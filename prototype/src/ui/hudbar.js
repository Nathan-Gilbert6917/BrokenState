// The row of buttons at the bottom left of the State Map (a desktop, a tablet on its side): one button a box over the
// map, each with its count, lit while its box is open. The user's request 2026-10-24: "I like the portrait button
// overlay; utilize that as a toggle system with some information shown in the button, like the week one and alerts;
// when clicked the movable window overlay shows for the selected buttons; in a row have these buttons in the bottom
// left of the screen".
//   🔔 Alerts      how many need you (red with an urgent one)      shows or hides the alerts stack
//   👁 Watching    pins and map notes (only while there are any)    shows or hides the Watching panel
//   🗺 Layers      how many layers are on                           shows or hides the Layers box
//   ▣ Minimap      (lit while it shows)                             shows or hides the minimap (as M does)
//   🧭 First week  steps done of the list, while the guide is on    shows or hides the first-week guide
// A click toggles that one box; any number may be open at once, and each open box is a window that moves by its header
// (ui/overlaydrag.js). The buttons go through the boxes' own state, so the keys (Shift+], M, \\ Map only), autoReveal
// (a new urgent alert opens the alerts) and the layout saved in the browser keep working: main.js "panel-toggle"
// (ui/layout.js setFolded) for the alerts, Layers and the guide, "wl-collapse" for Watching, "mm-toggle" (ui/display.js)
// for the minimap. While the bar is up (body.hudbar) a folded box shows nothing in its place: the button is its tab
// (styles.css), and the Layers box opens above the bar (--hudbar-h on #mapwrap). On a phone or a tablet held upright the
// strip over the map does this (ui/responsive.js) and the bar is not drawn.
import { view } from "./render.js";
import { LAYERS } from "../sim/markers.js";
import { guideSteps } from "./guide.js";
import { compactUI } from "./responsive.js";

const CHIPS = [
  ["alerts", "🔔", "Alerts", "What needs you now: a team waiting, food or water running low, a horde near a base, someone sick… Red when something is urgent. Click to show or hide the alerts (Shift+])"],
  ["watch", "👁", "Watching", "What you pinned with 📌 (a person, a team, a horde, a group, a base) with its status live, and your map notes. Click to show or hide the panel"],
  ["legend", "🗺", "Layers", "The map's layers: switch each on or off (the count is how many are on). Click to show or hide the box"],
  ["minimap", "▣", "Minimap", "The whole state as far as you know it: click or drag on it to look there. Click to show or hide it (M)"],
  ["guide", "🧭", "First week", "The first-week guide: steps for a new holdout, ticked off as you do them, with Show me (the count: steps done). Click to show or hide it"],
];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const $ = (id) => document.getElementById(id);
let bar = null, wrap = null, sizeObs = null;
let dangerSeen = null; // the urgent alerts' keys at the last sync: a new one flashes 🔔

// A click on a main.js action, as the player's own (its listener folds, saves the layout and redraws).
function act(action, data = {}) {
  const b = document.createElement("button");
  b.hidden = true;
  b.dataset.action = action;
  for (const [k, v] of Object.entries(data)) b.dataset[k] = v;
  document.body.appendChild(b);
  b.click();
  b.remove();
}

export function initHudBar(mapwrap) {
  if (typeof document === "undefined" || !mapwrap || bar) return;
  wrap = mapwrap;
  bar = document.createElement("nav");
  bar.id = "hudbar";
  bar.className = "hidden";
  bar.setAttribute("aria-label", "The boxes over the map");
  bar.innerHTML = CHIPS.map(([k, ic, name, t]) => `<button class="hb-chip hidden" data-hb="${k}" aria-pressed="false" data-tip="${esc(t)}"><span class="hb-ic" aria-hidden="true">${ic}</span><span class="hb-l">${name}</span><b class="hb-badge hidden"></b></button>`).join("");
  bar.addEventListener("click", onClick);
  wrap.appendChild(bar);
  if (typeof ResizeObserver !== "undefined") { sizeObs = new ResizeObserver(syncHeight); sizeObs.observe(bar); }
}
function syncHeight() {
  if (!wrap || !bar) return;
  wrap.style.setProperty("--hudbar-h", `${bar.classList.contains("hidden") ? 0 : Math.round(bar.offsetHeight)}px`);
}
// The box's state and count, from the game and the layout (ui/layout.js: folded is true).
function chipState(state, ui, layout, options) {
  const live = !!(ui && ui.started && state && !state.combat && !state.gameOver && !ui.timelapse);
  const alerts = live && ui.alertList ? ui.alertList : [];
  const danger = alerts.filter((a) => a && a.tone === "danger").map((a) => a.key);
  const w = live ? state.watchList : null, pins = w && w.items ? w.items.length : 0, notes = live && state.mapNotes && state.mapNotes.list ? state.mapNotes.list.length : 0;
  const on = Object.keys(LAYERS).filter((k) => view.layers.has(k)).length;
  const mm = $("minimap"), mmOn = !!(mm && !mm.classList.contains("hidden"));
  const g = live ? state.guide : null, gOn = !!(g && g.on);
  const steps = gOn ? guideSteps(g) : [], done = steps.filter((st) => g.done[st.id] != null).length;
  return {
    live,
    alerts: { show: live, open: !layout.alerts, n: alerts.length, danger: danger.length > 0, keys: danger },
    watch: { show: live && pins + notes > 0, open: !!w && !w.collapsed, n: pins + notes },
    legend: { show: live, open: !layout.legend, n: on },
    minimap: { show: live, open: options ? options.minimap !== false : mmOn, n: "" }, // the option, not the element: the frame loop shows it a moment later
    guide: { show: gOn, open: !layout.guide, n: steps.length ? `${done}/${steps.length}` : "" },
  };
}
let last = null; // the last state synced (the click reads it)
// Each redraw (main.js refresh, after the boxes are written): the buttons' counts and lights, the guide's place.
export function syncHudBar(state, ui, layout, options) {
  if (!bar) return;
  const S = chipState(state, ui, layout, options);
  last = S;
  const up = S.live && !compactUI();
  document.body.classList.toggle("hudbar", up);
  bar.classList.toggle("hidden", !up);
  if (up) {
    for (const b of bar.querySelectorAll(".hb-chip")) {
      const k = b.dataset.hb, s = S[k];
      b.classList.toggle("hidden", !s.show);
      if (!s.show) continue;
      b.classList.toggle("active", s.open);
      b.setAttribute("aria-pressed", String(s.open));
      const bd = b.querySelector(".hb-badge"), n = String(s.n ?? "");
      if (bd.textContent !== n) bd.textContent = n;
      bd.classList.toggle("hidden", !n || n === "0");
      const red = k === "alerts" && s.danger;
      bd.classList.toggle("danger", red);
      b.classList.toggle("danger", red);
    }
    const keys = new Set(S.alerts.keys);
    if (dangerSeen && [...keys].some((k) => !dangerSeen.has(k))) flash("alerts");
    dangerSeen = keys;
  } else dangerSeen = null;
  syncHeight();
  placeGuide();
}
// A new urgent alert: 🔔 flashes for a moment (nothing with Reduce motion: styles.css).
function flash(k) {
  const b = bar && bar.querySelector(`.hb-chip[data-hb="${k}"]`);
  if (!b) return;
  b.classList.remove("hb-flash");
  void b.offsetWidth; // restart the animation
  b.classList.add("hb-flash");
  setTimeout(() => b.classList.remove("hb-flash"), 3000);
}
// A button: its box shown or hidden, the way its own control would do it.
function onClick(e) {
  const b = e.target.closest && e.target.closest(".hb-chip");
  if (!b || !last) return;
  const k = b.dataset.hb, s = last[k];
  if (!s) return;
  if (k === "minimap") act("mm-toggle");
  else if (k === "watch") act("wl-collapse", { v: s.open ? "1" : "0" });
  else act("panel-toggle", { p: k, v: s.open ? "1" : "0" });
}
// The first-week guide's box goes under the alerts (open, and in the right column) or under the banner, and stops
// above the minimap; a guide the player moved (ui/overlaydrag.js ov-placed) stays where it was put.
export function placeGuide() {
  const el = $("guide");
  if (!el || !wrap || el.classList.contains("hidden") || el.classList.contains("ov-placed") || compactUI()) { if (el && !el.classList.contains("ov-placed")) { el.style.top = ""; el.style.maxHeight = ""; } return; }
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16, gap = Math.round(rem * 0.5);
  const right = (b) => b && !b.classList.contains("hidden") && b.offsetHeight && b.offsetLeft + b.offsetWidth / 2 > wrap.clientWidth / 2;
  const al = $("alerts"), banner = $("banner"), mm = $("minimap");
  let top = Math.round(rem * 0.6);
  if (right(al) && al.offsetTop + al.offsetHeight / 2 < wrap.clientHeight / 2) top = al.offsetTop + al.offsetHeight + gap;
  else if (banner && !banner.classList.contains("hidden") && banner.offsetHeight) top = banner.offsetTop + banner.offsetHeight + gap;
  const bottom = right(mm) && mm.offsetTop > wrap.clientHeight / 2 ? mm.offsetTop - gap : wrap.clientHeight - gap;
  el.style.top = `${top}px`;
  el.style.maxHeight = `${Math.max(64, bottom - top)}px`;
}
