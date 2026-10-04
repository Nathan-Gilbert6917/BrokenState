// Power (suggestions-2 #5): generators burn fuel to power a handful of buildings, and an ethanol still turns surplus
// or spoiled food into that fuel. Machines still need people: a generator needs an operator (the Operate role, like
// any workshop station) and so does every powered station; nothing runs by itself.
//
//   Generator (station "power"): with an operator it gives POWER.genOut (6) power for POWER.genFuel (2) fuel a day.
//     It only starts when something draws power, and only as many generators run as the demand needs. The fuel for
//     a day is burned when it starts (at the daily tick, or the hour demand appears) and keeps it running until the
//     next daily tick. A running generator is loud: +POWER.genHeat (4) Heat at the base on top of the usual
//     workshop noise (hordes.js baseHeat).
//   Ethanol still (station "still", buildings.js RECIPES.still): an operator turns 8 food + 2 water into 3 fuel a
//     day; up to STILL.mash (4) of the food can be yesterday's spoiled food (storage.js keeps it as mash).
//   Users (POWER_USERS, need in power units, served in this order while the supply lasts):
//     cold store 1 (a freezer: keeps food as in winter all year, storage.js), radio station 1 (+2 tiles of
//     coverage, radio.js), floodlights 1 (no fuel burned per attack, defences.js), machine shop 2 (2 parts a day
//     from 9 scrap instead of 1 from 6), preserving kitchen 1 (half as much again a day).
//     Workshop stations draw only while their operator is at work (an order that holds them, or no operator, draws
//     nothing). Each building can be switched off by hand (base.powerOff[id]).
// The result is cached on the base (base.power: supply, demand, served building ids, running generators) every hour
// (production.js productionHour) and before the stations run each day, so storage, radio and defences read it
// cheaply. A base that never refreshed has no power.
import { BUILDINGS, RECIPES, stationOperator } from "./buildings.js";
import { day } from "./world.js";
import { orderHold } from "./production.js";

export const POWER = { genOut: 6, genFuel: 2, genHeat: 4 };
export const STILL = { mash: 4 };
export const POWER_USERS = {
  coldstore:    { need: 1, what: "a freezer: food keeps as in winter (0.2% a day) in every season" },
  radio:        { need: 1, what: "+2 tiles of radio coverage" },
  floodlights:  { need: 1, what: "no fuel burned when a horde attacks" },
  machine_shop: { need: 2, what: "power tools: 2 parts a day from 9 scrap (1 from 6 without)" },
  kitchen:      { need: 1, what: "an electric stove: half as much again a day (14 food → 12 preserved)" },
};
// Powered stations: inputs and outputs multiplied (rounded) while they are served.
export const POWER_BOOST = { machine_shop: { in: 1.5, out: 2 }, kitchen: { in: 1.5, out: 1.5 } };
export const RADIO_BOOST = 2;
const PRIORITY = Object.keys(POWER_USERS);

const isGen = (b) => BUILDINGS[b.type] && BUILDINGS[b.type].station === "power";
export const generators = (base) => base.buildings.filter(isGen);
export const switchedOff = (base, b) => !!(base.powerOff && base.powerOff[b.id]);

// A powered workshop station wants power while its operator works it: someone on it, no order holding it, and the
// inputs for an unpowered day there.
function stationWants(state, base, b) {
  if (!stationOperator(state, base, b)) return false;
  if (orderHold(state, base, b)) return false;
  const r = RECIPES[BUILDINGS[b.type].station];
  return Object.entries(r.in).every(([k, v]) => (base.stock[k] || 0) >= v);
}

// Supply, demand and who gets power, worked out from the base as it is now (no side effects).
// gens: [{ b, op, fueled, ok, running, reason }], users: [{ b, need, wants, served, off }].
export function powerStatus(state, base) {
  const today = day(state);
  const users = [];
  for (const type of PRIORITY) {
    for (const b of base.buildings) {
      if (b.type !== type) continue;
      const off = switchedOff(base, b);
      const wants = !off && (BUILDINGS[type].station ? stationWants(state, base, b) : true);
      users.push({ b, need: POWER_USERS[type].need, wants, served: false, off });
    }
  }
  const demand = users.reduce((a, u) => a + (u.wants ? u.need : 0), 0);
  let fuel = base.stock.fuel || 0;
  const gens = generators(base).map((b) => {
    const op = stationOperator(state, base, b);
    const hold = orderHold(state, base, b);
    const fueled = b.fueled === today;
    const reason = !op ? "No operator" : hold || "";
    return { b, op, fueled, ok: !!op && !hold, running: false, reason };
  });
  // Generators already fuelled today go first; the rest start only if the fuel is there.
  let needed = Math.ceil(demand / POWER.genOut);
  for (const g of [...gens].sort((x, y) => Number(y.fueled) - Number(x.fueled))) {
    if (!g.ok) continue;
    if (needed <= 0) { g.reason = demand > 0 ? "Standby: the other generator covers the demand" : "Standby: nothing draws power"; continue; }
    if (!g.fueled) {
      if (fuel < POWER.genFuel) { g.reason = `Waiting for fuel (${POWER.genFuel} a day)`; continue; }
      fuel -= POWER.genFuel;
    }
    g.running = true;
    g.reason = "Running";
    needed--;
  }
  const running = gens.filter((g) => g.running);
  const supply = running.length * POWER.genOut;
  let left = supply;
  for (const u of users) {
    if (!u.wants || left < u.need) continue;
    u.served = true;
    left -= u.need;
  }
  return { supply, demand, served: users.filter((u) => u.served).reduce((a, u) => a + u.need, 0), gens, users, running: running.length, fuelPerDay: running.length * POWER.genFuel, heat: running.length * POWER.genHeat };
}

// Burns the fuel of generators that start now and caches the result on the base (base.power).
export function refreshPower(state, base) {
  if (!base.buildings.some((b) => isGen(b) || POWER_USERS[b.type])) { base.power = null; return null; }
  const ps = powerStatus(state, base);
  const today = day(state);
  for (const g of ps.gens) {
    if (!g.running || g.fueled) continue;
    base.stock.fuel = Math.max(0, (base.stock.fuel || 0) - POWER.genFuel);
    g.b.fueled = today;
    g.fueled = true;
  }
  base.power = {
    day: today, supply: ps.supply, demand: ps.demand, running: ps.running,
    gens: ps.gens.filter((g) => g.running).map((g) => g.b.id),
    served: ps.users.filter((u) => u.served).map((u) => u.b.id),
  };
  return ps;
}

// Readers (cheap, from the cache): is this building powered, is any building of a type powered?
export const isPowered = (base, b) => !!(base && base.power && b && base.power.served.includes(b.id));
export const poweredType = (base, type) => !!(base && base.power && base.buildings.some((b) => b.type === type && base.power.served.includes(b.id)));
export const generatorRunning = (base, b) => !!(base && base.power && base.power.gens.includes(b.id));
// Engine noise for hordes.js baseHeat.
export const generatorHeat = (base) => (base && base.power ? base.power.gens.length * POWER.genHeat : 0);
// Extra radio coverage for radio.js.
export const radioBoost = (base) => (poweredType(base, "radio") ? RADIO_BOOST : 0);

// The generator's row in the Workshops tab (buildings.js stationStatus delegates here).
export function generatorStatus(state, base, st, op) {
  const ps = powerStatus(state, base);
  const g = ps.gens.find((x) => x.b.id === st.id);
  const running = generatorRunning(base, st) || (g && g.running && g.fueled);
  const hold = orderHold(state, base, st);
  const reason = running ? `Running: ${POWER.genOut} power${g && g.fueled ? " (fuelled for today)" : ""}` : (g && g.reason) || "Standby";
  return { op, running: !!running, idle: !running && (!!hold || /^Standby/.test(reason)), reason, recipe: "power", in: { fuel: POWER.genFuel }, out: {} };
}

// One line for the Buildings tab and the base screens.
export function powerLine(state, base) {
  if (!generators(base).length && !base.buildings.some((b) => POWER_USERS[b.type])) return "No generator";
  const ps = powerStatus(state, base);
  if (!generators(base).length) return `No generator (${ps.demand} power wanted)`;
  return `${ps.supply} supply / ${ps.demand} demand · ${ps.running} of ${generators(base).length} generator${generators(base).length === 1 ? "" : "s"} running (${ps.fuelPerDay} fuel a day, +${ps.heat} Heat)`;
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
  return need;
}
