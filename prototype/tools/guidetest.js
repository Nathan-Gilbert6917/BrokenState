// The first-week guide (ui/guide.js) and Help's "Start here" topic, without a browser.
// Usage: node tools/guidetest.js [seed]
// - a normal start: the base list, nothing ticked at the start, each step ticks off from the state when it is really
//   done (the stores looked at, people on priorities, a building queued, someone on Cut wood, a team out and home, the
//   clock run, the first dawn, the diary), with a toast; all done → the checklist steps aside, the notes go on to day 7
// - Show me: each step opens its screen and points at selectors that the rendered screen really has
// - a road start (Normal and Hardcore): the road list in two parts (day 1: the team, the clock, water, the fire's wood
//   and stone, the camp, the night; by day 7: wood, a team out from the camp, the shelter's needs, the shelter, the
//   diary), founded for real; the phase headings; the shelter is the week's goal (the user's request 2026-10-28)
// - off after day 7 (not when brought back by hand), ✕, fold, the menu's toggle; saved and loaded with the world, an
//   older save without it loads and shows nothing; the pulse (a stand-in DOM)
// - options: the new-run box on for the first campaign only, guideSeen kept; the new-run screen and the menu's row
// - new things: the first window of a kind gets a note over it (#guidetip), the first alert of a kind a line on the card,
//   each once; their Help topics exist
// - Help: "Start here" first, its links lead to topics that exist; How to play: a few short pages first, the Reference
//   folded by area (one open: the topic's, or the one help-group picked); README and main.js hooks
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { readFileSync } from "node:fs";
import { createWorld, tickHour, hub, day, alive } from "../src/sim/world.js";
import { launchExpedition, startReturn, partyTile, partyMembers, giveOrder } from "../src/sim/parties.js";
import { queueBuild, BUILDINGS, CAMP, canBuild, tierUpJob, tierUpType } from "../src/sim/buildings.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { WORK_ACTIONS } from "../src/ui/work.js";
import { renderModal, renderRight, renderLeft, topbarParts } from "../src/ui/ui.js";
import { newRunScreen } from "../src/ui/newgame.js";
import { settingsModal, openSettings, SETTINGS_ACTIONS } from "../src/ui/settings.js";
import { helpTopics, helpTab, HELP_GROUPS } from "../src/ui/help.js";
import { addCard } from "../src/sim/world.js";
import { loadOptions, saveOptions } from "../src/ui/saves.js";
import {
  GUIDE, GUIDE_LISTS, GUIDE_PHASES, GUIDE_ACTIONS, GUIDE_MENU_ACTIONS, guideSteps, startGuide, guideCheck, renderGuide, guidePulse, guideDefault, guideMenuRow,
  POPUP_TIPS, ALERT_TIPS, popupOf, renderGuideTip,
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
  check(GUIDE_LISTS.base.length >= 6 && GUIDE_LISTS.base.length <= 11 && GUIDE_LISTS.road.length >= 6 && GUIDE_LISTS.road.length <= 11, "6–11 steps a list");
  check(Object.values(GUIDE_PHASES).every((ph) => ph.length === 2 && ph[0].label === "Day 1" && ph.every((x) => x.label && x.sub && x.ids.length)), "each list in two parts: Day 1, then the rest of the week");
  check(guideSteps(g).every((x) => x.title && x.why && x.why.length > 30 && typeof x.done === "function" && typeof x.show === "function"), "every step has a title, a why line, a test and a Show me");
  const cards0 = st.cards.length, log0 = st.log.length, hour0 = st.hour;
  check(guideCheck(st, ui).length === 0 && !Object.keys(g.done).length, "nothing is ticked at the start");
  check(st.cards.length === cards0 && st.log.length === log0 && st.hour === hour0, "the check adds no cards or log lines and moves no clock");
  let html = renderGuide(st, ui);
  check(g.fold && clean(html) && /class="guide folded"/.test(html) && /Next:/.test(html) && !/gd-show/.test(html), "the card starts folded to its next step (the user's request 2026-10-24: the alerts' corner takes less of the map)");
  GUIDE_ACTIONS["gd-fold"](st, ui, {}); // ▾ opens it
  html = renderGuide(st, ui);
  check(clean(html) && /First week/.test(html) && html.includes(`0/${GUIDE_LISTS.base.length}`), `the card: clean, 0 of ${GUIDE_LISTS.base.length}`);
  check((html.match(/data-action="gd-show"/g) || []).length === GUIDE_LISTS.base.length && /class="gd-why"/.test(html) && /▶/.test(html), "a Show me on every open step, the next one with its why line");
  check((html.match(/class="gd-phase/g) || []).length === 2 && /class="gd-phase first"><b>Day 1<\/b>/.test(html) && html.indexOf("gd-phase first") < html.indexOf('data-id="stores"') && html.lastIndexOf("gd-phase") < html.indexOf('data-id="scavenge"'), "the steps under their two headings, Day 1 first");
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
  check(fresh.length === 1 && fresh[0].id === "stores" && g.done.stores === st.hour && ui.flash && /First week/.test(ui.flash.text) && new RegExp(`1 of ${GUIDE_LISTS.base.length}`).test(ui.flash.text), `stores ticks off with a toast (${ui.flash && ui.flash.text})`);
  ui.baseView = null;
  // wood: nobody starts on Cut wood.
  check(!g.done.wood && !alive(st).some((s) => s.role === "wood"), "nobody starts on Cut wood");
  // work: everyone on priorities.
  WORK_ACTIONS.weveryone(st, ui, { base: String(hub(st).id) });
  check(guideCheck(st, ui).some((x) => x.id === "work"), "work: everyone on priorities");
  // build: something queued.
  const type = Object.keys(BUILDINGS).find((k) => canBuild(st, hub(st), k).ok);
  check(!!type && /queued/.test(queueBuild(st, hub(st), type)), `a building queued (${type})`);
  check(guideCheck(st, ui).some((x) => x.id === "build"), "build: a building queued");
  // wood: on priorities, the hour's job picked may already be Cut wood (work.js sets s.role to it), and that ticks it
  // (seed 42 since d0adaca, whose rolled vehicle backs fill the stores: two go on it). Else someone put on Cut wood
  // (a fixed job) ticks it; that path is also played on a world of its own below, so it is checked on every seed.
  const byWork = alive(st).some((s) => s.role === "wood" && s.location.kind === "base");
  check(!!g.done.wood === byWork, `wood: ticked with everyone on priorities only when the hour's job is Cut wood (${byWork ? "someone is on it" : "nobody is"})`);
  const fixedWood = (s0, ui0) => { const w = alive(s0).find((s) => s.location.kind === "base"); w.role = "wood"; if (w.work) w.work.role = null; return guideCheck(s0, ui0).some((x) => x.id === "wood"); };
  if (!byWork) check(fixedWood(st, ui), "wood: someone on Cut wood");
  {
    const s2 = createWorld({ seed, factionCount: 5 });
    s2.noWanderers = true;
    const u2 = freshUi();
    const g2 = startGuide(s2, true);
    check(guideCheck(s2, u2).length === 0 && !g2.done.wood && fixedWood(s2, u2) && !!g2.done.wood, "wood: someone put on Cut wood (a fixed job) ticks it");
  }
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
  check(clean(html) && (html.match(/gd-step done/g) || []).length === GUIDE_LISTS.base.length - 1 && (html.match(/data-action="gd-show"/g) || []).length === 1, "the card: all but one ticked, one Show me left");
  ui.diary = { day: 1 };
  guideCheck(st, ui);
  check(g.on && g.stepsDone === st.hour && !g.ended && /every step done/.test(ui.flash.text) && renderGuide(st, ui) === "", "all done in the first week: the checklist steps aside with a toast, the notes go on");
  ui.alertList = [{ kind: "nowork" }];
  guideCheck(st, ui);
  html = renderGuide(st, ui);
  check(clean(html) && /New:/.test(html) && !/gd-step/.test(html), "after the steps: a new alert still gets its note (and no checklist)");
  ui.alertList = [];
  ui.diary = null;
  // The menu hides it; again brings it back: a fresh list (the old one was finished), kept past day 7.
  openSettings(ui, "game");
  SETTINGS_ACTIONS["gd-toggle"](st, ui, {});
  check(!st.guide.on && st.guide.ended === "closed", "Menu → Hide (the notes too)");
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
  let html = renderGuide(st, ui);
  check(g.fold && clean(html) && /class="guide folded"/.test(html) && /Next:/.test(html) && !/gd-show/.test(html), "folded: one line with the next step (as it starts; ▾ toggles it)");
  GUIDE_ACTIONS["gd-fold"](st, ui, {});
  check(!g.fold && /gd-show/.test(renderGuide(st, ui)), "▾ opens it: the steps with their Show me");
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

// ---------- the road start ----------
// Normal and Hardcore both open on the road (issue #79): the road list, founded for real.
for (const [mode, seed0] of [["normal", 77], ["hardcore", 77]]) {
section(`Road start (${mode}): the road list, the shelter by day ${GUIDE.DAYS}`);
{
  const st = createWorld({ seed: seed0, factionCount: 7, mode, roadStart: true });
  st.noWanderers = true;
  const ui = freshUi();
  const g = startGuide(st, true);
  check(g.kind === "road" && guideSteps(g).map((x) => x.id).join() === GUIDE_LISTS.road.join(), `the road list (${GUIDE_LISTS.road.join(", ")})`);
  const day1 = GUIDE_PHASES.road[0].ids, week = GUIDE_PHASES.road[1].ids;
  check(["team", "water", "fire", "camp", "night"].every((id) => day1.includes(id)) && ["needs", "found"].every((id) => week.includes(id)) && GUIDE_PHASES.road[1].label === `By day ${GUIDE.DAYS}`, "day 1: off the road, into a camp, through the night; the shelter is for the rest of the week (the user's request 2026-10-28)");
  check(/by day 7/.test(guideSteps(g).find((x) => x.id === "found").title), "the shelter's step says it is the week's goal");
  const p = roadTeam(st);
  const fireHeld = () => ["wood", "stone"].every((k) => ((p.supplies[k] || 0) + ((p.cargo && p.cargo.supplies[k]) || 0)) >= 8);
  check(guideCheck(st, ui).length === 0 || (fireHeld() && Object.keys(g.done).join() === "fire"), "nothing ticked at the start");
  for (const id of GUIDE_LISTS.road) {
    const u = freshUi();
    const r = showMe(st, u, id);
    check(r.hit.length > 0, `Show me (${id}, on the road): ${r.sels.join(" | ")} found on screen`);
  }
  GUIDE_ACTIONS["gd-fold"](st, ui, {});
  let html = renderGuide(st, ui);
  check(clean(html) && (html.match(/class="gd-phase/g) || []).length === 2 && html.includes(`<b>By day ${GUIDE.DAYS}</b>`) && html.indexOf("<b>By day") < html.indexOf('data-id="found"') && html.indexOf("<b>By day") > html.indexOf('data-id="night"'), "the card: Day 1's steps, then By day 7's");
  GUIDE_ACTIONS["gd-fold"](st, ui, {});
  ui.expedition = p.id;
  check(guideCheck(st, ui).some((x) => x.id === "team"), "team: its panel opened");
  ui.expedition = null;
  p.cargo = { supplies: {}, gear: [] };
  for (const k of ["wood", "stone"]) p.supplies[k] = 0;
  Object.assign(p.cargo.supplies, { water: 12 });
  check(guideCheck(st, ui).some((x) => x.id === "water"), "water: the team holds more water than before");
  check(!g.done.camp, "no camp yet");
  if (!g.done.fire) {
    Object.assign(p.cargo.supplies, { wood: 3, stone: 8 });
    check(!guideCheck(st, ui).some((x) => x.id === "fire"), "fire: not with too little wood");
    p.cargo.supplies.wood = 5;
    check(guideCheck(st, ui).some((x) => x.id === "fire"), "fire: the camp fire's wood and stone carried");
  }
  st.cards.length = 0;
  Object.assign(p.cargo.supplies, { wood: 5, stone: 8, scrap: 6, water: 40 }); setFood(p.cargo, 40);
  establishNow(st, p);
  st.cards.length = 0;
  st.nameAsk = []; // the naming popup answered
  check(!!hub(st) && hub(st).camp === true && guideCheck(st, ui).some((x) => x.id === "camp"), "camp: the camp is set up (a base)");
  check(g.woodLow === (hub(st).stock.wood || 0) && !g.done.wood, `wood: counted from the camp's own pile (${g.woodLow}), not ticked by setting it up`);
  for (const id of ["wood", "scavenge", "needs", "found"]) {
    const u = freshUi();
    const r = showMe(st, u, id);
    check(r.hit.length > 0, `Show me (${id}, at the camp): ${r.sels.join(" | ")} found on screen`);
  }
  { const u = freshUi(); showMe(st, u, "scavenge"); check(u.selected >= 0 && st.tiles[u.selected].loc, "Show me (scavenge, at the camp) picks a site near it"); }
  check(!g.done.needs, "the camp still needs its materials");
  check(guideSteps(g).find((x) => x.id === "needs").why.includes("200 wood") && guideSteps(g).find((x) => x.id === "wood").why.includes("200 wood"), "needs and wood: the steps name the wood the step up takes");
  check(!tierUpJob(hub(st)) && !guideCheck(st, ui).some((x) => x.id === "needs"), "needs: nothing placed for the player (the user's request 2026-10-23: no shelter set when the camp is established)");
  // A team out from the camp (any mission).
  const camp = hub(st);
  const near = st.grid.within(camp.tile, 3).find((id) => id !== camp.tile && st.tiles[id].terrain !== "water" && st.grid.distance(id, camp.tile) >= 2);
  const crew = alive(st).filter((s) => s.location.kind === "base").slice(0, 1).map((s) => s.id);
  const res = launchExpedition(st, { memberIds: crew, dest: near, mission: "recon", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2 } });
  check(!res.error && guideCheck(st, ui).some((x) => x.id === "scavenge") && g.sent.length === 1, `scavenge: a team set out from the camp (${res.error || "ok"})`);
  queueBuild(st, hub(st), tierUpType(hub(st))); // the Camp tab's Place the shelter shack
  Object.assign(hub(st).stock, { scrap: 30, buildmat: 2, wood: 300 }); // a trip home with the rest (the wood: a Cut wood order)
  const fresh = guideCheck(st, ui);
  check(fresh.some((x) => x.id === "needs") && fresh.some((x) => x.id === "wood"), "needs: everything is in; wood: the pile grew");
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
}
section("Road start: a camp but no shelter by day 7");
{
  const st = createWorld({ seed: 78, factionCount: 5, mode: "normal", roadStart: true });
  st.noWanderers = true;
  const ui = freshUi();
  const p = roadTeam(st);
  Object.assign(p.cargo.supplies, { wood: 5, stone: 8 });
  establishNow(st, p);
  check(!!hub(st) && startGuide(st, true).kind === "road", "a guide started at the camp is still the road list (the camp is not the shelter)");
  const g = st.guide;
  guideCheck(st, ui);
  st.hour = GUIDE.DAYS * 24 + 2;
  guideCheck(st, ui);
  check(!g.on && g.ended === "days" && /No shelter yet/.test(ui.flash.text) && /Camp tab/.test(ui.flash.text), `after day 7 it steps aside, saying where the shelter stands (${ui.flash.text})`);
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

// ---------- new things: the notes ----------
section("New things: a note over a new window, a line for a new alert, each once");
{
  const st = createWorld({ seed: seed + 4, factionCount: 5 });
  st.noWanderers = true;
  const ui = freshUi();
  const g = startGuide(st, true);
  const ids = new Set(helpTopics().map((t) => t.id));
  const bad = [...Object.entries(POPUP_TIPS).map(([id, t]) => [id, t]), ...ALERT_TIPS.map((t) => [t.id, t])].filter(([, t]) => !t.title || !t.text || (t.help && !ids.has(t.help)));
  check(!bad.length, `every note has a title, a text and a Help topic that exists (${bad.map(([id, t]) => `${id}→${t.help}`).join(", ") || "all"})`);
  check(popupOf(st, ui) === null && renderGuideTip(st, ui) === "", "nothing up: no note");
  // A card that stops the clock (a team's orders).
  const mk = (title) => ({ title, text: "A test card.", isOrders: true, choices: [{ label: "OK", resolve: () => "ok" }] });
  st.cards.length = 0;
  addCard(st, mk("Orders: the test team"));
  const p = popupOf(st, ui);
  check(p && p.id === "orders" && p.ref === st.cards[0], `a card up: its note's kind (${p && p.id})`);
  let html = renderGuideTip(st, ui);
  check(clean(html) && /New:/.test(html) && html.includes(POPUP_TIPS.orders.title) && /data-action="help-open" data-sec="team-panel"/.test(html) && g.seen.orders === st.hour, "the note: clean, its title, a ? to Help, marked seen");
  check(renderGuideTip(st, ui) === html, "it stays while that card is up");
  ui.settings = { tab: "help" };
  check(renderGuideTip(st, ui) === "" && ui.guideTip, "Help open over it: hidden, kept");
  ui.settings = null;
  check(renderGuideTip(st, ui) === html, "back when Help closes");
  GUIDE_ACTIONS["gd-tip-ok"](st, ui, {});
  check(renderGuideTip(st, ui) === "", "✕ hides it");
  st.cards.length = 0;
  check(renderGuideTip(st, ui) === "" && !ui.guideTip, "the card answered: gone");
  addCard(st, mk("Orders: another team"));
  check(renderGuideTip(st, ui) === "", "the same kind again: told once");
  st.cards.length = 0;
  // A battle: the note's kind by the battle (a raid, a base defence, the build map, a fight).
  const kinds = [[{ raid: {}, setup: {} }, "raid"], [{ setup: { layout: "baseDefence" } }, "defence"], [{ layout: {}, setup: { layout: "baseDefence", drill: true } }, "buildmap"], [{ setup: {} }, "battle"]];
  for (const [b, want] of kinds) {
    st.combat = b;
    let got = null;
    try { const x = popupOf(st, ui); got = x && x.id; } catch (e) { got = `error ${e.message}`; }
    check(got === want, `a battle (${want}): ${got}`);
  }
  const setup = {};
  st.combat = { raid: {}, setup };
  html = renderGuideTip(st, ui);
  check(/The raid map/.test(html) && /Shift\+A/.test(html), "the raid map's note");
  st.combat = { raid: {}, setup }; // the battle made again (the raid's plan closed): the same raid
  check(renderGuideTip(st, ui) === html, "the battle made again from the same setup keeps its note");
  st.combat = null;
  ui.guideTip = null;
  // Alerts: the first of a kind gets a line on the card; cleared, it goes; the same kind again is not told.
  ui.alertList = [{ kind: "wait" }];
  guideCheck(st, ui);
  html = renderGuide(st, ui);
  check(ui.guideNote === "a-wait" && clean(html) && /class="gd-note"/.test(html) && /A team waits for orders/.test(html) && /data-sec="team-panel"/.test(html), "a team waiting: a New line on the card");
  ui.alertList = [];
  guideCheck(st, ui);
  check(!ui.guideNote && !/gd-note/.test(renderGuide(st, ui)), "the alert cleared: the line goes");
  ui.alertList = [{ kind: "plan" }];
  guideCheck(st, ui);
  check(!ui.guideNote, "the same kind again: told once");
  ui.alertList = [{ kind: "nowork" }, { kind: "food" }];
  guideCheck(st, ui);
  check(ui.guideNote === "a-nowork", "one line at a time");
  GUIDE_ACTIONS["gd-note-ok"](st, ui, {});
  guideCheck(st, ui);
  check(ui.guideNote === "a-food", "✕: the next one");
  // Off: no notes; saved with the world; an older guide without seen gets one.
  GUIDE_ACTIONS["gd-close"](st, ui, {});
  addCard(st, mk("Orders: a third team"));
  check(renderGuideTip(st, ui) === "" && !ui.guideNote, "the guide off: no notes");
  st.cards.length = 0;
  const ld = loadFromString(saveToString(st));
  check(JSON.stringify(ld.guide.seen) === JSON.stringify(g.seen), "what was told is saved with the world");
  const old = startGuide(createWorld({ seed: seed + 5, factionCount: 5 }), true);
  delete old.seen;
  const st2 = { ...st, guide: old };
  ui.alertList = [{ kind: "worm" }];
  ui.guideNote = null;
  guideCheck(st2, ui);
  check(old.seen && old.seen["a-worm"] != null, "a guide saved before the notes gets its seen list");
  ui.alertList = [];
  // main.js and index.html
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  check(main.includes('setPanel("guidetip", renderGuideTip(state, ui), user)') && /id="guidetip"/.test(index), "main.js writes the note into #guidetip");
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
  // How to play (the user's request 2026-10-28: "helpful to new players and not a long book"): a few short pages first.
  const strip = (h) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const how = topics.filter((t) => t.group === "how");
  check(how.length >= 5 && how.length <= 8 && topics.slice(0, how.length).every((t) => t.group === "how"), `How to play: ${how.length} pages, before the Reference`);
  check(how.every((t) => strip(t.html).length < 1600 && clean(t.html)), `each page is short (${how.map((t) => strip(t.html).length).join(", ")} characters)`);
  check(how.every((t) => [...t.html.matchAll(/data-sec="([^"]+)"/g)].every((m) => ids.has(m[1]))), "their links lead to topics that exist");
  // Raiding in the first week (the user's request 2026-10-28: "Add raiding for your first week help to find supplies to build you base shelter and defenses").
  const raid = how.find((t) => t.id === "raiding-for-supplies"), week = how.find((t) => t.id === "your-first-week");
  const shackScrap = BUILDINGS.camp_up.cost.scrap + BUILDINGS.camp_up.cost.buildmat * CAMP.matScrap;
  check(!!raid && /Scavenge \/ raid/.test(raid.html) && strip(raid.html).includes(`${shackScrap} scrap in all`) && /Defenses/.test(raid.html) && /wall stand/.test(raid.html), `Raiding for supplies: how to raid, the shack's ${shackScrap} scrap and the defenses'`);
  check(!!week && /data-sec="raiding-for-supplies"/.test(week.html) && /data-sec="raiding-for-supplies"/.test(start.html), "Your first week and Start here point at it");
  check(topics.every((t) => t.group === "how" || HELP_GROUPS.some(([g]) => g === t.group)), `every Reference topic is in an area (${topics.filter((t) => t.group === "more").map((t) => t.id).join(", ") || "none left over"})`);
  const nav = (h) => h.split('<div class="helpbody">')[0];
  const shown = (h) => [...nav(h).matchAll(/data-action="set-help" data-sec="([^"]+)"/g)].map((m) => m[1]);
  const first = shown(helpTab(""));
  check(first.length === how.length && how.every((t) => first.includes(t.id)) && (nav(helpTab("")).match(/data-action="help-group"/g) || []).length === HELP_GROUPS.length, `Help opens with the pages listed and the Reference's ${HELP_GROUPS.length} areas folded`);
  const atLayers = shown(helpTab("map-layers"));
  check(atLayers.includes("map-legend") && !atLayers.includes("battles") && /data-g="map" aria-expanded="true"/.test(helpTab("map-layers")), "a Reference topic shows its own area open, the others folded");
  const u = { started: true, settings: null };
  SETTINGS_ACTIONS["help-open"](null, u, { sec: "map-layers" });
  SETTINGS_ACTIONS["help-group"](null, u, { g: "fights" });
  check(u.settings.helpGroup === "fights" && shown(helpTab(u.settings.help, u.settings.helpGroup)).includes("battles"), "help-group opens another area");
  SETTINGS_ACTIONS["help-group"](null, u, { g: "fights" });
  check(u.settings.helpGroup === "" && shown(helpTab(u.settings.help, u.settings.helpGroup)).length === how.length, "and again folds it");
  SETTINGS_ACTIONS["set-help"](null, u, { sec: "battles" });
  check(u.settings.helpGroup === null && /data-g="fights" aria-expanded="true"/.test(helpTab(u.settings.help, u.settings.helpGroup)), "picking a topic opens its area");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  check(/First-week guide/.test(readme) && /Start here/.test(readme) && /guidetest/.test(readme), "the README describes the guide, Start here and this test");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  check(["guideCheck(state, ui)", "renderGuide(state, ui)", "guidePulse(ui)", "startGuide(state, ui.guide)", "\"nr-guide\":", "GUIDE_ACTIONS"].every((k) => main.includes(k)), "main.js: the check, the card, the pulse, the start, the box and the actions are hooked in");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  check(/\.gd-pulse\s*\{/.test(css) && /@keyframes gdpulse/.test(css) && /\.guide\s*\{/.test(css), "styles: the card and the pulse");
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
