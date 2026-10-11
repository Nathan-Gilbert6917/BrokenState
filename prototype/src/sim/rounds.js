// @ts-check
// Rounds in stock records: the plain half of the ammo API (ammo.js re-exports all of it). Imports only the data
// modules, so the low-level helpers (water.js stockHas / useStock / takeStock) can use it without an import cycle.
import { CALIBERS, AMMO_TYPES, ammoKey, ROUND_SUPPLIES, HAND_SUPPLIES, handKey } from "./data-ammo.js";
import { SUPPLIES, supValue } from "./data.js";
import { foodIn, preservedIn, takeFood } from "./foods.js"; // "food" in a deal or a request: days of food of any kind

// ---------- keys ----------
/** every round supply key (a_<cal>_<type>) */
export const ROUND_KEYS = Object.keys(ROUND_SUPPLIES);
// The keys generic "ammo" stands for: every round but the launchers' (data-ammo.js common: false: 40 mm grenades and
// rockets are counted, spent and folded only by key, never as "N ammo").
/** every round key that counts as generic ammo */
export const GENERIC_KEYS = ROUND_KEYS.filter((k) => ROUND_SUPPLIES[k].common !== false);
/** @param {string} k */
export const isLaunchRound = (k) => !!ROUND_SUPPLIES[k] && ROUND_SUPPLIES[k].common === false;
/** @param {string} k */
export const isRoundKey = (k) => !!ROUND_SUPPLIES[k];
// Handloads (data-ammo.js HAND_SUPPLIES, reloading.js): a_9mm_hp_hand is the bench's 9mm hollow point. A gun loaded
// with a type fires both; every draw by type takes the factory round first, then the handload.
/** @param {string} k */
export const isHandKey = (k) => !!HAND_SUPPLIES[k];
// The keys of one round: its factory key and its handload key (when the bench can load it).
/** @param {string} k a factory key */
export const withHand = (k) => { const r = ROUND_SUPPLIES[k] && ROUND_SUPPLIES[k].round; const h = r && !HAND_SUPPLIES[k] ? handKey(r.cal, r.type) : null; return h && HAND_SUPPLIES[h] ? [k, h] : [k]; };
// A handload key's factory key (any other key: itself).
/** @param {string} k */
export const factoryKey = (k) => (HAND_SUPPLIES[k] ? ammoKey(HAND_SUPPLIES[k].round.cal, HAND_SUPPLIES[k].round.type) : k);
/** @param {string} k @returns {{ cal: string, type: string } | null} */
export const roundOf = (k) => (ROUND_SUPPLIES[k] ? ROUND_SUPPLIES[k].round : null);
/** @param {string} cal */
export const baseType = (cal) => (CALIBERS[cal] ? CALIBERS[cal].base : "fmj");
/** @param {string} cal */
export const baseKey = (cal) => ammoKey(cal, baseType(cal));
// ---------- loads (2026-10-10: calibre compatibility, data-ammo.js CAL_ACCEPTS) ----------
// A load (a gun's item.load, a battle unit's u.load, a magazine's) is a type of its holder's own calibre ("fmj"), or
// "<cal>:<type>" for a round of another calibre the holder takes (a 5.56 gun loaded with .223: "223:fmj"). typeFor
// normalises one against a home calibre (another calibre's load stays "<cal>:<type>", its own calibre's becomes the bare
// type), so loads compare as strings; keyFor and roundName name the round it is. Whether the holder may take that
// calibre is ammo.js gunTakes / mags.js magTakes (typeFor only knows the calibre exists).
/** @param {string | null | undefined} load */
const splitLoad = (load) => { const s = typeof load === "string" ? load : ""; const i = s.indexOf(":"); return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [null, s]; };
// The round a load names against its holder's calibre: { cal, type } (a type its calibre has, else its common round).
/** @param {string} home @param {string | null | undefined} load @returns {{ cal: string, type: string }} */
export function loadParts(home, load) {
  const [c, t] = splitLoad(load);
  const cal = c && CALIBERS[c] ? c : home;
  return { cal, type: t && CALIBERS[cal] && CALIBERS[cal].types.includes(t) ? t : baseType(cal) };
}
// The load naming a round of `cal` / `type` for a holder of calibre `home`.
/** @param {string} home @param {string | null | undefined} cal @param {string | null | undefined} type */
export const loadId = (home, cal, type) => { const c = cal && CALIBERS[cal] ? cal : home; const t = typeFor(c, type); return c === home ? t : `${c}:${t}`; };
// A load moved from one holder to another (a magazine's load in a gun of another calibre: a STANAG in a .223 gun).
/** @param {string} from @param {string | null | undefined} load @param {string} to */
export const rebaseLoad = (from, load, to) => { const p = loadParts(from, load); return loadId(to, p.cal, p.type); };
// The calibre a load names (its holder's own when it names none).
/** @param {string} home @param {string | null | undefined} load */
export const loadCal = (home, load) => loadParts(home, load).cal;
// The bare type of a load ("223:sp" → "sp").
/** @param {string | null | undefined} load */
export const bareType = (load) => splitLoad(load)[1] || null;
// A type this calibre has (else its common round); a load of another calibre stays as it is, normalised (above).
/** @param {string} cal @param {string | null | undefined} type */
export const typeFor = (cal, type) => {
  if (typeof type === "string" && type.includes(":")) { const p = loadParts(cal, type); return p.cal === cal ? p.type : `${p.cal}:${p.type}`; }
  return type && CALIBERS[cal] && CALIBERS[cal].types.includes(type) ? type : baseType(cal);
};
/** @param {string} cal @param {string | null | undefined} [type] */
export const keyFor = (cal, type) => { const p = loadParts(cal, type); return ammoKey(p.cal, p.type); };
/** @param {string} cal "12 gauge" */
export const calName = (cal) => (CALIBERS[cal] ? CALIBERS[cal].name : cal);
/** @param {string} cal @param {string | null | undefined} [type] "9mm hollow point" ("223:sp" in a 5.56 gun: ".223 Rem soft point") */
export const roundName = (cal, type) => { const p = CALIBERS[cal] ? loadParts(cal, type) : { cal, type: typeFor(cal, type) }; return `${CALIBERS[p.cal] ? CALIBERS[p.cal].name : cal} ${(AMMO_TYPES[p.type] || {}).name || ""}`.trim(); };
/** @param {string | null | undefined} type "hollow point" */
export const typeName = (type) => { const t = bareType(type); return t && AMMO_TYPES[t] ? AMMO_TYPES[t].name : ""; };
// The types a calibre has, its common round first.
/** @param {string} cal */
export const typesOf = (cal) => (CALIBERS[cal] ? [CALIBERS[cal].base, ...CALIBERS[cal].types.filter((t) => t !== CALIBERS[cal].base)] : []);
// A type's effects (data-ammo.js AMMO_TYPES), {} for a common round or none.
/** @param {string | null | undefined} type */
export const typeFx = (type) => { const t = bareType(type); return (t && AMMO_TYPES[t]) || {}; };

// ---------- stock records ----------
const num = (v) => (Number.isFinite(v) ? v : 0);
// Rounds of a calibre (any type; or of one type) in a stock record; with no calibre, every round. Generic ammo is not
// counted here (totalRounds counts it).
/** @param {Record<string, number> | null | undefined} rec @param {string | null} [cal] @param {string | null} [type] */
export function roundsIn(rec, cal = null, type = null) {
  if (!rec) return 0;
  if (cal && type) return withHand(keyFor(cal, type)).reduce((a, k) => a + Math.max(0, Math.floor(num(rec[k]))), 0); // its handloads too
  let n = 0;
  for (const k of cal ? ROUND_KEYS : GENERIC_KEYS) { // no calibre named: the rounds generic ammo stands for
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
  const keys = type && strict ? withHand(keyFor(cal, type)) : orderFor(cal, type);
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
  const keys = typesOf(cal).map((t) => ammoKey(cal, t)).sort((a, b) => (a === baseKey(cal) ? -1 : b === baseKey(cal) ? 1 : supValue(a) - supValue(b)));
  if (type) { const k = keyFor(cal, type); return [k, ...keys.filter((x) => x !== k)].flatMap(withHand); }
  return keys.flatMap(withHand); // each factory round, then its handloads
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
  const order = GENERIC_KEYS.filter((k) => rec[k] >= 1).sort((a, b) => { // never a launcher's rounds
    const ka = keep && ROUND_SUPPLIES[a].round.cal in keep ? 1 : 0, kb = keep && ROUND_SUPPLIES[b].round.cal in keep ? 1 : 0; // (a calibre its guns take besides their own: weight 0, kept too)
    return ka - kb || supValue(a) - supValue(b) || num(rec[b]) - num(rec[a]) || (a < b ? -1 : 1);
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
  for (const k of GENERIC_KEYS) if (k in rec) { n += num(rec[k]); delete rec[k]; } // a debt (taken by key from the count) too; a launcher's rounds stay by key
  if (n) rec.ammo = Math.max(0, num(rec.ammo) + n);
  return n;
}
// A supply in a record by key, "ammo" counting every round there (the generic reads of a stock: a deal, an order's
// target, a council's request). Everything else is the plain figure.
/** @param {Record<string, number> | null | undefined} rec @param {string} k */
export const supplyAmt = (rec, k) => (!rec ? 0 : k === "ammo" ? totalRounds(rec) : k === "food" ? foodIn(rec) : k === "preserved" ? preservedIn(rec) : rec[k] || 0);
// Takes q of a supply out of a record by key, "ammo" as any rounds there (the cheapest first, never below zero). The
// generic writes of a stock (a deal, a delivery, a request) go through here so generic ammo is never owed.
/** @param {Record<string, number>} rec @param {string} k @param {number} q @param {Record<string, number> | null} [keep] */
export function useSupply(rec, k, q, keep = null) {
  if (!rec || !(q > 0)) return 0;
  if (k === "ammo") return spendAmmo(rec, q, keep).n;
  if (k === "food" || k === "preserved") return takeFood(rec, q, { eggs: false, only: k === "preserved" ? (x, f) => f.group === "preserved" : null }).units; // days of food, the soonest to spoil first (foods.js)
  rec[k] = (rec[k] || 0) - q;
  return q;
}
