// @ts-check
// The power grid's rules (2026-10-21, the user's request in data-power.js; the numbers are there). power.js keeps the
// supply and the demand (the generators, found ones too: isGen / genDef; the users and the circuits in powerStatus);
// this module is everything else:
//
// SETTING A PIECE FROM THE STORES (setPlaced, pickUpPlaced). A found generator, a mounted spotlight, a fridge or another
//   appliance (#19: appliances.js, its item placedItemKey: f_<kind>) is an item in the base's armory (carried home in both arms, a cart or a vehicle). It becomes a placed thing when it is
//   SET: from the base map's Build list (group Power: basemap.js buildMenu / layoutAct build -> setPlacedAt; its
//   footprint follows the mouse, R turns it, a click sets it there), or from the Construction tab and the governor with
//   no spot (the auto layout places it: a generator in the yard, a spotlight on a free wall stand else by the walls,
//   a fridge on a general building's floor). A set piece is a record in base.buildings of its own type (data-power.js
//   POWER_BUILDINGS furniture + set) keeping the item it was (rec.item: its condition comes back with it); Demolish
//   picks it up again, whole, into the stores (buildings.js demolish). The spotlight may stand on a wall stand's cell
//   (basemap.js FOOT mount: the stand keeps its ladder and its walkway; the light is higher and reaches further).
//
// THE BREAKER PANEL AND THE CIRCUITS (gridWired, circuitNeed). With a breaker panel standing (not broken) the buildings
//   in data-power.js CIRCUITS are wired: each draws its lights' power, and on a hot or a cold day (climateNeed: the
//   base's weather today) its fans and air conditioning, or its electric heaters, too. Each is switched on the Power
//   card (the switchboard: base.powerOff[id], as every powered thing) and served after the machines (power.js).
//
// THE MOOD (powerMood, relations.js moodFactors: applied each morning). At a wired base: every circuit served, +lit
//   ("Electric light"); some dark (switched off, not enough power, the generator dry or broken), −dark × the share of
//   the light dark. On a hot or a cold day, +comfy with every building's climate served, else −harsh × the share
//   without. No breaker panel: nothing is wired, nobody misses it (no line). Away on a team: no line.
//
// THE MACHINES. The ammo press (buildings.js stationStatus: idle without power, NEEDS_POWER; powered, POWER_BOOST and
//   the reloading orders at PRESS.rate: reloading.js), the electric well pump (pumpWater: economy.js waterProduction,
//   one pump a working well), the fence charger (fenceCharged: defences.js holds back more, basemap.js marks the wire
//   cells c.shock and combat.js shocks what steps in), the fridge (fridgesOn: storage.js storeSpaces).
//
// FINDS (rollPowerFind: scavenge.js, rollAreaPower: combat.js searchBox; their own dice). Generators in garages, sheds,
//   hardware stores and farms, the standby sets by big houses and clinics, the tactical sets with the Army; spotlights
//   at hardware stores, fire stations, factories; fridges in every kitchen.
//
// THE GOVERNOR (governPower, autopilot.js governBase): sets the generators lying in the stores while the base wants more
//   power than its generators give, every spotlight once there is a generator OR a solar array / battery bank (2026-10-24,
//   the user's "setting up power grids for the base": sources count, power.js isSource), then the appliances while a
//   building has room (appliances.js govAppliances: fridges before freezers before ranges; the range and the oven
//   without a source too, the range cooks on propane). The grid's BUILDS (the breaker panel, the well pump, the fence charger, the ammo press, the solar array,
//   the battery bank, the alarm, the heaters, the charging station) are the governor's build wishes: autopilot.js
//   gridWishes, each gated on its blueprint, a Mechanics hand, its plot, its parts and electronics with a reserve kept.
//
// MORE OF THE GRID (2026-10-24, the user's request in data-power.js: "more recipes for building that would use
//   electronics ... pre-requisite items"). The solar array (solarFactor, solarOut: by the hour of the day, the season
//   and the sky over the base; power.js powerStatus takes the sun's power before any generator runs) and the battery
//   bank (power.js: charged from the power that would go to waste, drawn last; data-power.js BATTERY); the perimeter
//   alarm (alarmOn: with power at night the base is never caught asleep and the approaches are watched: watch.js
//   surpriseAt through defences.js armoryDefence, lookoutsSpot); the electric heaters (heaterHeads: upkeep.js heatUse
//   warms that many people without the fires' wood; heaterWants: a day that wants heating draws); the charging station
//   (chargeHour: every powered hour puts CHARGER.rate uses back into the most drained rechargeable gear at the base, in
//   the stores or on anyone here; chargeWanted: it draws only while something is short).
//
// AI GROUPS (groups-power-grid 2026-10-24, docs/adr/0001-ai-parity.md; the user's request "Both players and AI groups
//   should build these and fix and implement any machine power needs and power output and setting up power grids for
//   the base"): theirs too, coarse and once a day. groupworks.js groupMachinesDaily runs grouppower.js powerDayBudget
//   over the day's 24 hours by these rules and numbers (POWER_USERS order, solarFactor at their base's tile, BATTERY's
//   cap, rate, eff and hysteresis, a generator started only when the sun and the bank do not cover the hour, genBurn
//   ÷ 24 an hour); their works `solar`, `bank`, `alarm`, `heaters` and `charger` go up by your locks and wear by your
//   FIXTURES at WORKS-scaled costs; the alarm is the braced bonus against a night raid, the heaters take HEATER.heads
//   out of their wood burn, the charger tops up drained gear. Found generators, spotlights, the panel's circuits, the
//   press, the pump, the fence charger and the fridge remain yours only.
import { GENSETS, GENSET_KINDS, GENSET_MAX, POWER_BUILDINGS, POWER_FINDS, AREA_POWER, CIRCUITS, CLIMATE, POWER_MOOD, PUMP, FRIDGE, SPOT, SOLAR, ALARM, HEATER, CHARGER } from "./data-power.js";
import { BUILDINGS, addBuilding, count, countAll } from "./buildings.js"; // (call-time only: the modules load in a circle)
import { placeItem, refreshBaseMap, fittingRoom } from "./basemap.js"; // (call-time only)
import { makeItem } from "./crafting.js"; // (call-time only)
import { powerStatus, isPowered, poweredType, generators, genCapacity, powerWanted, isSource } from "./power.js"; // (call-time only)
import { weatherAt, season } from "./weather.js"; // (call-time only)
import { day, atBase } from "./world.js";
import { heatRate } from "./upkeep.js"; // a day that wants heating: the electric heaters draw (call-time only)
import { itemDur, itemDurMax } from "./crafting.js"; // the charging station tops up rechargeable gear (call-time only)
import { allCarried } from "./inventory.js"; // ... on anyone at the base
import { hash01 } from "./skills.js";
import { lootItem } from "./inventory.js";
import { GEAR } from "./data.js"; // the rechargeable gear (recharge: true)
import { siteSource, areaSource } from "./itemcond.js";
import { applianceLine, govAppliances } from "./appliances.js"; // the appliances (#19; call-time only)

const nameOf = (type) => (POWER_BUILDINGS[type] ? POWER_BUILDINGS[type].name : BUILDINGS[type] ? BUILDINGS[type].name : type);
const lower = (type) => nameOf(type).toLowerCase();
/** A piece set from the stores (a found generator, a mounted spotlight, a fridge). @param {string} type */
export const isSetPiece = (type) => !!(POWER_BUILDINGS[type] && POWER_BUILDINGS[type].set);
/** The stores' item key of a set piece (an appliance's f_<kind>, data-appliances.js; else the type itself). @param {string} type */
export const placedItemKey = (type) => (POWER_BUILDINGS[type] && POWER_BUILDINGS[type].item) || type;
/** Pieces of this kind in a base's stores (its armory). @param {any} base @param {string} type */
export const placedInStores = (base, type) => ((base && base.armory) || []).filter((it) => it && it.key === placedItemKey(type)).length;
/** The found generators set at a base. @param {any} base */
export const gensetsAt = (base) => ((base && base.buildings) || []).filter((b) => GENSETS[b.type]);

// ---------- setting a piece and picking it up ----------
// Why one cannot be set at this base now ("" when it can), the stores aside.
/** @param {any} state @param {any} base @param {string} type */
export function placedProblem(state, base, type) {
  if (!isSetPiece(type)) return "Not a piece set from the stores";
  if (GENSETS[type] && gensetsAt(base).length >= GENSET_MAX) return `At most ${GENSET_MAX} found generators set at one base`;
  if (countAll(base, type) >= POWER_BUILDINGS[type].max) return `At most ${POWER_BUILDINGS[type].max} at one base`;
  if (POWER_BUILDINGS[type].fit && !fittingRoom(state, base, type)) return "Needs a building to stand in with free floor for it (a hut, cabin, lodge, hall or barn)";
  return "";
}
// buildings.js canBuild for a set piece: one in the stores, and room for it.
/** @returns {{ ok: boolean, reason?: string, short?: boolean }} */
export function canSetPlaced(state, base, type) {
  if (!isSetPiece(type)) return { ok: false, reason: "Not a piece set from the stores" };
  if (!placedInStores(base, type)) return { ok: false, short: true, reason: `No ${lower(type)} in the stores: find one and carry it home${type === "spotlamp" ? " (or make one at a workshop: Crafting)" : ""}` };
  const why = placedProblem(state, base, type);
  return why ? { ok: false, reason: why } : { ok: true };
}
// Take one from the stores and set it: at = [x, y, r] on the map (placed by hand), else the game places it. The best
// kept one first. Returns { rec, key, msg } or { err }.
export function setPlaced(state, base, type, at = null) {
  const chk = canSetPlaced(state, base, type);
  if (!chk.ok) return { err: chk.reason || "It cannot be set here now." };
  const list = base.armory.map((it, i) => [it, i]).filter(([it]) => it && it.key === placedItemKey(type)).sort(([a], [b]) => (b.quality || 0) - (a.quality || 0));
  const [item, idx] = list[0];
  base.armory.splice(idx, 1);
  delete item.store; // containers.js: an assignment to a container goes with it out of the stores
  const rec = addBuilding(base, type);
  rec.item = item;
  const key = `b:${rec.id}`;
  if (at) {
    const err = placeItem(state, base, key, at[0], at[1], at[2] || 0);
    if (err) { base.buildings.splice(base.buildings.indexOf(rec), 1); base.armory.splice(idx, 0, item); return { err }; }
  }
  const g = GENSETS[type];
  const what = g ? `${g.out} power once it is fuelled (the morning's refuelling), +${g.heat} Heat while it runs` : type === "spotlamp" ? `it lights the ground round it in a night fight while it has power` : applianceLine(type) || `${FRIDGE.room} days of cold food room while it has power`; // appliances.js: the chest freezer, the cold case, the range, the oven, the microwave
  return { rec, key, msg: `${nameOf(type)} set ${at ? "there" : "where the game found room for it"} at ${base.name}: ${what}.` };
}
// The base map's Build on a set piece (basemap.js layoutAct build): set where the ghost is. Returns an error or "".
export function setPlacedAt(state, b, base, type, g) {
  const L = b.layout;
  const r = setPlaced(state, base, type, g.at);
  if (r.err) return r.err;
  L.msg = r.msg;
  L.sel = r.key;
  if (!placedInStores(base, type)) L.pickType = null; // none left to set
  refreshBaseMap(state);
  return "";
}
// Demolish on a set piece (buildings.js demolish), or its building pulled down: back into the stores, whole. Its fuel
// stays in the tank's last state (a generator picked up is carried empty: the fuel goes back into the stock).
export function pickUpPlaced(state, base, rec) {
  const i = base.buildings.indexOf(rec);
  if (i >= 0) base.buildings.splice(i, 1);
  if (GENSETS[rec.type] && rec.tank > 0) base.stock.fuel = (base.stock.fuel || 0) + rec.tank;
  if (base.powerOff) delete base.powerOff[rec.id];
  const item = rec.item && typeof rec.item === "object" ? rec.item : makeItem(placedItemKey(rec.type), 0.8);
  base.armory.push(item);
  return `${nameOf(rec.type)} picked up and put back in the stores at ${base.name}${GENSETS[rec.type] && rec.tank > 0 ? " (its tank drained into the fuel)" : ""}.`;
}

// ---------- the breaker panel and the circuits ----------
/** A breaker panel standing (not broken): the buildings are wired. @param {any} base */
export const gridWired = (base) => !!base && count(base, "breaker") > 0;
const climateCache = new Map();
// "hot", "cold" or "" for the base's weather today (CLIMATE): fans and air conditioning, or heaters, wanted.
/** @returns {"hot"|"cold"|""} */
export function climateNeed(state, base) {
  if (!state || !base || base.tile == null) return "";
  const k = `${state.seed}|${base.tile}|${day(state)}`;
  let v = climateCache.get(k);
  if (v == null) {
    const w = weatherAt(state, base.tile, Math.floor(state.hour / 24) * 24 + 14);
    const hi = w && w.hi != null ? w.hi : 15, lo = w && w.lo != null ? w.lo : 5, mean = (hi + lo) / 2;
    v = (w && w.key === "heat") || hi >= CLIMATE.HOT_HI || mean >= CLIMATE.HOT_MEAN ? "hot" : mean <= CLIMATE.COLD_MEAN ? "cold" : "";
    if (climateCache.size > 2000) climateCache.clear();
    climateCache.set(k, v);
  }
  return /** @type {"hot"|"cold"|""} */ (v);
}
/** A wired building's circuit now: { light, climate } (power units). @param {any} state @param {any} base @param {any} b */
export function circuitOf(state, base, b) {
  const c = b && CIRCUITS[b.type];
  if (!c) return { light: 0, climate: 0 };
  return { light: c[0], climate: climateNeed(state, base) ? c[1] : 0 };
}
/** Its power now (power.js powerStatus): 0 for a building not on a circuit. */
export const circuitNeed = (state, base, b) => { const c = circuitOf(state, base, b); return c.light + c.climate; };
/** What its power does, for the switchboard. */
export function circuitWhat(state, base, b) {
  const c = circuitOf(state, base, b), need = climateNeed(state, base);
  return `lights inside${c.climate ? `, ${need === "hot" ? "fans and air conditioning in the heat" : "electric heaters in the cold"}` : CIRCUITS[b.type] && CIRCUITS[b.type][1] ? " (fans in the heat, heaters in the cold)" : ""}`;
}
// The circuits' state now: { n, lit, dark, light, litUnits, need, climate, cool (climate units served), warm } or null
// at a base not wired or with no wired building. ps: a powerStatus already made.
export function circuitState(state, base, ps = null) {
  if (!gridWired(base)) return null;
  const P = ps || powerStatus(state, base);
  const list = P.users.filter((u) => u.circuit);
  if (!list.length) return null;
  const need = climateNeed(state, base);
  let light = 0, litUnits = 0, climate = 0, served = 0, dark = 0;
  for (const u of list) {
    const c = circuitOf(state, base, u.b);
    light += c.light; climate += c.climate;
    if (u.served) { litUnits += c.light; served += c.climate; } else dark++;
  }
  return { n: list.length, dark, light, litUnits, need, climate, climateServed: served };
}
// A day's mood lines for someone at a wired base (relations.js moodFactors): [{ label, v, tip }].
const moodCache = new Map();
export function powerMood(state, s, base) {
  if (!state || !base || !gridWired(base)) return [];
  const k = `${state.seed}|${base.id}|${state.hour}|${Object.keys(base.powerOff || {}).join(",")}|${base.buildings.length}`; // the world, the hour, the switches and what stands
  let lines = moodCache.get(k);
  if (lines) return lines;
  lines = [];
  const cs = circuitState(state, base);
  if (cs) {
    const share = cs.light ? cs.litUnits / cs.light : 1;
    if (share >= 0.999) lines.push({ label: "Electric light in the buildings", v: POWER_MOOD.lit, tip: "The breaker panel's circuits are all on and powered (Power card)" });
    else lines.push({ label: `Dark buildings: ${cs.dark} of ${cs.n} without power`, v: -POWER_MOOD.dark * (1 - share), tip: "A wired building switched off, or the generators, the sun and the battery banks not giving enough power (Power card): no lights after dark" });
    if (cs.need && cs.climate > 0) {
      const cshare = cs.climateServed / cs.climate;
      const hot = cs.need === "hot";
      if (cshare >= 0.999) lines.push({ label: hot ? "Fans and cool air in the heat" : "Electric heaters on a cold day", v: POWER_MOOD.comfy, tip: "Every wired building's climate is on and powered" });
      else lines.push({ label: hot ? "Sweltering: no cooling in the buildings" : "Shivering: no heating in the buildings", v: -POWER_MOOD.harsh * (1 - cshare), tip: hot ? "A hot day and the fans and air conditioning off or unpowered (Power card)" : "A cold day and the electric heaters off or unpowered (Power card); the fires still keep everyone alive" });
    }
  }
  if (moodCache.size > 500) moodCache.clear();
  moodCache.set(k, lines);
  return lines;
}

// ---------- the machines ----------
// Does this electric pump serve a well (one pump a working well, the oldest pumps first)?
export function pumpServes(base, b) {
  const wells = count(base, "well");
  const pumps = base.buildings.filter((x) => x.type === "elec_pump").sort((a, c) => a.id - c.id);
  return pumps.indexOf(b) >= 0 && pumps.indexOf(b) < wells;
}
/** Water a day the powered pumps add (economy.js waterProduction, × the well's season factor there). @param {any} base */
export const pumpWater = (base) => base.buildings.filter((b) => b.type === "elec_pump" && !b.broken && isPowered(base, b) && pumpServes(base, b)).length * PUMP.water;
/** The fence charger powered and a wire to charge (defences.js, basemap.js). @param {any} base */
export const fenceCharged = (base) => !!base && poweredType(base, "fence_charger") && (count(base, "barbed_wire") > 0 || count(base, "razor_wire") > 0);
/** Fridges with power (storage.js storeSpaces; the other appliances: appliances.js appliancesOn). @param {any} base */
export const fridgesOn = (base) => base.buildings.filter((b) => b.type === "fridge" && !b.broken && isPowered(base, b)).length;
/** The mounted spotlights with power now (basemap.js: lit in a night fight). @param {any} base @param {any} b */
export const spotOn = (base, b) => !!b && b.type === "spotlamp" && !b.broken && isPowered(base, b);
export { SPOT };

// ---------- more of the grid (2026-10-24; see the header and data-power.js) ----------
const r1 = (v) => Math.round(v * 10) / 10;
/**
 * The sun's share at a base this hour (0 to 1): 0 at night, half in the first and last SOLAR.shoulder hours of daylight,
 * × the season × the sky over the base (data-power.js SOLAR).
 * @param {any} state @param {any} base @param {number} [hour]
 */
export function solarFactor(state, base, hour = state.hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h < SOLAR.from || h >= SOLAR.to) return 0;
  const edge = h < SOLAR.from + SOLAR.shoulder || h >= SOLAR.to - SOLAR.shoulder ? 0.5 : 1;
  const w = base && base.tile != null ? weatherAt(state, base.tile, hour) : null;
  const sky = w && SOLAR.sky[w.key] != null ? SOLAR.sky[w.key] : 0.5;
  const sea = SOLAR.season[season(state, hour).key] ?? 0.75;
  return edge * sky * sea;
}
/** The solar arrays here (built, standing). @param {any} base */
export const solarArrays = (base) => ((base && base.buildings) || []).filter((b) => b.type === "solar_array");
/** The power the sun gives this base now (power.js powerStatus): the arrays not broken or switched off × SOLAR.out × the hour's share, to a tenth. @param {any} state @param {any} base */
export function solarOut(state, base) {
  const live = solarArrays(base).filter((b) => !b.broken && !(base.powerOff && base.powerOff[b.id]));
  if (!live.length) return 0;
  return r1(live.length * SOLAR.out * solarFactor(state, base));
}
/** "4 power at full sun; now 2 (summer, overcast)": the array's line for the Power card. @param {any} state @param {any} base */
export function solarLine(state, base) {
  const f = solarFactor(state, base), w = base && base.tile != null ? weatherAt(state, base.tile) : null, h = state.hour % 24;
  const low = h < SOLAR.from + SOLAR.shoulder || h >= SOLAR.to - SOLAR.shoulder;
  return f <= 0 ? `${SOLAR.out} power at full sun · night: nothing` : `${SOLAR.out} power at full sun · now ${r1(SOLAR.out * f)} (${season(state).name.toLowerCase()}, ${w ? w.name.toLowerCase() : "clear"}${low ? ", a low sun" : ""})`;
}
/** The perimeter alarm with power now (watch.js, defences.js): the siren wakes the base, the sensors watch the approaches. @param {any} base */
export const alarmOn = (base) => !!base && poweredType(base, "perimeter_alarm");
/** The people the powered electric heaters warm (upkeep.js heatUse: not the fires' wood for them). @param {any} base */
export const heaterHeads = (base) => ((base && base.buildings) || []).filter((b) => b.type === "elec_heater" && !b.broken && isPowered(base, b)).length * HEATER.heads;
/** Do the heaters draw today: a day that wants heating (upkeep.js heatRate: a freezing day or a chill night). @param {any} state @param {any} base */
export const heaterWants = (state, base) => !!base && heatRate(state) > 0;
// Rechargeable gear at a base (GEAR recharge: electronic ear defenders, a military headset) that is short of uses: in
// the stores (the armory) or on anyone at the base, the most drained first.
/** @param {any} state @param {any} base */
export function chargeables(state, base) {
  const out = [];
  const add = (it) => { const d = it && GEAR[it.key]; if (!d || !d.recharge) return; const dur = itemDur(it), max = itemDurMax(it); if (dur != null && dur < max - 1e-9) out.push({ item: it, dur, max }); };
  for (const it of base.armory || []) add(it);
  for (const s of atBase(state, base.id)) for (const it of allCarried(s)) add(it);
  return out.sort((a, b) => a.dur / a.max - b.dur / b.max);
}
/** Does the charging station draw now: anything here short of charge. @param {any} state @param {any} base */
export const chargeWanted = (state, base) => !!base && chargeables(state, base).length > 0;
/**
 * An hour of charging (power.js refreshPower, once an hour per station: b.chargeHour): a powered station puts
 * CHARGER.rate uses back into the most drained item here (no battery pack spent). Returns the item charged or null.
 * @param {any} state @param {any} base @param {any} b
 */
export function chargeHour(state, base, b) {
  if (!b || b.type !== "charging_station" || b.broken || !isPowered(base, b) || b.chargeHour === state.hour) return null;
  b.chargeHour = state.hour;
  const c = chargeables(state, base)[0];
  if (!c) return null;
  c.item.dur = Math.min(c.max, Math.round((c.dur + CHARGER.rate) * 10) / 10);
  return c.item;
}

// ---------- finds (their own dice) ----------
/** @param {Record<string, number>} items @param {number} u */
function pickW(items, u) {
  const tot = Object.values(items).reduce((a, w) => a + w, 0);
  let x = u * tot;
  for (const [k, w] of Object.entries(items)) { x -= w; if (x < 0) return k; }
  return Object.keys(items).pop() || null;
}
/**
 * A generator, a spotlight or a fridge in the hour-by-hour search (scavenge.js; POWER_FINDS by the site or POI), or null.
 * @param {any} state @param {number} tileId @param {string} kind @param {number} left the pool left (0-1) @param {number} [mult] @param {string} [salt]
 */
export function rollPowerFind(state, tileId, kind, left, mult = 1, salt = "") {
  const f = POWER_FINDS[kind];
  if (!f) return null;
  const loot = Math.max(0.1, Math.min(1, left ?? 1));
  if (hash01(state.seed, "powerfind", tileId, state.hour, salt) >= f.p * loot * mult) return null;
  const key = pickW(f.items, hash01(state.seed, "powerpick", tileId, state.hour, salt));
  return key ? lootItem(key, siteSource(kind), hash01(state.seed, "powerdur", tileId, state.hour, salt)) : null;
}
/**
 * One in a raid's container (combat.js searchBox; AREA_POWER by the area, its own dice), or null.
 * @param {any} state @param {number} tileId @param {string} areaType @param {string|null} site @param {string} [salt]
 */
export function rollAreaPower(state, tileId, areaType, site, salt = "") {
  const a = AREA_POWER[areaType];
  if (!a || hash01(state.seed, "areapower", tileId, salt) >= a.p) return null;
  const key = pickW(a.items, hash01(state.seed, "areapowerpick", tileId, salt));
  return key ? lootItem(key, areaSource(areaType, site), hash01(state.seed, "areapowerdur", tileId, salt)) : null;
}

// ---------- the governor ----------
// Once a day (autopilot.js governBase): the biggest generator in the stores set while the base wants more power than
// its generators give; every spotlight in the stores once a generator OR a source that burns nothing (a solar array, a
// battery bank: power.js isSource; 2026-10-24) stands; then the appliances (appliances.js govAppliances, #19).
// Returns the log lines.
export function governPower(state, base) {
  const out = [];
  const want = powerWanted(state, base, () => true);
  for (let i = 0; i < GENSET_MAX && want > genCapacity(base); i++) {
    const k = GENSET_KINDS.slice().sort((a, c) => GENSETS[c].out - GENSETS[a].out).find((t) => placedInStores(base, t) && canSetPlaced(state, base, t).ok);
    if (!k) break;
    const r = setPlaced(state, base, k);
    if (r.err) break;
    out.push(r.msg);
  }
  if (generatorsOrSources(base)) while (placedInStores(base, "spotlamp") && canSetPlaced(state, base, "spotlamp").ok) { // with no source here the spotlights wait in the stores
    const r = setPlaced(state, base, "spotlamp");
    if (r.err) break;
    out.push(r.msg);
  }
  out.push(...govAppliances(state, base)); // appliances.js: the fridges, freezers, cold cases, ranges, ovens, microwaves (the powered ones once a source stands)
  return out;
}
/** Something here makes power: a generator, a solar array or a battery bank (power.js isSource). @param {any} base */
export const generatorsOrSources = (base) => !!base && (generators(base).length > 0 || base.buildings.some(isSource));
