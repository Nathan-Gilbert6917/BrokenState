# Teams, travel and exploration

Detail for section 5 of [docs/agents/features.md](../agents/features.md). `[name]` is `prototype/src/sim/name.js`; `ui/name` is `prototype/src/ui/name.js`. Session notes behind POIs and nomads: [docs/prompts/poi-and-nomads.md](../prompts/poi-and-nomads.md).

Contents: [Team inventory and handing over goods](#team-inventory-and-handing-over-goods) · [The map's right-click team menu](#the-maps-right-click-team-menu) · [Some of a team on jobs of their own](#some-of-a-team-on-jobs-of-their-own) · [The hands in a fight](#the-hands-in-a-fight) (and [Carrying furniture and appliances](#carrying-furniture-and-appliances), [Extracting with a piece in the arms](#extracting-with-a-piece-in-the-arms)) · [Vehicles](#vehicles) · [A lost team's vehicles keep what was in them](#a-lost-teams-vehicles-keep-what-was-in-them) · [Recover the convoy](#recover-the-convoy) · [Weather on the road](#weather-on-the-road) · [Tents](#tents) · [Travel event cards](#travel-event-cards) · [An overrun convoy](#an-overrun-convoy) · [Campsites](#campsites) · [Points of interest (POIs)](#points-of-interest-pois) · [Gun stores, pawn shops and hardware stores](#gun-stores-pawn-shops-and-hardware-stores) · [Shops and services as places, as franchises](#shops-and-services-as-places-as-franchises) · [POI surveys and the per-POI raid flow](#poi-surveys-and-the-per-poi-raid-flow) · [Walking to a POI](#walking-to-a-poi) · [Tile heat and persistent POI containers](#tile-heat-and-persistent-poi-containers) · [Other groups survey and raid POIs](#other-groups-survey-and-raid-pois) · [City crawl](#city-crawl)

## Team inventory and handing over goods
Forming teams, the team's own inventory, teams meeting and handing goods over; supplies and rounds put onto a named member; guns and magazines leave a base loaded.

Modules: [teamform, teaminv, teammeet].

- **The team's supplies as stack tiles** (the user's request 2026-10-18: the ammo and magazines in the truck onto the survivors before a raid). In the team inventory window (and the raid plan's Team inventory) and a member's own window, what the team packed and what it found are one stock of tiles in the cargo box (not a "Packed:" line).
  - Each tile is dragged or clicked onto a member's pockets, rig pouches, pack or off hand through the stack mover (rounds boxed or loose; found cargo drawn on first, then packed supplies).
  - A box of rounds dropped back on the cargo is the team's rounds again at once.
  - Modules: [ui/inventory storageBox teamPool / teamHolders, INV_STACK_DESTS, the "inv" stack screen; ui/teaminv teamTab stackPanel; inventory settleStore unbox].
- **Supplies onto a named member** wherever supplies change hands (forming a team, Load at a base, Give goods, the inventory window's stores): a pick of any supply with an item form (rounds boxed or loose, water, meds, fuel, a food, parts) with a person target `{ sid, where: pocket | pack | rig, loose }` becomes items in that place (the rig: its admin and pocket pouches), within what the place takes, their room and max load [supitems suppliesOnto / supRoom / placeSupplies / suppliesHeld / parseTarget / SUP_PLACES, teaminv loadFromBase / dropSupplies, teammeet giveGoods, teamform formTeam opts.onto; ui/teamform, ui/teaminv, ui/teammeet, ui/inventory INV_STACK_DESTS].
- **Rounds onto a named member** in the same places: a round key with a person target becomes boxed or loose items within their room and max load [supitems roundsOnto / roundRoom / parseTarget, teaminv loadFromBase / dropRounds, teammeet giveGoods, teamform formTeam opts.rounds].
- **Guns and magazines leave loaded**: a team forming at a base (and a person joining one there) takes the rounds its guns and spare magazines show in the rounds badge out of the base's stock as the team's own, so a fight starts as full as the window showed. The preview weighs them and says how many; one going back in takes theirs back [gunrounds `loadoutRounds`; teamform `teamLoadout`, `loadoutCount`, formPreview `loadout`, formTeam, addMember, removeMember; ui/teamform summary].

## The map's right-click team menu
A right-click on the State Map gives a team's orders for that tile with their times; on the team's own tile, every order it can do there, with no team selected.

Modules: [ui/teamctx teamTileMenu / teamCtxHtml / runTeamAction / spotOrders, ui/teamsel selectedTeam / teamOnTile; main.js showCtx]; test `tools/teamctxtest.js`.

- With a team selected (picked on the map, its panel open, move mode), a right-click on a tile gives that team's orders for it in groups (Go, Base, Site, Land, Camp, Team, Field work), each with its travel and job hours and, greyed out, the reason it cannot be done now. Plain right-click replaces its plan (asking first when orders under way would go); Shift+right-click or the menu's toggle adds to its queue.
- "All orders" (folded elsewhere, ui.ctxAll) lists every order the team can be given for the tile that the groups above do not show (sim/parties.js orderOptions) and opens the team panel.
- **On the team's own tile, every order it can do there** (the user's request 2026-10-23: "When you right click on the tile your team is on show all the orders you can do"):
  - No team needs to be selected: with none, the right-click on a tile one of your teams stands on gives that team's menu (teamOnTile); the other teams and the hub's options stay in the fold below.
  - "All orders" is always open there (no fold toggle), and adds the team panel's orders on the spot (spotOrders): the other sweeps (2 tiles 12h, 3 tiles 24h, 4 tiles 48h), forage and hunt 4h and 12h, fish and cut wood 4h, field crafting (only what the team can make now), gathering a boat's materials on a shore, treating each hurt member with the team's meds, and stopping the job under way (Stop resting / Stop: …).

## Some of a team on jobs of their own
A team of two or more can send some of its people off on an order while the rest stay or work on, like a mobile base; they rejoin with what they gathered, and the team cannot move while any are out.

The user's request 2026-10-24: "When in a team of more than 1 you can select different survivors to do different jobs basically acting like a mobile base when it comes to jobs when sitting on a tile. When one or more survivors is out doing a job you cannot move the team as a whole to another tile. Any order a team can do can be assigned to one or more survivors ... Add to this menu to select which survivors will do it. The survivors you can select are of the only survivors available. When it is only one survivor in the team they are the only option or just have it implied and don't show the survivor to select".
- **Who does it, asked on the click** (the user's request 2026-10-24: "When you have a team selected and click an order that can be split to have one or more people do the task make it so you can select which survivors will do the task"; ui/whopick.js): clicking an order of a team of two or more standing on its tile, from the right-click menu (ui/teamctx.js splitPick) or the team panel (main.js "xp-order"), opens "<order>: who does it?" with a chip a survivor free on the team, all lit (the team does it), Whole team, the ones out listed apart, Send N; the menu's own reason when the people picked cannot do it. The land jobs ask who in their hours box instead (ui/landorder.js whoRow, "land-who"): the estimate is theirs. Never asked for one survivor, a team on the move or busy, nor an order only the whole team gives (sim/detach.js splittable: Enter, Establish base, Build outpost, Strike camp, Drive home, Set up camp, the Scout-first camps, resting, treating someone). The menu shows only who is out under its head.
- **Off on their own** (detach.js detach): the people picked split off as a detachment (teammeet.js moveMembers: their share of the food and water; detach.js: their share by head of the other packed supplies, and the cargo's spare axes, pickaxes or rods for Cut wood, Gather stone or Fish), p.detachOf the team's id, and do the order with every rule a team has. When it cannot start they go straight back into the team.
- **Back** (detach.js detachHour, parties.js awaitOrders: no orders card): done, on the team's tile they merge into it (teammeet.js mergeTeams: what they gathered into its cargo); a job elsewhere, they walk back first; a plain move leaves them there as a team of their own. Call back (the team panel's Out on jobs card, and the detachment's own panel) stops the job and brings them back.
- **The team stays** (detach.js detachProblem): while any are out, parties.js orderMove and startReturn refuse, a queued move, sweep, nearby, area search or crossing waits at the front of the queue (orders.js startOrder: p.waitDetached) and goes once the last is back; the menu greys out its moves with why. The rest can take any job on the tile meanwhile.
- Player teams only. Modules: [detach, teammeet moveMembers quiet, parties awaitOrders / orderMove / startReturn, orders startOrder, world hourOfWorld, ui/teamctx, ui/landorder, ui/expedition detachCard, main xp-order / tc-do / xp-callback, ui/whopick]; test `tools/detachtest.js`.

## The hands in a fight
Carry weight and load bands, physical supply carrying, carry kit and rigs; whatever is carried in the arms fills the hands in a fight.

Modules: [load, carry, carrykit].

- Anything in the carried part of the inventory (a load or bag in the arms, finds carried loose) fills the hands: no shooting, reloading, doors or windows until it is set down or stowed. Two different things carried and nothing more is taken. Half cover is still vaulted, at double the movement, or the load is set down over it [carry, raidloot, combat VAULT].
- **The Carried list shows all that fills the hands** (the user's report 2026-10-20: "hands full" over an empty list):
  - the bag or cart in the arms (its grid under it; dragged onto the ground it is set down, a cart let go, free);
  - the team's supplies in the arms (taken off a ground pile in a team's fight they go into the arms: carry pileToArms; dragged onto the ground, set down free: dropArmsSupply);
  - a hand on a teammate's cart; the finds carried loose.
  - A crumb of a part-unit carried loose fills no hands (HAUL_MIN) and goes along with the last whole unit moved (raidloot raidMove).
  - On the State Map the Supplies carried box's Carried (hands) row names the bag or the cart pushed [ui/inventory carriedList, ui/carry armsRow].
- **What the arms hold is weighed** (issue #12, 2026-10-25): the team's supplies in the hands (`u.hands`) and the finds carried loose (`u.haul`) count in a fighter's battle kg too (carrykit `weighPlayer`), weighed again whenever something is picked up or set down in the arms (carry `fitHands`, `dropCarried`, `pickCarried`, `pileToArms`; furnicarry `reweigh`). Before, only the items worn and the bag counted.

### Carrying furniture and appliances
The user's request 2026-10-25 (issue #12, part of the interiors epic #7): "Some appliances, furniture etc can be picked up and put into carried and making you very slow due to weight and some will require two survivors to carry to a vehicle. […] Takes 2 actions to pick up the appliance, furniture etc and uses 2 actions from both survivors when using another to help. Sharing the weight reduces the weight in half for both survivors making them be able to move faster. They are now tethered to each other and must be in adjacent tiles until they set it down or put in a vehicle. […] You can place the appliance, furniture etc in an adjacent tile your survivor can see. For group of two it goes to the left or right of the two so it's parallel to them you choose."

Modules: [furnicarry `LIFT`, `liftDef`, `liftTargets`, `liftHelpers`, `liftPlan`, `liftAct`, `setTargets`, `setAct`, `stowAct`, `dropPiece`, `tetherRound`, `tetherMoveRefusal`, `followTether`, `pieceStairs`, `reweigh`, `refitPiece`; carrykit `weighPlayer`; carry `handsCount`, `armsBusy`, `armsText`, `handsWord`, `dropCarried`, `fitHands`; combat `combatAct` ("liftPiece", "setPiece", "stowPiece", "move", "goup"/"godown", "extract", "retreat"), `canVault`, `dashRange`, `sneakAct`, `refitUnit`, `startPlayerTurn`; barricade `pieceOff`, `pieceOn`, `freeForPiece`; raidloot `takeRule`; grouppois `raidPoiAsGroup`; ui/combat `pieceButtons` / `pieceChooser` / `pieceCbAct` / `pieceClick`, ui/battlebar, ui/keymap, ui/codex "Carrying furniture"]; test `tools/furnicarrytest.js`.

- **The pieces** (furnicarry `liftDef`, the one accessor): the catalogue's (data-furniture `pieceDef`, issue #8) weight, carry class (`"one"`: one survivor, very slow, or two sharing; `"two"`: two needed; `"fixed"`: never lifted: a toilet, a bathtub, a sink, cell bars, a safe, a bar counter...), footprint (`size`: a bed 1 × 2, a sofa 2 × 1) and item form (data-furniture `itemKey`: `f_<kind>`, the fridge its own `fridge` item). The item rows (data-furniture `FURNITURE_GEAR`) are merged into `GEAR` by data.js where no other row stands (the appliances' own, data-appliances, win), marked `piece: true` and kept out of the starting kits, trunks and backgrounds (startgear `slotChoices` / `trunkChoices`, custombg `slotOptions` / `trunkOptions`) so their dice stay as they were; each has its item entry in the codex, and the Carrying furniture entry lists them by class. Every `"one"` piece weighs at most 30 kg and every `"two"` piece at least 35 (data-furniture `CARRY_KG`): a 25 kg table, a 30 kg cabinet, a 22 kg bed alone; a 60 kg fridge, a 45 kg sofa, a 230 kg piano by two. Hay bales and rain barrels are `"one"` pieces too. Started before #8 merged with a local table (`LOCAL_KINDS`), swapped for `pieceDef` before the merge to dev.
- **Lift** ("liftPiece", Alt+U; `LIFT.AP` = 2, the user's): a survivor of yours with both hands free (nothing carried, nobody carried or dragged), not gripped, right next to a piece (any side) or to a piece item lying on a ground pile within reach. Never a fixed piece, one someone stands on, one on fire, a locked one. A piece of 2+ cells takes its other cells along (`pieceCells`: the cells with its number, `c.pc`, as roomlayout lays them; else the one right beside it of the same kind: a bed laid as two cells), its one container (`w × h`) with it. A painting or a wall clock hung on a wall (decor `c.wart.piece`, issue #13) is taken down the same way from the floor cell next to the wall (one person, 2 actions): it becomes its `f_painting` / `f_wallclock` item and `c.wart` goes; it is never hung again in a raid (set down, it stands on the floor as a 1-cell piece). The cell goes back to open floor or the door frame it stood in (barricade `pieceOff`). A container on it is emptied first: rolled if nobody had opened it (combat `searchBox`), its contents onto a ground pile on the cell; its record stays, empty and searched (so a revisit never refills it: poicont), and goes with the piece (`u.pieceBox`). The piece becomes its item in the arms (`u.bag` = `s.gear.carry`; `u.piece` the kind). A little noise (`LIFT.NOISE`, the unaware within `LIFT.RADIUS` 2).
- **Two survivors** (the user's: 2 actions from each): a helper is any teammate with free hands and both actions right next to the piece or to the lifter (`liftHelpers`); the Lift chooser names them (Alone / With …). A `"two"` piece takes the first helper there is, and is refused alone ("The refrigerator (60 kg) takes two…"); a `"one"` piece may be shared. Both are tethered (`u.tether`: the other's unit id) and each is weighed at half the kg (`u.shareKg`, `LIFT.SHARE` 0.5, the user's); the carrier holds the item, the helper `u.piece` (both hands: carry `handsCount` 2, `armsText` "the other end of the refrigerator").
- **The weight and the pace** (carrykit `weighPlayer`, furnicarry `pieceAdjKg`, `pieceKg`, `crushMob`): alone the piece counts its full kg, shared its half on each; the band from the total as for any load (`CARRY.BANDS`: 5 / 5 / 4 / 3). Past `MAX_LOAD` (40 kg) the piece's own kg crushes the pace (`LIFT.CRUSH`): mob = max(1, floor(mob × 40 / kg)): a 60 kg fridge alone 3 × 40 / 60 = 2 tiles an action, a 120 kg piece 1. Lift never puts a `"two"` piece on one person, so alone it happens only to a piece carried in from the road in the arms (the fridge item on the State Map); shared, a piano's 115 kg each is 1 tile. A pair moves at the slower one's pace (both set to the lower mob). In the test: a 25 kg table on a survivor in a pistol and a vest (about 5 kg) is 30 kg, Heavy, 4 tiles; the fridge alone 2; shared, 30 kg each plus kit (about 35 kg: Heavy, not Medium as the ticket guessed, since the Medium band ends at 28 kg), 4 tiles each, twice the lone pace.
- **With a piece**: no shooting, doors, windows, reloading (carry `HAND_ACTS`), no searching, taking things, getting into the vehicle, dragging, shoving, setting it over cover, carts (`PIECE_ACTS`, `pieceRefusal`); never a vault (combat `canVault`), never a dash (combat `dashRange`: one action's move at a time), never sneaking (`sneakAct`); the stairs take both actions (`LIFT.STAIRS_AP`; each of a pair, the partner onto a free cell next to the stairwell on the other floor: `pieceStairsRefusal`, `pieceStairs`, hooked in combat "goup"/"godown" where `moveToFloor` is called). A closed door stops them (hands full): a third teammate opens it, or it is broken.
- **The tether** (the user's: adjacent until set down or put in a vehicle): either of the two may move; the one who moves leads and the other steps along for free onto the nearest free cell next to where the lead ends (`followTether`, as the ram crew follows its lead). A move the other cannot follow (walled in, a closed door, someone in the way) is refused (`tetherMoveRefusal`: "… cannot keep up there"). Extracting or slipping away, the two leave together. After every order and at the start of your turn (`tetherRound`): one of them down or killed, gripped by the dead, or parted (shoved, on another floor), and the piece is set down (`dropPiece`) and the tether ends; a lone carrier going down too.
- **Set down** ("setPiece", Alt+G; `LIFT.SET_AP` 1, each of a pair): alone, onto a free cell next to the carrier (any side; open floor or a door frame, nobody on it, not burning, no cart: barricade `freeForPiece`) that they can see (combat `canSeeAt`); a 2-cell piece needs both cells, the second straight on from them. A pair: the piece goes to the **left or right of the two**, parallel to the line between them (the side picked in the chooser, or a cell on that side clicked): the cell beside the carrier on that side for a 1-cell piece, the two cells beside both for a 2-cell piece; standing diagonally, the one cell next to both on that side. The cell is the piece again (barricade `setPiece`: its hp, or what was left of it, `c.moved`; a door frame kept under it, a barricade), its container record with it, empty and searched (a lootable kind brought from elsewhere gets a new empty one).
- **Drop carried** (free) and every forced drop: onto a free cell next to the carrier (between the two first, then the one faced), seen or not; else the item lies on a ground pile on the carrier's own cell, to be lifted again from there (Lift). A piece item is never taken off a pile or out of the vehicle by hand (raidloot `takeRule`: "… is lifted, not picked up").
- **Into the vehicle** ("stowPiece", Alt+W; `LIFT.STOW_AP` 1; extracting with it does the same by itself, below): at the vehicle (raidloot `atVehicle`; a field battle's evac strip with the car: carriers `carHere`), the full item into the team's cargo (parties `addGearToCargo`) if the trunk has the room (raidloot `trunkSpace`, carriers `carRoom`; a bike only its racks): "No room in the car for the refrigerator (46 kg over)." The tether ends.
- **Carried from the road**: a survivor with a piece item in the arms (a fridge, an `f_<kind>` brought from an earlier raid; a crafted bed from data-beds is a plain both-arms bag) when a fight starts carries it by the same rules (carry `fitHands`: `u.piece`); a fight the team starts sets it down first as any bag (carry `stageLoads`).
- **AI parity** (docs/adr/0001-ai-parity.md): the human AI never lifts a piece in a fight (it shoves: barricade `aiBarricade`). The battle AI on your side and the raid bot set one down to fight (carry `autoDrop`, `botDropToFight`) and never lift one: the ticket allowed the bot a `"one"` piece on its way out with a car, left out on purpose, since it would change what every seeded headless raid does; crawl `quickSearch` takes none. Other groups' abstract raids (grouppois `raidPoiAsGroup` `opts.vehicle`) carry a `pieces` flag on the haul when they came by vehicle; nothing more.
- **Saves**: `u.tether`, `u.shareKg`, `u.piece`, `u.pieceBox` on the battle's units and the item in `s.gear.carry` (the same object as `u.bag`, kept by the save's graph) round-trip (the test).
- **The sprites** (issue #17, the user's request 2026-10-25: "Show an update to the sprites to show them carrying the appliance, furniture etc"): one carrying a piece alone stands in the carry pose with the piece's own iso picture in the arms (in front of them, behind them when they face away); a heavy piece alone (past 40 kg on them: `pieceKg`) in the low pose, gripped just off the floor, bobbing slowly; a tethered pair face each other with the piece drawn once between them, a thin line in their colour joining the hands under a 1-cell piece. The HANDS chip and the badge over the head read "✋✋ Refrigerator"; Set down lights the cells it can go on; a CARRY tag when the piece is not drawn. On the State Map a team member with a piece in `s.gear.carry` walks home with it on the shoulders. Detail: [ui.md, Carrying furniture: the carry poses](ui.md#carrying-furniture-the-carry-poses). Test `tools/carryviewtest.js`.
- **For the sibling tickets**: #17 (sprites, done: above) reads `u.piece`, `u.tether`, `u.shareKg` and the item in `u.bag` / `s.gear.carry`; #18 (extraction, below) settles the item in the arms of whoever extracted with it.

#### Extracting with a piece in the arms
The user's request 2026-10-25 (issue #18, part of the interiors epic #7): "You cannot hold these items in your arms and be taken back unless you have a vehicle then it automatically gets added to the vehicle inventory if you extract with something in your arms. If you do not have a vehicle show a message saying whatever appliances, furniture etc you were carrying was dropped due to exhaustion."

Modules: [furnihome `piecesAtExtraction`, `homeRoom`, `extractNote`, `pieceGoesHome`, `exhaustText`, `piecesText`, `crawlPieces`, `crawlMoveHours`, `piecesOut`, `pieceLedger`, `mergePieceLedger`, `applyPieceLedger`; furnicarry `placeNear`, `touchPiece`, `endCarry`; combat `endRaid`, `combatAct` "extract", `autoRaidTurn`; poicont `poiRaidStart`, `poiRaidEnd` (`poi.cont.pieces`); scavenge `afterRaid`; citycrawl `nextBlock`, `finishCrawl`; aiscav (`vehicle` to grouppois `raidPoiAsGroup`); ui/combat `raidButtons` (the Extract tooltip), ui/alerts `events` ("exhausted"), ui/citycrawl `hud`, ui/codex "Carrying furniture"]; test `tools/furnihometest.js`.
- **Since the carry playthrough (issue #48, 2026-10-26)**: a piece the ledger puts back by the door no longer stands on someone who arrived there (`applyPieceLedger` steps them to the nearest free cell); a piece loaded into the vehicle during the raid is in the raid's loot when the vehicle goes home (`b.raid.stowed`, combat `endRaid`); plural names read right ("The shelves go into the work van", furnicarry `pluralName`). The whole flow is played end to end by `tools/carryplaytest.js`: [combat.md, The carry playthrough](combat.md#the-carry-playthrough-issue-48).

- **When**: at a raid's end (combat `endRaid` → furnihome `piecesAtExtraction`, before the bodies and the hauls go home: carriers `endBodies`, raidloot `raidHome`), for every piece still in the arms of someone who got out (`u.left`, alive). A pair's one item counts once (looked at from the carrier). A pair parted on the way out (one down or left behind) sets it down first (furnicarry `tetherRound`), and a pair with one still on the map sets it down at the one who stayed (`placeNear`): "The refrigerator is set down where Dana and Lee parted."
- **With a vehicle** (the user's "automatically gets added to the vehicle inventory"): the team's car or truck kept (someone left in it: endRaid's `vehicleKept`) takes the piece into its cargo (parties `addGearToCargo`) when it has the room as Load into vehicle reckons it (`homeRoom`: raidloot `trunkSpace`, carriers `carRoom`), the arms emptied (furnicarry `endCarry`), a line ("Ivy and Theo heaved the refrigerator into the work van.") and the piece in the raid's loot. Too full: set down at the exit, "The work van is full: the refrigerator stays by the door."
- **Bikes** are no vehicle for a piece their racks cannot hold (decided here, after the ticket): a piece of at most one rack's 15 kg (`VEHICLE_TYPES.bike.rack`) within the racks' room goes on them ("onto the bicycle racks"); anything heavier is dropped from exhaustion as on foot.
- **No vehicle** (the user's message): the piece is set down at the exit (`placeNear`: the free cells nearest where the carrier left, ring by ring, as a set-down piece stands: barricade `setPiece`, `c.moved`) and the message is in the raid's summary, the log (scavenge `afterRaid`, warn, with the team's name), the team's report (its orders card) and so the alerts (ui/alerts `events`, kind "exhausted", 🪑, warn, a day): "Exhausted, the team dropped what it was carrying: two chairs, a refrigerator. They stand by the door: come back with a vehicle to take them." (`exhaustText`, `piecesText`).
- **The ledger** (a point of interest's raid): every cell a piece was lifted off or set on in a raid (furnicarry `touchPiece`: `b.raid.pieceCells`) is kept in `poi.cont.pieces[mapId]` (`pieceLedger`, merged over the last raid's: `mergePieceLedger`) and put back on the next visit (`applyPieceLedger`, in poicont `poiRaidStart` after the scenes): the piece dropped at the door stands there, to be lifted again (a car brought next time takes it home), and the cell it was lifted off stays empty. A container moved with its piece keeps where it stands (`box.shifted`, the ledger's `at`). Saved with the POI (pois `packPois`). Without a ledger (a street fight, a raid on a tile with no POI) the map goes with the raid: "Nobody can come back for it: it is lost."
- **The warning before leaving**: the Extract button's tooltip (ui/combat `raidButtons`) and the extract order's own line say what will happen (`extractNote`): "No vehicle: the floor lamp will be dropped at the door (too exhausted to carry it home)." / "No room for the refrigerator in the work van…" / "The refrigerator goes into the work van (if the vehicle goes home with the team)." The ticket's confirm dialog is this line and the tooltip (there is no confirm on Extract).
- **The raid bot** (combat `autoRaidTurn`) sets a piece down before it extracts without a vehicle to take it (`pieceGoesHome`; it never lifts one, #12), so headless raids (`autoCombat`, the tools) never end with one carried out on foot.
- **The city crawl**: a building on the crawl (`setup.handler` "crawl") is not the way out: a piece carried out of it stays in the arms, marked `it.crawl`. Each block's walk takes the hour ÷ the slowest carrier's pace (`crawlMoveHours`, citycrawl `nextBlock`: load `personLoad` of what they wear and carry; a 60 kg fridge alone, Overloaded, 2 hours), and the crawl's panel lists it (ui/citycrawl `hud`: "Carrying the refrigerator (Ivy)"). Out of the city (citycrawl `finishCrawl` → `piecesOut`): into the team's vehicle (a car or truck, waiting at the entry; bikes as above) with a line, else dropped from exhaustion and lost (the rim is no building), the message in the log and the crawl's closing line. A piece set down inside a building stays there in its snapshot (citycrawl `snapshotBuilding` keeps the cells). For #21 (the crawl's parity): the rule lives in `piecesAtExtraction` (the crawl branch), `crawlPieces`, `crawlMoveHours` and `piecesOut`. Since #21 (below): the crawl branch also notes the other end of a pair on the item (`it.mate`, read by citycrawl `notePieces`); the walk's pace is citycrawl `carryPace` (by pairs: half the kg each); since #48 `crawlMoveHours` scales `carryPace` too (it had weighed each of a pair with the whole piece); `piecesOut` runs when the team walks out at the entry block, where the vehicles wait; out at any other rim block the piece is dropped from exhaustion and kept on that block, not lost (citycrawl `rimExitPieces`).
- **Not this rule's** (decided here): the hour-by-hour search (scavenge `searchHour` / `extract`, the Overrun and Swarming hard extractions too) and a raid by the numbers lift nothing (no map, no arms); a piece carried on the road (the fridge hauled home, an `f_<kind>` from earlier) keeps #12's road rules, and a raid's start still sets it down (carry `stageLoads`) and hands it back after, unless it was lifted again and carried out.
- **A vehicle's own cargo** (vehicles `cargoIn` / `carryCargo`: a lost team's or a convoy's vehicle) carries a piece's item as any gear; nothing new (the test).
- **AI parity** (docs/adr/0001-ai-parity.md): other groups' raids carry a piece only when they came by vehicle: aiscav passes the party's vehicle to grouppois `raidPoiAsGroup` (`opts.vehicle`), which flags the haul (`pieces`); the one check, no card. Pieces you left at a POI's door are not taken by them yet (a follow-up).

## Vehicles
Fuel, condition, breakdowns and bicycles; one person per vehicle; found cars, military trucks, road blockages, road repairs and vehicle trade.

- Fuel tanks, condition, breakdowns, abandonment and recovery; bicycles [vehicles].
- **One person per vehicle** (a seat for each person): a team that loses people leaves its extra vehicles on its tile; after a raid with too few left to drive, you pick which go on (the card and its rules: [campaign.md, Custom mode and starting vehicles](campaign.md#custom-mode-and-starting-vehicles)) [walkers].
- **Found cars**: get in, find the keys or hotwire it, inspect it, and claim the few that run [foundcars].
- **Military trucks, Humvees and MRAPs** [miltrucks]; test `tools/miltrucktest.js`.
- **Road blockages** [roadblocks]; **road repairs**: a breakdown fixed on the road holds the team up, and a log line and alert say when it is moving again [repairwait]; **vehicle trade** [vehicletrade].

## The map's vehicles by type
A team's piece on the State Map, and the marker of a vehicle left on a tile, show the vehicle's type.

The user's request 2026-10-25: "change the world map vehicle sprites to change based on the type of vehicel", then "Improve to look more like real cars ... same for 2d map sprites". `ui/render.js` `vehicleKind` maps a vehicle's type (vehicles.js VEHICLE_TYPES) to a piece: `sedan`, `suv`, `van`, `hummer`, `miltruck`, else `truck` (the pickup; a bicycle has its own rider), for `partyLook` (the team's piece, `ui/mapfigures.js` mapPartyCanvas, with its upgrades) and `markerLook` (the parked marker, `ui/mapsprites.js` markerSpriteCanvas → paintParked, and the flat catalogue's partySpriteCanvas). The map's pieces are built as the battle's models are (ui/vehiclemodel.js, [combat.md](combat.md#vehicles-in-battle)) at the map's scale: true prisms (figures.js `flat`), a low body from sill to belt, a six-sided cabin with the windscreen and the rear window sloping to the belt, the wheels in their arches; the SUV with its roof rack and two doors a side, the work van one box with the cab's windows forward and the sliding door's line, the team's Hummer olive mixed with its colour with the gun only as its upgrade (the groups' and the outsiders' `humvee` is the same body, always armed), the Army truck, the MRAP and the armoured truck flat-sided. The flat 22 × 13 sprites (`carSide`: the body from the sill to the lit belt line, the cabin a trapezoid of glass between its pillars, the wheels in their arches, a lamp, a tail light, a grille; a rack on the SUV, the pickup's straight-backed cab and tarp, the van's box) carry the armour overlay's bands (ARMOUR_AT) for each kind. Dev page: `tools/mapfigures.html` (the Teams row). Test: `tools/vehiclemodeltest.js`.

**The windows' pictures** (the user's request 2026-10-25, "Add real car models to the inventory and vehicle windows too"): `ui/vehiclemodel.js` `vehicleImg(v, size, { color, yaw })` gives a vehicle record's picture as an `<img class="sprite vehimg">` (its height in rem, the width to match) from the same model painted whole (`carImgURL`: a data URL kept by look and heading, 64 at most; `vehicleCar` turns the record into a map car: its type, its upgrades as the cells' tag, a blown-up one a wreck, a bike stack a bicycle; the team's own in the team's blue, another's in `color`), and `carImg(car, size)` the same from a cell's car. Shown in the base window's Vehicles tab (ui/ui.js baseVehicles: parked here, bikes, elsewhere), the inventory window's team cargo header and a raid's trunk (ui/inventory.js, each vehicle of the fleet in a `.vehpics` strip), the team inventory's fleet chips (ui/teaminv.js), the trip planner's vehicle buttons (ui/fleetpick.js), the new run's Starting vehicles rows (ui/startgear.js), the car row beside a found car in a battle (ui/carpanel.js: the car as it stands on the map) and the trade window's Vehicles rows (ui/tradewindow.js: theirs in the group's colour, a merchant's gold). Styles: `styles.css` img.vehimg, .vehpics.

## A lost team's vehicles keep what was in them
A whole team lost away from a base leaves its vehicles abandoned and marked on that tile with its supplies and cargo inside; Recover vehicle brings them back, unless a group nearby loots them first.

The user's request 2026-10-25: "If a whole team is lost keep the vehicles in the tile lost to be recovered with whatever was in them as long as other groups do not loot it first". Modules: [parties wipeParty / stowLost / recoverVehicle / unloadLeft, groupworld vehicleDaily / takeVehicle / stripRacks, vehicles vehicleCapacity / carryCargo / cargoIn, markers markAbandonedVehicle, carry leaveOnGround, arsenal unloadVehicle]; test `tools/lostfleettest.js`.

- **Where it ends**: every way a whole team is lost (a battle, a raid, an ambush, a crawl, an event, a crossing, a hurt with nobody left) ends in `wipeParty`. Away from a base its vehicles stay abandoned on the tile (`loc: { kind: "abandoned", tile }`), marked on the map "(its team was lost, cargo inside)" (markers.js `vehicleMark`), as before; at a base everything goes into the base as before (now with the bodies in the car laid out there: carriers.js `bodiesHome`).
- **What stays inside** (`stowLost`): the team's packed supplies and found cargo go into its vehicles, the lead first, each up to its own room (`vehicleCapacity`: a car's payload, 15 kg a bike's rack; what is in it already counts; nobody rides, so no riders' 80 kg), the most worth a kilo first (`trimCargo`'s order turned round), food by the kilo and the rest in whole units, the very items (a pack keeps its contents). Before this (until 2026-10-25) all of it went to the ground.
- **What goes on the ground** (the tile's death site, as before): what has no place in a vehicle (more than the payloads or the racks take, or a team with no vehicle), the things of the bodies in the car (carriers.js `endBodies` puts a dead body's things on the ground when nobody keeps the car; a body already in the car from an earlier fight the same way; they were lost before), and the dead's own kit (world.js `killSurvivor`, unchanged). Scavengers strip it (economy.js `deathSitesDaily`). Log: "A whole team was lost near … Its 2 vehicles stand abandoned with what it carried inside, the rest on the ground there: marked on the map."
- **Recovered** with the vehicle (Recover vehicle, `recoverVehicle`): its cargo is the team's cargo again as far as the team has room; what does not fit is set down on the tile's ground (`unloadLeft` → carry.js `leaveOnGround`: Pick up… or Recover it later; it was lost before) and the log says so. A second vehicle on the tile stays with its cargo for the next recovery.
- **Looted first**: a group with a base within `VEH.TAKE_RANGE` (2) tiles takes a car at `VEH.TAKE` × its vehicles weight a day with its cargo into its stores (`takeVehicle`, arsenal.js `unloadVehicle`), as before; bikes (no group keeps them) now have their racks stripped at the same dice (`stripRacks`): the cargo into their stores, the bikes left there, the marker "(its racks stripped)", logged ("… stripped what was on the 2 bicycles that stood at …") when the group is known or the tile in sight. Empty bikes are left alone. The same goes for bikes left with cargo by `leaveVehicle`.
- **The enemy who wins the vehicle**: a team whose last people are taken prisoner (conflicts.js `endIfEmpty`: a surrender, a lost fight with the rest dragged off) loses its vehicles to the captors with what is in them (arsenal.js `captureVehicle`), unchanged: it is not wiped (`wipeParty` is not called).
- **AI parity** (docs/adr/0001-ai-parity.md): a group's vehicles are motor-pool records (`f.vehicles`) and its parties' hauls abstract; none stands on the map when one of its parties is beaten (a caravan's escort vehicle goes to the winner: caravanraids.js `loseGroupVehicle`; their scavengers' car is left empty for you: conflicts.js `takeTheirVehicle`), so there is no field-wipe path to mirror. The groups loot your lost vehicles by the rule above.

## Recover the convoy
Your vehicles left abandoned on a tile (the convoy) can be fetched by a team of yours, as a raid on that tile, or by an allied group's party for a fee.

The user's request 2026-10-25: "Recover the convoy. You can task a team or request an allied group to recover the convoy. Requesting an allied group will cost something, and they will create a team, go to the tile, get the vehicles and supplies, and move the team with the recovered equipment to your nearest base, or to a designated base or location given in the request. The request is sent by envoy if no radio communications are established. When you send a team, it's a move-to-tile raid: try to get as much as you can before leaving back to the base of origin." Modules: [convoyrecover, parties MISSIONS.convoy / missionProblem / orderOptions / arrive / aiPartyHour / removeParty / takeVehicleCargo, envoys KINDS.recover / aiAnswer / deliver / CARDS.recovery, groupworld vehicleDaily, kit; ui/ui siteMissions, ui/envoys composer]; test `tools/convoyrecoverytest.js`.

- **The convoy** (`convoyAt`): your vehicles standing abandoned on a tile (`loc.kind === "abandoned"`: a lost team's, ones left with too few drivers, left after a raid or a breakdown), not a found car that needs repair, not a burnt-out wreck.
- **Your team** (mission "convoy", "Recover convoy"): offered in the team's orders menu (`orderOptions`) and on a vehicle marker's tile card (ui.js `siteMissions`, beside Recover vehicle); refused where no vehicle of yours is known (`convoyProblem`). It travels by the normal rules.
  - **On arrival** (`convoyRecoverArrive`): the vehicles there join the team (up to `MAX_VEHICLES` with its own; cars first, the most worth first) with their cargo still inside, their markers go, and the team goes in: a raid on the tile's street map (`raid.building: "street"`) against the tile's dead and any group there (scavenge.js `raidEnemies`), the vehicles parked by the entry edge (combat.js `createRaid` / `placeRaidConvoy`: no spot is kept where they were left). By the numbers (autopilot, headless) combat.js `autoResolveCombat` resolves the same raid.
  - **Out again** (combat handler `convoyRecover`): a driver for each vehicle (walkers.js `shedSurplusVehicles`: the worst left first); the cargo of the ones that go comes into the team's load as far as it has room (parties.js `takeVehicleCargo`), the rest is set down on the tile (carry.js `leaveOnGround`, marked); a vehicle nobody drives stays with its cargo inside, marked. Nobody back at the vehicles: they all stay. Called off: they stay. The raid's hours pass, then the team heads for its **base of origin** (`startReturn`, `homeBaseId`). Log: "Convoy recovered at …: the Pickup truck and the Work van drive for … with …".
  - **Already gone** (`convoyGone`): a card "The convoy is gone" says who took them when the group is known to you (`noteTaken`: `state.vehiclesTaken`, the last `RECOVER.TAKEN_KEEP` = 30, written by groupworld.js `vehicleDaily`, recording only), "Someone drove them off" otherwise; the markers go and the team turns for home.
- **An allied group** (envoys.js kind "recover", "Recover our convoy", the Diplomacy window's Envoys tab): offered only to a coalition member or a group at standing `RECOVER.MIN_STANDING` (15) or more (`recoverOffered`). Pick the convoy's tile and where it goes: your base nearest the convoy (default), any base of yours, or a known place near it (`recoverDest`).
  - **Price** (`recoverFee`, `RECOVER.FEE`): value = 20 + 4 × tiles (their base nearest the convoy → the convoy → the destination) + 0.15 × the cargo's worth + 0.05 × the vehicles' worth (vehicles.js `vehicleValue`), asked in fuel, meds, food, scrap and parts, the good they need most first (trade.js `need`), out of what your base has; a base that cannot cover it cannot ask.
  - **Answer** (`recoverAnswer`): refused when relations are too poor, or when they are at war with a group with a base within `RECOVER.WAR_RANGE` (8) tiles of the convoy; else the envoy dice at 0.5 + (standing + `RECOVER.ODDS` 10) / 100. With a radio link the answer is at once and an envoy carries the fee; without one the envoy carries the request and the fee (the "carry" path, as aid). The fee is handed over when the envoy arrives and they agree.
  - **Their party** (`sendRecovery`, an AI party of kind "recovery", `p.recovery`): a driver for each vehicle and `RECOVER.GUARDS` (2) guards, from their base nearest the convoy. It walks there (parties.js `aiPartyHour`; raiders on the road may ambush it as a caravan), fights the tile's dead by the numbers (groupfight.js `fightSides`: infection × `RECOVER.DEAD_PER` 14 plus a horde there, as their parties meet a horde), then drives the vehicles (`loc.kind: "towed"`) with their cargo to the destination (`recoveryArrive`).
  - **On arrival**: at a base of yours the vehicles join it and their cargo goes into its stores and armory (storage limits as today); at a tile they are parked as your abandoned vehicles, cargo inside, marked "brought by …". Then the party goes home.
  - **Failure**: the vehicles gone before the party gets there: half the fee back by their caravan (`RECOVER.REFUND`, caravans.js `sendCaravan` as a gift) and word to you (envoys.js `cardFromGroup` "recovery": a card now by radio, else carried by their envoy); the dead too many: the party pulls back, no refund; no road for the vehicles: they stay, half the fee back; the party lost on the way (an ambush, a horde: parties.js `removeParty` → `recoveryLost`): the vehicles stand abandoned where it happened, marked "its escort was lost". Every step is in the diary.
- **Saves**: `state.vehiclesTaken` and `p.recovery` are new; an older save has neither and loads as is.
- **Not done, and why**:
  - **AI parity** (docs/adr/0001-ai-parity.md): a group going back for its own abandoned vehicles is not built. A group's vehicles are motor-pool records and never stand abandoned on the map (see [A lost team's vehicles keep what was in them](#a-lost-teams-vehicles-keep-what-was-in-them)); giving them a field-abandonment path first would change how vehicles are abandoned, which this request ruled out. The groups use the same convoy rules on your vehicles (they loot them, and their recovery party is lost by the same road rules).
  - The player's pick of which vehicles go on (walkers.js `raidVehiclePick`'s card) is not asked after a convoy raid: the drivers rule picks, so the team can head home at once.
  - The autopilot does not send convoy recoveries (it still sends Recover vehicle, autopilot.js).
  - The group's party burns no fuel driving your vehicles.

## Weather on the road
Weather and the seasons now weigh on driving: spring mud and rain-soaked ground can bog a car down off the road, snow and frost make it thirstier, a frost or a blizzard can stall the start, and the planner gives the route's outlook before you send it.

The user's request 2026-10-25: "make weather and seasons matter more for decisions", especially for vehicles and convoys: winter shortening range, spring mud slowing convoys, heavy rain keeping vehicles parked. Modules: [weather VEHICLE_WX / mudOdds / wetGround / mudTypeMult / mudStuck / vehicleFuelWx / coldStartRisk / coldStart / roadOutlook, parties moveHour / stuckInMud / stuckText / aiPartyHour / onEnterTile / travelHours / fuelForPath / estimateTrip / launchExpedition / spawnAiParty / glideAt, orders orderLabel, caravans (leg fuel), puddles waterOf (the rain-hours clock); ui/ui weatherEta, ui/render SIT_LABEL]; test `tools/vehicleweathertest.js`.

- **The audit** (what was there before, 2026-10-25):
  - Mud slowing vehicles: **partly**. Mud already raised the cost of an off-road vehicle step (weather.js `travelFactor`, the day's table) and the planner showed the hours the weather adds. There was no chance of getting stuck, so that was built.
  - Winter fuel: **missing** (vehicles.js `tileFuel` read no weather), so it was built. Frost wear on parked cars and the garage's shelter (breakdowns.js, vehicles.js `shelteredAt`) were already there and are unchanged.
  - Cold start: **missing**, so it was built.
  - Storms flooding the fords: **not applicable**. The State Map has no fords: an unbridged river tile is closed to vehicles in every season (parties.js `moveCost`: Infinity), and on foot it is crossed only on winter ice (weather.js `ICE`, unchanged) or by boat (crossing.js; boat mishaps already rise ×2.5 in a storm and ×2 in a blizzard, `travelEffects.boat`). See "Not done".
  - The forecast in the move dialog: **partly**. The planner showed the hours the weather adds (`estimateTrip` `weatherOut` / `weatherBack`, ui.js `weatherEta`) from the fronts already on the map. Mud, the odds of getting stuck, fuel and a cold start were added.
  - Constants: **missing**. They are now in `VEHICLE_WX`.
- **Mud** (`mudOdds`, `VEHICLE_WX.MUD`): the chance per off-road step that a car gets stuck is `SPRING` (0.05) in spring plus `WET` (0.05) on a tile rained on long enough for puddles. That uses puddles.js's clock: `wetGround` → `waterOf`, `PUDDLE.AFTER` = 3 rain hours (a storm hour counts 1.5) over the last 36, drying over 12, in any season but winter.
  - No mud on frozen ground, in winter or on a road step. Bikes never get stuck.
  - The model scales it (`TYPE`): sedan and van ×1, pickup ×0.6, SUV ×0.5, Hummer and Army truck ×0.3. A fleet goes by its worst (`mudTypeMult`).
  - The roll (`mudStuck`) uses the play RNG, as `travelHazard` does, and only when the odds are above 0. Stuck means `HOURS` 2–5 hours: the team stops on that tile (what it went on to that hour is given back) and owes the delay before it moves, as a road blockage's (parties.js `stuckInMud`; `p.stuck = { tile, until, hours }`).
  - Never on the destination tile. The diary says "… bogged down in the mud near …". The team's card shows "Stuck in mud: free in N h" (orders.js `orderLabel`, parties.js `stuckText`) and the map pill "Stuck in mud" (`glideAt` kind "mud").
  - The state is the team's progress and `p.stuck`, both saved, so it survives save and load.
- **Winter fuel** (`vehicleFuelWx`, `VEHICLE_WX.FUEL`): a step in snow or a hard frost, or onto `SNOW_COVER` (0.3) of snow on the ground, burns ×1.15; in a blizzard ×1.3. It applies to the real use tile by tile (`onEnterTile` → `useFuel`) and to every estimate: `travelHours` step by step (`fuelUsed`, `fuelFair` returned), and `fuelForPath` with the tiles an hour apart from `startHour`, which defaults to now (`null` gives fair weather). So the planner's fuel needed, the autopilot's trips, supply runs, the plans' fuel and the groups' hauls and caravans (caravans.js passes each leg's hour) all shrink a car's range in winter.
- **Cold start** (`coldStart`, `VEHICLE_WX.COLD`): a trip setting off by car in a blizzard or a hard frost loses `HOURS` 1–2 at `CHANCE` 0.3 (a delay owed before it moves; `p.coldStart`; the diary says "the engines would not start in the cold", the map pill "Cold start"). There is none when every car is in the base's garage (vehicles.js `shelteredAt`), and none for a group whose base has a garage (`worksAt(f, tile).garage`).
- **The planner's outlook** (`roadOutlook`, `estimateTrip.outlook`, shown by ui.js `weatherEta` beside "+N h weather"): from what can be known now (the season, the ground, the fronts already on the map: `known`): the off-road tiles with mud, the odds of getting stuck at least once on the way out, a cold start, and the fuel the weather adds, e.g. "Spring mud on 5 of 7 tiles: +1 h, may get stuck (23%)" or "Mud after rain on 3 of 9 tiles: +5 h, may get stuck (14%); fuel +10%".
- **AI parity** (docs/adr/0001-ai-parity.md): the groups' parties roll the same mud on their off-road vehicle steps (parties.js `aiPartyHour` → `stuckInMud`; their model `p.vehicleType`, else a pickup's odds) and the same cold start when a party sets off by vehicle (`spawnAiParty`). Their estimates read the same fuel (`fuelForPath`, `travelHours`; the autopilot's `planTrip` through `estimateTrip`).
- **Not done, and why**:
  - **Fords**: there are none on the State Map to flood (see the audit). Adding fords would change the strategic step costs of unbridged rivers, which this request said to keep. Frozen rivers are respected as before.
  - The groups' parties burn no fuel tile by tile (their vehicles are abstract on the road, as before), so the winter fuel reaches them through their estimates only.
  - Estimates add no expected stuck hours: getting stuck is a roll, shown as odds in the outlook.
  - Battle-map weather (seasonfx, seasonground, puddles), the weather generator and farming are unchanged.

## Tents
Tent bags found as loot in three sizes, plus a makeshift tent, pitched at camp as beds and dry storage.

The user's request 2026-10-20. Modules: [tents, data-tents; staging, nightmarch, orders, hardcore-start, nomads, visitors, groupworks, grouppois, scavenge, combat; ui/ui campTentsCard, ui/storage, ui/itemart/tents]; test `tools/tentstest.js`. Tents as base-map pieces: [bases.md, Tents on the base map](bases.md#tents-on-the-base-map).

- **Kinds** (one table, data-tents.js TENT_TYPES, for the bags and the base map): one-person `tent1` (1×2, sleeps 1, S = 15 kg out of the weather), two-person `tent2` (2×2, 2, 2S), four-person `tent4` (3×3, 4, 4S; the rarest), and the makeshift tent (1×2, 1, no storage, built, no bag).
- **Carrying**: bags go in the In arms slot (`arms`; the four-person duffle in both arms), a cart's bed or the team's cargo (a vehicle's trunk), never a pack.
- **Finds** on their own dice: the hour-by-hour search by site or POI (campgrounds, campsites, hiker camps, ranger stations, lodges, cabins, the mall's sporting goods, a town, garages, houses, army sites; TENT_FINDS), raid containers (AREA_TENTS), the AI's POI raids (rollGroupTent).
- **Set up camp** takes half an hour instead of an hour when the team's bags sleep everyone (by the share for some; campPitchHours, parties.js pitchHoursFor; a job under an hour ends at its minute: orders.js tasksDue). (Later superseded for a base's setup by the camp spot rules: tent bags no longer shorten it; see [bases.md](bases.md#setup-time-and-yield).)
- **At camp** every bag is pitched as a base map piece (pt-int merge: basemap pitchTent, a base.buildings record with its bag on it; the old base.tents list migrates on load, tents migrateTentList).
  - Sleepers are its beds (a camp has none of its own: buildings baseBeds + tentBeds, once).
  - Storage is room out of the weather once (basestorage "tent" containers keyed b:<id>, storage.js's dry Tents room; assignable in the Storage tab like a storage building, food or gear kept in it by hand, never by Tidy up: the user's pick 2026-10-20).
  - Whoever has no bed sleeps rough (beds bedLine, the one rule: −1 a day, ×2 wet, ×3 freezing, a 3% chance of a chest cold a freezing night). Bags in the camp's armory go up for them (campTentsDaily, and the governor at any base: beds governBeds).
  - Strike camp packs the tents back into bags first; a camp gone leaves them in its cache.
  - pitchTentAtBase / strikeTentAtBase / pitchStoredBag put the base map's pieces up and down.
- **On the road**: Make camp puts the bags up for the night (roadTentLine, roadTentsHour).
- **Hardcore**: one one-person tent bag per starting survivor (TENTS.HARDCORE), in the car, pitched at the first home, so its 0 beds become one each.
- **AI**: nomad and raider bands set out with bags by kit (BAND_TENTS; drifters makeshift) and pitch them at camp. Rough sleepers slow a nomad band's recruiting by CROWDED_GROWTH × the share; their fresh food keeps better in them (bandSpoilMult); they walk the time their bags save (bandPitchSaved). A group's bags on its shelf are quarters at its camps (groupworks.js served) and its tents on the battle map at its camp (tents groupCampTents, conquest).

## Travel event cards
Choice cards rolled tile by tile by ground, season, weather and the dead nearby [events]; test `tools/roadeventstest.js`.

- The cards include the dead ahead, a blocked highway, a swollen creek, wolves or feral dogs, a painted horde warning, a lonely farmhouse, an orchard, a roadside gas station, an overrun camp, an overrun convoy of nine kinds (below), a stranger with the worm, the worm's dead animals in a field…

## An overrun convoy
A travel event card: an overrun convoy of nine kinds on a road, each with its own haul, escort gear and trucks; take what is left, siphon the tanks, bring the owners word or bury the dead.

The user's requests 2026-10-24: "add moving tile event to run into a overran convoy and you can try to take what is left"; later that day the search cut to 1 hour and the siphon to 30 minutes; then "have different kind of convoy types to determine the kind of items you get like pre-fall military, fleeing military, aid convoy, AI group traveling convoy, trade convoy, etc". A travel event card (events.js `convoy`, numbers in `CONVOY`, the kinds in `CONVOY_KINDS`, their gear in `CONVOY_GEAR`, the card built by `convoyCard`); modules: [events, autopilot pickChoice, foundcars fixableAt / fixOption, markers markAbandonedVehicle, vehicles createVehicle / fitMilitary, gundist swapGun]; test `tools/roadeventstest.js` (every choice, each kind forced on several seeds, the autopilot's answer, the dice bring one up in play); the gear in the loot census `tools/loottest.js` (sources `event:convoy:<kind>`).

- **Where**: a bare road tile (no POI) with infection over 0.15, weight 2 among the road cards. One weighted roll picks the kind by where the team is; a group of the kind's type with a base within 4 tiles owned it, its mark on the doors, named when the group is known.
- **The kinds** (title; what it hauled, 3 cargo picks on a pass unless said; the escort's gear and its chance; the trucks one of which may be left whole; the dead's risk multiplier; where it is likelier):
  - **An overrun Army convoy** (`prefall`): the evacuation's escort from the first days. 40–80 rounds, Army rations 4–8 days, meds 2–4, fuel 4–10, gun parts 1–3; Humvee kit (`HUMVEE_GEAR`, swapped through gundist's `truck:humvee`) 70%; an Army cargo truck or a Humvee with an M2 (plated and glassed, Mechanics 5+ to repair); risk ×1.3, hurt 12–35; ×3 within 6 tiles of a military site, more in hardcore's first year; a known military group's markings.
  - **An overrun military convoy** (`fleeing`): soldiers who broke and ran. 20–45 rounds, rations 2–5 days, fuel 3–8, meds 1–3, water 3–6; a carbine, rifle, pistol, helmet, vest, assault pack, military radio, flashlight, hand radio, bandage kit or night vision 60%; a Humvee (no turret), pickup or SUV; risk ×1.1; near a military site, far more in hardcore's first year.
  - **An overrun aid convoy** (`aid`): white vans with a red cross. Preserved food 6–12 days, water 8–16, meds 3–6, shop food 3–6 days; bandage, trauma or surgical kit, purification tablets, water filter, canvas, candles, stove, hand warmers or flashlight 50%; a work van; risk ×1.2 (the people it carried), hurt 8–25; likelier within 4 tiles of a city, a hospital or a clinic. Nobody's to bring word to.
  - **An overrun convoy** (`group`): a group's haul between its bases. Preserved food 4–7 days, fuel 3–6, scrap 6–10, parts 1–3, 20–35 rounds, meds 1–3, water 4–8; a shotgun, hunting rifle, pistol, revolver or lever rifle, crowbar, hand radio, toolkit, binoculars, flare, rucksack, multitool, repair kit or bandage kit 50%; a pickup or van; weight 2 with a non-trader group within 4 tiles, else 0.4.
  - **An overrun trade caravan** (`trade`): caged pickups and a van. 4 picks of shop food 3–6 days, 25–45 rounds, meds 2–4, jars 4–10, scrap 5–9, parts 1–3, fuel 2–5, electronics 1–2; a toolkit, sewing kit, toolbox, binoculars, hand or pocket radio, candles, lighters, coffee, chocolate, a novel, cards, a harmonica, multitool or repair kit 70%; a van or pickup; weight 2 with a traders group near, else 0.8.
  - **An overrun refugee column** (`refugees`): family cars and a school bus. 2 picks of house food 1–3 days, water 2–5, fuel 2–5, meds 1; photos, a novel, cards, chocolate, candy, a flashlight, lighters, a harmonica, a backpack, a hiking pack, a pistol or a revolver 60%; a sedan, SUV or van; risk ×1.4 (the families turned), hurt 8–24; likelier near a city. Nobody's.
  - **An overrun raider convoy** (`raiders`): plated pickups with skulls on the doors. 30–60 rounds, fuel 4–9, meds 1–3, raider food 2–5 days, gun parts 1–2, scrap 4–8; a shotgun, AR-15, pistol, saw machete, spiked bat, scrap or tire vest, machete, hand radio or binoculars 70%; a pickup or SUV; weight 1.8 with a raider group near, else 0.5 (a hostile owner is never brought word: bury them).
  - **An overrun tanker convoy** (`tanker`): a fuel tanker on its side. 2 picks of fuel 10–20, fuel 8–15, scrap 4–8, parts 1–2; a flashlight, hand radio, toolkit, crowbar, flare or repair kit 40%; a pickup; risk ×0.9; the **siphon gives three times the fuel (9–21)**; likelier within 3 tiles of a gas station or truck stop.
  - **An overrun work crew** (`workcrew`): a flatbed of lumber and sheet metal. Building materials 3–6, metal sheets 2–4, wood 40–90, scrap 8–14, parts 2–4, stone 4–8; a toolkit, toolbox, multitool, crowbar, sledge, fire axe, repair kit or hand radio 60%; a pickup or van; weight 1 with a non-trader group near, else 0.3.
- **Take what is left (1 hour)**: Scavenging DC 8. A pass: the kind's picks; a failure: 1 pick, "picked over before the team got here". The gear at the kind's chance (half on a failure), in a wreck's condition, as far as it fits. On a pass 30% one of the kind's trucks is whole but shot through the engine: a found vehicle on the tile (fuel 2–10, condition 25–45%, repair 2 parts, 2 scrap, 6 hours, Mechanics 4+, 5+ for the Army's), marked on the map, the team's existing *Repair the …* order and the fixcar task take it from there (foundcars.js; the robbed-caravan pattern of caravanraids.js). Risk the dead that overran it are still about: (25% + 0.4 × infection) × the kind's multiplier, at most 60%; someone hurt by the kind's range.
- **Siphon the tanks and go (30 minutes)**: 3–7 fuel (the tanker 9–21), half the risk, the hurt range cut by a quarter.
- **Leave it for them and bring them word** when the owning group is known and not hostile: nothing taken, goodwill +4 ("word of their lost convoy"). Otherwise **Bury the …** (the kind's dead: soldiers, volunteers, drivers, traders, families, raiders, crew; 2 hours): everyone on the team mood +4.
- **Move on**: nothing.
- **Autopilot**: by the card's `convoyKind`: a cautious governor leaves it for the group (or siphons the tanks); any other takes what is left.

## Campsites
A POI of tents round a fire: abandoned, overrun or a raider camp, with its own raid map and loot in the tents.

The user's request 2026-10-20: "a campsite using these tents spawned on the map around a campfire". Modules: [campsite, scavenge startScavenge, combat createRaid / searchBox / finishCombat, pois generatePois / poiThreat / notePoiThreat, grouppois raidPoiAsGroup, nomads nomadFight, visitors teamFight, ground groundLeftovers; ui/poipick, ui/poiview, ui/raidplan]; test `tools/campsitetest.js`.

- **A POI kind**: the woods' own, plus one now and then on its own dice on a woods, countryside, roadside, lake or riverside tile (CAMPSITE.GEN, appended after the tile's list so saves line up; rarer than the common places). Drawn as a ring of tents round a lit fire (ui/mapsprites paintCampsite).
- **State** by hash dice, rolled again every CAMPSITE.EPOCH (10) days:
  - abandoned (40%): a few of the dead about, the best loot, some tents torn;
  - overrun (25%, more with infection): a pack of the dead among the tents, some of them the campers turned, campers' bodies to search, tents torn;
  - active raider camp (35%): 3–6 raiders round a lit fire; at night 60% asleep inside the tents (unaware, concealed, woken by noise).
  - Cleared for good once nobody of the camp's is left standing (poi.camp.cleared).
- Its state adds to the POI's true threat (CAMPSITE.DANGER). A survey or visit sees it (poi.camp.seen: the POI dialogue, tile panel, raid plan window; a scout come back unseen sees it as it is).
- **Raid map** (campRaidMap, the POI's own map dice): a clearing round a fire pit with 2–6 tents of mixed kinds (campTents), bushes and trees round it, a car now and then. Each tent with storage is a container with loot sized by its storage (tentBoxLoot: food, water, camp gear, rounds or a gun now and then, a spare bag). Roster by state (campRoster). Tents taken stay gone (poi.camp.gone); standing ones keep contents (the ledger) and wear (poi.camp.hp).
- **AI**: nomad and raider bands' camp fights use battle layout "campsite" with their real tents (bags off their shelf) and a share of their stores in the tents as piles (back to them before the handler), their people round the fire or asleep by the hour. Groups' POI raids on a campsite carry off up to CAMPSITE.AI_BAGS tents and clear it (campGroupRaid).

## Points of interest (POIs)
Small places on every land tile, each with its own loot pool, shown on the map and in the tile panel.

Modules: [pois, mapgen; the kinds in data LOCATIONS].
- 0–4 small places per land tile (house, shed, hunting blind, gas station…) with their own loot pools, a town suburb ring, known/hidden by zone, finds carried in team reports to the hub, saves that hold only the changes.
- **On the map**: a sprite per kind (ui/mapsprites POI_PAINT); a bare tile's top POI drawn on its zone plate once known and faded by its pool; a pip with the number of places known on the tile; parties sharing a tile drawn on opposite sides of the hex [ui/render].
- The tile panel's Places rows, the hover text and the codex's Places category (never a count of what is hidden) [ui/poiview, ui/ui renderRight, ui/codex].

## Where buildings stand: the placement table by setting

The user's request 2026-10-26 (issue #42, round-2 epic #39): "Stadiums, zoos hospitals should show in and near City centers. Towns can have some large building types and some small buildings and rural areas have smaller buildings". Modules: [data-placement, placement, pois, shops, citycrawl]. Test `tools/placementtest.js`.

- **Tile classes** (`placement.js tileClass(state, tile)`, memoised per map): #40's six settings (`settings.js settingAt`, whose centre rule is this ticket's) plus coast and scenic land. **centre** a city's heart (`state.cityIds`) and the city blocks within `CENTRE_R` (1) of it; **city** any other city block; **suburb** a suburb tile in a city's footprint (shops.js `settingOf` "suburb") and an urban site off the city's terrain (a city's hospital or mall out in its suburbs); **town** a town's tile, its suburb ring and its sites; **highway** a road tile out in the open; **coast** land by water (a river, a lake) and water; **scenic** forest, hills, mountains; **rural** the rest. On a small map about 1% of the land is centre, city or suburb, 7% town, 8% highway, 14% coast, 52% scenic, 28% rural. Decided from the map as mapgen.js lays it: a city's heart tile and the ring round it are city terrain, its suburbs 2–3 out (its urban sites there), so the centre is the heart and its ring.
- **The crawl's classes** (`crawlClass(c, n)`): a town's crawl is a town; a city's rim blocks (level 2 or less, shops.js `SHOP.OUTER`) its suburbs, its deepest level and the one before (from level 3) its centre, the rest city.
- **The table** (`data-placement.js PLACEMENT_ROWS`, read into `PLACEMENT`): a row for every `BUILDINGS` key, every site type (`SITES`) and every POI kind, 132 in all: `"<class> <weight> <S|M|L|H>"` a class, or a profile (downtown, main street, big lot, office, roadside, home, farm, wild, hideout), or `"of <site>"` for a site's own building (a barracks the military base's, a dorm the university's, a mall's cinema the mall's). The **weight** is how often the kind turns up on the class against before (1 as before, 0 never); the **size class** (small, medium, large, huge: `SIZE_CLASSES`) is the size of the variant it takes there. `sizeClassOf(w, d, storeys)` gives a footprint's by floor area: under 400 m² small, 2,000 medium, 10,000 large, above huge (`SIZE_AREA`).
  - Big kinds (`BIG_KINDS`: a hospital, a regional mall, a university; wave 2's stadiums, zoos, museums, amusement parks, convention hotels) are huge only in a city's centre and blocks; huge appears on no other class. A hospital: centre 3 huge (a medical centre), city 2 huge, suburb 0.8 large (a community hospital), town 0.15 large (a county hospital), never rural.
  - Towns: a regional high school, a county hospital and a big-box store large; main-street shops small.
  - Rural: clinics, chapels, feed stores, farm stands, farms small or medium. A compound in the country (a military base, an air base, an airport, a prison) is large at most: its buildings, never one huge one.
- **New worlds only** (`state.placeV` 1; save.js marks an older save `placeLegacy`, worldcfg.js `legacyPlace`; placement.js `placing`): a new world's
  - POI lists draw their kinds by the table's weight for the tile's class (pois.js `generatePois`: the same dice, weighted; a kind the row says never stands there is not drawn);
  - shops and offices as POIs and in the crawl are weighted by it too (shops.js `shopExtras`, `shopPlaces`: × `placeMult`), as are a crawl block's own places (citycrawl.js `genBlock`), so a city crawl's heart holds hospitals and its rim none;
  - bunkers, malls and hotels never stand where their row says not (`standsOn`), and a crawl's strip mall only on its rim or in a town;
  - one more POI by the table where the old pools had none (`placeExtraKind`, `PLACE_EXTRA`, on dice of its own after everything but the hotel (a hotel stays last), marked `extra: "place"`, known in the known zone 70% of the time, never beside a site it would out-rank): a hospital on a centre tile 6%, a city block 3%, a town tile 0.15%; a big-box store 0.6% and a high school 0.8% of a town's tiles; a clinic, a chapel, a feed store, a farm stand in the country (0.2–1%).
- **Golf courses, RV parks, campgrounds** (issue #61, [combat.md](combat.md#golf-courses-campgrounds-and-rv-parks)): their rows (golfcourse near the towns and the cities, large in the suburbs; rvpark by the highways, large by the water; campground large on the coast, medium in the woods) and three more `PLACE_EXTRA` kinds after the others on the same dice (golf on 2% of suburb tiles and 1.2% of town tiles, RV parks on 1.2% of highway tiles, a lake's campground on 0.4% of coast tiles), a world made since only (worldcfg.js `legacyOutdoors`).
- **The variant picker** (variantpick.js, #41): `placementCtx(state, tile, key)` is its ctx, `{ tileClass, setting, size }` (`setting` one of the six settings, centre, city, suburb, town, rural, highway, #40's `settings.js SETTINGS`: `settingAtClass`, coast and scenic land rural; `settingOfClass` gives the layouts' rural / town / city; `size` the table's for the kind there); `crawlCtx(c, n, key)` the same for a crawl block. buildingmaps.js `siteWhere` passes a new world's `tileClass` to the archetypes' make opts. Also exported: `placeWeight(key, cls)`, `sizeFor(key, cls)`, `classesOf(key)`, `cityDistance(state, id)`, `TILE_CLASSES`, `SIZE_CLASSES`, `PLACE` (`CENTRE_R` 1, `BIG_R` 2).
- **Older worlds** keep their POIs, crawl blocks and buildings exactly: placementtest.js regenerates two worlds as older saves and compares their hashes with dev's before the table (016f555).
- **Measured** (tools/placementtest.js over 100 small worlds): 28 checks green in 40 s; no huge building more than 2 tiles from a city's heart; 60.5% of 692 hospitals within 2 tiles of one (the rest a city's ring hospitals, large there, and towns' county hospitals); 99.9% of the buildings on rural tiles small or medium, none huge; 85% of 5,400 towns with a large building and all with small ones; a world of 6 cities holds 6.9 hospitals, 52 clinics, 71 churches, 343 houses; a city crawl's heart 8.4% hospitals among its places, its rim none.

## Gun stores, pawn shops and hardware stores
Shops with richer gun, gear and building-material finds, as POIs and as places on crawl blocks.
- The user's requests 2026-10-21: "gun shop, pawn shops POI and to town and city crawls which have increased loot chances for guns rigs and other survival gear"; "add hardware store that has increased spawn of materials needed for building and crafting".
- **Hardware store**: raid rooms are aisles of their own (building materials, lumber, scrap, parts, tools: combat AREAS `hardware`); its search hour finds more scrap and parts and the most building materials and wood (loot BUILDMAT_FINDS, SITE_WOOD; as a POI shopshelves `rollShopSupplies`).
- **Pawn shop**: a site type of its own (a counter and a locked gun case in the back; guns, rigs, packs, filters, stoves, lamps, radios, blades and pawned valuables).
- Both stand as POIs on suburb and city blocks and as places on city and town crawl blocks, each on its own dice after the tile's list or the block's places (`poi.extra: "shop"`; the campsite's extra is `extra: "campsite"`).
- gearRate on their search hour's gear roll and their own rows in the rigs/magazines, survival gear, extra-gun, blade, parts, lock and book tables. A shop POI's search hour rolls its own kind's tables (site tables go by the tile's site).
- Modules: [shops, shopshelves, pois shopExtra, citycrawl genBlock, scavenge, carrykit, data-survival, data-guns, buildingmaps, combat AREAS; ui/mapsprites paintPawnShop].

## Shops and services as places, as franchises
14 more site types of shops and services, each place one of 4–10 chains with its own name, look and layout.
- The user's requests 2026-10-21: sporting goods with football gear, a goalie mask, hockey sticks, bats, clubs and bows; electronics, radio shops, bookstores, libraries, groceries, diners, clinics, motels, churches, auto shops, pet stores, fire and police stations, garden centers, clothing stores, vets, car dealerships, pizza and other restaurants, banks, bars and liquor stores, "more common in areas that makes sense", "versions that fit the setting", "many variants … different franchises including colors, layout".
- **14 new site types**: sportshop, electronics, radioshop, bookstore, library, petstore, garden, clothing, vet, dealer, restaurant, bank, bar, liquor. Their raid rooms (a vault, a bar, liquor shelves, a showroom, bookshelves…), buildings and find rows are data merged by each owning module (`data-shops.js` NEW_KINDS, AREA_DEFS, ROWS, `mergeRows`).
- **Where**: a weight on a city block, a city's suburbs and a town's ring (`PLACE_W`, `settingOf`); up to two on a suburb or city tile and up to two besides a crawl block's own places, each on its own dice after the list (`shopExtras`, `shopPlaces`).
- **Franchises**: 4–10 fictional chains and local names per kind, old kinds too (`FRANCHISES`: a name, weights by setting, a look of colours and a style for the map painter, a plan for the building: floor, front-room depth and name, width, a flat above, storeys, the back's arrangement). Every place of such a kind is one (`poi.v`, a crawl place's `v`, `franchiseFor`), named by it (pois `poiName`, the crawl's card), drawn by it (ui/mapsprites, render `siteLook` variant) and laid out by it (buildingmaps `planOf`; a building saved before franchises keeps its layout; a new save's is one of the franchise's layout variants: [A dozen layout variants per type](#a-dozen-layout-variants-per-type)).
- **Inside, laid out for their kind** (issue #16, the user's request 2026-10-25: "Special buildings [...] should have furniture, appliances, decor, rooms and layouts that make sense for the type of building"; `shoplayout.js`, the rules in [combat.md](combat.md#raids-into-building-interiors)). The franchise's plan still sets the depth, width, floor and back rooms, its look the wall colour (decor). New saves only; an older save's buildings are as they were. The rooms and their pieces:
  - **Shop fronts**: aisles of shelving in rows a walk apart (a row shifts off the lanes between the doors), a shelf to search at each end and every few cells, a checkout with its register by the front door. A liquor store, a gas station and a truck stop's shop (a grocery and a corner store on an older save's plan): a cold case run along a side wall (drinks); a new save's grocery stores by size below. A gun store: the gun counter (display cases across the room) and gun racks along the wall behind it. A pawn shop: the pawn counter of display cases caged in bars at its ends. A bookstore: bookshelves in rows and a reading table. A pet store: fish tanks along a wall, cages of bars. A garden center: potting benches. Clothing: clothes racks in rows. Electronics and a radio shop: the workbench at the back with a counter in front of it, display cases. Hardware: tool aisles and a key-cutting counter (a workbench and a counter). A pharmacy, sporting goods (clothes racks too), a feed store: aisles.
  - **Shop back rooms**: the stockroom (shelves to search, crates stacked between), the manager's office (a desk and chair, filing, the safe always locked where the office locks a safe), the staff toilet (a toilet and a sink, two in a long restroom), the fitting rooms (cubicle partitions, a stool in each stall, clothes racks), the gun cage (gun racks, lockers, a crate), the dispensary (the pharmacist's counter, shelves), the repair bench (a workbench, a tool chest, shelves), a garden center's greenhouse (glass walls, potting benches) and a lumber or garden yard (pallet racks in rows, crates).
  - **Restaurants, diners, pizza places, bars**: a restaurant's dining room has the order counter along the back, the register, booths on the side walls and tables with chairs; a diner's (a pizza place's, a truck stop's) the long counter with bar stools, the pie case at its end, booths; a bar the long bar with stools, the liquor shelves and the beer fridge (a cold case) behind it when the room is deep enough, a jukebox, a pool table in a big room, a booth, tables, the till. The kitchen: a range of six rings, a deep fryer where the place fries, a pizza oven at a pizza place, stainless counters, a sink, a dishwasher, a prep island in a big kitchen, shelves. The walk-in cold room behind a steel door: cold-room shelving (tins among the spoiled food). A bar's keg room: kegs and shelves; its stage: a jukebox, tables.
  - **Restaurants by kind of food, format and size** (issue #33, the user's request 2026-10-25: "there should be a few dozen varients, sizes layout and kind of food for resauraunts"; the rules in [combat.md](combat.md#raids-into-building-interiors)). A new save's restaurant, pizza place, diner or bar is a variant (`data-eateries.js VARIANTS`: a cuisine, a format and a size): the 27 franchises there were keep their names, looks and plans and gain one each (Burger Barn fast-food burgers, Taj Palace…), and 59 new ones join the four lists (`FRANCHISES.restaurant` 44, `pizza` 13, `diner` 13, `bar` 16: 86 in all, 79 distinct cuisine × format × size combinations; every variant its own plan, a dozen or more a kind: the user's request 2026-10-25, "for buildings with no to only a few varients create a dozen varients per building type", the variant's id hashed into its plan's dice). No new site kinds: a café, a fast-food place, a buffet, a banquet hall, a kiosk and a food truck are restaurant variants (decision recorded here: new kinds would need their own POI, loot and map rows for no gain). Each variant has its look (colours, sign, the painter's style, the booths' colour by its cuisine), its plan (floor, front room's name), its setting weights (city, suburb, town, as every franchise) and the places it suits (`at`: main street, strip-mall pad, highway exit, city block, mall, hotel, truck stop), which #29's hotels and #30's mall food court read through `eaterylayout.js eateryVariant({ format, cuisine, setting, size, avoid, r })`. An older save keeps its restaurants' one plan (the `roomsLegacy` rule).
    - Sizes (`EAT_SIZE`, a cell about a metre; #24's size table was not on dev, so one const): tiny 8–10 × 9–10, small 11–14 × 10–12, medium 16–22 × 13–16, large 26–34 × 18–22, huge 50–54 × 36–40 (the shared rule's huge footprint, as the supermarket's).
    - Placement: unchanged weights (shops.js `PLACE_W`), but with 86 variants two restaurants on a map or a block are rarely the same one, and a tile or a block never holds two of one kind already.

    | Cuisine | Format | Size | Place (kind:id) | Stands at |
    |---|---|---|---|---|
    | Burgers | Fast food | medium | Burger Barn (`restaurant:burgerbarn`) | highway, strip, truckstop, main, strip |
    | Fried chicken | Fast food | medium | Cluck Shack (`restaurant:cluckshack`) | highway, strip, truckstop, main, strip |
    | Mexican | Fast food | medium | Taco Rio (`restaurant:tacorio`) | highway, strip, truckstop, strip, mall |
    | Chinese | Takeaway kitchen | small | Golden Wok (`restaurant:goldenwok`) | strip, city, main |
    | Steakhouse | Family sit-down | large | Big Sky Steakhouse (`restaurant:bigsky`) | highway, strip, hotel |
    | BBQ and smokehouse | Family sit-down | medium | Smoky Pete's BBQ (`restaurant:smokypete`) | highway, main |
    | Coffee and bakery | Café | small | Bean There Coffee (`restaurant:beanthere`) | city, main, strip, mall, hotel |
    | Sandwiches and deli | Fast-casual | small | Sub Station (`restaurant:substation`) | strip, mall, city |
    | Noodle bar | Fast-casual | medium | Noodle House (`restaurant:noodlehouse`) | city, mall |
    | Italian | Family sit-down | medium | Sal's Italian Kitchen (`restaurant:sals`) | main, city, hotel |
    | Japanese and sushi | Family sit-down | medium | Sakura Sushi (`restaurant:sakura`) | city, strip, hotel |
    | Japanese and sushi | Fine dining | large | Kobe Teppan House (`restaurant:kobe`) | city, hotel |
    | Thai and Vietnamese | Fast-casual | small | Saigon Pho (`restaurant:saigonpho`) | city, strip, mall |
    | Thai and Vietnamese | Family sit-down | medium | Bangkok Garden (`restaurant:bangkok`) | main, city, strip |
    | Indian | Family sit-down | medium | Taj Palace (`restaurant:tajpalace`) | city, strip, hotel |
    | Indian | Takeaway kitchen | small | Curry Express (`restaurant:curryexpress`) | city, strip |
    | Italian | Fine dining | large | Villa Toscana (`restaurant:villatoscana`) | city, hotel, main |
    | Steakhouse | Fine dining | large | The Chophouse (`restaurant:chophouse`) | city, hotel |
    | Seafood | Family sit-down | medium | Captain's Catch (`restaurant:captainscatch`) | highway, strip, main |
    | Seafood | Fine dining | large | The Pearl Oyster Bar (`restaurant:pearloyster`) | city, hotel |
    | Mediterranean and Greek | Fast-casual | small | Olympia Gyros (`restaurant:olympia`) | city, strip, mall |
    | Coffee and bakery | Café | medium | Golden Crust Bakery (`restaurant:goldencrust`) | main, city |
    | Donuts | Café | small | Hole Lotta Donuts (`restaurant:holelotta`) | highway, strip, truckstop, strip |
    | Ice cream | Kiosk or food truck | tiny | Polar Swirl (`restaurant:polarswirl`) | mall, strip, main |
    | Ice cream | Café | small | Frosty's Creamery (`restaurant:frostys`) | main, highway |
    | Sandwiches and deli | Fast-casual | medium | Uncle Moe's Deli (`restaurant:unclemoes`) | city, main |
    | Breakfast and pancakes | Family sit-down | medium | Sunny Side Pancake House (`restaurant:sunnyside`) | highway, strip, hotel |
    | Southern and soul food | Family sit-down | medium | Mama Lou's Soul Kitchen (`restaurant:mamalous`) | main, city |
    | Vegetarian and salad | Fast-casual | small | Green Leaf Salads (`restaurant:greenleaf`) | city, mall, strip |
    | Korean BBQ | Family sit-down | large | Seoul Grill (`restaurant:seoulgrill`) | city, strip |
    | Hot dogs | Kiosk or food truck | tiny | Top Dog (`restaurant:topdog`) | mall, city, highway |
    | Chinese | Buffet | huge | Emperor's Buffet (`restaurant:emperorsbuffet`) | strip, highway |
    | Southern and soul food | Buffet | large | Country Kitchen Buffet (`restaurant:countrybuffet`) | highway, strip |
    | Cafeteria | Buffet | large | Ruby's Cafeteria (`restaurant:rubys`) | city, main, mall |
    | Italian | Banquet hall | huge | The Crystal Ballroom (`restaurant:crystalballroom`) | city, hotel |
    | Southern and soul food | Banquet hall | large | Liberty Hall Banquets (`restaurant:libertyhall`) | main, highway |
    | Mexican | Kiosk or food truck | tiny | El Camión Taco Truck (`restaurant:elcamion`) | strip, highway, city |
    | BBQ and smokehouse | Kiosk or food truck | tiny | Smoke Wagon BBQ (`restaurant:smokewagon`) | highway, main |
    | Chinese | Kiosk or food truck | tiny | Wok To Go (`restaurant:woktogo`) | mall, city |
    | Wings and sports bar | Takeaway kitchen | medium | Wing It (`restaurant:wingit`) | city, strip |
    | Fried chicken | Fast food | large | Big Bird Fried Chicken (`restaurant:bigbird`) | highway, strip, truckstop |
    | Coffee and bakery | Kiosk or food truck | tiny | Java Cart (`restaurant:javacart`) | mall, hotel, city |
    | Burgers | Kiosk or food truck | tiny | Fry Shack (`restaurant:fryshack`) | mall, highway |
    | Mexican | Family sit-down | large | Taco Fiesta Cantina (`restaurant:tacofiesta`) | strip, highway |
    | Pizza | Family sit-down | medium | Tony's Pizzeria (`pizza:tonys`) | main, city, strip |
    | Pizza | Buffet | large | Pizza Palace (`pizza:pizzapalace`) | strip, highway |
    | Pizza | Fast-casual | small | Slice of Heaven (`pizza:sliceheaven`) | city, mall, strip |
    | Pizza | Family sit-down | medium | Brick Oven Co. (`pizza:brickoven`) | main, city |
    | Pizza | Takeaway kitchen | small | The Pie Hole (`pizza:piehole`) | main, strip |
    | Pizza | Fast food | medium | Pizza Pronto (`pizza:pizzapronto`) | highway, strip, truckstop, strip |
    | Pizza | Kiosk or food truck | tiny | Slice Cart (`pizza:slicecart`) | mall, city |
    | Pizza | Fine dining | large | Nonna's Wood-Fired Trattoria (`pizza:nonnas`) | city, main, hotel |
    | Pizza | Family sit-down | large | Windy City Deep Dish (`pizza:windycity`) | strip, main, city |
    | Pizza | Buffet | huge | Galaxy Pizza & Arcade (`pizza:galaxypizza`) | strip, highway, mall |
    | Pizza | Takeaway kitchen | medium | Rocco's Carry-Out (`pizza:roccos`) | strip, main |
    | Pizza | Café | small | Joe's Slice Window (`pizza:joesslice`) | city, main |
    | Pizza | Pub | medium | Hops & Pies Pizza Pub (`pizza:hopspies`) | main, city |
    | Burgers | Diner | medium | Starlite Diner (`diner:starlite`) | highway, main, truckstop |
    | Breakfast and pancakes | Diner | medium | Route 9 Diner (`diner:route9`) | highway, truckstop |
    | Sandwiches and deli | Diner | small | Lou's Lunch Counter (`diner:lous`) | main |
    | Southern and soul food | Diner | medium | Silver Spoon Diner (`diner:silverspoon`) | highway, main |
    | Breakfast and pancakes | Diner | small | Waffle Shack (`diner:waffleshack`) | highway, truckstop |
    | Steakhouse | Diner | large | Highway 40 Truckers' Diner (`diner:hwy40`) | highway, truckstop |
    | Burgers | Diner | small | Silver Bullet Railcar Diner (`diner:silverbullet`) | highway, main |
    | Steakhouse | Family sit-down | large | Big Rig Truck Stop Diner (`diner:bigrig`) | truckstop, highway |
    | Breakfast and pancakes | Family sit-down | medium | All-Nite Family Diner (`diner:allnite`) | highway, strip, main |
    | Ice cream | Diner | small | Sweet Sips Soda Fountain (`diner:sweetsips`) | main |
    | Burgers | Fast food | medium | Dee's Drive-In (`diner:deesdrivein`) | highway, main |
    | Cafeteria | Diner | medium | Main Street Lunch Counter (`diner:mainstlunch`) | main |
    | Breakfast and pancakes | Buffet | large | Pancake Junction (`diner:pancakejct`) | highway, strip, truckstop |
    | Burgers | Pub | small | The Rusty Nail (`bar:rustynail`) | main, highway |
    | BBQ and smokehouse | Pub | large | Roadhouse 61 (`bar:roadhouse61`) | highway |
    | Burgers | Pub | medium | O'Malley's Pub (`bar:omalleys`) | city, main |
    | Mediterranean and Greek | Pub | medium | The Velvet Lounge (`bar:velvetlounge`) | city, hotel |
    | Wings and sports bar | Pub | large | Touchdown Sports Bar (`bar:touchdown`) | strip, city |
    | Burgers | Pub | small | Last Call Tavern (`bar:lastcall`) | main |
    | Steakhouse | Pub | medium | Neon Moose Saloon (`bar:neonmoose`) | main, highway |
    | Burgers | Pub | large | Copper Kettle Brewpub (`bar:copperkettle`) | city, main |
    | BBQ and smokehouse | Pub | large | Iron Horse Brewing Co. (`bar:ironhorse`) | main, highway |
    | Hot dogs | Pub | small | Lucky's Dive (`bar:luckysdive`) | city, main |
    | BBQ and smokehouse | Banquet hall | large | Boot Scootin' Honky-Tonk (`bar:bootscootin`) | highway, main |
    | Seafood | Fine dining | large | The Gilded Cocktail Lounge (`bar:gilded`) | city, hotel |
    | Wings and sports bar | Pub | small | Iron Riders Biker Bar (`bar:ironriders`) | highway |
    | Italian | Pub | small | The Grand Hotel Bar (`bar:grandhotelbar`) | hotel, city |
    | Sandwiches and deli | Pub | large | Alpine Biergarten (`bar:alpinegarten`) | main, city |
    | Wings and sports bar | Banquet hall | huge | Club Pulse (`bar:clubpulse`) | city |

    The loot by cuisine (foods.js `MIXES` "eat:<cuisine>" and its keeps, the rooms' `mix`):

    | Cuisine | Signature pieces | Food (walk-ins, freezers, cases) | Preserved (dry store) |
    |---|---|---|---|
    | Burgers | flattop, fryer | frozenmeat, potatoes, bread, cheese | cannedmeat, sugar, beans |
    | Fried chicken | fryer | frozenmeat, potatoes, flour, bread | flour, cannedmeat, beans |
    | Pizza | deckoven | flour, cheese, cannedveg, frozenmeat | flour, cannedveg, pasta |
    | Mexican | tortillapress | drybeans, rice, flour, frozenmeat | drybeans, beans, rice |
    | Chinese | wokrange | rice, pasta, frozenmeat, cannedveg | rice, pasta, cannedveg |
    | Japanese and sushi | sushibar | rice, smokedfish, frozenmeat, eggs | rice, smokedfish, crackers |
    | Thai and Vietnamese | wokrange, stockpot | rice, pasta, frozenmeat, cannedveg | rice, pasta, peanutbutter |
    | Indian | tandoor | rice, drybeans, flour, frozenmeat | rice, drybeans, flour |
    | Italian | stockpot | pasta, flour, cannedveg, cheese | pasta, cannedveg, jarred |
    | Steakhouse | chargrill | frozenmeat, potatoes, onions, bread | cannedmeat, jerky, beans |
    | BBQ and smokehouse | smoker | frozenmeat, drybeans, potatoes, bread | jerky, beans, cannedmeat |
    | Seafood | lobstertank | smokedfish, potatoes, flour, rice | smokedfish, crackers, cannedveg |
    | Mediterranean and Greek | gyrospit | frozenmeat, flour, rice, drybeans | drybeans, rice, jarred |
    | Coffee and bakery | espresso | flour, sugar, bread, eggs | sugar, flour, crackers |
    | Donuts | fryer, pastrycase | flour, sugar, eggs, candybar | sugar, flour, candybar |
    | Ice cream | softserve, dipcabinet | sugar, candybar, cannedfruit, crackers | sugar, cannedfruit, candybar |
    | Sandwiches and deli | slicer | bread, frozenmeat, cheese, chips | cannedmeat, crackers, chips |
    | Breakfast and pancakes | flattop | flour, eggs, oats, sugar | oats, flour, sugar |
    | Southern and soul food | steamtable | frozenmeat, flour, drybeans, potatoes | drybeans, beans, jarred |
    | Vegetarian and salad | saladbar | cannedveg, drybeans, rice, apples | drybeans, cannedveg, driedfruit |
    | Noodle bar | stockpot | pasta, rice, eggs, frozenmeat | pasta, rice, soup |
    | Korean BBQ | kbbqtable | frozenmeat, rice, cannedveg, onions | rice, jarred, cannedmeat |
    | Hot dogs | flattop | frozenmeat, bread, onions, chips | cannedmeat, chips |
    | Wings and sports bar | fryer | frozenmeat, potatoes, flour, chips | cannedmeat, chips, crackers |
    | Cafeteria | steamtable | potatoes, rice, pasta, cannedveg | beans, cannedveg, rice |

  - **The office tower**: the lobby (the reception counter, the security desk with its monitors, chairs); offices as an open-plan floor (desks in pods of two facing rows with chairs, cubicle partitions between pods, a copier, a water cooler, filing) from 24 cells, else a meeting room (a long table, chairs, a whiteboard: 35%) or a private office (a desk, a bookshelf, a sofa, a safe 30%); the break room (a sink, a microwave, a vending machine, a table, the fridge); the records room or, 20%, the server room (server racks); the plant room (the boiler, the water heater, a workbench, tool chests); the cafe (the register, a cold case, tables); the restrooms. The stairwells are #9's.
  - **The motel**: each room a bed, a nightstand by it, a TV stand on the wall the bed faces, a chest of drawers, a chair (the drawers and the nightstand searched within the room's share), its bathroom (#10's: a toilet, a sink, a shower); the upper rooms have theirs on the far side from the walkway. The front desk: the counter, the key rack, the safe, a sofa, the vending machine, the ice machine. The manager's flat: a kitchenette (fridge, sink, stove), a bed and nightstand, a table. The laundry: washers and dryers, linen shelves. The upper walkway: an ice machine. Not done: the pool.
  - **The bank**: the ATM lobby at the front door (the ATM: a locked container, a cash box 40%), the banking hall (teller windows along its back wall, queue posts, chairs, a desk), the teller line (cash drawers, filing, desks), the vault (always locked; safe-deposit boxes) and the safe-deposit room beside it, the manager's office (desk, safe), offices above.
  - **Grocery stores by size** (issue #22, the user's request 2026-10-25: "make super markets really big, the ones in those 3 images would be a small one or corner store"; the rules in [combat.md](combat.md#raids-into-building-interiors)): three tiers that read as different sizes. A **corner store** (10–14 across): the till's counter by the door, the drinks fridges along a wall, a chest freezer of ice cream, 2–4 short shelf runs, a stockroom of crates, sometimes the flat above. A **neighbourhood grocery** (20–26 × 17–20): 2–3 checkouts, 5–9 aisles front to back, the dairy wall of cold cases with a small deli counter, the frozen section (freezer cases, a chest freezer), the produce corner, a stockroom with a walk-in cooler and the back door. A **supermarket** (54–58 × 36–40, twice the old store each way): the entrance with cart corrals, the customer service desk, 9–11 checkout lanes and a self-checkout block, the wide front aisle, 10–13 long aisles with aisle markers, produce down one side, the frozen aisles (freezer cases, island freezers), the dairy wall, the bakery, the deli and butcher, the pharmacy, the café and the restrooms; behind them the warehouse of pallet racks with 2–3 roller doors onto the loading dock and a box truck at a bay, the walk-in cooler and freezer, the baler, the cash office, the manager's office and the break room; sometimes a mezzanine stockroom with offices above. An older save keeps the old store below.
  - **The supermarket (an older save's) and the department store**: the supermarket's floor has checkout lanes at the front, the cold aisle of shop fridges along a side wall and aisles in long rows; the deli (display and cold cases, the bakery's oven, counters, a sink); the pharmacy counter; the back room of pallet racks with a forklift. The department store: a display bed, a sofa, an armchair, wardrobes and chests of drawers (the furniture department), racks of clothes, the checkout; its sporting goods section aisles.
  - **The library** (an older save's): the stacks (bookshelves in rows), the circulation desk, the reading and study rooms (tables, chairs, bookshelves), the children's corner, the workroom (a desk, filing), the archive. A new save's libraries are the variants below.
  - **The dealer, garages, warehouses, factories, barns**: a dealer's showroom (cars on the tiles, the salesmen's desks); service bays (the cars, the first on a car lift, a workbench and tool chest, an air compressor, tyre racks, shelves), the parts room (the parts counter, shelves, tyre racks); a workshop (workbenches, tool chests, a compressor); a warehouse floor of pallet racks in rows and a forklift; a factory floor of machine tools in rows with a tool chest or a workbench in front of each; a barn floor's stalls of fence, hay, the truck, and the tack room's saddle racks. The hayloft is as it was.
- **Layout names of the homes, the rural buildings and the motel** (issue #32, the user's request 2026-10-25: "add motel varients. every building should have several varients"; the plans in [combat.md](combat.md#raids-into-building-interiors)). A POI of a kind with layouts (a house, a neighbourhood, a farmhouse, a cabin, a lodge, a ranger station, an apartment block, a barn, a machine shed, a motel; a shed or a mine shack on another kind's building keeps its own name, its building's layout by the dice) rolls one when it is made (`poi.lay`, pois.js `makePoi`, by the tile's setting: rural, town, city) and the POI and its raid go by its name ("Ranch house", "Townhouse", "Shotgun house", "I-house", "A-frame", "Trapper's cabin", "Scout lodge", "Lookout tower", "Game warden's station", "Rooming house", "Trailer park", "Dairy barn", "Quonset hut"): 12 layouts a kind; a motel keeps its franchise's name and look, its layout (one of its 12: motor court, roadside strip, chain, motor lodge, extended stay, neon motor inn, motel and restaurant, poolside, fishing camp, tourist court, weekly-rate, ski motel) the building's dice and setting. A site's choice of buildings names each by its layout (buildingmaps.js `buildingOptions`). An older save's POIs and buildings keep their names and plans. The other kinds' variants and names are their own tickets' (#33 to #37).
- Modules: [shops, data-shops, data-eateries, eaterylayout, pois, citycrawl genBlock placeOption, poiraid poiPlace, buildingmaps shop dealer bank library vet, shoplayout, buildvariants; ui/mapsprites, ui/render].
- **Office buildings of every kind, with named firms** (issue #27 of the interiors epic #7, the user's request 2026-10-25: "add office building varients"). Seven new site types and the office tower's firms, data in `data-offices.js` merged into data-shops.js's tables (NEW_KINDS, AREA_DEFS, PLACE_W, FRANCHISES, ROWS); plans in `officeplans.js`, rooms in `officelayout.js` (the rules in [combat.md](combat.md#raids-into-building-interiors)); test `tools/officestest.js`, renders `tools/officeshot.cjs`.
  - **The kinds** (sizes in cells of about a metre, `officeplans.js SIZE`, until #24's real-world table takes them; storeys `STOREYS_BY_TYPE`):
    - **Storefront office** `storefront` (10–14 × 15–20, 1–2 storeys): an insurance agent, a lawyer, an accountant, a realtor or a travel agent (a front desk and waiting chairs, a hall down one side to private offices, the file room, a kitchenette, a restroom; a 2-storey firm's partner's office and more offices upstairs), a dentist (operatories with the dental chair, a sterilization room) or a doctor's practice (exam rooms, #14's exam style, and the drug cupboard): the firm's `plan.office`.
    - **Business park** `bizpark` (26–32 × 17–21, 1–3 storeys, a "lot" outside): a glass lobby, open plan, a meeting room, a training room, the mail room, the break room, the IT closet; upstairs open plan, meeting rooms, a manager's office, records. Not L-shaped yet (#23's shapes are not on dev).
    - **Corporate tower** (the old `offices` key, site type `office`, when it has a firm; 24–28 × 16–18, 6–10 storeys for the city firms, 3–5 for the two town firms, capped by `MAX_STOREYS`, 8 until #24 raises it to 10; the crawl's depth bonus still adds): two stairwells on every floor; the marble lobby (turnstiles, the reception, the lift bank), a café, the mail room, the loading bay (a roller door), the security office and a staff room; floors above by its dice (`floorKinds`, `TOWER`): the first open plan, the one under the top an executive floor (5+ storeys), the others open plan or once each a canteen, a fitness or an IT and server floor; the top floor the executive suite (the safe, the liquor cabinet), the boardroom, the chairman's office and the roof plant. A tower with no firm (saved before them, a city's or a factory's or a campus's offices) keeps the old plan.
    - **City hall** `cityhall` (26–30 × 21–24, 2–3 storeys): the clerk's office (its counter and queue posts), the lobby (marble), the permits office; the council chambers (the dais with the council's chairs, the podium, rows of seats facing them either side of an aisle), the mayor's office, records; upstairs council offices, a committee room, planning, the archives. No fallout shelter: #26's.
    - **Courthouse** `courthouse` (26–30 × 21–24, 2–3 storeys): the clerk of court, the security screening entrance (a walk-through scanner, the X-ray tunnel (#25's security scanner), queue posts, the security desk), a records office; the courtroom (the judge's bench, the witness stand, the jury box, counsel tables, the gallery's benches), the holding cell (#15's cells: bars, a cell door, a bunk, a toilet), the evidence room behind a steel door; upstairs judges' chambers, the jury room, a second courtroom, the law library.
    - **Call center** `callcenter` (26–32 × 17–20, 1–2 storeys): call floors of headset desks back to back with partitions, the supervisors' platform on the main floor (the security desk of monitors, the whiteboard), the big break room (vending machines), the team leads' office, the IT closet; upstairs more floors and a training room.
    - **Tech office** `techoffice` (20–24 × 15–18, 2–5 storeys): long bench desks, beanbags, the games corner (a pool table, a TV, a sofa), phone booths, the kitchen of fridges full of drinks, the server room; upstairs benches, a meeting room, a lounge, a snack bar.
    - **News station** `station` (22–26 × 15–17, 2 storeys): the newsroom, the reception and a TV studio (the news desk, cameras on tripods, studio lights), a radio station's broadcast booth or a newspaper's press room (`plan.media`); the control room or the layout room, the archive, a break room; upstairs the editorial offices, the station manager's or editor's office, the tape library or back issues, the transmitter room or darkroom. Its mast is on the map sprite; a hand-crank radio is among its loot (AREAS.studio) and in its scene.
  - **A dozen named plans a kind** (the user's request 2026-10-25: "for buildings with no to only a few varients create a dozen varients per building type"; #32's rule: a distinct plan, its room list and arrangement, not a recolour). `officeplans.js OFFICE_VARIANTS`: the first of each the plan above, the others data for `build` (a footprint, storeys, the ground floor's tree and the floors' above from the shared rooms `SLOTS`, the exits) or, for the tower, `towerVariant` (its ground floor's bands, the stairwells at the ends or round a centre core, the floor kinds it stacks: `TOWER_FLOORS` open, executive, canteen, fitness, IT, medical, law, claims, media, government, tech, offices, the top). Picked by the building's dice (`pickVariant`; `o.plan` a given one), named on the spec (`spec.variant`, the raid plan's). A firm still sets a storefront's kind (an office, a dentist, a doctor), a station's media and a tower's storeys. A tower with no firm (a city's, a factory's, a campus's offices) takes a plan too in a new save (3–6 storeys); an older save's (`officesLegacy`, passed by buildingmaps `makeSpec`) keeps the old tower. Every plan of a kind has its own room list (12 of 12, `tools/officestest.js`).
    - Storefront: Main street office, Corner office, Walk-up office, Strip-mall unit, Converted house, Open-plan agency, Partners' suite, Office over a shop, Records office, Courtyard office, Office with a garage, Two-door office.
    - Business park: Low-rise office, Flex space, Research park building, Training center, Medical office building, Atrium building, Data center, Back-office park building, Showroom offices, Corporate campus building, Courier depot, Startup incubator.
    - Tower: Glass slab tower, Centre-core tower, Atrium tower, Bank tower, Retail podium tower, Medical office tower, Law firm tower, Insurance headquarters, Media tower, Government office tower, Brutalist office block, Tech campus tower.
    - City hall: City hall, Domed capitol, Town hall with fire bay, Town hall with police office, Municipal annex, City hall and library, Hall with municipal court, Modern civic center, Town hall with auditorium, Public works hall, City hall with records vault, Village hall.
    - Courthouse: County courthouse, Courthouse and jail, Twin-courtroom courthouse, Family court, Federal courthouse, Traffic court, Old courthouse, Justice center, Courthouse with law library, Probate court, Courthouse with sally port, Magistrate's court.
    - Call center: Contact center, Open-floor contact center, Two-floor support center, Night-shift center, Telemarketing office, Help desk, Dispatch center, Survey center, Order desk and warehouse, Call center with cafeteria, Strip-mall call center, Converted big-box call center.
    - Tech office: Tech office, Loft office, Garage startup, Game studio, Hardware lab, Data company, Coworking space, Design agency, Fintech office, Robotics startup, Campus building, Biotech startup.
    - Station: News station, Small-market station, Radio house, Broadcast center, Paper with printing hall, Station with satellite yard, Public radio station, Station with weather center, News bureau, Studio complex, Transmitter site, Station with tape vault.
  - **Firms** (`OFFICE_FIRMS`, 4–10 a kind, 49 in all): storefronts Calder Mutual Insurance, Keystone Family Insurance, Hale & Whitcombe, Attorneys, Brandt Law Office, Pruitt & Lowe Accounting, Bluegate Realty, Wanderway Travel, Bright Smile Dental, Dr. Ostrander, DDS, Mercer Family Practice; business parks Lakeview Business Park, Northgate Corporate Center, Cedar Ridge Office Park, Harmon Logistics, Pinecrest Commons, Calder Valley Office Park; towers Calder Trust Tower, Meridian Plaza, Ashford Financial Center, Harlan Tower, Sterling & Vance Building, Westbrook Capital (the city's), Union Federal Building, Commerce Exchange Building (the towns'); City Hall, Town Hall, Municipal Building, Civic Center; Calder County Courthouse, District Courthouse, Hall of Justice, Municipal Court; Teleserve Solutions, DialPoint Contact Center, Calder Connect, Primeline Support, VoiceBridge; Granite Systems, Nimbus Labs, Brightwire, Quanta Works, Copperleaf Software, Hexagon Data; Channel 9 News, Valley 12 Eyewitness News, Radio Calder 1240 AM, River Country 98.5 FM, The Calder Courier, The Valley Gazette. Each a look (walls, trim, sign, letters, accent, style; a storefront's and a station's sign `icon`) the map painter draws (ui/mapsprites `paintStorefront`, `paintBizpark`, `paintTower`, `paintCityHall`, `paintCourthouse`, `paintCallCenter`, `paintTechOffice`, `paintStation`) and a plan (`office`, `media`, `storeys`, `fl`); its walls are its front room's (decor `wallc`). The crawl's tower (`offices`) reads the office site's firms (shops `franchisesOf`).
  - **Where** (`OFFICE_W`, the setting's weights as `PLACE_W`): on dice of their own after the shops, so the shops' rolls are as they were: a POI tile one more place at `SHOP.OFFICE` (city 30%, suburb 30%, town 25%: `officeExtras` in `shopExtras`, extra "shop"); a crawl block one more at `SHOP.CRAWL.office` (city 35%, town 30%: in `shopPlaces`). Measured over 3000 seeded tiles of each setting: a city tile 30% (storefront 11%, tech office 10%, call center 6%, station 2%), a suburb 31% (business park 12%, call center 6%, tech office 6%, storefront 6%, station 1%), a town 25% (storefront 15%, station 7%, business park 2%, call center and tech office under 1%). Never two of a kind on a tile or a block; over a city's crawl 4.5% of the pairs of office buildings share the kind and firm.
  - **City hall and the courthouse** (`civicPlaces`, citycrawl `civicBlock`): once a town or a city, on its crawl's civic block (the deepest level's block by the city's dice), in the slots after its own places: city hall in every one; the courthouse in every city and in a county seat (`COUNTY_SEAT` 40% of the towns: 79 of 200 seeded towns). Not POIs.
  - **The rooms' loot** (`OFFICE_AREAS`: `techfloor`, `dental`, `studio`, `execsuite`, `civichall`, `courtoffice`, `courtev`, `callfloor`; `OFFICE_BOX`: headset desk, news desk, mail sorter, liquor cabinet, a tech office's fridges of drinks, a dentist's instrument cabinet, the courthouse's evidence lockers): offices' electronics, snacks, first aid and paper (scrap); the executive suite's safe, valuables, whiskey and a pistol now and then; the courthouse's evidence lockers of confiscated knives and small guns and its holding cell; the dentist's meds and tools; the station's radios, cameras and batteries; the tech office's laptops and phones. Containers by floor area (`officelayout OFFICE.CELLS`): loot per cell within ±10% of the old tower's over all twelve plans (0.34 a cell over 200 seeds: storefront +1%, business park +7%, tower −7%, city hall +6%, courthouse +3%, call center +5%, tech office +7%, station −5%).
  - **Older saves**: a save from before (`officesV` missing: save.js marks it `officesLegacy`, worldcfg `legacyOffices`) gets none of the new places on its tiles or its crawls' blocks and its towers no firm (shops `noFirm`): its POI lists and blocks hash the same as before. The 59 old archetypes build exactly as before in old and new saves (checked by hash against origin/dev, 12 seeds each).

### A dozen layout variants per type
Issue #35 of the interiors epic #7, the user's requests 2026-10-25: "every building should have several varients"; "for buildings with no to only a few varients create a dozen varients per building type". `shopvariants.js` (the tables and the builder), called from buildingmaps `shop`, `bigstore`, `dealer`, `bank` and `openfloor` for a new save; test `tools/shopvarianttest.js`, renders `tools/shopshot.cjs`.
- **The types** (23): the pharmacy, the gas station, the truck stop, every franchise shop kind (gun store, pawn shop, sporting goods, electronics, radio, bookstore, pet store, garden center, clothing, liquor, hardware), the feed store, the car dealer, the auto shop, the garage, the workshop, the bank, and #22's corner store, grocery and supermarket. 12 named plans each (`VARIANT_TYPES[type].variants`).
- **The rule**: a variant is a plan of its own, not a recolour. Every pair of a type's variants differs in at least two of: the room list, the arrangement, the entrances, a corridor or an open plan, the size, the storeys (the test checks every pair from the tables). The footprint shapes (#23's L, T and U) are not on dev yet; the arrangements are rectangles.
- **The arrangements** (`VARIANT_LAYS`): front and back (the sales floor over a back strip of rooms), a service corridor (2 wide, between the front and the back strip: staff lockers and shelving along its back wall, shoplayout `servicehall`), three bands (the front, a middle band of counter rooms or offices, the back strip; at least 15 deep), a side column (the front the full depth, rooms down one side: the dice pick the side; the front keeps 8 cells across), an L of back rooms (the back strip and a side column). A service bay at one end with its roller door where the plan has one.
- **Sizes** (`SIZES`, cells of a metre): #24's real-world size of each type (data-buildingsize `REAL_SIZE`, metres across the front and front to back) cut into quarters, S the smallest to XL the biggest (a pharmacy 12–14 × 14–17 to 18–20 × 22–24, a gas station 15–18 × 10–11 to 23–25 × 14–15, a truck stop 25–29 × 15–18 to 36–40 × 22–25, a dealer 30–35 × 20–24 to 45–50 × 31–35); these rows are `planned` in REAL_SIZE (realScale leaves the plans as drawn). #22's tiers keep #22's footprints (`TIER_SIZES`: the corner store 10–14 across, the grocery 20–26 × 17–20, the supermarket 54–58 × 36–40). A footprint of 700+ cells and 30+ across is the "xl" class (its map its footprint and margins). A bigger plan's rooms hold more containers by their area over today's footprint (`TODAY_AREA`, `scaleBoxes`), × the type's `boxes` (tuned: below).
- **Ways in**: the front door always; by the plan a back door, a side door, a second entrance, a fire exit, a loading door (a roller), a yard gate, a drive-through window, bay doors front and back (`EXITS`).
- **Upstairs** (`UPPER`): the shop's flat, offices (a corridor of offices, a meeting room, records, a break room), an upper stockroom, an upper sales floor, a feed mill's grain loft, a truck stop's drivers' bunks; the supermarket's mezzanine or a food hall. A franchise with a flat above (`plan.flat`: a bodega, a used bookshop, an outfitter) rolls it on a one-storey plan, as before. Storey ranges in `STOREYS_BY_TYPE` (most of these types 1–2, the bank 1–3).
- **Each kind's signature in every plan**: the pharmacy's dispensary, the gun store's gun cage (locked behind its vault door on the dice, 80%), the pawn shop's gun case, the bank's vault behind its vault door and its ATM lobby, the gas station's and the truck stop's pumps on the lot (a new save's pumps take the row beside, or the lot beside the building, when trucks or the ways to the exits fill theirs), the truck stop's shop, diner and kitchen (its diner one of #33's truck-stop diners: eaterylayout `eateryVariant`, its counter and grill, its kitchen's line and its food), the garden center's greenhouse, the clothing store's fitting rooms, the hardware store's tool crib; #22's rooms in every grocery tier (the corner store's store and stockroom, the grocery's sales floor, stockroom and walk-in cooler, the supermarket's café, restrooms, bakery, pharmacy, deli and butcher, warehouse with 2–3 dock doors, walk-in cooler and freezer, baler and cash office). The fronts' pieces as #16 laid them (a narrow front: its rack, its cold case or its pawn counter's bars along a wall where the aisles or the counter could not take them).
- **Picked** (`shopVariant`, the plan's first roll): a place's own variant id (`option.plan`, as #37's plans: a strip mall's slot, a test, a render) first; else among its franchise's variants (`FRANCHISES` `plan.variants`: each franchise maps to the plans that fit it, a kind's franchises together covering all 12), weighted by the setting (`variantSetting` from the tile: a city "city", a suburb "town", a road through the country "highway", else "rural"; "strip" for a strip mall's slot), on the building's dice. With no setting every variant alike.
- **Names**: each variant has a name ("Chain drugstore with a drive-through", "Old service station with repair bays"). The map's plan carries it (`plan.variant`, its id `plan.vid`, as #37's) and the raid's opening lines start with it; the tile panel's places show it after the place's name (ui/poiview `poiLayout`), the crawl's block card after the kind (citycrawl `placeHint`); a franchise's place keeps its franchise's name on the POI and the map.
- **For a strip mall** (#30): `shopPlan(kind, { layout, size, setting, variant, seed })` returns a kind's plan for a slot.
- **Loot**: within ±10% a 100 cells (all floors) of today's (dev before the variants, a new save's plan, 200 seeds; the test's `TODAY`): pharmacy 0%, gas station +6%, truck stop −1%, gun store +3%, pawn shop −6%, sporting goods +5%, electronics +5%, radio −6%, bookstore +3%, pet store −3%, garden +6%, clothing +6%, liquor −5%, hardware −5%, feed store +6%, dealer −3%, bank +4%, auto shop +3%, garage 0%, workshop −2%, corner store +9%, grocery −7%, supermarket +8%. The densities `boxes`: bookstore 0.8, liquor 0.55, sporting goods 0.93, feed store 0.94, clothing 0.95, pawn shop 1.05, dealer 1.08, garage 1.08, grocery 0.9. tools/shopstest.js compares these types by the area too (#22's corner store and grocery by the building, as before).
- **Older saves**: an older save (`roomsLegacy`) keeps every building's old plan: all 77 archetypes build the same maps as on dev (cells, containers and their ids, rooms, locked doors; checked by hash, 12 seeds each).
- **The variants**, by type (the rooms besides the front room; ways in counting the front door):
**pharmacy** (12)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Chain drugstore with a drive-through (`drivethru`) | Drive-through window, Dispensary, Stockroom, Office, Restroom | side column | M 14–16 × 17–19 | 3 | 1 |
| Independent pharmacy with a soda fountain (`fountain`) | Soda fountain, Dispensary, Stockroom, Office | front and back | M 14–16 × 17–19 | 2 | 1–2 (flat) |
| Compounding pharmacy (`compounding`) | Dispensary, Compounding lab, Stockroom, Restroom | three bands | S 12–14 × 15–17 | 2 | 1 |
| Hospital outpatient pharmacy (`outpatient`) | Waiting area, Dispensary, Vaccine fridge room, Stockroom, Office | service corridor | L 16–18 × 19–22 | 3 | 1 |
| Strip-mall pharmacy (`stripmall`) | Dispensary, Stockroom, Restroom | front and back | S 12–14 × 14–17 | 2 | 1 |
| 24-hour pharmacy with a photo counter (`allnight`) | Photo counter, Dispensary, Stockroom, Break room, Manager's office, Restroom | front and back | L 16–18 × 19–22 | 3 | 1 |
| Country drugstore (`country`) | Stockroom, Dispensary | side column | M 14–16 × 17–19 | 2 | 1–2 (flat) |
| Pharmacy with a walk-in clinic (`clinic`) | Dispensary, Consultation room, Stockroom, Restroom | service corridor | L 16–18 × 19–22 | 3 | 1 |
| Two-storey main street apothecary (`apothecary`) | Dispensary, Stockroom, Office | front and back | M 14–16 × 17–19 | 3 | 2 (offices) |
| Discount pharmacy warehouse (`discount`) | Dispensary, Stockroom, Receiving, Office, Restroom | L of back rooms | XL 18–20 × 22–24 | 4 | 1 |
| Highway drug and sundries store (`highway`) | Office, Restroom, Vaccine fridge room, Dispensary, Stockroom | L of back rooms | M 14–16 × 17–19 | 3 | 1 |
| Mall pharmacy with a mezzanine stockroom (`mezzanine`) | Dispensary, Stockroom, Restroom | front and back | M 14–16 × 17–19 | 2 | 2 (stockroom) |

**gasstation** (12): franchises PetroStar (kiosk, carwash, deli, plaza); Blue Falcon Gas (service, tyres, citycorner, carwash); Greenleaf Fuel (general, bait, filling, towing); Sundown Gas & Go (fuelstop, plaza, kiosk, towing, deli)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Pump island and kiosk (`kiosk`) | Storeroom, Restroom, 2 pumps | front and back | S 15–18 × 10–11 | 1 | 1 |
| Convenience store with a car wash (`carwash`) | Storeroom, Restroom, Car wash, 3 pumps | front and back | M 18–20 × 11–13 | 4 | 1 |
| Old service station with repair bays (`service`) | Storeroom, Office, Service bay, 2 pumps | front and back | M 18–20 × 11–13 | 3 | 1 |
| Highway travel plaza (`plaza`) | Coffee and snack bar, Storeroom, Break room, Office, Restroom, 4 pumps | front and back | XL 23–25 × 14–15 | 3 | 1 |
| Rural general store with pumps (`general`) | Storeroom, Feed and seed, 1 pump | front and back | M 18–20 × 11–13 | 3 | 1–2 (flat) |
| City corner gas station (`citycorner`) | Office, Storeroom, 2 pumps | side column | S 15–18 × 10–11 | 2 | 1 |
| Gas station with a tyre shop (`tyres`) | Storeroom, Tyre store, Restroom, Tyre shop, 3 pumps | front and back | L 20–23 × 13–14 | 3 | 1 |
| Lakeside gas and bait (`bait`) | Storeroom, Bait room, 1 pump | front and back | S 15–18 × 10–11 | 3 | 1 |
| Two-bay garage with a towing yard (`towing`) | Storeroom, Office, Parts room, Service bay, 2 pumps | front and back | L 20–23 × 13–14 | 4 | 1 |
| Modern convenience station with a deli counter (`deli`) | Deli counter, Storeroom, Walk-in cooler, Break room, Restroom, 4 pumps | service corridor | L 20–23 × 13–14 | 3 | 1 |
| 1950s filling station with an attendant's office (`filling`) | Attendant's office, Service bay, 2 pumps | side column | L 20–23 × 13–14 | 2 | 1 |
| Fuel stop with a lunch counter and showers (`fuelstop`) | Lunch counter, Storeroom, Showers, Restroom, 3 pumps | front and back | L 20–23 × 13–14 | 3 | 1 |

**truckstop** (12)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Truck stop diner with showers and a drivers' lounge (`classic`) | Diner, Kitchen, Showers, Drivers' lounge, Restroom, 3 pumps | front and back | M 29–33 × 18–20 | 2 | 1 |
| Travel centre with a food court and a chapel (`travel`) | Food court, Diner, Kitchen, Storeroom, Chapel, Showers, Office, Restroom, 3 pumps | service corridor | XL 36–40 × 23–25 | 3 | 1 |
| CAT scale and tyre shop (`scale`) | Diner, Kitchen, CAT scale house, Storeroom, Restroom, Tyre shop, 3 pumps | front and back | L 33–36 × 20–23 | 3 | 1 |
| Old truck stop with a service bay (`oldstop`) | Diner, Kitchen, Storeroom, Office, Restroom, Service bay, 3 pumps | front and back | M 29–33 × 18–20 | 4 | 1 |
| Diesel island and café (`diesel`) | Diner, Kitchen, Storeroom, Restroom, 3 pumps | front and back | S 25–29 × 15–18 | 1 | 1 |
| Truck stop with drivers' bunks upstairs (`bunks`) | Diner, Kitchen, Storeroom, Office, Restroom, 3 pumps | front and back | L 33–36 × 20–23 | 2 | 2 (bunks) |
| Highway plaza with two entrances (`plaza`) | Diner, Drivers' lounge, Showers, Kitchen, Storeroom, Restroom, 3 pumps | three bands | L 33–36 × 20–23 | 3 | 1 |
| Rural fuel-and-feed stop (`feedstop`) | Diner, Feed room, Kitchen, Restroom, 3 pumps | L of back rooms | M 29–33 × 18–20 | 3 | 1 |
| Chain travel stop (`chain`) | Diner, Showers, Drivers' lounge, Restroom, Kitchen, Receiving, Office, 3 pumps | L of back rooms | XL 36–40 × 23–25 | 4 | 1 |
| Truck stop with a truck wash (`truckwash`) | Diner, Kitchen, Storeroom, Truck wash, 3 pumps | front and back | L 33–36 × 20–23 | 4 | 1 |
| Truckers' café and store (`cafe`) | Diner, Kitchen, Storeroom, 3 pumps | front and back | S 25–29 × 15–18 | 2 | 1–2 (flat) |
| Mega travel centre with a tyre shop and chapel (`mega`) | Diner, Kitchen, Chapel, Showers, CAT scale house, Restroom, Tyre shop, 3 pumps | service corridor | XL 36–40 × 23–25 | 5 | 1 |

**gunstore** (12): franchises Big Iron Guns (main, corner, narrow, wrap); Patriot Firearms (strip, twofloor, twin, counter); Tactical Supply Co. (superstore, flagship, outlet); Hunter's Rest Gun Shop (roadside, counter, outlet)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Main street gun shop (`main`) | Gun cage, Back room, Office | front and back | M 12–14 × 14–16 | 2 | 1 |
| Gun shop with the owner's flat above (`narrow`) | Back room, Gun cage | front and back | S 10–12 × 12–14 | 2 | 2 (flat) |
| Corner gun shop with a side door (`corner`) | Back room, Gun cage, Restroom | front and back | M 12–14 × 14–16 | 3 | 1 |
| Strip-mall gun counter (`strip`) | Gun cage, Back room | front and back | S 10–12 × 12–14 | 2 | 1 |
| Tactical supply superstore (`superstore`) | Back room, Gun cage, Gunsmith's bench, Break room, Manager's office, Restroom | service corridor | XL 16–18 × 18–20 | 3 | 1 |
| Gun shop with an indoor range (`outlet`) | Gun cage, Indoor range | side column | L 14–16 × 16–18 | 2 | 1 |
| Two-floor firearms store (`twofloor`) | Back room, Gun cage, Office | front and back | M 12–14 × 14–16 | 3 | 2 (sales floor) |
| Gun shop with an L of back rooms (`wrap`) | Office, Restroom, Gun cage, Back room | L of back rooms | M 12–14 × 14–16 | 2 | 1 |
| Gunsmith and gun shop (`counter`) | Gunsmith's bench, Gun cage, Back room, Office | three bands | M 12–14 × 15–16 | 2 | 1 |
| Guns and ammo, two shopfronts (`twin`) | Ammo and reloading, Back room, Gun cage, Manager's office, Restroom | front and back | L 14–16 × 16–18 | 3 | 1 |
| Roadside hunting and gun shop (`roadside`) | Back room, Gun cage | side column | L 14–16 × 16–18 | 3 | 1–2 (flat) |
| Flagship firearms outfitter (`flagship`) | Ammo and reloading, Back room, Gun cage, Gunsmith's bench, Office, Restroom | service corridor | XL 16–18 × 18–20 | 4 | 2 (offices) |

**pawnshop** (12): franchises Quick Cash Pawn (main, strip, narrow, wrap); Gold & Gun Exchange (flagship, counter, twin); Silver Dollar Pawn (roadside, outlet, corner); Main Street Loan (twofloor, superstore, corner)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Main street pawn shop (`main`) | Gun case, Back room, Office | front and back | M 12–13 × 14–16 | 2 | 1 |
| Pawn shop with a flat above (`narrow`) | Back room, Gun case | front and back | S 10–12 × 12–14 | 2 | 2 (flat) |
| Corner pawn and loan (`corner`) | Back room, Gun case, Restroom | front and back | M 12–13 × 14–16 | 3 | 1 |
| Strip-mall pawn counter (`strip`) | Gun case, Back room | front and back | S 10–12 × 12–14 | 2 | 1 |
| Pawn superstore (`superstore`) | Back room, Gun case, Jewellery safe room, Break room, Manager's office, Restroom | service corridor | XL 15–16 × 18–20 | 3 | 1 |
| Pawn shop with a storage yard (`outlet`) | Gun case, Storage yard | side column | L 13–15 × 16–18 | 2 | 1 |
| Two-floor pawn exchange (`twofloor`) | Back room, Gun case, Office | front and back | M 12–13 × 14–16 | 3 | 2 (sales floor) |
| Pawn shop with an L of back rooms (`wrap`) | Office, Restroom, Gun case, Back room | L of back rooms | M 12–13 × 14–16 | 2 | 1 |
| Pawn shop with a jewellery safe room (`counter`) | Jewellery safe room, Gun case, Back room, Office | three bands | M 12–13 × 15–16 | 2 | 1 |
| Pawn and electronics, two shopfronts (`twin`) | Electronics and tools, Back room, Gun case, Manager's office, Restroom | front and back | L 13–15 × 16–18 | 3 | 1 |
| Roadside trading post (`roadside`) | Back room, Gun case | side column | L 13–15 × 16–18 | 3 | 1–2 (flat) |
| Gold and gun exchange (`flagship`) | Electronics and tools, Back room, Gun case, Jewellery safe room, Office, Restroom | service corridor | XL 15–16 × 18–20 | 4 | 2 (offices) |

**sportshop** (12): franchises Peak Sports (superstore, flagship, twofloor); All-Star Athletics (main, corner, wrap, strip); Trailhead Outfitters (outlet, roadside, counter); Big Buck Sporting Goods (counter, roadside, outlet); Riverbend Bait & Tackle (narrow, roadside, main); Summit Outdoor Co. (flagship, twin, superstore)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Sporting goods store (`main`) | Fitting rooms, Stockroom, Office | front and back | M 19–21 × 18–21 | 2 | 1 |
| Bike and ski shop with a flat above (`narrow`) | Stockroom, Fitting rooms | front and back | S 16–19 × 16–18 | 2 | 2 (flat) |
| Corner sports shop (`corner`) | Stockroom, Fitting rooms, Restroom | front and back | M 19–21 × 18–21 | 3 | 1 |
| Strip-mall sports outlet (`strip`) | Fitting rooms, Stockroom | front and back | S 16–19 × 16–18 | 2 | 1 |
| Sports superstore (`superstore`) | Stockroom, Fitting rooms, Gun counter, Break room, Manager's office, Restroom | service corridor | XL 24–26 × 23–25 | 3 | 1 |
| Outdoor outfitter with a boat yard (`outlet`) | Fitting rooms, Boat yard | side column | L 21–24 × 21–23 | 2 | 1 |
| Two-floor sports store (`twofloor`) | Stockroom, Fitting rooms, Office | front and back | M 19–21 × 18–21 | 3 | 2 (sales floor) |
| Team sports shop (`wrap`) | Office, Restroom, Fitting rooms, Stockroom | L of back rooms | M 19–21 × 18–21 | 2 | 1 |
| Hunting and fishing counter (`counter`) | Gun counter, Fitting rooms, Stockroom, Office | three bands | M 19–21 × 18–21 | 2 | 1 |
| Sports and camping, two shopfronts (`twin`) | Camping and fishing, Stockroom, Fitting rooms, Manager's office, Restroom | front and back | L 21–24 × 21–23 | 3 | 1 |
| Bait and tackle on the road (`roadside`) | Stockroom, Fitting rooms | side column | L 21–24 × 21–23 | 3 | 1–2 (flat) |
| Flagship outdoor store (`flagship`) | Camping and fishing, Stockroom, Fitting rooms, Gun counter, Office, Restroom | service corridor | XL 24–26 × 23–25 | 4 | 2 (offices) |

**electronics** (12): franchises VoltMart (superstore, outlet, twin); Circuit Town (main, corner, strip, twofloor); MegaByte Electronics (flagship, superstore, twin); Hi-Fi Hut (wrap, narrow, main); Hometown TV & Repair (counter, roadside, narrow)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Electronics store (`main`) | Repair bench, Stockroom, Office | front and back | M 17–19 × 16–18 | 2 | 1 |
| TV shop with a flat above (`narrow`) | Stockroom, Repair bench | front and back | S 14–17 × 14–16 | 2 | 2 (flat) |
| Corner electronics shop (`corner`) | Stockroom, Repair bench, Restroom | front and back | M 17–19 × 16–18 | 3 | 1 |
| Strip-mall phone and gadget store (`strip`) | Repair bench, Stockroom | front and back | S 14–17 × 14–16 | 2 | 1 |
| Electronics megastore (`superstore`) | Stockroom, Repair bench, Home theatre room, Break room, Manager's office, Restroom | service corridor | XL 22–24 × 20–22 | 3 | 1 |
| Electronics warehouse outlet (`outlet`) | Repair bench, Warehouse pickup | side column | L 19–22 × 18–20 | 2 | 1 |
| Two-floor electronics store (`twofloor`) | Stockroom, Repair bench, Office | front and back | M 17–19 × 16–18 | 3 | 2 (sales floor) |
| Hi-fi shop (`wrap`) | Office, Restroom, Repair bench, Stockroom | L of back rooms | M 17–19 × 16–18 | 2 | 1 |
| TV and radio repair shop (`counter`) | Home theatre room, Repair bench, Stockroom, Office | three bands | M 17–19 × 16–18 | 2 | 1 |
| Computers and TVs, two shopfronts (`twin`) | Phones and computers, Stockroom, Repair bench, Manager's office, Restroom | front and back | L 19–22 × 18–20 | 3 | 1 |
| Roadside satellite and TV dealer (`roadside`) | Stockroom, Repair bench | side column | L 19–22 × 18–20 | 3 | 1–2 (flat) |
| Flagship electronics store (`flagship`) | Phones and computers, Stockroom, Repair bench, Home theatre room, Office, Restroom | service corridor | XL 22–24 × 20–22 | 4 | 2 (offices) |

**radioshop** (12): franchises Signal Hill Radio (main, corner, wrap); Wavelength Electronics (superstore, twofloor, twin, flagship); CB Corner (counter, roadside, strip); Antenna Joe's (outlet, roadside, counter, narrow); Frequency Supply (flagship, superstore, main)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Radio shop (`main`) | Repair bench, Stockroom, Office | front and back | M 13–14 × 14–16 | 2 | 1 |
| Radio shop with a flat above (`narrow`) | Stockroom, Repair bench | front and back | S 12–13 × 13–14 | 2 | 2 (flat) |
| Corner radio and parts (`corner`) | Stockroom, Repair bench, Restroom | front and back | M 13–14 × 14–16 | 3 | 1 |
| Strip-mall radio counter (`strip`) | Repair bench, Stockroom | front and back | S 12–13 × 13–14 | 2 | 1 |
| Electronic parts supply (`superstore`) | Stockroom, Repair bench, Antenna stock, Break room, Manager's office, Restroom | service corridor | XL 15–16 × 17–18 | 3 | 1 |
| Radio shop with a tower parts yard (`outlet`) | Repair bench, Tower parts yard | side column | L 14–15 × 16–17 | 2 | 1 |
| Two-floor ham radio store (`twofloor`) | Stockroom, Repair bench, Office | front and back | M 13–14 × 14–16 | 3 | 2 (sales floor) |
| Radio shop with an L of back rooms (`wrap`) | Office, Restroom, Repair bench, Stockroom | L of back rooms | M 13–14 × 14–16 | 2 | 1 |
| Radio repair shop (`counter`) | Antenna stock, Repair bench, Stockroom, Office | three bands | M 13–14 × 15–16 | 2 | 1 |
| CB and scanners, two shopfronts (`twin`) | CB and scanner counter, Stockroom, Repair bench, Manager's office, Restroom | front and back | L 14–15 × 16–17 | 3 | 1 |
| Truckers' CB shop (`roadside`) | Stockroom, Repair bench | side column | L 14–15 × 16–17 | 3 | 1–2 (flat) |
| Communications outfitter (`flagship`) | CB and scanner counter, Stockroom, Repair bench, Antenna stock, Office, Restroom | service corridor | XL 15–16 × 17–18 | 4 | 2 (offices) |

**bookstore** (12): franchises Dog-Eared Books (main, counter, wrap); Chapter & Verse (superstore, flagship, twofloor); Second Story Used Books (narrow, roadside, outlet); Bound & Found (corner, strip, twin); Readwell's (flagship, twin, superstore)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Bookshop (`main`) | Rare books room, Back room, Office | front and back | M 12–14 × 15–17 | 2 | 1 |
| Used bookshop with a flat above (`narrow`) | Back room, Rare books room | front and back | S 10–12 × 12–15 | 2 | 2 (flat) |
| Corner bookshop (`corner`) | Back room, Rare books room, Restroom | front and back | M 12–14 × 15–17 | 3 | 1 |
| Strip-mall bookstore (`strip`) | Rare books room, Back room | front and back | S 10–12 × 12–15 | 2 | 1 |
| Book superstore (`superstore`) | Back room, Rare books room, Reading café, Break room, Manager's office, Restroom | service corridor | XL 16–18 × 20–22 | 3 | 1 |
| Book barn and warehouse (`outlet`) | Rare books room, Book warehouse | side column | L 14–16 × 17–20 | 2 | 1 |
| Two-floor bookstore (`twofloor`) | Back room, Rare books room, Office | front and back | M 12–14 × 15–17 | 3 | 2 (sales floor) |
| Bookshop with an L of back rooms (`wrap`) | Office, Restroom, Rare books room, Back room | L of back rooms | M 12–14 × 15–17 | 2 | 1 |
| Bookshop with a reading café (`counter`) | Reading café, Rare books room, Back room, Office | three bands | M 12–14 × 15–17 | 2 | 1 |
| Books and children's books, two shopfronts (`twin`) | Children's books, Back room, Rare books room, Manager's office, Restroom | front and back | L 14–16 × 17–20 | 3 | 1 |
| Roadside book barn (`roadside`) | Back room, Rare books room | side column | L 14–16 × 17–20 | 3 | 1–2 (flat) |
| Flagship bookstore with a café (`flagship`) | Children's books, Back room, Rare books room, Reading café, Office, Restroom | service corridor | XL 16–18 × 20–22 | 4 | 2 (offices) |

**petstore** (12): franchises Paws & Claws (superstore, twin, flagship); Happy Tails Pet Supply (main, corner, strip); Fins & Feathers (twin, wrap, twofloor); The Feed Bin (outlet, roadside, counter); Wagmore Pet Mart (flagship, superstore, narrow)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Pet shop (`main`) | Fish room, Stockroom, Office | front and back | M 16–18 × 14–16 | 2 | 1 |
| Pet shop with a flat above (`narrow`) | Stockroom, Fish room | front and back | S 14–16 × 12–14 | 2 | 2 (flat) |
| Corner pet shop (`corner`) | Stockroom, Fish room, Restroom | front and back | M 16–18 × 14–16 | 3 | 1 |
| Strip-mall pet supply (`strip`) | Fish room, Stockroom | front and back | S 14–16 × 12–14 | 2 | 1 |
| Pet superstore (`superstore`) | Stockroom, Fish room, Grooming room, Break room, Manager's office, Restroom | service corridor | XL 20–22 × 18–20 | 3 | 1 |
| Pet and feed warehouse (`outlet`) | Fish room, Feed warehouse | side column | L 18–20 × 16–18 | 2 | 1 |
| Two-floor pet store (`twofloor`) | Stockroom, Fish room, Office | front and back | M 16–18 × 14–16 | 3 | 2 (sales floor) |
| Pet shop with an L of back rooms (`wrap`) | Office, Restroom, Fish room, Stockroom | L of back rooms | M 16–18 × 14–16 | 2 | 1 |
| Pet shop with a grooming salon (`counter`) | Grooming room, Fish room, Stockroom, Office | three bands | M 16–18 × 15–16 | 2 | 1 |
| Pets and aquariums, two shopfronts (`twin`) | Aquarium hall, Stockroom, Fish room, Manager's office, Restroom | front and back | L 18–20 × 16–18 | 3 | 1 |
| Country pet and feed (`roadside`) | Stockroom, Fish room | side column | L 18–20 × 16–18 | 3 | 1–2 (flat) |
| Flagship pet store with a groomer (`flagship`) | Aquarium hall, Stockroom, Fish room, Grooming room, Office, Restroom | service corridor | XL 20–22 × 18–20 | 4 | 2 (offices) |

**garden** (12): franchises Green Thumb Garden Center (superstore, flagship, twin); Blooming Acres Nursery (outlet, roadside); Sunflower Garden Supply (main, corner, strip, narrow); Root & Branch (outlet, counter, wrap); Hillcrest Greenhouses (twofloor, roadside, flagship)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Garden centre (`main`) | Greenhouse, Potting shed, Office | front and back | M 21–24 × 16–18 | 2 | 1 |
| Florist and garden shop with a flat above (`narrow`) | Potting shed, Greenhouse | front and back | S 18–21 × 14–16 | 2 | 2 (flat) |
| Corner garden shop (`corner`) | Potting shed, Greenhouse, Restroom | front and back | M 21–24 × 16–18 | 3 | 1 |
| Strip-mall garden supply (`strip`) | Greenhouse, Potting shed | front and back | S 18–21 × 14–16 | 2 | 1 |
| Garden superstore (`superstore`) | Potting shed, Greenhouse, Tool shed, Break room, Manager's office, Restroom | service corridor | XL 27–30 × 20–22 | 3 | 1 |
| Nursery with a yard (`outlet`) | Greenhouse, Yard stock | side column | L 24–27 × 18–20 | 2 | 1 |
| Two-floor garden store (`twofloor`) | Potting shed, Greenhouse, Office | front and back | M 21–24 × 16–18 | 3 | 2 (sales floor) |
| Garden centre with an L of sheds (`wrap`) | Office, Restroom, Greenhouse, Potting shed | L of back rooms | M 21–24 × 16–18 | 2 | 1 |
| Garden shop with a tool shed (`counter`) | Tool shed, Greenhouse, Potting shed, Office | three bands | M 21–24 × 16–18 | 2 | 1 |
| Garden and outdoor living, two shopfronts (`twin`) | Outdoor living, Potting shed, Greenhouse, Manager's office, Restroom | front and back | L 24–27 × 18–20 | 3 | 1 |
| Roadside nursery (`roadside`) | Potting shed, Greenhouse | side column | L 24–27 × 18–20 | 3 | 1–2 (flat) |
| Flagship garden centre (`flagship`) | Outdoor living, Potting shed, Greenhouse, Tool shed, Office, Restroom | service corridor | XL 27–30 × 20–22 | 4 | 2 (offices) |

**clothing** (12): franchises Threadline (superstore, flagship, twofloor); Denim & Co. (main, corner, strip); Western Wear Outlet (roadside, outlet); Workwear Depot (outlet, counter, wrap); Urban Thread (narrow, twin, corner); Mackinaw Outfitters (narrow, roadside, main); Velvet Lane Boutique (twin, counter, strip)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Clothing store (`main`) | Fitting rooms, Stockroom, Office | front and back | M 15–17 × 17–19 | 2 | 1 |
| Boutique with a flat above (`narrow`) | Stockroom, Fitting rooms | front and back | S 12–15 × 14–17 | 2 | 2 (flat) |
| Corner clothing shop (`corner`) | Stockroom, Fitting rooms, Restroom | front and back | M 15–17 × 17–19 | 3 | 1 |
| Strip-mall clothing store (`strip`) | Fitting rooms, Stockroom | front and back | S 12–15 × 14–17 | 2 | 1 |
| Clothing superstore (`superstore`) | Stockroom, Fitting rooms, Alterations room, Break room, Manager's office, Restroom | service corridor | XL 20–22 × 22–24 | 3 | 1 |
| Factory outlet (`outlet`) | Fitting rooms, Outlet stockroom | side column | L 17–20 × 19–22 | 2 | 1 |
| Two-floor fashion store (`twofloor`) | Stockroom, Fitting rooms, Office | front and back | M 15–17 × 17–19 | 3 | 2 (sales floor) |
| Clothing store with an L of back rooms (`wrap`) | Office, Restroom, Fitting rooms, Stockroom | L of back rooms | M 15–17 × 17–19 | 2 | 1 |
| Tailor and clothier (`counter`) | Alterations room, Fitting rooms, Stockroom, Office | three bands | M 15–17 × 17–19 | 2 | 1 |
| Clothes and shoes, two shopfronts (`twin`) | Shoe department, Stockroom, Fitting rooms, Manager's office, Restroom | front and back | L 17–20 × 19–22 | 3 | 1 |
| Western and work wear barn (`roadside`) | Stockroom, Fitting rooms | side column | L 17–20 × 19–22 | 3 | 1–2 (flat) |
| Flagship fashion store (`flagship`) | Shoe department, Stockroom, Fitting rooms, Alterations room, Office, Restroom | service corridor | XL 20–22 × 22–24 | 4 | 2 (offices) |

**liquor** (12): franchises Spirit Shoppe (main, corner, wrap); Bottle King (superstore, outlet, flagship); Package Liquors (roadside, strip, counter); Corner Cork Wine & Spirits (narrow, counter, twofloor); Liberty Liquor (main, twin, strip); Hops & Barley (outlet, roadside, twin)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Liquor store (`main`) | Walk-in beer cooler, Back room, Office | front and back | M 12–14 × 14–16 | 2 | 1 |
| Off-licence with a flat above (`narrow`) | Back room, Walk-in beer cooler | front and back | S 10–12 × 12–14 | 2 | 2 (flat) |
| Corner liquor store (`corner`) | Back room, Walk-in beer cooler, Restroom | front and back | M 12–14 × 14–16 | 3 | 1 |
| Strip-mall liquor store (`strip`) | Walk-in beer cooler, Back room | front and back | S 10–12 × 12–14 | 2 | 1 |
| Liquor superstore (`superstore`) | Back room, Walk-in beer cooler, Wine cellar, Break room, Manager's office, Restroom | service corridor | XL 16–18 × 18–20 | 3 | 1 |
| Liquor warehouse (`outlet`) | Walk-in beer cooler, Keg and case warehouse | side column | L 14–16 × 16–18 | 2 | 1 |
| Two-floor wine and spirits (`twofloor`) | Back room, Walk-in beer cooler, Office | front and back | M 12–14 × 14–16 | 3 | 2 (sales floor) |
| Liquor store with an L of back rooms (`wrap`) | Office, Restroom, Walk-in beer cooler, Back room | L of back rooms | M 12–14 × 14–16 | 2 | 1 |
| Wine merchant with a cellar (`counter`) | Wine cellar, Walk-in beer cooler, Back room, Office | three bands | M 12–14 × 15–16 | 2 | 1 |
| Beer and wine, two shopfronts (`twin`) | Wine room, Back room, Walk-in beer cooler, Manager's office, Restroom | front and back | L 14–16 × 16–18 | 3 | 1 |
| Roadside package store (`roadside`) | Back room, Walk-in beer cooler | side column | L 14–16 × 16–18 | 3 | 1–2 (flat) |
| Flagship wine and spirits (`flagship`) | Wine room, Back room, Walk-in beer cooler, Wine cellar, Office, Restroom | service corridor | XL 16–18 × 18–20 | 4 | 2 (offices) |

**hardware** (12): franchises Handy Hank's Hardware (main, corner, narrow); Builders Supply Co. (superstore, flagship, twin); Nail & Bolt Hardware (strip, wrap, counter, twofloor); Lumber Barn (outlet, roadside); Fix-It Depot (superstore, twin, flagship)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Hardware store (`main`) | Tool crib, Lumber and stock, Office | front and back | M 21–24 × 18–21 | 2 | 1 |
| Hardware shop with a flat above (`narrow`) | Lumber and stock, Tool crib | front and back | S 18–21 × 16–18 | 2 | 2 (flat) |
| Corner hardware store (`corner`) | Lumber and stock, Tool crib, Restroom | front and back | M 21–24 × 18–21 | 3 | 1 |
| Strip-mall hardware store (`strip`) | Tool crib, Lumber and stock | front and back | S 18–21 × 16–18 | 2 | 1 |
| Home improvement superstore (`superstore`) | Lumber and stock, Tool crib, Key and paint counter, Break room, Manager's office, Restroom | service corridor | XL 27–30 × 23–25 | 3 | 1 |
| Lumber yard and hardware (`outlet`) | Tool crib, Lumber yard | side column | L 24–27 × 21–23 | 2 | 1 |
| Two-floor hardware store (`twofloor`) | Lumber and stock, Tool crib, Office | front and back | M 21–24 × 18–21 | 3 | 2 (sales floor) |
| Hardware store with an L of back rooms (`wrap`) | Office, Restroom, Tool crib, Lumber and stock | L of back rooms | M 21–24 × 18–21 | 2 | 1 |
| Hardware store with a key and paint counter (`counter`) | Key and paint counter, Tool crib, Lumber and stock, Office | three bands | M 21–24 × 18–21 | 2 | 1 |
| Hardware and paint, two shopfronts (`twin`) | Paint and plumbing, Lumber and stock, Tool crib, Manager's office, Restroom | front and back | L 24–27 × 21–23 | 3 | 1 |
| Farm and ranch hardware (`roadside`) | Lumber and stock, Tool crib | side column | L 24–27 × 21–23 | 3 | 1–2 (flat) |
| Flagship builders' supply (`flagship`) | Paint and plumbing, Lumber and stock, Tool crib, Key and paint counter, Office, Restroom | service corridor | XL 27–30 × 23–25 | 4 | 2 (offices) |

**feedstore** (12)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Farm-supply barn with a bale yard (`supplybarn`) | Fencing and bale yard, Feed room, Office | side column | L 20–23 × 16–18 | 2 | 1 |
| Grain co-op with bins (`coop`) | Grain bins, Feed room, Office, Restroom | front and back | L 20–23 × 16–18 | 2 | 1 |
| Western store with saddles and boots (`western`) | Western wear, Saddle and tack room, Feed room, Office | front and back | M 18–20 × 14–16 | 3 | 1 |
| Country feed store (`country`) | Feed room, Office | front and back | M 18–20 × 14–16 | 2 | 1 |
| Tack and saddlery (`tack`) | Saddle and tack room, Office | front and back | S 15–18 × 12–14 | 2 | 1 |
| Farm and ranch centre (`ranch`) | Western wear, Feed room, Vet supplies, Saddle and tack room, Office, Restroom | service corridor | XL 23–25 × 18–20 | 3 | 1 |
| Old feed mill (`mill`) | Grain bins, Feed room | three bands | M 18–20 × 15–16 | 3 | 2 (grain loft) |
| Livestock supply with a vet counter (`livestock`) | Vet supplies, Office, Feed room | L of back rooms | M 18–20 × 14–16 | 2 | 1 |
| Feed and hardware (`feedhardware`) | Hardware, Feed room, Office | front and back | L 20–23 × 16–18 | 3 | 1 |
| Roadside hay and feed shed (`hayshed`) | Fencing and bale yard | side column | S 15–18 × 12–14 | 3 | 1 |
| Seed and garden supply (`seed`) | Feed room, Greenhouse, Office | front and back | M 18–20 × 14–16 | 2 | 1–2 (flat) |
| Farmers' co-op store with offices upstairs (`towncoop`) | Feed room, Grain bins, Restroom | service corridor | M 18–20 × 14–16 | 2 | 2 (offices) |

**dealer** (12): franchises Calder Motors (franchise, automall, glass); Bargain Bob's Used Cars (usedlot, rental, superstore); Highline Auto Mall (automall, boutique, glass); Truck Country (truck, country, rv); Hometown Auto Sales (franchise, country, bodyshop, motorcycle); Prestige Imports (boutique, glass, motorcycle)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| New car dealer with service bays (`franchise`) | Parts room, Sales office, Restroom, Service bays | front and back | M 35–40 × 24–28 | 3 | 1 |
| Used car lot office (`usedlot`) | Office, Restroom | front and back | S 30–35 × 20–24 | 2 | 1 |
| Auto mall with a finance floor (`automall`) | Parts room, Sales office, Finance office, Restroom, Service bays | service corridor | L 40–45 × 28–31 | 4 | 2 (offices) |
| Truck and tractor dealer (`truck`) | Parts room, Sales office, Service bays | front and back | L 40–45 × 28–31 | 3 | 1 |
| Import boutique showroom (`boutique`) | Sales office, Finance office, Restroom | front and back | M 35–40 × 24–28 | 1 | 1 |
| RV and boat dealer (`rv`) | Sales office, Finance office, Parts room, Accessories store, RV service bay | three bands | L 40–45 × 28–31 | 4 | 1 |
| Motorcycle dealer (`motorcycle`) | Gear and helmets, Parts room, Bike workshop | front and back | M 35–40 × 24–28 | 3 | 1 |
| Dealer with a body shop (`bodyshop`) | Paint booth, Parts room, Sales office, Service bays | front and back | M 35–40 × 24–28 | 4 | 1 |
| Glass-front showroom on the strip (`glass`) | Sales office, Finance office, Restroom | front and back | L 40–45 × 28–31 | 3 | 1 |
| Country dealer and garage (`country`) | Sales office, Restroom, Parts room, Service bays | L of back rooms | M 35–40 × 24–28 | 4 | 1 |
| Car rental and sales (`rental`) | Rental desk, Wash bay | side column | S 30–35 × 20–24 | 2 | 1 |
| Used car superstore (`superstore`) | Parts room, Sales office, Finance office, Break room, Restroom, Service bays | service corridor | XL 45–50 × 31–35 | 5 | 1 |

**bank** (12): franchises First Calder Bank (marble, corner, drivethru, headquarters, trust); Mercantile Trust (tower, grand, headquarters, marble); Farmers & Merchants Bank (farmers, smalltown, grand); Liberty Savings & Loan (savings, drivethru, driveup); Granite National Bank (marble, tower, grand); Union Credit Union (creditunion, driveup, savings, corner)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Small-town bank (`smalltown`) | ATM lobby, Teller line, Vault, Manager's office | front and back | S 15–19 × 15–18 | 2 | 1 |
| Branch with a drive-through (`drivethru`) | ATM lobby, Drive-up teller window, Teller line, Vault, Safe-deposit room, Restroom | side column | M 19–23 × 18–20 | 2 | 1 |
| Big city bank with a marble hall (`marble`) | ATM lobby, Teller line, Vault, Safe-deposit room, Manager's office, Records, Restroom | three bands | L 23–26 × 20–23 | 3 | 2–3 (offices) |
| Credit union in a strip mall (`creditunion`) | ATM lobby, Teller line, Vault, Restroom | front and back | S 15–19 × 15–18 | 2 | 1 |
| Savings and loan with loan offices (`savings`) | ATM lobby, Loan office, Teller line, Vault, Manager's office | service corridor | M 19–23 × 18–20 | 2 | 1 |
| Farmers' bank with a loan office (`farmers`) | ATM lobby, Manager's office, Loan office, Teller line, Vault | L of back rooms | M 19–23 × 18–20 | 2 | 1 |
| Bank tower lobby (`tower`) | ATM lobby, Teller line, Vault, Safe-deposit room, Records, Break room, Restroom | service corridor | L 23–26 × 20–23 | 3 | 3 (offices) |
| Corner bank with two doors (`corner`) | ATM lobby, Teller line, Vault, Safe-deposit room, Manager's office | front and back | M 19–23 × 18–20 | 3 | 1 |
| Old grand bank with offices above (`grand`) | ATM lobby, Vault, Teller line, Manager's office | front and back | L 23–26 × 20–23 | 1 | 2 (offices) |
| Branch with a drive-up ATM (`driveup`) | ATM lobby, Drive-up teller window, Teller line, Vault | side column | S 15–19 × 15–18 | 3 | 1 |
| Trust company with private offices (`trust`) | ATM lobby, Loan office, Vault, Safe-deposit room, Manager's office | three bands | M 19–23 × 18–20 | 2 | 1 |
| Regional bank headquarters (`headquarters`) | ATM lobby, Night deposit, Teller line, Vault, Safe-deposit room, Records, Manager's office, Break room, Restroom | service corridor | XL 26–30 × 23–25 | 4 | 2–3 (offices) |

**autoshop** (12): franchises Quick Lube Express (drivethru, wash, small); Hank's Garage & Tow (tow, flat, standard); Precision Auto Repair (standard, engine, counter, fleet); Tire Town (tyres, heavy, counter); Main Street Muffler (small, paint, engine)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Two-bay repair shop (`standard`) | Office, Parts room | side column | M 18–20 × 14–16 | 3 | 1 |
| Quick lube with drive-through bays (`drivethru`) | Office, Restroom | side column | M 18–20 × 14–16 | 3 | 1 |
| Tyre and brake shop (`tyres`) | Office, Tyre store | side column | M 18–20 × 14–16 | 3 | 1 |
| Body shop with a paint booth (`paint`) | Office, Parts room, Paint booth, Restroom | L of back rooms | L 20–23 × 16–18 | 3 | 1 |
| Engine and transmission shop (`engine`) | Office, Parts room, Engine room, Restroom | front and back | L 20–23 × 16–18 | 3 | 1 |
| Muffler shop (`small`) | Office | side column | S 15–18 × 12–14 | 2 | 1 |
| Fleet service garage (`fleet`) | Office, Parts room, Break room, Restroom | side column | XL 23–25 × 18–20 | 4 | 1 |
| Garage and tow yard (`tow`) | Office, Parts room, Tow gear store | L of back rooms | M 18–20 × 14–16 | 3 | 1 |
| Country garage with a flat above (`flat`) | Office, Parts room | side column | M 18–20 × 14–16 | 2 | 2 (flat) |
| Detailing and car wash (`wash`) | Office, Wash bay, Parts room | front and back | M 18–20 × 14–16 | 3 | 1 |
| Auto parts and repair (`counter`) | Parts counter, Office, Parts room, Restroom | three bands | M 18–20 × 15–16 | 3 | 1 |
| Heavy truck repair (`heavy`) | Office, Parts room, Restroom | side column | L 20–23 × 16–18 | 3 | 1 |

**garage** (12)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Town garage (`standard`) | Office, Parts room | side column | M 12–13 × 9–10 | 3 | 1 |
| Drive-through garage (`drivethru`) | Office, Restroom | side column | M 12–13 × 9–10 | 3 | 1 |
| Garage with a tyre store (`tyres`) | Office, Tyre store | side column | M 12–13 × 9–10 | 3 | 1 |
| Body shop and garage (`paint`) | Office, Parts room, Paint booth, Restroom | L of back rooms | L 13–15 × 10–11 | 3 | 1 |
| Garage with a workshop (`engine`) | Office, Parts room, Workshop, Restroom | front and back | L 13–15 × 10–11 | 3 | 1 |
| Lock-up garage (`small`) | Office | side column | S 10–12 × 8–9 | 2 | 1 |
| Municipal vehicle garage (`fleet`) | Office, Parts room, Break room, Restroom | side column | XL 15–16 × 11–12 | 4 | 1 |
| Breakdown and recovery garage (`tow`) | Office, Parts room, Tow gear store | L of back rooms | M 12–13 × 9–10 | 3 | 1 |
| Garage with a flat above (`flat`) | Office, Parts room | side column | M 12–13 × 9–10 | 2 | 2 (flat) |
| Garage with a wash bay (`wash`) | Office, Wash bay, Parts room | front and back | M 12–13 × 9–10 | 3 | 1 |
| Garage with a parts counter (`counter`) | Parts counter, Office, Parts room, Restroom | three bands | M 12–13 × 15 | 3 | 1 |
| Bus and truck garage (`heavy`) | Office, Parts room, Restroom | side column | L 13–15 × 10–11 | 3 | 1 |

**workshop** (12)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Welding shop (`standard`) | Office, Parts room | side column | M 14–16 × 11–12 | 3 | 1 |
| Fabrication shop with through doors (`drivethru`) | Office, Restroom | side column | M 14–16 × 11–12 | 3 | 1 |
| Steel stockholder's shop (`tyres`) | Office, Material store | side column | M 14–16 × 11–12 | 3 | 1 |
| Sign shop with a spray booth (`paint`) | Office, Parts room, Spray booth, Restroom | L of back rooms | L 16–18 × 12–13 | 3 | 1 |
| Machine shop (`engine`) | Office, Parts room, Machine room, Restroom | front and back | L 16–18 × 12–13 | 3 | 1 |
| Small engine repair (`small`) | Office | side column | S 12–14 × 10–11 | 2 | 1 |
| Contractor's workshop (`fleet`) | Office, Parts room, Break room, Restroom | side column | XL 18–20 × 13–14 | 4 | 1 |
| Joinery with a timber store (`tow`) | Office, Parts room, Timber store | L of back rooms | M 14–16 × 11–12 | 3 | 1 |
| Blacksmith's forge with a flat above (`flat`) | Office, Parts room | side column | M 14–16 × 11–12 | 2 | 2 (flat) |
| Boat repair shop (`wash`) | Office, Loading bay, Parts room | front and back | M 14–16 × 11–12 | 3 | 1 |
| Trade counter and workshop (`counter`) | Trade counter, Office, Parts room, Restroom | three bands | M 14–16 × 15 | 3 | 1 |
| Heavy fabrication works (`heavy`) | Office, Parts room, Restroom | side column | L 16–18 × 12–13 | 3 | 1 |

**corner** (12): franchises Quik Stop (classic, twodoor, cooler, kiosk); Seven Star Mart (booth, laundro, sidestock); Penny Mart (post, general, flat, wrap); Night Owl (booth, bodega, kiosk, wrap)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Corner shop (`classic`) | Stockroom, Office, Restroom | front and back | M 11–13 × 10–12 | 2 | 1–2 (flat) |
| Bodega with a deli counter (`bodega`) | Deli counter, Stockroom, Restroom | front and back | M 11–13 × 10–12 | 2 | 1 |
| Shop with the owner's flat above (`flat`) | Stockroom, Restroom | front and back | S 10–11 × 10–11 | 2 | 2 (flat) |
| Corner store with two doors (`twodoor`) | Stockroom, Office | front and back | M 11–13 × 10–12 | 3 | 1 |
| Village shop and post office (`post`) | Post office counter, Stockroom, Restroom | front and back | L 13–14 × 11–12 | 2 | 1 |
| Newsagent kiosk (`kiosk`) | Stockroom | front and back | S 10–11 × 10–11 | 1 | 1 |
| Beer-and-ice store with a walk-in (`cooler`) | Stockroom, Walk-in cooler | front and back | M 11–13 × 10–12 | 2 | 1 |
| Corner market with its stock on the side (`sidestock`) | Stockroom | side column | L 13–14 × 11–12 | 2 | 1 |
| Late-night store with a cashier's booth (`booth`) | Cashier's booth, Stockroom | front and back | M 11–13 × 10–12 | 2 | 1 |
| Corner store and laundromat (`laundro`) | Laundromat, Stockroom, Restroom | front and back | L 13–14 × 11–12 | 2 | 1 |
| General store with a back storeroom (`general`) | Office, Back storeroom, Stockroom | L of back rooms | M 11–13 × 10–12 | 3 | 1 |
| Corner store with an L of back rooms (`wrap`) | Office, Restroom, Stockroom | L of back rooms | L 13–14 × 11–12 | 2 | 2 (flat) |

**grocery** (12): franchises FreshWay Market (dock, corridor, pharmacy); Value Basket (neighbourhood, bakery, international, twostorey); Hilltop Grocers (butcher, florist, country); Mercer's General Store (country, coop, butcher); Corner Bodega (international, annex, coop); Harvest Foods (bakery, florist, pharmacy, annex)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Neighbourhood grocery (`neighbourhood`) | Stockroom, Walk-in cooler, Office, Restroom | front and back | M 20–23 × 17–20 | 3 | 1 |
| Grocery with an in-store bakery (`bakery`) | Bakery, Stockroom, Walk-in cooler, Restroom | front and back | M 20–23 × 17–20 | 2 | 1 |
| Butcher and grocer (`butcher`) | Butcher, Walk-in cooler, Stockroom, Office | front and back | S 20–21 × 17–18 | 3 | 1 |
| Grocery with a loading dock (`dock`) | Stockroom, Walk-in cooler, Walk-in freezer, Office | front and back | L 23–26 × 18–20 | 3 | 1 |
| Grocery with a pharmacy counter (`pharmacy`) | Pharmacy counter, Stockroom, Walk-in cooler, Restroom | front and back | M 20–23 × 17–20 | 3 | 1 |
| Food co-op with offices upstairs (`coop`) | Stockroom, Walk-in cooler, Members' room | front and back | S 20–21 × 17–18 | 2 | 2 (offices) |
| International market (`international`) | Stockroom, Walk-in cooler, Dry goods room, Restroom | front and back | M 20–23 × 17–20 | 2 | 1 |
| Grocery with a beer and wine annex (`annex`) | Beer and wine, Stockroom, Walk-in cooler, Restroom | L of back rooms | L 23–26 × 18–20 | 2 | 1 |
| Two-storey grocery with a stockroom above (`twostorey`) | Stockroom, Walk-in cooler, Restroom | front and back | L 23–26 × 18–20 | 3 | 2 (stockroom) |
| Grocery with a service corridor (`corridor`) | Stockroom, Walk-in cooler, Walk-in freezer, Office, Break room, Restroom | service corridor | L 23–26 × 18–20 | 3 | 1 |
| Market with a florist (`florist`) | Florist, Stockroom, Walk-in cooler, Restroom | front and back | S 20–21 × 17–18 | 3 | 1 |
| Country supermarket with a feed corner (`country`) | Stockroom, Walk-in cooler, Feed and seed | front and back | M 20–23 × 17–20 | 3 | 1 |

**supermarket** (12)

| Variant | Rooms | Plan | Size | Ways in | Storeys |
|---|---|---|---|---|---|
| Supermarket (`classic`) | #22's rooms | #22's | M 54–56 × 36–38 | 2 front, 2–3 docks, fire exit | 1–2 (mezzanine) |
| Supermarket with a fuel station (`fuel`) | 4 pumps | #22's | M 54–56 × 36–38 | 1 front, 2 docks, fire exit | 1 |
| Supermarket with a garden centre (`garden`) | Garden centre | #22's | L 56–58 × 37–40 | 2 front, 2 docks | 1 |
| Supermarket with a liquor store (`liquor`) | Liquor store | #22's | M 54–56 × 36–38 | 2 front, 2 docks, fire exit | 1 |
| Two-storey supermarket (`mezzanine`) | #22's rooms | #22's | L 56–58 × 37–40 | 2 front, 3 docks, fire exit | 2 (mezzanine) |
| Supermarket with a bank branch (`bank`) | Bank branch | #22's | M 54–56 × 36–38 | 1 front, 2 docks, fire exit | 1 |
| City supermarket with a food hall upstairs (`foodhall`) | #22's rooms | #22's | L 56–58 × 37–40 | 2 front, 2 docks | 2 (food hall) |
| Discount warehouse grocery (`discount`) | #22's rooms | #22's | L 56–58 × 37–40 | 1 front, 3 docks | 1 |
| Supermarket with doors at both ends (`twoends`) | #22's rooms | #22's | M 54–56 × 36–38 | 2 front, 2 docks, fire exit, 2 side | 1 |
| Supermarket with a florist and photo lab (`florist`) | Florist, Photo lab | #22's | M 54–56 × 36–38 | 2 front, 2–3 docks, fire exit | 1 |
| Regional supermarket and hardware (`regional`) | Hardware corner | #22's | M 54–56 × 36–38 | 1 front, 2 docks, fire exit | 1 |
| Hypermarket with a fuel station and a mezzanine (`hyper`) | 4 pumps | #22's | L 56–58 × 37–40 | 2 front, 2 docks, fire exit | 2 (mezzanine) |

### Library variants
Issue #34 (the user's request 2026-10-25: "add library variants with several layouts and sizes"; module `librarylayout.js`, test `tools/librarytest.js`, the rooms and rules in [combat.md Libraries](combat.md#libraries)). A new save's library is one of thirteen variants (the user's later request the same day: "for buildings with no to only a few varients create a dozen varients per building type"), each with two plans: a **rural one-room reading room** (10–12 m), a **Carnegie library** (19–25 × 17–20, 1–2 storeys: the rotunda and wings of stacks), a **modern branch** (26–32 × 20–24: glass front, open hall, children's area, teen space, computer bank), a **county library** (31–38 × 25–29, 2 storeys: local history, genealogy, technical services and a loading door), a **central city library** (50–56 × 40–44, 4–8 storeys: atrium, grand reading room, children's floor, floors of stacks, rare books, auditorium, café, closed stacks), a **historic or private library** (23–28 × 20–25, 2–3 storeys: panelled rooms, the gallery over the reading hall, the librarian's flat), a **bookmobile depot**, a **library in a strip mall**, a **library in a converted house**, a **children's library**, a **law library**, a **university research library** and a **historical society or archive**.
- **Which**: the place's franchise (`FRANCHISES.library`, each with `plan.libs`, its variants' weights): Central Library → the central library; Carnegie Library → a Carnegie; Branch Library → a modern branch (70%) or a strip-mall library; County Library → a county library (85%) or the bookmobile depot; Memorial Library → a Carnegie, a county or a historic library. New names: Calder Free Public Library (a Carnegie or a county), Pinecrest Reading Room and Millbrook Village Library (rural), Lakeside Branch Library (modern), Westgate Library Express (strip mall), County Bookmobile Depot, The Athenaeum and Harmon Hall Library (historic), Elm Street House Library (a converted house; Millbrook Village Library is a rural reading room or a house library), Juniper Children's Library, Calder County Law Library (downtown, rare), Calder College Library (downtown, rarer: #28's campus places its own) and Harlan County Historical Society (the towns; a Memorial Library is one now and then). A library with no franchise (a site's from before franchises): `LIBRARY.ANY`'s weights.
- **Where** (the franchise's weights by setting, `franchiseFor`): the rural reading rooms in the towns (a town's ring is where the game's villages and rural towns stand), Carnegies and county libraries in towns and cities, modern branches and strip-mall libraries in the suburbs, the central library downtown only (weight 0.25 among the downtown names, about 1 in 15 of a city block's libraries, none in a suburb or a town; a strict once-a-city rule would need a ledger per city and is left out), the historic libraries rare everywhere. The city crawl's places are the same buildings, so a block holds a library of its variant's size (a crawl place keeps its franchise: `placeOption` variant).
- An older save's libraries keep their layout (`legacyRooms`), and a saved place keeps its franchise and name.

## Bunkers as places
Issue #26 (the user's request 2026-10-25: "Add bunker buildings"). Points of interest on their own dice after the shops (pois.js `bunkerExtra`, `BUNKER_POI`; hash dice of the seed and the tile, never the world's: every seed's map is as it was, and an older save's lists gain the bunker at their end as they gained the shops), one bunker at most on a tile, within `POI.MAX`:
- **Military bunker** (`bunker`, data.js `LOCATIONS.bunker`, secret): hills 0.05%, mountains 0.08% of tiles, × `NEAR` 20 within `NEAR_HEX` 8 hexes of a military site. **Government bunker** (`govbunker`, secret): mountains 0.06%, city blocks 0.2%. **Fallout shelter** (`shelter`, found like a roadside place: known in the known zone half the time): suburbs (a town's ring) 5%, city blocks 4%. **Prepper bunker** (`prepper`, secret): plains 0.6%, forest 1%, hills 1.2%, mountains 0.8%. On a 250 × 150 world (seed 4242, interiortest): 15 military bunkers, 4 government bunkers, 57 shelters (68 at the base rate on the tiles their other places leave room on, POI.MAX), 260 prepper bunkers.
- Crashlanding's mountain bunker stays its own site (`bunker_mil`, crashstart.js), now with its building.
- Each opens its building (buildingmaps.js `SITES`: `bunker_mil` → `mountainbunker`, `bunker` → `milbunker`, `govbunker`, `shelter`, `prepper`); the rest of the POI flow (surveys, the per-POI raid, the container ledger, tile heat, other groups surveying and raiding them through `aiscav`) is the shared one. Their loot by place: loot.js tags (`bunker` military, guns, camp; `govbunker` tech, office, military; `shelter` kitchen, medical, camp; `prepper` camp, hunt, guns, kitchen, outdoor). The building: [combat.md Bunkers](combat.md#bunkers).

## Shopping malls as places
Issue #30 (the user's request 2026-10-25: "add … mall max 500x500 building variants"); the maps in [combat.md](combat.md#malls).
- **Regional malls**: the `mall` site (on a city's ring, as before: mapgen.js `URBAN_SITES`, "Mall") is now one map of the whole enclosed mall (buildingmaps.js `SITES.mall = ["regionalmall"]`); its site POI opens straight into it. A mall raided before keeps its old buildings (`LEGACY_SITES`).
- **Strip malls** (`stripmall`) and **outlet centres** (`outlet`): site types of their own (data-shops.js `NEW_KINDS`: LOCATIONS rows, theme tags, street areas), placed as POIs on their own dice after everything else (pois.js `mallExtra`, `MALL_POI`): a strip mall on a suburb tile (6%) or a town's own tile (30%), an outlet on a road out on the plains (0.4%) or in the suburbs (1%), never on a city block. Map sprite: the mall's.
- **City crawl**: a block may hold a strip mall among its places (citycrawl.js `CRAWL.STRIPMALL`: a city's blocks 4%, a town's 12%, on its own dice after the shops); never a regional mall (too big for a block).
- **AI parity**: other groups and your headless crews go through a mall shop by shop: poicont.js `poiHouses` counts the mall's buildings (mall.js `mallUnits`, cached), so the pool falls that many times slower, container by container, as on its map.

## Prisons and county jails as places
The user's request (2026-10-25, issue #31): "add … prisons max of 400x400". The maps are in [combat.md "Prisons"](combat.md#prisons).
- **The prison site** (data.js `LOCATIONS.prison`, mapgen.js: one on a Normal map, two on Large and Huge) is a state prison or a maximum-security penitentiary by its own dice (prison.js `prisonKind`, 35% maximum security). Its raid opens one complex: `siteBuildings(tile, state)` gives the one option `prison`, so no building is picked. The headless search and the other groups' raids read the site's loot as before.
- **The county jail** (new `LOCATIONS.jail`, "County jail", danger 2, richness 0.6, town; its world-map sprite is the police station's) is a point of interest. Every town has one on the tile of its suburb ring that the dice pick (pois.js `jailTile`: the lowest hash among the ring's tiles that can hold POIs). It comes after the campsite and before the shops (`jailExtra`, `extra: "jail"`). Its tile's own list is one shorter, so the jail keeps its place among `POI.MAX`. It is known where its tile is in the known zone. A raid on it (poiraid.js `poiPlace`, `SITES.jail`) opens the jail and its pods. The jail's finds alias a prison's (loot.js).
- **Older saves** (worldcfg.js `legacyPrisons`; save.js marks a save with no `state.prisonV`): no jails, and a prison keeps its pick of one building.
- Tests: `tools/prisontest.js` (a jail by every town, the jail's raid), `tools/poitest.js` (the jail extra), `tools/shopstest.js` (never over 4 places).
## Air bases

- **Air bases** (issue #25, the user's request 2026-10-25: "yes open a ticket for the military buildings bases, airports, air bases, etc that fits too"): a location type of its own, `airbase` (data.js `LOCATIONS`: "Air base", ✈, special, danger 3, public; fuel, ammunition and parts; military gear, flares, chest rigs). Its buildings (buildingmaps.js `SITES.airbase`): two hangars of aircraft, the control tower, flight operations, barracks and a mess hall, laid out as [combat.md](combat.md#raids-into-building-interiors) says; its street map's areas `AREA_SETS.airbase` (a hangar, a barracks, an armory, a warehouse); its finds by the military, guns and crash themes (loot.js `SITE_TAGS`), its guns from the military's bands (gundist.js, itemcond.js), its locks (locks.js: a hangar key), a raid map of the Large class (battlesize.js), its map sprite (ui/mapsprites.js `paintAirBase`: an olive hangar, a grey fighter, a tower).
  - Where (mapgen.js, at the end of the land's making): some of the military sites are air bases, one in six of them and never the first (a Normal map's 11–12: two; Small one; Large three), picked by hash dice of the tile, so nothing else on the map changes; named "<nearest town> Air base". They stay in `state.militaryIds` (military sites: the soldiers' dead, the groups that hold a base); Custom's "Military sites" count includes them (one once it asks for two or more). Crashlanding's unit falls back only to a Guard base (crashstart.js).
  - Test `tools/interiortest.js` (air bases on generated maps at a sensible rate; the site's buildings).

## Universities and colleges
Issue #28 (the user's request 2026-10-25: "Add college campus maps that are max 500x500 with connected and disconnected buildings courtyards and dorms").
- **The university** (`univ`, as before: one in the first city, "<City> University") is a campus now: its site opens one campus map (buildingmaps.js `SITES.univ = ["campus"]`), a state university three times in four, else a liberal arts college. An older save's university whose lab, offices or cafeteria a raid already went into keeps that choice of buildings (`SITES_LEGACY`); one nobody raided becomes a campus.
- **The college** (`college`, new: data.js `LOCATIONS.college`, "College", glyph Co, town, danger 1, public; parts, meds, scrap, food; a bag, a bat, a fire axe): mapgen.js gives `COLLEGE.P` 12% of the towns one, two or three tiles out on land with no site or hive, on hash dice of the town laid after the town rings (every other draw of a seed's map is as it was). Named from `COLLEGE_NAMES` (campus.js) after the town or from the list ("Granite Valley Community College", "Ashby Technical College", "Prairie View College", "St. Augustine College", "Whitcombe College"), never a name another site has; `COLLEGE.COMMUNITY` 55% are community colleges (`tile.loc.campus`), the rest liberal arts colleges. About 15–20 a Normal map. Its finds (loot.js `SITE_TAGS` school, office, tech, books, sport; `SITE_FINDS` phones, laptops, consoles), its books (skills.js), its locks (locks.js: a maintenance key, a safe), a raid map of the Large class (battlesize.js), its street map's areas (`AREA_SETS.college`), its map sprite (the university's, ui/mapsprites.js).
- The campus itself, its buildings, links, quads, dead, loot and scenes: [combat.md "Campuses"](combat.md#campuses). City crawls never get a campus (too big for a block).
- The POI rules: a campus is its site POI's one map; the ledger keeps each building's containers apart, and the headless search and other groups' raids take from it a building at a time (poicont.js `poiHouses`).

## Hotels and their chains

The user's request 2026-10-25 (issue #29 of the interiors epic #7): "add hotel 200x200 max". A new site type `hotel` (data-shops.js `NEW_KINDS.hotel`: LOCATIONS "Hotel", glyph "Ht", danger 2, richness 0.6; its raid rooms, tags and map size merged like the shops'), four kinds by its chain, its building and map in [combat.md](combat.md#raids-into-building-interiors) ("Special buildings: hotels"). Tests `tools/hoteltest.js` (the rates over 300 seeds, the crawl, a raid on each kind), `tools/interiortest.js` ("Hotels room by room").

- **The chains** (`FRANCHISES.hotel`, fictional; `plan.hotel` the kind, `plan.fl` the guest floors' floor, `look` the map sprite's colours and the lobby's wall; `w` by setting, `w.scenic` in scenic land):
  - roadside inns: **Willow Creek Inn** (town 1, suburb 0.4), **Old Mill Bed & Breakfast** (town 0.9, suburb 0.2);
  - business hotels: **Interstate Inn & Suites** (suburb 1, town 0.7, city 0.5), **Meridian Business Hotel** (city 1, suburb 0.8, town 0.3);
  - resorts: **Pinecrest Lodge Resort** (scenic 1, town 0.12), **Lakeshore Grand Resort** (scenic 0.8, suburb and town 0.08);
  - city towers: **Calder Grand Hotel** (city 1), **Harbor View Tower** (city 0.8).
  - Since issue #38 (2026-10-25, the user's "every building should have several varients" and "for buildings with no to only a few varients create a dozen varients per building type"), a chain a kind more, so a dozen variants a kind have chains to carry them: **Timberline Lodges** (inns: town 0.6, suburb 0.1), **Keystone Suites** (business: suburb 0.8, town 0.5, city 0.4), **Sundance Resorts & Casino** (resorts: scenic 0.6, town 0.06, suburb 0.05), **Pinnacle Tower Hotels** (towers: city 0.7). Twelve chains; the kinds where they stood before (no inn or resort in a city block, no tower in a town, only resorts in scenic land).
- **Each chain's variants** (issue #38; `plan.variants`, the variants of data-hotels.js `HOTEL_VARIANTS` that fit it, 5–8 a chain, every variant in at least one): a hotel POI's variant (`poi.hv`) is drawn by `hotels.js hotelVariantOf` from its chain's list, weighed by the setting (`HotelVariant.w`: a boutique hotel or a convention-centre hotel downtown, a budget box or a highway inn & suites in the suburbs and towns, no dude ranch in the suburbs), on dice of its own (`hash01(seed, "hotelvar", tile)`) after everything else, so the POI's other fields and every other list are as they were. Its name shows it: `pois.js poiName` "Willow Creek Inn (Victorian B&B)"; `poiraid.js poiPlace` hands it to the building as `plan`. A crawl hotel draws its variant the same way (`place.hv`, `hash01(seed, "crawlhotelvar", tile, cell)`, by the crawl's city, suburb or town setting; `citycrawl.js placeOption` passes it as `plan`, unless the block's snapshot kept another chain). A hotel POI made before the variants (no `hv`) keeps its kind's classic plan, #29's, cell for cell. The plans: [combat.md](combat.md#raids-into-building-interiors) ("Hotel variants"). Test `tools/hotelvarianttest.js`.
- **As points of interest** (hotels.js `hotelExtra`, from pois.js `generatePois` last, on dice of its own after the shops, so a world's lists and a save's changes to them stay as they were): a tile holds a hotel at `HOTELS.AT` by its setting (`hotelSetting`: shops.js `settingOf`'s city block, city suburb or town ring; else **scenic land** on or by a road: forest, hills, a mountain, or any land by water): a city block 9%, a city's suburb 6%, a town's ring 4.5%, scenic land 0.6%; never past `POI.MAX` (4), never two on a tile, never beside a site it would out-rank; known in the known zone `SHOP.KNOWN` of the time (a survey finds the rest). Its chain by the setting's weights: a town's 62% inns, 32% business hotels, 6% resorts; a suburb's 73% business hotels, 24% inns, 3% resorts; a city's 54% towers, 46% business hotels; scenic land's resorts only (tools/hoteltest.js over 300 seeds: 9.1%, 5.9%, 4.6%, 0.6%). Three generated worlds held 285 hotels (town 158, scenic 72, suburb 36, city 19: city blocks are often full). Its building: buildingmaps.js `SITES.hotel` (poiraid.js `poiPlace`: the chain's name and layout).
- **In the crawl** (hotels.js `hotelPlace`, from citycrawl.js `genBlock` after the shops, on dice of its own): a block with room for one more place (`CRAWL.PLACES[1]`) holds a hotel at `HOTELS.CRAWL` (a city's 7%, a town's 6%, +1.5% a block deeper, at most 15%; measured 7.9% / 9.1% / 15.4% at blocks 1, 3, 6 of a city); its place's richness 1.05 and its dead 1.2 (`HOTELS.PLACE`); its chain the crawl's (shops.js `crawlFranchise`: downtown 55% towers, 45% business hotels; a town's 60% inns, 34% business hotels, 6% resorts). Its upper floors hold survivors or raiders (floorfolk.js: the penthouse first).
- **The map sprite** (ui/mapsprites.js `paintHotel`, by the chain's kind in its colours): a gabled inn with its porch and sign, a business hotel's slab of windows and porte-cochere, a resort's long low lodge with the pool in front, a tower with its crown and sign.
- Modules: [hotels (`hotelVariantOf`), hotellayout, data-hotels, data-shops, pois (`poiName`), poiraid (`poiPlace`), citycrawl genBlock and `placeOption`, shops franchiseFor, buildingmaps SITES; ui/mapsprites].

## POI surveys and the per-POI raid flow
Survey and Quick look find and rate the places on a tile; a scavenge or raid goes into one POI at a time.
- **Survey** (8h, the team's own tile, one roll at the end, the ring of tiles with optics that reach; stamps "surveyed" and a perceived threat on every place known) and **Quick look** (2h, the kind only; the old Look around, a recon's look too) [survey `LOOK`, `fullSurveyDone`, `quickLook`; parties `MISSIONS.fullsurvey` / `survey`; orders task `fullsurvey`; fieldheat ACTIVITY].
- **Per-POI threat**: true = danger + infection + heat + hive land; the estimate is a word with skulls that goes stale; the picked-over bands [pois `poiThreat`, `poiThreatEstimate`, `poiBand`].
- **One POI at a time**: a scavenge or raid on a tile with places goes into one POI. The dialogue card in the browser; a site with several buildings lists each building and the street so one pick goes straight in [poiraid `poiPickCard`, `poiRaidSetup` building]; picked with no building (or a tile without places that has buildings), a card asks which before the raid map is made, never on it (the user's request 2026-10-25: [the building picked before the raid map](combat.md#the-building-picked-before-the-raid-map)). The best known one for the autopilot, crews and tools; a search that strips one moves on to the next; the POI's building is the raid map; its own pool; raiding a place on another group's base tile is hostile [poiraid, scavenge, ui/poipick; combat `createRaid` richness and areas].
- The autopilot sends POI surveys [survey `poiSurveyCandidate`].
- On the map a team on a Survey or a Quick look walks out from its spot and back, glasses up out there, a ring filling over the spot (the user's request 2026-10-26: [out on an order](economy.md#a-team-at-a-gathering-order-on-the-map)) [ui/render, ui/mapfigures].

## Walking to a POI
Each place on a tile is 5–20 minutes' walk away, shown on a map of the tile; the team walks there, and leaves the tile by an edge.

The user's requests 2026-10-22: minutes to each place on the tile, 5 to 20, unpause to see the walk, then the raid; raid again and the minutes are from where the team is; a small map of the tile with the places, a dot on the edge the team came in by, the distances drawn, decorations, the list a side panel folded by default. Module [poiwalk]; test `tools/poiwalktest.js`.

- **Distances**: every POI has a spot in its hex by hash dice (the top POI near the middle, where its sprite is drawn; others 0.45–0.75 out). Minutes on foot are the cheapest way over an 11 × 11 weighted map of the hex (cost a cell by terrain × its own dice, a road across the tile cheaper; Dijkstra): 5 + 1.25 a cell of cost, clamped to 5–20, route kept [poiwalk WALK, poiSpot, poiWalk, walkMap].
- **Start point**: the place it last went into (p.atPoi), else the edge it came onto the tile by (p.entered, noted as it steps on: parties.js stepAlong; WALK.EDGE toward that neighbour), else the middle [poiwalk walkFrom, edgeSpot].
- **The dialogue** is a map of the tile (ui/poimap.js): ground drawn once per tile and season from the State Map's own decals by terrain, water on the sides that touch it, roads out by its roadLinks, no grid; routes dashed with minutes, the team's dot, each place's map sprite with name and minutes, a button (data-action "poisel"). The picked place's details beside it with the walk button (a site's: one per building and the street); the list of places folded at the side (data-action "poilist"; card.poiPick.sel / .list) [ui/poipick, ui/poimap tileMapBg / poiMapSvg, terraindeco drawDecal, main.js poisel / poilist].
- **The walk**: a pick starts a task "poiwalk" of its minutes; the clock stays stopped ("Ready to walk to …", main.js choice).
- **Tile view** (the user's request 2026-10-22: the walk shown on the POI map, the State Map's team in the middle of its tile like normal): keeps the tile map up while it walks, never stopping the clock: the route lit, the team's dot moved every frame by the clock's minutes, minutes left, Run / Pause, Stop the walk, Close; Space runs the clock under it (ui.tileView; ui/poipick tileViewUp / tileViewModal / tileViewFrame, ui/ui pickModal "tileview", main.js tv-close / tv-stop). The State Map keeps the team in the middle with a "To … 4m" pill [ui/render walkPos].
- **Leaving** (the user's request 2026-10-22: a button to leave, the time from where the team is to the edge it leaves by): an arrow on each side of the map (the card's exit choices) and "Leave for another tile…" (the State Map's move mode, ui.moveExit; pickMove → startExitWalk, the side its way leaves by). The team walks to that edge (exitWalk: the weighted map's minutes, 0 if on that edge) as a "poiwalk" with exit { via, dest }, shown in the tile view and on the State Map, then sets off with half the first step behind it (parties.js headStart) [poiwalk exitsOf / startExitWalk / leaveNow, poiraid poiPickCard exits, ui/poimap exitArrow].
- **Arrival**: at its minute (orders.js tasksDue) the team stands at the place (p.atPoi) and the raid starts (poiWalkDone → giveOrder scavenge). The place it stands at is "here" (straight in).
- Only the player's pick on the card walks; the autopilot, crews and tools go straight in.

## Tile heat and persistent POI containers
Heat builds per tile, and a POI's containers keep their contents between visits.
- **Tile heat**: persistent per tile (going into and out of a POI by approach and shots, others' raids; 10% a day off). Raises every POI's true threat and the raid roster; when hot it brings a horde or a wandering band. Seen as a stale-able stamp in the tile panel and POI dialogue [pois `TILE_HEAT`, `tileHeat`, `addTileHeat`, `tileHeatDaily`, `noteTileHeat`, `tileHeatEstimate`; scavenge `raidEnemies`, `heatSurge`, `searchExitHeat`; ui/poiview, ui/poipick `heatLine`].
- **Containers that stay**: a POI's raid map is the same every visit; each container rolls its contents from its own dice (seed, tile, POI, map, id). The ledger `poi.cont` keeps what your side opened as it was left (contents, hidden rest, lock) on every raid end, marks containers others ransacked in a seeded order as the pool falls, and lets abstract raids take what you left [poicont `poiRaidStart`, `poiRaidEnd`, `syncLedger`, `lootPoiAbstract`, `ledgerSummary`, `boxRng`, `poiMapRng`; combat `createRaid` / `searchBox` R.poiDice; locks; scavenge `afterRaid` / `searchHour`; poiraid `poiContainerNote`; ui/codex "Containers that stay", "Tile heat"].
- **Your headless search takes back what you left** (issue #45, 2026-10-26): each search hour goes through your containers on the hour's share (hash dice), and once the place is picked over (`PICKED_OVER`) everything you left in yours comes away before the team moves on, with the log line "From what was left in a container here before" [scavenge `searchHour`, poicont `lootPoiAbstract`] `tools/poicontainertest.js`.

## Other groups survey and raid POIs
Every other group knows, surveys and raids POIs on its own knowledge, through one picker and the shared container ledger.
- **Knowledge**: every group, outsider band and hardcore band keeps its own. The known zone's places within reach of where it lives are seen without a survey; hidden ones only through its own survey (8 hours on the tile with the player's Survey odds and the group's Scouting) [grouppois `groupPois`, `groupKnowsPoi`, `groupSees`, `groupSurveyTile`, `groupWouldSurvey`, `groupHiddenGuess`].
- **One picker** for every holder, by need × what is left, with survey stops on tiles they may find more on [grouppois `groupTargets`, `bestGroupPoi`, `kindValue`].
- **One raid** through the container ledger (pool, ledger, your left items, tile heat), the haul by the POI's kind, log lines for a POI stripped or your things taken [grouppois `raidPoiAsGroup`, `poiNews`; aiscav `haulFor` kind].
- **Scavenging parties** go for one POI at a time (a survey stop shown on the map, the next POI when one is picked clean, `q.poi` for "being raided now"). Your team in a different POI on the same tile: no conflict; the same POI: the contest card; at war: either way. They wear down their own land's POIs [aiscav `bestSite`, `sendParty`, `scavSearchHour`, `teamPoi`, `landPoiTiles`].
- Outsider raiders survey and raid POIs; explorers pick through a site's [visitors `raidTargets`, `searchSite`].
- Hardcore bands raid their camp's POIs after a survey; the hardcore start doubles every POI pool [hardcore-groups `bandDay`, hardcore-loot].
- The pacing report [tools/poipacingtest]; the codex's "Other scavengers" [ui/codex].
- Issue #45 (2026-10-26): the pacing report runs 4 years by default (`--years N` for more; the checks read years 2 and 4), about 15 minutes for Normal and Large in parallel since the map sizes of 2026-10-24. Its near-base target is read round the bases that have stood a year (the bigger maps' groups found a new base or outpost every few weeks, so most of the near zone of the day is fresh): Normal seed 42 24% → 43% → 55% → 57% Little or Picked clean, against 11% → 27% → 33% → 36% round every base of the day. The groups' take was not re-tuned.

## City crawl
Block-by-block roguelike extraction in a city or town, with multi-storey buildings and who lives on each floor [citycrawl, floorfolk]. Design: [docs/multi-storey-crawl.md](../multi-storey-crawl.md), [docs/crawl-balance.md](../crawl-balance.md).

- A round grid of blocks: start at any rim block; go north, east, south or west from every block.
- Getting out: walk back to any rim block and out from there; at a high Alert walking out is a breakout.
- Multi-storey buildings with who lives on each floor (survivors barricaded upstairs, raiders holed up) [floorfolk].
- **Stair runs** (the user's request 2026-10-25, issue #9: "Make the layouts make sense"): a stairwell is a straight
  flight against a wall with a landing at each end, drawn as steps rising toward the floor above. Details below.
- **Buildings at real size, towers to 10 storeys** (the user's request 2026-10-25, issue #24): a crawl's buildings are
  their real size (a city's hospital 60–100 m across, its towers 6–10 storeys), each building's map as big as it needs
  (up to 300 × 300); only the first 4 floors of a taller building are built (5 from the deeper blocks), its stairs up
  from there collapsed or barricaded. Details below.
- Test `tools/citycrawltest.js`; the stairs `tools/storeytest.js`; the sizes `tools/scaletest.js`.

### Buildings at real size in the crawl (issue #24, 2026-10-25)
The user's request 2026-10-25: "All buildings should scale based on how large buildings are in real life with unique layouts and 1 to 3 stories tall and city buildings can be 10 stories tall make the raid maps larger if needed up to 300x300", and "to prevent needing to make really tall cities just block off or have destroyed stairs to prevent going to higher stories though they dont actually exist". The rules are in [combat.md "Buildings at real size"](combat.md#buildings-at-real-size-issue-24-2026-10-25) and [docs/multi-storey-crawl.md](../multi-storey-crawl.md#up-to-10-storeys-the-floors-above-blocked-off-issue-24-2026-10-25).

- **The setting**: a city crawl's buildings are "city" (buildingmaps.js `settingOf`: the crawl's tile is the city's), so offices, apartments and a hospital stand 6–10 storeys; a town's crawl "town" (2–4, 3–6). The depth bonus (`STOREY_BONUS`: +1 from block 4, +2 from block 7) adds to the height, within 10, and one more floor is built from block 4 (`openStoreys`).
- **The block card**: the hint says the floors open and the height ("Office building: 4 floors open of 9, offices", citycrawl `placeHint`, `placeHeight`); the tip under it that the stairs above floor 4 have collapsed or been barricaded. `placeStoreys` stays the floors built (who lives on which floor: floorfolk, the Look around).
- **The maps**: a place's building map is its footprint plus margins, at least the run's largest raid map dial, at most 300 × 300; the dead inside go by its floor area (`deadK`, at most 120 a group), its containers as full as a small building's (`R.natMap`), the quick search's the same (`placeProfile`).
- **Snapshots** are packed floor by floor (citycrawl `packCells`: each distinct cell once, runs of them): five big buildings left as they were add about 100 KB to a gzipped save (`tools/bigmapbench.js --save5`).
- **Other groups** strip the city's buildings no faster an hour, but they hold more (aiscav.js `siteSizeK`: a city 2.4 times what it did; docs/adr/0001-ai-parity.md).
- **The balance gate** (`tools/crawlbalance.js city --depth 2,4 --squad early,solid,rifles --trials 20`, [docs/crawl-balance.md](../crawl-balance.md)): 6 of 6 rows inside their targets before and after (2026-10-25). Every squad still comes out (100%, none wiped); losses within 3 points of before (depth 4 rifles 17% → 21%); loot value within 10% (depth 2 solid 241 → 227, rifles 272 → 244; depth 4 rifles 377 → 376); hours the same (8–20).

### Parity with the raid tickets (issue #21, 2026-10-25)
The user's request 2026-10-25 (the interiors epic #7, its last ticket): "I want the interiors of buildings during raids and crawls to make sense. […] Improve the building, furniture, appliances etc fidelity for raids and crawls." The crawl keeps up with what the raid tickets added (#8–#13, #18).

Modules: [citycrawl `snapshotBuilding` / `restoreBuilding`, `placeOption` (`scenes`), `pickedOver`, `CRAWL.LOOTED`, `crawlPieces`, `carryLine`, `carryPace`, `keepPairs`, `leavePiece`, `takeLeft`, `notePieces`, `piecesHide` / `piecesBack`, `rimExitPieces`, `CRAWL.CARRY`, `placeHint`, `placeProfile`, `quickLoot`, `quickSearch`; interiorscenes `rollScenes(map, rng, key, place)`, `sceneBias`, `SCENES.PLACE`; floorfolk `pileAgainst`, `boardWindows`, `FOLK.BARRICADE`; combat `boxFinds` (out of `searchBox`); buildingmaps `buildingHint` (`sig`); ui/citycrawl (the Carrying line, Left here / Take up, the hint line)]; test `tools/citycrawltest.js` section 10.

- **Snapshots keep everything** (`snapshotBuilding` / `restoreBuilding`): every floor's cells are copied whole (`structuredClone`, nothing shared with the battle either way), so blood (`c.blood`), spent brass (`c.brass`), decor and wall art (`c.deco`, `c.wart`, `c.wc`), a piece shoved, battered or set down (`c.moved`, `c.hp`, `c.frame`), boards (`c.boards`, `c.under`), a cell a piece was lifted off (open floor) and the stair cells (and `R.stairs`, the stair runs of #9) come back as they were left; the containers with their contents (ground piles, a lifted piece's emptied record `box.lifted`), the bodies by floor (`b.corpses` with `f`), the scenes and who holds the floors likewise. The test walks out and back in and checks each field, and that every floor's cells are byte for byte the same.
- **Scenes by the place** (interiorscenes `sceneBias`, `SCENES.PLACE`; citycrawl `placeOption` passes `option.scenes`, buildingmaps `buildingMap` hands it to `rollScenes`): the place's `dead` makes signs of survival likelier (odds × (1 + 0.5 × (dead − 1))) and overrun rooms and last stands more so; `raiders` a barricaded room (× 1.6); people upstairs (`folk.survivors`) a scene at all (at least 85%) and a barricade (× 2); a rich place a quiet death; a picked-over one fewer quiet rooms. Rolled once with the building's own dice and kept by the snapshot; everywhere else (`place` null) the roll is as it was.
- **A place picked over** (`pickedOver`, `CRAWL.LOOTED`), the first time its building is laid out on a crawl: each container (not bodies, piles, the raiders' stash, the survivors' own) is found stripped at `looted × 0.6` (`box.stripped`, empty contents), and from 30% picked over one barricade of its scenes is broken through (barricade `breakBoarded`, `breakPiece`).
- **Raiders' barricades up** (floorfolk `holeUpRaiders` → `boardWindows`, `pileAgainst`): their room's outer windows boarded (up to 3, `boardCell`) and half cover dragged up beside its doors (2, `setPiece`); recorded as `R.folk.raiders.fort`. **Survivors' furniture** (`barricadeSurvivors` → `pileAgainst`): two pieces beside their barred door inside the room (`R.folk.survivors.pieces`), never on the cell straight through a door, never in a room less than 2 cells across. A room a scene left boarded up is cut off from the reach `placeOccupantGroups` places by: the survivors are put inside it (that room is the one they prefer: `area.scene.alive`).
- **A piece carried block to block** (#12, #18): whoever comes out of a place with a piece in the arms carries it on (the item in `s.gear.carry`, marked `it.crawl` by furnihome `piecesAtExtraction`; a piece carried in from the road keeps the road's rules); the other end is kept on the crawl (`c.mates`: the battle's tether, or `it.mate`, which `piecesAtExtraction` notes before it ends the tether: `notePieces`). The HUD says "Carrying: a refrigerator (Dana, Lee)" (`carryLine`). The block's walk takes `MOVE_HOURS` × the slow factor (the unladen pace, `CARRY.BANDS[0].mob` 5, over the slowest carrier's mob as carrykit `weighPlayer` weighs them with the piece: its band and `LIFT.CRUSH`), rounded up, at most 4 h (`carryPace`): a fridge between two 2 h, alone 3 h. Both of a pair must be on the team: the other end gone, a `"two"` piece is left on the block (`keepPairs` → `leavePiece`: the city remembers it, `mem.left[cell]`, and the block card lists it under "Left here" with **Take up**, `takeLeft`), a `"one"` piece goes on alone. Going into a place it stays in the arms at the entry, the two side by side and tethered (`piecesHide` keeps it out of carry `stageLoads`, `piecesBack` gives it back); with the dead or raiders within 8 cells of the door (`CRAWL.CARRY.fightRange`) it is set down at the door first (furnicarry `dropPiece`) with a log line.
- **Out at the rim with a piece** (`rimExitPieces`, the one place the crawl meets #18's extraction rule): the vehicles wait at the entry block; out at that block with them, furnihome `piecesOut` (into the vehicle, else dropped from exhaustion, #18's message); out at any other rim block it is dropped there from exhaustion ("Exhausted, the team dropped what it was carrying: a refrigerator. It stands on Main Street at the edge of the city, far from the vehicle: a later crawl can take it up again.") and the block remembers it (`mem.left`), not lost. The crawl's closing line carries the loaded pieces and the message (`finishCrawl`).
- **The hint line** (`placeHint`): the kind, this place's storeys (`placeStoreys`, from the layout tickets' `buildingSpec`) and the kind's signature rooms from its archetype (buildingmaps `buildingHint(key).sig`: a sample plan's rooms with their counts; the most numerous first, then the first single ones; corridors, restrooms, storage and the like left out unless the kind is made of them): "Hospital: 4 floors, wards, a pharmacy", "Office building: 7 floors, offices, a shop".
- **Quick search parity** (`placeProfile`, `quickLoot`): the headless search goes through the place's own building (the map `buildingMap` lays out for it, built once and kept on the place as plain data: its containers by room type, kind and floor, the site's reward, the worthiest `"one"` piece) and opens `QUICK.rolls` (+ `rollsPerBlock` a block deeper, × (1 − 0.6 × looted)) of its containers, each rolled as `searchBox` rolls it on the map (combat `boxFinds`, extracted from `searchBox` with its dice in the same order: the piece's or the room's table, the richness × the floor's, the reward, the deep shift). A building the team has been in: only what it left unopened. Decision: the ticket's "the same loot totals" is read as per container opened (the test: every kind within ±10% over 200 buildings, a quarter of them laid out and searched on the map); the number opened stays the quick search's own, so the map is still where the rewards are (the old design note), and the balance gate holds. The extra finds `searchBox` rolls on their own dice (books, gun parts, reloading, grenades, launchers, tents, power) stay the map's. The old deep-loot cache roll stays as it was. **Pieces**: none on foot (#12 rule 8); with the team's vehicle waiting at the rim, the worthiest `"one"` piece of the place, once a place (`place.pieceTaken`), goes out to it (`c.atVehicle`, into the cargo when the team walks out; the building is not changed: abstract).
- **Hive crawl**: unchanged (the test asserts `hivecrawl.js` imports none of furnicarry, interiorscenes, floorfolk).
- **Balance gate** (`node tools/crawlbalance.js city --depth 2,4 --squad early,solid,rifles --trials 20`): before and after in the issue comment; every row inside its targets.

### Stair runs (2026-10-25)

> Create tickets […] to improve the interior layouts, staircase, appliances, furniture, decor […] Make the layouts make sense.

- **The run** (buildingmaps.js `assemble` `pickRuns`; helpers `runSteps`, `runTop`, `runLandings`, `stairTop`,
  `stairWaits`, `STAIR_DIRS`): 2 steps, 3 in a hospital, school, office tower or apartment block (`spec.stairs.len`;
  shorter where the room is too short), with a 1-cell landing at the bottom and the top. It lies along a wall of its
  room, parallel to it, with a free lane of the room beside every step. Recorded as `b.raid.runs[i] = { x, y, dx, dy,
  len, f0, f1 }` (x, y the bottom step, dx, dy one step up). The steps are `stairs` cells on every floor with `c.dir`,
  `c.step`, `c.len` and `c.top` on the top step; the landings are walkable floor with `c.landing`.
- **The top step changes floor**: Go up / Go down only from there (combat.js `stairOptions`; elsewhere on the run:
  "Climb to the top step first"). Position stays, so you arrive on the top step a floor up with the upper landing next
  to it. `b.raid.stairs` keeps the top steps as `[x, y]`, so the bots, the dead's drift, the allies' retreat and the
  crawl's restore work unchanged. The issue asked for the runs in `b.raid.stairs`; they went into `b.raid.runs` so the
  dozen callers that read `[x, y]` and older saves keep working.
- **By building kind** (`spec.stairs` on the archetype): a house's from the hall, else the front room, by the front
  door; a shop's, a big store's and a car dealer's from the back rooms (`BACK_STAIRS`) to the flat or floor above;
  apartments and offices in a stairwell room of their own (role `stairwell`, 2 wide, one door on each floor, the run
  against the far wall and the lane by the lobby or landing), at the same place on every floor; a hospital's and a
  school's one at each end of the main corridor (`ENDS`); a police station's and a fire station's from the lobby or day
  room (one run); a motel's an outside concrete stair along the office's side wall, up to a door onto the walkway.
  Other multi-storey kinds use the hubs as before, two runs from 220 cells of footprint. A church stays one storey; no
  basements, cellar doors or attic hatches.
- **Doors**: no door opens onto a step (outerDoor, innerDoor skip those cells; a last resort only if a room would
  otherwise be shut off). An office tower's front band is now at least 5 deep so its stairwell fits a run of 3.
- **The one-cell fallback**: a footprint with no room for a run keeps the old one-cell stairwell at a hub's centre
  (`run.single`); the raid's opening lines say so. No generated multi-storey type needs it today.
- **The dead on the stairs**: `BMAP.STOREY.dead.stairs` of a floor's dead still wait by a stairwell, now on the landings
  (then next to a landing), never on the steps. Watchers on the floor below do the same.
- **AI parity** (floorfolk.js `landingPiece`): survivors barricaded upstairs and raiders holed up upstairs shove a table,
  cabinet or crate onto the top landing of a run on their floor (barricade.js `FURNITURE` hit points; half cover a person
  vaults and the dead crawl over), only where the floor stays connected round it. A stairwell room's door is left
  alone so the floor is never cut off from the stairs.
- **View** (ui/isoview.js `primsOf` `stairs`): each step cell draws two treads of its share of the storey, the top step
  reaching the floor above; a railing (posts and a handrail) on the open side; a motel's in metal; on the top floor the
  run is a dark opening down under its railing. The ▲▼ tag marks only the top step. PageUp / PageDown are unchanged.
- **Older saves**: a mid-raid save with one-cell stairwells has no `b.raid.runs` and no `c.step`; every stairs cell
  still changes floor. A building snapshot (citycrawl.js `snapshotBuilding`) now keeps `stairs` and `runs`; an older
  one restores its own one-cell stairwells from its cells (`restoreBuilding`).
- Tests: `tools/storeytest.js` (every multi-storey type has a run against a wall, its steps on every floor it joins,
  the landings walkable, every room reached from a landing, no door onto a step; walking up a hospital's and a house's
  run; an older save and an older snapshot).
