# Suggestions, round 2

New ideas only. Nothing here repeats what is done or in progress (weather, hives, farming, radio and caravans, winter food, autopilot styles, recruit cards, hub event cards, desertion warnings, trip presets, timelapse, the desktop app and so on). Numbered straight through so you can answer "do 3, 7, 12".

Sizes: **S** = an evening or two, **M** = a few sessions, **L** = a big piece of work that touches many files.

## My top 5

1. **#23 Save and load.** The game is meant to last hundreds of hours and right now every session dies with the browser tab. Nothing else on this list matters much until a run can survive a restart.
2. **#1 Skills that grow with use.** Skills are set when a person is made and never change (`world.js:97`, nothing in `src/sim` ever raises them). Over a long run with 25–50 people, watching a nobody turn into your best medic is most of what makes RimWorld colonists feel like yours.
3. **#6 Standing production orders.** Stations run whenever they have inputs, so ammo piles into the thousands. "Make ammo until 300, then stop" is the modded-Minecraft level-emitter feeling, and it keeps your "machines need operators" rule.
4. **#21 A quest book of milestones.** The SkyFactory / StoneBlock quest book is an early-game guide and a long-term goal list in one. It fixes the quiet first week and the "now what?" after day 150.
5. **#10 Manuals and blueprints from raids.** It gives every raid a reason beyond scrap and food, makes the university, military base and factories places worth planning around, and gives the hub a tech path that comes from exploring.

---

## Survivors & story

### 1. Skills improve with use, and people can teach
A survivor gains a little experience in the skill they use: farmers in Farming, the person who treats wounds in Medicine, the shooter who lands hits in Shooting, the one who talks down a roadblock in Speech. Growth is fast at low levels and slow near 20, so a 3 becomes a 7 in a season, but a 15 takes a year. A *Teach* role pairs a high-skill person with a learner, so your only medic can train a backup before the next outbreak.
Why: today skills are fixed at creation (`world.js:97–103`; `skill()` at `world.js:223` only adds traits). In a hundreds-of-hours sandbox, people need to change. It also makes losing a veteran hurt.
Size **M**. Risk: snowballing (everyone at 20 by year two); cap growth per season and have skills slip slowly when unused.

### 2. Perks at skill milestones, and traits earned in play
When a skill reaches 5, 10 and 15, you pick one of two or three perks, Fallout New Vegas style: Medicine 10 gives "Field Surgeon" (field treatments as good as a base) or "Triage" (two patients per treatment); Stealth 10 gives "Ghost" (unaware enemies do not see you at 2 tiles) or "Quiet Hands" (searching adds no Heat). Events also leave marks: "Bitten and Lived", "Hive Killer", "Shaken" after a team wipe, "Road-Wise" after 20 trips.
Why: there are only ten fixed traits (`data.js:144`) and they never change. Perks give the skill growth in #1 decisions, not just bigger numbers.
Size **M** (needs #1 for the milestones; earned traits work without it). Risk: each perk needs a hook in combat, medical or scavenge code; start with about a dozen.

### 3. Friends, rivals and grief, with a service record
People who share trips, rooms or work build relationships: friends get a small bonus on the same team and take a mood hit when the other dies; rivals argue (the travel event "argument" in `events.js:278` could read this). Each survivor's screen shows a service record: trips, kills, people treated, hives destroyed, days survived. The dead get a memorial wall at the hub that lists their records.
Why: mood comes from just five things today (food, beds, rest, the leader, a few events; `economy.js:217–292`), and a death is a log line. With 25–50 people, relationships and records are what make you remember names.
Size **M**. Risk: mood balance; keep the effects small and visible.

### 4. Mood that does something besides desertion
Low mood slows work (builders, crafters, farmers, operators) and, near the bottom, causes a short "breaks down" episode (sits out a day, or takes a bottle from stock). High mood speeds work a little. New sources: variety in food (preserved only for weeks is grim), a common room or chapel (a building that raises mood), hot meals from a kitchen, a day of rest after a bad trip.
Why: mood today only matters below 15, where people may desert (`economy.js:279`). Everything above that is a number nobody needs to watch. RimWorld's needs are what make base management a constant series of small choices.
Size **M**. Risk: a new failure cascade (sad → slow → hungry → sadder). Show the cause on the People tab.

---

## Base & production (machines need operators)

### 5. Power: generators, an ethanol still and powered stations
Generators (fuel, or an ethanol still that turns corn or spoiled food into fuel) give a base power. Powered buildings run better or at all: a powered machine shop makes 2 parts a day, a powered cold store works in summer, floodlights stop needing fuel per attack, the radio station reaches further. Each powered station still needs its operator; the generator needs one too.
Why: fuel is scarce and only matters for vehicles and floodlights (`buildings.js:28`); the still links farming to fuel. Recipes are one step each today (`buildings.js:7–13`). A modest power layer is the "build the factory" itch from modded Minecraft without full automation.
Size **M–L**. Risk: fuel balance and Heat (a generator is loud: more Heat at the base, `hordes.js:68`). Keep it to a handful of buildings at first; skip intermediate goods unless it feels thin.

### 6. Standing production orders ("make until N")
Each station gets an order: *Forever*, *Until stock reaches N*, *Keep at least N of the input*, or *Off*. When the target is reached the operator stands idle (or switches to a fallback station you pick). The craft queue gets the same: "keep 2 bandage kits in the armory".
Why: `runStations` (`buildings.js:177`) runs any staffed station with inputs, which is why ammo ends runs at 1,000–5,000 (review P-24, R-19) while scrap runs out. This is the RimWorld bill and the Minecraft level emitter, and it keeps operators in the loop.
Size **S–M**. Risk: low. The autopilot can use the same orders instead of shuffling roles every hour.

### 7. Stewards: hand parts of a base to the autopilot
Per base, switch on stewards for one area each: *Roles*, *Building*, *Crafting*, *Medical*, *Farming*. A steward uses the governor's existing logic (`autopilot.js`) for that area only, and logs what it did in one daily line. You keep the rest. Outposts far from home can run on stewards while you manage the hub by hand.
Why: with 5–10 bases and 25–50 people, hand-setting every role gets old; this is the 4X governor that Civilization and Stellaris use for late-game sprawl. The code mostly exists; today it is all or nothing and dev-only.
Size **M**. Risk: the governor re-sets roles every hour (README known gaps), so it must leave alone people you have pinned by hand.

---

## Exploration & extraction

### 8. Keys, locked rooms and safes in raids
Some raid buildings have a locked room or a safe: police evidence lockers, the pharmacy's back room, the gun store's cage, the military base's arms vault. Open them with a found key (named, for that site), lockpicks and time (adds Heat), or a crowbar and noise. Keys turn up on bodies, in other raids and in trade.
Why: raid containers today are open boxes with area loot tables (`combat.js:1302–1330`); nothing makes you plan a return trip. Keys are the core Tarkov hook: "I have the Dunmore PD key, so that raid is worth it now."
Size **M**. Risk: cargo clutter; keys could live in a key ring on the hub's armory page, not in cargo.

### 9. Contested events, and a map that refills
Every week or two something appears on the map for a few days: a crashed supply helicopter, an abandoned military convoy, a stranded refugee bus, a pharmacy truck in a ditch. It shows up on the radio with a rough location, and AI groups send parties for it too, so you race them or fight over it. Meanwhile picked-over sites slowly regain a little (other survivors leave things, hordes drag stuff along), and AI groups scavenge sites too, so they also run dry.
Why: loot never regrows (only `scavenge.js:98, 162` lower `tile.loot`) and every site within about 12 tiles is picked clean by day 150 (browser-run review). Late game has nowhere worth going. Timed contested targets give the extraction loop a reason to go out and a reason to hurry.
Size **M**. Risk: regrowth can bring back the "stock piles up" problem; keep it slow and keep the big prizes in the events.

### 10. Manuals and blueprints: tech from the field
Rare finds unlock buildings, recipes and upgrades: "Field Surgery Manual" (from the hospital or university) unlocks the Clinic, "Ballistics Reloading Guide" (gun store) the second ammo bench tier, "Water Treatment Plant Schematics" (dam) the cistern pump, "Army Engineering Manual" (military base) the reinforced gate. A survivor with the right skill must read it at the hub for a few days (an operator again) before it unlocks. Some basic buildings stay unlocked from the start.
Why: there is no tech progression; every building is available from day 1 if you have the scrap (`buildings.js:15–60`). This ties exploration to base growth the way SkyFactory ties progress to resources you have to go get, and it makes specific landmarks worth a dangerous trip.
Size **M–L**. Risk: lock too much and the early game stalls; start with locks only on the top tiers (hospital tiers 3–4, machine shop, radio, generators from #5).

---

## Combat

### 11. Knock-outs and prisoners
Melee on an unaware human can be a takedown that knocks them out instead of killing (MGS V style). After the fight, knocked-out enemies can be tied up and brought home if there is room. At the hub a prisoner can be questioned for intel (their group's bases, stock, patrols), held for ransom, traded back for goodwill, or slowly recruited. Holding prisoners costs food and a guard, and their group may come for them.
Why: only the AI takes captives today (`conflicts.js:219`); you can only kill. MGS V's best idea is that every enemy is a possible recruit, and it gives stealth a real payoff.
Size **M–L**. Risk: a new population source on top of strangers and recruits (review C-6 already saw snowballing); make recruiting slow and depend on goodwill or mood.

### 12. A stealth kit: distractions, suppressors and darkness
Throwable bottles and noise makers pull guards and the dead toward a spot; a crafted suppressor (wears fast) halves a gun's noise; night raids have shorter enemy sight but your team needs light to search (a flashlight in the off hand, which makes them easier to spot). Bodies of silent kills can be dragged out of sight so patrols do not find them and raise the alarm.
Why: raids already have patrols, noise and Heat (`combat.js:1599–1640`), but the only quiet tools are melee and the crossbow, and throwables are a known gap in the README. This is the MGS V loop on top of a system that is already built for it.
Size **M**. Risk: the AI patrol code needs a "go investigate" state; balance stealth so it does not trivialise raids (Heat still rises every turn).

### 13. Set up the defence before a break-in
When a horde or raid will break in, you get a short deploy phase on the base's battle map: place your defenders on walls, towers and behind barricades, decide who holds the gate, and where the floodlights point. The attack then comes from the side the horde approached on the State Map.
Why: base defence battles use the normal left/right deployment (README known gaps), so the walls, trench and barricades you built are just scenery for your positions. Placing people on your own walls is the payoff for building them.
Size **M**. Risk: the AI-vs-AI calibration in `hivetest` assumes the current layout; re-run it.

---

## Diplomacy & factions

### 14. Jobs for other groups
Known groups post jobs over the radio or during visits: clear a horde near their base, escort their caravan, deliver 20 meds during an outbreak, rescue their people from raiders, help storm a hive near them, scout a region. Rewards are goodwill, gear you cannot make, recruits, intel or a site they hand over. Failing or ignoring costs a little goodwill.
Why: radio requests today are one-line supply deals (`radio.js:321`); goodwill only moves through trade, gifts and greetings. Jobs give the diplomacy screen things to do and send teams to new parts of the map, which feeds exploration.
Size **M**. Risk: needs the job to be checkable by the sim (horde gone, cargo delivered); start with three job types.

### 15. Groups deal with each other: blocs, wars and brokering
AI groups form pacts and fight wars with each other over land, and you hear about it on the radio. You can stay out, sell ammo to both sides, broker a ceasefire (Speech check, goodwill with both), or join a war for a share of the land. A group at war has less to trade and more to pay for weapons.
Why: today each group has one goodwill number toward you and only raids or trades with others by simple chance (`factions.js:119–184`). 4X diplomacy is about the relations between other players, not just yours with them.
Size **L**. Risk: groups collapse faster (review C-20 already saw 0–4 of 8 collapse a year); tune wars to end in terms more often than wipe-outs.

### 16. The Calder coalition (late-game goal)
Allied groups can be invited into a coalition. Members share sightings, send help against break-ins, join hive assaults with their own fighters, and meet in a council every season that asks something of you (supplies, a job, a ruling between two members). A coalition that holds most of the state and its hives is a second way to win alongside destroying every hive.
Why: there is one win condition (`world.js checkGameOver`) and it is pure combat. A diplomatic victory fits a 4X and gives the trade and radio systems a destination.
Size **L**. Risk: needs #14 or #15 to feel earned; easy to make allies too strong.

---

## Economy

### 17. A market board on the radio
One screen lists every group in radio reach with what they want, what they have spare, and price arrows compared with last week. Shortages show as events: "Greenhollow lost its harvest to frost: food prices high there for 20 days." A caravan planner can sort destinations by best price for what you carry.
Why: prices already move with each group's need (`trade.js`), but you only see them inside the trade window, one group at a time. Showing them turns the existing model into the dynamic economy you like: buy cheap at the commune, sell high at the fortress.
Size **S–M**. Risk: low; arbitrage can make money too easy, which the existing spread and the 4-goodwill-a-day cap already limit.

### 18. A ledger: where everything comes from and goes
A Ledger tab per base and for the whole holdout: for each resource, income and spending over the last day, week and season, by source (farms, stations, raids, trade, supply runs, spoilage, eating, crafting, building) with a small graph. Click a line to see the details.
Why: the base shows a few forecasts, but the review found shown numbers that did not match real ones (P-23), and nobody can tell why scrap is short or ammo is piling up. Factorio and modded Minecraft players live in production stats. `econStats` (`economy.js:258`) already counts some of this.
Size **S–M**. Risk: low; a little memory per day of history.

---

## Long-term goals and pacing

### 19. Landmark restoration projects
Big multi-week projects at landmarks you hold: restore the dam's turbine (power for every base in range), reopen the airport (a supply flight every season), repair the radio tower (statewide radio reach and a refugee broadcast), rebuild a collapsed bridge, re-open the prison as a fortified outpost. Each needs rare parts from specific raids, a crew of operators on site, and the site defended while it works.
Why: late game today is stocks in the thousands and nothing big to spend them on (reviews R-19, P-9). Projects turn surplus into goals and make holding distant land worth it.
Size **L**. Risk: hordes and raids must be able to threaten a project, or it is a timer.

### 20. Early hub tasks that ask for a person, not just a build
In the first weeks, give the hub small jobs that need a named person for a few hours: fix the well pump (Mechanics), clear the burned house next door for scrap, map the surroundings (Scouting, reveals nearby sites and their loot), teach the kids to shoot (raises everyone's Shooting by 1, needs #1). They show as a short list in the base screen, and each has a visible payoff.
Why: the first week has two decisions and no events (review P-15); hub event cards help, but they are random. These are planned, cheap and teach the systems.
Size **S–M**. Risk: low. Can share code with #21.

### 21. A quest book of milestones
A book (top bar) with chapters of goals: *Settle* (first harvest, first outpost, first radio contact), *Hold* (survive a winter, beat a break-in, staff a clinic), *Reach* (relays across the river, a trade route, a hive found), *Reclaim* (a hive destroyed, a landmark restored, a coalition). Each goal has a short text and a small reward (scrap, a blueprint from #10, a recruit). Later chapters open as earlier ones are done.
Why: SkyFactory and StoneBlock use a quest book as the spine of a long sandbox; it tells a first-time player where to look and gives a hundreds-of-hours run a shape. It also gives the win condition a path.
Size **S–M**. Risk: rewards that make the early game easy; keep them small.

---

## UI/UX & QoL (4K TV, mouse and keyboard)

### 22. Alerts stack, a clickable log and more keys
A RimWorld-style stack of alerts on the right edge: "Team waiting for orders", "Outpost low on water", "Station idle: no operator", "Horde 4 tiles from Dunmore". Clicking one jumps to the place or opens the right screen. Log lines name places and people as links, and the log can be filtered (deaths, trade, hordes, one base). New keys: Tab / N next waiting team, B / T / G / P for the side tabs, F1–F9 jump to bases, Ctrl+1–9 to save and recall camera spots.
Why: the log is the last 80 lines with no filter or links (`ui/ui.js:390`), and the map has only a few keys (`main.js:1051–1074`). On a 40" TV at a distance, a glanceable alert stack beats reading a scrolling log.
Size **M**. Risk: low.

### 23. Save and load
Save slots plus an autosave every in-game day (and before a hive assault), in the desktop app's data folder or browser storage. Saves keep the seed, the whole state, the chronicle (for the timelapse) and the weather stream.
Why: "No saving" (README known gaps) caps every run at one sitting, which does not fit a hundreds-of-hours sandbox or a family playing over weeks. It would also let the test tools resume long runs.
Size **L**. Risk: open cards hold `resolve` functions (123 of them in `src/sim`), and some state uses `Set`s; the simplest path is to rebuild cards from an id plus data on load, or only allow saving with no card open. A version number in the save keeps old saves loadable when the rules change.

### 24. A roster table for 25–50 people
A full-screen People table: one row per survivor, columns for base, role, health, mood, conditions, each skill, weapon and armor. Sort by any column, filter by base or role, and change roles from a drop-down in the row (or select several rows and set them at once).
Why: the People tab is a list of cards in a 22rem side panel (`ui/ui.js:195`); at 30 people it is a long scroll and you cannot compare skills. RimWorld's work and assign tabs are tables for exactly this reason, and a 4K screen has room for one.
Size **M**. Risk: low.

---

## Tech & performance

### 25. Cache the map layers and only redraw what changed
Draw terrain, roads, bridges, territory and hive land into an offscreen canvas once per zoom level and only rebuild it when your knowledge, ownership or a hive changes; each frame then copies one image and draws sprites on top. When paused with nothing animating, draw at a low rate instead of every frame. Smaller wins: the infection layer fills each tile separately and the territory layer fills and strokes each tile (`ui/render.js:157–184`); batching them by color like the terrain cuts thousands of calls; the hive distance check walks every tile against every hive each frame (`render.js:~200`) and can be cached.
Why: the frame redraws the whole map every frame, paused or not (`main.js` `step` calls `render` each frame; `render.js:118`). That fits the ~35 FPS with the whole 64×42 map visible at 4K.
Size **M**. Risk: stale layers if a change forgets to mark them dirty; use a simple version counter on knowledge and ownership.
