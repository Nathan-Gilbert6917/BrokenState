// @ts-check
// Stacks in one inventory slot (2026-10-10, user requests and decisions; the numbers are data-stacks.js):
//   - consumables (data-stacks.js STACK_MAX: smokes, treats, batteries, bottles…): item.n of the same thing in one slot
//     (none or 1: a single). Throwables and anything that wears down never stack. A stack weighs and is worth n of it,
//     is used one at a time (useOne) and splits (splitOff);
//   - rounds (an item of a round key, data-ammo.js AMMO_GEAR: a count stack, item.dur = its rounds): loose (item.loose:
//     up to AMMO_STACK.LOOSE rounds of one type) or boxed (up to AMMO_STACK.BOXES boxes of one kind: boxesIn). A boxed
//     stack opens into loose rounds (openRounds); loose rounds are never packed back into boxes;
//   - bulk containers (data-stacks.js BULK: an ammo can, a carton, a bag): item.loads, loose round items inside it
//     (one key, one calibre or any), up to its cap; a handful (up to LOOSE) comes out at a time (takeOut).
// Same thing, same form: two stacks of it merge up to the slot's limit (mergeInto: a stow, a move onto it, a find
// picked up). Everything here is plain: inventory.js weighs (stackKg), valuation.js prices (n and the rounds), the
// tools and the UI name (stackLabel). Old saves need nothing: no n is one, no loose flag is boxed, and a box's rounds
// over its size are the boxes they fill (migrateStacks only tidies).
import { GEAR, SUPPLIES } from "./data.js";
import { ROUND_SUPPLIES, CALIBERS } from "./data-ammo.js";
import { STACK_MAX, AMMO_STACK, BULK } from "./data-stacks.js";

const num = (v) => (Number.isFinite(v) ? v : 0);

// ---------- what stacks ----------
/** @param {string} key @returns {number} the most of it in one slot (1: it does not stack) */
export function stackMax(key) {
  const d = GEAR[key];
  if (!d || !STACK_MAX[key] || d.throw || d.dur || d.count || d.slots || d.pouches) return 1;
  return Math.max(1, Math.floor(STACK_MAX[key]));
}
export const isStackable = (key) => stackMax(key) > 1;
/** @param {any} it how many there are in it (consumables; 1 for anything else) */
export const countOf = (it) => (it && num(it.n) > 1 ? Math.floor(it.n) : 1);
/** @param {any} it an item of a round key (a box, a stack of boxes, loose rounds) */
export const isRoundItem = (it) => !!(it && ROUND_SUPPLIES[it.key] && GEAR[it.key] && GEAR[it.key].count);
/** @param {any} it a bulk ammo container */
export const isBulk = (it) => !!(it && BULK[it.key]);
/** @param {string} key a box's rounds (data-ammo.js: typical US retail counts) */
export const boxSize = (key) => Math.max(1, num(GEAR[key] && GEAR[key].dur) || 1);
/** @param {any} it */
export const roundsInItem = (it) => (isRoundItem(it) ? Math.max(0, Math.floor(num(it.dur))) : isBulk(it) ? bulkRounds(it) : 0);
/** @param {any} it the boxes in a boxed stack (0 for loose rounds) */
export const boxesIn = (it) => (isRoundItem(it) && !it.loose ? Math.max(1, Math.ceil(Math.max(0, num(it.dur)) / boxSize(it.key))) : 0);
/** @param {any} it the most rounds this slot's stack can hold in its form */
export const roundCap = (it) => (it && it.loose ? AMMO_STACK.LOOSE : AMMO_STACK.BOXES * boxSize(it.key));

// ---------- making them ----------
/** @param {string} key @param {number} n @param {boolean} [loose] */
export function roundItem(key, n, loose = false) {
  const d = GEAR[key];
  if (!d) return null;
  /** @type {any} */
  const it = { key, name: d.name, quality: 1, dur: Math.max(1, Math.floor(n)) };
  if (loose) it.loose = true;
  return it;
}
// n rounds of a key as slot-sized items of a form: loose handfuls of up to LOOSE, or stacks of up to BOXES boxes.
/** @param {string} key @param {number} n @param {boolean} [loose] */
export function roundItems(key, n, loose = false) {
  const out = [];
  let left = Math.floor(n);
  const cap = loose ? AMMO_STACK.LOOSE : AMMO_STACK.BOXES * boxSize(key);
  while (left > 0 && GEAR[key]) { const q = Math.min(cap, left); out.push(roundItem(key, q, loose)); left -= q; }
  return out;
}
// A consumable stack of n (n within its limit).
/** @param {any} it a fresh item @param {number} n */
export function withCount(it, n) {
  const m = Math.max(1, Math.min(stackMax(it.key), Math.floor(n)));
  if (m > 1) it.n = m; else delete it.n;
  return it;
}

// ---------- merging, splitting, using ----------
// Do these two stack (the same thing, the same form, both plain)?
/** @param {any} a @param {any} b */
export function canStack(a, b) {
  if (!a || !b || a === b || a.key !== b.key) return false;
  if (isRoundItem(a)) return !!a.loose === !!b.loose && !a.loaded && !b.loaded;
  if (!isStackable(a.key)) return false;
  return !a.mods && !b.mods && !a.contents && !b.contents && (a.quality ?? 1) === (b.quality ?? 1);
}
// Room left in a stack (rounds or things).
/** @param {any} it */
export const roomIn = (it) => (isRoundItem(it) ? Math.max(0, roundCap(it) - Math.max(0, Math.floor(num(it.dur)))) : Math.max(0, stackMax(it.key) - countOf(it)));
/** @param {any} it how much is in it (rounds or things) */
export const amountOf = (it) => (isRoundItem(it) ? Math.max(0, Math.floor(num(it.dur))) : countOf(it));
// Moves as much of src into dst as fits. Returns how much moved (0: they do not stack or dst is full); src keeps the rest.
/** @param {any} dst @param {any} src */
export function mergeInto(dst, src) {
  if (!canStack(dst, src)) return 0;
  const q = Math.min(roomIn(dst), amountOf(src));
  if (!(q > 0)) return 0;
  if (isRoundItem(dst)) { dst.dur = Math.floor(num(dst.dur)) + q; src.dur = Math.floor(num(src.dur)) - q; return q; }
  withCount(dst, countOf(dst) + q);
  const left = countOf(src) - q;
  if (left > 1) src.n = left; else if (left === 1) delete src.n; else src.n = 0;
  return q;
}
/** @param {any} it is anything left in it after a merge */
export const isSpent = (it) => (isRoundItem(it) ? !(num(it.dur) >= 1) : num(it.n) === 0 && "n" in it);
// Takes k off a stack as a new item of its own (rounds keep their form); null when there is not more than k in it
// (the whole stack is the thing to move).
/** @param {any} it @param {number} k */
export function splitOff(it, k) {
  k = Math.floor(k);
  const have = amountOf(it);
  if (!(k >= 1) || k >= have) return null;
  if (isRoundItem(it)) { it.dur = have - k; const out = { ...it, dur: k }; delete out.loaded; return out; }
  const out = { ...it };
  withCount(out, k);
  withCount(it, have - k);
  return out;
}
// Half of a stack (rounded up: the moved part), or null.
/** @param {any} it */
export const splitHalf = (it) => splitOff(it, Math.ceil(amountOf(it) / 2));
// One used: a stack of several is one less (true: the item stays where it is); a single is gone (false: the caller
// takes it away).
/** @param {any} it */
export function useOne(it) {
  if (!it || countOf(it) <= 1) return false;
  withCount(it, countOf(it) - 1);
  return true;
}
// Takes one of the item at list[i] (an armory, a cargo, a pocket list): one off a stack, else the item. Returns the
// one taken (a single of it), or null.
/** @param {any[]} list @param {number} i @param {boolean} [slots] a list of slots (pockets, a pack): the slot emptied, not cut out */
export function takeOneAt(list, i, slots = false) {
  const it = list && list[i];
  if (!it) return null;
  if (useOne(it)) { const one = { ...it }; delete one.n; return one; }
  if (slots) list[i] = null; else list.splice(i, 1);
  return it;
}
// Things of a key in a list, stacks counted by what is in them.
/** @param {any[]} list @param {string} key */
export const countKey = (list, key) => (list || []).reduce((a, it) => a + (it && it.key === key ? countOf(it) : 0), 0);
// A loose handful out of a boxed stack: the boxes opened (all of it, or up to LOOSE). Returns the loose item, or null.
/** @param {any} it a boxed stack */
export function openRounds(it) {
  if (!isRoundItem(it) || it.loose) return null;
  const have = Math.floor(num(it.dur));
  const q = Math.min(have, AMMO_STACK.LOOSE);
  if (!(q >= 1)) return null;
  it.dur = have - q;
  return roundItem(it.key, q, true);
}

// ---------- bulk containers ----------
/** @param {any} it */
export const loadsOf = (it) => (isBulk(it) ? (Array.isArray(it.loads) ? it.loads : (it.loads = [])) : []);
/** @param {any} it */
export function bulkRounds(it) {
  let n = 0;
  for (const l of loadsOf(it)) if (l) n += Math.max(0, Math.floor(num(l.dur)));
  return n;
}
// Why n rounds of key cannot go in this container ("" when they can: its kind, its room).
/** @param {any} it @param {string} key @param {number} [n] */
export function bulkReason(it, key, n = 1) {
  const B = isBulk(it) ? BULK[it.key] : null;
  if (!B) return "Not an ammo container.";
  if (!ROUND_SUPPLIES[key]) return "Only rounds go in it.";
  const loads = loadsOf(it).filter((l) => l && num(l.dur) >= 1);
  if (B.one === "key" && loads.some((l) => l.key !== key)) return `The ${it.name} holds one kind of round (${loads[0].name}).`;
  if (B.one === "cal" && loads.some((l) => ROUND_SUPPLIES[l.key].round.cal !== ROUND_SUPPLIES[key].round.cal)) return `The ${it.name} holds one calibre (${CALIBERS[ROUND_SUPPLIES[loads[0].key].round.cal].name}).`;
  if (bulkRounds(it) + n > B.cap) return `The ${it.name} holds ${B.cap} rounds.`;
  return "";
}
// Puts up to n rounds of a key in a container (its kind and room allowing). Returns how many went in.
/** @param {any} it @param {string} key @param {number} n */
export function fillBulk(it, key, n) {
  const B = isBulk(it) ? BULK[it.key] : null;
  if (!B || !ROUND_SUPPLIES[key] || bulkReason(it, key, 1)) return 0;
  const q = Math.max(0, Math.min(Math.floor(n), B.cap - bulkRounds(it)));
  if (!q) return 0;
  const l = loadsOf(it).find((x) => x && x.key === key);
  if (l) l.dur = Math.floor(num(l.dur)) + q; else loadsOf(it).push(roundItem(key, q, true));
  return q;
}
// A new container (empty, or with { key: n } in it).
/** @param {string} kind ammocan | ammocarton | ammobag @param {Record<string, number>} [rounds] */
export function newBulk(kind, rounds = {}) {
  const d = GEAR[kind];
  if (!d || !BULK[kind]) return null;
  const it = { key: kind, name: d.name, quality: 1, loads: [] };
  for (const [k, q] of Object.entries(rounds)) fillBulk(it, k, q);
  return it;
}
// A loose handful (up to LOOSE) out of a container: of key, else of its first load. Returns the item, or null.
/** @param {any} it @param {string | null} [key] */
export function takeOut(it, key = null) {
  const loads = loadsOf(it);
  const l = loads.find((x) => x && num(x.dur) >= 1 && (!key || x.key === key));
  if (!l) return null;
  const q = Math.min(Math.floor(num(l.dur)), AMMO_STACK.LOOSE);
  l.dur = Math.floor(num(l.dur)) - q;
  sweepLoads(it);
  return roundItem(l.key, q, true);
}
// Empty loads gone (after a fight drew on them).
/** @param {any} it */
export function sweepLoads(it) {
  if (isBulk(it) && Array.isArray(it.loads)) it.loads = it.loads.filter((l) => l && num(l.dur) >= 1);
}
// The rounds in a container as a record ({ key: n }).
/** @param {any} it */
export function bulkRecord(it) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const l of loadsOf(it)) if (l && num(l.dur) >= 1) out[l.key] = (out[l.key] || 0) + Math.floor(l.dur);
  return out;
}

// ---------- weight, worth, words ----------
// What a stack weighs (kg), or null when it is a plain item (inventory.js itemKg weighs those): loose rounds by the
// round, a container empty and its rounds, a consumable n times.
/** @param {any} it @param {number} one the item's own weight (one of it; a box stack: its count-share weight) */
export function stackKg(it, one) {
  if (!it) return one;
  if (isBulk(it)) return num(GEAR[it.key].weight) + loadsOf(it).reduce((a, l) => a + (l ? Math.max(0, num(l.dur)) * num(SUPPLIES[l.key] && SUPPLIES[l.key].weight) : 0), 0);
  if (isRoundItem(it) && it.loose) return Math.max(0, num(it.dur)) * num(SUPPLIES[it.key] && SUPPLIES[it.key].weight);
  return one * countOf(it);
}
// "Chocolate ×3", "9mm FMJ · 3 boxes (140)", "9mm FMJ · 60 loose", "Ammo can · 9mm FMJ 420".
/** @param {any} it */
export function stackLabel(it) {
  if (!it) return "";
  if (isBulk(it)) {
    const rec = bulkRecord(it), keys = Object.keys(rec);
    return keys.length ? `${it.name} · ${keys.length === 1 ? `${SUPPLIES[keys[0]] ? SUPPLIES[keys[0]].name : keys[0]} ${rec[keys[0]]}` : `${bulkRounds(it)} rounds, ${keys.length} kinds`}` : `${it.name} (empty)`;
  }
  if (isRoundItem(it)) {
    const n = Math.max(0, Math.floor(num(it.dur)));
    if (it.loose) return `${it.name} · ${n} loose`;
    const b = boxesIn(it);
    return b > 1 ? `${it.name} · ${b} boxes (${n})` : it.name;
  }
  return countOf(it) > 1 ? `${it.name} ×${countOf(it)}` : it.name;
}

// ---------- saves ----------
// Tidies stacks in a list of items (old saves need nothing: this only drops spent stacks and bad counts).
/** @param {any[]} list */
export function tidyList(list) {
  if (!Array.isArray(list)) return;
  for (const it of list) {
    if (!it) continue;
    if ("n" in it && !(num(it.n) > 1)) delete it.n;
    if (it.n > 1 && !isStackable(it.key)) delete it.n; // a key that no longer stacks: one of it (the rest was never real)
    if (isBulk(it)) sweepLoads(it);
  }
}
