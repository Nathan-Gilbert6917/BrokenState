// The title screen (src/ui/title.js) and how main.js, ui.js and settings.js hook it in.
// Usage: node tools/titletest.js
// - The menu: New game first and highlighted with no saves, Load game disabled; with saves Continue comes first
//   (the latest save's name), Load game is enabled; Quit only in the desktop app. Clean HTML, every button has a handler.
// - New game hides the title; Load game, Settings and How to play open the menu at the right tab over it; the title
//   is never covered by the new-run screen (ui.js) while it is up.
// - The backgrounds take turns: three scenes, each held and then cross-faded into the next, round and round.
// - main.js: opens on the title (unless ?notitle), hands Esc and the map keys to it, loading a game closes it, and the
//   menu's Exit / Save and exit go back to it (settings.js).
import { readFileSync } from "node:fs";
import { TITLE_ACTIONS, titleMenuHTML, initTitle, titleCovers } from "../src/ui/title.js";
import { SETTINGS_ACTIONS } from "../src/ui/settings.js";

let fails = 0, passes = 0;
const check = (ok, what) => { if (ok) passes++; else { fails++; console.log("FAIL", what); } };

// A stand-in localStorage (ui/saves.js reads the save index from it).
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };

const calls = [];
const api = { desktop: false, quit: () => calls.push("quit") };
initTitle(api);

const actionsOf = (html) => [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);
const known = (a) => a in TITLE_ACTIONS || a in SETTINGS_ACTIONS;

// ---------- the menu, without saves ----------
let html = titleMenuHTML({}, api);
check(!/Continue/.test(html), "no saves: no Continue");
check(/class="tt-item primary" data-action="title-new"/.test(html), "no saves: New game is the highlighted first item");
check(/data-action="title-load" disabled/.test(html), "no saves: Load game is disabled");
check(!/title-quit/.test(html), "in the browser: no Quit");
check(actionsOf(html).every(known), `every button has a handler (${actionsOf(html).filter((a) => !known(a)).join(", ")})`);
check(!/undefined|NaN|null/.test(html), "no undefined / NaN / null");
const opened = (html.match(/<button/g) || []).length, closed = (html.match(/<\/button>/g) || []).length;
check(opened === closed && opened === 4, `four buttons, balanced (${opened}/${closed})`);
check(/data-action="title-quit"/.test(titleMenuHTML({}, { ...api, desktop: true })), "in the desktop app: Quit");

// ---------- with saves ----------
store.set("brokenstate.saves", JSON.stringify([{ id: "s1", name: "Millbrook Holdout, day 40", day: 40, ts: 2 }, { id: "s0", name: "Older", day: 3, ts: 1 }]));
html = titleMenuHTML({}, api);
const ix = (s) => html.indexOf(s);
check(ix("set-continue") >= 0 && ix("set-continue") < ix("title-new"), "with saves: Continue comes first");
check(/Millbrook Holdout, day 40</.test(html), "Continue names the latest save, the day once (the name carries it)");
check(!/data-action="title-load" disabled/.test(html), "with saves: Load game is enabled");
check(/class="tt-item primary" data-action="set-continue"/.test(html) && !/primary" data-action="title-new"/.test(html), "with saves: Continue is highlighted, not New game");
store.set("brokenstate.saves", JSON.stringify([{ id: "s2", name: "My save", day: 12, ts: 3 }]));
check(/My save · day 12</.test(titleMenuHTML({}, api)), "a save name without the day gets it added");

// ---------- the buttons ----------
const ui = { title: true, settings: null };
TITLE_ACTIONS["title-new"]({}, ui, {});
check(!ui.title, "New game closes the title (the new-run screen is behind it)");
for (const [a, tab] of [["title-load", "game"], ["title-settings", "options"], ["title-help", "help"]]) {
  const u = { title: true, settings: null };
  TITLE_ACTIONS[a]({}, u, {});
  check(u.settings && u.settings.tab === tab && u.title, `${a} opens the menu at ${tab}, over the title`);
}
TITLE_ACTIONS["title-quit"]({}, {}, {});
check(calls.includes("quit"), "Quit quits");
check(titleCovers({ title: true }) && !titleCovers({ title: false, started: true }) && !titleCovers({ title: false, started: false, nrMap: true }), "the title covers the map only while it is up (not in a game, nor under View map)");
check(titleCovers({ title: false, started: false, nrMap: false }), "its background stays under the new-run screen (a full screen)");

// ---------- the backgrounds and the hooks in the other files ----------
const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const title = read("ui/title.js"), main = read("main.js"), uiSrc = read("ui/ui.js"), settings = read("ui/settings.js");
const scenes = (title.match(/const SCENES = \[([^\]]+)\]/) || [])[1] || "";
check(scenes.split(",").length === 3 && /skyline/.test(scenes) && /camp/.test(scenes) && /walls/.test(scenes) && !/hive/.test(scenes), `three backgrounds take turns, no hive (${scenes.trim()})`);
check(/HOLD_S = \d+/.test(title) && /FADE_S = \d+/.test(title) && /\(show\.cur \+ 1\) % SCENES\.length/.test(title), "each is held, then the next fades in, round and round");
for (const fn of ["skylineScene", "campScene", "wallsScene"]) check(new RegExp(`function ${fn}\\(\\)`).test(title) && new RegExp(`${fn}\\(\\)`).test(title.slice(0, title.indexOf(`function ${fn}`))), `${fn} exists and is used`);
check(!/title-bg|title-style|tt-look|TITLE_BGS|TITLE_STYLES/.test(title) && !/tt-look|tt-pick/.test(readFileSync(new URL("../title.css", import.meta.url), "utf8")), "no background or title picker");
check(/class="tt-runs"/.test(title) && !/<g id="tt-drips">[\s\S]*filter=/.test(title.slice(title.indexOf('class="tt-runs"'))), "the paint runs live outside the filtered lettering");
check(/showTitle\(ui\)/.test(main) && /notitle/.test(main), "main.js opens on the title, ?notitle skips it");
check(/if \(ui\.title\) \{[^\n]*titleKey/.test(main), "main.js hands the keys to the title while it is up");
check(/state = st;\s*\n\s*ui\.title = false;/.test(main), "loading a game closes the title");
check(/syncTitle\(state, ui\)/.test(main) && /titleFrame\(state, ui, now\)/.test(main), "main.js draws and updates the title");
check(/if \(ui\.title\) return null;/.test(uiSrc) && uiSrc.indexOf("if (ui.title) return null;") < uiSrc.indexOf('if (!ui.started) return ["newrun"'), "ui.js: no new-run screen while the title is up (the menu still opens over it)");
check((settings.match(/api\.toTitle\(\)/g) || []).length >= 3, "settings.js: Exit and Save and exit go back to the title");
check(/toTitle:/.test(main), "main.js gives the menu toTitle");

console.log(`titletest: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
