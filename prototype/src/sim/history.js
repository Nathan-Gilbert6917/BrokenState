// History: one row a day of the colony and of each base, for the Ledger (ui/ledger.js), the top bar's trend
// arrows and the run summary. Pure simulation: it only reads the world (no state.rng), so a run plays out the
// same with or without it.
//
// What a row holds (columns by name: H.bc for a base, H.cc for the colony; readers look them up with col()):
// - stocks at the end of the day: food, preserved, water (purified), rawwater, fuel, wood (firewood), meds, ammo,
//   parts, scrap;
// - flows over the day per resource group (food = fresh + preserved, water = both kinds): in (made, found, bought,
//   brought home) and out (eaten, drunk, burned, spent, sent out), and moved (signed: shipped between your own bases
//   by the outposts' daily surplus run, which is neither);
// - people at the base, their average mood, the base's Heat (hordes.js baseHeat);
// - the colony row also: everyone alive (teams included), deaths, arrivals and births that day, hives known and
//   destroyed, known groups alive / allied / hostile, and the coalition's share of the land (permille).
// The colony's stocks and flows are the sum over every base at the time; its flows are measured on that sum, so
// stock moved between your bases inside one step (the outposts' daily run) nets out (only what the road loses
// shows). Its Heat is the loudest base's.
//
// Flows are not recomputed from the economy's rules: every base's stock totals are marked (flowMark) at the end of
// each hour and at a few points inside the daily economy (economy.js baseDaily: after the base's production, after
// the farms; around the outposts' surplus run), and each change between two marks goes to in (up) or out (down).
// That catches every way stock moves (teams, trades, crafting, battles' loot) without hooks in every module; only
// changes of the same resource both ways between two marks net out.
//
// Size: daily rows for the last DAILY_KEEP days, then weekly rows (per-day averages) for WEEKLY_KEEP weeks, then
// 28-day rows. Numbers are rounded (one decimal under 10, whole numbers above). Measured on a Balanced autopilot run:
// 21 KB of JSON at day 90 (one base), 38 KB at a year, 134 KB at two years with 8 bases (20 KB gzipped, under 3%
// of the save).
import { day, alive } from "./world.js";
import { baseHeat } from "./hordes.js";
import { attitude } from "./factions.js";
import { controlledLand, allianceMembers } from "./alliance.js";

export const STOCK_KEYS = ["food", "preserved", "water", "rawwater", "fuel", "wood", "meds", "ammo", "parts", "scrap"];
// Flow groups: the stock keys each one sums.
export const FLOWS = { food: ["food", "preserved"], water: ["water", "rawwater"], fuel: ["fuel"], wood: ["wood"], meds: ["meds"], ammo: ["ammo"], parts: ["parts"], scrap: ["scrap"] };
export const FLOW_KEYS = Object.keys(FLOWS);
const BASE_COLS = ["day", "span", ...STOCK_KEYS.map((k) => `s_${k}`), ...FLOW_KEYS.map((k) => `i_${k}`), ...FLOW_KEYS.map((k) => `o_${k}`), ...FLOW_KEYS.map((k) => `m_${k}`), "people", "mood", "heat"];
const COLONY_COLS = [...BASE_COLS, "pop", "deaths", "arrivals", "births", "hivesKnown", "hivesDestroyed", "groups", "allied", "hostile", "land"];
// Columns kept as the last value in a merged row instead of the average (counters that only grow).
const LAST_COLS = new Set(["hivesDestroyed"]);

export const HISTORY = {
  DAILY_KEEP: 120,  // daily rows kept before the oldest week is merged
  WEEKLY_KEEP: 104, // weekly rows (two years) before the oldest four weeks are merged into 28 days
};

const r = (v) => (!Number.isFinite(v) ? 0 : Math.abs(v) < 10 ? Math.round(v * 10) / 10 : Math.round(v));

// ---------- state ----------
// The history, made on first use (a new world on its first hour; an older save on its first hour after loading:
// its history starts there).
export function ensureHistory(state) {
  let H = state.history;
  if (H && H.v === 1) return H;
  H = state.history = {
    v: 1, from: day(state), bc: BASE_COLS, cc: COLONY_COLS,
    all: { rows: [] }, bases: {}, // bases: id -> { name, hub, rows, lost? }
    last: {}, acc: {},            // per base id and "all": stock totals at the last mark, and the day's flows so far
    seen: state.survivors.length, dead: deadCount(state), // survivors made and dead at the last row
  };
  markAll(state); // the baseline: nothing before now counts as a flow
  return H;
}
export const historyOf = (state) => (state.history && state.history.v === 1 ? state.history : null);

const deadCount = (state) => state.survivors.reduce((n, s) => n + (!s.alive && !s.left ? 1 : 0), 0);

// ---------- marks ----------
function totals(stock) {
  const out = new Array(FLOW_KEYS.length);
  for (let i = 0; i < FLOW_KEYS.length; i++) {
    let v = 0;
    for (const k of FLOWS[FLOW_KEYS[i]]) v += Number(stock && stock[k]) || 0;
    out[i] = v;
  }
  return out;
}
const freshAcc = () => ({ i: FLOW_KEYS.map(() => 0), o: FLOW_KEYS.map(() => 0), m: FLOW_KEYS.map(() => 0) });

function markKey(H, key, now, kind) {
  const last = H.last[key];
  H.last[key] = now;
  if (!last) return;
  const acc = H.acc[key] || (H.acc[key] = freshAcc());
  for (let i = 0; i < now.length; i++) {
    const d = now[i] - last[i];
    if (!d) continue;
    if (kind === "move") acc.m[i] += d;
    else if (d > 0) acc.i[i] += d;
    else acc.o[i] -= d;
  }
}
function markColony(state, H, kind) {
  const sum = FLOW_KEYS.map(() => 0);
  for (const b of state.bases) {
    const t = totals(b.stock);
    for (let i = 0; i < sum.length; i++) sum[i] += t[i];
  }
  // A move between bases nets out in the sum: whatever is left (the road's loss) is a real out.
  markKey(H, "all", sum, kind === "move" ? "" : kind);
}

// One base's stock changes since its last mark go to its flows (kind "move": to its moved column), and the colony's.
export function flowMark(state, base, kind = "") {
  const H = historyOf(state);
  if (!H || !base) return;
  markKey(H, String(base.id), totals(base.stock), kind);
  markColony(state, H, kind);
}
// Every base at once (the end of the hour; around the outposts' surplus run).
export function markAll(state, kind = "") {
  const H = historyOf(state);
  if (!H) return;
  for (const b of state.bases) markKey(H, String(b.id), totals(b.stock), kind);
  markColony(state, H, kind);
}

// ---------- the day's rows ----------
// The rows as they stand now (stocks now, flows so far since the last row). Reads only: record() keeps them.
export function currentRows(state) {
  const H = historyOf(state);
  if (!H) return null;
  const d = day(state) - (state.hour % 24 === 0 ? 1 : 0); // at midnight the row is the day that just ended
  const living = alive(state);
  const bases = {};
  const sumStock = STOCK_KEYS.map(() => 0);
  let people = 0, moodSum = 0, heat = 0;
  for (const b of state.bases) {
    const here = living.filter((s) => s.location && s.location.kind === "base" && s.location.baseId === b.id);
    const mood = here.length ? here.reduce((a, s) => a + (Number(s.mood) || 0), 0) / here.length : 0;
    const h = safeHeat(state, b);
    const acc = H.acc[String(b.id)] || freshAcc();
    const stock = STOCK_KEYS.map((k) => Math.max(0, Number(b.stock && b.stock[k]) || 0));
    stock.forEach((v, i) => (sumStock[i] += v));
    people += here.length;
    moodSum += mood * here.length;
    heat = Math.max(heat, h);
    bases[b.id] = [d, 1, ...stock, ...acc.i, ...acc.o, ...acc.m, here.length, mood, h].map(r);
  }
  const acc = H.acc.all || freshAcc();
  const made = state.survivors.slice(H.seen);
  const facs = (state.factions || []).filter((f) => f.alive && f.known);
  const members = new Set(allianceMembers(state).map((f) => f.id));
  const hives = state.hives || [];
  const know = state.knowledge || {};
  const land = state.bases.length ? controlledLand(state).pct : 0;
  const all = [
    d, 1, ...sumStock, ...acc.i, ...acc.o, FLOW_KEYS.map(() => 0), people, people ? moodSum / people : 0, heat,
    living.length, deadCount(state) - H.dead, made.length, made.filter(isBirth).length,
    hives.filter((hv) => know[hv.tile] && know[hv.tile].hive).length,
    state.hiveInfo && state.hiveInfo.stats ? state.hiveInfo.stats.destroyed : 0,
    facs.length, facs.filter((f) => members.has(f.id) || attitude(f) === "Allied").length, facs.filter((f) => attitude(f) === "Hostile").length,
    land * 1000,
  ].flat().map(r);
  return { day: d, all, bases };
}
function safeHeat(state, b) {
  try { return baseHeat(state, b); } catch { return 0; }
}
// A newcomer born in the colony (the children module marks them; until then nobody is). Arrivals count everyone new.
export function isBirth(s) {
  return !!(s && (s.born != null || s.bornDay != null || s.parents || s.origin === "born"));
}

// Hourly hook (end of world.js tickHour): marks every base; at midnight writes the day's rows.
export function historyHour(state) {
  const H = ensureHistory(state);
  markAll(state);
  if (state.hour % 24 === 0) record(state, H);
}

function record(state, H) {
  const cur = currentRows(state);
  if (!cur) return;
  pushRow(H.all.rows, cur.all, H.cc);
  for (const b of state.bases) {
    const key = String(b.id);
    const ser = H.bases[key] || (H.bases[key] = { name: b.name, rows: [] });
    ser.name = b.name;
    ser.hub = b.type === "hub";
    delete ser.lost;
    pushRow(ser.rows, cur.bases[b.id], H.bc);
  }
  // Bases that are gone keep their rows (the Ledger lists them as lost).
  for (const [key, ser] of Object.entries(H.bases)) if (!ser.lost && !state.bases.some((b) => String(b.id) === key)) ser.lost = cur.day;
  for (const key of Object.keys(H.acc)) H.acc[key] = freshAcc();
  for (const key of Object.keys(H.last)) if (key !== "all" && !state.bases.some((b) => String(b.id) === key)) delete H.last[key];
  H.seen = state.survivors.length;
  H.dead = deadCount(state);
}

function pushRow(rows, row, cols) {
  if (rows.length && rows[rows.length - 1][0] === row[0]) rows[rows.length - 1] = row; // the same day twice (a reload): the newer one
  else rows.push(row);
  compact(rows, cols);
}

// Old daily rows become weekly ones, old weekly ones 28-day ones (per-day averages, weighted by span).
export function compact(rows, cols) {
  const firstOf = (span) => rows.findIndex((x) => x[1] === span);
  const count = (span) => rows.reduce((n, x) => n + (x[1] === span ? 1 : 0), 0);
  while (count(1) > HISTORY.DAILY_KEEP) {
    const i = firstOf(1);
    rows.splice(i, 7, merge(rows.slice(i, i + 7), cols));
  }
  while (count(7) > HISTORY.WEEKLY_KEEP) {
    const i = firstOf(7);
    rows.splice(i, 4, merge(rows.slice(i, i + 4), cols));
  }
}
function merge(group, cols) {
  const span = group.reduce((a, x) => a + x[1], 0);
  const out = [group[0][0], span];
  for (let c = 2; c < cols.length; c++) {
    if (LAST_COLS.has(cols[c])) { out.push(group[group.length - 1][c]); continue; }
    let v = 0;
    for (const x of group) v += (Number(x[c]) || 0) * x[1];
    out.push(r(v / span));
  }
  return out;
}

// ---------- reading ----------
// The column's index in a series' rows (by name, from the columns the history was written with).
export function colIndex(H, name, colony = false) {
  return (colony ? H.cc : H.bc).indexOf(name);
}
// A series: "all" (the colony) or a base id. { name, rows, colony, lost? }.
export function seriesOf(state, key) {
  const H = historyOf(state);
  if (!H) return null;
  if (key === "all" || key == null) return { name: "All bases", rows: H.all.rows, colony: true };
  const s = H.bases[String(key)];
  return s ? { name: s.name, rows: s.rows, colony: false, lost: s.lost, hub: s.hub } : null;
}
// Values of one column over a series' rows (with each row's day and span): [{ day, span, v }].
export function column(state, key, name) {
  const H = historyOf(state), ser = seriesOf(state, key);
  if (!H || !ser) return [];
  const i = colIndex(H, name, ser.colony);
  if (i < 0) return [];
  return ser.rows.map((x) => ({ day: x[0], span: x[1], v: Number(x[i]) || 0 }));
}
// The base series the Ledger can show: live bases first (the hub on top), then the lost ones.
export function seriesList(state) {
  const H = historyOf(state);
  if (!H) return [];
  return Object.entries(H.bases).map(([id, s]) => ({ id, name: s.name, lost: s.lost || null, hub: !!s.hub, days: s.rows.length }))
    .sort((a, b) => (!!a.lost - !!b.lost) || (b.hub - a.hub) || Number(a.id) - Number(b.id));
}

// Yesterday's change of one stock key at a base: { now, before, delta, spark: [last 15 values] } from the last two
// daily rows (null when there are not two yet).
export function stockTrend(state, baseId, key) {
  const H = historyOf(state);
  const ser = H && H.bases[String(baseId)];
  if (!ser) return null;
  const rows = ser.rows;
  const i = colIndex(H, key === "water+" ? "s_water" : `s_${key}`);
  if (i < 0) return null;
  const val = (x) => (key === "water+" ? (Number(x[i]) || 0) + (Number(x[colIndex(H, "s_rawwater")]) || 0) : Number(x[i]) || 0);
  const spark = rows.slice(-15).map(val);
  if (rows.length < 2 || rows[rows.length - 1][1] !== 1) return { now: spark[spark.length - 1] ?? null, before: null, delta: 0, spark };
  const now = val(rows[rows.length - 1]), before = val(rows[rows.length - 2]);
  return { now, before, delta: now - before, spark, day: rows[rows.length - 1][0] };
}

// ---------- the run summary's facts ----------
// Deaths by cause, from the memorial wall (relations.js onDeath). The one place a cause becomes a category: point it
// at a richer record of causes when there is one.
export const CAUSES = [
  ["hunger", "Hunger", /hunger|starv/i],
  ["thirst", "Thirst", /thirst/i],
  ["worm", "The worm", /worm|turned|got up/i],
  ["illness", "Illness and wounds", /infect|wound|illness|fever|flu|pneumonia|sick|disease|dysentery|cholera|tetanus|sepsis|operating/i],
  ["despair", "Despair", /own hand|walking out into the dead/i],
  ["dead", "The dead", /horde|overran|overrun|bitten|hive|the dead/i],
  ["cold", "Cold, storms and accidents", /cold|storm|blizzard|drown|a fall|fire escape|fighting a fire|collapsed/i],
  ["people", "Fights with people", /fight|defending|shot|hands of|raiding|killing|attacked|hit the convoy|came for|fistfight|running from|extracting/i],
];
export function causeOf(text) {
  const t = String(text || "");
  for (const [key, label, re] of CAUSES) if (re.test(t)) return { key, label };
  return { key: "other", label: "Other" };
}
export function deathsByCause(state) {
  const out = new Map();
  for (const m of state.memorial || []) {
    const c = causeOf(m.cause);
    const e = out.get(c.key) || { key: c.key, label: c.label, n: 0, names: [] };
    e.n++;
    if (e.names.length < 4) e.names.push(m.name);
    out.set(c.key, e);
  }
  return [...out.values()].sort((a, b) => b.n - a.n);
}

// The day with the most deaths (memorial wall), or else the day the colony lost the most (people, then food).
export function worstDay(state) {
  const byDay = new Map();
  for (const m of state.memorial || []) byDay.set(m.died, (byDay.get(m.died) || []).concat(m.name));
  let best = null;
  for (const [d, names] of byDay) if (!best || names.length > best.names.length || (names.length === best.names.length && d < best.day)) best = { day: d, names };
  if (best) return { day: best.day, kind: "deaths", n: best.names.length, names: best.names };
  const H = historyOf(state);
  if (!H) return null;
  const rows = H.all.rows.filter((x) => x[1] === 1);
  const pi = colIndex(H, "pop", true), fi = colIndex(H, "s_food", true), qi = colIndex(H, "s_preserved", true);
  let worst = null;
  for (let i = 1; i < rows.length; i++) {
    const lost = rows[i - 1][pi] - rows[i][pi];
    if (lost > 0 && (!worst || lost > worst.n)) worst = { day: rows[i][0], kind: "people", n: lost };
  }
  if (worst) return worst;
  for (let i = 1; i < rows.length; i++) {
    const lost = rows[i - 1][fi] + rows[i - 1][qi] - rows[i][fi] - rows[i][qi];
    if (lost > 0 && (!worst || lost > worst.n)) worst = { day: rows[i][0], kind: "food", n: Math.round(lost) };
  }
  return worst;
}
