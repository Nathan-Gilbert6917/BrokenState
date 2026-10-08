// @ts-check
// A team's inventory as one thing: every member's kit (worn, held, pockets, rig pouches, plates, pack) and the
// team's cargo (what rides in its vehicle, or is shared out among the people on foot), and moving goods between a
// team and one of your bases while the team stands on that base's tile (whether it has gone inside or not).
//
// inventory.js moves items only within one place (one base, or one team); this module is the one door between the
// two: drop off (team → the base's armory and stores) and load (the base's armory and stores → a member or the
// team's cargo). Items move as the objects they are, so condition, durability, a box's rounds left, a magazine's load,
// a gun's attachments, a pack's contents and a carrier's plates all go with them. Supplies move by key (food, water,
// un-purified water, every calibre and type of round on its own key, parts...), any part of a stack.
//
// Weight rules (load.js, parties.js): a team never ends a transfer more over its carry limit than it started (a worn
// pack or rig dropped off takes its carry bonus with it), nothing loaded takes it over the limit, and nobody is
// made to wear more than their own max load. Loaded supplies go into the team's packed supplies (eaten first on the
// road); loaded items go onto the person picked (their own slot if free, a rig pouch, a pocket, the pack) or into
// the cargo. Fresh game in the cargo (hunting.js) and forage with the worm's eggs (worm.js) go into the base's
// stores as they do when a team comes home.
//
// AI parity: the other groups' teams and caravans deliver their goods abstractly (a group's stock and lootedGear,
// factions.js, caravans.js): they have no per-person inventories to sort, so nothing of theirs goes through here.
/** @import { State, Party, Base, Item, Survivor, Stock } from "./types" */
import { SUPPLIES } from "./data.js";
import { survivorById } from "./world.js";
import { partyMembers, partyTile, partyCapacity, poolLoad, weighTeam, onTheMove } from "./parties.js";
import { partyVehicle, vehicleLabel } from "./vehicles.js";
import { ensureInv, EQUIP_SLOTS, packOf, rigPouches, isCarrier, insertsOf, INSERT_SIDES, itemLoad, stow, removeAt, parseLoc } from "./inventory.js";
import { wornLoad, maxLoad } from "./load.js";
import { meatIn, takeMeat, unloadGame, meatAt } from "./hunting.js";
import { wormMeatIn, wormMeatAt, wormForageIn, unloadWormForage } from "./worm.js";
import { bodiesHome } from "./carriers.js";

const EPS = 1e-6;
const num = (v) => (Number.isFinite(v) ? v : 0);
const r1 = (x) => Math.round(x * 10) / 10;
const supName = (k) => (SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : k);
const qtyText = (q) => (Math.abs(q - Math.round(q)) < 1e-6 ? String(Math.round(q)) : String(r1(q)));

// ---------- where ----------
/** A team of yours that can sort its things (a player expedition, not a trade convoy). @param {Party} p */
export const isPlayerTeam = (p) => !!p && p.owner === "player" && p.kind !== "convoy";
// The base of yours on the tile where the team stands, or null.
/** @param {State} state @param {Party} p @returns {Base | null} */
export function teamBase(state, p) {
  if (!isPlayerTeam(p) || !Array.isArray(p.path)) return null;
  const tile = partyTile(p);
  return state.bases.find((b) => b.tile === tile) || null;
}
// Why goods cannot move between this team and a base now ("" when they can).
/** @param {State} state @param {Party} p @param {Base | null} [base] */
export function transferProblem(state, p, base = null) {
  if (!p || !state.parties.includes(p)) return "That team is gone.";
  if (!isPlayerTeam(p)) return "Only your own teams can drop off or load at a base.";
  const b = base || teamBase(state, p);
  if (!b) return "The team is not at one of your bases.";
  if (b.tile !== partyTile(p)) return `The team is not at ${b.name}.`;
  if (state.combat) return "Not during a battle.";
  if (!partyMembers(state, p).length) return "Nobody is left on the team.";
  return "";
}
// Your teams standing on a base's tile (the base screen lists them: load them from the stores, take their things in).
/** @param {State} state @param {Base} base */
export const teamsAtBase = (state, base) => state.parties.filter((p) => isPlayerTeam(p) && Array.isArray(p.path) && partyTile(p) === base.tile && partyMembers(state, p).length);

// ---------- what a team has ----------
// Every place an item is on a person, with how to take it off and put it back: worn and held, pockets, the rig's
// pouches, a worn carrier's plates, the pack's slots. { item, where, loc, take(), put(item) }.
function spotsOf(s) {
  ensureInv(s);
  const pre = `s:${s.id}`;
  const out = [];
  const add = (arr, key, where, loc) => { const it = arr[key]; if (it) out.push({ item: it, where, loc, take: () => { arr[key] = null; }, put: (x) => { arr[key] = x; } }); };
  for (const k of EQUIP_SLOTS) add(s.gear, k, k, `${pre}:${k}`);
  s.pockets.forEach((_, i) => add(s.pockets, i, "pocket", `${pre}:pocket:${i}`));
  const rp = rigPouches(s);
  if (rp) rp.forEach((_, i) => add(rp, i, "rig", `${pre}:rig:${i}`));
  if (isCarrier(s.gear.armor)) { const ins = insertsOf(s.gear.armor); for (const side of INSERT_SIDES) add(ins, side, "insert", `${pre}:insert:${side}`); }
  const pk = packOf(s);
  if (pk) pk.forEach((_, i) => add(pk, i, "pack", `${pre}:pack:${i}`));
  return out;
}

// The team's inventory for the windows and tests:
//   members: [{ s, spots: [{ item, where, loc, kg }], worn, max }]
//   cargo: { vehicle, name, gear: [{ item, loc, kg }], supplies: { key: { packed, found, all } }, bodies }
//   load, cap: the pool (supplies and cargo) against what the team can carry on top of what it wears.
/** @param {State} state @param {Party} p */
export function teamHoldings(state, p) {
  const members = partyMembers(state, p).map((s) => ({
    s,
    spots: spotsOf(s).map(({ item, where, loc }) => ({ item, where, loc, kg: itemLoad(item) })),
    worn: wornLoad(s),
    max: maxLoad(s),
  }));
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  const v = partyVehicle(state, p);
  /** @type {Record<string, { packed: number, found: number, all: number }>} */
  const supplies = {};
  for (const [pool, k2] of [[p.supplies || {}, "packed"], [p.cargo.supplies || {}, "found"]]) {
    for (const [k, q] of Object.entries(pool)) {
      if (!SUPPLIES[k] || !(num(q) > 0)) continue;
      const e = supplies[k] || (supplies[k] = { packed: 0, found: 0, all: 0 });
      e[k2] += q;
      e.all += q;
    }
  }
  for (const k of Object.keys(supplies)) if (supplies[k].all < 0.05) delete supplies[k];
  return {
    members,
    cargo: { vehicle: v, name: v ? `${vehicleLabel(v)} (team cargo)` : "Team cargo (carried by hand)", gear: p.cargo.gear.map((item, i) => ({ item, loc: `cargo:${p.id}:list:${i}`, kg: itemLoad(item) })), supplies, bodies: (p.cargo.bodies || []).length },
    load: poolLoad(p),
    cap: partyCapacity(state, p),
  };
}
// A base's side: the armory's items and the stores.
/** @param {State} state @param {Base} base */
export function baseHoldings(state, base) {
  const stock = {};
  for (const [k, q] of Object.entries(base.stock || {})) if (SUPPLIES[k] && num(q) >= 0.05) stock[k] = q;
  return { armory: base.armory.map((item, i) => ({ item, loc: `armory:${base.id}:list:${i}`, kg: itemLoad(item) })), stock };
}

// How far over its carry limit the team is (0 when within it).
const overBy = (state, p) => Math.max(0, poolLoad(p) - partyCapacity(state, p));
// The pool weighed again when the team is not on the move (on the move only what slows it counts: parties.js reweigh).
function reweigh(state, p) { if (!onTheMove(p)) weighTeam(state, p); }

// ---------- supplies: out of a team, into a base ----------
// Takes up to `want` of a supply off the team, the found cargo first, then the packed supplies. Fresh game in the cargo
// goes first (it spoils on the road; at the base it is smoked or dried) and into the base as fresh game, the worm's
// eggs with it. Returns the amount moved.
function supplyToBase(p, base, k, want, packed = true) {
  const cs = p.cargo.supplies;
  let left = Math.max(0, want);
  let moved = 0;
  const fromCargo = Math.min(left, Math.max(0, num(cs[k])));
  if (fromCargo > 0) {
    if (k === "food") {
      const all = fromCargo >= Math.max(0, num(cs.food)) - EPS;
      if (all) {
        // Everything: exactly as a team coming home (parties.js returnHome).
        unloadGame(base, p.cargo);
        unloadWormForage(base, p.cargo);
        cs.food = num(cs.food) - fromCargo;
      } else {
        const plainBefore = Math.max(0, num(cs.food) - meatIn(p.cargo));
        const wfBefore = wormForageIn(p.cargo);
        const wmBefore = wormMeatIn(p.cargo);
        const meatQ = Math.min(meatIn(p.cargo), fromCargo);
        if (meatQ > 0) {
          takeMeat(p.cargo, meatQ); // takes the food off the cargo too
          const wm = Math.max(0, wmBefore - wormMeatIn(p.cargo));
          if (wm > 0) base.wormMeat = wormMeatAt(base) + wm;
          base.meat = meatAt(base) + meatQ;
        }
        const plainQ = fromCargo - meatQ;
        if (plainQ > 0) {
          cs.food = num(cs.food) - plainQ;
          const wf = plainBefore > 0 ? Math.min(wfBefore, (wfBefore * plainQ) / plainBefore) : 0;
          if (wf > 0) { p.cargo.wormForage = Math.max(0, num(p.cargo.wormForage) - wf); base.wormForage = num(base.wormForage) + wf; }
        }
      }
    } else cs[k] = num(cs[k]) - fromCargo;
    if (Math.abs(cs[k]) < 1e-9) cs[k] = 0;
    moved += fromCargo;
    left -= fromCargo;
  }
  const fromPacked = packed ? Math.min(left, Math.max(0, num(p.supplies[k]))) : 0;
  if (fromPacked > 0) {
    p.supplies[k] = num(p.supplies[k]) - fromPacked;
    if (Math.abs(p.supplies[k]) < 1e-9) p.supplies[k] = 0;
    moved += fromPacked;
  }
  if (moved > 0) base.stock[k] = num(base.stock[k]) + moved;
  return moved;
}

// ---------- drop off: team → base ----------
// picks: { items: [location strings or Item objects] (a member's "s:<id>:…", the cargo's "cargo:<pid>:list:<i>"),
//          supplies: { key: amount (Infinity: all of it) } }.
// Returns { moved: [text], refused: [text], text }.
/** @param {State} state @param {Party} p @param {{ items?: (string | Item)[], supplies?: Record<string, number> }} picks */
export function dropOff(state, p, picks = {}) {
  const why = transferProblem(state, p);
  if (why) return { moved: [], refused: [why], text: why };
  const base = /** @type {Base} */ (teamBase(state, p));
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  const moved = [], refused = [];
  const items = resolveTeamItems(state, p, picks.items || []);
  for (const it of items) {
    const at = findOnTeam(state, p, it);
    if (!at) continue; // went with something picked before it (a pack with its contents)
    const before = overBy(state, p);
    at.take();
    if (overBy(state, p) > before + EPS) {
      at.put(it);
      refused.push(`The ${it.name} stays: without it the team cannot carry its load (${Math.round(poolLoad(p))} kg on ${Math.round(partyCapacity(state, p))} kg). Drop off some cargo first.`);
      continue;
    }
    base.armory.push(it);
    moved.push(it.name);
  }
  for (const [k, q] of Object.entries(picks.supplies || {})) {
    if (!SUPPLIES[k]) continue;
    const want = q === Infinity ? Infinity : Math.max(0, num(Number(q)));
    if (!(want > 0)) continue;
    const got = supplyToBase(p, base, k, want);
    if (got > 0) moved.push(`${qtyText(got)} ${supName(k)}`);
  }
  if (moved.length) reweigh(state, p);
  return result(moved, refused, `into ${base.name}`);
}
// The cargo's whole contents (gear, found supplies, bodies in the car) into the base: what a team brings home.
/** @param {State} state @param {Party} p */
export function dropAllCargo(state, p) {
  const why = transferProblem(state, p);
  if (why) return { moved: [], refused: [why], text: why };
  const base = /** @type {Base} */ (teamBase(state, p));
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  const sup = {};
  for (const [k, q] of Object.entries(p.cargo.supplies)) if (SUPPLIES[k] && num(q) > 0) sup[k] = num(q);
  const r = dropOff(state, p, { items: [...p.cargo.gear], supplies: {} });
  for (const [k, q] of Object.entries(sup)) { const got = supplyToBase(p, base, k, q, false); if (got > 0) r.moved.push(`${qtyText(got)} ${supName(k)}`); }
  const bodies = (p.cargo.bodies || []).length;
  if (bodies) { bodiesHome(state, p, base); r.moved.push(`${bodies} bod${bodies === 1 ? "y" : "ies"}`); }
  reweigh(state, p);
  return result(r.moved, r.refused, `into ${base.name}`);
}
// Every supply the team has, packed and found, into the base's stores (the kit stays on the people).
/** @param {State} state @param {Party} p */
export function dropAllSupplies(state, p) {
  const h = teamHoldings(state, p);
  const supplies = {};
  for (const k of Object.keys(h.cargo.supplies)) supplies[k] = Infinity;
  return dropOff(state, p, { supplies });
}

// ---------- load: base → team ----------
// picks: { items: [armory location strings or Item objects], supplies: { key: amount } }.
// target: "cargo" (the team's cargo: the vehicle, or carried by hand) or a member's survivor id (their own slot if it
// is free, a rig pouch, a pocket, the pack; something that fits none of them is refused: load it into the cargo).
// Supplies go into the team's packed supplies, as many as it can carry.
/** @param {State} state @param {Party} p @param {{ items?: (string | Item)[], supplies?: Record<string, number> }} picks @param {"cargo" | number | string} target */
export function loadFromBase(state, p, picks = {}, target = "cargo") {
  const why = transferProblem(state, p);
  if (why) return { moved: [], refused: [why], text: why };
  const base = /** @type {Base} */ (teamBase(state, p));
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  p.supplies = p.supplies || {};
  const moved = [], refused = [];
  const toCargo = target === "cargo" || target == null;
  const s = toCargo ? null : survivorById(state, Number(target));
  if (!toCargo && (!s || !(p.members || []).includes(s.id) || !s.alive)) return result([], ["That person is not on the team."], "");
  const first = s ? s.name.split(" ")[0] : "";
  for (const it of resolveArmoryItems(base, picks.items || [])) {
    const i = base.armory.indexOf(it);
    if (i < 0) continue;
    if (toCargo) {
      const room = partyCapacity(state, p) - poolLoad(p);
      if (itemLoad(it) > room + EPS) { refused.push(`No room for the ${it.name} (${r1(itemLoad(it))} kg; ${r1(Math.max(0, room))} kg free).`); continue; }
      base.armory.splice(i, 1);
      p.cargo.gear.push(it);
      moved.push(it.name);
      continue;
    }
    const before = overBy(state, p);
    const loc = stow(/** @type {Survivor} */ (s), it);
    if (!loc) { refused.push(`${first} has no free place for the ${it.name} (its own slot, a pocket or pack slot): load it into the cargo, or make room.`); continue; }
    const tooHeavy = wornLoad(s) > maxLoad(s) + EPS;
    if (tooHeavy || overBy(state, p) > before + EPS) {
      removeAt(state, loc);
      refused.push(tooHeavy ? `The ${it.name} is too heavy for ${first} (${r1(itemLoad(it))} kg; ${first} would wear ${r1(wornLoad(s) + itemLoad(it))} of ${maxLoad(s)} kg).` : `No room for the ${it.name}: the team could not carry its load as well.`);
      continue;
    }
    base.armory.splice(base.armory.indexOf(it), 1);
    moved.push(`${it.name} (${first})`);
  }
  for (const [k, q] of Object.entries(picks.supplies || {})) {
    const sup = SUPPLIES[k];
    if (!sup) continue;
    const have = Math.max(0, num(base.stock[k]));
    const want = Math.min(have, q === Infinity ? have : Math.max(0, num(Number(q))));
    if (!(want > 0)) continue;
    const room = Math.max(0, partyCapacity(state, p) - poolLoad(p));
    const fit = sup.weight > 0 ? Math.min(want, Math.floor((room + EPS) / sup.weight)) : want;
    if (fit < want - EPS) refused.push(fit > 0 ? `Only ${qtyText(fit)} of the ${qtyText(want)} ${supName(k)} fit (${r1(room)} kg free).` : `No room for ${supName(k)} (${r1(room)} kg free).`);
    if (!(fit > 0)) continue;
    base.stock[k] = have - fit;
    if (Math.abs(base.stock[k]) < 1e-9) base.stock[k] = 0;
    p.supplies[k] = num(p.supplies[k]) + fit;
    moved.push(`${qtyText(fit)} ${supName(k)}`);
  }
  if (moved.length) reweigh(state, p);
  return result(moved, refused, toCargo ? `onto the team${partyVehicle(state, p) ? ` (${vehicleLabel(/** @type {any} */ (partyVehicle(state, p)))})` : ""}` : `onto the team (items to ${first})`);
}

// ---------- helpers ----------
function result(moved, refused, where) {
  const text = [moved.length ? `Moved ${moved.join(", ")} ${where}.` : refused.length ? "" : "Nothing picked.", ...refused].filter(Boolean).join(" ");
  return { moved, refused, text };
}
// Picks to the items themselves (location strings name a place now; the items are what move).
function resolveTeamItems(state, p, list) {
  const out = [];
  for (const x of list) {
    let it = null;
    if (typeof x === "string") {
      const L = parseLoc(x);
      if (L.o === "cargo" && L.id === p.id) it = L.i != null ? p.cargo.gear[L.i] || null : null;
      else if (L.o === "s" && (p.members || []).includes(L.id)) { const s = survivorById(state, L.id); it = s ? (spotsOf(s).find((q) => q.loc === x) || {}).item || null : null; }
    } else it = x;
    if (it && !out.includes(it)) out.push(it);
  }
  return out;
}
function resolveArmoryItems(base, list) {
  const out = [];
  for (const x of list) {
    let it = null;
    if (typeof x === "string") { const L = parseLoc(x); if (L.o === "armory" && L.id === base.id && L.i != null) it = base.armory[L.i] || null; }
    else it = x;
    if (it && !out.includes(it)) out.push(it);
  }
  return out;
}
// Where an item is on the team now: { take(), put(item) } or null.
function findOnTeam(state, p, it) {
  const ci = p.cargo.gear.indexOf(it);
  if (ci >= 0) return { take: () => { const j = p.cargo.gear.indexOf(it); if (j >= 0) p.cargo.gear.splice(j, 1); }, put: (x) => p.cargo.gear.splice(Math.min(ci, p.cargo.gear.length), 0, x) };
  for (const s of partyMembers(state, p)) {
    const spot = spotsOf(s).find((q) => q.item === it);
    if (spot) return spot;
  }
  return null;
}
