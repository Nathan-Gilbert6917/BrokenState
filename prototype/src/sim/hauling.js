// Hauling (the user's request 2026-10-20: "Add a hauling job to haul items from one base to another and add other
// hauling to gather other things than just water and wood").
//
// THE HAULER (role "haul", economy.js ROLES). A person on Haul at one of your bases (their home: where they live)
// works, in this order, by the hour:
//   1. Standing haul orders between their base and another of yours (state.haulOrders: the base window's Supply runs
//      tab, Hauling). An order is { id, from, to, what, mode, qty, gov? }:
//        what  "food" (days of food), a supply key, "cat:<category>" (every supply of a data.js category), "all"
//              (every supply but food, water and rounds), "outside" (what lies outside at `from`: no room), "surplus"
//              (the outpost shipping's own rule: what is over the keep economy.js outpostKeep sets);
//        mode  "send": what is over `qty` at `from` (qty: kept at home; per key for several) goes to `to`;
//              "stock": `to` is kept stocked at `qty` of it, out of what `from` can spare (its own week of food, its
//              reserve).
//      The sender always keeps its reserve (senderReserve): what its paid jobs still wait for (a step up's scrap,
//      building materials and wood: as pt-int fixed the midnight shipping) and what its supply runs will take.
//      A round trip: loading at the gate (HAUL.loadH), the walk (or the drive) to the other base by the map's route at
//      the teams' pace (parties.js planPath / travelHours: the load band's pace, a cart's drag off the roads), unloading
//      (HAUL.unloadH), loading what goes the other way, and the walk home. It leaves from HAUL.start and must be home
//      by HAUL.end: a pair too far apart for a day's round trip is not hauled (a supply run does that). The load: what
//      their weight limit, pack and rig allow up to the Heavy band (load.js poolAtBand), or a cart in their arms (one
//      from the armory is taken along: carts.js, the cart's share felt, its free kg) multiplies it; a vehicle the base
//      has set to hauling (v.haul, the Hauling panel) takes its payload (fuel for the round trip, else they walk).
//      Goods arrive into the other base's storage up to its free room (basestorage.js storageOf: the woodpile is
//      exempt, water goes to its tanks' room); what does not fit comes back. The trip is a job trip (s.trip, job
//      "haul"): out of the walls (world.js outOnTrip), lunch from the pack, and the road's trouble at a hauler's
//      scale through tripevents.js (the dead, the dead beasts, animals, an accident, getting lost, a stranger, a
//      find; the attack card and the lone fight), a load dropped when they run (lost on the road).
//   2. With nothing to move, local hauling (never idle while there is any): a stockpile of the base's with goods in it
//      (fieldworks.js) fetched in; salvage on the base map beyond the ring (a wreck stripped: 6 scrap, a car part and 2 metal sheets;
//      a broken crate or an old drum: a scrap; a rock or a boulder broken for stone: building materials, as there is
//      no stone supply; base.haulJobs, basemap.js queueClear / finishClear), at HAUL.salvage work-hours an hour; else
//      scavenge-lite in the ruins round the base (a share of a scavenger's day, scrap and a little building material,
//      picking the ground over as a scavenger does). Daylight (HAUL.gather).
// Helpers (noidle.js): a Manual person whose job has no work this hour may help with "haul": local hauling only.
//
// THE OUTPOST SHIPPING (economy.js shipFromOutposts) is folded in by direction: an outpost and the hub with a haul
// order between them (either way) and a hauler at either end: the midnight shipping in that direction stops (the
// surplus to the hub when an order goes outpost → hub; the hub's food top-up when one goes hub → outpost) and the
// haulers carry it by the orders. With no hauler it stays the default, as before. The food a starving outpost is
// sent at once (people eat today) stays either way. "surplus" is the shipping's own keep rule as an order.
//
// THE GOVERNOR (autopilot.js govHauling every HAUL.govEvery hours, planRoles step 5c): standing orders of its own
// (o.gov) between its bases where hauling helps (govRules: a base short of food while another has plenty; a step up
// waiting for materials another base can spare; goods outside a full base while another has room), the outpost
// shipping's surplus order with them, dropped once nothing calls for them for a day; and a hauler (the base with
// more people of the pair) while an order has goods to move. A hauler with nothing to move gathers locally.
//
// AI PARITY (groupHaulDaily, factions.js peopleUp after groupbases.js spreadStores): a group with several bases
// hauls the goods its outposts take each day (what the daily supply run out gave them beyond what they held) as a
// convoy party of its own people (parties.js spawnAiParty "convoy", p.haulTo), walking the road to the outpost and
// put into its stores on arrival (parties.js aiPartyHour → haulConvoyArrive): raided like any caravan on the road
// (caravanraids.js: your teams and the gangs). Their haulers' crew-days (hands × the round trip) come off the next
// day's building crew (groupworks.js groupWorksDaily: f.haulDay). Abstract still: what comes in from the outposts
// (gatherStores, the day's work at the main base), their local salvage, and goods under AI_HAUL.minKg.
// tools/haultest.js.
import { atBase, baseById, hourOfDay, day, log, newId, hub, skill } from "./world.js";
import { SUPPLIES, GEAR, CATEGORIES, supWeight, supplyFew } from "./data.js";
import { ROUND_SUPPLIES } from "./data-ammo.js";
import { FOODS, foodIn, takeItem, addFood, packPick, DAY_KG } from "./foods.js";
import { foodUse, mouthsAt } from "./upkeep.js";
import { RATION_DAYS, scavLeft, SCAV_FLOOR, SCAV_DEPLETE, scavYield, waterCapacity, outpostKeep } from "./economy.js"; // call-time only
import { storageOf, storedKey } from "./basestorage.js"; // call-time only
import { gatherRows, underAttack, isCamp } from "./buildings.js"; // call-time only
import { supplyReserve } from "./supply.js"; // call-time only
import { planPath, travelHours, fuelForPath, tileLabel, spawnAiParty } from "./parties.js"; // call-time only
import { poolAtBand, wornLoad, personLoad } from "./load.js"; // call-time only
import { cartOf, isCart, cartBroken, cartFree, cartSpec, cartTerrain } from "./carts.js"; // call-time only
import { payloadOf, typeSpeed, typeFuel, RIDER_KG, isCar } from "./vehicles.js"; // call-time only
import { armTripEvent, fireTripEvent, holdTrip, creditBonus, holdText } from "./tripevents.js"; // call-time only
import { landFor, queueClear, finishClear, ringHalf } from "./basemap.js"; // call-time only
import { dropPointsFor } from "./fieldworks.js"; // call-time only
import { walkHours } from "./tripland.js";
import { gainXp } from "./skills.js";
import { noteOutput } from "./output.js";
import { packFood, topUpPack, PACK } from "./eating.js"; // call-time only
import { RAW } from "./water.js";
import { workFactor } from "./health.js";
import { describeActivity } from "./activity.js"; // call-time only
import { helpingAs } from "./noidle.js"; // call-time only
import { homesOf } from "./groupbases.js"; // call-time only
import { cutOffWhy } from "./poirooms.js"; // a camp inside a POI cut off: nobody leaves its map (issue #71; call-time only)

export const HAUL = {
  start: 6, end: 21,     // a haul trip leaves from 06:00 and is home by 21:00
  gather: [7, 19],       // local hauling: daylight
  loadH: 0.25,           // loading at the gate
  unloadH: 0.5,          // unloading and loading at the far end
  restH: 0.25,           // between trips (unloading at home)
  minKg: 8,              // a route trip is worth it from this many kg
  band: 2,               // loaded to the Heavy band (load.js LOAD_BANDS)
  salvage: 1,            // work-hours an hour at salvage (× their Scavenging: salvageRate)
  stone: { rock: 1, boulder: 3 }, // building materials (stone) from a rock, a boulder (basescatter.js CLEAR: 1 and 3 work-hours)
  lite: 0.5,             // scavenge-lite: this share of a scavenger's day's finds (economy.js scavYield) …
  liteHours: 6,          // … spread over this many hours
  liteBm: 0.1,           // the share of it that is building materials (the rest scrap)
  beyond: 2,             // salvage beyond the ring by this many cells (the yard untouched)
  ownJobs: 1,            // salvage jobs of the haulers' own waiting at a base
  helpMax: 2,            // helpers on hauling at once (noidle.js)
  govEvery: 6,           // the governor looks at the orders every this many hours
  govHold: 24,           // its own order kept this many hours after nothing calls for it
  foodLow: 8, foodPlenty: 20, foodLevel: 10, // days a head
  outsideKg: 30, roomKg: 50,
};
export const AI_HAUL = { minKg: 20, kgHand: 45, maxCrewShare: 0.5, guard: 1.2 };
const r1 = (v) => Math.round((v || 0) * 10) / 10;
const r2 = (v) => Math.round((v || 0) * 100) / 100;
const hod = (h) => ((Math.floor(h) % 24) + 24) % 24;
const dayOf = (t) => Math.floor(t / 24);
const first = (s) => s.name.split(" ")[0];
const EPS = 1e-9;

// ---------- orders ----------
export const haulOrders = (state) => state.haulOrders || (state.haulOrders = []);
export const WHAT_SPECIAL = { food: "Food (days)", surplus: "Surplus (the outpost shipping's rule)", outside: "What lies outside (no room)", all: "Everything (but food, water and rounds)" };
export const CATS = ["scrap", "parts", "medical", "fuel", SUPPLIES.wood.cat, "vehicle", "gunmod", "electronics", "containers", "bow", "water"]; // (wood: its old category key, named "wood" in data.js CATEGORIES)
const isRound = (k) => !!ROUND_SUPPLIES[k] || k === "ammo";
/** The supply keys a base can haul one by one (no food items: "food" is days; no rounds). */
export const haulKeys = () => Object.keys(SUPPLIES).filter((k) => !FOODS[k] && !isRound(k) && supWeight(k) > 0);
/** "Food", "Scrap", "All spare parts" (a category by its name, data.js CATEGORIES) … */
export function whatName(what) {
  if (WHAT_SPECIAL[what]) return WHAT_SPECIAL[what];
  if (String(what).startsWith("cat:")) { const c = what.slice(4); return `All ${CATEGORIES[c] ? CATEGORIES[c].name : c}`; }
  return SUPPLIES[what] ? SUPPLIES[what].name : what;
}
/** Adds a standing order. o: { from, to, what, mode, qty }. Returns { order } or { error }. */
export function addHaulOrder(state, o, gov = false) {
  const A = baseById(state, Number(o.from)), B = baseById(state, Number(o.to));
  if (!A || !B || A === B) return { error: "Pick two different bases of yours." };
  const what = String(o.what || "");
  if (!WHAT_SPECIAL[what] && !SUPPLIES[what] && !what.startsWith("cat:")) return { error: "Pick what to haul." };
  const mode = o.mode === "stock" ? "stock" : "send";
  if (mode === "stock" && (what === "outside" || what === "surplus" || what === "all")) return { error: "Keep stocked takes food, one supply or a category." };
  const qty = Math.max(0, Math.round(Number(o.qty) || 0));
  if (mode === "stock" && !(qty > 0)) return { error: "How much to keep stocked there?" };
  const dup = haulOrders(state).find((x) => x.from === A.id && x.to === B.id && x.what === what && x.mode === mode);
  if (dup) { dup.qty = qty; if (!gov) delete dup.gov; return { order: dup }; }
  const order = { id: newId(), from: A.id, to: B.id, what, mode, qty, ...(gov ? { gov: true, since: state.hour } : {}) };
  haulOrders(state).push(order);
  return { order };
}
export function removeHaulOrder(state, id) {
  const L = haulOrders(state);
  const i = L.findIndex((o) => o.id === Number(id));
  if (i >= 0) L.splice(i, 1);
  return i >= 0;
}
/** "Riverbend → Hub: food, keep 10 days stocked there". */
export function orderText(state, o) {
  const A = baseById(state, o.from), B = baseById(state, o.to);
  const unit = o.what === "food" ? " days" : "";
  const how = o.mode === "stock" ? `keep ${o.qty}${unit} stocked at ${B ? B.name : "?"}` : o.what === "outside" ? "all of it" : o.what === "surplus" ? "over the outpost's keep" : `over ${o.qty}${unit} kept at ${A ? A.name : "?"}`;
  return `${A ? A.name : "?"} → ${B ? B.name : "?"}: ${whatName(o.what).toLowerCase()}, ${how}`;
}
// The orders between two bases, from a to b.
const ordersFromTo = (state, a, b) => haulOrders(state).filter((o) => o.from === a && o.to === b);
// The bases a base has orders with (either way).
export function haulPartners(state, base) {
  const out = new Set();
  for (const o of haulOrders(state)) { if (o.from === base.id) out.add(o.to); if (o.to === base.id) out.add(o.from); }
  return [...out].map((id) => baseById(state, id)).filter(Boolean);
}

// ---------- what is had, kept, wanted ----------
const haveOf = (base, k) => (k === "food" ? foodIn(base.stock) : Math.max(0, base.stock[k] || 0));
const kgOfKey = (k) => (k === "food" ? DAY_KG : FOODS[k] ? FOODS[k].kg : supWeight(k));
// What a base keeps whatever an order says: what its paid jobs still wait for (the step up), what its supply runs
// take or pick up there. { key: q }.
export function senderReserve(state, base) {
  const keep = {};
  for (const job of base.construction || []) if (job.paid) for (const r of gatherRows(job)) if (!r.ok) keep[r.key] = (keep[r.key] || 0) + Math.ceil(r.need - r.have);
  for (const [k, v] of Object.entries(supplyReserve(state, base) || {})) keep[k] = (keep[k] || 0) + v;
  return keep;
}
// Its own needs a stock order never takes: a week of food and more (the shipping's line), three days of water.
function ownKeep(state, base, k) {
  if (k === "food") return foodUse(state, base).total * (RATION_DAYS + 1);
  if (k === "water" || k === RAW) return mouthsAt(state, base).heads * 3;
  return 0;
}
function keysFor(state, base, what) {
  if (what === "food") return ["food"];
  if (what === "outside") return Object.keys(storageOf(state, base).outside.sup).filter((k) => !isRound(k));
  if (what === "all") return haulKeys().filter((k) => k !== "water" && k !== RAW && (base.stock[k] || 0) > 0);
  if (what === "surplus") return ["food", ...haulKeys().filter((k) => k !== RAW && (base.stock[k] || 0) > 0)];
  if (what.startsWith("cat:")) { const c = what.slice(4); return haulKeys().filter((k) => SUPPLIES[k].cat === c); }
  return SUPPLIES[what] ? [what] : [];
}
// Goods on the road: { [baseId]: { key: q } } heading to each base (food in days).
export function inTransit(state) {
  const out = {};
  const add = (id, g) => { if (id == null || !g) return; const T = out[id] || (out[id] = {}); for (const [k, q] of Object.entries(goodsUnits(g))) T[k] = (T[k] || 0) + q; };
  for (const s of state.survivors) {
    const t = s.trip;
    if (!s.alive || !t || t.job !== "haul") continue;
    if (!t.delivered && t.kind !== "fetch") add(t.to, t.out);
    else add(t.base, t.back);
  }
  return out;
}
// What one order wants moved now: { key: q } (food in days), never below the sender's reserve.
export function orderWant(state, o, transit = inTransit(state)) {
  const A = baseById(state, o.from), B = baseById(state, o.to);
  const out = {};
  if (!A || !B || A === B) return out;
  const res = senderReserve(state, A);
  const outside = o.what === "outside" ? storageOf(state, A).outside.sup : null;
  const keep = o.what === "surplus" ? outpostKeep(state, A) : null;
  for (const k of keysFor(state, A, o.what)) {
    const have = haveOf(A, k);
    let q;
    if (o.mode === "stock") q = Math.min(o.qty - haveOf(B, k) - ((transit[B.id] || {})[k] || 0), have - (res[k] || 0) - ownKeep(state, A, k));
    else if (outside) q = Math.min(outside[k] || 0, have - (res[k] || 0));
    else if (keep) q = have - (keep[k] || 0) - (res[k] || 0) - (k === "food" ? 1 : supplyFew(k, 1));
    else q = have - Math.max(o.qty || 0, 0) - (res[k] || 0);
    if (k !== "food") q = Math.floor(q * 10 + EPS) / 10;
    if (q > (k === "food" ? 0.5 : 0) + EPS) out[k] = r2(q);
  }
  return out;
}
// Every order from a to b, merged (stock orders first: shortages before surplus). [[key, q]] in that order.
export function pairWants(state, a, b, transit = inTransit(state)) {
  const list = ordersFromTo(state, a, b).sort((x, y) => (x.mode === "stock" ? 0 : 1) - (y.mode === "stock" ? 0 : 1) || x.id - y.id);
  const m = new Map();
  for (const o of list) for (const [k, q] of Object.entries(orderWant(state, o, transit))) m.set(k, Math.max(m.get(k) || 0, q));
  return [...m.entries()];
}
const wantKg = (wants) => wants.reduce((a, [k, q]) => a + q * kgOfKey(k), 0);

// ---------- goods ----------
// A load: { sup: { key: q }, food: [{ k, q, left, egg }] }.
const emptyGoods = () => ({ sup: {}, food: [] });
export const goodsKg = (g) => (!g ? 0 : Object.entries(g.sup || {}).reduce((a, [k, q]) => a + q * supWeight(k), 0) + (g.food || []).reduce((a, l) => a + l.q * (FOODS[l.k] ? FOODS[l.k].kg : DAY_KG), 0));
const goodsUnits = (g) => {
  const out = { ...(g.sup || {}) };
  const fd = (g.food || []).reduce((a, l) => a + foodIn({ [l.k]: l.q }), 0); // days of food
  if (fd > 0) out.food = fd;
  return out;
};
const goodsEmpty = (g) => !g || goodsKg(g) < 0.05;
/** "40 kg food and scrap". */
export function goodsText(g) {
  if (goodsEmpty(g)) return "";
  const kinds = [];
  if ((g.food || []).some((l) => l.q > 0)) kinds.push("food");
  const sup = Object.entries(g.sup || {}).filter(([, q]) => q > 0).sort((a, b) => b[1] * supWeight(b[0]) - a[1] * supWeight(a[0]));
  for (const [k] of sup) kinds.push(k === RAW ? "water" : (SUPPLIES[k] ? SUPPLIES[k].name : k).toLowerCase());
  const words = kinds.length <= 2 ? kinds.join(" and ") : `${kinds.slice(0, 2).join(", ")} and more`;
  return `${Math.round(goodsKg(g))} kg ${words}`;
}
// Room at a base for a key (kg; Infinity: the woodpile), given what is already earmarked: { stored, water }.
function roomOf(state, base) {
  const st = storageOf(state, base);
  return { stored: Math.max(0, st.free), water: Math.max(0, waterCapacity(base) - Math.max(0, base.stock.water || 0) - Math.max(0, base.stock[RAW] || 0)) };
}
const roomFor = (room, k) => (k === "wood" ? Infinity : k === "water" || k === RAW ? room.water : FOODS[k] || storedKey(k) ? room.stored : Infinity);
const useRoom = (room, k, kg) => { if (k === "water" || k === RAW) room.water -= kg; else if (k !== "wood" && (FOODS[k] || storedKey(k))) room.stored -= kg; };
// Takes up to capKg of the wants out of `from`'s stock, within `room` (the receiving base's; null: none).
function takeGoods(state, from, wants, capKg, room) {
  const g = emptyGoods();
  let cap = capKg;
  for (const [k, q] of wants) {
    if (cap < 0.05) break;
    if (k === "food") {
      const pick = packPick(state, from, q, { days: 30 });
      for (const [fk, fq] of Object.entries(pick)) {
        const w = FOODS[fk] ? FOODS[fk].kg : DAY_KG;
        const lim = Math.min(fq, cap / w, room ? roomFor(room, fk) / w : Infinity);
        const n = FOODS[fk] && FOODS[fk].unit === "kg" ? Math.floor(lim * 10) / 10 : Math.floor(lim + EPS);
        if (!(n > 0)) continue;
        const t = takeItem(from, fk, n, { state });
        if (!(t.q > EPS)) continue;
        for (const l of t.lots) g.food.push({ k: fk, q: l.q, left: l.left, ...(l.egg ? { egg: true } : {}) });
        cap -= t.q * w;
        if (room) useRoom(room, fk, t.q * w);
      }
      continue;
    }
    const w = supWeight(k);
    const lim = Math.min(q, Math.max(0, from.stock[k] || 0), cap / w, room ? roomFor(room, k) / w : Infinity);
    const n = w <= 0.15 ? Math.floor(lim * 10) / 10 : Math.floor(lim + EPS);
    if (!(n > 0)) continue;
    from.stock[k] = r2((from.stock[k] || 0) - n);
    g.sup[k] = r2((g.sup[k] || 0) + n);
    cap -= n * w;
    if (room) useRoom(room, k, n * w);
  }
  return g;
}
// Puts a load into a base's stock. room: true keeps to its free room (the woodpile and the tanks apart); returns what
// did not fit (it goes back with the hauler), else everything goes in.
function putGoods(state, base, g, room = false) {
  const left = emptyGoods();
  if (!g) return left;
  const R = room ? roomOf(state, base) : null;
  for (const l of g.food || []) {
    const w = FOODS[l.k] ? FOODS[l.k].kg : DAY_KG;
    const fit = R ? Math.max(0, Math.min(l.q, R.stored / w)) : l.q;
    if (fit > EPS) { addFood(base, l.k, fit, { left: l.left, egg: !!l.egg, state }); if (R) R.stored -= fit * w; }
    if (l.q - fit > EPS) left.food.push({ ...l, q: r2(l.q - fit) });
  }
  for (const [k, q] of Object.entries(g.sup || {})) {
    const w = supWeight(k);
    const fit = R ? Math.max(0, Math.min(q, roomFor(R, k) / w)) : q;
    if (fit > EPS) { base.stock[k] = r2((base.stock[k] || 0) + fit); if (R) useRoom(R, k, fit * w); }
    if (q - fit > EPS) left.sup[k] = r2(q - fit);
  }
  return left;
}
const mergeGoods = (a, b) => ({ sup: Object.fromEntries([...new Set([...Object.keys(a.sup || {}), ...Object.keys(b.sup || {})])].map((k) => [k, r2(((a.sup || {})[k] || 0) + ((b.sup || {})[k] || 0))])), food: [...(a.food || []), ...(b.food || [])] });

// ---------- the hauler's load and pace ----------
// The cart they would push: theirs, else the armory's best (not broken).
function cartFor(base, s) {
  if (cartOf(s)) return cartBroken(cartOf(s)) ? null : cartOf(s);
  if (s.gear && s.gear.carry) return null; // the arms are full (a tent bag, a bed)
  return (base.armory || []).filter((it) => isCart(it) && !cartBroken(it)).sort((a, b) => cartSpec(b).cap - cartSpec(a).cap)[0] || null;
}
// A vehicle set to hauling, parked here, not out: the biggest.
export function haulVehicle(state, base) {
  return (state.vehicles || []).filter((v) => v.haul && !v.haulOut && v.loc && v.loc.kind === "base" && v.loc.baseId === base.id && isCar(v) && !v.destroyed && (v.condition ?? 100) > 0).sort((a, b) => payloadOf(b) - payloadOf(a))[0] || null;
}
/** Kg a hauler takes: { kg, cart, veh, body } (veh: a car's payload less the driver; else the body to the Heavy band
 *  and a cart's share). */
export function haulCap(state, base, s, veh = null) {
  if (veh) return { kg: Math.max(0, Math.floor(payloadOf(veh) - RIDER_KG - wornLoad(s))), cart: null, veh, body: 0 };
  const c = cartFor(base, s);
  const held = c && cartOf(s) === c;
  let body = poolAtBand([s], HAUL.band);
  if (!c) return { kg: Math.floor(body * 10) / 10, cart: null, veh: null, body };
  const sp = cartSpec(c);
  if (!held) body = Math.max(0, body - (GEAR[c.key].weight || 0) * sp.frac); // its own weight, felt
  const inCart = Math.min(cartFree(c), body / sp.frac);
  return { kg: Math.floor((inCart + Math.max(0, body - inCart * sp.frac)) * 10) / 10, cart: c, veh: null, body, inCart };
}
// The pace on foot with kg loaded (load.js personLoad: the band's slow-down), the cart's share felt.
function footPace(s, cap, kg) {
  const c = cap.cart;
  const sp = c ? cartSpec(c) : null;
  const inCart = c ? Math.min(kg, cap.inCart || 0) : 0;
  const own = c && cartOf(s) !== c ? (GEAR[c.key].weight || 0) * sp.frac : 0;
  const felt = wornLoad(s) + own + (c ? inCart * sp.frac : 0) + (kg - inCart);
  return personLoad(s, felt).speed;
}
// Hours along a path at that pace (parties.js travelHours: the map's route, the teams' pace; no weather).
function legHours(state, path, s, cap, kg, startHour) {
  if (!path || path.length < 2) return 0;
  if (cap.veh) return travelHours(state, path, { vehicle: true, speed: typeSpeed(cap.veh), weather: false, startHour }).exact;
  const cartTer = cap.cart ? cartTerrain([{ ...s, gear: { ...s.gear, carry: cap.cart } }]) : null;
  return travelHours(state, path, { speed: footPace(s, cap, kg), cartTer, weather: false, startHour }).exact;
}

// ---------- the route trips ----------
const pathCaches = new WeakMap(); // state -> its own paths: tile ids repeat across worlds (a new game, a load, the tools)
function routePath(state, a, b, vehicle) {
  let pathCache = pathCaches.get(state);
  if (!pathCache) pathCaches.set(state, (pathCache = new Map()));
  const k = `${a}:${b}:${vehicle ? 1 : 0}:${state.hour >> 5}`;
  if (pathCache.has(k)) return pathCache.get(k);
  if (pathCache.size > 400) pathCache.clear();
  const r = planPath(state, a, b, vehicle) || (vehicle ? planPath(state, a, b, false) : null);
  const out = r ? r.path : null;
  pathCache.set(k, out);
  return out;
}
// The best trip for s from `base` starting at `start`: { dest, out wants, back wants, path, cap, … } or null.
export function planHaul(state, base, s, start, opts = {}) {
  const partners = haulPartners(state, base);
  if (!partners.length) return null;
  const transit = inTransit(state);
  const d0 = dayOf(start) * 24;
  let best = null;
  const veh0 = haulVehicle(state, base);
  for (const X of partners) {
    const outW = pairWants(state, base.id, X.id, transit), backW = pairWants(state, X.id, base.id, transit);
    const kgOut = wantKg(outW), kgBack = wantKg(backW);
    if (kgOut + kgBack < HAUL.minKg) continue;
    let veh = veh0;
    let path = routePath(state, base.tile, X.tile, !!veh);
    if (veh && path && (veh.fuel || 0) < fuelForPath(state, path, typeFuel(veh)) * 2 + 0.5) { veh = null; path = routePath(state, base.tile, X.tile, false); }
    if (!path) continue;
    const cap = haulCap(state, base, s, veh);
    if (cap.kg < 1) continue;
    const roomX = roomOf(state, X), roomH = roomOf(state, base);
    const est = (wants, room) => Math.min(cap.kg, wants.reduce((a, [k, q]) => a + Math.min(q * kgOfKey(k), (k === "food" ? room.stored : roomFor(room, k))), 0));
    const outKg = est(outW, roomX), backKg = est(backW, roomH);
    if (outKg + backKg < HAUL.minKg) continue;
    const outH = legHours(state, path, s, cap, outKg, start + HAUL.loadH);
    const backH = legHours(state, [...path].reverse(), s, cap, backKg, start + HAUL.loadH + outH + HAUL.unloadH);
    const total = HAUL.loadH + outH + HAUL.unloadH + backH;
    if (!opts.anyTime && start + total > d0 + HAUL.end + EPS) continue; // not home tonight: too far for a day's haul
    const score = (outKg + backKg) / Math.max(0.5, total);
    if (!best || score > best.score + EPS) best = { dest: X, outW, backW, path, cap, outKg, backKg, outH, backH, total, score };
  }
  return best;
}
// Sets out on the planned trip: the goods leave the stores, the cart into their arms, the vehicle out.
function startHaul(state, base, s, p, start, n) {
  const roomX = roomOf(state, p.dest);
  const out = takeGoods(state, base, p.outW, p.cap.kg, roomX);
  if (p.cap.cart && cartOf(s) !== p.cap.cart) {
    const i = base.armory.indexOf(p.cap.cart);
    if (i >= 0 && s.gear && !s.gear.carry) { base.armory.splice(i, 1); s.gear.carry = p.cap.cart; p.cap.cart.haulCart = true; }
  }
  if (p.cap.veh) { const v = p.cap.veh; v.haulOut = { sid: s.id, home: base.id }; v.fuel = r2(Math.max(0, (v.fuel || 0) - fuelForPath(state, p.path, typeFuel(v)) * 2)); }
  const t = {
    job: "haul", kind: "route", base: base.id, to: p.dest.id, tile: p.dest.tile, path: p.path, at: p.path[Math.floor(p.path.length / 2)], d: p.path.length - 1,
    leave: start, arrive: r2(start + HAUL.loadH), workEnd: r2(start + HAUL.loadH + p.outH + HAUL.unloadH), home: r2(start + p.total), n,
    out, back: emptyGoods(), cap: p.cap.kg, ...(p.cap.veh ? { veh: p.cap.veh.id } : {}), ...(p.cap.cart ? { cart: p.cap.cart.key } : {}),
    unloadAt: r2(start + HAUL.loadH + p.outH),
  };
  t.carry = { text: goodsText(out), kg: r1(goodsKg(out)) };
  s.trip = t;
  if (packFood(s) < PACK.trip) topUpPack(state, base, s);
  return t;
}

// ---------- local hauling ----------
const inGather = (h) => { const x = hod(h); return x >= HAUL.gather[0] && x < HAUL.gather[1]; };
const inHaulHours = (h) => { const x = hod(h); return x >= HAUL.start && x < HAUL.end; };
// A stockpile of the base's with goods in it (fieldworks.js): the nearest.
function stockpileWork(state, base) {
  let list = [];
  try { list = dropPointsFor(state, base); } catch (e) { return null; }
  const d = list.find((x) => x.fw && Object.values(x.fw.contents || {}).some((q) => q >= 1));
  return d || null;
}
function planFetch(state, base, s, start) {
  const sp = stockpileWork(state, base);
  if (!sp) return null;
  const dist = state.grid.distance(base.tile, sp.tile);
  const cap = haulCap(state, base, s, null);
  if (cap.kg < 1) return null;
  const walk = walkHours("wood", dist);
  const outH = walk / Math.max(0.3, footPace(s, cap, 0)), backH = walk / Math.max(0.3, footPace(s, cap, cap.kg));
  const total = outH + HAUL.unloadH + backH;
  if (start + total > dayOf(start) * 24 + HAUL.gather[1] + 1 + EPS) return null;
  return { sp, cap, outH, backH, total };
}
function startFetch(state, base, s, p, start, n) {
  if (p.cap.cart && cartOf(s) !== p.cap.cart) {
    const i = base.armory.indexOf(p.cap.cart);
    if (i >= 0 && s.gear && !s.gear.carry) { base.armory.splice(i, 1); s.gear.carry = p.cap.cart; p.cap.cart.haulCart = true; }
  }
  const t = {
    job: "haul", kind: "fetch", base: base.id, fw: p.sp.fw.id, tile: p.sp.tile, path: [base.tile, p.sp.tile], at: p.sp.tile, d: state.grid.distance(base.tile, p.sp.tile),
    leave: start, arrive: r2(start + p.outH), workEnd: r2(start + p.outH + HAUL.unloadH), home: r2(start + p.total), n,
    out: emptyGoods(), back: emptyGoods(), cap: p.cap.kg, unloadAt: r2(start + p.outH),
  };
  t.carry = { text: "", kg: 0 };
  s.trip = t;
  if (packFood(s) < PACK.trip) topUpPack(state, base, s);
  return t;
}
// Salvage on the base map: the pieces beyond the ring a hauler takes (nearest first).
const SALVAGE = [
  { k: "wreck", mode: "strip", ok: (base, p) => !(base.land && base.land.looted && base.land.looted[p.g]) },
  { k: "crate", mode: "clear" }, { k: "barrel", mode: "clear" },
  { k: "rock", mode: "clear" }, { k: "boulder", mode: "clear" },
];
function salvagePieces(state, base, n = 1) {
  const land = landFor(state, base);
  if (!land) return [];
  const busy = new Set([...(base.construction || []), ...(base.haulJobs || [])].filter((c) => c.type === "clear" && c.pieces).flatMap((c) => c.pieces.map((p) => `${p.g}|${c.mode || "clear"}`)));
  const R = ringHalf(base) + HAUL.beyond;
  const out = [];
  for (const p of land.list) {
    const S = SALVAGE.find((x) => x.k === p.k);
    if (!S || (S.ok && !S.ok(base, p)) || busy.has(`${p.g}|${S.mode}`)) continue;
    const [x, y] = p.cells[0];
    if (Math.max(Math.abs(x), Math.abs(y)) <= R) continue;
    out.push({ p, mode: S.mode, d: Math.hypot(x, y), r: SALVAGE.indexOf(S) });
  }
  return out.sort((a, b) => a.d - b.d || a.r - b.r || (a.p.g < b.p.g ? -1 : 1)).slice(0, n);
}
const SALVAGE_LABEL = { wreck: "Strip a wreck for scrap and metal sheets", crate: "Haul off a broken crate", barrel: "Haul off an old drum", rock: "Break a rock for stone", boulder: "Break up a boulder for stone" };
function queueSalvage(state, base) {
  const [c] = salvagePieces(state, base, 1);
  if (!c) return null;
  const job = queueClear(state, base, [c.p], { mode: c.mode, label: SALVAGE_LABEL[c.p.k] });
  if (!job) return null;
  const i = base.construction.indexOf(job);
  if (i >= 0) base.construction.splice(i, 1); // the haulers' own work, not the builders' queue
  job.haul = true;
  if (HAUL.stone[c.p.k]) job.get = { ...job.get, buildmat: (job.get.buildmat || 0) + HAUL.stone[c.p.k] }; // stone as building materials
  (base.haulJobs || (base.haulJobs = [])).push(job);
  return job;
}
const salvageJob = (base) => (base.haulJobs || []).find((c) => (c.progress || 0) < c.hours - EPS) || null;
export const salvageRate = (s) => r2(HAUL.salvage * Math.min(1.6, 0.75 + 0.06 * skill(s, "scavenging")) * Math.max(0.3, Math.min(1, workFactor(s))));
function finishSalvage(state, base, job) {
  base.haulJobs.splice(base.haulJobs.indexOf(job), 1);
  // A clearing job the builders have for the same piece is spent too (its yield is in).
  for (const c of [...(base.construction || [])]) {
    if (c.type !== "clear" || !c.pieces || (c.mode || "clear") !== (job.mode || "clear")) continue;
    const gs = new Set(job.pieces.map((p) => p.g));
    if (!c.pieces.some((p) => gs.has(p.g))) continue;
    c.pieces = c.pieces.filter((p) => !gs.has(p.g));
    if (!c.pieces.length) base.construction.splice(base.construction.indexOf(c), 1);
  }
  finishClear(state, base, job);
  for (const [k, v] of Object.entries(job.get || {})) if (v > 0) noteOutput(state, base, "haul", v, k);
  const st = haulStats(state);
  st.salvage = (st.salvage || 0) + 1;
}
const liteOk = (state, base) => scavLeft(base) > SCAV_FLOOR + 0.02;
// Local work a hauler (or a helper) could do here now: { kind: "fetch" | "salvage" | "lite", text } or null.
export function localWork(state, base) {
  if (underAttack(state, base)) return null;
  const sp = stockpileWork(state, base);
  if (sp) return { kind: "fetch", text: `Fetching goods from the stockpile at ${tileLabel(state, sp.tile)}` };
  const j = salvageJob(base);
  if (j) return { kind: "salvage", text: j.label };
  const [c] = salvagePieces(state, base, 1);
  if (c) return { kind: "salvage", text: SALVAGE_LABEL[c.p.k] };
  if (liteOk(state, base)) return { kind: "lite", text: "Picking scrap from the ruins round the base" };
  return null;
}
// One hour of local hauling for s (no trip): salvage or scavenge-lite. Returns what they did, or null.
export function gatherHour(state, base, s, now = state.hour) {
  if (!inGather(now) || underAttack(state, base)) return null;
  let job = salvageJob(base);
  if (!job && (base.haulJobs || []).length < HAUL.ownJobs) job = queueSalvage(state, base);
  if (job) {
    const rate = salvageRate(s);
    job.progress = r2((job.progress || 0) + rate);
    (job.who || (job.who = {}))[s.id] = now;
    s.haulDid = { base: base.id, kind: "salvage", job: job.id, label: job.label, pct: Math.min(100, Math.round((100 * job.progress) / Math.max(EPS, job.hours))), hour: now };
    gainXp(state, s, "scavenging", 0.6);
    noteOutput(state, base, "haul", 0, "scrap");
    if (job.progress >= job.hours - EPS) finishSalvage(state, base, job);
    return s.haulDid;
  }
  if (liteOk(state, base)) {
    const y = scavYield(state, base, s, base.tile) * HAUL.lite / HAUL.liteHours; // supplies this hour
    const acc = base.haulAcc || (base.haulAcc = {});
    acc.scrap = r2((acc.scrap || 0) + y * (1 - HAUL.liteBm));
    acc.buildmat = r2((acc.buildmat || 0) + y * HAUL.liteBm / 3); // a building material is three scrap's worth
    for (const k of ["scrap", "buildmat"]) {
      const n = Math.floor(acc[k] + EPS);
      if (n >= 1) { acc[k] = r2(acc[k] - n); base.stock[k] = (base.stock[k] || 0) + n; noteOutput(state, base, "haul", n, k); }
    }
    base.scavLeft = Math.max(SCAV_FLOOR, scavLeft(base) - SCAV_DEPLETE * HAUL.lite / HAUL.liteHours);
    s.haulDid = { base: base.id, kind: "lite", hour: now, label: "Picking scrap from the ruins" };
    gainXp(state, s, "scavenging", 0.4);
    return s.haulDid;
  }
  return null;
}

// ---------- the hour ----------
export const haulStats = (state) => { const S = state.stats || (state.stats = {}); return S.haul || (S.haul = { trips: 0, kg: 0, lost: 0, fetch: 0, salvage: 0 }); };
// May s set out or work now (their activity line says work, not asleep, eating, hurt …)?
function mayWork(state, s, h) {
  const a = describeActivity(state, s, hod(h), { trips: false });
  return a.kind === "work" && a.job === "haul";
}
// Back home: the goods into the stores, a find, the vehicle parked. (jobtrips.js stepPerson's credit for a haul.)
function arriveHome(state, base, s, t) {
  const lost = t.noLoad || (t.carry && t.carry.empty);
  const st = haulStats(state);
  let text = "";
  if (t.kind === "fetch") {
    if (!lost && !goodsEmpty(t.back)) { putGoods(state, base, t.back); text = `+${goodsText(t.back)}`; st.fetch++; st.kg += goodsKg(t.back); for (const [k, q] of Object.entries(goodsUnits(t.back))) noteOutput(state, base, "haul", q, k); }
    else if (!goodsEmpty(t.back)) { st.lost += goodsKg(t.back); }
  } else if (!t.delivered) {
    // Turned back before they got there: what they still carry comes back into the stores.
    if (!lost) putGoods(state, base, t.out); else { st.lost += goodsKg(t.out); log(state, `${s.name} lost ${goodsText(t.out)} on the road to ${(baseById(state, t.to) || { name: "the other base" }).name}.`, "danger"); }
  } else {
    const g = mergeGoods(t.back, t.ret || emptyGoods());
    if (!lost) { putGoods(state, base, g); if (!goodsEmpty(t.back)) { text = `+${goodsText(t.back)}`; for (const [k, q] of Object.entries(goodsUnits(t.back))) noteOutput(state, base, "haul", q, k); } }
    else if (!goodsEmpty(g)) { st.lost += goodsKg(g); log(state, `${s.name} lost ${goodsText(g)} on the way home from ${(baseById(state, t.to) || { name: "the other base" }).name}.`, "danger"); }
  }
  const bonus = creditBonus(state, base, t, base.stock);
  const pop = [text, bonus].filter(Boolean).join(" ");
  if (pop) { const pops = base.tripPops || (base.tripPops = []); pops.push({ t: r2(t.home), sid: s.id, job: "haul", text: pop, tile: base.tile }); while (pops.length > 12) pops.shift(); }
  vehicleHome(state, t, base);
  gainXp(state, s, "scouting", 0.5);
}
function vehicleHome(state, t, base) {
  if (t.veh == null) return;
  const v = (state.vehicles || []).find((x) => x.id === t.veh);
  if (v && v.haulOut) { delete v.haulOut; if (base) v.loc = { kind: "base", baseId: base.id }; }
}
// The far end: unload (into its free room; the rest comes back), load what goes the other way.
function deliver(state, base, s, t) {
  t.delivered = true;
  const X = t.kind === "fetch" ? null : baseById(state, t.to);
  const lost = t.noLoad || (t.carry && t.carry.empty);
  const st = haulStats(state);
  if (t.kind === "fetch") {
    const fwRec = findFieldWork(state, t.fw);
    if (fwRec && !lost) {
      const room = roomOf(state, base);
      const g = emptyGoods();
      let cap = t.cap;
      const keys = Object.keys(fwRec.contents || {}).sort((a, b) => (SUPPLIES[b] ? SUPPLIES[b].value / SUPPLIES[b].weight : 0) - (SUPPLIES[a] ? SUPPLIES[a].value / SUPPLIES[a].weight : 0));
      for (const k of keys) {
        const w = supWeight(k) || 1;
        const n = Math.floor(Math.min(fwRec.contents[k] || 0, cap / w, roomFor(room, k) / w) * 10) / 10;
        if (!(n > 0)) continue;
        fwRec.contents[k] = r1(fwRec.contents[k] - n);
        if (fwRec.contents[k] <= 0) delete fwRec.contents[k];
        g.sup[k] = r2((g.sup[k] || 0) + n);
        cap -= n * w;
        useRoom(room, k, n * w);
      }
      t.back = g;
    }
    t.carry = { text: goodsText(t.back), kg: r1(goodsKg(t.back)) };
    delete t.noLoad;
    return;
  }
  if (lost) { st.lost += goodsKg(t.out); log(state, `${s.name} lost ${goodsText(t.out) || "the load"} on the road to ${X ? X.name : "the other base"}.`, "danger"); t.out = emptyGoods(); t.ret = emptyGoods(); }
  else if (!X) t.ret = t.out; // the base is gone: it comes back
  else {
    t.ret = putGoods(state, X, t.out, true);
    const moved = goodsKg(t.out) - goodsKg(t.ret);
    st.trips++;
    st.kg += moved;
    for (const [k, q] of Object.entries(goodsUnits(t.out))) { const back = (goodsUnits(t.ret)[k] || 0); if (q - back > EPS) noteOutput(state, X, "haul", q - back, k); }
    if (moved > 0.5) { const pops = X.tripPops || (X.tripPops = []); pops.push({ t: r2(t.unloadAt ?? t.workEnd), sid: s.id, job: "haul", text: `+${Math.round(moved)} kg`, tile: X.tile }); while (pops.length > 12) pops.shift(); }
  }
  if (X) {
    const room = roomOf(state, base);
    const left = Math.max(0, t.cap - goodsKg(t.ret));
    t.back = left > 0.5 ? takeGoods(state, X, pairWants(state, X.id, base.id), left, room) : emptyGoods();
  }
  const g = mergeGoods(t.back, t.ret || emptyGoods());
  t.carry = { text: goodsText(g), kg: r1(goodsKg(g)) };
  delete t.noLoad;
}
function findFieldWork(state, id) {
  try { const sp = (state.bases || []).flatMap((b) => dropPointsFor(state, b)).find((d) => d.fw.id === id); return sp ? sp.fw : null; } catch (e) { return null; }
}
// The trip was cut short before the far end (tripevents.js goHome → jobtrips.js cutShort): home is as far as they
// walked out, not the whole way back.
function fixCut(t) {
  if (!t.cut || t.cutSeen) return;
  t.cutSeen = true;
  if (!t.delivered && t.workEnd < (t.unloadAt ?? t.workEnd) + EPS) {
    t.cutOut = true;
    const walked = Math.max(0, t.workEnd - t.arrive);
    t.home = r2(t.workEnd + walked);
  }
}
// A haul trip that ended with the hauler (killed) or that they left (a team, an errand): the vehicle left where they
// were, the goods with it (lost).
export function haulDropped(state, s, t = s.trip) {
  if (!t || t.job !== "haul") return;
  const st = haulStats(state);
  st.lost += goodsKg(t.delivered ? mergeGoods(t.back, t.ret || emptyGoods()) : t.out);
  if (t.veh != null) {
    const v = (state.vehicles || []).find((x) => x.id === t.veh);
    if (v && v.haulOut) {
      delete v.haulOut;
      if (s.alive && s.location && s.location.kind === "base") v.loc = { kind: "base", baseId: s.location.baseId };
      else v.loc = { kind: "abandoned", tile: t.at, since: state.hour };
    }
  }
}
/**
 * One hauler's hour (jobtrips.js stepPerson for anyone on Haul or out on a haul trip): the trip goes on (its trouble
 * through tripevents.js), the far end, home; else a new trip (an order's goods, a stockpile) or an hour's local hauling.
 */
export function haulStep(state, base, s, now = state.hour) {
  const end = now + 1;
  for (let guard = 0; guard < 4; guard++) {
    const t = s.trip;
    if (t && t.job === "haul") {
      if (!t.evr) armTripEvent(state, base, s, t);
      if (t.ev && t.ev.pending && holdTrip(state, base, s, t, now)) return;
      if (!s.alive || s.trip !== t) { haulDropped(state, s, t); return; }
      if (t.ev && !t.ev.done && t.ev.at < end && t.ev.at < t.home) {
        fireTripEvent(state, base, s, t, now);
        if (!s.alive || s.trip !== t) { haulDropped(state, s, t); return; }
        if (t.ev.pending) return;
      }
      fixCut(t);
      if (!t.delivered && !t.cutOut && (t.unloadAt ?? t.workEnd) < end) deliver(state, base, s, t);
      if (t.home >= end) return;
      arriveHome(state, base, s, t);
      delete s.trip;
      s.haulNext = r2(t.home + HAUL.restH);
      if (s.haulNext >= end) return;
      continue;
    }
    if (s.role !== "haul" || !mayWork(state, s, now)) return;
    const start = Math.max(now, s.haulNext && dayOf(s.haulNext) === dayOf(now) ? s.haulNext : now);
    if (start >= end) return;
    const helping = helpingAs(s) === "haul";
    const n = (s.haulN && s.haulN.day === dayOf(now) ? s.haulN.n : 0);
    if (!helping && inHaulHours(start)) {
      const p = planHaul(state, base, s, start);
      if (p) { startHaul(state, base, s, p, start, n); s.haulN = { day: dayOf(now), n: n + 1 }; continue; }
    }
    if (!helping && inGather(start)) {
      const f = planFetch(state, base, s, start);
      if (f) { startFetch(state, base, s, f, start, n); s.haulN = { day: dayOf(now), n: n + 1 }; continue; }
    }
    gatherHour(state, base, s, now);
    return;
  }
}

// ---------- where a hauler is (the activity line and the map) ----------
/** A haul trip at time t: { phase, f (0..1 along the leg), text, dest, load, held } or null. */
export function haulTripState(state, s, t = state.hour) {
  const tr = s && s.trip;
  if (!tr || tr.job !== "haul" || t < tr.leave || t >= tr.home) return null;
  const X = tr.kind === "fetch" ? null : baseById(state, tr.to);
  const name = tr.kind === "fetch" ? `the stockpile at ${tileLabel(state, tr.tile)}` : X ? X.name : "the other base";
  const held = holdText(tr);
  if (held) return { phase: tr.ev.phase || "work", f: tr.ev.f ?? 0.5, text: `${held} on the way to ${name}`, held: true, kind: tr.kind };
  const ua = tr.unloadAt ?? tr.workEnd;
  const load = tr.carry && !tr.carry.empty ? tr.carry.text : "";
  const hrs = (x) => { const h = Math.max(0, x - t); return h < 1 ? `${Math.max(5, Math.round(h * 60 / 5) * 5)} min out` : `${Math.round(h)} h out`; };
  if (tr.kind === "fetch") {
    if (t < tr.arrive) return { phase: "out", f: (t - tr.leave) / Math.max(EPS, tr.arrive - tr.leave), text: `Walking out to ${name}`, kind: "fetch" };
    if (t < tr.workEnd) return { phase: "work", f: 1, text: `Loading at ${name}`, kind: "fetch" };
    return { phase: "back", f: (t - tr.workEnd) / Math.max(EPS, tr.home - tr.workEnd), text: load ? `Bringing ${load} in from ${name}` : `Heading home from ${name}`, load, kind: "fetch" };
  }
  if (t < tr.arrive) return { phase: "out", f: 0, text: `Loading ${load || "up"} for ${name}`, kind: "route", load };
  if (tr.cutOut || (tr.cut && !tr.delivered)) return { phase: "back", f: Math.min(1, (t - tr.workEnd) / Math.max(EPS, tr.home - tr.workEnd)), reach: Math.max(0, Math.min(1, (tr.workEnd - tr.arrive) / Math.max(EPS, ua - tr.arrive))), text: load ? `Turned back: bringing ${load} home` : "Turned back: heading home", kind: "route", load, turned: true };
  if (t < ua) return { phase: "work", f: (t - tr.arrive) / Math.max(EPS, ua - tr.arrive), text: load ? `Hauling ${load} to ${name} (${hrs(ua)})` : `Heading to ${name} (${hrs(ua)})`, kind: "route", load };
  if (t < tr.workEnd) return { phase: "work", f: 1, text: `Unloading at ${name}`, kind: "route", load };
  return { phase: "back", f: (t - tr.workEnd) / Math.max(EPS, tr.home - tr.workEnd), text: load ? `Bringing ${load} back from ${name} (${hrs(tr.home)})` : `Heading home from ${name} (${hrs(tr.home)})`, kind: "route", load };
}
// The haulers of a base out on the road at time t: [{ s, st, trip }] (the map).
export function outHaulers(state, base, t = state.hour) {
  const out = [];
  for (const s of atBase(state, base.id)) { const st = haulTripState(state, s, t); if (st) out.push({ s, st, trip: s.trip }); }
  return out;
}
// Route goods waiting at a base (by the job: the activity line, the governor): [{ dest, kg }] heaviest first.
const routeMemo = new Map();
export function routeWork(state, base) {
  const k = `${base.id}:${state.hour}:${haulOrders(state).length}`;
  const hit = routeMemo.get(k);
  if (hit) return hit;
  if (routeMemo.size > 200) routeMemo.clear();
  const transit = inTransit(state);
  const out = [];
  for (const X of haulPartners(state, base)) {
    const kg = wantKg(pairWants(state, base.id, X.id, transit)) + wantKg(pairWants(state, X.id, base.id, transit));
    if (kg >= HAUL.minKg && routePath(state, base.tile, X.tile, false)) out.push({ dest: X, kg: r1(kg) });
  }
  out.sort((a, b) => b.kg - a.kg || a.dest.id - b.dest.id);
  routeMemo.set(k, out);
  return out;
}
const JOB_ICON = "📦";
const actOf = (kind, text, why = "", icon = null) => ({ kind, icon: icon || (kind === "work" ? JOB_ICON : kind === "off" ? "🕓" : kind === "idle" ? "⏸" : "⚠️"), text, why, job: "haul" });
/** The Haul job's activity line (activity.js jobActivity). */
export function haulActivity(state, base, s, h, opts = {}) {
  const nowH = h === hourOfDay(state);
  if (opts.trips !== false && nowH && s.trip && s.trip.job === "haul") {
    const st = haulTripState(state, s, state.hour);
    if (st) return actOf("work", st.text, st.held ? "Trouble on the road: they hold where they are until you answer the card (or do what seems best after a few hours)." : st.kind === "fetch" ? "Bringing a stockpile's goods into the base's storage." : "A standing haul order (Supply runs tab: Hauling). The goods go into the other base's storage, as far as it has room.");
  }
  if (underAttack(state, base)) return { ...actOf("off", "On hold: base under siege", `${base.name} is on alert or under attack: nobody goes out until it is over.`, "⛔"), hold: "siege" };
  const co = cutOffWhy(state, base, { heavy: true }); // poirooms.js (#71): a cut-off camp's loads cannot leave its map (a climb out is for people on foot)
  if (co) return actOf("stalled", `Can't haul: ${co}`, `${base.name} is cut off inside its place: nothing is carried off the map until a route is cleared or they break out (Camp tab).`, "⛔");
  const routes = routeWork(state, base);
  const helping = helpingAs(s) === "haul";
  if (!inHaulHours(h)) return actOf("off", "Hauler – off until 06:00", "Haulers set out from 06:00 and are home by 21:00.");
  if (!helping && routes.length) {
    const r = routes[0];
    if (opts.trips === false || !nowH) return actOf("work", `Hauling for ${r.dest.name}`, "");
    if (s.haulNext && s.haulNext > state.hour && dayOf(s.haulNext) === dayOf(state.hour)) return actOf("work", "Unloading at the base", `Out again at ${String(Math.floor(s.haulNext) % 24).padStart(2, "0")}:${String(Math.floor((s.haulNext % 1) * 60)).padStart(2, "0")}.`);
    return actOf("work", `Loading for ${r.dest.name} (~${Math.round(r.kg)} kg waiting)`, "");
  }
  const lw = localWork(state, base);
  if (lw && !(helping && lw.kind === "fetch")) {
    if (!inGather(h)) return actOf("off", "Done hauling for the day", `Local hauling (salvage, the ruins, the stockpiles) is daylight work (${HAUL.gather[0]}:00–${HAUL.gather[1]}:00).`);
    const did = nowH && s.haulDid && s.haulDid.hour >= state.hour - 1 && s.haulDid.base === base.id ? s.haulDid : null;
    const text = did ? (did.kind === "salvage" ? `${did.label}: ${did.pct}%` : did.label) : lw.text;
    return actOf("work", text, "Nothing to move between the bases: the hauler gathers near the base (a stockpile's goods, salvage on the base map, scrap from the ruins).");
  }
  return actOf("idle", "Hauler – nothing to haul or gather", `No haul order has goods waiting at ${base.name}, no stockpile to bring in, nothing left to salvage beyond the walls and the ruins round it are picked clean.`);
}

// ---------- noidle: may one more help with hauling this hour? ----------
export function helpHaulOpen(state, base, h, n) {
  return n < HAUL.helpMax && inGather(h) && !!localWork(state, base) && (localWork(state, base).kind !== "fetch");
}

// ---------- the outpost shipping (economy.js shipFromOutposts) ----------
/** Haulers at either end of a pair: someone alive on Haul at a or b. */
export function pairHauled(state, a, b) {
  return (state.survivors || []).some((s) => s.alive && s.role === "haul" && s.location && s.location.kind === "base" && (s.location.baseId === a.id || s.location.baseId === b.id));
}
/** { up, down }: the directions between an outpost and the hub the haulers carry (an order that way and a hauler). */
export function haulCovers(state, outpost, h) {
  if (!outpost || !h || !pairHauled(state, outpost, h)) return { up: false, down: false };
  return { up: ordersFromTo(state, outpost.id, h.id).length > 0, down: ordersFromTo(state, h.id, outpost.id).length > 0 };
}

// ---------- the governor ----------
const foodDaysAt = (state, base) => foodIn(base.stock) / Math.max(0.5, foodUse(state, base).total);
// The orders it wants now: [{ from, to, what, mode, qty, why }].
export function govRules(state) {
  const out = [];
  const bases = state.bases.filter((b) => b.owner == null || b.owner === "player");
  const pairOk = (a, b) => !!routePath(state, a.tile, b.tile, false);
  for (const X of bases) {
    if (!atBase(state, X.id).length) continue;
    for (const Y of bases) {
      if (X === Y || !pairOk(X, Y)) continue;
      // Food: X short while Y has plenty.
      const fx = foodDaysAt(state, X), fy = foodDaysAt(state, Y);
      if (fx < HAUL.foodLow && fy > HAUL.foodPlenty) out.push({ from: Y.id, to: X.id, what: "food", mode: "stock", qty: Math.ceil(foodUse(state, X).total * HAUL.foodLevel), why: `${X.name} has ${Math.round(fx)} days of food, ${Y.name} ${Math.round(fy)}` });
      // A step up (a paid job) waiting for materials Y can spare.
      for (const job of X.construction || []) {
        if (!job.paid) continue;
        for (const r of gatherRows(job)) {
          if (r.ok) continue;
          const short = Math.ceil(r.need - r.have) - Math.max(0, X.stock[r.key] || 0);
          const spare = Math.max(0, Y.stock[r.key] || 0) - (senderReserve(state, Y)[r.key] || 0) - (r.key === "wood" ? 300 : 20);
          if (short > 0 && spare >= Math.min(short, 10)) out.push({ from: Y.id, to: X.id, what: r.key, mode: "stock", qty: Math.ceil(r.need - r.have), why: `${X.name}'s ${job.type.replace(/_/g, " ")} waits for ${r.key}` });
        }
      }
      // Goods outside a full base while another has room.
      const sx = storageOf(state, X);
      const outKg = Object.entries(sx.outside.sup).reduce((a, [k, q]) => a + q * supWeight(k), 0);
      if (outKg >= HAUL.outsideKg && storageOf(state, Y).free >= HAUL.roomKg) out.push({ from: X.id, to: Y.id, what: "outside", mode: "send", qty: 0, why: `${Math.round(outKg)} kg outside at ${X.name}, room at ${Y.name}` });
    }
  }
  // The outpost shipping as an order where the governor hauls between an outpost and the hub anyway.
  const H = hub(state);
  if (H) for (const r of [...out]) {
    const other = r.from === H.id ? r.to : r.to === H.id ? r.from : null;
    const O = other != null ? baseById(state, other) : null;
    if (O && O.type === "outpost" && !(isCamp(O)) && !out.some((x) => x.from === O.id && x.to === H.id && x.what === "surplus")) out.push({ from: O.id, to: H.id, what: "surplus", mode: "send", qty: 0, why: "the outpost's surplus to the hub (the midnight shipping's rule)" });
  }
  return out;
}
/** The governor's standing orders (autopilot.js, every HAUL.govEvery hours): its own added, kept while called for and
 *  HAUL.govHold hours after; the player's untouched. */
export function govHauling(state) {
  const want = govRules(state);
  const L = haulOrders(state);
  for (const r of want) {
    const o = L.find((x) => x.from === r.from && x.to === r.to && x.what === r.what && x.mode === r.mode);
    if (o) { if (o.gov) { o.qty = r.qty; o.since = state.hour; o.why = r.why; } continue; }
    const res = addHaulOrder(state, r, true);
    if (res.order) res.order.why = r.why;
  }
  for (let i = L.length - 1; i >= 0; i--) {
    const o = L[i];
    if (!o.gov) continue;
    if (!baseById(state, o.from) || !baseById(state, o.to) || state.hour - (o.since ?? 0) > HAUL.govHold) L.splice(i, 1);
  }
}
/** Haulers the governor wants at a base: one for every pair it is the hauling end of (the end with more people,
 *  the hub on a tie) with goods waiting, at most two; none at a base of fewer than two. */
export function haulersWanted(state, base) {
  const ppl = atBase(state, base.id).length;
  if (ppl < 2) return 0;
  let n = 0;
  for (const r of routeWork(state, base)) {
    const X = r.dest, px = atBase(state, X.id).length;
    const mine = ppl > px || (ppl === px && (base.type === "hub" || base.id < X.id)) || px < 2;
    if (mine && r.kg >= HAUL.minKg * 2) n++;
  }
  return Math.min(2, n, Math.max(1, Math.floor(ppl / 4)));
}
/** Out on a haul trip now: the governor keeps their role. */
export const onHaulTrip = (state, s) => !!(s && s.trip && s.trip.job === "haul" && s.trip.leave <= state.hour && state.hour < s.trip.home);
/** The best hauler first: strength and stamina (health, a strong back), Scouting for the road. */
export function haulScore(s) {
  return (s.health ?? 100) / 20 + skill(s, "scouting") * 0.3 + (s.traits && s.traits.includes("strongback") ? 2 : 0) - (s.traits && s.traits.includes("badback") ? 3 : 0) + (cartOf(s) ? 1 : 0);
}

// ---------- AI parity ----------
const homeKg = (st) => Object.entries(st || {}).reduce((a, [k, q]) => a + (typeof q === "number" && q > 0 ? q * supWeight(k) : 0), 0);
/** A group's day of hauling (factions.js peopleUp, right after groupbases.js spreadStores): the goods each outpost
 *  took beyond what it held (h.held: groupbases.js gatherStores) go out on a convoy of its people, robbed like any
 *  caravan; their crew-days come off the next day's building (f.haulDay). */
export function groupHaulDaily(state, f) {
  if (!f || !f.alive || f.outsider || !Array.isArray(f.bases) || f.bases.length < 2) return;
  const H = homesOf(state, f);
  const today = day(state);
  const rec = { day: today, kg: 0, hands: 0, crewDays: 0, convoys: 0 };
  for (const t of f.bases.slice(1)) {
    const h = H[t];
    if (!h || !h.held) continue;
    const goods = {};
    for (const [k, q] of Object.entries(h.stock)) {
      if (typeof q !== "number" || !(q > 0) || (!SUPPLIES[k] && !FOODS[k])) continue;
      const inflow = Math.floor((q - (h.held[k] || 0)) * 10) / 10;
      if (inflow > 0) goods[k] = inflow;
    }
    delete h.held;
    const kg = homeKg(goods);
    if (kg < AI_HAUL.minKg) continue;
    const res = planPath(state, f.bases[0], t, false, f.id);
    if (!res) continue;
    const hands = Math.max(1, Math.ceil(kg / AI_HAUL.kgHand));
    const p = spawnAiParty(state, f, "convoy", f.bases[0], t, { strength: Math.max(2, hands * AI_HAUL.guard) });
    if (!p) continue;
    for (const [k, q] of Object.entries(goods)) h.stock[k] = r2((h.stock[k] || 0) - q);
    p.goods = { supplies: goods, gear: [] };
    p.haulTo = t;
    rec.kg += kg; rec.hands += hands; rec.convoys++;
    rec.crewDays += hands * Math.min(1, (2 * Math.max(1, res.cost)) / 12);
  }
  for (const t of f.bases.slice(1)) if (H[t]) delete H[t].held;
  rec.kg = r1(rec.kg); rec.crewDays = r2(rec.crewDays);
  f.haulDay = rec;
}
/** A group's haul convoy at its outpost (parties.js aiPartyHour): what it carries into that base's stores. */
export function haulConvoyArrive(state, p) {
  const f = (state.factions || []).find((x) => x.id === p.owner);
  if (!f || !f.alive) return;
  const H = homesOf(state, f);
  const h = H[p.haulTo] || H[f.bases[0]];
  if (!h) return;
  for (const [k, q] of Object.entries((p.goods && p.goods.supplies) || {})) if (q > 0) h.stock[k] = r2((h.stock[k] || 0) + q);
  p.goods = { supplies: {}, gear: [] };
  f.haulIn = (f.haulIn || 0) + 1;
}
/** The crew-days a group's haulers took yesterday (groupworks.js groupWorksDaily: off today's building crew). */
export function groupHaulCrew(state, f, crew) {
  const r = f && f.haulDay;
  if (!r || r.day !== day(state) - 1) return 0;
  return Math.min(crew * AI_HAUL.maxCrewShare, r.crewDays);
}
