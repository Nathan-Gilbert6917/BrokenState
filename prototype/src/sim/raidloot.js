// Raid loot by hand: each survivor carries what they pick up, and a vehicle has its own trunk.
//
// In a raid (combat.js raid mode) a container's contents are rolled once (searchBox) and then moved by hand in the
// search window (ui/inventory.js raidModal): onto the survivor who opened it (their hands, pockets, pack, or
// "carried": loose finds in bags and arms) or back. Nothing goes to the team's cargo by itself any more.
//
// What one survivor can take (personalRoom): their max load (load.js maxLoad) less what they wear and hold, less
// their share of the team's packed supplies and cargo they brought in (u.share, set when the raid starts), less what
// they carry loose (u.haul). With a car the team's supplies and cargo stay in the car, so the share is 0.
//
// The vehicle (a car or the bikes) waits in its zone. A survivor standing in that zone, or next to it, opens its
// trunk: the team's cargo (party.cargo) plus its packed supplies. Things put in the trunk are safe and free up the
// survivor; things taken out weigh on them. How much more the trunk takes (trunkSpace):
//   a car: what the team can carry with it (parties.js cargoRoom) less everything its people carry loose, because the
//          car takes all of it home (it is weighed again with its riders when they leave);
//   bikes: the racks (15 kg a bike) less what is on them already (the pool beyond what the people carry).
// Without a vehicle there is no trunk: the team's supplies are shared out among the people (u.share).
//
// Handing over: teammates standing next to each other (a downed one too) pass things between them for free; each
// one's own max load still holds.
//
// The hands (carry.js, the user's ask 2026-10-19): whatever a survivor carries loose fills their hands (no shooting,
// reloading, doors, windows until it is put down or stowed), and with two different things carried (carry.js
// handsCount) nothing more is taken from a container, a body, the ground, the vehicle or a teammate (handsTakeRefusal,
// checked here in raidMove for the one who would hold it). Moving things between a survivor's own places (carried
// into the pack or the pockets, out of the pack) is free of it, and so is putting things down or into the vehicle.
//
// Hauling takes time (HAUL): each turn a survivor moves the first HAUL.free kg out of a container or the vehicle (or
// into the vehicle) for free, then every HAUL.per kg more costs one of their actions. With none left they wait for
// the next turn. One heavy thing can always be lifted with all the actions they have left.
//
// Splitting stacks: supplies are stacks, and any part of one moves, 1 to all (raidMove qty; supplyFit says how many
// would go without moving anything). Only what fits goes; hauling time is paid on what actually moved.
// Into pockets and the pack (2026-10-16, user request: "when looting these items are not put into pockets, packs; the
// carried section is meant for larger heavy objects"): a found supply moved onto a slot of a survivor (a pocket, a
// pack cell, the off hand, a bag in the arms) becomes the item that holds it (supitems.js: rounds a loose handful, the
// rest s_<key>, up to its stack a slot), and "stow:<unitId>" puts it in their pockets and pack, the stacks of it they
// have first. Take all does that; a bulky supply (building materials, car parts), one with no item form and what the
// pockets and pack have no room for are carried loose (so a searched container is emptied: the raid bot moves on). A supply item put back in a container, Carried or the vehicle is a supply stack there again.
// A container only rummaged through (search.js box.quick) keeps the rest hidden (box.hidden, not in this window).
//
// Extraction: a survivor who comes home (walked out, or carried out while down) adds what they carry loose to the
// team's cargo (raidHome). Someone who dies in the raid drops it on their body (dropHaul): the others can search it.
// Whatever is still on the map when the raid ends is lost, and not counted as found.
// The loose supplies a survivor carries are also one of the battle's supply pools, so found ammo and meds can be
// used at once (combat.js pools; the save keeps the shared objects).
//
// Locations (strings, like inventory.js) for the window:
//   "rbox:<containerId>:gear:<i>"  "rbox:<id>:sup:<key>"  "rbox:<id>:list"       the open container
//   "haul:<unitId>:gear:<i>"       "haul:<uid>:sup:<key>" "haul:<uid>:list"       what a survivor carries loose
//   "trunk:<partyId>:gear:<i>"     "trunk:<pid>:sup:<key>" "trunk:<pid>:list"     the vehicle (the team's cargo)
//   "s:<survivorId>:<slot>[:<i>]"                                                  the survivor's own slots
//   "stow:<unitId>"                                                                 a supply stack into their pockets and pack
import { GEAR, SUPPLIES, supWeight } from "./data.js";
const worthPerKg = (it) => ((GEAR[it.key] && GEAR[it.key].value) || 1) / Math.max(0.1, itemLoad(it));
import { survivorById } from "./world.js";
import { keyWord } from "./water.js"; // supplies as words: "9mm FMJ", "rounds"
import { partyMembers, cargoRoom, poolLoad, unitsThatFit } from "./parties.js";
import { partyVehicle, isBike, VEHICLE_TYPES } from "./vehicles.js";
import { teamLoad, wornLoad, maxLoad } from "./load.js";
import { ensureInv, packOf, ensurePack, itemLoad, carryOf, fitReason, isBulky, isSmall, packSize, EQUIP_SLOTS, SLOT_NAMES, allCarried, isTwoHands } from "./inventory.js";
import { gunLeavesTeam, unloadInto, teamGuns, returnStacks } from "./gunload.js";
import { pileToArms, handsTakeRefusal } from "./carry.js"; // the team's loads off the ground: into the arms; two different things carried: nothing more taken (call-time only: safe in the import cycle)
import { groundPile, settlePile } from "./ground.js"; // the pile a load is set down on (call-time only: safe in the import cycle)
import { canStack, mergeInto, isSpent, stackLabel, isSupItem, roomIn, roundCap, amountOf, roundItems, isRoundItem } from "./itemstack.js"; // stacks merge in a slot (2026-10-10)
import { isMag } from "./mags.js"; // rounds onto a spare magazine in the search window load it (call-time only: the import cycle)
import { combatAct } from "./combat.js"; // (call-time only)
import { isCart, boxFree, boxRefusal } from "./carts.js"; // a cart on the map: a container up to its kg (call-time only)
import { itemKeyOf, stockKeyOf, foundItems, putBack } from "./supitems.js"; // found supplies as items for pockets and the pack (2026-10-16)
import { ROUND_SUPPLIES } from "./data-ammo.js";

const EPS = 1e-9;
export const HAUL = { free: 8, per: 12 }; // kg a turn for free, then kg an action
const r1 = (x) => Math.round(x * 10) / 10;

// ---------- the loot layer ----------
// What this module works on: the raid (b.raid: its containers, found, foundGear, lootBy, vehicle zone) or, in a field
// battle, b.fieldLoot (ground.js: the bodies searched where they fell and the things on the ground), made on first
// use with the same fields. lootLayer: whichever there is (null in a field battle nothing was searched or dropped in).
export const lootLayer = (b) => (b ? b.raid || b.fieldLoot || null : null);
export function fieldLayer(b) {
  if (!b) return null;
  return b.raid || b.fieldLoot || (b.fieldLoot = { containers: [], found: {}, foundGear: [], vehicleZone: -1, zones: [], field: true });
}

// ---------- setup ----------
export const raidParty = (state, b) => (b && b.setup ? state.parties.find((x) => x.id === b.setup.partyId) || null : null);
export function raidVehicle(state, b) {
  const p = raidParty(state, b);
  return p && b.raid && (b.raid.hasVehicle ?? b.raid.vehicleZone >= 0) ? partyVehicle(state, p) : null;
}
// The vehicle whose trunk can be opened in this battle: a raid's (raidVehicle), or in a field battle the team's car
// or bikes standing on the map (combat.js b.vehicle). What its people carry loose comes home in it either way
// (ground.js groundEnd: into the team's cargo), so the same trunk rules hold.
// A burnt-out wreck (launchers.js blown up: its cargo goes up with it) is not opened, as it is not boarded or driven.
export function trunkVehicle(state, b) {
  if (!b || (b.vehicle && b.vehicle.blownUp)) return null;
  if (b.raid) return raidVehicle(state, b);
  const p = b.vehicle ? raidParty(state, b) : null;
  return p && p.vehicle ? partyVehicle(state, p) : null;
}

// When the raid starts: everyone's share of what the team brought, and an empty load of finds.
export function raidCarrySetup(state, b) {
  const p = raidParty(state, b);
  const mine = b.units.filter((u) => u.side === "player");
  for (const u of mine) { u.haul = { sup: {}, gear: [] }; u.share = 0; }
  if (!p) return;
  b.pools.push(...mine.map((u) => u.haul.sup)); // found ammo and meds count at once (combat.js pool)
  raidShares(state, b);
}
// Each survivor's share of the team's packed supplies and cargo (on foot or bikes; a car keeps them). Again after the
// loads were set down at the start (carry.js stageAtStart: out of the pool).
export function raidShares(state, b) {
  const p = raidParty(state, b);
  if (!p || !b.raid) return;
  const mine = b.units.filter((u) => u.side === "player");
  for (const u of mine) u.share = 0;
  const v = raidVehicle(state, b);
  if (v && !isBike(v)) return; // a car: the team's things stay in it
  const members = partyMembers(state, p);
  const t = teamLoad(members, poolLoad(p), v);
  const people = (t.ride && isBike(v) ? t.ride.people : t.foot.people);
  let shared = 0;
  for (const u of mine) {
    const s = survivorById(state, u.sid);
    const x = people.find((q) => q.sid === u.sid);
    u.share = s && x ? Math.max(0, x.load - wornLoad(s)) : 0;
    shared += u.share;
  }
  b.raid.shared = shared; // with bikes: what is not on the racks
}

// ---------- weights ----------
export const haulOf = (u) => u.haul || (u.haul = { sup: {}, gear: [] });
// What a survivor carries loose, in words ("3 9mm FMJ, a crowbar and a flashlight"); "" with nothing.
export function haulText(u) {
  const h = u && u.haul;
  if (!h) return "";
  const parts = Object.entries(h.sup).filter(([, v]) => v > 0).map(([k, v]) => `${Math.floor(v) || Math.round(v * 10) / 10} ${keyWord(k)}`);
  for (const it of h.gear) parts.push(stackLabel(it));
  return parts.join(", ");
}
// Everything a survivor carries loose onto a ground pile (carry.js dropCarried: free; at: another cell than theirs,
// Set over cover). A pile holds things already found (drop: true), so the raid's tally keeps them; a gun among them
// leaves the team loaded (gunload.js). Returns the pile (null: nothing carried).
export function dropHaulInto(b, u, at = null) {
  const h = u.haul;
  if (!h || !(h.gear.length || Object.values(h.sup).some((v) => v > 0))) return null;
  const pile = groundPile(b, at ? at.x : u.x, at ? at.y : u.y, at ? at.f || 0 : u.f || 0);
  for (const [k, v] of Object.entries(h.sup)) if (v > 0) { pile.contents.sup[k] = (pile.contents.sup[k] || 0) + v; delete h.sup[k]; }
  for (const it of h.gear.splice(0)) { pile.contents.gear.push(it); gunLeavesTeam(b, it); }
  settlePile(pile);
  return pile;
}
export const haulLoad = (u) => {
  const h = u.haul;
  if (!h) return 0;
  return Object.entries(h.sup).reduce((a, [k, v]) => a + (SUPPLIES[k] && v > 0 ? v * supWeight(k) : 0), 0) + h.gear.reduce((a, g) => a + itemLoad(g), 0);
};
// Kg this survivor still has room for (negative: over their max).
export function personalRoom(state, u) {
  const s = survivorById(state, u.sid);
  if (!s) return 0;
  return maxLoad(s) - wornLoad(s) - (u.share || 0) - haulLoad(u);
}
// What this survivor has on them (the window's weight line): { load, max, room }.
export function personalLoad(state, u) {
  const s = survivorById(state, u.sid);
  if (!s) return { load: 0, max: 0, room: 0, worn: 0, share: 0, haul: 0 };
  const worn = wornLoad(s), haul = haulLoad(u), share = u.share || 0, max = maxLoad(s);
  return { load: worn + share + haul, max, room: max - worn - share - haul, worn, share, haul };
}

// Kg more the trunk takes (negative: past it). null without a vehicle.
export function trunkSpace(state, b) {
  const v = trunkVehicle(state, b);
  const p = raidParty(state, b);
  if (!v || !p) return null;
  if (isBike(v)) {
    const rack = (v.count || 1) * VEHICLE_TYPES.bike.rack;
    return rack - (poolLoad(p) - ((b.raid && b.raid.shared) || 0));
  }
  const loose = b.units.filter((u) => u.side === "player" && !u.dead).reduce((a, u) => a + haulLoad(u), 0);
  // cargoRoom is never below 0; the car's own limit is what counts here.
  return cargoRoom(state, p) - loose;
}
export function trunkInfo(state, b) {
  const v = trunkVehicle(state, b);
  const p = raidParty(state, b);
  if (!v || !p) return null;
  const space = trunkSpace(state, b);
  if (isBike(v)) {
    const cap = (v.count || 1) * VEHICLE_TYPES.bike.rack;
    return { name: `${v.count || 1} bicycle rack${(v.count || 1) === 1 ? "" : "s"}`, cap, load: cap - space, space, bike: true };
  }
  const loose = b.units.filter((u) => u.side === "player" && !u.dead).reduce((a, u) => a + haulLoad(u), 0);
  const load = poolLoad(p);
  return { name: v.name, cap: load + loose + space, load, loose, space, bike: false };
}

// Can this survivor reach the vehicle: in its zone, or right next to it.
export function atVehicle(b, u) {
  if (!u) return false;
  // The team's car or truck covers cells of its own (combat.js b.vehicle, driven about): next to any of them.
  if (b.vehicle) { const v = b.vehicle; return !(u.f || 0) && u.x >= v.x - 1 && u.x <= v.x + v.w && u.y >= v.y - 1 && u.y <= v.y + v.h; }
  const R = b.raid;
  if (!R || R.vehicleZone < 0 || !u) return false;
  const z = R.zones[R.vehicleZone];
  return u.x >= z.x0 - 1 && u.x <= z.x0 + z.w && u.y >= z.y0 - 1 && u.y <= z.y0 + z.h;
}

// ---------- locations ----------
export function parseRaidLoc(str) {
  const [o, id, slot, i] = String(str).split(":");
  return { o, id: Number(id), slot: slot || "list", i: i == null || i === "" ? null : slot === "sup" ? i : Number(i) };
}
const holds = (loc) => loc.o === "haul" || loc.o === "s"; // on the survivor
const isList = (loc) => loc.o !== "s";

// The pieces of one location: { item, take(), put(it) } for gear, or { sup (object), key } for a supply stack.
function place(state, b, loc) {
  const R = lootLayer(b);
  if (loc.o === "rbox") {
    if (!R) return null;
    const box = R.containers.find((c) => c.id === loc.id);
    if (!box || !box.contents) return null;
    return { gear: box.contents.gear, sup: box.contents.sup, box };
  }
  if (loc.o === "haul") {
    const u = b.units.find((x) => x.id === loc.id);
    return u ? { gear: haulOf(u).gear, sup: u.haul.sup, u } : null;
  }
  if (loc.o === "trunk") {
    const p = raidParty(state, b);
    if (!p) return null;
    p.cargo = p.cargo || { supplies: {}, gear: [] };
    return { gear: p.cargo.gear, sup: p.cargo.supplies, packed: p.supplies, p };
  }
  if (loc.o === "s") {
    const s = survivorById(state, loc.id);
    if (!s) return null;
    ensureInv(s);
    if (loc.slot === "pocket") return loc.i != null && loc.i < s.pockets.length ? { arr: s.pockets, key: loc.i, s } : null;
    if (loc.slot === "pack") { const pk = packOf(s); return pk && loc.i != null && loc.i < pk.length ? { arr: pk, key: loc.i, s } : null; }
    if (loc.slot === "bag") { const g = s.gear.carry; const pk = g && packSize(g) ? ensurePack(g) : null; return pk && loc.i != null && loc.i < pk.length ? { arr: pk, key: loc.i, s } : null; } // a bag carried in the arms (carry.js)
    if (EQUIP_SLOTS.includes(loc.slot)) return { arr: s.gear, key: loc.slot, s };
  }
  return null;
}
const getAt = (P, loc) => (P.arr ? P.arr[P.key] || null : loc.i != null ? P.gear[loc.i] || null : null);
export const raidItemAt = (state, b, str) => {
  const loc = parseRaidLoc(str);
  const P = place(state, b, loc);
  return P && loc.slot !== "sup" ? getAt(P, loc) : null;
};

// Teammates right next to this survivor who can take or hand over things (a downed one too).
export const matesOf = (b, u) => b.units.filter((x) => x.side === "player" && x !== u && !x.dead && !x.left && Math.max(Math.abs(x.x - u.x), Math.abs(x.y - u.y)) <= 1);
// The unit holding a location on a person ("s:<sid>…" or "haul:<uid>…"), or null.
function ownerOf(b, loc) {
  if (loc.o === "s") return b.units.find((x) => x.side === "player" && x.sid === loc.id && !x.dead) || null;
  if (loc.o === "haul" || loc.o === "stow") return b.units.find((x) => x.side === "player" && x.id === loc.id) || null;
  return null;
}

// Who may use a location from this window: the survivor (uid) and the teammates next to them, the box next to them,
// the trunk at the vehicle.
function reach(state, b, u, loc) {
  if (loc.o === "s" || loc.o === "haul" || loc.o === "stow") {
    const o = ownerOf(b, loc);
    return o && (o === u || matesOf(b, u).includes(o)) ? "" : "Only someone right next to them can hand things over.";
  }
  if (loc.o === "rbox") {
    const L = lootLayer(b);
    const box = L && L.containers.find((c) => c.id === loc.id);
    if (!box) return "That is not there any more.";
    if (box.kind === "ground" || (box.kind === "body" && L.field)) return (box.f || 0) === (u.f || 0) && Math.max(Math.abs(u.x - box.x), Math.abs(u.y - box.y)) <= 1 ? "" : `${u.name.split(" ")[0]} has to be on it or next to it.`; // ground.js: a pile, a body searched where it fell
    return Math.max(Math.abs(u.x - box.x), Math.abs(u.y - box.y)) <= 1 ? "" : `${u.name.split(" ")[0]} has to be next to it.`;
  }
  if (loc.o === "trunk") return !trunkVehicle(state, b) ? "There is no vehicle here." : atVehicle(b, u) ? "" : `${u.name.split(" ")[0]} has to be at the vehicle.`;
  return "Not here.";
}

// The limits a move must not break: each person's room and the trunk's, each only if the move used some of it.
function rooms(state, b, people) {
  const r = { trunk: trunkSpace(state, b) };
  for (const x of people) r[x.id] = personalRoom(state, x);
  return r;
}
function broke(before, after) {
  for (const k of Object.keys(after)) {
    if (after[k] == null) continue;
    if (after[k] < -EPS && after[k] < before[k] - EPS) return k;
  }
  return "";
}
function tooHeavy(state, b, which, what) {
  if (which === "trunk") return `The ${trunkVehicle(state, b)?.name?.toLowerCase() || "vehicle"} is full: no room for the ${what}.`;
  const x = b.units.find((q) => String(q.id) === String(which));
  const l = x ? personalLoad(state, x) : { load: 0, max: 0 };
  return `Too heavy: ${x ? x.name.split(" ")[0] : "they"} cannot carry the ${what} as well (${r1(l.load)} of ${r1(l.max)} kg).`;
}

// ---------- hauling time (HAUL) ----------
// Kg this survivor has moved this turn (reset when the turn changes).
export function hauled(b, u) {
  if (u.haulTurn !== b.turn) { u.haulTurn = b.turn; u.hauledKg = 0; }
  return u.hauledKg || 0;
}
const paid = (kg) => Math.max(0, Math.ceil((kg - HAUL.free - 1e-6) / HAUL.per));
// Actions moving `kg` more would cost this survivor now.
export const haulCost = (b, u, kg) => paid(hauled(b, u) + kg) - paid(hauled(b, u));
// Kg more they can move this turn with the actions they have left.
export const haulBudget = (b, u) => Math.max(0, HAUL.free + HAUL.per * (paid(hauled(b, u)) + Math.max(0, u.ap || 0)) - hauled(b, u));
// Does a move take hauling: out of a container or the vehicle onto someone, or into the vehicle.
const hauling = (from, to) => ((from.o === "rbox" || from.o === "trunk") && (to.o === "s" || to.o === "haul")) || (to.o === "trunk" && from.o !== "trunk");
function payHaul(b, u, kg) {
  const c = haulCost(b, u, kg);
  hauled(b, u);
  u.hauledKg += kg;
  u.ap = Math.max(0, (u.ap || 0) - c);
}
const noTime = (u, what) => `No time: ${u.name.split(" ")[0]} has no actions left to haul the ${what} this turn (the first ${HAUL.free} kg a turn are free, then ${HAUL.per} kg an action). End the turn and come back for it.`;

// ---------- moves ----------
// Moves the item (or the supply stack, as much of it as fits; qty: at most that many) at `from` to `to`, for the
// survivor in unit `uid`. Returns a message ("" when nothing happened).
export function raidMove(state, uid, fromStr, toStr, qty = Infinity) {
  const r = raidMoveAt(state, uid, fromStr, toStr, qty);
  // The vehicle loaded or unloaded: the pool the team shares out (on foot, or past the bikes' racks) changed, so each
  // one's share of it with it (raidShares; a car's riders carry none): the window's weights are right at once.
  const b = state.combat;
  if (b && b.raid && lootLayer(b) && (parseRaidLoc(fromStr).o === "trunk" || parseRaidLoc(toStr).o === "trunk")) raidShares(state, b);
  return r;
}
function raidMoveAt(state, uid, fromStr, toStr, qty = Infinity) {
  const b = state.combat;
  if (!b || !lootLayer(b) || b.over) return "";
  const u = b.units.find((x) => x.id === uid && x.side === "player");
  if (!u || u.dead || u.left) return "Nobody to carry it.";
  if (fromStr === toStr) return "";
  const from = parseRaidLoc(fromStr), to = parseRaidLoc(toStr);
  const e = reach(state, b, u, from) || reach(state, b, u, to);
  if (e) return e;
  lootLayer(b).lootBy = u.id; // the one whose window it is (messages name the others)
  // Rounds dropped onto one of the searcher's own spare magazines load it (2026-10-18 user request: "you can load and
  // reload magazines during raids"): the fight's own rule (combat.js invAct "load", mags.js loadMagPlan: up to 6 a
  // time, 1 action from a pocket or the rig, both from the pack), not a swap of the two things.
  if (from.o === "s" && to.o === "s" && from.id === to.id && from.id === u.sid && from.slot !== "sup" && to.slot !== "sup") {
    const A = place(state, b, from), B = place(state, b, to);
    const item = A ? getAt(A, from) : null, cur = B ? getAt(B, to) : null;
    if (item && cur && isRoundItem(item) && isMag(cur)) return combatAct(state, { type: "inv", unit: u.id, from: fromStr, to: toStr, op: "load" });
  }
  { const why = takeRule(state, b, from, to, fromStr); if (why) return why; } // carry.js: two different things carried: nothing more taken
  if (from.slot === "sup") return to.o === "stow" ? stowSupply(state, b, u, from, to, qty) : isList(to) ? moveSupply(state, b, u, from, to, qty) : slotSupply(state, b, u, from, to, qty);
  if (to.o === "stow") return "Drop it on a pocket or a pack cell.";
  return moveGear(state, b, u, from, to);
}
// The hands rule of a move: the one who would hold what moves (the owner of `to`), taking it from anywhere but their
// own places, must have a hand free (carry.js handsTakeRefusal). "" when the move is allowed.
function takeRule(state, b, from, to, fromStr) {
  const taker = ownerOf(b, to);
  if (!taker) return "";
  const giver = ownerOf(b, from);
  if (giver === taker) return ""; // their own places: carried into the pack, out of the pack...
  // More of a kind already in hand (scrap onto their scrap, a second box of the same rounds) joins that armful.
  const h = taker.haul;
  if (from.slot === "sup") { if (h && (h.sup[String(from.i)] || 0) > EPS) return ""; return handsTakeRefusal(taker, `the ${keyWord(String(from.i))}`); }
  const item = raidItemAt(state, b, fromStr);
  if (item && h && to.o === "haul" && !isTwoHands(item) && h.gear.some((g) => g.key === item.key)) return ""; // a second fire safe is not one armful: each takes both hands
  return handsTakeRefusal(taker, `the ${item ? item.name : "that"}`, item);
}

// How many of a supply stack a move would take (splitting stacks, search window): { have, n (what fits, ≤ qty),
// err } without moving anything. n is what raidMove(…, qty) would move now: limited by the stack, every load limit
// the move touches and, when it is hauling, the time left this turn.
export function supplyFit(state, uid, fromStr, toStr, qty = Infinity) {
  const b = state.combat;
  const u = b && lootLayer(b) && b.units.find((x) => x.id === uid && x.side === "player");
  if (!u) return { have: 0, n: 0, err: "Nobody to carry it." };
  const from = parseRaidLoc(fromStr), to = parseRaidLoc(toStr);
  if (from.slot !== "sup") return { have: 0, n: 0, err: "Not a supply stack." };
  const e = reach(state, b, u, from) || reach(state, b, u, to);
  const P = to.o === "stow" ? planStow(state, b, u, from, to, qty) : isList(to) ? planSupply(state, b, u, from, to, qty) : planSlot(state, b, u, from, to, qty);
  return { have: P.have || 0, n: (e || P.err != null) ? 0 : P.n, err: e || P.err || "" };
}

// The plan of a supply move: { A, B, k, n, have, name, timed, shift } or { err, have }.
function planSupply(state, b, u, from, to, qty) {
  if (!isList(to)) return { err: "Supplies are carried loose, not in a slot." };
  const A = place(state, b, from), B = place(state, b, to);
  if (!A || !B) return { err: "That is not there any more." };
  const k = from.i;
  // From the trunk: found supplies first, then what the team packed.
  const have = Math.floor(Math.max(0, A.sup[k] || 0)) + (A.packed ? Math.floor(Math.max(0, A.packed[k] || 0)) : 0);
  if (have < 1 || !SUPPLIES[k]) return { err: "Nothing there.", have: 0 };
  if (from.o === to.o && from.id === to.id) return { err: "", have };
  // How many fit: move one to see what it uses of each limit, then as many as the tighter one allows.
  const name = SUPPLIES[k].name.toLowerCase();
  const people = [...new Set([u, ownerOf(b, from), ownerOf(b, to)].filter(Boolean))];
  const before = rooms(state, b, people);
  const shift = (m) => {
    let left = m;
    const fromFound = Math.min(left, Math.floor(Math.max(0, A.sup[k] || 0)));
    A.sup[k] = (A.sup[k] || 0) - fromFound;
    left -= fromFound;
    if (left > 0 && A.packed) A.packed[k] = (A.packed[k] || 0) - left;
    B.sup[k] = (B.sup[k] || 0) + m;
    return () => { B.sup[k] -= m; A.sup[k] += fromFound; if (left > 0) A.packed[k] += left; };
  };
  const undoOne = shift(1);
  const one = rooms(state, b, people);
  undoOne();
  let n = Math.min(have, Number.isFinite(qty) ? Math.max(1, Math.floor(qty)) : have);
  let limit = "";
  for (const key of Object.keys(one)) {
    if (one[key] == null) continue;
    const per = before[key] - one[key];
    if (per <= EPS) continue;
    const fit = Math.max(0, Math.floor((before[key] + EPS) / per));
    if (fit < n) { n = fit; limit = key; }
  }
  if (n < 1) return { err: tooHeavy(state, b, limit || u.id, name), have };
  const w = supWeight(k);
  if (B.box && B.box.cart && !(A.box === B.box)) { // carts.js: a cart on the map takes up to its kg
    n = Math.min(n, Math.floor((boxFree(B.box) + 1e-6) / Math.max(1e-6, w)));
    if (n < 1) return { err: boxRefusal(B.box, w), have };
  }
  const timed = hauling(from, to);
  if (timed) {
    const fit = Math.floor((haulBudget(b, u) + 1e-6) / w);
    if (fit < 1) return { err: noTime(u, name), have };
    n = Math.min(n, fit);
  }
  return { A, B, k, n, have, name, timed, w, shift };
}

// ---------- found supplies into a slot (supitems.js) ----------
// The item a found supply is held as on a person: rounds a loose handful, the rest its s_<key> (a food fresh as its kind
// is now). null: none (the abstract ammo count).
function heldForm(state, k, n) {
  if (!itemKeyOf(k)) return null;
  return ROUND_SUPPLIES[k] ? roundItems(k, n, true)[0] || null : foundItems(state, k, n)[0] || null;
}
// The supply stack's pieces at `from`: how many there are, and shift(m) taking m of them (found first, then what the
// team packed) with its undo.
function supplySource(A, k) {
  const have = Math.floor(Math.max(0, A.sup[k] || 0)) + (A.packed ? Math.floor(Math.max(0, A.packed[k] || 0)) : 0);
  const take = (m) => {
    const fromFound = Math.min(m, Math.floor(Math.max(0, A.sup[k] || 0)));
    A.sup[k] = (A.sup[k] || 0) - fromFound;
    const rest = m - fromFound;
    if (rest > 0 && A.packed) A.packed[k] = (A.packed[k] || 0) - rest;
    return () => { A.sup[k] = (A.sup[k] || 0) + fromFound; if (rest > 0) A.packed[k] += rest; };
  };
  return { have, take };
}
// The plan of a supply moved onto one slot of a survivor: { n, have, put(m) → undo, ... } or { err, have }.
function planSlot(state, b, u, from, to, qty) {
  const A = place(state, b, from), B = place(state, b, to);
  if (!A || !B || !B.arr) return { err: "That is not there any more." };
  const k = from.i;
  const src = supplySource(A, k);
  const have = src.have;
  if (have < 1 || !SUPPLIES[k]) return { err: "Nothing there.", have: 0 };
  const name = SUPPLIES[k].name.toLowerCase();
  const probe = heldForm(state, k, 1);
  if (!probe) return { err: `The ${name} is carried loose, not held in a slot.`, have };
  const cur = getAt(B, to);
  let room;
  if (cur) {
    if (!canStack(cur, probe)) return { err: `The ${cur.name} is there already: drop the ${name} on a free spot or on a stack of it.`, have };
    room = roomIn(cur);
    if (room < 1) return { err: `The ${stackLabel(cur)} is full.`, have };
  } else {
    const why = fitReason(probe, to.slot, B.s);
    if (why) return { err: why, have };
    room = roundCap(probe);
  }
  const put = (m) => {
    const undoA = src.take(m);
    if (cur) { const was = cur.dur; cur.dur = Math.floor(cur.dur) + m; return () => { cur.dur = was; undoA(); }; }
    const it = heldForm(state, k, m);
    B.arr[B.key] = it;
    return () => { B.arr[B.key] = null; undoA(); };
  };
  const people = [...new Set([u, ownerOf(b, from), ownerOf(b, to)].filter(Boolean))];
  const before = rooms(state, b, people);
  const undoOne = put(1);
  const one = rooms(state, b, people);
  undoOne();
  let n = Math.min(have, room, Number.isFinite(qty) ? Math.max(1, Math.floor(qty)) : have);
  let limit = "";
  for (const key of Object.keys(one)) {
    if (one[key] == null) continue;
    const per = before[key] - one[key];
    if (per <= EPS) continue;
    const fit = Math.max(0, Math.floor((before[key] + EPS) / per));
    if (fit < n) { n = fit; limit = key; }
  }
  if (n < 1) return { err: tooHeavy(state, b, limit || u.id, name), have };
  const w = supWeight(k);
  const timed = hauling(from, to);
  if (timed) {
    const fit = Math.floor((haulBudget(b, u) + 1e-6) / w);
    if (fit < 1) return { err: noTime(u, name), have };
    n = Math.min(n, fit);
  }
  return { k, n, have, name, timed, w, put };
}
function slotSupply(state, b, u, from, to, qty) {
  const P = planSlot(state, b, u, from, to, qty);
  if (P.err != null) return P.err;
  const { k, n, have, name, timed, w, put } = P;
  put(n);
  if (timed) payHaul(b, u, n * w);
  tally(b, from, to, { sup: k, n });
  const A = place(state, b, from);
  afterBox(b, A && A.box);
  const o = ownerOf(b, to), sv = survivorById(state, to.id);
  if (o && sv) refit(state, b, o, sv);
  return `${n} ${name} → ${where(state, b, to)}${n < have ? ` (${have - n} left)` : ""}.`;
}
// The slots a found supply would go in on a survivor, best first: the stacks of it they hold with room, then a free
// pocket (a small one), a free pack cell (not a bulky one). [] when it has no held form or is bulky.
function stowSlots(state, s, k) {
  const probe = heldForm(state, k, 1);
  if (!s || !probe || isBulky(probe.key)) return [];
  ensureInv(s);
  const out = [];
  const pk = packOf(s);
  s.pockets.forEach((it, i) => { if (it && canStack(it, probe) && roomIn(it) >= 1) out.push(`s:${s.id}:pocket:${i}`); });
  (pk || []).forEach((it, i) => { if (it && canStack(it, probe) && roomIn(it) >= 1) out.push(`s:${s.id}:pack:${i}`); });
  if (!fitReason(probe, "pocket")) s.pockets.forEach((it, i) => { if (!it) out.push(`s:${s.id}:pocket:${i}`); });
  if (pk && !fitReason(probe, "pack")) pk.forEach((it, i) => { if (!it) out.push(`s:${s.id}:pack:${i}`); });
  return out;
}
// How much of a stack "stow:<uid>" would take: the room in their pockets and pack, by weight and hauling time.
function planStow(state, b, u, from, to, qty) {
  const o = b.units.find((x) => x.id === to.id && x.side === "player" && !x.dead);
  const s = o && survivorById(state, o.sid);
  if (!s) return { err: "Nobody to carry it." };
  const A = place(state, b, from);
  if (!A) return { err: "That is not there any more." };
  const k = from.i;
  const have = supplySource(A, k).have;
  if (have < 1 || !SUPPLIES[k]) return { err: "Nothing there.", have: 0 };
  const name = SUPPLIES[k].name.toLowerCase();
  const probe = heldForm(state, k, 1);
  if (!probe) return { err: `The ${name} is carried loose, not held in a pocket or a pack.`, have };
  if (isBulky(probe.key)) return { err: `The ${name} is too big for a pocket or a pack: carry it.`, have };
  let n = 0;
  for (const t of stowSlots(state, s, k)) {
    const L = parseRaidLoc(t), P = place(state, b, L), cur = P && getAt(P, L);
    n += cur ? roomIn(cur) : roundCap(probe);
  }
  if (n < 1) return { err: `No room for the ${name} in ${s.name.split(" ")[0]}'s pockets or pack.`, have };
  n = Math.min(n, have, Number.isFinite(qty) ? Math.max(1, Math.floor(qty)) : have);
  const w = supWeight(k);
  if (o !== ownerOf(b, from) && w > EPS) {
    const fit = Math.floor((personalRoom(state, o) + EPS) / w);
    if (fit < 1) return { err: tooHeavy(state, b, o.id, name), have };
    n = Math.min(n, fit);
  }
  if (hauling(from, { o: "s" }) && w > EPS) {
    const fit = Math.floor((haulBudget(b, u) + 1e-6) / w);
    if (fit < 1) return { err: noTime(u, name), have };
    n = Math.min(n, fit);
  }
  return { n, have, name, s };
}
// A found supply into a survivor's pockets and pack (the stacks of it first), as much as fits.
function stowSupply(state, b, u, from, to, qty) {
  const P = planStow(state, b, u, from, to, qty);
  if (P.err != null) return P.err;
  const k = from.i;
  let left = P.n, moved = 0;
  const spots = [];
  for (const t of stowSlots(state, P.s, k)) {
    if (left < 1) break;
    const L = parseRaidLoc(t);
    const S = planSlot(state, b, u, from, L, left);
    if (S.err != null) continue;
    slotSupply(state, b, u, from, L, S.n);
    moved += S.n; left -= S.n;
    spots.push(L.slot === "pocket" ? "a pocket" : "the pack");
  }
  if (!moved) return `No room for the ${P.name} in ${P.s.name.split(" ")[0]}'s pockets or pack.`;
  const left2 = P.have - moved;
  return `${moved} ${P.name} → ${[...new Set(spots)].join(" and ")}${left2 > 0 ? ` (${left2} left)` : ""}.`;
}

// Moves n of the stack (n: as many as fit, at most qty; any part of a stack can be taken, 1 to all).
function moveSupply(state, b, u, from, to, qty) {
  const P = planSupply(state, b, u, from, to, qty);
  if (P.err != null) return P.err;
  const { A, B, k, n, have, name, timed, w, shift } = P;
  shift(n);
  if (timed) payHaul(b, u, n * w);
  tally(b, from, to, { sup: k, n });
  afterBox(b, A.box || B.box);
  const arms = to.o === "haul" && A.box ? pileToArms(state, b, A.box, to.id, k, n) : ""; // carry.js: the team's loads off the ground go into the arms
  return `${n} ${name} → ${where(state, b, to)}${n < have ? ` (${have - n} left)` : ""}.${arms}`;
}

function moveGear(state, b, u, from, to) {
  const A = place(state, b, from), B = place(state, b, to);
  if (!A || !B) return "That is not there any more.";
  const item = getAt(A, from);
  if (!item) return "Nothing there.";
  if (isList(from) && isList(to) && from.o === to.o && from.id === to.id) return "";
  if (isCart(item) && from.o === "s" && from.slot === "carry") return `Let go of the ${item.name.toLowerCase()} to leave it here (Let go: free): it stays on the map with what is in it.`; // carts.js
  if (isCart(item) && !(to.o === "s" && to.slot === "carry")) return `The ${item.name.toLowerCase()} is pushed, not carried loose: Carry in arms.`;
  if (B.box && B.box.cart && A.box !== B.box) { const why = isCart(item) ? "A cart does not go in a cart." : boxRefusal(B.box, itemLoad(item), true); if (why) return why; }
  if (isList(to) && isSupItem(item)) return itemToStack(state, b, u, A, B, from, to, item);
  let cur = null;
  if (!isList(to)) {
    const why = fitReason(item, to.slot, to.o === "s" ? survivorById(state, to.id) : null); // a cart's grid (carts.js) takes bulky things
    if (why) return why;
    if (to.slot === "pack" && from.o === "s" && from.slot === "backpack") return "A pack does not fit inside itself.";
    cur = getAt(B, to);
  }
  // Hauling time: the actions it takes, or one heavy thing with all they have left.
  const timed = hauling(from, to);
  const kgMoved = itemLoad(item);
  if (timed && haulCost(b, u, kgMoved) > (u.ap || 0) && !((u.ap || 0) >= 1 && kgMoved > haulBudget(b, u))) return noTime(u, item.name);
  const people = [...new Set([u, ownerOf(b, from), ownerOf(b, to)].filter(Boolean))];
  const before = rooms(state, b, people);
  // Apply, check the limits, undo if one broke.
  const undo = [];
  const take = (P, loc, it) => {
    if (P.arr) { P.arr[P.key] = null; undo.push(() => (P.arr[P.key] = it)); }
    else { const i = P.gear.indexOf(it); P.gear.splice(i, 1); undo.push(() => P.gear.splice(i, 0, it)); }
  };
  const put = (P, it) => {
    if (P.arr) { const old = P.arr[P.key]; P.arr[P.key] = it; undo.push(() => (P.arr[P.key] = old)); }
    else { P.gear.push(it); undo.push(() => P.gear.splice(P.gear.lastIndexOf(it), 1)); }
  };
  // Onto a stack of the same thing (itemstack.js): as much as fits merges into it, the rest stays where it was.
  if (cur && canStack(cur, item)) {
    const was = [cur.dur, cur.n, item.dur, item.n];
    const q = mergeInto(cur, item);
    if (!q) return `The ${stackLabel(cur)} is full.`;
    const spent = isSpent(item);
    if (spent) take(A, from, item);
    const which = broke(before, rooms(state, b, people));
    if (which) {
      for (let i = undo.length - 1; i >= 0; i--) undo[i]();
      const set = (it, k, v) => { if (v === undefined) delete it[k]; else it[k] = v; };
      set(cur, "dur", was[0]); set(cur, "n", was[1]); set(item, "dur", was[2]); set(item, "n", was[3]);
      return tooHeavy(state, b, which, item.name);
    }
    if (timed) payHaul(b, u, kgMoved);
    tally(b, from, to, { item: cur });
    afterBox(b, A.box || B.box);
    return spent ? `${item.name} onto the stack: ${stackLabel(cur)}.` : `${q} onto the stack (${stackLabel(cur)}); the rest stays.`;
  }
  take(A, from, item);
  let curTo = null;
  if (cur) {
    take(B, to, cur);
    // The thing already there: back where the moved one came from if it fits, else into its owner's arms.
    const holder = ownerOf(b, to) || u;
    if (isList(from) || !fitReason(cur, from.slot)) { put(A, cur); curTo = from; }
    else { put(place(state, b, { o: "haul", id: holder.id }), cur); curTo = { o: "haul", id: holder.id }; }
  }
  put(B, item);
  const which = broke(before, rooms(state, b, people));
  if (which) {
    for (let i = undo.length - 1; i >= 0; i--) undo[i]();
    return tooHeavy(state, b, which, item.name);
  }
  if (timed) {
    if (haulCost(b, u, kgMoved) > (u.ap || 0)) { hauled(b, u); u.hauledKg += kgMoved; u.ap = 0; } // the heavy lift: the rest of the turn
    else payHaul(b, u, kgMoved);
  }
  tally(b, from, to, { item });
  if (cur) tally(b, to, curTo, { item: cur });
  afterBox(b, A.box || B.box);
  for (const loc of [from, to]) {
    if (loc.o !== "s") continue;
    const o = ownerOf(b, loc), sv = survivorById(state, loc.id);
    if (o && sv) refit(state, b, o, sv);
  }
  // gunload.js: a gun carried into the fight that leaves your people unfired goes out loaded (its rounds with it).
  const team = (l) => l && (l.o === "s" || l.o === "haul");
  if (team(from) && !team(to)) gunLeavesTeam(b, item);
  if (cur && team(to) && curTo && !team(curTo)) gunLeavesTeam(b, cur);
  return cur ? `${item.name} → ${where(state, b, to)}; the ${cur.name} → ${where(state, b, curTo)}.` : `${item.name} → ${where(state, b, to)}.`;
}

// A supply item (supitems.js) put in a container, Carried or the vehicle: a supply stack there again (its food back
// in the team's cargo with the shelf it has left).
function itemToStack(state, b, u, A, B, from, to, item) {
  const k = stockKeyOf(item), q = amountOf(item);
  if (!k || !(q >= 1)) return "Nothing there.";
  const timed = hauling(from, to);
  const kgMoved = itemLoad(item);
  if (timed && haulCost(b, u, kgMoved) > (u.ap || 0) && !((u.ap || 0) >= 1 && kgMoved > haulBudget(b, u))) return noTime(u, item.name);
  const people = [...new Set([u, ownerOf(b, from), ownerOf(b, to)].filter(Boolean))];
  const before = rooms(state, b, people);
  const was = B.sup[k];
  const restore = A.arr ? (() => { const at = A.key; A.arr[at] = null; return () => (A.arr[at] = item); })() : (() => { const i = A.gear.indexOf(item); A.gear.splice(i, 1); return () => A.gear.splice(i, 0, item); })();
  B.sup[k] = (B.sup[k] || 0) + q;
  const which = broke(before, rooms(state, b, people));
  if (which) { if (was === undefined) delete B.sup[k]; else B.sup[k] = was; restore(); return tooHeavy(state, b, which, item.name); }
  if (to.o === "trunk" && B.p && B.p.cargo) { B.sup[k] -= q; if (!(B.sup[k] > 0)) delete B.sup[k]; putBack(state, B.p.cargo, item); } // its food a lot with the shelf it has left
  if (timed) payHaul(b, u, kgMoved);
  tally(b, from, to, { sup: k, n: q });
  afterBox(b, A.box || B.box);
  if (from.o === "s") { const o = ownerOf(b, from), sv = survivorById(state, from.id); if (o && sv) refit(state, b, o, sv); }
  return `${stackLabel(item)} → ${where(state, b, to)}.`;
}

function where(state, b, loc) {
  if (loc.o === "rbox") { const c = lootLayer(b).containers.find((x) => x.id === loc.id); return c && c.cart ? `in the ${c.cart.name.toLowerCase()}` : c && c.kind === "ground" ? "on the ground" : c && c.kind === "body" ? "left on the body" : "left in the container"; }
  if (loc.o === "haul") {
    const o = b.units.find((x) => x.id === loc.id);
    return o && o.id !== lootLayer(b).lootBy ? `${o.name.split(" ")[0]} (carried)` : "carried";
  }
  if (loc.o === "trunk") return isBike(trunkVehicle(state, b)) ? "the bike racks" : "the vehicle";
  const o = ownerOf(b, loc);
  return `${SLOT_NAMES[loc.slot] || "worn"}${o && o.id !== lootLayer(b).lootBy ? ` (${o.name.split(" ")[0]})` : ""}`;
}

// What the raid found (b.raid.found / foundGear, shown in the panel and the result): things out of a container count,
// things put back do not.
function tally(b, from, to, { item, sup, n }) {
  const R = lootLayer(b);
  // A container counts; a pile a fallen teammate dropped holds things already found (dropHaul).
  const box = (loc) => loc.o === "rbox" && !R.containers.find((c) => c.id === loc.id)?.drop;
  const sign = box(from) && !box(to) ? 1 : box(to) && !box(from) ? -1 : 0;
  if (!sign) return;
  if (sup) {
    R.found[sup] = (R.found[sup] || 0) + sign * n;
    if (R.found[sup] <= 0) delete R.found[sup];
  } else if (sign > 0) { if (!R.foundGear.includes(item)) R.foundGear.push(item); }
  else { const i = R.foundGear.indexOf(item); if (i >= 0) R.foundGear.splice(i, 1); }
}

// A container is searched once nothing is left in it (the map stops marking it); one only rummaged through
// (search.js box.quick) is not, since a full search may turn up more.
function afterBox(b, box) {
  if (!box || !box.contents) return;
  const left = box.contents.gear.length + Object.values(box.contents.sup).filter((v) => v >= 1).length;
  box.searched = !left && !box.quick;
  box.partial = !!left;
}

// A weapon or armor put on (or taken off) in the middle of a raid counts at once (combat.js refitUnit).
let refitHook = null;
export const setRefit = (fn) => (refitHook = fn);
function refit(state, b, u, s) { if (refitHook) refitHook(b, u, s); }

// ---------- whole loads ----------
// Everything from the container that fits on this survivor: supplies first (into pockets and the pack as items; a bulky
// one, and what has no room there, carried), then items by worth per kg (small things to pockets and the pack, the rest carried). Returns
// { got: [names], left: n }.
export function raidTakeAll(state, uid, boxId) {
  const b = state.combat;
  const u = b && b.units.find((x) => x.id === uid);
  const box = b && lootLayer(b) && lootLayer(b).containers.find((c) => c.id === boxId);
  if (!u || !box || !box.contents) return { got: [], left: 0 };
  const got = [];
  const src = `rbox:${box.id}`;
  for (const k of Object.keys(box.contents.sup)) {
    if (!(box.contents.sup[k] >= 1)) continue;
    const before = Math.floor(box.contents.sup[k]);
    // Into pockets and the pack as the item that holds it; only a bulky supply (or one with no item form) is carried.
    const probe = heldForm(state, k, 1);
    if (probe && !isBulky(probe.key)) raidMove(state, uid, `${src}:sup:${k}`, `stow:${u.id}`);
    if (box.contents.sup[k] >= 1) raidMove(state, uid, `${src}:sup:${k}`, `haul:${u.id}:list`); // bulky, or more than the pockets and pack hold: carried
    const took = before - Math.floor(box.contents.sup[k] || 0);
    if (took > 0) got.push(`${took} ${keyWord(k)}`);
  }
  // Items by worth for their weight, so the time and the room go on the best things first.
  const order = box.contents.gear.slice().sort((a, c) => worthPerKg(c) - worthPerKg(a));
  for (const it of order) {
    if (!(u.ap > 0) && haulBudget(b, u) < itemLoad(it)) break;
    raidMove(state, uid, `${src}:gear:${box.contents.gear.indexOf(it)}`, stowTarget(state, b, u, it));
    if (!box.contents.gear.includes(it)) got.push(it.name);
  }
  const left = box.contents.gear.length + Object.values(box.contents.sup).filter((v) => v >= 1).length;
  // Nothing taken (an empty container, or nothing that fits) still counts as searched when nothing is left: afterBox
  // runs with every move, but a container that rolled empty never had one, and the bot came back to it every step.
  afterBox(b, box);
  return { got, left, outOfTime: left > 0 && haulBudget(b, u) < 0.5 };
}
// Where a found item goes on a survivor without being put to use: a free pocket or pack cell, else carried.
function stowTarget(state, b, u, it) {
  const s = survivorById(state, u.sid);
  if (s) {
    ensureInv(s);
    if (isSmall(it.key)) { const i = s.pockets.indexOf(null); if (i >= 0) return `s:${s.id}:pocket:${i}`; }
    const pk = packOf(s);
    if (pk && !packSize(it) && !isBulky(it.key)) { const i = pk.indexOf(null); if (i >= 0) return `s:${s.id}:pack:${i}`; }
  }
  return `haul:${u.id}:list`;
}

// Everything the survivor carries loose goes in the vehicle (what fits). Returns { put: [names], left: n, outOfTime }.
export function stashAll(state, uid) {
  const b = state.combat;
  const u = b && b.units.find((x) => x.id === uid);
  const p = b && raidParty(state, b);
  if (!u || !p || !u.haul) return { put: [], left: 0 };
  const put = [];
  const to = `trunk:${p.id}:list`;
  for (const k of Object.keys(u.haul.sup)) {
    const before = Math.floor(u.haul.sup[k] || 0);
    if (before < 1) continue;
    raidMove(state, uid, `haul:${u.id}:sup:${k}`, to);
    const n = before - Math.floor(u.haul.sup[k] || 0);
    if (n > 0) put.push(`${n} ${keyWord(k)}`);
  }
  for (const it of u.haul.gear.slice()) {
    raidMove(state, uid, `haul:${u.id}:gear:${u.haul.gear.indexOf(it)}`, to);
    if (!u.haul.gear.includes(it)) put.push(it.name);
  }
  const left = u.haul.gear.length + Object.values(u.haul.sup).filter((v) => v >= 1).length;
  return { put, left, outOfTime: left > 0 && haulBudget(b, u) < 0.5 }; // what is left stays for want of time, not room
}

// The headless search (bots, autopilot, tests): what fits goes on the survivor (stowed or carried).
export function autoTake(state, b, u, box) {
  return raidTakeAll(state, u.id, box.id);
}

// ---------- someone falls ----------
// A survivor who dies in a raid (bled out, or torn into lying down: combat.js) leaves their body like anyone killed
// there (combat.js damage: every human, any side, is a body to search; uid ties it to the unit, so the downed
// picture shows it searched). On it, what they carried loose (drop: things already found, the others can take home);
// their own slots go with them as before. Carrying nothing loose, the body is there but has nothing to turn out
// (searched from the start, so nobody walks over for it).
export function dropHaul(b, u) {
  if (!b.raid) return null;
  const h = u.haul;
  const sup = {}, gear = [];
  if (h) {
    for (const [k, v] of Object.entries(h.sup)) if (v > 0) { sup[k] = v; h.sup[k] = 0; }
    gear.push(...h.gear.splice(0));
  }
  const any = gear.length > 0 || Object.keys(sup).length > 0;
  const old = b.raid.containers.find((c) => c.kind === "body" && c.uid === u.id);
  if (old) { // already a body (should not happen twice): add to it
    old.contents = old.contents || { sup: {}, gear: [] };
    for (const [k, v] of Object.entries(sup)) old.contents.sup[k] = (old.contents.sup[k] || 0) + v;
    old.contents.gear.push(...gear);
    if (any) { old.searched = false; old.partial = true; }
    return old;
  }
  const pile = { id: b.nextId++, x: u.x, y: u.y, f: u.f || 0, kind: "body", drop: true, area: null, searched: !any, partial: any, label: `${u.name}'s body`, uid: u.id, contents: { sup, gear } };
  b.raid.containers.push(pile);
  return pile;
}
// Did the fallen leave anything loose on their body (the bleed-out line says so)?
export const dropHeld = (pile) => !!(pile && pile.contents && (pile.contents.gear.length || Object.values(pile.contents.sup).some((v) => v > 0)));

// ---------- the end of a raid ----------
// Those who come home add what they carry loose to the team's cargo; the rest lose it (and the raid did not find it).
export function raidHome(state, b, homeUids) {
  const p = raidParty(state, b);
  const R = b.raid;
  for (const u of b.units) {
    if (u.side !== "player" || !u.haul) continue;
    const h = u.haul;
    if (p && homeUids.has(u.id)) {
      p.cargo = p.cargo || { supplies: {}, gear: [] };
      for (const [k, v] of Object.entries(h.sup)) if (v > 0) p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + v;
      p.cargo.gear.push(...h.gear);
    } else {
      for (const [k, v] of Object.entries(h.sup)) if (v > 0 && R.found[k]) { R.found[k] = Math.max(0, R.found[k] - v); if (!R.found[k]) delete R.found[k]; }
      for (const g of h.gear) { const i = R.foundGear.indexOf(g); if (i >= 0) R.foundGear.splice(i, 1); }
    }
    for (const k of Object.keys(h.sup)) h.sup[k] = 0;
    h.gear.length = 0;
  }
  // gunload.js: the guns that came home with rounds in them are unloaded into the team's cargo.
  if (p) p.cargo = p.cargo || { supplies: {}, gear: [] };
  const homePeople = b.units.filter((u) => u.side === "player" && homeUids.has(u.id)).map((u) => survivorById(state, u.sid)).filter(Boolean);
  returnStacks(b, homePeople, p ? p.cargo.supplies || (p.cargo.supplies = {}) : null); // mags.js: what is left in the guns and the magazines goes back onto the person as loose rounds
  if (p) unloadInto(null, teamGuns(homePeople, p.cargo.gear || []), p.cargo.supplies || (p.cargo.supplies = {})); // a bag in the arms and one in the cargo too
  // The piles nobody picked up stay behind: they were found, but nobody brought them home.
  for (const c of R.containers) {
    if (!c.drop || !c.contents) continue;
    for (const [k, v] of Object.entries(c.contents.sup)) if (v > 0 && R.found[k]) { R.found[k] = Math.max(0, R.found[k] - v); if (!R.found[k]) delete R.found[k]; }
    for (const g of c.contents.gear) { const i = R.foundGear.indexOf(g); if (i >= 0) R.foundGear.splice(i, 1); }
  }
}

// Where a thing clicked twice in the search window goes: out of the container or the vehicle onto the survivor;
// off the survivor into the vehicle when they are at it, else back into the open container.
export function quickTarget(state, b, uid, fromStr, boxId) {
  const u = b.units.find((x) => x.id === uid);
  const F = parseRaidLoc(fromStr);
  if (!u) return fromStr;
  if (F.o === "rbox" || F.o === "trunk") {
    if (F.slot === "sup") { const probe = heldForm(state, F.i, 1); return probe && !isBulky(probe.key) && stowSlots(state, survivorById(state, u.sid), F.i).length ? `stow:${u.id}` : `haul:${u.id}:list`; } // pockets and the pack; Carried for the big things
    const it = raidItemAt(state, b, fromStr);
    return it ? stowTarget(state, b, u, it) : fromStr;
  }
  // A teammate's thing comes to the one whose window it is.
  const o = ownerOf(b, F);
  if (o && o !== u) { const it = raidItemAt(state, b, fromStr); return it ? stowTarget(state, b, u, it) : `haul:${u.id}:list`; }
  const p = raidParty(state, b);
  if (p && atVehicle(b, u)) return `trunk:${p.id}:list`;
  if (boxId != null) return `rbox:${boxId}:list`;
  return F.o === "s" ? `haul:${u.id}:list` : fromStr;
}
