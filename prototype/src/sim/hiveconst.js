// @ts-check
// Shared numbers for the hives and their bosses (hives.js, defences.js, hordes.js and the UI). A leaf module: it
// imports nothing, so it is safe to read at load time whatever order the circular sim imports are evaluated in.
export const HIVE = {
  CLUSTER: 5,         // hives this close count as a cluster for income
  START_RES: 5,       // resources of every hive on the map at the start
  RES_CAP: 80,        // a hive stores no more than this
  BOSS_COST: 40,      // a Wallbreaker
  BOSS_DAY: 200,      // no Wallbreakers before this day
  TERRITORY: 4,       // land a hive holds (sites inside show at least 3 skulls)
  RING: 1,            // red-skull ground around the hive: much tougher dead
  RADIATE: 6,         // infection reaches this far
  SUPPORT: 10,        // hives this close to a build site send hordes to it
  DRAW: 6,            // wandering hordes this close to a build site are drawn to it
  SITE_SCORE: 30,     // construction starts at this combined horde score
  SITE_BIOMASS: 1000, // ... and the hive stands when this many of the dead have gone into it
  SITE_INTAKE: 40,    // ... at most this many a day (a quarter of the gathered mass, at least 25): about 25 days
  // New hives (hives.js pickSite): a curve, slow in the first year and faster later, under a cap. Over a span of
  // NEW_SPAN days the hives found at most NEW_CAP[0]–NEW_CAP[1] new hives (by the dice per world) on a Large or Huge
  // map; smaller maps proportionally fewer by their land against a Large map's (NEW_SCALE: worldsize.js worldScale),
  // never under NEW_MIN (Normal 3–5, Small 2–3). The n-th site of a span is due NEW_SPAN × (n / cap) ^ SITE_CURVE
  // days into it (cap 6: days 374, 566, 723, 858, 981, 1095: about a year to the first, then every 4–5 months),
  // ± SITE_JITTER by the dice, never two within SITE_GAP days. The budget renews every span, so the late game is
  // not frozen (eras.js hiveCap still caps the hives standing). The census of 2026-10-06 saw ~16 new hives in three
  // years on a huge map at the old fixed pace of 120–180 days (÷ the area) between sites.
  NEW_CAP: [5, 8], NEW_MIN: 2, NEW_SPAN: 1095, NEW_SCALE: 1.55, SITE_CURVE: 0.6, SITE_JITTER: 0.15, SITE_GAP: 60,
  SITE_MAX: 1,        // build sites at a time
  BORDER_DAYS: [5, 9],
  GUARD_MIN: 40,      // a hive rebuilds its guard below this
  START_ORIGIN: 4,    // hives placed around the outbreak origin at the start on a Normal map (mapgen.js; worldsize.js for the others)
  START_SPOT: 1,      // ... and around each other hot spot (a lone hive: a first target)
  // The share of a defending hive's new roaming hordes it sends to attack a base: ATTACK_START on day 1, up by
  // 1 / ATTACK_RAMP a day, at most ATTACK_MAX (20% at first, 40% on day 30, 65% from about day 70).
  ATTACK_START: 0.2, ATTACK_RAMP: 150, ATTACK_MAX: 0.65,
  LARGE_DAY: 60,      // a defending hive sends out no large roaming / attacking hordes before this day
  ATTACK_RANGE: 45,   // your bases are attacked from at most this far (the groups' from 22)
  PLAYER_PULL: 2.5,   // your bases weigh this much more than the groups' when a hive picks what to attack
  BOSS_GAP: 90,       // days after a hive raises a Wallbreaker before it can raise the next
  BOSS_DEN: true,     // Wallbreakers come only from a hive with a Wallbreaker den (GROWTHS.den); false: the calendar alone (BOSS_DAY)
};
export const BOSS_NAMES = { horde: "Wallbreaker", hive: "Broodmother", hivemind: "Hivemind" }; // hivemind: the heart of a hive, met in its core room (hivecrawl.js)

// ---------- the hive tech tree (hivetech.js) ----------
// A hive grows structures ("growths") on land within TECH.RANGE tiles of itself, bought with its resources and
// taking days to grow. Which ones it may grow is set by its tier: tier t is open once the game is past
// TIER_DAY[t] (stretched by up to JITTER per hive, so the hives do not all evolve on the same day) and the hive
// itself is TIER_AGE[t] days old (a young hive starts at the bottom). The years are the game's 112-day years
// (eras.js). With the defaults: pits, a brood chamber and the worm cyst (Carriers, the first special dead a hive
// breeds: CARRIER below) from the start, runners and feeding grounds from year 2 (the early game), brutes, spitters,
// Bonebacks, Climbers, Flingers, Sowers and Nightmares from year 5–6 (the mid game: middead.js), screamers, crawlers
// and the Wallbreaker den
// from year 10–13 (the late game: no Wallbreakers before), the mutation vat (elite dead) from year 13–17. Every number
// the tree uses is here.
export const TECH = {
  RANGE: 2,             // growths stand within this many tiles of their hive
  MAX: 10,              // growths a hive keeps at most (withered ones not counted; also limited by the free tiles)
  TIER_DAY: [0, 120, 450, 995, 1331], // game day each tier opens (tiers 0–4): game years 2, 5, 10, 13 (eras.js: 112-day years; tier 3 opens with the late game, eras.js; 1100 / 1500 before the progression census of 2026-10-09)
  TIER_AGE: [0, 20, 90, 200, 400],     // ... and the age in days a hive needs for it
  JITTER: 0.35,         // per hive: a tier opens up to 35% later than its day
  GAP: 12,              // days between a hive starting one growth and the next
  SAVE_DAYS: 20,        // a growth a hive cannot afford yet: it sends out no new roaming hordes for up to this many days to save for it
  THREAT_DAYS: 60,      // a hive attacked within this many days builds for defence (brood chamber first)
  HP: 100,              // a growth's flesh: fires burn it down; it regrows REGROW a day
  REGROW: 5,
  DECAY_DAYS: 40,       // the growths of a destroyed hive wither and are gone after this many days
  RUMOUR: 0.4,          // chance a growth finished out of sight, at a hive you know of, reaches you as a rumour
  BORDER_DAY: 900,      // border hordes carry the special dead of the era (at BORDER_SHARE of a hive's mix) from this day (game year 9)
  BORDER_SHARE: 0.5,
  MIX_MAX: 0.45,        // at most this share of a horde is special dead; the rest are ordinary
  // Burning a growth (the Burn the growth mission): its guard, the fires and the Molotovs.
  GUARD_BASE: 6, GUARD_PER: 40, GUARD_MAX: 12, // 6 of the dead + 1 per 40 in the hive's guard, at most 12
  FIRE_FUEL: 4, FIRE_DMG: 60, BOMBS: 2, BOMB_DMG: 100,
  SPIRE_RANGE: 10,      // a screamer spire: its hive attacks bases this much farther away
  SPIRE_CALL: 6,        // ... and calls wandering dead within this many tiles into its guard (SPIRE_ODDS a day each)
  SPIRE_ODDS: 0.3,
  ELITE_HP: 1.3, ELITE_DMG: 1.2, ELITE_WEIGHT: 1.25, // a mutation vat's special dead
};

// The Carrier (carriers.js): one of the dead so full of the worm that it is swollen with it. Every number it and its
// worm swarm use is here (their battle stats in ZTYPES carrier / swarm).
// - A human body (anyone killed: your people, raiders, soldiers, neutrals; never one of the dead) within RANGE tiles
//   of a Carrier (diagonals count as 1) gets up at once as one of the dead: on the Carrier's own turn, or at the
//   start of the enemy turn for a body killed during yours. No warning: a body near a Carrier is a danger (the map
//   marks it). Crush its skull from next to it (1 action, silent), shoot it from range (a double tap: 1 action, ammo,
//   noise), burn it (fire on its tile: the body and everything on it are gone), or pick it up and carry it off.
//   A Carrier walks to a body within SEEK tiles when none of the living is next to it.
// - The risen keep what the person wore: worn armour still takes its share of every hit; they use no guns. Killed,
//   the body has the person's things to take off; your own fallen get up as "Dana (turned)".
// - Killed, a Carrier bursts: a worm swarm comes out where it fell (quick, weak; single shots go through it, SHOT;
//   shotguns do SHOTGUN of their damage; blades, blows, blasts and fire are the answer). Each of its hits on
//   someone living leaves the worm in them INFEST of the time (worm.js catchWorm); someone it kills always has it.
//   Whoever has the worm and dies, anywhere and any time later, gets up. With no host to go to the swarm sinks into
//   the ground after SWARM_TURNS turns.
// - Carrying a body (carriers.js pickUp): CARRY × the move distance (half of it), no shooting; put down with another
//   action, or into the team's car (a raid's vehicle zone; a field battle's evac strip) if the car has room for it:
//   a body weighs BODY_KG plus its things (parties.js bodyLoad) and counts in the team's load and capacity like
//   any cargo until it is buried or burned. A body in the car cannot rise and comes home: bury it (its things to the armory) or burn it (Armory tab). Left unburied with the worm in
//   it, it gets up at the base after BASE_RISE nights.
// - Walking loot (carriers.js walkOff / placeWalking): the gear of one of the risen still walking when a battle ends
//   goes into state.walkingLoot with its tile. A battle made within WALK_RADIUS tiles of an entry (nearer = likelier,
//   WALK_CHANCE at the tile itself, at most WALK_MAX a battle) has one of its ordinary dead marked as that risen
//   person, in their armour, and its body is looted as usual. Each day an entry drifts a step (DRIFT: the chance;
//   DRIFT_HIVE: toward the nearest hive, else at random), so the dead seem to wander.
// - The worm cyst (GROWTHS.cyst) costs CYST_COST and grows in CYST_DAYS days. It is tier 0, so Carriers are the
//   first special dead a hive breeds: a young hive grows its first biomass pit, then the cyst (about the second
//   month); runners only come with tier 1 (year 2).
export const CARRIER = {
  RANGE: 2,        // a body this close (Chebyshev) to a Carrier gets up
  SEEK: 8,         // a Carrier walks to a body this close when none of the living is next to it
  RISE_AP: 1,      // the risen get up with this many actions on their first turn
  SWARM_TURNS: 6,  // the swarm sinks into the ground after this many enemy turns
  SHOT: 0.15,      // × the damage a single bullet or bolt does to the swarm (pistols, rifles, carbines, bows: most of it goes through)
  SHOTGUN: 1,      // × a shotgun's (data.js GEAR cat "shotgun": the spread catches it)
  MELEE: 0.9, BASH: 1.25, BLAST: 1.5, // × a blade's, a blow's (a club, a gun butt, a boot), a blast's
  INFEST: 0.35,    // a swarm's hit on someone living leaves the worm in them this often (a kill always does)
  CARRY: 0.5,      // × the move distance while carrying a body (combat.js MOVE 5 → 2.5 tiles an action)
  BODY_KG: 70,     // what a body weighs in the car, on top of its things (parties.js bodyLoad)
  BASE_RISE: 1,    // a body with the worm brought home and left unburied gets up after this many nights
  WALK_RADIUS: 8,  // walking loot is met in battles this many tiles from where it drifted to
  WALK_CHANCE: 0.6, // ... this often on the tile itself, falling off with distance
  WALK_MAX: 2,     // at most this many of the walking dead in one battle
  DRIFT: 0.5,      // each day an entry moves a tile this often ...
  DRIFT_HIVE: 0.7, // ... toward the nearest hive this often, else at random
  CYST_COST: 18, CYST_DAYS: 15,
};

// The growths. tier: the tier it needs; cost / days: resources and days to grow; max: per hive; unlocks: the kind of
// dead it lets the hive breed (ZTYPES); income: + resources a day; incomeMult: × the hive's income; guard / out:
// + its guard's minimum and + hordes out at once; boss: Wallbreakers need one (HIVE.BOSS_DEN); elite: the special
// dead are elite; spire: the screamer spire. danger: how much the autopilot wants it gone (hivetech.js).
export const GROWTHS = {
  pit:      { name: "Biomass pit",     tier: 0, cost: 12, days: 10, max: 2, income: 1, danger: 1,
              desc: "A pit of rotting flesh the hive feeds on: +1 resource a day." },
  brood:    { name: "Brood chamber",   tier: 0, cost: 20, days: 15, max: 1, guard: 40, out: 1, outTier: 2, danger: 2,
              desc: "Swollen sacs where the dead are kept: the hive's guard is 40 bigger, and once the hive has evolved to tier 2 one more of its hordes can be out." },
  // The first special dead a hive breeds (CARRIER above): tier 0, but a young hive grows its first pit before it.
  cyst:     { name: "Worm cyst",       tier: 0, cost: CARRIER.CYST_COST, days: CARRIER.CYST_DAYS, max: 1, unlocks: "carrier", danger: 2,
              desc: "A swollen bladder of the worm the dead are fed into: the hive's hordes bring Carriers, bloated dead that raise the human dead around them and burst into a worm swarm when killed." },
  feeding:  { name: "Feeding grounds", tier: 1, cost: 25, days: 20, max: 1, incomeMult: 1.5, danger: 1.5,
              desc: "A field of bones and offal: the hive's income is half again as much." },
  warren:   { name: "Runner warren",   tier: 1, cost: 25, days: 20, max: 1, unlocks: "runner", danger: 2.5,
              desc: "Tunnels the fast dead nest in: the hive's hordes bring runners." },
  brutepit: { name: "Brute pit",       tier: 2, cost: 35, days: 30, max: 1, unlocks: "brute", danger: 3.5,
              desc: "A pit where the dead are fed until they swell: the hive's hordes bring brutes that batter walls." },
  sac:      { name: "Spitter sac",     tier: 2, cost: 35, days: 30, max: 1, unlocks: "spitter", danger: 3,
              desc: "Bloated bladders of acid: the hive's hordes bring spitters that hit you behind cover." },
  spire:    { name: "Screamer spire",  tier: 3, cost: 40, days: 40, max: 1, unlocks: "screamer", spire: true, danger: 3.5,
              desc: "A shrieking tower of fused bodies: the hive's hordes bring screamers, it attacks bases from farther away and calls wandering dead in." },
  burrow:   { name: "Crawler burrow",  tier: 3, cost: 40, days: 40, max: 1, unlocks: "crawler", danger: 4,
              desc: "Holes the legless dead crawl out of: the hive's hordes bring crawlers that slip past walls." },
  den:      { name: "Wallbreaker den", tier: 3, cost: 50, days: 45, max: 1, boss: true, danger: 5,
              desc: "A cave of bone where Wallbreakers are grown: the hive can raise Wallbreakers." },
  vat:      { name: "Mutation vat",    tier: 4, cost: 60, days: 60, max: 1, elite: true, danger: 4.5,
              desc: "A boiling vat of flesh: the hive's special dead are elite (tougher and harder hitting)." },
  // The Shepherd (SHEPHERD below): the late game's answer to decoys and fire. Tier 3 opens around game year 10
  // (TIER_DAY[3] = day 1100); a hive weighs it like its other late spawners.
  fold:     { name: "Shepherd's fold", tier: 3, cost: 45, days: 45, max: 1, unlocks: "shepherd", danger: 4.5,
              desc: "A ring of standing bodies around one that watches: the hive's hordes are led by Shepherds that are not fooled by decoys or fire." },
  // The mid game's special dead (middead.js, MIDDEAD below): tier 2, from game year 5, beside the brute pit and the
  // spitter sac. A hive grows only some of them (TECH.MAX growths), so no two hives field quite the same hordes.
  ossuary:  { name: "Ossuary",         tier: 2, cost: 35, days: 30, max: 1, unlocks: "boneback", danger: 3,
              desc: "A heap of fused bones the dead lie in until plates grow over their chests: the hive's hordes bring Bonebacks, armoured in front and soft behind." },
  scaffold: { name: "Sinew scaffold",  tier: 2, cost: 35, days: 30, max: 1, unlocks: "climber", danger: 3.5,
              desc: "A frame of stretched sinew the dead climb day and night: the hive's hordes bring Climbers that go over walls and fences." },
  wormpit:  { name: "Worm pit",        tier: 2, cost: 35, days: 30, max: 1, unlocks: "flinger", danger: 3.5,
              desc: "A pit seething with the worm, and long-armed dead scooping at it: the hive's hordes bring Flingers that throw worm swarms." },
  cistern:  { name: "Egg cistern",     tier: 2, cost: 30, days: 30, max: 1, unlocks: "sower", danger: 3,
              desc: "A pool of rot thick with the worm's eggs: the hive's hordes bring Sowers that seed the land they cross with eggs." },
  hollow:   { name: "Dread hollow",    tier: 2, cost: 40, days: 40, max: 1, unlocks: "nightmare", danger: 4,
              desc: "A pit in the ground that screams at night: the hive's hordes bring Nightmares whose scream sends your people running." },
  // The counter-dead (counterdead.js, tunnels.js; COUNTER below): tier 2, bred in answer to the defences of the bases
  // the hive's hordes go for (counter: the hive grows one only once its read of those defences asks for it).
  tunnels:  { name: "Tunnel mound",    tier: 2, cost: 35, days: 30, max: 1, unlocks: "digger", counter: true, danger: 3.5,
              desc: "A mound of turned earth over a warren of burrows: the hive's hordes bring Diggers that tunnel under walls and trenches." },
  meltpool: { name: "Melt pool",       tier: 2, cost: 35, days: 30, max: 1, unlocks: "melter", counter: true, danger: 3.5,
              desc: "A steaming pool of acid the dead wallow in: the hive's hordes bring Melters whose acid eats through walls and gates." },
  huskbed:  { name: "Husk bed",        tier: 2, cost: 30, days: 25, max: 1, unlocks: "husk", counter: true, danger: 3,
              desc: "A bed of drying hides and bone: the hive's hordes bring Husks that wire and spike pits barely hurt." },
  blastscar:{ name: "Blast scar",      tier: 2, cost: 30, days: 25, max: 1, unlocks: "tripper", counter: true, danger: 3,
              desc: "Scorched, cratered ground the dead keep blundering over: the hive's hordes bring Trippers that walk ahead and set off your mines." },
  gloom:    { name: "Gloom pit",       tier: 2, cost: 35, days: 30, max: 1, unlocks: "darkwalker", counter: true, danger: 3.5,
              desc: "A pit no light reaches: the hive's hordes bring Dark-walkers that keep out of the light and that floodlights do not show." },
};

// ---------- the counter-dead (counterdead.js, tunnels.js) ----------
// The defences a base relies on, as a hive reads them (counterdead.js defenceProfile, 0–1 each): walls (the wall's
// strength, the gate, the barricades), trench, wire (barbed and concertina wire, spike pits), mines, light (lit
// floodlights, the watchtower, guard towers). The kinds that answer each (ZTYPES counters): walls Diggers, Melters,
// Climbers; trench Diggers; wire Husks; mines Trippers; light Dark-walkers.
// Adaptation (counterdead.js adaptDaily): each hive keeps a read of those (hive.adapt), moving READ of the way a day
// toward what the bases its hordes may attack have built (yours within its attack range, a group's within GROUP_RANGE:
// the same rule a hive picks its targets by, hives.js attackTarget), and HIT of the way at once when one of its hordes
// meets a base's defences (defences.js atTheWalls, every base alike). A counter growth is wished for once a read
// reaches MIN (WISH_BASE + WISH × the read in growthWish); a counter kind's share in a new horde is × (1 + MIX × the
// read), its odds + ODDS × the read.
// By the numbers (counterdead.js counterCut): each kind takes CUT[kind][part] × its share of the horde off that part of
// the defence (walls: the wall's hold; gate, barricades, trench, wire, light: their bonus to the hold limit; pits: the
// dead the spike pits take; mines: the dead the mines take, the mines spent on Trippers), each part at most MAX.
export const COUNTER = {
  PARTS: ["walls", "trench", "wire", "mines", "light"],
  READ: 1 / 30, HIT: 0.35, MIN: 0.2, WISH_BASE: 1.5, WISH: 4, MIX: 1.5, ODDS: 0.25, GROUP_RANGE: 22,
  CUT: {
    digger: { walls: 2, trench: 4 }, melter: { walls: 2.5, gate: 4, barricades: 4 },
    husk: { wire: 4, pits: 4 }, tripper: { mines: 5 }, darkwalker: { light: 4 },
  },
  MAX: 0.75,
  // Breeding (counterdead.js payCounters, from hives.js buy): a hive pays for each of the counter-dead in a new horde
  // (ZTYPES breed: resources each, about 0.8 a point of the kind's weight over an ordinary dead's; an ordinary one costs
  // a medium horde's 8 / 65 ≈ 0.12), after the horde's own cost; short of it, it brings as many as it can pay for. The
  // counter-dead are at most KIND_MAX of a horde each and SHARE_MAX together (within TECH.MIX_MAX of all the special).
  KIND_MAX: 0.12, SHARE_MAX: 0.2,
  // Battle: a Husk walks through wire and spike pits unhurt and unstopped; a Melter's blows at a wall section, the gate,
  // a door or a barricade do MELT × (combat.js UNIT_SIEGE melter); a Tripper sniffs out mines within SNIFF tiles and
  // walks onto them, taking BLAST of a blast; a Dark-walker is low in the dark (a crawler's reveal), floodlit ground
  // does not show it, and it keeps off lit cells (LIT: the cost it weighs a lit cell at).
  MELT: 4, SNIFF: 6, BLAST: 0.35, LIT: 6,
};
// The Digger's tunnels (tunnels.js). It goes down only on bare ground (a cell of kind GROUND with a floor in FLOORS:
// dirt, grass, a field; never a road, a floor, gravel, rubble, water) and comes up only on bare ground, at most RANGE
// cells (Chebyshev) away, under anything between (walls, gates, buildings, wire, trenches, mines: nothing is set off).
// It digs PER_TURN cells a turn, unseen; it digs only when the tunnel saves GAIN moves of walking (or battering).
// The tunnel stays open: the dead crawl through it (in at one end, out at the other: CRAWL moves a cell, a turn under
// for every two actions' moves of theirs, at least one), the pathing links its ends (combat.js reachable / distField).
// A blocked exit: it waits under up to WAIT turns, then comes up at the free bare cell nearest it (never on an
// occupied, unwalkable or mined cell). Your people see a hole once one of theirs has had it in sight, or when the dead
// come up out of it in their view; they can stand on a hole to block it.
// On your base's map (the fort map: the base map) the open tunnels are kept on the base (base.tunnels) and every fight
// there starts with them until they are filled: Fill tunnel, a job in the construction queue (FILL_BASE + FILL_PER
// work-hours a cell), worked by the builders. By the numbers each open tunnel takes HOLD of the walls' hold (at most
// HOLD_MAX), and every EVERY Diggers at walls that held dig one (at most NUM an attack, LEN cells long) where no battle
// map is fought (your walls that held, a group's base); a group's crew fills GROUP_DAY work-hours a day of theirs.
export const DIG = {
  FLOORS: ["dirt", "grass", "field"], GROUND: ["open", "bush"],
  RANGE: 8, PER_TURN: 3, GAIN: 4, CRAWL: 1.5, WAIT: 3,
  EVERY: 8, NUM: 2, LEN: [5, 9], HOLD: 0.08, HOLD_MAX: 0.4,
  FILL_BASE: 4, FILL_PER: 2, GROUP_DAY: 16,
};
// The dead met away from a hive's hordes broaden with the years (deadpool.js; zombietypes.js ambientMix): the era's
// kinds are shaped by the place (AFFINITY: × a kind's share by the kind of place, the total kept), the counter kinds
// at WILD of their share there (bred in answer to walls, rarer in the wild); and from START_DAY on, beyond the hives:
// soldiers out of the military sites within MIL_RANGE tiles (MIL_YEAR a year, at most MIL_MAX, less with the distance),
// riot police in towns and cities (RIOT_YEAR, at most RIOT_MAX), the dead beasts of the countryside's ground
// (BEAST_YEAR, at most BEAST_MAX, by the terrain's kinds), all × the run's Zombie damage dial (DIAL: its power).
// A hive's brood (hivecrawl.js) gets BROOD_YEAR a year (at most BROOD_MAX) of the era's kinds it does not breed.
export const POOL = {
  AFFINITY: {
    city: { climber: 1.6, screamer: 1.4, spitter: 1.3, melter: 1.3, darkwalker: 1.4, carrier: 1.2, runner: 0.8, digger: 0.5 },
    town: { runner: 1.2, carrier: 1.2, climber: 1.2, flinger: 1.2, nightmare: 1.2 },
    other: { runner: 1.4, crawler: 1.6, digger: 1.6, husk: 1.3, sower: 1.4, climber: 0.7, melter: 0.7 },
    military: { brute: 1.8, boneback: 1.8, tripper: 1.6, husk: 1.4, runner: 0.7 },
  },
  WILD: 0.5, START_DAY: 60,
  MIL_RANGE: 3, MIL_YEAR: 0.025, MIL_MAX: 0.15,
  RIOT_YEAR: 0.008, RIOT_MAX: 0.06,
  BEAST_YEAR: 0.012, BEAST_MAX: 0.08,
  BROOD_YEAR: 0.02, BROOD_MAX: 0.12,
  DIAL: 0.5,
};

// ---------- the mid game's special dead (middead.js) and the Sleepers (sleepers.js) ----------
// Bonebacks: a hit from the half a Boneback faces does FRONT of its damage (a critical one CRIT_FRONT), from the side
// or behind all of it; fire gets round the plates, a blast BLAST. Hit, it turns to face whoever hit it.
// Climbers: go over the cells in CLIMB (a wall section, a fence, a barricade, cars, crates...) at COST extra moves a
// cell, never stopping on one, and up or down a level without a ladder; at a base's walls SLIP of them get over even
// when the horde is held, less TOWER with a watchtower and MANNED with the defences manned.
// Flingers: wind up for a turn (WINDUP), then throw a worm swarm up to RANGE tiles: it lands next to whoever it was
// thrown at. COOLDOWN turns between throws, THROWS a battle. A hit of DROP or more while it winds up (or any blow
// from next to it) makes it drop the mass at its own feet; killed while winding up, the same.
// Sowers: on the State Map each tile a horde with Sowers crosses gets PER × (the Sowers in it) Infection, at most
// PASS a pass and never above CAP; it fades back as Infection always does (hives.js radiate). In battle, each enemy
// turn a Sower is on its feet the battle's infection (more dead drawn by noise, faster Heat) rises BATTLE, at most
// BATTLE_MAX over where it started.
// Nightmares: every EVERY turns (from the first time they see your people) a scream: Heat + HEAT in a raid, NOISE in
// any battle (the dead it draws), every one of the dead within WAKE tiles wakes, and your people within RANGE tiles
// who fail their nerve (HOLD + their own: brave, cowardly) panic and spend their next turn running.
export const MIDDEAD = {
  BONEBACK: { FRONT: 0.3, CRIT_FRONT: 0.5, BLAST: 0.7 },
  CLIMBER: {
    CLIMB: ["palisade", "fence", "barricade", "sandbag", "crate", "hay", "car", "truck", "rock", "boulder", "well", "barrel", "pump", "counter", "table", "bed"],
    COST: 1, SLIP: 0.5, TOWER: 0.4, MANNED: 0.3,
  },
  FLINGER: { RANGE: 7, WINDUP: 1, COOLDOWN: 2, THROWS: 3, DROP: 10 },
  SOWER: { PER: 0.015, PASS: 0.2, CAP: 0.95, BATTLE: 0.05, BATTLE_MAX: 0.3, NOTE_RANGE: 1 },
  NIGHTMARE: { EVERY: 3, RANGE: 6, WAKE: 12, HEAT: 15, NOISE: 4, HOLD: 0.3, BRAVE: 0.3, COWARD: -0.2, NEAR: 0.1 },
};
// Sleepers (sleepers.js): bodies lie about every battle map in the open and every raid (COUNT by the map's area, more
// on infected ground: PER_INF), at least AWAY tiles from where your people start. Each is a Sleeper at ODDS (+
// ODDS_INF × the tile's Infection, at most ODDS_MAX): a body so full of the worm that it splits open when anyone
// living comes next to it, and SWARMS worm swarms pour out (the first bites at once unless it was spotted). Your
// people spot one within SPOT_RANGE tiles in sight at SPOT + SPOT_PER × Scouting (at most SPOT_MAX), once a turn a
// body: spotted, it can be shot from afar (it splits where it lies) or burned (the worms cook: no swarm).
export const SLEEPER = { COUNT: 4, AREA: 32 * 24, PER_INF: 4, MAX: 9, AWAY: 6, ODDS: 0.15, ODDS_INF: 0.25, ODDS_MAX: 0.45, SWARMS: 1, SPOT_RANGE: 3, SPOT: 0.2, SPOT_PER: 0.03, SPOT_MAX: 0.8 };

// The dead beasts (deadbeasts.js): animals that died of the worm and walk, full of it, on the hills, in the woods and
// over the farmland, and the pets that died of it in the towns and cities (never on a base's tile). They are among a tile's dead there
// (beastMix: shares by the ground, as the armoured dead are by the site; deadbeasts.js has the words): a dead stag on
// the hills and in the woods, a dead hog in the woods and by the farms, dead dogs and dead cattle where the farms were.
// LAND: the shares by terrain in the countryside; TOWN: the dead pets (dogs and cats) by terrain in the suburbs and
// cities (a town site in the countryside counts as suburb); SITE: more at a farm, barn or ranch, and the pets in the
// houses, neighbourhoods, motels and apartment blocks (data.js LOCATIONS of those types);
// HERD: an infested herd on the tile (worm.js state.herds) adds this much of its own kind (deer → stag, hog → hog).
// The ground's Infection scales them: × (FLOOR + PER_INF × infection), at most 1; and only ODDS of tiles have them
// in a week (a hash of the seed, the tile and the week: no world dice, the same tile the same beasts). INFEST: a
// bite that someone living stands leaves the worm in them this often (a kill INFEST_KILL); BURST: killed, each kind
// bursts into a worm swarm this often (never when fire killed it: the worms cook). PACK: a dead dog's bite is this
// much surer for each other dead dog next to its target (at most PACK_MAX). Hordes crossing such land at HORDE_INF
// infection or more pick some up (HORDE_ODDS a pass, HORDE_ADD, up to HORDE_MAX). CARD: the travel card's odds.
// LOCKED: the pets shut in a raid's locked house, let out when its door is opened.
export const BEASTS = {
  LAND: { hills: { deadstag: 0.1, deadhog: 0.03 }, forest: { deadstag: 0.07, deadhog: 0.08, deadhound: 0.02 }, plains: { deadhound: 0.07, deadcow: 0.05, deadhog: 0.04 } },
  TOWN: { suburb: { deadhound: 0.07, deadcat: 0.05 }, city: { deadhound: 0.04, deadcat: 0.06 } },
  SITE: { farm: { deadcow: 0.12, deadhound: 0.12 }, barn: { deadcow: 0.14, deadhound: 0.08 }, ranch: { deadcow: 0.16, deadhound: 0.1 }, lodge: { deadstag: 0.06 }, cabin: { deadstag: 0.04 }, campground: { deadhound: 0.05 },
          house: { deadhound: 0.12, deadcat: 0.1 }, neighbourhood: { deadhound: 0.12, deadcat: 0.08 }, motel: { deadcat: 0.08, deadhound: 0.05 }, apartments: { deadcat: 0.12, deadhound: 0.05 }, town: { deadhound: 0.08, deadcat: 0.06 } },
  HERD: { deer: ["deadstag", 0.12], hog: ["deadhog", 0.12] },
  FLOOR: 0.35, PER_INF: 1.3, ODDS: 0.6,
  INFEST: 0.2, INFEST_KILL: 0.6, BURST: { deadstag: 0.35, deadhog: 0.6, deadhound: 0.2, deadcow: 1, deadcat: 0.15 },
  PACK: 8, PACK_MAX: 16,
  HORDE_INF: 0.3, HORDE_ODDS: 0.25, HORDE_ADD: 0.03, HORDE_MAX: 0.08,
  SEARCH_THREAT: 3, // the hour-by-hour search (scavenge.js): + threat per point of the mix's extra weight
  CARD: 1.5, // the travel card's weight (events.js "deadbeasts") on a tile that has them
  // Pets shut in a raid's locked house (deadbeasts.js shutInPets / releasePets; locks.js lockRaid / openLock): a locked
  // room of one of these kinds on a tile that has dead pets holds ODDS of the time COUNT[0]–COUNT[1] of them (the
  // tile's likelier kind), which come out at whoever opens the door.
  LOCKED: { ODDS: 0.55, COUNT: [1, 3], ROOMS: ["house", "farmhouse", "cabin", "garage", "kitchen"] },
};

// The special dead in a hive's new horde (hivetech.js hiveMix): each kind the hive breeds comes along at ODDS of the
// horde's size (+ TIER a tier the hive is past the growth's own, + BROOD with a brood chamber, at most MAX), no more
// than KINDS kinds (+1 at tier 3, +1 at tier 4); its guard brings every kind at GUARD. A hive fights its assault with
// at least ASSAULT of every kind it breeds (hives.js hiveForce), never more than ASSAULT_SHARE of the brood.
export const HORDEMIX = {
  ODDS: { small: 0.3, medium: 0.5, large: 0.7 }, KINDS: { small: 2, medium: 3, large: 4 },
  TIER: 0.08, BROOD: 0.1, MAX: 0.95, GUARD: 0.85, ASSAULT: 1, ASSAULT_SHARE: 0.6,
};
// The special dead met away from a hive's hordes (zombietypes.js ambientMix): in towns and cities they grow more
// common with every game year (PER_YEAR, at most MAX by the kind of place), of the kinds the hives have grown by then
// (the calendar's tier); on a hive's land TERRITORY more, and on the red-skull ring around a hive RED more of the kinds
// that hive breeds. All together at most CAP of the dead.
export const AMBIENT = {
  PER_YEAR: { city: 0.035, town: 0.025, other: 0.012 }, MAX: { city: 0.3, town: 0.22, other: 0.1 },
  TERRITORY: 0.1, RED: 0.3, CAP: 0.5,
};

// The Shepherd: a smarter dead thing that keeps behind its pack (KEEP tiles from your people), steps around fire,
// and herds the dead within AURA tiles: they ignore decoys and fire, go for the living, the breaches and the gate a
// ram is battering, and keep together. Kill it and the aura ends. On the State Map a horde led by one turns for a
// decoy (a fire, decoys from the armory) only DECOY_CUT as often, and the warning card says so.
export const SHEPHERD = { AURA: 4, KEEP: 6, DECOY_CUT: 0.3, YEAR: 10 };
// What the dead follow (decoys.js): noise (bottles, noise makers, firecrackers, an alarm clock, a radio, gunfire),
// light (a flare, fire, floodlights) and heat (hand warmers, a heat pack, a flare, fire). The ordinary dead follow
// noise and light; each special kind has its own (ZTYPES senses); Wallbreakers and Broodmothers follow nothing.
export const SENSES = { ordinary: ["noise", "light"], boss: [] };

// The special dead (zombietypes.js on the battle map; hives.js, hordes.js, defences.js on the State Map).
// Battle: hp and dmg × an ordinary zombie's of the same power, aim + its melee aim, mob tiles per action, armor ×
// the damage it takes. Map: share = its part of a horde from a hive that breeds it; wall = how hard each one presses
// the walls (× against the hold limit); weight = its worth in a fight resolved by the numbers and in a horde's
// strength. special / counter: shown in the game (tile panel, Help).
// senses: what decoys and fire pull it toward (decoys.js; SENSES.ordinary for the rest). burn: × the fire's damage.
export const ZTYPES = {
  runner:   { name: "Runner",   short: "R", hp: 0.85, dmg: 1.0, aim: 5, mob: 6, armor: 1, share: 0.15, wall: 0.9, weight: 1.15, speed: 1.25, senses: ["noise"],
              special: "Very fast: crosses the battle map in a turn; hordes with many of them move a quarter faster. Follows noise.",
              counter: "Walls and overwatch: behind walls they are just more of the dead. A noise decoy pulls them off." },
  brute:    { name: "Brute",    short: "B", hp: 2.4, dmg: 1.5, aim: 5, mob: 2.5, armor: 0.75, share: 0.08, wall: 2.5, weight: 2.2, smash: 0.6, smashEvery: 12, senses: ["noise"], burn: 0.6,
              special: "Huge and slow, shrugs off a quarter of every hit and smashes barricades and walls in its way; every dozen in a horde smashes a defence like a Wallbreaker. Follows noise; fire hurts it less.",
              counter: "Armor against its blows, heavy guns at range, spike pits and trenches." },
  spitter:  { name: "Spitter",  short: "S", hp: 0.9, dmg: 1.0, aim: 0, mob: 3, armor: 1, share: 0.08, wall: 1.4, weight: 1.6, spitAim: 50, priority: 1.6, keep: 4, cooldown: 2, pierce: 1, senses: ["noise", "light"], // weight: its acid burst too (acid.js)
              special: "Spits acid up to 6 tiles away every other turn; cover counts one step less against it. When it dies its sac bursts: acid splashes everyone living within a tile and pools there for 3 turns.",
              counter: "Smoke, shooting it first from range; kill it away from your people, not in their midst." },
  screamer: { name: "Screamer", short: "Sc", hp: 0.8, dmg: 0.6, aim: 0, mob: 3, armor: 1, share: 0.03, wall: 1.2, weight: 2.0, priority: 2.5, keep: 5, every: 2, calls: [1, 2], callMax: 6, pull: 3, pullOdds: 0.3, senses: [],
              special: "Hangs back and shrieks every other turn, calling more of the dead in from the edge (up to 6 a battle); on the map its horde pulls wandering dead in. Ignores decoys.",
              counter: "Kill it first: the calling stops when it dies." },
  crawler:  { name: "Crawler",  short: "C", hp: 0.8, dmg: 1.2, aim: 10, mob: 3, armor: 1, share: 0.06, wall: 0.5, weight: 1.3, reveal: 2.5, ambush: 1.6, slip: 0.6, senses: ["heat"],
              special: "Low in the grass: unseen until it is within 2 tiles, in light or has struck, and its first bite hits hard. At the walls some slip past and attack inside. Follows heat.",
              counter: "Watchtowers and floodlights (they see them coming), flares, keeping your people together. Hand warmers and heat packs pull them out of hiding." },
  // The Carrier and its worm swarm (CARRIER above, carriers.js). No growth breeds the swarm (share 0): it only comes
  // out of a Carrier. swarm armor 1: what a hit does to it is by the kind of hit (carriers.js swarmArmor).
  carrier:  { name: "Carrier",  short: "Ca", hp: 1.5, dmg: 0.8, aim: 0, mob: 2.5, armor: 1, share: 0.06, wall: 1.1, weight: 1.5, priority: 2, burn: 1.3,
              special: `Bloated with the worm and slow. A human body within ${CARRIER.RANGE} tiles of it gets up at once as one of the dead, wearing what the person wore. Killed, it bursts into a worm swarm. It never raises the dead.`,
              counter: "Shoot it before it reaches the bodies, and not next to your people (the swarm). Crush a body's skull (U) from next to it, double tap it from range (J), burn it, or carry it off (P) before the Carrier gets near." },
  swarm:    { name: "Worm swarm", short: "W", hp: 0.7, dmg: 0.6, aim: 15, mob: 4, armor: 1, share: 0, wall: 1, weight: 1, burn: 2.5,
              special: `Worms from a burst Carrier: quick and weak, but a single bullet or bolt goes straight through it (${Math.round(CARRIER.SHOT * 100)}% of the damage). Each bite can leave the worm in someone (${Math.round(CARRIER.INFEST * 100)}%): whoever has it gets up when they die, now or later. Whoever it kills gets up as one of the dead. It sinks into the ground after ${CARRIER.SWARM_TURNS} turns.`,
              counter: "Single shots pass through it: use shotguns, blasts or fire; blades and blows work. Or keep away until it sinks, and watch anyone it bit for the worm." },
  shepherd: { name: "Shepherd", short: "Sh", hp: 1.6, dmg: 0.8, aim: 0, mob: 3, armor: 0.85, share: 0.02, wall: 1.6, weight: 2.6, priority: 3, keep: SHEPHERD.KEEP, senses: [], aura: SHEPHERD.AURA,
              special: `Stays behind its pack and steps around fire. The dead within ${SHEPHERD.AURA} tiles of it ignore decoys and fire, go for the living and the breaches, and keep together.`,
              counter: "Kill it first, at range: the aura ends with it. Until then decoys and fire are wasted on its pack." },
  // The mid game (MIDDEAD above, middead.js). front: × the damage a hit from the front does to a Boneback.
  boneback: { name: "Boneback", short: "Bb", hp: 1.4, dmg: 1.1, aim: 5, mob: 2.5, armor: 1, share: 0.08, wall: 1.6, weight: 1.8, senses: ["noise"],
              special: `Plates of bone grown over its chest and face: a hit from the front does ${Math.round(MIDDEAD.BONEBACK.FRONT * 100)}% of its damage, from the side or behind all of it. Hit, it turns to face whoever hit it. Slow.`,
              counter: "Flank it: two shooters from different sides, or hit it from behind while it turns on someone else. Fire gets round the plates." },
  climber:  { name: "Climber", short: "Cl", hp: 0.8, dmg: 1.0, aim: 5, mob: 3.5, armor: 1, share: 0.08, wall: 1.3, weight: 1.4, slip: MIDDEAD.CLIMBER.SLIP, senses: ["noise", "light"], counters: ["walls"], answers: "walls and wall stands",
              special: "Thin, with hooked fingers: it goes over walls, fences, barricades, cars and crates instead of breaking them, and climbs onto walkways without a ladder. At a base's walls some of them get over even when the horde is held.",
              counter: "Defenders inside the walls as well as on them, a watchtower over the yard, overwatch. A building with its doors shut keeps them out." },
  flinger:  { name: "Flinger", short: "Fl", hp: 1.1, dmg: 0.9, aim: 0, mob: 2.5, armor: 1, share: 0.05, wall: 1.3, weight: 1.7, priority: 2.2, keep: 5, senses: ["noise"],
              special: `Scoops up a writhing mass of the worm and winds up for a turn (you see it coming), then throws it up to ${MIDDEAD.FLINGER.RANGE} tiles: it lands as a worm swarm next to whoever it was thrown at. Hit it for ${MIDDEAD.FLINGER.DROP} or more while it winds up and it drops the mass at its own feet.`,
              counter: "Shoot it while it winds up, or move whoever it is aiming at out of reach or out of sight. Fire and clubs for the swarms." },
  sower:    { name: "Sower", short: "Se", hp: 1.2, dmg: 0.7, aim: 0, mob: 2.5, armor: 1, share: 0.06, wall: 1.0, weight: 1.2, priority: 1.3, senses: ["noise", "light"],
              special: "Swollen with the worm's eggs and weak in a fight, but every tile its horde crosses on the State Map is seeded: the land's Infection climbs (tougher dead, more of them drawn by noise, the worm caught more easily), around your bases too. In battle, while it stands, the ground thickens with eggs and the noise draws more of the dead.",
              counter: "Catch its horde before it reaches your land, and kill it early in a fight. Fire cleans the ground." },
  nightmare: { name: "Nightmare", short: "Nm", hp: 1.3, dmg: 1.0, aim: 5, mob: 3, armor: 0.9, share: 0.03, wall: 1.5, weight: 2.2, priority: 2.6, keep: 5, senses: [],
              special: `Hangs back and screams every ${MIDDEAD.NIGHTMARE.EVERY} turns: the Heat climbs, the dead around wake and come, and your people within ${MIDDEAD.NIGHTMARE.RANGE} tiles who lose their nerve panic and spend their next turn running (to the way out if there is one, else away from the dead). Ignores decoys.`,
              counter: "Kill it first, at range, and keep the team out of its reach. The brave hold their nerve better, and so does someone with a friend beside them." },
  // The counter-dead (COUNTER, DIG above; counterdead.js, tunnels.js): bred in answer to a base's defences.
  // counters: the parts of a defence it answers (COUNTER.PARTS); answers: the words for the tooltips and the codex.
  digger:   { name: "Digger", short: "Di", breed: 0.4, hp: 1.2, dmg: 1.0, aim: 5, mob: 2.5, armor: 0.9, share: 0.06, wall: 1.5, weight: 1.5, senses: ["noise"], counters: ["walls", "trench"], answers: "walls and trenches",
              special: `Broad, clay-caked hands for digging. Where the way to the living is long or walled, it goes down on bare ground (dirt, grass, a field) and tunnels up to ${DIG.RANGE} tiles under anything (walls, gates, buildings, wire, trenches, mines), unseen, ${DIG.PER_TURN} tiles a turn, and comes up on bare ground behind them. The tunnel stays: the other dead crawl through it. Tunnels dug at your base stay open until filled (Fill tunnel on the base map).`,
              counter: "Pave or build over the ground just inside the walls (it only comes up on bare ground), keep someone inside the walls, stand on its hole to stop it coming up, and fill the tunnels after the fight." },
  melter:   { name: "Melter", short: "Me", breed: 0.5, hp: 1.1, dmg: 0.9, aim: 0, mob: 2.5, armor: 1, share: 0.05, wall: 1.9, weight: 1.6, priority: 1.8, burn: 1.2, senses: ["noise", "light"], counters: ["walls"], answers: "walls, gates and barricades",
              special: `Its skin weeps acid. Its blows at a wall section, the gate, a door or a barricade eat through ${COUNTER.MELT} times as fast as another's; at a base's walls by the numbers it makes the walls, the gate and the barricades count for less.`,
              counter: "Shoot it before it reaches the wall: from the walkway, the towers and the stands. Fire hurts it more." },
  husk:     { name: "Husk", short: "Hu", breed: 0.4, hp: 1.5, dmg: 1.0, aim: 5, mob: 3, armor: 0.85, share: 0.07, wall: 1.3, weight: 1.5, burn: 1.3, senses: ["noise"], counters: ["wire"], answers: "barbed wire, concertina wire and spike pits",
              special: "Wrapped in a dried hide as tough as leather: it walks through barbed and razor wire and over spike pits unhurt and unstopped, and shrugs off a little of every hit. By the numbers wire and spike pits count for less against its horde.",
              counter: "Guns and blades, not traps; fire (the dry hide burns)." },
  tripper:  { name: "Tripper", short: "Tr", breed: 0.25, hp: 1.6, dmg: 0.8, aim: 0, mob: 3, armor: 1, share: 0.05, wall: 1.1, weight: 1.3, senses: ["noise"], counters: ["mines"], answers: "minefields",
              special: `It sniffs the ground: it smells out mines within ${COUNTER.SNIFF} tiles and walks onto them, ahead of the rest, setting them off on itself; a blast does ${Math.round(COUNTER.BLAST * 100)}% of its damage to it. By the numbers the mines go off on the Trippers and take fewer of the rest.`,
              counter: "Shoot it before it reaches the minefield, or let it waste a few mines: the field still holds the rest." },
  darkwalker:{ name: "Dark-walker", short: "Dw", breed: 0.35, hp: 0.9, dmg: 1.2, aim: 10, mob: 3.5, armor: 1, share: 0.06, wall: 1.1, weight: 1.4, reveal: 2.5, ambush: 1.4, senses: ["heat"], counters: ["light"], answers: "floodlights and watchtowers",
              special: "Pale and silent, it keeps to the dark: unseen until it is within 2 tiles of your people, in a flare's light or has struck (floodlights do not show it), it keeps off floodlit ground, and its first blow from the dark hits hard. By the numbers floodlights and towers count for less against its horde.",
              counter: "Flares and flashlights close in, people kept together, and someone inside the walls as well as on them." },
  // Not bred: a body full of the worm lying among the others on the map (SLEEPER above, sleepers.js). It never walks.
  sleeper:  { name: "Sleeper", short: "Sl", hp: 0.6, dmg: 0, aim: 0, mob: 0, armor: 1, share: 0, wall: 1, weight: 1, senses: [],
              special: `A body like any other on the ground, so full of the worm that it splits open when anyone comes next to it: a worm swarm pours out and bites. Spotted (Scouting), it shows.`,
              counter: "Keep away from the bodies you have not checked. Shoot a spotted one from afar (it splits where it lies) or burn it (the worms cook)." },
  // Not bred: the dead beasts (BEASTS above, deadbeasts.js): animals that died of the worm and walk, met on the hills,
  // in the woods and over the farmland. beast: true marks them (zombietypes.js applyZType; the UI). mob: their own.
  deadstag: { name: "Dead stag", short: "Dg", hp: 1.1, dmg: 1.3, aim: 5, mob: 5, armor: 1, share: 0, wall: 1.2, weight: 1.5, beast: true, senses: ["noise"],
              special: "A stag the worm killed and walks: fast, and its antlers hit hard. It bites with the worm in it (a bite can leave the worm in someone) and now and then bursts into a worm swarm when it falls. The hills and the woods.",
              counter: "Shoot it before it closes; a wall or a fence stops it. Keep your people together and watch anyone it gored for the worm." },
  deadhog:  { name: "Dead hog",  short: "Hg", hp: 1.6, dmg: 1.2, aim: 5, mob: 3.5, armor: 0.8, share: 0, wall: 1.5, weight: 1.6, beast: true, senses: ["noise"], burn: 1.2,
              special: "A wild hog swollen with the worm: thick hide and fat (takes 80% of each hit), hard to put down, and more often than not it splits into a worm swarm when it dies. Its bite can leave the worm in someone. The woods and the farms.",
              counter: "Kill it away from your people (the swarm), or burn it: fire cooks the worms and the fat burns. Rifles and heavy blows." },
  deadhound: { name: "Dead dog", short: "Dd", hp: 0.55, dmg: 0.7, aim: 10, mob: 5, armor: 1, share: 0, wall: 0.8, weight: 1.1, beast: true, senses: ["noise", "light"],
              special: "Somebody's dog once, dead of the worm and still running: quick and weak, in packs, and the pack's bites are surer when two or more are on the same person. A bite can leave the worm in someone. Farmland, the towns and the cities, and the houses they were shut in.",
              counter: "Keep together so no one is pulled down by a pack; a blade or a club each. They follow noise and light: a decoy pulls them off." },
  deadcat:  { name: "Dead cat",  short: "Ct", hp: 0.35, dmg: 0.5, aim: 15, mob: 6, armor: 1, share: 0, wall: 0.5, weight: 1.05, beast: true, senses: ["heat"],
              special: "A house cat the worm killed: tiny, very quick, and it hides, under a car, in a cupboard, in the long grass, unseen until it is within 2 tiles, in light or has struck, and its first bite from hiding hits hard. A bite can leave the worm in someone. The towns and the cities, the houses and the apartment blocks.",
              counter: "Light (a flashlight, a flare, floodlights) and keeping together; a boot or a club once it shows. Watch anyone it bit for the worm." },
  deadcow:  { name: "Dead cow",  short: "Cw", hp: 2.2, dmg: 1.3, aim: 0, mob: 2, armor: 0.9, share: 0, wall: 2, weight: 1.8, beast: true, senses: ["noise"], burn: 1.2, priority: 1.5,
              special: "A cow the worm filled: huge, slow, so full of the worm that it bursts into a swarm when it falls, every time. Its bite can leave the worm in someone. Farmland: the barns, the ranches and the fields.",
              counter: "Shoot it from range and well away from your people, or burn it (the worms cook). Never put it down next to someone." },
  // Not bred by hives (no growth unlocks them, share 0): the dead who were soldiers or riot police and still wear their
  // armour, found at military sites, police stations and in hordes that crossed them (deadsoldiers.js MILDEAD, where
  // the armour by weapon lives). armor here: the rough average the AI and fights by the numbers use; mob null: the
  // ordinary dead's pace (never faster: the kit weighs them down).
  soldier:  { name: "Dead soldier", short: "So", hp: 1.3, dmg: 1.0, aim: 0, mob: null, armor: 0.65, share: 0, wall: 1.1, weight: 1.7, military: true,
              special: "A soldier who turned in a plate carrier and a helmet: pistol rounds, knives and machetes barely get through (rifles mostly do); more health than the ordinary dead, no faster.",
              counter: "Rifles and the assault rifle, a sledgehammer or bat, critical (head) shots, fire and pipe bombs, or a blade from behind or on one that has not seen you." },
  riot:     { name: "Dead riot cop", short: "Ri", hp: 1.25, dmg: 1.0, aim: 0, mob: null, armor: 0.65, share: 0, wall: 1.1, weight: 1.5, military: true,
              special: "Riot police in hard-shell gear and a visored helmet: blows, blades and buckshot glance off, but the soft vest does little against rifle rounds.",
              counter: "Rifles (hunting, lever-action, carbine, assault), critical shots, fire; a blade from behind." },
};
