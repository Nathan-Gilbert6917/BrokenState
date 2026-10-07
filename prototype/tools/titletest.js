// The title screen (src/ui/title.js) and how main.js, ui.js and settings.js hook it in.
// Usage: node tools/titletest.js
// - The menu: New game first and highlighted with no saves, Load game disabled; with saves Continue comes first
//   (the latest save's name), Load game is enabled; Quit only in the desktop app. Clean HTML, every button has a handler.
// - The background and logo pickers cycle both ways through every choice and save the options; unknown saved values
//   fall back to the first choice.
// - New game hides the title and asks main.js for the new-run screen; Load game, Settings and How to play open the
//   menu at the right tab; the title is never covered by the new-run screen (ui.js) while it is up.
// - main.js: opens on the title (unless ?notitle), hands Esc and the map keys to it, loading a game closes it, and the
//   menu's Exit / Save and exit go back to it (settings.js).
import { readFileSync } from "node:fs";
import { TITLE_ACTIONS, TITLE_BGS, TITLE_STYLES, titleMenuHTML, titleBg, titleStyle, initTitle } from "../src/ui/title.js";
import { SETTINGS_ACTIONS } from "../src/ui/settings.js";

let fails = 0, passes = 0;
const check = (ok, what) => { if (ok) passes++; else { fails++; console.log("FAIL", what); } };

// A stand-in localStorage (ui/saves.js reads the save index from it).
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };

const calls = [];
const options = {};
const api = { options, desktop: false, saveOptions: () => calls.push("save"), newGame: () => calls.push("new"), quit: () => calls.push("quit"), tick: () => {} };
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
store.set("brokenstate.saves", JSON.stringify([{ id: "s1", name: "Day 40 · Millbrook", day: 40, ts: 2 }, { id: "s0", name: "Older", day: 3, ts: 1 }]));
html = titleMenuHTML({}, api);
const ix = (s) => html.indexOf(s);
if (/Continue/.test(html)) {
  check(ix("set-continue") >= 0 && ix("set-continue") < ix("title-new"), "with saves: Continue comes first");
  check(/Day 40 · Millbrook/.test(html), "Continue names the latest save");
  check(!/data-action="title-load" disabled/.test(html), "with saves: Load game is enabled");
  check(/class="tt-item primary" data-action="set-continue"/.test(html) && !/primary" data-action="title-new"/.test(html), "with saves: Continue is highlighted, not New game");
} else {
  const src = readFileSync(new URL("../src/ui/saves.js", import.meta.url), "utf8");
  console.log("note: the save index key is not brokenstate.saves; saves.js INDEX_KEY:", (src.match(/INDEX_KEY\s*=\s*([^;]+)/) || [])[1]);
  fails++;
}

// ---------- the pickers ----------
for (const [action, list, read, key] of [["title-bg", TITLE_BGS, titleBg, "titleBg"], ["title-style", TITLE_STYLES, titleStyle, "titleStyle"]]) {
  options[key] = "nonsense";
  check(read(options) === list[0][0], `${key}: an unknown saved value falls back to ${list[0][0]}`);
  const seen = [];
  for (let i = 0; i < list.length; i++) { TITLE_ACTIONS[action]({}, {}, { dir: "1" }); seen.push(read(options)); }
  check(new Set(seen).size === list.length && seen[seen.length - 1] === list[0][0], `${key}: › goes through every choice and wraps (${seen.join(" ")})`);
  TITLE_ACTIONS[action]({}, {}, { dir: "-1" });
  check(read(options) === list[list.length - 1][0], `${key}: ‹ wraps back to the last choice`);
}
check(calls.filter((c) => c === "save").length === TITLE_BGS.length + TITLE_STYLES.length + 2, "each pick saves the options");

// ---------- the buttons ----------
const ui = { title: true, settings: null };
TITLE_ACTIONS["title-new"]({}, ui, {});
check(!ui.title && calls.includes("new"), "New game closes the title and asks for the new-run screen");
for (const [a, tab] of [["title-load", "game"], ["title-settings", "options"], ["title-help", "help"]]) {
  const u = { title: true, settings: null };
  TITLE_ACTIONS[a]({}, u, {});
  check(u.settings && u.settings.tab === tab && u.title, `${a} opens the menu at ${tab}, over the title`);
}
TITLE_ACTIONS["title-quit"]({}, {}, {});
check(calls.includes("quit"), "Quit quits");

// ---------- the hooks in the other files ----------
const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const main = read("main.js"), uiSrc = read("ui/ui.js"), settings = read("ui/settings.js");
check(/showTitle\(ui\)/.test(main) && /notitle/.test(main), "main.js opens on the title, ?notitle skips it");
check(/if \(ui\.title\) \{[^\n]*titleKey/.test(main), "main.js hands the keys to the title while it is up");
check(/state = st;\s*\n\s*ui\.title = false;/.test(main), "loading a game closes the title");
check(/syncTitle\(state, ui\)/.test(main) && /titleFrame\(state, ui, now\)/.test(main), "main.js draws and updates the title");
check(/if \(ui\.title\) return null;/.test(uiSrc) && uiSrc.indexOf("if (ui.title) return null;") < uiSrc.indexOf('if (!ui.started) return ["newrun"'), "ui.js: no new-run screen while the title is up (the menu still opens over it)");
check((settings.match(/api\.toTitle\(\)/g) || []).length >= 3, "settings.js: Exit and Save and exit go back to the title");
check(/toTitle:/.test(main), "main.js gives the menu toTitle");

console.log(`titletest: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
