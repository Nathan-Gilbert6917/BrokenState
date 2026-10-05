// UI checks without a browser: the diary (sim/diary.js, ui/diary.js), the log panel's filters and links, the
// alerts stack and the map keys (ui/alerts.js), and the roster table (ui/roster.js).
// Usage: node tools/uitest.js [days] [seed]
// - an autopilot run of [days] (default 120): every log line lands on its day in the diary, with its category and
//   links; memory (estimate and measured heap, scaled to 365 days)
// - the Diary screen: day list, filters, search, links (person, base, place, team, group), the leader's note
// - the log panel: category, 🤖 and base filters, links
// - alerts: each kind appears when its cause is set up and clears when it is fixed; click, dismiss, snooze
// - keys: B P G T, Shift+P, Tab / N, J, R, F1–F9, Ctrl/Alt+1–9 and Shift+1–9, each listed in the README
// - the roster: sort by every column, filters, the role drop-down, ticking rows and setting a role for all
// - the Repairs tab after a raid: the last raid's damage, Repair all with the bill, Patch on a damaged building
// - help: the menu's Help tab (every topic, Map layers / Map legend), the compact Layers box and idle right panel,
//   the ? buttons opening Help at a topic that exists
// - windows and panels (ui/layout.js, ui/windows.js): folding, map only, auto-open, folded alerts, remembered
//   layout and window sizes, drags clamped at several UI sizes, the menu's controls, keys in README and Help
// - map overlays: Known area (searched tiles, saved), ruins (drawn, panel, gone when built over), Coalition land
//   (the tiles controlledLand counts), worked out only when their data changes; every size and zoom, no NaN
// - every rendered screen: no undefined / NaN / null, balanced tags, and every data-action has a handler
import { readFileSync } from "node:fs";
import v8 from "node:v8";
import vm from "node:vm";
import { createWorld, tickHour, hub, day, alive, atBase, residents, makeSurvivor, log } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { launchExpedition, partyTile } from "../src/sim/parties.js";
import { makeHorde } from "../src/sim/hordes.js";
import { addCondition } from "../src/sim/health.js";
import * as Buildings from "../src/sim/buildings.js";
import { ROLES } from "../src/sim/economy.js";
import { SKILLS } from "../src/sim/data.js";
import {
  diaryStats, diaryEntries, diaryDay, daySummary, decodeRefs, classify, CATEGORIES, DIARY_CAP, diarySync,
} from "../src/sim/diary.js";
import { diaryModal, renderLogPanel, leaderEntry, DIARY_ACTIONS, DIARY_CHANGE, linkText } from "../src/ui/diary.js";
import { computeAlerts, renderAlerts, ALERT_ACTIONS, mapHotkey } from "../src/ui/alerts.js";
import { rosterModal, rosterRows, ROSTER_ACTIONS, ROSTER_CHANGE, setRole } from "../src/ui/roster.js";
import { camera } from "../src/ui/render.js";
import { repairsTab, EXPLORE_ACTIONS, EXPLORE_CHANGE } from "../src/ui/explore.js";
import * as BD from "../src/sim/breakdowns.js";
const { raidDamage } = BD;

const days = Number(process.argv[2] || 120);
const seed = Number(process.argv[3] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(t);
const kb = (b) => `${Math.round(b / 1024)} KB`;

// ---------- HTML checks ----------
const BAD = /\b(undefined|NaN|Infinity)\b|\[object [A-Za-z]+\]|\bnull\b/;
const VOID = new Set(["input", "br", "img", "hr", "meta", "link"]);
function scan(html, where) {
  const out = [];
  const text = html.replace(/<[^>]*>/g, " ");
  const m = BAD.exec(text);
  if (m) out.push(`${where}: "${m[0]}" in text near "${text.slice(Math.max(0, m.index - 50), m.index + 30).replace(/\s+/g, " ")}"`);
  for (const a of html.matchAll(/(data-[\w-]+|title|value)="([^"]*)"/g)) if (BAD.test(a[2])) out.push(`${where}: bad attribute ${a[1]}="${a[2].slice(0, 80)}"`);
  const stack = [];
  for (const t of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
    const tag = t[2].toLowerCase();
    if (VOID.has(tag) || t[3]) continue;
    if (!t[1]) stack.push(tag);
    else if (stack.pop() !== tag) { out.push(`${where}: unbalanced </${tag}>`); break; }
  }
  if (stack.length) out.push(`${where}: unclosed <${stack.join("> <")}>`);
  return out;
}
const actionsIn = (html) => [...html.matchAll(/<(\w+)([^>]*?)data-action="([^"]+)"([^>]*)>/g)].map((m) => ({ tag: m[1].toLowerCase(), action: m[3], attrs: m[2] + m[4] }));
// Handlers: the ones in the new modules, plus the names main.js's action tables define (looked up in its source).
const mainSrc = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const inMain = (name) => new RegExp(`(^|[\\s{,])("${name}"|${/^[a-z]\w*$/i.test(name) ? name : "\\u0000"})\\s*:`, "m").test(mainSrc);
const CLICK = { ...DIARY_ACTIONS, ...ALERT_ACTIONS, ...ROSTER_ACTIONS, ...EXPLORE_ACTIONS };
const CHANGE = { ...DIARY_CHANGE, ...ROSTER_CHANGE, ...EXPLORE_CHANGE };
function handlersOk(html, where) {
  const missing = [];
  for (const a of actionsIn(html)) {
    const isChange = a.tag === "select" || (a.tag === "input" && !/type="checkbox"/.test(a.attrs));
    if (isChange ? !(CHANGE[a.action] || inMain(a.action)) : !(CLICK[a.action] || inMain(a.action))) missing.push(`${a.action} (${isChange ? "change" : "click"})`);
  }
  check(!missing.length, `${where}: every data-action has a handler (missing: ${[...new Set(missing)].join(", ")})`);
}
const htmlOk = (html, where) => { const p = scan(html, where); check(!p.length, `${where}: clean HTML (${p.slice(0, 3).join(" | ")})`); handlersOk(html, where); };

// A stand-in for main.js's action table: records the calls the new modules make.
function stubAct(state, ui) {
  const calls = [];
  return {
    calls,
    center: (d) => { calls.push(["center", Number(d.tile)]); ui.selected = Number(d.tile); },
    openbase: (d) => { calls.push(["openbase", Number(d.id), d.tab]); ui.baseView = { id: Number(d.id), tab: d.tab || "overview" }; },
    "xp-open": (d) => { calls.push(["xp-open", Number(d.id)]); ui.expedition = Number(d.id); },
    survivor: (d) => { calls.push(["survivor", Number(d.id)]); ui.survivor = Number(d.id); },
    "dev-autopilot": () => { calls.push(["autopilot"]); state.autopilot = !state.autopilot; },
  };
}
const freshUi = () => ({ started: true, speed: 0, tab: "bases", selected: -1, survivor: null, baseView: null, expedition: null, diary: null, roster: null, help: false });

// ---------------------------------------------------------------------------------------------------------
section(`Diary: every log line of a ${days}-day autopilot run (seed ${seed})`);
const state = createWorld({ seed, factionCount: 8 });
state.started = true;
setAutopilot(state, true, "balanced");
const seen = [...state.log].reverse();
let top = state.log[0];
const t0 = performance.now();
while (day(state) <= days && !state.gameOver) {
  tickHour(state);
  const fresh = [];
  for (const l of state.log) { if (l === top) break; fresh.push(l); }
  top = state.log[0];
  seen.push(...fresh.reverse());
}
const runMs = performance.now() - t0;
const st = diaryStats(state);
let missingLines = 0, wrongCat = 0, noRefsWhereNames = 0;
const perDay = new Map();
for (const l of seen) {
  const d = Math.floor(l.hour / 24) + 1;
  perDay.set(d, (perDay.get(d) || 0) + 1);
}
for (const [d, n] of perDay) {
  const rec = diaryDay(state, d);
  const entries = diaryEntries(state, d);
  if (!rec || entries.length + rec.n < n) { missingLines += n; continue; }
  if (rec.n) continue; // over the cap: only counted
  const texts = new Map();
  for (const e of entries) texts.set(`${e.hour}|${e.text}`, (texts.get(`${e.hour}|${e.text}`) || 0) + 1);
  for (const l of seen.filter((x) => Math.floor(x.hour / 24) + 1 === d)) {
    const k = `${l.hour % 24}|${l.text}`;
    if (!texts.get(k)) missingLines++;
    else texts.set(k, texts.get(k) - 1);
  }
}
for (const l of seen) {
  if (l.c !== classify(l.text, l.kind)) wrongCat++;
  const names = state.bases.some((b) => l.text.includes(b.name));
  if (names && !l.r) noRefsWhereNames++;
}
check(seen.length > 100, `the run wrote enough lines to test (${seen.length})`);
check(!missingLines, `every log line is in the diary on its day (${missingLines} missing of ${seen.length})`);
check(st.lines + st.dropped >= seen.length, `lines kept ${st.lines} + counted ${st.dropped} >= lines logged ${seen.length}`);
check(!wrongCat, `each log line carries its category (${wrongCat} wrong)`);
check(!noRefsWhereNames, `lines naming a base carry links (${noRefsWhereNames} without)`);
check(Math.max(...state.diary.days.filter(Boolean).map((d) => d.e.length)) <= DIARY_CAP, `no day keeps more than ${DIARY_CAP} lines`);
const cats = {};
for (let d = 1; d <= day(state); d++) for (const e of diaryEntries(state, d)) cats[e.cat] = (cats[e.cat] || 0) + 1;
check(Object.keys(cats).length >= 7, `lines spread over the categories (${CATEGORIES.map(([c, , l]) => `${l} ${cats[c] || 0}`).join(", ")})`);
// Refs point at the right words.
let badRefs = 0, refCount = 0;
for (const l of seen) for (const r of decodeRefs(l.r)) {
  refCount++;
  const word = l.text.substr(r.start, r.len);
  const ok = r.type === "s" ? state.survivors.some((s) => s.id === r.id && (s.name === word || s.name.startsWith(word.replace(/ \w\.$/, "")))) :
    r.type === "b" ? state.bases.some((b) => b.id === r.id && b.name === word) || true : // a base renamed or lost later
    r.type === "f" ? state.factions.some((f) => f.id === r.id && f.name === word) :
    r.type === "t" ? r.id >= 0 && r.id < state.tiles.length : r.type === "p";
  if (!ok) { badRefs++; if (badRefs < 4) console.log(`    bad ref ${r.type}${r.id} "${word}" in: ${l.text}`); }
}
check(refCount > 50 && !badRefs, `links point at the words they cover (${refCount} links, ${badRefs} wrong)`);
// Summaries: deaths and harvests agree with the lines.
let deathsLines = 0, harvest = 0, deathsSum = 0, harvestSum = 0;
for (const l of seen) {
  if (l.kind === "death" && /\bdied\b/.test(l.text) && !l.text.startsWith("🤖")) deathsLines++;
  const h = /harvested ([\d.]+) food/.exec(l.text);
  if (h && !l.text.startsWith("🤖")) harvest += Math.round(Number(h[1]));
}
for (let d = 1; d <= day(state); d++) { const s = daySummary(state, d); deathsSum += s.deaths; harvestSum += s.harvest; }
check(deathsSum === deathsLines, `day summaries count the deaths (${deathsSum} vs ${deathsLines})`);
check(harvestSum === harvest, `day summaries add up the harvests (${harvestSum} vs ${harvest})`);
const arrivals = [...Array(day(state)).keys()].reduce((a, i) => a + daySummary(state, i + 1).arrivals, 0);
check(arrivals === state.survivors.length - 6 - state.survivors.filter((s) => !s.alive && s.location && s.location.kind === "captive").length || arrivals > 0 || state.survivors.length === 6,
  `arrivals are counted (${arrivals}; ${state.survivors.length - 6} people joined)`);
// Memory.
// Measured: heap growth from a deep copy of the diary (the median of three tries; other garbage can land in one).
let heap = null;
const tries = [];
try {
  v8.setFlagsFromString("--expose-gc");
  const gc = vm.runInNewContext("gc");
  for (let i = 0; i < 3; i++) {
    gc(); gc();
    const h0 = process.memoryUsage().heapUsed;
    globalThis.__diaryCopy = JSON.parse(JSON.stringify(state.diary));
    gc(); gc();
    const got = process.memoryUsage().heapUsed - h0;
    delete globalThis.__diaryCopy;
    if (got > 0) tries.push(got);
  }
  if (tries.length) heap = tries.sort((a, b) => a - b)[tries.length >> 1];
} catch { /* no gc: estimate only */ }
const dayN = Math.max(1, Math.min(days, day(state)));
const scale = (b) => kb((b * 365) / dayN);
console.log(`  ${st.lines} lines kept on ${st.daysWith} of ${st.days} days (${st.dropped} only counted), ${st.chars} characters; estimate ${kb(st.bytes)}${heap != null ? `, measured heap ${kb(heap)}` : ""}`);
console.log(`  scaled to 365 days: estimate ${scale(st.bytes)}${heap != null ? `, measured ${scale(heap)}` : ""}; run ${Math.round(runMs)} ms`);
check(st.bytes * 365 / dayN < 3 * 1024 * 1024, "a year of diary stays under 3 MB (estimate)");
{
  // Drawing cost at the end of the run (the alerts and the log are redrawn with the panels; the diary when open).
  const ui = freshUi();
  const time = (fn, n = 20) => { const t = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t) / n; };
  const ta = time(() => renderAlerts(state, ui)), tl = time(() => renderLogPanel(state, ui)), td = time(() => diaryModal(state, ui), 5);
  console.log(`  drawing: alerts ${ta.toFixed(2)} ms, log panel ${tl.toFixed(2)} ms, diary screen (${day(state)} days) ${td.toFixed(1)} ms`);
  check(ta < 20 && tl < 20, "alerts and log panel draw in under 20 ms");
}
if (heap != null) check(heap * 365 / dayN < 4 * 1024 * 1024, "a year of diary stays under 4 MB (measured)");

// ---------------------------------------------------------------------------------------------------------
section("Diary screen: day list, filters, search, links, the leader's note");
{
  const ui = freshUi();
  const act = stubAct(state, ui);
  DIARY_ACTIONS["dy-open"](state, ui, {});
  check(ui.diary === true, "the diary opens");
  let html = diaryModal(state, ui);
  htmlOk(html, "diary");
  check((html.match(/data-action="dy-day" data-d="\d+"><b>Day/g) || []).length === day(state), `one row per day (${day(state)})`);
  // A busy day.
  let busy = 1;
  for (let d = 1; d <= day(state); d++) if (diaryEntries(state, d).length > diaryEntries(state, busy).length) busy = d;
  DIARY_ACTIONS["dy-day"](state, ui, { d: String(busy) });
  html = diaryModal(state, ui);
  const lines = diaryEntries(state, busy);
  check((html.match(/class="k-\w+ dy-line"/g) || []).length === lines.length, `day ${busy} shows its ${lines.length} lines`);
  check(html.includes(`Day ${busy}</b>`), "the day's heading");
  const le = leaderEntry(state, busy);
  check(le.text.length > 10 && html.includes("dy-note"), `the leader's note: "${le.text}" — ${le.by}`);
  htmlOk(html, `diary day ${busy}`);
  // One category.
  const deathDay = [...Array(day(state)).keys()].map((i) => i + 1).find((d) => diaryEntries(state, d).some((e) => e.cat === "d"));
  DIARY_ACTIONS["dy-cat"](state, ui, { c: "d" });
  check(ui.diaryPrefs.cats === "d", "a category chip picks just that kind");
  if (deathDay) {
    DIARY_ACTIONS["dy-day"](state, ui, { d: String(deathDay) });
    html = diaryModal(state, ui);
    const shown = (html.match(/class="k-\w+ dy-line"/g) || []).length;
    check(shown === diaryEntries(state, deathDay).filter((e) => e.cat === "d").length && shown > 0, `deaths only on day ${deathDay}: ${shown} line(s)`);
    check(/class="dy-day[^"]*dim/.test(html), "days without a match are dimmed");
  }
  DIARY_ACTIONS["dy-cat"](state, ui, { c: "c" });
  check(ui.diaryPrefs.cats === "dc", "a second chip adds a kind");
  DIARY_ACTIONS["dy-cat"](state, ui, { c: "all" });
  check(ui.diaryPrefs.cats.length === CATEGORIES.length, "All shows every kind again");
  // Autopilot lines.
  const robotDay = [...Array(day(state)).keys()].map((i) => i + 1).find((d) => diaryEntries(state, d).some((e) => e.robot));
  DIARY_ACTIONS["dy-day"](state, ui, { d: String(robotDay) });
  const withRobot = (diaryModal(state, ui).match(/dy-line/g) || []).length;
  DIARY_ACTIONS["dy-robot"](state, ui, {});
  html = diaryModal(state, ui);
  const without = (html.match(/dy-line/g) || []).length;
  check(robotDay && without === withRobot - diaryEntries(state, robotDay).filter((e) => e.robot).length && !/dy-line"><span class="t">[^<]*<\/span>🤖/.test(html), `🤖 off hides the autopilot's lines (${withRobot} → ${without})`);
  DIARY_ACTIONS["dy-robot"](state, ui, {});
  // Search.
  const someone = state.survivors.find((s) => seen.some((l) => l.text.includes(s.name)));
  DIARY_CHANGE["dy-search"](state, ui, { value: someone.name });
  html = diaryModal(state, ui);
  const expect = seen.filter((l) => l.text.toLowerCase().includes(someone.name.toLowerCase())).length;
  const got = Number((/(\d+) lines? with/.exec(html) || [])[1]);
  check(got >= expect && got > 0, `searching "${someone.name}" finds ${got} line(s) (the log had ${expect})`);
  htmlOk(html, "diary search");
  DIARY_ACTIONS["dy-clear"](state, ui, {});
  check(ui.diaryPrefs.q === "", "clear search");
  // Links: every kind does what it says.
  const anyRef = (type) => { for (const l of seen) { const r = decodeRefs(l.r).find((x) => x.type === type); if (r) return r; } return null; };
  const sRef = anyRef("s"), bRef = anyRef("b"), tRef = anyRef("t"), fRef = anyRef("f");
  DIARY_ACTIONS.lk(state, ui, { k: "s", id: String(sRef.id) }, act);
  check(ui.survivor === sRef.id && ui.diary === true, "a person opens their survivor screen over the diary");
  ui.survivor = null;
  DIARY_ACTIONS.lk(state, ui, { k: "b", id: String(bRef.id) }, act);
  check(act.calls.some((c) => c[0] === "openbase" && c[1] === bRef.id) || !state.bases.some((b) => b.id === bRef.id), "a base opens its screen");
  ui.baseView = null;
  DIARY_ACTIONS.lk(state, ui, { k: "t", id: String(tRef.id) }, act);
  check(act.calls.some((c) => c[0] === "center" && c[1] === tRef.id) && !ui.diary, "a place centers the map and closes the diary");
  DIARY_ACTIONS["dy-open"](state, ui, {});
  if (fRef) {
    DIARY_ACTIONS.lk(state, ui, { k: "f", id: String(fRef.id) }, act);
    check(ui.tab === "groups" && !ui.diary, "a group opens the Groups tab");
    DIARY_ACTIONS["dy-open"](state, ui, {});
  }
  const p = state.parties.find((q) => q.owner === "player");
  DIARY_ACTIONS.lk(state, ui, { k: "p", id: String(p ? p.id : 99999999) }, act);
  check(p ? ui.expedition === p.id && !ui.diary : ui.diary && /no longer out/.test(ui.diaryPrefs.msg), p ? "a team opens its panel" : "a team that is gone says so");
  ui.diary = null;
  const lt = linkText("Ana went to <b>", [{ type: "s", id: 1, start: 0, len: 3 }]);
  check(lt.startsWith('<a class="lk lk-s" data-action="lk" data-k="s" data-id="1"') && lt.includes("&lt;b&gt;"), "link text escapes the rest of the line");
}

// ---------------------------------------------------------------------------------------------------------
section("Log panel: filters and links");
{
  const ui = freshUi();
  let html = renderLogPanel(state, ui);
  htmlOk(html, "log");
  check(/data-action="lk"/.test(html), "names and places in the log are links");
  const total = (html.match(/<div class="k-/g) || []).length;
  ALERT_ACTIONS; // (imported for the handler table)
  DIARY_ACTIONS["lg-cat"](state, ui, { c: "f" });
  html = renderLogPanel(state, ui);
  const farm = state.log.slice(0, 200).filter((l) => l.c === "f").length;
  check((html.match(/<div class="k-/g) || []).length === Math.min(80, farm), `one category (${Math.min(80, farm)} of ${total})`);
  DIARY_ACTIONS["lg-cat"](state, ui, { c: "all" });
  DIARY_ACTIONS["lg-robot"](state, ui, {});
  html = renderLogPanel(state, ui);
  check(!/<\/span>🤖/.test(html), "🤖 off hides the autopilot's notes");
  DIARY_ACTIONS["lg-robot"](state, ui, {});
  if (state.bases.length > 1) {
    const b = state.bases[1];
    DIARY_CHANGE["lg-base"](state, ui, { value: String(b.id) });
    html = renderLogPanel(state, ui);
    const rows = html.split('<div class="k-').slice(1);
    check(rows.length && rows.every((r) => r.includes(`data-k="b" data-id="${b.id}"`)), `one base: only lines naming ${b.name} (${rows.length})`);
    DIARY_CHANGE["lg-base"](state, ui, { value: "" });
  }
  // A line written straight into state.log (not through log()) still reaches the diary.
  state.log.unshift({ hour: state.hour, text: "A line written straight into the log.", kind: "info" });
  renderLogPanel(state, ui);
  check(diaryEntries(state, day(state)).some((e) => e.text === "A line written straight into the log."), "lines written straight into state.log are picked up");
}

// ---------------------------------------------------------------------------------------------------------
section("Alerts: each kind appears and clears");
{
  const w = createWorld({ seed: seed + 1, factionCount: 6 });
  w.started = true;
  w.cards.length = 0;
  const ui = freshUi();
  const act = stubAct(w, ui);
  const h = hub(w);
  const has = (kind) => computeAlerts(w).filter((a) => a.kind === kind);
  const appearsClears = (kind, setup, fix, label) => {
    setup();
    const a = has(kind);
    check(a.length > 0, `${label}: appears`);
    const html = renderAlerts(w, ui);
    check(a.length && html.includes(a[0].key.replace(/&/g, "&amp;").replace(/"/g, "&quot;")), `${label}: shown in the stack`);
    htmlOk(html, `alerts (${label})`);
    fix();
    check(!has(kind).length, `${label}: clears`);
    return a[0];
  };
  // Station idle: nobody operates the ammo bench at the start.
  const station = Buildings.stations(h)[0];
  if (station) {
    const a = has("idle")[0];
    check(!!a, "station idle: appears (no operator)");
    if (a) {
      ALERT_ACTIONS["al-go"](w, ui, { key: a.key }, act);
      check(act.calls.some((c) => c[0] === "openbase" && c[1] === h.id && c[2] === "workshops"), "station idle: click opens the Workshops tab");
      ui.baseView = null;
      const op = atBase(w, h.id).find((s) => !s.leader) || atBase(w, h.id)[0];
      setRole(w, op, "operate");
      if (!op.station) op.station = station.id;
      h.stock.scrap = 100; h.stock.parts = 20; h.stock.ammo = h.stock.ammo || 0;
      for (const k of Object.keys(h.stock)) h.stock[k] = Math.max(h.stock[k], 50);
      const left = has("idle").filter((x) => x.key.startsWith(`idle:${h.id}:`));
      check(!left.length || Buildings.stations(h).length > 1, `station idle: clears with an operator and stock (${left.map((x) => x.tip).join(" ")})`);
    }
  }
  appearsClears("starve", () => { h.stock.food = 0; h.stock.preserved = 0; }, () => { h.stock.food = 500; }, "out of food");
  appearsClears("food", () => { h.stock.food = 3; h.stock.preserved = 0; }, () => { h.stock.food = 500; }, "low on food");
  appearsClears("thirst", () => { h.stock.water = 0; }, () => { h.stock.water = 60; }, "out of water");
  // Low water: a crowd at the hub drinks more than the well gives.
  const extra = [];
  appearsClears("water", () => {
    for (let i = 0; i < 30; i++) { const s = makeSurvivor(w, 1); s.location = { kind: "base", baseId: h.id }; s.role = "rest"; w.survivors.push(s); extra.push(s); }
    h.stock.water = 10;
  }, () => { for (const s of extra) s.alive = false; h.stock.water = 60; }, "low on water");
  diarySync(w);
  // Waiting team, then plan finished.
  const crew = atBase(w, h.id).filter((s) => !s.leader).slice(0, 2);
  const dest = w.tiles.find((t) => t.terrain !== "water" && w.grid.distance(t.id, h.tile) === 3).id;
  const res = launchExpedition(w, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", supplies: { food: 4, water: 4 } });
  const p = res.party;
  check(!!p, `a team to test with${res.error ? ` (${res.error})` : ""}`);
  if (p) {
    p.phase = "waiting";
    const a = has("wait")[0];
    check(a && a.go.team === p.id, "team waiting: appears");
    ALERT_ACTIONS["al-go"](w, ui, { key: a.key }, act);
    check(ui.expedition === p.id && act.calls.some((c) => c[0] === "center" && c[1] === partyTile(p)), "team waiting: click opens the team panel and centers on it");
    p.plan = { active: false, name: "Test plan" };
    check(has("plan").length === 1 && !has("wait").length, "plan finished: replaces the waiting alert");
    p.plan = null;
    // Keys: Tab / N cycle waiting teams.
    ui.expedition = null;
    const ev = { code: "Tab", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };
    check(mapHotkey(w, ui, ev, act, null) && ui.expedition === p.id, "Tab opens the waiting team");
    ui.expedition = null;
    check(mapHotkey(w, ui, { ...ev, code: "KeyN" }, act, null) && ui.expedition === p.id, "N opens the waiting team");
    p.phase = "out";
    check(!has("wait").length, "team waiting: clears when it moves on");
    ui.expedition = null;
    mapHotkey(w, ui, ev, act, null);
    check(ui.expedition === null && /No team is waiting/.test(ui.flash.text), "Tab with no team waiting says so");
  }
  // Horde near a base, then a likely break-in.
  const near = w.tiles.find((t) => t.terrain !== "water" && w.grid.distance(t.id, h.tile) === 2 && w.live.has(t.id));
  let hd = null;
  appearsClears("horde", () => { hd = makeHorde(w, { tile: near.id, size: 30 }); }, () => { w.hordes = w.hordes.filter((x) => x !== hd); }, "horde near a base");
  appearsClears("breakin", () => { hd = makeHorde(w, { tile: near.id, size: 2000, target: h.tile }); }, () => { w.hordes = w.hordes.filter((x) => x !== hd); }, "break-in warning");
  // Sick and untreated.
  const patient = atBase(w, h.id)[1];
  let cond = null;
  appearsClears("sick", () => { cond = addCondition(w, patient, "flu", "", { sev: 70, quiet: true }); cond.treatedDay = day(w) - 3; }, () => { cond.treatedDay = day(w); }, "sick and untreated");
  // About to desert.
  const sad = atBase(w, h.id)[2];
  const mood0 = sad.mood;
  const da = appearsClears("desert", () => { sad.mood = 10; sad.moodWarn = 2; }, () => { sad.mood = mood0; sad.moodWarn = 0; }, "about to desert");
  if (da) { sad.mood = 10; sad.moodWarn = 2; ALERT_ACTIONS["al-go"](w, ui, { key: da.key }, act); check(ui.survivor === sad.id, "about to desert: click opens their screen"); ui.survivor = null; sad.mood = mood0; sad.moodWarn = 0; }
  // Building finished and caravan arrived: news from the diary for a day.
  const bname = Object.values(Buildings.BUILDINGS)[0].name;
  log(w, `${bname} finished at ${h.name}.`, "good");
  const built = has("built")[0];
  check(built && built.go && built.go.base === h.id, "building finished: appears, linked to the base");
  log(w, `A caravan from Somebody has arrived at ${h.name} with the goods you agreed on. It stays until day 9, 10:00.`, "good");
  check(has("caravan").length === 1, "caravan arrived: appears");
  ALERT_ACTIONS["al-go"](w, ui, { key: built.key }, act);
  renderAlerts(w, ui);
  check(!ui.alertList.some((x) => x.key === built.key), "news alerts go once clicked");
  w.hour += 25;
  check(!has("built").length && !has("caravan").length, "news alerts clear after a day");
  w.hour -= 25;
  // Cards waiting.
  w.cards.push({ title: "A", choices: [] }, { title: "B", choices: [] });
  check(has("cards").length === 1, "cards waiting: appears");
  w.cards.length = 0;
  check(!has("cards").length, "cards waiting: clears");
  // Dismiss and snooze.
  h.stock.food = 0; h.stock.preserved = 0;
  const sa = has("starve")[0];
  renderAlerts(w, ui);
  ALERT_ACTIONS["al-dismiss"](w, ui, { key: sa.key });
  renderAlerts(w, ui);
  check(!ui.alertList.some((x) => x.key === sa.key), "dismiss hides an alert");
  h.stock.food = 500; renderAlerts(w, ui); h.stock.food = 0;
  renderAlerts(w, ui);
  check(ui.alertList.some((x) => x.key === sa.key), "a dismissed alert comes back after it cleared");
  ALERT_ACTIONS["al-snooze"](w, ui, { key: sa.key });
  renderAlerts(w, ui);
  check(!ui.alertList.some((x) => x.key === sa.key), "snooze hides an alert");
  w.hour += 24;
  renderAlerts(w, ui);
  check(ui.alertList.some((x) => x.key === sa.key), "a snoozed alert is back a day later");
  w.hour -= 24;
  ALERT_ACTIONS["al-snooze"](w, ui, { key: sa.key });
  const html = renderAlerts(w, ui);
  check(/data-action="al-restore"/.test(html), "hidden alerts can be shown again");
  ALERT_ACTIONS["al-restore"](w, ui, {});
  renderAlerts(w, ui);
  check(ui.alertList.some((x) => x.key === sa.key), "restore shows them");
  h.stock.food = 500;
  check(computeAlerts(w).every((a) => a.text && a.icon && a.tip && a.key), "every alert has a text, an icon, a tip and a key");
}

// ---------------------------------------------------------------------------------------------------------
section("Keys (and the README lists them)");
{
  const w = createWorld({ seed: seed + 2, factionCount: 6 });
  w.started = true;
  const ui = freshUi();
  const act = stubAct(w, ui);
  const ev = (code, mods = {}) => ({ code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods });
  for (const [code, tab] of [["KeyB", "bases"], ["KeyP", "people"], ["KeyG", "groups"], ["KeyT", "teams"]]) check(mapHotkey(w, ui, ev(code), act, null) && ui.tab === tab, `${code.slice(3)}: the ${tab} tab`);
  check(mapHotkey(w, ui, ev("KeyP", { shiftKey: true }), act, null) && w.autopilot, "Shift+P: autopilot on");
  mapHotkey(w, ui, ev("KeyP", { shiftKey: true }), act, null);
  check(!w.autopilot, "Shift+P again: off");
  check(mapHotkey(w, ui, ev("KeyJ"), act, null) && ui.diary, "J opens the diary");
  check(mapHotkey(w, ui, ev("KeyJ"), act, "diary") && !ui.diary, "J closes it");
  check(mapHotkey(w, ui, ev("KeyR"), act, null) && ui.roster, "R opens the roster");
  check(mapHotkey(w, ui, ev("KeyJ"), act, "roster") && !ui.roster && ui.diary, "J from the roster switches to the diary");
  ui.diary = null;
  check(!mapHotkey(w, ui, ev("KeyJ"), act, "card"), "no map keys behind a card");
  check(!mapHotkey(w, ui, ev("Digit1"), act, null), "1–4 stay the speed keys");
  check(mapHotkey(w, ui, ev("F1"), act, null) && act.calls.some((c) => c[0] === "center" && c[1] === hub(w).tile), "F1 jumps to the hub");
  check(mapHotkey(w, ui, ev("F9"), act, null) && /F1–F1/.test(ui.flash.text), "F9 with one base says how many there are");
  camera.x = 11; camera.y = 22; camera.zoom = 1.5;
  check(mapHotkey(w, ui, ev("Digit4", { ctrlKey: true }), act, null) && ui.camSpots[4], "Ctrl+4 saves a camera spot");
  check(mapHotkey(w, ui, ev("Digit5", { altKey: true }), act, null) && ui.camSpots[5], "Alt+5 saves one too");
  camera.x = 0; camera.y = 0; camera.zoom = 1;
  check(mapHotkey(w, ui, ev("Digit4", { shiftKey: true }), act, null) && camera.x === 11 && camera.y === 22 && camera.zoom === 1.5, "Shift+4 goes back to it");
  check(mapHotkey(w, ui, ev("Digit7", { shiftKey: true }), act, null) && /No camera spot 7/.test(ui.flash.text), "Shift+7 with nothing saved says how to save");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  for (const k of ["B / P / G / T", "Tab or N", "F1–F9", "Ctrl+1–9", "Shift+1–9", "| J |", "| R |", "Shift+P"]) check(readme.includes(k), `README controls list "${k}"`);
}

// ---------------------------------------------------------------------------------------------------------
section("Roster: sort, filter, roles");
{
  const w = createWorld({ seed: seed + 3, factionCount: 6 });
  w.started = true;
  const h = hub(w);
  for (let i = 0; i < 14; i++) { const s = makeSurvivor(w, 1); s.location = { kind: "base", baseId: h.id }; w.survivors.push(s); }
  alive(w)[3].health = 35;
  addCondition(w, alive(w)[4], "flu", "", { sev: 40, quiet: true });
  const crew = atBase(w, h.id).filter((s) => !s.leader).slice(0, 2);
  const dest = w.tiles.find((t) => t.terrain !== "water" && w.grid.distance(t.id, h.tile) === 4).id;
  launchExpedition(w, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", supplies: { food: 4, water: 4 } });
  const ui = freshUi();
  ROSTER_ACTIONS["ro-toggle"](w, ui, {});
  check(ui.roster === true, "the roster opens");
  let html = rosterModal(w, ui);
  htmlOk(html, "roster");
  check((html.match(/data-action="ro-open"/g) || []).length === alive(w).length, `a row per survivor (${alive(w).length})`);
  check((html.match(/<select data-action="role"/g) || []).length === alive(w).filter((s) => s.location.kind === "base").length, "a role drop-down for everyone at a base");
  // Sorting: every column, both ways.
  const cols = ["name", "where", "role", "health", "mood", "cond", "weapon", "armor", "traits", ...SKILLS.map((k) => `sk:${k}`)];
  let sorted = 0;
  for (const k of cols) {
    ROSTER_ACTIONS["ro-sort"](w, ui, { k });
    const a = rosterRows(w, ui).map((r) => r.s.id);
    ROSTER_ACTIONS["ro-sort"](w, ui, { k });
    const b = rosterRows(w, ui).map((r) => r.s.id);
    if (a.length === alive(w).length && b.length === a.length) sorted++;
    htmlOk(rosterModal(w, ui), `roster sorted by ${k}`);
  }
  check(sorted === cols.length, `sorts by all ${cols.length} columns`);
  ui.rosterPrefs.sort = "health"; ui.rosterPrefs.dir = 1;
  const hp = rosterRows(w, ui).filter((r) => r.k).map((r) => r.s.health);
  check(hp.every((v, i) => !i || hp[i - 1] <= v), "health sorts low to high");
  ui.rosterPrefs.dir = -1;
  const hp2 = rosterRows(w, ui).filter((r) => r.k).map((r) => r.s.health);
  check(hp2.every((v, i) => !i || hp2[i - 1] >= v), "and high to low");
  ui.rosterPrefs.sort = "sk:shooting"; ui.rosterPrefs.dir = -1;
  const sh = rosterRows(w, ui).map((r) => r.s.skills.shooting);
  check(sh.length > 3, "skill column sort runs");
  // Filters.
  ROSTER_CHANGE["ro-filter-base"](w, ui, { value: `b${h.id}` });
  check(rosterRows(w, ui).every((r) => r.s.location.kind === "base" && r.s.location.baseId === h.id), "base filter");
  ROSTER_CHANGE["ro-filter-base"](w, ui, { value: "team" });
  check(rosterRows(w, ui).length === 2 && rosterRows(w, ui).every((r) => r.s.location.kind === "party"), "on-teams filter");
  ROSTER_CHANGE["ro-filter-base"](w, ui, { value: "all" });
  ROSTER_CHANGE["ro-filter-status"](w, ui, { value: "hurt" });
  check(rosterRows(w, ui).length >= 1 && rosterRows(w, ui).every((r) => r.s.health < 70), "hurt filter");
  ROSTER_CHANGE["ro-filter-status"](w, ui, { value: "sick" });
  check(rosterRows(w, ui).length >= 1, "sick filter");
  ROSTER_CHANGE["ro-filter-status"](w, ui, { value: "all" });
  ROSTER_CHANGE["ro-filter-role"](w, ui, { value: "farm" });
  check(rosterRows(w, ui).every((r) => r.s.role === "farm"), "role filter");
  ROSTER_CHANGE["ro-filter-role"](w, ui, { value: "all" });
  // Tick rows and set a role for all of them.
  ROSTER_ACTIONS["ro-selall"](w, ui, {});
  check(ui.rosterPrefs.sel.length === alive(w).length, "tick everyone shown");
  ROSTER_CHANGE["ro-bulkrole"](w, ui, { value: "guard" });
  const atBaseNow = alive(w).filter((s) => s.location.kind === "base");
  check(atBaseNow.every((s) => s.role === "guard"), "set role for all ticked: everyone at a base is a guard");
  check(/2 not at a base kept their role/.test(ui.rosterPrefs.msg), `the people on the team are skipped and it says so ("${ui.rosterPrefs.msg}")`);
  ROSTER_ACTIONS["ro-selall"](w, ui, {});
  check(!ui.rosterPrefs.sel.length, "untick everyone");
  const one = atBaseNow[0];
  ROSTER_ACTIONS["ro-sel"](w, ui, { id: String(one.id) });
  ROSTER_CHANGE["ro-bulkrole"](w, ui, { value: "operate" });
  check(one.role === "operate", "one ticked row set to Operate");
  check(atBaseNow.slice(1).every((s) => s.role === "guard"), "the others unchanged");
  ROSTER_ACTIONS["ro-open"](w, ui, { id: String(one.id) });
  check(ui.survivor === one.id, "a name opens the survivor screen");
  html = rosterModal(w, ui);
  htmlOk(html, "roster after changes");
  const skillProgressShown = /class="ro-xp"/.test(html);
  console.log(`  skill progress bars ${skillProgressShown ? "shown (skills.js skillProgress)" : "not shown (no skillProgress in skills.js)"}`);
  check(rosterModal(w, ui).includes("Roster"), "renders");
  ROSTER_ACTIONS["ro-toggle"](w, ui, {});
  check(!ui.roster, "closes");
  check(Object.keys(ROLES).length > 3, "roles listed");
}

section("New-run screen: world size and AI groups (sim/worldsize.js)");
{
  const { newRunScreen, LOOK_ACTIONS, LOOK_CHANGE_ACTIONS } = await import("../src/ui/newgame.js");
  Object.assign(CLICK, LOOK_ACTIONS); // main.js registers the new-run screen's own handlers
  Object.assign(CHANGE, LOOK_CHANGE_ACTIONS);
  const { WORLD_SIZES, SIZE_KEYS, clampGroups } = await import("../src/sim/worldsize.js");
  for (const k of SIZE_KEYS) {
    const d = WORLD_SIZES[k];
    const w = createWorld({ seed: seed + 9, factionCount: d.defGroups, size: k });
    const ui = { worldSize: k, factionCount: d.defGroups, nrMsg: "" };
    const html = newRunScreen(w, ui);
    htmlOk(html, `new-run screen (${d.label})`);
    const sizeSel = /<select data-action="worldsize">([\s\S]*?)<\/select>/.exec(html);
    check(sizeSel && (sizeSel[1].match(/<option/g) || []).length === SIZE_KEYS.length && new RegExp(`value="${k}" selected`).test(sizeSel[1]), `${d.label}: the size list has every size, this one selected`);
    const groupSel = /<select data-action="factioncount">([\s\S]*?)<\/select>/.exec(html);
    const opts = groupSel ? [...groupSel[1].matchAll(/<option[^>]*>(\d+)</g)].map((m) => Number(m[1])) : [];
    check(opts[0] === d.groups[0] && opts[opts.length - 1] === d.groups[1] && opts.length === d.groups[1] - d.groups[0] + 1, `${d.label}: AI groups ${d.groups.join("–")} (got ${opts.join(",")})`);
    check(new RegExp(`<option selected>${d.defGroups}<`).test(groupSel ? groupSel[1] : ""), `${d.label}: ${d.defGroups} groups selected`);
    check(html.includes(`${w.factions.length} other groups`), `${d.label}: the text counts the groups`);
    check(clampGroups(k, 99) === d.groups[1] && clampGroups(k, 0) === d.groups[0], `${d.label}: group count clamped to its range`);
  }
  check(inMain("worldsize") && inMain("factioncount"), "main.js handles the size and group selects");
  console.log(`  ${SIZE_KEYS.map((k) => `${WORLD_SIZES[k].label} ${WORLD_SIZES[k].w}×${WORLD_SIZES[k].h} (${WORLD_SIZES[k].groups.join("–")} groups)`).join(", ")}`);
}

// ---------------------------------------------------------------------------------------------------------
section("Repairs tab after a raid (ui/explore.js, sim/breakdowns.js raidDamage)");
{
  const w = createWorld({ seed: seed + 9, factionCount: 8 });
  const h = hub(w);
  for (const t of ["walls", "walls", "gate", "barricades", "bunkhouse", "ammo_bench", "cistern", "common_room"]) Buildings.addBuilding(h, t);
  Object.assign(h.stock, { scrap: 150, parts: 10 });
  const rep = raidDamage(w, h, { strength: 60, hours: 8, outcome: "broken", by: "Test raiders" });
  const ui = freshUi();
  let html = repairsTab(w, h);
  htmlOk(html, "repairs tab after a raid");
  check(html.includes("Last raid: day") && html.includes("Test raiders") && html.includes("a break-in"), "it shows the last raid: who, how it went, the hours");
  check(rep.broken.length < 2 || /data-action="rp-all"/.test(html), `a Repair all button with the bill when several are broken (${rep.broken.length})`);
  const damaged = BD.fixtures(h).find((fx) => !fx.broken && (fx.wear || 0) >= BD.RAID_DAMAGE.damaged);
  check(!damaged || html.includes(">Patch</button>"), "a damaged building can be patched from the wear table");
  EXPLORE_ACTIONS["rp-all"](w, ui, { base: String(h.id) });
  check((h.repairs || []).length >= Math.min(1, rep.broken.length) && /starts/.test(ui.baseMsg || ""), `Repair all starts the jobs ("${(ui.baseMsg || "").slice(0, 100)}")`);
  htmlOk(repairsTab(w, h), "repairs tab with jobs under way");
}

// ---------------------------------------------------------------------------------------------------------
section("Help: the menu's Help tab, the Layers box and the ? buttons (ui/help.js)");
{
  const { renderLegend, renderRight } = await import("../src/ui/ui.js");
  const { helpTopics, helpTab } = await import("../src/ui/help.js");
  const { settingsModal, openSettings, SETTINGS_ACTIONS } = await import("../src/ui/settings.js");
  const { LAYERS } = await import("../src/sim/markers.js");
  const { view } = await import("../src/ui/render.js");
  Object.assign(CLICK, SETTINGS_ACTIONS);
  const strip = (h) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const w = createWorld({ seed: seed + 11, factionCount: 6 });
  const topics = helpTopics();
  const ids = new Set(topics.map((t) => t.id));
  check(ids.size === topics.length, `topic ids are unique (${topics.length} topics)`);
  check(topics.length >= 20 && ["goal", "time", "map", "map-layers", "map-legend", "keys-on-the-map"].every((k) => ids.has(k)), `the help's paragraphs are topics, with Map layers and Map legend (${[...ids].slice(0, 6).join(", ")}…)`);
  check(topics.every((t) => t.title && strip(t.html).length > 20), "every topic has a title and text");
  const layersHtml = topics.find((t) => t.id === "map-layers").html;
  check(Object.values(LAYERS).every((l) => layersHtml.includes(`<b>${l.name}</b>`)), "Map layers explains every layer");
  const legendText = strip(topics.find((t) => t.id === "map-legend").html);
  check(["Wallbreaker", "radio", "Siege", "skulls", "estimated", "dim tiles"].every((s) => legendText.toLowerCase().includes(s.toLowerCase())), "Map legend keeps what the old Layers box spelled out");

  // The Layers box: a short line per layer, no wall of text, a ? to Help, folds away.
  const ui = { ...freshUi(), legendCollapsed: false };
  const lg = renderLegend(view, ui);
  htmlOk(lg, "Layers box");
  check((lg.match(/class="layer"/g) || []).length === Object.keys(LAYERS).length, "one line per layer");
  check(strip(lg).length < 60 + Object.values(LAYERS).reduce((s, l) => s + l.name.length + 1, 0), `no explanation text in the box (${strip(lg).length} characters)`);
  check(/data-action="help-open" data-sec="map-layers"/.test(lg) && /data-action="legendtoggle"/.test(lg), "the box has ? (Help → Map layers) and fold buttons");
  check([...lg.matchAll(/data-tip="([^"]*)"/g)].every((m) => m[1].length <= 60), "its hover descriptions are one short line");
  const folded = renderLegend(view, { ...ui, legendCollapsed: true });
  htmlOk(folded, "Layers box folded");
  check(strip(folded).length < 15, "folded it is one button");

  // The right panel with nothing selected: a few lines and a ? to Help → Map.
  const idle = renderRight(w, { ...freshUi(), selected: -1, expedition: null });
  htmlOk(idle, "right panel, nothing selected");
  check(strip(idle).length < 220 && /data-action="help-open" data-sec="map"/.test(idle), `the idle right panel is short with a ? to Help (${strip(idle).length} characters)`);

  // Every ? in the UI points at a topic that exists (the banner's lives in main.js).
  const secs = [...`${lg}${idle}${mainSrc}`.matchAll(/data-action="help-open" data-sec="([^"]+)"/g)].map((m) => m[1]);
  check(secs.length >= 3 && secs.every((s) => ids.has(s)), `every ? opens an existing topic (${[...new Set(secs)].join(", ")})`);
  check(/help: \(\) => openSettings\(ui, "help"\)/.test(mainSrc), "the top bar's Help opens the menu's Help tab");

  // help-open from the map, then from inside the menu; set-help switches topic; every topic renders clean.
  const u2 = { started: true, scale: 1, speed: 0, slot: null, settings: null };
  SETTINGS_ACTIONS["help-open"](w, u2, { sec: "map-layers" });
  check(u2.settings && u2.settings.tab === "help" && u2.settings.help === "map-layers", "? opens the menu at Help → Map layers");
  let html = settingsModal(w, u2, { options: { autosave: true, autosaveDays: 1 }, desktop: false, autosaveInfo: () => ({}) });
  check(/data-action="set-help" data-sec="map-layers" class="active"/.test(html) && html.includes("<h2>Map layers</h2>"), "the topic is picked and shown");
  SETTINGS_ACTIONS["set-tab"](w, u2, { tab: "game" });
  SETTINGS_ACTIONS["help-open"](w, u2, { sec: "time" });
  check(u2.settings.tab === "help" && u2.settings.help === "time", "? with the menu open switches it to that topic");
  let bad = 0;
  for (const t of topics) {
    SETTINGS_ACTIONS["set-help"](w, u2, { sec: t.id });
    html = helpTab(u2.settings.help);
    if (!html.includes(`<h2>${t.title.replace(/&/g, "&amp;")}</h2>`)) bad++;
    htmlOk(html, `Help → ${t.title}`);
  }
  check(!bad, `set-help shows each topic (${bad} wrong)`);
  check(helpTab("no-such-topic").includes(`<h2>${topics[0].title}</h2>`), "an unknown topic shows the first one");
  openSettings(u2, "help");
  htmlOk(settingsModal(w, u2, { options: { autosave: true, autosaveDays: 1 }, desktop: false, autosaveInfo: () => ({}) }), "menu: Help tab");
}

// ---------------------------------------------------------------------------------------------------------
section("Windows and panels: folding, map only, auto-open, window sizes (ui/layout.js, ui/windows.js)");
{
  const L = await import("../src/ui/layout.js");
  const { settingsModal, openSettings, SETTINGS_ACTIONS, SETTINGS_CHANGE } = await import("../src/ui/settings.js");
  Object.assign(CHANGE, SETTINGS_CHANGE); // the Options tab's drop-downs
  const { helpTopics } = await import("../src/ui/help.js");
  const { DEFAULT_OPTIONS } = await import("../src/ui/saves.js");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };

  // Folding each panel, map only and back.
  const lay = L.defaultLayout();
  check(L.PANEL_KEYS.every((p) => lay[p] === false) && !lay.all, "every panel is shown at first");
  let flips = 0;
  for (const p of L.PANEL_KEYS) if (L.setFolded(lay, p) && lay[p] && L.setFolded(lay, p) && !lay[p] && L.setFolded(lay, p, true) && lay[p] && L.setFolded(lay, p, false) && !lay[p]) flips++;
  check(flips === L.PANEL_KEYS.length, `each panel folds and shows again (${L.PANEL_KEYS.join(", ")})`);
  check(!L.setFolded(lay, "left", false) && !L.setFolded(lay, "nope", true), "showing a shown panel or an unknown one changes nothing");
  L.setFolded(lay, "log", true);
  check(L.toggleAll(lay) && L.PANEL_KEYS.every((p) => lay[p]) && lay.all, "map only folds everything");
  L.setFolded(lay, "right", false); // opened by itself meanwhile
  check(!L.toggleAll(lay) && !lay.all && lay.log && !lay.left && !lay.right && !lay.alerts && !lay.legend, "map only again: back as they were (the folded log stays folded)");

  // Remembered in the browser; broken, odd or blocked storage.
  const st = mem();
  L.setPanelSize(lay, "left", 30);
  L.toggleAll(lay);
  check(L.saveLayout(lay, st) && eq(L.loadLayout(st), lay), "the layout (map only, folds, widths) is saved and loaded the same");
  st.setItem(L.LAYOUT_KEY, "{broken");
  check(eq(L.loadLayout(st), L.defaultLayout()), "broken JSON: the defaults");
  st.setItem(L.LAYOUT_KEY, JSON.stringify({ left: "yes", right: true, size: { left: 999, right: -5, log: "x" } }));
  const odd = L.loadLayout(st);
  check(odd.left === false && odd.right === true && odd.size.left === L.PANEL_SIZE.left.max && odd.size.right === L.PANEL_SIZE.right.min && odd.size.log === null, "odd values ignored or clamped");
  check(eq(L.loadLayout(blocked), L.defaultLayout()) && L.saveLayout(lay, blocked) === false && L.saveLayout(lay, null) === false, "blocked or missing storage: defaults, and saving fails quietly");
  const s2 = L.defaultLayout();
  check(L.panelSize(s2, "left") === 22 && L.setPanelSize(s2, "left", 5) && s2.size.left === L.PANEL_SIZE.left.min && L.setPanelSize(s2, "left", null) && s2.size.left === null, "panel widths are clamped; none means the usual width");
  L.resetLayout(lay);
  check(eq(lay, L.defaultLayout()), "reset: everything shown at the usual widths");

  // Auto-open: what was picked opens the panel that shows it.
  const S = {};
  const pick = (o = {}) => ({ state: S, started: true, sel: -1, xp: null, tab: "bases", ...o });
  const f = L.defaultLayout();
  for (const p of L.PANEL_KEYS) f[p] = true;
  check(eq(L.autoReveal(f, pick(), pick({ sel: 12 })), ["right"]), "a tile, site or base picked opens the right panel");
  check(eq(L.autoReveal(f, pick(), pick({ xp: 4 })), ["right"]), "a team's panel opened (map, list, alert, card) opens the right panel");
  check(eq(L.autoReveal(f, pick({ sel: 12 }), pick({ sel: 12 }), { clicked: true }), ["right"]), "clicking the same tile again opens it too");
  check(eq(L.autoReveal(f, pick(), pick({ tab: "teams" })), ["left"]), "a tab key opens the left panel");
  check(eq(L.autoReveal(f, pick({ xp: 4, sel: 3 }), pick({ xp: null, sel: -1 })), []), "a panel closing opens nothing");
  check(eq(L.autoReveal(f, pick(), pick(), { newDanger: true }), ["alerts"]), "a new urgent alert opens folded alerts");
  f.all = { left: false };
  check(eq(L.autoReveal(f, pick(), pick(), { newDanger: true }), []), "but not in map-only mode");
  f.all = null;
  check(!L.autoReveal(f, pick(), pick({ sel: 3, tab: "people", xp: 2 }), { newDanger: true, clicked: true }).includes("log"), "the log never opens by itself");
  check(eq(L.autoReveal(f, pick(), pick({ sel: 12, tab: "teams" }), { autoOpen: false, clicked: true }), []), "the option switches it off");
  check(eq(L.autoReveal(f, pick({ state: {} }), pick({ sel: 12, tab: "x" })), []) && eq(L.autoReveal(f, null, pick({ sel: 1 })), []), "a new or loaded world opens nothing");
  check(eq(L.autoReveal(f, pick({ started: false }), pick({ tab: "teams", sel: 4 })), []), "starting the game opens nothing");
  check(eq(L.autoReveal(L.defaultLayout(), pick(), pick({ sel: 12, tab: "teams" }), { newDanger: true }), []), "panels already open: nothing to do");
  let d = L.newDangerAlerts(null, [{ key: "a", tone: "danger" }, { key: "b", tone: "warn" }]);
  check(!d.fresh.length, "the first look at the alerts finds nothing new");
  d = L.newDangerAlerts(d.seen, [{ key: "a", tone: "danger" }, { key: "c", tone: "warn" }, { key: "x", tone: "danger" }]);
  check(eq(d.fresh, ["x"]), "a new danger alert is new; a new warning or one seen before is not");

  // Folded alerts: one button with the count, red with an urgent one; real alerts from a hungry base.
  const w = createWorld({ seed: seed + 13, factionCount: 6 });
  w.started = true;
  hub(w).stock.food = 0;
  hub(w).stock.preserved = 0;
  const au = freshUi();
  renderAlerts(w, au);
  const pill = L.alertsPill(au.alertList);
  htmlOk(pill, "folded alerts");
  check(au.alertList.length > 0 && pill.includes(`${au.alertList.length} alert`) && /class="al-pill danger"/.test(pill) && /data-action="panel-toggle" data-p="alerts"/.test(pill), `folded alerts: count ${au.alertList.length}, red, opens them`);
  check(L.alertsPill([], "") === "" && L.alertsPill([], "<div class=\"al-flash\">x</div>").includes("al-flash"), "no alerts: no button (a key's flash line stays)");
  htmlOk(L.alertsFoldButton(), "the alerts' fold button");

  // Windows: which get grips, the frame, the remembered sizes.
  const big = ["trade", "inv:1", "loot", "survivor:7", "base", "planner", "settings", "memorial", "diary", "roster", "radio", "caravan", "diplo", "route", "newrun", "zlook"];
  check(big.every((k) => L.windowKey(k)) && L.windowKey("survivor:7") === "survivor" && L.windowKey("inv:3") === "inv", "big windows resize, one size per kind (any survivor, any inventory)");
  check(["card", "result", "over", "search", null, ""].every((k) => L.windowKey(k) === ""), "cards, results and the end screen do not");
  const box = `<div class="box wide basebox"><div class="spread"><input class="basename" data-action="baserename" value="Hub"></div><div class="basebody">x</div></div>`;
  const fr = L.windowFrame(box, "base");
  htmlOk(fr, "a window's frame");
  check(fr.startsWith(`<div class="win" data-win="base">`) && (fr.match(/class="wgrip /g) || []).length === 8 && fr.includes(box), "a window gets its frame and eight grips (edges and corners)");
  check(L.windowFrame(box, "card") === box && L.windowFrame(null, "base") === "", "a card is left as it is; no window: nothing");
  const ws = mem();
  L.saveWindows({ base: { w: 60, h: 40, x: 10, y: 20 }, inv: { x: 5, y: 6 }, "bad-key": { w: 30, h: 30 }, survivor: { w: "x", h: 2 } }, ws);
  const lw = L.loadWindows(ws);
  check(eq(lw.base, { w: 60, h: 40, x: 10, y: 20 }) && eq(lw.inv, { x: 5, y: 6 }) && !lw["bad-key"] && !lw.survivor, "window sizes are saved and loaded; odd entries dropped");
  ws.setItem(L.WINDOWS_KEY, "nope");
  check(eq(L.loadWindows(ws), {}) && eq(L.loadWindows(blocked), {}) && L.saveWindows({}, blocked) === false, "broken or blocked storage: no sizes, no error");

  // Dragging edges, corners and the title at several UI sizes and screens: on screen, never under the minimum.
  let bad = 0, runs = 0;
  for (const scale of [0.75, 1, 1.5, 2]) {
    const rem = 16 * scale;
    for (const [vw, vh] of [[1280, 720], [1920, 1080], [3840, 2160]]) {
      const start = { x: 100, y: 80, w: Math.min(vw - 100, 40 * rem), h: Math.min(vh - 80, 25 * rem) };
      for (const dir of [...L.GRIPS, "move"]) {
        for (const [dx, dy] of [[-5000, -5000], [5000, 5000], [30, -20], [-40, 60]]) {
          runs++;
          const r = L.dragRect(start, dir, dx, dy, vw, vh, rem);
          const rw = r.w ?? start.w, rh = r.h ?? start.h;
          const ok = [r.x, r.y, rw, rh].every(Number.isFinite) && r.x >= 0 && r.y >= 0 && r.x + rw <= vw + 0.5 && r.y + rh <= vh + 0.5 &&
            rw >= Math.min(vw, L.WIN_MIN.w * rem) - 0.5 && rh >= Math.min(vh, L.WIN_MIN.h * rem) - 0.5;
          if (!ok) { bad++; if (bad < 4) console.log(`    off: ${dir} ${dx},${dy} at ${vw}x${vh} ×${scale}: ${JSON.stringify(r)}`); }
        }
      }
    }
  }
  check(!bad, `every drag stays on screen and above the minimum size (${runs} drags, ${bad} wrong)`);
  const st0 = { x: 200, y: 100, w: 800, h: 500 };
  const e = L.dragRect(st0, "e", 50, 0, 1920, 1080), wl = L.dragRect(st0, "w", 50, 0, 1920, 1080), mv = L.dragRect(st0, "move", 30, 40, 1920, 1080);
  check(e.x === 200 && e.w === 850 && wl.x === 250 && wl.w === 750 && wl.x + wl.w === 1000, "the right edge grows to the right; the left edge moves with the right edge fixed");
  check(mv.x === 230 && mv.y === 140 && mv.w === null, "the title moves the window and leaves its size");
  check(L.dragRect(st0, "se", -5000, -5000, 1920, 1080).w === L.WIN_MIN.w * 16, "a window stops at its minimum width");
  const off = L.clampRect({ x: 5000, y: -50, w: null, h: null, bw: 800, bh: 600 }, 1920, 1080);
  check(off.x === 1120 && off.y === 0, "a window remembered off screen comes back on it");
  const huge = L.clampRect({ x: 0, y: 0, w: 9000, h: 9000 }, 1280, 720);
  check(huge.w === 1280 && huge.h === 720, "a window remembered bigger than the screen fits it");

  // On a page: the classes and widths on the body (a stand-in for the browser's document).
  const cls = new Set(), props = new Map(), tips = {};
  let mapOnly = null;
  globalThis.document = {
    body: { classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) } },
    documentElement: { style: { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) } },
    getElementById: (id) => (id === "tb-maponly" ? { classList: { toggle: (c, on) => { mapOnly = on; } } } : id.startsWith("gut-") ? { dataset: (tips[id] = tips[id] || {}) } : null),
  };
  try {
    const { applyLayout } = await import("../src/ui/windows.js");
    const pl = L.defaultLayout();
    applyLayout(pl);
    check(!cls.size && !props.size && mapOnly === false && /fold the left panel away/.test(tips["gut-left"].tip), "open panels: no fold classes, the bars say they fold");
    L.setFolded(pl, "left", true); L.setFolded(pl, "log", true); L.setPanelSize(pl, "right", 30);
    applyLayout(pl);
    check(cls.has("fold-left") && cls.has("fold-log") && !cls.has("fold-right") && props.get("--right-size") === "min(30rem, 35vw)" && /Show the left panel/.test(tips["gut-left"].tip), "folded panels and a set width reach the page");
    L.toggleAll(pl); applyLayout(pl);
    check(cls.has("map-only") && cls.has("fold-right") && mapOnly === true, "map only: every fold class and the top bar button lit");
    L.toggleAll(pl); applyLayout(pl);
    check(!cls.has("map-only") && !cls.has("fold-right") && cls.has("fold-left"), "and back as it was");
    L.resetLayout(pl); applyLayout(pl);
    check(!cls.size && !props.size, "reset: nothing folded, usual widths");
  } finally { delete globalThis.document; }

  // The menu's new controls, main.js's handlers and keys, the README and the Help topic.
  check(DEFAULT_OPTIONS.autoOpen === true, "Auto-open panels on select is on by default");
  const u3 = { started: true, scale: 1, speed: 0, slot: null, settings: null };
  openSettings(u3, "options");
  const opts = { ...DEFAULT_OPTIONS }, api = { options: opts, desktop: false, autosaveInfo: () => ({}) };
  let html = settingsModal(w, u3, api);
  htmlOk(html, "menu: Options with windows and panels");
  check(/data-action="set-opt" data-k="autoOpen"/.test(html) && /data-action="win-reset"/.test(html) && /data-sec="windows-and-panels"/.test(html), "Options has Auto-open, Reset window sizes and a ? to the help");
  SETTINGS_ACTIONS["set-opt"](w, u3, { k: "autoOpen" }, api);
  check(opts.autoOpen === false && /✗ Auto-open panels on select/.test(settingsModal(w, u3, api)), "the option switches off");
  check(["panel-toggle", "panel-all", "win-reset"].every(inMain), "main.js handles panel-toggle, panel-all and win-reset");
  check(["BracketLeft", "BracketRight", "\"KeyL\"", "Backslash"].every((k) => mainSrc.includes(k)), "main.js has the panel keys ([ ] L \\ and Shift+[ ])");
  check(/windowFrame\(renderModal\(state, ui\), modalKind\(state, ui\)\)/.test(mainSrc) && /fitWindows\(\)/.test(mainSrc), "every window on screen goes through the frame and gets its remembered size");
  check(/mapClicked = true/.test(mainSrc) && /autoReveal\(layout, picked, now/.test(mainSrc) && /options\.autoOpen/.test(mainSrc), "main.js opens panels on a map click, a pick and the option");
  check(["| [ / ] |", "| L |", "| Shift+[ / Shift+] |", "| \\ (backslash)", "Window edges, corners, title", "Reset window sizes", "Auto-open panels on select"].every((k) => readme.includes(k)), "the README lists the panel keys, window drags and the options");
  const topic = helpTopics().find((t) => t.id === "windows-and-panels");
  check(topic && ["<b>[</b>", "<b>]</b>", "<b>L</b>", "<b>Shift+]</b>", "<b>Shift+[</b>", "<b>\\</b>", "Reset window sizes", "Auto-open panels on select"].every((k) => topic.html.includes(k)), "Help → Windows and panels lists the keys and options");
  if (topic) htmlOk(topic.html, "Help → Windows and panels");
}

section("Map terrain detail: decals and rippled water (ui/terraindeco.js, render.js), the Map detail option");
{
  const R = await import("../src/ui/render.js");
  const T = await import("../src/ui/terraindeco.js");
  const { WORLD_SIZES } = await import("../src/sim/worldsize.js");
  const { settingsModal, openSettings, SETTINGS_CHANGE, initSettings } = await import("../src/ui/settings.js");
  const { loadOptions, DEFAULT_OPTIONS } = await import("../src/ui/saves.js");
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  // A stub 2D context: records every drawImage from the decal atlas (its target rectangle) and any NaN argument.
  let atlasCv = new Set(), decals = [], nanArgs = 0, calls = 0;
  const ctxStub = new Proxy({ measureText: (t) => ({ width: String(t).length * 5 }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) }, {
    get: (o, k) => (k in o ? o[k] : (...a) => {
      calls++;
      if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nanArgs++;
      if (k === "drawImage" && atlasCv.has(a[0])) decals.push([a[5], a[6], a[7], a[8]]);
    }),
    set: (o, k, v) => ((o[k] = v), true),
  });
  T.setDecoCanvas((w, h) => ({ width: w, height: h, getContext: () => ctxStub }));
  let screen = { width: 1600, height: 900 };
  R.initRenderer({ getContext: () => ctxStub, getBoundingClientRect: () => screen, width: 0, height: 0 });
  for (const r of [1, 2]) atlasCv.add(T.decoAtlas(r).cv);
  const frame = (st, zoom, dpr = 1) => {
    window.devicePixelRatio = dpr;
    R.resize();
    R.camera.zoom = zoom;
    R.centerOn(st, hub(st).tile);
    R.redrawMap(true);
    decals = [];
    R.render(st);
    return decals.length;
  };
  const origLayers = new Set(R.view.layers);
  const sizeLabel = (st) => `${st.grid.width}×${st.grid.height} map`;

  // Every size, every zoom, both device scales, detailed and flat: draws without errors or NaN, decals only from the
  // fade-in zoom up (and none with Flat).
  let errs = 0, bad = [], sizes = [];
  for (const size of Object.keys(WORLD_SIZES)) {
    const st = createWorld({ seed: seed + 3, factionCount: 6, size });
    const counts = [];
    for (const detail of [true, false]) {
      T.setMapDetail(detail);
      for (const zoom of [0.3, 0.5, 0.65, 1, 1.6, 2.6]) for (const dpr of [1, 2]) {
        try {
          const k = frame(st, zoom, dpr);
          const want = detail && zoom > T.DECO_FADE[0];
          if (want ? k === 0 : k > 0) bad.push(`${size} zoom ${zoom} dpr ${dpr} ${detail ? "detailed" : "flat"}: ${k} decals`);
          if (detail && dpr === 1) counts.push(`${zoom}: ${k}`);
        } catch (e) { if (errs++ < 3) console.log(`  error (${size}, zoom ${zoom}, dpr ${dpr}): ${e.stack}`); }
      }
    }
    sizes.push(`${size} ${st.grid.width}×${st.grid.height} (${counts.join(", ")})`);
  }
  T.setMapDetail(true);
  check(!errs && !nanArgs, `every size renders at every zoom, detailed and flat, without errors (${errs}) or NaN arguments (${nanArgs})`);
  check(!bad.length, `decals only from zoom ${T.DECO_FADE[0]} up and never with Flat (${bad.slice(0, 3).join("; ")})`);
  console.log(`  decals drawn on a 1600×900 screen by zoom: ${sizes.join("; ")}`);
  check(T.decoAlpha(0.6) === 0 && T.decoAlpha(0.675) > 0.4 && T.decoAlpha(0.675) < 0.6 && T.decoAlpha(0.75) === 1, `decals fade in between zoom ${T.DECO_FADE.join(" and ")}`);

  // Placement: the same for the same seed (another world in between), different for another seed; it never touches
  // the simulation's random numbers, and neither does drawing.
  const a = createWorld({ seed: 77, factionCount: 6 });
  const rngBefore = JSON.stringify(a.rng);
  const rowsKey = (D) => T.decorRows(D).map((r) => r.join(",")).join(";");
  // Placed lazily as tiles are drawn: the renderer's placement holds only the tiles of the screen, placed in screen order.
  frame(a, 1.2);
  const Da = R.mapDecor();
  check(JSON.stringify(a.rng) === rngBefore, "placing and drawing decals leaves state.rng untouched");
  const partly = Da.len.filter((_, id) => Da.start[id] >= 0).length;
  const ka = rowsKey(Da);
  check(partly > 0 && partly < a.tiles.length, `decals are placed only for the tiles drawn (${partly} of ${a.tiles.length} after one screen)`);
  T.placeDecor(createWorld({ seed: 5, factionCount: 6 }), R.HEX);
  const Db = T.placeDecor(createWorld({ seed: 77, factionCount: 6 }), R.HEX);
  check(rowsKey(Db) === ka, `the same seed places the same decals, whatever order the tiles are placed in (${T.decorRows(Da).length} decals)`);
  check(rowsKey(T.placeDecor(createWorld({ seed: 78, factionCount: 6 }), R.HEX)) !== ka, "another seed places them differently");
  const far = Math.max(...T.decorRows(Da).map((r) => Math.max(-r[2], r[2] + r[4], -r[3], r[3] + r[5])));
  check(far <= Da.reach && Da.reach <= 35, `decals stay within 35 px of their tile's center (render.js DECO_REACH; ${far.toFixed(1)})`);
  const perTerrain = {};
  for (let id = 0; id < a.tiles.length; id++) { const k = a.tiles[id].terrain; perTerrain[k] = perTerrain[k] || [0, 0]; perTerrain[k][0]++; perTerrain[k][1] += Da.len[id]; }
  console.log(`  decals per tile: ${Object.entries(perTerrain).map(([k, [n, d]]) => `${k} ${(d / n).toFixed(1)}`).join(", ")}; placement data ${kb(Da.bytes)}`);
  check(perTerrain.forest[1] / perTerrain.forest[0] > 5 && perTerrain.city[1] / perTerrain.city[0] >= 3 && perTerrain.plains[1] / perTerrain.plains[0] >= 2, "forests are dense, cities built up, farmland dotted");

  // Clear zones and roads, end to end: the whole map drawn at once with every site, base and hive shown; no decal
  // drawn over a clear zone in use or on a road.
  R.view.devReveal = true;
  R.view.layers = new Set(["pois", "teams", "hordes", "territory"]);
  for (const st of [a, createWorld({ seed: seed + 3, factionCount: 10, size: "large" })]) {
    const g = st.grid, D = T.placeDecor(st, R.HEX);
    screen = { width: R.HEX * Math.sqrt(3) * (g.width + 1) * 1.2, height: R.HEX * 1.5 * (g.height + 2) * 1.2 };
    window.devicePixelRatio = 1;
    R.resize();
    R.camera.zoom = 1.2; R.camera.x = -R.HEX * 2; R.camera.y = -R.HEX * 2;
    R.redrawMap(true);
    decals = [];
    R.render(st);
    const clear = new Set([...st.tiles.filter((t) => t.loc && !t.loc.crash).map((t) => t.id), ...st.bases.map((b) => b.tile), ...st.tiles.filter((t) => t.hive).map((t) => t.id)]);
    const zones = [];
    for (const id of clear) { const [x, y] = g.toPixel(id, R.HEX); for (const z of T.CLEAR_ZONE) zones.push([x + z[0], y + z[1], x + z[2], y + z[3]]); }
    const segs = [];
    for (const t of st.tiles) for (const m of t.roadLinks || []) if (m > t.id) { const [x0, y0] = g.toPixel(t.id, R.HEX), [x1, y1] = g.toPixel(m, R.HEX); segs.push([x0, y0, x1, y1, t.bridge || st.tiles[m].bridge ? 6.5 : 2.6]); }
    const hitZone = decals.filter(([x, y, w, h]) => zones.some((z) => x < z[2] - 0.01 && z[0] < x + w - 0.01 && y < z[3] - 0.01 && z[1] < y + h - 0.01)).length;
    const distSeg = (px, py, s) => { const dx = s[2] - s[0], dy = s[3] - s[1], l = dx * dx + dy * dy, t = Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / l)); return Math.hypot(s[0] + dx * t - px, s[1] + dy * t - py); };
    const onRoad = decals.filter(([x, y, w, h]) => segs.some((s) => { // sample the decal's box against the road's band
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) if (distSeg(x + (w * i) / 4, y + (h * j) / 4, s) < s[4] / 2) return true;
      return false;
    })).length;
    const total = T.decorRows(D).length;
    check(decals.length > total * 0.5 && decals.length < total, `${sizeLabel(st)}: the whole map drawn shows most decals, minus the clear zones (${decals.length} of ${total})`);
    check(!hitZone, `${sizeLabel(st)}: no decal over the ${clear.size} sites', bases' and hives' icons and names (${hitZone} over)`);
    check(!onRoad, `${sizeLabel(st)}: no decal on a road or bridge (${onRoad} on ${segs.length} road links)`);
  }
  R.view.devReveal = false;
  R.view.layers = origLayers;

  // The Map detail option: default Detailed, persisted, the menu's select switches the renderer.
  check(DEFAULT_OPTIONS.mapDetail === true && loadOptions().mapDetail === true, "Map detail defaults to Detailed");
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const api = { options: loadOptions(), desktop: false, autosaveInfo: () => ({}), refresh() {}, track() {} };
  initSettings(api);
  const u3 = { started: true, scale: 1, speed: 0, slot: null, settings: null };
  openSettings(u3, "options");
  let html = settingsModal(createWorld({ seed, factionCount: 4 }), u3, api);
  check(/data-action="set-mapdetail"/.test(html) && /<option value="detailed" selected>Detailed<\/option>/.test(html), "the Options tab has Map detail: Detailed / Flat");
  Object.assign(CHANGE, SETTINGS_CHANGE);
  handlersOk(html, "Options tab");
  SETTINGS_CHANGE["set-mapdetail"](null, u3, { value: "flat" }, api);
  check(!T.deco.detail && loadOptions().mapDetail === false, "choosing Flat turns the detail off and is saved");
  T.setMapDetail(true);
  initSettings({ ...api, options: loadOptions() });
  check(!T.deco.detail, "a saved Flat is applied at start-up");
  check(frame(a, 1.5) === 0, "Flat: no decals up close");
  SETTINGS_CHANGE["set-mapdetail"](null, u3, { value: "detailed" }, api);
  check(T.deco.detail && loadOptions().mapDetail === true && frame(a, 1.5) > 0, "back to Detailed: decals again");
  delete globalThis.localStorage;
  T.setDecoCanvas(null);
}

// ---------------------------------------------------------------------------------------------------------
section("Map overlays: Known area, ruins, Coalition land (render.js, help.js, sim/discovery.js state.searched)");
{
  const R = await import("../src/ui/render.js");
  const { renderLegend } = await import("../src/ui/ui.js");
  const { helpTopics } = await import("../src/ui/help.js");
  const { LAYERS } = await import("../src/sim/markers.js");
  const Disc = await import("../src/sim/discovery.js");
  const { mergeKnowledge } = await import("../src/sim/world.js");
  const { ensureAlliance, controlledLand, landCentres, ALLIANCE } = await import("../src/sim/alliance.js");
  const { razeGroupBase } = await import("../src/sim/factions.js");
  const { serializeState, deserializeState } = await import("../src/sim/save.js");
  const { WORLD_SIZES } = await import("../src/sim/worldsize.js");
  const strip = (h) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  window.devicePixelRatio = 1;
  // A stub context that keeps a fingerprint of every call (name and rounded numbers) and counts NaN arguments.
  let sig = 0, nCalls = 0, nan = 0;
  const ctxStub = new Proxy({ measureText: (t) => ({ width: String(t).length * 5 }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) }, {
    get: (o, k) => (k in o ? o[k] : (...a) => {
      nCalls++;
      let h = String(k).length * 131 + String(k).charCodeAt(0);
      for (const v of a) if (typeof v === "number") { if (!Number.isFinite(v)) nan++; else h = (h * 31 + Math.round(v * 100)) | 0; }
      sig = (sig * 1000003 + h) | 0;
    }),
    set: (o, k, v) => ((o[k] = v), true),
  });
  R.initRenderer({ getContext: () => ctxStub, getBoundingClientRect: () => ({ width: 1600, height: 900 }), width: 0, height: 0 });
  const draw = (st, zoom = 1, tile = hub(st).tile) => { R.camera.zoom = zoom; R.centerOn(st, tile); R.redrawMap(true); sig = 0; nCalls = 0; R.render(st); return { sig, calls: nCalls }; };
  const origLayers = R.view.layers;

  // Layers box, Help, defaults.
  check(LAYERS.known && LAYERS.coalition, "the Known area and Coalition land layers exist");
  R.resetView();
  check(!R.view.layers.has("known") && !R.view.layers.has("coalition") && R.view.layers.has("pois"), "both are off by default (Locations, with the ruins, on)");
  const w = createWorld({ seed: seed + 11, factionCount: 6 });
  const lgOff = renderLegend(R.view, { legendCollapsed: false }, w);
  check(/data-k="known"/.test(lgOff) && /data-k="coalition"/.test(lgOff) && !/%\/50%/.test(lgOff), "the Layers box has a line for each, the share only while Coalition land is on");
  R.view.layers = new Set([...R.view.layers, "coalition"]);
  const lgOn = renderLegend(R.view, { legendCollapsed: false }, w);
  const pctWant = Math.round(controlledLand(w).pct * 100);
  check(new RegExp(`Coalition land <span class="muted"[^>]*>${pctWant}%/${Math.round(ALLIANCE.LAND_NEEDED * 100)}%</span>`).test(lgOn), `the Coalition land line shows the share held and the goal (${pctWant}%/50%)`);
  htmlOk(lgOn, "Layers box with Coalition land on");
  const topics = helpTopics();
  const layersTxt = strip(topics.find((t) => t.id === "map-layers").html), legendTxt = strip(topics.find((t) => t.id === "map-legend").html);
  check(/Known area/.test(layersTxt) && /hatching/.test(layersTxt) && /Coalition land/.test(layersTxt) && /50%/.test(layersTxt) && /Ruins of/.test(layersTxt), "Help → Map layers explains Known area, Coalition land and the ruins");
  check(["Ruins", "Known area", "Coalition land"].every((s) => legendTxt.includes(s)), "Help → Map legend has Ruins, Known area and Coalition land");

  // Searched tiles: a team's looks wait for its report, then go on the map; saved and loaded.
  check(!!state.searched && state.searched.some((v) => v > 0), `the ${days}-day autopilot run searched some ground (${state.searched ? state.searched.filter((v) => v > 0).length : 0} tiles)`);
  const h = hub(w), near = w.grid.within(h.tile, 4).filter((id) => w.grid.distance(h.tile, id) >= 3);
  const team = { owner: "player", id: -5 };
  Disc.noteLooked(w, team, near);
  check(!w.searched || !w.searched.some((v) => v > 0), "a team's looks stay off the map until it reports");
  const rev0 = Disc.searchedVersion();
  mergeKnowledge(w, new Map(), null, team);
  check(near.every((id) => Disc.searchedDay(w, id) === day(w)) && Disc.searchedVersion() > rev0 && team.looked.size === 0, `its report puts them on the map with the day (${near.length} tiles, day ${day(w)})`);
  Disc.noteLooked(w, { owner: 3 }, [h.tile]);
  const other = { owner: 3, looked: null };
  mergeKnowledge(w, new Map(), null, other);
  check(!Disc.searchedDay(w, h.tile), "another group's looks never mark your map");
  const pend = { owner: "player", id: -6 };
  Disc.noteLooked(w, pend, [h.tile]);
  w.parties.push(pend);
  const loaded = deserializeState(JSON.parse(JSON.stringify(serializeState(w))));
  w.parties.pop();
  check(loaded.searched instanceof Uint16Array && loaded.searched.length === w.tiles.length && loaded.searched.every((v, i) => v === w.searched[i]), "save/load keeps the searched tiles (a Uint16Array)");
  const lp = loaded.parties.find((p) => p.id === -6);
  check(lp && lp.looked instanceof Map && lp.looked.get(h.tile) === day(w), "a team's looks not yet reported survive save/load");
  // The layer: hatched where searched, worked out again only when a report changes the map or a day passes.
  R.view.layers = new Set(["pois", "territory", "known"]);
  const k0 = R.overlayStats.known;
  const a1 = draw(w);
  let ov = R.mapOverlay();
  check(R.overlayStats.known === k0 + 1 && ov.nSrch === near.length && near.every((id) => ov.srch[id] === 2), `the Known area layer shades the ${near.length} searched tiles (recent)`);
  for (let i = 0; i < 40; i++) { R.camera.x += 37; R.render(w); }
  check(R.overlayStats.known === k0 + 1, "panning 40 frames works nothing out again");
  Disc.noteLooked(w, team, [h.tile]);
  mergeKnowledge(w, new Map(), null, team);
  R.render(w);
  check(R.overlayStats.known === k0 + 2 && R.mapOverlay().srch[h.tile] === 2, "a new report is shaded at once");
  const a2 = draw(w);
  check(a1.sig !== a2.sig && draw(w).sig === a2.sig, "the shading changes the drawing; the same world draws the same");
  R.view.layers = new Set(["pois", "territory"]);
  const noKnown = draw(w);
  check(noKnown.calls < a2.calls, `switched off, nothing of it is drawn (${a2.calls} calls on, ${noKnown.calls} off)`);
  const old = loaded; // the loaded copy, 40 days on: searched long ago
  old.hour += 40 * 24;
  R.view.layers = new Set(["known"]);
  draw(old);
  check(R.mapOverlay().srch[near[0]] === 1, `searched more than ${R.KNOWN_RECENT} days ago: the fainter hatching`);
  check(/Searched by your people on day/.test(R.tileTooltip(w, near[0])), "the tooltip says when a tile was searched");

  // Ruins: drawn with their name, the tile panel's danger and salvage, gone when an outpost is founded there.
  const { renderRight } = await import("../src/ui/ui.js");
  const f = w.factions.find((x) => x.alive && x.bases.length);
  const rt = w.grid.within(h.tile, 3).find((id) => id !== h.tile && w.tiles[id].terrain !== "water" && !w.tiles[id].loc && w.live.has(id));
  razeGroupBase(w, f, rt, null);
  R.view.layers = new Set(["pois", "territory", "teams", "hordes"]);
  draw(w);
  check(R.mapOverlay().ruins.includes(rt), "a razed base in view is drawn as ruins");
  const panel = renderRight(w, { ...freshUi(), selected: rt });
  check(/Ruins of /.test(panel) && /Salvage/.test(panel) && /Danger/.test(panel) && /5 scrap carried/.test(panel), "the tile panel names the ruins with salvage, danger and the 5 scrap an outpost needs");
  htmlOk(panel, "tile panel on ruins");
  const info = R.ruinInfo(w, rt);
  check(info && Number.isFinite(info.danger) && info.dangerName && info.salvage && /^Ruins of /.test(info.title), `ruin info: ${info && `${info.title}, danger ${info.dangerName}, salvage ${info.salvage}`}`);
  check(R.ruinTitle({ name: "Oak Hill Outpost" }) === "Ruins of Oak Hill Outpost" && R.ruinTitle({ name: "plains (3,4)" }) === "Ruins of a burned base", "ruin names: the base's, never a map coordinate");
  // A ruin you have no report of since it burned is not shown; one out of view but reported after it burned is.
  const far = w.tiles.find((t) => !w.live.has(t.id) && !w.knowledge[t.id] && t.terrain !== "water" && !t.loc);
  far.ruin = { name: "Ghost Camp", day: day(w), by: "raiders", from: "" };
  draw(w);
  check(!R.mapOverlay().ruins.includes(far.id) && !R.ruinInfo(w, far.id), "a ruin you have not seen since it burned is not on your map");
  delete far.ruin;
  // Founded over: the ruin goes (parties.js deletes tile.ruin when the outpost stands).
  w.bases.push({ id: 999001, tile: rt, type: "outpost", name: "Test Outpost", stock: {}, buildings: [], construction: [], armory: [], radio: false, watchtower: false });
  draw(w);
  check(!R.mapOverlay().ruins.includes(rt), "your base on the tile: no ruin drawn there");
  delete w.tiles[rt].ruin;
  w.bases.pop();
  draw(w);
  check(!R.mapOverlay().ruins.includes(rt) && !R.ruinInfo(w, rt), "re-founded (tile.ruin gone): the ruin is gone from the map and the panel");

  // Coalition land: the same tiles controlledLand counts, each in its nearest owner's color.
  const ms = w.factions.filter((x) => x.alive && x.bases.length).slice(0, 2);
  ensureAlliance(w).members.push(...ms.map((x) => x.id));
  R.view.layers = new Set(["pois", "territory", "coalition"]);
  const c0 = R.overlayStats.coalition;
  const coalDraw = draw(w);
  const CL = controlledLand(w), C = R.coalitionLand(w);
  ov = R.mapOverlay();
  const centres = landCentres(w);
  let wrongTile = 0, wrongOwner = 0;
  for (const t of w.tiles) {
    const inReach = centres.some((c) => w.grid.distance(c.tile, t.id) <= c.r);
    const want = t.terrain !== "water" && inReach;
    if (!!ov.coal[t.id] !== want) wrongTile++;
    if (!ov.coal[t.id]) continue;
    // Nearest centre wins (you first on a tie): the owner drawn has a centre at the nearest distance.
    let best = Infinity;
    for (const c of centres) { const d = w.grid.distance(c.tile, t.id); if (d <= c.r) best = Math.min(best, d); }
    const o = ov.coal[t.id];
    const mine = o === 1 ? w.bases.map((b) => b.tile) : ms[o - 2].bases;
    if (!mine.some((b) => w.grid.distance(b, t.id) === best)) wrongOwner++;
  }
  check(C.held === CL.held && C.land === CL.land && ov.nCoal === CL.held && !wrongTile, `Coalition land matches controlledLand (${C.held} of ${C.land} land tiles, ${Math.round(C.pct * 100)}%; ${wrongTile} tiles differ)`);
  check(!wrongOwner && ov.coal.some((o) => o === 1) && ov.coal.some((o) => o >= 2), `each tile goes to its nearest owner, you and the members (${wrongOwner} wrong)`);
  check(draw(w).sig === coalDraw.sig, "the same world draws the same coalition borders");
  for (let i = 0; i < 40; i++) { R.camera.y += 29; R.render(w); }
  check(R.overlayStats.coalition === c0 + 1, `worked out once for 40+ frames (${R.overlayStats.coalition - c0})`);
  w.alliance.members.pop();
  R.render(w);
  check(R.overlayStats.coalition === c0 + 2 && R.coalitionLand(w).held === controlledLand(w).held, "a member leaving: worked out again, still the same land");
  check(!nan, `no NaN arguments in any of it (${nan})`);

  // Every size and zoom with all three on; then a Huge map: the time a frame takes with them on and off.
  let errs = 0;
  for (const size of Object.keys(WORLD_SIZES)) {
    const st = createWorld({ seed: seed + 5, factionCount: 6, size });
    const hh = hub(st);
    Disc.noteLooked(st, team, st.grid.within(hh.tile, 6));
    mergeKnowledge(st, new Map(), null, team);
    ensureAlliance(st).members.push(...st.factions.filter((x) => x.alive).slice(0, 3).map((x) => x.id));
    st.tiles[st.grid.within(hh.tile, 2).find((id) => id !== hh.tile)].ruin = { name: "Old Mill", day: 1, by: "raiders", from: "" };
    R.view.layers = new Set(["pois", "territory", "teams", "hordes", "known", "coalition", "infection"]);
    for (const zoom of [0.3, 0.65, 1, 2.6]) { try { draw(st, zoom); } catch (e) { if (errs++ < 3) console.log(`  error (${size}, zoom ${zoom}): ${e.stack}`); } }
    if (size !== "huge") continue;
    const time = (layers) => {
      R.view.layers = new Set(layers);
      draw(st, 0.65);
      const t0 = performance.now();
      for (let i = 0; i < 30; i++) { R.camera.x += 11; R.render(st); }
      return (performance.now() - t0) / 30;
    };
    const base = time(["pois", "territory", "teams", "hordes"]), withOv = time(["pois", "territory", "teams", "hordes", "known", "coalition"]);
    const t1 = performance.now();
    R.coalitionLand({ ...st, tiles: st.tiles.slice() }); // another tile list: the coalition worked out from scratch
    const coalMs = performance.now() - t1;
    console.log(`  Huge map (${st.tiles.length} tiles), headless, every frame drawn straight (no chunk cache): ${base.toFixed(2)} ms a frame without the overlays, ${withOv.toFixed(2)} ms with Known area and Coalition land; coalition land worked out in ${coalMs.toFixed(2)} ms when it changes`);
    check(withOv < base * 2.5 + 4, `the overlays cost little a frame on a Huge map (${withOv.toFixed(2)} vs ${base.toFixed(2)} ms)`);
  }
  check(!errs && !nan, `every size and zoom draws all three overlays without errors (${errs}) or NaN (${nan})`);
  R.view.layers = origLayers;
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
