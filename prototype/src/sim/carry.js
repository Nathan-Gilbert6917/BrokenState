// @ts-check
// Carrying the team's supplies: where food, water, firewood, fresh game, fuel and the rest physically are, person by
// person, what carrying by hand costs in a fight, putting things on the ground and picking them up again, and how
// much a team collects.
//
// ONE POOL, PLACED. A team's supplies stay one pool (p.supplies, what was packed, and p.cargo.supplies, what was
// found; parties.js): every module reads and spends them as before, and the team's weight, pace and rations are still
// the pool shared out (load.js). This module only says WHERE each unit of the bulk supplies (HOLD_KEYS) is held:
//
//   p.hold = { by: { [survivorId]: { pocket: {key: qty}, pack: {key: qty}, hands: {key: qty} } }, car: {key: qty} }
//
//   pocket  small things only: HOLD[key].pocket units a free pocket (a ration, a bottle of water)
//   pack    HOLD[key].pack units a free pack slot (2 L of water, 4 rations, a 2 kg bundle of firewood)
//   hands   anything, carried in the arms: a 20 L jerrycan, a crate, an armful of firewood, a deer carcass. Up to
//           HANDS_KG a person; past that someone is overloaded. Hands full: no gun, no blade, no reload, no throw,
//           no treating (combat.js) until it is set down (Drop carried: free).
//   THE HANDS (the user's ask, 2026-10-19). Everything in the "carried" part of the inventory fills the hands: the
//           supplies in the arms (hands), a bag in the arms (bag) and the finds a survivor carries loose in a fight
//           (raidloot.js u.haul: the search window's Carried column). With anything there (handsBusy) they cannot
//           shoot, strike with a weapon, reload, throw, treat, open or close a door, work a lock, climb a window,
//           hotwire a car or free a captive (HAND_ACTS, combatAct), and a closed door stops their move (reachable).
//           Two different things carried (handsCount: a supply kind, an item, a bag each count one) are two hands
//           full: nothing more can be taken from a container, a body, the ground, the vehicle or a teammate
//           (handsTakeRefusal: raidloot.js raidMove, ground.js pickUpFromGround, carryBag, pickCarried) until something
//           is put down (the ground: free) or moved into the pack, the pockets or the vehicle. Half cover (a fence,
//           sandbags, crates, a counter: combat.js CELL vault) can still be vaulted, at twice the vault's cost
//           (combat.js VAULT), and the load set down on its far side (Set over cover: 1 action, facing the cover;
//           setOverCover): a ground pile anyone can pick up later from the ground.
//   car     the team's car or truck takes all of it; bikes' racks up to their rack kg (vehicles.js).
// Packs and pockets are the slots left free by the items kept there (inventory.js): putting an item in the pack
// pushes supplies out of it, into someone's hands. Quantities are units of the supply (floats: food is eaten in
// parts). Food is by type (foods.js) but held here in days of food: "food" (everything but raw meat and fish, FOOD_KG
// a day as a rough figure for the places: the team's real weight is the items', load.js) and "meat" (raw meat and
// fish, hunting.js MEAT_KG a day). On the ground and in a fight's piles it is the items themselves (cans of beans,
// kilos of venison), each with its shelf left.
// The small kit (meds, rounds, arrows, gun parts, electronics, the reloading bench's brass) stays abstract: spread in
// pouches and pockets, never in the hands.
//
// settleHold keeps p.hold matching the pool, and is called lazily by every reader (the UI, a battle starting): what
// was eaten, drunk, spent or traded comes off the hands first (people drink from the jerrycan they carry), then the
// car, the packs, the pockets; what is new (found, collected, bought) goes in the car, then the packs, then the
// pockets, then the hands: the weakest fighters carry first, each up to HANDS_KG, so the others keep their hands
// free. A hand-placed stack stays where the player put it (moveHeld) as long as the pool has it.
// Only player teams (not convoys) hold; AI groups' parties keep their stores abstract (their people never fight
// with full hands: AI parity note).
//
// THE GROUND. On the State Map the ground is the tile's site in state.deathSites (one per tile): a site with no
// names is "Cargo left behind" (parties.js shedOverload already used it). It persists in saves, has its map marker
// (markers.js: "Cargo left behind: 20 un-purified water, a machete", the contents in its label and tooltip),
// scavengers strip it (economy.js deathSitesDaily: the most valuable stack first, faster by roads and towns), the
// Recover mission (and the governor) fetches what fits, and any team standing on the tile can Pick up… what and how
// much it wants (pickUpGround). Food on the ground spoils (groundDaily): each stack's shelf left runs at the stores'
// "outside" factor (storage.js storeFactor; cans and rations hardly at all, raw meat in a day or two).
//
// FIGHTS (decided: carriers start a tactical battle with their hands full, a fight by the numbers drops at once).
//   - On the battle map (combat.js createBattle → fitHands): u.hands = what they carry. Drop carried is free (no
//     action): it lands on their cell as a ground pile (groundDropCell → ground.js dropToGround; the supplies leave
//     the pool at that moment, b.armsDrops remembers what was set down from the arms and where); Pick up load (1
//     action) takes the team's own loads from a pile on their cell or next to it back into the arms (and the pool).
//     A pile is a pile: fire burns it, a blast wears it, anyone can take things off it with the Ground window
//     (hauling, ground.js), the enemy snatches a gun out of it. The battle AI drops at once (autoPlayerTurn).
//     A fight the team starts (stagedStart: a raid, an assault on a base, a hive or a growth, a rescue) begins with
//     free hands: what the arms held goes into the vehicle as far as it has room, the rest is set down where each one
//     starts (stageLoads, marked staged: it comes back after unless the team is beaten). A base's fight: no loads.
//     The team's kind of supplies taken off a pile with the Ground window go into the taker's arms too (pileToArms).
//     Food set down lies there as its items (a pile's supplies: raw venison, cans of beans), spoiling as on the
//     tile's ground once the fight is over.
//   - By the numbers: the carriers set it down when it starts.
//   - Afterwards: won, what is left of the loads set down goes back (combat.js endBattle → armsDropsEnd, before the
//     piles become loot: the supplies into the pool, a bag into its carrier's arms or the cargo); retreated, broken
//     off or beaten, the piles stay on the tile (ground.js groundLeftovers: a death site). finishCombat →
//     settleCarried then handles only who still holds a load (and piles no battle end reached: a raid's).
//
// BAGS IN THE ARMS. A whole container (a looted pack, a second pack, a rig, a gun case) can be carried in the arms
// instead of worn: the survivor's EQUIP_SLOTS "carry" slot (s.gear.carry, inventory.js; its contents "s:<id>:bag:<i>").
// It is an item on them, so its weight (the bag and everything in it, itemLoad) counts in their load, the team's pace
// and their battle weight like anything worn; it fills the arms like a load of supplies (the same hands-full rule,
// and HANDS_KG less its weight for supplies). Set down on the State Map it goes on the ground as one item (contents
// intact); in a fight Drop carried sets it down with the rest (groundDropCell: a gun in it leaves the team loaded,
// gunload.js), and the end of the fight treats it as the loads: won, back in its carrier's arms (or the team's
// cargo), else on the tile's ground. In the battle's search window a bag on the ground or on a body can be taken
// straight into the arms (Carry in arms: ground.js pickUpFromGround arms, the In arms slot). Put it on from the
// inventory (Backpack / Rig) when the back is free, or take things out of it there. carryBag is the one call for
// picking a bag up into someone's arms from anywhere (the tactical search window, a body, the ground).
//
// CARTS (carts.js: a wheelbarrow, a hand cart). A cart in the arms is a bag in the arms for every rule above, and one
// more place for the team's supplies: p.hold.by[sid].cart (PLACES), up to its free kg (carts.js cartFree), filled after
// the car and before the packs (a lone survivor's haul goes in it), never the hands (its pusher's hands are on the
// handles: roomAt hands 0). Set down on the State Map (dropBag, dropItemToGround, settleCarried) its share of the pool
// goes with it as its lots (cartToGround: item.held); picked up again (carryBag, pickUpGround, the Recover mission:
// cartToArms) the lots come back into the pool and into it (settleHold, absorbHeld). In a fight Drop carried lets it go
// as a cart on the map (carts.js letGoCart), not a pile, and the end of the fight settles it (carts.js cartsEnd).
//
// HOW MUCH (collectInfo): Fetch water, Hunt, Fish, Forage and Cut wood take a quantity (order o.qty): the task stops
// collecting at that many units (orders.js startTask: task.capKg, parties.js cargoRoom). The team panel asks (a
// slider, the team's room and the weight a unit, defaulting to the most that fits); the governor, the autopilot
// and the AI give no quantity: the most that fits, as before.
import { SUPPLIES, GEAR, supValue } from "./data.js";
import { packOf, ensureInv, itemAt, removeAt, parseLoc, placeOfLoc, itemLoad, isCarryable } from "./inventory.js";
import { partyMembers, cargoRoom, partyTile, addGearToCargo, poolLoad } from "./parties.js";
import { FOODS, foodUnits, takeFood, addFood, giveFood, unitsOf } from "./foods.js"; // food by type, held in days of food
import { partyVehicle, partyVehicles, isCar, isBike, VEHICLE_TYPES } from "./vehicles.js";
import { combatPower, survivorById, day, newId, log, baseById } from "./world.js";
import { markDeathSite } from "./markers.js";
import { storeFactor } from "./storage.js";
import { forageKg } from "./foraging.js"; // what a day of the season's forage weighs (call-time only)
import * as Weather from "./weather.js";
import { addWormWater } from "./worm.js";
import { say, active, vaultsNear } from "./combat.js";
import { faceToward } from "./vision.js"; // Set over cover turns them to the cover (free)
import { dropToGround, pilesNear, settlePile } from "./ground.js"; // the battle map's piles (call-time only: safe in the import cycle)
import { lootLayer, raidShares, haulLoad, haulText, dropHaulInto } from "./raidloot.js"; // the finds carried loose fill the hands too (call-time only: safe in the import cycle)
import { gunLeavesTeam } from "./gunload.js"; // a gun in a bag set down leaves the team loaded
import { isCart, cartOf, cartFree, addLot, cartWorth, letGoCart, cartsEnd, oneHandOk, cartSpec } from "./carts.js"; // carts: a place for the supplies, a 1x1 thing in a fight (call-time only)

// ---------- the table ----------
// pack: units a pack slot holds, pocket: units a pocket holds (0: never there). kg: per unit (food: FOOD_KG a day,
// meat: MEAT_KG a day).
export const HOLD = {
  water:     { pack: 2,  pocket: 1, name: "purified water" },
  rawwater:  { pack: 2,  pocket: 1, name: "un-purified water" },
  food:      { pack: 4,  pocket: 1, name: "days of food" },
  meat:      { pack: 2,  pocket: 0, name: "days of raw meat" },
  fuel:      { pack: 2,  pocket: 0, name: "fuel" },
  jars:      { pack: 4,  pocket: 0, name: "jars" },
  wood:      { pack: 20, pocket: 0, name: "firewood" },
  parts:     { pack: 1,  pocket: 0, name: "machine parts" },
  scrap:     { pack: 1,  pocket: 0, name: "scrap" },
  carparts:  { pack: 0,  pocket: 0, name: "car parts" },
  buildmat:  { pack: 0,  pocket: 0, name: "building materials" }, // lumber and blocks: in the arms or a vehicle
};
// In the order they are packed: water and food in the packs first, the bulky stuff last (it ends up in the arms).
export const HOLD_KEYS = Object.keys(HOLD);
export const HANDS_KG = 25;     // what one person carries in their arms before counting as overloaded
export const PLACES = ["pocket", "pack", "hands", "cart"];
export const PLACE_NAMES = { pocket: "Pockets", pack: "Pack", hands: "Carried (hands)", cart: "Cart", car: "Vehicle", ground: "Ground" };
// The order kinds that collect a resource, the supply they bring and what a unit weighs (the quantity prompt).
export const COLLECT = { water: "rawwater", wood: "wood", forage: "food", hunt: "meat", fish: "meat" };
const EPS = 1e-6;
const MEAT_KG = 1.35; // hunting.js MEAT_KG (a literal: no use of an import while the module graph loads)
export const FOOD_KG = 1; // a day of packed food, roughly (cans 2.2 kg, MREs 1.1, jerky 0.5): the places' figure
// Raw meat and fish (hold "meat") and the rest of the food (hold "food").
const isRaw = (k, f) => !!f.raw;
const notRaw = (k, f) => !f.raw;
export const holdKeyOf = (k) => (FOODS[k] ? (FOODS[k].raw ? "meat" : "food") : k);

export const unitKg = (k) => (k === "meat" ? MEAT_KG : k === "food" ? FOOD_KG : SUPPLIES[k] ? SUPPLIES[k].weight : 1);
export const holdName = (k) => (HOLD[k] ? HOLD[k].name : SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : k);
const r1 = (x) => Math.round(x * 10) / 10;
export const qtyText = (q) => (Math.abs(q - Math.round(q)) < 0.05 ? String(Math.round(q)) : String(r1(q)));
export const stackText = (k, q) => `${qtyText(q)} ${holdName(k)}`;
export const kgOf = (rec) => Object.entries(rec || {}).reduce((a, [k, q]) => a + (q > 0 ? q * unitKg(k) : 0), 0);
const nonzero = (rec) => { const o = {}; for (const [k, q] of Object.entries(rec || {})) if (q > EPS) o[k] = q; return Object.keys(o).length ? o : null; };
const add = (rec, k, q) => { rec[k] = (rec[k] || 0) + q; if (rec[k] <= EPS) delete rec[k]; };
export const recText = (rec) => Object.entries(rec || {}).filter(([, q]) => q > EPS).map(([k, q]) => stackText(k, q)).join(", ");

// ---------- the pool ----------
export const holdsOwn = (p) => !!(p && p.owner === "player" && p.kind !== "convoy" && p.supplies);
// Units of each hold key the team has (packed and found; food and raw meat in days of food).
export function holdTotals(p) {
  const out = {};
  const cs = (p.cargo && p.cargo.supplies) || {};
  for (const k of HOLD_KEYS) {
    if (k === "food" || k === "meat") { const f = k === "meat" ? isRaw : notRaw; out[k] = foodUnits(p, f) + (p.cargo && p.cargo.supplies ? foodUnits(p.cargo, f) : 0); continue; }
    out[k] = Math.max(0, Math.max(0, (p.supplies && p.supplies[k]) || 0) + Math.max(0, cs[k] || 0));
  }
  return out;
}
// Puts `qty` of a key back in the pool (the found cargo): a food item as itself (egg: how much of it carries the
// worm's eggs, left: its shelf left), days of "food"/"meat" as the stores' mix or game (a fallback).
function addPool(p, key, qty, egg = 0, left = null) {
  if (!(qty > 0) || !p) return;
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  p.cargo.supplies = p.cargo.supplies || {};
  if (FOODS[key]) {
    const e = Math.max(0, Math.min(qty, egg || 0));
    if (qty - e > EPS) addFood(p.cargo, key, qty - e, { left });
    if (e > EPS) addFood(p.cargo, key, e, { left, egg: true });
    return;
  }
  if (key === "food" || key === "meat") { giveFood(null, p.cargo, qty, key === "meat" ? "game" : "stores"); return; }
  p.cargo.supplies[key] = (p.cargo.supplies[key] || 0) + qty;
}
// Takes `qty` days of "food" or "meat" out of the pool as items (the found cargo and the packs, the soonest to spoil
// first): [{ k, q, left, egg }].
function takePoolLots(p, key, qty) {
  if (!(qty > 0)) return [];
  return takeFood([p.cargo, p].filter((h) => h && h.supplies), qty, { only: key === "meat" ? isRaw : notRaw }).lots;
}
// Takes `qty` of a hold key out of the pool (the found cargo first, then what was packed). Returns what it took.
function takePool(p, key, qty) {
  if (!(qty > 0)) return 0;
  if (key === "food" || key === "meat") return takePoolLots(p, key, qty).reduce((a, l) => a + unitsOf(l.k, l.q), 0);
  let want = qty, got = 0;
  const cs = p.cargo && p.cargo.supplies;
  if (cs) {
    const free = Math.max(0, cs[key] || 0);
    const t = Math.min(want, free);
    if (t > 0) { cs[key] -= t; got += t; want -= t; }
  }
  if (want > EPS && p.supplies) {
    const t = Math.min(want, Math.max(0, p.supplies[key] || 0));
    if (t > 0) { p.supplies[key] -= t; got += t; }
  }
  return got;
}

// ---------- room ----------
export const freePack = (s) => { const pk = packOf(s); return pk ? pk.filter((x) => !x).length : 0; };
export const freePockets = (s) => (ensureInv(s).pockets || []).filter((x) => !x).length;
const per = (k, place) => (HOLD[k] ? HOLD[k][place] || 0 : 0);
const slotsUsed = (rec, place) => Object.entries(rec || {}).reduce((a, [k, q]) => a + (q > EPS && per(k, place) ? Math.ceil(q / per(k, place) - EPS) : 0), 0);
// Units of `k` that still go in this pocket or pack record with `slots` free slots (a part-filled slot of k first).
function roomFor(rec, k, place, slots) {
  const n = per(k, place);
  if (!n) return 0;
  const q = rec[k] || 0;
  const partial = q > EPS ? Math.ceil(q / n - EPS) * n - q : 0;
  return Math.max(0, partial + n * Math.max(0, slots - slotsUsed(rec, place)));
}
const slotsOf = (s, place) => (place === "pack" ? freePack(s) : place === "pocket" ? freePockets(s) : 0);
// Takes stacks off a pocket or pack record until it fits its slots (the bulky kinds first). Returns nothing: what
// comes off is loose and settleHold places it again.
function trimTo(rec, place, slots) {
  for (const k of [...HOLD_KEYS].reverse()) {
    while (slotsUsed(rec, place) > slots && (rec[k] || 0) > EPS) {
      const n = per(k, place) || 1;
      const part = rec[k] % n;
      rec[k] -= part > EPS ? part : Math.min(n, rec[k]);
      if (rec[k] <= EPS) delete rec[k];
    }
  }
}
// A team of several vehicles (vehicles.js fleets, up to MAX_VEHICLES; walkers.js): any car or truck among them takes
// it all; with bikes only, every bike's rack.
const carOf = (state, p) => {
  const vs = partyVehicles(state, p);
  if (!vs.length) { const v = partyVehicle(state, p); if (v) vs.push(v); }
  const car = vs.some((v) => isCar(v));
  return { car, rack: car ? 0 : vs.filter((v) => isBike(v)).reduce((a, v) => a + (v.count || 1) * VEHICLE_TYPES.bike.rack, 0) };
};

// ---------- settling ----------
// Makes p.hold match the pool (see the top). Returns p.hold, or null for a party that does not hold (AI, convoys).
export function settleHold(state, p) {
  if (!holdsOwn(p)) return null;
  const members = partyMembers(state, p);
  const h = p.hold && p.hold.by ? p.hold : (p.hold = { by: {}, car: {} });
  if (!h.car) h.car = {};
  const ids = new Set(members.map((s) => String(s.id)));
  for (const id of Object.keys(h.by)) if (!ids.has(id)) delete h.by[id]; // gone home, dead, captured: theirs comes loose
  for (const s of members) { const r = h.by[s.id] || (h.by[s.id] = {}); for (const pl of PLACES) if (!r[pl]) r[pl] = {}; }
  for (const s of members) { const c = cartOf(s); if (c && c.held && c.held.length) absorbHeld(state, p, h.by[s.id].cart, c); } // a cart picked up with what it carried
  tidyHelp(members); // two on a hand cart (carts.js): only while both are on the team, the cart pushed, the helper's arms free
  const { car, rack } = carOf(state, p);
  if (!car && !rack) h.car = {};
  const tot = holdTotals(p);
  for (const k of Object.keys(h.car)) if (!HOLD[k]) delete h.car[k];
  // 1. More placed than the pool has (eaten, drunk, spent, traded): off the hands first, then the car, packs, pockets.
  for (const k of HOLD_KEYS) {
    let over = placedOf(h, k) - tot[k];
    if (over <= EPS) continue;
    const take = (rec) => { const q = rec[k] || 0; const t = Math.min(q, over); if (t > 0) { rec[k] = q - t; if (rec[k] <= EPS) delete rec[k]; over -= t; } };
    for (const s of members) if (over > EPS) take(h.by[s.id].hands);
    if (over > EPS) take(h.car);
    for (const s of members) if (over > EPS) take(h.by[s.id].cart);
    for (const s of members) if (over > EPS) take(h.by[s.id].pack);
    for (const s of members) if (over > EPS) take(h.by[s.id].pocket);
  }
  // 2. Containers that shrank (an item put in the pack, the pack taken off, the bikes gone): the overflow comes loose.
  for (const s of members) { const r = h.by[s.id]; trimTo(r.pack, "pack", freePack(s)); trimTo(r.pocket, "pocket", freePockets(s)); trimKg(r.cart, cartFree(cartOf(s))); if (cartOf(s) || s.cartHelp != null) trimKg(r.hands, 0); } // a cart gone or fuller of items: the overflow comes loose
  if (rack) for (const k of [...HOLD_KEYS].reverse()) { const over = kgOf(h.car) - rack; if (over > EPS && h.car[k]) { h.car[k] = Math.max(0, h.car[k] - over / unitKg(k)); if (h.car[k] <= EPS) delete h.car[k]; } }
  // 3. What is not placed yet: the car, the carts, the packs, the pockets, then the hands.
  const loose = {};
  for (const k of HOLD_KEYS) { const q = tot[k] - placedOf(h, k); if (q > EPS) loose[k] = q; }
  if (Object.keys(loose).length) placeLoose(h, members, loose, car, rack);
  return h;
}
// Takes stacks off a cart's record until it weighs no more than kg (the bulky kinds first).
function trimKg(rec, kg) {
  for (const k of [...HOLD_KEYS].reverse()) {
    const over = kgOf(rec) - kg;
    if (over <= EPS) return;
    if (!(rec[k] > EPS)) continue;
    rec[k] = Math.max(0, rec[k] - over / unitKg(k));
    if (rec[k] <= EPS) delete rec[k];
  }
}
// A cart's lots (item.held: carried while no team held it) into the team's pool, placed in the cart (rec). Food comes
// back as its items with their shelf left, un-purified water with its eggs.
function absorbHeld(state, p, rec, cart) {
  for (const l of cart.held || []) {
    if (!(l.q > EPS) || !SUPPLIES[l.k]) continue;
    addPool(p, l.k, l.q, l.egg ? l.q : 0, l.left ?? null);
    if (l.k === "rawwater") addWormWater(state, p, l.q, l.eggs || 0);
    const hk = holdKeyOf(l.k);
    if (HOLD[hk]) add(rec, hk, FOODS[l.k] ? unitsOf(l.k, l.q) : l.q);
  }
  delete cart.held;
}
export function placedOf(h, k) {
  let q = h.car[k] || 0;
  for (const r of Object.values(h.by)) for (const pl of PLACES) q += (r[pl] && r[pl][k]) || 0;
  return q;
}
function placeLoose(h, members, loose, car, rack) {
  for (const k of HOLD_KEYS) {
    if (!(loose[k] > EPS)) continue;
    if (car) { add(h.car, k, loose[k]); loose[k] = 0; continue; }
    if (rack) { const n = Math.min(loose[k], Math.max(0, rack - kgOf(h.car)) / unitKg(k)); if (n > EPS) { add(h.car, k, n); loose[k] -= n; } }
  }
  // The carts (carts.js), up to their free kg: what a lone survivor hauls goes in theirs.
  for (const k of HOLD_KEYS) {
    for (const s of members) {
      if (!(loose[k] > EPS)) break;
      const c = cartOf(s);
      if (!c) continue;
      const rec = h.by[s.id].cart;
      const n = Math.min(loose[k], Math.max(0, cartFree(c) - kgOf(rec)) / unitKg(k));
      if (n > EPS) { add(rec, k, n); loose[k] -= n; }
    }
  }
  for (const place of ["pack", "pocket"]) {
    for (const k of HOLD_KEYS) {
      for (const s of members) {
        if (!(loose[k] > EPS)) break;
        const rec = h.by[s.id][place];
        const n = Math.min(loose[k], roomFor(rec, k, place, slotsOf(s, place)));
        if (n > EPS) { add(rec, k, n); loose[k] -= n; }
      }
    }
  }
  // The hands: the weakest fighters first, each up to HANDS_KG; past that, the one with the least in their arms.
  const order = [...members].sort((a, b) => Number(bagKg(a) > 0) - Number(bagKg(b) > 0) || combatPower(a) - combatPower(b) || a.id - b.id); // a bag in the arms: last
  const armsKg = (s) => (cartOf(s) || s.cartHelp != null ? HANDS_KG : kgOf(h.by[s.id].hands) + bagKg(s)); // a cart's pusher (and a helper): hands on the handles
  for (const k of HOLD_KEYS) {
    for (const s of order) {
      if (!(loose[k] > EPS)) break;
      const rec = h.by[s.id].hands;
      const n = Math.min(loose[k], Math.max(0, HANDS_KG - armsKg(s)) / unitKg(k));
      if (n > EPS) { add(rec, k, n); loose[k] -= n; }
    }
    if (loose[k] > EPS && order.length) {
      const s = order.reduce((a, b) => (armsKg(b) < armsKg(a) ? b : a));
      add(h.by[s.id].hands, k, loose[k]);
      loose[k] = 0;
    }
  }
}

// ---------- reading ----------
// What a person has in their arms ({ key: qty } or null). s: a survivor on a team.
export function handsOf(state, s) {
  const p = s && s.location && s.location.kind === "party" ? state.parties.find((x) => x.id === s.location.partyId) : null;
  const h = p ? settleHold(state, p) : null;
  return h && h.by[s.id] ? nonzero(h.by[s.id].hands) : null;
}
// Everyone's places, for the panels: [{ s, pocket, pack, hands, kg, freePack, freePockets }] and the car.
export function holdView(state, p) {
  const h = settleHold(state, p);
  if (!h) return null;
  const people = partyMembers(state, p).map((s) => {
    const r = h.by[s.id];
    const c = cartOf(s);
    return { s, bag: bagOf(s), bagKg: bagKg(s), cartItem: c, cart: nonzero(r.cart) || {}, cartKg: kgOf(r.cart), cartRoom: c ? Math.max(0, cartFree(c) - kgOf(r.cart)) : 0, pocket: nonzero(r.pocket) || {}, pack: nonzero(r.pack) || {}, hands: nonzero(r.hands) || {}, kg: kgOf(r.pocket) + kgOf(r.pack) + kgOf(r.hands) + kgOf(r.cart), handsKg: kgOf(r.hands), freePack: freePack(s), freePockets: freePockets(s), packUsed: slotsUsed(r.pack, "pack"), pocketUsed: slotsUsed(r.pocket, "pocket") };
  });
  const { car, rack } = carOf(state, p);
  return { people, car: nonzero(h.car) || {}, hasCar: car, rack, carKg: kgOf(h.car) };
}
// The ones whose hands are full: [{ s, hands, bag }] (a load of supplies, a bag, or both).
export function carriersOf(state, p) {
  const v = holdView(state, p);
  return v ? v.people.filter((x) => Object.keys(x.hands).length || x.bag).map((x) => ({ s: x.s, hands: x.hands, bag: x.bag })) : [];
}
// The bag someone carries in the arms (inventory.js EQUIP_SLOTS carry), and what it weighs with its contents.
export const bagOf = (s) => (s && s.gear && s.gear.carry) || null;
export const bagKg = (s) => (bagOf(s) ? itemLoad(bagOf(s)) : 0);
// Picks a bag up into someone's arms. where: a battle (state.combat; who: the unit or its id) or a team (who: a
// survivor or a survivor id). The caller takes the item out of where it was (a container, a body, the ground) when
// this returns "" (the tactical search window and ground items call this: one call, the hands-full rule follows).
// Returns "" or why not.
export function carryBag(state, where, who, item) {
  const why = bagRefusal(state, where, who, item);
  if (why) return why;
  const battle = where && where.units ? where : null;
  const u = battle ? (typeof who === "object" ? who : battle.units.find((x) => x.id === who)) : null;
  const s = u ? survivorById(state, u.sid) : typeof who === "object" ? who : survivorById(state, who);
  s.gear.carry = item;
  if (u) u.bag = item;
  return "";
}
// Why this bag cannot go into these arms now ("" when it can): not a bag, nobody, a bag in the arms already, a body.
export function bagRefusal(state, where, who, item) {
  if (!item || !isCarryable(item)) return `Only a bag, a rig or a case is carried in the arms${item ? ` (not the ${item.name})` : ""}.`;
  const battle = where && where.units ? where : null;
  const u = battle ? (typeof who === "object" ? who : battle.units.find((x) => x.id === who)) : null;
  const s = u ? survivorById(state, u.sid) : typeof who === "object" ? who : survivorById(state, who);
  if (!s || !s.alive) return "Nobody to carry it.";
  ensureInv(s);
  if (s.gear.carry) return `${s.name.split(" ")[0]} already carries the ${s.gear.carry.name} in their arms: set it down first.`;
  if (u && (u.carrying != null || u.dragging != null)) return "Hands full: put the body down first.";
  if (u) { const why = handsTakeRefusal(u, `the ${item.name}`); if (why) return why; } // two different things carried already
  return "";
}
// Sets the bag down on the ground of the team's tile (one item, contents and all). Returns its name ("" if none).
export function dropBag(state, p, s) {
  const bag = bagOf(s);
  if (!bag) return "";
  if (isCart(bag)) return cartToGround(state, p, s);
  s.gear.carry = null;
  const site = groundAt(state, partyTile(p), true);
  site.items.push(groundGear(bag));
  touched(state, site);
  return bag.name;
}
const groundGear = (item) => (isCart(item) ? { kind: "gear", key: item.key, name: item.name, qty: 1, value: cartWorth(item), cartKg: r1(itemLoad(item)), item } // carts.js: worth and weight with what is in it (the marker names it so)
  : { kind: "gear", key: item.key, name: item.name, qty: 1, value: Math.round((GEAR[item.key] ? GEAR[item.key].value || 0 : 0) * (item.quality || 1)), item });
export const groundGearOf = groundGear;

// ---------- carts (carts.js) ----------
// The team's supplies placed in someone's cart taken out of the pool: [{ k, q, left?, egg?, eggs? }] (food as its items,
// the soonest to spoil first). The cart's record is emptied.
export function cartSupOut(state, p, s) {
  const h = settleHold(state, p);
  const rec = h && h.by[s.id] && h.by[s.id].cart;
  if (!rec) return [];
  const out = [];
  for (const [k, q] of Object.entries(rec)) {
    if (!(q > EPS)) continue;
    if (k === "food" || k === "meat") { for (const l of takePoolLots(p, k, q)) out.push({ k: l.k, q: l.q, ...(l.left != null ? { left: l.left } : {}), ...(l.egg ? { egg: true } : {}) }); continue; }
    const got = takePool(p, k, q);
    if (got > EPS) out.push({ k, q: got, ...(k === "rawwater" && p.wormEggs ? { eggs: p.wormEggs } : {}) });
  }
  h.by[s.id].cart = {};
  return out;
}
// The team's supplies placed in each cart ({ [sid]: kg }), for the weight (load.js teamLoad); null with no cart.
export function cartSupOf(state, p) {
  if (!holdsOwn(p)) return null;
  const members = partyMembers(state, p);
  if (!members.some((s) => cartOf(s))) return null;
  const h = settleHold(state, p);
  const out = {};
  for (const s of members) if (cartOf(s)) out[s.id] = kgOf(h.by[s.id].cart);
  return out;
}
// A cart on a tile's ground (one item, everything in it).
export function cartOnTile(state, tile, cart) {
  const site = groundAt(state, tile, true);
  site.items.push(groundGear(cart));
  touched(state, site);
  return site;
}
// Someone's cart set down on the team's tile, with its share of the pool as its lots. Returns its name ("" if none).
export function cartToGround(state, p, s) {
  const cart = cartOf(s);
  if (!cart) return "";
  if (holdsOwn(p)) for (const l of cartSupOut(state, p, s)) addLot(cart, l.k, l.q, l);
  s.gear.carry = null;
  cartOnTile(state, partyTile(p), cart);
  return cart.name;
}
// ---------- two on a hand cart (carts.js twoMan) ----------
// A helper (s.cartHelp: the pusher's id) and the pusher (s.cartHelper: the helper's id): the pusher feels half their
// share of the cart and the team goes at half the drag (carts.js cartFrac, cartPace); the helper's arms are full too
// (nothing carried in them; in a fight hands full until they let go). Kept only while it makes sense (tidyHelp).
function tidyHelp(members) {
  const byId = new Map(members.map((s) => [s.id, s]));
  for (const s of members) {
    if (s.cartHelper != null) { const h = byId.get(s.cartHelper); const c = cartOf(s); if (!h || h.cartHelp !== s.id || !c || !cartSpec(c).twoMan || (h.gear && h.gear.carry)) delete s.cartHelper; }
    if (s.cartHelp != null) { const pu = byId.get(s.cartHelp); if (!pu || pu.cartHelper !== s.id) delete s.cartHelp; }
  }
}
// Has someone help pull a teammate's hand cart (pusher: a survivor id; null: stop helping). Returns a message.
export function setCartHelp(state, p, helperId, pusherId) {
  const members = partyMembers(state, p);
  const h = members.find((s) => s.id === helperId);
  if (!h) return "Not on this team.";
  if (pusherId == null) {
    const pu = members.find((s) => s.id === h.cartHelp);
    if (pu && pu.cartHelper === h.id) delete pu.cartHelper;
    delete h.cartHelp;
    settleHold(state, p);
    return `${h.name.split(" ")[0]} stops helping with the cart.`;
  }
  const pu = members.find((s) => s.id === pusherId);
  const c = cartOf(pu);
  if (!pu || !c) return "Nobody pushes a cart there.";
  if (!cartSpec(c).twoMan) return `The ${c.name.toLowerCase()} takes one person.`;
  ensureInv(h);
  if (h.gear.carry) return `${h.name.split(" ")[0]} has their arms full (the ${h.gear.carry.name}).`;
  if (pu.cartHelper != null && pu.cartHelper !== h.id) return `Someone already helps ${pu.name.split(" ")[0]}.`;
  if (h.cartHelp != null && h.cartHelp !== pu.id) setCartHelp(state, p, h.id, null);
  h.cartHelp = pu.id; pu.cartHelper = h.id;
  settleHold(state, p);
  return `${h.name.split(" ")[0]} helps ${pu.name.split(" ")[0]} pull the ${c.name.toLowerCase()}: half the weight felt, half the drag off the roads (both have their hands full).`;
}
// The lots of the carts in a team's cargo (and pushed by its people) into its pool (parties.js unloadAt: a team coming
// into a base empties them into the stores).
export function cartLotsIn(state, p) {
  if (!p) return;
  const carts = [...((p.cargo && p.cargo.gear) || []), ...partyMembers(state, p).map((s) => cartOf(s))].filter((c) => isCart(c) && c.held && c.held.length);
  for (const c of carts) absorbHeld(state, p, {}, c);
}
// A cart into the free arms of someone on the team (the weakest fighter first: the others keep their hands free).
// Returns their first name, or "" when nobody's arms are free.
export function cartToArms(state, p, cart) {
  const free = partyMembers(state, p).filter((s) => { ensureInv(s); return !s.gear.carry; }).sort((a, b) => combatPower(a) - combatPower(b) || a.id - b.id);
  if (!free.length) return "";
  if (carryBag(state, p, free[0], cart)) return "";
  return free[0].name.split(" ")[0];
}
// Units of `k` the team can still take with nobody's hands full: the car or the racks, free pack slots, pockets.
export function fitsStowed(state, p, k) {
  const h = settleHold(state, p);
  if (!h) return Infinity;
  const { car, rack } = carOf(state, p);
  if (car) return Infinity;
  let n = rack ? Math.max(0, rack - kgOf(h.car)) / unitKg(k) : 0;
  for (const s of partyMembers(state, p)) for (const pl of ["pack", "pocket"]) n += roomFor(h.by[s.id][pl], k, pl, slotsOf(s, pl));
  return n;
}

// ---------- moving it about ----------
// where: { sid, place } for a person ("pocket", "pack", "hands"), { place: "car" } for the vehicle.
const recAt = (h, w) => (w.place === "car" ? h.car : h.by[w.sid] ? h.by[w.sid][w.place] : null);
const whereText = (state, w) => (w.place === "car" ? "the vehicle" : `${(survivorById(state, w.sid) || { name: "?" }).name.split(" ")[0]}'s ${w.place === "hands" ? "arms" : w.place === "pocket" ? "pockets" : w.place === "cart" ? String((cartOf(survivorById(state, w.sid)) || { name: "cart" }).name).toLowerCase() : "pack"}`);
// Room at a place for more of `k` (units).
export function roomAt(state, p, w, k) {
  const h = settleHold(state, p);
  if (!h) return 0;
  if (w.place === "car") { const { car, rack } = carOf(state, p); return car ? Infinity : rack ? Math.max(0, rack - kgOf(h.car)) / unitKg(k) : 0; }
  const s = survivorById(state, w.sid);
  const rec = h.by[w.sid] && h.by[w.sid][w.place];
  if (!s || !rec) return 0;
  if (w.place === "hands") return cartOf(s) || s.cartHelp != null ? 0 : Math.max(0, HANDS_KG - kgOf(rec) - bagKg(s)) / unitKg(k); // a cart's pusher: hands on the handles
  if (w.place === "cart") return cartOf(s) ? Math.max(0, cartFree(cartOf(s)) - kgOf(rec)) / unitKg(k) : 0;
  return roomFor(rec, k, w.place, slotsOf(s, w.place));
}
// Moves qty units of `k` from one place to another (as much as there is and as fits). Returns a message.
export function moveHeld(state, p, k, qty, from, to) {
  const h = settleHold(state, p);
  if (!h || !HOLD[k]) return "Nothing to move.";
  const a = recAt(h, from), b = recAt(h, to);
  if (!a || !b) return "Not there any more.";
  if (a === b) return "";
  const have = a[k] || 0;
  if (have <= EPS) return `No ${holdName(k)} there.`;
  const room = roomAt(state, p, to, k);
  const n = Math.min(have, Number.isFinite(qty) ? Math.max(0, qty) : have, room);
  if (n <= EPS) return to.place === "cart" ? (cartOf(survivorById(state, to.sid)) ? `${whereText(state, to)} is full.` : "No cart there.") : to.place === "hands" ? (cartOf(survivorById(state, to.sid)) ? "Hands on the cart's handles: put it in the cart." : `${whereText(state, to)} are full (${HANDS_KG} kg).`) : to.place === "car" ? "No vehicle with room." : `No room in ${whereText(state, to)} for ${holdName(k)}${per(k, to.place) ? "" : `: ${holdName(k)} does not go in ${to.place === "pocket" ? "a pocket" : "a pack"}`}.`;
  a[k] = have - n; if (a[k] <= EPS) delete a[k];
  add(b, k, n);
  return `${stackText(k, n)} → ${whereText(state, to)}.`;
}

// ---------- the ground (State Map) ----------
// The tile's site (state.deathSites), made when asked.
export function groundAt(state, tile, make = false) {
  let site = (state.deathSites || []).find((d) => d.tile === tile) || null;
  if (!site && make) { site = { id: newId(), tile, items: [], day: day(state), names: [], lastConfirmed: day(state) }; state.deathSites.push(site); }
  return site;
}
export const groundItemText = (it) => (it.kind === "gear" ? it.name : `${qtyText(it.qty)} ${FOODS[it.key] ? FOODS[it.key].word : it.name.toLowerCase()}`);
export const groundText = (site, n = 6) => (site && site.items.length ? site.items.slice(0, n).map(groundItemText).join(", ") + (site.items.length > n ? `, and ${site.items.length - n} more` : "") : "nothing");
// A stack of a supply on the ground. Food: extra.left (its shelf left, averaged with a stack already there) and
// extra.worm (how much of it carries the worm's eggs).
function addGroundSupply(site, key, q, extra = {}) {
  if (!SUPPLIES[key]) return;
  const cur = site.items.find((i) => i.kind === "supply" && i.key === key);
  if (cur) {
    if (extra.eggs != null) cur.eggs = ((cur.eggs || 0) * cur.qty + extra.eggs * q) / (cur.qty + q);
    if (extra.worm != null) cur.worm = (cur.worm || 0) + extra.worm;
    if (FOODS[key]) cur.left = ((cur.left ?? FOODS[key].shelf) * cur.qty + (extra.left ?? FOODS[key].shelf) * q) / (cur.qty + q);
    cur.qty += q;
    cur.value = cur.qty * supValue(key);
  } else site.items.push({ kind: "supply", key, name: SUPPLIES[key].name, qty: q, value: q * supValue(key), ...(FOODS[key] ? { left: extra.left ?? FOODS[key].shelf } : {}), ...(extra.eggs != null ? { eggs: extra.eggs } : {}), ...(extra.worm > 0 ? { worm: extra.worm } : {}) });
}
// Supplies left on a tile's ground by those who cannot carry them on (nomads.js leaveOnGround: a band's goods where
// nobody of it is left to carry them, or what will not fit).
export function leaveSuppliesAt(state, tile, sup) {
  const list = Object.entries(sup || {}).filter(([k, q]) => SUPPLIES[k] && q > 1e-9);
  if (!list.length || tile == null) return;
  const site = groundAt(state, tile, true);
  for (const [k, q] of list) addGroundSupply(site, k, q);
}
const touched = (state, site) => { site.lastConfirmed = day(state); markDeathSite(state, site); };
// Stores and kit left on a tile's ground by nobody's team (hardcore-groups.js militaryFalls: what nobody could carry
// out of a fallen base stays in its ruin): every supply of `stock` as a stack, every item of `items` as itself.
// Returns the site, or null with nothing to leave.
export function leaveOnGround(state, tile, stock = {}, items = []) {
  const sup = Object.entries(stock || {}).filter(([k, q]) => SUPPLIES[k] && Number.isFinite(q) && q > EPS);
  const gear = (items || []).filter(Boolean);
  if (!sup.length && !gear.length) return null;
  const site = groundAt(state, tile, true);
  for (const [k, q] of sup) addGroundSupply(site, k, q);
  for (const it of gear) site.items.push(groundGear(it));
  touched(state, site);
  return site;
}
function dropSite(state, site) {
  if (site.items.length || (site.walked && site.walked.length) || site.names.length) return;
  const i = state.deathSites.indexOf(site);
  if (i >= 0) state.deathSites.splice(i, 1);
  if (!state.deathSites.some((d) => d.tile === site.tile)) state.markers = state.markers.filter((m) => m.key !== `death:${site.tile}`);
}
// Puts qty of `k` held at `from` (a person's place or the car) on the ground of the team's tile. Returns a message.
export function dropHeld(state, p, k, qty, from) {
  const h = settleHold(state, p);
  if (!h || !HOLD[k]) return "Nothing to put down.";
  const rec = recAt(h, from);
  const have = rec ? rec[k] || 0 : 0;
  const n = Math.min(have, Number.isFinite(qty) ? Math.max(0, qty) : have);
  if (n <= EPS) return `No ${holdName(k)} there.`;
  return groundPut(state, p, { [k]: n }, from) || `Put ${stackText(k, n)} on the ground.`;
}
// Takes the units in `sup` ({ key: qty }) off the places (from: one place first, else wherever they are) and out of
// the pool, onto the ground of the team's tile. Returns "" or an error.
function groundPut(state, p, sup, from = null) {
  const h = settleHold(state, p);
  const site = groundAt(state, partyTile(p), true);
  for (const [k, want] of Object.entries(sup)) {
    let owed = want;
    const off = (rec) => { if (!rec || owed <= EPS) return; const t = Math.min(rec[k] || 0, owed); if (t > 0) { rec[k] -= t; if (rec[k] <= EPS) delete rec[k]; owed -= t; } };
    if (from) off(recAt(h, from));
    for (const r of Object.values(h.by)) off(r.hands);
    off(h.car);
    for (const r of Object.values(h.by)) off(r.cart);
    for (const r of Object.values(h.by)) { off(r.pack); off(r.pocket); }
    if (k === "food" || k === "meat") { for (const l of takePoolLots(p, k, want)) addGroundSupply(site, l.k, l.q, { left: l.left, worm: l.egg ? l.q : 0 }); continue; } // the items themselves
    const got = takePool(p, k, want);
    if (got > EPS) addGroundSupply(site, k, got, k === "rawwater" ? { eggs: p.wormEggs || 0 } : {});
  }
  touched(state, site);
  dropSite(state, site);
  return "";
}
// Everything in someone's arms (sid) or everyone's (sid null) onto the ground. Returns a message.
export function dropHands(state, p, sid = null) {
  const out = [];
  for (const { s, hands, bag } of carriersOf(state, p)) {
    if (sid != null && s.id !== sid) continue;
    if (Object.keys(hands).length) groundPut(state, p, hands, { sid: s.id, place: "hands" });
    if (bag) dropBag(state, p, s);
    out.push(`${s.name.split(" ")[0]}: ${[recText(hands), bag ? `the ${bag.name}${bag.contents && bag.contents.some(Boolean) ? " (with what is in it)" : ""}` : ""].filter(Boolean).join(", ")}`);
  }
  return out.length ? `Put on the ground: ${out.join("; ")}. Any team on this tile can pick it up again.` : "Nobody is carrying anything by hand.";
}
// An item on a team (a person's slot, pocket, pack or pouch; the team's cargo) onto the ground of its tile.
export function dropItemToGround(state, locStr) {
  const loc = parseLoc(locStr);
  const place = placeOfLoc(state, loc);
  if (!place || !place.startsWith("party:") || loc.o === "body") return "Only a team in the field puts things on the ground (at a base they go in the armory).";
  const p = state.parties.find((x) => x.id === Number(place.split(":")[1]));
  const item = itemAt(state, locStr);
  if (!p || !item) return "Nothing there.";
  if (isCart(item) && loc.o === "s" && loc.slot === "carry") { const s = survivorById(state, loc.id); if (s && cartOf(s) === item) { cartToGround(state, p, s); return `Set the ${item.name.toLowerCase()} down with everything in it (${r1(itemLoad(item))} kg). Any team on this tile can take it again.`; } }
  removeAt(state, locStr);
  const site = groundAt(state, partyTile(p), true);
  site.items.push(groundGear(item));
  touched(state, site);
  return `Put the ${item.name} on the ground. Any team on this tile can pick it up again.`;
}
// Picks up qty of the site's item i (a stack: as much as asked and as fits; an item: if it fits). Returns a message.
export function pickUpGround(state, p, i, qty = Infinity, arms = null) {
  const site = groundAt(state, partyTile(p));
  const it = site && site.items[i];
  if (!it) return "Nothing there any more.";
  let msg;
  if (it.kind === "gear" && arms != null) { // arms: a survivor id: the bag goes in their arms (carryBag), not the cargo
    const item = it.item || { key: it.key, name: (GEAR[it.key] && GEAR[it.key].name) || it.name, quality: 1 };
    const s = survivorById(state, arms);
    if (!s || !partyMembers(state, p).includes(s)) return "Not on this team.";
    const why = carryBag(state, p, s, item);
    if (why) return why;
    site.items.splice(i, 1);
    msg = `${s.name.split(" ")[0]} picks up the ${it.name} and carries it in their arms (${r1(itemLoad(item))} kg; no weapon until it is set down).`;
  } else if (it.kind === "gear" && isCart(it.item) && cartToArms(state, p, it.item)) { // carts.js: into someone's free arms first, whole
    site.items.splice(i, 1);
    msg = `Picked up the ${it.name.toLowerCase()}: ${cartToArmsName(state, p, it.item)} pushes it (${r1(itemLoad(it.item))} kg, ${cartWords(it.item)}; hands full until it is set down).`;
  } else if (it.kind === "gear") {
    const item = it.item || { key: it.key, name: (GEAR[it.key] && GEAR[it.key].name) || it.name, quality: 1 };
    if (!addGearToCargo(state, p, item)) return `No room to carry the ${it.name} (${r1(itemLoad(item))} kg; ${r1(cargoRoom(state, p))} kg free).`;
    site.items.splice(i, 1);
    msg = `Picked up the ${it.name}.`;
  } else {
    const k = it.key;
    const want = Math.min(it.qty, Number.isFinite(qty) ? Math.max(0, qty) : it.qty);
    let n;
    {
      const fit = cargoRoom(state, p) / unitKg(k);
      n = Math.min(want, Math.floor(fit + EPS)); // whole units, but a last part-unit (a kilo of meat) goes when it fits
      if (want - n < 1 && want <= fit + EPS) n = want;
      if (n > EPS) {
        p.cargo = p.cargo || { supplies: {}, gear: [] };
        if (FOODS[k]) { const egg = it.worm > 0 ? it.worm * Math.min(1, n / it.qty) : 0; addPool(p, k, n, egg, it.left ?? null); if (egg > 0) it.worm = Math.max(0, it.worm - egg); } // foods.js: with its shelf left and the worm's eggs
        else p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + n;
        if (k === "rawwater") addWormWater(state, p, n, it.eggs || 0);
      }
    }
    if (!(n > EPS)) return `No room to carry any ${groundItemText({ ...it, qty: 1 }).replace(/^1 /, "")} (${unitKg(k)} kg each; ${r1(cargoRoom(state, p))} kg free).`;
    it.qty -= n;
    it.value = Math.max(0, it.qty) * supValue(it.key);
    if (it.qty < 0.05) site.items.splice(i, 1);
    msg = `Picked up ${stackText(k, n)}${it.qty >= 0.05 ? ` (${qtyText(it.qty)} left on the ground)` : ""}.`;
  }
  touched(state, site);
  dropSite(state, site);
  return msg;
}
const cartToArmsName = (state, p, cart) => { const s = partyMembers(state, p).find((x) => x.gear && x.gear.carry === cart); return s ? s.name.split(" ")[0] : "someone"; };
const cartWords = (cart) => { const n = (cart.contents || []).filter(Boolean).length + (cart.held || []).length; return n ? `with ${n} thing${n === 1 ? "" : "s"} in it` : "empty"; };
// Opens a cart lying on the tile's ground (carts.js: what is in a cart is had through the cart, never as loose things
// on the tile): one thing out of it into the team (ref.item: a slot of its grid, into the cargo; ref.lot: a lot of its
// supplies, as much as fits, into the pool). The cart stays on the ground. Returns a message.
export function takeFromGroundCart(state, p, i, ref) {
  const site = groundAt(state, partyTile(p));
  const it = site && site.items[i];
  const cart = it && it.item;
  if (!isCart(cart)) return "No cart there.";
  let msg;
  if (ref.item != null) {
    const x = (cart.contents || [])[ref.item];
    if (!x) return "Not in it any more.";
    if (!addGearToCargo(state, p, x)) return `No room to carry the ${x.name} (${r1(itemLoad(x))} kg; ${r1(cargoRoom(state, p))} kg free).`;
    cart.contents[ref.item] = null;
    msg = `Took the ${x.name} out of the ${cart.name.toLowerCase()}.`;
  } else {
    const l = (cart.held || [])[ref.lot];
    if (!l) return "Not in it any more.";
    const w = SUPPLIES[l.k] ? SUPPLIES[l.k].weight : 1;
    const n = Math.min(l.q, Math.floor((cargoRoom(state, p) + EPS) / Math.max(1e-6, w)) || 0, Number.isFinite(ref.qty) ? Math.max(0, ref.qty) : l.q);
    if (!(n > EPS)) return `No room to carry any (${r1(cargoRoom(state, p))} kg free).`;
    addPool(p, l.k, n, l.egg ? n : 0, l.left ?? null);
    if (l.k === "rawwater") addWormWater(state, p, n, l.eggs || 0);
    l.q -= n;
    if (l.q < 0.05) cart.held.splice(ref.lot, 1);
    if (!cart.held.length) delete cart.held;
    msg = `Took ${qtyText(n)} ${String(SUPPLIES[l.k] ? SUPPLIES[l.k].name : l.k).toLowerCase()} out of the ${cart.name.toLowerCase()}.`;
  }
  it.value = cartWorth(cart);
  it.cartKg = r1(itemLoad(cart));
  touched(state, site);
  return msg;
}
// Everything on the tile that fits: supplies first, then items, the most valuable first. Returns a message.
export function pickUpAll(state, p) {
  const site = groundAt(state, partyTile(p));
  if (!site || !site.items.length) return "Nothing on the ground here.";
  const got = [];
  const order = [...site.items].sort((a, b) => (a.kind === "supply" ? 0 : 1) - (b.kind === "supply" ? 0 : 1) || b.value - a.value);
  for (const it of order) {
    const i = site.items.indexOf(it);
    if (i < 0) continue;
    const before = it.kind === "gear" ? 1 : it.qty;
    const m = pickUpGround(state, p, i);
    if (/^Picked up/.test(m)) got.push(it.kind === "gear" ? it.name : stackText(it.key, before - Math.max(0, site.items.includes(it) ? it.qty : 0)));
  }
  const left = groundAt(state, partyTile(p));
  return got.length ? `Picked up ${got.join(", ")}.${left && left.items.length ? ` No room for the rest: ${groundText(left)}.` : ""}` : `No room to carry any of it (${r1(cargoRoom(state, p))} kg free).`;
}
// Daily: food on the ground spoils: each stack's shelf left runs at the stores' outside factor (cans and rations by
// the "stable" one), and a stack at 0 is gone.
export function groundDaily(state) {
  const w = Weather.weather ? Weather.weather(state) : { temp: 15, key: "clear" };
  const temp = w.temp ?? 15, wet = w.key === "rain" || w.key === "storm", heat = w.key === "heat";
  for (const site of [...(state.deathSites || [])]) {
    let changed = false;
    for (const it of [...site.items]) {
      const f = it.kind === "supply" && FOODS[it.key];
      if (!f) continue;
      it.left = (it.left ?? f.shelf) - storeFactor(f.stable ? "stable" : "outside", temp, { wet, heat });
      if (it.left <= 0 || it.qty < 0.05) site.items.splice(site.items.indexOf(it), 1);
      changed = true;
    }
    if (changed && !site.items.length) dropSite(state, site);
  }
}

// ---------- how much to collect ----------
// What a collecting order would bring and how much the team has room for: { key, kg (a unit), max (units that fit
// by weight), stowed (units that fit with nobody's hands full), name }.
// Forage weighs what the season's forage weighs (foraging.js forageKg: berries and greens are heavy), game MEAT_KG.
const collectKg = (state, type) => (type === "forage" ? (state ? forageKg(state) : 3.5) : unitKg(COLLECT[type]));
export function collectInfo(state, p, type) {
  const k = COLLECT[type];
  if (!k) return null;
  const kg = collectKg(state, type);
  const room = cargoRoom(state, p);
  const max = Math.max(0, Math.floor(room / kg + EPS));
  return { key: k, kg, max, stowed: Math.min(max, Math.floor(fitsStowed(state, p, k) + EPS)), name: holdName(k), room };
}
// orders.js startTask: a collecting task with a quantity stops at that many units (parties.js cargoRoom reads it).
export function capTask(p, task, state = null) {
  if (!task || task.qty == null || !COLLECT[task.type]) return;
  task.qty = Math.max(0, Math.floor(Number(task.qty) || 0));
  task.capKg = task.qty * collectKg(state, task.type); // forage: the season's mix (foraging.js forageKg)
  task.pool0 = poolLoad(p);
  // Water and firewood are counted by themselves (keyKg): the team's meals while it works lighten the load, and that
  // must not count as room for more (eating.js teamMeal: breakfast, lunch and dinner on the road).
  if (KEY_KINDS[task.type]) task.kind0 = keyKg(p, KEY_KINDS[task.type]);
}
// The tasks whose haul is one supply key, and its kg on the team (packed and found).
export const KEY_KINDS = { water: "rawwater", wood: "wood" };
export const keyKg = (p, k) => (((p.supplies && p.supplies[k]) || 0) + ((p.cargo && p.cargo.supplies && p.cargo.supplies[k]) || 0)) * ((SUPPLIES[k] && SUPPLIES[k].weight) || 1);

// ---------- fights ----------
// The acts that need free hands (combat.js combatAct). Carrying a body or dragging someone blocks the same.
// Doors, locks, windows, a car's wires and a captive's ropes need the hands too (the user's ask, 2026-10-19).
const HAND_ACTS = new Set(["shoot", "melee", "reload", "getshells", "throw", "throwspear", "launch", "glreload", "suppress", "overwatch", "doubletap", "finish", "taser", "reloadTaser", "pepper", "unjam", "subdue", "tie", "pickup", "dragAlly", "meds", "heal", "revive", "plate", "turret", "gunner", "open", "close", "brace", "climb", "checkwindow", "openwindow", "closewindow", "breakwindow", "car", "rescue"]);
export const handsKg = (u) => kgOf(u && u.hands) + (u && u.bag ? itemLoad(u.bag) : 0) + (u ? haulLoad(u) : 0);
// Arms full of supplies or a bag (the loads: autoDrop, fitHands, the end of a fight); a hand on a cart (carts.js).
export const armsBusy = (u) => !!(u && (u.hands || u.bag || u.cartHelp != null)); // cartHelp: helping pull a hand cart (carts.js)
// Finds carried loose (raidloot.js u.haul: the search window's Carried column).
export const haulBusy = (u) => !!(u && u.haul && (u.haul.gear.length || Object.values(u.haul.sup).some((v) => v > EPS)));
// Hands full: anything in the carried part of the inventory (combat.js canFire, fireRefusal, reloadRefusal, reachable).
export const handsBusy = (u) => armsBusy(u) || haulBusy(u);
// How many different things fill the hands: each kind of supply in the arms, the bag, each item and each kind of
// supply carried loose. Two or more: both hands full (handsTakeRefusal). A cart pushed takes both hands, helping to
// pull one a hand (carts.js).
export function handsCount(u) {
  if (!u) return 0;
  let n = Object.values(u.hands || {}).filter((q) => q > EPS).length + (u.bag ? (isCart(u.bag) ? 2 : 1) : 0) + (u.cartHelp != null ? 1 : 0);
  if (u.haul) {
    const keys = new Set(u.haul.gear.map((it) => it.key));
    n += keys.size + Object.values(u.haul.sup).filter((v) => v > EPS).length;
  }
  return n;
}
export const HANDS_MAX = 2; // two hands: two different things carried, and nothing more can be taken
export const armsText = (u) => [recText(u.hands), u.bag ? `the ${u.bag.name}` : "", u.cartHelp != null ? "a hand on the cart (helping pull it)" : "", haulText(u)].filter(Boolean).join(" and ");
export const handsWord = (u) => (u.cartHelp != null && !u.bag ? `Hands full: ${u.name.split(" ")[0]} helps pull the cart. Let go first (free); a pistol fires one-handed.` : isCart(u.bag) ? `Hands full: ${u.name.split(" ")[0]} pushes the ${u.bag.name.toLowerCase()} (${r1(handsKg(u))} kg). Let go first (free); a pistol fires one-handed.` : `Hands full: ${u.name.split(" ")[0]} carries ${armsText(u)} (${r1(handsKg(u))} kg). Set it down first (Drop carried: free${haulBusy(u) ? ", or put it in the pack, the pockets or the vehicle" : ""}).`);
// Why this unit cannot take one more thing in hand ("" when it can): two different things carried already.
export function handsTakeRefusal(u, what = "that") {
  if (!u || handsCount(u) < HANDS_MAX) return "";
  return `Both hands full: ${u.name.split(" ")[0]} carries ${armsText(u)} and cannot take ${what} as well. Put something down (the ground: free), or into the pack, the pockets or the vehicle first.`;
}
// Why this act cannot be done with what the unit holds ("" when it can).
export function handsRefusal(u, type) {
  if (!u || !HAND_ACTS.has(type)) return "";
  if (type === "shoot" && oneHandOk(u)) return ""; // carts.js: a pistol, one-handed (an aim penalty, shotOdds)
  if (handsBusy(u)) return handsWord(u);
  if ((u.carrying != null || u.dragging != null) && (type === "melee" || type === "throw" || type === "throwspear" || type === "launch" || type === "finish" || type === "subdue" || type === "taser" || type === "pepper")) return u.carrying != null ? "Hands full: put the body down first." : "Hands full: dragging someone (put them down first, Shift+D).";
  return "";
}
// The fights the team goes into on purpose (the user's call): a raid, an assault on a base, a hive or a growth, a
// rescue. Their loads are set down before it starts (stageLoads); any other fight on the road catches them with full
// arms.
export const STAGED_HANDLERS = new Set(["baseAssault", "hiveAssault", "hiveChamber", "growthAssault", "rescueRaid", "rescue", "jobRescue"]);
export const stagedStart = (b) => !!(b && b.setup && (b.raid || b.setup.mode === "raid" || STAGED_HANDLERS.has(b.setup.handler)));
// A battle starting (combat.js createBattle, createRaid): who starts with their arms full. A team's field battle on the
// road: the team's supplies held in the arms (settleHold) and a bag carried in the arms. A fight the team starts
// (stagedStart): set down first (stageLoads). A base's fight: a bag in the arms (its people have no loads).
export function fitHands(state, b) {
  const p = battleParty(state, b);
  const own = holdsOwn(p) ? p : null;
  if (own && stagedStart(b)) { b.stageLoads = true; return; } // stageAtStart, once the map is set up (no ids taken before the enemy's)
  const h = own ? settleHold(state, own) : null;
  const names = [];
  for (const u of b.units) {
    if (u.side !== "player" || u.sid == null) continue;
    const s = survivorById(state, u.sid);
    const bag = bagOf(s);
    const hands = h && h.by[u.sid] ? nonzero(h.by[u.sid].hands) : null;
    if (bag) u.bag = bag;
    if (hands) u.hands = hands;
    if (bag || hands) names.push(u.name.split(" ")[0]);
  }
  if (names.length) say(b, `${names.join(", ")} ${names.length === 1 ? "has their" : "have their"} arms full: no shooting or fighting with a weapon until it is set down (Drop carried: free).`, "warn");
}
// combat.js createBattle / createRaid, at the end of the setup: the loads of a fight the team starts set down (the
// piles take ids after everyone else's, so the enemy and the map come out as they would without them); a raid's
// shares of the load weighed again.
export function stageAtStart(state, b) {
  if (!b || !b.stageLoads) return null;
  delete b.stageLoads;
  const p = battleParty(state, b);
  if (!holdsOwn(p)) return null;
  const out = stageLoads(state, b, p);
  if (b.raid) raidShares(state, b);
  return out;
}
// A fight the team starts: what its people hold in their arms goes into the team's vehicle first, as far as it has room
// (a car's cargo, the bikes' racks: settleHold's own rules, roomAt / addGearToCargo), and the rest is set down where
// each of them starts (a ground pile, groundDropCell, marked staged: it comes back after the fight unless the team is
// beaten). Everyone starts with free hands. Returns what was set down: { car: {key: qty}, ground: {key: qty}, bags }.
export function stageLoads(state, b, p) {
  const h = settleHold(state, p);
  const v = partyVehicles(state, p).find((x) => isCar(x)) || partyVehicle(state, p); // a fleet: the bags go in a car or truck of it
  const out = { car: {}, ground: {}, bags: [], carBags: [] };
  for (const u of b.units) {
    if (u.side !== "player" || u.sid == null) continue;
    const s = survivorById(state, u.sid);
    const r = h && h.by[u.sid];
    const sup = {};
    for (const [k, q] of Object.entries((r && r.hands) || {})) {
      if (!(q > EPS)) continue;
      const room = roomAt(state, p, { place: "car" }, k);
      const n = Math.min(q, Number.isFinite(room) ? room : q);
      if (n > EPS) { moveHeld(state, p, k, n, { sid: u.sid, place: "hands" }, { place: "car" }); add(out.car, k, n); }
      if (q - n > EPS) { sup[k] = q - n; add(out.ground, k, q - n); }
    }
    const bag = bagOf(s);
    let down = null;
    if (bag && isCart(bag)) { // carts.js: into the vehicle if it has the room (its supplies stay in the pool: the car takes them), else let go where its pusher starts
      u.bag = bag;
      if (v && isCar(v) && addGearToCargo(state, p, bag)) { s.gear.carry = null; out.carBags.push(bag); }
      else { letGoCart(state, b, u, { staged: true, quiet: true }); out.bags.push(bag); }
    } else if (bag) {
      s.gear.carry = null;
      if (v && isCar(v) && addGearToCargo(state, p, bag)) out.carBags.push(bag); // the vehicle's cargo, if it has the room
      else { down = bag; out.bags.push(bag); }
    }
    if (Object.keys(sup).length || down) {
      const n0 = (b.armsDrops || []).length;
      groundDropCell(state, b, u, sup, down);
      for (const d of (b.armsDrops || []).slice(n0)) d.staged = true;
    }
    u.hands = null;
    u.bag = null;
  }
  const parts = [];
  if (Object.keys(out.car).length || out.carBags.length) parts.push(`into the ${v ? String(v.name || "vehicle").toLowerCase() : "vehicle"}: ${[recText(out.car), ...out.carBags.map((x) => `the ${x.name}`)].filter(Boolean).join(", ")}`);
  if (Object.keys(out.ground).length || out.bags.length) parts.push(`set down where they start: ${[recText(out.ground), ...out.bags.map((x) => `the ${x.name}`)].filter(Boolean).join(", ")}`);
  if (parts.length) say(b, `The team puts down what it carried by hand before going in (${parts.join("; ")}). It is picked up again after, unless the team is beaten.`, "info");
  return out;
}
// The battle's team (its party; null for a base's battle).
const battleParty = (state, b) => (b && b.setup && b.setup.partyId != null ? state.parties.find((x) => x.id === b.setup.partyId) || null : null);
const pileKey = (k) => k; // food lies in a pile as its items
// The one place a load set down on the battle map lands: a ground pile on the unit's cell (ground.js dropToGround).
// The supplies leave the pool now (what lies there is anyone's: fire, the search window, the enemy); a bag goes down
// whole (a gun in it leaves the team loaded, gunload.js). b.armsDrops remembers it: Pick up load and the end of the
// fight take back what is still there. sup: { key: qty } or null; item: a bag, or null.
// at: another cell than the unit's ({ x, y, f }: the far side of half cover, setOverCover).
export function groundDropCell(state, b, u, sup, item = null, at = null) {
  const p = battleParty(state, b);
  const rec = { pile: null, sup: {}, item: null, sid: u.sid };
  for (const [k, q] of Object.entries(sup || {})) {
    // Days of "food"/"meat" go down as the items they are (the soonest to spoil first); anything else as itself.
    const parts = (k === "food" || k === "meat") && p ? takePoolLots(p, k, q).map((l) => [l.k, l.q]) : [[k, p ? takePool(p, k, q) : 0]];
    for (const [kk, n] of parts) {
      if (!(n > EPS)) continue;
      const pile = dropToGround(b, u, pileKey(kk), n, at);
      if (pile) { rec.pile = pile.id; rec.sup[kk] = (rec.sup[kk] || 0) + n; }
      else addPool(p, kk, n);
    }
  }
  if (item) {
    const pile = dropToGround(b, u, item, 1, at);
    if (pile) { rec.pile = pile.id; rec.item = item; gunLeavesTeam(b, item); } // gunload.js: the guns in it go out loaded
  }
  if (rec.pile != null) (b.armsDrops = b.armsDrops || []).push(rec);
}
// Drop carried: free. Supplies and the bag in the arms, and the finds carried loose (raidloot.js u.haul), go down on
// the unit's cell (at: on another cell, setOverCover). Returns "" or an error.
export function dropCarried(state, b, u, quiet = false, at = null) {
  if (!u || !handsBusy(u)) return "Not carrying anything in the arms.";
  if (u.cartHelp != null && !u.bag && !u.hands) return letGoCart(state, b, u, { quiet }); // carts.js: a helper lets go
  const what = armsText(u);
  if (isCart(u.bag)) { letGoCart(state, b, u, { quiet }); if (!u.hands) return ""; } // carts.js: let go, a cart on the map
  const bag = u.bag || null;
  if (bag) { const s = survivorById(state, u.sid); if (s && s.gear && s.gear.carry === bag) s.gear.carry = null; }
  groundDropCell(state, b, u, u.hands, bag, at);
  if (haulBusy(u)) dropHaulInto(b, u, at); // raidloot.js: the loose finds onto the same pile (still counted as found)
  if (!quiet) say(b, `${u.name} sets down ${what}${at ? " on the far side of the cover" : ""}.`, "info");
  u.hands = null;
  u.bag = null;
  return "";
}
// Set over cover (1 action): facing half cover that can be vaulted (combat.js vaultsNear), everything carried is set
// down on the cell beyond it: a ground pile there, which anyone can pick up later from the ground (the Ground window,
// Pick up load). act.x / act.y: the cover cell (else the one they face, else the only one next to them). Facing the
// cover is free, so the action turns them to it. Returns "" or an error.
export function setOverCover(state, b, u, act = {}) {
  if (!u || !handsBusy(u)) return "Not carrying anything in the arms.";
  if (isCart(u.bag) || u.cartHelp != null) return "A cart is parked (Park cart) or shoved over, not set over cover.";
  if (u.ap < 1) return "No actions left this turn.";
  const opts = vaultsNear(b, u);
  if (!opts.length) return "Stand right next to half cover (a fence, sandbags, crates, a counter...) with room on the far side.";
  let o = act.x != null ? opts.find((v) => v.x === Number(act.x) && v.y === Number(act.y)) : null;
  if (act.x != null && !o) return "No half cover to set it over there.";
  if (!o) { const fx = u.face ? Math.round(u.face[0]) : 0, fy = u.face ? Math.round(u.face[1]) : 0; o = (Math.abs(fx) + Math.abs(fy) === 1 ? opts.find((v) => v.x - u.x === fx && v.y - u.y === fy) : null) || (opts.length === 1 ? opts[0] : null); }
  if (!o) return "Face the half cover to set the load over it (Face is free), or click the cover.";
  faceToward(u, o.x, o.y); // vision.js: squarely at the cover
  const err = dropCarried(state, b, u, false, { x: o.to[0], y: o.to[1], f: u.f || 0 });
  if (err) return err;
  u.ap -= 1;
  u.hunker = false;
  return "";
}
// A record's pile, and what of it still lies there ({ sup: { key: qty }, item }).
const dropPile = (b, d) => { const L = lootLayer(b); return L && d.pile != null ? L.containers.find((c) => c.id === d.pile) || null : null; };
function dropLeft(c, d) {
  const sup = {};
  for (const [k, q] of Object.entries(d.sup || {})) {
    const there = c.contents.sup[pileKey(k)] || 0;
    const n = Math.min(q, there);
    if (n > EPS) sup[k] = n;
  }
  return { sup, item: d.item && c.contents.gear.includes(d.item) ? d.item : null };
}
// The team's loads set down within reach of the unit (a pile on its cell or next to it, the same floor), with what
// is still there: [{ d, pile, sup, item }].
export function carriedNear(b, u) {
  if (!b || !u || !b.armsDrops || !b.armsDrops.length) return [];
  const piles = pilesNear(b, u);
  const out = [];
  for (const d of b.armsDrops) {
    const c = dropPile(b, d);
    if (!c || !piles.includes(c)) continue;
    const left = dropLeft(c, d);
    if (left.item || Object.keys(left.sup).length) out.push({ d, pile: c, ...left });
  }
  return out;
}
// Takes n of key k of a record off its pile. Returns 0 (the worm's eggs do not follow food through a fight's piles).
function offPile(c, d, k, n) {
  const pk = pileKey(k);
  const worm = 0;
  c.contents.sup[pk] = (c.contents.sup[pk] || 0) - n;
  if (c.contents.sup[pk] <= EPS) delete c.contents.sup[pk];
  if (d) { d.sup[k] = (d.sup[k] || 0) - n; if (d.sup[k] <= EPS) delete d.sup[k]; }
  return worm;
}
function offPileItem(c, d) {
  const i = c.contents.gear.indexOf(d.item);
  if (i >= 0) c.contents.gear.splice(i, 1);
  d.item = null;
}
const prune = (b) => { if (b.armsDrops) b.armsDrops = b.armsDrops.filter((d) => d.item || Object.keys(d.sup || {}).length); };
// Pick up load (1 action): the team's supplies set down within reach go back in the unit's arms (and the pool), and
// one bag if its arms have none.
export function pickCarried(state, b, u) {
  const near = carriedNear(b, u);
  if (!near.length) return "Nothing set down within reach.";
  if (u.carrying != null || u.dragging != null) return "Hands full: put the body down first.";
  { const why = handsTakeRefusal(u, "the load"); if (why) return why; } // two different things carried already
  const p = battleParty(state, b);
  let took = false;
  for (const c of near) {
    if (c.item && !u.bag && !carryBag(state, b, u, c.item)) { offPileItem(c.pile, c.d); took = true; } // one bag in the arms at a time
    if (p) for (const [k, n] of Object.entries(c.sup)) { offPile(c.pile, c.d, k, n); addPool(p, k, n); u.hands = u.hands || {}; add(u.hands, holdKeyOf(k), FOODS[k] ? unitsOf(k, n) : n); took = true; } // food items back in the arms as days of food / fresh game
    settlePile(c.pile);
  }
  prune(b);
  if (!took) return "Already carrying a bag: set it down first.";
  if (u.hands && !Object.keys(u.hands).length) u.hands = null;
  say(b, `${u.name} picks up ${armsText(u)}.`, "info");
  return "";
}
// combatAct's free acts: "dropCarried" (one unit) and "dropAllCarried" (everyone of yours). Returns "" or an error.
export function carriedAct(state, b, act) {
  if (b.phase !== "player") return "Wait for the enemy turn to finish.";
  if (act.type === "dropAllCarried") {
    const list = b.units.filter((u) => u.side === "player" && handsBusy(u) && (active(u) || u.down));
    if (!list.length) return "Nobody is carrying anything in the arms.";
    for (const u of list) dropCarried(state, b, u);
    return "";
  }
  const u = b.units.find((x) => x.id === act.unit);
  if (!u || u.side !== "player" || u.dead) return "That unit cannot act.";
  return dropCarried(state, b, u);
}
// The battle AI on your side sets everything down before it fights (autoPlayerTurn).
export function autoDrop(state, b) {
  for (const u of b.units) if (u.side === "player" && handsBusy(u) && active(u)) dropCarried(state, b, u);
}
// The raid bot (combat.js autoRaidTurn): with something to fight within reach it sets down what fills its hands (free)
// and takes it up again from the pile when the way is clear (the pile is a container to search again).
export function botDropToFight(state, b, u) {
  if (!handsBusy(u) || !active(u)) return false;
  dropCarried(state, b, u);
  return true;
}
// The loads set down in the fight that still lie in their piles, taken back. Back: a won fight, or a load staged at the
// start (stageLoads) of a fight the team was not beaten in (a retreat, a raid it got out of). Back: the supplies into
// the pool, a bag
// into its carrier's arms (alive, free arms), else the team's cargo, else (a base's fight) the armory; keep: one that
// fits nowhere stays in its pile (the loot screen), else it comes back in `bags`. Not won: off the piles into `loose`
// (supplies already out of the pool) and `bags`. Returns { loose, bags: [{ item, sid }] }.
function reclaimDrops(state, b, outcome, keep = false) {
  const p = battleParty(state, b);
  const own = holdsOwn(p) ? p : null;
  const home = !p && b.setup && b.setup.baseId != null ? baseById(state, b.setup.baseId) : null;
  const loose = {}, bags = [];
  for (const d of b.armsDrops || []) {
    const c = dropPile(b, d);
    if (!c) continue;
    const won = outcome === "victory" || (!!d.staged && outcome !== "defeat");
    if (!won && keep) continue; // endBattle: the rest is the piles' (ground.js groundLeftovers)
    const left = dropLeft(c, d);
    for (const [k, n] of Object.entries(left.sup)) {
      if (won && !own) continue;
      offPile(c, d, k, n);
      if (won) addPool(own, k, n); else add(loose, k, n);
    }
    if (left.item) {
      const it = left.item;
      const s = d.sid != null ? survivorById(state, d.sid) : null;
      const mine = !!(s && s.alive && (own ? partyMembers(state, own).includes(s) : !p));
      if (!won) { offPileItem(c, d); bags.push({ item: it, sid: d.sid }); }
      else if (mine && !bagOf(s)) { offPileItem(c, d); ensureInv(s); s.gear.carry = it; }
      else if (own && addGearToCargo(state, own, it)) offPileItem(c, d);
      else if (home) { offPileItem(c, d); home.armory.push(it); }
      else if (!keep) { offPileItem(c, d); bags.push({ item: it, sid: d.sid }); }
    }
    settlePile(c);
  }
  prune(b);
  return { loose, bags };
}
// combat.js endBattle, before the piles are settled (ground.js groundEnd, groundLeftovers): won, the loads set down
// are picked up again (what fire, the enemy or the search window left of them), and so are the loads staged at the
// start of a fight the team was not beaten in. Otherwise the piles stay where they are.
export function armsDropsEnd(state, b, outcome) {
  if (b) cartsEnd(state, b, outcome); // carts.js: the carts on the map, before the piles become loot
  if (!b || !b.armsDrops || !b.armsDrops.length) return;
  reclaimDrops(state, b, outcome, true); // food left lying goes to the tile's death site as its items (inventory.js leaveBodies) and spoils there (groundDaily)
}
// The Ground window (raidloot.js moveSupply): the team's kind of supplies (HOLD) taken off a pile on the ground in a
// team's fight go into the taker's arms (hands full, as Pick up load) and back into the pool, not loose; fresh game
// stays fresh. n: what the move put in their haul. Returns the words for the message ("" when nothing changed).
export function pileToArms(state, b, box, uid, k, n) {
  if (!b || !box || box.kind !== "ground" || !HOLD[holdKeyOf(k)] || !(n > EPS)) return "";
  const p = battleParty(state, b);
  if (!holdsOwn(p)) return "";
  const u = b.units.find((x) => x.id === uid && x.side === "player");
  if (!u || !u.haul || u.carrying != null || u.dragging != null) return "";
  const take = Math.min(n, u.haul.sup[k] || 0);
  if (!(take > EPS)) return "";
  u.haul.sup[k] -= take;
  if (u.haul.sup[k] <= EPS) u.haul.sup[k] = 0;
  // The team's own loads on that pile: what is left of them is less now (Pick up load, the end of the fight).
  const owed = { [k]: take };
  for (const d of b.armsDrops || []) {
    if (d.pile !== box.id) continue;
    for (const kk of Object.keys(owed)) { const t = Math.min(owed[kk], d.sup[kk] || 0); if (t > EPS) { d.sup[kk] -= t; if (d.sup[kk] <= EPS) delete d.sup[kk]; owed[kk] -= t; } }
  }
  prune(b);
  u.hands = u.hands || {};
  addPool(p, k, take);
  add(u.hands, holdKeyOf(k), FOODS[k] ? unitsOf(k, take) : take); // a food item in the arms: days of food or fresh game
  return ` ${u.name.split(" ")[0]} carries it in the arms (hands full: no weapon until it is set down).`;
}
// After a fight (combat.js finishCombat, before its handler). Loads still in their piles (a raid's, or a battle that
// did not go through endBattle) are settled as endBattle would: won, picked up again; else they lie on the tile's
// ground. Then who still holds a load: won, nothing changes (the pool never did); retreated, broken off or beaten,
// what the living held (and a bag) stays on the tile's ground (the dead's things are at their death site already). A
// fight by the numbers: the carriers set it down when it started.
export function settleCarried(state, setup, result, battle) {
  const p = setup && setup.partyId != null ? state.parties.find((x) => x.id === setup.partyId) : null;
  const won = !!(result && result.outcome === "victory");
  if (battle) cartsEnd(state, battle, result ? result.outcome : "defeat"); // carts.js: a raid's carts (a field battle's went in endBattle)
  const back = battle ? reclaimDrops(state, battle, result ? result.outcome : "defeat") : { loose: {}, bags: [] };
  if (!holdsOwn(p)) { // a base's battle: a bag set down goes back to its carrier, else into the armory
    const home = setup && setup.baseId != null ? baseById(state, setup.baseId) : null;
    for (const { item, sid } of back.bags) {
      const s = sid != null ? survivorById(state, sid) : null;
      if (s && s.alive && !bagOf(s)) s.gear.carry = item; else if (home) home.armory.push(item);
    }
    return "";
  }
  const raid = setup.mode === "raid" || (battle && battle.raid);
  let left = {};
  const carts = [];
  const loose = nonzero(back.loose);
  const bags = back.bags.map((x) => x.item);
  if (battle) {
    if (!won) for (const u of battle.units) {
      if (u.side !== "player" || u.left || u.aboard) continue;
      const s = survivorById(state, u.sid);
      if (!s || !s.alive) continue; // died holding it: at their death site with the rest of their things
      if (!raid && u.hands) for (const [k, q] of Object.entries(u.hands)) add(left, k, q);
      if (u.bag && bagOf(s) === u.bag && isCart(u.bag)) { carts.push(cartToGround(state, p, s)); continue; } // carts.js: still on the map when it ended: left there
      if (u.bag && bagOf(s) === u.bag) { s.gear.carry = null; bags.push(u.bag); }
    }
  } else {
    if (won || raid) return "";
    for (const { s, hands, bag } of carriersOf(state, p)) {
      for (const [k, q] of Object.entries(hands)) add(left, k, q);
      if (bag && isCart(bag)) { if (result && result.outcome === "defeat") carts.push(cartToGround(state, p, s)); continue; } // carts.js: a retreat by the numbers pushes it off with them
      if (bag) { s.gear.carry = null; bags.push(bag); }
    }
  }
  left = nonzero(left);
  if (carts.filter(Boolean).length) log(state, `Left on the ground there: the ${carts.filter(Boolean).map((n) => n.toLowerCase()).join(", the ")} with what was in it (any team on that tile can take it again).`, "warn");
  if (!left && !loose && !bags.length) return "";
  if (left) groundPut(state, p, left); // still in the pool: out of it, onto the ground
  if (loose || bags.length) {
    const site = groundAt(state, partyTile(p), true);
    for (const [k, q] of Object.entries(loose || {})) addGroundSupply(site, k, q); // out of the pool since it was set down
    for (const it of bags) site.items.push(groundGear(it));
    touched(state, site);
  }
  const all = {};
  for (const rec of [left, loose]) for (const [k, q] of Object.entries(rec || {})) add(all, k, q);
  const what = [recText(all), ...bags.map((it) => `the ${it.name}`)].filter(Boolean).join(", ");
  const text = `${what} set down for the fight stayed on the ground there (pick it up from the team panel).`;
  log(state, `The team left ${text}`, "warn");
  return text;
}
