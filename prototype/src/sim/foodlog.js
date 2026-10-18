// The food ledger (user request 2026-10-12: "Show the food chain on the base window: food on hand, how fast it spoils,
// cooking bills and fuel for the fire, so a player can see why food runs out"). A rolling per-day record on each base
// of where its food came from and where it went, the last FOODLOG.keep days, for the base window's Food tab
// (sim/foodchain.js, ui/foodchain.js). Pure bookkeeping: it reads no dice and changes nothing the world plays on.
//
// How it counts (like history.js: marks, not hooks in every module). base.foodLog.last holds the base's food stock by
// item at the last mark; a mark (foodMark) compares the stock now and books every item's change to the day's row by
// the phase it was marked in, and by the item's kind where the phase does not say (raw meat → hunting, fish →
// fishing, forage → foraging). The marks (world.js tickHour, economy.js baseDaily and basesDaily):
//   player  the start of the hour and before the job trips: what the player, the governor, a steward or a crew did
//           (trades in, teams packed out);
//   team    after the teams moved: teams home (raw meat → hunting, fish → fishing, forage → foraging, the rest →
//           scavenging and teams home), teams setting out;
//   pack    after the hour's eating: everyone's pack topped up from the stores (out) or emptied into them (back);
//   job     after the job trips: the hunters', fishers', foragers' and scavengers' loads home;
//   other   anything else (visitors, caravans, raids, crafting): in by the item's kind, else "trade and gifts";
//   scav, hunt, station, farm, cook, storage, ship: the steps of the base's day at midnight (base scavenging, the
//           hunters and fishers, the workshop stations (a pen's eggs and milk count as the farm's), the harvest
//           (seed out), the cooking bills, the drying racks and the smokehouse, the outposts' surplus run).
// Two flows are booked where they happen and explained to the next mark so it does not count them twice: eating
// (storage.js noteAte: every meal from the stores, by the item; its quality tier; raw meat or fish where nothing cooks)
// and spoiling (economy.js after storage.js storageDaily: the lots thrown out).
// So a day's row closes: in − out + made − used = the change in the base's days of food (tools/foodchaintest.js).
//
// base.foodLog = { v: 1, from (the hour it started), last: { key: q }, x: { key: q explained since the last mark },
//   rows: [{ d (work day, output.js workDay), in: { farm, hunt, fish, forage, scav, trade, ship, back, other },
//            out: { eaten, spoiled, sent, ship, used, other }, made, raw, tier: { tier: days eaten } }] }
// Every amount is in days of food (2000 kcal). Older saves start it on their first hour after loading.
import { FOODS, unitsOf } from "./foods.js";
import { workDay } from "./output.js";

export const FOODLOG = { keep: 8, window: 7 };
// In and out kinds (rows' keys), in the order the screens list them.
export const IN_KEYS = ["farm", "hunt", "fish", "forage", "scav", "trade", "ship", "back", "other"];
export const OUT_KEYS = ["eaten", "spoiled", "sent", "pack", "ship", "used", "other"];
const EPS = 1e-6;
const GROUP_IN = { rawmeat: "hunt", rawfish: "fish", forage: "forage" };
const wildIn = (k, f) => GROUP_IN[f.group] || (k === "f_honey" ? "forage" : null);

const newRow = (d) => ({ d, in: {}, out: {}, made: 0, used: 0, raw: 0, tier: {} });
const r3 = (v) => Math.round(v * 1000) / 1000;
function roundRow(r) {
  for (const g of [r.in, r.out, r.tier]) for (const k of Object.keys(g)) g[k] = r3(g[k]);
  r.made = r3(r.made); r.used = r3(r.used); r.raw = r3(r.raw);
}

// The base's food by item (q > 0).
function foodStock(base) {
  const out = {};
  const st = base.stock || {};
  for (const k in st) if (FOODS[k] && st[k] > EPS) out[k] = st[k];
  return out;
}
// The log, made on first use with today's stock as its baseline (nothing before counts).
export function foodLogOf(state, base, make = true) {
  let L = base && base.foodLog;
  if (L && L.v === 1) return L;
  if (!make || !base) return null;
  L = base.foodLog = { v: 1, from: state ? state.hour : 0, last: foodStock(base), x: {}, rows: [] };
  return L;
}
// The day's row (a new day closes and rounds the one before; only FOODLOG.keep rows are kept).
function rowOf(state, L) {
  const d = state ? workDay(state.hour) : L.rows.length ? L.rows[L.rows.length - 1].d : 1;
  let r = L.rows[L.rows.length - 1];
  if (r && r.d === d) return r;
  if (r) roundRow(r);
  r = newRow(d);
  L.rows.push(r);
  while (L.rows.length > FOODLOG.keep) L.rows.shift();
  return r;
}
const add = (g, k, v) => { g[k] = (g[k] || 0) + v; };

// Where an item that came in at this phase came from.
function inKind(phase, k, f) {
  switch (phase) {
    case "farm": return "farm";
    case "scav": return "scav";
    case "hunt": return f.group === "rawfish" ? "fish" : "hunt";
    case "ship": return "ship";
    case "pack": return "back";
    case "player": return "trade";
    case "cook": case "storage": return null; // made: the kitchen, the racks, the smokehouse
    case "station": return k === "f_eggs" || k === "f_milk" ? "farm" : null; // the pen's; the rest the stations made of food
    case "team": return wildIn(k, f) || "scav";
    case "job": return wildIn(k, f) || "scav"; // the scavengers' trips home too
    default: return wildIn(k, f) || "trade";
  }
}
// Where food that went out at this phase went.
function outKind(phase) {
  switch (phase) {
    case "cook": case "storage": case "station": return null; // used: ingredients, racks, smokehouse, preserving
    case "ship": return "ship";
    case "pack": return "pack";
    case "farm": case "other": return "other";
    default: return "sent";
  }
}

// A mark: the base's food changes since the last one, booked by phase.
export function foodMark(state, base, phase = "other") {
  if (!base || !base.stock) return;
  const fresh = !(base.foodLog && base.foodLog.v === 1);
  const L = foodLogOf(state, base);
  if (fresh) return; // the baseline was just taken
  const last = L.last || {};
  const x = L.x || {};
  // Most marks find nothing moved: the same items in the same amounts as the last mark and nothing booked since.
  // Known from the stock at once (L.last already holds what foodStock would make now).
  if (isEmpty(x) && unchanged(base.stock || {}, last)) { if (!L.last) L.last = {}; return; }
  const now = foodStock(base);
  let r = null;
  const keys = new Set([...Object.keys(now), ...Object.keys(last), ...Object.keys(x)]);
  for (const k of keys) {
    const f = FOODS[k];
    if (!f) continue;
    const dq = (now[k] || 0) - (last[k] || 0) + (x[k] || 0);
    if (Math.abs(dq) <= EPS) continue;
    const u = unitsOf(k, Math.abs(dq));
    if (!(u > EPS)) continue;
    r = r || rowOf(state, L);
    if (dq > 0) { const kind = inKind(phase, k, f); if (kind) add(r.in, kind, u); else r.made += u; }
    else { const kind = outKind(phase); if (kind) add(r.out, kind, u); else r.used += u; }
  }
  L.last = now;
  L.x = {};
}
// Does the stock's food (foodStock: every food item over EPS) match `last` exactly, item for item and in the same
// order (so the kept `last` is the object foodStock would make)?
function unchanged(st, last) {
  const lk = Object.keys(last);
  let i = 0;
  for (const k in st) if (FOODS[k] && st[k] > EPS) { if (lk[i++] !== k || st[k] !== last[k]) return false; }
  return i === lk.length;
}
const isEmpty = (o) => { for (const k in o) return false; return true; };
export function foodMarkAll(state, phase = "other") {
  for (const b of state.bases || []) foodMark(state, b, phase);
}

// Food that left the stores and was booked here (eaten, spoiled): the next mark leaves it out.
function explain(L, items) {
  for (const [k, q] of Object.entries(items || {})) if (FOODS[k] && q > 0) L.x[k] = (L.x[k] || 0) + q;
}
// Eaten from the stores (storage.js noteAte: the people living here at the table, prisoners, children, guests): by
// quality tier, and raw meat or fish where nothing cooks it (cooked: worm.js baseCooks).
export function foodAte(state, base, items, cooked = true) {
  const L = base && base.foodLog && base.foodLog.v === 1 ? base.foodLog : null;
  if (!L) return; // no baseline yet: the first mark takes it
  explain(L, items);
  const r = rowOf(state, L);
  for (const [k, q] of Object.entries(items || {})) {
    const f = FOODS[k];
    if (!f || !(q > 0)) continue;
    const u = unitsOf(k, q);
    add(r.out, "eaten", u);
    add(r.tier, f.tier || "plain", u);
    if (f.raw && !cooked) r.raw += u;
  }
}
// Thrown out spoiled (storage.js storageDaily's items).
export function foodSpoiled(state, base, items) {
  const L = base && base.foodLog && base.foodLog.v === 1 ? base.foodLog : null;
  if (!L) return;
  explain(L, items);
  const r = rowOf(state, L);
  for (const [k, q] of Object.entries(items || {})) if (FOODS[k] && q > 0) add(r.out, "spoiled", unitsOf(k, q));
}

// ---------- reading it ----------
// The last `days` work days (today included) summed: { days (how much of them the log covers, fractional), rows,
// in, out, made, used, raw, tier, totalIn, totalOut, net (a day) }.
export function foodWindow(state, base, days = FOODLOG.window) {
  const L = foodLogOf(state, base, false);
  const today = workDay(state.hour);
  const start = (today - days) * 24; // the hour before the window's first day
  const sum = { days: 0, rows: [], in: {}, out: {}, made: 0, used: 0, raw: 0, tier: {}, totalIn: 0, totalOut: 0, net: 0 };
  for (const k of IN_KEYS) sum.in[k] = 0;
  for (const k of OUT_KEYS) sum.out[k] = 0;
  if (!L) return sum;
  sum.days = Math.max(0, state.hour - Math.max(L.from, start)) / 24;
  for (const r of L.rows) {
    if (r.d <= today - days || r.d > today) continue;
    sum.rows.push(r);
    for (const [k, v] of Object.entries(r.in)) sum.in[k] = (sum.in[k] || 0) + v;
    for (const [k, v] of Object.entries(r.out)) sum.out[k] = (sum.out[k] || 0) + v;
    for (const [k, v] of Object.entries(r.tier)) sum.tier[k] = (sum.tier[k] || 0) + v;
    sum.made += r.made; sum.used += r.used; sum.raw += r.raw;
  }
  sum.totalIn = Object.values(sum.in).reduce((a, v) => a + v, 0);
  sum.totalOut = Object.values(sum.out).reduce((a, v) => a + v, 0);
  sum.net = sum.days > 0 ? (sum.totalIn - sum.totalOut + sum.made - sum.used) / sum.days : 0;
  return sum;
}
// A row's balance: in − out + made − used (days of food).
export const rowNet = (r) => Object.values(r.in).reduce((a, v) => a + v, 0) - Object.values(r.out).reduce((a, v) => a + v, 0) + r.made - r.used;
