// Panels and windows: which panels around the map are folded away, how wide they are, and the size and place of
// each kind of window. The rules here are plain functions on plain objects (tools/uitest.js runs them without a
// browser); ui/windows.js puts them on the page and main.js calls both.
//
// Panels: the left panel (tabs), the right panel (tile, team and site info), the log under the map, and three boxes
// over the map: the alerts, the running orders and the Layers box. Each folds to a slim strip or a small button and
// comes back with a click, a key ([ ] L, Shift+[ Shift+]) or, when the player picks something it shows, by itself
// (autoReveal). "Map only" (\) folds them all and the next press puts them back as they were.
// The left panel, the right panel and the log can also be CLOSED (L.shut): nothing of them stays, not even the
// strip, and the map takes the room. Closed is a step past folded (a closed panel is folded too, so nothing draws
// it). The ✕ on a folded strip or the panel's button in the top bar (◧ ◨ ⬓) closes it; the same button, a slim tab
// at the map's edge, its key or anything that would open a folded panel brings it back open.
//
// Windows: every big window (base, survivor, trade, inventory, planner, menu…) can be resized from its edges and
// corners and moved by its title. Sizes are kept in rem (they grow with the UI size), places in pixels, both clamped
// to the screen. Remembered per kind of window in the browser (localStorage, failures ignored).

import { OVERLAYS_HELP } from "./overlaydrag.js"; // the boxes over the map move (Help line)

export const LAYOUT_KEY = "brokenstate.layout";
export const WINDOWS_KEY = "brokenstate.windows";

// Panel widths in rem: default, smallest, largest (the largest is also capped to a share of the screen).
export const PANEL_SIZE = {
  left: { def: 22, min: 14, max: 48 },
  right: { def: 21, min: 14, max: 48 },
  log: { def: 9.5, min: 4, max: 40 },
};
export const PANEL_KEYS = ["left", "right", "log", "alerts", "orders", "legend"];
// The panels that can be closed completely (the three around the map); their top-bar glyph and name.
export const SHUT_KEYS = ["left", "right", "log"];
export const PANEL_NAMES = { left: { glyph: "◧", name: "left panel", tab: "⟩" }, right: { glyph: "◨", name: "right panel", tab: "⟨" }, log: { glyph: "⬓", name: "log", tab: "▴" } };
export const PANEL_KEYS_HELP = { left: "[", right: "]", log: "L", alerts: "Shift+]", orders: "Shift+[", legend: "", all: "\\" };

// Smallest window, in rem; windows never get bigger than the screen.
export const WIN_MIN = { w: 22, h: 12 };
// Windows that stay as they are: answers to a card, results and the end screen are short and come and go.
const FIXED_KINDS = new Set(["card", "result", "over", "search"]);

const storage = () => {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
};
const num = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);

// ---------- panels ----------
export function defaultLayout() {
  return { left: false, right: false, log: false, alerts: false, orders: false, legend: false, all: null, size: { left: null, right: null, log: null }, shut: { left: false, right: false, log: false } };
}
// Closed completely (no strip either). A closed panel is folded too.
export const isShut = (L, p) => !!(L.shut && L.shut[p]);

export function loadLayout(store = storage()) {
  const L = defaultLayout();
  try {
    const raw = store && store.getItem(LAYOUT_KEY);
    if (!raw) return L;
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object") return L;
    for (const k of PANEL_KEYS) if (typeof v[k] === "boolean") L[k] = v[k];
    if (v.all && typeof v.all === "object") {
      L.all = {};
      for (const k of PANEL_KEYS) L.all[k] = v.all[k] === true;
    }
    if (v.size && typeof v.size === "object") for (const k of Object.keys(PANEL_SIZE)) L.size[k] = num(v.size[k], PANEL_SIZE[k].min, PANEL_SIZE[k].max);
    if (v.shut && typeof v.shut === "object") for (const k of SHUT_KEYS) if (v.shut[k] === true) { L.shut[k] = true; L[k] = true; }
  } catch { /* unreadable: the defaults */ }
  return L;
}
export function saveLayout(L, store = storage()) {
  try { store.setItem(LAYOUT_KEY, JSON.stringify(L)); return true; } catch { return false; } // blocked: this session only
}

// Fold or unfold one panel (v: true folds, false shows, undefined flips). Returns true when it changed. Showing a
// closed panel opens it (a closed panel counts as folded, so its key, the strip or auto-open bring it back).
export function setFolded(L, p, v) {
  if (!PANEL_KEYS.includes(p)) return false;
  const next = v === undefined ? !L[p] : !!v;
  const opened = !next && isShut(L, p);
  if (opened) L.shut[p] = false;
  if (L[p] === next) return opened;
  L[p] = next;
  return true;
}
// Close one of the three panels completely or open it again (v: true closes, false opens, undefined flips).
// Returns true when it changed. Closing folds it too; opening unfolds it.
export function setShut(L, p, v) {
  if (!SHUT_KEYS.includes(p)) return false;
  if (!L.shut) L.shut = { left: false, right: false, log: false };
  const next = v === undefined ? !L.shut[p] : !!v;
  if (L.shut[p] === next && L[p] === next) return false;
  L.shut[p] = next;
  L[p] = next;
  return true;
}

// Map only: fold everything, remembering what was open; again: put it back the way it was. A closed panel stays
// closed through both (it is hidden either way; its key, tab or button opens it).
export function toggleAll(L) {
  if (L.all) {
    for (const k of PANEL_KEYS) L[k] = !!L.all[k];
    L.all = null;
    return false;
  }
  L.all = Object.fromEntries(PANEL_KEYS.map((k) => [k, !!L[k]]));
  for (const k of PANEL_KEYS) L[k] = true;
  return true;
}
// Everything shown again (the menu's reset), widths back to normal.
export function resetLayout(L) {
  Object.assign(L, defaultLayout());
}

export function setPanelSize(L, p, rem) {
  const d = PANEL_SIZE[p];
  if (!d) return false;
  const v = rem == null ? null : num(Number(rem), d.min, d.max);
  if (L.size[p] === v) return false;
  L.size[p] = v;
  return true;
}
export const panelSize = (L, p) => L.size[p] ?? PANEL_SIZE[p].def;

// What the player just picked, and the panel that shows it: before / after are { state, started, sel, xp, tab }.
// - a tile or site picked (selected tile changed), a team's panel opened: the right panel
// - another tab on the left (B P G T, a link that switches it): the left panel
// - a new alert that matters (danger), outside map-only mode: the alerts
// Nothing opens for a new log line. Returns the panels to show (folded or closed ones only).
export function autoReveal(L, before, after, opts = {}) {
  if (opts.autoOpen === false || !after || !after.started || !before || before.state !== after.state || !before.started) return [];
  const out = [];
  if ((after.sel !== before.sel && after.sel >= 0) || (after.xp !== before.xp && after.xp != null) || opts.clicked) out.push("right");
  if (after.tab !== before.tab) out.push("left");
  if (opts.newDanger && !L.all) out.push("alerts");
  return out.filter((p) => L[p] || isShut(L, p));
}

// The hover text of a panel's control: the top-bar button (◧ ◨ ⬓) and the tab at the map's edge.
export function shutTip(L, p) {
  const n = PANEL_NAMES[p], k = PANEL_KEYS_HELP[p];
  if (!n) return "";
  if (isShut(L, p)) return `Open the ${n.name} (${k}, or Alt+${k})`;
  return `Close the ${n.name} completely, strip and all (Alt+${k}). Back: this button, the ${n.tab} tab at the map's edge, Alt+${k} or ${k}`;
}

// Danger alerts not seen before (keys), for autoReveal. seen: a Set kept between refreshes (null the first time).
export function newDangerAlerts(seen, list) {
  const keys = (list || []).filter((a) => a && a.tone === "danger").map((a) => a.key);
  if (!seen) return { seen: new Set(keys), fresh: [] };
  return { seen: new Set(keys), fresh: keys.filter((k) => !seen.has(k)) };
}

// ---------- the boxes over the map: one look ----------
// The Running orders, the Watching panel, the Layers box and the alerts share a header (icon, title, a count, the
// fold chevron) and, folded, a slim tab with the same icon, title and count (styles.css .fp-head / .fp-tab). The
// renderers (ui/expedition.js, ui/watchlist.js, ui/ui.js, main.js) only say what goes in them.
//   icon, title   what the box is
//   count         a number or short text in a badge (null: none); tone "warn" / "danger" colours it
//   badges        more badges after it: [{ text, tone, tip }]
//   action, data  the fold toggle's data-action and other data-* attributes (an object)
//   tip           the toggle's hover text
//   extra         buttons of the box's own, on the header's right (open header only)
const attrEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function fpBadges(o) {
  const out = [];
  if (o.count != null && o.count !== "") out.push(`<span class="fp-badge${o.tone ? ` ${o.tone}` : ""}">${o.count}</span>`);
  for (const b of o.badges || []) if (b && b.text != null && b.text !== "") out.push(`<span class="fp-badge${b.tone ? ` ${b.tone}` : ""}"${b.tip ? ` data-tip="${attrEsc(b.tip)}"` : ""}>${b.text}</span>`);
  return out.join("");
}
function fpToggle(o, open, cls) {
  const data = Object.entries(o.data || {}).map(([k, v]) => ` data-${k}="${attrEsc(v)}"`).join("");
  return `<button class="${cls}" data-action="${o.action}"${data} aria-expanded="${open}"${o.tip ? ` data-tip="${attrEsc(o.tip)}"` : ""}>` +
    `<span class="fp-ico" aria-hidden="true">${o.icon || ""}</span><span class="fp-title">${o.title}</span>${fpBadges(o)}<span class="fp-chev" aria-hidden="true">${open ? "▾" : "▸"}</span></button>`;
}
// The header of an open box: the whole title is the fold button.
export function panelHead(o) {
  return `<div class="fp-head">${fpToggle(o, true, "fp-toggle")}${o.extra ? `<span class="fp-extra">${o.extra}</span>` : ""}</div>`;
}
// A folded box: one slim tab.
export const panelTab = (o) => fpToggle(o, false, `fp-tab${o.cls ? ` ${o.cls}` : ""}`);

// The alerts folded: one tab with the count (red when one of them is a danger), plus the flash line.
export function alertsPill(list, flashHtml = "") {
  const n = (list || []).length;
  const danger = (list || []).some((a) => a && a.tone === "danger");
  if (!n) return flashHtml;
  return `${flashHtml}<button class="al-pill${danger ? " danger" : ""}" data-action="panel-toggle" data-p="alerts" aria-expanded="false" data-tip="Show the alerts (Shift+])"><span class="fp-ico" aria-hidden="true">🔔</span><span class="fp-title">${n} alert${n === 1 ? "" : "s"}</span><span class="fp-chev" aria-hidden="true">▸</span></button>`;
}
// The fold button over the alerts when they are open (n: how many, danger: one is urgent).
export const alertsFoldButton = (n = null, danger = false) => `<button class="al-fold"data-action="panel-toggle" data-p="alerts" aria-expanded="true" data-tip="Fold the alerts away (Shift+])"><span class="fp-ico" aria-hidden="true">🔔</span><span class="fp-title">Alerts</span>${n ? `<span class="fp-badge${danger ? " danger" : ""}">${n}</span>` : ""}<span class="fp-chev" aria-hidden="true">▴</span></button>`;

// The folded left panel's rail: a button per tab (opens the panel on it). The glyphs match the watch list's.
export const RAIL_TABS = [["bases", "🏠", "Bases", "B"], ["people", "👥", "People", "P"], ["groups", "🏴", "Groups", "G"], ["teams", "🚶", "Teams", "T"]];

// ---------- windows ----------
// The kind of window to remember a size for (the survivor screen is one kind whoever it shows), or "" when this
// kind is not resizable.
export function windowKey(kind) {
  if (!kind) return "";
  const k = String(kind).split(":")[0];
  return FIXED_KINDS.has(k) ? "" : k;
}

export function loadWindows(store = storage()) {
  const out = {};
  try {
    const raw = store && store.getItem(WINDOWS_KEY);
    if (!raw) return out;
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object") return out;
    for (const [k, g] of Object.entries(v)) {
      if (!g || typeof g !== "object" || !/^[a-z]+$/.test(k)) continue;
      const w = num(g.w, 8, 400), h = num(g.h, 4, 400), x = num(g.x, -1e5, 1e5), y = num(g.y, -1e5, 1e5);
      const e = {};
      if (w != null && h != null) { e.w = w; e.h = h; }
      if (x != null && y != null) { e.x = x; e.y = y; }
      if (Object.keys(e).length) out[k] = e;
    }
  } catch { /* unreadable: no sizes */ }
  return out;
}
export function saveWindows(W, store = storage()) {
  try { store.setItem(WINDOWS_KEY, JSON.stringify(W)); return true; } catch { return false; }
}

// A window rectangle in pixels kept on the screen: at least the minimum size (or the whole screen when it is
// smaller), at most the screen, and its top left inside it.
export function clampRect(r, vw, vh, rem = 16) {
  const minW = Math.min(vw, WIN_MIN.w * rem), minH = Math.min(vh, WIN_MIN.h * rem);
  const w = r.w == null ? null : Math.max(minW, Math.min(vw, r.w));
  const h = r.h == null ? null : Math.max(minH, Math.min(vh, r.h));
  const bw = w ?? Math.min(vw, r.bw ?? 0), bh = h ?? Math.min(vh, r.bh ?? 0);
  const x = r.x == null ? null : Math.max(0, Math.min(vw - bw, r.x));
  const y = r.y == null ? null : Math.max(0, Math.min(vh - bh, r.y));
  return { x, y, w, h };
}

// Dragging an edge or corner (dir: n s e w ne nw se sw) or the title (dir "move") by dx, dy from the rectangle
// the drag started with. Sizes stop at the minimum without the opposite edge moving.
export function dragRect(start, dir, dx, dy, vw, vh, rem = 16) {
  let { x, y, w, h } = start;
  const minW = Math.min(vw, WIN_MIN.w * rem), minH = Math.min(vh, WIN_MIN.h * rem);
  if (dir === "move") return clampRect({ x: x + dx, y: y + dy, w: null, h: null, bw: w, bh: h }, vw, vh, rem);
  if (dir.includes("e")) w = Math.max(minW, Math.min(vw - x, w + dx));
  if (dir.includes("s")) h = Math.max(minH, Math.min(vh - y, h + dy));
  if (dir.includes("w")) { const nw = Math.max(minW, Math.min(x + w, w - dx)); x += w - nw; w = nw; }
  if (dir.includes("n")) { const nh = Math.max(minH, Math.min(y + h, h - dy)); y += h - nh; h = nh; }
  return clampRect({ x, y, w, h }, vw, vh, rem);
}

// The grips around a resizable window (ui/windows.js handles them); built into the modal's HTML by main.js.
// A window without a title bar of its own (ui/windows.js winBar: the base, survivor and menu windows have one) gets
// a ✕ in its top right corner that is Esc (main.js "win-close"), so every window closes the same way (the user's
// request 2026-10-24). Only the kinds Esc simply closes: the windows that need an answer (a card, a raid's plan, a
// crawl, a trade, loot), the new-run screen and the ones with a Close in their own head (diary, roster, codex,
// ledger) get none.
export const GRIPS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const X_KINDS = new Set(["inv", "teaminv", "teammeet", "teamform", "gunb", "memorial", "why", "skilltree", "radio", "diplo", "route", "caravan", "planner", "volpick", "volreq", "worldcfg", "bgedit", "gearedit", "fleetedit", "zlook", "namebase"]);
export function windowFrame(html, kind) {
  const key = windowKey(kind);
  if (!html || !key) return html || "";
  const x = X_KINDS.has(key) && !/class="wx[" ]/.test(html) ? `<button class="wx wx-corner" data-action="win-close" aria-label="Close" data-tip="Close (Esc)">✕</button>` : "";
  return `<div class="win" data-win="${key}">${html}${x}${GRIPS.map((d) => `<i class="wgrip g-${d}" data-grip="${d}"></i>`).join("")}</div>`;
}

// ---------- help ----------
export function windowsHelp() {
  return `The panels around the map fold away to give the map more room, and big windows can be resized and moved.<br><br>
    <b>Panels:</b> click the slim bar between a panel and the map (⟨ ⟩) to fold it to a strip; click the strip to bring it back. Drag the bar to make the panel wider or narrower (Options → <i>Reset window sizes</i> brings back the usual widths). Keys: <b>[</b> the left panel, <b>]</b> the right panel, <b>L</b> the log, <b>Shift+]</b> the alerts, <b>Shift+[</b> the running orders. The boxes over the map (Running orders, Watching, Layers, the alerts) fold from their header and come back from the slim tab left in their place, which keeps their count. A folded log shows its latest line on its strip; the folded left panel's strip has a button per tab (🏠 Bases, 👥 People, 🏴 Groups, 🚶 Teams, with the number of teams waiting) that opens it on that tab. With the keyboard: Tab to a bar, Enter or Space folds or shows its panel, the arrow keys make it narrower or wider (Shift: by more), Home gives it its usual size.<br><br>
    <b>Closing a panel completely:</b> <b>Alt+[</b>, <b>Alt+]</b> or <b>Alt+L</b>, the ✕ on a folded strip, or the panel's button in the top bar (◧ the left panel, ◨ the right panel, ⬓ the log), closes it with nothing left over, strip and all, and the map takes the room. A closed panel comes back open with the same Alt key or top-bar button (dark while the panel is closed), the slim tab at that edge of the map (⟩ ⟨ ▴), its plain key (<b>[</b> <b>]</b> <b>L</b>), or by itself when you pick something it shows (below). Folded and closed panels are remembered in this browser.<br><br>
    <b>Map only:</b> <b>\\</b> (backslash) or the ▣ button in the top bar folds every panel and box at once; press it again to put them back the way they were. A closed panel stays closed through both.<br><br>
    <b>Opening by themselves:</b> when you pick something a folded or closed panel shows, it opens: a tile, site, base or team clicked on the map, a team opened from a list, an alert or a log link: the right panel; a tab key (B P G T): the left panel; a new urgent alert (red) opens folded alerts, except in map-only mode. The log never opens for a new line. Switch this off in the menu: Options → <i>Auto-open panels on select</i>.<br><br>
    <b>Windows:</b> drag a window's edges or corners to resize it, and its title to move it; double-click the title for its usual size and place. The content scrolls inside. Each kind of window (base, survivor, trade, inventory, planner, menu, diary, roster…) remembers its size and place in this browser; Options → <i>Reset window sizes</i> puts every window and panel back. Sizes follow the UI size.<br><br>
    ${OVERLAYS_HELP}`;
}
