// The Ledger (📈 in the top bar, or E): one chart row per resource with what came in and went out each day and the
// stock, then people, mood and Heat, and for the whole colony hives, groups and land, over 30 / 90 / 365 days or the
// whole run, for all bases or one. Its second tab is the run summary, which is also the game-over and victory
// screen's body. And the top bar's trend arrows (▲ ▼ – against the day before) with a 14-day sparkline in the
// stock's tooltip. The numbers come from sim/history.js (one row a day); charts are drawn on <canvas> with no library
// after the window is written (main.js calls drawCharts), and hovering one shows that day's numbers.
import { day, alive } from "../sim/world.js";
import { SUPPLIES, SKILLS, SKILL_NAMES } from "../sim/data.js";
import {
  historyOf, seriesOf, seriesList, colIndex, FLOWS, FLOW_KEYS, stockTrend, currentRows, deathsByCause, worstDay,
} from "../sim/history.js";
import { rec, daysWith } from "../sim/relations.js";
import { diaryEntries } from "../sim/diary.js";
import { openDiary } from "./diary.js";
import { keyAction } from "./keymap.js"; // the key table (Menu → Controls)

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.round(Number(v) || 0).toLocaleString("en-US");
const n1 = (v) => { const x = Number(v) || 0; return Math.abs(x) < 10 && x % 1 ? x.toFixed(1) : n0(x); };
const sg = (v) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${n1(Math.abs(v))}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const RANGES = [[30, "30 days"], [90, "90 days"], [365, "365 days"], [0, "Whole run"]];
const LABEL = { food: "Food", water: "Water", fuel: "Fuel", wood: "Firewood", meds: "Meds", ammo: "Ammo", parts: "Parts", scrap: "Scrap" };
const ABOUT = {
  food: "Fresh and preserved food together. In: harvests, hunting, fishing, foraging, scavenging, teams and trade bringing it home. Out: eating, spoiling, seed, teams packing it, trade.",
  water: "Purified and un-purified water together. In: the well, springs, rivers, rain, claimed wells, teams fetching it. Out: drinking, the crops, teams packing it, evaporation.",
  fuel: "In: found, bought, made by the still. Out: heating once the firewood is gone, the generator, refuelling vehicles.",
  wood: "Firewood. In: the Cut wood job and teams, things broken down. Out: heating below freezing, the water boiler, the camp fires.",
  meds: "In: found, bought, crafted. Out: treating the hurt and the ill, teams packing them.",
  ammo: "In: found, bought, the ammo bench. Out: fights at the base, hunting, teams packing it.",
  parts: "In: found, bought, the parts bench. Out: building, repairs.",
  scrap: "In: found, bought, scavenging near the base. Out: building, crafting, workshops.",
};

// ---------- the window ----------
const prefs = (ui) => ui.ledgerPrefs || (ui.ledgerPrefs = { base: "all", range: 90, tab: "ledger" });
export function openLedger(ui, tab = null) {
  const p = prefs(ui);
  if (tab) p.tab = tab;
  ui.diary = null;
  ui.roster = null;
  ui.codex = null; // ui/codex.js
  ui.ledger = true;
}

export const LEDGER_ACTIONS = {
  "ld-open": (state, ui, d) => openLedger(ui, d && d.tab ? d.tab : null),
  "ld-close": (state, ui) => { ui.ledger = null; },
  "ld-base": (state, ui, d) => { prefs(ui).base = d.id || "all"; },
  "ld-range": (state, ui, d) => { prefs(ui).range = Number(d.r) || 0; },
  "ld-tab": (state, ui, d) => { prefs(ui).tab = d.t === "summary" ? "summary" : "ledger"; },
  "ld-diary": (state, ui, d) => { ui.ledger = null; openDiary(ui, Math.max(1, Math.min(day(state), Number(d.d) || 1))); },
};

// E opens and closes the Ledger (from the map, the game-over screen, the diary or the roster). J and R from the
// Ledger close it and let alerts.js open the diary or the roster. True when the key was used.
// The keys come from the key table (ui/keymap.js win.ledger; Menu → Controls rebinds them); C from the Ledger opens the codex.
export function ledgerKey(state, ui, e, modal) {
  if (!ui.started || state.combat) return false;
  const k = keyAction(e, "map");
  if (modal === "ledger" && ["win.diary", "win.roster", "win.codex"].includes(k)) { ui.ledger = null; return false; }
  if (k !== "win.ledger") return false;
  if (modal === "ledger") { ui.ledger = null; return true; }
  if (modal && !["diary", "roster", "codex", "over"].includes(modal)) return false;
  openLedger(ui);
  return true;
}

export function ledgerModal(state, ui) {
  const p = prefs(ui);
  const H = historyOf(state);
  const tabs = `<button class="lgchip ${p.tab === "ledger" ? "active" : ""}" data-action="ld-tab" data-t="ledger"${tip("Production and use, stock, people, mood and Heat, day by day")}>📈 Ledger</button>` +
    `<button class="lgchip ${p.tab === "summary" ? "active" : ""}" data-action="ld-tab" data-t="summary"${tip("The run so far: timeline, the best people, the worst day, deaths by cause, what happened")}>🏁 Run summary</button>`;
  const head = `<div class="spread"><h1>📈 Ledger</h1><span class="row">${tabs}</span><button class="primary" data-action="ld-close"${tip("Close the Ledger (E or Esc)")}>Close</button></div>`;
  if (p.tab === "summary") return `<div class="box ledgerbox">${head}<div class="ld-scroll">${runSummaryHTML(state, { live: true })}</div></div>`;
  if (!H || !H.all.rows.length) {
    return `<div class="box ledgerbox">${head}<div class="muted" style="margin-top:0.8rem">Nothing recorded yet: the Ledger writes a line for each base at midnight. Come back tomorrow.${H && H.from > 1 ? ` (This game was loaded on day ${H.from}; its numbers start there.)` : ""}</div></div>`;
  }
  const list = seriesList(state);
  if (p.base !== "all" && !list.some((s) => s.id === String(p.base))) p.base = "all";
  const baseChips = `<button class="lgchip ${p.base === "all" ? "active" : ""}" data-action="ld-base" data-id="all"${tip("Every base together (stock moved between your own bases nets out)")}>All bases</button>` +
    list.map((s) => `<button class="lgchip ${String(p.base) === s.id ? "active" : ""} ${s.lost ? "muted" : ""}" data-action="ld-base" data-id="${s.id}"${tip(s.lost ? `${s.name} was lost on day ${s.lost}: its numbers up to then` : `${s.name} alone`)}>${s.hub ? "🏠 " : ""}${esc(s.name)}${s.lost ? " (lost)" : ""}</button>`).join("");
  const rangeChips = RANGES.map(([r, l]) => `<button class="lgchip ${p.range === r ? "active" : ""}" data-action="ld-range" data-r="${r}">${l}</button>`).join("");
  const key = p.base === "all" ? "all" : p.base;
  const body = ledgerRows(state, key, p.range);
  const older = H.from > 1 ? ` This game was loaded on day ${H.from}: its numbers start there.` : "";
  return `<div class="box ledgerbox">${head}
    <div class="row dy-filters">${baseChips}</div>
    <div class="row dy-filters">${rangeChips}<span class="muted small" style="margin-left:auto"${tip(`One line a day for the last 120 days, then weekly averages, then 28-day averages for the oldest. In counts everything that came into the stores (made, found, bought, brought home); out everything that left (eaten, drunk, burned, spent, packed by a team, traded). Moved: shipped to or from your other bases by the outposts' daily run. Supply runs and trade convoys show as out at one base and in at the other.${older}`)}>ⓘ What the lines mean</span></div>
    <div class="ld-scroll">${body}</div></div>`;
}

// ---------- the rows ----------
function rangeRows(rows, range) {
  if (!range || !rows.length) return rows;
  const last = rows[rows.length - 1][0];
  return rows.filter((x) => x[0] + x[1] - 1 > last - range);
}
const mid = (x) => x[0] + (x[1] - 1) / 2;
const dayText = (x) => (x[1] > 1 ? `Days ${x[0]}–${x[0] + x[1] - 1} (a day on average)` : `Day ${x[0]}`);

function ledgerRows(state, key, range) {
  const H = historyOf(state);
  const ser = seriesOf(state, key);
  if (!ser || !ser.rows.length) return `<div class="muted">No lines for this base yet.</div>`;
  const rows = rangeRows(ser.rows, range);
  const C = (name) => colIndex(H, name, ser.colony);
  const val = (x, name) => { const i = C(name); return i < 0 ? 0 : Number(x[i]) || 0; };
  const days = rows.map(mid);
  const id = `ld-${key}-${range}`;
  const out = [];
  for (const g of FLOW_KEYS) {
    const stock = rows.map((x) => FLOWS[g].reduce((a, k) => a + val(x, `s_${k}`), 0));
    const inn = rows.map((x) => val(x, `i_${g}`)), outv = rows.map((x) => val(x, `o_${g}`)), mv = rows.map((x) => val(x, `m_${g}`));
    const any = (a) => a.some((v) => Math.abs(v) > 0.05);
    if (!any(stock) && !any(inn) && !any(outv)) { out.push(`<div class="ld-row ld-empty"><b>${LABEL[g]}</b> <span class="muted small">none in these days</span></div>`); continue; }
    const span = rows.reduce((a, x) => a + x[1], 0);
    const avg = (a) => rows.reduce((s, x, i) => s + a[i] * x[1], 0) / Math.max(1, span);
    const net = avg(inn) - avg(outv) + avg(mv);
    const parts = FLOWS[g].length > 1 ? FLOWS[g] : null;
    const series = [{ v: inn, color: "--good", kind: "line", label: "in" }, { v: outv, color: "--danger", kind: "line", label: "out" }];
    if (any(mv)) series.push({ v: mv, color: "--info", kind: "line", label: "moved", dash: true });
    out.push(chartRow(`${id}-${g}`, {
      title: `<b${tip(ABOUT[g])}>${LABEL[g]}</b> <span class="small ${net > 0.05 ? "good" : net < -0.05 ? "danger" : "muted"}"${tip("In minus out (and moved) a day, on average over these days")}>${net > 0.05 ? "▲" : net < -0.05 ? "▼" : "–"} ${sg(net)} a day</span>`,
      days,
      panels: [{ series, min: 0, label: "a day" }, { series: [{ v: stock, color: "--accent", kind: "area", label: "stock" }], min: 0, label: "stock" }],
      read: (i) => {
        const x = rows[i];
        const brk = parts ? ` (${parts.map((k) => `${n1(val(x, `s_${k}`))} ${k === "preserved" ? "preserved" : k === "rawwater" ? "un-purified" : k === "water" ? "purified" : "fresh"}`).join(", ")})` : "";
        return `${dayText(x)} · <span class="good">in +${n1(inn[i])}</span> · <span class="danger">out −${n1(outv[i])}</span>${Math.abs(mv[i]) > 0.05 ? ` · <span class="info">moved ${sg(mv[i])}</span>` : ""} · stock <b>${n1(stock[i])}</b>${brk}`;
      },
    }));
  }
  // People, mood and Heat.
  const people = rows.map((x) => val(x, ser.colony ? "pop" : "people"));
  if (ser.colony) {
    const atHome = rows.map((x) => val(x, "people")), deaths = rows.map((x) => val(x, "deaths")), arrivals = rows.map((x) => val(x, "arrivals")), births = rows.map((x) => val(x, "births"));
    out.push(chartRow(`${id}-pop`, {
      title: `<b${tip("Everyone alive (teams on the road and captives included), and those at a base")}>Population</b>`,
      days,
      panels: [
        { series: [{ v: people, color: "--accent", kind: "area", label: "alive" }, { v: atHome, color: "--info", kind: "line", label: "at a base" }], min: 0, label: "people" },
        { series: [{ v: deaths, color: "--death", kind: "bars", label: "deaths" }, { v: arrivals, color: "--good", kind: "bars", label: "arrivals", up: true }], min: 0, label: "a day", bars: true },
      ],
      read: (i) => `${dayText(rows[i])} · <b>${n1(people[i])}</b> alive, ${n1(atHome[i])} at a base · <span class="danger">${n1(deaths[i])} died</span> · <span class="good">${n1(arrivals[i])} joined</span>${births[i] ? ` (${n1(births[i])} born)` : ""}`,
    }));
  } else {
    out.push(chartRow(`${id}-pop`, {
      title: `<b${tip("People living at this base (not its teams on the road)")}>People</b>`,
      days, panels: [{ series: [{ v: people, color: "--accent", kind: "area", label: "people" }], min: 0, label: "people" }],
      read: (i) => `${dayText(rows[i])} · <b>${n1(people[i])}</b> people`,
    }));
  }
  const mood = rows.map((x) => val(x, "mood")), heat = rows.map((x) => val(x, "heat"));
  out.push(chartRow(`${id}-mood`, {
    title: `<b${tip("The average mood of the people at the base (0–100; under 25 people start to break)")}>Mood</b>`,
    days, panels: [{ series: [{ v: mood, color: "--good", kind: "line", label: "mood" }], min: 0, max: 100, label: "mood", marks: [25] }],
    read: (i) => `${dayText(rows[i])} · mood <b>${n1(mood[i])}</b>`,
  }));
  out.push(chartRow(`${id}-heat`, {
    title: `<b${tip(ser.colony ? "Heat: the noise and life that draws the dead (hordes.js). For all bases, the loudest one's" : "Heat: the noise and life at this base that draws the dead")}>Heat</b>`,
    days, panels: [{ series: [{ v: heat, color: "--danger", kind: "line", label: "Heat" }], min: 0, label: "Heat" }],
    read: (i) => `${dayText(rows[i])} · Heat <b>${n1(heat[i])}</b>`,
  }));
  if (ser.colony) {
    const known = rows.map((x) => val(x, "hivesKnown")), gone = rows.map((x) => val(x, "hivesDestroyed"));
    out.push(chartRow(`${id}-hives`, {
      title: `<b${tip("Hives you know of (still standing), and hives destroyed in the state so far (by anyone)")}>Hives</b>`,
      days, panels: [{ series: [{ v: known, color: "--danger", kind: "line", label: "known" }, { v: gone, color: "--good", kind: "line", label: "destroyed" }], min: 0, label: "hives" }],
      read: (i) => `${dayText(rows[i])} · <span class="danger">${n1(known[i])} known</span> · <span class="good">${n1(gone[i])} destroyed</span>`,
    }));
    const groups = rows.map((x) => val(x, "groups")), allied = rows.map((x) => val(x, "allied")), hostile = rows.map((x) => val(x, "hostile"));
    out.push(chartRow(`${id}-groups`, {
      title: `<b${tip("Groups you know of that are still standing; allied (or in the coalition) and hostile among them")}>Groups</b>`,
      days, panels: [{ series: [{ v: groups, color: "--accent", kind: "line", label: "known" }, { v: allied, color: "--good", kind: "line", label: "allied" }, { v: hostile, color: "--danger", kind: "line", label: "hostile" }], min: 0, label: "groups" }],
      read: (i) => `${dayText(rows[i])} · ${n1(groups[i])} known · <span class="good">${n1(allied[i])} allied</span> · <span class="danger">${n1(hostile[i])} hostile</span>`,
    }));
    const land = rows.map((x) => val(x, "land") / 10);
    out.push(chartRow(`${id}-land`, {
      title: `<b${tip("The coalition's share of the land (your bases' reach, members' bases, claimed tiles): over 50% for a year wins")}>Land</b>`,
      days, panels: [{ series: [{ v: land, color: "--info", kind: "area", label: "%" }], min: 0, max: Math.max(60, ...land), label: "%", marks: [50] }],
      read: (i) => `${dayText(rows[i])} · <b>${n1(land[i])}%</b> of the land`,
    }));
  }
  return out.join("");
}

// ---------- charts ----------
// Specs by id, written while the window's HTML is built and read when it is drawn and hovered.
const charts = new Map();
function chartRow(id, spec) {
  charts.set(id, { ...spec, hover: -1 });
  const last = spec.days.length - 1;
  const legend = spec.panels.map((p) => p.series.map((s) => `<span class="ld-key" style="--c:var(${s.color})">${esc(s.label)}</span>`).join(" ")).join(" · ");
  return `<div class="ld-row"><div class="ld-head">${spec.title}<span class="ld-legend small muted">${legend}</span></div>
    <div class="ld-read small" data-read="${id}">${last >= 0 ? spec.read(last) : ""}</div>
    <div class="ld-charts ld-n${spec.panels.length}">${spec.panels.map((p, i) => `<canvas class="ld-chart" data-chart="${id}" data-panel="${i}"></canvas>`).join("")}</div></div>`;
}

const cssVar = (name, fallback) => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
};
const niceMax = (v) => {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
};

function paint(cv, spec, pi) {
  const P = spec.panels[pi];
  if (!P) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(60, cv.clientWidth), h = Math.max(40, cv.clientHeight);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const fs = parseFloat(getComputedStyle(cv).fontSize) || 14;
  const font = `${Math.round(fs * 0.78)}px "Segoe UI", system-ui, sans-serif`;
  const muted = cssVar("--muted", "#9aa0a8"), line = cssVar("--line", "#343a44"), text = cssVar("--text", "#e6e2d8");
  const days = spec.days;
  const padL = fs * 3, padR = fs * 0.5, padT = fs * 0.6, padB = fs * 1.3;
  const x0 = days[0], x1 = days[days.length - 1];
  const X = (d) => padL + (x1 === x0 ? (w - padL - padR) / 2 : ((d - x0) / (x1 - x0)) * (w - padL - padR));
  let hi = P.min ?? 0;
  for (const s of P.series) for (const v of s.v) if (Number.isFinite(v) && v > hi) hi = v;
  const lo = P.min ?? 0;
  const top = P.max != null ? Math.max(P.max, hi) : niceMax(hi);
  const Y = (v) => padT + (1 - (v - lo) / (top - lo || 1)) * (h - padT - padB);
  // Grid and labels.
  g.font = font;
  g.lineWidth = 1;
  g.strokeStyle = line;
  g.fillStyle = muted;
  g.textBaseline = "middle";
  g.textAlign = "right";
  for (const v of [lo, (lo + top) / 2, top]) {
    g.beginPath(); g.moveTo(padL, Math.round(Y(v)) + 0.5); g.lineTo(w - padR, Math.round(Y(v)) + 0.5); g.stroke();
    g.fillText(n1(v), padL - fs * 0.3, Y(v));
  }
  for (const m of P.marks || []) {
    g.setLineDash([4, 4]); g.strokeStyle = muted;
    g.beginPath(); g.moveTo(padL, Y(m)); g.lineTo(w - padR, Y(m)); g.stroke();
    g.setLineDash([]); g.strokeStyle = line;
  }
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  g.fillText(`Day ${Math.round(x0)}`, padL, h - fs * 0.25);
  g.textAlign = "right";
  g.fillText(x1 === x0 ? "" : `Day ${Math.round(x1)}`, w - padR, h - fs * 0.25);
  g.textAlign = "center";
  g.fillText(P.label || "", (padL + w - padR) / 2, h - fs * 0.25);
  // Series.
  const bw = Math.max(1.5, Math.min(fs * 0.6, ((w - padL - padR) / Math.max(1, days.length)) * 0.42));
  P.series.forEach((s, si) => {
    const c = cssVar(s.color, "#e0a84f");
    if (s.kind === "bars") {
      g.fillStyle = c;
      const off = P.series.filter((t) => t.kind === "bars").length > 1 ? (si === 0 ? -bw / 2 : bw / 2) : 0;
      s.v.forEach((v, i) => { if (v > 0) g.fillRect(X(days[i]) + off - bw / 2, Y(v), bw, Y(lo) - Y(v)); });
      return;
    }
    g.beginPath();
    let started = false;
    s.v.forEach((v, i) => {
      if (!Number.isFinite(v)) { started = false; return; }
      if (!started) { g.moveTo(X(days[i]), Y(v)); started = true; } else g.lineTo(X(days[i]), Y(v));
    });
    if (days.length === 1) { g.arc(X(days[0]), Y(s.v[0] || 0), 2.5, 0, Math.PI * 2); }
    g.strokeStyle = c;
    g.lineWidth = Math.max(1.5, fs * 0.13);
    g.setLineDash(s.dash ? [fs * 0.4, fs * 0.3] : []);
    g.stroke();
    g.setLineDash([]);
    if (s.kind === "area" && days.length > 1) {
      g.lineTo(X(days[days.length - 1]), Y(lo));
      g.lineTo(X(days[0]), Y(lo));
      g.closePath();
      g.globalAlpha = 0.22;
      g.fillStyle = c;
      g.fill();
      g.globalAlpha = 1;
    }
  });
  // The hovered day.
  const i = spec.hover;
  if (i >= 0 && i < days.length) {
    const x = X(days[i]);
    g.strokeStyle = text;
    g.globalAlpha = 0.5;
    g.beginPath(); g.moveTo(x, padT); g.lineTo(x, h - padB); g.stroke();
    g.globalAlpha = 1;
    for (const s of P.series) {
      const v = s.v[i];
      if (!Number.isFinite(v) || s.kind === "bars") continue;
      g.fillStyle = cssVar(s.color, "#e0a84f");
      g.beginPath(); g.arc(x, Y(v), Math.max(2.5, fs * 0.22), 0, Math.PI * 2); g.fill();
    }
  }
}

function paintRow(id, root = document) {
  const spec = charts.get(id);
  if (!spec) return;
  for (const cv of root.querySelectorAll(`canvas[data-chart="${id}"]`)) paint(cv, spec, Number(cv.dataset.panel) || 0);
}
function nearest(spec, cv, clientX) {
  const r = cv.getBoundingClientRect();
  const fs = parseFloat(getComputedStyle(cv).fontSize) || 14;
  const padL = fs * 3, padR = fs * 0.5, days = spec.days;
  const x0 = days[0], x1 = days[days.length - 1];
  const t = x1 === x0 ? 0 : (clientX - r.left - padL) / Math.max(1, r.width - padL - padR);
  const d = x0 + Math.max(0, Math.min(1, t)) * (x1 - x0);
  let best = 0;
  for (let i = 1; i < days.length; i++) if (Math.abs(days[i] - d) < Math.abs(days[best] - d)) best = i;
  return best;
}
function onMove(e) {
  const cv = e.currentTarget, id = cv.dataset.chart, spec = charts.get(id);
  if (!spec || !spec.days.length) return;
  const i = nearest(spec, cv, e.clientX);
  if (i === spec.hover) return;
  spec.hover = i;
  paintRow(id);
  const rd = document.querySelector(`[data-read="${id}"]`);
  if (rd) rd.innerHTML = spec.read(i);
}
function onLeave(e) {
  const id = e.currentTarget.dataset.chart, spec = charts.get(id);
  if (!spec) return;
  spec.hover = -1;
  paintRow(id);
  const rd = document.querySelector(`[data-read="${id}"]`);
  if (rd && spec.days.length) rd.innerHTML = spec.read(spec.days.length - 1);
}
let sizer = null;
// Draws every chart in a freshly written window (main.js, after the modal's HTML changed), and again when the window
// is resized.
export function drawCharts(root) {
  if (!root || typeof document === "undefined") return;
  const list = root.querySelectorAll("canvas[data-chart]");
  if (!list.length) return;
  if (!sizer && typeof ResizeObserver !== "undefined") sizer = new ResizeObserver((es) => { for (const en of es) { const cv = en.target, spec = charts.get(cv.dataset.chart); if (spec && cv.isConnected) paint(cv, spec, Number(cv.dataset.panel) || 0); } });
  for (const cv of list) {
    const spec = charts.get(cv.dataset.chart);
    if (!spec) continue;
    spec.hover = -1;
    paint(cv, spec, Number(cv.dataset.panel) || 0);
    if (!cv._ld) {
      cv._ld = true;
      cv.addEventListener("mousemove", onMove);
      cv.addEventListener("mouseleave", onLeave);
      if (sizer) sizer.observe(cv);
    }
  }
}

// ---------- the run summary ----------
// The run in one page: timeline graphs, the best people, the worst day, deaths by cause, notable events. Used by the
// game-over and victory screens (ui.js) and the Ledger's second tab. opts.live: today's numbers so far as the
// timeline's last point (always at the end of a run, so the fall shows).
export function runSummaryHTML(state, opts = {}) {
  const H = historyOf(state);
  const parts = [];
  // Timeline.
  if (H && H.all.rows.length) {
    let rows = H.all.rows.slice();
    const cur = (opts.live || state.gameOver) ? currentRows(state) : null;
    // Today so far (the timeline's levels only): after the last row, or in its place when the run ends at midnight.
    if (cur && (!rows.length || cur.all[0] > rows[rows.length - 1][0])) rows.push(cur.all);
    else if (cur && state.gameOver && cur.all[0] === rows[rows.length - 1][0]) rows[rows.length - 1] = cur.all;
    const C = (n) => colIndex(H, n, true);
    const v = (n) => rows.map((x) => Number(x[C(n)]) || 0);
    const days = rows.map(mid);
    const food = rows.map((x) => (Number(x[C("s_food")]) || 0) + (Number(x[C("s_preserved")]) || 0));
    const water = rows.map((x) => (Number(x[C("s_water")]) || 0) + (Number(x[C("s_rawwater")]) || 0));
    const pop = v("pop"), heat = v("heat"), known = v("hivesKnown"), gone = v("hivesDestroyed"), land = v("land").map((x) => x / 10);
    const dt = (i) => (cur && i === rows.length - 1 ? `Day ${rows[i][0]} (${state.gameOver ? "the end" : "so far"})` : dayText(rows[i]));
    const id = "rs";
    const tiles = [
      [`${id}-pop`, "Population", [{ v: pop, color: "--accent", kind: "area", label: "alive" }], (i) => `${dt(i)} · <b>${n1(pop[i])}</b> alive`, {}],
      [`${id}-food`, "Food", [{ v: food, color: "--good", kind: "area", label: "food" }], (i) => `${dt(i)} · <b>${n1(food[i])}</b> food in store`, {}],
      [`${id}-water`, "Water", [{ v: water, color: "--info", kind: "area", label: "water" }], (i) => `${dt(i)} · <b>${n1(water[i])}</b> water`, {}],
      [`${id}-heat`, "Heat", [{ v: heat, color: "--danger", kind: "line", label: "Heat" }], (i) => `${dt(i)} · Heat <b>${n1(heat[i])}</b> (the loudest base)`, {}],
      [`${id}-hives`, "Hives", [{ v: known, color: "--danger", kind: "line", label: "known" }, { v: gone, color: "--good", kind: "line", label: "destroyed" }], (i) => `${dt(i)} · <span class="danger">${n1(known[i])} known</span> · <span class="good">${n1(gone[i])} destroyed</span>`, {}],
      [`${id}-land`, "Land", [{ v: land, color: "--info", kind: "area", label: "%" }], (i) => `${dt(i)} · <b>${n1(land[i])}%</b> of the land`, { max: Math.max(60, ...land), marks: [50] }],
    ];
    parts.push(`<h3>Timeline</h3><div class="rs-grid">${tiles.map(([cid, title, series, read, o]) => chartRow(cid, { title: `<b>${title}</b>`, days, panels: [{ series, min: 0, label: "", ...o }], read })).join("")}</div>`);
    if (H.from > 1) parts.push(`<div class="muted small">The timeline starts on day ${H.from}, when this game was loaded (saves from before the Ledger have no history).</div>`);
  } else parts.push(`<div class="muted">No timeline yet: the first line is written at midnight.</div>`);

  // The best people (the living and the dead).
  const all = state.survivors.filter((s) => s.joined != null || s.alive || s.diedDay != null);
  const tag = (s) => `${esc(s.name)}${s.alive ? "" : s.left ? " <span class=\"muted\">(left)</span>" : " <span class=\"muted\">†</span>"}`;
  const best = (score, min = 1) => {
    let b = null, bv = -Infinity;
    for (const s of all) { const v = score(s); if (v > bv) { bv = v; b = s; } }
    return b && bv >= min ? { s: b, v: bv } : null;
  };
  const kills = best((s) => (rec(s).killsZ || 0) + (rec(s).killsH || 0));
  const longest = best((s) => daysWith(state, s));
  const trips = best((s) => rec(s).trips || 0);
  const topSkill = (() => {
    let b = null;
    for (const s of all) for (const k of SKILLS) { const v = Number(s.skills && s.skills[k]) || 0; if (!b || v > b.v) b = { s, v, k }; }
    return b && b.v > 0 ? b : null;
  })();
  const treated = best((s) => rec(s).treated || 0);
  const built = best((s) => rec(s).built || 0);
  const cards = [
    kills && ["⚔ Most kills", tag(kills.s), `${n0(kills.v)} (${n0(rec(kills.s).killsZ)} of the dead, ${plural(Math.round(rec(kills.s).killsH || 0), "person", "people")})`],
    longest && ["⏳ Longest with the group", tag(longest.s), `${plural(longest.v, "day")}`],
    topSkill && ["★ Top skill", tag(topSkill.s), `${esc(SKILL_NAMES[topSkill.k] || topSkill.k)} ${topSkill.v}`],
    trips && ["🚶 Most trips", tag(trips.s), `${plural(trips.v, "trip")}`],
    treated && ["✚ Most people treated", tag(treated.s), n0(treated.v)],
    built && ["🔨 Most buildings built", tag(built.s), n0(built.v)],
  ].filter(Boolean);
  parts.push(`<h3>The best of them</h3>${cards.length ? `<div class="rs-cards">${cards.map(([t, who, what]) => `<div class="card"><div class="muted small">${t}</div><div><b>${who}</b></div><div class="small">${what}</div></div>`).join("")}</div>` : `<div class="muted">Nobody has done much yet.</div>`}`);

  // The worst day.
  const wd = worstDay(state);
  if (wd) {
    const firsts = (wd.names || []).map((n) => String(n).split(" ")[0]);
    const lines = diaryEntries(state, wd.day).filter((e) => e.cat === "d" && firsts.some((f) => e.text.includes(f))).slice(0, 5); // your own dead
    const what = wd.kind === "deaths" ? `${plural(wd.n, "death")}: ${esc(wd.names.slice(0, 6).join(", "))}${wd.names.length > 6 ? "…" : ""}` : wd.kind === "people" ? `${plural(wd.n, "person", "people")} lost` : `${n0(wd.n)} food lost`;
    parts.push(`<h3>The worst day</h3><div class="card"><b class="danger">Day ${wd.day}</b> · ${what}${lines.length ? `<div class="small" style="margin-top:0.3rem">${lines.map((e) => `<div>${esc(e.text)}</div>`).join("")}</div>` : ""}
      ${state.gameOver ? "" : `<div class="row" style="margin-top:0.4rem"><button data-action="ld-diary" data-d="${wd.day}"${tip("Open that day in the diary (J)")}>📖 Read the day</button></div>`}</div>`);
  }

  // Deaths by cause.
  const causes = deathsByCause(state);
  const dead = causes.reduce((a, c) => a + c.n, 0);
  parts.push(`<h3>Deaths by cause</h3>${dead ? `<div class="rs-causes">${causes.map((c) => `<div class="rs-cause"${tip(`${c.names.join(", ")}${c.n > c.names.length ? "…" : ""}`)}><span>${esc(c.label)}</span><span class="rs-bar"><i style="width:${Math.max(3, Math.round((c.n / causes[0].n) * 100))}%"></i></span><b>${c.n}</b></div>`).join("")}</div>` : `<div class="muted">Nobody has died.</div>`}`);

  // Notable events (the timelapse's captions: sim/chronicle.js), spread over the run.
  const ev = notableEvents(state, 14);
  if (ev.length) parts.push(`<h3>What happened</h3><div class="rs-events">${ev.map((e) => `<div class="dy-line k-${e.kind === "death" ? "death" : e.kind === "good" ? "good" : e.kind === "danger" ? "danger" : "info"}"><span class="t">Day ${Math.floor(e.h / 24) + 1}</span>${esc(e.text)}</div>`).join("")}</div>`);

  if (!opts.noButtons) parts.push(`<div class="row" style="margin-top:0.8rem">${state.chronicle ? `<button data-action="tl-open" data-from="${state.gameOver ? "end" : "ledger"}"${tip("Replay the whole game sped up with the fog of war off: the groups' land, the infection, the hives, hordes, teams and your holdout")}>▶ Watch the timelapse</button>` : ""}${opts.ledgerButton ? `<button data-action="ld-open" data-tab="ledger"${tip("Every resource day by day, per base (E)")}>📈 Ledger</button>` : ""}</div>`);
  const head = `<div class="muted small">Day ${day(state)} · ${plural(alive(state).length, "survivor")} · ${plural(state.bases.length, "base")}${dead ? ` · ${plural(dead, "death")}` : ""}</div>`;
  return head + parts.join("");
}

// Up to n captions from the chronicle (sim/chronicle.js), the weightiest first, then put back in time order. Routine
// lines (a skill rising, firewood cut, a trade) are left out, and so is news from beyond your sight (the chronicle has
// no fog of war) until the run is over.
const BIG = /died|killed|overrun|was lost|destroyed|has fallen|holds the state|coalition|war|peace|pact|hive|horde of \d{3}|raid|taken prisoner|captured|rescued|outpost|founded|took over|deserted|allied/i;
const ROUTINE = /rose to|took the perk|firewood|harvested|got over|night care|came down with|got a |needs \d+ medic|stores are full|traded with|has arrived|hunted near|key ring|have become|finished studying|brought word|is now friendly/i;
export function notableEvents(state, n = 14) {
  const c = state.chronicle;
  if (!c || !Array.isArray(c.events)) return [];
  const score = (e) => (e.major ? 5 : 0) + (e.kind === "death" ? 4 : 0) + (BIG.test(e.text) ? 3 : 0) + (e.kind === "danger" || e.kind === "good" ? 1 : 0);
  const list = c.events.filter((e) => (state.gameOver || e.kind !== "world") && (e.major || !ROUTINE.test(e.text)))
    .map((e, i) => ({ e, i, s: score(e) }))
    .sort((a, b) => b.s - a.s || b.i - a.i) // the weightiest, the latest first among equals
    .slice(0, n);
  return list.sort((a, b) => a.e.h - b.e.h || a.i - b.i).map((x) => x.e);
}

// ---------- the top bar ----------
// A stock chip's trend against the day before (sim/history.js stockTrend at the hub): { arrow (HTML), tip (text
// added to the chip's tooltip), attr (the sparkline's values for main.js's tooltip) }.
export function stockChipTrend(state, base, key) {
  const none = { arrow: "", tip: "", attr: "" };
  if (!base || !historyOf(state)) return none;
  const t = stockTrend(state, base.id, key === "water" ? "water+" : key);
  if (!t) return none;
  const spark = t.spark.length > 1 ? ` data-tip-spark="${t.spark.map((v) => Math.round(v * 10) / 10).join(",")}"` : "";
  if (t.before == null) return { arrow: ` <span class="trend muted">–</span>`, tip: " Trend: not enough days recorded yet.", attr: spark };
  const what = key === "water" ? "water (both kinds)" : key === "food" ? "days of food (every kind)" : (SUPPLIES[key] ? SUPPLIES[key].name.toLowerCase() : key);
  const still = Math.abs(t.delta) < Math.max(0.5, Math.abs(t.before) * 0.01);
  const arrow = still ? "–" : t.delta > 0 ? "▲" : "▼";
  const cls = still ? "muted" : t.delta > 0 ? "good" : "danger";
  const line = ` Day ${t.day}: ${what} ${still ? "held steady" : t.delta > 0 ? "went up" : "went down"} ${still ? "" : `by ${n1(Math.abs(t.delta))} `}(${n1(t.before)} → ${n1(t.now)}).${t.spark.length > 1 ? ` The line: the last ${t.spark.length - 1} days. The Ledger (E) has the details.` : ""}`;
  return { arrow: ` <span class="trend ${cls}">${arrow}</span>`, tip: line, attr: spark };
}

// The tooltip's sparkline (main.js adds it under the text of anything with data-tip-spark).
export function sparkNode(values) {
  const v = String(values || "").split(",").map(Number).filter(Number.isFinite);
  const el = document.createElement("div");
  el.className = "tip-spark";
  if (v.length < 2) return el;
  const W = 160, Hh = 36, lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * (W - 4) + 2).toFixed(1)},${(Hh - 3 - ((x - lo) / span) * (Hh - 6)).toFixed(1)}`);
  const up = v[v.length - 1] >= v[0];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none"><polyline points="${pts.join(" ")}" fill="none" stroke="var(${up ? "--good" : "--danger"})" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><span class="muted">${n1(lo)}–${n1(hi)}</span>`;
  return el;
}

// ---------- help ----------
// The Help topic (ui/help.js).
export function ledgerHelp() {
  return `The <b>Ledger</b> (📈 Ledger in the top bar, or <b>E</b>; E or Esc closes it) keeps the books: one line a day for each base and for the whole colony, written at midnight.<br><br>
    <b>Resources:</b> a row each for food (fresh and preserved), water (purified and un-purified), fuel, firewood, meds, ammo, parts and scrap. The left chart is what came <span class="good">in</span> each day (harvests, hunting, foraging, wells, workshops, what teams and trade brought home) against what went <span class="danger">out</span> (eaten, drunk, burned, spent, spoiled, packed by teams, traded); the right one the stock. For one base a dashed <span style="color:var(--info)">moved</span> line is what the outposts' daily run shipped to or from your other bases; for <i>All bases</i> that nets out (only what the road loses shows). The figure by the name is in minus out a day on average over the days shown. Supply runs and trade convoys count as out where they load and in where they unload.<br><br>
    <b>People:</b> population (everyone alive, and those at a base), deaths and arrivals a day, mood and Heat; for All bases also the hives you know of and the hives destroyed, the groups you know (allied, hostile) and the coalition's share of the land (the 50% line is what the alliance victory needs).<br><br>
    <b>Days:</b> 30, 90, 365 or the whole run. Move the mouse over a chart for that day's numbers. The last 120 days are kept day by day, older ones as weekly averages, anything older than about two years and four months as 28-day averages. A game saved before the Ledger existed starts its history on the day it was loaded.<br><br>
    <b>Run summary</b> (the Ledger's second tab, and the game-over and victory screens): the timeline of population, food, water, Heat, hives and land; the best of your people (most kills, longest with the group, top skill, most trips, most treated, most built), the worst day, deaths by cause (from the memorial wall), what happened (the timelapse's captions) and <i>Watch the timelapse</i>.<br><br>
    <b>Top bar trends:</b> the <b>Needs</b> button in the top bar (hover, click or tab to it) lists every supply at the hub with its days left, the critical ones first; each shows ▲ (up), ▼ (down) or – (steady) for the last full day against the day before, green when it grew and red when it fell. Its tooltip says by how much, with a sparkline of the last 14 days (water counts both kinds).`;
}
