// Navigation checks without a browser: the key table (ui/keymap.js), Menu → Controls (ui/controls.js), the search box
// (ui/cmdpalette.js) and the Codex (ui/codex.js).
// Usage: node tools/navtest.js [seed]
// - keys: the default bindings fire the same actions as before the table (map, panels, camera spots, bases, battle,
//   the battle view, timelapse, title), no default conflicts, mapHotkey and combatKey through the table
// - rebinding: a new key works and the old one stops, a clash in one context is caught (not across contexts), reset
//   one / all, "press a key" (a modifier alone waits, Esc cancels), the Controls tab, the bindings saved and loaded as
//   a machine option (bad entries dropped)
// - the search box: people, bases, teams, groups, sites, build buttons, menu, Help topics and seen codex entries are
//   found by a few letters and jump to the right place; recent picks first; fast with 50 people and 50 groups
// - the codex: every entry has text, locked entries show ???, entries open on first sight (items, supplies,
//   buildings, conditions, hordes, battles, groups), the "new" flash, saved and loaded with the campaign
import { createWorld, hub, makeSurvivor, tickHour } from "../src/sim/world.js";
import { makeHorde } from "../src/sim/hordes.js";
import { addCondition } from "../src/sim/health.js";
import { GEAR, FACTION_TYPES } from "../src/sim/data.js";
import { BUILDINGS, queueBuild } from "../src/sim/buildings.js";
import { layoutOf } from "../src/sim/basemap.js";
import { ZTYPES } from "../src/sim/hiveconst.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import * as K from "../src/ui/keymap.js";
import { controlsTab, controlsKey, keysSheet, CONTROLS_ACTIONS } from "../src/ui/controls.js";
import { mapHotkey } from "../src/ui/alerts.js";
import { paletteIndex, paletteSearch, paletteGo, matchScore } from "../src/ui/cmdpalette.js";
import { codexEntries, codexScan, codexSeen, codexModal, codexState, CODEX_ACTIONS, CODEX_CATS } from "../src/ui/codex.js";
import { helpTopics } from "../src/ui/help.js";
import { saveOptions, loadOptions } from "../src/ui/saves.js";
import { ledgerKey } from "../src/ui/ledger.js";
import { undoKey } from "../src/ui/undo.js";
import { historyOf } from "../src/sim/history.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(t);
const ev = (code, mods = {}) => ({ code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods });
const parse = (chord) => { const p = chord.split("+"); const code = p.pop(); return ev(code, { ctrlKey: p.includes("Ctrl"), altKey: p.includes("Alt"), shiftKey: p.includes("Shift"), metaKey: p.includes("Meta") }); };
const freshUi = () => ({ started: true, speed: 0, tab: "bases", selected: -1, survivor: null, baseView: null, expedition: null, diary: null, roster: null, codex: null, settings: null, paletteRecent: [] });
function stubAct(state, ui) {
  const calls = [];
  return {
    calls,
    center: (d) => { calls.push(["center", Number(d.tile)]); ui.selected = Number(d.tile); },
    openbase: (d) => { calls.push(["openbase", Number(d.id), d.tab]); ui.baseView = { id: Number(d.id), tab: d.tab || "overview" }; },
    "xp-open": (d) => { calls.push(["xp-open", Number(d.id)]); ui.expedition = Number(d.id); },
    "rd-open": (d) => { calls.push(["rd-open", Number(d.id)]); ui.radioWith = Number(d.id); },
    "dev-autopilot": () => { calls.push(["autopilot"]); state.autopilot = !state.autopilot; },
  };
}
// localStorage for the options (ui/saves.js), in memory.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

// ---------------------------------------------------------------------------------------------------------
section("Keys: the defaults are the keys of before");
{
  // [chord, context, action]: every key the handlers tested by hand before the table.
  const OLD = [
    ["Space", "map", "time.pause"], ["Digit1", "map", "time.speed1"], ["Digit4", "map", "time.speed4"], ["KeyH", "map", "map.hub"], ["KeyI", "map", "map.infection"],
    ["Backquote", "map", "dev.tools"], ["KeyW", "map", "map.panUp"], ["ArrowUp", "map", "map.panUp"], ["KeyS", "map", "map.panDown"], ["ArrowLeft", "map", "map.panLeft"], ["KeyD", "map", "map.panRight"],
    ["KeyB", "map", "tab.bases"], ["KeyP", "map", "tab.people"], ["KeyG", "map", "tab.groups"], ["KeyT", "map", "tab.teams"], ["Shift+KeyP", "map", "dev.autopilot"],
    ["Tab", "map", "team.next"], ["KeyN", "map", "team.next"], ["Shift+Tab", "map", "team.prev"], ["KeyJ", "map", "win.diary"], ["KeyR", "map", "win.roster"],
    ["F1", "map", "base.1"], ["F9", "map", "base.9"], ["Ctrl+Digit4", "map", "cam.save4"], ["Alt+Digit5", "map", "cam.save5"], ["Ctrl+Numpad3", "map", "cam.save3"], ["Shift+Digit4", "map", "cam.go4"],
    ["BracketLeft", "map", "panel.left"], ["BracketRight", "map", "panel.right"], ["KeyL", "map", "panel.log"], ["Shift+BracketLeft", "map", "panel.orders"], ["Shift+BracketRight", "map", "panel.alerts"],
    ["Alt+BracketLeft", "map", "panel.closeLeft"], ["Alt+BracketRight", "map", "panel.closeRight"], ["Alt+KeyL", "map", "panel.closeLog"], ["Backslash", "map", "panel.all"], ["IntlBackslash", "map", "panel.all"],
    ["ArrowUp", "queue", "queue.up"], ["ArrowDown", "queue", "queue.down"], ["Delete", "queue", "queue.remove"], ["Backspace", "queue", "queue.remove"],
    ["KeyW", "battle", "bview.panUp"], ["ArrowRight", "battle", "bview.panRight"], ["KeyQ", "battle", "bview.rotLeft"], ["KeyE", "battle", "bview.rotRight"], ["Comma", "battle", "bview.rotLeft"], ["Period", "battle", "bview.rotRight"], ["Equal", "battle", "bview.zoomIn"],
    ["NumpadSubtract", "battle", "bview.zoomOut"], ["Home", "battle", "bview.center"], ["KeyB", "battle", "bview.roofs"], ["PageUp", "battle", "bview.floorUp"], ["PageDown", "battle", "bview.floorDown"],
    ["Space", "battle", "battle.endTurn"], ["Enter", "battle", "battle.confirm"], ["NumpadEnter", "battle", "battle.confirm"], ["Tab", "battle", "battle.next"], ["Shift+Tab", "battle", "battle.prev"], ["Digit3", "battle", "battle.unit3"],
    ["Shift+KeyA", "battle", "battle.autoplay"], ["Shift+KeyR", "battle", "battle.retreatAll"], ["Shift+KeyC", "battle", "battle.clear"], ["Shift+KeyS", "battle", "battle.search"], ["Shift+KeyQ", "battle", "battle.quick"], ["Shift+KeyD", "battle", "battle.drag"],
    ["KeyF", "battle", "battle.shoot"], ["KeyV", "battle", "battle.melee"], ["KeyM", "battle", "battle.meds"], ["KeyO", "battle", "battle.overwatch"], ["KeyH", "battle", "battle.hunker"], ["KeyR", "battle", "battle.retreat"],
    ["KeyN", "battle", "battle.vehicle"], ["KeyX", "battle", "battle.extract"], ["KeyC", "battle", "battle.subdue"], ["KeyT", "battle", "battle.tie"], ["KeyG", "battle", "battle.throw"], ["KeyL", "battle", "battle.climb"],
    ["KeyK", "battle", "battle.peek"], ["Shift+KeyE", "battle", "battle.close"], ["KeyY", "battle", "battle.brace"], ["KeyU", "battle", "battle.crush"], ["KeyJ", "battle", "battle.doubletap"], ["KeyP", "battle", "battle.pickup"], ["KeyZ", "battle", "battle.stowbody"],
    ["Space", "timelapse", "tl.play"], ["ArrowLeft", "timelapse", "tl.back"], ["End", "timelapse", "tl.end"], ["Digit2", "timelapse", "tl.speed2"], ["KeyF", "timelapse", "tl.fit"], ["KeyT", "timelapse", "tl.territory"], ["KeyA", "timelapse", "tl.panLeft"],
    ["ArrowUp", "title", "title.up"], ["ArrowDown", "title", "title.down"],
    // New with this table: the codex and the search box.
    ["KeyC", "map", "win.codex"], ["Ctrl+KeyK", "map", "win.palette"], ["Slash", "map", "win.palette"],
    // Folded in from the other branches: the Ledger and undo.
    ["Digit5", "map", "time.speed5"], ["Numpad2", "map", "time.speed2"], ["KeyM", "map", "map.minimap"],
    ["KeyE", "map", "win.ledger"], ["Ctrl+KeyZ", "edit", "edit.undo"], ["Meta+KeyZ", "edit", "edit.undo"],
  ];
  const bad = OLD.filter(([c, ctx, id]) => K.keyAction(parse(c), ctx) !== id);
  check(!bad.length, `every old key fires its old action (wrong: ${bad.map(([c, ctx, id]) => `${c}/${ctx} → ${K.keyAction(parse(c), ctx)} not ${id}`).join(", ")})`);
  check(K.keyAction(ev("KeyH", { shiftKey: true }), "map") === null && K.keyAction(ev("KeyA"), "timelapse") === "tl.panLeft" && K.keyAction(ev("ArrowLeft"), "timelapse") === "tl.back", "Shift+H is not H; the timelapse's ← steps a day (A pans)");
  check(!K.conflicts().length, `no two actions share a key in one context by default (${K.conflicts().map((c) => c.chord).join(", ")})`);
  check(K.KEYMAP.every((k) => k.id && k.label && k.group && K.KEY_CTX[k.ctx] && Array.isArray(k.keys) && k.keys.every(K.validChord)), "every entry has an id, label, group, context and valid default chords");
  check(new Set(K.KEYMAP.map((k) => k.id)).size === K.KEYMAP.length, "action ids are unique");
  check(K.KEYMAP.filter((k) => k.ctx === "map").length >= 40, `40+ map keys in the table (${K.KEYMAP.filter((k) => k.ctx === "map").length})`);
  check(K.chordOf(ev("ShiftLeft", { shiftKey: true })) === "" && K.chordOf({ code: "KeyA" }) === "KeyA" && K.normChord("Shift+Ctrl+KeyK") === "Ctrl+Shift+KeyK", "a modifier alone is no chord; missing flags count as up; modifiers in one order");
  check(K.chordName("Ctrl+Digit4") === "Ctrl+4" && K.chordName("BracketLeft") === "[" && K.keyLabel("team.next") === "Tab or N", "key names for people (Ctrl+4, [, Tab or N)");

  // Through the handlers.
  const w = createWorld({ seed, factionCount: 6 });
  const ui = freshUi();
  const act = stubAct(w, ui);
  check(mapHotkey(w, ui, ev("KeyG"), act, null) && ui.tab === "groups", "G: the Groups tab (mapHotkey)");
  check(!mapHotkey(w, ui, ev("Digit2"), act, null), "2 is left to main.js (a speed key)");
  check(mapHotkey(w, ui, ev("KeyC"), act, null) && ui.codex, "C opens the codex");
  check(mapHotkey(w, ui, ev("KeyJ"), act, "codex") && !ui.codex && ui.diary, "J over the codex switches to the diary");
  check(mapHotkey(w, ui, ev("KeyC"), act, "diary") && !ui.diary && ui.codex, "C over the diary switches to the codex");
  check(mapHotkey(w, ui, ev("KeyC"), act, "codex") && !ui.codex, "C again closes it");
  check(!mapHotkey(w, ui, ev("KeyC"), act, "base"), "no codex key behind a base screen");
  // The Ledger (ui/ledger.js ledgerKey) through the table; never a battle key; C, J, R from it.
  check(ledgerKey(w, ui, ev("KeyE"), null) && ui.ledger, "E opens the Ledger");
  check(!ledgerKey(w, ui, ev("KeyC"), "ledger") && !ui.ledger && mapHotkey(w, ui, ev("KeyC"), act, null) && ui.codex, "C from the Ledger closes it and opens the codex");
  check(ledgerKey(w, ui, ev("KeyE"), "codex") && ui.ledger && !ui.codex, "E from the codex switches to the Ledger");
  check(ledgerKey(w, ui, ev("KeyE"), "ledger") && !ui.ledger, "E again closes it");
  check(!ledgerKey(w, ui, ev("KeyE", { shiftKey: true }), null) && !ui.ledger, "Shift+E is not E");
  check(K.keyAction(ev("KeyE"), "battle") === "bview.rotRight" && K.keyAction(ev("KeyZ", { ctrlKey: true }), "battle") === null, "in battle E turns the view and Ctrl+Z does nothing");
  // Undo (ui/undo.js undoKey) only on a screen with an undo list.
  check(!undoKey(w, { ...freshUi() }, ev("KeyZ", { ctrlKey: true })), "Ctrl+Z on the bare map does nothing");
  const uw = { ...freshUi(), baseView: { id: hub(w).id, tab: "work" } };
  check(undoKey(w, uw, ev("KeyZ", { ctrlKey: true })) && !undoKey(w, uw, ev("KeyZ")), "Ctrl+Z on the Work tab is undo (Z alone is not)");
  K.setBinding("edit.undo", 0, "Ctrl+KeyU");
  check(undoKey(w, uw, ev("KeyU", { ctrlKey: true })) && K.keysOf("edit.undo")[0] === "Ctrl+KeyU", "undo rebinds like any key");
  K.resetAll();
}

// ---------------------------------------------------------------------------------------------------------
section("Rebinding: Menu → Controls");
{
  const opts = {};
  K.initKeymap(opts);
  const w = createWorld({ seed: seed + 1, factionCount: 5 });
  const ui = freshUi();
  const act = stubAct(w, ui);
  K.setBinding("tab.bases", 0, "KeyY");
  check(K.keyAction(ev("KeyY"), "map") === "tab.bases" && K.keyAction(ev("KeyB"), "map") === null, "B → Y: Y opens the Bases tab, B does nothing");
  ui.tab = "people";
  check(mapHotkey(w, ui, ev("KeyY"), act, null) && ui.tab === "bases", "the handler follows the new key");
  check(opts.keys && opts.keys["tab.bases"][0] === "KeyY", "the binding is in the machine options (options.keys)");
  const clash = K.setBinding("tab.groups", 0, "KeyY");
  check(clash && clash.includes("tab.bases") && K.conflicts().some((c) => c.chord === "KeyY" && c.ctx === "map"), "Y on Groups too: the clash with Bases is caught");
  check(/keyclash/.test(controlsTab(ui)) && /class="clash"/.test(controlsTab(ui)), "the Controls tab warns and marks both rows");
  K.setBinding("tab.groups", 0, "KeyG");
  check(!K.conflicts().length, "giving Groups its key back clears the clash");
  K.setBinding("tab.groups", 0, "KeyI"); // I is the infection overlay on the map ...
  check(K.conflicts().some((c) => c.chord === "KeyI"), "I on Groups clashes with the infection overlay");
  K.setBinding("tab.groups", 0, "KeyG");
  // (every letter is a battle order now, I is Reload: Shift+N, the map's previous team, is the map key free in battle)
  check(!(K.setBinding("battle.shoot", 0, "Shift+KeyN") || []).length, "... but the map's Shift+N in a battle is no clash (another context)");
  check(K.keyAction(parse("Shift+KeyN"), "battle") === "battle.shoot" && K.keyAction(ev("KeyF"), "battle") === null, "Shoot on Shift+N in battle; F no longer shoots");
  K.setBinding("battle.shoot", 1, "KeyF"); // added as a second key
  check(K.keysOf("battle.shoot").join() === "Shift+KeyN,KeyF", "+ adds a second key");
  K.removeBinding("battle.shoot", 0);
  check(K.keysOf("battle.shoot").join() === "KeyF", "✕ takes one off");
  // A battle key, through combatKey.
  K.setBinding("battle.autoplay", 0, "Ctrl+KeyA");
  check(K.keyAction(ev("KeyA", { ctrlKey: true }), "battle") === "battle.autoplay" && K.keyAction(ev("KeyA", { shiftKey: true }), "battle") === null, "the AI-plays key moved to Ctrl+A");
  // Fixed keys are not rebindable.
  check(K.setBinding("ui.close", 0, "KeyQ") === null && K.keysOf("ui.close").join() === "Escape", "Esc (fixed) cannot be rebound");
  // Reset one, reset all.
  K.resetBinding("tab.bases");
  check(K.keyAction(ev("KeyB"), "map") === "tab.bases" && !K.isCustom("tab.bases"), "Reset: B is the Bases key again");
  K.setBinding("map.hub", 0, "KeyQ");
  K.resetAll();
  check(K.keyAction(ev("KeyH"), "map") === "map.hub" && K.keyAction(ev("KeyF"), "battle") === "battle.shoot" && !opts.keys, "Reset all: every default back, nothing left in the options");

  // "Press a key".
  ui.settings = { tab: "controls", msg: "" };
  K.startCapture("map.hub", 0);
  check(controlsKey(ui, ev("ShiftLeft", { shiftKey: true }), {}) && K.capturing(), "a modifier alone waits for the key");
  check(controlsKey(ui, ev("KeyK", { shiftKey: true }), { options: opts }) && !K.capturing() && K.keyAction(ev("KeyK", { shiftKey: true }), "map") === "map.hub" && /Shift\+K/.test(ui.settings.msg), "Shift+K becomes the hub key, and the menu says so");
  K.startCapture("map.hub", 0);
  controlsKey(ui, ev("Escape"), {});
  check(!K.capturing() && K.keysOf("map.hub").join() === "Shift+KeyK", "Esc cancels the capture");
  K.startCapture("map.infection", null);
  ui.settings.tab = "game";
  check(!controlsKey(ui, ev("KeyO"), {}) && !K.capturing(), "a capture left over on another tab is dropped, the key is not taken");
  CONTROLS_ACTIONS["key-capture"]({}, ui, { id: "map.infection" });
  ui.settings.tab = "controls";
  check(/press a key…/.test(controlsTab(ui)), "the Controls tab shows the key it waits for");
  K.stopCapture();

  // Saved and loaded with the machine options.
  saveOptions({ ...loadOptions(), keys: { "map.hub": ["Shift+KeyK"], "tab.bases": ["KeyY", "bad key!", 5], "ui.close": ["KeyQ"], "no.such": ["KeyZ"] } });
  const o2 = loadOptions();
  K.initKeymap(o2);
  check(K.keyAction(ev("KeyK", { shiftKey: true }), "map") === "map.hub" && K.keyAction(ev("KeyY"), "map") === "tab.bases" && K.keysOf("tab.bases").length === 1, "bindings come back from the options; bad chords are dropped");
  check(K.keysOf("ui.close").join() === "Escape", "a fixed key in the options is ignored");
  check(/<kbd>Shift\+K<\/kbd>/.test(keysSheet()) && /key-print/.test(keysSheet()), "the key sheet (Help → Keys) shows the keys as set now, with a print button");
  check(helpTopics().some((t) => t.id === "keys" && /keysheet/.test(t.html)) && helpTopics().some((t) => t.id === "codex-and-search"), "Help has the Keys and Codex and search topics");
  K.resetAll();
  K.initKeymap({});
}

// ---------------------------------------------------------------------------------------------------------
section("The search box: 50 people, 50 groups");
{
  const w = createWorld({ seed: seed + 2, factionCount: 10 });
  const h = hub(w);
  while (w.survivors.length < 50) { const s = makeSurvivor(w, 1); s.location = { kind: "base", baseId: h.id }; w.survivors.push(s); }
  const base0 = w.factions[0];
  for (let i = 0; w.factions.length < 50; i++) w.factions.push({ ...base0, id: 9000 + i, name: `Test Group ${i}`, bases: base0.bases.slice(), known: true });
  w.factions.forEach((f) => { f.known = true; });
  const ui = freshUi();
  ui.started = true;
  const act = stubAct(w, ui);
  // The rebuild as on opening the box in a running game: the hub's base map laid out first (its one-time layout and
  // land, cached per base, which the game has long done by then: the Build buttons' ring wall reads it), then the best
  // of a few rebuilds and search rounds (the wall time of one is the machine's load as much as the code's).
  let t0 = performance.now();
  layoutOf(w, h);
  const tLayout = performance.now() - t0;
  let index = null, tIndex = Infinity, tSearch = Infinity;
  for (let k = 0; k < 5; k++) { t0 = performance.now(); index = paletteIndex(w, ui); tIndex = Math.min(tIndex, performance.now() - t0); }
  for (let k = 0; k < 3; k++) {
    t0 = performance.now();
    for (const q of ["ma", "hub", "iron", "water barrel", "save", "hosp", "zz", "test group 4", "keys", "r"]) paletteSearch(index, q, []);
    tSearch = Math.min(tSearch, (performance.now() - t0) / 10);
  }
  console.log(`  ${index.length} entries; index ${tIndex.toFixed(1)} ms (best of 5), a search ${tSearch.toFixed(2)} ms (best of 3); the base map's first layout ${tLayout.toFixed(1)} ms`);
  check(tIndex < 150 && tSearch < 15, "fast enough to rebuild on open and search on every key");
  const kinds = new Set(index.map((e) => e.kind));
  check(["person", "base", "group", "site", "build", "menu", "help"].every((k) => kinds.has(k)), `people, bases, groups, sites, build buttons, menu and help are indexed (${[...kinds].join(", ")})`);
  check(["menu:ledger", "menu:summary", "menu:guide", "menu:sound", "menu:templates", "help:sound", "help:start-here"].every((id) => index.some((e) => e.id === id)), "the Ledger, run summary, guide, sound and templates are in the menu, their Help topics too");
  const rl = paletteSearch(index, "ledger", [])[0];
  paletteGo(w, ui, rl, act);
  check(ui.ledger && rl.id === "menu:ledger", "\"ledger\": opens the Ledger");
  ui.ledger = null;

  const s = w.survivors[7];
  const first = s.name.split(" ")[0];
  const rp = paletteSearch(index, s.name.slice(0, 6), []);
  check(rp.some((r) => r.id === `person:${s.id}`), `a person by the start of the name ("${s.name.slice(0, 6)}")`);
  const exact = paletteSearch(index, s.name, [])[0];
  check(exact && exact.id === `person:${s.id}`, "the full name is the top result");
  paletteGo(w, ui, exact, act);
  check(ui.survivor === s.id, "Enter on a person opens their screen");
  void first;

  const rb = paletteSearch(index, h.name, [])[0];
  check(rb && rb.kind === "base", "the hub by its name");
  act.calls.length = 0;
  paletteGo(w, ui, rb, act);
  check(act.calls.some((c) => c[0] === "center" && c[1] === h.tile) && act.calls.some((c) => c[0] === "openbase" && c[1] === h.id), "a base: centered and its screen opened");

  const g = w.factions[23];
  const rg = paletteSearch(index, g.name, [])[0];
  check(rg && rg.id === `group:${g.id}`, "a group by its name");
  act.calls.length = 0;
  paletteGo(w, ui, rg, act);
  check(ui.tab === "groups" && act.calls.some((c) => c[0] === "center" || c[0] === "rd-open"), "a group: the Groups tab and its base (or its radio panel)");

  const rw = paletteSearch(index, "water barrel", [])[0];
  check(rw && rw.kind === "build" && /Water barrel/.test(rw.label), "\"water barrel\": the build button");
  act.calls.length = 0;
  paletteGo(w, ui, rw, act);
  check(act.calls.some((c) => c[0] === "openbase" && c[2] === "construction") && ui.palFocus && ui.palFocus.type === "water_barrel", "a build button: the base's Construction tab, the button to light up");
  check(paletteSearch(index, "wtr brl", []).some((r) => r.id === rw.id), "letters in order find it too (\"wtr brl\")");

  const site = w.tiles.find((t) => t.loc && t.loc.name && index.some((e) => e.id === `site:${t.id}`));
  check(site && paletteSearch(index, site.loc.name, [])[0].id === `site:${site.id}`, "a known site or town by its name");
  check(!index.some((e) => e.kind === "site" && !w.tiles[Number(e.id.slice(5))].loc), "only tiles with a site");

  const rs = paletteSearch(index, "save", [])[0];
  paletteGo(w, ui, rs, act);
  check(ui.settings && ui.settings.tab === "game", "\"save\": the menu's Game tab");
  const rk = paletteSearch(index, "controls", [])[0];
  paletteGo(w, ui, rk, act);
  check(ui.settings.tab === "controls", "\"controls\": Menu → Controls");
  const rh = paletteSearch(index, "keys on the map", [])[0];
  paletteGo(w, ui, rh, act);
  check(ui.settings.tab === "help" && ui.settings.help === "keys-on-the-map", "a Help topic opens Help at it");

  const empty = paletteSearch(index, "", ui.paletteRecent);
  check(empty[0] && empty[0].id === rh.id && empty[0].recent && empty.findIndex((r) => r.id === rb.id) < 6, "empty: the recent picks first, newest on top");
  check(matchScore("water barrel", "water") > matchScore("cold water store", "water") && matchScore("abc", "x") === 0, "a match at the start beats one inside; no match is 0");

  // Codex entries: only the seen ones.
  codexScan(w, ui, true);
  const idx2 = paletteIndex(w, ui);
  check(idx2.some((e) => e.id === "codex:z:walker") && !idx2.some((e) => e.id === "codex:z:nightmare"), "codex entries you have opened are found, the others are not");
  const rc = paletteSearch(idx2, "the dead", []).find((r) => r.kind === "codex");
  paletteGo(w, ui, rc, act);
  check(ui.codex && ui.codex.sel === "z:walker", "a codex entry opens the codex at it");
}

// ---------------------------------------------------------------------------------------------------------
section("The codex");
{
  const all = codexEntries();
  const cats = new Set(all.map((e) => e.cat));
  check(CODEX_CATS.every(([k]) => cats.has(k)), "every category has entries");
  check(Object.keys(ZTYPES).every((k) => all.some((e) => e.key === `z:${k}`)) && all.some((e) => e.key === "z:wallbreaker") && all.some((e) => e.key === "z:broodmother"), "every kind of the dead and both bosses");
  check(Object.keys(GEAR).every((k) => GEAR[k].supKey || all.some((e) => e.key === `i:${k}`)) && Object.keys(BUILDINGS).filter((k) => !BUILDINGS[k].hidden && !BUILDINGS[k].furniture && !BUILDINGS[k].retired).every((k) => all.some((e) => e.key === `b:${k}`)), "every item and building");
  check(Object.keys(FACTION_TYPES).every((k) => all.some((e) => e.key === `g:${k}`)) && ["c:worm", "c:infwound", "o:merchants"].every((k) => all.some((e) => e.key === k)), "every group kind, the worm, infected wounds, outsiders");
  const thin = all.filter((e) => !e.name || !e.sub || !(e.text || e.how) || !Array.isArray(e.stats) || e.stats.some(([l, v]) => !l || v == null || /undefined|NaN/.test(String(v))));
  check(!thin.length, `every entry has a name, category, text and clean stats (${thin.slice(0, 4).map((e) => e.key).join(", ")})`);
  check(all.filter((e) => e.cat === "dead" || e.cat === "conditions" || e.cat === "groups").every((e) => e.how), "every kind of the dead, condition and group says how to deal with it");

  const w = createWorld({ seed: seed + 3, factionCount: 6 });
  const ui = freshUi();
  const fresh0 = codexScan(w, ui, true);
  const c = codexState(w);
  check(codexSeen(w, "z:walker") && fresh0.length > 0 && !c.fresh.length && !ui.flash, "the first scan opens what the world already shows, quietly");
  check(!codexSeen(w, "z:nightmare") && !codexSeen(w, "i:molotov") === !w.bases[0].armory.some((it) => it.key === "molotov"), "the rest stays locked");
  let html = codexModal(w, ui);
  check(/\?\?\?/.test(html) && /The dead/.test(html), "locked entries show ??? with their category");

  // Items, supplies, buildings, conditions on the next hour's scan.
  const h = hub(w);
  const newItem = Object.keys(GEAR).find((k) => !codexSeen(w, `i:${k}`) && GEAR[k].slot !== "cargo");
  h.armory.push({ key: newItem, id: 99991 });
  const s = w.survivors.find((x) => x.alive);
  addCondition(w, s, "flu", "test");
  const bType = Object.keys(BUILDINGS).find((k) => !codexSeen(w, `b:${k}`) && !queueBuild(w, h, k).startsWith("Needs") && h.construction.some((j) => j.type === k));
  tickHour(w);
  const got = codexScan(w, ui);
  check(got.includes(`i:${newItem}`) && codexSeen(w, `i:${newItem}`), `an item in the armory opens its entry (${GEAR[newItem].name})`);
  check(codexSeen(w, "c:flu"), "someone with the flu opens Flu");
  check(!bType || codexSeen(w, `b:${bType}`), `a building queued opens its entry (${bType || "none queued"})`);
  check(ui.flash && /New in the Codex/.test(ui.flash.text) && c.fresh.includes(`i:${newItem}`), "a new entry flashes and is marked new");
  check(codexScan(w, ui).length === 0, "nothing new without a new hour");

  // A horde in sight with special dead, and a Wallbreaker.
  const tile = [...w.live][0];
  const hd = makeHorde(w, { tile, size: 60 });
  hd.mix = { runner: 0.2, spitter: 0.1 };
  hd.bosses = 1;
  codexScan(w, ui, true);
  check(codexSeen(w, "z:runner") && codexSeen(w, "z:spitter") && codexSeen(w, "z:wallbreaker") && !codexSeen(w, "z:brute"), "a horde on a live tile opens the special dead in its mix and its Wallbreaker");
  // A battle (over: everything is seen).
  w.combat = { over: true, units: [{ side: "enemy", kind: "zombie", ztype: "nightmare", id: 1 }, { side: "enemy", kind: "zombie", boss: "broodmother", id: 2 }, { side: "enemy", kind: "zombie", ztype: "crawler", low: false, id: 3 }], corpses: [{ sleeper: true, spotted: true }] };
  codexScan(w, ui);
  check(["z:nightmare", "z:broodmother", "z:crawler", "z:sleeper"].every((k) => codexSeen(w, k)), "a battle's dead (and a spotted Sleeper) open their entries");
  w.combat = null;
  // A group you know.
  const f = w.factions.find((x) => !codexSeen(w, `g:${x.type}`));
  if (f) { f.known = true; codexScan(w, ui, true); check(codexSeen(w, `g:${f.type}`), `knowing a group opens its kind (${FACTION_TYPES[f.type].label})`); }

  // The window: pick an entry, it is no longer new.
  CODEX_ACTIONS["cx-open"](w, ui, { key: `i:${newItem}` });
  html = codexModal(w, ui);
  check(ui.codex.cat === "items" && html.includes(GEAR[newItem].name) && /How to deal with it/.test(html) && !c.fresh.includes(`i:${newItem}`), "opening an entry shows it with its stats and how to deal with it; it is no longer new");
  ui.codex.q = "flu";
  check(/Flu/.test(codexModal(w, ui)), "the codex's own find box");
  check(!/undefined|NaN/.test(codexModal(w, ui)), "no undefined or NaN in the window");

  // Saved and loaded with the campaign; an older save without a codex.
  const seenBefore = Object.keys(c.seen).length;
  const back = loadFromString(saveToString(w));
  check(back.codex && Object.keys(back.codex.seen).length === seenBefore && codexSeen(back, "z:wallbreaker"), "the codex is saved and loaded with the campaign");
  const old = loadFromString(saveToString(w));
  delete old.codex;
  codexScan(old, ui, true);
  check(codexSeen(old, "z:walker") && codexSeen(old, `i:${newItem}`) && !old.codex.fresh.length, "an older save without a codex opens what its world shows, quietly");
  // After a load the codex keeps scanning and the Ledger's history keeps recording (sim/history.js, in tickHour).
  const rows0 = (historyOf(back) && historyOf(back).all.rows.length) || 0;
  const it2 = Object.keys(GEAR).find((k) => !codexSeen(back, `i:${k}`) && GEAR[k].slot !== "cargo");
  hub(back).armory.push({ key: it2, id: 99992 });
  for (let i = 0; i < 25; i++) tickHour(back);
  const got2 = codexScan(back, ui);
  check(got2.includes(`i:${it2}`), "a loaded campaign: the codex opens a new item");
  check(historyOf(back) && historyOf(back).all.rows.length > rows0, `a loaded campaign: the Ledger records the next day (${rows0} → ${historyOf(back) ? historyOf(back).all.rows.length : 0} rows)`);
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
