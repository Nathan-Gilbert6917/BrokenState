// Economy checks (farming.js, economy.js, storage.js, health.js): crop timing and yields against farmers' skill and
// numbers, weather killing and rotting crops, the harvest window, water (wells, capacity, people and crops drinking,
// thirst), food storage (room, cellar vs outside, preserved food, eating order, jars, the preserving kitchen and
// drying racks), the winter crops, the winter outlook, rare base scavenging, illness and injuries (chances, contagion, treatment, work),
// fuel scarcity, and no NaN or negative stock over long campaigns.
// Usage: node tools/farmtest.js [seed] [days for the long runs]
import { outputDays } from "../src/sim/output.js";
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js";
import { lotsOf, FOODS, unitsOf } from "../src/sim/foods.js"; // days of food by type (sim/foods.js)
import { ROUND_KEYS } from "../src/sim/ammo.js";
import { PART_KINDS } from "../src/sim/trade.js";
import { RELOAD_SUPPLIES } from "../src/sim/data-ammo.js"; // the reloading bench's brass, powder, primers: like rounds, kept only where there are some
import { createWorld, hub, atBase, alive, residents, makeSurvivor, newId, day } from "../src/sim/world.js";
import { tickHour } from "../src/sim/world.js";
import {
  CROPS, CROP_KEYS, farmOf, farmingDaily, careToday, tendMult, skillMult, plotLimit, cropWaterNeed, bestCrop, plantPlot,
  harvestPlot, clearPlot, econStats, cropForecast, hungryGap, winterOutlook, plantCheck,
} from "../src/sim/farming.js";
import {
  STORE, FACTOR, RACK, storeCapacity, storeFactor, foodStore, edibleFood, eatFromStore, jarsInUse, rackPlan,
} from "../src/sim/storage.js";
import {
  basesDaily, waterProduction, waterNeed, waterCapacity, waterOutlook, WATER, thirstDamage, spoilRate, foodSpoilage,
  scavengeOutput, scavYield, scavTrip, scavTripTile, siteBonus, BASE_SCAV_YIELD, SCAV_REF, SCAV_SKILL, SCAV_YIELD_CAP, foodOutlook, eatPerDay, summerWater, summerWaterOk, summerFixText, summerWarningDaily, SUMMER_WARN_DAYS,
} from "../src/sim/economy.js";
import {
  CONDITIONS, addCondition, treatCondition, treatConditionInfo, workFactor, healthDaily, conditionsOf, isSick,
} from "../src/sim/health.js";
import { addBuilding, buildRate, stationOperator, stations, stationStatus, runStations, RECIPES, BUILDINGS } from "../src/sim/buildings.js";
import { medicalHour, patients } from "../src/sim/medical.js";
import { LOCATIONS, SUPPLY_KEYS } from "../src/sim/data.js";
import { setAutopilot, foodTarget, waterPlan, droughtWater } from "../src/sim/autopilot.js";
import { makeItem } from "../src/sim/crafting.js";
import * as Weather from "../src/sim/weather.js";

const seed = Number(process.argv[2] || 42);
const longDays = Number(process.argv[3] || 224);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const r1 = (v) => Math.round(v * 10) / 10;
const wtot = (b) => Math.round(((b.stock.water || 0) + (b.stock.rawwater || 0)) * 100) / 100; // purified and un-purified water (sim/water.js)
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; return st; };
const plain = (s) => { s.traits = []; return s; };
const addPerson = (st, base, role) => { const s = plain(makeSurvivor(st, 1)); s.location = { kind: "base", baseId: base.id }; s.role = role; st.survivors.push(s); return s; };
const setDay = (st, dayIdx) => { st.hour = dayIdx * 24 + 12; };
const nextDay = (st) => { st.hour += 24; };
const bareFarm = (st, h) => { const f = farmOf(st, h); for (const p of f.plots) clearPlot(st, h, p.id); f.auto = false; return f; };
const has = (fn, name) => { if (typeof fn !== "function") console.log(`  note: weather.js has no ${name}; the farming code uses its fair-weather fallback`); };
has(Weather.growthFactor, "growthFactor"); has(Weather.cropDamage, "cropDamage"); has(Weather.rainWater, "rainWater"); has(Weather.exposureRisk, "exposureRisk");

// 1. Crops take days, not a daily trickle; more and better farmers give more from the same days.
{
  console.log("Crop timing and yields");
  const grow = (dayIdx, crop, farmerSkills) => {
    const st = W();
    const h = hub(st);
    const f = bareFarm(st, h);
    atBase(st, h.id).forEach((s) => { s.role = "rest"; s.conditions = []; });
    farmerSkills.forEach((sk, i) => { const s = atBase(st, h.id)[i]; s.role = "farm"; s.skills.farming = sk; plain(s); });
    setDay(st, dayIdx);
    setFood(h, 100);
    const p = f.plots[0];
    const msg = plantPlot(st, h, p.id, crop);
    const food0 = food(h);
    let days = 0, ripeAt = null, dailyRise = false;
    while (days < 120) {
      const before = food(h);
      const out = farmingDaily(st, h, 1);
      days++;
      if (p.stage === "dead") return { died: true, msg };
      if (out.harvested > 0) { ripeAt = days; return { ripeAt, yield: out.harvested, dailyRise, msg, food0 }; }
      if (food(h) > before + 1e-9) dailyRise = true;
      nextDay(st);
    }
    return { never: true, msg };
  };
  let done = false;
  for (let start = 16; start < 40 && !done; start += 2) {
    const novice = grow(start, "potato", [2]);
    const crew = grow(start, "potato", [2, 2, 2]);
    const experts = grow(start, "potato", [16, 16, 16]);
    if (novice.died || crew.died || experts.died || novice.never) continue;
    done = true;
    check(!novice.dailyRise && !crew.dailyRise, "no food comes in while the crop is still growing");
    check(novice.ripeAt >= CROPS.potato.days * 0.7, `potatoes take weeks to ripen (${novice.ripeAt} days, ${CROPS.potato.days} at full growth)`);
    check(novice.ripeAt === crew.ripeAt && crew.ripeAt === experts.ripeAt, `more or better farmers do not make it faster (${novice.ripeAt} / ${crew.ripeAt} / ${experts.ripeAt} days)`);
    check(crew.yield > novice.yield * 1.15, `three farmers on one plot harvest more than one (${novice.yield} → ${crew.yield})`);
    check(experts.yield > crew.yield * 1.2, `skilled farmers harvest more (${crew.yield} → ${experts.yield})`);
    console.log(`  potatoes sown on day ${start + 1}: ripe after ${novice.ripeAt} days; yield ${novice.yield} (1 novice), ${crew.yield} (3 novices), ${experts.yield} (3 experts)`);
  }
  check(done, "found a summer start where the test crop survived");
  check(tendMult(1) - tendMult(0.5) > tendMult(2) - tendMult(1.5) && tendMult(3) > tendMult(2), "more farmers per plot help, with diminishing returns");
  check(skillMult(20) > skillMult(10) && skillMult(10) > skillMult(0), "Farming skill raises the yield");
  // Every crop: sensible numbers, and the table is complete.
  for (const k of CROP_KEYS) {
    const c = CROPS[k];
    check(c.days > 0 && c.yield > c.seed && c.water >= 0 && c.spoil > 0 && c.climate && c.climate.seasons.length, `${k}: complete crop data`);
  }
  // Plots per base type, and buildings add plots.
  const st = W();
  const h = hub(st);
  const n0 = plotLimit(h);
  addBuilding(h, "farm_plot");
  check(plotLimit(h) === n0 + 2 && farmOf(st, h).plots.length === n0 + 2, `a Farm plot adds 2 plots (${n0} → ${farmOf(st, h).plots.length})`);
  addBuilding(h, "greenhouse");
  check(farmOf(st, h).plots.filter((p) => p.gh).length === 2, "a Greenhouse adds 2 plots under glass");
  check(farmOf(st, h).plots.filter((p) => !p.gh && p.stage === "growing").length >= 8, "the hub starts with its fields sown");
}

// 2. Weather kills and rots crops; ripe crops must be harvested within their window.
{
  console.log("Weather, rot and the harvest window");
  // Tender beans sown late in the autumn: frost and the first freezes kill them.
  const st = W();
  const h = hub(st);
  const f = bareFarm(st, h);
  atBase(st, h.id).forEach((s) => { s.role = "farm"; });
  setDay(st, 64);
  for (const p of f.plots.filter((x) => !x.gh)) Object.assign(p, { stage: "growing", crop: "beans", grown: 1, care: 1, careDays: 1 });
  const before = econStats(st).cropsLost;
  for (let i = 0; i < 25; i++) { farmingDaily(st, h, 1); nextDay(st); }
  const dead = f.plots.filter((p) => p.stage === "dead" || (p.stage === "empty" && /Killed/.test(p.note))).length;
  const why = f.plots.map((p) => p.note).filter((n) => /Killed/.test(n)).join("; ");
  check(dead >= 3, `frost kills tender crops sown too late (${dead} of ${f.plots.length} died: ${why.slice(0, 120)})`);
  check(econStats(st).cropsLost > before, "lost crops are counted");
  check(/frost|freeze|blizzard|snow/.test(why), "the plot says what killed it");
  // A ripe crop nobody harvests rots in the field.
  const st2 = W();
  const h2 = hub(st2);
  const f2 = bareFarm(st2, h2);
  atBase(st2, h2.id).forEach((s) => (s.role = "rest"));
  setDay(st2, 20);
  const p = f2.plots[0];
  Object.assign(p, { stage: "ripe", crop: "greens", grown: 12, care: 1, careDays: 1, yieldLeft: 10, ripeDays: 0 });
  for (let i = 0; i <= CROPS.greens.spoil + 1; i++) { farmingDaily(st2, h2, 1); nextDay(st2); }
  check(p.stage === "dead" && /Rotted/.test(p.note), `an unharvested ripe crop rots after its window (${p.stage}: ${p.note})`);
  // Farmers bring it in.
  atBase(st2, h2.id)[0].role = "farm";
  Object.assign(p, { stage: "ripe", crop: "greens", grown: 12, care: 1, careDays: 1, yieldLeft: 10, ripeDays: 0, note: "" });
  const food0 = food(h2);
  farmingDaily(st2, h2, 1);
  check(p.stage !== "ripe" && food(h2) > food0 && food(h2) <= food0 + 10, `farmers harvest a ripe plot (${food0} → ${food(h2)})`);
  // Player actions.
  check(/Nothing ripe/.test(harvestPlot(st2, h2, p.id)), "harvesting an empty plot is refused");
  const winter = W();
  const hw = hub(winter);
  const fw = bareFarm(winter, hw);
  setDay(winter, 80);
  check(bestCrop(winter, hw, fw.plots.find((x) => !x.gh)) === null, "nothing is sown outdoors in deep winter");
  addBuilding(hw, "greenhouse");
  const gh = farmOf(winter, hw).plots.find((x) => x.gh);
  check(!!bestCrop(winter, hw, gh), "a greenhouse plot can be sown in winter");
}

// 3. Water: people and crops drink, wells fill up to the capacity, thirst kills.
{
  console.log("Water");
  const st = W();
  const h = hub(st);
  atBase(st, h.id).forEach((s) => { s.role = "rest"; s.conditions = []; });
  const n = residents(st, h.id).length;
  const need = waterNeed(st, h);
  check(need.people === Math.round(n * Weather.thirstFactor(st) * 10) / 10 && need.rate === 1, `everyone drinks 1 a day in spring (${need.people} for ${n} people)`);
  const prod = waterProduction(st, h);
  check(prod.own > 0 && prod.total >= prod.own, `the hub's well gives water (${prod.total} a day)`);
  h.stock.water = 30; h.stock.rawwater = 0; // both kinds count (sim/water.js)
  const outlook = waterOutlook(st, h);
  basesDaily(st);
  st.cards.length = 0;
  const expect = Math.min(waterCapacity(h), 30 + prod.total) - need.people;
  check(wtot(h) <= expect + 0.11 && wtot(h) >= expect - need.crops - 0.11, `water moves by production minus drinking and crops (${wtot(h)}, expected ${expect.toFixed(1)} less up to ${need.crops} for crops)`);
  check(Number.isFinite(outlook.net) && Number.isFinite(outlook.dryNet), "the water outlook is a number");
  // Capacity: the well does not fill past it, water brought home is kept; a cistern holds more.
  h.stock.water = waterCapacity(h); h.stock.rawwater = 0; // both kinds count (sim/water.js)
  const cap0 = waterCapacity(h);
  basesDaily(st);
  check(wtot(h) <= cap0, `the well does not overfill (${wtot(h)} of ${cap0})`);
  h.stock.water = cap0 + 100; h.stock.rawwater = 0; // both kinds count (sim/water.js)
  basesDaily(st);
  check(wtot(h) > cap0, "water brought home above the capacity is kept");
  addBuilding(h, "cistern");
  check(waterCapacity(h) === cap0 + WATER.cistern, "a cistern adds capacity");
  addBuilding(h, "well");
  check(waterProduction(st, h).wells > 0, "a well adds water");
  // Crops need water on dry days (none when it rains).
  let dry = null, wet = null;
  for (let d = 15; d < 60 && (dry == null || wet == null); d++) {
    setDay(st, d);
    const w = Weather.weather ? Weather.weather(st) : { rain: 0 };
    if (w.rain > 0 && wet == null) wet = d;
    if (!w.rain && dry == null) dry = d;
  }
  if (dry != null) { setDay(st, dry); check(cropWaterNeed(st, h) > 0, `growing crops need watering on a dry day (${cropWaterNeed(st, h)})`); }
  if (wet != null) { setDay(st, wet); check(cropWaterNeed(st, h) === 0, "no watering needed on a rainy day"); }
  // A water filter adds water.
  const f0 = waterProduction(st, h).filters;
  h.armory.push(makeItem("waterfilter", 1));
  check(waterProduction(st, h).filters === f0 + 3, "a water filter counts in the water outlook");
  // Thirst kills, faster than hunger, and armor does not help.
  const st2 = W();
  const h2 = hub(st2);
  const ppl = atBase(st2, h2.id);
  ppl.forEach((s) => { plain(s); s.role = "rest"; s.mood = 60; });
  ppl[0].gear.armor = makeItem("plate", 1);
  const keep = { hubWell: WATER.hubWell, stream: WATER.stream };
  WATER.hubWell = 0; WATER.stream = 0;
  h2.stock.water = 0; setFood(h2, 500);
  let days = 0;
  while (alive(st2).length === ppl.length && days < 20) {
    h2.stock.water = 0;
    for (let i = 0; i < 24; i++) medicalHour(st2);
    basesDaily(st2);
    st2.cards.length = 0;
    ppl.forEach((s) => (s.mood = 60));
    days++;
  }
  Object.assign(WATER, keep);
  check(alive(st2).length < ppl.length, `thirst kills (first death after ${days} days without water)`);
  check(days <= 9, `faster than hunger (${days} days)`);
  check(thirstDamage(1) < thirstDamage(2) && thirstDamage(3) < thirstDamage(5), "thirst damage grows day by day");
}

// 3b. Seasonal water: everyone drinks by the season (spring and autumn 1, summer 1.3, winter 0.9, at least 1.6 on a
// hot day), crops need a fifth more on a summer dry day, water above the capacity evaporates a little in summer, the
// summer outlook and its warning a week before summer, and the governor's summer plan on a big hub.
{
  console.log("Seasonal water");
  const T = Weather.THIRST;
  check(T.spring === 1 && T.summer === 1.3 && T.autumn === 1 && T.winter === 0.9 && T.heat === 1.6, `thirst: spring ${T.spring}, summer ${T.summer}, autumn ${T.autumn}, winter ${T.winter}, a hot day at least ${T.heat}`);
  const st = W();
  const h = hub(st);
  atBase(st, h.id).forEach((s) => { s.role = "rest"; s.conditions = []; });
  const n = residents(st, h.id).length;
  // Days by kind: a plain day of each season, a hot summer day.
  const find = (pred) => { for (let d = 0; d < 112 * 3; d++) if (pred(d)) return d; return null; };
  const hot = (d) => { const w = Weather.weatherOnDay(st, d + 1); return w.key === "heat" || w.hi >= 30; };
  const plainDay = { spring: null, summer: null, autumn: null, winter: null };
  for (const k of Object.keys(plainDay)) plainDay[k] = find((d) => Weather.seasonOfDay(d).key === k && !hot(d) && Weather.weatherOnDay(st, d + 1).key !== "drought");
  const hotDay = find((d) => hot(d));
  for (const [k, d] of Object.entries(plainDay)) {
    setDay(st, d);
    const need = waterNeed(st, h);
    check(Weather.thirstFactor(st) === T[k] && need.rate === T[k] && Math.abs(need.people - n * T[k]) < 0.06, `${k}: everyone drinks ${T[k]} (${need.people} for ${n})`);
  }
  check(hotDay != null, "test setup: a hot day in three years");
  setDay(st, hotDay);
  check(Weather.thirstFactor(st) >= T.heat && waterNeed(st, h).hot, `a hot day (${Weather.weather(st).name}, ${Math.round(Weather.weather(st).hi)} °C): at least ${T.heat} each (${Weather.thirstFactor(st)})`);
  // The day's drinking at the base follows the rate (summer).
  setDay(st, plainDay.summer);
  bareFarm(st, h);
  h.stock.water = 30; h.stock.rawwater = 0; // both kinds count (sim/water.js)
  const prodS = waterProduction(st, h);
  basesDaily(st);
  st.cards.length = 0;
  const expectS = Math.min(waterCapacity(h), 30 + prodS.total) - n * T.summer;
  check(Math.abs(wtot(h) - expectS) < 0.11, `summer: the base drinks ${T.summer} a head (${wtot(h)}, expected ${expectS.toFixed(1)})`);
  // Prisoners in the cells drink like anyone: counted in the outlook.
  st.prisoners = [{ id: 1, at: { kind: "base", baseId: h.id } }];
  check(Math.abs(waterNeed(st, h).prisoners - T.summer) < 0.01, `a prisoner in the cells drinks ${T.summer} in summer too`);
  st.prisoners = [];
  // Crops: a fifth more on a summer dry day than in spring (the same plots), half again when hot (as before).
  const f = bareFarm(st, h);
  setDay(st, plainDay.spring);
  atBase(st, h.id)[0].role = "farm";
  setFood(h, Math.max(food(h) || 0, 50));
  plantPlot(st, h, f.plots[0].id, "potato");
  plantPlot(st, h, f.plots[1].id, "beans");
  const springCrops = cropWaterNeed(st, h, { dry: true });
  setDay(st, plainDay.summer);
  const summerCrops = cropWaterNeed(st, h, { dry: true });
  check(springCrops > 0 && Math.abs(summerCrops - springCrops * 1.2) < 0.11, `crops need a fifth more on a summer dry day (${springCrops} → ${summerCrops})`);
  setDay(st, hotDay);
  check(Math.abs(cropWaterNeed(st, h, { dry: true }) - springCrops * 1.5) < 0.11, `and half again on a hot day (${cropWaterNeed(st, h, { dry: true })})`);
  // Evaporation: in summer, water kept above the capacity loses 5% of the overflow a day; not in spring.
  setDay(st, plainDay.summer);
  const cap = waterCapacity(h);
  h.stock.water = cap + 100; h.stock.rawwater = 0; // both kinds count (sim/water.js)
  const nd = waterNeed(st, h);
  basesDaily(st); st.cards.length = 0;
  check(Math.abs(wtot(h) - (cap + 100 - 100 * WATER.evaporate - nd.people - nd.crops)) < 0.2, `summer: ${Math.round(WATER.evaporate * 100)}% of the water above the capacity evaporates (${wtot(h).toFixed(1)} of ${cap + 100})`);
  setDay(st, plainDay.spring);
  h.stock.water = cap + 100; h.stock.rawwater = 0; // both kinds count (sim/water.js)
  const ns = waterNeed(st, h);
  basesDaily(st); st.cards.length = 0;
  check(Math.abs(wtot(h) - (cap + 100 - ns.people - ns.crops)) < 0.2, "spring: no evaporation");
  // The summer outlook: a crowd at the hub with the starting well falls short, and the outlook says what to build.
  const big = W();
  const hb = hub(big);
  for (let i = 0; i < 30; i++) addPerson(big, hb, "rest");
  const sw = summerWater(big, hb);
  const nb = residents(big, hb.id).length;
  check(sw.n === nb && Math.abs(sw.need - (nb * T.summer + sw.crops)) < 0.11, `summer outlook: ${nb} people at ${T.summer} plus the crops (${sw.need} a day)`);
  check(sw.net < 0 && sw.heatNet < sw.net && sw.fix.some((x) => x.type === "well") && sw.fix.some((x) => x.type === "waterfilter"), `a crowd outgrows the well: ${sw.short} a day short (${-sw.heatNet} in a heat wave); fix: ${summerFixText(sw.fix)}`);
  check(!summerWaterOk(sw), "the crowd's summer water does not hold");
  const small = W();
  const hs = hub(small);
  const sws = summerWater(small, hs);
  check(summerWaterOk(sws) || sws.net >= 0, `the starting hub's own well carries its people (${sws.net >= 0 ? "+" : ""}${sws.net} a day)`);
  // The warning a week before summer: a log line per base that falls short and one card; once a year; none for a
  // base whose summer water holds.
  const warnDay = find((d) => Weather.seasonOfDay(d).key === "spring" && Weather.seasonOfDay(d).daysLeft === SUMMER_WARN_DAYS && d > 20);
  big.cards.length = 0;
  setDay(big, warnDay);
  const log0 = big.log.length;
  summerWarningDaily(big);
  const lines = big.log.slice(0, big.log.length - log0).filter((l) => /Summer in 7 days/.test(l.text));
  const card = big.cards.find((c) => c.summerWater);
  check(lines.length === 1 && /short/.test(lines[0].text) && /Build/.test(lines[0].text), `end of spring: a warning line with the shortfall and what to build ("${lines[0] ? lines[0].text.slice(0, 140) : ""}…")`);
  check(card && /drinks 30% more/.test(card.text) && /60% more in a heat wave/.test(card.text) && card.choices.length, "and a Summer water card (30% more, 60% in a heat wave)");
  big.cards.length = 0;
  summerWarningDaily(big);
  check(!big.cards.some((c) => c.summerWater), "once a year");
  setDay(big, warnDay - 1);
  hb.summerWarned = null;
  summerWarningDaily(big);
  check(!big.cards.some((c) => c.summerWater), "only on its day (a week before summer)");
  small.cards.length = 0;
  setDay(small, warnDay);
  summerWarningDaily(small);
  check(!small.cards.some((c) => c.summerWater), "no warning for a base whose summer water holds");
  // The governor's summer plan on a big hub (autopilot.js waterPlan): it wants filters for the heat-wave gap, holds
  // scrap for them and for a broken well, plans a summer stock, builds wells and cisterns before summer, crafts
  // the filters, and takes in no newcomers its summer water cannot carry.
  const ap = W(seed + 5);
  const ha = hub(ap);
  for (let i = 0; i < 34; i++) { const s = addPerson(ap, ha, "rest"); s.skills.mechanics = 4; }
  setAutopilot(ap, true, "balanced");
  const wd = find((d) => Weather.seasonOfDay(d).key === "spring" && Weather.seasonOfDay(d).daysLeft === 18 && d > 20);
  setDay(ap, wd);
  ap.hour = wd * 24;
  Object.assign(ha.stock, { scrap: 400, parts: 30, water: 60 }); setFood(ha, 3000);
  const wp = waterPlan(ap, ha);
  check(wp.near && wp.short && wp.filters >= 8 && wp.reserve > 0, `a hub of ${residents(ap, ha.id).length} in late spring: summer is near and short; it wants ${wp.filters} filters and ${wp.reserve} water in store`);
  check(wp.hold.scrap >= 4, `scrap held back for water (${wp.hold.scrap})`);
  const nA = atBase(ap, ha.id).length;
  check(!droughtWater(ap, ha, nA + 1), "no newcomers the summer water cannot carry");
  ha.buildings.push({ type: "well", id: newId(), wear: 100, broken: { day: 1, cause: "test" }, built: 1 });
  const wp2 = waterPlan(ap, ha);
  ap.hour += 1; // a new hour: a fresh plan
  check(waterPlan(ap, ha).hold.parts >= 1 && waterPlan(ap, ha).hold.scrap >= wp2.hold.scrap, "a broken well holds a part and scrap for its repair");
  ha.buildings.pop();
  const filtersOf = () => ha.armory.filter((it) => it.key === "waterfilter").length;
  const f0w = filtersOf();
  let thirsty = 0;
  for (let i = 0; i < 24 * 40; i++) {
    tickHour(ap);
    if (ap.hour % 24 === 0) { setFood(ha, 3000); ha.stock.scrap = Math.max(ha.stock.scrap, 60); if (ha.thirstDays) thirsty++; }
    if (ap.gameOver) break;
  }
  const wells = ha.buildings.filter((b) => b.type === "well").length + ha.construction.filter((c) => c.type === "well").length;
  const cis = ha.buildings.filter((b) => b.type === "cistern").length + ha.construction.filter((c) => c.type === "cistern").length;
  console.log(`  big hub after 40 days (into summer): wells ${wells}, cisterns ${cis}, filters ${f0w} → ${filtersOf()}, water ${Math.round(ha.stock.water)}, days without water ${thirsty}`);
  check(wells >= 2, `the governor builds the wells before summer (${wells})`);
  check(filtersOf() >= 6, `and crafts water filters for the summer (${filtersOf()})`);
  check(thirsty === 0, `nobody goes thirsty in the first weeks of summer (${thirsty} dry days)`);
  // Determinism: the same big hub twice.
  const runBig = () => {
    const s2 = W(seed + 5);
    const h2 = hub(s2);
    for (let i = 0; i < 34; i++) { const s = addPerson(s2, h2, "rest"); s.skills.mechanics = 4; }
    setAutopilot(s2, true, "balanced");
    s2.hour = wd * 24;
    Object.assign(h2.stock, { scrap: 400, parts: 30, water: 60 }); setFood(h2, 3000);
    for (let i = 0; i < 24 * 20; i++) tickHour(s2);
    return JSON.stringify([h2.stock, h2.buildings.map((b) => b.type), h2.armory.map((x) => x.key), s2.log.slice(0, 40).map((l) => l.text)]);
  };
  check(runBig() === runBig(), "the summer planning plays out the same twice");
}

// 4. Food storage (storage.js): room for fresh food, slow spoilage inside, fast outside; preserved food; eating
// order and jars; the preserving kitchen and drying racks.
{
  console.log("Food storage and spoilage");
  const st = W();
  const h = hub(st);
  check(storeCapacity(h) === STORE.hubCellar, `the hub starts with a small cellar (${storeCapacity(h)})`);
  const op = { type: "outpost", stock: {}, buildings: [] };
  check(storeCapacity(op) === STORE.pantry, `an outpost has only a pantry (${storeCapacity(op)})`);
  // A mild day for the rates.
  let mild = null;
  for (let d = 10; d < 40 && mild == null; d++) { setDay(st, d); const w = Weather.weather(st); const t = (w.hi + w.lo) / 2; if (t >= 6 && t <= 23 && !w.rain && w.key !== "heat") mild = d; }
  setDay(st, mild ?? 20);
  // Food by type (sim/foods.js): fresh food (potatoes, a month's shelf) needs a room, the cans do not.
  setFood(h, 150, "f_potatoes");
  const inside = foodStore(st, h);
  const facIn = inside.spaces[0].factor;
  check(inside.outside === 0 && near(inside.inside, 150, 1e-6) && facIn <= FACTOR.cellar * 1.2 + 1e-9 && inside.spoil < 1e-6, `fresh food that fits keeps in the cellar (×${facIn.toFixed(2)} of its shelf a day) and none of it will spoil before it is eaten`);
  setFood(h, 400, "f_potatoes");
  const over = foodStore(st, h);
  check(near(over.outside, 200, 1e-6) && over.outFactor >= facIn * 3, `food above the room is stored outside and spoils much faster (${over.outside} outside at ×${over.outFactor.toFixed(2)} vs ×${facIn.toFixed(2)} inside)`);
  check(near(foodSpoilage(st, h), over.spoil, 1e-9) && over.forecast.waste > inside.forecast.waste + 20, `more than the people eat before it goes is lost (${over.forecast.waste.toFixed(0)} days of food against ${inside.forecast.waste.toFixed(0)})`);
  check(storeFactor("outside", 28) > storeFactor("outside", 15) && storeFactor("outside", 15, { wet: true }) > storeFactor("outside", 15) && storeFactor("outside", -3) < storeFactor("outside", 15), "outside: heat and rain rot it faster, frost keeps it");
  check(storeFactor("cellar", 0) < storeFactor("cellar", 15) && storeFactor("cold", -2) < storeFactor("cellar", -2) && storeFactor("cold", 25) > storeFactor("cellar", 25), "the cold store is the best in winter and the worst in summer; everything keeps better in the cold");
  // Buildings add room.
  addBuilding(h, "cellar");
  check(storeCapacity(h) === STORE.hubCellar + STORE.rootCellar, `a root cellar adds ${STORE.rootCellar} room`);
  addBuilding(h, "storehouse"); addBuilding(h, "coldstore");
  check(storeCapacity(h) === STORE.hubCellar + STORE.rootCellar + STORE.storehouse + STORE.coldStore, `a storehouse and a cold store add room (${storeCapacity(h)})`);
  check(foodStore(st, h).outside === 0, "with the room built nothing is stored outside");
  // Food that keeps (jars, cans): no room needed, nothing lost for years.
  setFood(h, 0); setJarred(h, 1000);
  const ps = foodStore(st, h);
  check(ps.outside === 0 && near(ps.stable, 1000, 1e-6) && ps.spoil <= 1.5, `jarred food needs no room and barely spoils (${ps.spoil.toFixed(1)} of 1000 a day)`);
  check(near(edibleFood(h), 1000, 1e-6), "jarred food counts as food");
  // The warning when food goes outside.
  const st2 = W();
  const h2 = hub(st2);
  atBase(st2, h2.id).forEach((s) => { s.role = "rest"; s.conditions = []; });
  setFood(h2, 500, "f_greens"); h2.stock.water = 80;
  for (const l of lotsOf(h2).f_greens) l.left = 1; // a day of shelf left
  basesDaily(st2);
  check(st2.log.some((l) => /stored outside and spoil fast/.test(l.text)), "a log warning when food starts spoiling outside");
  check(food(h2) < 500 - eatPerDay(st2, h2) - 200 * 0.3 && st2.log.some((l) => /food spoiled and was thrown out/.test(l.text)), `the food outside spoiled and was thrown out (${food(h2).toFixed(0)} left)`);
  // Eating: the soonest to spoil first (the fresh), then the jars; jars come back.
  const st3 = W();
  const h3 = hub(st3);
  setFood(h3, 3, "f_potatoes"); setJarred(h3, 20); h3.jarsInUse = 10; h3.stock.jars = 0;
  const left = eatFromStore(h3, 6);
  check(left === 0 && !kindsOf(h3).f_potatoes && near(jarred(h3), 17, 1e-9), `fresh food is eaten first, then the jarred (${food(h3)} left)`);
  check(h3.stock.jars > 0 && h3.stock.jars < 1.5, `eating jarred food gives most of the jars back (${h3.stock.jars.toFixed(2)})`);
  check(eatFromStore(h3, 100) > 0 && jarred(h3) === 0, "what cannot be covered is reported (hunger)");
  // The preserving kitchen: operator, inputs, 8 portions of jarred food a day from fresh food.
  const st4 = W();
  const h4 = hub(st4);
  addBuilding(h4, "kitchen");
  const ppl4 = atBase(st4, h4.id);
  ppl4.forEach((s) => { s.role = "rest"; s.skills.farming = 2; });
  Object.assign(h4.stock, { water: 50, scrap: 10, jars: 12 });
  setFood(h4, 100, "f_potatoes");
  const kit = stations(h4).find((x) => x.type === "kitchen");
  check(!stationStatus(st4, h4, kit).running, "the kitchen needs an operator");
  ppl4[0].role = "operate"; ppl4[0].station = kit.id;
  runStations(st4, h4);
  check(near(jarred(h4), RECIPES.preserve.out.f_jarred, 1e-6) && near(kindsOf(h4).f_potatoes, 100 - RECIPES.preserve.in.fresh, 1e-6) && h4.stock.jars === 12 - RECIPES.preserve.in.jars && h4.stock.water === 50 - RECIPES.preserve.in.water,
    `the kitchen jars fresh food (${RECIPES.preserve.in.fresh} days of fresh food, ${RECIPES.preserve.in.water} water, ${RECIPES.preserve.in.jars} jars → ${jarred(h4)} portions)`);
  check(jarsInUse(h4) === RECIPES.preserve.in.jars, "the filled jars are tracked");
  h4.stock.jars = 0;
  check(/jars/.test(stationStatus(st4, h4, kit).reason), "no jars, no jarring");
  // Drying racks: surplus only.
  const st5 = W();
  const h5 = hub(st5);
  addBuilding(h5, "smoker");
  const eat5 = eatPerDay(st5, h5);
  setFood(h5, eat5 * 10, "f_potatoes");
  check(rackPlan(st5, h5).take === 0, "a drying rack leaves food under 15 days of eating alone");
  setFood(h5, 300, "f_potatoes");
  const rp = rackPlan(st5, h5);
  check(rp.take > 0 && rp.take <= RACK.food && Math.abs(rp.out - rp.take * RACK.out / RACK.food) < 1e-9, `a drying rack dries surplus food (${rp.take} → ${rp.out} days of dried food)`);
  // The food outlook and short rations.
  setFood(h, 400, "f_potatoes"); setJarred(h, 50);
  const o = foodOutlook(st, h);
  check(Number.isFinite(o.daysLeft) && o.eat === eatPerDay(st, h) && near(o.stock, 450, 1e-6) && near(o.fresh, 400, 1e-6) && Array.isArray(o.harvests), "the food outlook has fresh + that keeps, days left, eating and the next harvests");
  const st6 = W();
  const h6 = hub(st6);
  atBase(st6, h6.id).forEach((s) => { s.role = "rest"; s.health = 100; s.conditions = []; });
  setFood(h6, 6); setJarred(h6, 4);
  basesDaily(st6);
  check(h6.rationing && edibleFood(h6) > 10 - eatPerDay(st6, h6) && atBase(st6, h6.id).every((s) => s.health >= 100 || conditionsOf(s).length), `short rations stretch the last food (${edibleFood(h6)} left)`);
}

// 4b. Winter crops: data, climates registered with weather.js, timing, frost survival, dry harvests.
{
  console.log("Winter crops");
  const st = W();
  farmOf(st, hub(st)); // registers the crop climates
  for (const k of ["kale", "winterwheat", "drybeans"]) {
    check(!!CROPS[k] && Weather.cropClimate(k).hardy === CROPS[k].climate.hardy && Weather.cropClimate(k).tMin === CROPS[k].climate.tMin, `${k}: climate registered with weather.js`);
  }
  const autumn = 45, late = 60;
  const kale = cropForecast("kale", false, autumn);
  check(kale.days <= 30 && kale.survival >= 0.8, `kale sown early in autumn (day ${autumn + 1}) ripens before winter and stands the frost (${kale.days} days, ${Math.round(kale.survival * 100)}%)`);
  const ww = cropForecast("winterwheat", false, autumn);
  const gap = hungryGap(st, autumn);
  check(autumn + ww.days > gap.start + 20 && autumn + ww.days <= gap.end + 25 && ww.survival >= 0.5, `winter wheat sown in autumn overwinters and ripens in spring (day ${autumn + ww.days + 1}, ${Math.round(ww.survival * 100)}% survive)`);
  check(plantCheck(st, hub(st), { id: 0, gh: false, stage: "empty" }, "winterwheat").ok === false, "winter wheat cannot be sown in spring");
  const potato = cropForecast("potato", false, late);
  check(potato.survival < 0.2 || !isFinite(potato.days), `potatoes sown in late autumn would not make it (survival ${Math.round(potato.survival * 100)}%)`);
  check(cropForecast("drybeans", false, 14).survival >= 0.6 && CROPS.drybeans.store === "preserved" && CROPS.wheat.store === "preserved", "dry beans ripen from an early summer sowing; dry beans and wheat go to the preserved stock");
  // Real weather: kale and winter wheat on a few seeds (frost survival in the live game).
  let kaleOk = 0, wwOk = 0, wwSpring = 0, n = 0;
  for (let sd = 1; sd <= 6; sd++) {
    const s2 = W(seed + sd);
    const h = hub(s2);
    const f = bareFarm(s2, h);
    atBase(s2, h.id).forEach((s) => { s.role = "farm"; s.conditions = []; });
    setDay(s2, autumn);
    const [pk, pw] = f.plots.filter((x) => !x.gh);
    Object.assign(pk, { stage: "growing", crop: "kale", grown: 0, care: 0, careDays: 0 });
    Object.assign(pw, { stage: "growing", crop: "winterwheat", grown: 0, care: 0, careDays: 0 });
    let kaleRipe = false, wwDay = null;
    for (let i = 0; i < 100; i++) {
      h.stock.water = 80; setFood(h, 200);
      const out = farmingDaily(s2, h, 1);
      if (/Last harvest/.test(pk.note)) kaleRipe = true;
      if (wwDay == null && pw.stage === "empty" && /Last harvest/.test(pw.note)) wwDay = autumn + i;
      nextDay(s2);
    }
    n++;
    if (kaleRipe) kaleOk++;
    if (wwDay != null || pw.stage === "growing") wwOk++;
    if (wwDay != null && wwDay >= gap.end - 40) wwSpring++;
  }
  check(kaleOk >= n - 2, `kale sown in early autumn is harvested on most seeds (${kaleOk}/${n})`);
  check(wwOk >= n / 2 && wwSpring >= 1, `winter wheat survives the winter on most seeds and comes in in spring (${wwOk}/${n} alive or harvested, ${wwSpring} harvested in spring)`);
  // Farmers pick for the season: no tender crops into the first frosts.
  const s3 = W();
  const h3 = hub(s3);
  const f3 = bareFarm(s3, h3);
  setDay(s3, late);
  setFood(h3, 300);
  const pick = bestCrop(s3, h3, f3.plots.find((x) => !x.gh));
  check(!pick || CROPS[pick].climate.hardy >= 0.9, `late autumn: the farmers sow only frost-hardy crops (${pick})`);
}

// 4c. The winter outlook (the governor's plan for the hungry gap).
{
  console.log("Winter outlook");
  const st = W();
  const h = hub(st);
  setDay(st, 50);
  setFood(h, 100); setJarred(h, 0);
  const a = winterOutlook(st, h);
  check([a.need, a.gapNeed, a.have, a.crops, a.spoil, a.end, a.short, a.margin].every(Number.isFinite) && a.gap.start === 70 && a.gap.end > 98, `the outlook is in numbers (need ${a.need}, crops ${a.crops}, short ${a.short}; gap day ${a.gap.start + 1} to ${a.gap.end + 1})`);
  const b = winterOutlook(st, h, { extra: 4 });
  check(b.need > a.need && b.short >= a.short, `more mouths need more (${a.need} → ${b.need})`);
  setFood(h, 0);
  const c = winterOutlook(st, h, { extra: 6 });
  check(c.short > 0 && c.runsOut != null, `an empty store in autumn is short (${c.short}, runs out on day ${c.runsOut + 1})`);
  setJarred(h, 3000);
  check(winterOutlook(st, h).short === 0, "a full granary covers the winter");
  setJarred(h, 0); setFood(h, 100);
  const t0 = foodTarget(st);
  setFood(h, 0);
  check(t0 >= 15 && Number.isFinite(t0), `the governor's food target comes from the outlook in autumn (${t0.toFixed(0)} days)`);
}

// 5. Base scavenging (WORLD-01): 1.5 supplies a day at Scavenging 0 in ruins (site factor 1.2), more with the skill,
// at most SCAV_YIELD_CAP; the trips' rolls, the Work panel's average and the stock agree.
{
  console.log("Base scavenging");
  const st = W();
  const h = hub(st);
  const ppl = atBase(st, h.id);
  ppl.forEach((s) => { plain(s); s.role = "guard"; s.gear.tool = null; s.health = 100; s.skills.scavenging = 0; });
  const s0 = ppl[0];
  s0.role = "scavenge";
  const tt = scavTripTile(st, h), tile = tt ? tt.id : h.tile, site = siteBonus(st, h, tile).scav;
  const y0 = scavYield(st, h, s0, tile);
  check(near(y0 * SCAV_REF / site, BASE_SCAV_YIELD, 1e-9), `baseline: ${BASE_SCAV_YIELD} supplies a day at Scavenging 0 in ruins (here ${r1(y0)} at site factor ${site})`);
  if (site === SCAV_REF) check(near(y0, BASE_SCAV_YIELD, 1e-9), `the hub's ruins give the baseline itself (${r1(y0)})`);
  s0.skills.scavenging = 5;
  const y5 = scavYield(st, h, s0, tile);
  s0.skills.scavenging = 10;
  const y10 = scavYield(st, h, s0, tile);
  check(y5 > y0 && y10 > y5, `the yield grows with Scavenging (0: ${r1(y0)}, 5: ${r1(y5)}, 10: ${r1(y10)})`);
  check(near(y10 / y0, Math.min(SCAV_YIELD_CAP / y0, 1 + 10 * SCAV_SKILL), 1e-9), `Scavenging 10 finds ×${1 + 10 * SCAV_SKILL} (${r1(y10 / y0)})`);
  s0.skills.scavenging = 40; s0.traits = ["greedy"];
  check(near(scavYield(st, h, s0, tile), SCAV_YIELD_CAP, 1e-9), `capped at ${SCAV_YIELD_CAP} a day (${r1(scavYield(st, h, s0, tile))})`);
  s0.traits = []; s0.skills.scavenging = 5;
  // The Work panel's average is the sum of the scavengers' yields by the walk's share of the day.
  const exp = Object.values(scavengeOutput(st, h)).reduce((a, v) => a + v, 0);
  check(near(exp, scavYield(st, h, s0, tile) * (tt ? tt.f : 1), 1e-6), `the panel's average is the yield by the walk (${r1(exp)} a day)`);
  // The trips roll what the panel shows: whole finds, the long-run average within 5%.
  let units = 0, whole = true;
  const N = 3000, share = tt ? tt.f : 1;
  const sv = st.rng;
  for (let i = 0; i < N; i++) {
    const r = scavTrip(st, h, s0, tile, share, i);
    for (const [k, q] of Object.entries(r.got)) { if (k === "buildmat") continue; if (!Number.isInteger(q)) whole = false; units += FOODS[k] ? unitsOf(k, q) : q; }
    if (r.ammo) { if (!Number.isInteger(r.ammo.q)) whole = false; units += r.ammo.q; }
    st.tiles[tile].foodStock = null; // keep the shelves full for the measure (foods.js shopFood)
  }
  st.rng = sv;
  check(whole, "finds come in whole units");
  check(Math.abs(units / N - exp) / exp < 0.05, `the trips' average matches the panel (${(units / N).toFixed(2)} rolled against ${exp.toFixed(2)} expected a day)`);
  // Six scavengers over 60 days: real supplies, the ground picked over.
  ppl.forEach((s) => { s.role = "scavenge"; s.skills.scavenging = 0; });
  // What came in by the Scavenge job's own record (output.js; the stock itself moves with the base's other work).
  const finds0 = econStats(st).scavFinds || 0, seen = new Set();
  let brought = 0;
  setFood(h, 2000); h.stock.water = 80;
  for (let i = 0; i < 60; i++) {
    for (let k = 0; k < 24; k++) tickHour(st);
    for (const r of outputDays(h, "scavenge")) if (!seen.has(r.day) && r.day < day(st)) { seen.add(r.day); for (const [u, n] of Object.entries(r.by)) if (u !== "finds" && u !== "buildmat") brought += n; }
    st.cards.length = 0; h.stock.water = 80; setFood(h, 2000); alive(st).forEach((s) => { s.health = 100; s.mood = 60; });
  }
  const finds = (econStats(st).scavFinds || 0) - finds0;
  check(finds >= 60 && brought >= 150, `six scavengers bring in real supplies in 60 days (${finds} finds, ${Math.round(brought)} supplies)`);
  check(h.scavLeft < 1, `the surroundings get picked over (${h.scavLeft.toFixed(2)} left)`);
}

// 6. Illness and injuries: chances, contagion, work, treatment with meds.
{
  console.log("Illness and injuries");
  // Work accidents: builders get hurt more than people resting.
  const count = (role, days) => {
    const st = W();
    const h = hub(st);
    atBase(st, h.id).forEach((s) => { plain(s); s.role = role; });
    let n = 0;
    for (let i = 0; i < days; i++) {
      h.stock.water = 80; setFood(h, 200); h.stock.meds = 0;
      healthDaily(st);
      for (const l of st.log) { if (l.hour !== st.hour) break; if (/got a (deep cut|sprain)/.test(l.text)) n++; }
      nextDay(st);
      alive(st).forEach((s) => { s.health = 100; s.conditions = []; });
    }
    return n;
  };
  const builders = count("build", 150), resting = count("rest", 150);
  check(builders > resting && builders >= 3, `building brings cuts and sprains (${builders} injuries in 150 days vs ${resting} resting)`);
  // Treatment: a course of doses (health.js SICK.dose: 3 at severity 70), each 1 meds, one a day; the course is set
  // when the first dose is given, and a second dose the same day is refused.
  const st = W();
  const h = hub(st);
  const s = atBase(st, h.id)[1];
  h.stock.meds = 3;
  const c = addCondition(st, s, "pneumonia", "for the test", { sev: 70 });
  check(isSick(s) && workFactor(s) < 0.3, `pneumonia stops work (${workFactor(s)})`);
  const info = treatConditionInfo(st, h, s, "pneumonia");
  check(info.ok && info.course === 3 && info.dose === 1, `severity 70 pneumonia takes a course of 3 doses, the first today (course ${info.course}, dose ${info.dose})`);
  const msg = treatCondition(st, h, s.id, "pneumonia");
  check(h.stock.meds === 3 - CONDITIONS.pneumonia.meds && c.sev < 70 && isSick(s) && c.course === 3 && c.dosed === 1 && !c.mending, `a dose costs ${CONDITIONS.pneumonia.meds} meds, lowers the severity and counts towards the course (${msg})`);
  const again = treatConditionInfo(st, h, s, "pneumonia");
  check(!again.ok && again.treatedToday && /Already had today's dose/.test(again.reason) && /Already had today's dose/.test(treatCondition(st, h, s.id, "pneumonia")) && h.stock.meds === 3 - CONDITIONS.pneumonia.meds && c.dosed === 1, `one dose per condition a day (${again.reason})`);
  h.stock.meds = 0;
  addCondition(st, atBase(st, h.id)[2], "cut", "test", { sev: 30 });
  const dry = treatConditionInfo(st, h, atBase(st, h.id)[2], "cut");
  check(!dry.ok && dry.cost === CONDITIONS.cut.meds && /^No meds: needs 1 \(have 0\)\./.test(dry.reason), `no meds, no dose (${dry.reason})`);
  // Untreated pneumonia costs health.
  const st2 = W();
  const h2 = hub(st2);
  const v = atBase(st2, h2.id)[0];
  h2.stock.meds = 0;
  v.health = 100;
  addCondition(st2, v, "pneumonia", "test", { sev: 70 });
  for (let i = 0; i < 3; i++) { healthDaily(st2); nextDay(st2); }
  check(v.health < 95, `untreated pneumonia hurts (${v.health.toFixed(1)} health after 3 days)`);
  // The sick work less: builders and stations.
  const st3 = W();
  const h3 = hub(st3);
  const ppl3 = atBase(st3, h3.id);
  ppl3.forEach((x) => { x.role = "build"; x.conditions = []; });
  const r0 = buildRate(st3, h3);
  addCondition(st3, ppl3[0], "flu", "test", { sev: 60 });
  check(buildRate(st3, h3) < r0, `a sick builder builds less (${r0.toFixed(2)} → ${buildRate(st3, h3).toFixed(2)})`);
  const stn = stations(h3)[0] || addBuilding(h3, "ammo_bench"); // the hub starts with no station now (a crafting bench)
  if (stn) { ppl3[1].role = "operate"; ppl3[1].station = stn.id; addCondition(st3, ppl3[1], "pneumonia", "test", { sev: 80 }); check(!stationOperator(st3, h3, stn), "someone too sick leaves the station idle"); }
  addBuilding(h3, "infirmary");
  ppl3[2].role = "medic";
  check(patients(st3, h3).some((x) => isSick(x)), "the sick get hospital beds");
  // Contagion at a crowded base.
  const st4 = W();
  const h4 = hub(st4);
  for (let i = 0; i < 8; i++) addPerson(st4, h4, "rest");
  const crowd = residents(st4, h4.id);
  crowd.forEach((x) => (x.conditions = []));
  crowd.slice(0, 3).forEach((x) => addCondition(st4, x, "flu", "test", { sev: 60, quiet: true }));
  h4.stock.meds = 0; h4.autoTreat = false;
  for (let i = 0; i < 8; i++) { h4.stock.water = 80; setFood(h4, 300); healthDaily(st4); nextDay(st4); crowd.forEach((x) => { if (x.alive) x.health = 100; }); }
  const caught = crowd.slice(3).filter((x) => conditionsOf(x).some((c) => c.key === "flu") || /caught/.test(JSON.stringify(x.conditions))).length;
  check(caught >= 1 || st4.log.some((l) => /caught from/.test(l.text)), `flu spreads in a crowded base (${caught} caught it)`);
  check(st4.cards.some((cd) => /^Outbreak at/.test(cd.title)) || caught < 2, "an outbreak brings a card");
  // Automatic treatment uses meds on the sick.
  const st5 = W();
  const h5 = hub(st5);
  h5.stock.meds = 10; h5.medsReserve = 0;
  addCondition(st5, atBase(st5, h5.id)[0], "dysentery", "test", { sev: 60 });
  healthDaily(st5);
  check(h5.stock.meds < 10, `the base treats the sick automatically (meds 10 → ${h5.stock.meds})`);
}

// 7. Fuel is scarce: gas stations, truck stops, airports and military bases are the real sources.
{
  console.log("Fuel");
  const share = (t) => (LOCATIONS[t].loot.fuel || 0) / Object.values(LOCATIONS[t].loot).reduce((a, v) => a + v, 0);
  const sources = ["gas", "truckstop", "airport", "military"];
  // The abandoned Army convoy (miltrucks.js, a temporary road site) is military trucks with their tanks: a fuel source
  // in between, more than anywhere ordinary, less than a military base's motor pool.
  const military = ["convoy"];
  const others = Object.keys(LOCATIONS).filter((t) => !sources.includes(t) && !military.includes(t) && LOCATIONS[t].loot.fuel);
  check(sources.every((t) => share(t) >= 0.2), `fuel stays common at ${sources.join(", ")}`);
  check(military.every((t) => share(t) > Math.max(...others.map(share)) && share(t) <= share("military")), `an Army convoy is between (${military.map((t) => share(t).toFixed(2)).join(", ")})`);
  check(others.every((t) => share(t) <= 0.15), `fuel is a small share elsewhere (auto shops the most) (max ${Math.max(...others.map(share)).toFixed(2)})`);
  const st = W();
  check(hub(st).stock.fuel <= 12, `the hub starts with little fuel (${hub(st).stock.fuel})`);
  check(st.factions.every((f) => f.stock.fuel <= f.pop * 1.01 + 1e-9), "other groups start with little fuel");
}

// 8. Long runs: no NaN, no negative stock, sane crops and conditions; meds and fuel rates.
{
  console.log(`Long runs (${longDays} days)`);
  for (const [sd, style] of [[seed, "balanced"], [seed + 1, null]]) {
    const st = W(sd);
    if (style) setAutopilot(st, true, style);
    let bad = "", personDays = 0;
    const meds0 = st.medsUsed || 0;
    let fuelIn = 0, prevFuel = null, winterLines = 0, top = st.log[0];
    for (let i = 0; i < 24 * longDays && !st.gameOver && !bad; i++) {
      tickHour(st);
      for (const l of st.log) { if (l === top) break; if (/Winter stores at/.test(l.text)) winterLines++; }
      top = st.log[0];
      if (!style) while (st.cards.length) { const c = st.cards.shift(); const ch = c.choices.find((x) => !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled)); if (ch) ch.resolve(st); }
      if (st.hour % 24) continue;
      personDays += alive(st).length;
      for (const b of st.bases) {
        for (const k of SUPPLY_KEYS) if ((b.stock[k] !== undefined || !(ROUND_KEYS.includes(k) || PART_KINDS.includes(k) || RELOAD_SUPPLIES[k] || FOODS[k])) && (!(b.stock[k] >= 0) || !Number.isFinite(b.stock[k]))) bad = `${b.name} ${k} = ${b.stock[k]}`; // rounds by calibre (ammo.js), the part kinds (car, gun parts, electronics: weapons wave) and the food items (sim/foods.js) are kept only where there are some
        for (const p of farmOf(st, b).plots) if (!["empty", "growing", "ripe", "dead"].includes(p.stage) || !Number.isFinite(p.grown) || !Number.isFinite(p.care) || !Number.isFinite(p.yieldLeft)) bad = `bad plot ${JSON.stringify(p)}`;
      }
      for (const s of st.survivors) {
        if (!Number.isFinite(s.health) || !Number.isFinite(s.mood)) bad = `${s.name} health ${s.health}`;
        for (const c of conditionsOf(s)) if (!Number.isFinite(c.sev) || !CONDITIONS[c.key]) bad = `${s.name} condition ${JSON.stringify(c)}`;
      }
      const h = hub(st);
      if (h) { const f = h.stock.fuel; if (prevFuel != null && f > prevFuel) fuelIn += f - prevFuel; prevFuel = f; }
    }
    const es = st.econStats || {};
    const medsPer30 = ((st.medsUsed || 0) - meds0) / Math.max(1, personDays) * 30;
    check(!bad, `${style || "hands-off"} seed ${sd}: ${bad || "no NaN or negative stock"} (${day(st) - 1} days${st.gameOver ? ", fell" : ""})`);
    console.log(`  ${style || "hands-off"} seed ${sd}: day ${day(st) - 1}, alive ${alive(st).length}; harvested ${Math.round(es.harvested || 0)}, seed ${Math.round(es.seed || 0)}, spoiled ${Math.round(es.spoiled || 0)}, eaten ${Math.round(es.eaten || 0)}, crops lost ${es.cropsLost || 0}, thirst days ${es.thirstDays || 0}, hunger days ${es.hungerDays || 0}, base finds ${es.scavFinds || 0}; illness meds ${medsPer30.toFixed(2)} per person per 30 days; hub fuel in ${(fuelIn / Math.max(1, day(st) - 1) * 30).toFixed(1)} per 30 days`);
    if (style) check(medsPer30 > 0.3, `meds are a real ongoing need (${medsPer30.toFixed(2)} per person per 30 days on illness and injuries)`);
    if (style && day(st) > 72) check(winterLines >= 4, `the governor logs the winter stores every week in autumn (${winterLines} lines)`);
    console.log(`    jarred ${Math.round(hub(st) ? jarred(hub(st)) : 0)}, dried on racks ${Math.round(es.dried || 0)}, winter-stores lines ${winterLines}`);
    check((es.harvested || 0) > 0, "crops were harvested");
  }
}

console.log(`\n${passes} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
