// Base screen: Farming tab (crop plots, the food and water outlook, the crop guide) and the short food / water
// lines used by the Bases list and the top bar. Actions are merged into main.js's dispatcher (FARM_ACTIONS,
// FARM_CHANGE).
import { FOODS } from "../sim/foods.js"; // a crop's harvest item
import { foodTip, baseFoodHtml } from "./food.js";
import { cookingCard } from "./cooking.js"; // wave 2 cooking: the stations' bills
import {
  CROPS, CROP_KEYS, farmOf, careToday, expectedYield, daysToRipe, plotWeatherNote, plantCheck, bestCrop, plantPlot,
  harvestPlot, clearPlot, setPlotWant, setAutoReplant, plotLimit, greenhouseLimit, siteFarm, farmers, recentGrowth,
  cropForecast, winterOutlook,
} from "../sim/farming.js";
import { foodOutlook, waterOutlook, RATION, RATION_DAYS, WATER, summerWater, summerWaterOk, summerFixText, SUMMER } from "../sim/economy.js";
import { useText, perHeadText, heatUse, HEAT, woodFor } from "../sim/upkeep.js";
import { SUPPLIES } from "../sim/data.js";
import { woodNeed, baseWoodHint } from "../sim/woodcutting.js";
import { COLD } from "../sim/needs.js";
import { THIRST } from "../sim/weather.js";
import { storeLine } from "../sim/storage.js";
import { baseById, atBase } from "../sim/world.js";
import { count } from "../sim/buildings.js";
import * as Weather from "../sim/weather.js";
import { KITCHEN, hasKitchen, kitchenWood, kitchenCold } from "../sim/kitchen.js"; // the Kitchen's stove: firewood every day
import { baseWater, boilerUse, cropLandBad, WORM, purifyText, baseTabCount, baseCooks } from "../sim/worm.js";
import {
  HUNT_METHODS, METHOD_NAMES, MIX_PRESETS, huntMixOf, setHuntMix, setHuntShare, huntWorkWhy, ammoKeep, hasBow, ARROW, TRAP, HUNT, baseHuntDay,
} from "../sim/hunting.js";
import { ask } from "./confirm.js"; // digging a living crop under asks first (one confirmation style)
import { totalRounds } from "../sim/rounds.js"; // rounds by calibre
import { roundsLine } from "../sim/ammo.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const n1 = (v) => (Math.round((v || 0) * 10) / 10).toString();
const bar = (v, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></div>`;
const days = (d) => (!isFinite(d) ? "∞" : d >= 99 ? "99+" : n0(d));
const SEASON_NAMES = { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" };

// ---------- short lines (Bases list, overview, top bar) ----------
// Upkeep per head × heads (sim/upkeep.js): "6 people × 1.0 = 6.0" for food, the same for water with the day's thirst
// (+ dysentery), and who else eats here (prisoners, guests, a holding convoy's crew, the dog).
export const foodUseText = (o) => useText(o.use);
export function waterUseText(need) {
  const parts = [];
  const g = perHeadText;
  if (need.n) parts.push(g(need.n, need.n === 1 ? "person" : "people", need.rate));
  if (need.sick) parts.push(`dysentery ${n1(need.sick)}`);
  if (need.nPrisoners) parts.push(g(need.nPrisoners, need.nPrisoners === 1 ? "prisoner" : "prisoners", need.rate));
  if (need.nGuests) parts.push(g(need.nGuests, need.nGuests === 1 ? "guest" : "guests", need.rate));
  if (need.nCrew) parts.push(g(need.nCrew, "convoy crew", need.rate));
  if (!parts.length) return "nobody here";
  const drink = need.people + need.prisoners + need.guests;
  return parts.length === 1 ? parts[0] : `${parts.join(" + ")} (${(Math.round(drink * 10) / 10).toFixed(1)})`;
}
export function upkeepLine(state, b) {
  const fo = foodOutlook(state, b);
  const need = waterOutlook(state, b).need;
  const food = foodUseText(fo), water = waterUseText(need);
  const heat = heatUse(state, b); // needs-gauges: heating per head below 0°C (woodcutting.js: firewood first, then fuel)
  const heating = heat.each > 0 ? `Heating: ${heat.text}` : "";
  // The water boiler (sim/worm.js): firewood a head every day the water needs boiling, like heating.
  const boil = count(b, "boiler") ? boilerUse(state, b) : null;
  const boiler = boil && boil.active ? `Water boiler: ${boil.text}${boil.lit ? "" : " (cold today: nothing to burn)"}` : "";
  // The Kitchen's stove (sim/kitchen.js): firewood every day, after the boiler and the heating.
  const kw = hasKitchen(b) ? kitchenWood(state, b) : null;
  const kitchen = kw ? `Kitchen stove: ${Math.round(kw.need * 10) / 10} firewood a day (stove ${kw.stove} + meals ${Math.round(kw.meals * 10) / 10})${kitchenCold(b) ? " (cold today: no firewood to spare)" : ""}` : "";
  const cold = fo.use.cold > 1 ? ` The cold: everyone eats ${Math.round((fo.use.cold - 1) * 100)}% more today.` : "";
  const wn = woodNeed(state, b);
  const woodNote = ` ${n0(b.stock.wood)} firewood and ${n0(b.stock.fuel)} fuel in store${wn.need > 0 && wn.soon ? `; the cold ahead (about ${Math.round(wn.days)} freezing days) needs about ${wn.need} firewood` : ""}.`;
  const heatTip = ` Heating: on a day below 0°C everyone here needs ${HEAT.fuel} fuel's worth of heat a day (×${HEAT.bitter} below ${HEAT.bitterAt}°C). The base burns firewood first (30 firewood, 3 kg, heat as much as ${Math.round(30 * HEAT.wood * 100) / 100} fuel: ${woodFor(HEAT.fuel)} firewood a head), then fuel for what the wood does not cover; a shelter with its camp fire lit needs neither. Without them everyone is cold (mood −${COLD.mood} and health −${COLD.hp} a day, and illness as outdoors). Cut wood on the Work tab (the Cut wood job), send a team to cut it, or trade for it.${heating ? ` Today: ${heat.text}.` : " No heating needed today."}${woodNote}${b.cold ? ` ${b.name} is cold now: it ran short of firewood and fuel.` : ""}`;
  const boilTip = boil ? ` The water boiler burns ${WORM.BOILER_WOOD_HEAD} firewood's worth a head a day in every season (firewood, then the armory's burnable junk while the base allows it, then ${Math.round(WORM.BOILER_WOOD_HEAD * HEAT.wood * 100) / 100} fuel a head), on every day un-purified water would be drunk here (any of it can carry the worm) and no water filter covers it${boil.active ? `: today ${boil.text}${boil.lit ? "" : ", and it is cold: the base could not pay, so the water is unboiled today (purification tablets from the armory if there are no filters)"}` : "; today it stands ready (the filters do the job)"}.` : "";
  const tipText = `What the people fed from ${b.name}'s stores use up a day: a rate per person × the people here. Food ${food}; water ${water}${need.crops ? `, and the crops ${n1(need.crops)} on a dry day` : ""}.${cold}${boilTip} Everyone living here eats 1 food a day (more in the cold; a Quartermaster here cuts it 10%) and drinks 1 water (the season's thirst: ${THIRST.summer} in summer, ${THIRST.winter} in winter, at least ${THIRST.heat} on a hot day; dysentery 1 more). Prisoners, guests you shelter and a supply convoy holding here eat and drink the same from these stores. People away on a team eat the team's packed supplies, not the base's; someone on a personal errand takes a day's food and water a day with them.${heatTip} Spoilage goes by the food stored, generator fuel by the day it runs, wear by the building.`;
  const boilerWood = boil && boil.active ? boil.wood : 0;
  const kitchenWoodDay = kw ? kw.need : 0;
  const kitchenTip = kw ? ` The Kitchen's stove burns ${KITCHEN.wood.stove} firewood a day and ${KITCHEN.wood.meal} a meal served (two a day for everyone fed), after the boiler's and the heating's day: today ${n1(kw.need)}${kitchenCold(b) ? ", and it is cold: no firewood to spare, so the meals are cold" : ""}.` : "";
  return { food, water, heating, boiler, kitchen, kitchenCold: kitchenCold(b), boilerCold: !!boil && boil.active && !boil.lit, cold: !!b.cold, short: `${fo.heads} fed here: food ${n1(fo.eat)} · water ${n1(need.people + need.prisoners + need.guests)}${heat.total > 0 || boilerWood > 0 || kitchenWoodDay > 0 ? ` · firewood ${n0(heat.wood + boilerWood + kitchenWoodDay)}` : ""} a day`, tip: tipText + kitchenTip };
}
export const upkeepCellHtml = (state, b) => { const u = upkeepLine(state, b); return `<div${tip(u.tip)}>${esc(u.short)}<div class="small muted">${esc(`food ${u.food}; water ${u.water}`)}</div>${u.heating ? `<div class="small ${u.cold ? "danger" : "muted"}">${esc(u.heating)}${u.cold ? " · cold: out of firewood and fuel" : ""}</div>` : ""}${u.boiler ? `<div class="small ${u.boilerCold ? "danger" : "muted"}">${esc(u.boiler)}</div>` : ""}${u.kitchen ? `<div class="small ${u.kitchenCold ? "danger" : "muted"}">${esc(u.kitchen)}</div>` : ""}</div>`; };

// Firewood (sim/woodcutting.js) for the top bar and the base panel: days of heating left in the cold, else what is in
// store against what the coming cold needs. { short, cls, tip }.
export function woodLine(state, b) {
  const w = woodNeed(state, b);
  const heat = heatUse(state, b);
  const burning = heat.total > 0;
  const perDay = (burning ? heat.wood : 0) + (w.daily || 0); // heating, the water boiler and the Kitchen's stove
  const short = burning || w.kitchen > 0 ? `${days(w.have / Math.max(0.01, perDay))}d` : w.soon && w.need > 0 ? `${n0(w.have)}/${w.need}` : ""; // days left at today's burn (the Kitchen burns every day)
  const cls = !w.soon || !w.short ? "good" : w.cold || w.toCold <= 14 ? "danger" : "";
  const tipText = `Firewood: the winter's heating. Below 0°C everyone here needs ${woodFor(HEAT.fuel)} firewood a day (${woodFor(HEAT.fuel * HEAT.bitter)} below ${HEAT.bitterAt}°C); fuel covers what the wood does not (30 firewood = ${Math.round(30 * HEAT.wood * 100) / 100} fuel of heat; a firewood is ${SUPPLIES.wood.weight} kg).${burning ? ` Today: ${heat.text}.` : ""}${w.boiler > 0 ? ` The water boiler burns ${n1(w.boiler)} a day.` : ""}${w.kitchen > 0 ? ` The Kitchen's stove burns ${n1(w.kitchen)} a day (${KITCHEN.wood.keepDays} days of it wanted in store).` : ""}${w.daily > 0 && w.have > 0 ? ` At ${n1(perDay)} a day it lasts about ${days(w.have / Math.max(0.01, perDay))} days.` : ""}${w.need > 0 ? ` The cold ahead: about ${Math.round(w.days)} freezing days for ${w.heads} ${w.heads === 1 ? "person" : "people"}, about ${w.need} firewood with a fifth to spare (${n0(w.have)} in store${w.short ? `, ${Math.ceil(w.need - w.have)} short` : ""}).` : ""} ${baseWoodHint(state, b)[0].toUpperCase()}${baseWoodHint(state, b).slice(1)}: put people on Cut wood (Work tab), send a team to cut wood (team panel, Land), or trade for it. Cut it in late summer and autumn.`;
  return { short, cls, tip: tipText };
}

// Food: the forecast line that replaces "food per day".
export function foodLine(state, b) {
  const o = foodOutlook(state, b);
  const sl = storeLine(state, b);
  const next = o.harvests[0];
  const text = `${n0(o.stock)} days of food in store (${n0(o.fresh)} fresh + ${n0(o.stable)} that keeps) · eaten ${foodUseText(o)} a day · will spoil ${n1(o.spoil)}/day${o.used > 0.05 ? ` · workshops ${n1(o.used)}/day` : ""} · ${days(o.daysLeft)} days left without harvests`;
  const nextText = next ? `next harvest: ${next.name} in ${next.inDays} day${next.inDays === 1 ? "" : "s"} (~${n0(next.food)} days of food)` : "nothing growing";
  const why = `Crops do not give food every day: each plot is harvested once, when it ripens (Farming tab). ${text}. ${sl.short.charAt(0).toUpperCase() + sl.short.slice(1)}. Expected from the plots over the next 30 days: about ${n1(o.farm)} a day. ${nextText}.${b.rationing ? ` On short rations (${Math.round(RATION * 100)}%): under ${RATION_DAYS} days of food.` : ""}${o.store.outside >= 1 ? " The food rooms are full: fresh food stored outside spoils faster." : ""} Loot brought home by teams and convoys comes on top. ${sl.tip}`;
  const cls = o.daysLeft < 7 || o.store.outside >= 1 ? "danger" : o.daysLeft < 20 ? "" : "good";
  return { cls, short: `${days(o.daysLeft)}d · ${next ? `${next.name} in ${next.inDays}d` : "no crops"}`, text: `${text}; ${nextText}`, tip: why };
}
export const foodCellHtml = (state, b) => { const f = foodLine(state, b); return `<div class="${f.cls}"${tip(f.tip)}>${esc(f.short)}</div>`; };
// Food storage for the base panel: "in cellar 180/200, outside 40 (spoiling 2.3/day)" and the preserved stock.
export const storeCellHtml = (state, b) => { const sl = storeLine(state, b); return `<div class="${sl.cls}"${tip(sl.tip)}>${esc(sl.short)}<div class="small muted">${esc(sl.pres)}</div></div>`; };

// The winter outlook (farming.js winterOutlook), one line: food to reach the first spring harvest against what
// is in store and in the ground.
export function winterLine(state, b) {
  const w = winterOutlook(state, b);
  const firstHarvest = w.gap.end + 1;
  const tipText = `Planning figure for ${b.name}: from today to the first spring harvest (around day ${firstHarvest}; winter starts on day ${w.gap.start + 1}) the ${w.people} here eat about ${w.need} (more in the cold) and about ${w.spoil} spoils on the way. In store: ${w.have}. The crops in the ground (and one more sowing of the free plots) should bring about ${w.crops}, by the usual weather and the chance they survive. Seed for the spring sowing: ${w.seed}. ${w.short > 0 ? `Short by about ${w.short}${w.runsOut != null ? `: the food runs out around day ${w.runsOut + 1}` : ""}.` : `About ${Math.max(0, w.end)} to spare.`} Loot, trade and crops sown later come on top. Keep the winter stock in a cellar (or preserve it): food stored outside spoils fast.`;
  const text = w.short > 0 ? `short by ~${w.short} (runs out ~day ${(w.runsOut ?? w.gap.end) + 1})` : `enough (~${Math.max(0, w.end)} to spare)`;
  return { w, text: `${text} · need ~${w.need} to day ${firstHarvest}`, tip: tipText, cls: w.short > 0 ? "danger" : "good" };
}

export function waterLine(state, b) {
  const o = waterOutlook(state, b);
  const p = o.prod;
  const ins = [`well ${n1(p.own)}`, p.stream ? `stream ${n1(p.stream)}` : "", p.wells ? `wells ${n1(p.wells)}` : "", p.rain ? `rain ${n1(p.rain)}` : "", p.hauled ? `hauled ${n1(p.hauled)}` : "", p.filters ? `filters ${p.filters}` : ""].filter(Boolean).join(", ");
  // Wells dug on your claims next to the base (sim/claims.js): each with its yield and what is left, hauled by the base's people.
  const cw = (p.claimWells || []).length ? ` Wells on your claims next to ${b.name}: ${p.claimWells.map((o) => `(${state.tiles[o.tile].x},${state.tiles[o.tile].y}) ${o.well.left <= 0 ? "dry" : `${o.rate}/day, ${Math.round(o.well.left)} left`}${o.counted || o.well.left <= 0 ? "" : " (nobody free to haul: one well per 4 people here)"}`).join("; ")}.` : "";
  const why = `In: ${ins} (${n1(o.inflow)}/day; the well and rain only fill up to the capacity of ${o.cap}). Out: ${waterUseText(o.need)} (${drinkNote(o.need)}), crops ${n1(o.need.crops)} (none on a rainy day${o.need.season === "summer" ? ", a fifth more in summer" : ""})${o.need.animals ? `, the animal pens ${n1(o.need.animals)}` : ""}. On a dry day the balance is ${o.dryNet >= 0 ? "+" : ""}${n1(o.dryNet)}. People drink 1 a day in spring and autumn, ${THIRST.summer} in summer, ${THIRST.winter} in winter and at least ${THIRST.heat} on a hot day. A base that runs dry goes thirsty: everyone loses health every day and nobody heals. Wells, rain catchers and cisterns (Construction) help; a water filter adds ${WATER.filter} a day and cuts dysentery.`;
  // Purified and un-purified water (sim/water.js, sim/worm.js purifyDaily): what comes in from the land is un-purified;
  // the boiler, the filters and a shelter's fire purify it each day before people drink, purified water first.
  const pu = purifyText(state, b);
  const tabs = baseTabCount(state, b);
  const purify = ` Purified ${n0(o.pure)}, un-purified ${n0(o.raw)} (the wells, springs, streams, rain catchers and hauled water come in un-purified). Purified a day: ${pu.total > 0 ? `${n1(pu.total)} (${pu.text})` : "none (no water boiler lit, no water filter, no fire)"}; people drink purified water first, then un-purified water (any of it can carry the worm, more on infected ground, and turn the stomach); crops get un-purified water first. The tanks hold both together.${tabs ? ` Purification tablets here (${tabs}): kept for the road (a team leaving packs a tube); the base uses them only when the boiler is cold for want of firewood and fuel and there is no water filter.` : ""}`;
  // The worm (sim/worm.js): any un-purified water can carry it (more from infected ground) unless it is boiled or filtered.
  const ww = baseWater(state, b);
  const worm = ww.drawn ? ` The worm: ${ww.raw > 0 ? "this ground and its water carry the worm's eggs" : "even on clean ground un-purified water can carry the worm"}, and the water here is ${ww.safe ? `safe (${ww.why})` : `not safe (${ww.why}): build a water boiler or keep water filters here (each purifies ${WORM.PURIFY_FILTER} a day)`}.` : "";
  const cls = o.daysLeft < 5 || !ww.safe ? "danger" : o.net < 0 ? "" : "good";
  return { cls, short: `${o.net >= 0 ? "+" : ""}${n1(o.net)}/day · ${n0(o.stock)}/${o.cap}${o.raw >= 1 ? ` (${n0(o.raw)} raw)` : ""}${pu.total > 0 ? ` · purify ${n0(pu.total)}/day` : ""}${isFinite(o.daysLeft) ? ` · ${days(o.daysLeft)}d left` : ""}${ww.safe ? "" : " · un-purified (the worm)"}${tabs ? " · tablets: for the road (and a no-firewood emergency)" : ""}`, tip: why + purify + cw + worm };
}
const drinkNote = (need) => {
  const pct = Math.round((need.rate - 1) * 100);
  const why = need.hot ? "a hot day" : need.season;
  return pct > 0 ? `${need.rate} each: ${why}, everyone drinks ${pct}% more` : pct < 0 ? `${need.rate} each: ${why}, everyone drinks ${-pct}% less` : "1 each";
};
// The summer water outlook (economy.summerWater) for the Farming tab: from spring on, whether the water holds through
// summer (average summer days and a heat-wave stretch) and what would close a gap.
export function summerLine(state, b) {
  const sw = summerWater(state, b);
  const ok = summerWaterOk(sw);
  const pct = (f) => Math.round((f - 1) * 100);
  const fixText = summerFixText(sw.fix);
  const text = ok ? `holds (+${n1(sw.net)}/day; heat wave ${sw.heatNet >= 0 ? "+" : ""}${n1(sw.heatNet)})` : sw.net < 0 ? `short by ~${n1(sw.short)}/day${fixText ? ` · build ${fixText}` : ""}` : `heat waves: ${n1(-sw.heatNet)}/day short, needs ${sw.reserve} stored (room ${sw.cap})${fixText ? ` · build ${fixText}` : ""}`;
  const tipText = `Summer: everyone drinks ${pct(sw.rate)}% more water (${sw.rate} each a day), ${pct(sw.heatRate)}% more in a heat wave (${sw.heatRate}); crops need a fifth more on dry days; wells and springs give about 90% on an average summer day and 60% in a dry spell. For ${sw.n} people here and the crops (~${n1(sw.crops)}): about ${n1(sw.need)} a day against ${n1(sw.inflow)} coming in on an average summer day (${sw.net >= 0 ? "+" : ""}${n1(sw.net)}); in a heat wave ${n1(sw.heatNeed)} against ${n1(sw.heatIn)} (${sw.heatNet >= 0 ? "+" : ""}${n1(sw.heatNet)}). Heat waves last up to ${SUMMER.heatStretch} days: ${sw.reserve ? `that takes about ${sw.reserve} water in store (room for ${sw.cap})` : "the sources keep up"}. ${fixText ? `To close the gap: ${fixText}.` : ""} A week before summer the holdout warns any base whose water will not hold.`;
  return { sw, ok, text, tip: tipText, cls: ok ? "good" : "danger" };
}
// The season's (or a hot day's) drinking under the numbers: "Summer: everyone drinks 30% more".
export function thirstNoteText(state) {
  const f = Weather.thirstFactor ? Weather.thirstFactor(state) : 1;
  if (Math.abs(f - 1) < 1e-9) return "";
  const w = Weather.weather(state);
  const hot = w.key === "heat" || w.hi >= 30;
  return `${hot ? "A hot day" : Weather.season(state).name}: everyone drinks ${f > 1 ? `${Math.round((f - 1) * 100)}% more` : `${Math.round((1 - f) * 100)}% less`}`;
}
export const waterCellHtml = (state, b) => { const w = waterLine(state, b); const note = thirstNoteText(state); return `<div class="${w.cls}"${tip(w.tip)}>${esc(w.short)}${note ? `<div class="small muted">${esc(note)}</div>` : ""}</div>`; };

// Days left for the top bar's tooltip.
export function hubSupplyTip(state, b, key) {
  if (key === "food") return foodLine(state, b).tip;
  if (key === "water") return waterLine(state, b).tip;
  return "";
}

// ---------- the Farming tab ----------
const STAGE = { empty: "Empty", growing: "Growing", ripe: "Ripe", dead: "Dead" };

function cropOptions(selected, gh, state, b, p) {
  return `<option value="">Farmers pick</option>` + CROP_KEYS.map((k) => {
    const chk = plantCheck(state, b, { ...p, stage: "empty" }, k);
    return `<option value="${k}" ${selected === k ? "selected" : ""}>${esc(CROPS[k].name)}${chk.ok ? "" : " (not now)"}</option>`;
  }).join("");
}

const baseCooksHere = (b) => baseCooks(b); // sim/worm.js: a cook fire, a preserving room, a lit Kitchen
export function baseFarming(state, b) {
  const f = farmOf(state, b);
  const care = careToday(state, b);
  const fo = foodOutlook(state, b);
  const wo = waterOutlook(state, b);
  const s = Weather.season ? Weather.season(state) : null;
  const wx = Weather.weatherSummary ? Weather.weatherSummary(state) : "";
  const wxTip = Weather.weatherReport ? Weather.weatherReport(state) : "";
  const workers = farmers(state, b);
  const anyFarmer = workers.length > 0;
  const rows = f.plots.map((p) => {
    const c = p.crop ? CROPS[p.crop] : null;
    const pct = c ? Math.min(100, (p.grown / c.days) * 100) : 0;
    const exp = c ? (p.stage === "ripe" ? p.yieldLeft : expectedYield(state, b, p, care.care)) : 0;
    const note = plotWeatherNote(state, b, p);
    const warn = /risk|short|out of season|not growing|left to harvest/.test(note);
    const pick = p.want || (p.stage === "empty" || p.stage === "dead" ? bestCrop(state, b, p) : null);
    const chk = pick ? plantCheck(state, b, { ...p, stage: "empty" }, pick) : { ok: false, reason: "Nothing would ripen before its season ends" };
    const plantable = p.stage === "empty" || p.stage === "dead";
    const actions = [
      plantable ? `<button class="mini" data-action="farm-plant" data-base="${b.id}" data-plot="${p.id}" ${anyFarmer && chk.ok && p.stage === "empty" ? "" : "disabled"}${tip(!anyFarmer ? "Nobody is on the Farm role here." : p.stage === "dead" ? "Clear the dead crop first." : chk.ok ? `Sow ${CROPS[pick].name.toLowerCase()} now (${CROPS[pick].seed} days of food as seed).` : chk.reason)}>Plant${pick && chk.ok ? ` ${esc(CROPS[pick].name)}` : ""}</button>` : "",
      p.stage === "ripe" ? `<button class="mini" data-action="farm-harvest" data-base="${b.id}" data-plot="${p.id}" ${anyFarmer ? "" : "disabled"}${tip(anyFarmer ? `Bring in about ${n0(p.yieldLeft)} food now. Farmers harvest ripe plots by themselves each day too (3 plots per farmer).` : "Nobody is on the Farm role here.")}>Harvest</button>` : "",
      p.stage !== "empty" ? `<button class="mini" data-action="farm-clear" data-base="${b.id}" data-plot="${p.id}"${tip(p.stage === "dead" ? "Dig the dead crop under so the plot can be sown again." : "Dig this crop under (it is lost).")}>Clear</button>` : "",
    ].join(" ");
    return `<tr>
      <td>${p.id}${p.gh ? ` <span class="chip on"${tip("Greenhouse plot: grows in every season and the weather rarely harms it")}>glass</span>` : ""}</td>
      <td${tip(c ? c.desc : "")}>${c ? esc(c.name) : "<span class='muted'>—</span>"}</td>
      <td style="min-width:7rem">${STAGE[p.stage]}${c && p.stage === "growing" ? bar(pct, "var(--good)") : ""}${p.note && p.stage !== "growing" ? `<div class="small muted">${esc(p.note)}</div>` : ""}</td>
      <td>${p.stage === "growing" ? `~${daysToRipe(p)}d` : p.stage === "ripe" ? "ready" : "—"}</td>
      <td>${c && (p.stage === "growing" || p.stage === "ripe") ? `~${n0(exp)}` : "—"}</td>
      <td class="small ${warn ? "danger" : "muted"}">${esc(note || (p.stage === "empty" ? "" : ""))}</td>
      <td><select data-action="farm-want" data-base="${b.id}" data-plot="${p.id}"${tip("What to sow on this plot next. 'Farmers pick' chooses the best crop for the season.")}>${cropOptions(p.want, p.gh, state, b, p)}</select></td>
      <td>${actions}</td>
    </tr>`;
  }).join("");
  const harvests = fo.harvests.slice(0, 4).map((h) => `${esc(h.name)} in ${h.inDays}d (~${n0(h.food)})`).join(", ");
  const sl = storeLine(state, b);
  const wl = winterLine(state, b);
  const today = Math.floor(state.hour / 24);
  const guide = CROP_KEYS.map((k) => {
    const c = CROPS[k], cl = c.climate;
    const g = recentGrowth(state, k, false);
    const fc = cropForecast(k, false, today);
    const sowable = cl.seasons.includes(s ? s.key : "summer") && (!c.sowIn || c.sowIn.includes(s ? s.key : "summer"));
    const sow = !sowable ? "<span class='muted'>not now</span>" : isFinite(fc.days) ? `<span class="${fc.survival < 0.5 ? "danger" : ""}">~${fc.days}d, ${Math.round(fc.survival * 100)}%</span>` : "<span class='muted'>won't ripen</span>";
    return `<tr${tip(c.desc)}><td><b>${esc(c.name)}</b></td><td>${c.days}</td><td>${c.yield}</td><td>${c.seed}</td><td>${c.water}</td><td class="small">${cl.seasons.map((x) => SEASON_NAMES[x]).join(", ")}${c.sowIn ? ` <span class="muted">(sow in ${c.sowIn.map((x) => SEASON_NAMES[x].toLowerCase()).join(", ")})</span>` : ""}</td>
      <td>${Math.round(cl.hardy * 100)}%</td><td>${Math.round((1 - cl.thirst) * 100)}%</td><td>${Math.round(c.heatTol * 100)}%</td><td>${c.spoil}d</td><td${tip(FOODS[c.item] ? foodTip(c.item) : "")}>${FOODS[c.item] ? `${FOODS[c.item].icon} ${esc(FOODS[c.item].name)}` : "—"}</td><td>${Math.round(g * 100)}%</td><td class="small">${sow}</td></tr>`;
  }).join("");
  return `<div class="grid2">
    <div>
      <h3>Outlook</h3>
      <div class="kv small">
        <div${tip(wxTip)}>Season</div><div${tip(wxTip)}>${esc(wx || (s ? s.name : ""))}</div>
        <div${tip("Days of food in store (2000 kcal a day), every kind together: fresh food (needs a cold room) and food that keeps (cans, dry goods, rations, preserved)")}>Food in store</div><div class="${fo.daysLeft < 7 ? "danger" : ""}">${n0(fo.stock)} days <span class="muted">(${n0(fo.fresh)} fresh + ${n0(fo.stable)} keeps)</span>${b.rationing ? " · <b>short rations</b>" : ""}</div>
        <div${tip(sl.tip)}>Storage</div><div class="${sl.cls}"${tip(sl.tip)}>${esc(sl.short)}<div class="small muted">${esc(sl.pres)}</div></div>
        <div${tip("What everyone fed from these stores eats a day: a ration a person × the people here (more in the cold; prisoners, guests and a holding convoy's crew eat here too). People away on a team eat the team's supplies.")}>Eaten</div><div>${esc(foodUseText(fo))} a day</div>
        <div${tip(`Food that will spoil before it is eaten at today's rate (the soonest to spoil is eaten first), a day over the next month. ${sl.tip}`)}>Spoiling</div><div class="${fo.store.outside >= 1 ? "danger" : ""}">${n1(fo.spoil)} a day${fo.store.outside >= 1 ? ` (${n0(fo.store.outside)} days of fresh food outside)` : ""}</div>
        <div${tip("Days the stock lasts at today's rate, with no harvests and no loot")}>Days of food</div><div class="${fo.daysLeft < 7 ? "danger" : fo.daysLeft < 20 ? "" : "good"}">${days(fo.daysLeft)}</div>
        <div>Next harvests</div><div>${harvests || "<span class='muted'>nothing growing</span>"}</div>
        <div${tip(wl.tip)}>Winter outlook</div><div class="${wl.cls}"${tip(wl.tip)}>${esc(wl.text)}</div>
        <div${tip(waterLine(state, b).tip)}>Water</div><div class="${waterLine(state, b).cls}">${esc(waterLine(state, b).short)}${thirstNoteText(state) ? `<div class="small muted">${esc(thirstNoteText(state))}</div>` : ""}</div>
        ${s && s.key !== "autumn" && s.key !== "winter" ? (() => { const su = summerLine(state, b); return `<div${tip(su.tip)}>Summer water</div><div class="${su.cls}"${tip(su.tip)}>${esc(su.text)}</div>`; })() : ""}
      </div>
      <h3>Farmers</h3>
      <div class="card small">
        ${workers.length ? workers.map((x) => esc(x.name.split(" ")[0])).join(", ") : "<span class='danger'>Nobody on the Farm role: nothing is tended, planted or harvested (ripe crops rot).</span>"}
        <div class="kv" style="margin-top:0.3rem">
          <div${tip("Farmers (by how much they can work) per planted plot. More hands give a bigger harvest from the same days, with diminishing returns: 0.5 per plot about 1.0, 1 per plot 1.23, 2 per plot 1.4.")}>Tending</div><div>${n1(care.perPlot)} per plot → ×${n1(care.tend)}</div>
          <div${tip("Average Farming of the farmers who tend (one per planted plot): Farming 0 ×0.75, 7 ×1.0, 20 ×1.45")}>Skill</div><div>Farming ${n1(care.avgSkill)} → ×${n1(care.skill)}</div>
          <div${tip("Farmland 1.3, forest 0.9, hills 0.85, elsewhere 1")}>Ground</div><div>×${siteFarm(state, b)}${cropLandBad(state, b.tile) ? ` <span class="danger"${tip(`The worm (Help: The dead and the worm): this ground is at ${Math.round((state.tiles[b.tile].infection || 0) * 100)}% infection, ${Math.round(WORM.CROP_MIN * 100)}% or more, so the fresh crops grown here (and anything foraged on land like it) carry its eggs: ${WORM.CROP * 100}% a ration eaten raw (forage ${WORM.FORAGE * 100}%). A cook fire, a preserving room or a lit Kitchen boils everything the base eats; without one that food waits in the stores and is eaten last, raw. Dry crops (grain, dry beans) are threshed and cooked: safe.`)}>infected: the crops carry the worm's eggs${baseCooksHere(b) ? " (boiled here)" : " (build a cook fire)"}</span>` : ""}</div>
          <div>Plots</div><div>${plotLimit(b)} outdoor${greenhouseLimit(b) ? ` + ${greenhouseLimit(b)} under glass` : ""} · ${f.plots.filter((p) => p.stage === "growing").length} growing</div>
        </div>
        <label style="display:block;margin-top:0.35rem"${tip("Farmers sow free plots by themselves (the crop picked for the plot, or the best one for the season) and clear dead ones. Off: only what you sow.")}><input type="checkbox" data-action="farm-auto" data-base="${b.id}" ${f.auto ? "checked" : ""}> Replant automatically</label>
      </div>
      <h3${tip("Food by kind: how much, the days before the soonest of it spoils where it is kept today, and the food rooms")}>Food in store</h3>
      <div class="card">${baseFoodHtml(state, b, { max: 24 })}</div>
      ${cookingCard(state, b)}
      ${huntingCard(state, b)}
    </div>
    <div>
      <h3>How farming works</h3>
      <div class="small muted">A crop takes days to ripen (slower in cold or dry weather, not at all out of season) and is harvested in one go. Seed costs a little food. Frost, storms, drought and heat can kill a standing crop; wet weather rots a ripe one, and a ripe crop not harvested within its window is lost. Growing crops need watering on dry days (people drink first). More plots: Farm plot (+2), Greenhouse (+2 under glass, grows in winter).</div>
      <div class="small muted" style="margin-top:0.35rem"><b>Winter:</b> nothing grows outdoors in winter and the first spring harvest comes weeks into spring, so the food for the hungry gap has to be grown and stored before it. Sow kale, winter roots and winter wheat in autumn (they stand the frost); wheat, winter wheat and dry beans are threshed or dried: grain and dry beans keep for years. Every harvest is a food of its own with its own shelf life (greens days, potatoes and roots months in a cellar): fresh food fills the coldest food room first and spoils faster once it is stored outside: build root cellars, a storehouse or a cold store, and preserve the surplus (Preserving room with jars, Drying racks).</div>
    </div>
  </div>
  <h3>Plots</h3>
  <table class="t"><tr><th>#</th><th>Crop</th><th>Stage</th><th>Ripe in</th><th${tip("Food at harvest from the care so far (farmers, skill, ground)")}>Yield</th><th>Weather</th><th>Next crop</th><th></th></tr>${rows}</table>
  <h3>Crop guide</h3>
  <table class="t small"><tr><th>Crop</th><th${tip("Growing days at full growth")}>Days</th><th${tip("Food per plot at care ×1")}>Yield</th><th>Seed</th><th${tip("Water per plot on a dry day")}>Water</th><th>Seasons</th><th>Frost</th><th>Drought</th><th>Heat</th><th${tip("Days a ripe crop keeps in the field")}>Keeps</th><th${tip("What the harvest is (a food item): its shelf life sets where it keeps (grain and dry beans keep years in any dry corner; greens days; potatoes, squash and roots a month or two, months in a root cellar)")}>Harvest</th><th${tip("Growth over the last week outdoors")}>Growth</th><th${tip("Sown outdoors today: about how many days until it is ripe and the chance it lives that long, by the usual weather for the time of year (frost, storms, heat)")}>Sow now</th></tr>${guide}</table>`;
}

// ---------- hunting (sim/hunting.js) ----------
// The base's hunting mix: the share of the hunting hours with traps, bows and guns, for the Hunt job's hunters at the
// hunting cabin and for the teams that hunt from here. A drop-down per method (the other two share the rest), the
// presets, what the hunters have to shoot with, and yesterday's hunt.
const MIX_TIPS = {
  traps: `Snares and deadfalls: small game only. Silent: no Heat, no noise, no ammo or arrows. At the cabin a trap hour is a third of a day on two snare lines (about half a rifle's food); on a team's hunt ${Math.round(TRAP.field * 100)}% of that, + ${Math.round(TRAP.hand * 100)}% a hand past the first (about a third).`,
  bows: `Bows and crossbows with arrows: nearly a rifle's food (a compound bow about 90%), silent: no Heat, no noise. A shot at game loses its arrow ${Math.round(ARROW.lost * 100)}% of the time (about 0.6 arrows a kill). Without a bow or arrows those hours go to the traps.`,
  guns: `Each hunter's best weapon (a rifle first; a bow if that is all they have): the most food. Every shot uses 1 round of the gun's calibre (never the walls' last 3 a head + 10), adds Heat to the base (a rifle +1 a kill) or to a team (+${HUNT.shotHeat} a shot), and each wandering horde within ${HUNT.drawRange} tiles of the hunting ground turns toward the shots ${Math.round(HUNT.drawChance * 100)}% of the time. Without a gun or ammo those hours go to the bows, then the traps.`,
};
function huntingCard(state, b) {
  const mix = huntMixOf(b);
  const people = atBase(state, b.id);
  const hunters = people.filter((s) => s.role === "hunt");
  const why = huntWorkWhy(state, b);
  const spare = Math.max(0, totalRounds(b.stock) - ammoKeep(state, b)); // every round (sim/rounds.js); a gun hunts with its own calibre
  const bows = people.filter((s) => hasBow([s]));
  const opts = (k) => Array.from({ length: 11 }, (_, i) => i * 10).map((v) => `<option value="${v}" ${mix[k] === v ? "selected" : ""}>${v}%</option>`).join("");
  const sel = HUNT_METHODS.map((k) => `<label class="wcf"${tip(MIX_TIPS[k])}>${METHOD_NAMES[k]} <select data-action="hunt-share" data-base="${b.id}" data-k="${k}">${opts(k)}</select></label>`).join(" ");
  const presets = Object.entries(MIX_PRESETS).map(([k, p]) => `<button class="mini${mix.traps === p.mix.traps && mix.bows === p.mix.bows && mix.guns === p.mix.guns ? " active" : ""}" data-action="hunt-preset" data-base="${b.id}" data-preset="${k}"${tip(`${p.name}: traps ${p.mix.traps}%, bows ${p.mix.bows}%, guns ${p.mix.guns}%. ${p.desc}`)}>${esc(p.name)}</button>`).join(" ");
  const last = b.huntLast && b.huntLast.day >= Math.floor(state.hour / 24) - 1 ? b.huntLast : null;
  const lastText = last ? `${n1(last.rations)} food; ${HUNT_METHODS.filter((k) => last.hrs[k]).map((k) => `${METHOD_NAMES[k].toLowerCase()} ${last.hrs[k]}h`).join(", ") || "no hours"}${last.shots ? ` · ${last.shots} shot${last.shots === 1 ? "" : "s"} (Heat +${n1(last.noise)})` : " · not a shot fired"}${last.arrows ? ` · ${last.arrows} arrow${last.arrows === 1 ? "" : "s"} lost` : ""}${last.trapped ? ` · traps ${last.trapped} small game` : ""}${last.drawn ? ` · <span class="danger">${last.drawn} horde${last.drawn === 1 ? "" : "s"} drawn by the shots</span>` : ""}` : "";
  const day = baseHuntDay(state, b);
  return `<h3${tip("How this base hunts: the share of the hunting hours with traps, bows and guns, for the people on the Hunt job (its hunting grounds: the tiles next to it, within 2 tiles with a Hunting cabin) and for the teams that hunt from here (their hours in turn by the same shares). Guns bring the most food but use ammo, add Heat and can draw the dead; bows are silent but lose arrows; traps are silent and catch the least.")}>Hunting</h3>
      <div class="card small">
        <div>${why ? `<span class="muted">${esc(`The Hunt job: ${why}.`)}</span>` : hunters.length ? `On the Hunt job: ${hunters.map((s) => esc(s.name.split(" ")[0])).join(", ")}${day > 0 ? ` <span class="muted">(~${n1(day)} food a day each by this mix, an average hunter on the best ground)</span>` : ""}` : `<span class="muted">Nobody on the Hunt job.</span>`}</div>
        <div class="row" style="margin-top:0.35rem">${sel}</div>
        <div class="row" style="margin-top:0.3rem">${presets}</div>
        <div class="kv" style="margin-top:0.3rem">
          <div${tip(`Ammo the hunters may use: the stock less the walls' keep (3 a person here + 10).`)}>Ammo</div><div${tip(roundsLine(b.stock))}>${n0(totalRounds(b.stock))} <span class="muted">(${n0(spare)} above the walls' keep)</span></div>
          <div${tip("Arrows and crossbow bolts for hunting (Crafting: 12 from 30 firewood and 1 scrap; found at hunting lodges, gun stores, sports shops and campgrounds). A hunting team with a bow takes up to 12 along.")}>Arrows</div><div>${n0(b.stock.arrows)}${bows.length ? ` <span class="muted">(${bows.length} with a bow or crossbow)</span>` : ` <span class="muted">(nobody here carries a bow)</span>`}</div>
          ${last ? `<div>Yesterday</div><div>${lastText}</div>` : ""}
        </div>
        ${mix.bows > 0 && (!bows.length || (b.stock.arrows || 0) < 1) ? `<div class="small warn" style="margin-top:0.3rem">${bows.length ? "No arrows" : "Nobody here carries a bow or crossbow"}: the bow hours go to the traps.</div>` : ""}
      </div>`;
}

// ---------- actions ----------
const baseOf = (state, d) => baseById(state, Number(d.base));
export const FARM_ACTIONS = {
  "farm-plant": (state, ui, d) => {
    const b = baseOf(state, d);
    if (!b) return;
    const p = farmOf(state, b).plots.find((x) => x.id === Number(d.plot));
    const crop = p && (p.want || bestCrop(state, b, p));
    ui.baseMsg = crop ? plantPlot(state, b, Number(d.plot), crop) : "Nothing would ripen there before its season ends.";
  },
  "farm-harvest": (state, ui, d) => { const b = baseOf(state, d); if (b) ui.baseMsg = harvestPlot(state, b, Number(d.plot)); },
  "farm-clear": (state, ui, d) => {
    const b = baseOf(state, d), plot = b ? (farmOf(state, b).plots || []).find((x) => x.id === Number(d.plot)) : null;
    if (!b) return;
    if (plot && plot.stage !== "dead" && plot.stage !== "empty" && ask(ui, d, "farm-clear", { kind: "clearcrop", title: `Dig under the ${plot.crop && CROPS[plot.crop] ? CROPS[plot.crop].name.toLowerCase() : "crop"} on plot ${plot.id}?`, text: `The crop is lost${plot.stage === "ripe" ? " (it is ripe: Harvest brings it in instead)" : ""}, and the seed with it. The plot is free to sow again.`, yes: "Dig it under" })) return;
    ui.baseMsg = clearPlot(state, b, Number(d.plot));
  },
  "farm-auto": (state, ui, d) => { const b = baseOf(state, d); if (b) ui.baseMsg = setAutoReplant(state, b, !farmOf(state, b).auto); },
  "hunt-preset": (state, ui, d) => { const b = baseOf(state, d); const p = MIX_PRESETS[d.preset]; if (b && p) ui.baseMsg = setHuntMix(b, p.mix); },
};
// Change events (selects).
export const FARM_CHANGE = {
  "farm-want": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b) ui.baseMsg = setPlotWant(state, b, Number(el.dataset.plot), el.value); },
  "hunt-share": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b) ui.baseMsg = setHuntShare(b, el.dataset.k, Number(el.value)); },
};
