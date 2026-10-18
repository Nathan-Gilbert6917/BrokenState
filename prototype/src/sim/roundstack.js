// @ts-check
// Rounds as a stack (2026-10-18 user request: "track these in a stack and you can choose what the ordering of ammo can
// be and how much of each type goes in to determine effectiveness based on the bullet in the chamber"; "magazines can
// hold an assortment of different types of ammo … each magazine should keep track of the stack").
//
// A stack is an array of runs [{ k, n }] in FIRING ORDER: stack[0] is the run in the chamber (the next round fired),
// the last run is the bottom of the magazine (the last to fire). k is a round's supply key (data-ammo.js
// a_<calibre>_<type>, or a handload's a_…_hand); n how many of it lie together. Adjacent runs of one key are merged.
// Who holds a stack:
//   - a battle unit's gun: u.stack (combat.js / mags.js: the physical rounds in the gun; u.mag counts them, u.load is
//     the chamber's load);
//   - a magazine item in a fight: item.stack (mags.js: the rounds in it; a swap moves them into the gun);
//   - a gun put down in a fight: item.loaded.stack (gunload.js: with the old { n, key } beside it).
// Plain helpers only: nothing here knows a gun or a unit.
import { ROUND_SUPPLIES } from "./data-ammo.js";
import { loadId, roundName } from "./rounds.js";

const num = (v) => (Number.isFinite(v) ? v : 0);
const whole = (n) => Math.max(0, Math.floor(num(n)));

/** @param {any} st rounds in a stack (0 for anything that is not one) */
export const stackN = (st) => (Array.isArray(st) ? st.reduce((a, r) => a + whole(r && r.n), 0) : 0);
/** @param {any} st the key in the chamber, or null */
export const topKey = (st) => (Array.isArray(st) && st.length ? st[0].k : null);
/** @param {any} st a copy (each run its own object) */
export const copyStack = (st) => (Array.isArray(st) ? st.filter((r) => r && whole(r.n) > 0).map((r) => ({ k: r.k, n: whole(r.n) })) : []);
// Drops empty runs and merges neighbours of one key, in place. Returns the stack.
/** @param {any[]} st */
export function tidyStack(st) {
  if (!Array.isArray(st)) return st;
  let i = 0;
  while (i < st.length) {
    const r = st[i];
    if (!r || !(whole(r.n) > 0)) { st.splice(i, 1); continue; }
    r.n = whole(r.n);
    if (i > 0 && st[i - 1].k === r.k) { st[i - 1].n += r.n; st.splice(i, 1); continue; }
    i++;
  }
  return st;
}
// n rounds of k on top (the chamber end: the next to fire). Returns the stack.
/** @param {any[]} st @param {string} k @param {number} n */
export function pushTop(st, k, n) {
  n = whole(n);
  if (!(n > 0) || !k) return st;
  if (st.length && st[0].k === k) st[0].n += n; else st.unshift({ k, n });
  return st;
}
// n rounds of k at the bottom (the last to fire: a magazine filled at the start, one round after another).
/** @param {any[]} st @param {string} k @param {number} n */
export function pushBottom(st, k, n) {
  n = whole(n);
  if (!(n > 0) || !k) return st;
  const last = st[st.length - 1];
  if (last && last.k === k) last.n += n; else st.push({ k, n });
  return st;
}
// Takes up to n rounds off the top (fired, or unloaded). Returns the runs taken, in the order they came off.
/** @param {any[]} st @param {number} n @returns {{ k: string, n: number }[]} */
export function takeTop(st, n) {
  const out = [];
  let left = whole(n);
  while (left > 0 && st.length) {
    const r = st[0];
    const q = Math.min(left, whole(r.n));
    if (q > 0) { out.push({ k: r.k, n: q }); r.n = whole(r.n) - q; left -= q; }
    if (!(r.n > 0)) st.shift();
  }
  return out;
}
// Takes up to n rounds off the bottom (a magazine over its capacity trimmed). Returns the runs taken.
/** @param {any[]} st @param {number} n */
export function takeBottom(st, n) {
  const out = [];
  let left = whole(n);
  while (left > 0 && st.length) {
    const r = st[st.length - 1];
    const q = Math.min(left, whole(r.n));
    if (q > 0) { out.push({ k: r.k, n: q }); r.n = whole(r.n) - q; left -= q; }
    if (!(r.n > 0)) st.pop();
  }
  return out;
}
// Rounds of one key (or of several) in a stack.
/** @param {any} st @param {string | string[]} keys */
export const stackOf = (st, keys) => { const ks = Array.isArray(keys) ? keys : [keys]; return Array.isArray(st) ? st.reduce((a, r) => a + (r && ks.includes(r.k) ? whole(r.n) : 0), 0) : 0; };
// The stack as a record { key: n }.
/** @param {any} st */
export function stackRecord(st) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const r of Array.isArray(st) ? st : []) if (r && whole(r.n) > 0) out[r.k] = num(out[r.k]) + whole(r.n);
  return out;
}
// The round a key is, as a load for a holder of calibre `home` (rounds.js loads: "fmj", "223:sp"), or null.
/** @param {string} home @param {string | null | undefined} k */
export function loadOfKey(home, k) {
  const r = k && ROUND_SUPPLIES[k] ? ROUND_SUPPLIES[k].round : null;
  return r ? loadId(home, r.cal, r.type) : null;
}
// The stack in words, the chamber first: "12 ga slug ×2, 12 ga buckshot ×4" ("" for an empty one). short: the types
// only ("slug ×2, buckshot ×4").
/** @param {string} home @param {any} st @param {{ short?: boolean, names?: Record<string, string> } | null} [opts] */
export function stackText(home, st, opts = null) {
  const runs = copyStack(st);
  if (!runs.length) return "";
  const name = (k) => {
    const r = ROUND_SUPPLIES[k] && ROUND_SUPPLIES[k].round;
    if (!r) return k;
    const full = roundName(r.cal, r.type) + (r.hand ? " (handload)" : "");
    if (!(opts && opts.short)) return full;
    const names = (opts && opts.names) || {};
    return (names[r.type] || full.replace(`${roundName(r.cal, null).split(" ")[0]} `, "")) + (r.hand ? " (hand)" : "");
  };
  return runs.map((r) => `${name(r.k)} ×${r.n}`).join(", ");
}
// Keeps a unit's magazine counters true to its stack: u.mag is the rounds in the gun, u.load the chamber's load (the
// last load stays when the gun is empty, so the Reload button and the AI know what it shot).
/** @param {any} u @param {string | null} cal */
export function syncGun(u, cal) {
  if (!u || !Array.isArray(u.stack)) return;
  tidyStack(u.stack);
  u.mag = stackN(u.stack);
  if (cal && u.stack.length) { const l = loadOfKey(cal, u.stack[0].k); if (l) u.load = l; }
}
