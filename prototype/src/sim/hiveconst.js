// Shared numbers for the hives and their bosses (hives.js, defences.js, hordes.js and the UI). A leaf module: it
// imports nothing, so it is safe to read at load time whatever order the circular sim imports are evaluated in.
export const HIVE = {
  CLUSTER: 5,         // hives this close count as a cluster for income
  START_RES: 5,       // resources of every hive on the map at the start
  RES_CAP: 80,        // a hive stores no more than this
  BOSS_COST: 40,      // a Wallbreaker
  BOSS_DAY: 120,      // no Wallbreakers before this day
  TERRITORY: 4,       // land a hive holds (sites inside show at least 3 skulls)
  RING: 1,            // red-skull ground around the hive: much tougher dead
  RADIATE: 6,         // infection reaches this far
  SUPPORT: 10,        // hives this close to a build site send hordes to it
  DRAW: 6,            // wandering hordes this close to a build site are drawn to it
  SITE_SCORE: 30,     // construction starts at this combined horde score
  SITE_BIOMASS: 1000, // ... and the hive stands when this many of the dead have gone into it
  SITE_INTAKE: 40,    // ... at most this many a day (a quarter of the gathered mass, at least 25): about 25 days
  SITE_DAYS: [50, 80], // days between new build sites
  SITE_MAX: 2,        // build sites at a time
  BORDER_DAYS: [5, 9],
  GUARD_MIN: 40,      // a hive rebuilds its guard below this
  START_ORIGIN: 4,    // hives placed around the outbreak origin at the start (mapgen.js)
  START_SPOT: 1,      // ... and around each other hot spot (a lone hive: a first target)
  // The share of a defending hive's new roaming hordes it sends to attack a base: ATTACK_START on day 1, up by
  // 1 / ATTACK_RAMP a day, at most ATTACK_MAX (20% at first, 40% on day 30, 65% from about day 70).
  ATTACK_START: 0.2, ATTACK_RAMP: 150, ATTACK_MAX: 0.65,
  LARGE_DAY: 60,      // a defending hive sends out no large roaming / attacking hordes before this day
  ATTACK_RANGE: 45,   // your bases are attacked from at most this far (the groups' from 22)
  PLAYER_PULL: 2.5,   // your bases weigh this much more than the groups' when a hive picks what to attack
  BOSS_GAP: 90,       // days after a hive raises a Wallbreaker before it can raise the next
};
export const BOSS_NAMES = { horde: "Wallbreaker", hive: "Broodmother" };
