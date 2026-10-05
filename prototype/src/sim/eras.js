// Eras: how the threats and the two victories change over the years of a campaign. Every number is here.
//
// Years are the game's calendar years (weather.js: four seasons of 28 days = 112 days; day 1 is day 15 of spring,
// so year 1 is days 1–98, year 2 starts on day 99, year 5 on day 435, year 6 on 547, year 10 on 995, year 15 on 1555).
//
// The three eras
// - Early game (years 1–2): the first winters. Medium hordes at the gates, small raids sized to your walls, a few
//   outsider bands with clubs and old pistols. Nothing below grows yet.
// - Mid game (years 3–7, centred on year 5): the long war. From year 3 the threats grow every year: roaming and
//   attacking hordes and the hordes from beyond the border come bigger (+GROW.horde a year), the aggressive groups
//   arm themselves better (their strength +GROW.gangArms a year) and grow larger (they recruit up to
//   RECRUIT_UNTIL + GROW.recruit a year), new gangs from beyond the border arrive bigger (+GROW.gangPop people a
//   year), outsider raider bands bring more people and better guns than their first-year ceiling.
// - Late game (year 8 on, above all year 10+): the reckoning. The growth goes on to its caps (most reached around
//   year 12–14), at least LATE_MIN_AGG aggressive groups stay in the state (new gangs keep coming), more outsider
//   bands roam at once.
//
// Winning (world.js checkGameOver)
// - Neither victory comes before year WIN_FROM_YEAR (6): until the fifth winter is over the outbreak still burns
//   beyond the borders and nobody in the state would sign anything. The Goals panel says so.
// - Coalition victory = the Calder Accord: the coalition holds more than half the land with every group still
//   standing a member (alliance.js), and it has to KEEP that for ACCORD.DAYS days (a year: four seasons). Each day
//   the condition holds counts one; a day it does not takes ACCORD.DECAY back (a new gang settling, a member
//   walking out or land lost sets the Accord back, it does not wipe it out). A gang that has just come over the border
//   (or a raider band that dug in) does not count against it for ACCORD.GRACE days (two seasons): break it or win it
//   over in that time. The Accord is also only signed once the coalition has stood ACCORD.SEASONS seasons since its
//   founding (the council must have met that often).
// - Hive victory: every hive destroyed and none being built (hives.js hivesSecured), the outbreak beyond the border
//   burned out (outbreak.js: in a year between 9 and 12, per world; until then new hives keep rising near the border
//   whenever fewer than 2 stand, 1 from year 8), and the state then kept clear for CONTAIN.DAYS days (a season): a
//   hive that rises again in that time (from a build site the hordes start) sets the count back to zero.
export const YEAR_DAYS = 112; // weather.js YEAR_DAYS (eras.js imports nothing: it is read at load time)
const START_OFFSET = 14; // weather.js START_OFFSET
export const yearOfDay = (d) => Math.floor((Math.max(1, d) - 1 + START_OFFSET) / YEAR_DAYS) + 1;
export const yearStartDay = (y) => (y <= 1 ? 1 : YEAR_DAYS * (y - 1) - START_OFFSET + 1);
const dayOf = (state) => Math.floor(state.hour / 24) + 1;
export const yearOf = (state) => yearOfDay(dayOf(state));

export const ERAS = {
  LIST: [
    { key: "early", name: "Early game", from: 1, desc: "The first winters: medium hordes at the gates, small raids sized to your walls, outsider bands with clubs and old pistols." },
    { key: "mid", name: "Mid game", from: 3, desc: "The long war: every year the hordes come bigger, the gangs are better armed and larger, outsider bands bring more guns." },
    { key: "late", name: "Late game", from: 8, desc: "The reckoning: the threats near their peak, more gangs and more outsider bands at once. A coalition or a hive war can be won now, with work." },
  ],
  GROW_FROM: 3, // the first year the threats grow (year 3: one step, year 4: two ...)
  // Growth per year from GROW_FROM, and its cap.
  GROW: {
    horde: 0.04, hordeMax: 0.4,          // roaming, attacking and border hordes: +4% a year, at most +40% (year 12)
    gangArms: 0.03, gangArmsMax: 0.3,    // aggressive groups' strength (raids, wars, the base they defend): +3% a year
    recruit: 2, recruitMax: 20,          // aggressive groups recruit up to RAIDS.RECRUIT_UNTIL (45) + 2 a year
    gangPop: 1.5, gangPopMax: 15,        // new gangs from beyond the border: 12–18 people + 1.5 a year
    raiderSize: 1, raiderSizeMax: 10,    // outsider raider bands: up to 14 people + 1 a year (visitors.js)
    raiderPower: 0.2, raiderPowerMax: 2, // ... each as strong as 6.0 at most + 0.2 a year (rifles and plate)
  },
  LATE_MIN_AGG: 3,        // from the late game at least this many hostile aggressive groups (factions.js newGangs; 2 before)
  LATE_RAIDER_BANDS: 1,   // one more outsider raider band on the map at a time from the late game (visitors.js caps)
  WIN_FROM_YEAR: 6,
  ACCORD: { DAYS: 112, DECAY: 2, SEASONS: 12, GRACE: 56 },
  CONTAIN: { DAYS: 28 },
  // The outbreak beyond the border (outbreak.js): while it burns, a new hive is seeded near the border DELAY days
  // after fewer than the year's FLOOR of hives stand or are being built ([from year, floor]); MASS of the dead
  // arrive with it; at least KEEP_CLEAR tiles from any base, within EDGE tiles of the map's edge. It burns out in a
  // year between BURNOUT[0] and BURNOUT[1] (per world, from its seed); only then can the hive victory be won.
  OUTBREAK: { FLOOR: [[1, 2], [8, 1]], BURNOUT: [9, 12], DELAY: [20, 40], MASS: 1100, EDGE: 2, KEEP_CLEAR: 8 },
};

export const eraOf = (state) => { const y = yearOf(state); let e = ERAS.LIST[0]; for (const x of ERAS.LIST) if (y >= x.from) e = x; return e; };
// Steps of growth this year: 0 before GROW_FROM, 1 in that year, 2 the next ...
export const growSteps = (state) => Math.max(0, yearOf(state) - ERAS.GROW_FROM + 1);
const grown = (state, per, max) => Math.min(max, per * growSteps(state));
export const hordeGrowth = (state) => 1 + grown(state, ERAS.GROW.horde, ERAS.GROW.hordeMax);
export const gangArms = (state) => 1 + grown(state, ERAS.GROW.gangArms, ERAS.GROW.gangArmsMax);
export const recruitBonus = (state) => Math.round(grown(state, ERAS.GROW.recruit, ERAS.GROW.recruitMax));
export const gangPopBonus = (state) => Math.round(grown(state, ERAS.GROW.gangPop, ERAS.GROW.gangPopMax));
export const raiderSizeBonus = (state) => Math.round(grown(state, ERAS.GROW.raiderSize, ERAS.GROW.raiderSizeMax));
export const raiderPowerBonus = (state) => grown(state, ERAS.GROW.raiderPower, ERAS.GROW.raiderPowerMax);
export const isLate = (state) => eraOf(state).key === "late";
export const winOpen = (state) => yearOf(state) >= ERAS.WIN_FROM_YEAR;

// ---------- the outbreak beyond the border (outbreak.js) ----------
const hash = (n) => { let x = (n >>> 0) ^ 0x85ebca6b; x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d); x = Math.imul(x ^ (x >>> 12), 0x297a2d39); return (x ^ (x >>> 15)) >>> 0; };
// The year it burns out (from the world's seed: the same world always plays the same).
export function burnoutYear(state) {
  const [a, b] = ERAS.OUTBREAK.BURNOUT;
  return a + (hash(state.seed || 1) % (b - a + 1));
}
export const burnedOut = (state) => yearOf(state) >= burnoutYear(state);
// The fewest hives (standing or being built) the outbreak beyond the border keeps in the state this year.
export function hiveFloor(state) {
  if (burnedOut(state)) return 0;
  const y = yearOf(state);
  return ERAS.OUTBREAK.FLOOR.reduce((n, [from, k]) => (y >= from ? k : n), 0);
}

// ---------- the victories' clocks (world.js calls erasVictoryDaily once a day, checkGameOver reads them) ----------
export function ensureEraState(state) {
  if (!state.era) state.era = { accord: 0, accordBest: 0, clear: 0, clearBest: 0, accordFirst: null, clearFirst: null };
  return state.era;
}
// coalitionHolds / hivesClear: today's conditions (alliance.js allianceVictory's test, hives.js hivesSecured).
export function erasVictoryDaily(state, coalitionHolds, hivesClear) {
  const E = ensureEraState(state);
  const d = dayOf(state);
  if (coalitionHolds) { E.accord += 1; if (E.accordFirst == null) E.accordFirst = d; }
  else E.accord = Math.max(0, E.accord - ERAS.ACCORD.DECAY);
  E.accordBest = Math.max(E.accordBest, E.accord);
  if (hivesClear) { E.clear += 1; if (E.clearFirst == null) E.clearFirst = d; }
  else E.clear = 0;
  E.clearBest = Math.max(E.clearBest, E.clear);
}
// Seasons the coalition has stood (since its founding: alliance.js state.alliance.founded).
export const coalitionSeasons = (state) => (state.alliance && state.alliance.founded != null ? Math.floor((dayOf(state) - state.alliance.founded) / 28) : 0);
export const accordReady = (state) => winOpen(state) && ensureEraState(state).accord >= ERAS.ACCORD.DAYS && coalitionSeasons(state) >= ERAS.ACCORD.SEASONS;
export const containReady = (state) => winOpen(state) && burnedOut(state) && ensureEraState(state).clear >= ERAS.CONTAIN.DAYS;
// For the Goals panel and the tools.
export function eraProgress(state) {
  const E = ensureEraState(state);
  const y = yearOf(state);
  return {
    year: y, era: eraOf(state), winFrom: ERAS.WIN_FROM_YEAR, winOpen: winOpen(state), winDay: yearStartDay(ERAS.WIN_FROM_YEAR),
    accord: E.accord, accordNeed: ERAS.ACCORD.DAYS, seasons: coalitionSeasons(state), seasonsNeed: ERAS.ACCORD.SEASONS,
    clear: E.clear, clearNeed: ERAS.CONTAIN.DAYS, burnout: burnoutYear(state), burnedOut: burnedOut(state), floor: hiveFloor(state),
    threat: { horde: hordeGrowth(state), gangArms: gangArms(state), raiderSize: raiderSizeBonus(state), raiderPower: raiderPowerBonus(state), gangPop: gangPopBonus(state) },
  };
}
