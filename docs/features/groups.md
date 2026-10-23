# Other groups, diplomacy, war, radio and intel

Detail for sections 10 and 11 of [docs/agents/features.md](../agents/features.md). `[name]` is `prototype/src/sim/name.js`; `ui/name` is `prototype/src/ui/name.js`. Related docs: [ADR 0001 (AI parity)](../adr/0001-ai-parity.md), [docs/ai-parity-audit.md](../ai-parity-audit.md), [docs/coalition-war-plan.md](../coalition-war-plan.md), [docs/prompts/poi-and-nomads.md](../prompts/poi-and-nomads.md).

## Group arsenals and job kit
- Groups fight only with what they gathered [arsenal].
- Their job kit (decoys and flares, packs, the crowbar and lockpicks, picks, a drill) is on their books too: scavenged on its own draw (what they are short of first), decoys crafted by your recipes while short, paid more for while short [arsenal isJobKitKey, jobKitShort, scavFinds SCAV_KIT, arsenalDaily CRAFT.decoys; trade gearPool].

## Packing for the job
- A group's party packs as your team is packed for its trip, out of the group's own stores: a pack on every empty back; a raid: grenades, smoke, tourniquets, a med kit and a second helping of rounds; a way through the dead: decoys, Molotovs, flares and a blade beside the gun; scavengers: the crowbar, picks and drill; a caravan: a med kit; a hunter: a hunting rifle.
- The home keeps a share of its decoys, set out at its walls against a horde they will not hold, by your warning card's odds.
- Modules: [loadouts packForJob JOB_KIT jobsOf, parties spawnAiParty; groupfight hordeAtGroup; defences armoryDecoys decoyChance lureOff]; test `tools/jobkittest.js`.

## Combat and inventory parity
[docs/adr/0001-ai-parity.md](../adr/0001-ai-parity.md), [docs/ai-parity-audit.md](../ai-parity-audit.md). Every non-player human obeys your rules.
- **People**: a group's people are survivor records with skills, traits, health and what they carry [members]. Each base has its own stores and buildings [groupbases].
- **Kit**: the daily kit-out hands the group's items to its people through your equip rules; a raid takes the launchers along; every party packs for its job (decoys and flares through the dead, packs and tools to scavenge) [loadouts, equip].
- **Battle**: one unit builder makes every human on the battle map, including nomad and visitor bands' people [fighters, bands]. Physical rounds and reloads for every side [mags, ammo]. Your bots' decoy and crush for every side's people [decoys botDecoy, carriers botCrush, combat aiRepertoire].
- **Care**: wounded heal by your medical rules, a band's from its own meds [groupmedical; nomads bandCare].
- **Bands**: nomad bands and raiders from beyond the border live by one band code (carry rule, food and water, care) and take newcomers in as people [nomads bandRoom / bandFeeds / recruit, visitors raiderDay, bands bandNewcomer].
- **Work**: repairs, crafting quality, the reloading bench and salvage go through your code, done by the group's best person with the skill [groupcare, arsenal, reloading].
- **Unwatched fights** between groups, their caravans and the dead go through one resolver on your by-the-numbers rules; your convoy's people too when a group or raiders rob it [groupfight fightSides / applyYours, breakoff landFight, caravanraids groupRobs, visitors hitConvoy].
- **Cargo**: a vehicle's cargo goes with it between your vehicles and a group's records [vehicles carryCargo, arsenal unloadVehicle].
- **Defectors**: one of yours who goes over to a group goes as themselves, with what they carry [members joinFromYours, groupcare takeInFromYours].
- **Checks**: a test campaign checks no AI holding grows from nowhere [ledger, tools/conservationtest.js]; swapped-sides fights play alike [tools/paritytest.js].

## Keeping the coalition together
The user's request 2026-10-21: Total War meets Civilization. Test `tools/coalitiontest.js`.
- **Standing**: each member's standing toward you is its goodwill plus named modifiers that fade (a quarter of each act stays in goodwill). Between members: their relation plus theirs (border friction, trade, a common enemy, incidents, your rulings) [coalition standing / pairStanding / standingParts / remember / pairDrift].
- **Asks** every few days through the card system (default: refuse): mediate a quarrel (side with one, split, stay out); a favour at another's expense; a trade; aid for nothing; military aid (fighters lent through volunteers.js answerAsk, rounds, or joining its war: diplomacy.js joinWar) [coalition askCard, disputeCard, favourCard, tradeCard, aidCard, militaryCard].
- **Refusal fatigue**: accepts and refusals tallied per member and for the coalition (the council's asks and volunteer calls too: noteAnswer); refusals × fatigue and "Requests ignored" deepening [coalition fatigue, neglect].
- **Tolerance bands by type**: under the leave line a member may leave, under 20 at once; far under it turns hostile and a warlike type declares war (playerwars.js declareOnPlayer). A grudge between members raises a demand to expel one; refused 3 times the demander walks out [coalition band, toleranceCheck, breakAway, expelCard; alliance allianceDaily].
- **UI**: Diplomacy → Coalition standing (bars with leave and hostile lines, modifiers, record, risk flags, land if they leave, member grid) [ui/coalition coalitionStandingTab]; codex "Keeping the coalition" [ui/codex].

## Envoys: word carried in person
The user's request 2026-10-21: "before radios are set up ... you must send a convoy of at least one survivor to give the message in person. AI groups must do this for you as well". Tests `tools/envoystest.js`, `tools/envoys2test.js`.

### When an envoy is needed
- Without a two-way radio link (radio.js canRadioGroup: your coverage + 6 reaching their base and groupHasSet, a set of their own; between groups groupsLinked) every message goes by envoy.

### Your envoys
- Diplomacy → Envoys, or a group's card Communicate…: aid, a trade, a pact, an invitation, a request for aid or military aid, news or a warning.
- aiAnswer decides on arrival by standing, needs and type: p = 0.5 + (standing + base + type + needs) / 100 on hash dice; gifts, pacts and invitations by their rules [envoys communicate, envoyPlan, launchEnvoy, deliver, aiAnswer].
- The envoy is a team on mission "envoy": at least one survivor, a vehicle, the goods in its cargo, food and water for there and back × 1.3. Locked to its errand (orderMove, queueOrder, startOrder, cancelMove, startReturn, giveOrder refuse; awaitOrders sends it on: envoyCarryOn). Meets travel events and road fights like any team.
- Goods change hands on arrival; the answer is known when it is home (envoyHome: the pact signed, the coalition joined, their news mapped).
- Killed going: lost, no answer, no refusal. Killed coming back: their side stands, the agreement lapses, you never hear it. "No word from our envoy" at 1.5× the trip + 24h [envoys envoysHour, noteOverdue, statusOf, messageList; parties arrive / returnHome / awaitOrders hooks; orders, teamform guards].

### Their envoys
- A coalition ask without a link comes by an AI party (kind "envoy", tagged with its errand on the map, interceptable: caravanraids roadCaravans; never starts a fight: conflicts enemyParty; robbed by raiders: parties aiPartyHour).
- The card only on arrival (coalition raise → envoys envoyAsk; askCard focus/params; raiseArrived). The asker's books only when it is home (coalition withSink / replaySink: remember and noteAnswer deferred, your goods ride with it).
- Word between members their radios do not join goes by courier (envoys wordHome). The season's council waits for delegates (alliance council → envoys councilByDelegates, holdCouncil).
- Modules: [envoys envoyAiArrive, envoyAiWait; ui/envoys envoysTab, commsButton; ui/coalition commsBadge; ui/render crewTag and the AI envoy pill; ui/codex "Envoys and radio links"].

### Every word by envoy
- The user's rule 2026-10-22: "All communication regardless if radios have not been established between the groups has to come by envoy regardless if it is a player or AI group".
- Any card a group sends you goes by envoys cardFromGroup: by radio the card now; else an AI envoy, the card built again on arrival from plain args by CARDS, the sender's side under the talk sink (talk.js withTalk, factions changeGoodwill and coalition remember deferred; parties it sets moving held in msg.held until it is home). Covers:
  - asking to join (alliance askToJoin / joinAskCard); a call for your people (volunteers makeAsk); trade offers (radio envoyOffers on hash dice); jobs (jobs jobsDaily "carried" → jobArrived);
  - their war (diplomacy askPlayerToJoin); a bloc's invitation (blocs inviteYou); a war on you (playerwars declareOnPlayer → carryDeclaration; the war begins when it is read); suing for peace and their terms (playerwars warDay);
  - a member's sightings by courier every NEWS_DAYS (alliance shareSightings → envoys newsFromMember).
- Yours by your best talker (envoys quickEnvoy): peace terms (playerwars offerTerms, KINDS.terms), a ransom's price (ransom.js, KINDS.ransom), keeping their people (KINDS.keep).
- Between groups (AI ↔ AI) without a link, a courier (envoys groupWord / WORDS: pacts, war declarations, peace; diplomacy pactsDaily, declareWars, warsDaily).
- **Left as they were**: a raid (no envoy); help calls already on a runner's clock (factions helpCall); the hardcore Guard (inContact); your own acts in their war (joinWar, expel); a ceasefire you broker (radio to both sides); groups lending each other (volunteers aiLendDaily); bloc mergers and their internal trade; haggling at the same table; caravans at your gates.
- **An envoy lost out of radio coverage** says nothing live (parties unheardEnvoy: no death lines, no "whole team was lost", no death site or vehicle marked: world killSurvivor, parties wipeParty, conflicts / nomads / visitors / wanderers result handlers; envoys envoyLostQuiet). "No word from our envoy" at its overdue hour gives them up for lost by name (envoys noteOverdue). In coverage (p.radioLive) it reports as any team.

## Volunteers on loan and joint operations
The user's request 2026-10-21: "a request for volunteers to be added to one of your bases as people temporally ... or joint operations to coordinate fighting hives doing city/town crawls, fighting another group or horde or just help raiding POIs". Tests `tools/loanstest.js`, `tools/envoys2test.js`.

### Asking
- Through the envoy path (envoys KINDS volunteers / jointop: by envoy, or at once by radio).
- They decide by volunteers.js askQuote's points (in person: groupProblem inPerson) plus their kind, the purpose's or operation's danger, a member's standing and a loot share [loans loanQuote, opQuote]. A member's answer goes on coalition.js's record [coalition noteTheirAnswer, recordOf tAcc / tRef].

### Loans
- **Arrival**: their very people walk to the base as a party of the group by the AI parties' rules (kind "loan": its people the group's members out with it, members partyId, road rations PACK.food a head out of its stock; killed by name by a horde or an ambush: groupfight fightersOf the party; robbed like a caravan). Then they leave the group's list (members removeMember) and live there as survivors with s.loan.
- **Yours in every way**: roles, beds, food, water, rounds and supplies from the stores, teams, your orders in a fight; the base may issue them gear.
- **Their own kit** is marked theirs (it.loanOwn: inventory ownKit) and never leaves them: inventory moveItem refuses it; parties unloadAt unpacks only the base's (supitems unpackPerson keep); itemstack canStack keeps it apart; equip equipPeople / bulk / tripgear / carrykit equipKit and governPlates / autopilot (heavy armour stashed, roadKit) never swap it out; trade toggleGear / autoGearOffer never sell it; loans ownKitHour puts a stray piece back on them.
- **Leaving**: the base's things go back to the base's stores and armory (or the team's); they take home only their own (loans returnBaseKit). The offer is paid on arrival. Home on foot when the days are up or they are recalled (hostile, under GW_LEAVE, at war with you, their own war or a horde), as a party with rations from the base, to a base of their choosing (loans baseOfChoice: the nearest, else one under threat or short of hands) [loans sendLoan, walk, loanArrive, endLoan, recallWhy, loansHour].
- **Wanting to stay** (loans stayDaily, stayChance: mood, bonds with your people, days with you, trouble at home): the card "<name> wants to stay with you" (stayCard) with:
  - a request to their group (only while someone wants to and they have not said no; by radio or envoy, envoys KINDS.keep → loans keepAnswer / keepDelivered / keepHome): a yes with no hit or a small one; a no: home at the end, or "Keep them anyway" for more;
  - "Just let them join" (justKeep: dice by standing and type: no reaction, a hit, or a recall of their other loans);
  - or home at the end.
  - Those who stay are yours (joinYou: s.joinedFrom).
- **Standing**: a death costs standing by how (the work they came for −2, a fight −4, otherwise −10); home well +1 [loans loanFell; world killSurvivor].

### Joint operations
- A target, a rendezvous (rendezvousFor) and a day. Each group that agrees sends a party (kind "opparty") that waits there LOAN.WAIT days. The parties to the rendezvous are people with rations like a loan's.
- Your team there joins them as volunteers (volunteers.js: their group's AI on the battle map with volOrder, in crawls, by the numbers). A party that never comes is missed; nobody of yours there costs standing.
- After: a group's people leave your team together as a party walking to a base they choose with their loot share in its goods (volunteers sendHomeAll → loans opTeamHome; settleShare into the party, robbed with it, into their stock when home).
- The share is of the most the cargo held while they were with it (volunteers noteHaul peakOf: spent before it is paid counts as reneging: loans reneged). Fighting together +6 (kind "fight").
- Modules: [loans planOp, joinOp, meet, opHour, proposalCard, aiProposalsDaily; envoys proposeRoute and "propose" envoys; ui/envoys loanButtons, opsBlock, loansBlock, loanBadge (roster, person cards); ui/render rendezvous flag; ui/codex "Volunteers on loan and joint operations"].

## Meeting to trade
The user's request 2026-10-21. Test `tools/trademeettest.js`.
- Asking a group for a trade caravan, or a radio deal with "We meet", names where: one of your bases, halfway along their road to it (halfwayTile), or a tile picked on the map (meetProblem: land, no base, no hive, no horde; meetRefusal: the delivery rule, one way). No fee.
- Their caravan walks there and waits MEET.WAIT_HOURS. Any team of yours on the tile trades with it from what it carries (trade.js context kind "meet": the team's side as a visit, the caravan's as a caravan, both carry limits; a radio deal filled in and honoured), again from the orders card or the caravan stop card.
- The trade caravan planner opens aimed at the tile with your side loaded (meetCaravanForm, a "Meet the … caravan" destination).
- A group calling with an offer may ask to meet halfway when your base is over MEET.OFFER_HOURS away (radio meetOfferCard; the governor declines).
- Groups' trade convoys are a swap both ways out of their own stores (convoyLoad): to the partner's base when near; both to the halfway tile when the road is over MEET.AI_FAR_HOURS (they wait for each other, swap, go home).
- Modules: [trademeet, caravans sendCaravan meetTile, radio radioRequestCaravan offerCard, radiotrade "meet", factions convoys, parties aiPartyHour, ui/tradewindow meetPicker meetRow meetPick*, main.js meetPick mode, ui/codex "Meeting to trade"].

## Outsiders and raider bands
- Outsiders/visitors from beyond the state [visitors].
- Raider bands live as a nomad band does, by the nomads' own code: people records with what they carry; stores and shelf carried by your teams' rule; a day's forage; food and water from their stores (hungry, they lose people); their wounded cared for from their own meds.
- They take only what they can carry and leave the rest; a band broken or wiped out leaves its goods where it ended [visitors raiderDay, addToStock, dropBandGoods; nomads bandRoom, bandFeeds, bandCare].

## Nomads
Modules: [nomads; combat KITS drifters/looters/survivalists/preppers, arsenal KIT_OF nomad0–3, markers "nomadcamp", parties mission "nomads", trade `nomadId`; ui/render, ui/mapselect, ui/codex "Nomads"].
- **Bands**: baseless bands of 3–10 that camp 2–5 days, survey and raid the places within 3 tiles of their camp (the groups' picker and the container ledger: they take what you left in a container) and move on 4–8 tiles.
- **Life**: they forage, eat, drink, starve, fall to the dead or to you. They take in neutral wanderers, refugees and someone off the road up to their tier's cap, each as a person (refugees and strangers made as one who joins you is: recruits makeCandidate): a mouth their stores feed and water and their meds care for, and, up to work, a pair of hands that forages, surveys, raids and carries for the band [nomads recruit, bandHands, bandFeeds, bandCare; bands bandNewcomer; groupmedical].
- **Numbers**: a slow respawn holds them at about half the AI group count (a hardcore run starts with twice that many, thinning back to it). Bands leave after one to two game years; a new band takes the unlocked tier furthest below an even share.
- **Four tiers** unlocked by era, each with its own battle kit:
  - Drifters (the low tier): wary traders who carry only makeshift crafted gear (pipe spears, scrap bats, a scrap crossbow or a pipe shotgun, tyre vests) and start with a few such pieces to trade; share the low slot of the even share with the Looters.
  - Looters: hostile, melee.
  - Survivalists: neutral traders, hunting rifles.
  - Preppers: defensive, rifles and plate, a vehicle.
- **Not a group**: never in `state.factions`; no land, pacts or Coalition.
- Meeting cards by tier; trade through the trade window (their shelf is what their people can carry by your teams' rule, never cut to a size: bandRoom); camps marked on the map once seen; Attack the nomad camp.

## Radio network
Modules: [radio, radiotrade]. Stations and relays, talking to groups, radio deals and radio trades.
- **Radios are mid game** (2026-10-21): starting bases have none, in normal or hardcore mode (the hardcore veteran's grab is a hand-crank radio, not the Military encrypted radio: hardcore-start ARCHETYPES).
  - Only military bases do: the military type's and the Guard's splinters' army sets at every base; a group settled on a military site its radio room (factions createFactions); the hardcore Guard and old saves by type.
- A call needs both sides' sets (radio canRadioGroup / groupHasSet / inRadioReach; the refusal says "no radio of their own").
- The station needs the Radio Engineering Handbook studied or the mid game, year 5, for you and the groups alike (blueprints radioeng unlocks radio, ERA_OPEN / eraOpens / buildLock; groupworks LOCKS.radio, workLock).
- Without a link, envoys (see Envoys above).
- **Radio coverage is a map layer** (the user's request 2026-10-23: "Add to layers radio distance"): the Layers box's Radio coverage (markers LAYERS.radio, on by default; render DEFAULT_LAYERS, the timelapse's LAYER_KEYS).
  - Draws the dashed ring round each of your stations and relays with its reach on the ring's top: Radio 12 tiles, 24 with the military set, Relay 6 tiles; red and "not linked" or "off the air" for a relay not on the net.
  - While you listen in, a tuned group's network dotted in its colour. Unticked, no rings are drawn (ui/render.js; the help's Map layers topic in ui/help.js).

## Your radio and your allies' on the Radio layer
- The user's request 2026-10-23: "Radio layer shows your radio distance and when allied you can see their radio distance".
- Your rings in your blue (PLAYER_COLOR), dashed over a faint wash, "Your radio: 12 tiles" / "Your relay: 6 tiles", "(not linked)" / "(off the air)" when so (radioallies yourRadioRings, yourLabel).
- Allies are Calder Coalition members (alliance isMember / allianceMembers; a pact alone is not). Each with a network of its own (radio groupNetwork: stations at 12, a military group's army sets at 24, linked relay masts at 6, by your rules: ADR 0001; hidden outposts off the air) is drawn dash-dotted in its colour with "<Group> radio: 12 tiles" at the ring's foot (alliedRadioNetworks). Groups outside the coalition are never shown; a tuned channel stays dotted unless it is an ally's.
- One wash per network over the union of its rings; labels moved round the ring to a free spot on screen (ui/render ringLabel, drawLabels alt); rings keep their screen width zoomed out.
- The Layers line shows your reach and each ally's ●N in its colour, its tooltip "Allied: <Group> radio, 12 tiles (linked: you talk by radio | no link to yours: word comes by envoy)" (radioLegend, radioLegendTip; radio canRadioGroup); the tile tooltip names whose radio covers it (radioTipLines; ui/render tileTooltip). ui/help LAYER_HELP, LEGEND, swatch. `tools/radioalliestest.js`.
