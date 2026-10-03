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
  SITE_DAYS: [30, 60],
  SITE_MAX: 2,        // build sites at a time
  BORDER_DAYS: [5, 9],
  GUARD_MIN: 40,      // a hive rebuilds its guard below this
};
export const BOSS_NAMES = { horde: "Wallbreaker", hive: "Broodmother" };
