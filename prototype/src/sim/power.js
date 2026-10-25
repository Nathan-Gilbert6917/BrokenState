// Power (suggestions-2 #5): generators burn fuel to power a handful of buildings, and an ethanol still turns surplus
// fresh food into that fuel (spoiled food is thrown out, user pick 2026-10-10).
//
//   Generator (machines-2 2026-10-10, the user's pick: "generators do not need operators just people to repair and fuel
//     it"; it was a workshop station with an operator): no operator, no Operate role. It gives POWER.genOut (6) power
//     for POWER.genFuel (2) fuel a day of running, burned by the hour (1/12 fuel an hour) from its own tank while
//     something draws power; only as many generators run as the demand needs. The same fuel a day and power as
//     before: a generator that runs all day burns its 2.
//     The tank (b.tank, POWER.tank = 3: a day and a half's running, so a refuelling that comes late in the morning
//     never leaves a gap before the next day's; it was 2). Refuelling is a chore (refuelChore): once a day, from
//     REFUEL.from (06:00), the first hour anyone able is at the base (not in a hospital bed, not resting sick, well
//     enough to work: workFactor 0.35+), the least busy of them (a builder with nothing to build, a scavenger, someone
//     resting, ...: refueller) tops the tanks up from the base's fuel. It takes REFUEL.hours (half an hour) of their
//     day: a builder on a job builds the next hour at half pace (buildings.js buildRate, choreShare). A base left with
//     nobody able (everyone away, ill or in a bed) keeps its power until the tank runs dry: a day and a half at most. A new
//     generator waits for its first fill the same way.
//     The fuel reserve (base.genReserve = { n, by }: the Power card's "Keep N fuel", the governor's and a steward's
//     fuel floor): the tanks are filled only from the fuel above it, so a base at its reserve runs its tanks dry and the
//     power goes off (the switch-off rule the generator's old Keep-at-least station order was). A generator can be
//     switched off by hand like any powered building (base.powerOff[id]).
//     Repairs (breakdowns.js): it wears by the days it ran (FIXTURES.generator, b.lastRan), breaks, and a breakdown
//     needs a Mechanics 3 hand and machine parts, as before. Loud: +POWER.genHeat (4) Heat at the base while it runs
//     (hordes.js baseHeat).
//   Ethanol still (station "still", buildings.js RECIPES.still): an operator turns 8 days of fresh food (foods.js: the
//     soonest to spoil first) + 2 water into 3 fuel a day. Spoiled food is thrown out, not distilled (STILL.mash 0).
//   Users (POWER_USERS, need in power units, served in this order while the supply lasts):
//     walk-in freezer 2 (freezer-parts: food in it keeps 20× longer than its shelf life, storage.js; base.freezerOn below), radio station 1
//     (+2 tiles of coverage, radio.js), floodlights 1 (no fuel burned per attack, defences.js), machine shop 2 (2 parts
//     a day from 9 scrap instead of 1 from 6), preserving room 1 (half as much again a day), vacuum sealer 1
//     (hasSealer: the hook for the packaged survival meals of a later cooking wave). The cold store is an ice house
//     again (machines-2, the user's pick: no power draw, no summer bonus).
//     A broken building (breakdowns.js) draws nothing and gets nothing. Workshop stations draw only while their
//     operator is at work (an order that holds them, or no operator, draws nothing). Each building can be switched off
//     by hand (base.powerOff[id]).
//   Tiers (gen-tiers 2026-10-10, the user's request: "Generators have several tier upgrades to increase power for each
//     tier requires more fuel"; GEN_TIERS, b.tier, a missing tier is 1): a generator is upgraded where it stands (no new
//     plot, buildings.js canUpgradeGenerator / queueGenUpgrade, a queue job { type: "generator", target, tier }), one
//     step at a time:
//       tier                    power  fuel a day (idle → full load)  tank  Heat  upgrade (scrap, parts, el.)  hours  Mechanics  manual
//       1 Portable generator      6     2 → 2 (flat)                   3     4    built: 20, 4                   30      3        Generator Schematics
//       2 Standby generator      12     2.25 → 3.5                     5     6    24, 5                          30      4        (the same)
//       3 Industrial diesel set  24     3 → 6                          9     8    40, 8, 2 electronics           48      5        + Industrial Power Manual
//     Fuel (the user's "each tier requires more fuel"): a bigger engine burns more at any load. The portable set runs
//     flat out whatever it powers (no governor on a cheap petrol set: 2 a day running, as it always was, so tier 1 plays
//     exactly as before); the standby and the industrial sets have a governor and burn idle + (full − idle) × the share
//     of their power drawn (genBurn): only what they must. A tier-3 set running one freezer (2 of 24) burns 3.25 a day,
//     not 6; a standby set with the same freezer 2.46, the portable set 2. At full load the bigger sets are a little
//     thriftier per unit of power (0.33, 0.29, 0.25 fuel a power a day): the one reason to upgrade besides the power
//     itself; a base that does not need the power pays more fuel for a bigger set, never less. Why a load share and not
//     a flat burn: it is two numbers a tier and one line here, and a flat 6 a day for an idling tier 3 would punish the
//     base that built ahead of its needs. The tank holds about a day and a half at that tier's full burn (3, 5, 9), so a
//     late morning refuelling still never leaves a gap.
//     Heat (hordes.js baseHeat, generatorHeat): +4 / +6 / +8 while it runs. Wear and spares (breakdowns.js fxDef:
//     FIXTURES.generator / generator2 / generator3): wears 1.6 / 1.9 / 2.2 a running day, a spare part every 20 / 16 /
//     12 running days, a proper repair 4 scrap 2 parts Mechanics 3 / 6 scrap 3 parts Mechanics 4 / 8 scrap 4 parts
//     Mechanics 5. Demolishing gives half of everything put into it back (buildings.js demolishRefund: the build and
//     the upgrades). Old saves: every generator is tier 1 (migrateGenTiers).
//     Several generators (max 2 a base, any tiers): the supply is the sum of the running ones; powerStatus runs the
//     fewest that cover the demand, the cheapest for the load first (a portable set before a standby set idling for
//     one freezer), the ones already running before an equal one (no flipping), and splits the load between them in
//     that order (each carries up to its power: its burn).
//     The governor and stewards (autopilot.js autoGenUpgrade) upgrade one when the demand wants more than the
//     generators give and the base's fuel can carry the bigger burn (genUpgradeFuelOk); the AI groups by the same
//     tiers, costs, skill and manual (groupworks.js MACH.tiers).
// The walk-in freezer (freezer-parts): refreshPower sets base.freezerOn (true while at least one freezer here is
// served: built, not broken, not switched off, power enough from a running generator with fuel in its tank) and
// base.freezersOn (how many), every hour and before the stations run each day. That flag is the contract with
// storage.js (the food-types branch ages the food in the freezer at ~0.05× while it is true). When a freezer goes off
// the log says why (no generator, the tank dry, no fuel above the reserve, not enough power, broken, switched off), at
// most once a day, and again when it is cold once more (freezerSwitch: one line each per outage, none for a blip of
// under two hours).
// The power grid (2026-10-21, data-power.js and electric.js: found generators, spotlights, the breaker panel's
// circuits, the ammo press, the well pump, the fence charger, the fridge):
//   Found generators (GENSETS: an inverter set up to the Army's tactical set) are items carried in both arms and set on
//     the base map from the stores; set, each is a generator here (isGen) with its kind's power, its burn by the hour
//     (genDef: data-power.js gives fuel an hour, the tiers here fuel a day) and tank and Heat, refuelled by the same
//     morning chore. Never upgraded (genToUpgrade: the built Generator only).
//   New users (POWER_USERS, after the old ones in the serving order): the spotlight from dusk to dawn, the fence
//     charger, the ammo press while its operator works it, the electric well pump while it serves a well, the fridge;
//     then the building circuits (electric.js circuitNeed: a breaker panel standing, each wired building's lights and,
//     on a hot or a cold day, its climate), each switched like any powered building (base.powerOff[id]).
// More of the grid (2026-10-24, data-power.js header: "more recipes for building that would use electronics"):
//   Sources without fuel (SOURCE_TYPES, powerStatus): the solar array gives by the hour, the season and the sky
//     (electric.js solarOut, data-power.js SOLAR), the battery bank gives what it stored (data-power.js BATTERY: cap
//     power-hours a bank, at most rate an hour, eff of what went in). The sun is drawn first, then the generators, then
//     the bank; but the bank's power counts as supply before any generator is started, so a night load the bank can
//     carry never starts one. The bank is charged (refreshPower, once an hour: b.charge, b.cycleHour; b.ran for its
//     wear) only from power that costs nothing: the sun's surplus, and the unused power of a running flat-burn set
//     (idle = full: the portable generator, the house and inverter sets burn the same whatever they power); a governed
//     set never burns more to charge it. base.power carries solar (the sun's power this hour) and battery { stored, cap }.
//   The appliances (#19, 2026-10-25, appliances.js): the chest freezer and the cold case all day, the kitchen range and
//     the microwave while a cook's bill here wants cooking; after the fridge in the serving order.
//   New users (POWER_USERS): the perimeter alarm from dusk to dawn, the electric heaters on a day that wants heating
//     (electric.js heaterWants), the charging station while anything here is short of charge (chargeWanted; its hour
//     of charging runs in refreshPower: electric.js chargeHour).
// The grid audit (2026-10-24, the user's request: "fix and implement any machine power needs and power output and
// setting up power grids for the base"): every building with a motor was read against POWER_USERS and POWER_BOOST.
//   The grain mill and the meat grinder (cooking.js; hand-cranked until now) take an OPTIONAL electric draw of 1 power
//     each (POWER_USERS grainmill / meatgrinder), wanted only while a cook's bill at the base calls for them today
//     (cooking.js machineWanted: a Flour, Ground meat or Smoked sausage bill that is not paused or done); powered, their
//     batches take 1 / POWER_BOOST.out of the cooking hours (×1.5 the flour, ground meat and sausage a cook's hour:
//     cooking.js runStation), unpowered they turn by hand as before (never idle: not in NEEDS_POWER). The pressure
//     canner on a preserving room draws nothing (a pot on the stove: the kitchen's own 1 power is the electric stove).
//   Every reader of base.power works at a base with the sun and a bank and no generator: freezerOffWhy says what the
//     sun gives and whether the bank is there, powerLine shows the sources, generatorHeat is the running generators'
//     only (the sun and the bank make no noise), hasSealer / isPowered read the served list whatever carried the load.
//   The governor builds the grid (autopilot.js gridWishes) and sets the found spotlights and fridges once any source
//     stands, a solar array included (electric.js governPower).
// The result is cached on the base (base.power: supply, demand, served building ids, running generators) every hour
// (production.js productionHour) and before the stations run each day, so storage, radio and defences read it
// cheaply. A base that never refreshed has no power.
import { BUILDINGS, RECIPES, stationOperator, assignStations } from "./buildings.js";
import { withBuildmat } from "./buildmats.js"; // the upgrades' building materials
import { day, log, atBase, hourOfDay, skill, isNight } from "./world.js";
import { orderHold } from "./production.js";
import { stockHas } from "./water.js"; // a recipe's "fresh" in days of fresh food
import { workFactor } from "./health.js";
import { sickRestWhy } from "./sickrest.js"; // the ill rest: they do no chores
import { GENSETS, SPOT, FRIDGE, PRESS, ALARM, HEATER, CHARGER, BATTERY } from "./data-power.js"; // the power grid's pieces (found generators, spotlights, ...; 2026-10-24 the alarm, the heaters, the charger, the battery bank, the solar array)
import { circuitNeed, circuitWhat, gridWired, pumpServes, solarOut, heaterWants, chargeWanted, chargeHour } from "./electric.js"; // the breaker panel's circuits, the well pump, the sun, the heaters, the charger (call-time only)
import { COLD, RANGE, MICROWAVE } from "./data-appliances.js"; // the appliances' draws (#19)
import { rangeWanted, cookingWanted } from "./appliances.js"; // the range and the microwave draw while the cooks have work (call-time only)
import { machineWanted } from "./cooking.js"; // the grain mill and the meat grinder draw while a cook's bill calls for them (call-time only; 2026-10-24 grid audit)

export const POWER = { genOut: 6, genFuel: 2, genHeat: 4, tank: 3 }; // tier 1 (GEN_TIERS[1])
// The generator's tiers (see the header): out (power), idle / full (fuel a day running at no load / at full load: genBurn),
// tank, heat; the upgrade to a tier: cost, hours (work-hours), req (a survivor's skill at the base), bp (a manual studied).
export const GEN_TIERS = [
  null,
  { name: "Portable generator", out: POWER.genOut, idle: POWER.genFuel, full: POWER.genFuel, tank: POWER.tank, heat: POWER.genHeat, desc: "A petrol generator on a wheeled frame: it runs flat out whatever it powers" },
  { name: "Standby generator", out: 12, idle: 2.25, full: 3.5, tank: 5, heat: 6, cost: { scrap: 24, parts: 5 }, hours: 30, req: { mechanics: 4 },
    desc: "A liquid-cooled standby set on a concrete pad, with a governor: it burns 2.25 fuel a day idling, 3.5 at full load" },
  { name: "Industrial diesel set", out: 24, idle: 3, full: 6, tank: 9, heat: 8, cost: { scrap: 40, parts: 8, electronics: 2 }, hours: 48, req: { mechanics: 5 }, bp: "indpower",
    desc: "A skid-mounted diesel set out of a factory or a hospital basement, with its control panel: it burns 3 fuel a day idling, 6 at full load" },
];
for (const T of GEN_TIERS) if (T && T.cost) T.cost = withBuildmat(T.cost); // building materials in every upgrade (buildmats.js; made on site from scrap when short)
export const genTier = (b) => Math.max(1, Math.min(GEN_TIERS.length - 1, Math.floor(Number(b && b.tier) || 1)));
// A found generator's numbers in the tiers' shape (fuel a day: data-power.js gives it an hour).
const GENSET_DEFS = Object.fromEntries(Object.entries(GENSETS).map(([k, g]) => [k, { name: g.name, out: g.out, idle: g.idle * 24, full: g.full * 24, tank: g.tank, heat: g.heat, desc: g.what, set: true }]));
export const isGenset = (b) => !!b && !!GENSETS[b.type];
export const genDef = (b) => (isGenset(b) ? GENSET_DEFS[b.type] : GEN_TIERS[genTier(b)]);
export const genName = (b) => genDef(b).name;
export const genTank = (b) => genDef(b).tank;
// Fuel a day a generator of tier def burns while running with `load` power drawn from it (see the header).
export const genBurn = (def, load) => def.idle + (def.full - def.idle) * Math.max(0, Math.min(1, (Number(load) || 0) / def.out));
export const STILL = { mash: 0 }; // no spoiled food goes into the still (food-types: food spoils by its lots and is thrown out; kept for old callers)
// The refuelling chore: from this hour of the day; the share of an hour it takes.
export const REFUEL = { from: 6, hours: 0.5 };
export const POWER_USERS = {
  freezer:      { need: 2, what: "a walk-in freezer: food in it keeps 20 times longer than its shelf life (×0.05 a day; 300 days of food room)" },
  radio:        { need: 1, what: "+2 tiles of radio coverage" },
  floodlights:  { need: 1, what: "no fuel burned when a horde attacks" },
  machine_shop: { need: 2, what: "power tools: 2 parts a day from 9 scrap (1 from 6 without)" },
  kitchen:      { need: 1, what: "an electric stove: half as much again a day (14 days of fresh food → 12 portions of jarred food)" },
  sealer:       { need: 1, what: "a vacuum sealer: packs cooked food into long-keeping survival meals" },
  // The cooking machines (2026-10-24 grid audit; cooking.js): hand-cranked, with an optional motor. They draw only while a
  // cook's bill at the base calls for them today (machineWanted), and turn by hand without power (never idle).
  grainmill:    { need: 1, what: "a motor on the grain mill: ×1.5 the flour a cook's hour (hand-cranked without power, slower)" },
  meatgrinder:  { need: 1, what: "a motor on the meat grinder: ×1.5 the ground meat and sausage a cook's hour (hand-cranked without power, slower)" },
  // The power grid (data-power.js, electric.js).
  spotlamp:     { need: SPOT.need, what: `a mounted spotlight: lights ${SPOT.R} cells round it in a night fight here (${SPOT.STAND_R} from a wall stand); on from dusk to dawn` },
  fence_charger:{ need: 2, what: "a charged fence: the wire shocks whatever reaches it, and the base holds back more of a horde" },
  ammo_press:   { need: 2, what: `the ammo press: ${PRESS.in}× the scrap into ${PRESS.out}× the rounds, reloading orders ${PRESS.rate}× as fast; idle without power` },
  elec_pump:    { need: 1, what: "an electric well pump: more water a day from the well it serves" },
  fridge:       { need: FRIDGE.need, what: `a refrigerator: ${FRIDGE.room} days of food kept at a quarter of its shelf a day` },
  // The appliances (#19, data-appliances.js, appliances.js): the cold ones all day; the range and the microwave while a
  // cook's bill here wants cooking today (rangeWanted, cookingWanted).
  chest_freezer: { need: COLD.chest_freezer.need, what: `a chest freezer: ${COLD.chest_freezer.room} days of food frozen (×${COLD.chest_freezer.factor} of its shelf a day)` },
  cold_case:    { need: COLD.cold_case.need, what: `a cold case: ${COLD.cold_case.room} days of food chilled (×${COLD.cold_case.factor} of its shelf a day)` },
  freezer_case: { need: COLD.freezer_case.need, what: `a freezer case: ${COLD.freezer_case.room} days of food frozen (×${COLD.freezer_case.factor} of its shelf a day)` }, // a grocery store's (issue #22)
  island_freezer: { need: COLD.island_freezer.need, what: `an island freezer: ${COLD.island_freezer.room} days of food frozen (×${COLD.island_freezer.factor} of its shelf a day)` },
  meat_case:    { need: COLD.meat_case.need, what: `a butcher's case: ${COLD.meat_case.room} days of food chilled (×${COLD.meat_case.factor} of its shelf a day)` },
  range:        { need: RANGE.need, what: `a kitchen range: cooks its bills with no wood (off the grid it burns ${RANGE.propane} propane a batch); on while its bills cook` },
  microwave:    { need: MICROWAVE.need, what: `a microwave: ×${MICROWAVE.boost} on a meal's time at every station here; on while the cooks work` },
  // More of the grid (2026-10-24, data-power.js): the alarm at night, the heaters on a cold day, the charger while something is short.
  perimeter_alarm: { need: ALARM.need, what: `a perimeter alarm: the base is never caught asleep at night (everyone counts ${Math.round(ALARM.wake * 100)}% on the walls unwarned), anything within ${ALARM.tiles} tile is spotted; on from dusk to dawn` },
  elec_heater:  { need: HEATER.need, what: `electric heaters: ${HEATER.heads} people warmed without the fires' wood; on while the day wants heating` },
  charging_station: { need: CHARGER.need, what: `a charging station: ${CHARGER.rate} uses an hour back into the most drained rechargeable gear here (ear defenders, headsets), no battery packs; on while something is short` },
};
// Sources that burn nothing (data-power.js source: true): the solar array (electric.js solarOut) and the battery bank.
export const SOURCE_TYPES = new Set(["solar_array", "battery_bank"]);
export const isSource = (b) => !!b && SOURCE_TYPES.has(b.type);
export const batteries = (base) => base.buildings.filter((b) => b.type === "battery_bank");
const chargeOf = (b) => Math.max(0, Math.min(BATTERY.cap, Number(b.charge) || 0));
const r1 = (v) => Math.round(v * 10) / 10;
// Powered stations: inputs and outputs multiplied (rounded) while they are served.
export const POWER_BOOST = { machine_shop: { in: 1.5, out: 2 }, kitchen: { in: 1.5, out: 1.5 }, ammo_press: { in: PRESS.in, out: PRESS.out }, grainmill: { in: 1, out: 1.5 }, meatgrinder: { in: 1, out: 1.5 } }; // the mill and the grinder: cooking.js runStation (the same inputs, ×1.5 out a cook's hour)
// Stations that run only with power (electric.js: idle without it).
export const NEEDS_POWER = new Set(["ammo_press"]);
export const RADIO_BOOST = 2;
const PRIORITY = Object.keys(POWER_USERS);

export const isGen = (b) => !!b && (b.type === "generator" || !!GENSETS[b.type]);
export const generators = (base) => base.buildings.filter(isGen);
export const switchedOff = (base, b) => !!(base.powerOff && base.powerOff[b.id]);
const tankOf = (b) => Math.max(0, Number(b.tank) || 0);
// The fuel the tanks are never filled from (the Power card's Keep N fuel; the governor's and a steward's fuel floor).
export const genReserve = (base) => Math.max(0, (base && base.genReserve && Number(base.genReserve.n)) || 0);
// Sets it. by: "player" (the Power card) or "ai" (the governor, a steward: they leave the player's alone).
export function setGenReserve(base, n, by = "player") {
  const v = Math.max(0, Math.min(99999, Math.floor(Number(n) || 0)));
  base.genReserve = { n: v, by }; // the player's 0 stands too (a steward leaves it)
  return v ? `Generators: ${v} fuel kept back; the tanks are filled only from the fuel above it.` : "Generators: the tanks are filled from all the fuel here.";
}

// A powered workshop station wants power while its operator works it: someone on it, no order holding it, and the
// inputs for an unpowered day there.
function stationWants(state, base, b) {
  if (!stationOperator(state, base, b)) return false;
  if (orderHold(state, base, b)) return false;
  const r = RECIPES[BUILDINGS[b.type].station];
  return Object.entries(r.in).every(([k, v]) => (k === "fresh" || k === "food" ? stockHas(base.stock, k) : base.stock[k] || 0) >= v); // fresh: days of fresh food, every kind (foods.js)
}

// ---------- the refuelling chore ----------
// Who could refuel now: at the base, not in a hospital bed, not resting sick, well enough to work.
export const canRefuel = (state, s) => !!s && s.alive && !s.inBed && workFactor(s) >= 0.35 && !sickRestWhy(state, s);
// The least busy of them: a builder with nothing to build (upkeep), a scavenger around the base, someone resting,
// wood, foraging, the plots and the rest in this order (a builder on a job after the plots); then the best at
// Mechanics, then the lowest id.
const CHORE_ORDER = ["build", "scavenge", "rest", "wood", "forage", "farm", "craft", "read", "trainee", "teach", "guard", "hunt", "fish", "operate", "medic"];
export function refueller(state, base) {
  const busy = (s) => (s.role === "build" && base.construction.length && !s.upkeep ? 6 : (CHORE_ORDER.indexOf(s.role) + 1 || CHORE_ORDER.length + 1));
  return atBase(state, base.id).filter((s) => canRefuel(state, s)).sort((a, b) => busy(a) - busy(b) || skill(b, "mechanics") - skill(a, "mechanics") || a.id - b.id)[0] || null;
}
// Once a day per generator (b.refuelDay) from REFUEL.from: the tanks topped up from the fuel above the reserve by the
// least busy able hand (s.chore marks their half hour; base.refuel says who, for the Power card). Returns the fuel
// poured (0: nothing done this hour; with no fuel to pour or nobody able it is tried again the next hour).
export function refuelChore(state, base) {
  const today = day(state);
  if (hourOfDay(state) < REFUEL.from) return 0;
  const due = generators(base).filter((b) => !b.broken && !switchedOff(base, b) && b.refuelDay !== today && tankOf(b) < genTank(b) - 1e-9);
  if (!due.length) return 0;
  let avail = Math.max(0, (base.stock.fuel || 0) - genReserve(base));
  if (avail < 1e-6) return 0;
  const who = refueller(state, base);
  if (!who) return 0;
  let poured = 0;
  for (const b of due) {
    const add = Math.min(genTank(b) - tankOf(b), avail);
    if (add <= 0) break;
    b.tank = tankOf(b) + add;
    b.refuelDay = today;
    avail -= add;
    poured += add;
  }
  base.stock.fuel = Math.max(0, (base.stock.fuel || 0) - poured);
  who.chore = { what: "refuel", hour: state.hour, base: base.id };
  base.refuel = { day: today, hour: state.hour, by: who.id, name: who.name, fuel: Math.round(poured * 100) / 100 };
  return poured;
}
// The share of this hour a person's work counts: the chore was done in the production step of the hour before
// (world.js runs construction before production), so that builder's next hour is half an hour short.
export const choreShare = (state, s) => (s && s.chore && s.chore.hour === state.hour - 1 ? 1 - REFUEL.hours : 1);

// Supply, demand and who gets power, worked out from the base as it is now (no side effects).
// gens: [{ b, def, off, burned, fueled, ok, running, tank, reason, load, burn }], users: [{ b, need, wants, served, off }].
// load: the power drawn from a running generator; burn: its fuel a day at that load (genBurn).
// A user's draw now: a station while its operator works it, a spotlight at night, a pump on a well (electric.js).
function userWants(state, base, b) {
  if (BUILDINGS[b.type].station) return stationWants(state, base, b);
  if (b.type === "spotlamp") return isNight(state);
  if (b.type === "elec_pump") return pumpServes(base, b);
  if (b.type === "perimeter_alarm") return isNight(state); // the sensors and the siren: dusk to dawn
  if (b.type === "elec_heater") return heaterWants(state, base); // a day that wants heating (electric.js)
  if (b.type === "charging_station") return chargeWanted(state, base); // something here short of charge (electric.js)
  if (b.type === "range") return rangeWanted(state, base); // a bill at the range (appliances.js, #19)
  if (b.type === "microwave") return cookingWanted(state, base); // a bill at any station here
  if (b.type === "grainmill" || b.type === "meatgrinder") return machineWanted(state, base, b.type); // a cook's bill calls for it today (cooking.js; 2026-10-24 grid audit)
  return true;
}
export function powerStatus(state, base) {
  const users = [];
  for (const type of PRIORITY) {
    for (const b of base.buildings) {
      if (b.type !== type) continue;
      const off = switchedOff(base, b);
      const wants = !off && !b.broken && userWants(state, base, b); // a broken one draws nothing (breakdowns.js)
      users.push({ b, need: POWER_USERS[type].need, wants, served: false, off, what: POWER_USERS[type].what });
    }
  }
  // The breaker panel's circuits (electric.js): every wired building's lights and, on a hot or a cold day, its climate.
  if (gridWired(base)) for (const b of base.buildings) {
    const need = circuitNeed(state, base, b);
    if (!need) continue;
    const off = switchedOff(base, b);
    users.push({ b, need, wants: !off && !b.broken, served: false, off, circuit: true, what: circuitWhat(state, base, b) });
  }
  const demand = users.reduce((a, u) => a + (u.wants ? u.need : 0), 0);
  // The sources that burn nothing (2026-10-24; see the header): the sun's power this hour, and what the battery banks
  // can give (each at most BATTERY.rate an hour, no more than it holds). Both count as supply before a generator is
  // started; the bank is drawn last (below).
  const solar = solarOut(state, base);
  // A bank starts giving only once it holds a full hour's rate, and then keeps giving until it is empty (b.giving, set
  // in refreshPower): no flicker at the bottom, where a bank with a dribble in it would give one hour and charge the next.
  const banks = batteries(base).map((b) => ({ b, off: switchedOff(base, b), charge: chargeOf(b), ok: !b.broken && !switchedOff(base, b), can: !b.broken && !switchedOff(base, b) && (b.giving ? chargeOf(b) > 1e-9 : chargeOf(b) >= BATTERY.rate - 1e-9), out: 0, in: 0, reason: b.broken ? "Broken: needs repair (Repairs tab)" : switchedOff(base, b) ? "Switched off" : "" }));
  const battAvail = r1(banks.reduce((a, k) => a + (k.can ? Math.min(BATTERY.rate, k.charge) : 0), 0));
  const gens = generators(base).map((b) => {
    const off = switchedOff(base, b);
    const burned = b.burnHour === state.hour; // it ran this hour already (the hour's fuel paid)
    const fueled = burned || tankOf(b) > 1e-9;
    const reason = b.broken ? "Broken: needs repair (Repairs tab)" : off ? "Switched off" : "";
    return { b, def: genDef(b), off, burned, fueled, ok: !b.broken && !off, running: false, tank: tankOf(b), reason, load: 0, burn: 0 };
  });
  // The fewest that cover the demand (see the header): one that covers what is left before one that does not, then the
  // cheapest for that load, then one that ran already (no flipping between two alike), then the fuller tank.
  const ran = (g) => (g.burned || g.b.burnHour === state.hour - 1 ? 1 : 0);
  const order = [];
  let left = demand - solar - battAvail;
  while (left > 1e-9) {
    const cand = gens.filter((g) => g.ok && g.fueled && !g.running);
    if (!cand.length) break;
    const covers = (g) => (g.def.out >= left ? 1 : 0);
    const cost = (g) => genBurn(g.def, Math.min(left, g.def.out));
    cand.sort((x, y) => covers(y) - covers(x) || (covers(x) ? cost(x) - cost(y) : y.def.out - x.def.out) || ran(y) - ran(x) || y.tank - x.tank);
    const g = cand[0];
    g.running = true;
    g.reason = "Running";
    order.push(g);
    left -= g.def.out;
  }
  for (const g of gens) {
    if (!g.ok || g.running) continue;
    g.reason = left <= 1e-9 ? (demand <= 0 ? "Standby: nothing draws power" : order.length ? "Standby: the other generator covers the demand" : solar >= demand ? "Standby: the sun covers the demand" : "Standby: the battery bank covers the demand") : !g.fueled ? dryWhy(state, base, g.b) : "Standby";
  }
  const supply = r1(solar + battAvail + order.reduce((a, g) => a + g.def.out, 0));
  let room = supply;
  for (const u of users) {
    if (!u.wants || room < u.need - 1e-9) continue;
    u.served = true;
    room -= u.need;
  }
  const served = users.filter((u) => u.served).reduce((a, u) => a + u.need, 0);
  // Who carries the load: the sun first, then each running generator in the order it was started (up to its power), and
  // the battery banks last (the dearest: a fifth is lost in storing it).
  let draw = served;
  const fromSolar = Math.min(solar, draw);
  draw -= fromSolar;
  for (const g of order) { g.load = Math.min(g.def.out, draw); draw -= g.load; g.burn = genBurn(g.def, g.load); }
  let discharge = r1(Math.max(0, Math.min(battAvail, draw)));
  // What is left over and cost nothing: the sun's surplus, and a flat-burn set's unused power (it burns the same whatever
  // it powers). Into the banks, each at most BATTERY.rate an hour and up to its cap; BATTERY.eff of it is kept.
  const free = r1(Math.max(0, solar - fromSolar) + order.filter((g) => g.def.idle === g.def.full).reduce((a, g) => a + Math.max(0, g.def.out - g.load), 0));
  let give = discharge, take = discharge > 0 ? 0 : free;
  for (const k of banks) {
    if (!k.ok) continue;
    if (give > 0 && k.can) { k.out = r1(Math.min(BATTERY.rate, k.charge, give)); give = r1(give - k.out); }
    else if (take > 0) { k.in = r1(Math.min(BATTERY.rate, Math.max(0, BATTERY.cap - k.charge), take)); take = r1(take - k.in); }
    k.reason = k.out > 0 ? `Giving ${k.out} power an hour` : k.in > 0 ? `Charging: +${r1(k.in * BATTERY.eff)} an hour` : k.reason || (k.charge >= BATTERY.cap - 1e-9 ? "Full" : k.charge <= 1e-9 ? "Empty: nothing to spare for it" : k.can ? "Holding" : `Holding: gives again from ${BATTERY.rate} stored`);
  }
  const charging = r1(banks.reduce((a, k) => a + k.in, 0));
  const stored = r1(banks.reduce((a, k) => a + (k.b.broken ? 0 : k.charge), 0)), cap = banks.filter((k) => !k.b.broken).length * BATTERY.cap;
  const fuelPerDay = Math.round(order.reduce((a, g) => a + g.burn, 0) * 100) / 100;
  return { supply, demand, served, gens, users, running: order.length, fuelPerDay, heat: order.reduce((a, g) => a + g.def.heat, 0), solar, banks, battAvail, discharge, charging, stored, cap, sources: base.buildings.filter(isSource) };
}
// Why a generator's tank is dry: no fuel above the reserve, refuelled today already, nobody able here, or before 06:00.
export function dryWhy(state, base, b) {
  const above = (base.stock.fuel || 0) - genReserve(base);
  if (above < 1e-6) return genReserve(base) > 0 ? `Tank dry: no fuel above the ${genReserve(base)} kept back` : "Tank dry: no fuel here";
  if (b.refuelDay === day(state)) return "Tank dry: refuelled today already (again tomorrow morning)";
  if (!atBase(state, base.id).some((s) => canRefuel(state, s))) return "Tank dry: nobody able here to refuel it";
  return `Tank dry: refuelled from ${String(REFUEL.from).padStart(2, "0")}:00`;
}

// The hour of power at a base: the refuelling chore, then the running generators burn their hour's fuel from the tank
// (once an hour: b.burnHour), and the result is cached on the base (base.power). Safe to call more than once an hour.
export function refreshPower(state, base) {
  if (!base.buildings.some((b) => isGen(b) || isSource(b) || POWER_USERS[b.type] || b.type === "breaker")) { base.power = null; if (base.freezerOn) base.freezerOn = false; return null; }
  refuelChore(state, base);
  const ps = powerStatus(state, base);
  for (const g of ps.gens) {
    if (!g.running || g.burned) continue;
    g.b.tank = Math.max(0, tankOf(g.b) - g.burn / 24); // its tier's burn at the load it carries (genBurn)
    if (g.b.tank < 1e-9) g.b.tank = 0;
    g.b.burnHour = state.hour;
    g.b.lastRan = state.hour; // breakdowns.js: it ran in the last day (wear, spares)
    g.burned = true;
  }
  // The battery banks' hour (2026-10-24): what each gave comes off its charge, what it took goes in at BATTERY.eff; once
  // an hour (b.cycleHour). A bank that cycled ran today (b.ran: breakdowns.js ranDay wear).
  for (const k of ps.banks) {
    if (!k.ok || k.b.cycleHour === state.hour || (k.out <= 0 && k.in <= 0)) continue;
    k.b.charge = r1(Math.max(0, Math.min(BATTERY.cap, k.charge - k.out + k.in * BATTERY.eff)));
    k.b.cycleHour = state.hour;
    k.b.ran = day(state);
    if (k.out > 0) k.b.giving = k.b.charge > 1e-9; // it keeps giving until empty (the hysteresis in powerStatus)
    else if (k.in > 0) delete k.b.giving; // charging: it gives again from a full hour's rate
  }
  base.power = {
    day: day(state), supply: ps.supply, demand: ps.demand, running: ps.running, heat: ps.heat, fuel: ps.fuelPerDay,
    gens: ps.gens.filter((g) => g.running).map((g) => g.b.id),
    served: ps.users.filter((u) => u.served).map((u) => u.b.id),
    solar: ps.solar, battery: { stored: ps.stored, cap: ps.cap, out: ps.discharge, in: ps.charging },
  };
  // The charging station's hour (electric.js chargeHour): a powered one tops up the most drained rechargeable item here.
  for (const b of base.buildings) if (b.type === "charging_station") chargeHour(state, base, b);
  freezerSwitch(state, base, ps);
  return ps;
}
// Did this generator run in the last day (breakdowns.js: its wear and spares)?
export const generatorRanToday = (state, b) => b.lastRan != null && state.hour - b.lastRan < 24;

// ---------- the walk-in freezer (freezer-parts) ----------
export const freezers = (base) => base.buildings.filter((b) => b.type === "freezer");
// Why a freezer is off, from a powerStatus (ps): "" when it is on.
export function freezerOffWhy(base, b, ps) {
  if (b.broken) return "it is broken (Repairs tab)";
  if (switchedOff(base, b)) return "its power is switched off";
  const u = ps.users.find((x) => x.b === b);
  if (u && u.served) return "";
  const gens = ps.gens;
  if (!gens.length && !ps.sources.length) return "there is no generator";
  if (!gens.length) return ps.solar > 0 ? `the sun gives only ${ps.solar} power and the battery bank is ${ps.cap ? "drained" : "not there"}` : `it is night: no sun, and the battery bank is ${ps.cap ? "drained" : "not there"}`;
  const live = gens.filter((g) => !g.b.broken);
  if (!live.length) return "the generator is broken";
  if (live.every((g) => g.off)) return "the generator is switched off";
  if (gens.every((g) => !g.running) && gens.some((g) => /^Tank dry/.test(g.reason))) return `the generator's tank is dry (${gens.find((g) => /^Tank dry/.test(g.reason)).reason.replace(/^Tank dry: /, "")})`;
  return `there is not enough power (${ps.supply} supply for ${ps.demand} wanted)`;
}
// base.freezerOn / base.freezersOn and the log when it goes off or on again.
function freezerSwitch(state, base, ps) {
  const list = freezers(base);
  if (!list.length) { if (base.freezerOn != null) { delete base.freezerOn; delete base.freezersOn; delete base.freezerOffSince; delete base.freezerOffLogged; } return; }
  const on = list.filter((b) => isPowered(base, b) && !b.broken).length;
  const was = base.freezerOn;
  base.freezerOn = on > 0;
  base.freezersOn = on;
  const today = day(state);
  // One line when an outage starts and one when it ends: the off line once it has lasted into a second hour (a new
  // freezer waiting for the morning's refuelling says nothing), at most one a day; the back-on line only after an off line.
  if (on) delete base.freezerOffSince;
  else if (base.freezerOffSince == null) base.freezerOffSince = state.hour;
  if (!on && !base.freezerOffLogged && state.hour - base.freezerOffSince >= 1 && base.freezerLogDay !== today) {
    base.freezerLogDay = today;
    base.freezerOffLogged = true;
    log(state, `❄ The freezer at ${base.name} is off: ${freezerOffWhy(base, list[0], ps)}. The food in it is thawing (it keeps only as in a pantry until the power is back).`, "danger");
  } else if (on && was === false && base.freezerOffLogged) {
    delete base.freezerOffLogged;
    log(state, `❄ The freezer at ${base.name} is cold again.`, "good");
  }
}
// One line for the base's buildings view: "On: 2 power, 300 room" / "Off: the generator's tank is dry (thawing)".
export function freezerLine(state, base) {
  const list = freezers(base);
  if (!list.length) return "";
  const ps = powerStatus(state, base);
  const on = list.filter((b) => isPowered(base, b) && !b.broken).length;
  const room = list.length * 300;
  if (on === list.length) return `On: ${on * POWER_USERS.freezer.need} power, ${room} room keeping cold`;
  const why = freezerOffWhy(base, list.find((b) => !(isPowered(base, b) && !b.broken)), ps);
  return `${on ? `${on} of ${list.length} on` : "Off"}: ${why} (the food in it keeps only as in a pantry)`;
}
// The vacuum sealer hook (freezer-parts; the cooking wave's packaged survival meals): built, powered, not broken.
export const hasSealer = (state, base) => !!base && base.buildings.some((b) => b.type === "sealer" && !b.broken && isPowered(base, b));

// Readers (cheap, from the cache): is this building powered, is any building of a type powered?
export const isPowered = (base, b) => !!(base && base.power && b && base.power.served.includes(b.id));
// The sun's power this hour and the banks' charge (from the cache; 2026-10-24).
export const solarNow = (base) => (base && base.power && base.power.solar) || 0;
export const batteryStored = (base) => (base && base.power && base.power.battery ? base.power.battery : { stored: 0, cap: 0, out: 0, in: 0 });
export const poweredType = (base, type) => !!(base && base.power && base.buildings.some((b) => b.type === type && base.power.served.includes(b.id)));
export const generatorRunning = (base, b) => !!(base && base.power && base.power.gens.includes(b.id));
// Engine noise for hordes.js baseHeat.
export const generatorHeat = (base) => (base && base.power ? base.power.heat ?? base.power.gens.length * POWER.genHeat : 0); // by tier (GEN_TIERS heat)
// Extra radio coverage for radio.js.
export const radioBoost = (base) => (poweredType(base, "radio") ? RADIO_BOOST : 0);

// A generator's line for the Power card: "Running: 2 of 12 power, 2.46 fuel a day · tank 1.4 of 5" / "Tank dry: ...".
export function generatorLine(state, base, b, ps = powerStatus(state, base)) {
  const g = ps.gens.find((x) => x.b === b);
  const tank = `tank ${Math.round(tankOf(b) * 10) / 10} of ${genTank(b)} fuel`;
  if (!g) return tank;
  return g.running ? `Running: ${g.load} of ${g.def.out} power, ${Math.round(g.burn * 100) / 100} fuel a day · ${tank}` : `${g.reason || "Standby"} · ${tank}`;
}
// "Tier 2 of 3: 12 power, 2.25–3.5 fuel a day (by the load), tank 5, +6 Heat" (the Power card, the Buildings tab).
export const genTierText = (def, t) => `Tier ${t} of ${GEN_TIERS.length - 1}: ${def.out} power, ${def.idle === def.full ? `${def.full} fuel a day running` : `${def.idle}–${def.full} fuel a day (by the load)`}, tank ${def.tank}, +${def.heat} Heat`;

// ---------- the governor's upgrade (autopilot.js autoGenUpgrade; the AI groups: groupworks.js) ----------
// The generators' power if all of them ran (broken ones too: they are repaired), and the one to upgrade (the lowest tier
// that is not broken, has no upgrade queued and has a tier above it), or null.
export const genCapacity = (base) => generators(base).reduce((a, b) => a + genDef(b).out, 0);
export function genToUpgrade(base) {
  const list = generators(base).filter((b) => b.type === "generator" && !b.broken && genTier(b) < GEN_TIERS.length - 1 && !base.construction.some((c) => c.target === b.id));
  return list.sort((x, y) => genTier(x) - genTier(y) || x.id - y.id)[0] || null;
}
// The fuel a day the base's generators (not broken) would burn carrying `need` power, the biggest first: as they are,
// or with `up` upgraded a tier.
export function genFuelFor(base, need, up = null) {
  const defs = generators(base).filter((b) => !b.broken).map((b) => (b === up && !isGenset(b) ? GEN_TIERS[genTier(b) + 1] : genDef(b))).sort((x, y) => y.out - x.out);
  let left = need, fuel = 0;
  for (const d of defs) { if (left <= 0) break; const load = Math.min(d.out, left); fuel += genBurn(d, load); left -= load; }
  return fuel;
}
// Never into a fuel deficit (the brief: "fuel income vs burn over the season, including the winter heating need"):
//   flows: the base's fuel a day in (income) and out over the last weeks (the caller: autopilot.js from history.js; the
//     generators, the cars, the heating and the floodlights are all in the out; the AI groups': groupworks.js);
//   extra: what the upgrade adds to the generators' burn at the demand it is for (genFuelFor);
//   ok when income − out − extra ≥ 0 (the fuel does not run down with the bigger burn) and the fuel above the floor
//   (the governor's fuel floor: the winter's heating still to come, the cars' and floodlights' 10, the hive campaign's
//   fires) covers GEN_UP.days of the extra (a bad month does not stop the power).
// Returns { ok, why, income, out, extra, spare }.
export const GEN_UP = { window: 28, minDays: 7, days: 30 };
export function genUpgradeFuelOk(base, need, up, floor = 0, flows = { income: 0, out: 0 }, stock = base.stock.fuel || 0) {
  const extra = Math.max(0, genFuelFor(base, need, up) - genFuelFor(base, need));
  const net = flows.income - flows.out - extra;
  const spare = stock - floor;
  const r = (v) => Math.round(v * 100) / 100;
  const out = { income: flows.income, out: flows.out, extra, spare };
  if (net < -1e-9) return { ok: false, why: `fuel a day: ${r(flows.income)} in, ${r(flows.out)} out; ${r(extra)} more for the generator would run it down`, ...out };
  if (spare < extra * GEN_UP.days - 1e-9) return { ok: false, why: `${Math.floor(Math.max(0, spare))} fuel above the floor: not ${GEN_UP.days} days of the ${r(extra)} more a day`, ...out };
  return { ok: true, why: "", ...out };
}

// One line for the Buildings tab and the base screens.
export function powerLine(state, base) {
  if (!generators(base).length && !base.buildings.some((b) => isSource(b) || POWER_USERS[b.type] || b.type === "breaker")) return "No generator";
  const ps = powerStatus(state, base);
  const srcs = `${ps.sources.some((b) => b.type === "solar_array") ? ` · the sun ${ps.solar}` : ""}${ps.cap ? ` · battery ${ps.stored} of ${ps.cap} stored` : ""}`; // 2026-10-24: the sources that burn nothing
  if (!generators(base).length) return ps.sources.length ? `${ps.supply} supply / ${ps.demand} demand · no generator${srcs}` : `No generator (${ps.demand} power wanted)`;
  const tiers = generators(base).map((b) => (isGenset(b) ? genName(b).toLowerCase() : `tier ${genTier(b)}`)).join(" + ");
  return `${ps.supply} supply / ${ps.demand} demand · ${ps.running} of ${generators(base).length} generator${generators(base).length === 1 ? "" : "s"} running (${tiers}; ${ps.fuelPerDay} fuel a day, +${ps.heat} Heat)${srcs}`;
}

// What a base could draw if every powered building it has were at work (the governor's look-ahead).
export function powerWanted(state, base, staffed = () => false) {
  let need = 0;
  for (const b of base.buildings) {
    const u = POWER_USERS[b.type];
    if (!u || switchedOff(base, b)) continue;
    if (BUILDINGS[b.type].station && !staffed(b)) continue;
    need += u.need;
  }
  if (gridWired(base)) for (const b of base.buildings) if (!switchedOff(base, b)) need += circuitNeed(state, base, b); // electric.js: the wired buildings
  return need;
}

// ---------- saves from before the tiers (save.js, once: state.genTiersV) ----------
// Every generator standing is a portable set (tier 1), and an AI group's generator too (groupworks.js w.powerTier).
export function migrateGenTiers(state) {
  for (const base of state.bases || []) for (const b of generators(base)) if (b.type === "generator" && !(b.tier >= 1)) b.tier = 1;
  for (const f of state.factions || []) for (const w of Object.values(f.works || {})) if (w && w.power && !(w.powerTier >= 1)) w.powerTier = 1;
}

// ---------- saves from before machines-2 (save.js, once: state.machinesV) ----------
// The generator was a workshop station with an operator. Anyone operating one (or parked off it by an order) goes back
// to their next job: another free station if there is one (assignStations), else the Build role (builders with nothing
// to build do the upkeep); people on work priorities get theirs from the planner the next hour. The operator-day mark
// goes; a generator that had today's fuel paid keeps it in its tank. A standing order on a generator becomes the
// base's fuel reserve (Keep at least N fuel) or its power switch (Off); fallbacks onto a generator go to Idle.
export function migrateGenerators(state) {
  const today = day(state);
  for (const base of state.bases || []) {
    const gens = generators(base);
    const ids = new Set(gens.map((b) => b.id));
    delete base.genKeeper;
    for (const b of gens) {
      if (b.fueled === today && b.tank == null) b.tank = POWER.genFuel; // the day's fuel it was paid
      delete b.fueled; delete b.opDay;
      const o = base.orders && base.orders[b.id];
      if (o) {
        if (o.mode === "keep" && (o.key || "fuel") === "fuel" && o.n > 0 && !(base.genReserve && base.genReserve.by === "player")) base.genReserve = { n: Math.floor(o.n), by: o.by === "player" ? "player" : "ai" };
        else if (o.mode === "off") { base.powerOff = base.powerOff || {}; base.powerOff[b.id] = true; }
        delete base.orders[b.id];
      }
    }
    for (const o of Object.values(base.orders || {})) if (o && typeof o.fallback === "string" && o.fallback.startsWith("st:") && ids.has(Number(o.fallback.slice(3)))) o.fallback = "idle";
    if (!ids.size) continue;
    let moved = false;
    for (const s of state.survivors || []) {
      if (s.parked && (ids.has(s.parked.from) || (typeof s.parked.as === "string" && ids.has(Number(s.parked.as.slice(3)))))) s.parked = null;
      if (s.role === "operate" && ids.has(s.station)) { s.station = null; moved = true; }
      if (s.govWatch && ids.has(s.govWatch.station)) s.govWatch = { role: "build", station: null };
    }
    if (!moved) continue;
    assignStations(state, base); // a free station takes them
    for (const s of atBase(state, base.id)) if (s.role === "operate" && s.station == null) s.role = "build";
  }
}
