// Menu → Options → Display (ui/settings.js shows the rows): colour-blind-safe colours (ui/palette.js and the CSS
// variables under :root.cb), larger text on the map, reduce motion (no map animations, glides, pulsing badges or
// sliding cards: :root.calm), the minimap (ui/minimap.js) and "Show dev tools" (the Dev button in the top bar and the
// ` key; off for players). The options live in ui/saves.js (read through ui/displayopts.js). The keys this module
// owns: M (minimap), ` (dev tools, when they are shown) and Shift+P (autopilot, a dev tool) are all in displayKey.
import { setPalette } from "./palette.js";
import { setReadable, setMapAnim, redrawMap, view } from "./render.js";
import { MINIMAP_SIZES } from "./displayopts.js";
import { keyAction } from "./keymap.js"; // the key table (Menu → Controls)

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
export const BIG_TEXT = 1.4; // "Larger map text": names, badges and crew tags on the map this much bigger

let OPT = null, SAVE = null;
// main.js: the options and how to save them. Applies them at once.
export function initDisplay(options, save) {
  OPT = options;
  SAVE = save || null;
  applyDisplay();
}
export const displayOptions = () => OPT;

// Everything the Display options change, from the options as they are now.
export function applyDisplay() {
  if (!OPT) return;
  if (setPalette(OPT.cbPalette)) redrawMap(true); // the cached map chunks hold the overlays' colours
  const root = typeof document !== "undefined" ? document.documentElement : null;
  if (root) {
    root.classList.toggle("cb", !!OPT.cbPalette);
    root.classList.toggle("calm", !!OPT.calm);
    root.style.setProperty("--minimap-w", `${(MINIMAP_SIZES[OPT.minimapSize] || MINIMAP_SIZES.m).rem}rem`);
  }
  setReadable({ text: OPT.bigText ? BIG_TEXT : 1, still: !!OPT.calm });
  setMapAnim(OPT.mapAnim !== false && !OPT.calm);
}

// The Dev button and the ` key: with "Show dev tools" on, or while the dev tools are open (a tool or the desktop
// perf driver opened them: window.game.dev).
export const devAllowed = (ui) => !!(OPT && OPT.devTools) || !!(ui && ui.dev);
export const devButton = (ui) => (devAllowed(ui)
  ? `<button data-action="dev-toggle" class="${ui.dev ? "active" : ""}"${tip("Dev tools: reveal the map, autopilot, fast forward, frame rate, and a tracker of groups and zombie hotzones (` key). Hide this button: Menu → Options → Display → Show dev tools")}>Dev</button>`
  : "");

// The rows added to the Options tab's Display section.
export function displayRows(o) {
  const box = (k, on, label, t) => `<button class="setopt ${on ? "active" : ""}" data-action="dsp-opt" data-k="${k}"${tip(t)}>${on ? "✔" : "✗"} ${label}</button>`;
  return `<div class="setrow">
      ${box("cbPalette", o.cbPalette, "Colour-blind-safe colours", "Blue and orange instead of green and red for good and bad (moods, stock, odds, health, friend and foe), purple instead of red for the Infection layer and hive land, and the battle's threat lines and hit chances in the same colours")}
      ${box("bigText", o.bigText, "Larger map text", `Names, number badges and crew tags drawn on the State Map ${Math.round(BIG_TEXT * 100)}% of their size, whatever the UI size (for a TV across the room)`)}
      ${box("calm", o.calm, "Reduce motion", "No map animations (teams bobbing, smoke, fire), teams jump from tile to tile instead of gliding, nothing pulses or slides (alerts, cards, the title screen)")}
    </div>
    <div class="setrow">
      ${box("minimap", o.minimap !== false, "Minimap", "The whole state in the map's bottom-right corner: your bases and teams, the hordes and hives you know of, and the part on screen; click or drag on it to look there (M)")}
      <label${tip("How big the minimap is (it also grows with the UI size)")}>size <select data-action="dsp-mmsize"${o.minimap !== false ? "" : " disabled"}>${Object.entries(MINIMAP_SIZES).map(([k, s]) => `<option value="${k}" ${o.minimapSize === k ? "selected" : ""}>${s.label}</option>`).join("")}</select></label>
      ${box("devTools", o.devTools, "Show dev tools", "The Dev button in the top bar and the ` key: reveal the map, autopilot, fast forward, the frame rate and the trackers. For testing; they are not part of the game")}
    </div>`;
}

const toggle = (ui, k) => {
  if (!OPT || !(k in OPT)) return;
  OPT[k] = !OPT[k];
  if (k === "devTools" && !OPT.devTools && ui) { ui.dev = false; view.devReveal = false; } // hidden again: closed, and the map's fog back
  if (SAVE) SAVE();
  applyDisplay();
};
// Handlers (main.js: fn(ui, d) and fn(ui, el)).
export const DISPLAY_ACTIONS = {
  "dsp-opt": (ui, d) => toggle(ui, d.k),
  "mm-toggle": (ui) => toggle(ui, "minimap"),
};
export const DISPLAY_CHANGE = {
  "dsp-mmsize": (ui, el) => { if (OPT && MINIMAP_SIZES[el.value]) { OPT.minimapSize = el.value; if (SAVE) SAVE(); applyDisplay(); } },
};

// The keys (main.js keydown, before the other map keys). modal: a window is up (ui.js modalKind). Returns true when the
// key was taken (Shift+P is taken and does nothing while the dev tools are hidden).
export function displayKey(ui, e, modal) {
  if (modal || !ui.started) return false;
  const k = keyAction(e, "map"); // the key table (ui/keymap.js; Menu → Controls): M, ` and Shift+P by default
  if (k === "map.minimap") { toggle(ui, "minimap"); return true; }
  if (k === "dev.tools") { if (devAllowed(ui)) ui.dev = !ui.dev; return true; }
  if (k === "dev.autopilot" && !devAllowed(ui)) return true;
  return false;
}

// Help topics (ui/help.js adds them after Windows and panels): the minimap, readability, and the confirmation box.
export function displayHelp() {
  return [
    ["Minimap", `The whole state in the bottom-right corner of the map, as far as you know it: the land bright where you see it now, dimmer where you have a report, dark where you have none; water and roads; your bases (blue squares, the hub bigger) and teams (light blue dots, yellow when one waits for orders, faded where a team out of radio contact should be by its plan); the hordes (dots, bigger for bigger hordes, faded where one was last seen) and hives (diamonds) you know of; and with the Territory layer on, other groups' bases you know in their colour and the land they hold. The Territory, Infection and Coalition layers tint it like the map. The white frame is the part of the map on screen. <b>Click or drag</b> on it to look there. <b>M</b> (or its – button) hides it; ▣ Minimap in the same corner, or M again, brings it back. Its size is in ⚙ Menu → Options → Display (and it grows with the UI size); it is remembered.`],
    ["Readability", `In ⚙ Menu → Options → Display. <b>Colour-blind-safe colours</b>: green and red, which most colour-blind people cannot tell apart, become blue (good: safe, healthy, a good chance, friendly) and orange (bad: danger, wounds, a poor chance, hostile) everywhere, the in-between amber becomes yellow, and the Infection layer and hive land turn purple. The battle's threat lines and hit chances use the same colours. <b>Larger map text</b>: the names, number badges and crew tags drawn on the State Map ${Math.round(BIG_TEXT * 100)}% of their size, on top of the UI size (which sizes the panels, windows and buttons but not the map's own drawing). <b>Reduce motion</b>: no map animations, teams jump from tile to tile instead of gliding along the road, hives and besieged bases do not pulse, and nothing on the screen slides or blinks (the urgent-alert pulse, the title screen). <b>Show dev tools</b>: the Dev button and the \` key (for testing; the autopilot's Shift+P too).`],
    ["Confirmations", `Orders that cannot be taken back ask first, all in the same box: what happens, then <b>Yes</b> (or <b>Enter</b>) and <b>Cancel</b> (or <b>Esc</b>). They are: executing or releasing a prisoner, pulling a building down, breaking gear worth more than junk down for firewood, attacking a caravan or robbing merchants, joining or leaving a war, expelling a coalition member, giving up a job, ending a trade route, deleting a supply run or a work role, and digging a growing crop under. Tick <b>Don't ask again</b> in the box to stop asking for that kind of order; ⚙ Menu → Options → Confirmations lists the kinds you stopped, with Ask again. The menu's own questions (loading, exiting without saving, a new campaign, deleting a save) use the same box; the one about leaving with progress not saved can be stopped there too (the option Confirm before leaving a game). Battles keep their own: the end turn asks "Space again" while units still have actions, and sounding the retreat or falling back from the walls shows each unit's odds first.`],
  ];
}
