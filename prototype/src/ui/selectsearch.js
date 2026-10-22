// Drop-downs you can type in (searchable selects). A native <select> only jumps by the first letter; a long one
// (MIN_OPTIONS or more options: the start-gear and background item pickers, the gun builder's rounds, trade and
// caravan bases and stops, the roster's role list, ...) opens this box instead: a filter box over the list, and
// typing narrows it to the options whose text (or their group's label) has every typed word in it, anywhere, any
// case ("ak 74" finds "AK-74"). ↑ ↓ (Page Up / Down) move, Enter or a click picks, Esc / Tab / a click outside closes.
//
// The <select> stays the real thing: picking sets its value and fires a bubbling `input` then `change`, exactly as
// the browser would, so main.js's data-action change handlers run unchanged. Nothing is attached to the selects
// themselves: one set of listeners on the document (mousedown and keydown, capture) catches any select, so panels
// rebuilt with innerHTML need nothing done and nothing leaks. data-search="0" on a select keeps it native,
// data-search="1" makes a short one searchable too; multiple / size > 1 / disabled selects are left alone.
//
// Keys: the filter box swallows every key it gets (stopPropagation), so the map's hotkeys never see the typing and
// Esc closes only the box, never the window behind it. While the box is open main.js holds back tick redraws of the
// panel the select is in (searchOpenIn), like a native open drop-down; if the select is rebuilt anyway, the pick
// finds the new one by its data- attributes.
//
// The pure parts (wantsSearch, selectEntries, filterEntries) are tested by tools/selectsearchtest.js with a small DOM.
import { touchRecent } from "./touch.js";
export const MIN_OPTIONS = 8;

let D = null, W = null;           // the document and window (install)
let box = null, input = null, list = null, foot = null;
let src = null;                   // the <select> the box is open for
let srcSig = null;                // how to find it again if it is rebuilt: { attrs, nth }
let entries = [], shownIdx = [], hi = -1; // all options, the indexes into entries shown, the highlighted one (into shownIdx)
let byKeyboard = false;           // opened from the keyboard: the focus goes back to the select on close

// Should this select open the search box?
export function wantsSearch(sel) {
  if (!sel || sel.tagName !== "SELECT" || sel.multiple || sel.disabled || Number(sel.size || 0) > 1) return false;
  const want = sel.dataset ? sel.dataset.search : undefined;
  if (want === "0") return false;
  if (want === "1") return true;
  return (sel.options ? sel.options.length : 0) >= MIN_OPTIONS;
}

// The select's options in order: { i (option index), value, text, group (optgroup label or ""), disabled, selected, title }.
export function selectEntries(sel) {
  const out = [];
  const opts = sel.options || [];
  for (let i = 0; i < opts.length; i++) {
    const o = opts[i];
    const g = o.parentNode && o.parentNode.tagName === "OPTGROUP" ? o.parentNode : null;
    out.push({
      i, value: o.value, text: String(o.textContent || o.label || "").replace(/\s+/g, " ").trim(),
      group: g ? String(g.label || g.getAttribute("label") || "") : "",
      disabled: !!(o.disabled || (g && g.disabled)), selected: i === sel.selectedIndex,
      title: (o.getAttribute && o.getAttribute("title")) || "", // an item's description, shown on hover as before
    });
  }
  return out;
}

// The query's words, lower case.
export const queryTerms = (q) => String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
// The entries whose text or group label holds every word of the query (in the list's own order).
export function filterEntries(list, q) {
  const terms = queryTerms(q);
  if (!terms.length) return list.slice();
  return list.filter((e) => {
    const hay = `${e.text} ${e.group}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

// main.js setHTML: is the box open for a select inside this panel? (tick redraws wait, as for a native drop-down)
export function searchOpenIn(el) {
  return !!(box && src && el && el.contains && el.contains(src));
}
export const searchOpen = () => !!src;

// main.js, once. doc / win default to the page's (the test passes its own).
export function installSelectSearch(doc = globalThis.document, win = globalThis.window) {
  if (!doc || !doc.addEventListener || D === doc) return;
  D = doc; W = win || {};
  box = null; src = null;
  D.addEventListener("mousedown", onDocMouseDown, true);
  D.addEventListener("keydown", onDocKeyDown, true);
  D.addEventListener("scroll", onScroll, true);
  if (W.addEventListener) {
    W.addEventListener("resize", () => { if (src) place(); });
    W.addEventListener("blur", () => closeBox(false));
  }
}

// ---------- the document's listeners ----------
function onDocMouseDown(e) {
  const t = e.target;
  if (box && src && box.contains(t)) return; // the box's own (below)
  const sel = t && t.closest ? t.closest("select") : null;
  if (src) {
    const same = sel && sel === src;
    closeBox(false);
    if (same) { e.preventDefault(); return; } // a second click on the select closes it, as a native one
  }
  if (!sel || (e.button || 0) !== 0 || !wantsSearch(sel)) return;
  if (touchRecent()) return; // a tap: the phone's own picker scrolls and fits better than a box that brings up the keyboard (ui/touch.js)
  e.preventDefault(); // no native list (and no focus: the filter box takes it)
  openBox(sel, "", false);
}

const PRINTABLE = (e) => e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
function onDocKeyDown(e) {
  if (src) return; // the box's input handles its own keys
  const sel = e.target;
  if (!sel || sel.tagName !== "SELECT" || !wantsSearch(sel)) return;
  const open = e.key === "Enter" || e.key === " " || e.key === "F4" || (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp"));
  if (!open && !PRINTABLE(e)) return; // ↑ ↓ on a closed select still step through it natively
  e.preventDefault();
  e.stopPropagation(); // the keys before main.js's text-box guard never see it
  openBox(sel, PRINTABLE(e) && e.key !== " " ? e.key : "", true);
}
function onScroll(e) {
  if (!src) return;
  if (box && e.target && box.contains && box.contains(e.target)) return; // the list scrolling
  place();
}

// ---------- the box ----------
function build() {
  box = D.createElement("div");
  box.className = "ssel hidden";
  box.setAttribute("role", "dialog");
  input = D.createElement("input");
  input.className = "ssel-q";
  input.setAttribute("type", "text");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
  input.setAttribute("placeholder", "Type to filter…");
  input.setAttribute("aria-label", "Filter the list");
  list = D.createElement("div");
  list.className = "ssel-list";
  list.setAttribute("role", "listbox");
  foot = D.createElement("div");
  foot.className = "ssel-foot";
  box.appendChild(input);
  box.appendChild(list);
  box.appendChild(foot);
  D.body.appendChild(box);
  input.addEventListener("input", (e) => { e.stopPropagation(); show(true); }); // main.js's input handlers are for the panels' own boxes
  input.addEventListener("keydown", onInputKey);
  input.addEventListener("keyup", (e) => e.stopPropagation());
  input.addEventListener("keypress", (e) => e.stopPropagation());
  box.addEventListener("mousedown", (e) => {
    e.preventDefault(); // the filter box keeps the focus
    e.stopPropagation(); // nothing behind reacts (main.js's held panel, the map)
  });
  box.addEventListener("click", (e) => {
    e.stopPropagation();
    const row = e.target && e.target.closest ? e.target.closest("[data-ssi]") : null;
    if (row && !row.classList.contains("dis")) pick(Number(row.dataset.ssi));
  });
  box.addEventListener("mousemove", (e) => {
    const row = e.target && e.target.closest ? e.target.closest("[data-ssi]") : null;
    if (!row || row.classList.contains("dis")) return;
    const k = shownIdx.indexOf(Number(row.dataset.ssi));
    if (k >= 0 && k !== hi) { hi = k; mark(); }
  });
}

function onInputKey(e) {
  e.stopPropagation(); // the map's hotkeys and the windows' Esc never see the typing
  const k = e.key;
  if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); step(k === "ArrowDown" ? 1 : -1); }
  else if (k === "PageDown" || k === "PageUp") { e.preventDefault(); step(k === "PageDown" ? 8 : -8, true); }
  else if (k === "Enter") { e.preventDefault(); if (hi >= 0) pick(entries[shownIdx[hi]].i); }
  else if (k === "Escape") { e.preventDefault(); closeBox(true); }
  else if (k === "Tab") { e.preventDefault(); closeBox(true); }
}

function openBox(sel, q, kb) {
  if (!box) build();
  src = sel;
  byKeyboard = kb;
  srcSig = signature(sel);
  entries = selectEntries(sel);
  input.value = q;
  box.classList.remove("hidden");
  show(false);
  place();
  if (input.focus) input.focus({ preventScroll: true });
  if (q && input.setSelectionRange) input.setSelectionRange(q.length, q.length);
}

export function closeBox(refocus) {
  if (!src) return;
  const s = src;
  src = null; srcSig = null; entries = []; shownIdx = []; hi = -1;
  if (box) { box.classList.add("hidden"); list.textContent = ""; }
  if (refocus && byKeyboard && s.isConnected !== false && s.focus) s.focus({ preventScroll: true });
  else if (D && D.activeElement === input && input.blur) input.blur();
}

// typed: the query changed (highlight the first match); else the current value when it is shown.
function show(typed) {
  const q = input.value;
  const keep = new Set(filterEntries(entries, q));
  shownIdx = [];
  entries.forEach((e, k) => { if (keep.has(e)) shownIdx.push(k); });
  const firstOk = shownIdx.findIndex((k) => !entries[k].disabled);
  const cur = typed ? -1 : shownIdx.findIndex((k) => entries[k].selected && !entries[k].disabled);
  hi = cur >= 0 ? cur : firstOk;
  list.textContent = "";
  const terms = queryTerms(q);
  let lastGroup = null;
  for (const k of shownIdx) {
    const e = entries[k];
    if (e.group !== lastGroup) {
      lastGroup = e.group;
      if (e.group) {
        const g = D.createElement("div");
        g.className = "ssel-grp";
        appendMarked(g, e.group, terms);
        list.appendChild(g);
      }
    }
    const row = D.createElement("div");
    row.className = `ssel-opt${e.group ? " ind" : ""}${e.disabled ? " dis" : ""}${e.selected ? " cur" : ""}`;
    row.dataset.ssi = String(e.i);
    row.setAttribute("role", "option");
    if (e.disabled) row.setAttribute("aria-disabled", "true");
    if (e.title) row.setAttribute("title", e.title);
    appendMarked(row, e.text || " ", terms);
    list.appendChild(row);
  }
  if (!shownIdx.length) {
    const none = D.createElement("div");
    none.className = "ssel-none";
    none.textContent = "Nothing matches.";
    list.appendChild(none);
  }
  foot.textContent = `${shownIdx.length === entries.length ? entries.length : `${shownIdx.length} of ${entries.length}`} · ↑ ↓ Enter · Esc`;
  mark();
}
// The text with the first place each typed word appears in bold.
function appendMarked(el, text, terms) {
  const lc = text.toLowerCase();
  const spans = [];
  for (const t of terms) {
    const at = lc.indexOf(t);
    if (at >= 0) spans.push([at, at + t.length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let pos = 0;
  for (const [a0, b] of spans) {
    const a = Math.max(a0, pos);
    if (b <= a) continue;
    if (a > pos) el.appendChild(D.createTextNode(text.slice(pos, a)));
    const m = D.createElement("b");
    m.textContent = text.slice(a, b);
    el.appendChild(m);
    pos = b;
  }
  if (pos < text.length) el.appendChild(D.createTextNode(text.slice(pos)));
}
function mark() {
  const want = hi >= 0 ? String(entries[shownIdx[hi]].i) : null;
  let on = null;
  for (const row of list.children) {
    if (!row.dataset || row.dataset.ssi == null) continue;
    const yes = row.dataset.ssi === want;
    row.classList.toggle("sel", yes);
    if (yes) on = row;
  }
  if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
}
// Moves the highlight by n over the enabled rows (page: stop at the ends instead of wrapping).
function step(n, page) {
  const ok = shownIdx.map((k, j) => (entries[k].disabled ? -1 : j)).filter((j) => j >= 0);
  if (!ok.length) return;
  let at = ok.indexOf(hi);
  if (at < 0) at = n > 0 ? -1 : ok.length;
  let next = at + n;
  next = page ? Math.max(0, Math.min(ok.length - 1, next)) : ((next % ok.length) + ok.length) % ok.length;
  hi = ok[next];
  mark();
}

function pick(i) {
  let sel = src;
  if (sel && sel.isConnected === false) sel = refind(srcSig);
  const was = entries.find((e) => e.i === i);
  closeBox(true);
  if (!sel || !was) return;
  const o = sel.options[i];
  // The select was rebuilt with other options: pick by value, else give up.
  const idx = o && o.value === was.value ? i : [...sel.options].findIndex((x) => x.value === was.value);
  if (idx < 0 || (sel.options[idx] && sel.options[idx].disabled)) return;
  if (idx === sel.selectedIndex) return; // no change, as with a native pick of the same option
  sel.selectedIndex = idx;
  const Ev = W.Event || globalThis.Event;
  sel.dispatchEvent(new Ev("input", { bubbles: true }));
  sel.dispatchEvent(new Ev("change", { bubbles: true }));
}

// A select is known again after a rebuild by its data- attributes (and name / id) and which one of those it is.
function attrsOf(sel) {
  const out = [];
  for (const a of sel.attributes || []) if (a.name.startsWith("data-") || a.name === "name" || a.name === "id") out.push(`${a.name}=${a.value}`);
  return out.sort().join("&");
}
function signature(sel) {
  const attrs = attrsOf(sel);
  const all = [...D.querySelectorAll("select")].filter((s) => attrsOf(s) === attrs);
  return { attrs, nth: all.indexOf(sel) };
}
function refind(sig) {
  if (!sig || !sig.attrs) return null; // a select with nothing to know it by
  const all = [...D.querySelectorAll("select")].filter((s) => attrsOf(s) === sig.attrs);
  return all[sig.nth] || null;
}

// Under the select (above it when there is more room there), at least as wide, kept on screen.
function place() {
  if (!src || !box) return;
  if (src.isConnected === false) { const again = refind(srcSig); if (again) src = again; else { closeBox(false); return; } }
  const r = src.getBoundingClientRect ? src.getBoundingClientRect() : { left: 0, top: 0, bottom: 0, width: 0 };
  const vw = W.innerWidth || 1024, vh = W.innerHeight || 768;
  const rem = parseFloat((W.getComputedStyle && D.documentElement ? W.getComputedStyle(D.documentElement).fontSize : "") || "16") || 16;
  const gap = 2, margin = 4;
  const below = vh - r.bottom - gap - margin, above = r.top - gap - margin;
  const up = below < 14 * rem && above > below;
  const room = Math.max(6 * rem, up ? above : below);
  const width = Math.min(Math.max(r.width, 14 * rem), vw - 2 * margin);
  const left = Math.max(margin, Math.min(r.left, vw - width - margin));
  box.style.left = `${Math.round(left)}px`;
  box.style.minWidth = `${Math.round(width)}px`;
  box.style.maxWidth = `${Math.round(Math.max(width, Math.min(36 * rem, vw - left - margin)))}px`; // long names widen it, never off screen
  box.style.maxHeight = `${Math.round(Math.min(room, 28 * rem))}px`;
  if (up) { box.style.top = ""; box.style.bottom = `${Math.round(vh - r.top + gap)}px`; }
  else { box.style.bottom = ""; box.style.top = `${Math.round(r.bottom + gap)}px`; }
}
