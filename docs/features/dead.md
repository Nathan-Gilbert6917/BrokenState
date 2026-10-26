# The dead, hives and hordes

Detail for section 8 of [docs/agents/features.md](../agents/features.md). `[name]` is `prototype/src/sim/name.js`; `ui/name` is `prototype/src/ui/name.js`. Crawl docs: [docs/multi-storey-crawl.md](../multi-storey-crawl.md), [docs/crawl-balance.md](../crawl-balance.md).

Contents: [Bosses on 2 × 2 cells](#bosses-on-2--2-cells) · [Hive crawl](#hive-crawl) · [Hordes](#hordes) · [Special dead and the dead beasts](#special-dead-and-the-dead-beasts) · [Attacked alone (2026-10-19)](#attacked-alone-2026-10-19) · [The counter-dead](#the-counter-dead) · [The Digger's tunnels](#the-diggers-tunnels) · [The pool of the dead widens with the years](#the-pool-of-the-dead-widens-with-the-years)

The dead on the land (how many there are per tile and per POI, their caps, kills, reinforcements and the daily recalculation, issue #65): [travel.md](travel.md#the-dead-on-the-land-tile-and-poi-populations); their spread between tiles out from the towns, cities and hives (issue #66): [travel.md](travel.md#spread-between-tiles).

Hunt the dead (a team order to sweep its tile's open ground, Attack on a small map or Retreat, every kill off the tile's count; the governor and the groups hunt their own land, issue #68): [travel.md](travel.md#hunt-the-dead).

## Bosses on 2 × 2 cells
The two boss dead take 2 × 2 cells.
- The Broodmother and the Hivemind stand on 2 × 2 cells (`defences.js` BOSSES size; `combat.js` unitSize / unitCells / nearCell / coversCell).
- The footprint blocks all four cells and answers `unitAt` on any of them. Distance for shots, melee reach and blasts goes by the nearest cell; sight by any cell; the figure and its ring by the centre.
- The Hivemind's own throws-at-it targeting and its brood's spawn window go by its heart (the centre cell, the old one cell); the flames on it and the lash by its edge.
- Modules: [combat, defences, hivecrawl; ui/isoview, ui/battlehud].

## Hive crawl
The raid down into a hive, chamber by chamber.
- Chamber by chamber down to the Hivemind through a round grid of chambers, each open on 3 sides with 1 wall (a hallway with a room off the side).
- Four mouths, one on each side, to pick from and walk back out by. The core deep in it, open on 1–2 sides; the beat through the walls, the warmth along the passages [hivecrawl, citygrid].
- Listening at a passage (`hivecrawl.js listenAt`): the best listener's (Scouting + Stealth) / 2 + a d10 of the visit's own dice against `HCRAWL.LISTEN.dc` + `perLayer` × the chamber's layer; 3 over is exact, 0 over rough, −4 or under a fumble (Alert). The odds the window shows (`listenOdds`) count the d10's faces by the same comparisons (issue #63, 2026-10-26: they had counted one face short, 50% for an exact listen that is 60%). Test `tools/hiveplustest.js`.

## Hordes
Hordes are the hives' armies on the State Map.
- Roles (guard, build, attack, roam); hordes merge on the State Map [hordes].
- Drawn on the State Map as a crowd of the dead shuffling the way the horde drifts [ui/mapfigures mapHordeCanvas].

## Special dead and the dead beasts
The special kinds of the dead beyond the plain ones, and the worm's dead animals.
- Runners, brutes, spitters (acid pools), screamers, crawlers, elites, a Broodmother [zombietypes, acid]. Mid-game dead such as the Boneback [middead]. Carriers and worm swarms [carriers]. Armoured soldier and riot dead [deadsoldiers]. Sleepers among the bodies [sleepers].
- **The dead beasts** (2026-10-19): the worm's dead animals among the dead of the hills, woods and farmland (a dead stag, hog, dog and cow) and its dead pets in towns, cities and houses (dead dogs and cats).
  - Their bites carry the worm; most burst into a worm swarm when killed.
  - A horde crossing bad land picks some up. A raid's locked house may hold pets that come out at whoever opens the door. A team on foot meets them as a travel card.
  - Modules: [deadbeasts, hiveconst BEASTS; locks lockRaid / openLock; events "deadbeasts"].

## Bodies on every floor
The bodies lying about a raid's building, on every storey (issue #11, the user's request 2026-10-25).
- `sleepers.js placeBodies` spreads the map's bodies (as many as before) over every floor of a building with storeys (`b.floors`, each floor's reach; the zones and the keep-away from your people's start on the ground floor only); each body has `f`. `spotCheck` and `wakeNear` look only at bodies on the unit's own floor (and the active one); a spotted Sleeper stands on its body's floor; `ui/isoview.js drawCorpseIso` draws the active floor's.
- The scenes of a building (`interiorscenes.js`, [combat.md](combat.md#signs-of-survival)) add their dead to `b.corpses` (`scene: true`, with `f`), Sleepers among them at the battle's own share (`SLEEPER.ODDS + ODDS_INF` × the tile's Infection, at most `ODDS_MAX`), and their survivors as dead people (side `neutral`, kit survivors, `restored`: never counted as killed) with a body container each (`kind: "body"`, `f`, `full`): searched as any body, and a Carrier raises them (`carriers.js wormable`).
- Kept by the city crawl's snapshot (`corpses`: a split Sleeper stays split) and by a save mid-raid.
- Modules: [sleepers placeBodies, spotCheck, wakeNear; interiorscenes sceneBattle; citycrawl snapshotBuilding]. Test `tools/scenestest.js`.

## Attacked alone (2026-10-19)
A lone worker or walker set upon by the dead fights alone on the battle map or by the numbers.
- A worker on a job trip or one of a team on foot set upon by the dead or the dead beasts: the card "<name> was attacked by …" with Save and fight, Fight (the battle map with just that person and what they carry: combat `afield`) or by the numbers.
- The trip holds while it is fought; its end steers the trip.
- Modules: [loneattack, tripevents raiseCard / holdTrip / settleBattle, events "straggler"; ui/settings saveBeforeFight]. Crews: see [economy.md, Teamwork on job trips](economy.md#teamwork-on-job-trips).

## The counter-dead
The user's requests 2026-10-21. Modules: [counterdead, tunnels, hiveconst COUNTER / DIG / GROWTHS, hivetech, hives, defences, zombietypes]; test `tools/counterdeadtest.js`.

- Kinds a hive breeds in answer to the defences its hordes meet: tier 2 growths, grown only once the hive's read asks for them.

  | Kind | Growth | Counters | Rule |
  |---|---|---|---|
  | Digger | Tunnel mound | walls and trenches | tunnels.js (below) |
  | Melter | Melt pool | wall sections, gates, doors, barricades | its blows ×4 (combat.js UNIT_SIEGE melter) |
  | Husk | Husk bed | wire and spike pits | through them unhurt (counterdead.js trapProof from combat.js moveAlong) |
  | Tripper | Blast scar | mines | sniffs out mines within 6 tiles and walks onto them, 35% of a blast (tripperTurn, combat.js hitMult) |
  | Dark-walker | Gloom pit | light | a crawler's hiding that floodlight does not break; keeps off lit ground (zombietypes.js zRevealed, darkTurn) |

  The Climber answers walls too.
- **Adaptation**: each hive reads the bases it may attack, yours and the groups' by one rule (defenceProfile: walls, trench, wire, mines, light; adaptDaily from hivetech.js growthsDaily, noteDefences from defences.js atTheWalls) into hive.adapt. The read gates and weights the counter growths (hivetech.js growthWish) and the counter kinds' odds and shares in new hordes (counterOdds, counterMix from mixOdds / hiveMix; at most 12% a kind, 20% together).
- **Bred at a cost**: the hive pays ZTYPES breed resources for each (0.25–0.5; payCounters from hives.js buy), fewer when short.
- **By the numbers** each takes its part off the hold (counterCut, from defences.js holdLimit / defenceMult / spikeKill / minesTake / holdCheck, groupfight.js groupHoldCheck).
- **UI**: the log names the base ("The hive near X has begun breeding diggers": counterNews from completeGrowth); the tile panel shows a hive's read (hiveCounterText); the warning card the counter-dead in a horde (counterText); the codex and battle hover what each counters. Figures (ui/figures.js specialApp: spade hands, a hide, nose to the ground, the pale one), flat painters and growth sprites (ui/hivesprites.js).

## The Digger's tunnels
Diggers tunnel under walls; the tunnels stay on the base map until filled.

Modules: [tunnels; hiveconst DIG].
- **Digging**: goes down only on bare ground (open or bush cells floored dirt, grass or a field: diggable) and comes up only on bare ground, up to 8 cells away, under anything (walls, gates, buildings, wire, trenches, mines: nothing set off), 3 cells a turn, unseen (off the map: u.off, u.under), when the tunnel saves 4 moves of its siege field (diggerTurn from zombietypes.js zombieTurn).
- **The tunnel stays**: combat.js reachable and distField link its ends for the dead (tunnelLinks; 1.5 moves a cell); moveAlong sends one down it (crawlIn); tunnelRound (combat.js endPlayerTurn) brings them up at the far end. A blocked exit waits, then comes up beside it, never on an occupied, mined or unbare cell.
- Your people see the holes they have had in sight (ui/isoview.js) and can stand on one to keep the dead in.
- **On your base map**: a horde fight's open tunnels are kept on the base (settleTunnels from closeCombat; base.tunnels) and laid on every later fight and the base map view (layTunnels, the "baseDefence" layout) until filled.
- Diggers at walls that held (yours, a group's: atTheWalls dig) dig tunnels by the numbers, placed when a fight lays them. Each open tunnel takes 8% of the walls' hold (tunnelHold, at most 40%).
- **Fill tunnel**: a construction job, 4 + 2 work-hours a cell, put first, worked by builders (queueFill / finishFill, buildings.js BUILDINGS.filltunnel and constructionHour). Queued by clicking a hole on the base map (basemap.js layoutAct tunnel / fillTunnel / unfill; ui/basemap.js tunnelCard / tunnelList with Cancel). An alert while any is open (ui/alerts.js tunnels). The governor queues them (autoFillTunnels from autopilot.js governBase). A group fills 16 work-hours a day (groupFillDaily from groupworks.js).

## The pool of the dead widens with the years
The kinds of the dead met widen with the years, by place and era.
- Whatever the hives do [deadpool; hiveconst POOL].
- **Shaped by the place**: the era's kinds met exploring (shapeKinds / poolPlace from hivetech.js siteSpecials and citycrawl.js crawlKind): Climbers and screamers in cities; crawlers, runners and Diggers in the countryside; brutes, Bonebacks and Trippers round military sites; the counter-dead at half their share.
- **From day 60** the dead nobody bred grow a little a year (widenMix, merged in scavenge.js raidEnemies (raids, the places on a tile), conflicts.js and the city crawl's street): soldiers within 3 tiles of a military site, riot police in towns and cities, the dead beasts of the countryside.
- A hive's brood in a hive crawl gets the era's kinds it does not breed (broodWiden from hivecrawl.js broodTypes).
- All × the Zombie damage dial ^0.5.
