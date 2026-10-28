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
// - Help: "Start here" first, its links lead to topics that exist; README and main.js hooks
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { readFileSync } from "node:fs";
import { createWorld, tickHour, hub, day, alive } from "../src/sim/world.js";
import { launchExpedition, startReturn, partyTile, partyMembers, giveOrder } from "../src/sim/parties.js";
import { queueBuild, BUILDINGS, canBuild, tierUpJob, tierUpType } from "../src/sim/buildings.js";
import { newItem } from "../src/sim/inventory.js";
import { putBack } from "../src/sim/deadpop.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { WORK_ACTIONS } from "../src/ui/work.js";
import { renderModal, renderRight, renderLeft, topbarParts } from "../src/ui/ui.js";
import { newRunScreen } from "../src/ui/newgame.js";
import { settingsModal, openSettings, SETTINGS_ACTIONS } from "../src/ui/settings.js";
import { helpTopics, helpTab } from "../src/ui/help.js";
import { addCard } from "../src/sim/world.js";
import { loadOptions, saveOptions } from "../src/ui/saves.js";
import {
  GUIDE, GUIDE_LISTS, GUIDE_PHASES, GUIDE_ACTIONS, GUIDE_MENU_ACTIONS, guideSteps, guideDay, startGuide, guideCheck, renderGuide, guidePulse, guideDefault, guideMenuRow,
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

// The dawn that ends the guide's night n (ui/guide.js nightDawn).
const dawnOf = (g, n) => (Math.floor(g.h0 / 24) + n) * 24 + 6;
const NIGHTS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh"];

// ---------- a hub start ----------
section("Hub start: the base list, day by day, ticks off from the state");
{
  const st = createWorld({ seed, factionCount: 5 });
  st.noWanderers = true;
  const ui = freshUi();
  check(startGuide(st, false) === null && !st.guide, "box off: no guide is made");
  const g = startGuide(st, true);
  check(g && g.kind === "base" && g.on && guideSteps(g).map((x) => x.id).join() === GUIDE_LISTS.base.join(), `the base list (${GUIDE_LISTS.base.join(", ")})`);
  for (const [kind, ph] of Object.entries(GUIDE_PHASES)) {
    check(ph.length === GUIDE.DAYS && ph.every((x, i) => x.label === `Day ${i + 1}` && x.sub && x.ids.length >= 2 && x.ids.length <= 6 && x.ids[x.ids.length - 1] === (i ? `night${i + 1}` : "night")), `${kind}: a day for each of the ${GUIDE.DAYS}, each ending with its night (the user's request 2026-10-28)`);
    check(new Set(GUIDE_LISTS[kind]).size === GUIDE_LISTS[kind].length, `${kind}: no step twice`);
    check(["scavenge", "raid", "work", "food", "farm", "defence"].every((id) => GUIDE_LISTS[kind].includes(id)), `${kind}: the week has a raid, work at the base, food, farming and a defence`);
  }
  check(guideSteps(g).filter((x) => /^night/.test(x.id)).map((x) => x.title).join("|") === NIGHTS.map((n) => `Get through the ${n} night`).join("|"), "the nights by name, first to seventh");
  check(guideSteps(g).every((x) => x.title && x.why && x.why.length > 30 && typeof x.done === "function" && typeof x.show === "function"), "every step has a title, a why line, a test and a Show me");
  check(new Set(guideSteps(g).filter((x) => /^night/.test(x.id)).map((x) => x.why)).size === GUIDE.DAYS, "each night says something of its own");
  const cards0 = st.cards.length, log0 = st.log.length, hour0 = st.hour;
  check(guideCheck(st, ui).length === 0 && !Object.keys(g.done).length, "nothing is ticked at the start (the hub's own farmers and guard do not count)");
  check(st.cards.length === cards0 && st.log.length === log0 && st.hour === hour0, "the check adds no cards or log lines and moves no clock");
  const day1 = GUIDE_PHASES.base[0].ids;
  let html = renderGuide(st, ui);
  check(g.fold && clean(html) && /class="guide folded"/.test(html) && /Next:/.test(html) && !/gd-show/.test(html) && html.includes(`Day 1 · 0/${day1.length}`), "the card starts folded to its next step, with today's count (the user's request 2026-10-24: the alerts' corner takes less of the map)");
  GUIDE_ACTIONS["gd-fold"](st, ui, {}); // ▾ opens it
  html = renderGuide(st, ui);
  check(clean(html) && /First week/.test(html) && /<b>Day 1<\/b>[^<]*<span class="gd-today">today/.test(html), "the card: clean, Day 1 marked today");
  check((html.match(/data-action="gd-show"/g) || []).length === day1.length && /class="gd-why"/.test(html) && /▶/.test(html), "a Show me on each of today's steps, the next one with its why line");
  check((html.match(/data-action="gd-day"/g) || []).length === GUIDE.DAYS - 1 && !/data-id="raid"/.test(html), "the later days one line each, their steps not shown");
  GUIDE_ACTIONS["gd-day"](st, ui, { day: "3" });
  html = renderGuide(st, ui);
  check(clean(html) && /data-action="gd-show" data-id="raid"/.test(html) && /data-action="gd-show" data-id="night3"/.test(html), "a click on Day 3's line shows its steps");
  GUIDE_ACTIONS["gd-day"](st, ui, { day: "3" });
  check(!/data-id="raid"/.test(renderGuide(st, ui)), "and again folds it");
  GUIDE_ACTIONS["gd-day"](st, ui, { day: "7" });
  html = renderGuide(st, ui);
  check(/gd-step locked"><button class="gd-go" data-action="gd-pick" data-id="hold"[^>]*data-tip="Comes once every step of days 1 to 6 is done/.test(html) && /🔒/.test(html), "day 7's attack: locked until days 1 to 6 are done, its hover says so");
  GUIDE_ACTIONS["gd-day"](st, ui, { day: "7" });
  check(renderGuide(st, { ...ui, started: false }) === "" && renderGuide(st, { ...ui, timelapse: {} }) === "", "hidden before the start and in the timelapse");

  // Show me for each step points at what the screen has.
  for (const id of GUIDE_LISTS.base) {
    const u = freshUi();
    const r = showMe(st, u, id);
    if (/^night/.test(id)) check(r.act.calls.some((c) => c[0] === "panel" && c[1] === "left") && u.tab === "bases" && /class="tabs"[\s\S]*?<\/div><div class="card">/.test(renderLeft(st, u)), `Show me (${id}): the Bases tab, the hub's card first`);
    else check(r.hit.length > 0, `Show me (${id}): ${r.sels.join(" | ")} found on screen (calls ${r.act.calls.map((c) => c[0]).join(", ")})`);
  }
  { const u = freshUi(); showMe(st, u, "stores"); check(u.baseView && u.baseView.tab === "farming", "Show me (stores) opens the Farming tab"); }
  { const u = freshUi(); const r = showMe(st, u, "scavenge"); check(u.selected >= 0 && st.tiles[u.selected].loc && r.act.calls.some((c) => c[0] === "panel" && c[1] === "right"), `Show me (scavenge) picks a site near the hub (${st.tiles[u.selected] && st.tiles[u.selected].loc ? st.tiles[u.selected].loc.name : "none"}) and shows the right panel`); }
  { const u = freshUi(); GUIDE_ACTIONS["gd-show"](st, u, { id: "nope" }, fakeAct(u)); check(!u.guidePulse, "an unknown step does nothing"); }

  // Day 1: stores, work, the clock.
  ui.baseView = { id: hub(st).id, tab: "farming" };
  let fresh = guideCheck(st, ui);
  check(fresh.length === 1 && fresh[0].id === "stores" && g.done.stores === st.hour && ui.flash && /First week/.test(ui.flash.text) && ui.flash.text.includes(`Day 1: 1 of ${day1.length}`), `stores ticks off with a toast and today's count (${ui.flash && ui.flash.text})`);
  ui.baseView = null;
  check(!g.done.wood && !alive(st).some((s) => s.role === "wood"), "nobody starts on Cut wood");
  WORK_ACTIONS.weveryone(st, ui, { base: String(hub(st).id) });
  check(guideCheck(st, ui).some((x) => x.id === "work"), "work: everyone on priorities");
  // Day 2's, done early: a building, wood. Steps tick on any day.
  const type = Object.keys(BUILDINGS).find((k) => canBuild(st, hub(st), k).ok && !BUILDINGS[k].tab && k !== "farm_plot");
  check(!!type && /queued/.test(queueBuild(st, hub(st), type)), `a building queued (${type})`);
  check(guideCheck(st, ui).some((x) => x.id === "build") && !g.done.farm, "build: a building queued (on day 1: steps tick on any day)");
  // wood: on priorities, the hour's job picked may already be Cut wood (work.js sets s.role to it), and that ticks it.
  // Else someone put on Cut wood (a fixed job) ticks it; that path is also played on a world of its own below.
  const byWork = alive(st).some((s) => s.role === "wood" && s.location.kind === "base");
  check(!!g.done.wood === byWork, `wood: ticked with everyone on priorities only when the hour's job is Cut wood (${byWork ? "someone is on it" : "nobody is"})`);
  const fixedRole = (s0, ui0, role, id) => { const w = alive(s0).find((s) => s.location.kind === "base" && s.role !== role); w.role = role; if (w.work) w.work.role = null; return guideCheck(s0, ui0).some((x) => x.id === id); };
  if (!byWork) check(fixedRole(st, ui, "wood", "wood"), "wood: someone on Cut wood");
  {
    const s2 = createWorld({ seed, factionCount: 5 });
    s2.noWanderers = true;
    const u2 = freshUi();
    const g2 = startGuide(s2, true);
    check(guideCheck(s2, u2).length === 0 && !g2.done.wood && fixedRole(s2, u2, "wood", "wood") && !!g2.done.wood, "wood: someone put on Cut wood (a fixed job) ticks it");
    check(!g2.done.food && fixedRole(s2, u2, "forage", "food") && !!g2.done.food, "food: someone put on Forage ticks it");
    // The first dawn: night 1 over, Day 2's toast says what the day is about.
    s2.hour = dawnOf(g2, 1);
    const f2 = guideCheck(s2, u2);
    check(f2.some((x) => x.id === "night") && guideDay(s2, g2) === 2 && u2.flash.text.includes(`Day 2: ${GUIDE_PHASES.base[1].sub}`), `the first dawn: the first night ticked, day 2 begins (${u2.flash.text})`);
    check(guideDay({ hour: dawnOf(g2, 1) - 1 }, g2) === 1 && guideDay({ hour: dawnOf(g2, 3) }, g2) === 4 && guideDay({ hour: dawnOf(g2, 20) }, g2) === GUIDE.DAYS, "the guide's day turns at each dawn and stops at day 7");
  }
  // Day 3: a team out (any mission), then home; a raid.
  check(!g.done.scavenge && !g.done.home, "no team out yet");
  const h = hub(st);
  const near = st.grid.within(h.tile, 3).find((id) => id !== h.tile && st.tiles[id].terrain !== "water" && st.grid.distance(id, h.tile) >= 2);
  const crew = alive(st).slice(0, 2).map((s) => s.id);
  const res = launchExpedition(st, { memberIds: crew, dest: near, mission: "recon", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4 } });
  check(!res.error, `a team launched (${res.error || "ok"})`);
  check(guideCheck(st, ui).some((x) => x.id === "scavenge") && g.sent.length === 1 && g.sent[0].mission === "recon", "scavenge: the team that set out is noted, with its mission");
  check(!g.done.clock && !g.done.night, "the clock has not run yet");
  tickHour(st); st.cards.length = 0;
  check(guideCheck(st, ui).some((x) => x.id === "clock"), "clock: an hour went by");
  const p = st.parties.find((x) => x.id === g.sent[0].id);
  run(st, 200, () => { guideCheck(st, ui); return !!g.done.home && !!g.done.night; }, () => { if (st.parties.includes(p) && p.phase === "waiting") startReturn(st, p); });
  check(!!g.done.night && g.done.night >= dawnOf(g, 1), `night: ticked at the first dawn (hour ${g.done.night})`);
  check(!!g.done.home && !st.parties.includes(p) && crew.some((id) => st.survivors.find((s) => s.id === id).location.kind === "base"), `home: the team got back (hour ${g.done.home})`);
  check(!g.done.raid, "raid: a recon team home is not a raid");
  st.combat = { raid: {}, setup: {} }; // a raid's map up
  guideCheck(st, ui);
  st.combat = null;
  check(g.done.raid != null && g.raided != null, "raid: a raid's map came up");
  // Day 4 to 6: food, a farm plot, a first defence.
  if (!g.done.food) check(fixedRole(st, ui, "fish", "food") || fixedRole(st, ui, "forage", "food"), "food: someone on Fish or Forage");
  check(/queued/.test(queueBuild(st, hub(st), "farm_plot")) && guideCheck(st, ui).some((x) => x.id === "farm"), "farm: a farm plot queued (more than the hub's own)");
  const def = Object.keys(BUILDINGS).find((k) => BUILDINGS[k].tab === "defenses" && canBuild(st, hub(st), k).ok);
  check(!!def && /queued/.test(queueBuild(st, hub(st), def)) && guideCheck(st, ui).some((x) => x.id === "defence"), `defence: a first defence queued (${def})`);
  // Day 2's water boiler (the user's request 2026-10-28: "build a boiler to purify the water").
  check(guideSteps(g).find((x) => x.id === "boiler").why.includes("wrench") && GUIDE_PHASES.base[1].ids.includes("boiler") && GUIDE_PHASES.road[1].ids.includes("boiler"), "boiler: on day 2 of both lists, and it names the wrench it needs");
  hub(st).armory.push(newItem("toolkit"));
  Object.assign(hub(st).stock, { scrap: (hub(st).stock.scrap || 0) + 10, stone: (hub(st).stock.stone || 0) + 10 });
  check(/queued/.test(queueBuild(st, hub(st), "boiler")) && guideCheck(st, ui).some((x) => x.id === "boiler"), "boiler: a water boiler queued");
  // Day 7: the diary; the nights to the sixth.
  ui.diary = { day: 1 };
  check(guideCheck(st, ui).some((x) => x.id === "diary"), "diary: opened");
  ui.diary = null;
  st.hour = dawnOf(g, 6);
  guideCheck(st, ui);
  check(g.on && ["night2", "night3", "night4", "night5", "night6"].every((id) => g.done[id] != null) && g.done.night7 == null && guideDay(st, g) === 7, "the nights tick at their dawns; day 7, its night still ahead");
  check(g.ready === st.hour, "days 1 to 6 all done: ready for the seventh night's attack (g.ready)");
  GUIDE_ACTIONS["gd-fold"](st, ui, {}); GUIDE_ACTIONS["gd-fold"](st, ui, {}); // as it was: open
  html = renderGuide(st, ui);
  check(clean(html) && (html.match(/class="gd-phase gd-dayline past/g) || []).length === GUIDE.DAYS - 1 && /<b>Day 7<\/b>[^<]*<span class="gd-today">today/.test(html) && (html.match(/data-action="gd-show"/g) || []).length === 2 && /data-id="hold"/.test(html) && /data-id="night7"/.test(html), "day 7: the six days behind it one line each; the attack and the night left");
  // The seventh night's attack (sim/firstweekattack.js), played through the hours: Defend, played out headless.
  putBack(st, hub(st).tile, null, 12); // the dead about, so it comes
  for (const s of alive(st)) s.health = 100;
  st.hour = dawnOf(g, 7) - 10; // 20:00 of day 7
  st.cards.length = 0;
  let atk = null;
  for (let i = 0; i < 9 && !atk; i++) { tickHour(st); guideCheck(st, ui); atk = st.cards.find((c) => c.campAttack === hub(st).id || c.firstWeek === hub(st).id); if (!atk) st.cards.length = 0; }
  check(!!atk && g.attack && !g.attack.quiet && g.done.hold == null && st.log.some((l) => /watching/.test(l.text)), `the seventh night: warned, then the attack (${atk ? atk.title : "none"}); not held yet`);
  if (atk) { st.cards.splice(st.cards.indexOf(atk), 1); atk.choices.find((x) => x.default).resolve(st); }
  st.cards.length = 0;
  guideCheck(st, ui);
  check(g.done.hold != null && g.on, "hold: the fight over, the step ticked");
  st.hour = dawnOf(g, 7);
  guideCheck(st, ui);
  check(!g.on && g.ended === "done" && g.done.night7 != null && /every step done/.test(ui.flash.text) && renderGuide(st, ui) === "", "the seventh night over and every step done: the guide steps aside with a toast");
  // The menu brings a finished one back fresh, kept past the week; again hides it.
  openSettings(ui, "game");
  SETTINGS_ACTIONS["gd-toggle"](st, ui, {});
  check(st.guide.on && st.guide.keep && !Object.keys(st.guide.done).length && /back/.test(ui.settings.msg), "Menu → Show: a fresh guide, kept past day 7");
  SETTINGS_ACTIONS["gd-toggle"](st, ui, {});
  check(!st.guide.on && st.guide.ended === "closed", "Menu → Hide");
}

// ---------- the week, ✕, fold, saves ----------
section("Off after the seventh night, ✕ and fold, saved with the world");
{
  const st = createWorld({ seed: seed + 1, factionCount: 5 });
  const ui = freshUi();
  const g = startGuide(st, true);
  // Days left behind: their open steps under "still to do", the next one the first of them.
  st.hour = dawnOf(g, 2); // day 3
  guideCheck(st, ui);
  GUIDE_ACTIONS["gd-fold"](st, ui, {});
  let html = renderGuide(st, ui);
  check(clean(html) && (html.match(/still to do/g) || []).length === 2 && /<b>Day 3<\/b>[^<]*<span class="gd-today">today/.test(html) && /gd-step cur"><button class="gd-go" data-action="gd-pick" data-id="stores"/.test(html) && !/data-id="night2"[^>]*>[^<]*<span class="gd-mark">○/.test(html), "day 3 with nothing done: days 1 and 2's open steps under still to do, the next the first of them");
  GUIDE_ACTIONS["gd-fold"](st, ui, {});
  st.hour = dawnOf(g, GUIDE.DAYS) - 1;
  guideCheck(st, ui);
  check(g.on && day(st) === GUIDE.DAYS + 1, "day 8 before dawn: the seventh night not over, still on");
  st.hour = dawnOf(g, GUIDE.DAYS);
  guideCheck(st, ui);
  check(!g.on && g.ended === "days" && /day 7/.test(ui.flash.text), "the dawn after the seventh night: it steps aside by itself");
  openSettings(ui, "game");
  SETTINGS_ACTIONS["gd-toggle"](st, ui, {});
  check(st.guide === g && g.on && g.keep && g.done.clock != null, "Menu → Show on day 8: the same list (its progress kept), kept on");
  st.hour += 48;
  guideCheck(st, ui);
  check(g.on, "brought back by hand: not switched off again by the day");
  html = renderGuide(st, ui);
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
section(`Road start (${mode}): the road list day by day, the shelter on day ${GUIDE.DAYS}`);
{
  const st = createWorld({ seed: seed0, factionCount: 7, mode, roadStart: true });
  st.noWanderers = true;
  const ui = freshUi();
  const g = startGuide(st, true);
  check(g.kind === "road" && guideSteps(g).map((x) => x.id).join() === GUIDE_LISTS.road.join(), `the road list (${GUIDE_LISTS.road.join(", ")})`);
  const ph = GUIDE_PHASES.road;
  check(["team", "water", "fire", "camp", "night"].every((id) => ph[0].ids.includes(id)) && ["found", "night7"].every((id) => ph[GUIDE.DAYS - 1].ids.includes(id)) && ph[2].ids.includes("raid"), "day 1: off the road, into a camp, through the night; a raid on day 3; the shelter on day 7 (the user's request 2026-10-28)");
  check(/by day 7/.test(guideSteps(g).find((x) => x.id === "found").title), "the shelter's step says it is the week's goal");
  const p = roadTeam(st);
  const fireHeld = () => ["wood", "stone"].every((k) => ((p.supplies[k] || 0) + ((p.cargo && p.cargo.supplies[k]) || 0)) >= 8);
  check(guideCheck(st, ui).length === 0 || (fireHeld() && Object.keys(g.done).join() === "fire"), "nothing ticked at the start");
  for (const id of GUIDE_LISTS.road) {
    const u = freshUi();
    const r = showMe(st, u, id);
    check(r.hit.length > 0, `Show me (${id}, on the road): ${r.sels.join(" | ")} found on screen`);
  }
  { const u = freshUi(); const r = showMe(st, u, "farm"); check(r.sels.some((x) => /establish/.test(x)), "Show me (a step for the camp, before it): the team's Establish base"); }
  GUIDE_ACTIONS["gd-fold"](st, ui, {});
  let html = renderGuide(st, ui);
  check(clean(html) && /<b>Day 1<\/b>[^<]*<span class="gd-today">today/.test(html) && (html.match(/data-action="gd-show"/g) || []).length === ph[0].ids.length && (html.match(/data-action="gd-day"/g) || []).length === GUIDE.DAYS - 1, "the card: Day 1's steps, the six days after one line each");
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
  for (const id of ["work", "boiler", "wood", "food", "scavenge", "raid", "place", "needs", "farm", "defence", "found"]) {
    const u = freshUi();
    const r = showMe(st, u, id);
    check(r.hit.length > 0, `Show me (${id}, at the camp): ${r.sels.join(" | ")} found on screen`);
  }
  { const u = freshUi(); showMe(st, u, "scavenge"); check(u.selected >= 0 && st.tiles[u.selected].loc, "Show me (scavenge, at the camp) picks a site near it"); }
  // Day 2: the camp at work.
  WORK_ACTIONS.weveryone(st, ui, { base: String(hub(st).id) });
  check(guideCheck(st, ui).some((x) => x.id === "work"), "work: the camp on priorities");
  if (!g.done.food) { const w = alive(st).find((s) => s.location.kind === "base"); w.role = "forage"; if (w.work) w.work.role = null; check(guideCheck(st, ui).some((x) => x.id === "food"), "food: someone on Forage at the camp"); }
  // Day 3: a team out from the camp, a raid.
  const camp = hub(st);
  const near = st.grid.within(camp.tile, 3).find((id) => id !== camp.tile && st.tiles[id].terrain !== "water" && st.grid.distance(id, camp.tile) >= 2);
  const crew = alive(st).filter((s) => s.location.kind === "base").slice(0, 1).map((s) => s.id);
  const res = launchExpedition(st, { memberIds: crew, dest: near, mission: "recon", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2 } });
  check(!res.error && guideCheck(st, ui).some((x) => x.id === "scavenge") && g.sent.length === 1, `scavenge: a team set out from the camp (${res.error || "ok"})`);
  st.combat = { raid: {}, setup: {} };
  guideCheck(st, ui);
  st.combat = null;
  check(g.done.raid != null, "raid: a raid's map came up");
  // Day 4: the shack placed; day 5: its needs, a farm plot; day 6: a defence.
  check(!g.done.needs && !g.done.place, "the shack not placed yet");
  check(guideSteps(g).find((x) => x.id === "needs").why.includes("200 wood") && guideSteps(g).find((x) => x.id === "wood").why.includes("200 wood"), "needs and wood: the steps name the wood the step up takes");
  check(!tierUpJob(hub(st)) && !guideCheck(st, ui).some((x) => x.id === "place"), "place: nothing placed for the player (the user's request 2026-10-23: no shelter set when the camp is established)");
  queueBuild(st, hub(st), tierUpType(hub(st))); // the Camp tab's Place the shelter shack
  check(guideCheck(st, ui).some((x) => x.id === "place") && !g.done.needs, "place: the shack placed, its needs not in");
  Object.assign(hub(st).stock, { scrap: 30, buildmat: 2, wood: 400 }); // a trip home with the rest (the wood: a Cut wood order)
  const fresh = guideCheck(st, ui);
  check(fresh.some((x) => x.id === "needs") && g.done.wood != null, "needs: everything is in; wood: someone on it or the pile grew");
  run(st, 24 * 8, () => { guideCheck(st, ui); return !!hub(st) && hub(st).camp !== true; });
  run(st, 30, () => { guideCheck(st, ui); return !!g.done.night; }); // the shelter can stand within a day (20 work-hours): its first night after it
  guideCheck(st, ui);
  check(!!hub(st) && !!g.done.found && !!g.done.clock && !!g.done.night, `found: the shelter stands (day ${day(st)}), the clock and the first night ticked`);
  // Days 5, 6 and 2's builds, at the shelter (queued after the shack: the builders take the queue in order).
  check(!/queued/.test(queueBuild(st, hub(st), "farm_plot")) && guideSteps(g).find((x) => x.id === "farm").why.includes("shovel"), "farm: no plot without a shovel, and the step says so");
  hub(st).armory.push(newItem("shovel"), newItem("toolkit")); // found on a raid
  check(/queued/.test(queueBuild(st, hub(st), "farm_plot")) && guideCheck(st, ui).some((x) => x.id === "farm"), "farm: a farm plot queued at the shelter");
  const def = Object.keys(BUILDINGS).find((k) => BUILDINGS[k].tab === "defenses" && canBuild(st, hub(st), k).ok);
  check(!!def && /queued/.test(queueBuild(st, hub(st), def)) && guideCheck(st, ui).some((x) => x.id === "defence"), `defence: a first defence queued at the shelter (${def})`);
  Object.assign(hub(st).stock, { scrap: (hub(st).stock.scrap || 0) + 10, stone: (hub(st).stock.stone || 0) + 10 });
  check(/queued/.test(queueBuild(st, hub(st), "boiler")) && guideCheck(st, ui).some((x) => x.id === "boiler"), "boiler: a water boiler queued at the shelter (the toolkit's wrench)");
  check(g.on && !g.done.diary, "still on until the diary and the nights");
  // A road guide over (the hub stands) and closed: the menu starts the base list.
  GUIDE_ACTIONS["gd-close"](st, ui, {});
  openSettings(ui, "game");
  SETTINGS_ACTIONS["gd-toggle"](st, ui, {});
  check(st.guide.on && st.guide.kind === "base", "Menu → Show once the hub stands: the base list");
}
}
section("Road start: a camp but no shelter by the end of the week");
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
  st.hour = dawnOf(g, GUIDE.DAYS);
  guideCheck(st, ui);
  check(!g.on && g.ended === "days" && /No shelter yet/.test(ui.flash.text) && /Camp tab/.test(ui.flash.text), `after the seventh night it steps aside, saying where the shelter stands (${ui.flash.text})`);
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
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  check(/First-week guide/.test(readme) && /Start here/.test(readme) && /guidetest/.test(readme), "the README describes the guide, Start here and this test");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  check(["guideCheck(state, ui)", "renderGuide(state, ui)", "guidePulse(ui)", "startGuide(state, ui.guide)", "\"nr-guide\":", "GUIDE_ACTIONS"].every((k) => main.includes(k)), "main.js: the check, the card, the pulse, the start, the box and the actions are hooked in");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  check(/\.gd-pulse\s*\{/.test(css) && /@keyframes gdpulse/.test(css) && /\.guide\s*\{/.test(css), "styles: the card and the pulse");
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
