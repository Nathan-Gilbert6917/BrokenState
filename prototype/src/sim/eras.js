// Eras: how the threats and the two victories change over the years of a campaign. Every number is here.
//
// Years are the game's calendar years (weather.js: four seasons of 28 days = 112 days; day 1 is day 15 of spring,
// so year 1 is days 1–98, year 2 starts on day 99, year 5 on day 435, year 8 on 771, year 10 on 995, year 15 on 1555).
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
//   year 12–14), at least LATE_MIN_AGG hostile aggressive groups stay in the state (new gangs keep coming), and
//   LATE_RAIDER_BANDS more outsider bands may roam at once. The coalition has grown into an army: every member sends
//   ALLY_LATE more fighters to your hive and base assaults (alliance.js hiveAllies, assaultAllies). The hives
//   multiplying (hives.js: a new site every 120–180 days) is the main growth of all: about 6 hives in year 1,
//   9 in year 7, 12–15 by years 12–15 when nobody destroys them.
//
// Fewer, better prepared threats (RAIDS, HORDES): raids on your bases and the hordes a hive sends at them come at a
// pace that rises over the years (about 3 raids a year early, 7 around year 5, up to 14 late at most; a hive horde
// every ~19 days early, every ~4 days late), and a raid comes only when its group can take on the base with
// everyone at a post (a bar that rises every few years) and is sized to it. The brood inside a hive fights harder
// every year from year 4 (BROOD), and from year 8 no new hive site is picked past HIVE_CAP. Calibrated fights by the
// numbers (combat.js winOdds, breakoff.js) make every one of these as deadly as on the battle map.
//
// Winning (world.js checkGameOver)
// - Neither victory comes before year WIN_FROM_YEAR (8, the start of the late game, day 771): the state is not won in
//   the long war. Until then the outbreak still burns beyond the borders and nobody would sign anything. The Goals
//   panel says so.
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
// Hardcore mode (hardcore-outbreak.js): the run starts on the day Calder falls, state.hardcore.eraOffset days before
// a normal game's day 1. Every ramp keyed to the year or the game day counts from that normal start: a hardcore
// run's day N ramps like a normal run's day N − offset (never below day 1). In a normal game this is the day itself.
export const eraOffsetOf = (state) => (state.mode === "hardcore" && state.hardcore && state.hardcore.eraOffset) || 0;
export const rampDay = (state) => { const d = dayOf(state), o = eraOffsetOf(state); return o ? Math.max(1, d - o) : d; };
// Hardcore: still before the normal start (the outbreak is spreading through its first year).
export const beforeFall = (state) => { const o = eraOffsetOf(state); return o > 0 && dayOf(state) <= o; };
export const yearOf = (state) => yearOfDay(rampDay(state));

export const ERAS = {
  LIST: [
    { key: "early", name: "Early game", from: 1, desc: "The first winters: medium hordes at the gates, small raids sized to your walls, outsider bands with clubs and old pistols." },
    { key: "mid", name: "Mid game", from: 3, desc: "The long war: every year the hordes come bigger, the gangs are better armed and larger, outsider bands bring more guns." },
    { key: "late", name: "Late game", from: 8, desc: "The reckoning: the threats near their peak, more gangs and more outsider bands at once. A coalition or a hive war can be won now, with work." },
  ],
  GROW_FROM: 3, // the first year the threats grow (year 3: one step, year 4: two ...)
  // Growth per year from GROW_FROM, and its cap.
  GROW: {
    horde: 0.03, hordeMax: 0.3,          // roaming, attacking and border hordes: +3% a year, at most +30% (year 12)
    gangArms: 0.02, gangArmsMax: 0.2,    // aggressive groups' strength (raids, wars, the base they defend): +2% a year
    recruit: 1, recruitMax: 10,          // aggressive groups recruit up to RAIDS.RECRUIT_UNTIL (45) + 1 a year
    gangPop: 1, gangPopMax: 10,          // new gangs from beyond the border: 12–18 people + 1 a year
    raiderSize: 0.25, raiderSizeMax: 3,  // outsider raider bands: up to 14 people + 1 every four years (visitors.js)
    raiderPower: 0.05, raiderPowerMax: 0.5, // ... each as strong as 6.0 at most + 0.05 a year (rifles and plate)
  },
  LATE_MIN_AGG: 2,        // from the late game at least this many hostile aggressive groups (factions.js newGangs; RAIDS.MIN_AGG = 2 before)
  LATE_RAIDER_BANDS: 0,   // more outsider raider bands on the map at a time from the late game (visitors.js caps)
  BANDWAGON: 0.25, BANDWAGON_CAP: 60, // a coalition holding over half the land: peaceful groups outside +0.25 goodwill a day, up to 60 (factions.js)
  ALLY_LATE: 2,           // from the late game every coalition member sends two more fighters to your hive and base assaults (alliance.js)
  WIN_FROM_YEAR: 8,
  // The hives late in the game (hives.js): the brood inside a hive (and its Broodmother's dead) fights BROOD more
  // a year from BROOD_FROM (at most BROOD_MAX: a hive stormed in year 12 is 30% tougher than in year 3), and no new
  // build site is picked while HIVE_CAP ([from year, hives standing + sites]) are already there (the state does not
  // fill up with hives in the late game; the outbreak beyond the border still keeps its floor, outbreak.js).
  BROOD: 0.035, BROOD_FROM: 4, BROOD_MAX: 0.3,
  HIVE_CAP: [[1, 99], [8, 11]],
  ACCORD: { DAYS: 112, DECAY: 2, SEASONS: 12, GRACE: 56 },
  CONTAIN: { DAYS: 28 },
  // Raids on your bases (a group's raid, a war raid, a grudge raid, an outsider band coming for a base): fewer, better
  // prepared ones as the years go on. PER_YEAR ([from year, raids]): the pace aimed at, about that many a game year
  // (not a cap: the next raid may come once 112 / PER_YEAR × 0.75–1.25 days have passed since the last one began, and
  // only if somebody is ready then). PREP: a group raids a base only if its whole strength reaches PREP × the base's
  // defence with everyone at a post (an outsider band, its own strength: OUT_PREP); SIZE: the raid is then sized to
  // SIZE × that defence (× their escalation, at most the whole group).
  // Horde attacks a hive sends at your bases: HORDES ([from year, attacks a game year]) is the pace aimed at, as for
  // the raids (a hive's horde may be sent at you once 112 / HORDES × 0.75–1.25 days have passed since the last one;
  // in between they go for the groups or roam). Wandering and border hordes that stumble on a base are not paced.
  // Fewer, bigger: each horde comes GROW.horde a year bigger.
  HORDES: [[1, 6], [3, 10], [5, 14], [8, 18], [10, 22], [13, 26]],
  RAIDS: {
    PER_YEAR: [[1, 3], [3, 5], [5, 7], [8, 10], [10, 14]],
    PREP: [[1, 0.8], [3, 0.95], [5, 1.05], [8, 1.15], [10, 1.25]],
    OUT_PREP: [[1, 0.6], [3, 0.75], [5, 0.85], [8, 0.95], [10, 1.05]],
    SIZE: [[1, [0.6, 1.0]], [3, [0.7, 1.0]], [5, [0.75, 1.05]], [8, [0.8, 1.1]], [10, [0.85, 1.15]]],
  },
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
export const broodGrowth = (state) => 1 + Math.min(ERAS.BROOD_MAX, ERAS.BROOD * Math.max(0, yearOf(state) - ERAS.BROOD_FROM + 1));
export const hiveCap = (state) => { const y = yearOf(state); let v = 99; for (const [from, n] of ERAS.HIVE_CAP) if (y >= from) v = n; return v; };
export const winOpen = (state) => yearOf(state) >= ERAS.WIN_FROM_YEAR;

// ---------- raids on your bases (factions.js, diplomacy.js, radio.js, visitors.js) ----------
// A [from year, value] table's value this year.
export const byYear = (table, state) => { const y = yearOf(state); let v = table[0][1]; for (const [from, x] of table) if (y >= from) v = x; return v; };
export const raidPrep = (state) => byYear(ERAS.RAIDS.PREP, state);
export const outsiderPrep = (state) => byYear(ERAS.RAIDS.OUT_PREP, state);
export const raidSizeRange = (state) => byYear(ERAS.RAIDS.SIZE, state);
// The pace: may a new raid on your bases begin today? (state.raidPaceOff: a test switch.)
export const raidPaceOpen = (state) => !!state.raidPaceOff || dayOf(state) >= (ensureEraState(state).nextRaid || 0);
// A raid on one of your bases has begun: the next may begin 112 / PER_YEAR × 0.75–1.25 days later (no dice drawn:
// the jitter comes from the day and the seed, so every world plays out the same).
export function noteRaid(state) {
  const E = ensureEraState(state);
  const d = dayOf(state);
  const gap = YEAR_DAYS / byYear(ERAS.RAIDS.PER_YEAR, state);
  const j = 0.75 + 0.5 * (hash((state.seed || 1) * 7919 + d) / 4294967296);
  E.nextRaid = d + Math.round(gap * j);
  E.raids = (E.raids || 0) + 1;
}

// The pace of horde attacks a hive sends at you (hives.js attackTarget / sendAttack).
export const hordePaceOpen = (state) => !!state.raidPaceOff || dayOf(state) >= (ensureEraState(state).nextHorde || 0);
export function noteHorde(state) {
  const E = ensureEraState(state);
  const d = dayOf(state);
  const gap = YEAR_DAYS / byYear(ERAS.HORDES, state);
  const j = 0.75 + 0.5 * (hash((state.seed || 1) * 104729 + d) / 4294967296);
  E.nextHorde = d + Math.round(gap * j);
  E.hordes = (E.hordes || 0) + 1;
}

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
  if (burnedOut(state) || beforeFall(state)) return 0; // hardcore: the border floor starts with the normal start
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
  const off = eraOffsetOf(state);
  return {
    year: y, era: eraOf(state), winFrom: ERAS.WIN_FROM_YEAR, winOpen: winOpen(state), winDay: yearStartDay(ERAS.WIN_FROM_YEAR) + off,
    // Hardcore: the first year after the fall (the years count from the normal start, day offset + 1).
    fall: off ? { offset: off, before: beforeFall(state), normalStart: off + 1, left: Math.max(0, off + 1 - dayOf(state)) } : null,
    accord: E.accord, accordNeed: ERAS.ACCORD.DAYS, seasons: coalitionSeasons(state), seasonsNeed: ERAS.ACCORD.SEASONS,
    clear: E.clear, clearNeed: ERAS.CONTAIN.DAYS, burnout: burnoutYear(state), burnedOut: burnedOut(state), floor: hiveFloor(state),
    threat: { horde: hordeGrowth(state), gangArms: gangArms(state), raiderSize: raiderSizeBonus(state), raiderPower: raiderPowerBonus(state), gangPop: gangPopBonus(state) },
  };
}
