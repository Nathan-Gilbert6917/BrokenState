// Vehicles in trade (the trade window's Vehicles section; the governor; groupworld.js trades them between groups).
//
// Who sells what:
// - A group (its caravan at your gates, your team at theirs, or over the radio): any running vehicle in its motor pool
//   (vehicles.js factionVehicles) that is not out with a caravan; the military sells only past what it wants
//   (groupworld.js vehicleWant) and never its turret vehicle. It buys yours when it can pay: the cars at the base you
//   trade from, or the team's own vehicle (its cargo goes into the team's cargo first).
// - Merchants from outside sell a spare pickup now and then (their company owns one that does not ride with the
//   escort: escorts.js companyFor); never their escort's vehicles. They do not buy.
// Price: vehicles.js vehicleValue (type, condition, upgrades) × their want (WANT: more when they have fewer than they
// want, less when they have plenty) × the trade spread (trade.js spread: Speech and goodwill), × MERCHANT for
// merchants. Paid in goods at their worth (data.js SUPPLIES values): scrap, fuel, ammo, parts, then food and meds; the
// buyer must hold that much. A vehicle you sell leaves its cargo at the base (or with the team); one you buy is parked
// at the base, joins the team (a team with none), or over the radio is driven over (it arrives DELIVERY days later).
// The governor (autopilot.js): buys one when the hub has no car and goods worth GOV.afford × the price to spare, and
// sells a car that has stood at a base GOV.idle days while the hub has more than GOV.keep.
import { SUPPLIES } from "./data.js";
import { day, log, hub, baseById } from "./world.js";
import { tradeContext, spread } from "./trade.js";
import { factionVehicles, vehicleValue, createVehicle, VEHICLE_TYPES, upgradesOf, carsAtBase, isCar, partyVehicles, dropPartyVehicle } from "./vehicles.js";
import { vehicleWant } from "./groupworld.js";
import { joinTeam } from "./foundcars.js";
import { unloadVehicle } from "./arsenal.js"; // a group's vehicle sold to you: what is in it stays with them

export const VTRADE = { WANT: { short: 1.2, plenty: 0.8, sell: 1 }, MERCHANT: 1.3, DELIVERY: 1, PAY: ["scrap", "fuel", "ammo", "parts", "food", "meds"], KEEP_FOOD: 20 };
export const GOV = { afford: 2, idle: 30, keep: 2 };
const worthOf = (k) => (SUPPLIES[k] && SUPPLIES[k].value) || 1;
const live = (f) => factionVehicles(f).filter((v) => v.condition > 0);

// What a pile of pools could pay (pools: stocks, first to last).
const poolWorth = (pools) => VTRADE.PAY.reduce((a, k) => a + pools.reduce((s, p) => s + Math.max(0, Math.floor((p[k] || 0) - (k === "food" ? VTRADE.KEEP_FOOD : 0))), 0) * worthOf(k), 0);
// Pays `value` out of the pools into `to`; returns { paid } (null when short).
function pay(pools, to, value) {
  if (poolWorth(pools) < value) return null;
  const paid = {};
  let owed = value;
  for (const k of VTRADE.PAY) {
    for (const p of pools) {
      if (owed <= 0) break;
      const have = Math.max(0, Math.floor((p[k] || 0) - (k === "food" ? VTRADE.KEEP_FOOD : 0)));
      const q = Math.min(have, Math.ceil(owed / worthOf(k)));
      if (q <= 0) continue;
      p[k] -= q;
      to[k] = (to[k] || 0) + q;
      paid[k] = (paid[k] || 0) + q;
      owed -= q * worthOf(k);
    }
  }
  return { paid };
}
const paidText = (paid) => Object.entries(paid).map(([k, q]) => `${q} ${(SUPPLIES[k] ? SUPPLIES[k].name : k).toLowerCase()}`).join(", ");

// The vehicles a group or merchant would sell you, and yours they would buy: { theirs: [{ rec, price }], mine: [{ v, price }] }.
export function vehicleOffers(state, ctx) {
  const out = { theirs: [], mine: [] };
  if (!ctx || ctx.kind === "meet") return out; // a caravan met at a tile in the open (trademeet.js) has no motor pool along
  const sp = spread(ctx.f, ctx.speech);
  if (ctx.visitor) {
    const v = ctx.visitor;
    const own = (v.escort && v.escort.company && v.escort.company.vehicles) || [];
    if (own.includes("truck") && (!v.escort || v.escort.vehicle !== "truck") && !v.pickupSold) {
      const rec = { id: `m${v.serial || v.id}-pickup`, type: "truck", name: "Pickup truck", fuel: 10, condition: 70, merchant: true };
      out.theirs.push({ rec, price: Math.round(vehicleValue(rec) * VTRADE.MERCHANT * sp.buy) });
    }
    return out;
  }
  const f = ctx.f;
  if (!f || !f.alive) return out;
  const busy = new Set((state.parties || []).filter((q) => q.owner === f.id && q.escort && q.escort.vehicleId != null).map((q) => q.escort.vehicleId));
  const want = vehicleWant(f), n = live(f).length;
  for (const rec of live(f)) {
    if (busy.has(rec.id)) continue;
    if (f.type === "military" && (n <= want + 1 || upgradesOf(rec).turret)) continue;
    out.theirs.push({ rec, price: Math.round(vehicleValue(rec) * VTRADE.WANT.sell * sp.buy) });
  }
  const theyWant = n < want ? VTRADE.WANT.short : VTRADE.WANT.plenty;
  const mine = ctx.kind === "visit" ? (ctx.p ? partyVehicles(state, ctx.p).filter(isCar) : []) : ctx.base ? carsAtBase(state, ctx.base.id) : [];
  for (const v of mine) out.mine.push({ v, price: Math.round(vehicleValue(v) * theyWant * sp.sell) });
  return out;
}
// Your side's pools for paying or being paid.
function myPools(ctx) {
  if (ctx.kind === "visit" && ctx.p) return [ctx.p.cargo.supplies, ctx.p.supplies];
  return ctx.base ? [ctx.base.stock] : [];
}
// Buy one of theirs (index into vehicleOffers(...).theirs). Returns a message.
export function buyVehicle(state, i) {
  const ctx = tradeContext(state);
  const o = vehicleOffers(state, ctx).theirs[i];
  if (!ctx || !o) return "That vehicle is not for sale any more.";
  if (ctx.kind === "visit" && ctx.p && ctx.p.vehicle) return "The team already has a vehicle: sell it first, or buy from a base.";
  const into = ctx.visitor ? ctx.visitor.stock : ctx.f.stock;
  const r = pay(myPools(ctx), into, o.price);
  if (!r) return `They want goods worth ${o.price}; you do not have that much to give.`;
  const rec = o.rec;
  if (ctx.visitor) ctx.visitor.pickupSold = true;
  else { unloadVehicle(state, ctx.f, rec, "kept", true); factionVehicles(ctx.f).splice(factionVehicles(ctx.f).indexOf(rec), 1); } // arsenal.js: what is in it stays with them, as yours stays with you when you sell
  const type = VEHICLE_TYPES[rec.type] ? rec.type : "truck";
  let where;
  if (ctx.kind === "radio") {
    (state.vehicleDeliveries = state.vehicleDeliveries || []).push({ day: day(state) + VTRADE.DELIVERY, baseId: ctx.base.id, rec: { ...rec, owner: undefined }, from: ctx.f.name });
    where = `they will drive it over to ${ctx.base.name}`;
  } else {
    const v = createVehicle(state, type, ctx.kind === "visit" ? { kind: "abandoned", tile: ctx.center, since: state.hour } : { kind: "base", baseId: ctx.base.id }, { fuel: rec.fuel, condition: rec.condition, name: rec.name });
    if (rec.upgrades) v.upgrades = JSON.parse(JSON.stringify(rec.upgrades));
    if (ctx.kind === "visit") { joinTeam(state, ctx.p, v); where = "the team drives it"; }
    else where = `it is parked at ${ctx.base.name}`;
  }
  const msg = `Bought the ${rec.name} from ${ctx.f.name} for ${paidText(r.paid)}: ${where}.`;
  log(state, msg, "good");
  return msg;
}
// Sell one of yours (index into vehicleOffers(...).mine). Returns a message.
export function sellVehicle(state, i) {
  const ctx = tradeContext(state);
  const o = vehicleOffers(state, ctx).mine[i];
  if (!ctx || !o || ctx.visitor) return "They do not buy vehicles.";
  const f = ctx.f, v = o.v;
  const pools = myPools(ctx);
  const r = pay([f.stock], pools[0] || {}, o.price);
  if (!r) return `${f.name} cannot pay what it is worth (${o.price}).`;
  // Its cargo stays with you.
  if (v.cargo) {
    for (const [k, q] of Object.entries(v.cargo.supplies || {})) if (q > 0) pools[0][k] = (pools[0][k] || 0) + q;
    if (ctx.base) ctx.base.armory.push(...(v.cargo.gear || []));
    else if (ctx.p) ctx.p.cargo.gear.push(...(v.cargo.gear || []));
    v.cargo = null;
  }
  if (ctx.kind === "visit" && ctx.p) dropPartyVehicle(state, ctx.p, v); // the team's other vehicles stay (vehicles.js fleets)
  state.vehicles.splice(state.vehicles.indexOf(v), 1);
  f.vehSeq = (f.vehSeq || 0) + 1;
  const rec = { id: `f${f.id}-b${f.vehSeq}`, type: v.type, name: v.name, fuel: Math.round(v.fuel || 0), condition: Math.round(v.condition), owner: f.id };
  if (v.upgrades) rec.upgrades = JSON.parse(JSON.stringify(v.upgrades));
  factionVehicles(f).push(rec);
  f.vehiclesBought = (f.vehiclesBought || 0) + 1;
  const msg = `Sold the ${v.name} to ${f.name} for ${paidText(r.paid)}.`;
  log(state, msg, "good");
  return msg;
}
// Vehicles bought over the radio arrive (world daily: groupworld.js groupWorldWorld).
export function vehicleDeliveriesDaily(state) {
  const list = state.vehicleDeliveries;
  if (!list || !list.length) return;
  for (const d of [...list]) {
    if (d.day > day(state)) continue;
    list.splice(list.indexOf(d), 1);
    const base = baseById(state, d.baseId) || hub(state);
    if (!base) continue;
    const v = createVehicle(state, VEHICLE_TYPES[d.rec.type] ? d.rec.type : "truck", { kind: "base", baseId: base.id }, { fuel: d.rec.fuel, condition: d.rec.condition, name: d.rec.name });
    if (d.rec.upgrades) v.upgrades = JSON.parse(JSON.stringify(d.rec.upgrades));
    log(state, `${d.from}'s driver brought the ${v.name} you bought to ${base.name}.`, "good");
  }
}

// ---------- the governor ----------
// A caravan at the gates (or merchants): buy a car when the base has none and can afford it twice over; sell a car that
// has stood idle GOV.idle days when the base has more than GOV.keep. Returns a log text ("" when nothing).
export function governorVehicles(state) {
  const ctx = tradeContext(state);
  if (!ctx || ctx.kind !== "caravan" || !ctx.base) return "";
  const offers = vehicleOffers(state, ctx);
  const cars = carsAtBase(state, ctx.base.id);
  const anyCar = state.vehicles.some(isCar);
  if (!anyCar && offers.theirs.length) {
    const best = offers.theirs.map((o, i) => ({ ...o, i })).sort((a, b) => a.price - b.price)[0];
    if (poolWorth([ctx.base.stock]) >= best.price * GOV.afford) return buyVehicle(state, best.i);
  }
  if (cars.length > GOV.keep && offers.mine.length) {
    const idle = offers.mine.map((o, i) => ({ ...o, i })).filter((o) => (o.v.idleDays || 0) >= GOV.idle).sort((a, b) => a.price - b.price)[0];
    if (idle) return sellVehicle(state, idle.i);
  }
  return "";
}
// Days each car has stood at a base (autopilot.js autopilotDaily).
export function idleDaily(state) {
  for (const v of state.vehicles) v.idleDays = v.loc && v.loc.kind === "base" ? (v.idleDays || 0) + 1 : 0;
}
