// Drop-downs you can type in (ui/selectsearch.js), headless on a small DOM written here (no browser, no install):
//   - which selects get the box (8+ options, data-search="1" / "0", not multiple, sized or disabled);
//   - the filter: any case, anywhere in the text, every word, the optgroup's label too;
//   - the box: a click on a long select opens it (no native list), typing filters, ↑ ↓ skip disabled rows, Enter or a
//     click picks: the select's value is set and a bubbling input + change reach the document's data-action handler
//     with the right value, once; the same option again fires nothing; disabled rows cannot be picked;
//   - keys: typing, arrows, Enter and Esc in the box never reach the window's hotkey handler; Esc closes only the box
//     (no change); a printable key on a focused long select opens the box with that letter;
//   - re-renders: the panel rebuilt with innerHTML (before opening, and while the box is open: the pick lands on the new
//     select) and no listeners pile up; searchOpenIn holds the panel's tick redraws while open; a click outside closes;
//   - the real screens: the start-gear window's pickers (slots, Add a thing, the vehicle's back), the background
//     editor's and the gun builder's Ammo list get the box, and a typed pick reaches SG_CHANGE with the right item.
// Usage: node tools/selectsearchtest.js
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log(`  FAIL ${msg}`); } return ok; };
const section = (t) => console.log(`== ${t}`);

// ---------- a small DOM ----------
let listenerCount = 0;
class Ev {
  constructor(type, o = {}) {
    Object.assign(this, { type, bubbles: !!o.bubbles, defaultPrevented: false, target: null, currentTarget: null, _stop: false, _stopNow: false }, o);
    this.bubbles = !!o.bubbles;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; this._stopNow = true; }
}
class Target {
  constructor() { this._ls = []; }
  addEventListener(type, fn, opt) { const capture = opt === true || !!(opt && opt.capture); if (this._ls.some((l) => l.type === type && l.fn === fn && l.capture === capture)) return; this._ls.push({ type, fn, capture }); listenerCount++; }
  removeEventListener(type, fn, opt) { const capture = opt === true || !!(opt && opt.capture); const i = this._ls.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture); if (i >= 0) { this._ls.splice(i, 1); listenerCount--; } }
  _fire(e, phase) {
    e.currentTarget = this;
    for (const l of this._ls.slice()) {
      if (l.type !== e.type) continue;
      if (phase === "capture" && !l.capture) continue;
      if (phase === "bubble" && l.capture) continue;
      l.fn.call(this, e);
      if (e._stopNow) return;
    }
  }
  dispatchEvent(e) {
    e.target = this;
    const path = [];
    for (let n = this.parentNode; n; n = n.parentNode) path.push(n);
    if (path.length && path[path.length - 1] === doc) path.push(win);
    for (let i = path.length - 1; i >= 0 && !e._stop; i--) path[i]._fire(e, "capture");
    if (!e._stop) this._fire(e, "target");
    if (e.bubbles) for (let i = 0; i < path.length && !e._stop; i++) path[i]._fire(e, "bubble");
    return !e.defaultPrevented;
  }
}
const decode = (s) => s.replace(/&(#\d+|#x[\da-f]+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (m, c) => {
  if (c[0] === "#") return String.fromCodePoint(c[1] === "x" || c[1] === "X" ? parseInt(c.slice(2), 16) : Number(c.slice(1)));
  return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[c.toLowerCase()];
});
class TextNode extends Target {
  constructor(t) { super(); this.nodeType = 3; this.data = t; this.parentNode = null; }
  get textContent() { return this.data; }
}
const VOID = new Set(["input", "br", "img", "hr", "meta", "link", "wbr", "col", "source"]);
class El extends Target {
  constructor(tag) {
    super();
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.childNodes = []; this.parentNode = null; this.attributes = []; this.style = {};
    this._value = null; this._selected = null; this._sel = -1;
    const self = this;
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === "string" ? self.getAttribute(`data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`) ?? undefined : undefined),
      set: (_, k, v) => { self.setAttribute(`data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, String(v)); return true; },
    });
    this.classList = {
      contains: (c) => self.className.split(/\s+/).includes(c),
      add: (...c) => { const s = new Set(self.className.split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(" "); },
      remove: (...c) => { self.className = self.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(" "); },
      toggle: (c, on) => { const has = self.classList.contains(c); const want = on === undefined ? !has : !!on; if (want && !has) self.classList.add(c); if (!want && has) self.classList.remove(c); return want; },
    };
  }
  getAttribute(n) { const a = this.attributes.find((x) => x.name === n); return a ? a.value : null; }
  setAttribute(n, v) { const a = this.attributes.find((x) => x.name === n); if (a) a.value = String(v); else this.attributes.push({ name: n, value: String(v) }); }
  removeAttribute(n) { this.attributes = this.attributes.filter((x) => x.name !== n); }
  hasAttribute(n) { return this.getAttribute(n) != null; }
  get className() { return this.getAttribute("class") || ""; }
  set className(v) { this.setAttribute("class", v); }
  get id() { return this.getAttribute("id") || ""; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; if (doc && doc.activeElement && (doc.activeElement === n || n.contains && n.contains(doc.activeElement))) doc.activeElement = doc.body; return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  get isConnected() { for (let x = this; x; x = x.parentNode) if (x === doc) return true; return false; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
  set textContent(t) { for (const n of this.childNodes) n.parentNode = null; this.childNodes = []; if (t !== "" && t != null) this.appendChild(new TextNode(String(t))); }
  set innerHTML(html) { this.textContent = ""; parseInto(this, html); }
  closest(sel) { for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (matches(x, sel)) return x; return null; }
  matches(sel) { return matches(this, sel); }
  querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n.children) { if (matches(c, sel)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  getBoundingClientRect() { return { left: 100, top: 200, right: 300, bottom: 224, width: 200, height: 24 }; }
  scrollIntoView() {}
  focus() { doc.activeElement = this; }
  blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
  setSelectionRange() {}
  // form controls
  get disabled() { return this.hasAttribute("disabled"); }
  get multiple() { return this.hasAttribute("multiple"); }
  get size() { return Number(this.getAttribute("size") || 0); }
  get label() { return this.getAttribute("label") ?? this.textContent; }
  get options() { return this.tagName === "SELECT" ? this.querySelectorAll("option") : undefined; }
  get selected() { if (this._selected == null) { const s = this.closest("select"); return !!s && s.options[s.selectedIndex] === this; } return this._selected; }
  get selectedIndex() {
    const o = this.options;
    if (this._sel >= 0 && this._sel < o.length) return this._sel;
    const i = o.findIndex((x) => x.hasAttribute("selected"));
    return i >= 0 ? i : o.length ? 0 : -1;
  }
  set selectedIndex(i) { this._sel = i; }
  get value() {
    if (this.tagName === "SELECT") { const o = this.options[this.selectedIndex]; return o ? o.value : ""; }
    if (this.tagName === "OPTION") return this.getAttribute("value") ?? this.textContent;
    return this._value ?? this.getAttribute("value") ?? "";
  }
  set value(v) {
    if (this.tagName === "SELECT") { this._sel = this.options.findIndex((o) => o.value === String(v)); return; }
    this._value = String(v);
  }
}
// Selectors: one compound (tag, .class, #id, [attr], [attr="v"]), or a comma list of them.
function matches(el, sel) {
  return sel.split(",").some((s) => {
    const m = /^\s*([a-zA-Z][\w-]*)?((?:\.[\w-]+|#[\w-]+|\[[^\]]+\])*)\s*$/.exec(s);
    if (!m) throw new Error(`selector not supported here: ${s}`);
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    for (const p of m[2].match(/\.[\w-]+|#[\w-]+|\[[^\]]+\]/g) || []) {
      if (p[0] === ".") { if (!el.classList.contains(p.slice(1))) return false; }
      else if (p[0] === "#") { if (el.id !== p.slice(1)) return false; }
      else { const a = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(p); if (!a) throw new Error(`selector ${p}`); const v = el.getAttribute(a[1]); if (v == null || (a[2] != null && v !== a[2])) return false; }
    }
    return true;
  });
}
function parseInto(root, html) {
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+|<)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[5] != null) { top().appendChild(new TextNode(decode(m[5]))); continue; }
    if (!m[2]) continue; // a comment
    const tag = m[2].toLowerCase();
    if (m[1]) { // closing: pop to the matching open tag (if any)
      const at = stack.map((n) => n.tagName).lastIndexOf(tag.toUpperCase());
      if (at > 0) stack.length = at;
      continue;
    }
    if (tag === "option" && top().tagName === "OPTION") stack.pop();
    const el = new El(tag);
    for (const a of m[3].matchAll(/([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) el.setAttribute(a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? ""));
    top().appendChild(el);
    if (!VOID.has(tag) && !m[4]) stack.push(el);
  }
}
class Doc extends El {
  constructor() { super("#document"); this.nodeType = 9; }
  createElement(t) {
    const el = new El(t);
    // A canvas draws on a context that does nothing (gun thumbnails in item lists, ui/gunart.js gunThumb: since gun-art2).
    if (String(t).toLowerCase() === "canvas") Object.assign(el, { width: 0, height: 0, getContext: () => new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => ((o[k] = v), true) }), toDataURL: () => "data:image/png;base64," });
    return el;
  }
  createTextNode(t) { return new TextNode(t); }
}
const doc = new Doc();
const win = new Target();
Object.assign(win, { innerWidth: 1920, innerHeight: 1080, Event: Ev, getComputedStyle: () => ({ fontSize: "16px" }) });
doc.documentElement = doc.appendChild(new El("html"));
doc.body = doc.documentElement.appendChild(new El("body"));
doc.activeElement = doc.body;

const press = (target, key, o = {}) => { const e = new Ev("keydown", { bubbles: true, key, ...o }); target.dispatchEvent(e); return e; };
const mouse = (target, type = "mousedown", o = {}) => { const e = new Ev(type, { bubbles: true, button: 0, ...o }); target.dispatchEvent(e); return e; };
const typeIn = (input, text) => { for (const ch of text) { press(input, ch); input.value += ch; input.dispatchEvent(new Ev("input", { bubbles: true })); } };

// ---------- the module ----------
const SS = await import("../src/ui/selectsearch.js");
const { wantsSearch, selectEntries, filterEntries, installSelectSearch, searchOpenIn, searchOpen, MIN_OPTIONS } = SS;

section("Which selects get the box");
{
  const host = doc.body.appendChild(new El("div"));
  const sel = (n, attrs = "") => { host.innerHTML = `<select data-action="x"${attrs}>${Array.from({ length: n }, (_, i) => `<option value="v${i}">Item ${i}</option>`).join("")}</select>`; return host.querySelector("select"); };
  check(MIN_OPTIONS === 8, `the threshold is ${MIN_OPTIONS} options`);
  check(!wantsSearch(sel(MIN_OPTIONS - 1)) && wantsSearch(sel(MIN_OPTIONS)), "7 options stay native, 8 get the box");
  check(wantsSearch(sel(3, ' data-search="1"')) && !wantsSearch(sel(30, ' data-search="0"')), 'data-search="1" opts a short one in, "0" keeps a long one native');
  check(!wantsSearch(sel(30, " multiple")) && !wantsSearch(sel(30, ' size="5"')) && !wantsSearch(sel(30, " disabled")), "multiple, sized and disabled selects are left alone");
  check(!wantsSearch(host) && !wantsSearch(null), "not a select: no");
  host.remove();
}

section("The filter");
{
  const host = doc.body.appendChild(new El("div"));
  host.innerHTML = `<select><option value="">Add a thing…</option><optgroup label="Automatic weapons"><option value="ak">AK-74 · 3.4 kg</option><option value="m4">M4 carbine</option></optgroup>` +
    `<optgroup label="Medical"><option value="band">Bandage kit</option><option value="morph" disabled>Morphine &amp; syringe</option></optgroup><option value="rope">Rope</option></select>`;
  const E = selectEntries(host.querySelector("select"));
  check(E.length === 6 && E[1].group === "Automatic weapons" && E[4].disabled && E[4].text === "Morphine & syringe" && E[0].selected && E[5].group === "", "entries: text, group label, disabled, the selected one");
  const vals = (q) => filterEntries(E, q).map((e) => e.value).join(",");
  check(vals("") === ",ak,m4,band,morph,rope", "empty: everything");
  check(vals("CARB") === "m4" && vals("arbi") === "m4", "any case, anywhere in the text");
  check(vals("ak 74") === "ak" && vals("74 ak") === "ak" && vals("ak 99") === "", "every word, any order");
  check(vals("automatic") === "ak,m4" && vals("medical band") === "band", "the optgroup's label counts");
  check(vals("syringe") === "morph", "disabled options are listed (shown greyed)");
  check(vals("zzz") === "", "no match: nothing");
  host.remove();
}

section("The box: open, filter, pick");
installSelectSearch(doc, win);
installSelectSearch(doc, win); // twice is once
const baseListeners = listenerCount;
const changes = [], hotkeys = [];
doc.addEventListener("change", (e) => { const el = e.target.closest("[data-action]"); if (el) changes.push({ action: el.dataset.action, value: el.value, el }); });
let inputs = 0;
doc.addEventListener("input", (e) => { if (e.target.tagName === "SELECT") inputs++; });
win.addEventListener("keydown", (e) => hotkeys.push(e.key)); // main.js's window keydown: the map hotkeys, Esc closing windows
const afterHandlers = listenerCount;
const modal = doc.body.appendChild(new El("div"));
modal.setAttribute("id", "modal");
const ITEMS = ["Rope", "Rifle scope", "Rifle sling", "Bandage kit", "Morphine", "Duct tape", "Lighter", "Flashlight", "Rifle cleaning kit", "Canned beans"];
const PICKER = `<div class="box"><label>Add <select data-action="sg-item-add" data-slot="pack"><option value="">Add a thing…</option><optgroup label="Tools">` +
  ITEMS.map((t, i) => `<option value="i${i}"${t === "Morphine" || t === "Rifle sling" ? " disabled" : ""}>${t}</option>`).join("") + `</optgroup></select></label><select data-action="short"><option>a</option><option>b</option></select></div>`;
modal.innerHTML = PICKER;
const box = () => doc.body.querySelector(".ssel");
const open = () => !!box() && !box().classList.contains("hidden");
const rows = () => box().querySelectorAll(".ssel-opt");
const hiRow = () => box().querySelector(".ssel-opt.sel");
const input = () => box().querySelector(".ssel-q");
{
  const sel = modal.querySelector('select[data-action="sg-item-add"]');
  const e = mouse(sel);
  check(e.defaultPrevented && open(), "a click on a long select opens the box (the native list is stopped)");
  check(doc.activeElement === input() && input().value === "", "the filter box has the focus, empty");
  check(rows().length === 11 && box().querySelectorAll(".ssel-grp").length === 1 && box().querySelector(".ssel-grp").textContent === "Tools", "every option listed, under its group's heading");
  check(hiRow() && hiRow().dataset.ssi === "0" && hiRow().classList.contains("cur"), "the current value is highlighted");
  check(searchOpen() && searchOpenIn(modal) && !searchOpenIn(doc.body.appendChild(new El("div"))), "searchOpenIn: the panel holding the select waits for tick redraws");
  typeIn(input(), "RIF");
  check(rows().length === 3 && rows().every((r) => /rif/i.test(r.textContent)), `typing "RIF" leaves the three rifle things (${rows().map((r) => r.textContent).join(" / ")})`);
  check(rows()[1].classList.contains("dis") && hiRow().textContent === "Rifle scope", "the first enabled match is highlighted, the disabled one greyed");
  check(rows()[0].querySelector("b") && rows()[0].querySelector("b").textContent === "Rif", "the typed part is marked");
  check(/3 of 11/.test(box().querySelector(".ssel-foot").textContent), "the footer counts the matches");
  check(hotkeys.length === 0, `no key reached the window's hotkeys while typing (${hotkeys.join(" ")})`);
  press(input(), "ArrowDown");
  check(hiRow().textContent === "Rifle cleaning kit", "↓ skips the disabled row");
  press(input(), "ArrowDown");
  check(hiRow().textContent === "Rifle scope", "and wraps round");
  press(input(), "ArrowUp");
  press(input(), "Enter");
  check(!open() && changes.length === 1 && changes[0].action === "sg-item-add" && changes[0].value === "i8" && sel.value === "i8", `Enter picks: the select's value set and one change for data-action (${JSON.stringify(changes.map((c) => c.value))})`);
  check(inputs === 1, "an input event first, as the browser sends");
  check(hotkeys.length === 0, "↑ ↓ Enter never reached the window");
  mouse(sel);
  check(open() && hiRow().textContent === "Rifle cleaning kit", "opened again: the new value is highlighted");
  press(input(), "Enter");
  check(!open() && changes.length === 1, "picking the same option again changes nothing");
}

section("Mouse, disabled rows, Esc, outside clicks");
{
  const sel = modal.querySelector('select[data-action="sg-item-add"]');
  mouse(sel);
  typeIn(input(), "morph");
  const dis = rows()[0];
  check(rows().length === 1 && dis.classList.contains("dis") && !hiRow(), "only a disabled match: nothing highlighted");
  mouse(dis); mouse(dis, "click");
  press(input(), "Enter");
  check(open() && changes.length === 1, "a disabled row cannot be picked (click or Enter)");
  input().value = ""; input().dispatchEvent(new Ev("input", { bubbles: true }));
  typeIn(input(), "duct");
  const md = mouse(rows()[0]);
  check(md.defaultPrevented && doc.activeElement === input(), "a mousedown on a row keeps the focus in the filter box");
  mouse(rows()[0], "click");
  check(!open() && changes.length === 2 && changes[1].value === "i5" && sel.value === "i5", "a click picks (Duct tape)");
  mouse(sel);
  typeIn(input(), "bean");
  const esc = press(input(), "Escape");
  check(!open() && esc.defaultPrevented && !hotkeys.includes("Escape") && changes.length === 2 && sel.value === "i5", "Esc closes the box only: the window never sees it, no change");
  mouse(sel);
  mouse(modal.querySelector(".box"));
  check(!open() && changes.length === 2, "a click outside closes it, no change");
  mouse(sel);
  const again = mouse(sel);
  check(!open() && again.defaultPrevented, "a second click on the select closes it");
  const short = modal.querySelector('select[data-action="short"]');
  const se = mouse(short);
  check(!se.defaultPrevented && !open(), "a short select keeps its native list");
}

section("Keys on a focused select");
{
  const sel = modal.querySelector('select[data-action="sg-item-add"]');
  sel.focus();
  const k = press(sel, "f");
  check(k.defaultPrevented && open() && input().value === "f" && doc.activeElement === input(), "a letter on a focused long select opens the box with it typed");
  check(!hotkeys.includes("f"), "and the window's hotkeys never get it");
  typeIn(input(), "las");
  check(rows().length === 1 && hiRow().textContent === "Flashlight", "filters as typed (Flas)");
  press(input(), "Escape");
  check(!open() && doc.activeElement === sel, "Esc: back to the select (opened from the keyboard)");
  const down = press(sel, "ArrowDown");
  check(!down.defaultPrevented && !open(), "↓ on a closed select is left to the browser");
  const sp = press(sel, " ");
  check(open() && input().value === "", "Space opens it empty");
  press(input(), "Tab");
  check(!open(), "Tab closes it");
  sel.blur();
}

section("Re-renders");
{
  modal.innerHTML = PICKER; // the panel rebuilt (main.js setHTML)
  const sel = modal.querySelector('select[data-action="sg-item-add"]');
  mouse(sel);
  typeIn(input(), "lighter");
  press(input(), "Enter");
  check(changes.length === 3 && changes[2].el === sel && changes[2].value === "i6", "a rebuilt panel's new select works at once");
  // Rebuilt while the box is open (a redraw the hold did not stop): the pick goes to the new select.
  mouse(sel);
  typeIn(input(), "canned");
  modal.innerHTML = PICKER.replace(' data-action="short"', ' data-action="short2"');
  const fresh = modal.querySelector('select[data-action="sg-item-add"]');
  check(fresh !== sel && !sel.isConnected, "the select was replaced under the open box");
  mouse(rows()[0], "click");
  check(changes.length === 4 && changes[3].el === fresh && changes[3].value === "i9" && fresh.value === "i9", "the pick lands on the new select, with the right value");
  // Two selects alike (same data- attributes): the right one of them is found again.
  modal.innerHTML = PICKER + PICKER;
  const second = modal.querySelectorAll('select[data-action="sg-item-add"]')[1];
  mouse(second);
  typeIn(input(), "rope");
  modal.innerHTML = PICKER + PICKER;
  press(input(), "Enter");
  const now = modal.querySelectorAll('select[data-action="sg-item-add"]');
  check(changes.length === 5 && changes[4].el === now[1] && now[0].value === "" && now[1].value === "i0", "of two alike, the second is found again");
  for (let i = 0; i < 50; i++) { modal.innerHTML = PICKER; const s = modal.querySelector("select"); mouse(s); typeIn(input(), "r"); press(input(), "Escape"); }
  check(doc.body.querySelectorAll(".ssel").length === 1, "one box, built once");
  const box0 = listenerCount;
  for (let i = 0; i < 50; i++) { modal.innerHTML = PICKER; const s = modal.querySelector("select"); mouse(s); press(input(), "Escape"); }
  check(listenerCount === box0, `50 more rebuilds and opens add no listeners (${listenerCount - baseListeners} besides the install's)`);
  check(!searchOpenIn(modal) && !searchOpen(), "closed: no hold on the panel");
}

// ---------- the real screens ----------
section("The real screens");
{
  globalThis.document = doc; // the gun builder's art draws on stub canvases
  const { createWorld } = await import("../src/sim/world.js");
  const { startGearEditor, SG_ACTIONS, SG_CHANGE } = await import("../src/ui/startgear.js");
  const st = createWorld({ seed: 42, factionCount: 5, crew: [{ points: true }] });
  const ui = { started: false, freeEdit: true, ironman: false, worldSize: "normal", factionCount: 5 };
  SG_ACTIONS["sg-open"](st, ui, { id: st.survivors[0].id });
  modal.innerHTML = startGearEditor(st, ui);
  const sels = modal.querySelectorAll("select");
  const census = sels.map((s) => `${s.dataset.action}${s.dataset.slot ? `:${s.dataset.slot}` : ""} ${s.options.length}${wantsSearch(s) ? "*" : ""}`);
  console.log(`  start gear: ${census.join(", ")}  (* gets the box)`);
  const add = modal.querySelector('select[data-action="sg-item-add"]');
  check(add && wantsSearch(add), `Add a thing… gets the box (${add ? add.options.length : 0} options)`);
  const trunk = modal.querySelector('select[data-action="sg-trunk-add"]');
  check(!trunk || wantsSearch(trunk) || trunk.disabled, "the vehicle's back gets it");
  check(modal.querySelectorAll('select[data-action="sg-slot"]').filter(wantsSearch).length >= 3, "the long slot pickers get it");
  // A typed pick through the real change handler.
  const SG_SEEN = [];
  const h = (e) => { const el = e.target.closest("[data-action]"); if (el && SG_CHANGE[el.dataset.action]) SG_SEEN.push(SG_CHANGE[el.dataset.action](st, ui, el) !== false ? el.value : null); };
  doc.addEventListener("change", h);
  mouse(add);
  typeIn(input(), "bandage");
  const want = rows().find((r) => !r.classList.contains("dis"));
  const wantVal = want ? add.options[Number(want.dataset.ssi)].value : null;
  press(input(), "Enter");
  const carried = JSON.stringify(st.survivors[0].startGear || {});
  check(wantVal && SG_SEEN[0] === wantVal && carried.includes(`"${wantVal}"`), `typing "bandage" + Enter: SG_CHANGE adds ${wantVal} to the carried list`);
  doc.removeEventListener("change", h);
  mouse(add);
  const titled = rows().filter((r) => r.getAttribute("title"));
  check(titled.length > 100, `the items' descriptions stay on hover (${titled.length} rows with one)`);
  press(input(), "Escape");

  const { backgroundEditor, BG_ACTIONS, setCustomLibrary } = await import("../src/ui/backgrounds.js");
  setCustomLibrary([]);
  const bst = createWorld({ seed: 8, factionCount: 5 });
  const bui = { started: false, ironman: false };
  BG_ACTIONS["bg-open"](bst, bui);
  BG_ACTIONS["bg-new"](bst, bui);
  modal.innerHTML = backgroundEditor(bst, bui);
  const bsels = modal.querySelectorAll("select");
  console.log(`  backgrounds: ${bsels.map((s) => `${s.dataset.action}${s.dataset.slot ? `:${s.dataset.slot}` : ""} ${s.options.length}${wantsSearch(s) ? "*" : ""}`).join(", ")}`);
  check(bsels.filter(wantsSearch).length >= 3 && wantsSearch(modal.querySelector('select[data-action="bg-copy"]')), "the background editor's item and preset pickers get it");

  const GB = await import("../src/ui/gunbuilder.js");
  const html = GB.loadChoices({ key: "ar" }).length ? `<select data-action="gb-load" data-search="1">${GB.loadChoices({ key: "ar" }).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>` : "";
  const gsrc = (await import("node:fs")).readFileSync(new URL("../src/ui/gunbuilder.js", import.meta.url), "utf8");
  modal.innerHTML = html;
  check(/<select data-action="gb-load" data-search="1"[>$]/.test(gsrc) && wantsSearch(modal.querySelector("select")), `the gun builder's Ammo list (${GB.loadChoices({ key: "ar" }).length} options) opts in`); // [>$]: "disabled" in a fight may follow
  modal.innerHTML = "";
}

section("Styles and wiring");
{
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  check(/\.ssel \{[^}]*position: fixed;[^}]*z-index: 60;[^}]*var\(--panel\)/.test(css) && /\.ssel \.ssel-opt\.dis/.test(css) && /\.ssel \.ssel-opt\.sel/.test(css), "the box's CSS: fixed over the windows, the theme's colours, rem sizes");
  const z = [...css.matchAll(/#crash \{[^}]*z-index: (\d+)/g)].map((m) => Number(m[1]))[0];
  check(z > 60, "the crash screen stays above it");
  check(/installSelectSearch\(\)/.test(main) && /if \(searchOpenIn\(el\)\) return true;/.test(main), "main.js installs it once and holds tick redraws while it is open");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
