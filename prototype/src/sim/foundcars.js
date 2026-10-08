// Cars found on a map (any battle or raid map: the cars on a road, a wreck pile, a garage's, the Army trucks of
// miltrucks.js): get in, find the keys or hotwire it, inspect it, and claim the few that run (or can be made to).
//
// On the map (combat.js combatAct "car", act.op), from next to the car, 1 action each:
//   enter    open the door. Some are locked (LOCKED by model; an Army truck never): pick it (lockpicks), force it (a
//            pry bar: loud) or break the glass (no tool: both actions, loudest). The odds and the noise are the locks
//            (locks.js openOdds, PICK / FORCE / SMASH). A car that is also a raid container shares its lock.
//   keys     look for the keys: the sun visor, the glovebox, the dead lying near it (KEYS by model, + BODY_KEYS with a
//            body within 6 cells). Once per car.
//   hotwire  a Mechanics check (HOTWIRE: older cars are easier), retried as often as you like (Heat +1 a try on a raid).
//            An Army truck has a start switch: no key, no wiring.
//   inspect  the engine, the tyres, the battery and the fuel: it runs, it can be fixed (parts, scrap, a Mechanics level
//            and hours: repairOf), or it is scrap. Most are dead (COND); a few run.
//   siphon   the fuel in its tank: into your vehicle on the map, else into the team's cans.
//   claim    one that runs or can be fixed, once it can be started (keys, hotwired or a start switch): it becomes a
//            vehicle record (vehicles.js createVehicle) parked on the tile, with a map marker. When the battle ends
//            (settleClaims) one that runs joins the team if it has no vehicle (or the base, defending it); otherwise
//            it stays parked for a team to collect (parties.js "Recover vehicle").
// On the State Map (parties.js orderOptions / recoverVehicle, orders.js tasks):
//   repair   a found vehicle that needs work: the team works on it on the tile for the hours it needs (the "fixcar"
//            task: exposed, fieldheat.js), with its parts and scrap; then a Mechanics check (fixChance). A failure wastes
//            half the parts and can be tried again; too low a Mechanics level says what is needed.
//   drive it home  a team that already has a vehicle sends one of its people home in the found one (driveHome).
// Dice: hash01 (skills.js), never the world's or the battle's random numbers.
import { log, survivorById, skill, newId, hub, baseById } from "./world.js";
import { hash01, gainXp, USE } from "./skills.js";
import { openOdds, picksOf, PICK, FORCE, SMASH } from "./locks.js";
import { createVehicle, vehicleById, isCar, tank, VEHICLE_TYPES, partyVehicle, fitMilitary } from "./vehicles.js";
import { markTaken } from "./miltrucks.js"; // (names below are literal: the modules load in a circle)
import { markAbandonedVehicle } from "./markers.js";
import { partyMembers, partyTile, carried, takeSupply, cargoRoom, unitsThatFit, weighTeam, awaitOrders, startReturn, tileLabel, bestSkill, teamName } from "./parties.js";
import { startTask } from "./orders.js";
import { SUPPLIES } from "./data.js";

export const CARS = {
  // Doors locked, keys left in it (visor, glovebox), by model; BODY_KEYS more with one of the dead lying near.
  LOCKED: { sedan: 0.5, van: 0.45, pickup: 0.45, boxtruck: 0, cargo: 0, humvee: 0, mrap: 0 },
  KEYS: { sedan: 0.3, van: 0.3, pickup: 0.35, boxtruck: 0 },
  BODY_KEYS: 0.2, BODY_RANGE: 6,
  // Hotwiring: base + perMech a Mechanics point (+old for an old car), at most max; Heat +heat a try on a raid.
  HOTWIRE: { base: 0.15, perMech: 0.06, old: 0.15, max: 0.9, heat: 1 },
  // A tile where a car was claimed: its other cars are dead for COOLDOWN days (someone already took the good one).
  COOLDOWN: 60,
};
// What it is (by the cell's c.car): name, the vehicle type it becomes, old (easier to hotwire).
export const MODELS = {
  sedan: { name: "Sedan", vehicle: "sedan", old: true },
  van: { name: "Van", vehicle: "van" },
  pickup: { name: "Pickup truck", vehicle: "truck" },
  boxtruck: { name: "Burnt-out box truck", vehicle: null },
  cargo: { name: "Army cargo truck", vehicle: "miltruck", mil: true },
  humvee: { name: "Humvee", vehicle: "hummer", mil: true },
  mrap: { name: "MRAP", vehicle: "miltruck", mil: true },
};
// Its state when found: engine [ok, fixable] (the rest dead), tyres / battery flat, fuel [chance of any, lo, hi].
// Civilian cars: about 1 in 20 starts (an engine that runs, tyres up, a live battery); half more can be fixed.
export const COND = {
  civil:   { engine: [0.25, 0.35], tyres: 0.5, battery: 0.6, fuel: [0.45, 1, 6], condition: [35, 65] },
  intact:  { engine: [0.5, 0.4], tyres: 0.3, battery: 0.45, fuel: [0.6, 10, 60], condition: [55, 85] },
  wrecked: { engine: [0, 0.4], tyres: 0.7, battery: 0.8, fuel: [0.3, 2, 20], condition: [30, 55] },
  burnt:   { engine: [0, 0], tyres: 1, battery: 1, fuel: [0, 0, 0], condition: [0, 0] },
};
// Getting one running: an engine 2 parts, 2 scrap, Mechanics 4 (an Army truck 5, an old car 3), 6 hours; flat tyres 1
// part, 2 hours; a dead battery 1 part, 1 hour (Mechanics 1 for those).
export const FIX = { engine: { parts: 2, scrap: 2, hours: 6, mech: 4, milMech: 5, oldMech: 3 }, tyres: { parts: 1, hours: 2, mech: 1 }, battery: { parts: 1, hours: 1, mech: 1 }, base: 0.5, perMech: 0.08, min: 0.15, max: 0.95, waste: 0.5 };

// ---------- the cars on a map ----------
const carCells = (b, id) => { const out = []; for (let i = 0; i < b.cells.length; i++) { const c = b.cells[i]; if (c.car && c.car.id === id && (c.k === "car" || c.k === "truck")) out.push(i); } return out; };
function modelOf(car) {
  if (car.mil) return car.mil.kind;
  if (car.kind === "truck") return "boxtruck";
  return car.L <= 3 ? "sedan" : car.v % 2 ? "van" : "pickup";
}
const roll = (state, b, id, ...k) => hash01(state.seed, "car", b.tileId, b.carSalt ?? (b.carSalt = state.hour), id, ...k);
// The record of a car on this battle's map (made the first time someone looks at it), or null.
export function carRecord(state, b, id) {
  b.cars = b.cars || {};
  if (b.cars[id]) return b.cars[id];
  const cells = carCells(b, id);
  if (!cells.length) return null;
  const W = b.w;
  const xs = cells.map((i) => i % W), ys = cells.map((i) => (i / W) | 0);
  const car = b.cells[cells[0]].car;
  if (car.escort) return null; // a caravan escort's vehicle (combat.js): settled when the battle ends (caravanraids.js)
  if (car.owned) return (b.cars[id] = ownedRecord(state, b, id, car, xs, ys)); // a group's own vehicle in its motor pool (arsenal.js placeMotorPool)
  const model = modelOf(car);
  const M = MODELS[model];
  const r = (...k) => roll(state, b, id, ...k);
  const C = M.mil ? COND[car.mil.cond] || COND.wrecked : model === "boxtruck" ? COND.burnt : COND.civil;
  const cooled = !M.mil && (state.carClaims || {})[b.tileId] != null && state.hour - state.carClaims[b.tileId] < CARS.COOLDOWN * 24;
  const e = r("engine");
  const ready = !!(car.mil && car.mil.runs); // a National Guard motor pool's ready vehicle (miltrucks.js MOTOR_POOL): it runs, with fuel in it
  const engine = ready ? "ok" : cooled ? "dead" : e < C.engine[0] ? "ok" : e < C.engine[0] + C.engine[1] ? "fixable" : "dead";
  const fuel = ready ? Math.round(30 + r("fq") * 30) : r("fuel") < C.fuel[0] ? Math.round(C.fuel[1] + r("fq") * (C.fuel[2] - C.fuel[1])) : 0;
  const rec = {
    id, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1,
    model, name: M.mil ? `${car.mil.cond === "intact" ? "" : car.mil.cond === "burnt" ? "Burned-out " : "Wrecked "}${M.name}` : M.name,
    mil: M.mil ? { ...car.mil } : null, locked: r("lock") < (CARS.LOCKED[model] ?? 0.4), open: false, keys: M.mil ? true : null, hot: false, tries: 0,
    inspected: false, cond: { engine, tyres: !ready && r("tyres") < C.tyres ? "flat" : "ok", battery: !ready && r("battery") < C.battery ? "flat" : "ok", fuel }, condition: Math.round(C.condition[0] + r("cq") * (C.condition[1] - C.condition[0])),
    claimed: null,
  };
  b.cars[id] = rec;
  return rec;
}
// A group's own vehicle (f.vehicles) parked in its motor pool: it runs (its condition), locked like any car of its
// model, no keys left in it (hotwire it; an Army one has a start switch); claiming it is stealing it (claimCar).
const OWNED_MODEL = { sedan: "sedan", suv: "sedan", van: "van", truck: "pickup", hummer: "humvee", miltruck: "cargo" };
function ownedRecord(state, b, id, car, xs, ys) {
  const o = car.owned;
  const model = OWNED_MODEL[o.type] || "pickup";
  const M = MODELS[model];
  return {
    id, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1,
    model, name: o.name || M.name, mil: M.mil ? { kind: model, cond: "intact", runs: true } : null, owned: { ...o },
    locked: roll(state, b, id, "lock") < (CARS.LOCKED[model] ?? 0.4), open: false, keys: M.mil ? true : false, hot: false, tries: 0,
    inspected: false, cond: { engine: o.condition > 0 ? "ok" : "dead", tyres: "ok", battery: "ok", fuel: Math.round(o.fuel || 0) }, condition: Math.round(o.condition || 0),
    claimed: null,
  };
}
const gap = (rec, x, y) => Math.max(rec.x - x, x - (rec.x + rec.w - 1), rec.y - y, y - (rec.y + rec.h - 1), 0);
// The cars next to a unit (any of their cells within a step): ids, nearest first.
export function carsNear(b, u) {
  const seen = new Set(), out = [];
  for (let y = u.y - 1; y <= u.y + 1; y++) for (let x = u.x - 1; x <= u.x + 1; x++) {
    if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
    const c = b.cells[y * b.w + x];
    if (!c.car || (c.k !== "car" && c.k !== "truck") || c.car.escort || seen.has(c.car.id)) continue;
    seen.add(c.car.id);
    out.push(c.car.id);
  }
  return out;
}
// A raid container on the same car (a car in a wreck pile or on the road, an Army truck's cargo bed): its lock is the doors'.
const boxOf = (b, rec) => (b.raid ? b.raid.containers.find((c) => c.x === rec.x && c.y === rec.y && (c.w || 1) === rec.w && (c.h || 1) === rec.h && c.kind === "car") : null);
export const isOpen = (b, rec) => rec.open || !rec.locked || !!(boxOf(b, rec)?.lock?.open);
export const canStart = (rec) => !!(rec.keys || rec.hot || rec.mil);
// What getting it running needs: { parts, scrap, hours, mech, what: [] } (nothing: it runs), or null (scrap).
export function repairOf(rec) {
  const c = rec.cond;
  if (c.engine === "dead") return null;
  const out = { parts: 0, scrap: 0, hours: 0, mech: 0, what: [] };
  if (c.engine === "fixable") { out.parts += FIX.engine.parts; out.scrap += FIX.engine.scrap; out.hours += FIX.engine.hours; out.mech = Math.max(out.mech, rec.mil ? FIX.engine.milMech : MODELS[rec.model].old ? FIX.engine.oldMech : FIX.engine.mech); out.what.push("the engine"); }
  if (c.tyres === "flat") { out.parts += FIX.tyres.parts; out.hours += FIX.tyres.hours; out.mech = Math.max(out.mech, FIX.tyres.mech); out.what.push("flat tyres"); }
  if (c.battery === "flat") { out.parts += FIX.battery.parts; out.hours += FIX.battery.hours; out.mech = Math.max(out.mech, FIX.battery.mech); out.what.push("a dead battery"); }
  return out;
}
export const runs = (rec) => { const r = repairOf(rec); return !!r && !r.what.length; };
export function verdictText(rec) {
  const c = rec.cond, r = repairOf(rec);
  const parts = `Engine ${c.engine === "ok" ? "turns over" : c.engine === "fixable" ? "needs work" : "seized or burned out"}, tyres ${c.tyres === "ok" ? "hold air" : "flat"}, battery ${c.battery === "ok" ? "has charge" : "dead"}, ${c.fuel ? `${c.fuel} fuel in the tank` : "the tank is dry"}.`;
  if (!r) return `${parts} Scrap: nothing to save but its fuel.`;
  if (!r.what.length) return `${parts} It runs.`;
  return `${parts} Fixable: ${r.what.join(", ")}: ${r.parts} part${r.parts === 1 ? "" : "s"}${r.scrap ? `, ${r.scrap} scrap` : ""}, Mechanics ${r.mech}+, about ${r.hours}h of work.`;
}
// The ops open to a unit at a car now: { op: { ok, why, chance?, ap } }.
export function carOptions(state, b, u, rec) {
  const s = survivorById(state, u.sid);
  const open = isOpen(b, rec);
  const o = {};
  const mech = s ? skill(s, "mechanics") : 0;
  if (!open) {
    const odds = openOdds(state, b, u, { kind: "car" });
    o.pick = { ok: odds.pick.ok, chance: odds.pick.chance, ap: 1, why: odds.pick.why };
    o.force = { ok: odds.force.ok, chance: odds.force.chance, ap: odds.force.ap, why: odds.force.why, glass: !!odds.force.glass, crowbar: !!odds.force.crowbar };
  } else if (!rec.open) o.enter = { ok: true, ap: 1, why: "" };
  const inside = open && rec.open;
  const needIn = inside ? "" : "Get in first.";
  if (!rec.mil && rec.model !== "boxtruck") {
    o.keys = { ok: inside && rec.keys == null, ap: 1, chance: Math.min(0.95, (CARS.KEYS[rec.model] || 0.3) + (bodyNear(b, rec) ? CARS.BODY_KEYS : 0)), why: needIn || (rec.keys ? "The keys are in the ignition." : rec.keys === false ? "No keys anywhere in it." : "") };
    o.hotwire = { ok: inside && !canStart(rec), ap: 1, chance: hotwireChance(rec, mech), why: needIn || (canStart(rec) ? "It can already be started." : "") };
  }
  o.inspect = { ok: inside && !rec.inspected, ap: 1, why: needIn || (rec.inspected ? "Already inspected." : "") };
  o.siphon = { ok: inside && rec.inspected && rec.cond.fuel > 0, ap: 1, why: needIn || (!rec.inspected ? "Inspect it first (is there any fuel?)." : rec.cond.fuel > 0 ? "" : "The tank is dry.") };
  const r = repairOf(rec);
  const owner = b.setup.partyId != null || b.setup.baseId != null;
  o.claim = {
    ok: inside && rec.inspected && !!r && canStart(rec) && !rec.claimed && owner && !!MODELS[rec.model].vehicle, ap: 1,
    why: needIn || (!rec.inspected ? "Inspect it first." : rec.claimed ? "Already yours." : !r ? "It is scrap." : !canStart(rec) ? "No way to start it: find the keys or hotwire it." : !owner ? "Nobody to take it." : ""),
    fix: r && r.what.length ? r : null,
  };
  return o;
}
function bodyNear(b, rec) {
  const near = (x, y) => gap(rec, x, y) <= CARS.BODY_RANGE;
  return b.units.some((x) => x.dead && x.side === "enemy" && near(x.x, x.y)) || (b.corpses || []).some((c) => near(c.x, c.y));
}
export const hotwireChance = (rec, mech) => Math.max(0.05, Math.min(CARS.HOTWIRE.max, CARS.HOTWIRE.base + CARS.HOTWIRE.perMech * mech + (MODELS[rec.model].old ? CARS.HOTWIRE.old : 0)));

// ---------- the action (combat.js combatAct "car") ----------
// act: { unit, car: id (default: the nearest), op: "enter" | "pick" | "force" | "keys" | "hotwire" | "inspect" | "siphon" | "claim" }.
// H: { say, alertNear, fx } from combat.js. Returns an error ("" when the action happened, success or not).
export function carAct(state, b, u, act, H) {
  const id = act.car != null ? Number(act.car) : carsNear(b, u)[0];
  const rec = id != null && carsNear(b, u).includes(id) ? carRecord(state, b, id) : null;
  if (!rec) return "Move next to a car first.";
  const o = carOptions(state, b, u, rec)[act.op];
  if (!o) return "Not something you can do with this one.";
  if (!o.ok) return o.why || "Not now.";
  if (u.ap < (o.ap || 1)) return "Not enough actions left.";
  const s = survivorById(state, u.sid);
  const name = rec.name.toLowerCase();
  const heat = (n) => { if (b.raid) b.raid.heat = Math.min(100, b.raid.heat + n); };
  const r = (...k) => roll(state, b, rec.id, ...k);
  u.ap -= o.ap || 1;
  u.hunker = false;
  const at = [rec.x + Math.floor(rec.w / 2), rec.y + Math.floor(rec.h / 2)];
  switch (act.op) {
    case "enter":
      rec.open = true;
      H.say(b, `${u.name} opens the door of the ${name}.`, "info");
      break;
    case "pick": case "force": {
      rec.tries += 1;
      const ok = r("open", rec.tries, u.id) < o.chance;
      if (act.op === "pick") {
        heat(PICK.heat);
        if (s) gainXp(state, s, "stealth", ok ? PICK.xpWin : PICK.xpMiss);
        H.say(b, ok ? `${u.name} picks the lock of the ${name} (${Math.round(o.chance * 100)}%).` : `${u.name} works the door lock of the ${name}, but it holds (${Math.round(o.chance * 100)}%).`, ok ? "good" : "info");
      } else {
        const P = o.crowbar ? FORCE : SMASH;
        heat(P.heat);
        b.noise = (b.noise || 0) + P.noise;
        H.say(b, o.glass ? (ok ? `${u.name} smashes a window of the ${name} and reaches in for the lock (${Math.round(o.chance * 100)}%).` : `${u.name} hits the ${name}'s window; it cracks and holds (${Math.round(o.chance * 100)}%).`)
          : ok ? `${u.name} jimmies the door of the ${name} open with a crunch (${Math.round(o.chance * 100)}%).` : `${u.name} heaves on the ${name}'s door, but it holds (${Math.round(o.chance * 100)}%).`, ok ? "good" : "danger");
        H.alertNear(b, at[0], at[1], P.radius, o.glass ? "Breaking glass carries: the dead nearby turn toward it." : "The noise wakes everything nearby.");
      }
      if (ok) {
        rec.open = true;
        const box = boxOf(b, rec);
        if (box && box.lock) { box.lock.open = true; box.lock.how = act.op === "pick" ? "pick" : o.crowbar ? "force" : "smash"; }
        H.fx(b, { type: "loot", to: at, text: "open" });
      } else H.fx(b, { type: "loot", to: at, text: "locked" });
      break;
    }
    case "keys": {
      const ok = r("keys") < o.chance;
      rec.keys = ok;
      H.say(b, ok ? `${u.name} finds the keys of the ${name} ${bodyNear(b, rec) && r("where") < 0.5 ? "in the pocket of one of the dead lying near it" : r("where") < 0.75 ? "behind the sun visor" : "in the glovebox"}.` : `${u.name} turns the ${name} inside out: no keys. Hotwire it, or leave it.`, ok ? "good" : "info");
      H.fx(b, { type: "loot", to: at, text: ok ? "keys!" : "no keys" });
      break;
    }
    case "hotwire": {
      rec.tries += 1;
      heat(CARS.HOTWIRE.heat);
      const ok = r("hot", rec.tries, u.id) < o.chance;
      if (ok) rec.hot = true;
      if (s) gainXp(state, s, "mechanics", ok ? 4 : 1);
      H.say(b, ok ? `${u.name} pulls the wires under the ${name}'s dash and twists the right two together (${Math.round(o.chance * 100)}%): it can be started now.` : `${u.name} fumbles with the wires under the dash of the ${name}: nothing (${Math.round(o.chance * 100)}%). Try again.`, ok ? "good" : "info");
      H.fx(b, { type: "loot", to: at, text: ok ? "wired" : "nothing" });
      break;
    }
    case "inspect":
      rec.inspected = true;
      if (s) gainXp(state, s, "mechanics", 1);
      H.say(b, `${u.name} looks the ${name} over. ${verdictText(rec)}${rec.mil ? " An Army vehicle: a start switch, no key needed." : ""}`, runs(rec) ? "good" : "info");
      break;
    case "siphon": {
      const got = siphon(state, b, rec);
      H.say(b, got.n ? `${u.name} siphons ${got.n} fuel out of the ${name} (${got.where}).` : `${u.name} has nowhere to put the fuel.`, got.n ? "good" : "info");
      if (got.n) H.fx(b, { type: "loot", to: at, text: `+${got.n} fuel` });
      break;
    }
    case "claim": {
      const v = claimCar(state, b, rec);
      H.say(b, `${u.name} claims the ${name}${o.fix ? `: it needs ${o.fix.what.join(", ")} (${o.fix.parts} parts${o.fix.scrap ? `, ${o.fix.scrap} scrap` : ""}, Mechanics ${o.fix.mech}+, ${o.fix.hours}h) before it goes anywhere. Repair it from the team's orders once the fight is over` : `: it runs. ${b.setup.partyId != null ? "It joins the team when the fight is over if the team has no vehicle; otherwise it stays here, marked on the map" : "It goes in the base's motor pool"}`}.`, "good");
      H.fx(b, { type: "loot", to: at, text: v ? "claimed" : "" });
      break;
    }
    default:
      return "Not something you can do with this one.";
  }
  return "";
}

// The fuel in a car's tank: into your vehicle on the map first (up to its tank), then the team's cans (as cargo room
// allows) or the base's stock. Returns { n, where }.
function siphon(state, b, rec) {
  const p = b.setup.partyId != null ? state.parties.find((x) => x.id === b.setup.partyId) : null;
  const base = b.setup.baseId != null ? state.bases.find((x) => x.id === b.setup.baseId) : null;
  let left = rec.cond.fuel, n = 0;
  const where = [];
  const pv = p ? partyVehicle(state, p) : null;
  if (pv && isCar(pv) && b.vehicle) {
    const put = Math.min(left, Math.max(0, tank(pv) - pv.fuel));
    if (put > 0) { pv.fuel += put; left -= put; n += put; where.push(`into the ${pv.name}'s tank`); }
  }
  if (left > 0 && p) {
    const put = Math.min(left, unitsThatFit(cargoRoom(state, p), "fuel"));
    if (put > 0) { p.cargo.supplies.fuel = (p.cargo.supplies.fuel || 0) + put; left -= put; n += put; where.push("into the team's jerry cans"); }
  } else if (left > 0 && base) {
    base.stock.fuel = (base.stock.fuel || 0) + left; n += left; where.push("into the base's stores"); left = 0;
  }
  rec.cond.fuel = left;
  return { n, where: where.join(", ") };
}

// The car becomes a vehicle record, parked on the tile (loc "abandoned", v.found), with a marker on the map.
export function claimCar(state, b, rec) {
  const M = MODELS[rec.model];
  const type = M.vehicle;
  if (!type || rec.claimed) return null;
  const tile = b.tileId;
  const r = repairOf(rec);
  const fix = r && r.what.length ? { parts: r.parts, scrap: r.scrap, hours: r.hours, mech: r.mech, what: r.what.slice() } : null;
  const v = createVehicle(state, type, { kind: "abandoned", tile, since: state.hour }, {
    fuel: Math.min(VEHICLE_TYPES[type].tank, rec.cond.fuel), condition: fix ? Math.max(15, Math.round(rec.condition * 0.6)) : rec.condition,
    name: type === "miltruck" && rec.model === "mrap" ? "MRAP" : M.name,
  });
  v.found = { model: rec.model, at: b.place, hour: state.hour, repair: fix };
  if (rec.owned) { stolenFromGroup(state, b, rec, v); return v; } // arsenal.js: out of their motor pool
  if (rec.mil) fitMilitary(v, rec.mil.turret || null); // vehicles.js: an Army vehicle is plated and glassed (a motor pool's Humvee has its M2)
  rec.claimed = v.id;
  (b.claims = b.claims || []).push(v.id);
  if (rec.mil) markTaken(state, rec.mil); // miltrucks.js: gone from the tile's maps from now on
  else (state.carClaims = state.carClaims || {})[tile] = state.hour;
  markAbandonedVehicle(state, v, fix ? "needs repair" : "found");
  log(state, `Your people claimed a ${v.name.toLowerCase()} at ${tileLabel(state, tile)}${fix ? ` (it needs ${fix.what.join(", ")} before it runs)` : ""}${rec.mil ? `: armour plate and bulletproof glass${rec.mil.turret ? ", an M2 on the roof (not yet usable)" : ""}` : ""}.`, "good");
  return v;
}
// A group's vehicle driven out of its motor pool: off their books (with its upgrades), and they know who took it.
function stolenFromGroup(state, b, rec, v) {
  const o = rec.owned;
  const f = (state.factions || []).find((x) => x.id === o.fid);
  rec.claimed = v.id;
  (b.claims = b.claims || []).push(v.id);
  if (o.upgrades) v.upgrades = JSON.parse(JSON.stringify(o.upgrades));
  if (f) {
    const list = f.vehicles || [];
    const i = list.findIndex((x) => x.id === o.recId);
    if (i >= 0) list.splice(i, 1);
    f.goodwill = Math.max(-100, (f.goodwill || 0) - STEAL_GOODWILL);
    f.lastProvoked = Math.floor(state.hour / 24);
    f.vehiclesLostToYou = (f.vehiclesLostToYou || 0) + 1;
  }
  markAbandonedVehicle(state, v, "stolen");
  log(state, `Your people drove the ${v.name} out of ${f ? `${f.name}'s` : "their"} motor pool. ${f ? `${f.name} know who took it (goodwill −${STEAL_GOODWILL}).` : ""}`, "danger");
}
export const STEAL_GOODWILL = 25;
// When a battle ends (combat.js finishCombat): a claimed car that runs joins the team that claimed it (if it has no
// vehicle and was not beaten), or the base it was defending; the rest stay parked on the tile.
export function settleClaims(state, b, result) {
  if (!b || !b.claims || !b.claims.length) return;
  const p = b.setup.partyId != null ? state.parties.find((x) => x.id === b.setup.partyId) : null;
  const base = b.setup.baseId != null ? baseById(state, b.setup.baseId) : null;
  const lost = result && result.outcome === "defeat";
  for (const id of b.claims) {
    const v = vehicleById(state, id);
    if (!v || v.loc.kind !== "abandoned" || (v.found && v.found.repair)) continue;
    if (!lost && p && state.parties.includes(p) && partyMembers(state, p).length && !p.vehicle) {
      joinTeam(state, p, v);
      log(state, `The ${v.name} joins ${teamName(state, p)} (fuel ${Math.round(v.fuel)}, condition ${Math.round(v.condition)}%).`, "good");
    } else if (!lost && base && !p) {
      v.loc = { kind: "base", baseId: base.id };
      log(state, `The ${v.name} goes into ${base.name}'s motor pool.`, "good");
    }
  }
}
// A found vehicle that runs becomes the team's (the fuel it carries poured in as far as the tank needs).
export function joinTeam(state, p, v) {
  const pour = Math.max(0, Math.min(carried(p, "fuel"), tank(v) - v.fuel, Math.max(0, 6 - v.fuel)));
  if (pour > 0) v.fuel += takeSupply(p, "fuel", pour);
  v.loc = { kind: "party", partyId: p.id };
  p.vehicle = true;
  p.vehicleId = v.id;
  delete v.found;
  if (p.spotted) p.spotted.set(`vehicle:${v.id}`, { key: `vehicle:${v.id}`, type: "vehicle", tile: partyTile(p), hour: state.hour, label: v.name, remove: true });
  const m = state.markers.find((x) => x.key === `vehicle:${v.id}`);
  if (m) state.markers.splice(state.markers.indexOf(m), 1);
  weighTeam(state, p);
}

// ---------- the State Map: repairing a found vehicle, driving it home ----------
// The found vehicle that needs work on the team's tile, or null.
export const fixableAt = (state, tile) => state.vehicles.find((v) => v.loc.kind === "abandoned" && v.loc.tile === tile && v.found && v.found.repair) || null;
// A found vehicle that runs on the team's tile (for "drive it home"), or null.
export const runnerAt = (state, tile) => state.vehicles.find((v) => v.loc.kind === "abandoned" && v.loc.tile === tile && v.found && !v.found.repair && isCar(v)) || null;
export const fixChance = (mech, need) => Math.max(FIX.min, Math.min(FIX.max, FIX.base + FIX.perMech * (mech - need)));
// Why the team cannot start the repair now ("" when it can).
export function fixProblem(state, p, v) {
  const r = v.found && v.found.repair;
  if (!r) return "It does not need repairs.";
  const mech = bestSkill(state, p, "mechanics");
  if (mech < r.mech) return `Needs Mechanics ${r.mech}+ on the team (best: ${mech}).`;
  if (carried(p, "parts") < r.parts) return `Needs ${r.parts} part${r.parts === 1 ? "" : "s"} carried (have ${Math.floor(carried(p, "parts"))}).`;
  if (r.scrap && carried(p, "scrap") < r.scrap) return `Needs ${r.scrap} scrap carried (have ${Math.floor(carried(p, "scrap"))}).`;
  return "";
}
export function fixOption(state, p, v) {
  const r = v.found.repair;
  const why = fixProblem(state, p, v);
  const mech = bestSkill(state, p, "mechanics");
  return {
    mission: "getvehicle", label: `Repair the ${v.name}`,
    desc: `Get the found ${v.name.toLowerCase()} running: ${r.what.join(", ")}. ${r.parts} part${r.parts === 1 ? "" : "s"}${r.scrap ? ` and ${r.scrap} scrap` : ""}, Mechanics ${r.mech}+, ${r.hours}h of work on the spot (the noise draws attention). ${why ? "" : `Then a Mechanics check: ${Math.round(fixChance(mech, r.mech) * 100)}% (a failure wastes half the parts; try again).`}`,
    disabled: why || null,
  };
}
// The "Recover vehicle" order on a found vehicle that needs work: the fixcar task (orders.js).
export function startFixCar(state, p, v) {
  const why = fixProblem(state, p, v);
  if (why) { awaitOrders(state, p, `Repair the ${v.name}: ${why}`, { failed: true }); return ""; }
  startTask(state, p, { type: "fixcar", vehicleId: v.id, hours: v.found.repair.hours });
  log(state, `${teamName(state, p)} start work on the ${v.name} at ${tileLabel(state, partyTile(p))} (${v.found.repair.hours}h).`, "info");
  return "";
}
// The end of the fixcar task (orders.js finishTask): the check, the parts, and the vehicle running (or not).
export function finishFixCar(state, p, t) {
  const v = vehicleById(state, t.vehicleId);
  if (!v || v.loc.kind !== "abandoned" || !v.found || !v.found.repair) return "The vehicle is gone.";
  const why = fixProblem(state, p, v);
  if (why) return `Repair the ${v.name}: ${why}`;
  const r = v.found.repair;
  const mech = bestSkill(state, p, "mechanics");
  const chance = fixChance(mech, r.mech);
  const best = partyMembers(state, p).reduce((a, s) => (skill(s, "mechanics") > skill(a, "mechanics") ? s : a), partyMembers(state, p)[0]);
  const t0 = (v.found.tries = (v.found.tries || 0) + 1);
  if (hash01(state.seed, "fixcar", v.loc.tile, v.found.hour ?? 0, v.found.model, state.hour, t0) >= chance) {
    const lost = Math.max(1, Math.ceil(r.parts * FIX.waste));
    takeSupply(p, "parts", lost);
    if (best) gainXp(state, best, "mechanics", USE.repair || 3);
    return `The ${v.name} still will not start (${Math.round(chance * 100)}%): ${lost} part${lost === 1 ? "" : "s"} wasted. Try again with ${r.parts} parts.`;
  }
  takeSupply(p, "parts", r.parts);
  if (r.scrap) takeSupply(p, "scrap", r.scrap);
  if (best) gainXp(state, best, "mechanics", (USE.repair || 3) * 2);
  v.found.repair = null;
  v.condition = Math.max(v.condition, Math.min(60, 30 + 3 * mech));
  const marker = state.markers.find((m) => m.key === `vehicle:${v.id}`);
  if (marker) marker.label = `${v.name} (found, runs)`;
  if (!p.vehicle && v.fuel + carried(p, "fuel") >= 2) {
    joinTeam(state, p, v);
    return `The ${v.name} roars into life (${Math.round(chance * 100)}%, condition ${Math.round(v.condition)}%): it is the team's now.`;
  }
  return `The ${v.name} roars into life (${Math.round(chance * 100)}%, condition ${Math.round(v.condition)}%).${p.vehicle ? " The team already has a vehicle: send someone home in it (Drive it home) or come back for it." : " It needs 2 fuel to go anywhere."}`;
}
export function driveHomeOption(state, p, v) {
  const n = partyMembers(state, p).length;
  return {
    mission: "drivehome", label: `Drive the ${v.name} home`,
    desc: `One of the team drives the found ${v.name.toLowerCase()} home on their own (fuel ${Math.round(v.fuel)}${v.fuel < 4 ? ", topped up from the team's cans" : ""}); the rest carry on here.`,
    disabled: n < 2 ? "Needs two people: one stays with the team's own vehicle." : v.fuel + carried(p, "fuel") < 2 ? "Needs 2 fuel (in its tank or carried)." : null,
  };
}
// One of the team (the best Mechanics, never the last one) takes the found vehicle home as a team of their own.
export function driveHome(state, p) {
  const tile = partyTile(p);
  const v = runnerAt(state, tile);
  const members = partyMembers(state, p);
  if (!v) { awaitOrders(state, p, "There is no found vehicle here that runs.", { failed: true }); return ""; }
  if (members.length < 2) { awaitOrders(state, p, "Needs two people: one stays with the team's own vehicle.", { failed: true }); return ""; }
  const driver = members.slice().sort((a, b) => skill(b, "mechanics") - skill(a, "mechanics") || a.id - b.id)[0];
  const home = baseById(state, p.homeBaseId) || hub(state);
  if (!home) { awaitOrders(state, p, "There is no base to drive it to.", { failed: true }); return ""; }
  const fuel = Math.min(carried(p, "fuel"), Math.max(0, 8 - v.fuel));
  if (fuel > 0) v.fuel += takeSupply(p, "fuel", fuel);
  // A day's food and water for the drive, as far as the team has it.
  const sup = {};
  for (const k of Object.keys(SUPPLIES)) sup[k] = 0;
  sup.food = takeSupply(p, "food", 2);
  sup.water = takeSupply(p, "water", 2);
  const q = {
    id: newId(), owner: "player", kind: "expedition", mission: "move", teamMission: "move", dest: home.tile, homeBaseId: home.id,
    members: [driver.id], stance: "normal", vehicle: true, vehicleId: v.id, supplies: sup, cargo: { supplies: {}, gear: [] },
    path: [tile], idx: 0, progress: 0, phase: "waiting", seen: new Map(), spotted: new Map(), sightNow: [], radioLive: false,
    departed: state.hour, plannedHours: 0, eventsSeen: 0, orders: [], orderStart: state.hour,
    planPath: [tile], planStart: state.hour, planVehicle: true, planFuel: v.fuel, etaOut: 0, etaBack: null,
  };
  p.members = p.members.filter((id) => id !== driver.id);
  driver.location = { kind: "party", partyId: q.id };
  v.loc = { kind: "party", partyId: q.id };
  delete v.found;
  const m = state.markers.find((x) => x.key === `vehicle:${v.id}`);
  if (m) state.markers.splice(state.markers.indexOf(m), 1);
  state.parties.push(q);
  weighTeam(state, q);
  weighTeam(state, p);
  startReturn(state, q);
  awaitOrders(state, p, `${driver.name.split(" ")[0]} drives the ${v.name} home to ${home.name}.`);
  return "";
}
