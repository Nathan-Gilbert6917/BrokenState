// Menu → Options → Display (ui/settings.js shows the rows): colour-blind-safe colours (ui/palette.js and the CSS
// variables under :root.cb), larger text on the map, reduce motion (no map animations, glides, pulsing badges or
// sliding cards: :root.calm), the minimap (ui/minimap.js) and "Show dev tools" (the Dev button in the top bar and the
// ` key; off for players). The options live in ui/saves.js (read through ui/displayopts.js). The keys this module
// owns: M (minimap), ` (dev tools, when they are shown) and Shift+P (autopilot, a dev tool) are all in displayKey.
import { setPalette } from "./palette.js";
import { setReadable, setMapAnim, redrawMap, view } from "./render.js";
import { MINIMAP_SIZES, BATTLE_LOOK_LEVELS, NIGHT_SHADES, LIGHTNING_LEVELS } from "./displayopts.js";
import { setMarksLevel } from "./battlemarks.js"; // Battle ground marks
import { setPoiReveal } from "../sim/pois.js"; // the dev tools hidden: the points of interest back under the fog
import { setEdgeLevel } from "./battleedge.js"; // Battle map edge
import { setNightShade, NIGHT_LEVELS } from "./nightfx.js"; // the State Map's night shade (Display → Night darkness)
import { keyAction } from "./keymap.js"; // the key table (Menu → Controls)
import { setLightning } from "./lightningfx.js"; // lightning flashes on the State Map (Display → Lightning flashes)

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
  setMarksLevel(OPT.battleMarks || "full");
  setEdgeLevel(OPT.battleEdge || "full");
  setNightShade(OPT.nightShade); // ui/nightfx.js (setMapAnim above draws the map again)
  setLightning(OPT.lightning, !!OPT.calm); // ui/lightningfx.js: Reduce motion makes Full Soft
}

// The Dev button and the ` key: with "Show dev tools" on, or while the dev tools are open (a tool or the desktop
// perf driver opened them: window.game.dev).
export const devAllowed = (ui) => !!(OPT && OPT.devTools) || !!(ui && ui.dev);
export const devButton = (ui) => (devAllowed(ui)
  ? `<button data-action="dev-toggle" class="${ui.dev ? "active" : ""}"${tip("Dev tools: reveal the map, autopilot, fast forward, frame rate, and a tracker of groups and zombie hotzones (` key). Hide this button: Menu → Options → Display → Show dev tools")}>Dev</button>`
  : "");

// The rows added to the Options tab's Display section.
export function displayRows(o) {
  const look = (act, v, label, t) => `<label${tip(t)}>${label} <select data-action="${act}">${Object.entries(BATTLE_LOOK_LEVELS).map(([k, l]) => `<option value="${k}" ${(v || "full") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
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
    </div>
    <div class="setrow">
      ${look("dsp-bmarks", o.battleMarks, "Battle ground marks", "What a fight leaves on the ground for the rest of it: blood where someone was hit or fell, spent brass under the shooters, scorch marks and ash where grenades, Molotovs, rockets and fire went off, broken glass. Light: blood, scorch and glass only. Off for slow machines (the bodies always stay)")}
      ${look("dsp-bedge", o.battleEdge, "Battle map edge", "The ground running on a few tiles past the battle map's edges and fading into fog the colour of the sky (night, the weather), with a soft vignette. Light: a narrower plain strip, no vignette. Off: the fog colour behind the map")}
      <label${tip("How dark the State Map gets at night: dusk fades in from 19:00 to 21:00 and dawn out from 05:00 to 07:00. Your bases, lit camps, fires and teams carrying lights glow through it; names, icons and the selection stay bright. Not in the timelapse or the minimap.")}>Night darkness <select data-action="dsp-night">${NIGHT_SHADES.map((k) => `<option value="${k}" ${(o.nightShade || "dark") === k ? "selected" : ""}>${NIGHT_LEVELS[k].label}</option>`).join("")}</select></label>
      <label${tip("Lightning in thunderstorms on the State Map. Full: the land brightens for a moment (most round the strike, at night the dark lifts there), a bolt comes down and now and then flickers. Soft: the bolt and a glow round it only, no brightening of the whole map and no flicker (Reduce motion makes Full Soft). Off: no flashes, the thunder only. Never more than 3 flashes a second. Not in the timelapse or the minimap.")}>Lightning flashes <select data-action="dsp-lightning">${Object.entries(LIGHTNING_LEVELS).map(([k, l]) => `<option value="${k}" ${(o.lightning || "full") === k ? "selected" : ""}>${l}${k === "full" && o.calm ? " (Soft: reduce motion)" : ""}</option>`).join("")}</select></label>
      ${box("edgeWarn", o.edgeWarn !== false, "Screen-edge warnings", "A red pulse at the edge of the screen, toward the place, when something off screen is under attack: a base of yours besieged or attacked, a raid or horde about to hit one, a team of yours in a fight or ambushed; in a battle, one of your people shot at or hit out of view. Click it to look there")}
      ${box("heartbeat", !!o.heartbeat, "Heartbeat while a base is attacked", "A soft heartbeat in the ambience while a base of yours is under attack (siege, raid or horde at the walls). Follows the Ambience volume")}
    </div>`;
}

const toggle = (ui, k) => {
  if (!OPT || !(k in OPT)) return;
  OPT[k] = !OPT[k];
  if (k === "devTools" && !OPT.devTools && ui) { ui.dev = false; view.devReveal = false; setPoiReveal(false); } // hidden again: closed, and the map's fog back (pois.js too)
  if (SAVE) SAVE();
  applyDisplay();
};
// Handlers (main.js: fn(ui, d) and fn(ui, el)).
export const DISPLAY_ACTIONS = {
  "dsp-opt": (ui, d) => toggle(ui, d.k),
  "mm-toggle": (ui) => toggle(ui, "minimap"),
};
const setLook = (k, v) => { if (OPT && Object.hasOwn(BATTLE_LOOK_LEVELS, v)) { OPT[k] = v; if (SAVE) SAVE(); applyDisplay(); } };
export const DISPLAY_CHANGE = {
  "dsp-bmarks": (ui, el) => setLook("battleMarks", el.value),
  "dsp-bedge": (ui, el) => setLook("battleEdge", el.value),
  "dsp-mmsize": (ui, el) => { if (OPT && MINIMAP_SIZES[el.value]) { OPT.minimapSize = el.value; if (SAVE) SAVE(); applyDisplay(); } },
  "dsp-lightning": (ui, el) => { if (OPT && Object.hasOwn(LIGHTNING_LEVELS, el.value)) { OPT.lightning = el.value; if (SAVE) SAVE(); applyDisplay(); } },
  "dsp-night": (ui, el) => { if (OPT && NIGHT_SHADES.includes(el.value)) { OPT.nightShade = el.value; if (SAVE) SAVE(); applyDisplay(); } },
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
    ["Readability", `In ⚙ Menu → Options → Display. <b>Colour-blind-safe colours</b>: green and red, which most colour-blind people cannot tell apart, become blue (good: safe, healthy, a good chance, friendly) and orange (bad: danger, wounds, a poor chance, hostile) everywhere, the in-between amber becomes yellow, and the Infection layer and hive land turn purple. The battle's threat lines and hit chances use the same colours. <b>Larger map text</b>: the names, number badges and crew tags drawn on the State Map ${Math.round(BIG_TEXT * 100)}% of their size, on top of the UI size (which sizes the panels, windows and buttons but not the map's own drawing). <b>Reduce motion</b>: no map animations, teams jump from tile to tile instead of gliding along the road, hives and besieged bases do not pulse, and nothing on the screen slides or blinks (the urgent-alert pulse, the title screen). <b>Night darkness</b>: how dark the State Map gets at night (Off, Light, Dark): dusk fades in from 19:00 to 21:00 and dawn out from 05:00 to 07:00; your bases, lit camps, fires and teams carrying lights glow through it, and names, icons and the selection stay bright. <b>Lightning flashes</b>: lightning in thunderstorms on the State Map (Full, Soft, Off). Full: the land brightens for a moment, most round the strike (at night the dark lifts there), and a bolt comes down, now and then flickering. Soft: the bolt and a glow round it only, no brightening of the whole map and no flicker (Reduce motion makes Full Soft). Off: the thunder only. Never more than 3 flashes in any second, and the whole map never brightens past a moderate level. <b>Screen-edge warnings</b>: a red pulse at the edge of the map toward a base of yours under attack, a team of yours in a fight or ambushed, or a raid or horde about to hit a base, when it is off screen; in a battle, toward one of your people shot at or hit out of view. Click its badge to look there. <b>Heartbeat while a base is attacked</b> (off by default) adds a soft heartbeat to the ambience. <b>Show dev tools</b>: the Dev button and the \` key (for testing; the autopilot's Shift+P too).`],
    ["Confirmations", `Orders that cannot be taken back ask first, all in the same box: what happens, then <b>Yes</b> (or <b>Enter</b>) and <b>Cancel</b> (or <b>Esc</b>). They are: executing or releasing a prisoner, pulling a building down, breaking gear worth more than junk down for firewood, attacking a caravan or robbing merchants, joining or leaving a war, expelling a coalition member, giving up a job, ending a trade route, deleting a supply run or a work role, and digging a growing crop under. Tick <b>Don't ask again</b> in the box to stop asking for that kind of order; ⚙ Menu → Options → Confirmations lists the kinds you stopped, with Ask again. The menu's own questions (loading, exiting without saving, a new campaign, deleting a save) use the same box; the one about leaving with progress not saved can be stopped there too (the option Confirm before leaving a game). Battles keep their own: the end turn asks "Space again" while units still have actions, and sounding the retreat or falling back from the walls shows each unit's odds first.`],
  ];
}
