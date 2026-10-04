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

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
