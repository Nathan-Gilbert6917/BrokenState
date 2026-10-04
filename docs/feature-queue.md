# Feature queue (requested 2026-10-03)

Order of work: (1) finish the review fixes and re-test, (2) desktop app wrapper, (3) the features below.
The user's wording is kept under each heading so nothing is lost; "Reading" lines are the lead's interpretation where the request leaves a gap.

## Done with the review fixes (UI agent)
- Start paused; pause banner at the top of the main screen; timed actions are queued until you unpause.
- FPS counter in the dev settings.
- Skull sprites larger and centred under the location's name.

## A. Weather and seasons
> Add weather and seasons that affect travel and farming

## B. Infestation hives and hordes
> Allow for infestation hives to send out hordes and create more infestation hives. The amount of resources gained per hive increases as more hives are around. Alone: 1 resource per day, 2 hives within 5 tiles 3 resource per day, 3 hives within 5 tiles 6 resource per day, etc balance this accordingly
>
> The hordes need to combine to create a infestation hive. a combination of hordes above a threshold it makes a new infestation hive. Other near by hives can send hordes to where the new hive is to be made to construct it faster.
> No hordes will exist when the game starts
> All hive existing at the start will start with 5 resources
> Score needed to build a hive 30
> Resources needed to construct hordes
> Small horde 10-25 zombies 3 resources
> Medium horde 50-80 zombies 8 resources
> Large horde 100-200 zombies 15 resources
>
> A hive can use 40 resources can output a hive boss zombie which can integrate with hordes. The point of this zombie is to smash defenses to attack bases
>
> Create a hive boss sprite and name separate from the one that is in the hive when you attack it.
>
> A new Hive needs at least 1000 zombies from hordes to be constructed
>
> Every 30-60 days a new infestation hive location is detemined based on the current locations of the infestation hives
>
> the goal of each infestation hive is to defend it's hive and support the creation of the new hive
>
> if they are too far they are defenders sending out hordes
>
> if they are close within 10 tiles of the new infestation hive location they will send hordes to the new location to combine into the hive until there is enough biomass to constuct the hive.
>
> Each horde has a score based on how many zombies are part of the horde
> This determines the toughness of the horde if you come accross it and fight it or it attacks your base. As well as how much it will provide to a new infestation hive
>
> Hordes can be spotted on the map via recon, encounters, watch towers if they come in range of one
>
> hordes can combine the amount of zombies when wandering out and about
>
> Wandering zombie hordes if they come in range of a hive needing zombies for construction they will be drawn there to be added
>
> Zombie hordes can split as long as the produced hordes have at least 10 zombies each
>
> Wall durability seems too strong to keep out hordes I think size of a horde should reduce effectiveness based on the tier of wall if over a threshold they break in and a combat encounter occurs to defend against the horde
>
> Add other defense constructions that can help defend against hordes and be used when under attack like barricades etc
>
> if a location is within the held territory of a hive they must have at a minimum 3 skulls and within the inner 1 tile around the hive is a red skull sprite that indicates much tougher zombies if you encouter any
>
> When you remove a hive it reduces the infection rate in an area.
>
> I want each hive to radiate infection rate and be reduced when hives are destroyed so survivors can win by securing the hives
>
> on the land tiles along the border every x days a off map random sized horde can spawn and move around so removing all hordes does not make everything safe but safer.
>
> hordes can move up to 2 tiles per day max

Reading:
- "Hive" replaces today's "nest".
- A build site needs both: combined horde score of 30 or more to start, and 1,000 zombies of biomass delivered to finish. Horde score scales with its zombie count (small about 3, medium about 8, large about 15).
- Destroying every hive is a win condition, alongside the existing lose condition.

## C. Economy
> the gathering of recources seems overpowered in a run they never got close to running out of any supplies. Make scavanging very rare to find things when doing so at a base to encourage going out and exploring to get items. Farming on land should not produce per day it should take time like x days to produce y amount of food takes the same x days but y * z amount yield for more skillful farmers and having more of them in a base. Expand the farming system where each base has x plots depending on the type of base and can constuct more and have a list of crops with each having different yields and time to mature. with the season and weather system affecting them causing them to die or rot
>
> Water is important and does not seem to increase or decrease look into this and make a change and fix
>
> Meds are not being used enough add a system that when doing certain actions give a chance of getting sick or hurt to use meds
>
> Fuel seems to be too common make it rarer

## D. Radio and trade
> Radio relay construction at outside bases to extend radio coverage
>
> Radio to other groups
>
> Looking for trade over radio with other groups within radio coverage. They will send over a caravan of supplies to trade if they agree. They can request some from you as well. They/you can request a specific resource with an attached price.
>
> When a foreign caravan comes you can attack it if you do you will become hostile to the whole group they are from and they may try to raid you
>
> Create a trade caravan with a destination queue you go to the first destination you get the option to stay a day, return home or go to the next destination
>
> A group exploring can go to a group and try to trade or provide/request information to remove fog of war or get POI info
>
> Create trade window like RimWorlds/Fallout
> Each item is scored based on what the item is (base score), and quality later durability

## Review suggestions the requests above already decide
Difficulty (hub cannot fall, raids and hordes too weak), walls against hordes, stock piling up, water unused at bases, meds unused, loot never regrowing, trade route exploits.

---

# Batch 3 (requested 2026-10-03, after suggestions-2.md)

User's words:
> Add a settings view with Save, Load, save and exit game
> Skill growth with use and teaching (add book items that can be read to learn skills)
> Add a production order until x and add optional for quality
> Add a diary which shows logs day by day
> Add Manuals and blueprints that can be recovered
> Add some perks at skill milestones maybe a skill tree with different options to choose from
> Add #3, #4, #5, #11, #12, #13, #14, #15, #22, #24, #25, #16 (Alliance must control over half the map all groups left are part of the alliance and all hives are gone)
> Friendly groups have a wants list and show surplus
> Add event hub tasks to handle things breaking like a well pump etc
> Add events like seeing a helicoptor/plane crash and see a general area on the map where it occurred, send a recon to find it and explore it.
> Add the ability to pick locks (add locked boxes, lockers, doors, etc)
> Set a steward that will auto run a base and survivors in the base and be able to take over at any time.

Numbers refer to docs/suggestions-2.md.

Plan (waves, so agents don't collide in the same files):
- Wave 1: skills (growth, teaching, books, perks/skill tree) · production orders + quality + power (#5) + steward per base · diary + alerts/log/hotkeys (#22) + roster table (#24) · map performance (#25) · relationships/service record/memorial (#3) + mood effects (#4)
- Wave 2: exploration (manuals/blueprints, lockpicking and locked containers, crash events with a search area, hub breakdown tasks) · combat (#11 knock-outs and prisoners, #12 stealth kit, #13 deploy phase) · diplomacy (#14 jobs, #15 group wars, #16 alliance victory, wants/surplus lists)
- Wave 3: settings view with Save / Load / Save and exit (last, so it captures every system's state)
