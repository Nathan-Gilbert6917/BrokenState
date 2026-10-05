// Farming: crop plots at every base. A crop takes days to ripen and is harvested in one go; it does not
// produce food every day. Each base has plots by type (hub 6, outpost 2) plus 2 per Farm plot building and
// 2 sheltered plots per Greenhouse. Every crop has its own growing time, yield, seed cost, water need, seasons,
// tolerances and a harvest window. Growth each day follows the weather (weather.js growthFactor); frost,
// storms, drought and heat can kill a standing crop and wet weather rots a ripe one (weather.js cropDamage).
// Ripe crops must be harvested by farmers within their window or they rot in the field.
// Yield = base yield x care x site, where care is averaged over the days the crop stood:
//   care = tending (farmers per planted plot, diminishing returns) x skill (the tending farmers' Farming).
// More and better farmers give more food from the same days, never a faster crop.
// Dry crops (wheat, winter wheat, dry beans) go into the preserved stock when harvested: threshed grain and dry
// beans keep a year and need no cellar room (storage.js). Everything else is fresh food and spoils in store.
// Planning (bestCrop, the winter outlook): farmers judge a crop by the usual weather for the time of year (the
// climate table below), so they stop sowing tender crops that the first frosts would kill and sow hardy ones
// (kale, winter roots, winter wheat) for the winter and the hungry gap before the first spring harvest.
import * as Weather from "./weather.js";
import { log, atBase, skill, day, residents } from "./world.js";
import { count } from "./buildings.js";
import { workFactor } from "./health.js";
import { storeCapacity, storeRate, edibleFood, spoilFresh } from "./storage.js";
import { hasPerk, seedCost } from "./skills.js";

// days = growing days at a growth factor of 1 (a cold or dry spell makes it longer); yield = food per plot at
// care 1; seed = food to plant one plot; water = water per plot per dry day; spoil = days a ripe crop keeps in the
// field before it is lost; heatTol = 0..1 heat tolerance (frost tolerance is climate.hardy, drought tolerance is
// 1 - climate.thirst). climate goes to weather.js as is (and is registered there by key). Optional: store
// "preserved" = the harvest goes into the preserved stock (dry goods); sowIn = seasons it can be sown outdoors
// (default: its growing seasons); snowproof = a ripe crop stands in snow without rotting.
export const CROPS = {
  potato: { name: "Potatoes",     days: 28, yield: 65, seed: 4, water: 0.2, spoil: 10, heatTol: 0.3,
    climate: { seasons: ["spring", "summer", "autumn"], hardy: 0.5, thirst: 0.5, tMin: 6, tOpt: [12, 23], tall: 0.1 },
    desc: "A safe staple: steady yield, stands a light frost, keeps well once dug." },
  beans:  { name: "Beans",        days: 18, yield: 36, seed: 3, water: 0.2, spoil: 5,  heatTol: 0.6,
    climate: { seasons: ["spring", "summer"], hardy: 0.1, thirst: 0.5, tMin: 9, tOpt: [16, 28], tall: 0.5 },
    desc: "Quick and warm-loving. Frost kills them; pick them fast once ripe." },
  corn:   { name: "Corn",         days: 32, yield: 80, seed: 3, water: 0.35, spoil: 7,  heatTol: 0.8,
    climate: { seasons: ["spring", "summer"], hardy: 0, thirst: 0.7, tMin: 10, tOpt: [18, 30], tall: 1 },
    desc: "The biggest summer harvest, but thirsty, tender to frost and flattened by storms." },
  wheat:  { name: "Wheat",        days: 42, yield: 72, seed: 4, water: 0.15, spoil: 12, heatTol: 0.5, store: "preserved",
    climate: { seasons: ["spring", "summer", "autumn"], hardy: 0.8, thirst: 0.3, tMin: 3, tOpt: [10, 24], tall: 0.7 },
    desc: "Slow, hardy and needs little water. Storms can lodge it. Threshed grain keeps: the harvest goes into the preserved stock." },
  squash: { name: "Squash",       days: 24, yield: 52, seed: 3, water: 0.3, spoil: 14, heatTol: 0.7,
    climate: { seasons: ["summer", "autumn"], hardy: 0.1, thirst: 0.6, tMin: 9, tOpt: [16, 28], tall: 0.2 },
    desc: "A summer and autumn crop that keeps a long time in the field." },
  greens: { name: "Greens",       days: 12, yield: 19, seed: 2, water: 0.2, spoil: 3,  heatTol: 0.1,
    climate: { seasons: ["spring", "summer", "autumn"], hardy: 0.6, thirst: 0.5, tMin: 4, tOpt: [8, 22], tall: 0 },
    desc: "Lettuce, spinach and chard: the fastest food there is, but small, and it wilts in heat or in a few days ripe." },
  turnip: { name: "Winter roots", days: 30, yield: 40, seed: 3, water: 0.15, spoil: 14, heatTol: 0.2,
    climate: { seasons: ["spring", "autumn", "winter"], hardy: 1, thirst: 0.3, tMin: 0, tOpt: [6, 18], tall: 0 },
    desc: "Turnips and swedes: frost-proof, for late autumn and (under glass) winter. Small yield." },
  // Winter crops (the hungry gap): each one is a trade-off.
  kale:   { name: "Kale",         days: 16, yield: 22, seed: 2, water: 0.15, spoil: 24, heatTol: 0.1, snowproof: true,
    climate: { seasons: ["spring", "autumn", "winter"], hardy: 1, thirst: 0.4, tMin: 0, tOpt: [6, 18], tall: 0.1 },
    desc: "Kale and collards: shrugs off frost and snow and stands ripe in the field for weeks, so it can be picked into early winter. Small yield, and it hardly grows in deep cold: sow it in the first half of autumn." },
  winterwheat: { name: "Winter wheat", days: 40, yield: 88, seed: 6, water: 0.1, spoil: 14, heatTol: 0.4, store: "preserved", sowIn: ["autumn"],
    climate: { seasons: ["spring", "autumn", "winter"], hardy: 1, thirst: 0.25, tMin: 1, tOpt: [6, 18], tall: 0.6 },
    desc: "Sown in autumn only: it sprouts, sleeps under the snow and ripens in late spring. The biggest grain harvest and it keeps a year (preserved stock), but it ties up the plot for months, costs the most seed and comes in after the worst of the hungry gap." },
  drybeans: { name: "Dry beans",  days: 32, yield: 40, seed: 4, water: 0.25, spoil: 12, heatTol: 0.6, store: "preserved",
    climate: { seasons: ["spring", "summer", "autumn"], hardy: 0.1, thirst: 0.55, tMin: 8, tOpt: [15, 28], tall: 0.4 },
    desc: "Beans left to dry on the vine: twice as slow as green beans for a little more food, thirstier and tender to frost, but the harvest keeps all year and needs no cellar room (preserved stock)." },
};
export const CROP_KEYS = Object.keys(CROPS);
// Every crop's climate is registered with weather.js by key (done on first use: weather.js may still be loading
// when this module runs).
let climatesRegistered = false;
function registerClimates() {
  if (climatesRegistered || !Weather.registerCrop) return;
  try {
    for (const k of CROP_KEYS) Weather.registerCrop(k, CROPS[k].climate);
    climatesRegistered = true;
  } catch { /* weather.js not ready yet: try again next time */ }
}

export const BASE_PLOTS = { hub: 6, outpost: 2 };
// Running totals for tools and balance checks (state.econStats).
export const econStats = (state) => state.econStats || (state.econStats = { harvested: 0, seed: 0, spoiled: 0, eaten: 0, cropsLost: 0, thirstDays: 0, hungerDays: 0, scavFinds: 0 });
export const PLOTS_PER_BUILDING = 2;     // per Farm plot building
export const GREENHOUSE_PLOTS = 2;       // sheltered plots per Greenhouse
export const GH_MIN_GROWTH = 0.6;        // under glass a crop grows at least this fast (unless it is bitterly cold)
export const HARVEST_PER_FARMER = 3;     // ripe plots one full-time farmer harvests a day
export const PLANT_PER_FARMER = 2;       // plots one full-time farmer plants a day
export const EXPECTED_GROWTH = 0.85;     // planning guess of the average daily growth factor
const ALL_SEASONS = ["spring", "summer", "autumn", "winter"];

// ---------- the numbers ----------
// Tending: farmers per planted plot, with diminishing returns (0 → 0.55, 0.5 → 1.0, 1 → 1.23, 2 → 1.4, 3 → 1.44).
export const tendMult = (perPlot) => 0.55 + 0.9 * (1 - Math.exp(-1.4 * Math.max(0, perPlot)));
// Skill of the farmers who tend: 0 → 0.75, 7 → 1.0, 10 → 1.1, 20 → 1.45.
export const skillMult = (avgSkill) => 0.75 + 0.035 * Math.max(0, avgSkill);

// Where the base sits: farmland and farmsteads 1.3, forest 0.9, hills 0.85, anything else 1.
export function siteFarm(state, base) {
  const t = state.tiles[base.tile];
  const loc = t.loc ? t.loc.type : null;
  return loc === "farm" || t.terrain === "plains" ? 1.3 : t.terrain === "forest" ? 0.9 : t.terrain === "hills" ? 0.85 : 1;
}

export const plotLimit = (base) => (BASE_PLOTS[base.type] ?? 2) + count(base, "farm_plot") * PLOTS_PER_BUILDING;
export const greenhouseLimit = (base) => count(base, "greenhouse") * GREENHOUSE_PLOTS;

// Climate passed to weather.js. A greenhouse plot grows in every season and stands 10 °C more cold.
export function plotClimate(crop, gh = false) {
  const c = CROPS[crop].climate;
  if (!gh) return c;
  return { ...c, seasons: ALL_SEASONS, hardy: 1, tMin: c.tMin - 10, tOpt: [c.tOpt[0] - 10, c.tOpt[1]], tall: 0, sheltered: true };
}

// weather.js may still be missing a function while it is being built: fall back to fair weather.
const W = {
  growth: (state, clim, dayIdx) => (Weather.growthFactor ? Weather.growthFactor(state, clim, dayIdx) : (clim.seasons.includes(seasonKey(state)) ? 1 : 0)),
  damage: (state, clim, dayIdx) => (Weather.cropDamage ? Weather.cropDamage(state, clim, dayIdx) : { kill: 0, rot: 0, reason: "" }),
  inSeason: (state, clim) => (Weather.isGrowingSeason ? Weather.isGrowingSeason(state, clim) : true),
  // For planning outdoors, winter does not count as growing time for crops that cannot stand it; winter roots sown
  // in autumn come on in mild spells and ripen early in spring (the bridge over the hungry gap).
  daysLeft: (state, clim) => (!Weather.growingDaysLeft ? Infinity : clim.seasons.includes("winter") && clim.hardy >= 0.9 ? Weather.growingDaysLeft(state, clim) : Weather.growingDaysLeft(state, { ...clim, seasons: clim.seasons.filter((s) => s !== "winter") })),
};
export const seasonKey = (state) => (Weather.season ? Weather.season(state).key : "summer");
// Growth over the last week (today included): what the farmers judge a crop by when they choose what to sow.
export function recentGrowth(state, crop, gh = false) {
  const clim = plotClimate(crop, gh);
  const today = Math.floor(state.hour / 24);
  let sum = 0, n = 0;
  for (let i = Math.max(0, today - 6); i <= today; i++) { sum += W.growth(state, clim, i); n++; }
  const g = n ? sum / n : EXPECTED_GROWTH;
  return gh ? Math.max(GH_MIN_GROWTH, g) : g;
}
const todayWeather = (state) => (Weather.weather ? Weather.weather(state) : { hi: 20, lo: 10, rain: 0, key: "clear" });

// ---------- the climate ahead (planning) ----------
// Farmers plan by the usual weather for the time of year, never by the real days to come: per day of the year,
// the average growth factor, the chance a standing crop dies (as farmingDaily applies it: under glass, heat
// tolerance, watered plots riding out a dry spell) and the food people need, over CLIMATE_SEEDS years of the same
// weather model. The years are other seeds on their own weather streams (fake worlds): the live world's weather
// and state.rng are never touched. Computed once per crop (and per greenhouse) and cached.
const YEAR = Weather.YEAR_DAYS || 112;
const SEASON = Weather.SEASON_DAYS || 28;
const OFFSET = Weather.START_OFFSET ?? 14;
const CLIMATE_SEEDS = 12;
let climateYears = null;
const climateCache = new Map();
function years() {
  if (!climateYears) climateYears = Array.from({ length: CLIMATE_SEEDS }, (_, i) => ({ seed: 70001 + i * 977 }));
  return climateYears;
}
// { grow[], kill[], need[] } indexed by day of the year (campaign day index % YEAR).
export function climateTable(crop, gh = false) {
  const key = `${crop}|${gh ? 1 : 0}`;
  let t = climateCache.get(key);
  if (t) return t;
  registerClimates();
  const c = CROPS[crop];
  const clim = plotClimate(crop, gh);
  const grow = new Array(YEAR).fill(0), kill = new Array(YEAR).fill(0), need = new Array(YEAR).fill(0), temp = new Array(YEAR).fill(0), n = new Array(YEAR).fill(0);
  if (Weather.growthFactor && Weather.cropDamage) {
    for (const y of years()) {
      for (let i = 2; i < YEAR * 2 + 2; i++) { // the first two days of any world are calm: skipped
        const d = i % YEAR;
        let g = Weather.growthFactor(y, clim, i);
        const w = Weather.weatherOnDay(y, i + 1);
        if (gh && g < GH_MIN_GROWTH && (w.hi + w.lo) / 2 > c.climate.tMin - 14) g = GH_MIN_GROWTH;
        const dmg = Weather.cropDamage(y, clim, i);
        let k = dmg.kill * (gh ? 0.15 : 1);
        if (dmg.reason === "heat") k *= 1 - c.heatTol * 0.6;
        if (dmg.reason === "drought") k *= 0.1;
        grow[d] += g; kill[d] += k; need[d] += Weather.foodNeedFactor ? Weather.foodNeedFactor(y, i) : 1; temp[d] += (w.hi + w.lo) / 2; n[d]++;
      }
    }
    for (let d = 0; d < YEAR; d++) { grow[d] /= n[d] || 1; kill[d] /= n[d] || 1; need[d] = n[d] ? need[d] / n[d] : 1; temp[d] = n[d] ? temp[d] / n[d] : 12; }
  } else for (let d = 0; d < YEAR; d++) { grow[d] = EXPECTED_GROWTH; need[d] = 1; temp[d] = 12; }
  t = { grow, kill, need, temp };
  climateCache.set(key, t);
  return t;
}
const todayIdx = (state) => Math.floor(state.hour / 24);
// Food people need a day on campaign day index i, as a share of a normal day (more in the cold), by the climate.
export const usualFoodNeed = (i) => climateTable("potato").need[((i % YEAR) + YEAR) % YEAR];
// Usual mean temperature (°C) on campaign day index i.
export const usualTemp = (i) => climateTable("potato").temp[((i % YEAR) + YEAR) % YEAR];

// From campaign day index `from`, with `grown` growing days already in: expected calendar days until ripe
// (Infinity if not within the horizon) and the chance the crop lives that long, by the usual weather.
const forecastMemo = new Map();
export function cropForecast(crop, gh, from, grown = 0, horizon = 2 * YEAR) {
  // A fresh sowing depends only on the crop, glass and the day of the year: remembered.
  const memoKey = grown === 0 && horizon === 2 * YEAR ? `${crop}|${gh ? 1 : 0}|${((from % YEAR) + YEAR) % YEAR}` : null;
  if (memoKey && forecastMemo.has(memoKey)) return forecastMemo.get(memoKey);
  const out = forecastRun(crop, gh, from, grown, horizon);
  if (memoKey) forecastMemo.set(memoKey, out);
  return out;
}
function forecastRun(crop, gh, from, grown, horizon) {
  const t = climateTable(crop, gh);
  const need = CROPS[crop].days;
  let g = grown, surv = 1, n = 0;
  while (g < need && n < horizon) {
    const d = (from + n) % YEAR;
    g += t.grow[d];
    surv *= 1 - t.kill[d];
    n++;
  }
  return { days: g >= need ? Math.max(1, n) : Infinity, survival: Math.round(surv * 1000) / 1000 };
}

// The calendar of the hungry gap: from the first day of winter (no outdoor harvest of ordinary crops after it) to
// the first spring harvest (the quickest crop sown outdoors on the first day of spring, plus a few days to get it
// in). Campaign day indexes. While in winter or early spring (before that harvest) it is the current gap.
const firstSpringDays = (() => {
  let memo = null;
  return () => {
    if (memo != null) return memo;
    const springStart = YEAR - OFFSET; // campaign day index of the first day of the second spring
    let best = Infinity;
    for (const k of CROP_KEYS) {
      const c = CROPS[k];
      if (!c.climate.seasons.includes("spring") || (c.sowIn && !c.sowIn.includes("spring"))) continue;
      const fc = cropForecast(k, false, springStart);
      if (fc.survival >= 0.6) best = Math.min(best, fc.days);
    }
    memo = (isFinite(best) ? best : 25) + 3;
    return memo;
  };
})();
export function hungryGap(state, dayIdx = todayIdx(state)) {
  const o = dayIdx + OFFSET;
  const yearBase = Math.floor(o / YEAR) * YEAR;
  const doy = o - yearBase;
  const winterOf = (yb) => yb + 3 * SEASON - OFFSET;          // first day of winter in that year (day index)
  const endOf = (yb) => yb + YEAR - OFFSET + firstSpringDays(); // first spring harvest after that winter
  // In spring before the first harvest: still last winter's gap.
  const prev = yearBase - YEAR;
  if (doy < firstSpringDays()) return { start: winterOf(prev), end: endOf(prev), inGap: true };
  const start = winterOf(yearBase), end = endOf(yearBase);
  return { start, end, inGap: dayIdx >= start };
}

// ---------- plots ----------
// The farm of a base, created on first use; plots follow the buildings (a finished Farm plot or Greenhouse adds
// empty plots). The hub's fields are already sown on day 1 (planted before the fall), so the first harvests come in
// the first two weeks.
export function farmOf(state, base) {
  registerClimates();
  let f = base.farm;
  if (!f) f = base.farm = { auto: true, plots: [], nextId: 1, seeded: false, lastHarvest: null };
  const sync = (gh, limit) => {
    const have = f.plots.filter((p) => !!p.gh === gh);
    for (let i = have.length; i < limit; i++) f.plots.push(newPlot(f, gh));
    // Fewer than before (should not happen): drop empty plots first.
    let extra = have.length - limit;
    for (const p of [...have].sort((a, b) => (a.stage === "empty" ? -1 : 1) - (b.stage === "empty" ? -1 : 1))) {
      if (extra <= 0) break;
      f.plots.splice(f.plots.indexOf(p), 1);
      extra--;
    }
  };
  sync(false, plotLimit(base));
  sync(true, greenhouseLimit(base));
  if (!f.seeded) {
    f.seeded = true;
    if (base.type === "hub" && state.hour <= 30) {
      // Sown before the fall: [crop, share already grown].
      // Staggered, so something comes in every few days for the first month.
      const sown = [["greens", 0.75], ["greens", 0.5], ["potato", 0.7], ["wheat", 0.7], ["greens", 0.25], ["potato", 0.5], ["wheat", 0.5], ["potato", 0.3], ["wheat", 0.3], ["potato", 0.15]];
      sown.forEach(([crop, frac], i) => {
        const p = f.plots.filter((x) => !x.gh)[i];
        if (!p) return;
        sow(p, crop);
        p.grown = CROPS[crop].days * frac;
        p.care = Math.round(p.grown) * 0.85; // tended at about 0.85 so far
        p.careDays = Math.round(p.grown);
      });
    }
  }
  return f;
}

function newPlot(f, gh) {
  return { id: f.nextId++, gh: !!gh, stage: "empty", crop: null, want: null, grown: 0, care: 0, careDays: 0, ripeDays: 0, yieldLeft: 0, note: "" };
}

// Seed comes out of the fresh food first, then the preserved stock (seed grain and dry beans).
function paySeed(base, amount) {
  const fresh = Math.min(Math.max(0, base.stock.food || 0), amount);
  base.stock.food = (base.stock.food || 0) - fresh;
  if (amount > fresh) base.stock.preserved = Math.max(0, (base.stock.preserved || 0) - (amount - fresh));
}

function sow(p, crop) {
  Object.assign(p, { stage: "growing", crop, grown: 0, care: 0, careDays: 0, ripeDays: 0, yieldLeft: 0, note: "", thirsty: false });
}

export const plotById = (state, base, id) => farmOf(state, base).plots.find((p) => p.id === Number(id)) || null;

// Farmers at a base who can work (not in a hospital bed), best first, with how much each can do (illness).
export function farmers(state, base) {
  return atBase(state, base.id).filter((s) => s.role === "farm" && !s.inBed && workFactor(s) > 0)
    .sort((a, b) => skill(b, "farming") - skill(a, "farming"));
}
export const farmLabour = (state, base) => farmers(state, base).reduce((a, s) => a + workFactor(s), 0);

// Today's care for a standing crop: tending (labour per planted plot) x skill (average Farming of the best farmers,
// one per planted plot).
export function careToday(state, base) {
  const f = farmOf(state, base);
  const list = farmers(state, base);
  const planted = Math.max(1, f.plots.filter((p) => p.stage === "growing").length);
  const labour = list.reduce((a, s) => a + workFactor(s), 0);
  const tenders = list.slice(0, Math.max(1, planted));
  // Perks (skills.js): Early Riser counts Farming +3 when tending; Green Thumb +15% while one of the tenders.
  const avg = tenders.length ? tenders.reduce((a, s) => a + skill(s, "farming") + (hasPerk(s, "earlyriser") ? 3 : 0), 0) / tenders.length : 0;
  const thumb = tenders.some((s) => hasPerk(s, "greenthumb")) ? 1.15 : 1;
  return { care: tendMult(labour / planted) * skillMult(avg) * thumb, tend: tendMult(labour / planted), skill: skillMult(avg), labour, planted, perPlot: labour / planted, avgSkill: avg };
}

// What a crop on this plot should give when harvested (care so far, or today's if just sown).
export function expectedYield(state, base, p, care = null) {
  if (!p.crop) return 0;
  const c = p.careDays > 0 ? p.care / p.careDays : (care ?? careToday(state, base).care);
  return Math.round(CROPS[p.crop].yield * c * siteFarm(state, base) * 10) / 10;
}

// Estimated days until a growing crop ripens (at the expected growth rate).
export const daysToRipe = (p) => (p.stage === "growing" ? Math.max(1, Math.ceil((CROPS[p.crop].days - p.grown) / EXPECTED_GROWTH)) : 0);

// Can this crop be sown here today, and will it ripen before its season ends?
export function plantCheck(state, base, p, crop) {
  const c = CROPS[crop];
  if (!c) return { ok: false, reason: "Unknown crop" };
  if (!p) return { ok: false, reason: "No such plot" };
  if (p.stage === "growing" || p.stage === "ripe") return { ok: false, reason: "The plot is in use" };
  const clim = plotClimate(crop, p.gh);
  if (!p.gh && !W.inSeason(state, clim)) return { ok: false, reason: `${c.name} do not grow in ${seasonKey(state)}` };
  if (!p.gh && c.sowIn && !c.sowIn.includes(seasonKey(state))) return { ok: false, reason: `${c.name} can only be sown in ${c.sowIn.join(" or ")}` };
  const need = c.days / Math.max(0.5, Math.min(EXPECTED_GROWTH, recentGrowth(state, crop, p.gh) + 0.25));
  if (!p.gh && W.daysLeft(state, clim) < need) return { ok: false, reason: `Would not ripen before the season ends (needs about ${Math.ceil(need)} days)` };
  if (edibleFood(base) < c.seed) return { ok: false, reason: `Needs ${c.seed} food as seed` };
  return { ok: true, reason: "" };
}

// The crop to sow on a plot today: the most food per calendar day among those that can ripen in time, judged by
// the usual weather ahead (cropForecast: days to ripen and the chance frost, storms or heat kill it first), so
// tender crops are not sown into the first frosts. Food that comes in during the hungry gap (winter and early
// spring) counts more: 1.6× in its first half, 1.25× in the second. Fresh food harvested for the winter store
// counts what will be left of it by midwinter (it spoils in the cellar, fast outside once the stores are full);
// dry crops go into the preserved stock and keep. Each plot already growing the same crop marks it down 15% (a mix
// of harvest dates and risks beats one big bet). Thirsty crops are marked down while water is short. null when
// nothing fits (winter outdoors).
export function bestCrop(state, base, p, { waterShort = false } = {}) {
  let best = null, bestScore = 0;
  const today = todayIdx(state);
  const gap = hungryGap(state, today);
  // Short of food: a crop that ripens within about three weeks is worth twice as much.
  const people = Math.max(1, residents(state, base.id).length);
  const foodDays = edibleFood(base) / people;
  const mid = (gap.start + gap.end) / 2;
  const cap = storeCapacity(base);
  const same = {};
  for (const x of farmOf(state, base).plots) if (x !== p && x.crop && (x.stage === "growing" || x.stage === "ripe")) same[x.crop] = (same[x.crop] || 0) + 1;
  for (const k of CROP_KEYS) {
    const c = CROPS[k];
    const clim = plotClimate(k, p.gh);
    if (!p.gh && !W.inSeason(state, clim)) continue;
    if (!p.gh && c.sowIn && !c.sowIn.includes(seasonKey(state))) continue;
    const g = recentGrowth(state, k, p.gh);
    if (g < 0.15 && !(c.sowIn && !p.gh)) continue; // too cold or dry for it right now (an autumn-sown grain can wait)
    if (!p.gh && W.daysLeft(state, clim) < c.days / Math.max(0.5, Math.min(EXPECTED_GROWTH, g + 0.25)) && !c.sowIn) continue;
    const fc = cropForecast(k, p.gh, today);
    if (!isFinite(fc.days) || fc.survival < 0.25) continue;
    const ripe = today + fc.days;
    let food = c.yield * fc.survival;
    // Stored until midwinter: what is left of it then (a harvest after the gap starts is eaten as it comes in).
    if (ripe < gap.start && foodDays >= 20) {
      const wait = Math.max(0, mid - ripe);
      const rate = c.store === "preserved" ? 0.001 : (base.stock.food || 0) + c.yield > cap ? 0.03 : 0.005;
      food *= Math.pow(1 - rate, wait);
    }
    food -= c.seed;
    if (food <= 0) continue;
    let score = food / (fc.days + 10) * Math.pow(0.85, same[k] || 0);
    if (ripe >= gap.start && ripe <= gap.end + 10) score *= ripe <= mid ? 1.6 : 1.25;
    if (foodDays < 15 && fc.days > 22) score *= 0.5;
    if (waterShort) score /= 1 + c.water * 3;
    if (score > bestScore) { best = k; bestScore = score; }
  }
  return best;
}

// ---------- player actions ----------
export function hasFarmer(state, base) {
  return farmers(state, base).length > 0;
}

export function plantPlot(state, base, plotId, crop) {
  const p = plotById(state, base, plotId);
  if (!p) return "That plot is gone.";
  if (!hasFarmer(state, base)) return "Nobody is on the Farm role here to plant it.";
  const chk = plantCheck(state, base, p, crop);
  if (!chk.ok) return chk.reason;
  paySeed(base, seedCost(state, base, CROPS[crop].seed)); // seedCost: Seed Saver halves it (skills.js)
  sow(p, crop);
  p.want = crop;
  return `${CROPS[crop].name} sown on plot ${p.id} at ${base.name} (${seedCost(state, base, CROPS[crop].seed)} food as seed). Ripe in about ${daysToRipe(p)} days.`;
}

export function harvestPlot(state, base, plotId) {
  const p = plotById(state, base, plotId);
  if (!p) return "That plot is gone.";
  if (p.stage !== "ripe") return "Nothing ripe on that plot.";
  if (!hasFarmer(state, base)) return "Nobody is on the Farm role here to harvest it.";
  const got = takeHarvest(base, p);
  return `Harvested ${got} food from plot ${p.id} at ${base.name}.`;
}

export function clearPlot(state, base, plotId) {
  const p = plotById(state, base, plotId);
  if (!p) return "That plot is gone.";
  if (p.stage === "empty") return "The plot is already empty.";
  const was = p.stage === "dead" ? "the dead crop" : p.crop ? CROPS[p.crop].name.toLowerCase() : "it";
  Object.assign(p, { stage: "empty", crop: null, grown: 0, care: 0, careDays: 0, ripeDays: 0, yieldLeft: 0, note: "" });
  return `Plot ${p.id} cleared (${was} dug under).`;
}

export function setPlotWant(state, base, plotId, crop) {
  const p = plotById(state, base, plotId);
  if (!p) return "That plot is gone.";
  p.want = crop && CROPS[crop] ? crop : null;
  return p.want ? `Plot ${p.id} will be sown with ${CROPS[p.want].name.toLowerCase()} when it is free and in season.` : `Plot ${p.id}: the farmers pick the crop.`;
}

export function setAutoReplant(state, base, on) {
  farmOf(state, base).auto = !!on;
  return on ? `Farmers at ${base.name} replant free plots automatically.` : `Farmers at ${base.name} only plant what you sow.`;
}

function takeHarvest(base, p) {
  const got = Math.round(p.yieldLeft * 10) / 10;
  const key = CROPS[p.crop] && CROPS[p.crop].store === "preserved" ? "preserved" : "food";
  base.stock[key] = (base.stock[key] || 0) + got;
  Object.assign(p, { stage: "empty", crop: null, grown: 0, care: 0, careDays: 0, ripeDays: 0, yieldLeft: 0, note: `Last harvest ${got} food` });
  return got;
}

// ---------- water for crops ----------
// Water the planted plots need today: nothing on a rainy day outdoors, a fifth more on a summer day, half again in
// a heat wave or dry spell. dry: as on a dry day (no rain), for planning. Moist soil halves it.
export const CROP_SUMMER_WATER = 1.2, CROP_HOT_WATER = 1.5;
export function cropWaterNeed(state, base, { dry = false } = {}) {
  const w = todayWeather(state);
  const hot = w.key === "heat" || w.key === "drought" || (w.hi ?? 20) >= 30;
  const summer = Weather.season && Weather.season(state).key === "summer";
  const mult = hot ? CROP_HOT_WATER : summer ? CROP_SUMMER_WATER : 1;
  const soil = dry ? 0.4 : (w.soil ?? 0.5);
  let need = 0;
  for (const p of farmOf(state, base).plots) {
    if (p.stage !== "growing") continue;
    if (!p.gh && !dry && (w.rain || 0) > 0) continue;
    need += CROPS[p.crop].water * mult * (!p.gh && soil >= 0.6 ? 0.5 : 1);
  }
  return Math.round(need * 10) / 10;
}

// ---------- the daily tick ----------
// watered: share (0..1) of today's crop water the base could give (economy.js decides, people drink first).
// Returns { harvested, sown, died, rotted } for the log and tests.
export function farmingDaily(state, base, watered = 1) {
  const rng = state.rng;
  const f = farmOf(state, base);
  const out = { harvested: 0, sown: 0, died: [], rotted: [], plots: 0 };
  const care = careToday(state, base);
  const site = siteFarm(state, base);
  const wx = todayWeather(state);
  for (const p of f.plots) {
    if (p.stage === "growing") {
      const c = CROPS[p.crop];
      const clim = plotClimate(p.crop, p.gh);
      let g = W.growth(state, clim);
      if (p.gh && g < GH_MIN_GROWTH && (wx.hi + wx.lo) / 2 > c.climate.tMin - 14) g = GH_MIN_GROWTH; // under glass it keeps going
      p.thirsty = watered < 0.999 && !(!p.gh && (wx.rain || 0) > 0);
      if (p.thirsty) g *= 0.4 + 0.6 * watered;
      p.grown += g;
      p.care += care.care;
      p.careDays += 1;
      const dmg = W.damage(state, clim);
      let kill = dmg.kill * (p.gh ? 0.15 : 1);
      if (dmg.reason === "heat") kill *= 1 - c.heatTol * 0.6;
      if (dmg.reason === "drought") kill *= 0.1 + 0.9 * (p.thirsty ? 1 - watered : 0); // watered plots ride out a dry spell
      if (p.thirsty) kill += 0.04 * (1 - watered) * (0.5 + c.climate.thirst);
      if (kill > 0 && rng.chance(kill)) {
        p.stage = "dead";
        p.note = `Killed by ${p.thirsty && !dmg.reason ? "thirst" : dmg.reason || "the weather"} on day ${day(state)}`;
        out.died.push(`${c.name} (${dmg.reason || "thirst"})`);
        continue;
      }
      if (p.grown >= c.days) {
        p.stage = "ripe";
        p.ripeDays = 0;
        p.yieldLeft = Math.round(c.yield * (p.care / Math.max(1, p.careDays)) * site * 10) / 10;
        p.note = "Ripe: harvest it";
      }
    } else if (p.stage === "ripe") {
      const c = CROPS[p.crop];
      p.ripeDays += 1;
      const dmg = W.damage(state, plotClimate(p.crop, p.gh));
      if (dmg.rot > 0 && rng.chance(dmg.rot * (p.gh ? 0.2 : 1) * (c.snowproof && dmg.reason === "snow" ? 0.15 : 1))) {
        p.yieldLeft = Math.round(p.yieldLeft * 0.75 * 10) / 10;
        p.note = `Part of it rotted (${dmg.reason || "wet"})`;
      }
      if (p.ripeDays > c.spoil) {
        out.rotted.push(c.name);
        p.stage = "dead";
        p.note = `Rotted in the field on day ${day(state)}: not harvested in time`;
      }
    }
  }
  // Harvest: the farmers bring in the oldest ripe plots first.
  let harvestCap = Math.floor(care.labour * HARVEST_PER_FARMER + 1e-9);
  if (care.labour > 0) harvestCap = Math.max(1, harvestCap);
  harvestCap += 2 * farmers(state, base).filter((s) => hasPerk(s, "harvester")).length; // Harvester (skills.js)
  for (const p of f.plots.filter((x) => x.stage === "ripe").sort((a, b) => b.ripeDays - a.ripeDays)) {
    if (harvestCap <= 0) break;
    out.harvested += takeHarvest(base, p);
    out.plots++;
    harvestCap--;
  }
  // Sowing: free (and dead) plots, if the farmers replant on their own or a crop was picked for the plot.
  let plantCap = Math.floor(care.labour * PLANT_PER_FARMER + 1e-9);
  if (care.labour > 0) plantCap = Math.max(1, plantCap);
  const short = watered < 0.999;
  // Nothing new is sown while the base cannot water what is already in the ground (it would die of thirst).
  if (watered < 0.6) plantCap = 0;
  for (const p of f.plots) {
    if (plantCap <= 0) break;
    if (p.stage !== "empty" && !(p.stage === "dead" && f.auto)) continue;
    const pick = p.want && plantCheck(state, base, { ...p, stage: "empty" }, p.want).ok ? p.want : f.auto ? bestCrop(state, base, p, { waterShort: short }) : null;
    // Seed never comes out of the last two days of food.
    if (!pick || edibleFood(base) - CROPS[pick].seed < 2 * residents(state, base.id).length) continue;
    paySeed(base, seedCost(state, base, CROPS[pick].seed)); // Seed Saver (skills.js)
    econStats(state).seed += seedCost(state, base, CROPS[pick].seed);
    sow(p, pick);
    out.sown++;
    plantCap--;
  }
  out.harvested = Math.round(out.harvested * 10) / 10;
  const es = econStats(state);
  es.harvested += out.harvested;
  es.cropsLost += out.died.length + out.rotted.length;
  if (out.harvested > 0) {
    f.lastHarvest = { day: day(state), food: out.harvested };
    log(state, `${base.name}: harvested ${out.harvested} food from ${out.plots} plot${out.plots === 1 ? "" : "s"}.`, "good");
  }
  if (out.died.length) log(state, `${base.name}: crops lost to the weather: ${out.died.join(", ")}.`, "danger");
  if (out.rotted.length) log(state, `${base.name}: ${out.rotted.join(", ")} rotted in the field (nobody harvested in time).`, "danger");
  return out;
}

// ---------- outlook for the UI and the governor ----------
// Next harvests: [{ plot, crop, inDays, food }], soonest first.
export function nextHarvests(state, base) {
  const care = careToday(state, base).care;
  return farmOf(state, base).plots.filter((p) => p.stage === "growing" || p.stage === "ripe")
    .map((p) => ({ plot: p.id, crop: p.crop, name: CROPS[p.crop].name, inDays: daysToRipe(p), food: p.stage === "ripe" ? p.yieldLeft : expectedYield(state, base, p, care) }))
    .sort((a, b) => a.inDays - b.inDays);
}

// Expected food per day from the plots over the coming weeks (for planning: what is in the ground, by its time).
export function farmFoodPerDay(state, base) {
  const list = nextHarvests(state, base);
  const days = 30;
  return list.filter((h) => h.inDays <= days).reduce((a, h) => a + h.food, 0) / days;
}

// Weather effect on one plot today, as text for the Farming tab ("" in fair weather).
export function plotWeatherNote(state, base, p) {
  if (!p.crop || (p.stage !== "growing" && p.stage !== "ripe")) return "";
  const clim = plotClimate(p.crop, p.gh);
  const bits = [];
  if (p.stage === "growing") {
    const g = W.growth(state, clim);
    bits.push(g <= 0 ? "not growing today" : `growth ${Math.round(g * 100)}%`);
    if (p.thirsty) bits.push("short of water");
  }
  const dmg = W.damage(state, clim);
  const kill = dmg.kill * (p.gh ? 0.15 : 1);
  if (p.stage === "growing" && kill >= 0.01) bits.push(`${Math.round(kill * 100)}% risk of dying (${dmg.reason})`);
  if (p.stage === "ripe" && dmg.rot >= 0.01) bits.push(`${Math.round(dmg.rot * (p.gh ? 0.2 : 1) * 100)}% risk of rot`);
  if (p.stage === "ripe") bits.push(`${Math.max(0, CROPS[p.crop].spoil - p.ripeDays)} day(s) left to harvest`);
  if (p.stage === "growing" && !p.gh && !W.inSeason(state, clim)) bits.push("out of season");
  return bits.join(", ");
}

// How many farmers the plots can use: about one per planted plot (more still helps, less and less).
export function farmersWanted(state, base) {
  const f = farmOf(state, base);
  const active = f.plots.filter((p) => p.stage === "growing" || p.stage === "ripe").length;
  const toSow = f.auto ? f.plots.filter((p) => (p.stage === "empty" || p.stage === "dead") && bestCrop(state, base, p)).length : 0;
  return { active, toSow, need: active + toSow > 0 ? Math.max(1, Math.ceil((active + toSow) * 0.6)) : 0, ideal: Math.ceil((active + toSow) * 1.2) };
}

// ---------- the winter outlook (the governor and the Farming tab) ----------
// Will the food last until the first spring harvest? Day by day from today to the end of the hungry gap
// (hungryGap): everyone living here eats (residents × the usual food need for the time of year: more in the cold),
// fresh food first, and food spoils by the base's storage at the usual temperature (storage.js: cellar room,
// outside above it, preserved barely); the crops standing now come in on the day they should ripen (by the usual
// weather, times the chance they survive), and then each plot gets the crops the farmers would sow on it one
// after the other (plannedCrop, at 85% of the forecast) until the first spring harvest. Seed for the spring
// sowing is kept back at the end. Loot and trade come on top: a planning figure, on the safe side.
// extra = more mouths (a newcomer being weighed); also = other bases pooled with this one (the hub feeds the
// outposts that run short, and they ship it their surplus). short counts a safety margin of 15% of what the gap
// needs. Returns { gap, people, bases, days, need, gapNeed (eaten and spoiled from the first day of winter to the
// first spring harvest), have, crops, spoil, seed, margin, end (food left at the first spring harvest after the
// seed), short, runsOut (day index the food runs out, or null), low: { food, day } }.
export const FUTURE_SOWING = 0.85;
// What the farmers would sow on a plot on campaign day index i, for planning (no stock, water or storage
// considerations): the most food per calendar day by the usual weather, among the crops in season that would be
// growing then and live to ripen more often than not.
const plannedMemo = new Map();
export function plannedCrop(gh, i) {
  const doy = ((i % YEAR) + YEAR) % YEAR;
  const key = `${gh ? 1 : 0}|${doy}`;
  if (plannedMemo.has(key)) return plannedMemo.get(key);
  const sk = Weather.seasonOfDay ? Weather.seasonOfDay(i).key : "summer";
  let best = null, bestScore = 0;
  for (const k of CROP_KEYS) {
    const c = CROPS[k];
    if (!gh && (!c.climate.seasons.includes(sk) || (c.sowIn && !c.sowIn.includes(sk)))) continue;
    if (!gh && !c.sowIn && climateTable(k, false).grow[doy] < 0.15) continue;
    const fc = cropForecast(k, gh, i);
    if (!isFinite(fc.days) || fc.survival < 0.5) continue;
    const score = (c.yield * fc.survival - c.seed) / (fc.days + 10);
    if (score > bestScore) { best = k; bestScore = score; }
  }
  plannedMemo.set(key, best);
  return best;
}
export const WINTER_MARGIN = 0.15;
export function winterOutlook(state, base, { extra = 0, also = [] } = {}) {
  const today = todayIdx(state);
  const gap = hungryGap(state, today);
  const pool = [base, ...also.filter((b) => b && b !== base)];
  const people = pool.reduce((a, b) => a + residents(state, b.id).length, 0) + extra;
  const events = new Map();
  const add = (i, food, key) => { const e = events.get(i) || { food: 0, preserved: 0 }; e[key] += food; events.set(i, e); };
  let crops = 0, plots = 0;
  const keyOf = (crop) => (CROPS[crop].store === "preserved" ? "preserved" : "food");
  for (const b of pool) {
  const f = farmOf(state, b);
  const care = careToday(state, b).care;
  const site = siteFarm(state, b);
  plots += f.plots.length;
  for (const p of f.plots) {
    let next = today + 1; // when the plot is free to sow
    if (p.stage === "ripe") { add(today, p.yieldLeft, keyOf(p.crop)); crops += p.yieldLeft; }
    else if (p.stage === "growing") {
      const fc = cropForecast(p.crop, p.gh, today, p.grown);
      if (!isFinite(fc.days)) continue; // it will not ripen (out of season for good): the plot is lost for now
      if (today + fc.days < gap.end) {
        const food = expectedYield(state, b, p, care) * fc.survival;
        add(today + fc.days, food, keyOf(p.crop));
        crops += food;
      }
      next = today + fc.days + 1;
    }
    // Then the crops the farmers would sow on it, one after the other, until the first spring harvest (a little
    // less than the forecast: dry spells, short hands, seed and the odd lost day). Nothing replanted by hand.
    if (!f.auto && !p.want) continue;
    for (let n = 0, guard = 0; guard < 40 && next < gap.end; guard++) {
      const pick = n === 0 && p.want ? p.want : plannedCrop(p.gh, next);
      if (!pick) { next += 7; continue; } // nothing to sow outdoors now (winter): look again in a week
      const fc = cropForecast(pick, p.gh, next);
      if (!isFinite(fc.days)) { next += 7; continue; }
      if (next + fc.days < gap.end) {
        const pc = CROPS[pick];
        const food = (pc.yield * care * site * fc.survival - pc.seed) * FUTURE_SOWING;
        add(next + fc.days, food, keyOf(pick));
        crops += food;
      }
      next += fc.days + 1;
      n++;
    }
  }
  }
  let fresh = pool.reduce((a, b) => a + Math.max(0, b.stock.food || 0), 0), pres = pool.reduce((a, b) => a + Math.max(0, b.stock.preserved || 0), 0);
  const have = fresh + pres;
  let need = 0, gapNeed = 0, spoil = 0, unmet = 0, runsOut = null, low = { food: have, day: today };
  for (let i = today; i < gap.end; i++) {
    const e = events.get(i);
    if (e) { fresh += Math.max(0, e.food); pres += Math.max(0, e.preserved); }
    const eat = people * usualFoodNeed(i);
    need += eat;
    if (i >= gap.start) gapNeed += eat;
    const fromFresh = Math.min(fresh, eat);
    fresh -= fromFresh;
    const fromPres = Math.min(pres, eat - fromFresh);
    pres -= fromPres;
    const missing = eat - fromFresh - fromPres;
    if (missing > 1e-9) { unmet += missing; if (runsOut == null) runsOut = i; }
    const t = usualTemp(i);
    const freshLoss = Math.min(fresh, spoilFresh(base, fresh, t));
    const presLoss = pres * storeRate("preserved", t);
    fresh -= freshLoss;
    pres -= presLoss;
    spoil += freshLoss + presLoss;
    if (i >= gap.start) gapNeed += freshLoss + presLoss;
    if (fresh + pres < low.food) low = { food: fresh + pres, day: i };
  }
  const seed = plots * 3;
  // A safety margin for bad luck (a crop lost, a raid, a bad winter): 15% of what the gap needs.
  const margin = Math.round(gapNeed * WINTER_MARGIN);
  const end = fresh + pres - seed;
  const short = unmet + Math.max(0, margin - end);
  const r = (v) => Math.round(v);
  return { gap, people, bases: pool.length, days: gap.end - today, need: r(need), gapNeed: r(gapNeed), have: r(have), crops: r(crops), spoil: r(spoil), seed, margin, end: r(end), short: r(short), runsOut, low: { food: r(low.food), day: low.day } };
}
