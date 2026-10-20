// Open the build map (the user's requests 2026-10-20; sim/staging.js askLayout): the ways to a base's build map that
// never stop the clock nor block a save.
//   - the alert: a base new to you or just gone up a tier ("Sutter Camp: camp set up. Open the build map"; the base's
//     name read as it is drawn, so a rename shows); a click opens its build map, ✕ or 💤 put it away, opening the map
//     any way ends it (sim/staging.js layoutDone), and it goes by itself after LAYOUT_ASK.HOURS;
//   - the camp's Camp tab: the button (the base map's own bm-open, back to the Camp tab when it closes);
//   - the key (ui/keymap.js base.buildmap, U by default; B is the Bases tab): the selected base's build map from the
//     State Map: the base whose window is open, else the base on the selected tile.
// The cards that carry the button (sim/staging.js buildMapChoice) are routed by main.js's card choice to
// ui/basemap.js openBuildMap, as everything here is.
import { baseById } from "../sim/world.js";
import { layoutAsks, layoutAskLine, LAYOUT_WHY, BUILD_MAP_LABEL } from "../sim/staging.js";
import { openBuildMap } from "./basemap.js";
import { keyAction, keyLabel } from "./keymap.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * The selected base: the one whose window is open, else yours on the selected tile; null when neither.
 * @param {any} state @param {any} ui
 */
export function selectedBase(state, ui) {
  if (!state || !ui) return null;
  const open = ui.baseView ? baseById(state, ui.baseView.id) : null;
  if (open) return open;
  return ui.selected != null ? state.bases.find((b) => b.tile === Number(ui.selected)) || null : null;
}

// The alerts (ui/alerts.js SECTIONS.layout): one a base that asks to be laid out.
export function buildMapAlerts(state, out) {
  for (const b of layoutAsks(state)) {
    out.push({
      key: `layout:${b.id}:${b.layoutAsk.hour}`, kind: "layout", icon: "📐", tone: "info", text: layoutAskLine(b),
      tip: `${b.name} is ${LAYOUT_WHY[b.layoutAsk.why] || "new"}: lay it out on its build map (where its buildings, tents, fields and defences go). Click to open the map; any time later, select the base and press ${keyLabel("base.buildmap", 1)}, or use its Base map tab.`,
      go: { act: "buildmap", baseId: b.id }, event: true,
    });
  }
}

// The button on the camp's Camp tab (ui/ui.js campTab): the base map's own bm-open, back to the Camp tab.
export function buildMapRow(state, b) {
  if (!b) return "";
  return `<div class="row" style="margin-top:0.4rem"><button class="primary" data-action="bm-open" data-base="${b.id}" data-tab="camp"${tip(`Lay the camp out on its map: pick a tent, a fire, a shelter or a defence from the Build list and click where it goes, or move what stands there (${keyLabel("base.buildmap", 1)} opens it from the State Map too).`)}>${BUILD_MAP_LABEL}</button></div>`;
}

// main.js: actions.buildmap (the alert's go, the key). d.baseId: that base; none: the selected base. d.tab: the base
// window's tab to come back to. Returns true when the map opened; otherwise ui.flash says why.
export const BUILDMAP_ACTIONS = {
  buildmap: (state, ui, d = {}) => {
    const b = d.baseId != null ? baseById(state, Number(d.baseId)) : selectedBase(state, ui);
    const why = !b ? (d.baseId != null ? "That base is gone: there is no build map to open." : "Select one of your bases first (click its tile, or open its window).")
      : openBuildMap(state, ui, b.id, d.tab || (ui.baseView && ui.baseView.id === b.id ? ui.baseView.tab : "basemap"));
    if (why) ui.flash = { text: why, at: now() };
    return !why;
  },
};

// main.js keydown: the key opens the selected base's build map, on the State Map or over that base's window (no other
// window). True when it was the key.
export function buildMapKey(state, ui, e, modal) {
  if (!ui.started || state.combat || keyAction(e, "map") !== "base.buildmap") return false;
  if (modal && modal !== "base") return false;
  const tab = ui.baseView ? ui.baseView.tab : null;
  BUILDMAP_ACTIONS.buildmap(state, ui, tab ? { tab } : {});
  return true;
}
