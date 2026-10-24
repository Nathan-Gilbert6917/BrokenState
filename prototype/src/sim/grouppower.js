// @ts-check
// The AI groups' power budget by the hour (2026-10-24, the user's request: "Both players and AI groups should build
// these [the solar panel array, battery bank, perimeter alarm, electric heaters and charging station, plus the rest of
// the grid] and fix and implement any machine power needs and power output and setting up power grids for the base";
// docs/adr/0001-ai-parity.md: your rules with your numbers, coarse where the groups are abstract). groupworks.js
// groupMachinesDaily calls powerDayBudget once a day for each base with a machine or a source; this module is the
// arithmetic only (no group state), so it reads as power.js powerStatus does, hour by hour:
//   - the day budgeted is the day the midnight tick starts (dayIdx = the hour ÷ 24 of the tick: factions.js's
//     `today − 1`, the same day its wood burn for heating is for), its 24 hours from 00:00;
//   - the demand each hour, in your priority order (power.js POWER_USERS): the walk-in freezer 2 all day, the vacuum
//     sealer 1 all day, the perimeter alarm ALARM.need from GRID.alarm[0] to GRID.alarm[1] (20:00–06:00, your dusk to
//     dawn), the electric heaters HEATER.need each all day on a day that wants heating (upkeep.js heatRate for that
//     day), the charging station CHARGER.need in the GRID.charger hours (08:00–20:00: coarse, your station draws
//     while something here is short of charge; theirs charges by day);
//   - the supply each hour, the sources in your order: the sun first (arrays × SOLAR.out × electric.js solarFactor for
//     that hour at the base's tile: the season, the sky, the low sun), then the generator at its tier, started only when
//     the sun and what the battery bank can give do not cover the demand (left = demand − solar − battAvail, as
//     powerStatus starts the fewest generators), and the bank last (BATTERY.cap × banks stored, at most BATTERY.rate ×
//     banks an hour in or out; it gives only once it holds BATTERY.rate and then until it is empty: your hysteresis,
//     b.giving); the users are served in order while the supply lasts;
//   - the bank charges only from power that costs nothing: the sun's surplus and the unused power of a running
//     flat-burn set (GEN_TIERS[1]: idle === full; a governed set never burns more to charge it), BATTERY.eff of what goes
//     in is kept;
//   - fuel: genBurn(def, load) ÷ 24 for each hour the generator runs, from the group's fuel while there is any (the last
//     of it runs the hour); no fuel, no generator.
// The result (groupworks.js keeps it on the works as w.powerDay) is power-hours over the day: demand, served, solar
// (drawn from the sun), gen (drawn from the generator), bank (drawn from the bank), charged (put into the bank), burn
// (fuel), genHours, servedHours and wantedHours per user key, heaterUnitHours (heater-hours served: the heads warmed),
// chargeHours, short (power-hours wanted and not served), charge and giving (the bank after the day), cycled (the bank
// gave or took today: its wear day), storm (a storm or a blizzard over the base today: the array's wear).
import { SOLAR, BATTERY, ALARM, HEATER, CHARGER } from "./data-power.js";
import { POWER_USERS, GEN_TIERS, genBurn } from "./power.js";
import { solarFactor } from "./electric.js"; // the sun's share of SOLAR.out that hour at a tile (call-time only)
import { heatRate } from "./upkeep.js"; // a day that wants heating (the heaters draw)
import { weatherAt } from "./weather.js"; // a storm over the base (the array's wear)

export const GRID = {
  alarm: [20, 6], // the alarm's hours (your dusk to dawn: world.js isNight)
  charger: [8, 20], // the station's hours (coarse: by day, half the hours)
  onShare: 0.75, // a machine counts "on" today when served this share of the hours it wanted (the freezer: 18 of 24)
};
const r1 = (v) => Math.round(v * 10) / 10;
export const alarmHour = (h) => h >= GRID.alarm[0] || h < GRID.alarm[1];
/** The day wants heating (upkeep.js heatRate for that day: freezing, or a chill night): the heaters draw. @param {any} state @param {number} dayIdx */
export const heatingDay = (state, dayIdx) => heatRate(state, dayIdx) > 0;
const chargerHour = (h) => h >= GRID.charger[0] && h < GRID.charger[1];

/**
 * The users at a base for the day, in your priority order (POWER_USERS' key order), one entry a unit: the freezer, the
 * sealer, the alarm, each heater, the charger. have(k): how many of works key k stand there and are not broken.
 * heating: the day wants heating (the heaters draw). Each: { k (the works key), need, want(h) }.
 * @param {(k: string) => number} have @param {boolean} heating
 */
export function gridUsers(have, heating) {
  const users = [];
  if (have("freezer")) users.push({ k: "freezer", need: POWER_USERS.freezer.need, want: () => true });
  if (have("sealer")) users.push({ k: "sealer", need: POWER_USERS.sealer.need, want: () => true });
  if (have("alarm")) users.push({ k: "alarm", need: ALARM.need, want: alarmHour });
  for (let i = 0; i < have("heaters"); i++) users.push({ k: "heaters", need: HEATER.need, want: () => heating });
  if (have("charger")) users.push({ k: "charger", need: CHARGER.need, want: chargerHour });
  return users;
}

/**
 * The day's budget, hour by hour (see the header). Pure but for reading the world's weather.
 * @param {any} state @param {number} tile the base's tile (electric.js solarFactor reads only base.tile) @param {number} dayIdx the day (hour ÷ 24)
 * @param {{ users: { k: string, need: number, want: (h: number) => boolean }[], arrays: number, banks: number, charge?: number, giving?: boolean, tier: number, fuel: number }} spec
 *   arrays / banks: solar arrays and battery banks standing and not broken; charge: the banks' pooled charge (power-hours);
 *   tier: the generator's tier (power.js GEN_TIERS; 0: none or broken); fuel: the group's fuel.
 */
export function powerDayBudget(state, tile, dayIdx, spec) {
  const def = spec.tier > 0 ? GEN_TIERS[spec.tier] : null;
  const genOut = def ? def.out : 0;
  const banks = Math.max(0, spec.banks || 0), arrays = Math.max(0, spec.arrays || 0);
  const cap = BATTERY.cap * banks, rate = BATTERY.rate * banks;
  let charge = Math.max(0, Math.min(cap, Number(spec.charge) || 0)), giving = !!spec.giving && charge > 1e-9;
  let fuel = Math.max(0, Number(spec.fuel) || 0);
  const out = { demand: 0, served: 0, solar: 0, gen: 0, bank: 0, charged: 0, burn: 0, genHours: 0, servedHours: {}, wantedHours: {}, heaterUnitHours: 0, chargeHours: 0, short: 0, charge: 0, giving: false, cycled: false, storm: false, heating: false, solarMade: 0 };
  out.heating = heatingDay(state, dayIdx); // (the caller built the users with the same answer: gridUsers)
  const w = weatherAt(state, tile, dayIdx * 24 + 12);
  out.storm = !!w && ["storm", "blizzard"].includes(w.key);
  for (let h = 0; h < 24; h++) {
    const abs = dayIdx * 24 + h;
    const want = spec.users.filter((u) => u.want(h));
    const demand = want.reduce((a, u) => a + u.need, 0);
    for (const u of want) out.wantedHours[u.k] = (out.wantedHours[u.k] || 0) + 1;
    out.demand += demand;
    const solar = arrays ? r1(arrays * SOLAR.out * solarFactor(state, { tile }, abs)) : 0;
    out.solarMade += solar;
    // The bank gives only from BATTERY.rate stored, then until empty (your b.giving).
    const can = banks > 0 && (giving ? charge > 1e-9 : charge >= BATTERY.rate - 1e-9);
    const battAvail = can ? r1(Math.min(rate, charge)) : 0;
    const left = demand - solar - battAvail;
    const genOn = left > 1e-9 && genOut > 0 && fuel > 1e-6;
    const supply = solar + battAvail + (genOn ? genOut : 0);
    let room = supply, served = 0;
    for (const u of want) {
      if (room < u.need - 1e-9) continue;
      room -= u.need; served += u.need;
      out.servedHours[u.k] = (out.servedHours[u.k] || 0) + 1;
      if (u.k === "heaters") out.heaterUnitHours++;
      if (u.k === "charger") out.chargeHours++;
    }
    out.served += served;
    out.short += demand - served;
    // Who carries it: the sun, then the generator up to its power, then the bank.
    let draw = served;
    const fromSolar = Math.min(solar, draw);
    draw -= fromSolar;
    const load = genOn ? Math.min(genOut, draw) : 0;
    draw -= load;
    const discharge = r1(Math.max(0, Math.min(battAvail, draw)));
    out.solar += fromSolar; out.gen += load; out.bank += discharge;
    if (genOn && def) {
      const b = genBurn(def, load) / 24;
      const burned = Math.min(fuel, b);
      fuel -= burned; out.burn += burned; out.genHours++;
    }
    // Into the bank: the sun's surplus and a flat-burn set's unused power, never while it gives.
    const free = r1(Math.max(0, solar - fromSolar) + (genOn && def && def.idle === def.full ? Math.max(0, genOut - load) : 0));
    const take = banks && discharge <= 0 ? r1(Math.min(rate, Math.max(0, cap - charge), free)) : 0;
    charge = Math.max(0, Math.min(cap, charge - discharge + take * BATTERY.eff));
    out.charged += take * BATTERY.eff;
    if (discharge > 0 || take > 0) out.cycled = true;
    if (discharge > 0) giving = charge > 1e-9;
    else if (charge <= 1e-9) giving = false;
  }
  out.charge = charge; out.giving = giving;
  return out;
}
/** Served this share of the hours it wanted today (GRID.onShare): the machine counts as on. @param {any} pd @param {string} k */
export const servedToday = (pd, k) => !!pd && (pd.wantedHours[k] || 0) > 0 && (pd.servedHours[k] || 0) >= GRID.onShare * pd.wantedHours[k] - 1e-9;
