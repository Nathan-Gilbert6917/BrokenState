// Farming: crop plots at every base. A crop takes days to ripen and is harvested in one go; it does not
// produce food every day. Each base has plots by type (hub 6, outpost 2) plus 2 per Farm plot building and
// 2 sheltered plots per Greenhouse. Every crop has its own growing time, yield, seed cost, water need, seasons,
// tolerances and a harvest window. Growth each day follows the weather (weather.js growthFactor); frost,
// storms, drought and heat can kill a standing crop and wet weather rots a ripe one (weather.js cropDamage).
// Ripe crops must be harvested by farmers within their window or they rot in the field.
// Yield = base yield x care x site, where care is averaged over the days the crop stood:
//   care = tending (farmers per planted plot, diminishing returns) x skill (the tending farmers' Farming).
// More and better farmers give more food from the same days, never a faster crop.
// Stored food spoils slowly (economy.js uses foodSpoilage): a storehouse and a root cellar slow it.
import * as Weather from "./weather.js";
import { log, atBase, skill, day, residents } from "./world.js";
import { count } from "./buildings.js";
import { workFactor } from "./health.js";

// days = growing days at a growth factor of 1 (a cold or dry spell makes it longer); yield = food per plot at
// care 1; seed = food to plant one plot; water = water per plot per dry day; spoil = days a ripe crop keeps in the
// field before it is lost; heatTol = 0..1 heat tolerance (frost tolerance is climate.hardy, drought tolerance is
// 1 - climate.thirst). climate goes to weather.js as is.
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
  wheat:  { name: "Wheat",        days: 42, yield: 72, seed: 4, water: 0.15, spoil: 12, heatTol: 0.5,
    climate: { seasons: ["spring", "summer", "autumn"], hardy: 0.8, thirst: 0.3, tMin: 3, tOpt: [10, 24], tall: 0.7 },
    desc: "Slow, hardy and needs little water. Storms can lodge it." },
  squash: { name: "Squash",       days: 24, yield: 52, seed: 3, water: 0.3, spoil: 14, heatTol: 0.7,
    climate: { seasons: ["summer", "autumn"], hardy: 0.1, thirst: 0.6, tMin: 9, tOpt: [16, 28], tall: 0.2 },
    desc: "A summer and autumn crop that keeps a long time in the field." },
  greens: { name: "Greens",       days: 12, yield: 19, seed: 2, water: 0.2, spoil: 3,  heatTol: 0.1,
    climate: { seasons: ["spring", "summer", "autumn"], hardy: 0.6, thirst: 0.5, tMin: 4, tOpt: [8, 22], tall: 0 },
    desc: "Lettuce, spinach and chard: the fastest food there is, but small, and it wilts in heat or in a few days ripe." },
  turnip: { name: "Winter roots", days: 30, yield: 40, seed: 3, water: 0.15, spoil: 14, heatTol: 0.2,
    climate: { seasons: ["spring", "autumn", "winter"], hardy: 1, thirst: 0.3, tMin: 0, tOpt: [6, 18], tall: 0 },
    desc: "Turnips, kale and swedes: frost-proof, for late autumn and (under glass) winter. Small yield." },
};
export const CROP_KEYS = Object.keys(CROPS);

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
  damage: (state, clim) => (Weather.cropDamage ? Weather.cropDamage(state, clim) : { kill: 0, rot: 0, reason: "" }),
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

// ---------- plots ----------
// The farm of a base, created on first use; plots follow the buildings (a finished Farm plot or Greenhouse adds
// empty plots). The hub's fields are already sown on day 1 (planted before the fall), so the first harvests come in
// the first two weeks.
export function farmOf(state, base) {
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
  const avg = tenders.length ? tenders.reduce((a, s) => a + skill(s, "farming"), 0) / tenders.length : 0;
  return { care: tendMult(labour / planted) * skillMult(avg), tend: tendMult(labour / planted), skill: skillMult(avg), labour, planted, perPlot: labour / planted, avgSkill: avg };
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
  const need = c.days / Math.max(0.5, Math.min(EXPECTED_GROWTH, recentGrowth(state, crop, p.gh) + 0.25));
  if (!p.gh && W.daysLeft(state, clim) < need) return { ok: false, reason: `Would not ripen before the season ends (needs about ${Math.ceil(need)} days)` };
  if ((base.stock.food || 0) < c.seed) return { ok: false, reason: `Needs ${c.seed} food as seed` };
  return { ok: true, reason: "" };
}

// The crop to sow on a plot today: the most food per day among those that can ripen in time, thirsty crops
// marked down while water is short. null when nothing fits (winter outdoors).
export function bestCrop(state, base, p, { waterShort = false } = {}) {
  let best = null, bestScore = 0;
  // Short of food: a crop that ripens within about three weeks is worth twice as much.
  const foodDays = (base.stock.food || 0) / Math.max(1, residents(state, base.id).length);
  for (const k of CROP_KEYS) {
    const c = CROPS[k];
    const clim = plotClimate(k, p.gh);
    if (!p.gh && !W.inSeason(state, clim)) continue;
    const g = recentGrowth(state, k, p.gh);
    if (g < 0.15) continue; // too cold or dry for it right now
    if (!p.gh && W.daysLeft(state, clim) < c.days / Math.max(0.5, Math.min(EXPECTED_GROWTH, g + 0.25))) continue;
    // Food per day, counting 10 days of waiting: quicker crops win a close call.
    let score = (c.yield - c.seed) / (c.days / Math.min(1.1, g) + 10);
    if (foodDays < 15 && c.days / Math.min(1.1, g) > 22) score *= 0.5;
    // Safety from frost: a little in spring and summer, a lot in autumn (first frosts).
    score *= seasonKey(state) === "autumn" && !p.gh ? 0.35 + 0.65 * clim.hardy : 0.85 + 0.15 * clim.hardy;
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
  base.stock.food -= CROPS[crop].seed;
  sow(p, crop);
  p.want = crop;
  return `${CROPS[crop].name} sown on plot ${p.id} at ${base.name} (${CROPS[crop].seed} food as seed). Ripe in about ${daysToRipe(p)} days.`;
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
  base.stock.food = (base.stock.food || 0) + got;
  Object.assign(p, { stage: "empty", crop: null, grown: 0, care: 0, careDays: 0, ripeDays: 0, yieldLeft: 0, note: `Last harvest ${got} food` });
  return got;
}

// ---------- water for crops ----------
// Water the planted plots need today: nothing on a rainy day outdoors, half again in a heat wave.
// dry: as on a dry day (no rain), for planning. Moist soil halves it; a heat wave or dry spell adds half.
export function cropWaterNeed(state, base, { dry = false } = {}) {
  const w = todayWeather(state);
  const hot = w.key === "heat" || w.key === "drought" || (w.hi ?? 20) >= 30;
  const soil = dry ? 0.4 : (w.soil ?? 0.5);
  let need = 0;
  for (const p of farmOf(state, base).plots) {
    if (p.stage !== "growing") continue;
    if (!p.gh && !dry && (w.rain || 0) > 0) continue;
    need += CROPS[p.crop].water * (hot ? 1.5 : 1) * (!p.gh && soil >= 0.6 ? 0.5 : 1);
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
      if (dmg.rot > 0 && rng.chance(dmg.rot * (p.gh ? 0.2 : 1))) {
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
  for (const p of f.plots) {
    if (plantCap <= 0) break;
    if (p.stage !== "empty" && !(p.stage === "dead" && f.auto)) continue;
    const pick = p.want && plantCheck(state, base, { ...p, stage: "empty" }, p.want).ok ? p.want : f.auto ? bestCrop(state, base, p, { waterShort: short }) : null;
    // Seed never comes out of the last two days of food.
    if (!pick || (base.stock.food || 0) - CROPS[pick].seed < 2 * residents(state, base.id).length) continue;
    base.stock.food -= CROPS[pick].seed;
    econStats(state).seed += CROPS[pick].seed;
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
