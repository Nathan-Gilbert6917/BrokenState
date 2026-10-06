// Seasons and weather for the whole state (one sky for every tile; kept simple on purpose).
//
// A year is 4 seasons of 28 days (112 days), and day 1 of a campaign is day 15 of spring.
// Every day has one weather type plus ground conditions that carry over (mud, snow cover, soil moisture).
// Days are generated in order from the campaign seed with their own RNG stream (state.rng is never
// touched here), and kept in state.weather.days. The weather of any future day is therefore already
// decided: movement, the trip planner and every ETA read the same per-day records, so an estimate
// made today stays exact however the weather turns during the trip. What the PLAYER is told about the
// coming days (forecast) is a separate, deliberately imperfect view of those records.
//
// API for other systems (all take the game state; `hour`/`dayIdx` default to now):
//   season(state)                         -> { key, name, icon, dayOfSeason, daysLeft, year, index }
//   weather(state)                        -> { key, name, icon, temp, hi, lo, rain, snow, wind, severe,
//                                              mud, snowCover, soil, frozen, dryDays, desc }
//   weatherAt(state, tileId)              -> same (no regional variation yet)
//   forecast(state, days)                 -> [{ day, offset, key, name, icon, hi, lo, severe, confidence, season }]
//   forecastRange(state)                  -> days the hub can forecast (3; 4 with a watchtower; 5 with a radio station)
//   travelFactor(state, { vehicle, tileId, from, hour })  -> multiplier on movement cost (1 = normal, more = slower)
//   travelEffects(state)                  -> { footRoad, footOff, vehRoad, vehOff, sight, ambush, injury, events, boat, lines }
//   growthFactor(state, crop)             -> 0..1.3 growth multiplier for today
//   cropDamage(state, crop)               -> { kill, rot, reason } chances for today (0..1)
//   isGrowingSeason(state, crop)          -> bool; growingDaysLeft(state, crop) -> days until that season ends
//   rainWater(state)                      -> water units one rain collector gathers today; wellFactor(state) -> 0.6..1.15
//   thirstFactor(state, dayIdx)           -> how much people drink that day: THIRST by season, at least THIRST.heat on
//                                            a hot day (hotDay: a heat wave, or 30 °C and up)
//   exposureRisk(state, { sheltered })    -> { chance, kind: "cold"|"heat"|null, reason, temp } per person per day outdoors
//   hordeSpeedFactor(state)               -> 0.5..1 (the dead are slower in deep cold and snow)
//   foodNeedFactor(state)                 -> 1..1.2 (people eat more in the cold; optional hook)
//   weatherDaily(state) / weatherHour(state)  tick hooks (world.js tickHour)
// `crop` is a crop key ("potato", "corn"...) or an object with any of { seasons, hardy, thirst, tMin, tOpt, tall }.
// A crop defined in data.js as CROPS[key] may carry the same fields (or a `climate` object); registerCrop adds one.
import { Rng } from "./rng.js";
import * as data from "./data.js";
import { log, hurt, hub } from "./world.js";

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
  spring: { clear: 30, overcast: 22, rain: 24, storm: 6, fog: 10, frost: 8 },
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
export function seasonOfDay(dayIdx) {
  const d = Math.max(0, Math.floor(dayIdx)) + START_OFFSET;
  const index = Math.floor(d / SEASON_DAYS) % 4;
  const dayOfSeason = (d % SEASON_DAYS) + 1;
  const s = SEASONS[index];
  return { key: s.key, name: s.name, icon: s.icon, desc: s.desc, index, dayOfSeason, daysLeft: SEASON_DAYS - dayOfSeason, year: Math.floor(d / YEAR_DAYS) + 1 };
}
export const dayIndex = (state, hour = state.hour) => Math.floor(Math.max(0, hour) / 24);
export const season = (state, hour = state.hour) => seasonOfDay(dayIndex(state, hour));

// Mean temperature of the calendar day, before the day's weather: 21 °C in midsummer, -3 °C in midwinter.
function seasonalMean(dayIdx) {
  const y = ((dayIdx + START_OFFSET + 0.5) % YEAR_DAYS) / YEAR_DAYS;
  return 9 + 12 * Math.cos(2 * Math.PI * (y - 0.375));
}

// ---------- state and generation ----------
function ensure(state) {
  let w = state.weather;
  if (!w || !Array.isArray(w.days)) {
    const seed = (Number(state.seed) || 1) >>> 0;
    // Own stream: the map and everything else rolled from state.rng stay as they were.
    w = state.weather = { seed, rs: (Math.imul(seed ^ 0x57ea7e25, 0x9e3779b1) ^ 0x5eed) >>> 0, days: [], lastLogged: -1, tint: true };
  }
  return w;
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
  w.days[i] = d;
  w.rs = rng.state;
  return d;
}

// Movement-cost multipliers for one day: [on foot on a road, on foot off-road, vehicle on a road, vehicle off-road].
function travelTable(d) {
  const m = d.frozen ? 0 : d.mud, c = d.cover;
  let fr = 1 + 0.05 * m + 0.25 * c;
  let fo = 1 + 0.45 * m + 0.6 * c;
  let vr = 1 + 0.08 * m + 0.4 * c;
  let vo = 1 + 0.9 * m + 1.0 * c;
  if (d.k === "rain") { fo += 0.08; vr += 0.05; vo += 0.08; }
  else if (d.k === "storm") { fr += 0.3; fo += 0.35; vr += 0.3; vo += 0.35; }
  else if (d.k === "fog") { fr += 0.04; fo += 0.06; vr += 0.12; vo += 0.08; }
  else if (d.k === "heat") { fr += 0.12; fo += 0.15; }
  else if (d.k === "snow") { fr += 0.08; fo += 0.08; vr += 0.08; vo += 0.08; }
  else if (d.k === "blizzard") { fr += 0.5; fo += 0.6; vr += 0.6; vo += 0.7; }
  return [fr, fo, vr, vo].map((v) => Math.min(3, r2(v)));
}

// The record of a day (generated on demand, in order).
function rec(state, dayIdx) {
  const w = ensure(state);
  const i = Math.max(0, Math.floor(dayIdx));
  while (w.days.length <= i) genDay(w, w.days.length);
  return w.days[i];
}

// Temperature at an hour of the day: coldest around 05:00, warmest around 15:00.
function tempAt(d, hourOfDay) {
  return r1((d.hi + d.lo) / 2 + ((d.hi - d.lo) / 2) * Math.cos((2 * Math.PI * (hourOfDay - 15)) / 24));
}

function describe(d, hour) {
  const def = WEATHER[d.k];
  return {
    key: d.k, name: def.name, icon: def.icon, desc: def.desc,
    temp: tempAt(d, ((hour % 24) + 24) % 24), hi: d.hi, lo: d.lo,
    rain: d.rain, snow: d.snow, wind: d.wind, severe: !!def.severe,
    mud: d.frozen ? 0 : d.mud, snowCover: d.cover, soil: d.soil, frozen: d.frozen, dryDays: d.dry,
  };
}

// Current statewide weather (or at a given hour).
export function weather(state, hour = state.hour) {
  return describe(rec(state, dayIndex(state, hour)), hour);
}
export const weatherAt = (state, tileId, hour = state.hour) => weather(state, hour);
// The true weather of a campaign day (1-based day number, as the clock shows it). For the timelapse and tools.
export const weatherOnDay = (state, dayNumber) => describe(rec(state, dayNumber - 1), 12);

// ---------- forecast (what the player is told) ----------
function hash(a, b, c) {
  let h = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 1) >>> 0, 0xc2b2ae35) ^ Math.imul((c + 7) >>> 0, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}

function hubBase(state) {
  try { return hub(state); } catch { return null; }
}

// How many days ahead the holdout can forecast: reading the sky gives 3; a watchtower 4; a radio station 5.
export function forecastRange(state) {
  const bases = (state.bases || []).filter((b) => b.owner == null || b.owner === "player");
  if (bases.some((b) => b.radio)) return 5;
  if (bases.some((b) => b.watchtower)) return 4;
  return 3;
}

// The coming days as the holdout expects them. Tomorrow is nearly always right; further out the guess can be wrong
// (a neighbouring kind of weather, temperatures off by a few degrees). A radio station or a watchtower helps.
// The same day asks give the same answers (no flicker), and the forecast is redrawn each morning.
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
export function severeSoon(state, days = 1) {
  if (weather(state).severe) return true;
  return forecast(state, Math.min(days, forecastRange(state))).some((f) => f.severe);
}

// ---------- travel ----------
// Multiplier on the cost of entering `tileId` (from `from`, if given) at `hour`. 1 = normal, higher = slower.
// Movement (parties.js stepAlong) and every estimate (travelHours) call this with the hour being simulated.
export function travelFactor(state, { vehicle = false, tileId = null, from = null, hour = state.hour } = {}) {
  const tf = rec(state, Math.floor(hour / 24)).tf;
  let road = false;
  if (tileId != null) {
    const links = from != null ? state.tiles[from]?.roadLinks : null;
    road = links ? links.includes(tileId) : (state.tiles[tileId]?.roadLinks?.length || 0) > 0;
  }
  return tf[(vehicle ? 2 : 0) + (road ? 0 : 1)];
}

// Everything weather does to a team on the move right now, plus plain-text lines for panels and tooltips.
export function travelEffects(state, hour = state.hour) {
  const d = rec(state, Math.floor(hour / 24));
  const [footRoad, footOff, vehRoad, vehOff] = d.tf;
  const k = d.k;
  const sight = k === "fog" || k === "blizzard" ? -1 : 0;
  const ambush = k === "fog" ? 0.08 : k === "blizzard" ? 0.05 : k === "storm" ? 0.03 : 0;
  const injury = k === "blizzard" ? 0.025 : k === "storm" ? 0.015 : 0; // per hour on the move, on foot (half in a vehicle)
  const events = k === "storm" || k === "blizzard" ? 1.15 : 1;
  const boat = k === "storm" ? 2.5 : k === "blizzard" ? 2 : d.wind > 0.5 ? 1.5 : 1;
  const pct = (f) => `${f > 1 ? "+" : ""}${Math.round((f - 1) * 100)}%`;
  const lines = [];
  if (footOff > 1.005 || vehOff > 1.005 || footRoad > 1.005 || vehRoad > 1.005) {
    lines.push(`Travel time on foot: roads ${pct(footRoad)}, off-road ${pct(footOff)}`);
    lines.push(`Travel time by vehicle: roads ${pct(vehRoad)}, off-road ${pct(vehOff)}`);
  } else lines.push("Travel: normal pace");
  if (!d.frozen && d.mud >= 0.15) lines.push(`Mud ${Math.round(d.mud * 100)}% (off-road, worst for vehicles)`);
  if (d.cover >= 0.05) lines.push(`Snow cover ${Math.round(d.cover * 100)}%`);
  if (sight) lines.push("Teams see 1 tile less");
  if (ambush) lines.push("Easier to be ambushed");
  if (injury) lines.push(`Injury risk on the road (${(injury * 100).toFixed(1)}% an hour on foot)`);
  if (boat > 1) lines.push(`Boat mishaps ${boat}× as likely`);
  return { footRoad, footOff, vehRoad, vehOff, sight, ambush, injury, events, boat, lines };
}

// Called by parties.js once an hour for a player team that moved: storms and blizzards can hurt someone.
// Returns the survivor who was hurt, or null. Uses the play RNG only in severe weather.
export function travelHazard(state, p, members) {
  const d = rec(state, dayIndex(state));
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
export function registerCrop(key, climate) {
  CROP_CLIMATE[key] = { ...CROP_DEFAULT, ...climate };
}
const CLIMATE_FIELDS = ["seasons", "hardy", "thirst", "tMin", "tOpt", "tall", "sheltered"];
export function cropClimate(crop) {
  if (crop && typeof crop === "object") return { ...CROP_DEFAULT, ...(crop.climate || crop) };
  const key = String(crop || "").toLowerCase();
  const def = data.CROPS?.[crop] || data.CROPS?.[key];
  const fromData = {};
  if (def) for (const f of CLIMATE_FIELDS) if (def[f] != null) fromData[f] = def[f];
  return { ...CROP_DEFAULT, ...(CROP_CLIMATE[key] || {}), ...fromData, ...(def?.climate || {}) };
}

// A crop grows only in its seasons (a hardy winter crop lists "winter").
export function isGrowingSeason(state, crop, dayIdx = dayIndex(state)) {
  return cropClimate(crop).seasons.includes(seasonOfDay(dayIdx).key);
}
// Days of growing season left for this crop, today included (0 when out of season). For "will it ripen in time?".
export function growingDaysLeft(state, crop, dayIdx = dayIndex(state)) {
  const seasons = cropClimate(crop).seasons;
  if (seasons.length >= 4) return Infinity;
  let n = 0;
  while (n < YEAR_DAYS && seasons.includes(seasonOfDay(dayIdx + n).key)) n += seasonOfDay(dayIdx + n).daysLeft + 1;
  return n;
}

// Growth multiplier for one day: 0 out of season or too cold, about 1 in fair weather, up to 1.3 on a warm day
// with moist soil and sun.
export function growthFactor(state, crop, dayIdx = dayIndex(state)) {
  const c = cropClimate(crop);
  const d = rec(state, dayIdx);
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
// reason names the main cause ("" when there is no risk): frost, hard freeze, blizzard, drought, heat, storm, wet, snow.
export function cropDamage(state, crop, dayIdx = dayIndex(state)) {
  const c = cropClimate(crop);
  const d = rec(state, dayIdx);
  const causes = [];
  const tender = 1 - clamp(c.hardy, 0, 1);
  const shelter = c.sheltered || (c.seasons.length >= 4 && c.hardy >= 1 && !c.tall);
  if (d.lo <= -4) causes.push(["hard freeze", 0.65 * tender + (d.lo <= -12 && !shelter ? 0.03 : 0)]);
  else if (d.lo <= 0 || d.k === "frost") causes.push(["frost", 0.35 * tender]);
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
export function rainWater(state, dayIdx = dayIndex(state)) {
  const d = rec(state, dayIdx);
  return r1(d.rain * 6 + d.snow * 1.5);
}
// Multiplier on what a well or a stream gives: less in a dry spell, a little more after wet weeks.
export function wellFactor(state, dayIdx = dayIndex(state)) {
  const d = rec(state, dayIdx);
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
export function thirstFactor(state, dayIdx = dayIndex(state)) {
  const s = THIRST[seasonOfDay(dayIdx).key] ?? 1;
  return hotDay(rec(state, dayIdx)) ? Math.max(s, THIRST.heat) : s;
}
// The factor for the hour a team drinks in (parties.js consume runs after the clock moves on).
export const thirstAt = (state, hour = state.hour) => thirstFactor(state, dayIndex(state, hour));
// The highest factor over the next `days` days, today included (packing with a margin: crews, caravans).
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
export function exposureRisk(state, { sheltered = false, dayIdx = dayIndex(state) } = {}) {
  const d = rec(state, dayIdx);
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
export function hordeSpeedFactor(state, dayIdx = dayIndex(state)) {
  const d = rec(state, dayIdx);
  const mean = (d.hi + d.lo) / 2;
  let f = d.k === "blizzard" || mean < -8 ? 0.5 : mean < -2 ? 0.7 : 1;
  if (d.cover > 0.5) f *= 0.85;
  return r2(Math.max(0.4, f));
}

// The mean temperature of a day (°C): what heating (upkeep.js heatRate) and the cold's appetite go by.
export function dayMeanTemp(state, dayIdx = dayIndex(state)) {
  const d = rec(state, dayIdx);
  return (d.hi + d.lo) / 2;
}

// People burn more food keeping warm.
export function foodNeedFactor(state, dayIdx = dayIndex(state)) {
  const d = rec(state, dayIdx);
  const mean = (d.hi + d.lo) / 2;
  return mean < -8 ? 1.2 : mean < 0 ? 1.1 : 1;
}

// ---------- ticks ----------
// Once a day (world.js, at midnight): the new day's weather is fixed and anything notable goes in the log.
export function weatherDaily(state) {
  const w = ensure(state);
  const i = dayIndex(state);
  const d = rec(state, i);
  rec(state, i + 7); // the week ahead, so forecasts and short estimates never generate inside a render
  if (w.lastLogged === i) return;
  w.lastLogged = i;
  const s = seasonOfDay(i);
  const prev = i > 0 ? w.days[i - 1] : null;
  if (s.dayOfSeason === 1) log(state, `${s.icon} ${s.name} begins. ${s.desc}`, "info");
  if (!prev || prev.k === d.k) return;
  const def = WEATHER[d.k];
  if (def.severe) log(state, `${def.icon} ${def.name} today (${Math.round(d.lo)} to ${Math.round(d.hi)} °C): travel is slow and risky.`, "bad");
  else if (d.k === "snow" && prev.cover < 0.05) log(state, `${def.icon} Snow is falling. Travel slows as it builds up, off-road most of all.`, "info");
  else if (d.k === "heat") log(state, `${def.icon} A heat wave sets in (${Math.round(d.hi)} °C): everyone drinks ${Math.round((THIRST.heat - 1) * 100)}% more water while it lasts.`, "info");
  else if (d.k === "drought") log(state, `${def.icon} A dry spell: no rain in sight and the soil is drying out.`, "info");
  else if (d.k === "frost" && s.key !== "winter") log(state, `${def.icon} Frost overnight (${Math.round(d.lo)} °C): tender crops are at risk.`, "info");
}

// Once an hour (world.js): nothing to roll (the day's weather is fixed); keeps old states working.
export function weatherHour(state) {
  const w = ensure(state);
  if (w.days.length <= dayIndex(state)) rec(state, dayIndex(state));
}

// ---------- text for the UI ----------
export function weatherSummary(state) {
  const s = season(state), w = weather(state);
  return `${s.icon} ${s.name} ${s.dayOfSeason}/${SEASON_DAYS} · ${w.icon} ${w.name} ${Math.round(w.temp)}°C`;
}

// Multi-line plain text: season, today, effects on travel and farming, and the forecast. Used as a tooltip.
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
  if (thirstNote(tf)) lines.push(`• Water: ${thirstNote(tf)} (${r2(tf)} a day each${hotDay(rec(state, dayIndex(state))) ? ", a hot day" : ` in ${s.name.toLowerCase()}`})`);
  const ex = exposureRisk(state);
  if (ex.chance > 0) lines.push(`• Exposure: ${ex.reason} (${(ex.chance * 100).toFixed(1)}% a day outdoors)`);
  const hs = hordeSpeedFactor(state);
  if (hs < 1) lines.push(`• The dead move at ${Math.round(hs * 100)}% speed in this cold`);
  const fc = forecast(state);
  lines.push("", `Forecast (${fc.length} days${forecastRange(state) < 5 ? "; a watchtower or radio station sees further and better" : ""}):`);
  for (const f of fc) {
    const hot = f.key === "heat" || f.hi >= 30;
    lines.push(`Day ${f.day}: ${f.icon} ${f.name}, ${f.lo} to ${f.hi} °C${hot ? ` (hot: everyone drinks ${Math.round((THIRST.heat - 1) * 100)}% more water)` : ""}${f.confidence < 0.8 ? " (uncertain)" : ""}`);
  }
  return lines.join("\n");
}

// ---------- map look ----------
// A light wash over the land for the map renderer (render.js, "Weather" layer): snow whitens it, rain and storms
// darken it, fog greys it, heat and dry spells warm it, autumn browns it a little. null = no wash.
export function weatherTint(state, hour = state.hour) {
  const d = rec(state, dayIndex(state, hour));
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
