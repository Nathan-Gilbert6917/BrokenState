// @ts-check
// Seasons and weather: a statewide sky (the season, temperatures, the ground) with regional weather fronts on top.
//
// A year is 4 seasons of 28 days (112 days), and day 1 of a campaign is day 15 of spring.
// Every day has one weather type plus ground conditions that carry over (mud, snow cover, soil moisture).
// Days are generated in order from the campaign seed with their own RNG stream (state.rng is never
// touched here), and kept in state.weather.days. A day's record is the region's weather: its storms, blizzards
// and fog do not cover the whole state but come as FRONTS (state.weather.fronts): seeded systems with a position,
// a heading and speed in tiles an hour, a radius and a lifetime, that come in at a map edge and cross the map over
// hours to a couple of days. Away from the fronts a tile has the day's background sky (bgKind: a storm day is rain
// there, a blizzard day snow, a foggy day overcast). Fronts come from their own RNG stream, a day at a time, so
// they too are fixed ahead for a seed. Movement uses the real fronts; estimates (travelHours) use only the fronts
// already on the map when the estimate is made (`known`): a front that forms later can still slow a team down.
// What the PLAYER is told about the coming days (forecast) is a separate, deliberately imperfect view of the
// day records: the regional outlook ("storms about"), not where the fronts will go.
//
// Rivers freeze in deep winter (ICE): a freezing index (degree-days below 0 °C, melting three times as fast above)
// is kept on each day record; the rivers' northern reaches freeze first and thaw last. Frozen river tiles can be
// walked (ICE.walk hours a tile), never driven; hordes and other groups cross them too (parties.js moveCost,
// hordes.js, rivers.js).
//
// API for other systems (all take the game state; `hour`/`dayIdx` default to now; "home" is the hub's tile, or your
// team's before you have a hub):
//   season(state)                         -> { key, name, icon, dayOfSeason, daysLeft, year, index }
//   weather(state, hour, tileId)          -> { key, name, icon, temp, hi, lo, rain, snow, wind, severe,
//                                              mud, snowCover, soil, frozen, dryDays, desc, front } at home (or the tile)
//   weatherAt(state, tileId, hour) / wxAt(state, x, y, hour)  -> the same for one tile
//   frontAt(state, tileId, hour, known)   -> the front over a tile ({ f, x, y, r }) or null; visibleFronts(state, frac)
//   frontsApproaching(state, tileId)      -> the fronts on the map with when (if ever) they reach the tile
//   forecast(state, days)                 -> [{ day, offset, key, name, icon, hi, lo, severe, confidence, season }]
//   forecastRange(state)                  -> days the hub can forecast (3; 4 with a watchtower; 5 with a radio station)
//   travelFactor(state, { vehicle, tileId, from, hour, known })  -> multiplier on movement cost (1 = normal, more = slower)
//   travelEffects(state, hour, tileId)    -> { footRoad, footOff, vehRoad, vehOff, sight, ambush, injury, events, boat, lines }
//   iceRow(state, hour), riverFrozen(state, tileId, hour), thinIce(state, tileId, hour)  -> frozen rivers (ICE)
//   growthFactor(state, crop)             -> 0..1.3 growth multiplier for today
//   cropDamage(state, crop)               -> { kill, rot, reason } chances for today (0..1)
//   isGrowingSeason(state, crop)          -> bool; growingDaysLeft(state, crop) -> days until that season ends
//   rainWater(state)                      -> water units one rain collector gathers today; wellFactor(state) -> 0.6..1.15
//   thirstFactor(state, dayIdx)           -> how much people drink that day: THIRST by season, at least THIRST.heat on
//                                            a hot day (hotDay: a heat wave, or 30 °C and up)
//   exposureRisk(state, { sheltered })    -> { chance, kind: "cold"|"heat"|null, reason, temp } per person per day outdoors
//   hordeSpeedFactor(state)               -> 0.5..1 (the dead are slower in deep cold and snow); hordeSpeedAt(state, tile)
//   The daily ones (growth, crop damage, rain water, wells, thirst, exposure, cold) read home's day (dayRec): the
//   background sky, or the front that sat over home for a good part of the day.
//   foodNeedFactor(state)                 -> 1..1.2 (people eat more in the cold; optional hook); coldAt(state, hour)
//                                            the same for the hour a team eats in, coldAhead(state, days) the highest
//                                            over the coming days (trip estimates and packing, as thirstAt/thirstAhead)
//   weatherDaily(state) / weatherHour(state)  tick hooks (world.js tickHour)
// `crop` is a crop key ("potato", "corn"...) or an object with any of { seasons, hardy, thirst, tMin, tOpt, tall }.
// A crop defined in data.js as CROPS[key] may carry the same fields (or a `climate` object); registerCrop adds one.
import { Rng } from "./rng.js";
import * as data from "./data.js";
import { log, hurt, hub } from "./world.js";
import { cfgOf } from "./worldcfg.js"; // the run's dials: Thirst
import { frostMult, coldSnap } from "./winter.js"; // winter frosts and cold snaps (cropDamage; call-time only)
/** @import { State, Party, Survivor } from "./types" */

export const SEASON_DAYS = 28;
export const YEAR_DAYS = SEASON_DAYS * 4;
export const START_OFFSET = 14; // campaign day 1 = day 15 of spring

export const SEASONS = [
  { key: "spring", name: "Spring", icon: "🌱", desc: "Mild and wet: rain and mud, late frosts early on. Planting time." },
  { key: "summer", name: "Summer", icon: "🌻", desc: "Warm and mostly dry: fast travel and growth, with heat waves, dry spells and thunderstorms. Everyone drinks 30% more water (60% more in a heat wave), crops need more on dry days and wells give less." },
  { key: "autumn", name: "Autumn", icon: "🍂", desc: "Cooling and wet: rain, fog and mud; first frosts toward the end. Harvest before winter." },
  { key: "winter", name: "Winter", icon: "❄️", desc: "Freezing: snow piles up and slows everything, blizzards stop travel, nothing grows outdoors. People drink a little less (10%)." },
];

// severe: storms and blizzards (slow everything, small injury risk on the road, risky boat crossings).
export const WEATHER = {
  clear:    { name: "Clear",       icon: "☀️", desc: "Dry and bright. Wet ground dries out." },
  overcast: { name: "Overcast",    icon: "☁️", desc: "Grey skies, no effect on travel." },
  rain:     { name: "Rain",        icon: "🌧️", desc: "Ground turns to mud: off-road travel slows, vehicles most of all. Fills rain barrels." },
  storm:    { name: "Storm",       icon: "⛈️", severe: true, desc: "Heavy rain and wind: slow going everywhere, a small injury risk on the road, risky boat crossings, crops can be flattened." },
  fog:      { name: "Fog",         icon: "🌫️", desc: "Teams see one tile less and are a little easier to ambush; driving is slower." },
  heat:     { name: "Heat wave",   icon: "🥵", desc: "Walking is slower, soil dries fast, heat sickness risk for people working outside." },
  drought:  { name: "Dry spell",   icon: "🏜️", desc: "No rain, soil drying out: crops wither without water, wells give less." },
  snow:     { name: "Snow",        icon: "🌨️", desc: "Snow builds up: everything slows, off-road most of all. Tender crops die." },
  blizzard: { name: "Blizzard",    icon: "🌬️", severe: true, desc: "Whiteout: travel is very slow and dangerous (frostbite, lost footing), sight is cut, crops die." },
  frost:    { name: "Hard frost",  icon: "🧊", desc: "Clear and freezing: frozen ground is firm to travel on, but frost kills tender crops." },
};

// Chance weights per season (rolled once a day; yesterday's weather tends to stay, see PERSIST).
const WEIGHTS = {
  // Spring rains more often (the user's request 2026-10-23: "In spring it rains more often"): rain 24 → 30, from clear and grey skies.
  spring: { clear: 27, overcast: 19, rain: 30, storm: 6, fog: 10, frost: 8 },
  summer: { clear: 46, overcast: 16, rain: 14, storm: 8, fog: 2, heat: 9, drought: 6 },
  autumn: { clear: 24, overcast: 26, rain: 24, storm: 8, fog: 12, frost: 12 },
  winter: { clear: 16, overcast: 22, rain: 4, snow: 28, blizzard: 8, fog: 6, frost: 16 },
};
const PERSIST = { clear: 0.4, overcast: 0.35, rain: 0.4, storm: 0.15, fog: 0.25, heat: 0.5, drought: 0.55, snow: 0.4, blizzard: 0.2, frost: 0.45 };
const TEMP_MOD = { clear: 1, overcast: 0, rain: -2, storm: -3, fog: -1, heat: 6, drought: 2, snow: -2, blizzard: -6, frost: -3 };
const TEMP_AMP = { clear: 6.5, overcast: 4, rain: 4, storm: 3.5, fog: 4, heat: 6.5, drought: 6.5, snow: 3.5, blizzard: 3.5, frost: 6.5 };
const WIND = { clear: [0.1, 0.3], overcast: [0.15, 0.4], rain: [0.2, 0.5], storm: [0.7, 1], fog: [0, 0.1], heat: [0.05, 0.2], drought: [0.1, 0.3], snow: [0.2, 0.5], blizzard: [0.8, 1], frost: [0, 0.2] };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

// ---------- seasons ----------
// dayIdx: 0 = campaign day 1.
/** @param {number} dayIdx */
export function seasonOfDay(dayIdx) {
  const d = Math.max(0, Math.floor(dayIdx)) + START_OFFSET;
  const index = Math.floor(d / SEASON_DAYS) % 4;
  const dayOfSeason = (d % SEASON_DAYS) + 1;
  const s = SEASONS[index];
  return { key: s.key, name: s.name, icon: s.icon, desc: s.desc, index, dayOfSeason, daysLeft: SEASON_DAYS - dayOfSeason, year: Math.floor(d / YEAR_DAYS) + 1 };
}
/** @param {State} state @param {number} [hour] */
export const dayIndex = (state, hour = state.hour) => Math.floor(Math.max(0, hour) / 24);
/** @param {State} state @param {number} [hour] */
export const season = (state, hour = state.hour) => seasonOfDay(dayIndex(state, hour));

// Mean temperature of the calendar day, before the day's weather: 21 °C in midsummer, -3 °C in midwinter.
/** @param {number} dayIdx */
function seasonalMean(dayIdx) {
  const y = ((dayIdx + START_OFFSET + 0.5) % YEAR_DAYS) / YEAR_DAYS;
  return 9 + 12 * Math.cos(2 * Math.PI * (y - 0.375));
}

// ---------- state and generation ----------
/** @param {State} state */
function ensure(state) {
  let w = state.weather;
  if (!w || !Array.isArray(w.days)) {
    const seed = (Number(state.seed) || 1) >>> 0;
    // Own stream: the map and everything else rolled from state.rng stay as they were.
    w = state.weather = { seed, rs: (Math.imul(seed ^ 0x57ea7e25, 0x9e3779b1) ^ 0x5eed) >>> 0, days: [], lastLogged: -1, tint: true };
  }
  if (w.fs == null) upgrade(w);
  return w;
}

// Fronts and river ice for a state made before them (an older save): the fronts' own stream from the seed, every
// day's travel table without its storm (now the fronts' part) and the freezing index.
function upgrade(w) {
  w.fs = (Math.imul((w.seed >>> 0) ^ 0x3f1a7c55, 0x85ebca6b) ^ 0xf007) >>> 0;
  w.fronts = [];
  w.fd = 0; // days whose fronts are made
  w.nf = 1; // next front id
  w.days.forEach((d, i) => {
    d.tf = travelTable(d);
    d.ice = nextIce(i > 0 ? w.days[i - 1].ice : 0, d);
  });
}

function genDay(w, i) {
  const rng = new Rng(w.rs);
  const prev = i > 0 ? w.days[i - 1] : null;
  const s = seasonOfDay(i);
  const an = r2((prev ? prev.an * 0.7 : 0) + rng.range(-2.2, 2.2)); // warm and cold spells drift over days
  const base = seasonalMean(i) + an;
  const weights = { ...WEIGHTS[s.key] };
  if (weights.frost && base - 6 > 1) weights.frost = 0; // frost needs a night near freezing
  if (weights.heat && base < 17) weights.heat = 0;
  if (weights.drought) weights.drought = prev && prev.soil < 0.5 ? weights.drought * (1 + Math.min(6, prev.dry) / 4) : 0;
  let k;
  if (i < 2) k = rng.chance(0.6) ? "clear" : "overcast"; // a calm first two days for every campaign
  else if (prev && weights[prev.k] > 0 && rng.chance(PERSIST[prev.k])) k = prev.k;
  else {
    const keys = Object.keys(weights).filter((x) => weights[x] > 0);
    k = rng.weighted(keys, (x) => weights[x]);
  }
  // Rain below freezing falls as snow, and snow in the warm falls as rain.
  if (base < -0.5) k = k === "rain" ? "snow" : k === "storm" ? "blizzard" : k;
  else if (base > 3) k = k === "snow" ? "rain" : k === "blizzard" ? "storm" : k;
  const mean = base + (k === "clear" && s.key === "winter" ? -1 : TEMP_MOD[k]);
  const hi = r1(mean + TEMP_AMP[k]);
  let lo = r1(mean - TEMP_AMP[k]);
  if (k === "frost") lo = Math.min(lo, -1);
  const rain = k === "rain" ? r2(rng.range(0.3, 0.6)) : k === "storm" ? r2(rng.range(0.75, 1)) : 0;
  const snow = k === "snow" ? r2(rng.range(0.3, 0.6)) : k === "blizzard" ? r2(rng.range(0.8, 1)) : 0;
  const wind = r2(rng.range(WIND[k][0], WIND[k][1]));
  // Ground: snow cover builds and melts, mud follows rain and melt and dries in the sun, soil moisture feeds crops.
  let cover = prev ? prev.cover : 0, mud = prev ? prev.mud : 0.1, soil = prev ? prev.soil : 0.55;
  cover = Math.min(1, cover + snow * 0.5);
  let melt = 0;
  if (hi > 1 && cover > 0) {
    melt = Math.min(cover, 0.035 * hi + (rain ? 0.1 : 0));
    cover -= melt;
  }
  mud = clamp(mud * (k === "heat" || k === "drought" ? 0.45 : k === "clear" || k === "frost" ? 0.6 : 0.75) + rain * 0.6 + melt * 0.6, 0, 1);
  soil = clamp(soil - (k === "drought" ? 0.14 : k === "heat" ? 0.12 : k === "clear" ? 0.05 : 0.03) * (base < 5 ? 0.3 : 1) + rain * 0.45 + melt * 0.3 + snow * 0.1, 0, 1);
  const dry = rain || snow ? 0 : (prev ? prev.dry : 0) + 1;
  const frozen = (hi + lo) / 2 < -2; // frozen ground carries no mud
  const d = { k, hi, lo, rain, snow, wind, an, cover: r2(cover), mud: r2(mud), soil: r2(soil), dry, frozen };
  d.tf = travelTable(d);
  d.ice = nextIce(prev ? prev.ice : 0, d);
  w.days[i] = d;
  w.rs = rng.state;
  return d;
}

// What each kind of weather adds to the movement cost: [on foot on a road, on foot off-road, vehicle on a road,
// vehicle off-road]. A day's table has its background sky's share; a front over a tile adds the rest (travelFactor).
const KIND_TF = {
  rain: [0, 0.08, 0.05, 0.08], storm: [0.3, 0.35, 0.3, 0.35], fog: [0.04, 0.06, 0.12, 0.08], heat: [0.12, 0.15, 0, 0],
  snow: [0.08, 0.08, 0.08, 0.08], blizzard: [0.5, 0.6, 0.6, 0.7],
};
const NO_TF = [0, 0, 0, 0];
// Movement-cost multipliers for one day, from the ground (mud, snow cover) and the background sky.
function travelTable(d) {
  const m = d.frozen ? 0 : d.mud, c = d.cover, x = KIND_TF[bgKind(d.k)] || NO_TF;
  const fr = 1 + 0.05 * m + 0.25 * c + x[0];
  const fo = 1 + 0.45 * m + 0.6 * c + x[1];
  const vr = 1 + 0.08 * m + 0.4 * c + x[2];
  const vo = 1 + 0.9 * m + 1.0 * c + x[3];
  return [fr, fo, vr, vo].map((v) => Math.min(3, r2(v)));
}

// The record of a day (generated on demand, in order), with the fronts that come in that day.
/** @param {State} state @param {number} dayIdx */
function rec(state, dayIdx) {
  const w = ensure(state);
  const i = Math.max(0, Math.floor(dayIdx));
  while (w.days.length <= i) genDay(w, w.days.length);
  if (w.fd <= i) makeFronts(state, w, i);
  return w.days[i];
}

// ---------- regional weather: fronts ----------
// The kinds of front, how big they are (radius in tiles, on a Normal map; a bigger map has bigger ones), how fast
// they travel (tiles an hour) and how they look on the map (ui/wxmap.js).
export const FRONT_KINDS = {
  storm:    { name: "Thunderstorm", r: [5, 8],  speed: [0.9, 1.5] },
  rain:     { name: "Rain belt",    r: [7, 12], speed: [0.7, 1.2] },
  blizzard: { name: "Blizzard",     r: [7, 11], speed: [0.6, 1.0] },
  snow:     { name: "Snow squall",  r: [6, 10], speed: [0.7, 1.2] },
  fog:      { name: "Fog bank",     r: [6, 10], speed: [0.2, 0.45] },
};
// How strong a kind of weather is: a front shows over a tile only where it is stronger than the background sky.
const RANK = { clear: 0, heat: 0, drought: 0, frost: 0, overcast: 1, fog: 2, rain: 3, snow: 4, storm: 5, blizzard: 6 };
// The background sky of a day: its storms, blizzards and fog are fronts, so between them it is rain, snow, grey.
const BG = { storm: "rain", blizzard: "snow", fog: "overcast" };
export const bgKind = (k) => BG[k] || k;
// Fronts a day brings: a stormy, blizzard or foggy day 1-2 of them (FRONT.second: the chance of a second), plus
// these by season (the chance of each a day).
export const FRONT = { second: 0.45, maxLife: 72, fadeHours: 6, growHours: 3 };
const EXTRA = {
  spring: { rain: 0.36, storm: 0.06 }, summer: { storm: 0.14, rain: 0.12 },
  autumn: { rain: 0.3, storm: 0.05, fog: 0.1 }, winter: { snow: 0.3, blizzard: 0.04, fog: 0.05 },
};
// The map edge a front comes in from (weights): mostly the west, more from the north in winter and the south in summer.
const EDGES = { spring: { w: 6, n: 2, s: 2, e: 1 }, summer: { w: 5, n: 1, s: 3, e: 1 }, autumn: { w: 6, n: 2, s: 2, e: 1 }, winter: { w: 5, n: 4, s: 1, e: 1 } };
// Rain in the freezing cold falls as snow (a storm as a blizzard), snow in the warm as rain.
const precip = (k, mean) => (mean < -0.5 ? (k === "rain" ? "snow" : k === "storm" ? "blizzard" : k) : mean > 3 ? (k === "snow" ? "rain" : k === "blizzard" ? "storm" : k) : k);

// Map geometry in tile units (neighbouring tiles 1 apart): odd rows sit half a tile right, rows are 0.866 apart.
const ROW = Math.sqrt(3) / 2;
/** @param {State} state */
const dims = (state) => {
  const g = state.grid;
  return g ? { W: g.width, H: g.height, w: g.width - 0.5, h: (g.height - 1) * ROW } : { W: 64, H: 42, w: 63.5, h: 41 * ROW };
};
/** @param {State} state */
export function tileUnits(state, id) {
  const W = state.grid ? state.grid.width : 64, x = id % W, y = (id - x) / W;
  return [x + 0.5 * (y & 1), y * ROW];
}

// The fronts that come in on day i: each from a map edge, heading for a point inside the map, gone when it has
// crossed (or after FRONT.maxLife hours, fading over the last FRONT.fadeHours).
/** @param {State} state */
function makeFronts(state, w, upTo) {
  const D = dims(state), size = Math.max(0.8, Math.min(1.4, Math.sqrt((D.W * D.H) / (64 * 42))));
  for (let i = w.fd; i <= upTo; i++) {
    const d = w.days[i], s = seasonOfDay(i).key, mean = (d.hi + d.lo) / 2, bg = bgKind(d.k);
    const rng = new Rng(w.fs);
    const kinds = [];
    if (i >= 2) { // the calm first two days of a campaign stay calm
      if (BG[d.k]) for (let n = rng.chance(FRONT.second) ? 2 : 1; n > 0; n--) kinds.push([d.k, rng.int(0, d.k === "fog" ? 4 : 9)]); // fog before dawn
      for (const [k, c] of Object.entries(EXTRA[s])) if (rng.chance(c)) kinds.push([k, rng.int(0, 20)]);
    }
    const made = [];
    for (const [k0, at] of kinds) {
      const f = makeFront(rng, precip(k0, mean), i * 24 + at, D, size, EDGES[s]);
      if (RANK[f.k] > RANK[bg]) made.push(f); // a rain belt on a rainy day changes nothing
    }
    made.sort((a, b) => a.t0 - b.t0);
    for (const f of made) { f.id = w.nf++; w.fronts.push(f); }
    w.fs = rng.state;
    w.fd = i + 1;
  }
}

function makeFront(rng, k, t0, D, size, edges) {
  const def = FRONT_KINDS[k];
  const r = r1(rng.range(def.r[0], def.r[1]) * size), speed = rng.range(def.speed[0], def.speed[1]);
  const edge = rng.weighted(Object.keys(edges), (e) => edges[e]);
  const along = rng.next(), out = r * 0.6;
  let x = edge === "w" ? -out : edge === "e" ? D.w + out : along * D.w;
  let y = edge === "n" ? -out : edge === "s" ? D.h + out : along * D.h;
  const tx = D.w * rng.range(0.2, 0.8), ty = D.h * rng.range(0.2, 0.8);
  if (k === "fog") { // fog forms where it lies (before dawn) and drifts a little until the day burns it off
    const fx = D.w * rng.range(0.1, 0.9), fy = D.h * rng.range(0.1, 0.9), a = Math.atan2(ty - y, tx - x);
    return { k, x: r2(fx), y: r2(fy), vx: r2(Math.cos(a) * speed), vy: r2(Math.sin(a) * speed), r, t0, t1: t0 + rng.int(8, 14), p: r2(rng.next()) };
  }
  const len = Math.hypot(tx - x, ty - y) || 1, ux = (tx - x) / len, uy = (ty - y) / len;
  // Hours until it has left the map on the far side.
  const tX = ux > 0 ? (D.w + r - x) / ux : ux < 0 ? (-r - x) / ux : Infinity;
  const tY = uy > 0 ? (D.h + r - y) / uy : uy < 0 ? (-r - y) / uy : Infinity;
  const life = Math.max(8, Math.min(FRONT.maxLife, Math.round(Math.min(tX, tY) / speed)));
  return { k, x: r2(x), y: r2(y), vx: r2(ux * speed), vy: r2(uy * speed), r, t0, t1: t0 + life, p: r2(rng.next()) };
}

// A front's radius at an hour: growing over its first hours (FRONT.growHours), shrinking away over its last.
const frontRadius = (f, h) => f.r * Math.min(1, (f.t1 - h) / FRONT.fadeHours, (h - f.t0 + 1) / FRONT.growHours);

// The fronts over the map at `hour`, as known at hour `known` (only fronts that had come in by then; Infinity:
// all of them): [{ f, x, y, r }] in tile units. Kept for the last few thousand asks (travel estimates ask a lot).
let memoW = null, memoN = 0;
const memo = new Map();
// Drops every cache above (the fronts over the map by the hour, the background skies, the days by tile). They only
// remember what the state already decides, so the weather never depends on what was asked before: the tools check
// it by dropping them every hour (tools/fronttest.js).
export function dropWeatherCaches() {
  memo.clear();
  memoW = null;
  bgCache = new WeakMap();
  dayCache = new WeakMap();
  frCache = new WeakMap();
}
/** @param {State} state @param {number} hour @param {number} [known] */
function activeFronts(state, hour, known = Infinity) {
  const w = ensure(state);
  rec(state, Math.floor(hour / 24));
  const lag = known >= hour ? 0 : Math.min(2097151, hour - known);
  if (memoW !== w || memoN !== w.fronts.length || memo.size > 4096) { memo.clear(); memoW = w; memoN = w.fronts.length; }
  const key = hour * 2097152 + lag;
  let list = memo.get(key);
  if (list) return list;
  list = [];
  const fr = w.fronts, from = hour - FRONT.maxLife, kn = hour - lag;
  let lo = 0, hi = fr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (fr[m].t0 <= from) lo = m + 1; else hi = m; }
  for (let j = lo; j < fr.length && fr[j].t0 <= hour; j++) {
    const f = fr[j];
    if (f.t0 > kn || hour >= f.t1) continue;
    const r = frontRadius(f, hour), dt = hour - f.t0;
    if (r > 0) list.push({ f, x: f.x + f.vx * dt, y: f.y + f.vy * dt, r });
  }
  memo.set(key, list);
  return list;
}

// The strongest front over a tile at `hour` (as known at `known`), or null.
/** @param {State} state @param {number} tileId @param {number} [hour] @param {number} [known] */
export function frontAt(state, tileId, hour = state.hour, known = Infinity) {
  if (tileId == null || tileId < 0) return null;
  const list = activeFronts(state, hour, known);
  if (!list.length) return null;
  const [ux, uy] = tileUnits(state, tileId);
  let best = null;
  for (const a of list) {
    const dx = ux - a.x, dy = uy - a.y;
    if (dx * dx + dy * dy <= a.r * a.r && (!best || RANK[a.f.k] > RANK[best.f.k])) best = a;
  }
  return best;
}

// A day's background sky (the record without its storm, blizzard or fog; the day's temperatures stay the record's:
// the cold of a blizzard day is the region's): one object per day record. rk: the record's kind.
let bgCache = new WeakMap();
// A day a tool forced to one weather for the whole state (d.all: true) has no background of its own.
function bgRec(d) {
  if (!BG[d.k] || d.all) return d;
  let b = bgCache.get(d);
  if (b) return b;
  const k = BG[d.k];
  b = { ...d, k, rk: d.k, rain: d.k === "storm" ? r2(d.rain * 0.5) : d.rain, snow: d.k === "blizzard" ? r2(d.snow * 0.55) : d.snow, wind: d.k === "fog" ? d.wind : r2(d.wind * 0.5) };
  bgCache.set(d, b);
  return b;
}
// The weather under a front: its kind (rain or snow by the day's cold), cooler or warmer than the day's record for
// it (a rain belt on a clear day: 3 °C cooler; a blizzard on a blizzard day: the record's), its rain, snow and wind.
// Kept per front for the last background sky it was asked over (a front sits over one day at a time, mostly).
let frCache = new WeakMap();
/** @param {any} b the background sky @param {any} f the front */
function frontRec(b, f) {
  const c = frCache.get(f);
  if (c && c.b === b) return c.r;
  const r = makeFrontRec(b, f);
  frCache.set(f, { b, r });
  return r;
}
/** @param {any} b @param {any} f */
function makeFrontRec(b, f) {
  const k = precip(f.k, (b.hi + b.lo) / 2);
  if (RANK[k] <= RANK[b.k]) return b;
  const dT = TEMP_MOD[k] - TEMP_MOD[b.rk || b.k], p = f.p ?? 0.5;
  const rain = k === "storm" ? 0.75 + 0.25 * p : k === "rain" ? 0.3 + 0.3 * p : k === "snow" || k === "blizzard" ? 0 : b.rain;
  const snow = k === "blizzard" ? 0.8 + 0.2 * p : k === "snow" ? 0.3 + 0.3 * p : k === "rain" || k === "storm" ? 0 : b.snow;
  const wind = Math.max(b.wind, WIND[k][0] + (WIND[k][1] - WIND[k][0]) * p);
  return { ...b, k, hi: r1(b.hi + dT), lo: r1(b.lo + dT), rain: r2(rain), snow: r2(snow), wind: r2(wind), front: f };
}
// The weather of a tile at an hour (as known at `known`).
/** @param {State} state @param {number} tileId @param {number} hour @param {number} [known] */
function localRec(state, tileId, hour, known = Infinity) {
  const b = bgRec(rec(state, Math.floor(hour / 24)));
  const a = tileId == null ? null : frontAt(state, tileId, hour, known);
  return a ? frontRec(b, a.f) : b;
}

// Home: the hub's tile, or before there is a hub (the hardcore start) your first team's.
/** @param {State} state */
export function homeTile(state) {
  if (!Array.isArray(state.bases)) return null; // a bare state (farming.js climate tables): no home, no fronts
  const b = hubBase(state);
  if (b) return b.tile;
  const p = (state.parties || []).find((x) => x.owner === "player" && Array.isArray(x.path) && x.path.length);
  return p ? p.path[Math.min(p.idx || 0, p.path.length - 1)] : null;
}

// A tile's day (farming, water, thirst, exposure and the like go by home's): the front that sat over the tile for
// a good part of the day (a storm or blizzard 3 hours, anything else 6), else the background sky; the temperatures
// are the day record's either way.
let dayCache = new WeakMap();
/** @param {State} state @param {number} dayIdx @param {number} [tileId] */
function dayRec(state, dayIdx, tileId = homeTile(state)) {
  const i = Math.max(0, Math.floor(dayIdx));
  const d = rec(state, i);
  if (tileId == null) return bgRec(d);
  const w = state.weather;
  let m = dayCache.get(w);
  if (!m || m.size > 20000) dayCache.set(w, (m = new Map()));
  const key = i * 65536 + tileId;
  let out = m.get(key);
  if (out) return out;
  const b = bgRec(d), hours = new Map();
  for (let h = i * 24; h < i * 24 + 24; h++) {
    const a = frontAt(state, tileId, h);
    if (a) hours.set(a.f, (hours.get(a.f) || 0) + 1);
  }
  out = b;
  for (const [f, n] of hours) {
    const x = frontRec(b, f);
    if (x !== b && n >= (x.k === "storm" || x.k === "blizzard" ? 3 : 6) && RANK[x.k] > RANK[out.k]) out = x;
  }
  // The day's temperatures stay the region's (heating, appetite, frost and crop growth go by the season's day as
  // before); a front changes the day's kind, rain, snow and wind.
  if (out !== b) out = { ...out, hi: b.hi, lo: b.lo };
  m.set(key, out);
  return out;
}

// Temperature at an hour of the day: coldest around 05:00, warmest around 15:00.
function tempAt(d, hourOfDay) {
  return r1((d.hi + d.lo) / 2 + ((d.hi - d.lo) / 2) * Math.cos((2 * Math.PI * (hourOfDay - 15)) / 24));
}

/** @param {number} hour */
function describe(d, hour) {
  const def = WEATHER[d.k];
  return {
    key: d.k, name: def.name, icon: def.icon, desc: def.desc,
    temp: tempAt(d, ((hour % 24) + 24) % 24), hi: d.hi, lo: d.lo,
    rain: d.rain, snow: d.snow, wind: d.wind, severe: !!def.severe,
    mud: d.frozen ? 0 : d.mud, snowCover: d.cover, soil: d.soil, frozen: d.frozen, dryDays: d.dry,
    front: d.front ? FRONT_KINDS[d.front.k]?.name || def.name : null,
  };
}

// The weather now (or at a given hour) at home, or on a given tile: the background sky, or the front over it.
/** @param {State} state @param {number} [hour] @param {number} [tileId] */
export function weather(state, hour = state.hour, tileId = homeTile(state)) {
  return describe(localRec(state, tileId, hour), hour);
}
/** @param {State} state @param {number} tileId @param {number} [hour] */
export const weatherAt = (state, tileId, hour = state.hour) => weather(state, hour, tileId);
/** @param {State} state @param {number} x @param {number} y @param {number} [hour] */
export const wxAt = (state, x, y, hour = state.hour) => weather(state, hour, y * (state.grid ? state.grid.width : 64) + x);
// The weather of a campaign day at home, or on a tile (1-based day number, as the clock shows it): the front that
// sat over it a good part of the day, else the day's sky. For the diary, hub events, the timelapse, tools.
/** @param {State} state @param {number} dayNumber @param {number|null} [tileId] */
export const weatherOnDay = (state, dayNumber, tileId = homeTile(state)) => describe(dayRec(state, dayNumber - 1, tileId), 12);
// The region's weather that day (the day record, storms and all): what the forecast foretells.
/** @param {State} state @param {number} dayNumber */
export const regionOnDay = (state, dayNumber) => describe(rec(state, dayNumber - 1), 12);

// Rain fog (seasonfx.js, the user's request 2026-10-23: "show rain fog can occur to that limit visibility range"): a
// mist off the rain over a tile under rain or a storm, one roll a day for each weather system (the front over the tile,
// or the day's sky): RAIN_FOG.chance, ×spring in spring, +dawn from dawnH[0] to dawnH[1] o'clock (the same roll, so the
// fog of a dawn lifts later in the day). Its own hash of the seed: no RNG stream is touched.
export const RAIN_FOG = { chance: 0.15, spring: 2, dawn: 0.2, dawnH: [4, 9] };
/** @param {State} state @param {number | null} tileId @param {number} [hour] */
export function rainFog(state, tileId, hour = state.hour) {
  const d = localRec(state, tileId, hour);
  if (!(d.k === "rain" || d.k === "storm") || !(d.rain > 0)) return false;
  const day = Math.floor(hour / 24), h = ((hour % 24) + 24) % 24;
  const p = RAIN_FOG.chance * (seasonOfDay(day).key === "spring" ? RAIN_FOG.spring : 1) + (h >= RAIN_FOG.dawnH[0] && h < RAIN_FOG.dawnH[1] ? RAIN_FOG.dawn : 0);
  return new Rng(hash(ensure(state).seed ^ 0x6f9a, day, d.front ? d.front.id : 0xfff)).next() < p;
}

// ---------- forecast (what the player is told) ----------
function hash(a, b, c) {
  let h = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 1) >>> 0, 0xc2b2ae35) ^ Math.imul((c + 7) >>> 0, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}

/** @param {State} state */
function hubBase(state) {
  try { return hub(state); } catch { return null; }
}

// How many days ahead the holdout can forecast: reading the sky gives 3; a watchtower 4; a radio station 5.
/** @param {State} state */
export function forecastRange(state) {
  const bases = (state.bases || []).filter((b) => b.owner == null || b.owner === "player");
  if (bases.some((b) => b.radio)) return 5;
  if (bases.some((b) => b.watchtower)) return 4;
  return 3;
}

// The coming days as the holdout expects them. Tomorrow is nearly always right; further out the guess can be wrong
// (a neighbouring kind of weather, temperatures off by a few degrees). A radio station or a watchtower helps.
// The same day asks give the same answers (no flicker), and the forecast is redrawn each morning.
/** @param {State} state @param {number} [days] */
export function forecast(state, days = forecastRange(state)) {
  const w = ensure(state);
  const today = dayIndex(state);
  const bases = (state.bases || []);
  const skill = bases.some((b) => b.radio) ? 0.1 : bases.some((b) => b.watchtower) ? 0.05 : 0;
  const out = [];
  for (let off = 1; off <= days; off++) {
    const i = today + off;
    const d = rec(state, i);
    const s = seasonOfDay(i);
    const wrong = clamp(0.04 + 0.1 * (off - 1) - skill, 0.02, 0.6);
    const h = new Rng(hash(w.seed, today, i));
    let k = d.k, hi = d.hi, lo = d.lo;
    if (h.next() < wrong) {
      const weights = WEIGHTS[s.key];
      const keys = Object.keys(weights).filter((x) => x !== d.k && (x !== "heat" || d.hi > 22) && (x !== "frost" || d.lo < 4));
      k = h.weighted(keys, (x) => weights[x]);
      if ((d.hi + d.lo) / 2 < -0.5) k = k === "rain" ? "snow" : k === "storm" ? "blizzard" : k;
    }
    const err = (h.next() - 0.5) * 2 * Math.min(5, off - 1);
    hi = Math.round(hi + err); lo = Math.round(lo + err);
    const def = WEATHER[k];
    out.push({
      day: i + 1, offset: off, key: k, name: def.name, icon: def.icon, hi, lo, severe: !!def.severe,
      confidence: r2(1 - wrong), season: s.key,
    });
  }
  return out;
}

// True if the forecast (what the holdout believes) has a storm or blizzard within `days` days, today included.
/** @param {State} state @param {number} [days] */
export function severeSoon(state, days = 1) {
  if (weather(state).severe) return true;
  return forecast(state, Math.min(days, forecastRange(state))).some((f) => f.severe);
}

// ---------- travel ----------
// Multiplier on the cost of entering `tileId` (from `from`, if given) at `hour`. 1 = normal, higher = slower.
// Movement (parties.js stepAlong) and every estimate (travelHours) call this with the hour being simulated.
// The day's table is the ground and the background sky; a front over the tile adds its own share (KIND_TF).
// known: estimates pass the hour they are made in, so only fronts already on the map count (Infinity: all).
/** @param {State} state @param {{ vehicle?: boolean | "bike", tileId?: number | null, from?: number | null, hour?: number, known?: number }} [opts] */
export function travelFactor(state, { vehicle = false, tileId = null, from = null, hour = state.hour, known = Infinity } = {}) {
  let road = false;
  if (tileId != null) {
    const links = from != null ? state.tiles[from]?.roadLinks : null;
    road = links ? links.includes(tileId) : (state.tiles[tileId]?.roadLinks?.length || 0) > 0;
  }
  return localTable(state, tileId, hour, known)[(vehicle ? 2 : 0) + (road ? 0 : 1)];
}
// The four multipliers on a tile at an hour: the day's table, plus what a front over it adds.
/** @param {State} state @param {number} tileId @param {number} hour @param {number} [known] */
function localTable(state, tileId, hour, known = Infinity) {
  const d = rec(state, Math.floor(hour / 24));
  const a = tileId == null ? null : frontAt(state, tileId, hour, known);
  if (!a) return d.tf;
  const b = bgRec(d), k = precip(a.f.k, (b.hi + b.lo) / 2);
  if (RANK[k] <= RANK[b.k]) return d.tf;
  const x = KIND_TF[k] || NO_TF, y = KIND_TF[b.k] || NO_TF;
  return d.tf.map((v, j) => Math.min(3, r2(v + Math.max(0, x[j] - y[j]))));
}

// Everything weather does to a team on the move right now (at home, or on `tileId`: where the team is), plus
// plain-text lines for panels and tooltips.
/** @param {State} state @param {number} [hour] @param {number} [tileId] */
export function travelEffects(state, hour = state.hour, tileId = homeTile(state)) {
  const d = localRec(state, tileId, hour);
  const [footRoad, footOff, vehRoad, vehOff] = localTable(state, tileId, hour);
  const k = d.k;
  const sight = k === "fog" || k === "blizzard" ? -1 : 0;
  const ambush = k === "fog" ? 0.08 : k === "blizzard" ? 0.05 : k === "storm" ? 0.03 : 0;
  const injury = k === "blizzard" ? 0.025 : k === "storm" ? 0.015 : 0; // per hour on the move, on foot (half in a vehicle)
  const events = k === "storm" || k === "blizzard" ? 1.15 : 1;
  const boat = k === "storm" ? 2.5 : k === "blizzard" ? 2 : d.wind > 0.5 ? 1.5 : 1;
  const pct = (f) => `${f > 1 ? "+" : ""}${Math.round((f - 1) * 100)}%`;
  const lines = [];
  if (d.front) lines.push(`${WEATHER[k].icon} ${FRONT_KINDS[d.front.k]?.name || WEATHER[k].name} overhead${frontLeaves(state, tileId, d.front, hour)}`);
  if (footOff > 1.005 || vehOff > 1.005 || footRoad > 1.005 || vehRoad > 1.005) {
    lines.push(`Travel time on foot: roads ${pct(footRoad)}, off-road ${pct(footOff)}`);
    lines.push(`Travel time by vehicle: roads ${pct(vehRoad)}, off-road ${pct(vehOff)}`);
  } else lines.push("Travel: normal pace");
  if (!d.frozen && d.mud >= 0.15) lines.push(`Mud ${Math.round(d.mud * 100)}% (off-road, worst for vehicles)`);
  if (d.cover >= 0.05) lines.push(`Snow cover ${Math.round(d.cover * 100)}%`);
  if (sight) lines.push("Teams see 1 tile less");
  if (k === "fog") lines.push("Fog: everyone in a fight here sees 4 tiles less (far less at night)"); // wxsight.js WX_SIGHT
  else if ((k === "rain" || k === "storm") && rainFog(state, tileId, hour)) lines.push("Rain fog: everyone in a fight here sees 4 tiles less (far less at night)"); // wxsight.js WX_SIGHT
  if (k === "rain" || k === "storm") lines.push("Rain: sounds carry less in a fight, noise lures drowned out"); // seasonfx.js HEAR
  if (ambush) lines.push("Easier to be ambushed");
  if (injury) lines.push(`Injury risk on the road (${(injury * 100).toFixed(1)}% an hour on foot)`);
  if (boat > 1) lines.push(`Boat mishaps ${boat}× as likely`);
  return { footRoad, footOff, vehRoad, vehOff, sight, ambush, injury, events, boat, lines };
}

// Called by parties.js once an hour for a player team that moved: storms and blizzards can hurt someone.
// Returns the survivor who was hurt, or null. Uses the play RNG only in severe weather.
// The weather where the team is (a storm or blizzard front over it).
/** @param {State} state @param {Party} p @param {Survivor[]} members */
export function travelHazard(state, p, members) {
  const d = localRec(state, p.path ? p.path[p.idx] : homeTile(state), state.hour);
  if (!WEATHER[d.k].severe || !members.length) return null;
  const chance = (d.k === "blizzard" ? 0.025 : 0.015) * (p.vehicle ? 0.5 : 1);
  if (!state.rng.chance(chance)) return null;
  const s = state.rng.pick(members);
  const dmg = state.rng.int(4, 10);
  const what = d.k === "blizzard" ? (p.vehicle ? "is hurt when the vehicle slides off the road in the blizzard" : "gets frostbite in the blizzard")
    : (p.vehicle ? "is hurt when the vehicle skids in the storm" : "takes a bad fall in the storm");
  hurt(state, s, dmg, p.path ? p.path[p.idx] : null, d.k === "blizzard" ? "the blizzard" : "the storm");
  if (s.alive) log(state, `${p.name ? p.name + ": " : ""}${s.name} ${what} (−${dmg} health).`, "bad");
  return s;
}

// ---------- farming ----------
const CROP_DEFAULT = { seasons: ["spring", "summer", "autumn"], hardy: 0.3, thirst: 0.5, tMin: 6, tOpt: [14, 26], tall: 0.4 };
// hardy: frost tolerance (0 tender .. 1 hardy). thirst: water need (0..1). tMin: no growth at or below this mean temperature.
// tOpt: best range of mean temperature. tall: how much storms hurt it (0..1). sheltered: under glass (a greenhouse):
// grey skies and snow do not slow it and storms and blizzards cannot flatten it (frost still counts against hardy and tMin,
// so a greenhouse passes those raised). A climate with all four seasons, hardy 1 and tall 0 counts as sheltered too.
export const CROP_CLIMATE = {
  potato:  { seasons: ["spring", "summer", "autumn"], hardy: 0.5, thirst: 0.5, tMin: 6, tOpt: [12, 23], tall: 0.1 },
  corn:    { seasons: ["spring", "summer"], hardy: 0, thirst: 0.7, tMin: 10, tOpt: [18, 30], tall: 1 },
  wheat:   { seasons: ["spring", "summer", "autumn"], hardy: 0.8, thirst: 0.3, tMin: 3, tOpt: [10, 24], tall: 0.7 },
  beans:   { seasons: ["spring", "summer"], hardy: 0.1, thirst: 0.5, tMin: 9, tOpt: [16, 28], tall: 0.5 },
  tomato:  { seasons: ["spring", "summer"], hardy: 0, thirst: 0.8, tMin: 10, tOpt: [18, 28], tall: 0.6 },
  squash:  { seasons: ["summer", "autumn"], hardy: 0.1, thirst: 0.6, tMin: 9, tOpt: [16, 28], tall: 0.2 },
  pumpkin: { seasons: ["summer", "autumn"], hardy: 0.1, thirst: 0.6, tMin: 9, tOpt: [16, 28], tall: 0.2 },
  carrot:  { seasons: ["spring", "summer", "autumn"], hardy: 0.7, thirst: 0.4, tMin: 4, tOpt: [10, 22], tall: 0 },
  cabbage: { seasons: ["spring", "autumn", "winter"], hardy: 0.9, thirst: 0.5, tMin: 1, tOpt: [8, 20], tall: 0.1 },
  turnip:  { seasons: ["spring", "autumn", "winter"], hardy: 1, thirst: 0.3, tMin: 0, tOpt: [6, 18], tall: 0 },
  kale:    { seasons: ["spring", "autumn", "winter"], hardy: 1, thirst: 0.4, tMin: 0, tOpt: [6, 18], tall: 0.1 },
};
/** @param {string} key */
export function registerCrop(key, climate) {
  CROP_CLIMATE[key] = { ...CROP_DEFAULT, ...climate };
}
const CLIMATE_FIELDS = ["seasons", "hardy", "thirst", "tMin", "tOpt", "tall", "sheltered"];
export function cropClimate(crop) {
  if (crop && typeof crop === "object") return { ...CROP_DEFAULT, ...(crop.climate || crop) };
  const key = String(crop || "").toLowerCase();
  // @ts-expect-error data.js has no CROPS (the hook is unused: farming.js registers its crops with registerCrop)
  const def = data.CROPS?.[crop] || data.CROPS?.[key];
  const fromData = {};
  if (def) for (const f of CLIMATE_FIELDS) if (def[f] != null) fromData[f] = def[f];
  return { ...CROP_DEFAULT, ...(CROP_CLIMATE[key] || {}), ...fromData, ...(def?.climate || {}) };
}

// A crop grows only in its seasons (a hardy winter crop lists "winter").
/** @param {State} state @param {number} [dayIdx] */
export function isGrowingSeason(state, crop, dayIdx = dayIndex(state)) {
  return cropClimate(crop).seasons.includes(seasonOfDay(dayIdx).key);
}
// Days of growing season left for this crop, today included (0 when out of season). For "will it ripen in time?".
/** @param {State} state @param {number} [dayIdx] */
export function growingDaysLeft(state, crop, dayIdx = dayIndex(state)) {
  const seasons = cropClimate(crop).seasons;
  if (seasons.length >= 4) return Infinity;
  let n = 0;
  while (n < YEAR_DAYS && seasons.includes(seasonOfDay(dayIdx + n).key)) n += seasonOfDay(dayIdx + n).daysLeft + 1;
  return n;
}

// Growth multiplier for one day: 0 out of season or too cold, about 1 in fair weather, up to 1.3 on a warm day
// with moist soil and sun.
/** @param {State} state @param {number} [dayIdx] */
export function growthFactor(state, crop, dayIdx = dayIndex(state)) {
  const c = cropClimate(crop);
  const d = dayRec(state, dayIdx);
  if (!c.seasons.includes(seasonOfDay(dayIdx).key)) return 0;
  const mean = (d.hi + d.lo) / 2;
  if (mean <= c.tMin) return 0;
  const t = mean < c.tOpt[0] ? 0.25 + 0.75 * ((mean - c.tMin) / Math.max(1, c.tOpt[0] - c.tMin))
    : mean <= c.tOpt[1] ? 1 : Math.max(0.4, 1 - (mean - c.tOpt[1]) * 0.08);
  const dryAt = 0.15 + 0.2 * c.thirst;
  const m = d.soil < dryAt ? 0.35 + 0.65 * (d.soil / dryAt) : d.soil > 0.92 ? 0.85 : 1 + 0.15 * Math.min(1, (d.soil - dryAt) / 0.4);
  const shelter = c.sheltered || (c.seasons.length >= 4 && c.hardy >= 1 && !c.tall);
  const sky = shelter ? 1 : { clear: 1.1, overcast: 0.95, rain: 1.05, storm: 0.85, fog: 0.9, heat: 0.85, drought: 0.75, snow: 0.3, blizzard: 0.1, frost: 0.6 }[d.k];
  const cover = !shelter && d.cover > 0.3 ? 0.3 : 1;
  return clamp(r2(t * m * sky * cover), 0, 1.3);
}

// Daily chances that a standing crop dies (kill) and that a ripe crop or a harvest in the field rots (rot).
// reason names the main cause ("" when there is no risk): frost, hard freeze, cold snap, blizzard, drought, heat,
// storm, wet, snow. Winter (winter.js FROST): frost and a hard freeze × frostMult (winter, late autumn, early spring),
// and outdoors a cold snap that takes hardy crops too (coldSnap); under glass neither.
/** @param {State} state @param {number} [dayIdx] */
export function cropDamage(state, crop, dayIdx = dayIndex(state)) {
  const c = cropClimate(crop);
  const d = dayRec(state, dayIdx);
  /** @type {[string, number][]} */
  const causes = [];
  const tender = 1 - clamp(c.hardy, 0, 1);
  const shelter = c.sheltered || (c.seasons.length >= 4 && c.hardy >= 1 && !c.tall);
  const fm = frostMult(dayIdx);
  if (d.lo <= -4) causes.push(["hard freeze", Math.min(0.9, 0.65 * tender * fm) + (d.lo <= -12 && !shelter ? 0.03 : 0)]);
  else if (d.lo <= 0 || d.k === "frost") causes.push(["frost", 0.35 * tender * fm]);
  if (!shelter) { const snap = coldSnap(dayIdx, d); if (snap > 0) causes.push(["cold snap", snap]); }
  if (d.k === "blizzard" && !shelter) causes.push(["blizzard", 0.03 + 0.2 * tender]);
  if (!d.frozen && d.hi > 8 && (d.k === "drought" || d.soil < 0.1)) causes.push(["drought", Math.min(0.15, (0.02 + 0.01 * Math.max(0, d.dry - 5)) * (0.5 + c.thirst))]);
  if (d.k === "heat") causes.push(["heat", 0.01 + 0.03 * c.thirst]);
  if (d.k === "storm" && !shelter) causes.push(["storm", 0.02 + 0.07 * c.tall]);
  let kill = 0, reason = "", top = 0;
  for (const [name, p] of causes) {
    kill = 1 - (1 - kill) * (1 - p);
    if (p > top) { top = p; reason = name; }
  }
  let rot = 0, rotReason = "";
  if (d.k === "storm") { rot = 0.15; rotReason = "wet"; }
  else if (d.k === "rain") { rot = 0.08; rotReason = "wet"; }
  else if (d.k === "snow" || d.k === "blizzard" || d.cover > 0.2) { rot = 0.2; rotReason = "snow"; }
  if (d.soil > 0.85 && d.k !== "snow" && d.k !== "blizzard") { rot += 0.08; rotReason = rotReason || "wet"; }
  if (shelter) rot *= 0.25; // under glass: little rain or snow reaches it
  return { kill: r2(clamp(kill, 0, 0.95)), rot: r2(clamp(rot, 0, 0.6)), reason: reason || rotReason };
}

// Water one rain collector (barrel, tarp) gathers today. A wet day gives about 2-3.5, a storm 4.5-6, melting snow a little.
/** @param {State} state @param {number} [dayIdx] */
export function rainWater(state, dayIdx = dayIndex(state)) {
  const d = dayRec(state, dayIdx);
  return r1(d.rain * 6 + d.snow * 1.5);
}
// Multiplier on what a well or a stream gives: less in a dry spell, a little more after wet weeks.
/** @param {State} state @param {number} [dayIdx] */
export function wellFactor(state, dayIdx = dayIndex(state)) {
  const d = dayRec(state, dayIdx);
  if (d.k === "drought" || d.dry >= 6 || d.soil < 0.15) return 0.6;
  if (d.frozen) return 0.8;
  return d.soil > 0.6 ? 1.15 : 1;
}

// ---------- drinking ----------
// Water a person drinks a day, as a multiple of the usual 1: by season, and at least THIRST.heat on a hot day (a heat
// wave, or 30 °C and up). The same factor applies at every base, to teams in the field (per hour, the load bands on
// top), prisoners and guests, and to every water estimate (economy.js, parties.js, plans.js).
export const THIRST = { spring: 1, summer: 1.3, autumn: 1, winter: 0.9, heat: 1.6 };
export const hotDay = (d) => d.k === "heat" || d.hi >= 30;
/** @param {State} state @param {number} [dayIdx] */
export function thirstFactor(state, dayIdx = dayIndex(state)) {
  const s = THIRST[seasonOfDay(dayIdx).key] ?? 1;
  return (hotDay(dayRec(state, dayIdx)) ? Math.max(s, THIRST.heat) : s) * cfgOf(state, "thirst"); // worldcfg.js: the run's Thirst dial
}
// The factor for the hour a team drinks in (parties.js consume runs after the clock moves on).
/** @param {State} state @param {number} [hour] */
export const thirstAt = (state, hour = state.hour) => thirstFactor(state, dayIndex(state, hour));
// The highest factor over the next `days` days, today included (packing with a margin: crews, caravans).
/** @param {State} state @param {number} [days] */
export function thirstAhead(state, days = 1) {
  const today = dayIndex(state);
  let f = 0;
  for (let i = 0; i < Math.max(1, Math.ceil(days)); i++) f = Math.max(f, thirstFactor(state, today + i));
  return f;
}
const thirstNote = (f) => (f > 1.001 ? `everyone drinks ${Math.round((f - 1) * 100)}% more water` : f < 0.999 ? `everyone drinks ${Math.round((1 - f) * 100)}% less water` : "");

// ---------- people and the dead ----------
// Chance per person per day spent outdoors (travel, farm work, scavenging) of falling ill from cold or heat.
// sheltered: indoors with a roof and a fire (a quarter of the risk).
/** @param {State} state */
export function exposureRisk(state, { sheltered = false, dayIdx = dayIndex(state) } = {}) {
  const d = dayRec(state, dayIdx);
  let chance = 0, kind = null, reason = "";
  if (d.k === "blizzard") { chance = 0.1; kind = "cold"; reason = "blizzard"; }
  else if (d.lo <= -8) { chance = 0.06; kind = "cold"; reason = "bitter cold"; }
  else if (d.lo <= -2) { chance = 0.03; kind = "cold"; reason = "freezing nights"; }
  else if (d.lo <= 3 && (d.k === "rain" || d.k === "storm")) { chance = 0.02; kind = "cold"; reason = "cold rain"; }
  else if (d.k === "heat" || d.hi >= 33) { chance = 0.04; kind = "heat"; reason = "heat wave"; }
  else if (d.hi >= 30) { chance = 0.015; kind = "heat"; reason = "hot days"; }
  if (sheltered) chance *= 0.25;
  return { chance: r2(chance * 100) / 100, kind, reason, temp: kind === "heat" ? d.hi : d.lo };
}

// Speed multiplier for hordes: the dead stiffen in the cold and flounder in deep snow.
/** @param {State} state @param {number} [dayIdx] */
export function hordeSpeedFactor(state, dayIdx = dayIndex(state)) {
  const d = dayRec(state, dayIdx);
  const mean = (d.hi + d.lo) / 2;
  let f = d.k === "blizzard" || mean < -8 ? 0.5 : mean < -2 ? 0.7 : 1;
  if (d.cover > 0.5) f *= 0.85;
  return r2(Math.max(0.4, f));
}

// The same for one horde, by the weather where it is this hour (a blizzard over it halves its pace).
/** @param {State} state @param {number} tileId @param {number} [hour] */
export function hordeSpeedAt(state, tileId, hour = state.hour) {
  const d = localRec(state, tileId, hour);
  const mean = (d.hi + d.lo) / 2;
  let f = d.k === "blizzard" || mean < -8 ? 0.5 : mean < -2 ? 0.7 : 1;
  if (d.cover > 0.5) f *= 0.85;
  return r2(Math.max(0.4, f));
}

// The mean temperature of a day (°C): what heating (upkeep.js heatRate) and the cold's appetite go by.
/** @param {State} state @param {number} [dayIdx] */
export function dayMeanTemp(state, dayIdx = dayIndex(state)) {
  const d = dayRec(state, dayIdx);
  return (d.hi + d.lo) / 2;
}
// The low of a day (°C, about 05:00): the night's fires go by it (upkeep.js HEAT.chillAt: a cool night below it burns
// wood for warmth at every base, a freezing day the whole day).
/** @param {State} state @param {number} [dayIdx] */
export function dayLowTemp(state, dayIdx = dayIndex(state)) {
  return dayRec(state, dayIdx).lo;
}
// The season's mean for a day before its weather (seasonalMean), for the wood plans (woodcutting.js chillDaysAhead:
// the nights ahead that will want a fire) without generating the days.
/** @param {number} dayIdx */
export const seasonalMeanTemp = (dayIdx) => seasonalMean(dayIdx);

// People burn more food keeping warm.
/** @param {State} state @param {number} [dayIdx] */
export function foodNeedFactor(state, dayIdx = dayIndex(state)) {
  const d = dayRec(state, dayIdx);
  const mean = (d.hi + d.lo) / 2;
  return mean < -8 ? 1.2 : mean < 0 ? 1.1 : 1;
}
// The factor for the hour a team eats in (as thirstAt: parties.js consume runs after the clock moves on), and the
// highest over the next `days` days, today included (packing with a margin, as thirstAhead).
/** @param {State} state @param {number} [hour] */
export const coldAt = (state, hour = state.hour) => foodNeedFactor(state, dayIndex(state, hour));
/** @param {State} state @param {number} [days] */
export function coldAhead(state, days = 1) {
  const today = dayIndex(state);
  let f = 0;
  for (let i = 0; i < Math.max(1, Math.ceil(days)); i++) f = Math.max(f, foodNeedFactor(state, today + i));
  return f;
}

// ---------- ticks ----------
// Once a day (world.js, at midnight): the new day's weather is fixed and anything notable goes in the log. The day
// record is the region's: its storms, blizzards and fog come as fronts that may or may not pass over you.
/** @param {State} state */
export function weatherDaily(state) {
  const w = ensure(state);
  const i = dayIndex(state);
  const d = rec(state, i);
  rec(state, i + 7); // the week ahead, so forecasts and short estimates never generate inside a render
  // Fronts long gone are dropped (40 days back: the diary and the timelapse do not need them).
  if (w.fronts.length && w.fronts[0].t1 < state.hour - 40 * 24) w.fronts = w.fronts.filter((f) => f.t1 >= state.hour - 40 * 24);
  if (w.lastLogged === i) return;
  w.lastLogged = i;
  const s = seasonOfDay(i);
  const prev = i > 0 ? w.days[i - 1] : null;
  if (s.dayOfSeason === 1) log(state, `${s.icon} ${s.name} begins. ${s.desc}`, "info");
  if (!prev || prev.k === d.k) return;
  const def = WEATHER[d.k];
  if (def.severe) log(state, `${def.icon} ${d.k === "blizzard" ? "Blizzards" : "Storms"} are about today (${Math.round(d.lo)} to ${Math.round(d.hi)} °C): travel under one is slow and risky. They cross the map from its edges (the Weather layers show where).`, "bad");
  else if (d.k === "snow" && prev.cover < 0.05) log(state, `${def.icon} Snow is falling. Travel slows as it builds up, off-road most of all.`, "info");
  else if (d.k === "heat") log(state, `${def.icon} A heat wave sets in (${Math.round(d.hi)} °C): everyone drinks ${Math.round((THIRST.heat - 1) * 100)}% more water while it lasts.`, "info");
  else if (d.k === "drought") log(state, `${def.icon} A dry spell: no rain in sight and the soil is drying out.`, "info");
  else if (d.k === "frost" && s.key !== "winter") log(state, `${def.icon} Frost overnight (${Math.round(d.lo)} °C): tender crops are at risk.`, "info");
}

// Once an hour (world.js): nothing to roll (the day's weather is fixed); keeps old states working.
/** @param {State} state */
export function weatherHour(state) {
  const w = ensure(state);
  if (w.days.length <= dayIndex(state)) rec(state, dayIndex(state));
}

// ---------- text for the UI ----------
/** @param {State} state */
export function weatherSummary(state) {
  const s = season(state), w = weather(state);
  return `${s.icon} ${s.name} ${s.dayOfSeason}/${SEASON_DAYS} · ${w.icon} ${w.name} ${Math.round(w.temp)}°C`;
}

// Multi-line plain text: season, today, effects on travel and farming, and the forecast. Used as a tooltip.
/** @param {State} state */
export function weatherReport(state) {
  const s = season(state), w = weather(state), fx = travelEffects(state);
  const lines = [
    `${s.icon} ${s.name}, day ${s.dayOfSeason} of ${SEASON_DAYS} (year ${s.year}; ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left). ${s.desc}`,
    "",
    `${w.icon} ${w.name}: now ${Math.round(w.temp)} °C (${Math.round(w.lo)} to ${Math.round(w.hi)} °C). ${w.desc}`,
    ...fx.lines.map((l) => `• ${l}`),
  ];
  const g = growthFactor(state, null), dmg = cropDamage(state, null);
  lines.push(`• Crops: ${g <= 0 ? "no growth today" : `growth ${Math.round(g * 100)}%`}` +
    (dmg.kill >= 0.01 ? `, ${Math.round(dmg.kill * 100)}% risk of dying (${dmg.reason})` : "") +
    (dmg.rot >= 0.01 ? `, ripe crops may rot (${Math.round(dmg.rot * 100)}%)` : "") +
    ` · soil moisture ${Math.round(w.soil * 100)}%`);
  const rw = rainWater(state);
  if (rw > 0) lines.push(`• Rain water: +${rw} per collector today`);
  const tf = thirstFactor(state);
  if (thirstNote(tf)) lines.push(`• Water: ${thirstNote(tf)} (${r2(tf)} a day each${hotDay(dayRec(state, dayIndex(state))) ? ", a hot day" : ` in ${s.name.toLowerCase()}`})`);
  const ex = exposureRisk(state);
  if (ex.chance > 0) lines.push(`• Exposure: ${ex.reason} (${(ex.chance * 100).toFixed(1)}% a day outdoors)`);
  const hs = hordeSpeedFactor(state);
  if (hs < 1) lines.push(`• The dead move at ${Math.round(hs * 100)}% speed in this cold`);
  const ir = iceText(state);
  if (ir) lines.push(`• ${ir}`);
  const near = frontsApproaching(state).filter((x) => !x.over).slice(0, 5);
  if (near.length) {
    lines.push("", "Weather fronts on the map:");
    for (const x of near) lines.push(`${x.icon} ${x.name} ${x.dist} tile${x.dist === 1 ? "" : "s"} ${x.dir}, ${x.eta != null ? `here ${whenText(state, x.eta)}` : `moving ${x.heading}, passing you by`}`);
  }
  const fc = forecast(state);
  lines.push("", `Outlook for the region (${fc.length} days${forecastRange(state) < 5 ? "; a watchtower or radio station sees further and better" : ""}; storms, blizzards and fog come as fronts that may miss you):`);
  for (const f of fc) {
    const hot = f.key === "heat" || f.hi >= 30;
    lines.push(`Day ${f.day}: ${f.icon} ${f.name}, ${f.lo} to ${f.hi} °C${hot ? ` (hot: everyone drinks ${Math.round((THIRST.heat - 1) * 100)}% more water)` : ""}${f.confidence < 0.8 ? " (uncertain)" : ""}`);
  }
  return lines.join("\n");
}

// ---------- map look ----------
// A light wash over the land for the map renderer (render.js, "Weather" layer): snow whitens it, rain and storms
// darken it, fog greys it, heat and dry spells warm it, autumn browns it a little. null = no wash.
/** @param {State} state @param {number} [hour] */
export function weatherTint(state, hour = state.hour) {
  const d = bgRec(rec(state, dayIndex(state, hour))); // the statewide sky: the fronts are drawn on their own (ui/wxmap.js)
  const s = seasonOfDay(dayIndex(state, hour)).key;
  if (d.cover >= 0.08) return `rgba(235,240,248,${r2(Math.min(0.42, 0.1 + d.cover * 0.35))})`;
  if (d.k === "blizzard") return "rgba(225,232,242,0.35)";
  if (d.k === "storm") return "rgba(10,16,32,0.26)";
  if (d.k === "rain") return "rgba(16,24,44,0.16)";
  if (d.k === "fog") return "rgba(170,175,180,0.2)";
  if (d.k === "frost") return "rgba(200,220,240,0.14)";
  if (d.k === "heat" || d.k === "drought") return "rgba(230,170,60,0.12)";
  if (s === "autumn") return "rgba(170,100,30,0.1)";
  if (s === "winter") return "rgba(170,190,220,0.1)";
  return null;
}

// ---------- fronts for the UI ----------
const COMPASS = ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"];
// The compass direction of a vector in tile units (y grows southward).
export const compass = (dx, dy) => COMPASS[(Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)) + 8) % 8];

// When something `h` hours from now happens, in words: "within the hour", "by evening (5 h)", "tomorrow morning (19 h)".
/** @param {State} state */
export function whenText(state, h) {
  if (h <= 1) return "within the hour";
  const at = state.hour + h, hod = at % 24, days = Math.floor(at / 24) - Math.floor(state.hour / 24);
  const part = hod < 5 ? "night" : hod < 11 ? "morning" : hod < 14 ? "midday" : hod < 18 ? "afternoon" : hod < 22 ? "evening" : "night";
  let when;
  if (days === 0) when = part === "night" ? "tonight" : `by ${part}`;
  else if (days === 1) when = hod < 5 ? "tonight" : `tomorrow ${part}`;
  else when = days === 2 ? "the day after tomorrow" : `in ${days} days`;
  return `${when} (${h} h)`;
}

// " (clears in about N h)" for a front over a tile.
/** @param {State} state @param {number} tileId @param {number} [hour] */
function frontLeaves(state, tileId, f, hour = state.hour) {
  if (tileId == null) return "";
  const [ux, uy] = tileUnits(state, tileId);
  for (let t = hour + 1; t <= hour + 72; t++) {
    if (t >= f.t1) return ` (clears in about ${t - hour} h)`;
    const x = f.x + f.vx * (t - f.t0), y = f.y + f.vy * (t - f.t0), r = frontRadius(f, t);
    if ((ux - x) ** 2 + (uy - y) ** 2 > r * r) return ` (clears in about ${t - hour} h)`;
  }
  return "";
}

// The fronts on the map now (as you see them) and what they will do at a tile (home by default): over it now,
// arriving in `eta` hours (straight on at their speed, as everyone can see), or passing by. Nearest first.
/** @param {State} state @param {number} [tileId] @param {number} [horizon] */
export function frontsApproaching(state, tileId = homeTile(state), horizon = 48) {
  const now = state.hour, out = [];
  if (tileId == null || !state.tiles) return out;
  const [ux, uy] = tileUnits(state, tileId);
  const b = bgRec(rec(state, dayIndex(state)));
  for (const a of activeFronts(state, now, now)) {
    const f = a.f, k = precip(f.k, (b.hi + b.lo) / 2);
    if (RANK[k] <= RANK[b.k]) continue; // a rain belt on a rainy day: nothing to see
    const dist = Math.hypot(ux - a.x, uy - a.y), over = dist <= a.r;
    let eta = null;
    if (!over) for (let h = 1; h <= horizon && now + h < f.t1; h++) {
      const t = now + h, x = f.x + f.vx * (t - f.t0), y = f.y + f.vy * (t - f.t0), r = frontRadius(f, t);
      if ((ux - x) ** 2 + (uy - y) ** 2 <= r * r) { eta = h; break; }
    }
    const def = WEATHER[k];
    out.push({ f, k, name: FRONT_KINDS[k]?.name || def.name, icon: def.icon, severe: !!def.severe, dist: Math.max(0, Math.round(dist - a.r)), dir: compass(a.x - ux, a.y - uy), heading: compass(f.vx, f.vy), over, eta });
  }
  return out.sort((x, y) => (+y.over - +x.over) || ((x.eta ?? 999) - (y.eta ?? 999)) || x.dist - y.dist);
}

// The fronts to draw on the map: the ones on it now, where they are `frac` of the way into the coming hour
// (they glide), in tile units, with the kind they bring (rain or snow by the cold). For ui/wxmap.js.
/** @param {State} state @param {number} [frac] */
export function visibleFronts(state, frac = 0) {
  const now = state.hour, out = [];
  if (!state.weather || !state.tiles) return out;
  const b = bgRec(rec(state, dayIndex(state)));
  for (const a of activeFronts(state, now, now)) {
    const f = a.f, k = precip(f.k, (b.hi + b.lo) / 2), t = now + frac;
    if (RANK[k] <= RANK[b.k]) continue;
    out.push({ id: f.id, k, name: FRONT_KINDS[k]?.name || WEATHER[k].name, x: f.x + f.vx * (t - f.t0), y: f.y + f.vy * (t - f.t0), r: Math.max(0, frontRadius(f, t)), vx: f.vx, vy: f.vy });
  }
  return out;
}

// ---------- frozen rivers ----------
// ICE: a river tile freezes once the freezing index (degree-days) reaches ICE.freeze at the map's north edge, up to
// ICE.south more at its south edge (rivers run from the northern hills southward, so they freeze from their upper
// reaches down and thaw the other way). Each day adds its mean frost below 0 °C and takes away ICE.thaw × its warmth
// above, up to ICE.cap: about 3 weeks of ice up north and 2 down south in a usual winter, none in the south in a mild
// one. On the ice: ICE.walk hours a tile on foot, no vehicles (bikes neither). Thin ice: within ICE.thin of the
// freezing point (early and late in the freeze); a team on foot may go through (ICE.fall a tile; rivers.js).
export const ICE = { freeze: 30, south: 15, thaw: 3, cap: 45, walk: 1.75, thin: 5, fall: 0.06 };
function nextIce(prev, d) {
  const mean = (d.hi + d.lo) / 2;
  return r1(clamp((prev || 0) + (mean < 0 ? -mean : -mean * ICE.thaw), 0, ICE.cap));
}
/** @param {State} state @param {number} [hour] */
export const iceIndex = (state, hour = state.hour) => rec(state, dayIndex(state, hour)).ice || 0;
/** @param {State} state @param {number} y */
const iceNeed = (state, y) => ICE.freeze + ICE.south * (y / Math.max(1, (state.grid ? state.grid.height : 42) - 1));
// The southernmost row whose rivers are frozen (-1: none).
/** @param {State} state @param {number} [hour] */
export function iceRow(state, hour = state.hour) {
  const ice = iceIndex(state, hour), H = state.grid ? state.grid.height : 42;
  if (ice < ICE.freeze) return -1;
  return Math.min(H - 1, Math.floor(((ice - ICE.freeze) / ICE.south) * (H - 1)));
}
/** @param {State} state @param {number} tileId @param {number} [hour] */
export function riverFrozen(state, tileId, hour = state.hour) {
  const t = state.tiles && state.tiles[tileId];
  return !!t && t.terrain === "water" && !t.bridge && t.y <= iceRow(state, hour);
}
/** @param {State} state @param {number} tileId @param {number} [hour] */
export function thinIce(state, tileId, hour = state.hour) {
  return riverFrozen(state, tileId, hour) && iceIndex(state, hour) - iceNeed(state, state.tiles[tileId].y) < ICE.thin;
}
// A line for the weather report: how far down the rivers are frozen, or how close they are to it.
/** @param {State} state */
export function iceText(state) {
  const row = iceRow(state), H = state.grid ? state.grid.height : 42;
  if (row < 0) return iceIndex(state) >= ICE.freeze * 0.6 ? "The rivers are icing up: a few more freezing days and they can be walked across" : "";
  const part = row >= H - 1 ? "everywhere" : row >= H * 0.6 ? "all but the far south" : row >= H * 0.3 ? "in the north and the middle of the state" : "in the north";
  return `Rivers frozen ${part}: they can be walked across (${ICE.walk} h a tile, no vehicles), by you, other groups and the dead`;
}
