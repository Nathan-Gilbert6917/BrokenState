// Rotating autosaves, the save list by campaign and the error screen (ui/saves.js writeAutosave, ui/savelist.js,
// sim/savesummary.js, ui/crash.js; a stand-in localStorage, no browser).
// Usage: node tools/savehealthtest.js
// - The summary line: "Day N · X people · season", then the run's end, a war you joined, a hostile group or a
//   Hardcore band on the road.
// - Autosaves: each campaign keeps its last 3 (the oldest written over), named by the summary; another campaign keeps
//   its own; a one-slot autosave of an older build is replaced by its own campaign's first rotating one (another
//   campaign's stays); none in Ironman (its one slot); a full storage clears the slot being written over, then older
//   autosaves (the newest stays).
// - The menu's save list: one head line per campaign (the game being played first), the summary under a manual save,
//   a warning when the saves fill most of the storage.
// - The error screen: a crash stops the clock and writes the crash slot (never an Ironman game's slot; its copy goes
//   when the game saves itself again); errors while it is up are counted, not handled again; a crash soon after Try to
//   keep playing comes back with a warning and keeps the first crash save; the report has the error, stack, day,
//   seed, map, mode and the last log lines; Load the crash save and Back to title.
import { createWorld, tickHour, day, alive } from "../src/sim/world.js";
import { WORLD_SIZES } from "../src/sim/worldsize.js"; // the crash report names the map's size
import { setAutopilot } from "../src/sim/autopilot.js";
import { saveSummary, campaignKey, newCampaignId } from "../src/sim/savesummary.js";
import * as Saves from "../src/ui/saves.js";
import { autosaveCheck, settingsModal, openSettings } from "../src/ui/settings.js";
import { initCrash, reportCrash, crashUp, crashState, crashReport, crashChoose, REPEAT_MS } from "../src/ui/crash.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
const t0 = performance.now();

// A stand-in browser storage that counts characters; cap: the most it holds (keys and values), like a browser's quota.
const store = new Map();
let cap = Infinity;
const used = () => { let n = 0; for (const [k, v] of store) n += k.length + v.length; return n; };
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    v = String(v);
    if (used() - (store.has(k) ? k.length + store.get(k).length : 0) + k.length + v.length > cap) throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    store.set(k, v);
  },
  removeItem: (k) => store.delete(k),
};
const pending = [];
const settle = async () => { while (pending.length) await pending.shift(); };
const mkApi = (opts = {}) => ({
  options: { ...Saves.DEFAULT_OPTIONS, ...opts }, desktop: false, autosaveInfo: () => ({ error: "" }), refresh() {}, thumb: () => "",
  track: (p) => pending.push(p), adopt() {}, newWorld() {}, toTitle() {}, quit() {},
});
let clock = 0;
const frame = async (st, ui, api) => { ui.settings = null; autosaveCheck(st, ui, api, (clock += 70000)); await settle(); };
const world = (seed, opts = {}) => {
  const st = createWorld({ seed, factionCount: 4, size: "small", ...opts });
  st.started = true;
  setAutopilot(st, true, "balanced");
  return st;
};
// The clock moved on to the next dawn (06:00) and the game loop's autosave run there. The world is not played
// through the day (the autosave only reads the clock), which keeps this test quick.
async function toDawn(st, ui, api) {
  st.hour = (Math.floor((st.hour - 6) / 24) + 1) * 24 + 6;
  await frame(st, ui, api);
}
const autosOf = (st) => Saves.campaignAutosaves(campaignKey(st)).sort((a, b) => a.ts - b.ts);

// ---------- 1. the summary line ----------
console.log("The summary line");
{
  const st = world(7);
  const line = saveSummary(st);
  check(/^Day 1 · \d+ people · (spring|summer|autumn|winter)$/.test(line), `a new run: "${line}"`);
  const f = st.factions[0];
  f.known = true; f.goodwill = -60;
  check(saveSummary(st).endsWith(`· ${f.name} hostile`), `a hostile group: "${saveSummary(st)}"`);
  st.diplo = st.diplo || { wars: [] };
  st.diplo.wars = [...(st.diplo.wars || []), { a: st.factions[1].id, b: f.id, playerSide: st.factions[1].id }];
  check(saveSummary(st).endsWith(`· at war with ${f.name}`), `a war you joined: "${saveSummary(st)}"`);
  st.gameOver = true;
  check(saveSummary(st).endsWith("· fallen"), `a fallen run: "${saveSummary(st)}"`);
  const hc = world(11, { mode: "hardcore" });
  check(/on the road$/.test(saveSummary(hc)) || hc.bases.length > 0, `Hardcore before its hub: "${saveSummary(hc)}"`);
  const one = world(5);
  for (const s of alive(one).slice(1)) s.alive = false;
  check(/· 1 person ·/.test(saveSummary(one)), `one survivor: "${saveSummary(one)}"`);
  check(campaignKey({ seed: 42 }) === "seed-42" && campaignKey({ seed: 42, campaign: "cX" }) === "cX" && newCampaignId() !== newCampaignId(), "campaigns: a run's own id, else its seed");
}

// ---------- 2. rotating autosaves ----------
console.log("Rotating autosaves");
{
  store.clear();
  const api = mkApi();
  const A = world(7);
  A.campaign = newCampaignId();
  const ui = { started: true, speed: 1, slot: null };
  await frame(A, ui, api); // the loop meets this world
  const seen = [];
  for (let i = 0; i < 5; i++) { await toDawn(A, ui, api); seen.push(autosOf(A).map((e) => `${e.id}@${e.day}`).join(" ")); }
  const mine = autosOf(A);
  check(mine.length === Saves.AUTO_KEEP, `five dawns, ${mine.length} autosaves kept (${seen[seen.length - 1]})`);
  check(mine.map((e) => e.day).join() === [day(A) - 2, day(A) - 1, day(A)].join(), `the last three days (${mine.map((e) => e.day).join(", ")}; now day ${day(A)})`);
  check(new Set(mine.map((e) => e.id)).size === 3 && mine.every((e) => e.id.startsWith(`auto-${A.campaign}-`) && e.auto), "three slots of this campaign, marked as autosaves");
  check(mine.every((e) => /^Day \d+ · \d+ (people|person) · \w+/.test(e.name) && e.name === e.summary), `each named by its summary ("${mine[2].name}")`);
  check(ui.slot === mine[2].id, "this game's slot is its newest autosave");
  // The oldest is the one written over.
  const oldest = mine[0].id;
  await toDawn(A, ui, api);
  const after = autosOf(A);
  check(after.length === 3 && after[2].id === oldest, `the next one goes over the oldest (${oldest})`);
  // Another campaign keeps its own three.
  const B = world(9);
  B.campaign = newCampaignId();
  const uiB = { started: true, speed: 1, slot: null };
  await frame(B, uiB, api);
  await toDawn(B, uiB, api);
  await toDawn(B, uiB, api);
  check(autosOf(B).length === 2 && autosOf(A).length === 3, `another campaign: its own autosaves (${autosOf(B).length}), the first keeps its 3`);
  // A one-slot autosave of an older build: replaced by its own campaign's first rotating autosave, not another's.
  const C = world(13); // no campaign id: a world from an older save (its seed is its campaign)
  await Saves.writeSave(Saves.AUTOSAVE, C, { why: "dawn" });
  const D = world(17);
  const uiD = { started: true, speed: 1, slot: null };
  await frame(D, uiD, api);
  await toDawn(D, uiD, api);
  check(!!Saves.saveEntry(Saves.AUTOSAVE), "an older build's autosave of another campaign stays");
  const uiC = { started: true, speed: 1, slot: null };
  await frame(C, uiC, api);
  await toDawn(C, uiC, api);
  check(!Saves.saveEntry(Saves.AUTOSAVE) && autosOf(C).length === 1 && autosOf(C)[0].id === "auto-seed-13-1", "its own campaign's first rotating autosave replaces it");
  // Ironman: none.
  const I = world(19);
  I.campaign = newCampaignId();
  I.ironman = { id: "ironRot", since: 1 };
  const uiI = { started: true, speed: 1, slot: null };
  await frame(I, uiI, api);
  await toDawn(I, uiI, api);
  await toDawn(I, uiI, api);
  check(autosOf(I).length === 0 && !!Saves.saveEntry("ironRot"), "Ironman: no rotating autosaves, its own slot only");
  // Storage full: the slot being written over goes first, then older ones; the newest stays.
  const before = autosOf(A);
  const size = before[2].size;
  cap = used() - Math.round(size * 0.5); // no room for one more: the slot written over, then one more must go
  let entry = null, err = null;
  try { entry = await Saves.writeAutosave(A, { why: "dawn" }); } catch (e) { err = e; }
  const left = autosOf(A);
  check(!err && entry && left.length === 2 && left.some((e) => e.id === before[2].id) && left.some((e) => e.id === entry.id), `a full storage: older autosaves make room, the newest stays (${left.length} kept${err ? `; ${err.message}` : ""})`);
  cap = 1000;
  err = null;
  try { await Saves.writeAutosave(A, { why: "dawn" }); } catch (e) { err = e; }
  check(err && err.code === "quota" && autosOf(A).length >= 1, `no room at all: the quota message, the newest autosave kept ("${err && err.message}")`);
  cap = Infinity;
}

// ---------- 3. the save list ----------
console.log("The save list by campaign");
{
  const api = mkApi();
  const A = world(23);
  A.campaign = newCampaignId();
  await Saves.writeSave("s1", A, { name: "Before the raid" });
  const ui = { started: true, scale: 1, speed: 0, slot: "s1" };
  openSettings(ui, "game");
  const html = settingsModal(A, ui, api);
  const groups = (html.match(/class="sgroup"/g) || []).length;
  const camps = new Set(Saves.listSaves().map(Saves.entryCamp)).size;
  check(groups === camps && groups >= 5, `one head line per campaign (${groups} for ${camps})`);
  const heads = html.split('class="sgroup"').slice(1);
  check(heads[0].includes("this game</span>") && heads[0].includes("Before the raid"), "the game being played comes first, its saves under it");
  check(html.includes(`<div class="small">${saveSummary(A)}</div>`), "a manual save shows its summary line");
  check(/the last 3 kept/.test(html), "a campaign's head says its autosaves rotate");
  check(!/Saves fill/.test(html), "no storage warning with room to spare");
  const idx = JSON.parse(store.get("brokenstate.saves"));
  idx.push({ id: "big", name: "Big", ts: 1, size: 4_000_000, seed: 1 });
  store.set("brokenstate.saves", JSON.stringify(idx));
  check(/Saves fill \d+% of this browser's storage/.test(settingsModal(A, ui, api)), `a warning when the saves fill most of the storage (${Math.round(Saves.storageShare() * 100)}%)`);
  Saves.deleteSave("big");
}

// ---------- 4. the error screen ----------
console.log("The error screen");
{
  store.clear();
  let state = world(29);
  state.campaign = newCampaignId();
  for (let i = 0; i < 30; i++) tickHour(state);
  while (state.cards.length) tickHour(state);
  const ui = { started: true, speed: 2, lastSpeed: 1, slot: null };
  const adopted = [], titled = [];
  initCrash({ state: () => state, ui, adopt: (st, e) => { adopted.push([st, e]); state = st; }, toTitle: () => titled.push(1), desktop: false, track: (p) => pending.push(p), refresh() {} });
  const realError = console.error;
  console.error = () => {}; // the crash's console line, expected here
  reportCrash(new Error("boom in a tick"), "the game loop");
  check(crashUp() && ui.speed === 0 && ui.lastSpeed === 2, "a crash stops the clock and opens the screen");
  await settle();
  const e1 = Saves.saveEntry(Saves.CRASH_SAVE);
  check(!!e1 && e1.auto && /^Crash: Day \d+/.test(e1.name) && crashState().saved === "ok", `the crash save is written to its own slot ("${e1 && e1.name}")`);
  reportCrash(new Error("boom again"), "the game loop");
  reportCrash("a string thrown", "a click");
  await settle();
  check(crashState().more === 2 && crashState().error.message === "boom in a tick" && Saves.saveEntry(Saves.CRASH_SAVE).ts === e1.ts, "errors while the screen is up are counted, not handled again");
  const rep = crashReport();
  check(rep.includes("Error: boom in a tick") && rep.includes(`seed ${state.seed}`) && rep.includes(`Small map (${WORLD_SIZES.small.w}×${WORLD_SIZES.small.h})`) && rep.includes("Normal mode") && /Last \d+ log lines/.test(rep) && rep.includes("Crash save: written") && /at .*crashtest|savehealthtest/.test(rep), "the report: error, stack, seed, map, mode, crash save, log lines");
  check((rep.match(/^Day \d+ \d\d:00 {2}/gm) || []).length === Math.min(20, state.log.length), `the last ${Math.min(20, state.log.length)} log lines`);
  crashChoose("keep");
  check(!crashUp() && ui.speed === 0, "Try to keep playing: the screen closes, the game stays paused");
  reportCrash(new Error("boom right after"), "the game loop");
  await settle();
  check(crashUp() && crashState().again && crashState().saved === "ok" && Saves.saveEntry(Saves.CRASH_SAVE).ts === e1.ts, `a crash ${REPEAT_MS / 1000} s after: the screen again, with a warning; the first crash save kept`);
  crashChoose("keep");
  const realNow = Date.now;
  Date.now = () => realNow() + REPEAT_MS + 1000;
  tickHour(state);
  reportCrash(new Error("a later crash"), "the game loop");
  await settle();
  Date.now = realNow;
  check(!crashState().again && Saves.saveEntry(Saves.CRASH_SAVE).ts !== e1.ts, "a crash later on is a new one: the crash save is written again");
  const p = crashChoose("load");
  await p;
  await settle();
  check(!crashUp() && adopted.length === 1 && adopted[0][1].id === Saves.CRASH_SAVE && day(adopted[0][0]) === day(state), "Load the crash save: the world as it crashed");
  reportCrash(new Error("on to the title"), "the game loop");
  await settle();
  // (within REPEAT_MS of the load: shown again with the same crash save)
  crashChoose("title");
  check(!crashUp() && titled.length === 1, "Back to title");
  // Ironman: the game's own slot is never written by a crash; the copy beside it goes once the game saves itself.
  Date.now = () => realNow() + 3 * REPEAT_MS;
  state = world(31);
  state.ironman = { id: "ironCrash", since: 1 };
  await Saves.writeSave("ironCrash", state, { name: "Ironman" });
  const iron0 = Saves.saveEntry("ironCrash");
  tickHour(state);
  reportCrash(new Error("ironman boom"), "the game loop");
  await settle();
  const ce = Saves.saveEntry(Saves.CRASH_SAVE);
  check(Saves.saveEntry("ironCrash").ts === iron0.ts && ce && ce.iron === "ironCrash" && ce.hour === state.hour % 24, "Ironman: the crash copy sits beside the game's slot, which keeps its last save");
  crashChoose("keep");
  Date.now = realNow;
  const api = mkApi();
  const uiI = { started: true, speed: 1, slot: "ironCrash" };
  await frame(state, uiI, api);
  await toDawn(state, uiI, api);
  check(!Saves.saveEntry(Saves.CRASH_SAVE) && Saves.saveEntry("ironCrash").why === "dawn", "the copy is removed once the Ironman game saves itself again");
  // Not in a game (the title screen): nothing to save.
  Date.now = () => realNow() + 6 * REPEAT_MS;
  ui.started = false;
  reportCrash(new Error("title boom"), "the game loop");
  await settle();
  check(crashState().saved === "none" && !Saves.saveEntry(Saves.CRASH_SAVE), "on the title screen: the screen, no crash save");
  crashChoose("keep");
  Date.now = realNow;
  console.error = realError;
}

// ---------- 5. the hooks in main.js (the frame loop and the page closing run only in a browser) ----------
console.log("The hooks in main.js");
{
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const frameFn = (src.match(/function frame\(now\) \{[\s\S]*?\n\}/) || [""])[0];
  check(/if \(crashUp\(\)\)/.test(frameFn) && /catch \(e\) \{[\s\S]*reportCrash\(e/.test(frameFn), "the frame loop: an exception opens the error screen, no frames run under it");
  check(/beforeunload[\s\S]{0,80}if \(crashUp\(\)\) return/.test(src) && /document\.hidden && !crashUp\(\)\) ironHidden/.test(src), "an Ironman slot is not written by the page closing or hiding under the error screen");
  check(/initCrash\(\{/.test(src) && /state\.campaign = newCampaignId\(\)/.test(src), "main.js starts the error screen and gives each new run its campaign id");
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
