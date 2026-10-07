// The battle-start save and Ironman (ui/settings.js autosaveCheck, ui/saves.js; a stand-in localStorage):
// - Battle start: the save written as a battle opens (its own slot, open cards left out), Restart battle loading it
//   back to turn 1 with everyone as they were, a later battle taking the slot (the old battle's Restart is refused),
//   none with the option off, on autopilot or in Ironman.
// - Ironman: the game's own slot written at the start, at dawn, when a battle starts and ends, at the end of the run;
//   never the autosave slot; a card waiting holds it; saving, loading, files, exporting and Exit without saving refused;
//   Save and exit writes it and leaves; the page closing writes it at once (uncompressed) and it loads; the menu shows
//   no save buttons; the new-run screen's Ironman box; a loaded Ironman game stays one.
// Usage: node tools/ironmantest.js
import { tickHour, addCard, day } from "../src/sim/world.js";
import { autoPlayerTurn, runEnemyPhase } from "../src/sim/combat.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { battles, world } from "./isobattles.js";
import * as Saves from "../src/ui/saves.js";
import { autosaveCheck, SETTINGS_ACTIONS, settingsModal, openSettings, ironUnload, ironHidden, initSettings } from "../src/ui/settings.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const pending = [];
const adopted = [];
let left = 0;
const mkApi = (opts = {}) => ({
  options: { ...Saves.DEFAULT_OPTIONS, ...opts }, desktop: false, autosaveInfo: () => ({ error: "" }), refresh() {}, thumb: () => "",
  track: (p) => pending.push(p), adopt: (st, entry) => adopted.push({ st, entry }), newWorld: () => { left++; }, quit() {},
});
const settle = async () => { while (pending.length) await pending.shift(); };
let clock = 0;
// One frame of the game loop's autosave (main.js): with the menu closed.
const frame = async (st, ui, api) => { ui.settings = null; autosaveCheck(st, ui, api, (clock += 70000)); await settle(); };
const clearStore = () => store.clear();

// ---------- 1. the battle-start save ----------
console.log("The battle-start save and Restart battle");
{
  clearStore();
  const { st, b } = battles(5, ["field-forest"])[0];
  const ui = { started: true, speed: 1, slot: null };
  const api = mkApi();
  st.combat = null;
  await frame(st, ui, api); // the loop meets this world first (no battle yet)
  addCard(st, { title: "Something else", text: "", choices: [{ label: "OK", resolve: () => "" }] }); // a card open as the battle starts
  st.combat = b;
  await frame(st, ui, api);
  const e = Saves.saveEntry(Saves.BATTLE_SAVE);
  check(!!e && e.bkey && e.bkey === b.saveKey && b.saveOk && e.auto, `a save as the battle opens, its own slot ("${e && e.name}")`);
  check(!Saves.saveEntry(Saves.AUTOSAVE), "it is not the autosave");
  const hp0 = b.units.map((u) => u.hp).join(",");
  for (let i = 0; i < 6 && !b.over; i++) { autoPlayerTurn(st); if (!b.over) runEnemyPhase(st); }
  check(b.turn > 1, `the battle went on (turn ${b.turn})`);
  st.cards.length = 0;
  openSettings(ui, "game");
  SETTINGS_ACTIONS["set-battlereload"](st, ui, {}, api);
  check(!!ui.settings.confirm && /Restart this battle/.test(ui.settings.confirm.text), "Restart battle asks first");
  ui.settings.confirm.go();
  await settle();
  const a = adopted.pop();
  const L = a && a.st;
  check(L && L.combat && L.combat.turn === 1 && !L.combat.acted && L.combat.units.map((u) => u.hp).join(",") === hp0 && a.entry.id === Saves.BATTLE_SAVE, "it loads the battle back at turn 1, everyone as they were");
  check(L && L.combat.saveKey === b.saveKey && L.combat.saveOk, "the loaded battle can be restarted again");
  check(L && L.cards.length === 0, "an open card is left out of the battle save (cards cannot be saved)");
  // The same battle loaded: no second save of it.
  const ts = Saves.saveEntry(Saves.BATTLE_SAVE).ts;
  const ui2 = { started: true, speed: 1, slot: Saves.BATTLE_SAVE };
  await frame(L, ui2, api);
  await frame(L, ui2, api);
  check(Saves.saveEntry(Saves.BATTLE_SAVE).ts === ts, "loading the battle start does not write it again");
  // A later battle takes the slot: the old battle's Restart is refused.
  const nb = battles(6, ["field-town"])[0];
  const ui3 = { started: true, speed: 1, slot: null };
  nb.st.combat = null;
  await frame(nb.st, ui3, api);
  nb.st.combat = nb.b;
  await frame(nb.st, ui3, api);
  check(Saves.saveEntry(Saves.BATTLE_SAVE).bkey === nb.b.saveKey, "a later battle's start takes the slot");
  openSettings(ui2, "game");
  SETTINGS_ACTIONS["set-battlereload"](L, ui2, {}, api);
  check(!ui2.settings.confirm && /gone/.test(ui2.settings.msg), `the earlier battle's Restart is refused ("${ui2.settings.msg}")`);
  // Off, on autopilot: none.
  for (const [what, setup] of [["the option off", (s) => ({ battleSave: false })], ["on autopilot", (s) => { setAutopilot(s, true); return {}; }]]) {
    clearStore();
    const x = battles(7, ["field-forest"])[0];
    const o = setup(x.st);
    const api2 = mkApi(o);
    const u = { started: true, speed: 1, slot: null };
    const bb = x.st.combat;
    x.st.combat = null;
    await frame(x.st, u, api2);
    x.st.combat = bb;
    await frame(x.st, u, api2);
    check(!Saves.saveEntry(Saves.BATTLE_SAVE), `no battle-start save with ${what}`);
  }
}

// ---------- 2. Ironman ----------
console.log("Ironman");
{
  clearStore();
  const st = world(11, 2);
  st.ironman = { id: "ironT", since: 1 };
  const ui = { started: true, speed: 1, slot: null };
  const api = mkApi();
  await frame(st, ui, api);
  await frame(st, ui, api);
  const e0 = Saves.saveEntry("ironT");
  check(!!e0 && e0.ironman && e0.iron === "ironT" && e0.auto && ui.slot === "ironT", "a new Ironman game is saved to its own slot at once");
  // Dawn.
  const d0 = day(st);
  while (day(st) === d0 || st.hour % 24 < 7) { tickHour(st); st.cards.length = 0; }
  await frame(st, ui, api);
  check(Saves.saveEntry("ironT").day === day(st) && Saves.saveEntry("ironT").why === "dawn", `saved at dawn (day ${Saves.saveEntry("ironT").day})`);
  check(!Saves.saveEntry(Saves.AUTOSAVE) && !Saves.saveEntry(Saves.BATTLE_SAVE), "never the autosave slot or a battle-start save");
  // A card waiting holds the save.
  addCard(st, { title: "Wait", text: "", choices: [{ label: "OK", resolve: () => "" }] });
  const d1 = day(st);
  while (day(st) === d1 || st.hour % 24 < 7) tickHour(st);
  const keep = st.cards.splice(0, st.cards.length - 0);
  st.cards.push(keep[0]);
  await frame(st, ui, api);
  check(Saves.saveEntry("ironT").day === d1, "a card waiting holds the save");
  st.cards.length = 0;
  await frame(st, ui, api);
  check(Saves.saveEntry("ironT").day === day(st), "answered: saved");
  // A battle starts and ends.
  const bt = battles(12, ["field-forest"])[0].b;
  st.combat = bt;
  await frame(st, ui, api);
  check(Saves.saveEntry("ironT").why === "a battle started", "saved when a battle starts");
  check(!bt.saveOk && !bt.saveKey, "no battle-start save (no Restart battle in Ironman)");
  st.combat = null;
  await frame(st, ui, api);
  check(Saves.saveEntry("ironT").why === "a battle ended", "saved when the battle ends");
  // The menu: refused.
  openSettings(ui, "game");
  const before = Saves.listSaves().length;
  for (const a of ["set-save", "set-savenew", "set-tofile", "set-load", "set-exit"]) {
    ui.settings.msg = "";
    SETTINGS_ACTIONS[a](st, ui, { id: "ironT" }, api);
    await settle();
    check(/Ironman/.test(ui.settings.msg) && ui.settings.err && !ui.settings.confirm, `${a} is refused ("${ui.settings.msg.slice(0, 60)}…")`);
  }
  check(Saves.listSaves().length === before, "nothing new was saved");
  ui.settings.msg = "";
  SETTINGS_ACTIONS["set-export"](st, ui, { id: "ironT" }, api);
  check(/cannot be exported/.test(ui.settings.msg), "its save cannot be exported");
  const html = settingsModal(st, ui, api);
  check(/Ironman/.test(html) && !/data-action="set-save"/.test(html) && !/data-action="set-savenew"/.test(html) && !/data-action="set-tofile"/.test(html) && !/data-action="set-export" data-id="ironT"/.test(html) && /data-action="set-saveexit"/.test(html), "the menu: no Save, Save as new, Save to file or Export; Save and exit");
  check(/data-action="set-load"[^>]*disabled/.test(html), "Load is greyed out while playing it");
  // The page closes: written at once.
  tickHour(st);
  st.cards.length = 0;
  check(ironUnload(st, ui) && store.get("brokenstate.save.ironT").startsWith("BSJ1|") && Saves.saveEntry("ironT").hour === st.hour % 24, "the page closing writes it at once (uncompressed)");
  const L = await Saves.readSave("ironT");
  check(L.ironman && L.ironman.id === "ironT" && L.hour === st.hour, "and it loads, still an Ironman game");
  addCard(st, { title: "Wait", text: "", choices: [] });
  check(!ironUnload(st, ui), "with a card waiting the last save stands");
  st.cards.length = 0;
  // The window hidden: saved at once (the game loop stops while hidden).
  initSettings(api);
  tickHour(st);
  st.cards.length = 0;
  ironHidden(st, ui);
  await settle();
  check(Saves.saveEntry("ironT").why === "you left the window" && Saves.saveEntry("ironT").hour === st.hour % 24, "hiding the window saves it at once");
  // Save and exit.
  openSettings(ui, "game");
  tickHour(st);
  st.cards.length = 0;
  const h = st.hour;
  SETTINGS_ACTIONS["set-saveexit"](st, ui, {}, api);
  await settle();
  check(left === 1 && Saves.saveEntry("ironT").hour === h % 24, "Save and exit writes it and leaves");
  // New campaign from it: saved first.
  openSettings(ui, "game");
  tickHour(st);
  st.cards.length = 0;
  SETTINGS_ACTIONS["set-new"](st, ui, {}, api);
  await settle();
  check(left === 2 && Saves.saveEntry("ironT").hour === st.hour % 24, "New campaign saves it first");
  // The end of the run.
  st.gameOver = true;
  addCard(st, { title: "Last", text: "", choices: [] });
  ui.settings = null;
  await frame(st, ui, api);
  check(Saves.saveEntry("ironT").gameOver && Saves.saveEntry("ironT").why === "the run ended", "the end of the run is saved (open cards dropped)");
  // The new-run screen's box.
  const NG = await import("../src/ui/newgame.js");
  const w2 = world(13, 0);
  const nr = NG.newRunScreen(w2, { ironman: true, factionCount: 7, worldSize: "normal", customW: 64, customH: 42, hiveCount: null, mode: "normal", nrMsg: "" });
  check(/data-action="ironman" checked/.test(nr), "the new-run screen has the Ironman box");
}

console.log(`\n${passed} passed, ${failed} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(failed ? 1 : 0);
