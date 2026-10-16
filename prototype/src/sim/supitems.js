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
import { isSupItem, isRoundItem, roundItems, supItemCap, roundCap, canStack, roomIn, mergeInto, isSpent } from "./itemstack.js";
import { ensureInv, packOf, rigPouches, fitReason, stow, battleBodies, storageFor, battlePlace } from "./inventory.js"; // call-time only: safe in the import cycle
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
  const pk = packOf(s);
  if (pk && !fitReason(probe, "pack")) n += pk.filter((x) => !x).length * cap;
  return n;
}
// Puts items on a person (stacks first, then pockets and the pack: inventory.js stow), or into the off hand. Returns
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
// Is this a thing held as a supply: rounds in any form, a bench's bag, a supply item.
/** @param {any} it */
export const isHeldSupply = (it) => isSupItem(it) || isRoundItem(it);
// A person home with a team (parties.js unloadAt): the supply items on them (pockets, rig pouches, the pack, the off
// hand, a bag in the arms) are unpacked into the base's stores, as the team's cargo is. Rounds stay on them (their
// boxes are their own kit, as before). Returns the units put back.
/** @param {any} state @param {any} s @param {any} holder */
export function unpackPerson(state, s, holder) {
  if (!s || !s.gear || !holder) return 0;
  ensureInv(s);
  let n = 0;
  const lists = [s.pockets, rigPouches(s), packOf(s), s.gear.carry && Array.isArray(s.gear.carry.contents) ? s.gear.carry.contents : null];
  for (const list of lists) (list || []).forEach((it, i) => { if (isSupItem(it)) { n += putBack(state, holder, it); list[i] = null; } });
  if (isSupItem(s.gear.tool)) { n += putBack(state, holder, s.gear.tool); s.gear.tool = null; }
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
