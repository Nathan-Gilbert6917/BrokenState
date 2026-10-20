// The side panels' small helpers (styles.css .pf, .sf-top / .sf-bot, .ppl-bar):
//   folds        a short line you can open for what is under it; the panels are redrawn as a whole (main.js setHTML),
//                so each fold remembers whether it is open by its key, for the session
//   scroll fades the top / bottom edge of a box that scrolls fades out while there is more to see that way
//   focus        a text box in a panel keeps the focus and the caret when the panel is redrawn under it
//   People tab   the find box's text and the compact / cards view (remembered in this browser)
const opened = new Map(); // key → open (true) or closed (false) by the player; a fold never touched shows its default
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hasDoc = typeof document !== "undefined" && !!document.addEventListener;

// ---------- folds ----------
//   key      unique and stable for what it shows ("upkeep:3")
//   summary  the line you click (HTML)
//   body     what it opens (HTML)
//   tipText  hover text on the line
//   open     open until the player closes it (closed by default)
export const foldIsOpen = (key, def = false) => (opened.has(String(key)) ? opened.get(String(key)) : def);
export function setFoldOpen(key, open) {
  opened.set(String(key), !!open);
}
export function fold(key, summary, body, { cls = "", tipText = "", open = false } = {}) {
  if (!body) return "";
  return `<details class="pf${cls ? ` ${cls}` : ""}" data-fold="${esc(key)}"${foldIsOpen(key, open) ? " open" : ""}><summary${tipText ? ` data-tip="${esc(tipText)}"` : ""}>${summary}</summary><div class="pf-body">${body}</div></details>`;
}

// ---------- scroll fades ----------
// The boxes that scroll on their own inside the panels. Marked only while they overflow, so a box that fits costs
// nothing (no mask).
const FADE_SEL = ".pk-scroll, .pf-body, .gc-extra > .small, .pk .kv > div:nth-child(even)";
export function fadeEdges(el) {
  const more = el.scrollHeight - el.clientHeight > 1;
  const top = more && el.scrollTop > 1;
  const bot = more && el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  if (el.classList.contains("sf-top") !== top) el.classList.toggle("sf-top", top);
  if (el.classList.contains("sf-bot") !== bot) el.classList.toggle("sf-bot", bot);
}
export function updateFades(root) {
  if (!root || !root.querySelectorAll) return;
  if (root.matches && root.matches(FADE_SEL)) fadeEdges(root);
  for (const el of root.querySelectorAll(FADE_SEL)) fadeEdges(el);
}

// ---------- focus ----------
// A text box marked data-keep="name" keeps the focus, its caret and selection when its panel is rewritten (the
// People tab's find box while the clock runs). main.js setHTML: const k = keepFocusBefore(el); write; keepFocusAfter(el, k).
export function keepFocusBefore(el) {
  const a = hasDoc ? document.activeElement : null;
  if (!a || !el.contains(a) || !a.dataset || !a.dataset.keep) return null;
  let s = null, e = null, d = "none";
  try { s = a.selectionStart; e = a.selectionEnd; d = a.selectionDirection || "none"; } catch { /* not a text box */ }
  return { key: a.dataset.keep, s, e, d };
}
export function keepFocusAfter(el, k) {
  if (!k) return;
  const n = [...el.querySelectorAll("[data-keep]")].find((x) => x.dataset.keep === k.key);
  if (!n) return;
  n.focus({ preventScroll: true });
  try { if (k.s != null) n.setSelectionRange(k.s, k.e, k.d); } catch { /* not a text box */ }
}
// Everything a panel needs after it was rewritten.
export function afterPanelWrite(el, k) {
  keepFocusAfter(el, k);
  updateFades(el);
}

// ---------- the People tab ----------
// The find box (this session) and the view: compact rows or full cards (this browser, localStorage when it works).
const PEOPLE_VIEW_KEY = "bs.peopleView";
let peopleQ = "";
let peopleCompact = null;
export const peopleQuery = () => peopleQ;
export function setPeopleQuery(q) { peopleQ = String(q || "").slice(0, 40); }
export function peopleIsCompact() {
  if (peopleCompact == null) {
    try { peopleCompact = typeof localStorage !== "undefined" && localStorage.getItem(PEOPLE_VIEW_KEY) === "compact"; } catch { peopleCompact = false; }
  }
  return peopleCompact;
}
export function setPeopleCompact(on) {
  peopleCompact = !!on;
  try { if (typeof localStorage !== "undefined") localStorage.setItem(PEOPLE_VIEW_KEY, peopleCompact ? "compact" : "cards"); } catch { /* private window: this session only */ }
}
// Clicks (main.js actions) and typing (main.js input listener).
export const PANEL_ACTIONS = {
  "ppl-view": () => setPeopleCompact(!peopleIsCompact()),
  "ppl-clear": () => setPeopleQuery(""),
};
export const PANEL_INPUT = {
  "ppl-q": (el) => setPeopleQuery(el.value),
};

if (hasDoc) {
  // A <details> opened or closed by the player: remember it (toggle does not bubble, so listen while it captures),
  // and its boxes may now overflow (or no longer).
  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!d || !d.dataset || d.dataset.fold == null) return;
    setFoldOpen(d.dataset.fold, d.open);
    updateFades(d);
  }, true);
  // Scrolling a box moves its fades (scroll does not bubble either).
  document.addEventListener("scroll", (e) => {
    const t = e.target;
    if (t && t.matches && t.matches(FADE_SEL)) fadeEdges(t);
  }, { capture: true, passive: true });
  // A new window size or UI size changes what overflows.
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("resize", () => { updateFades(document.getElementById("left")); updateFades(document.getElementById("right")); });
}
