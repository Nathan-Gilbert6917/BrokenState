// The Ledger's history (src/sim/history.js), the Ledger and the run summary (src/ui/ledger.js), the top bar's trends.
// Usage: node tools/historytest.js [days=40] [seed=42]     (about a minute and a half)
// - the recorder: a Balanced autopilot run with a test outpost; one colony row a day and one per base; each base's
//   stock change every day is its in − out + moved; the colony's stocks are the bases' sum and its moved nets out;
//   population, deaths and arrivals match the world; the outposts' daily run shows as moved
// - it never touches the world: the same seed with the history thrown away every hour plays out the same (dice,
//   log, stocks); reading it (rows, the Ledger, the summary) leaves the dice alone; its cost a day
// - compaction: daily rows past 120 become weekly averages, weekly past 104 become 28-day ones (spans add up, the
//   averages are right, counters keep their last value)
// - saves: saved and loaded mid-run, the history plays on the same as the original; a save from before the Ledger
//   loads and starts its history on that day
// - causes of death, the worst day, the best people, notable events
// - the screens (no DOM): every base and range, the summary tab, the game-over and victory screens, the top bar's
//   arrows and sparkline values, the E key; no undefined / NaN / null, balanced tags, every data-action handled;
//   the Help topic and the README
import { readFileSync } from "node:fs";
import { createWorld, tickHour, day, hub, alive, newId, killSurvivor, peekNextId, setNextId } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { addBuilding } from "../src/sim/buildings.js";
import { recomputeOwnership } from "../src/sim/factions.js";
import { planPath } from "../src/sim/parties.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import {
  historyOf, ensureHistory, currentRows, markAll, compact, colIndex, seriesList, column, stockTrend, FLOWS, FLOW_KEYS,
  STOCK_KEYS, HISTORY, causeOf, deathsByCause, worstDay,
} from "../src/sim/history.js";
import { ledgerModal, runSummaryHTML, stockChipTrend, notableEvents, ledgerKey, LEDGER_ACTIONS, RANGES, ledgerHelp } from "../src/ui/ledger.js";
import { ACH_ACTIONS } from "../src/ui/achievements.js";
import { renderModal, topbarParts } from "../src/ui/ui.js";
import { TL_ACTIONS } from "../src/ui/timelapse.js";
import { helpTopics } from "../src/ui/help.js";

const days = Number(process.argv[2] || 40);
const seed = Number(process.argv[3] || 42);
let passes = 0, fails = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

// ---------- helpers ----------
function makeOutpost(state, tile, name) {
  const base = { id: newId(), tile, type: "outpost", name, stock: { food: 80, water: 30, fuel: 10, meds: 2, ammo: 30, parts: 0, scrap: 40, wood: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  state.bases.push(base);
  for (let i = 0; i < 3; i++) addBuilding(base, "walls");
  recomputeOwnership(state);
  return base;
}
function freeTile(state, near, dmin, dmax) {
  const g = state.grid;
  return state.tiles.find((t) => {
    const d = g.distance(t.id, near);
    if (d < dmin || d > dmax || t.terrain === "water" || typeof t.owner === "number") return false;
    if (state.bases.some((b) => g.distance(b.tile, t.id) < 3)) return false;
    if (state.factions.some((f) => f.bases.some((b) => g.distance(b, t.id) <= 3))) return false;
    return !!planPath(state, near, t.id, true);
  });
}
const SCAN = /\bundefined\b|\bNaN\b|>null<|="null"/;
function tagsBalanced(html) {
  const stack = [];
  for (const m of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g)) {
    const tag = m[1].toLowerCase();
    if (["br", "img", "input", "hr", "meta", "link"].includes(tag)) continue;
    if (m[0].startsWith("</")) { if (stack.pop() !== tag) return false; } else if (!m[2]) stack.push(tag);
  }
  return stack.length === 0;
}
const HANDLERS = new Set([...Object.keys(LEDGER_ACTIONS), ...Object.keys(TL_ACTIONS), ...Object.keys(ACH_ACTIONS), "keepplaying", "restart"]); // ACH_ACTIONS: the end screens' 🏆 Achievements (ui/achievements.js)
function screenOk(html, where) {
  check(typeof html === "string" && html.length > 0, `${where}: renders`);
  const bad = SCAN.exec(html);
  check(!bad, `${where}: no undefined / NaN / null (${bad ? html.slice(Math.max(0, bad.index - 80), bad.index + 30) : ""})`);
  check(tagsBalanced(html), `${where}: balanced tags`);
  const missing = [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]).filter((a) => !HANDLERS.has(a));
  check(!missing.length, `${where}: every data-action has a handler (missing: ${[...new Set(missing)].join(", ")})`);
}
const groupOf = (row, H, key, colony) => FLOWS[key].reduce((a, k) => a + (Number(row[colIndex(H, `s_${k}`, colony)]) || 0), 0);

// ---------- the recorder ----------
section(`Recorder: ${days} days on seed ${seed} (Balanced autopilot, a test outpost)`);
const st = createWorld({ seed, factionCount: 6 });
setAutopilot(st, true, "balanced");
const h0 = hub(st);
const tile = freeTile(st, h0.tile, 3, 6);
const outpost = tile ? makeOutpost(st, tile.id, "Test Outpost") : null;
check(!!outpost, "a test outpost could be placed");
if (outpost) for (const s of alive(st).slice(-2)) { s.location = { kind: "base", baseId: outpost.id }; s.role = "guard"; }
const made0 = st.survivors.length;
let dayMs = 0;
const t0 = Date.now();
while (day(st) <= days && !st.gameOver) tickHour(st);
const runMs = Date.now() - t0;
const H = historyOf(st);
check(!!H && H.v === 1, "the world has a history");
const rows = H.all.rows;
check(rows.length === days, `one colony row a day (${rows.length} for ${days} days)`);
check(rows.every((x, i) => x[0] === i + 1 && x[1] === 1 && x.length === H.cc.length), "colony rows are days 1…N in order, a day each, every column filled");
const list = seriesList(st);
check(list.length === st.bases.length && list[0].hub, `a series per base, the hub first (${list.map((s) => s.name).join(", ")})`);
for (const s of list) check(H.bases[s.id].rows.every((x) => x.length === H.bc.length), `${s.name}: every column filled`);

// Each base: the stock change each day is in − out + moved (both read from rounded rows: a little slack).
let worst = 0, checked = 0;
for (const s of list) {
  const rs = H.bases[s.id].rows;
  for (let i = 1; i < rs.length; i++) {
    for (const g of FLOW_KEYS) {
      const d = groupOf(rs[i], H, g, false) - groupOf(rs[i - 1], H, g, false);
      const f = rs[i][colIndex(H, `i_${g}`)] - rs[i][colIndex(H, `o_${g}`)] + rs[i][colIndex(H, `m_${g}`)];
      const err = Math.abs(d - f) / (2 + Math.abs(d) * 0.01 + rs[i][colIndex(H, `i_${g}`)] * 0.01);
      worst = Math.max(worst, err);
      checked++;
      if (err > 1 && worst === err) console.log(`  ${s.name} day ${rs[i][0]} ${g}: stock ${d.toFixed(1)} vs flows ${f.toFixed(1)}`);
    }
  }
}
check(worst <= 1, `every base's daily stock change is its in − out + moved (${checked} checks, worst ${(worst * 100).toFixed(0)}% of the slack)`);
// The colony: its stocks are the bases' sum, its moved column is always 0, and its balance holds without it.
const stockSum = rows.every((x) => {
  return STOCK_KEYS.every((k) => {
    const c = x[colIndex(H, `s_${k}`, true)];
    // history.js r(): one decimal under 10, whole numbers above, so each figure is off by up to half its step.
    const half = (v) => (Math.abs(v) < 10 ? 0.05 : 0.5);
    let sum = 0, slack = half(c) + 0.001;
    for (const s of list) { const r = H.bases[s.id].rows.find((y) => y[0] === x[0]); const v = r ? Number(r[colIndex(H, `s_${k}`)]) || 0 : 0; sum += v; if (r) slack += half(v); }
    return Math.abs(c - sum) <= Math.max(slack, 0.15 * list.length + 0.5 + sum * 0.005);
  });
});
check(stockSum, "the colony's stocks are the sum of its bases' every day");
check(rows.every((x) => FLOW_KEYS.every((g) => x[colIndex(H, `m_${g}`, true)] === 0)), "the colony's moved column is 0 (moves between your bases net out)");
let cworst = 0;
for (let i = 1; i < rows.length; i++) for (const g of FLOW_KEYS) {
  const d = groupOf(rows[i], H, g, true) - groupOf(rows[i - 1], H, g, true);
  const f = rows[i][colIndex(H, `i_${g}`, true)] - rows[i][colIndex(H, `o_${g}`, true)];
  cworst = Math.max(cworst, Math.abs(d - f) / (2 + Math.abs(d) * 0.01 + rows[i][colIndex(H, `i_${g}`, true)] * 0.01));
}
check(cworst <= 1, `the colony's daily stock change is its in − out (worst ${(cworst * 100).toFixed(0)}% of the slack)`);
const moved = outpost && H.bases[String(outpost.id)] ? H.bases[String(outpost.id)].rows.reduce((a, x) => a + FLOW_KEYS.reduce((b, g) => b + Math.abs(x[colIndex(H, `m_${g}`)]), 0), 0) : 0;
check(moved > 0, `the outpost's daily surplus run shows as moved (${Math.round(moved)} units over the run)`);
const inFood = rows.reduce((a, x) => a + x[colIndex(H, "i_food", true)], 0), outFood = rows.reduce((a, x) => a + x[colIndex(H, "o_food", true)], 0);
check(inFood > 0 && outFood > 0, `food came in (${Math.round(inFood)}) and went out (${Math.round(outFood)})`);
const outWater = rows.reduce((a, x) => a + x[colIndex(H, "o_water", true)], 0);
check(outWater > alive(st).length * days * 0.5, `water drunk shows as out (${Math.round(outWater)})`);
// People.
const last = rows[rows.length - 1];
const deathsRec = rows.reduce((a, x) => a + x[colIndex(H, "deaths", true)], 0);
const deadNow = st.survivors.filter((s) => !s.alive && !s.left).length;
check(deathsRec === deadNow, `deaths a day add up to the dead (${deathsRec} vs ${deadNow})`);
const arrivals = rows.reduce((a, x) => a + x[colIndex(H, "arrivals", true)], 0);
check(arrivals === st.survivors.length - made0, `arrivals add up to the newcomers (${arrivals} vs ${st.survivors.length - made0})`);
check(rows.every((x) => x[colIndex(H, "births", true)] === 0), "no births (there are no children yet)");
check(last[colIndex(H, "mood", true)] > 0 && last[colIndex(H, "mood", true)] <= 100, `mood is 0–100 (${last[colIndex(H, "mood", true)]})`);
check(last[colIndex(H, "heat", true)] > 0, `Heat is recorded (${last[colIndex(H, "heat", true)]})`);
check(last[colIndex(H, "land", true)] > 0 && last[colIndex(H, "land", true)] <= 1000, `land share in permille (${last[colIndex(H, "land", true)]})`);
check(column(st, "all", "pop").length === rows.length && column(st, "all", "nope").length === 0, "column() reads a column by name, nothing for an unknown one");

// Reading never rolls the world's dice; the cost of a day.
const rng0 = st.rng.state;
const ui = { started: true, ledgerPrefs: null };
for (const r of RANGES) for (const b of ["all", ...list.map((s) => s.id)]) { ui.ledgerPrefs = { base: b, range: r[0], tab: "ledger" }; ledgerModal(st, ui); }
runSummaryHTML(st, { live: true });
currentRows(st);
check(st.rng.state === rng0, "the Ledger, the summary and currentRows leave the world's dice alone");
{
  const N = 200;
  const tA = process.hrtime.bigint();
  const H0 = JSON.stringify(H);
  for (let i = 0; i < N; i++) { for (let k = 0; k < 24; k++) markAll(st); currentRows(st); }
  dayMs = Number(process.hrtime.bigint() - tA) / 1e6 / N;
  st.history = JSON.parse(H0); // the timing marks left no trace
  console.log(`  recorder: ${(dayMs * 1000).toFixed(0)} µs a day (24 marks + the rows) with ${st.bases.length} bases; the whole run took ${(runMs / 1000).toFixed(0)} s (${(runMs / days).toFixed(0)} ms a day)`);
  check(dayMs < runMs / days / 20, `the recorder costs under 5% of a day's simulation (${(dayMs * 100 / (runMs / days)).toFixed(2)}%)`);
}
const hjson = JSON.stringify(historyOf(st));
console.log(`  history after ${days} days: ${kb(hjson.length)} (${list.length} base series + the colony)`);

// ---------- determinism ----------
section("It never changes the world");
{
  const dd = 25;
  // One world after the other: ids come from one counter for the whole process (world.js newId), so a world made
  // while another still runs would number its parties differently (localId), and the dice keyed by them (road
  // blockages, roadblocks.js) would differ for that reason alone.
  const A = createWorld({ seed: 7, factionCount: 6 });
  setAutopilot(A, true, "balanced");
  while (day(A) <= dd && !A.gameOver) tickHour(A);
  const B = createWorld({ seed: 7, factionCount: 6 });
  setAutopilot(B, true, "balanced");
  while (day(B) <= dd && !B.gameOver) { delete B.history; tickHour(B); }
  check(A.rng.state === B.rng.state, "the same dice with and without the history (history thrown away every hour)");
  check(JSON.stringify(A.log.map((l) => l.text)) === JSON.stringify(B.log.map((l) => l.text)), "the same log");
  check(JSON.stringify(hub(A).stock) === JSON.stringify(hub(B).stock) && alive(A).length === alive(B).length, "the same stocks and people");
}

// ---------- compaction ----------
section("Compaction");
{
  const cols = ["day", "span", "s_food", "hivesDestroyed"];
  const rs = [];
  for (let d = 1; d <= 300; d++) { rs.push([d, 1, d * 2, Math.floor(d / 50)]); compact(rs, cols); }
  const n = (sp) => rs.filter((x) => x[1] === sp).length;
  check(n(1) > HISTORY.DAILY_KEEP - 7 && n(1) <= HISTORY.DAILY_KEEP, `the last ${HISTORY.DAILY_KEEP - 6}–${HISTORY.DAILY_KEEP} days stay daily (${n(1)})`);
  check(rs.reduce((a, x) => a + x[1], 0) === 300 && rs.every((x, i) => i === 0 || x[0] === rs[i - 1][0] + rs[i - 1][1]), "spans add up and the days follow on");
  const w = rs.find((x) => x[1] === 7);
  check(w && w[0] === 1 && w[2] === 8 && w[3] === 0, `a week is the average of its days, counters keep the last (${w})`);
  const w8 = rs.find((x) => x[0] === 50);
  check(w8 && w8[1] === 7 && w8[3] === 1, `the counter keeps the week's last value (${w8})`);
  for (let d = 301; d <= 1500; d++) { rs.push([d, 1, d * 2, 0]); compact(rs, cols); }
  check(n(1) > HISTORY.DAILY_KEEP - 7 && n(1) <= HISTORY.DAILY_KEEP && n(7) > HISTORY.WEEKLY_KEEP - 4 && n(7) <= HISTORY.WEEKLY_KEEP && n(28) > 0, `after 1,500 days: ${n(1)} daily, ${n(7)} weekly, ${n(28)} of 28 days (${rs.length} rows)`);
  const m = rs.find((x) => x[1] === 28);
  check(m && m[2] === (m[0] * 2 + 27), `a 28-day row is the average of its days (${m})`);
}

// ---------- saves ----------
section("Saves");
{
  const A = createWorld({ seed: 11, factionCount: 5 });
  setAutopilot(A, true, "balanced");
  while (day(A) <= 12) tickHour(A);
  while (A.hour % 24 !== 7) tickHour(A); // mid-day: the day's flows so far go into the save
  A.cards.length = 0;
  const text = saveToString(A);
  const B = loadFromString(text);
  const idAtLoad = peekNextId(); // the id counter is the module's: B plays on from the same ids, as a loaded game in its own tab would
  const end = day(A) + 6;
  while (day(A) <= end && !A.gameOver) tickHour(A);
  setNextId(idAtLoad);
  while (day(B) <= end && !B.gameOver) tickHour(B);
  check(JSON.stringify(historyOf(A)) === JSON.stringify(historyOf(B)), "saved and loaded mid-day, the history plays on exactly as the original's");
  // A save from before the Ledger: no history in it.
  const C = createWorld({ seed: 12, factionCount: 5 });
  while (day(C) <= 9) tickHour(C);
  while (C.hour % 24 !== 15) tickHour(C);
  delete C.history;
  C.cards.length = 0;
  const D = loadFromString(saveToString(C));
  check(!historyOf(D), "an older save loads without a history");
  const uiD = { started: true };
  screenOk(ledgerModal(D, uiD), "Ledger with no history");
  tickHour(D);
  check(historyOf(D) && historyOf(D).from === day(D) && historyOf(D).all.rows.length === 0, `its history starts on the day it was loaded (day ${historyOf(D) && historyOf(D).from})`);
  while (D.hour % 24 !== 1) tickHour(D);
  check(historyOf(D).all.rows.length === 1, "and writes its first row at midnight");
  screenOk(ledgerModal(D, uiD), "Ledger after a loaded day");
  check(ledgerModal(D, uiD).includes("loaded on day"), "the Ledger says when the history starts");
}

// ---------- the facts ----------
section("Causes, the worst day, the best people, events");
{
  const cases = [["of hunger at Fallon", "hunger"], ["of thirst on the road", "thirst"], ["of the worm", "worm"], ["when Ann turned (the worm)", "worm"],
    ["of an infected wound at Fallon", "illness"], ["of pneumonia", "illness"], ["defending Fallon", "people"], ["in a fight with Red Hand", "people"],
    ["fighting the horde at Fallon", "dead"], ["bitten in a crashed ambulance in Oakhurst", "dead"], ["firebombing a hive", "dead"], ["the blizzard", "cold"],
    ["drowned crossing the river", "cold"], ["by their own hand at Fallon", "despair"], ["walking out into the dead from Fallon", "despair"], ["what they did", "other"]];
  const bad = cases.filter(([t, k]) => causeOf(t).key !== k);
  check(!bad.length, `causes of death sort into their kinds (${bad.map(([t, k]) => `"${t}" → ${causeOf(t).key}, not ${k}`).join("; ")})`);
  const W = createWorld({ seed: 5, factionCount: 4 });
  while (day(W) <= 6) tickHour(W);
  const ppl = alive(W);
  killSurvivor(W, ppl[0], hub(W).tile, "of hunger at the hub");
  tickHour(W);
  killSurvivor(W, ppl[1], hub(W).tile, "fighting the horde at the hub");
  killSurvivor(W, ppl[2], hub(W).tile, "fighting the horde at the hub");
  const dc = deathsByCause(W);
  check(dc[0].key === "horde" && dc[0].n === 2 && dc.some((c) => c.key === "hunger" && c.n === 1), `deaths by cause from the memorial wall (${dc.map((c) => `${c.label} ${c.n}`).join(", ")})`);
  const wd = worstDay(W);
  check(wd && wd.kind === "deaths" && wd.n >= 2 && wd.day === day(W), `the worst day is the one with most deaths (day ${wd && wd.day}, ${wd && wd.n})`);
  const html = runSummaryHTML(W, { live: true });
  screenOk(html, "run summary mid-run");
  check(/Longest with the group/.test(html) && /Top skill/.test(html) && /Deaths by cause/.test(html) && /The worst day/.test(html), "the summary has the best people, the worst day and deaths by cause");
  check(html.includes('data-action="tl-open"'), "and Watch the timelapse");
  const ev = notableEvents(st, 14);
  check(ev.length > 0 && ev.length <= 14 && ev.every((e, i) => i === 0 || e.h >= ev[i - 1].h), `notable events: ${ev.length}, in time order`);
  check(ev.every((e) => e.kind !== "world"), "no news from beyond your sight mid-run");
}

// ---------- the screens ----------
section("Screens, the top bar and the key");
{
  const ui2 = { started: true, speed: 0, scale: 1, ledger: true };
  for (const r of RANGES) for (const b of ["all", ...list.map((s) => s.id)]) {
    ui2.ledgerPrefs = { base: b, range: r[0], tab: "ledger" };
    const html = ledgerModal(st, ui2);
    screenOk(html, `Ledger ${b} ${r[1]}`);
  }
  ui2.ledgerPrefs = { base: "all", range: 90, tab: "ledger" };
  const lh = ledgerModal(st, ui2);
  check(FLOW_KEYS.filter((g) => /data-chart="[^"]*-food"/.test(lh)).length > 0 && (lh.match(/<canvas/g) || []).length >= 10, `the Ledger has chart rows (${(lh.match(/<canvas/g) || []).length} canvases)`);
  check(/Population/.test(lh) && /Mood/.test(lh) && /Heat/.test(lh) && /Hives/.test(lh) && /Land/.test(lh), "people, mood, Heat, hives and land rows for all bases");
  ui2.ledgerPrefs = { base: String(h0.id), range: 30, tab: "ledger" };
  const one = ledgerModal(st, ui2);
  check(!/>Hives</.test(one) && /People/.test(one), "a base alone has no colony rows");
  LEDGER_ACTIONS["ld-tab"](st, ui2, { t: "summary" });
  screenOk(ledgerModal(st, ui2), "Ledger summary tab");
  check(renderModal(st, ui2) && /ledgerbox/.test(renderModal(st, ui2)), "the Ledger is the window on screen while it is open");
  LEDGER_ACTIONS["ld-close"](st, ui2, {});
  check(!ui2.ledger, "Close shuts it");
  // Keys: E opens and closes; J / R from the Ledger hand over to the diary / roster.
  const key = (code, modal) => ledgerKey(st, ui2, { code, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false }, modal);
  check(key("KeyE", null) && ui2.ledger, "E opens the Ledger");
  check(key("KeyE", "ledger") && !ui2.ledger, "E again closes it");
  check(!key("KeyE", "card") && !ui2.ledger, "not over a card");
  ui2.ledger = true;
  check(!key("KeyJ", "ledger") && !ui2.ledger, "J closes the Ledger and leaves the diary to its own key");
  // The top bar.
  const tb = topbarParts(st, { started: true, speed: 0, scale: 1 });
  check(/class="trend (good|danger|muted)">[▲▼–]/.test(tb.stock) && /data-tip-spark="[\d.,]+"/.test(tb.stock), "the stock chips have a trend arrow and a sparkline");
  check(/data-action="ld-open"/.test(tb.tools), "the top bar has the 📈 Ledger button");
  const tr = stockTrend(st, h0.id, "food");
  check(tr && tr.spark.length === 15 && Number.isFinite(tr.delta), `food trend: ${tr && tr.delta} over the last day, 15 points`);
  const ch = stockChipTrend(st, h0, "food");
  check(ch.arrow.includes(tr.delta > 0 ? "▲" : tr.delta < 0 ? "▼" : "–") || ch.arrow.includes("–"), `the arrow follows the change (${ch.arrow.replace(/<[^>]+>/g, "").trim()})`);
  // The end screens.
  for (const s of alive(st)) killSurvivor(st, s, hub(st) ? hub(st).tile : null, "of hunger at the end");
  check(st.gameOver, "everyone gone: game over");
  const over = renderModal(st, { started: true });
  screenOk(over, "game-over screen");
  check(/The holdout has fallen/.test(over) && /Timeline/.test(over) && /Deaths by cause/.test(over) && /data-action="ld-open"/.test(over) && /data-action="tl-open"/.test(over), "the fall shows the run summary, the Ledger and the timelapse");
  check((over.match(/data-action="tl-open"/g) || []).length === 1, "one Watch the timelapse button");
  const pop = column(st, "all", "pop");
  check(/Day \d+ \(the end\) · <b>0<\/b> alive/.test(over), `the timeline ends with nobody alive (${(/data-read="rs-pop">([^<]*<b>[^<]*<\/b>[^<]*)/.exec(over) || [])[1]})`);
  check(renderModal(st, { started: true, ledger: true }).includes("ledgerbox"), "the Ledger opens over the end screen");
  const V = createWorld({ seed: 3, factionCount: 3 });
  while (day(V) <= 3) tickHour(V);
  V.gameOver = true; V.victory = true; V.victoryReason = "hives";
  const vic = renderModal(V, { started: true });
  screenOk(vic, "victory screen");
  check(/Every hive is destroyed/.test(vic) && /Timeline/.test(vic) && /keepplaying/.test(vic), "the victory screen has the summary and Keep playing");
  void pop;
}

// ---------- docs ----------
section("Help and README");
{
  const t = helpTopics().find((x) => x.id === "ledger-and-run-summary");
  check(!!t && t.html === ledgerHelp(), "Help has the Ledger and run summary topic");
  check(helpTopics().some((x) => /Ledger/.test(x.html) && x.id === "keys-on-the-map"), "Keys on the map lists E");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  check(readme.includes("| E |") && /Ledger/.test(readme) && /historytest/.test(readme), "the README lists E, the Ledger and this test");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
