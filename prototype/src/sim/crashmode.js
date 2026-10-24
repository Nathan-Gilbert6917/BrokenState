// @ts-check
// Crashlanding (2026-10-24, the user's request: "Add a new scenario start to the Normal Hardcore Custom called
// Crashlanding. You start off as the sole surviving member of a fallen helicoptor from a surviving military group. Out
// of communication range, broken radio and with only the supplies you can scavenge from the heli and what was on you
// when you crashed. You try to get back to your group ... This takes place 3 year after the fall of calder. Loot spawns
// are starting to be diminished new zombie types are showing more often. The map is 500x250 tiles. Have a random spawn
// for the crash and the base the survivor needs to get to has to be on the other side diagonal to the crashsite ...
// There is no starting base. You can raid the Heli POI but heat will be up due to the loudness of the crash ... The
// starting character can be customized but will start with military gear, a broken military radio that can be repaired
// but requires a soldering iron and other materials ... You do not start with a vehicle." Added the same day: "Most
// cars will not be repairable and limited fuel can be siphoned."; "Have a reveal at the end when you make it back to
// base the base was taken over by a hive ... once you leave change the military base sprite on the world map to a hive
// infested one. There are some supplies you can scavange from the base but it will have harder zombies."; "Fighting the
// hive and winning provides good loot."; "Find a message in the wreckage after defeating the hive of people fleeing to
// another location ... Maybe it's a secret mountain base or something that is not revealed as a location on the map
// until you beat the hive.").
// - Crashlanding is not a third state.mode (save.js resets any mode but "hardcore" to "normal"): a Crashlanding run is
//   a normal-mode world with state.crash (saved with the state), made by createWorld's `crash` option (world.js →
//   crashstart.js setupCrashStart). isCrashRun says which runs are Crashlanding. state.crash:
//   { tile, homeTile, homeName, nextTile, nextName, revealed, hiveBorn, hiveLooted, radioFixed, stage, trail, ... }
//   (crashstart.js has the rules: the wreck, the kit, the unit's base and its reveal, the hive, the haul, the bunker).
// - The numbers live here (CRASH) so the sim and the new-run screen read the same ones.
// A leaf module (no imports), safe to read from the sim and the UI.

export const CRASH = {
  W: 300, H: 200,       // the map: 300 × 200 (the user, 2026-10-24: "reduce map size to 300x200 for crashlanding mode"; it was the 500 × 250 of the first request); the Large preset's grid (worldsize.js), so a crash world's size def is Large's
  YEAR: 4,              // "3 year after the fall": the run starts on year 4, day 1 (eras.js yearStartDay)
  LOOT: 0.55,           // every tile's loot and every non-site POI pool × this ("loot spawns are starting to be diminished")
  WRECK_LOOT: 2.2,      // the heli wreck's own tile.loot ("some decent supplies on the heli")
  HEAT: 60,             // tile heat on the crash tile at the start ("heat will be up due to the loudness of the crash")
  LURE_HOURS: 72,       // the crash's noise draws the hordes within crashes.js CRASH.hordeRange for this long
  SPECIALS: 2,          // the special zombie shares × this ("new zombie types are showing more often")
  TIER_BONUS: 1,        // hivetech.js eraTier / hiveTier's calendar tier + this
  HIVE_AGE_DAYS: 336,   // every starting hive is born this many days before the start (its tiers follow the calendar)
  CAR_FIX: 0.2,         // a car found in the world is repairable with this chance ("most cars will not be repairable")
  SIPHON: 0.35,         // fuel siphoned from a car or wreck × this ("limited fuel can be siphoned")
  HOME_NEAR: 12,        // the unit's base snaps to the best tile within this many hexes of the crash tile's mirror
  FAR: 0.6,             // the crash is picked so the base is at least this × the map's diagonal away (both "diagonal" and far)
  HOME_LOOT: 0.8,       // the overrun base's tile.loot after the reveal ("some supplies you can scavenge")
  HOME_HEAT: 40, HOME_INFECTION: 0.6, // the reveal: harder dead at the base (heat and infection raised; deadsoldiers.js)
  HAUL: { rounds: 600, guns: 8, armour: 6, meds: 12, food: 20, water: 20, fuel: 25, electronics: 6, parts: 8, scrap: 20, rare: 3 }, // the base's stores: the hive's prize
  BUNKER_FAR: 1 / 3,    // the secret bunker: at least this × the diagonal from the base, in a quadrant of its own
  BUNKER_LOOT: 1.1,     // its tile.loot once it exists (data.js LOCATIONS bunker_mil)
  CACHE: { food: 10, water: 8, meds: 4, rounds: 120, fuel: 6, parts: 3, electronics: 2 }, // what the unit left in the bunker
  MRE_DAYS: 3,          // the party's rations: about this many days of f_mre
  WATER: 4, RIFLE_ROUNDS: 120, PISTOL_ROUNDS: 45, MEDS: 2, // the party's supplies beyond the guns and magazines
  STANAG_MAGS: 3, GLOCK_MAGS: 2,                          // spare magazines in the rig's pouches
};

/** One survivor, no more (the new-run screen's Starting people). */
export const CRASH_PEOPLE = { MIN: 1, MAX: 1, DEF: 1 };

/** The fixed kit's item keys (data modules' GEAR / MAGAZINES keys), for the UI's tooltips and the crew card. */
export const CRASH_KIT = {
  weapon: "m4", sidearm: "pistol", rig: "chestrig", armor: "plate", head: "milhelmet", tool: "traumakit",
  pouch: ["tourniquet"], mags: { mag_stanag_30: CRASH.STANAG_MAGS, mag_glock_15: CRASH.GLOCK_MAGS },
  pack: ["milradio_broken"],
  supplies: { f_mre: `${CRASH.MRE_DAYS} days`, water: CRASH.WATER, a_556_fmj: CRASH.RIFLE_ROUNDS, a_9mm_fmj: CRASH.PISTOL_ROUNDS, meds: CRASH.MEDS },
};
/** Every item key the kit puts on the survivor, in display order. */
export const CRASH_KIT_KEYS = ["m4", "pistol", "chestrig", "plate", "milhelmet", "mag_stanag_30", "mag_glock_15", "traumakit", "tourniquet", "milradio_broken"];

/** The unit ("your group") and its secret fallback. */
export const CRASH_UNIT = { name: "3rd Guard Battalion", short: "the 3rd Battalion", bunker: "Mountain bunker" };

/** A Crashlanding run (a normal-mode world with state.crash). @param {any} state */
export const isCrashRun = (state) => !!state && state.mode !== "hardcore" && !!state.crash;

/** The special zombie shares' multiplier: CRASH.SPECIALS in a crash run, 1 in any other. @param {any} state */
export const crashSpecials = (state) => (isCrashRun(state) ? CRASH.SPECIALS : 1);
/** The calendar tier bonus: CRASH.TIER_BONUS in a crash run, 0 in any other. @param {any} state */
export const crashTierBonus = (state) => (isCrashRun(state) ? CRASH.TIER_BONUS : 0);

/** The unit's name (state.crash.homeName), for the preamble, the marker and the cards. @param {any} state */
export const crashHomeName = (state) => (isCrashRun(state) && state.crash.homeName) || CRASH_UNIT.name;

/** The unit's base after the reveal: the dead there are harder (deadsoldiers.js, hivetech.js). @param {any} state @param {number} tileId */
export const crashHomeHot = (state, tileId) => isCrashRun(state) && !!state.crash.revealed && state.crash.homeTile === tileId;
