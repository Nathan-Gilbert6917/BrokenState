// @ts-check
// Supplies as items you hold (2026-10-16, user request: "Convert items in stores into items that can be held in
// pockets, packs and off hand"; "when looting these items are not put into pockets, packs; the carried section is
// meant for larger heavy objects"). The data is data-supitems.js (s_<key>, the stack a slot, small / bulky); the stacks
// themselves are itemstack.js (a count stack: item.dur = the units).
//
// A stock (a base's stores, a team's found cargo) holds supplies by key. Taking some out makes the item form of that
// key: a box of rounds for rounds (the same key, data-ammo.js), a bag, a can or a box for the bench's brass, powder and
// primers, else s_<key>. A food taken out keeps its shelf left (item.until: the day it spoils, from the lot it came
// from, foods.js takeItem; the eggs too, item.egg) and goes off in a pocket as it would in the stores. Put back (into a
// base's armory or a team's cargo: supitems settle at once, and every hour with the boxes, ammo.js settleBase /
// settleParty) it is stock again, its food a lot with the shelf it has left; spoiled food is gone.
//
// While on a person it is theirs: rounds in a fight (ammo.js roundsOf), everything else until it is put back. Found
// supplies in a raid or a field battle go the same way (raidloot.js: into pockets and the pack as these items, bulky
// ones and what does not fit carried loose).
import { GEAR, SUPPLIES } from "./data.js";
import { supItemKey } from "./data-supitems.js";
import { FOODS, stockOf, takeItem, addFood, newLeft } from "./foods.js";
import { ROUND_SUPPLIES } from "./data-ammo.js";
import { isSupItem, isRoundItem, roundItems, roundItem, supItemCap, roundCap, canStack, roomIn, mergeInto, isSpent, amountOf } from "./itemstack.js";
import { AMMO_STACK } from "./data-stacks.js";
import { ADMIN_KG, SUPPLY_POUCHES } from "./data-kit.js"; // the rig pouches that take supplies (admin within its weight, pocket)
import { ensureInv, packOf, rigPouches, rigOf, pouchesOf, pouchReason, isSmall, fitReason, stow, battleBodies, storageFor, battlePlace, itemLoad } from "./inventory.js"; // call-time only: safe in the import cycle
import { wornLoad, maxLoad } from "./load.js";
import { cargoRoom, unitsThatFit } from "./parties.js"; // call-time only: safe in the import cycle

const num = (v) => (Number.isFinite(v) ? v : 0);
const EPS = 1e-9;
/** @param {any} state the day now (fractional) */
export const today = (state) => num(state && state.hour) / 24;

// ---------- keys ----------
// The GEAR key a stock key is held as (null: it has no item form, the abstract "ammo").
/** @param {string} k */
export function itemKeyOf(k) {
  if (!SUPPLIES[k]) return null;
  if (GEAR[k] && GEAR[k].count) return k; // rounds (boxes), the bench's brass, powder and primers
  const s = supItemKey(k);
  return GEAR[s] ? s : null;
}
// The stock key an item stands for (null: not a supply).
/** @param {any} it */
export const stockKeyOf = (it) => (!it || !GEAR[it.key] ? null : GEAR[it.key].supKey || (SUPPLIES[it.key] && GEAR[it.key].count ? it.key : null));
/** @param {string} k units of a stock key in one slot */
export function slotCap(k) {
  const g = itemKeyOf(k);
  if (!g) return 0;
  if (ROUND_SUPPLIES[k]) return roundCap({ key: k });
  if (GEAR[g].supKey) return supItemCap(g);
  return Math.max(1, num(GEAR[g].dur)); // a bag of brass: as found
}
// A food item's days of shelf left (null: not a food).
/** @param {any} state @param {any} it */
export function shelfLeft(state, it) {
  const k = stockKeyOf(it);
  if (!k || !FOODS[k]) return null;
  return it.until != null ? it.until - today(state) : newLeft(k, state);
}
/** @param {any} state @param {any} it */
export const spoiled = (state, it) => { const l = shelfLeft(state, it); return l != null && l <= 0; };

// ---------- making them ----------
// n units of a stock key as slot-sized items (rounds as boxes). opts: until / egg for a food.
/** @param {string} k @param {number} n @param {{ until?: number | null, egg?: boolean }} [opts] */
export function supItems(k, n, opts = {}) {
  const g = itemKeyOf(k);
  n = Math.floor(n);
  if (!g || !(n >= 1)) return [];
  if (ROUND_SUPPLIES[k]) return roundItems(k, n, false);
  const cap = slotCap(k), out = [];
  for (let left = n; left > 0; left -= cap) {
    /** @type {any} */
    const it = { key: g, name: GEAR[g].name, quality: 1, dur: Math.min(cap, left) };
    if (opts.until != null) it.until = opts.until;
    if (opts.egg) it.egg = true;
    out.push(it);
  }
  return out;
}
// A food found loose (a raid's container, a body): fresh as its kind is now (no lot behind it).
/** @param {any} state @param {string} k @param {number} n */
export const foundItems = (state, k, n) => supItems(k, n, FOODS[k] ? { until: today(state) + newLeft(k, state) } : {});

// ---------- out of a stock and back ----------
// Takes n whole units of a key out of a holder (a base, a team's cargo: stockOf), as items. Food comes off its oldest
// lots (foods.js takeItem) and keeps their shelf (the soonest of them) and eggs.
/** @param {any} state @param {any} holder @param {string} k @param {number} n */
export function takeOut(state, holder, k, n) {
  const st = stockOf(holder);
  n = Math.min(Math.floor(n), Math.floor(num(st && st[k]) + EPS));
  if (!st || !itemKeyOf(k) || !(n >= 1)) return [];
  if (FOODS[k]) {
    const got = takeItem(holder, k, n, { state });
    const q = Math.round(got.q);
    const clean = got.lots.filter((l) => !l.egg), dirty = got.lots.filter((l) => l.egg);
    const until = (lots) => today(state) + Math.min(...lots.map((l) => num(l.left)));
    const nd = Math.round(dirty.reduce((a, l) => a + l.q, 0));
    return [...supItems(k, q - nd, { until: clean.length ? until(clean) : null }), ...supItems(k, nd, { until: dirty.length ? until(dirty) : null, egg: true })];
  }
  st[k] = num(st[k]) - n;
  if (st[k] < EPS) delete st[k];
  return supItems(k, n);
}
// An item back into a holder's stock (its food a lot with the shelf it has left). Returns the units put back (0 for
// spoiled food: it is thrown out).
/** @param {any} state @param {any} holder @param {any} it */
export function putBack(state, holder, it) {
  const k = stockKeyOf(it);
  const st = stockOf(holder);
  const q = Math.max(0, Math.floor(num(it && it.dur)));
  if (!k || !st || !q) return 0;
  if (FOODS[k]) {
    const left = shelfLeft(state, it);
    if (left != null && left <= 0) return 0;
    return addFood(holder, k, q, { left, egg: !!it.egg, state });
  }
  st[k] = num(st[k]) + q;
  return q;
}
// Every supply item in a storage list back into its holder's stock (a base's armory into its stores, a team's cargo
// into its found supplies). Rounds and the bench's bags are left to ammo.js unbox, as before. Returns units put back.
/** @param {any} state @param {any[]} list @param {any} holder */
export function settleItems(state, list, holder) {
  if (!Array.isArray(list) || !holder) return 0;
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (!isSupItem(list[i])) continue;
    n += putBack(state, holder, list[i]);
    list.splice(i, 1);
  }
  return n;
}

// ---------- onto a person ----------
// How many units of a stock key would fit on a person: onto the stacks of it they have, then free pockets (a small
// one) and pack slots (not a bulky one), and the off hand when `hand` (empty, and it can be held).
/** @param {any} s @param {string} k @param {{ hand?: boolean }} [opt] */
export function roomOn(s, k, { hand = false } = {}) {
  const g = itemKeyOf(k);
  if (!s || !g) return 0;
  ensureInv(s);
  const probe = supItems(k, 1)[0];
  const cap = slotCap(k);
  if (hand) return !s.gear.tool && !fitReason(probe, "tool", s) ? cap : canStack(s.gear.tool, probe) ? roomIn(s.gear.tool) : 0;
  let n = 0;
  for (const list of [s.pockets, rigPouches(s), packOf(s)]) for (const it of list || []) if (it && canStack(it, probe)) n += roomIn(it);
  if (!fitReason(probe, "pocket")) n += s.pockets.filter((x) => !x).length * cap;
  const rp = rigPouches(s), kinds = rp ? pouchesOf(rigOf(s)) || [] : [];
  if (rp && !fitReason(probe, "pocket")) n += rp.filter((x, i) => !x && kinds[i] === "pocket" && !pouchReason(probe, "pocket")).length * cap; // the rig's pockets (stow: once the pockets are full)
  const pk = packOf(s);
  if (pk && !fitReason(probe, "pack")) n += pk.filter((x) => !x).length * cap;
  return n;
}
// Puts items on a person (stacks first, then pockets, the rig's pockets and the pack: inventory.js stow), or into the off hand. Returns
// what did not fit (the caller puts it back where it came from).
/** @param {any} s @param {any[]} items @param {{ hand?: boolean }} [opt] */
export function stowItems(s, items, { hand = false } = {}) {
  ensureInv(s);
  const left = [];
  for (const it of items) {
    if (hand) {
      const cur = s.gear.tool;
      if (cur && canStack(cur, it)) mergeInto(cur, it);
      else if (!cur && !fitReason(it, "tool", s)) { s.gear.tool = it; continue; }
      if (!isSpent(it)) left.push(it);
      continue;
    }
    if (!stow(s, it) && !isSpent(it)) left.push(it);
  }
  return left;
}
// Takes up to n of a key out of a holder's stock onto a person (or into their off hand). Returns the units moved.
/** @param {any} state @param {any} holder @param {string} k @param {number} n @param {any} s @param {{ hand?: boolean }} [opt] */
export function stockToPerson(state, holder, k, n, s, opt = {}) {
  const q = Math.min(Math.floor(n), roomOn(s, k, opt));
  if (!(q >= 1)) return 0;
  const items = takeOut(state, holder, k, q);
  const moved = items.reduce((a, it) => a + num(it.dur), 0);
  const back = stowItems(s, items, opt);
  for (const it of back) putBack(state, holder, it);
  return moved - back.reduce((a, it) => a + num(it.dur), 0);
}
// ---------- supplies onto a named person (2026-10-17 user request: "move loose ammo to survivor pockets and backpack
// when setting up teams or transferring any inventories"; 2026-10-18: "move x loose ammo or any other item in the
// stores into the pockets, rig, pack") ----------
// Wherever supplies change hands (forming a team, Load at a base, giving goods between teams, the inventory window's
// stores) a pick of a stock key that has an item form (itemKeyOf: rounds, water, meds, fuel, a food, parts...) can go
// onto one member as items in a place of theirs: the pockets, the pack or the rig's pouches that take supplies (an
// admin pouch up to ADMIN_KG, a pocket pouch anything small: data-kit.js SUPPLY_POUCHES). Rounds go boxed or loose.
// The target is { sid, where, loose } (teaminv.js loadFromBase, teammeet.js giveGoods, teamform.js formTeam). The
// limits are the inventory's own: the stacks' room (AMMO_STACK, a supply item's stack), free slots, what the place
// takes (a pocket small things, a pack nothing bulky, the pouches their kinds), the admin pouch's weight, the person's
// max load; the team's carry limit is the caller's (what they wear comes off what the team can carry). A refusal says
// why. The round* names are the first day's: the sup* ones are the same functions for any supply.
export const SUP_PLACES = ["pocket", "pack", "rig"];
export const ROUND_PLACES = SUP_PLACES;
export const PLACE_WORDS = { pocket: "pockets", pack: "pack", rig: "rig's pouches" };
const EPSW = 1e-9;
const firstOf = (s) => (s && s.name ? s.name.split(" ")[0] : "They");
const supWord = (k) => (SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : k);
// One unit of a stock key as the item it is held as (rounds in a form), to ask what takes it. null: it has no item form.
/** @param {string} k @param {boolean} [loose] */
export function probeOf(k, loose = false) {
  if (ROUND_SUPPLIES[k] && GEAR[k]) return roundItem(k, 1, loose);
  return supItems(k, 1)[0] || null;
}
// The slots of a place on a person: [{ list, i, kind }] (kind: a rig pouch's kind, null for a pocket or a pack slot).
// The rig's slots are its pouches that take supplies (admin, pocket); with a probe, only those that take that thing
// (pouchReason). null: they have no such place.
/** @param {any} s @param {string} where @param {any} [probe] */
export function placeSlots(s, where, probe = null) {
  ensureInv(s);
  if (where === "pocket") return s.pockets.map((_, i) => ({ list: s.pockets, i, kind: null }));
  if (where === "pack") { const pk = packOf(s); return pk ? pk.map((_, i) => ({ list: pk, i, kind: null })) : null; }
  if (where === "rig") {
    const rp = rigPouches(s), kinds = rp ? pouchesOf(rigOf(s)) || [] : [];
    const out = rp ? rp.map((_, i) => ({ list: rp, i, kind: kinds[i] })).filter((x) => SUPPLY_POUCHES.includes(x.kind) && (!probe || !pouchReason(probe, x.kind))) : null;
    return out && out.length ? out : null;
  }
  return null;
}
// Why a supply cannot go in that place on them at all ("" when it can), before the room is counted. k: the stock key
// (none: only whether they have the place).
/** @param {any} s @param {string} where @param {string | null} [k] @param {boolean} [loose] */
export function placeReason(s, where, k = null, loose = false) {
  if (!SUP_PLACES.includes(where)) return "Supplies go in the pockets, the pack or a rig's admin or pocket pouch.";
  if (where === "pack" && !packOf(s)) return `${firstOf(s)} wears no pack.`;
  if (where === "rig" && !rigOf(s)) return `${firstOf(s)} wears no rig.`;
  if (where === "rig" && !placeSlots(s, "rig")) return `${firstOf(s)}'s ${rigOf(s).name} has no admin or pocket pouch (the pouches that take supplies).`;
  if (k == null) return "";
  const probe = probeOf(k, loose);
  if (!probe) return `The ${supWord(k)} is not something to hold: it goes to the team's supplies.`;
  if (where === "pocket" || where === "pack") return fitReason(probe, where);
  if (where === "rig" && !placeSlots(s, "rig", probe)) return `No pouch of ${firstOf(s)}'s ${rigOf(s).name} takes the ${supWord(k)}${isSmall(probe.key) ? ` (its admin pouch${placeSlots(s, "rig").some((x) => x.kind === "admin") ? "" : "es"} take up to ${ADMIN_KG} kg)` : ": it is too big for a pocket"}.`;
  return "";
}
// Units of a key, in a form, a pouch takes on top of `have` kg (an admin pouch: ADMIN_KG; a pocket pouch: the stack),
// never more than the form's stack.
const pouchCap = (slot, perKg, cap, have = 0) => (slot.kind !== "admin" || !(perKg > 0) ? cap : Math.max(0, Math.min(cap, Math.floor((ADMIN_KG - have + EPSW) / perKg))));
// How many units of a key, in a form, fit in a place on a person now: onto their stacks of it there (the same form),
// then free slots (an admin pouch as far as ADMIN_KG goes), and never past their max load. { n, why }: why says what
// stops it when n is 0 (no such place, the thing does not go there, no room, over their max load).
/** @param {any} s @param {string} k @param {string} where @param {boolean} [loose] */
export function supRoom(s, k, where, loose = false) {
  if (!s || !itemKeyOf(k)) return { n: 0, why: `The ${supWord(k)} is not something to hold.` };
  const why = placeReason(s, where, k, loose);
  if (why) return { n: 0, why };
  const probe = probeOf(k, loose);
  const perKg = itemLoad(probe);
  const cap = roundCap(probe);
  let n = 0;
  for (const slot of placeSlots(s, where, probe) || []) {
    const it = slot.list[slot.i];
    if (!it) { n += pouchCap(slot, perKg, cap); continue; }
    if (canStack(it, probe)) n += Math.min(roomIn(it), pouchCap(slot, perKg, cap, itemLoad(it)));
  }
  if (!n) return { n: 0, why: `No room in ${firstOf(s)}'s ${PLACE_WORDS[where]} for the ${supWord(k)}.` };
  const byLoad = perKg > 0 ? Math.max(0, Math.floor((maxLoad(s) - wornLoad(s) + EPSW) / perKg)) : n;
  if (!byLoad) return { n: 0, why: `Too heavy for ${firstOf(s)}: ${firstOf(s)} wears ${Math.round(wornLoad(s) * 10) / 10} of ${maxLoad(s)} kg.` };
  return { n: Math.min(n, byLoad), why: "" };
}
export const roundRoom = supRoom;
// A part of a count stack as an item of its own (rounds keep their form, a food its shelf and eggs).
const pieceOf = (it, q) => { const out = { ...it, dur: q }; delete out.loaded; return out; };
// Puts supply items (count stacks: rounds in a form, supply items) into a place on a person: their stacks of it there
// first (the same form), then free slots (an admin pouch as far as its weight goes, the rest in the next). Returns the
// items (or parts) that found no room.
/** @param {any} s @param {any[]} items @param {string} where */
export function placeSupplies(s, items, where) {
  const left = [];
  for (const it of items) {
    const one = pieceOf(it, 1); // what takes one of it (an admin pouch asks the weight of a unit, not of the stack)
    const slots = placeSlots(s, where, one) || [];
    const perKg = itemLoad(one), cap = roundCap(it);
    for (const slot of slots) { // onto the stacks of it there
      if (isSpent(it)) break;
      const cur = slot.list[slot.i];
      if (!cur || !canStack(cur, it)) continue;
      const q = Math.min(amountOf(it), Math.min(roomIn(cur), pouchCap(slot, perKg, cap, itemLoad(cur))));
      if (q > 0) { mergeInto(cur, pieceOf(it, q)); it.dur = amountOf(it) - q; }
    }
    let placed = false;
    for (const slot of slots) { // then free slots
      if (isSpent(it)) break;
      if (slot.list[slot.i]) continue;
      const q = pouchCap(slot, perKg, cap);
      if (q < 1) continue;
      if (amountOf(it) <= q) { slot.list[slot.i] = it; placed = true; break; }
      slot.list[slot.i] = pieceOf(it, q);
      it.dur = amountOf(it) - q;
    }
    if (!placed && !isSpent(it)) left.push(it);
  }
  return left;
}
/** @param {any} s @param {any[]} items @param {string} where the rounds that found no room (the first day's name) */
export const placeRounds = (s, items, where) => placeSupplies(s, items, where).reduce((a, it) => a + amountOf(it), 0);
// Up to n units of a key out of stock holders (a base, a team's packed supplies or its cargo, or bare { key: n }
// records; drawn in order) onto a person, in a place, in a form (rounds loose or boxed). Food comes off its oldest lots
// with the shelf it has left (takeOut). The caller caps n by what its team can carry. Returns { moved, why } (why: the
// refusal when nothing moved, or what cut it short).
/** @param {any} state @param {any[]} holders @param {string} k @param {number} n @param {any} s @param {{ where: string, loose?: boolean }} opt */
export function suppliesOnto(state, holders, k, n, s, { where, loose = false }) {
  const have = holders.reduce((a, h) => { const st = stockOf(h); return a + Math.max(0, Math.floor(num(st && st[k]) + EPS)); }, 0);
  const want = Math.min(Math.floor(n), have);
  if (!(want >= 1)) return { moved: 0, why: `No ${supWord(k)} to take.` };
  const room = supRoom(s, k, where, loose);
  const q = Math.min(want, room.n);
  if (!(q >= 1)) return { moved: 0, why: room.why };
  const items = [];
  let left = q, last = holders[0];
  for (const h of holders) { // the first holder first (a team's found cargo before its packed supplies)
    const st = stockOf(h);
    const take = Math.min(left, Math.max(0, Math.floor(num(st && st[k]) + EPS)));
    if (!(take > 0)) continue;
    last = h;
    const got = takeOut(state, h, k, take);
    if (ROUND_SUPPLIES[k] && loose) items.push(...roundItems(k, got.reduce((a, it) => a + amountOf(it), 0), true)); // out of the stores as loose handfuls
    else items.push(...got);
    left -= take;
    if (!left) break;
  }
  const back = placeSupplies(s, items, where);
  for (const it of back) putBack(state, last, it); // (the room was counted: nothing should come back)
  const moved = q - back.reduce((a, it) => a + amountOf(it), 0);
  return { moved, why: moved < want ? `Only ${moved} of the ${want} ${supWord(k)} fit in ${firstOf(s)}'s ${PLACE_WORDS[where]}.` : "" };
}
/** @param {Record<string, number>[]} pools @param {string} k @param {number} n @param {any} s @param {{ where: string, loose?: boolean }} opt rounds out of bare stock records (the first day's name) */
export const roundsOnto = (pools, k, n, s, opt) => suppliesOnto(null, pools, k, n, s, opt);
// A transfer's target ({ sid, where, loose }, a bare survivor id, or "cargo" / null): { sid, where, loose } with where
// null for "onto them the usual way" (items by stow, supplies into the pool), or null for the cargo.
/** @param {any} target */
export function parseTarget(target) {
  if (target && typeof target === "object") return { sid: Number(target.sid), where: SUP_PLACES.includes(target.where) ? target.where : null, loose: !!target.loose };
  if (target === "cargo" || target == null) return null;
  return { sid: Number(target), where: null, loose: false };
}
// The units of a key a person holds in a place (the Team forming window's "Carried" column): rounds in a form, a
// supply's items.
/** @param {any} s @param {string} k @param {string} where @param {boolean} [loose] */
export function suppliesHeld(s, k, where, loose = false) {
  let n = 0;
  for (const { list, i } of placeSlots(s, where) || []) { const it = list[i]; if (it && stockKeyOf(it) === k && (!isRoundItem(it) || !!it.loose === !!loose)) n += amountOf(it); }
  return n;
}
export const roundsHeld = suppliesHeld;

// Is this a thing held as a supply: rounds in any form, a bench's bag, a supply item.
/** @param {any} it */
export const isHeldSupply = (it) => isSupItem(it) || isRoundItem(it);
// A person home with a team (parties.js unloadAt): the supply items on them (pockets, rig pouches, the pack, the off
// hand, a bag in the arms) are unpacked into the base's stores, as the team's cargo is. Rounds stay on them (their
// boxes are their own kit, as before). Returns the units put back.
// keep(it): true leaves that one on them (loans.js: what someone on loan came with is theirs).
/** @param {any} state @param {any} s @param {any} holder @param {{ keep?: (it: any) => boolean }} [opts] */
export function unpackPerson(state, s, holder, opts = {}) {
  if (!s || !s.gear || !holder) return 0;
  ensureInv(s);
  let n = 0;
  const out = (it) => isSupItem(it) && !(opts.keep && opts.keep(it));
  const lists = [s.pockets, rigPouches(s), packOf(s), s.gear.carry && Array.isArray(s.gear.carry.contents) ? s.gear.carry.contents : null];
  for (const list of lists) (list || []).forEach((it, i) => { if (out(it)) { n += putBack(state, holder, it); list[i] = null; } });
  if (out(s.gear.tool)) { n += putBack(state, holder, s.gear.tool); s.gear.tool = null; }
  return n;
}

// ---------- the bodies after a battle ----------
// A body's supply stack onto a person there (the loot window's "pockets and pack" / "off hand"): found items (rounds
// loose, food fresh), as far as their slots have room and, on a team, the team's load allows. Returns the message.
/** @param {any} state @param {number} bi @param {string} k @param {number} want @param {any} s @param {{ hand?: boolean }} [opt] */
export function bodyToPerson(state, bi, k, want, s, opt = {}) {
  const b = state.combat;
  const body = battleBodies(state)[bi];
  const have = body && body.supplies ? Math.floor(num(body.supplies[k])) : 0;
  if (!have || !s) return "Nothing there.";
  const name = SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : k;
  if (!itemKeyOf(k)) return `The ${name} is not something to hold: it goes to the team's cargo.`;
  let n = Math.min(have, Number.isFinite(want) ? Math.max(1, Math.floor(want)) : have, roomOn(s, k, opt));
  if (n < 1) return opt.hand ? `${s.name.split(" ")[0]}'s off hand is full.` : `No room in ${s.name.split(" ")[0]}'s pockets or pack for the ${name}.`;
  const st = storageFor(state, battlePlace(b));
  if (st && st.o === "cargo") n = Math.min(n, unitsThatFit(cargoRoom(state, st.party), k)); // the team carries it either way
  if (n < 1) return `Too heavy: the team cannot carry the ${name} as well.`;
  const items = ROUND_SUPPLIES[k] ? roundItems(k, n, true) : foundItems(state, k, n);
  const back = stowItems(s, items, opt).reduce((a, it) => a + num(it.dur), 0);
  const got = n - back;
  if (got < 1) return `No room for the ${name}.`;
  body.supplies[k] -= got;
  if (body.supplies[k] <= 0) delete body.supplies[k];
  if (b && b.result) b.result.loot.supplies[k] = (b.result.loot.supplies[k] || 0) + got;
  return `${got} ${name} → ${s.name.split(" ")[0]}'s ${opt.hand ? "off hand" : "pockets and pack"}${got < have ? ` (${have - got} left)` : ""}.`;
}
