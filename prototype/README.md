# Broken State — State Map Prototype

A browser prototype of the design doc, built to answer one question: *is running a hub, sending teams across a dangerous state and dealing with other groups fun?* Scavenging and hub building are abstracted; fights play out as XCOM-style tactical battles.

## Run it

```bash
node server.cjs
```

Then open http://localhost:5173. No install step and no dependencies; only Node.js is needed.

Headless tools (no browser):

```bash
node tools/simtest.js 120 42 8
```

Runs 120 in-game days on seed 42 with 8 AI groups and prints a summary (for balance checks).

```bash
node tools/cardcount.js
```

Counts which event cards fire across five 90-day runs.

```bash
node tools/combattest.js 300 5
```

Runs thousands of tactical battles with the AI playing both sides and reports win rates per matchup.

```bash
node tools/conflicttest.js 120
node tools/conflicttest_cover.js 30
```

Conflict balance (six 120-day campaigns with a random-choice auto-player: conflict types, outcomes, conflicts per trip, captives) and coverage (forces every conflict type and option, rescue missions, and a 60-day captive soak).

```bash
node tools/supplytest.js 70
```

Supply runs: founds test outposts, runs repeat / one-off / hold / disband / recreate jobs and blocked cases for 70 days on three seeds, and checks stock moves and schedules.

```bash
node tools/medtest.js 30 42
```

Medical: hospital tiers through the build queue (one step at a time, upgrades replace the old tier), medic staffing, passive healing and bed caps per tier, treating at a base (meds used, heal per tier), field treatment with a team's carried meds, infected wounds, and a short campaign with a staffed clinic.

```bash
node tools/crafttest.js 30 42
```

Crafting: hand-craft gates (stock, skill, workshop), the craft queue (materials paid up front, crafters' work-hours, blocked jobs skipped, cancel refunds, queue cap), equipping makeshift gear, durability (fights, treatments, days) and breaking, water filters and crowbars at a base, field crafting from a team's supplies with the bandage kit in field treatment, 25 tactical battles with makeshift weapons, and a short campaign with a crafter.

```bash
node tools/invtest.js 60 11
```

Inventory: migration of old gear (backpack out of the tool slot, arm guards to the arms, old football pads + helmet split), equip / swap / unequip rules, pockets and packs (a pack carries its contents along), armor summed across worn pieces, carry limits (packs add carry space, a full cargo refuses items), looting bodies by hand and headless, leftovers at death sites, captives stripped, battles with and without extra armor, and a render smoke test of the inventory and loot screens.

```bash
node tools/etatest.js 12
```

Travel-time check: launches teams to varied tiles (on foot / by truck, each stance, full and low fuel), redirects them, runs queued orders (move → camp → treat → move), and boat crossings (on foot, truck on a raft, truck left on the shore, then a move on the far side); compares the estimated hours with the real ones. Trips without road-event delays must match to the hour, and the map's estimated position must reach the destination on the arrival hour.

```bash
node tools/autotest.js 120 all 1 2 3 4 5
```

Autopilot: plays 120 days on seeds 1–5 with the AI governor in charge (`src/sim/autopilot.js`; style `cautious`, `balanced`, `aggressive` or `all`), next to simtest's simple auto-player on the same seeds. Per run: days survived, population (now and peak), deaths, desertions, captives, buildings, outposts, trips launched, cards resolved, raids held off and hub stock, plus what the governor did (builds, crafts, gear handed out, treatments, search hours, supply runs, outposts, trades, role changes). Then a takeover check on the browser code paths: switch on while a raid battle is open, play 10 days the way the game loop does, switch off (auto-combat restored, teams untouched). Flags crashes, cards left open after a tick and teams stuck with nothing to resolve.

```bash
node tools/maptest.js 60
```

Map generation over 60 seeds: every map has a National Guard base (off-road, away from the hub), every town and city has its own police station and auto shop (cities at least two police stations), site names are unique, every town and city is on the road network, the hub is a small town, all AI groups get placed, every site type has raid buildings and valid gear, and the same seed rebuilds the same map. Prints sites per zone and per type, and the generation time.

```bash
node tools/timelapsetest.js 240 42 8
```

Timelapse recording: plays 240 days on seed 42 with 8 groups (simtest auto-play), then kills one survivor a day until the holdout falls. Checks a frame for every day, memory (estimate and measured heap, scaled to 365 days), captions, decoding (sequential vs random access, and exact match with the live world sampled weekly), that the same seed without recording ends the same, renders every day's frame state with the real map renderer on a stub canvas, and builds the viewer's overlay HTML.

## Controls

| Input | Action |
| --- | --- |
| Left-click | Inspect a tile (a tile with one of your teams in contact opens its team panel) |
| Right-click | Actions for a tile, or move a waiting team there |
| Hover | Description of any button or option |
| Drag / wheel | Pan / zoom |
| Space | Pause |
| 1–4 | Speed 0.5× / 1× / 2× / 3× (an in-game hour takes 6 / 3 / 1.5 / 1 seconds) |
| H | Center on hub |
| I | Infection overlay |
| ` (backquote) or Dev button | Dev tools: reveal the map (no fog of war; display only, your intel is unchanged), infection overlay, 10× / 50× / 200× fast forward, and a tracker of each group's population, bases and land plus zombie hotzones, nests and hordes with the change over the last 7 days |
| P (or Dev tools → Autopilot) | Autopilot on / off: an AI governor runs your holdout (pick Cautious / Balanced / Aggressive in the dev panel). Pairs well with Reveal map and fast forward |
| Esc | Close menus |
| Timelapse (game over or dev tools) | Space play / pause, ← / → one day, Home / End, 1–4 speed 1 / 2 / 5 / 10 days per second, I infection, T territory, F fit the map, drag / wheel / WASD pan and zoom, click a caption to go there, Esc close |

UI scale (75–200%) is in the top-right. In battle: click a unit, then a tile to move or an enemy to shoot; Tab or 1–9 select units; F/E/O/H/M/R trigger actions; Space ends the turn; Esc or right-click cancels.

## What is in it

- **Procedural State of Calder** (64 × 42 hexes, `src/sim/mapgen.js`): terrain, 3–4 rivers, roads, an outbreak origin with nests (plus a second hot spot in the other city), and about 185 sites in four zones. New map per seed.
  - *Cities:* Calder City in the south (a cluster of about 50 city and suburb tiles) and a smaller second city far from it, packed with urban sites, several of a kind and named by district ("Calder City North Precinct", "Calder City Eastside Auto"): police stations, auto shops, pharmacies, supermarkets, gun stores, hardware stores, gas stations, apartment blocks, offices, schools, fire stations, warehouses, a hospital and a mall each, a university, a clinic, churches. Rich, but danger is high (more of the dead).
  - *Small towns:* 13, spread out. Each has a police station and an auto shop next to its center, 0–2 other shops (grocery, pharmacy, clinic, diner, hardware, gun store, gas, church, school, motel, feed store), and 1–2 satellites a few tiles out (gas station, diner, motel, church, feed store, clinic, farm). Moderate danger, a little poorer than the same shop in a city.
  - *Countryside:* farms, barns, ranches, country churches, cabins, hunting lodges, campgrounds, ranger stations, radio towers, quarries, crash sites, plus truck stops and gas stations on the highways. Quiet and poorer; many sit off the road.
  - *Landmarks:* at least one National Guard base (sometimes an Army depot too) off-road in the hills or woods, away from settlements and the hub; a state prison, a dam, a regional airport near Calder City, factories near towns.
  - Highways join every city and town (a spanning tree plus shortcuts where the roads made a long detour); city and town sites have streets to them. The hub starts in a small town away from the cities, the outbreak and the military bases; AI groups start outside the cities, spread apart, mostly within 30 tiles of the hub.
  - On the map, each site is a pixel sprite of its type on a plate in its zone's color (faded once picked over, with skulls for its danger when zoomed in close); zoomed out, small sites are dots and only cities, towns, landmarks and group bases keep their names; you can zoom out until the whole state fits. The tile panel and tooltip show the site's zone, danger and likely loot.
- **Customizable start (new-run screen):** per colonist: rename or random name, move skill points (fixed point total), edit or randomize the look, randomize name / skills / look / all; "Randomize all" for the whole crew; pick the leader; choose 5–10 AI groups. Edited colonists are kept when the seed or group count changes ("New map and colonists" rerolls them).
- **Sprites:** procedural pixel sprites drawn in code (`src/ui/sprites.js`, no image files). Survivors are built from their `appearance` (build, skin, hair style and color, facial hair, top style and color, pants, accessory) plus worn armor and weapon; edit it from the survivor screen ("Customize look"). Zombies come as walkers, runners, bloated and brutes; enemy humans wear raider / soldier / zealot kits in their group's color. On the State Map (`src/ui/mapsprites.js`) everything is a sprite too. Your teams: a pickup or sedan (the actual vehicle) for motorized parties, walkers with packs on foot (armed for raids, scouts with binoculars on recon, a relief squad behind a banner), a rowboat or a raft with the vehicle (and a foam wake) while crossing water; trade-route convoys haul crates (lime) and supply runs haul drums (teal), by truck or pulling a handcart; on a ring in the team's status color, facing the way they travel; a faded sprite with a "?" badge marks an estimated position. Status badges are pixel icons too (waiting "!", wrench for work, radio contact, crossed swords for a siege). Other groups' parties look like their group: raiders on bikes and in a spiked pickup, a military humvee and helmeted squads, robed zealots with a banner and torches, an expansionist armored truck and shield troopers, a trader caravan (covered wagon, pack mule), a commune tractor hauling hay and pitchfork militia, fortress spear-and-shield militia; raids stand on a red-tinted ring and a siege pitches a camp (tents, barricade, fire, banner) beside the base. Sites: one sprite per location type (about 40, from the city skyline and the town water tower to the police station's light bar, the pharmacy's green cross, the gun store's rifle sign, the red barn, the radio mast and the smoking crash site), on a plate in the zone's color, faded when picked over, with danger skulls up close. Hordes are a crowd of shamblers (2–7 figures by size, in the zombie palette, facing where they drift) with their size on a badge, stale ones as faded ghosts with "N?"; nests are a festering mound over a dark pool with glowing pods, bigger and redder on badly infected ground, pulsing while in view. Markers: a grave (with the gear still lying there), your abandoned truck or sedan (dusty, a red jerry can when it needs fuel, smoke when badly damaged), a rusted wreck (up on blocks once stripped), a cache of crates and a duffel (opened once emptied), an abandoned camp (collapsed once picked through). Bridges are railed decks along the road. The **Zombies** button (top bar) sets palette, gore, variants, eyes and clothes, saved in the browser.
- **Bases (Manage):** the hub and outposts share the same rules: roles (farm, scavenge, operate, build, guard, rest, medic, craft), Heat, defense, beds, healing, morale and desertion. Tabs for overview, workshops (farm plots, scavenging, stations with operators and running status), buildings and their bonuses, a construction queue with builders and timers, an armory with everyone's equipment (skill-gap rule shown), and vehicles.
- **Expeditions:** trip planner (crew, vehicle or on foot, stance, supplies with round-trip estimate). Food, water and fuel drain hour by hour; running out hurts.
- **Team orders:** when a team finishes a job it waits for orders: act on that tile, move to any tile (click or right-click), return home, or hold. Teams in radio range can be redirected while moving. Giving an order that takes time un-pauses the game; when the order is done the team reports in with a "Done" card offering the next steps.
- **Order queue and team panel:** click a team (map, Teams tab, or the *Running orders* list in the map's top-left corner, which shows each team's current order and time left) to open its panel: people (health, infection, skills, gear), packed supplies and found cargo against carry space, the vehicle's condition and fuel, and the queue. Actions: move, return home, scavenge, look around (2h), camp (8h / 24h / until broken; the hurt heal slowly, infected wounds need meds), roadside repair (1 part, 3h, better with Mechanics), treat a member with carried meds, field crafting, and boat crossings. A waiting team starts an action now; a team on the move (or with queue mode on) adds it to its queue, which runs by itself (e.g. move, then scavenge). Arrival estimates (planner, panels, queue) step through the same hour-by-hour movement as the simulation.
- **Boat crossings:** water blocks travel and routes never cross it, but a team on a shore can build a one-use boat and cross one water tile to the land straight across (team panel, the orders card, or right-click the far tile). Cost: scrap = 4 + 2 per person + 1 per 20 carry units of supplies and cargo (+14 scrap and 2 parts to raft a pickup, +9 and 1 for a sedan, or leave the vehicle on the shore, marked for recovery); build hours = 2 + 0.5 per person + 1 per 40 load (+4 / +3 for a raft), cut 5% per Mechanics point (up to 50%), then 1h on the water (2h with a raft) with a small mishap risk (a crate lost, someone bruised, the raft vehicle damaged). Hours and materials are fixed when the order is given, so queue estimates hold. *Gather materials* (3h) turns up scrap on the shore.
- **Vehicles:** own fuel tanks and condition; worn vehicles break down more. A vehicle left behind (out of fuel, broken down, no road home) is marked on the map and can be recovered with fuel. Wrecked cars can be restored into new vehicles.
- **Markers and map layers:** teams roll perception to spot caches, wrecked cars and abandoned camps, marked with how long ago they were seen. Toggle layers (locations, territory, teams, hordes, death sites, vehicles, finds, infection) in the map corner.
- **Tactical combat:** fights open an XCOM-style battle on a grid built from the tile (cover, two actions per unit, hit chances, flanking, overwatch, hunker, melee, meds, line of sight, retreat zone, ambush rules, enemy AI, zombies drawn by gunfire). Injuries and deaths carry back to the map. After a win the dead are bodies to loot (see Inventory).
- **Travel events:** about 18 choice cards with skill checks (hazards, the dead, raiders, traders, discoveries, crew drama), plus forced horde encounters.
- **Fog of war and recon:** geography is known; current conditions are not. Teams report only when they get home, unless a radio station is built and they are in range (live position and sight).
- **Scavenging / raids:** an interactive raid on a generated 28×18 map built from the site (buildings and outdoor areas set by location type, e.g. a hospital has clinics, a pharmacy and offices). Search containers next to you (S) for loot drawn from the area's table, scaled by how picked over the site is and by Scavenging; what does not fit stays inside. Guards patrol and the dead wander, unaware until they spot you (Stealth) or hear gunfire. Heat rises each turn and with noise; each stage brings more dead. Leave from a green extraction zone (X); a vehicle you bring waits in its own zone, and extracting elsewhere leaves it at the site. Raid time passes on the map clock afterwards. Headless tools still use the older hour-by-hour abstraction.
- **Death sites:** the dead keep their gear where they fell; scavengers strip the most valuable items first; looted gear turns up with nearby groups; recovery missions.
- **AI groups:** 7 types with starting attitudes, growth, expansion, raids on you and each other, convoys, attitude drift from your expansion, calls for help (instant by radio, late by runner), collapse and refugees.
- **Trade and diplomacy:** barter priced by each group's real stock, gifts, non-aggression and trade pacts, radio diplomacy.
- **Trade routes:** recurring convoys with Light / Standard / Heavy escorts following the design doc's risk table.
- **Supply runs:** convoy jobs between your own bases (hub ↔ outpost, outpost ↔ outpost), set up in a base's *Supply runs* tab: crew (with their current gear), optional vehicle, goods to deliver, goods to bring back, stance, and once or every X days. At the destination the convoy comes back, holds there (a parked convoy: the crew do not work that base but eat from its stock; send it home or disband it later), or disbands (crew join that base, vehicle parks there, the job stays as a template you can recreate; recreating from the far end runs the other way with the lists swapped). Runs travel like trade convoys (escort table by crew size, stance, fuel, wear, deaths). If the vehicle is missing, broken or short of fuel the convoy goes on foot when the load fits, otherwise it waits; every blocked case is logged. Outposts hold back the stock their runs need instead of shipping it to the hub.
- **Medical:** everyone at a base heals slowly (faster with Medicine), and anyone below 70 health gets a dose of meds a day while stock lasts. Build a hospital and upgrade it step by step: Makeshift infirmary (2 beds) → Field hospital (4) → Clinic (6) → Trauma hospital (10). Each tier needs people on the Medic role (1/1/2/3) or it works like no hospital; patients in beds (worst off first; medics are never patients) heal faster, get +3 mood a day and do not work until healed, and meds work better. Severe wounds (below 30 health) heal at 40% speed without a bed and at the tier's speed in one; from the Clinic up, surgery makes treatments of severe wounds 50% bigger and med stations make +1 meds a day. The base's Medical tab lists the injured with a Treat button (uses base meds). People out on a team can be treated from the People tab with the team's carried meds (weaker than base care). Wounds below 40 health can get infected (half healing at a base, worse on the road); a field hospital bed prevents it, a clinic bed cleans it.
- **Hand crafting and makeshift gear:** the base's Crafting tab has a craft queue like construction: materials are paid when queued, people on the Craft role put in work-hours (1 + 3% per skill point each) on the first job they are skilled enough for, and finished gear lands in the armory (equip it in the Armory tab). No station needed; sturdier recipes (scrap crossbow, pipe shotgun, scrap plate vest) need a workshop (ammo bench or machine shop) at that base. Makeshift weapons (spiked bat, pipe spear, saw-blade machete, silent ammo-free crossbow, pipe shotgun), armor (magazine arm guards, duct-tape shin guards, tire-rubber vest, scrap plate vest; football pads and the football helmet are found, not made) and tools (bandage and splint kit: +2 Medicine for field and battle treatment; crowbar and lockpicks: +2 Scavenging at a base; charcoal water filter: +3 water a day at its base; improvised backpack) are weaker than manufactured gear and wear out: each fight, treatment or day of work uses one point of durability and the item breaks at 0. Boiled-rag dressings make meds by hand. Condition comes from the best crafter's skill (+10% for workshop recipes). A few makeshift items show up as loot (houses, garages, campsites, factories, towns, raiders). Teams can make the simplest recipes in the field (`fieldCraftOptions` / `fieldCraft` in `crafting.js`).
- **Inventory (paper doll):** every survivor has Hands (main weapon), Off hand (a tool in use: med kit, radio, goggles, crowbar), Head, Body, Arms, Legs and Backpack slots, 4 pockets for small things (knives, pistols, kits, radios, goggles) and, with a pack on, pack slots (improvised backpack 6, assault pack 8; packs also add team carry space, +6 / +10). Armor from every worn piece adds up (cap 5.5; plate carrier alone is 4): Kevlar vest or plate on the body, motorcycle / riot / football helmet on the head, magazine arm guards, knee guards or duct-tape shin guards. Items in pockets and packs do nothing until moved to a hand, and do not use the team's carry space; items in a team's cargo take 3 each (a pack counts its contents). Supplies (food, ammo, meds, scrap…) stay pooled per team or base, not per person. Open it from the survivor screen (People tab), the base Armory tab, or a member card in the team panel: click an item then a slot (or drag it), click it twice to send it across, a full slot swaps. At a base items move between the people there and the armory; on a team between teammates and the cargo. `s.gear.weapon/armor/tool` keep their meaning, so combat, medical and crafting read them as before (`src/sim/inventory.js`, `src/ui/inventory.js`).
- **Looting bodies:** after a won battle, dead enemies carry what they fought with (in worn condition), their armor, ammo, sometimes food, meds, scrap, a pack or a spare piece of kit; zombies now and then have something in a pocket; your fallen keep their own things. The result screen offers *Loot the bodies* (bodies list, each body's paper doll next to your survivor and the team's cargo; take items one by one, supply stacks with a click, *Take all* per body or *Take everything*, limited by carry space), *Take all and continue* (Enter) or *Leave the rest and continue*. Whatever is left stays where they fell: a death site on that tile that scavengers strip over the days (a recovery mission can fetch it); your fallen's things are at their death site anyway, and taking them from the body takes them off the site. Base defenses put everything in the armory. Headless and auto-combat battles take everything that fits straight away.
- **Outposts:** found satellites with 15 scrap; production by terrain; supply line strength and backup ETA from distance, hostile land and hordes.
- **Conflicts on the road:** near hostile land, busy roads and infected ground a team can run into people (or a surge of the dead). A perception roll (Scouting, Keen Eye, stealthy stance) decides who sees whom first. *Forced* conflicts (ambush, roadblock, zealot patrol, checkpoint, challenge, surge): run, hide, talk, bribe or pay the toll, invoke a pact, surrender, or fight. *Observed* conflicts (a camp, a robbery, two groups fighting, survivors swarmed by the dead, prisoners on the move): watch for intel, slip away, steal, ambush, talk, or take a side. The approach panel shows who they are, estimated numbers, your team and odds for every option. Fights go through the tactical combat entry point (`combat.js`). Roughly 0–2 conflicts on a 3–5 day trip.
- **Captives:** surrender, lost fights and failed rescues can leave people held at a group's base (People tab: "Held by …"). Get them back with a Rescue mission (sneak in, storm the base, negotiate, ransom), a ransom during a trade visit, or goodwill (friendly groups let them go). Left too long they may escape, change sides, or (with zealots) die.
- **Hordes:** spawn from nests, grow, merge, drift toward noise and people, attack bases; cull or lure them away.
- **One shared clock** for the map and every scavenging run.
- **Autopilot (dev tool):** the dev panel's *Autopilot* checkbox (or P) hands the holdout to an AI governor (`src/sim/autopilot.js`) so you can watch it play itself; turn it off and you are back in control with everything as it stands. It runs from the hourly tick (`autopilotHour`, daily planning at 07:00 in `autopilotDaily`) and only uses the same calls as the UI and what you know of the map (knowledge, markers, known groups). While it is on, battles resolve by the numbers (auto-combat; restored when you switch off, and a battle already open is played out by the AI), scavenging uses the hour-by-hour search, and cards, searches and trades never stop the clock. Every move is in the log with 🤖 (role changes as one line a day). What it does:
  - *Roles* every hour, per base: patients and the worn-out rest (up to a third), farmers for food (more when stocks are low, extra plots asked for when the farmers run out of room), guards against a spotted raid or a horde at the door (and a standing watch against known raiders or hordes in sight), medics while anyone is hurt, builders while something is queued, operators for stations worth running (ammo, meds, parts, by stock), one crafter while the craft queue has work, the rest scavenge.
  - *Buildings* through `canBuild` / `queueBuild`, saving scrap for what matters: bunkhouses when beds run short, farm plots, walls when threatened, the hospital tier by tier, watchtower, med station, storehouse, machine shop, radio, garage; outposts get a farm plot, beds and walls. *Crafting*: weapons for anyone without a usable one (crossbow, saw-blade machete, spiked bat, pipe spear), armor, dressings when meds are short, a water filter, a crowbar for scavengers, backpacks, pads; armory gear goes to whoever it helps most. *Medicine*: infected and severe wounds treated with base meds right away, others below 50 when stocks allow.
  - *Trips* (one a day at most, style sets how many teams, how often, how far, how many stay home and how healthy the crew must be): scavenge the best known site for what the hub needs (loot left, danger, infection, hostile land, distance), check spotted caches, camps and wrecked cars, recover the dead's gear or a lost vehicle, a trade visit (sells surplus, buys what is short, proposes pacts), a rescue for captives, or found an outpost when the population allows. Teams take the truck when it can make the round trip; searches stop at the style's Heat or hour limit, when someone is hurt, the cargo is full or the site is dry. Done cards: treat the badly hurt with carried meds before a long way home, sometimes search one more site nearby, else go home. Only one search runs at a time: a second team arriving holds at the site until it is free.
  - *Supply runs* to outposts that are short of hands (a volunteer disbands there) or of scrap for a building (crew sized to the load).
  - *Cards*: conflicts are scored from the odds they show (talk, toll, pact, run, hide, fight, ambush, slip away, steal; style weighs fights and raids), travel events by fixed rules (detour, shelter, spare parts, burn a nest only on good odds, take in loners if the food lasts), raid warnings judged against defense on alert (prepare, pay tribute, or fight in person), calls for help, newcomers (strangers, refugees, loners) only with food and beds for them (built, queued or one more bunkhouse; Aggressive allows some crowding), a new leader by Leadership; anything else falls back to simtest's rule ("Return home", else the first choice).
  - *Styles*: **Cautious** (one stealthy team close to home, short searches, more guards, pays tribute, avoids fights), **Balanced** (default), **Aggressive** (more and longer trips, loud searches, raids hostile land, ambushes camps and robbers, takes in more newcomers, expands fast).
- **Timelapse:** the world is recorded from day 1 (`src/sim/chronicle.js`): one frame a day (every 6 hours for the first 3 days, plus a frame a few hours after a death or a base gained or lost) with tile owners and infection (stored as changes against the previous frame, a full keyframe every 60 frames), your bases, the groups' bases, hordes, nests, parties, your population and hub stocks, and captions: your log's deaths, raids, horde attacks, bases founded and lost, plus what the fog hid (groups taking or losing sites, sieges and how they ended, hordes striking a group, big hordes, nests destroyed, collapses). About 0.25 ms per frame and roughly 300 KB for a year. When every survivor is dead the game-over screen offers *Watch the timelapse*; the dev panel has *Timelapse so far* (the game pauses, Close returns to it). The viewer (`src/ui/timelapse.js`) fits the whole map with the fog off and draws each frame with the normal map renderer: land growing and shrinking, infection spreading, hordes and teams stepping toward their next position, bases appearing and disappearing, and graves where your bases stood at the end. Overlay: day and time, your people over time (chart with a cursor), hub stocks, the groups' land or population chart with a table, horde / nest / hotzone counts, the latest captions (a ring pings on the map where each happened), and a bar with play / pause, step, speed (1 / 2 / 5 / 10 days per second), infection and territory toggles, fit, close, and a scrubber with day labels and ticks for major events.

## Code layout

```
src/sim/   pure simulation, no DOM (world, mapgen, parties, supply, factions, hordes, economy, buildings, vehicles,
           markers, events, conflicts, combat, scavenge, trade, medical, crafting, chronicle = timelapse recording,
           autopilot = AI governor for the dev tools)
src/ui/    map renderer, DOM panels/modals, combat screen, timelapse viewer
src/main.js  game loop, input, action dispatcher
tools/     headless balance scripts
```

The `sim` folder is kept separate from rendering, so the rules could be ported to another engine (for example Godot with C#) almost one-to-one.

`node tools/raidtest.js 10 7` plays raids with an auto-player per site type and reports extraction rate, deaths, loot and vehicles kept (`node tools/raidtest.js 3 7 all` covers every site type).

## Known gaps

- Raid balance is untested with real players; the auto-player loses people often.

- Balance is first-pass.
- No saving.
- Downed allies cannot be carried out of a battle when retreating; base defense battles use the normal left/right deployment.
- Outposts cannot be abandoned by hand.
- Trade routes cannot swap escorts (end and recreate the route).
- Captives are not shown on the map (only in the People tab and tile tooltips); convoys on trade routes and supply runs do not get conflict cards (their road trouble is auto-resolved by the escort table).
- Held supply convoys do not help defend the base they are parked at.
- Timelapse: parties are only seen at frame times (a trip shorter than a day can be missed) and move in straight lines between frames, not along roads; death sites, markers and battles themselves are not drawn (deaths and fights show as captions and pings); the recording lives in memory for the session only (no saving).
- Crafting: no throwables (Molotov, pipe bomb), torches or noise makers; makeshift gear is not traded.
- Autopilot: fights and raids are always resolved by the numbers (never the tactical or raid maps); it does not set up trade routes, cull or lure hordes, build boats (a team cut off by water waits for you), or deliberately scout unknown land (unknown sites are scavenged on estimates). It re-sets roles every hour, so roles you set by hand while it is on are overwritten. Screens you open yourself (base, planner, survivor, inventory, help, timelapse) still pause the clock. The style resets to Balanced with a new campaign.
- Inventory: sprites draw the weapon and body armor (or arm guards) but not helmets, leg guards or packs; enemies in battle do not wear helmets (soldier and raider bodies can carry one as spare kit); no picking things up from downed units during a battle (loot comes after a win, not after a retreat or defeat); raid maps keep their own body containers (Search); supplies are pooled per team, not carried per person; death sites store leftovers as a flat list, not per body.
