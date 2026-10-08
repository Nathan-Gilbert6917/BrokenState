// @ts-check
// Rounds in stock records: the plain half of the ammo API (ammo.js re-exports all of it). Imports only the data
// modules, so the low-level helpers (water.js stockHas / useStock / takeStock) can use it without an import cycle.
import { CALIBERS, AMMO_TYPES, ammoKey, ROUND_SUPPLIES } from "./data-ammo.js";
import { SUPPLIES } from "./data.js";

// ---------- keys ----------
/** every round supply key (a_<cal>_<type>) */
export const ROUND_KEYS = Object.keys(ROUND_SUPPLIES);
/** @param {string} k */
export const isRoundKey = (k) => !!ROUND_SUPPLIES[k];
/** @param {string} k @returns {{ cal: string, type: string } | null} */
export const roundOf = (k) => (ROUND_SUPPLIES[k] ? ROUND_SUPPLIES[k].round : null);
/** @param {string} cal */
export const baseType = (cal) => (CALIBERS[cal] ? CALIBERS[cal].base : "fmj");
/** @param {string} cal */
export const baseKey = (cal) => ammoKey(cal, baseType(cal));
// A type this calibre has (else its common round).
/** @param {string} cal @param {string | null | undefined} type */
export const typeFor = (cal, type) => (type && CALIBERS[cal] && CALIBERS[cal].types.includes(type) ? type : baseType(cal));
/** @param {string} cal @param {string | null | undefined} [type] */
export const keyFor = (cal, type) => ammoKey(cal, typeFor(cal, type));
/** @param {string} cal "12 gauge" */
export const calName = (cal) => (CALIBERS[cal] ? CALIBERS[cal].name : cal);
/** @param {string} cal @param {string | null | undefined} [type] "9mm hollow point" */
export const roundName = (cal, type) => `${CALIBERS[cal] ? CALIBERS[cal].name : cal} ${(AMMO_TYPES[typeFor(cal, type)] || {}).name || ""}`.trim();
/** @param {string | null | undefined} type "hollow point" */
export const typeName = (type) => (type && AMMO_TYPES[type] ? AMMO_TYPES[type].name : "");
// The types a calibre has, its common round first.
/** @param {string} cal */
export const typesOf = (cal) => (CALIBERS[cal] ? [CALIBERS[cal].base, ...CALIBERS[cal].types.filter((t) => t !== CALIBERS[cal].base)] : []);
// A type's effects (data-ammo.js AMMO_TYPES), {} for a common round or none.
/** @param {string | null | undefined} type */
export const typeFx = (type) => (type && AMMO_TYPES[type]) || {};

// ---------- stock records ----------
const num = (v) => (Number.isFinite(v) ? v : 0);
// Rounds of a calibre (any type; or of one type) in a stock record; with no calibre, every round. Generic ammo is not
// counted here (totalRounds counts it).
/** @param {Record<string, number> | null | undefined} rec @param {string | null} [cal] @param {string | null} [type] */
export function roundsIn(rec, cal = null, type = null) {
  if (!rec) return 0;
  if (cal && type) return Math.max(0, Math.floor(num(rec[keyFor(cal, type)])));
  let n = 0;
  for (const k of ROUND_KEYS) {
    const q = rec[k];
    if (!(q > 0)) continue;
    if (cal && ROUND_SUPPLIES[k].round.cal !== cal) continue;
    n += Math.floor(q);
  }
  return n;
}
// Every round in a record, generic ammo included (a figure the old "stock.ammo" reads become).
/** @param {Record<string, number> | null | undefined} rec */
export const totalRounds = (rec) => (rec ? Math.max(0, roundsIn(rec) + Math.floor(num(rec.ammo))) : 0);
// Several records together (a team's supplies and cargo).
/** @param {...(Record<string, number> | null | undefined)} recs */
export const totalIn = (...recs) => recs.reduce((a, r) => a + totalRounds(r), 0);
/** @param {Record<string, number>} rec @param {string} key @param {number} n */
export function addRounds(rec, key, n) {
  if (!rec || !(n > 0) || !ROUND_SUPPLIES[key]) return 0;
  rec[key] = num(rec[key]) + n;
  return n;
}
// Takes up to n rounds of a calibre from a record: of one type when given (strict), else its common round first, then
// the other types by value (cheapest first). Returns what was taken.
/** @param {Record<string, number>} rec @param {string} cal @param {string | null} type @param {number} n @param {boolean} [strict] */
export function takeRounds(rec, cal, type, n, strict = true) {
  if (!rec || !(n > 0)) return 0;
  const keys = type && strict ? [keyFor(cal, type)] : orderFor(cal, type);
  let got = 0;
  for (const k of keys) {
    const q = Math.min(n - got, Math.max(0, Math.floor(num(rec[k]))));
    if (q > 0) { rec[k] -= q; got += q; }
    if (got >= n) break;
  }
  return got;
}
// A calibre's keys in the order a gun draws them with no type asked for: that type first, its common round, the rest
// cheapest first.
/** @param {string} cal @param {string | null} [type] */
function orderFor(cal, type = null) {
  const keys = typesOf(cal).map((t) => ammoKey(cal, t)).sort((a, b) => (a === baseKey(cal) ? -1 : b === baseKey(cal) ? 1 : SUPPLIES[a].value - SUPPLIES[b].value));
  if (type) { const k = keyFor(cal, type); return [k, ...keys.filter((x) => x !== k)]; }
  return keys;
}
// Generic rounds out of a record (a cost, a gift, a deal paid in "ammo", by-the-numbers shooting with no gun to say
// which): generic ammo first, then the calibres in `keep` last (the guns there need them), cheapest first. Returns
// what was taken: { n, keys: { key: q } }.
/** @param {Record<string, number>} rec @param {number} n @param {Record<string, number> | null} [keep] calibres to keep (weights) */
export function spendAmmo(rec, n, keep = null) {
  const out = { n: 0, keys: /** @type {Record<string, number>} */ ({}) };
  if (!rec || !(n > 0)) return out;
  const g = Math.min(n, Math.max(0, Math.floor(num(rec.ammo))));
  if (g > 0) { rec.ammo -= g; out.n += g; out.keys.ammo = g; }
  const order = ROUND_KEYS.filter((k) => rec[k] >= 1).sort((a, b) => {
    const ka = keep && keep[ROUND_SUPPLIES[a].round.cal] ? 1 : 0, kb = keep && keep[ROUND_SUPPLIES[b].round.cal] ? 1 : 0;
    return ka - kb || SUPPLIES[a].value - SUPPLIES[b].value || num(rec[b]) - num(rec[a]) || (a < b ? -1 : 1);
  });
  for (const k of order) {
    if (out.n >= n) break;
    const q = Math.min(n - out.n, Math.floor(num(rec[k])));
    if (q > 0) { rec[k] -= q; out.n += q; out.keys[k] = (out.keys[k] || 0) + q; }
  }
  return out;
}
// Splits n generic rounds into round keys by weights ({ key: w }; largest remainder, so it is exact and the same every
// time). Returns { key: q }.
/** @param {number} n @param {Record<string, number>} mix */
export function splitByMix(n, mix) {
  /** @type {Record<string, number>} */
  const out = {};
  const keys = Object.keys(mix).filter((k) => ROUND_SUPPLIES[k] && mix[k] > 0).sort();
  n = Math.floor(n);
  if (!(n > 0) || !keys.length) return out;
  const tot = keys.reduce((a, k) => a + mix[k], 0);
  let left = n;
  const rem = keys.map((k) => { const x = (n * mix[k]) / tot; const q = Math.floor(x); out[k] = q; left -= q; return [k, x - q]; });
  rem.sort((a, b) => /** @type {number} */ (b[1]) - /** @type {number} */ (a[1]) || (a[0] < b[0] ? -1 : 1));
  for (let i = 0; left > 0; i = (i + 1) % rem.length, left--) out[rem[i][0]] += 1;
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}
/** @param {Record<string, number>} rec @param {number} n @param {Record<string, number>} mix */
export function addAmmo(rec, n, mix) {
  const parts = splitByMix(n, mix);
  for (const [k, q] of Object.entries(parts)) addRounds(rec, k, q);
  return parts;
}
// Generic ammo in a record of yours turned into rounds: added by `mix` (the guns there), or (negative: taken
// generically) out of the rounds those guns need least. A record with none is left as it is (no "ammo" key is added).
/** @param {Record<string, number>} rec @param {Record<string, number>} mix round key weights @param {Record<string, number> | null} [keep] calibre weights */
export function settleRec(rec, mix, keep = null) {
  if (!hasGeneric(rec)) return;
  const g = Math.trunc(num(rec.ammo));
  rec.ammo = num(rec.ammo) - g; // 0 (a fraction stays); the key is kept so `stock.ammo += n` elsewhere stays a number
  if (g > 0) addAmmo(rec, g, mix);
  else spendAmmo(rec, -g, keep);
}
// Has this record whole generic rounds to settle (or owe)?
/** @param {any} rec */
export const hasGeneric = (rec) => !!rec && typeof rec === "object" && Math.abs(num(rec.ammo)) >= 1;
// Several stock records added up into one (a team's supplies and cargo: the armed factor by calibre).
/** @param {...(Record<string, number> | null | undefined)} recs */
export function sumRecs(...recs) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const r of recs) if (r) for (const [k, q] of Object.entries(r)) if (Number.isFinite(q)) out[k] = (out[k] || 0) + q;
  return out;
}
// Rounds by key folded back into a generic "ammo" count (an AI group's stores keep one number: rounds sold or given
// to them, robbed from you, brought home by their caravans).
/** @param {Record<string, number>} rec */
export function foldRounds(rec) {
  if (!rec) return 0;
  let n = 0;
  for (const k of ROUND_KEYS) if (k in rec) { n += num(rec[k]); delete rec[k]; } // a debt (taken by key from the count) too
  if (n) rec.ammo = Math.max(0, num(rec.ammo) + n);
  return n;
}
// A supply in a record by key, "ammo" counting every round there (the generic reads of a stock: a deal, an order's
// target, a council's request). Everything else is the plain figure.
/** @param {Record<string, number> | null | undefined} rec @param {string} k */
export const supplyAmt = (rec, k) => (!rec ? 0 : k === "ammo" ? totalRounds(rec) : rec[k] || 0);
// Takes q of a supply out of a record by key, "ammo" as any rounds there (the cheapest first, never below zero). The
// generic writes of a stock (a deal, a delivery, a request) go through here so generic ammo is never owed.
/** @param {Record<string, number>} rec @param {string} k @param {number} q @param {Record<string, number> | null} [keep] */
export function useSupply(rec, k, q, keep = null) {
  if (!rec || !(q > 0)) return 0;
  if (k === "ammo") return spendAmmo(rec, q, keep).n;
  rec[k] = (rec[k] || 0) - q;
  return q;
}
