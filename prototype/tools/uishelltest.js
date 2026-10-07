// The UI shell (suggestions-4 #6, #7, #13, #14): the tidy top bar (UI size and Zombies in Menu → Options → Display,
// the Dev button only with Show dev tools on; the ` and Shift+P keys likewise), the minimap's rules (what it shows
// is what you know; M toggles it; remembered), the readability options (colour-blind palette, larger map text,
// reduce motion; read back from storage, older options still load), and the one confirmation box (orders that
// cannot be undone ask first, Yes runs them, Enter / Esc, "Don't ask again" per kind, remembered and reset from the
// menu; the menu's own questions use the same box).
// Usage: node tools/uishelltest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { addBuilding } from "../src/sim/buildings.js";
import { takePrisonersAt, prisonersAt } from "../src/sim/prisoners.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { readFileSync } from "node:fs";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(t);
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null }; };
globalThis.localStorage = mem();

const Saves = await import("../src/ui/saves.js");
const { readDisplayOptions, DISPLAY_DEFAULTS } = await import("../src/ui/displayopts.js");
const UI = await import("../src/ui/ui.js");
const D = await import("../src/ui/display.js");
const C = await import("../src/ui/confirm.js");
const P = await import("../src/ui/palette.js");
const R = await import("../src/ui/render.js");
const MM = await import("../src/ui/minimap.js");
const { settingsModal, openSettings, SETTINGS_ACTIONS } = await import("../src/ui/settings.js");
const { PRISON_ACTIONS } = await import("../src/ui/prisoners.js");
const { VISITOR_ACTIONS } = await import("../src/ui/visitors.js");
const { DIPLO_ACTIONS } = await import("../src/ui/diplomacy.js");
const { FARM_ACTIONS } = await import("../src/ui/farming.js");
const { helpTopics } = await import("../src/ui/help.js");

// ---------- the options ----------
section("Options: Display and Don't ask again, stored and read back");
{
  const o = Saves.loadOptions();
  check(Object.entries(DISPLAY_DEFAULTS).every(([k, v]) => o[k] === v) && typeof o.noAsk === "object" && !Object.keys(o.noAsk).length, "fresh options: the Display defaults (minimap on, dev tools off, palette, text and motion as usual), nothing skipped");
  // An older options record (before these): loads with the defaults.
  localStorage.setItem("brokenstate.options", JSON.stringify({ autosave: false, uiScale: 1.5 }));
  const old = Saves.loadOptions();
  check(old.autosave === false && old.uiScale === 1.5 && old.minimap === true && old.devTools === false, "an older options record still loads, with the new defaults");
  // Everything stored comes back; garbage is dropped.
  const mine = { ...Saves.loadOptions(), cbPalette: true, bigText: true, calm: true, minimap: false, minimapSize: "l", devTools: true, mapAnim: false, noAsk: { execute: true, demolish: true } };
  Saves.saveOptions(mine);
  const back = Saves.loadOptions();
  check(back.cbPalette && back.bigText && back.calm && back.minimap === false && back.minimapSize === "l" && back.devTools && back.mapAnim === false, "the Display options are remembered (map animations Off too: it was lost on reload before)");
  check(back.noAsk.execute === true && back.noAsk.demolish === true, "the kinds not asked any more are remembered");
  const bad = readDisplayOptions({}, { cbPalette: "yes", minimapSize: "huge", noAsk: { execute: true, "<script>": true, demolish: 1 } });
  check(bad.cbPalette === false && bad.minimapSize === "m" && Object.keys(bad.noAsk).join() === "execute", "unreadable values are dropped (wrong types, unknown sizes, odd kinds)");
  localStorage.setItem("brokenstate.options", "{broken");
  check(Saves.loadOptions().minimap === true, "an unreadable options record: the defaults");
}

// ---------- the top bar ----------
section("Top bar: clock, weather, stock, people, Diary, Roster, Help, Menu; UI size and Zombies moved; Dev only with dev tools");
{
  const st = createWorld({ seed, factionCount: 5 });
  const ui = { speed: 1, scale: 1, dev: false, started: true };
  const opts = Saves.loadOptions();
  D.initDisplay(opts, () => {});
  const bar = UI.renderTopbar(st, ui);
  check(["dy-open", "ro-toggle", "help", "set-open"].every((a) => bar.includes(`data-action="${a}"`)) && /Day 1/.test(bar) && /class="wx"/.test(bar), "the bar keeps the clock, the weather, the stock, people, Diary, Roster, Help and Menu");
  check(!bar.includes('data-action="uiscale"') && !bar.includes('data-action="zlook-open"') && !bar.includes('data-action="dev-toggle"'), "no UI size select, no Zombies button, no Dev button by default");
  opts.devTools = true;
  check(UI.renderTopbar(st, ui).includes('data-action="dev-toggle"'), "Show dev tools on: the Dev button is back");
  opts.devTools = false;
  ui.dev = true;
  check(UI.renderTopbar(st, ui).includes('data-action="dev-toggle"'), "dev tools opened by a tool (window.game.dev): the Dev button shows while they are open");
  ui.dev = false;
  // The keys: ` does nothing unless dev tools are shown; Shift+P (autopilot) likewise; M toggles the minimap.
  const key = (code, extra = {}) => D.displayKey(ui, { code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...extra }, "");
  check(key("Backquote") === true && ui.dev === false, "` with dev tools hidden: nothing opens");
  check(key("KeyP", { shiftKey: true }) === true && !st.autopilot, "Shift+P with dev tools hidden: taken, the autopilot stays off");
  opts.devTools = true;
  check(key("Backquote") && ui.dev === true && key("Backquote") && ui.dev === false, "with Show dev tools on, ` opens and closes them");
  check(key("KeyP", { shiftKey: true }) === false, "with Show dev tools on, Shift+P goes on to the autopilot");
  D.DISPLAY_ACTIONS["dsp-opt"](ui, { k: "devTools" });
  check(opts.devTools === false && ui.dev === false, "switching Show dev tools off closes the dev tools");
  const mm = opts.minimap;
  check(key("KeyM") && opts.minimap === !mm && key("KeyM") && opts.minimap === mm, "M shows and hides the minimap (the option, so it is remembered)");
  check(D.displayKey(ui, { code: "KeyM" }, "base") === false && opts.minimap === mm, "behind a window, M does nothing");
  check(D.displayKey({ ...ui, started: false }, { code: "KeyM" }, "") === false, "before the game starts, M does nothing");
}

// ---------- readability ----------
section("Readability: colour-blind palette, larger map text, reduce motion");
{
  const opts = Saves.loadOptions();
  D.initDisplay(opts, () => {});
  const normal = { good: P.PAL.good, bad: P.PAL.bad, inf: P.PAL.infRgb };
  check(P.PAL.good === "#6cc48a" && P.PAL.bad === "#e2685f" && !P.PAL.safe, "the usual colours: green good, red bad");
  opts.cbPalette = true; D.applyDisplay();
  check(P.PAL.safe && P.PAL.good !== normal.good && P.PAL.bad !== normal.bad && P.PAL.infRgb !== normal.inf, "colour-blind-safe: good, bad and the Infection layer change");
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [gr, gg, gb] = hex(P.PAL.good), [br, bg, bb] = hex(P.PAL.bad);
  check(gb > gr && gb > gg * 0.9 && br > bb + 100, `the safe set is blue for good (${P.PAL.good}) and orange for bad (${P.PAL.bad}): no red against green`);
  check(P.tier3(0.9, 0.65, 0.35) === P.PAL.good && P.tier3(0.5, 0.65, 0.35) === P.PAL.mid && P.tier3(0.1, 0.65, 0.35) === P.PAL.bad, "the three steps (a hit chance) read from the palette");
  opts.cbPalette = false; D.applyDisplay();
  check(P.PAL.good === normal.good && P.PAL.bad === normal.bad, "and back");
  opts.bigText = true; opts.calm = true; D.applyDisplay();
  check(R.readable.text === D.BIG_TEXT && R.readable.still === true && R.anim.on === false, "larger map text and reduce motion reach the map (text ×1.4, no glides or pulses, animations off)");
  opts.calm = false; opts.mapAnim = true; D.applyDisplay();
  check(R.readable.still === false && R.anim.on === true, "reduce motion off: the map animations as the Map animations option says");
  opts.mapAnim = false; D.applyDisplay();
  check(R.anim.on === false, "Map animations Off stays off");
  opts.bigText = false; opts.mapAnim = true; D.applyDisplay();
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  check(/:root\.cb\s*\{[^}]*--good:[^}]*--danger:/.test(css) && /:root\.calm \*[^{]*\{[^}]*animation: none/.test(css), "the CSS has the colour-blind variables and the reduce-motion rule");
  // The battle and map code read the palette, not fixed greens and reds.
  const src = ["combat.js", "isoview.js", "render.js", "locks.js"].map((f) => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), "utf8"));
  check(src.every((s) => !/"#6cc48a"|"#e2685f"|rgba\(108,196,138|rgba\(226,104,95/.test(s)), "combat.js, isoview.js, render.js and locks.js take good and bad from the palette");
}

// ---------- the confirmation box ----------
section("One confirmation style: orders that cannot be undone ask first");
{
  const opts = Saves.loadOptions();
  let saved = 0;
  C.initConfirm(opts, () => { saved++; Saves.saveOptions(opts); });
  const st = createWorld({ seed: seed + 1, factionCount: 6 });
  st.started = true;
  const h = hub(st);
  addBuilding(h, "cells");
  const f = st.factions.find((x) => x.alive);
  const [pr] = takePrisonersAt(st, f, h, 2);
  const ui = { baseMsg: "" };
  // A tiny action table like main.js's: Yes runs the order again with ok.
  const actions = {};
  for (const [k, fn] of Object.entries(PRISON_ACTIONS)) actions[k] = (d) => fn(st, ui, d);
  for (const [k, fn] of Object.entries(C.ASK_ACTIONS)) actions[k] = (d) => fn(ui, d, actions);
  actions["pr-execute"]({ id: String(pr.id) });
  check(!!ui.ask && ui.ask.action === "pr-execute" && ui.ask.kind === "execute" && prisonersAt(st, h.id).includes(pr), "Execute asks first: the box is up, the prisoner still held");
  check(/Execute/.test(ui.ask.title) && /mood/.test(ui.ask.text) && /goodwill/i.test(ui.ask.text), `the box spells out what happens ("${ui.ask.title} ${ui.ask.text.slice(0, 60)}…")`);
  const html = C.askHtml(ui);
  check(/role="alertdialog"/.test(html) && /data-action="ask-yes"/.test(html) && /data-action="ask-no"/.test(html) && /data-action="ask-skip"/.test(html) && /Don't ask again before executing a prisoner/.test(html), "the box: Yes, Cancel and Don't ask again for the kind");
  check(C.askKey(ui, { code: "KeyS" }, actions) === true && !!ui.ask, "other keys wait while the box is up");
  C.askKey(ui, { code: "Escape" }, actions);
  check(!ui.ask && prisonersAt(st, h.id).includes(pr), "Esc cancels: nothing happens");
  actions["pr-execute"]({ id: String(pr.id) });
  C.askKey(ui, { code: "Enter" }, actions);
  check(!ui.ask && !prisonersAt(st, h.id).includes(pr) && /execut|dead/i.test(ui.baseMsg), `Enter answers yes: the order runs ("${ui.baseMsg.slice(0, 50)}")`);
  // Release with Don't ask again ticked.
  const p2 = prisonersAt(st, h.id)[0];
  actions["pr-release"]({ id: String(p2.id) });
  check(ui.ask && ui.ask.kind === "release", "Release asks too");
  actions["ask-skip"]({});
  actions["ask-yes"]({});
  check(!prisonersAt(st, h.id).includes(p2) && opts.noAsk.release === true && saved > 0 && Saves.loadOptions().noAsk.release === true, "Don't ask again ticked: released, and the kind is remembered in the options");
  const [p3] = takePrisonersAt(st, f, h, 1);
  actions["pr-release"]({ id: String(p3.id) });
  check(!ui.ask && !prisonersAt(st, h.id).includes(p3), "the next release goes at once");
  check(/Not asked any more/.test(C.confirmRows()) && /ask-reset/.test(C.confirmRows()), "Menu → Options → Confirmations lists it with Ask again");
  actions["ask-reset"]({ k: "release" });
  check(!opts.noAsk.release && !Saves.loadOptions().noAsk.release, "Ask again: asked again (and stored)");
  const [p4] = takePrisonersAt(st, f, h, 1);
  actions["pr-release"]({ id: String(p4.id) });
  check(ui.ask && ui.ask.kind === "release", "and the next release asks again");
  actions["ask-no"]({});
  check(!ui.ask && prisonersAt(st, h.id).includes(p4), "Cancel: nothing happens");
  // Other kinds: robbing merchants, leaving a war, digging a growing crop under.
  const ui2 = {};
  const merch = { id: 999, kind: "merchants", home: "the coast", guards: 3, tile: h.tile };
  st.visitors = [...(st.visitors || []), merch];
  VISITOR_ACTIONS["vis-attack"](st, ui2, { id: "999", base: String(h.id) });
  check(ui2.ask && ui2.ask.kind === "rob" && ui2.ask.action === "vis-attack-yes" && ui2.ask.data.base === String(h.id), "Rob the merchants asks first (and keeps where the fight is)");
  DIPLO_ACTIONS["war-leave"](st, ui2, { id: "1" });
  check(ui2.ask && ui2.ask.kind === "war", "leaving a war asks first");
  const { farmOf } = await import("../src/sim/farming.js");
  const fm = farmOf(st, h);
  const plot = fm.plots[0];
  if (plot) {
    Object.assign(plot, { stage: "growing", crop: Object.keys((await import("../src/sim/farming.js")).CROPS)[0], grown: 0.3 });
    let ui3 = {};
    FARM_ACTIONS["farm-clear"](st, ui3, { base: String(h.id), plot: String(plot.id) });
    check(ui3.ask && ui3.ask.kind === "clearcrop" && plot.stage === "growing", "digging a growing crop under asks first");
    plot.stage = "dead";
    ui3 = {};
    FARM_ACTIONS["farm-clear"](st, ui3, { base: String(h.id), plot: String(plot.id) });
    check(!ui3.ask && plot.stage === "empty", "a dead crop is cleared at once");
  }
  // Headless (no options): every kind asks.
  C.initConfirm(null);
  const ui4 = {};
  check(C.ask(ui4, {}, "x", { kind: "demolish" }) === true && C.ask(ui4, { ok: "1" }, "x", { kind: "demolish" }) === false, "without options every kind asks; an answered one (ok) goes on");
  // A save keeps no question (the box is the interface's, not the world's).
  const back = deserializeState(serializeState(st));
  check(!!back && prisonersAt(back, h.id).length === prisonersAt(st, h.id).length, "the world saves and loads as before");
}

// ---------- the menu ----------
section("Menu: Display rows, Confirmations, and the menu's questions in the same box");
{
  const opts = Saves.loadOptions();
  D.initDisplay(opts, () => {});
  C.initConfirm(opts, () => {});
  const st = createWorld({ seed, factionCount: 5 });
  const ui = { started: true, scale: 1, slot: null, savedMark: null };
  const api = { options: opts, desktop: false, autosaveInfo: () => ({ error: "" }), refresh() {}, track() {}, thumb: () => "", toTitle() { api.left = true; } };
  openSettings(ui, "options");
  const html = settingsModal(st, ui, api);
  check(["cbPalette", "bigText", "calm", "minimap", "devTools"].every((k) => html.includes(`data-action="dsp-opt" data-k="${k}"`)) && html.includes('data-action="dsp-mmsize"') && html.includes('data-action="uiscale"') && html.includes('data-action="zlook-open"'), "Options → Display: UI size, Zombie look, colour-blind colours, larger map text, reduce motion, minimap and its size, show dev tools");
  check(/<h3>Confirmations<\/h3>/.test(html), "Options → Confirmations");
  // Exit without saving with progress not saved: the same box, Don't ask again turns the leaving question off.
  ui.settings.tab = "game";
  st.hour += 5; // progress since the (missing) save
  SETTINGS_ACTIONS["set-exit"](st, ui, {}, api);
  const g = settingsModal(st, ui, api);
  check(!!ui.settings.confirm && /class="askbox"/.test(g) && /data-action="set-yes"/.test(g) && /data-action="set-noask"/.test(g), "the menu's question is the same box, with Don't ask again");
  SETTINGS_ACTIONS["set-noask"](st, ui, {}, api);
  SETTINGS_ACTIONS["set-yes"](st, ui, {}, api);
  check(api.left && opts.confirmQuit === false, "Yes with Don't ask again: it leaves, and Confirm before leaving a game is off");
  opts.confirmQuit = true;
}

// ---------- the minimap ----------
section("Minimap: only what you know (Reveal map shows all)");
{
  const st = createWorld({ seed: seed + 2, factionCount: 6 });
  st.started = true;
  R.resetView();
  const live = st.live;
  const far = st.tiles.find((t) => !live.has(t.id) && t.terrain !== "water" && !(st.knowledge && st.knowledge[t.id]));
  st.hordes.push({ id: 9999, tile: far.id, size: 77 });
  const at = (list, tile) => { const [x, y] = st.grid.toPixel(tile, R.HEX); return list.some((o) => o.p[0] === x && o.p[1] === y); };
  let d = MM.minimapDots(st);
  check(!at(d.hordes, far.id), "a horde where you cannot see and have no report: not on the minimap");
  check(d.bases.length === st.bases.length, `your bases are on it (${d.bases.length})`);
  st.knowledge[far.id] = { hour: st.hour, hordeSize: 60, hive: true };
  d = MM.minimapDots(st);
  check(at(d.hordes, far.id) && d.hordes.find((o) => o.live === false) && at(d.hives, far.id), "a report of a horde and a hive there: both show, faded (as last reported)");
  st.knowledge[far.id] = null;
  R.view.devReveal = true;
  d = MM.minimapDots(st);
  check(at(d.hordes, far.id) && d.hordes.length >= st.hordes.filter((x) => x.size > 0).length - 1, "Reveal map (dev): every horde shows");
  R.view.devReveal = false;
  R.view.layers.delete("hordes");
  check(MM.minimapDots(st).hordes.length === 0, "the Hordes layer off: no hordes on the minimap either");
  R.resetView();
  R.view.layers.delete("territory");
  check(MM.minimapDots(st).groups.length === 0, "other groups' bases only with the Territory layer");
  R.resetView();
}

// ---------- help ----------
section("Help topics");
{
  const ids = new Set(helpTopics().map((t) => t.id));
  check(["minimap", "readability", "confirmations"].every((k) => ids.has(k)), "Help has Minimap, Readability and Confirmations");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
