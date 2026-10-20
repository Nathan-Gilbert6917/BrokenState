// World configuration (2026-10-19, user request): the new-run screen's World… window. The dials of one run
// (sim/worldcfg.js WORLD_CFG: hunger, thirst, spoilage, the dead, the worm, the groups, events, raids, the loot by
// kind, the sizes of bases, raid maps and crawls, wear, failures, fuel) in groups, each a slider and a number box (a toggle for
// the worm's cure), with a preset select on top: Gentle, Standard, Harsh, Nightmare, or Custom. Picking a preset sets
// every dial; moving any dial off what a preset sets flips the select to Custom (sim/worldcfg.js presetOf). The
// settings live on the screen (ui.worldCfg), go into the world when it is built (main.js newWorld → createWorld
// worldCfg) and are remembered in this browser (ui/saves.js options.worldCfg); Done builds the world again if anything
// changed (the groups' starting kit is dealt as the world is made). HTML builders and handlers; main.js registers them.
import { WORLD_CFG, CFG_KEYS, CFG_GROUPS, CFG_PRESETS, cleanCfg, defaultCfg, presetOf, presetCfg, isDefaultCfg, cfgSummary, cfgValueText, cfgChanges } from "../sim/worldcfg.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");

// The settings on the screen, made safe (and made, the first time).
export function uiCfg(ui) {
  if (!ui.worldCfg) ui.worldCfg = defaultCfg();
  return ui.worldCfg;
}
// The name on the new-run screen's button: the preset, or Custom, or nothing when standard.
export function worldLabel(ui) {
  const c = uiCfg(ui);
  if (isDefaultCfg(c)) return "";
  const p = presetOf(c);
  return p ? CFG_PRESETS[p].name : "Custom";
}
// The new-run screen's button (ui/newgame.js).
export function worldButton(ui) {
  const label = worldLabel(ui), n = cfgChanges(uiCfg(ui)).length;
  const t = label ? `World configuration: ${label}${label === "Custom" ? ` (${n} dial${n === 1 ? "" : "s"} off standard)` : ""}. ${cfgSummary(uiCfg(ui))}` : "World configuration: the dials of this run (hunger, thirst, spoilage, the dead, the worm, the groups, events, raids, loot by kind, the sizes of bases, raid maps and crawls, wear, failures, fuel), a preset or your own. Standard now: the game as it is";
  return `<button data-action="wc-open"${tip(t)}>🌍 World${label ? `: ${esc(label)}` : ""}…</button>`;
}

// ---------- the window ----------
function dialRow(cfg, k) {
  const d = WORLD_CFG[k], v = cfg[k];
  const off = v !== d.def;
  if (d.kind === "bool") {
    return `<label class="wcrow wcbool ${off ? "off" : ""}"${tip(d.tip)}><span class="wcname">${esc(d.name)}</span>
      <input type="checkbox" data-action="wc-set" data-k="${k}"${v ? " checked" : ""}> <span class="wcval">${v ? "on" : "off"}${off ? "" : " (standard)"}</span></label>`;
  }
  const num = `<input type="number" class="wcnum" min="${d.min}" max="${d.max}" step="${d.step}" value="${v}" data-action="wc-set" data-k="${k}"${tip(`${d.min}–${d.max}; standard ${d.def}`)}>`;
  return `<div class="wcrow ${off ? "off" : ""}"${tip(d.tip)}><span class="wcname">${esc(d.name)}</span>
      <input type="range" class="wcslide" min="${d.min}" max="${d.max}" step="${d.step}" value="${v}" data-action="wc-set" data-k="${k}">
      ${num}<span class="wcval">${d.kind === "mult" ? cfgValueText(k, v) : ""}${off ? "" : `<i class="muted">${d.kind === "mult" ? " std" : "standard"}</i>`}</span></div>`;
}
export function worldConfigModal(state, ui) {
  const cfg = uiCfg(ui);
  const p = presetOf(cfg);
  const opts = Object.entries(CFG_PRESETS).map(([k, d]) => `<option value="${k}" ${p === k ? "selected" : ""}${tip(d.tip)}>${esc(d.name)}</option>`).join("")
    + `<option value="custom" ${p ? "" : "selected"}${tip("Your own dials: the select shows Custom as soon as one is off what a preset sets")}>Custom</option>`;
  const groups = CFG_GROUPS.map((g) => `<div class="wcgroup"><h3${tip(g.tip)}>${esc(g.name)}</h3><div class="wcrows">${CFG_KEYS.filter((k) => WORLD_CFG[k].group === g.key).map((k) => dialRow(cfg, k)).join("")}</div></div>`).join("");
  const sum = cfgSummary(cfg);
  return `<div class="box wide wcbox"><h1>World configuration</h1>
    <div class="where">The dials of this run. A multiplier is on the usual rate (×1 is the game as it is; ×2 twice as much, ×0.5 half). Saved with the game and remembered here for the next run; Random run keeps them as set. Not a hardcore or Ironman setting: they stack with the mode.</div>
    <div class="row" style="margin-bottom:0.6rem">
      <label${tip("A preset sets every dial at once (what each does is in its hover text). Moving any dial after that makes it Custom.")}>Preset <select data-action="wc-preset">${opts}</select></label>
      <button data-action="wc-reset"${tip("Every dial back to standard (×1, the worm curable, the usual sizes)")}>Reset to standard</button>
      <span class="small ${sum ? "" : "muted"}" style="flex:1;min-width:12rem">${sum ? esc(sum) : "Standard: every dial at 1, the worm curable, the usual sizes."}</span>
    </div>
    <div class="wcgroups">${groups}</div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><span class="small muted" style="flex:1">${ui.started ? `The game is running: these are this run's dials, read only.${state && state.raidLegacy ? " This world was made before the raid map dials: its raid maps keep the sizes it was made with (28 × 20 to 40 × 30)." : ""}` : "Done builds the world again on the same seed if anything changed (your colonists are kept)."}</span><button class="primary" data-action="wc-close">Done</button></div>
  </div>`;
}

// ---------- help ----------
export const WORLDCFG_HELP = `The new-run screen's <b>World…</b> button opens the world configuration: the dials of one run, in groups. <b>Needs and health</b>: how fast people hunger and thirst, how fast food spoils, how often anyone falls ill. <b>The dead and the worm</b>: the size of every horde, the dead waiting at sites, how fast hives grow, how hard the dead hit, the worm from a bite and from the land, and whether the worm can be cured at all (off: no dewormer, purge or surgery works, and nobody passes it on their own). <b>People and events</b>: what the other groups start armed with, how often cards come at home, on the road and on work trips, and how often you are raided. <b>Loot by kind</b>: food, water, ammo, guns and gear, parts, scrap, meds and fuel, each on its own dial, for searching, raids, crawls and the base's scavengers. <b>Sizes</b>: the yard a base starts with and the most it grows to, the smallest and the largest raid map (cities and towns always the largest, every other site between the two by its kind; past 40 × 30 a map has more dead and containers, but Heat rises slower and each container holds a little less), the blocks across a city crawl, the rings down a hive crawl, smallest to largest. <b>Wear, failures and fuel</b>: how fast things wear out, how often guns jam, vehicles break down and machines fail, and what driving burns.<br><br>
A <b>preset</b> (Gentle, Standard, Harsh, Nightmare) sets every dial at once; move any dial and the select reads <b>Custom</b>. <b>Reset to standard</b> is the game as it is. The dials are saved with the game (the log's first lines say which were set) and remembered in this browser for the next run. Random run rolls the map and the crew, not these.`;

// ---------- actions (main.js registers them; each gets (state, ui, data) or (state, ui, el)) ----------
export const WC_ACTIONS = {
  "wc-open": (state, ui) => { ui.wcOpen = true; ui.wcWas = JSON.stringify(uiCfg(ui)); },
  "wc-close": (state, ui) => { ui.wcOpen = false; },
  "wc-reset": (state, ui) => { if (!ui.started) ui.worldCfg = defaultCfg(); },
};
export const WC_CHANGE = {
  // One dial: clamped to its range and step; a min pushed over its max (or a max under its min) takes the other with it.
  "wc-set": (state, ui, el) => {
    if (ui.started) return;
    const k = el.dataset.k;
    if (!WORLD_CFG[k]) return;
    const v = el.type === "checkbox" ? !!el.checked : el.value;
    ui.worldCfg = cleanCfg({ ...uiCfg(ui), [k]: v }, k);
  },
  "wc-preset": (state, ui, el) => {
    if (ui.started) return;
    const c = presetCfg(el.value);
    if (c) ui.worldCfg = c; // Custom: nothing to set (the dials stay as they are)
  },
};
// Did the window's dials change since it opened (main.js wc-close: the world is built again if so)?
export const wcChanged = (ui) => ui.wcWas != null && ui.wcWas !== JSON.stringify(uiCfg(ui));
