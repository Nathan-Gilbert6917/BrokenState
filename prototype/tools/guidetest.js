// The first-week guide (ui/guide.js) and Help's "Start here" topic, without a browser.
// Usage: node tools/guidetest.js [seed]
// - a normal start: the base list, nothing ticked at the start, each step ticks off from the state when it is really
//   done (the stores looked at, people on priorities, a building queued, a team out and home, the clock run, the
//   first dawn, the diary), with a toast; all done → the guide steps aside
// - Show me: each step opens its screen and points at selectors that the rendered screen really has
// - a Hardcore start: the road list (the team, the clock, water, the camp, its needs, the shelter), founded for real
// - off after day 7 (not when brought back by hand), ✕, fold, the menu's toggle; saved and loaded with the world, an
//   older save without it loads and shows nothing; the pulse (a stand-in DOM)
// - options: the new-run box on for the first campaign only, guideSeen kept; the new-run screen and the menu's row
// - Help: "Start here" first, its links lead to topics that exist; README and main.js hooks
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { readFileSync } from "node:fs";
import { createWorld, tickHour, hub, day, alive } from "../src/sim/world.js";
import { launchExpedition, startReturn, partyTile, partyMembers, giveOrder } from "../src/sim/parties.js";
import { queueBuild, BUILDINGS, canBuild } from "../src/sim/buildings.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { WORK_ACTIONS } from "../src/ui/work.js";
import { renderModal, renderRight, renderLeft, topbarParts } from "../src/ui/ui.js";
import { newRunScreen } from "../src/ui/newgame.js";
import { settingsModal, openSettings, SETTINGS_ACTIONS } from "../src/ui/settings.js";
import { helpTopics, helpTab } from "../src/ui/help.js";
import { loadOptions, saveOptions } from "../src/ui/saves.js";
import {
  GUIDE, GUIDE_LISTS, GUIDE_ACTIONS, GUIDE_MENU_ACTIONS, guideSteps, startGuide, guideCheck, renderGuide, guidePulse, guideDefault, guideMenuRow,
} from "../src/ui/guide.js";

// Setting up a camp takes an hour (staging.js STAGING.PITCH): skipped here, the camp stands at once.
const establishNow = (st, p) => { p.pitched = true; return giveOrder(st, p, "establish"); };

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(t);

// ---------- helpers ----------
const BAD = /\b(undefined|NaN|Infinity)\b|\[object [A-Za-z]+\]|\bnull\b/;
const VOID = new Set(["input", "br", "img", "hr", "meta", "link"]);
function clean(html) {
  if (BAD.test(html.replace(/<[^>]*>/g, " "))) return false;
  const stack = [];
  for (const t of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
    const tag = t[2].toLowerCase();
    if (VOID.has(tag) || t[3]) continue;
    if (!t[1]) stack.push(tag);
    else if (stack.pop() !== tag) return false;
  }
  return !stack.length;
}
const freshUi = () => ({ started: true, speed: 0, tab: "bases", selected: -1, baseView: null, expedition: null, diary: null, planner: null, xpQueue: false, armed: { parties: new Map(), builds: new Set(), crafts: new Set() } });
// The handlers "Show me" calls (main.js's, reduced to what they set).
function fakeAct(ui) {
  const calls = [];
  return {
    calls,
    openbase: (d) => { ui.baseView = { id: Number(d.id), tab: d.tab || "overview" }; calls.push(["openbase", d.tab]); },
    "xp-open": (d) => { ui.expedition = Number(d.id); calls.push(["xp-open", d.id]); },
    center: (d) => { ui.selected = Number(d.tile); calls.push(["center", d.tile]); },
    "panel-toggle": (d) => { calls.push(["panel", d.p]); },
  };
}
// Does some tag in the HTML carry every attribute the selector's last part names ([k="v"]; :not(...) ignored)?
function selectorIn(sel, html) {
  const last = sel.replace(/:not\([^)]*\)\)?/g, "").trim().split(/\s+/).pop();
  const pairs = [...last.matchAll(/\[([\w-]+)="([^"]*)"\]/g)].map((m) => `${m[1]}="${m[2]}"`);
  if (!pairs.length) return false;
  return [...html.matchAll(/<[a-zA-Z][^>]*>/g)].some((t) => pairs.every((p) => t[0].includes(p)) && !(/:not\(\[disabled\]\)/.test(sel) && /\sdisabled/.test(t[0])));
}
// Everything the player could see after a Show me: the open window, the right and left panels, the top bar.
const screens = (st, ui) => [renderModal(st, ui) || "", renderRight(st, ui), renderLeft(st, ui), ...Object.values(topbarParts(st, ui))].join("\n");
function showMe(st, ui, id) {
  const act = fakeAct(ui);
  GUIDE_ACTIONS["gd-show"](st, ui, { id }, act);
  const P = ui.guidePulse;
  const html = screens(st, ui);
  return { act, sels: P ? P.sels : [], html, hit: P ? P.sels.filter((s) => selectorIn(s, html)) : [] };
}
function run(st, hours, done = () => false, rework = null) {
  for (let i = 0; i < hours && !done(); i++) {
    tickHour(st);
    st.cards.length = 0;
    if (st.engagement) st.engagement = null;
    if (rework) rework();
  }
}

// ---------- a normal start ----------
section("Normal start: the base list ticks off from the state");
{
  const st = createWorld({ seed, factionCount: 5 });
  st.noWanderers = true;
  const ui = freshUi();
  check(startGuide(st, false) === null && !st.guide, "box off: no guide is made");
  const g = startGuide(st, true);
  check(g && g.kind === "base" && g.on && guideSteps(g).map((x) => x.id).join() === GUIDE_LISTS.base.join(), `the base list (${GUIDE_LISTS.base.join(", ")})`);
  check(GUIDE_LISTS.base.length >= 6 && GUIDE_LISTS.base.length <= 9 && GUIDE_LISTS.road.length >= 6 && GUIDE_LISTS.road.length <= 9, "6–9 steps a list");
  check(guideSteps(g).every((x) => x.title && x.why && x.why.length > 30 && typeof x.done === "function" && typeof x.show === "function"), "every step has a title, a why line, a test and a Show me");
  const cards0 = st.cards.length, log0 = st.log.length, hour0 = st.hour;
  check(guideCheck(st, ui).length === 0 && !Object.keys(g.done).length, "nothing is ticked at the start");
  check(st.cards.length === cards0 && st.log.length === log0 && st.hour === hour0, "the check adds no cards or log lines and moves no clock");
  let html = renderGuide(st, ui);
  check(clean(html) && /First week/.test(html) && html.includes(`0/${GUIDE_LISTS.base.length}`), "the card: clean, 0 of 8");
  check((html.match(/data-action="gd-show"/g) || []).length === GUIDE_LISTS.base.length && /class="gd-why"/.test(html) && /▶/.test(html), "a Show me on every open step, the next one with its why line");
  check(renderGuide(st, { ...ui, started: false }) === "" && renderGuide(st, { ...ui, timelapse: {} }) === "", "hidden before the start and in the timelapse");

  // Show me for each step points at what the screen has.
  for (const id of GUIDE_LISTS.base) {
    const u = freshUi();
    const r = showMe(st, u, id);
    if (id === "night") check(r.act.calls.some((c) => c[0] === "panel" && c[1] === "left") && u.tab === "bases" && /class="tabs"[\s\S]*?<\/div><div class="card">/.test(renderLeft(st, u)), "Show me (night): the Bases tab, the hub's card first");
    else check(r.hit.length > 0, `Show me (${id}): ${r.sels.join(" | ")} found on screen (calls ${r.act.calls.map((c) => c[0]).join(", ")})`);
  }
  { const u = freshUi(); showMe(st, u, "stores"); check(u.baseView && u.baseView.tab === "farming", "Show me (stores) opens the Farming tab"); }
  { const u = freshUi(); const r = showMe(st, u, "scavenge"); check(u.selected >= 0 && st.tiles[u.selected].loc && r.act.calls.some((c) => c[0] === "panel" && c[1] === "right"), `Show me (scavenge) picks a site near the hub (${st.tiles[u.selected] && st.tiles[u.selected].loc ? st.tiles[u.selected].loc.name : "none"}) and shows the right panel`); }
  { const u = freshUi(); GUIDE_ACTIONS["gd-show"](st, u, { id: "nope" }, fakeAct(u)); check(!u.guidePulse, "an unknown step does nothing"); }

  // stores: the Farming tab looked at.
  ui.baseView = { id: hub(st).id, tab: "farming" };
  let fresh = guideCheck(st, ui);
  check(fresh.length === 1 && fresh[0].id === "stores" && g.done.stores === st.hour && ui.flash && /First week/.test(ui.flash.text) && /1 of 8/.test(ui.flash.text), `stores ticks off with a toast (${ui.flash && ui.flash.text})`);
  ui.baseView = null;
  // work: everyone on priorities.
  WORK_ACTIONS.weveryone(st, ui, { base: String(hub(st).id) });
  check(guideCheck(st, ui).some((x) => x.id === "work"), "work: everyone on priorities");
  // build: something queued.
  const type = Object.keys(BUILDINGS).find((k) => canBuild(st, hub(st), k).ok);
  check(!!type && /queued/.test(queueBuild(st, hub(st), type)), `a building queued (${type})`);
  check(guideCheck(st, ui).some((x) => x.id === "build"), "build: a building queued");
  // scavenge: a team out (any mission), then home.
  check(!g.done.scavenge && !g.done.home, "no team out yet");
  const h = hub(st);
  const near = st.grid.within(h.tile, 3).find((id) => id !== h.tile && st.tiles[id].terrain !== "water" && st.grid.distance(id, h.tile) >= 2);
  const crew = alive(st).slice(0, 2).map((s) => s.id);
  const res = launchExpedition(st, { memberIds: crew, dest: near, mission: "recon", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4 } });
  check(!res.error, `a team launched (${res.error || "ok"})`);
  check(guideCheck(st, ui).some((x) => x.id === "scavenge") && g.sent.length === 1, "scavenge: the team that set out is noted");
  check(!g.done.clock && !g.done.night, "the clock has not run yet");
  tickHour(st); st.cards.length = 0;
  check(guideCheck(st, ui).some((x) => x.id === "clock"), "clock: an hour went by");
  const p = st.parties.find((x) => x.id === g.sent[0].id);
  run(st, 200, () => { guideCheck(st, ui); return !!g.done.home && !!g.done.night; }, () => { if (st.parties.includes(p) && p.phase === "waiting") startReturn(st, p); });
  check(!!g.done.night && g.done.night >= (Math.floor(g.h0 / 24) + 1) * 24 + 6, `night: ticked at the first dawn (hour ${g.done.night})`);
  check(!!g.done.home && !st.parties.includes(p) && crew.some((id) => st.survivors.find((s) => s.id === id).location.kind === "base"), `home: the team got back (hour ${g.done.home})`);
  check(g.on && !g.done.diary, "still on: the diary is left");
  html = renderGuide(st, ui);
  check(clean(html) && (html.match(/gd-step done/g) || []).length === 7 && (html.match(/data-action="gd-show"/g) || []).length === 1, "the card: seven ticked, one Show me left");
  ui.diary = { day: 1 };
  guideCheck(st, ui);
  check(!g.on && g.ended === "done" && /every step done/.test(ui.flash.text) && renderGuide(st, ui) === "", "all done: the guide steps aside with a toast");
  ui.diary = null;
  // The menu brings it back: a fresh list (the old one was finished), kept past day 7.
  openSettings(ui, "game");
  SETTINGS_ACTIONS["gd-toggle"](st, ui, {});
  check(st.guide.on && st.guide.keep && !Object.keys(st.guide.done).length && /back/.test(ui.settings.msg), "Menu → Show: a fresh guide, kept past day 7");
  SETTINGS_ACTIONS["gd-toggle"](st, ui, {});
  check(!st.guide.on && st.guide.ended === "closed", "Menu → Hide");
}

// ---------- the week, ✕, fold, saves ----------
section("Off after day 7, ✕ and fold, saved with the world");
{
  const st = createWorld({ seed: seed + 1, factionCount: 5 });
  const ui = freshUi();
  const g = startGuide(st, true);
  st.hour = GUIDE.DAYS * 24 + 2; // day 8
  check(day(st) === GUIDE.DAYS + 1, "day 8");
  guideCheck(st, ui);
  check(!g.on && g.ended === "days" && /day 7/.test(ui.flash.text), "after day 7 it steps aside by itself");
  openSettings(ui, "game");
  SETTINGS_ACTIONS["gd-toggle"](st, ui, {});
  check(st.guide === g && g.on && g.keep && g.done.clock != null, "Menu → Show on day 8: the same list (its progress kept), kept on");
  guideCheck(st, ui);
  check(g.on, "brought back by hand: not switched off again by the day");
  GUIDE_ACTIONS["gd-fold"](st, ui, {});
  let html = renderGuide(st, ui);
  check(g.fold && clean(html) && /class="guide folded"/.test(html) && /Next:/.test(html) && !/gd-show/.test(html), "folded: one line with the next step");
  GUIDE_ACTIONS["gd-fold"](st, ui, {});
  GUIDE_ACTIONS["gd-pick"](st, ui, { id: "diary" });
  html = renderGuide(st, ui);
  check(/gd-step cur"><button class="gd-go" data-action="gd-pick" data-id="diary"/.test(html), "picking a step makes it the current one (its why line shows)");
  // Saved and loaded.
  st.cards.length = 0;
  const ld = loadFromString(saveToString(st));
  check(JSON.stringify(ld.guide) === JSON.stringify(st.guide), "the guide is saved with the world");
  GUIDE_ACTIONS["gd-close"](ld, ui, {});
  check(!ld.guide.on && ld.guide.ended === "closed" && renderGuide(ld, ui) === "" && /Menu/.test(ui.flash.text), "✕ hides it");
  // An older save: no guide, nothing shown, nothing made.
  const old = createWorld({ seed: seed + 2, factionCount: 5 });
  const ld2 = loadFromString(saveToString(old));
  check(!ld2.guide && renderGuide(ld2, ui) === "" && guideCheck(ld2, ui).length === 0 && !ld2.guide, "a save without the guide loads and shows nothing");
  // The menu row.
  openSettings(ui, "game");
  const menu = settingsModal(ld2, ui, { options: loadOptions(), desktop: false, autosaveInfo: () => ({ error: "" }) });
  check(clean(menu) && /data-action="gd-toggle"/.test(menu) && /Show the first-week guide/.test(menu), "the menu's Game tab: Show the first-week guide");
  check(guideMenuRow(ld2, { started: false }) === "" && SETTINGS_ACTIONS["gd-toggle"] === GUIDE_MENU_ACTIONS["gd-toggle"], "no row on the new-run screen's menu; the toggle is a menu action");
  SETTINGS_ACTIONS["gd-toggle"](ld2, ui, {});
  check(ld2.guide && ld2.guide.on && ld2.guide.keep && ld2.guide.kind === "base", "Menu → Show on an older save starts one");
}

// ---------- Hardcore ----------
section("Hardcore: the road list, founded for real");
{
  const st = createWorld({ seed: 77, factionCount: 7, mode: "hardcore" });
  st.noWanderers = true;
  const ui = freshUi();
  const g = startGuide(st, true);
  check(g.kind === "road" && guideSteps(g).map((x) => x.id).join() === GUIDE_LISTS.road.join(), `the road list (${GUIDE_LISTS.road.join(", ")})`);
  check(guideCheck(st, ui).length === 0, "nothing ticked at the start");
  const p = roadTeam(st);
  for (const id of GUIDE_LISTS.road) {
    const u = freshUi();
    const r = showMe(st, u, id);
    check(r.hit.length > 0, `Show me (${id}): ${r.sels.join(" | ")} found on screen`);
  }
  ui.expedition = p.id;
  check(guideCheck(st, ui).some((x) => x.id === "team"), "team: its panel opened");
  ui.expedition = null;
  p.cargo = { supplies: {}, gear: [] };
  Object.assign(p.cargo.supplies, { water: 12 });
  check(guideCheck(st, ui).some((x) => x.id === "water"), "water: the team holds more water than before");
  check(!g.done.camp, "no camp yet");
  st.cards.length = 0;
  Object.assign(p.cargo.supplies, { scrap: 6, water: 40 }); setFood(p.cargo, 40);
  establishNow(st, p);
  check(!!hub(st) && hub(st).camp === true && guideCheck(st, ui).some((x) => x.id === "camp"), "camp: the camp is set up (a base)");
  check(!g.done.needs, "the camp still needs its materials");
  Object.assign(hub(st).stock, { scrap: 30, buildmat: 2 }); // a trip home with the rest
  check(guideCheck(st, ui).some((x) => x.id === "needs"), "needs: everything is in");
  run(st, 24 * 8, () => { guideCheck(st, ui); return !!hub(st) && hub(st).camp !== true; });
  run(st, 30, () => { guideCheck(st, ui); return !!g.done.night; }); // the shelter can stand within a day now (20 work-hours): its first night after it
  guideCheck(st, ui);
  check(!!hub(st) && !!g.done.found && !!g.done.clock && !!g.done.night, `found: the shelter stands (day ${day(st)}), the clock and the first night ticked`);
  check(g.on && !g.done.diary, "still on until the diary");
  // A road guide over (the hub stands) and closed: the menu starts the base list.
  GUIDE_ACTIONS["gd-close"](st, ui, {});
  openSettings(ui, "game");
  SETTINGS_ACTIONS["gd-toggle"](st, ui, {});
  check(st.guide.on && st.guide.kind === "base", "Menu → Show once the hub stands: the base list");
}

// ---------- the autopilot ignores it ----------
section("The autopilot and the tools");
{
  const st = createWorld({ seed: seed + 3, factionCount: 5 });
  setAutopilot(st, true);
  for (let i = 0; i < 24 * 5; i++) { tickHour(st); }
  check(!st.guide, "an autopilot run never starts a guide");
  const st2 = createWorld({ seed: seed + 3, factionCount: 5 });
  const g = startGuide(st2, true);
  setAutopilot(st2, true);
  let ok = true;
  const ui = freshUi();
  try { for (let i = 0; i < 24 * 3; i++) { tickHour(st2); guideCheck(st2, ui); } } catch (e) { ok = false; console.log(e); }
  check(ok && g.done.clock != null, "a guide beside the autopilot: no errors, and it still ticks what happens");
}

// ---------- the pulse ----------
section("Show me's pulse");
{
  const mk = () => { const s = new Set(); return { classList: { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c) } }; };
  const a = mk(), b = mk(), c = mk();
  const all = [a, b, c];
  const map = { '[data-action="dy-open"]': [a, b], "#tb-stock": [c] };
  const doc = { body: { offsetWidth: 1 }, querySelectorAll: (s) => (s === ".gd-pulse" ? all.filter((e) => e.classList.contains("gd-pulse")) : map[s] || []) };
  const ui = { guidePulse: { step: "diary", sels: ['[data-action="dy-open"]', "[bad"], until: performance.now() + 1000, fresh: true } };
  guidePulse(ui, doc);
  check(a.classList.contains("gd-pulse") && b.classList.contains("gd-pulse") && !c.classList.contains("gd-pulse") && ui.guidePulse && !ui.guidePulse.fresh, "pulses what the step points at (a bad selector is skipped)");
  ui.guidePulse = { step: "stores", sels: ["#tb-stock"], until: performance.now() + 1000, fresh: true };
  guidePulse(ui, doc);
  check(!a.classList.contains("gd-pulse") && c.classList.contains("gd-pulse"), "a new Show me moves the pulse");
  ui.guidePulse.until = 0;
  guidePulse(ui, doc);
  check(!c.classList.contains("gd-pulse") && ui.guidePulse === null, "it ends");
  guidePulse({}, null);
  check(true, "no document: nothing happens");
}

// ---------- options and the new-run screen ----------
section("Options and the new-run screen");
{
  check(guideDefault({}) === true && guideDefault({ guideSeen: true }) === false, "the box is on for the first campaign here, off after one was started");
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
  const o = loadOptions();
  check(o.guideSeen === undefined, "no guideSeen by default");
  o.guideSeen = true;
  saveOptions(o);
  check(loadOptions().guideSeen === true && guideDefault(loadOptions()) === false, "guideSeen is remembered");
  delete globalThis.localStorage;
  const st = createWorld({ seed, factionCount: 5 });
  const base = { factionCount: 5, worldSize: "normal", customW: 64, customH: 42, hiveCount: null, nrMsg: "" };
  const on = newRunScreen(st, { ...base, guide: true }), off = newRunScreen(st, { ...base, guide: false });
  check(clean(on) && /data-action="nr-guide" checked/.test(on) && /First-week guide/.test(on) && !/data-action="nr-guide" checked/.test(off), "the new-run screen's First-week guide box follows ui.guide");
}

// ---------- Help, README, main.js ----------
section("Help: Start here; README and main.js");
{
  const topics = helpTopics();
  const ids = new Set(topics.map((t) => t.id));
  const start = topics[0];
  check(start.id === "start-here" && start.title === "Start here", "Start here is the first topic");
  check(helpTab("").includes("<h2>Start here</h2>"), "Help opens on it");
  const links = [...start.html.matchAll(/data-sec="([^"]+)"/g)].map((m) => m[1]);
  check(links.length >= 8 && links.every((id) => ids.has(id)), `its links lead to topics that exist (${links.filter((id) => !ids.has(id)).join(", ") || links.length + " links"})`);
  check(["bases", "teams", "state map", "card", "win", "lose"].every((w) => start.html.toLowerCase().includes(w)), "it covers bases, teams, the State Map, cards, winning and losing");
  check(clean(start.html), "clean");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  check(/First-week guide/.test(readme) && /Start here/.test(readme) && /guidetest/.test(readme), "the README describes the guide, Start here and this test");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  check(["guideCheck(state, ui)", "renderGuide(state, ui)", "guidePulse(ui)", "startGuide(state, ui.guide)", "\"nr-guide\":", "GUIDE_ACTIONS"].every((k) => main.includes(k)), "main.js: the check, the card, the pulse, the start, the box and the actions are hooked in");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  check(/\.gd-pulse\s*\{/.test(css) && /@keyframes gdpulse/.test(css) && /\.guide\s*\{/.test(css), "styles: the card and the pulse");
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
