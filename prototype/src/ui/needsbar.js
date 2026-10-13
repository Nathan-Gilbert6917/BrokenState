// The top bar's Needs button (2026-10-10, user request: "Improve the top bar, it is cluttered with the # of items per
// type like Food Water Fuel Meds etc. Create a Needs part and when you hover over it, it shows a scroll list of each
// item #."). One compact button says how the hub's stores stand at a glance: a dot (green all fine, amber something
// low, red something critical), how many are low and the most urgent one ("Water 2d"). Hovering it, clicking it or
// tabbing to it opens a drop-down with every supply: icon, name, amount, trend, days left, coloured by urgency, the
// critical ones first. The list scrolls; it stays open while the mouse is over it and closes on leaving, Esc or a
// click elsewhere. main.js writes the button, the head and the list as slots of their own (setHTML compares the
// strings), so the panel updates live without being rebuilt around the mouse, the focus or the scroll position.
// Every base (2026-10-13, user request: "have a way to see the needs for each base not just the hub"): with more than
// one base the panel has a chip for each (its own dot: how its stores stand) and shows the one picked (ui.needsBase,
// the hub by default); the button speaks for the base picked. Food is counted in food value (sim/foods.js: a meal is
// 1.00, three a day; ui/food.js mealLine).
import { SUPPLIES, STOCK_KEYS, supWeight } from "../sim/data.js";
import { foodOutlook, waterOutlook } from "../sim/economy.js";
import { atBase } from "../sim/world.js";
import { RAW } from "../sim/water.js";
import { baseWater } from "../sim/worm.js";
import { baseAmmo, baseAmmoBreakdown, breakdownText } from "../sim/ammo.js";
import { foodLine, waterLine, woodLine } from "./farming.js";
import { illnessSummary } from "./health.js";
import { stockChipTrend } from "./ledger.js";
import { roadNeeds } from "./hardcore.js";
import { foodIn } from "../sim/foods.js"; // days of food, every kind
import { foodTipText, mealLine } from "./food.js"; // the Food row's tooltip; food value and the meals
import { fvIn } from "../sim/foods.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const n1 = (v) => (Math.round((v || 0) * 10) / 10).toString();
const dd = (d) => (!isFinite(d) ? "∞" : d >= 99 ? "99+d" : d < 1 ? "<1d" : `${Math.floor(d)}d`);

export const NEEDS_ICON = { food: "🥫", water: "💧", fuel: "⛽", wood: "🪵", meds: "✚", ammo: "⁍", parts: "⚙", scrap: "🔩", carparts: "🛞", gunparts: "🔧", electronics: "🔌", buildmat: "🧱" };
// Urgency: 2 critical (red), 1 low (amber), 0 fine (green), null no outlook (a count only, grey).
export const LEVEL_CLS = { 2: "nb-crit", 1: "nb-low", 0: "nb-ok" };
// The thresholds (days left, rounds a head): food as the Bases tab colours it (farming.js foodLine), water as the
// alerts warn (ui/alerts.js: under 3 days), ammo by the defence rule (world.js armedFactor: under 3 a head the guns
// count 70%).
export const NEEDS_AT = { foodCrit: 7, foodLow: 20, waterCrit: 3, waterLow: 10, ammoCrit: 3, ammoLow: 10, medsLow: 2 };

// The rows for a base: { k, name, amt, extra, note, level, tip, tr }.
export function baseNeeds(state, h) {
  const heads = atBase(state, h.id).length;
  const rows = [];
  // Food (sim/foods.js): one row, the days of food of every kind (no generic food, no preserved stock of its own).
  for (const k of ["food", ...STOCK_KEYS]) {
    if (k === "jars" || k === RAW || k === "arrows") continue;
    const tr = stockChipTrend(state, h, k);
    const r = { k, name: k === "food" ? "Food (FV)" : k === "water" ? "Water" : SUPPLIES[k].name, amt: k === "food" ? n0(fvIn(h.stock)) : n0(h.stock[k]), extra: "", note: "", level: null, tip: "", tr };
    let base = k === "food" ? "" : `${SUPPLIES[k].name} at ${h.name}. Weight ${supWeight(k)} each; what it fetches depends on who you trade with.`;
    if (k === "food") {
      const o = foodOutlook(state, h), ln = foodLine(state, h);
      r.level = o.daysLeft < NEEDS_AT.foodCrit ? 2 : o.daysLeft < NEEDS_AT.foodLow || o.store.outside >= 1 ? 1 : 0;
      // The days it lasts at today's eating (foodOutlook: everyone fed here, spoiling, the kitchens); the amount is in
      // rations (one person's food for a day), so 12 rations for 2 people read 6d. Food that does not last a whole day
      // still feeds today: 1d, not "<1d" (INV-04); empty stores 0d.
      r.note = !(o.stock > 0.05) ? (isFinite(o.daysLeft) ? "0d" : dd(o.daysLeft)) : o.daysLeft < 1 ? "1d" : dd(o.daysLeft);
      const ml = mealLine(state, h);
      r.extra = `${n1(ml.day)}/d`;
      base = `${ml.tip} Food: ${n1(o.stock)} rations (one ration is a person's food for a day) for ${o.heads} ${o.heads === 1 ? "person" : "people"} eating ${n1(o.eat)} a day${o.spoil > 0.05 ? `, ${n1(o.spoil)} a day spoiling` : ""}${o.used > 0.05 ? `, ${n1(o.used)} a day into the stations` : ""}: ${isFinite(o.daysLeft) ? `about ${n1(o.daysLeft)} days` : "it keeps up"}. ${foodTipText(state, h, ln)} Empty jars: ${n0(h.stock.jars)}.`;
    } else if (k === "water") {
      const o = waterOutlook(state, h), ln = waterLine(state, h), safe = baseWater(state, h).safe;
      const raw = Math.floor(Math.max(0, h.stock[RAW] || 0));
      r.level = o.daysLeft < NEEDS_AT.waterCrit ? 2 : o.daysLeft < NEEDS_AT.waterLow || !safe ? 1 : 0;
      r.note = isFinite(o.daysLeft) ? dd(o.daysLeft) : !safe ? "unsafe" : `${o.net >= 0 ? "+" : ""}${n1(o.net)}/d`;
      if (raw > 0) r.extra = `+${raw} raw`;
      base = `Water at ${h.name}: ${n0(h.stock.water)} purified (safe to drink) and ${raw} un-purified (from the wells, rivers and rain: safe only once the boiler, the filters or a shelter's fire purify it). People drink purified water first. Weight 1 each.${safe ? "" : " The water here is not safe: un-purified water carries the worm."} ${ln.tip}`;
    } else if (k === "wood") {
      const ln = woodLine(state, h);
      r.level = ln.cls === "danger" ? 2 : ln.cls === "good" ? 0 : 1;
      r.note = ln.short;
      base += ` ${ln.tip}`;
    } else if (k === "fuel") {
      if (h.cold && heads) { r.level = 2; r.note = "cold"; base += " Out of firewood and fuel: everyone here is cold."; }
    } else if (k === "meds") {
      const ill = illnessSummary(state, h);
      r.level = ill.noMeds ? 2 : (h.stock.meds || 0) < Math.max(NEEDS_AT.medsLow, ill.ill + ill.worm) ? 1 : 0;
      r.note = ill.ill + ill.worm ? `${ill.ill + ill.worm} sick` : r.level === 1 ? "low" : "";
      if (ill.ill + ill.worm) base += ` ${ill.ill + ill.worm} ${ill.ill + ill.worm === 1 ? "person" : "people"} here need treatment.`;
    } else if (k === "ammo") {
      const abd = baseAmmoBreakdown(state, h), fit = baseAmmo(state, h);
      r.amt = n0(abd.total);
      if (heads) {
        const per = fit / heads;
        r.level = per < NEEDS_AT.ammoCrit ? 2 : per < NEEDS_AT.ammoLow ? 1 : 0;
        r.note = `${Math.floor(per)}/head`;
      }
      base = `Ammo at ${h.name}: every round of every calibre and every arrow and bolt, in the stores and in your people's pockets and packs there (a gun fires only its own calibre, a bow or crossbow only arrows). By calibre, most first: ${breakdownText(abd, "; ")}. ${n0(fit)} rounds fit the guns here${heads ? ` (${Math.floor(fit / heads)} a head; under ${NEEDS_AT.ammoCrit} a head the guns count 70% in a defence)` : ""}.`;
    }
    r.tip = `${base}${tr.tip}`;
    rows.push(r);
  }
  return rows;
}

// Critical first, then low, then fine, then the plain counts; the stores' own order within each.
export function sortNeeds(rows) {
  const rank = (r) => (r.level == null ? -1 : r.level);
  return rows.map((r, i) => [r, i]).sort((a, b) => rank(b[0]) - rank(a[0]) || a[1] - b[1]).map(([r]) => r);
}
export function needsSummary(rows) {
  const crit = rows.filter((r) => r.level === 2).length, low = rows.filter((r) => r.level === 1).length;
  const worst = sortNeeds(rows).find((r) => r.level >= 1) || null;
  return { crit, low, level: crit ? 2 : low ? 1 : 0, worst };
}

const rowHTML = (r) => {
  const tr = r.tr || { arrow: "", attr: "" };
  return `<div class="nb-row ${LEVEL_CLS[r.level] || "nb-plain"}" data-k="${r.k}"${tip(r.tip)}${tr.attr || ""}><span class="nb-ic" aria-hidden="true">${NEEDS_ICON[r.k] || "•"}</span><span class="nb-name">${esc(r.name)}</span><span class="nb-amt">${r.amt}${r.extra ? `<small> ${esc(r.extra)}</small>` : ""}</span><span class="nb-tr">${tr.arrow || ""}</span><span class="nb-note">${esc(r.note)}</span></div>`;
};

// The base the panel shows: ui.needsBase when it is still one of your bases, else the hub.
export function needsBase(state, ui, hub) {
  const id = ui && ui.needsBase;
  const b = id != null ? (state.bases || []).find((x) => String(x.id) === String(id)) : null;
  return b || hub || null;
}
// One chip a base (only with more than one): its name, its dot.
function baseChips(state, picked) {
  const list = state.bases || [];
  if (list.length < 2) return "";
  const chips = list.map((b) => {
    const sum = needsSummary(baseNeeds(state, b));
    const n = sum.crit + sum.low;
    const t = `${b.name}${b.type === "hub" ? " (the hub)" : ""}: ${sum.crit ? `${sum.crit} critical` : ""}${sum.crit && sum.low ? ", " : ""}${sum.low ? `${sum.low} low` : ""}${n ? "" : "nothing low"}${sum.worst ? ` (worst: ${sum.worst.name}${sum.worst.note ? ` ${sum.worst.note}` : ""})` : ""}. Click to see its stores.`;
    return `<button type="button" class="nb-chip${b === picked ? " active" : ""}" data-action="nb-base" data-id="${b.id}" aria-pressed="${b === picked}"${tip(t)}><span class="nb-dot ${LEVEL_CLS[sum.level]}" aria-hidden="true"></span>${b.type === "hub" ? "🏠 " : ""}${esc(b.name)}${n ? ` <small>${n}</small>` : ""}</button>`;
  });
  return `<div class="nb-bases" role="group" aria-label="Bases">${chips.join("")}</div>`;
}
export const NB_ACTIONS = { "nb-base": (state, ui, d) => { ui.needsBase = d && d.id != null ? d.id : null; } };

// The three slots (main.js writes each on its own) and the whole thing as one string (renderTopbar, tests).
// hub: the base to show (needsBase picks it: the hub unless another is picked).
export function needsBar(state, hub) {
  let rows = [], title = "", status = null, foot = "", empty = "", chips = "";
  if (hub) {
    rows = baseNeeds(state, hub);
    title = `${esc(hub.name)} stores`;
    chips = baseChips(state, hub);
    foot = `<button class="mini" data-action="openbase" data-id="${hub.id}" data-tab="farming"${tip(`Open ${hub.name}'s Farming tab: food, water, firewood and the upkeep`)}>Open base</button><button class="mini" data-action="ld-open"${tip("Ledger: production and use of every resource day by day")}>📈 Ledger</button>`;
  } else {
    const road = roadNeeds(state);
    if (road) {
      rows = road.rows.map((r) => ({ ...r, tr: null }));
      title = "The road team carries";
      status = road.status;
      foot = `<span class="muted small"${tip(road.camp.tip)}>${esc(road.camp.text)}</span>`;
    } else {
      status = { cls: "danger", text: "No base", tip: "You have no base left: your people are a team on the road. Establish base (a camp you build up into your hub) or take a base back (Assault their base)." };
      title = "No base";
      empty = `<div class="nb-empty danger">No base: on the road. Establish base or take a base back.</div>`;
    }
  }
  const sum = needsSummary(rows);
  const lvl = status && !rows.length ? 2 : sum.level;
  const w = sum.worst;
  const label = status ? `<span class="nb-status ${status.cls}"${tip(status.tip)}>${esc(status.text)}</span>` : "";
  const where = hub && (state.bases || []).length > 1 ? `<span class="nb-where">${esc(hub.name)}</span>` : "";
  const btn = `<span class="nb-dot ${LEVEL_CLS[lvl]}" aria-hidden="true"></span>${label}<span class="nb-label">Needs</span>${where}` +
    (sum.crit + sum.low ? `<span class="nb-badge ${LEVEL_CLS[sum.level]}" aria-label="${sum.crit + sum.low} low">${sum.crit + sum.low}</span>` : "") +
    (w ? `<span class="nb-worst ${LEVEL_CLS[w.level]}">${NEEDS_ICON[w.k] || ""} ${esc(w.name)}${w.note ? ` ${esc(w.note)}` : ""}</span>` : rows.length ? `<span class="nb-worst nb-ok">All good</span>` : "") +
    `<span class="nb-caret" aria-hidden="true">▾</span>`;
  const counts = sum.crit || sum.low ? `${sum.crit ? `<span class="nb-crit">${sum.crit} critical</span>` : ""}${sum.crit && sum.low ? " · " : ""}${sum.low ? `<span class="nb-low">${sum.low} low</span>` : ""}` : rows.length ? `<span class="nb-ok">Nothing low</span>` : "";
  const head = `<span class="nb-title">${title}</span><span class="nb-counts small">${counts}</span>${chips}`;
  const list = (empty || sortNeeds(rows).map(rowHTML).join("")) + (foot ? `<div class="nb-foot">${foot}</div>` : "");
  return { btn, head, list, level: lvl, html: needsSkeleton(btn, head, list) };
}
export const needsSkeleton = (btn = "", head = "", list = "") =>
  `<button type="button" class="nb-btn" id="nb-btn" aria-haspopup="true" aria-expanded="false" aria-controls="nb-panel">${btn}</button>` +
  `<div class="nb-panel" id="nb-panel" role="region" aria-label="Needs: every supply at a base"><div class="nb-head" id="nb-head">${head}</div><div class="nb-list" id="nb-list" tabindex="0">${list}</div></div>`;

// ---------- opening and closing (the page only) ----------
// Hover opens it (and leaving closes it, after a moment, so the mouse can cross the gap to the panel); a click pins it
// open (a tap on a touch screen too) and a second click closes it; the keyboard opens it on focus; Esc and a click
// elsewhere close it. The open state is a class on the slot (#tb-stock), which main.js never rewrites. cls: the class
// names, so the threat forecast's meter (ui/threatbar.js) opens and closes the same way.
export const NB_CLS = { btn: "nb-btn", panel: "nb-panel", open: "nb-open" };
export function initNeedsBar(root, doc = document, win = window, cls = NB_CLS) {
  if (!root || root.dataset.nbInit) return;
  root.dataset.nbInit = "1";
  let pinned = false, hover = false, timer = 0, quiet = false;
  const btn = () => root.querySelector(`.${cls.btn}`);
  const isOpen = () => root.classList.contains(cls.open);
  const set = (open) => {
    root.classList.toggle(cls.open, open);
    const b = btn();
    if (b) b.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) fit();
  };
  // Kept on screen: on a narrow window (the bar wraps) the panel slides left instead of running off the edge.
  const fit = () => {
    const p = root.querySelector(`.${cls.panel}`);
    if (!p || !p.getBoundingClientRect) return;
    p.style.left = "0px";
    const r = p.getBoundingClientRect(), vw = (doc.documentElement && doc.documentElement.clientWidth) || win.innerWidth || 0;
    const over = r.right - (vw - 8);
    if (over > 0) p.style.left = `${-Math.max(0, Math.min(over, r.left - 8))}px`;
  };
  const close = () => { clearTimeout(timer); pinned = false; set(false); };
  root.addEventListener("mouseenter", () => { hover = true; clearTimeout(timer); set(true); });
  root.addEventListener("mouseleave", () => {
    hover = false;
    if (pinned) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!hover && !pinned && !root.contains(doc.activeElement)) set(false); }, 220);
  });
  root.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest && t.closest(`.${cls.btn}`)) {
      if (pinned) close();
      else { pinned = true; set(true); }
      if (e.detail > 0) btn().blur(); // a mouse click leaves the keys to the game (Space pauses)
      return;
    }
    if (t.closest && t.closest("[data-action=\"nb-base\"]")) { pinned = true; return; } // picking a base keeps it open
    if (t.closest && t.closest("[data-action]")) close(); // Open base / Ledger: a window opens over it
  });
  root.addEventListener("focusin", () => { if (!quiet) set(true); });
  root.addEventListener("focusout", (e) => { if (!root.contains(e.relatedTarget) && !hover && !pinned) set(false); });
  doc.addEventListener("pointerdown", (e) => { if (isOpen() && !root.contains(e.target)) close(); }, true);
  win.addEventListener("keydown", (e) => {
    if (e.code !== "Escape" || !isOpen()) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // Esc closes the panel, not opens the menu
    const had = root.contains(doc.activeElement);
    close();
    if (had && btn()) { quiet = true; btn().focus(); quiet = false; } // the focus back on the button, the panel shut
  }, true);
}
