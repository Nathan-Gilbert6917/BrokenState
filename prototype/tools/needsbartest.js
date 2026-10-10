// The top bar's Needs button (ui/needsbar.js): the per-supply chips folded into one button with a dot, a count of the
// low ones and the most urgent; its drop-down lists every supply (icon, name, amount, trend, days left) with the
// critical ones first; the road team's list with no base; and opening and closing it (hover, click, focus, Esc, a
// click elsewhere) on a stand-in for the page.
// Usage: node tools/needsbartest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { STOCK_KEYS } from "../src/sim/data.js";
import { RAW } from "../src/sim/water.js";
import { topbarParts, renderTopbar } from "../src/ui/ui.js";
import { needsBar, baseNeeds, sortNeeds, needsSummary, initNeedsBar, NEEDS_ICON } from "../src/ui/needsbar.js";

const SEED = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(t);
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ data: new Uint8ClampedArray(4) })), set: (t, k, v) => ((t[k] = v), true) });
globalThis.document = globalThis.document || { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, toDataURL: () => "data:image/png;base64," }) };
const mk = (opts = {}) => { const st = createWorld({ seed: SEED, factionCount: 5, ...opts }); st.started = true; st.visitorsOff = true; return st; };
const rowOf = (html, k) => (new RegExp(`<div class="nb-row ([^"]*)" data-k="${k}"[^>]*>(.*?)</div>`).exec(html) || []);
const shown = STOCK_KEYS.filter((k) => k !== "jars" && k !== RAW && k !== "arrows");

section("The bar: one Needs button, the list behind it");
{
  const st = mk(), h = hub(st);
  const tb = topbarParts(st, { speed: 1 });
  check(/class="nb-btn"/.test(tb.stock) && /id="nb-panel"/.test(tb.stock) && /id="nb-list"/.test(tb.stock), "the stock slot is the Needs button and its panel");
  check(!/<b>Food<\/b>/.test(tb.stock) && !/<b>Fuel<\/b>/.test(tb.stock), "no row of per-supply chips on the bar any more");
  check(/aria-haspopup="true"/.test(tb.stock) && /aria-expanded="false"/.test(tb.stock), "the button says it opens a panel, closed to start with");
  check(tb.needs && typeof tb.needs.btn === "string" && typeof tb.needs.list === "string" && !Object.keys(tb).includes("needs"), "main.js gets the button, head and list as slots (not one of the bar's strings)");
  check(shown.every((k) => rowOf(tb.stock, k).length), `a row for every supply (${shown.length}: ${shown.join(", ")})`);
  check(!rowOf(tb.stock, "jars").length && !rowOf(tb.stock, "arrows").length && !rowOf(tb.stock, RAW).length, "no rows for jars, arrows (in Ammo) or raw water (in Water)");
  check(shown.every((k) => (rowOf(tb.stock, k)[2] || "").includes(NEEDS_ICON[k])), "each row has its icon");
  const food = rowOf(tb.stock, "food")[2] || "";
  check(new RegExp(`<span class="nb-amt">${Math.floor(h.stock.food)}<`).test(food) && /<span class="nb-note">(\d+d|<1d|99\+d|∞)<\/span>/.test(food), `Food: the amount and the days left (${food.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()})`);
  check(renderTopbar(st, { speed: 1 }).includes('id="nb-btn"'), "the whole bar as one string has it too");
}

section("Urgency: colours, the critical first, the button's summary");
{
  const st = mk(), h = hub(st);
  Object.assign(h.stock, { food: 0, preserved: 5000, water: 5000, [RAW]: 0, wood: 50000, fuel: 200, meds: 50 });
  for (const k of Object.keys(h.stock)) if (k.startsWith("a_")) h.stock[k] = 0;
  h.stock.a_9mm_fmj = 5000; h.stock.a_12ga_buck = 5000; h.stock.a_556_fmj = 5000; h.stock.a_308_fmj = 5000; h.stock.a_22lr = 5000; h.stock.arrows = 2000;
  let rows = baseNeeds(st, h);
  const lv = (k) => (rows.find((r) => r.k === k) || {}).level;
  check(lv("food") === 0, `plenty of preserved food (no cellar needed): fine (${lv("food")})`);
  check(lv("meds") === 0, `plenty of meds: fine (${lv("meds")})`);
  check(lv("scrap") == null && lv("parts") == null, "scrap and parts: a count only, no outlook");
  h.stock.water = 0; h.stock[RAW] = 0;
  h.stock.food = 2; h.stock.preserved = 0;
  h.stock.meds = 0;
  rows = baseNeeds(st, h);
  check(lv("food") === 2, `2 food for ${atBase(st, h.id).length} people: critical`);
  const w = rows.find((r) => r.k === "water");
  check(w.level === 2 || (w.level >= 1 && (w.note.endsWith("/d") || w.note === "unsafe")), `no water: critical while it drains, else low and why (${w.level} ${w.note})`);
  const sorted = sortNeeds(rows);
  const rank = (r) => (r.level == null ? -1 : r.level);
  check(sorted.every((r, i) => i === 0 || rank(sorted[i - 1]) >= rank(r)), `critical first, then low, fine, the counts (${sorted.map((r) => `${r.k}:${r.level}`).join(" ")})`);
  const sum = needsSummary(rows);
  check(sum.level === 2 && sum.crit >= 1 && sum.worst && sum.worst.level === 2, `the summary: ${sum.crit} critical, ${sum.low} low, worst ${sum.worst && sum.worst.name}`);
  const nb = needsBar(st, h);
  check(/class="nb-dot nb-crit"/.test(nb.btn) && new RegExp(`class="nb-badge nb-crit"[^>]*>${sum.crit + sum.low}<`).test(nb.btn), "the button: a red dot and the count of the low ones");
  check(nb.btn.includes(`${sum.worst.name}`) && /class="nb-worst nb-crit"/.test(nb.btn), `and the most urgent (${nb.btn.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()})`);
  check(nb.list.indexOf(`data-k="${sorted[0].k}"`) < nb.list.indexOf('data-k="scrap"'), "the list in that order");
  check(/class="nb-counts small"><span class="nb-crit">\d+ critical/.test(nb.head), "the panel's head counts them");
  check(/data-action="openbase"/.test(nb.list) && /data-action="ld-open"/.test(nb.list), "Open base and the Ledger from the panel");
  // The same base again: the same strings (main.js writes nothing, nothing flickers).
  check(needsBar(st, h).list === nb.list && needsBar(st, h).btn === nb.btn, "unchanged stock: the same HTML (no rewrite)");
  h.stock.scrap = (h.stock.scrap || 0) + 7;
  check(needsBar(st, h).list !== nb.list && needsBar(st, h).btn === nb.btn, "a count changes: only the list's string changes");
}

section("No base: the road team's list");
{
  const hc = createWorld({ seed: SEED, factionCount: 5, mode: "hardcore" });
  const tb = topbarParts(hc, { speed: 1 });
  check(!hub(hc) && /On the road/.test(tb.needs.btn), "hardcore before the first hub: the button says On the road");
  check(["food", "water", "scrap", "parts", "ammo", "meds"].every((k) => rowOf(tb.stock, k).length), "and lists what the team carries");
  check(/No camp yet/.test(tb.needs.list), "and the camp still to set up");
  const lost = mk();
  lost.bases.length = 0;
  lost.parties = lost.parties.filter((p) => p.owner !== "player");
  let ok = true, html = "";
  try { html = topbarParts(lost, { speed: 1 }).stock; } catch (e) { ok = false; html = String(e); }
  check(ok && /No base/.test(html), "no base and no team: a red No base, no crash");
}

section("Opening and closing (a stand-in for the page)");
{
  const mkEl = (cls) => ({ cls, attrs: {}, closest: (sel) => (sel === `.${cls}` ? el.btn : null), setAttribute(k, v) { this.attrs[k] = v; }, blur() { doc.activeElement = null; }, focus() { doc.activeElement = this; root.fire("focusin", { target: this }); } });
  const handlers = {}, docH = {}, winH = {};
  const classes = new Set();
  const root = {
    dataset: {}, classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    addEventListener: (t, f) => (handlers[t] = f), fire: (t, e) => handlers[t] && handlers[t](e),
    contains: (x) => x === el.btn || x === el.row, querySelector: (s) => (s === ".nb-btn" ? el.btn : null),
  };
  const el = {};
  el.btn = mkEl("nb-btn");
  el.row = { closest: () => null };
  const outside = { closest: () => null };
  const doc = { activeElement: null, addEventListener: (t, f) => (docH[t] = f) };
  const win = { addEventListener: (t, f) => (winH[t] = f) };
  initNeedsBar(root, doc, win);
  initNeedsBar(root, doc, win); // twice: still one set of listeners
  const open = () => classes.has("nb-open");
  root.fire("mouseenter");
  check(open() && el.btn.attrs["aria-expanded"] === "true", "hover opens it");
  root.fire("mouseleave");
  await new Promise((r) => setTimeout(r, 60));
  root.fire("mouseenter"); // back onto the panel within the moment
  await new Promise((r) => setTimeout(r, 300));
  check(open(), "crossing to the panel keeps it open");
  root.fire("mouseleave");
  await new Promise((r) => setTimeout(r, 300));
  check(!open() && el.btn.attrs["aria-expanded"] === "false", "leaving closes it");
  root.fire("mouseenter");
  root.fire("click", { target: el.btn, detail: 1 });
  root.fire("mouseleave");
  await new Promise((r) => setTimeout(r, 300));
  check(open(), "a click pins it open (a tap on a touch screen too)");
  root.fire("click", { target: el.btn, detail: 1 });
  check(!open(), "a second click closes it");
  root.fire("click", { target: el.btn, detail: 1 });
  docH.pointerdown({ target: outside });
  check(!open(), "a click elsewhere closes it");
  el.btn.focus();
  check(open(), "the keyboard: focus opens it");
  let stopped = false, prevented = false;
  winH.keydown({ code: "Escape", preventDefault: () => (prevented = true), stopImmediatePropagation: () => (stopped = true) });
  check(!open() && stopped && prevented && doc.activeElement === el.btn, "Esc closes it (not the menu) and leaves the focus on the button");
  stopped = false;
  winH.keydown({ code: "Escape", preventDefault: () => {}, stopImmediatePropagation: () => (stopped = true) });
  check(!stopped, "Esc with it shut goes on to the game (the menu)");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
