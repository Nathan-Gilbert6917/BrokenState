// The Diary screen (J or the Diary button in the top bar) and the log panel under the map, both with filters and
// clickable names and places. The lines come from sim/diary.js (every log line of the run, day by day).
import {
  CATEGORIES, CAT, ROBOT, decodeRefs, isBuilding, diaryDay, diaryEntries, daySummary, diarySync, diaryStats, DIARY_CAP,
} from "../sim/diary.js";
import { day, survivorById, baseById, factionById } from "../sim/world.js";
import { seasonOfDay, weatherOnDay, SEASON_DAYS } from "../sim/weather.js";
import { partyTile } from "../sim/parties.js";
import { contactable } from "../sim/orders.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const hh = (h) => `${String(h).padStart(2, "0")}:00`;
const ALL_CATS = CATEGORIES.map((c) => c[0]).join("");
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const firstName = (name) => String(name || "").split(/\s+/)[0];

// ---------- links ----------
const LINK_TIP = {
  s: "Open their survivor screen",
  b: "Open this base",
  t: "Show this place on the map",
  p: "Open this team's panel",
  f: "Show this group on the map (Groups tab)",
};
// A line's text with the people, bases, groups, teams and places it names as links (refs from sim/diary.js).
export function linkText(text, refs) {
  const list = typeof refs === "string" ? decodeRefs(refs) : refs || [];
  if (!list.length) return esc(text);
  let out = "", at = 0;
  for (const r of list) {
    if (r.start < at || r.start + r.len > text.length) continue;
    out += esc(text.slice(at, r.start));
    out += `<a class="lk lk-${r.type}" data-action="lk" data-k="${r.type}" data-id="${r.id}"${tip(LINK_TIP[r.type])}>${esc(text.substr(r.start, r.len))}</a>`;
    at = r.start + r.len;
  }
  return out + esc(text.slice(at));
}

// Big windows a map link closes, so the map is in view.
function closeScreens(ui) {
  ui.diary = null;
  ui.roster = null;
}
// Clicking a link (log, diary, alerts). act = main.js's action table (center, openbase, xp-open, survivor).
function followLink(state, ui, d, act) {
  const id = Number(d.id);
  const say = (msg) => { if (ui.diary) ui.diaryPrefs.msg = msg; else ui.logMsg = msg; };
  ui.logMsg = "";
  if (d.k === "s") {
    if (!survivorById(state, id)) return say("Nobody by that name is on the roster any more.");
    ui.survivor = id; // the survivor screen opens over the diary; Esc goes back to it
  } else if (d.k === "b") {
    if (!baseById(state, id)) return say("That base is gone.");
    act.openbase({ id, tab: "overview" });
  } else if (d.k === "t") {
    closeScreens(ui);
    act.center({ tile: id });
  } else if (d.k === "p") {
    const p = state.parties.find((q) => q.id === id && q.owner === "player");
    if (!p) return say("That team is no longer out (it came home, joined a base or was lost).");
    closeScreens(ui);
    act["xp-open"]({ id });
    if (contactable(p)) act.center({ tile: partyTile(p) });
  } else if (d.k === "f") {
    const f = factionById(state, id);
    closeScreens(ui);
    ui.tab = "groups";
    if (f && f.known && f.alive && f.bases.length) act.center({ tile: f.bases[0] });
  }
}

// ---------- log panel (under the map) ----------
const logPrefs = (ui) => ui.logf || (ui.logf = { cats: ALL_CATS, robot: true, base: "" });
const passes = (e, cats, robot, q, base) =>
  cats.includes(e.cat) && (robot || !e.robot) && (!q || e.text.toLowerCase().includes(q)) && (!base || (e.refs || "").split(",").some((r) => r.startsWith(`b${base}@`)));

export function renderLogPanel(state, ui) {
  diarySync(state); // new people and lines written straight into the log
  const f = logPrefs(ui);
  const base = f.base && baseById(state, Number(f.base)) ? Number(f.base) : "";
  const lines = [];
  for (const l of state.log) {
    const e = { cat: l.c || "w", robot: String(l.text).startsWith(ROBOT), text: String(l.text), refs: l.r || "" };
    if (!passes(e, f.cats, f.robot, "", base)) continue;
    lines.push(`<div class="k-${l.kind}"><span class="t">D${Math.floor(l.hour / 24) + 1} ${hh(l.hour % 24)}</span>${linkText(e.text, e.refs)}</div>`);
    if (lines.length >= 80) break;
  }
  const all = f.cats === ALL_CATS;
  const chips = `<button class="lgchip ${all ? "active" : ""}" data-action="lg-cat" data-c="all"${tip("Show every kind of line")}>All</button>` +
    CATEGORIES.map(([c, , label, icon]) => `<button class="lgchip ${!all && f.cats.includes(c) ? "active" : ""}" data-action="lg-cat" data-c="${c}"${tip(`${label}: show only these (click more to add them)`)}>${icon}</button>`).join("") +
    `<button class="lgchip ${f.robot ? "active" : ""}" data-action="lg-robot"${tip(f.robot ? "Autopilot notes (🤖) are shown. Click to hide them." : "Autopilot notes (🤖) are hidden. Click to show them.")}>🤖</button>`;
  const bases = state.bases.length > 1 ? `<select data-action="lg-base"${tip("Only lines that name this base")}><option value="">All bases</option>${state.bases.map((b) => `<option value="${b.id}" ${base === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>` : "";
  const msg = ui.logMsg ? `<span class="muted small">${esc(ui.logMsg)}</span>` : "";
  return `<div class="logbar">${chips}${bases}<button class="lgchip" data-action="dy-open"${tip("The whole run, day by day (J)")}>📖 Diary</button>${msg}</div>` +
    (lines.join("") || `<div class="muted small">No recent lines match the filter.</div>`);
}

// ---------- the diary screen ----------
const prefs = (ui) => ui.diaryPrefs || (ui.diaryPrefs = { day: null, cats: ALL_CATS, robot: true, q: "", msg: "" });

// What the leader wrote that night: a few short sentences from the day's events.
export function leaderEntry(state, dayNo) {
  const sum = daySummary(state, dayNo);
  const entries = diaryEntries(state, dayNo).filter((e) => !e.robot);
  const pick = (arr) => arr[(dayNo * 7 + arr.length) % arr.length];
  const names = (rx) => [...new Set(entries.map((e) => rx.exec(e.text)).filter(Boolean).map((m) => firstName(m[1])))];
  const list = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
  const out = [];
  const w = weatherOnDay(state, dayNo);
  const sky = {
    clear: ["Clear skies.", "A bright day.", "Sun all day."], overcast: ["Grey skies.", "Overcast and still."],
    rain: ["Rain all day.", "Wet and muddy."], storm: ["A storm tore through.", "Wind and rain all day."],
    fog: ["Fog this morning.", "Couldn't see the tree line for the fog."], heat: ["Brutal heat.", "Too hot to work past noon."],
    drought: ["Still no rain.", "Dry again."], snow: ["Snow.", "More snow."], blizzard: ["A blizzard. Nobody went out.", "Whiteout."],
    frost: ["Hard frost.", "Frozen ground this morning."],
  }[w.key] || ["Another day."];
  out.push(pick(sky));
  const dead = names(/^(.+?) died\b/);
  if (dead.length) out.push(`We lost ${list(dead)}.`);
  const gone = names(/^(.+?) lost hope and walked away/);
  if (gone.length) out.push(`${list(gone)} walked out on us.`);
  const joined = names(/^(.+?) joined the group\./);
  if (joined.length) out.push(joined.length === 1 ? `A new face: ${joined[0]}.` : `New faces: ${list(joined)}.`);
  if (sum.battles) out.push(sum.battles === 1 ? pick(["We had to fight.", "A fight today."]) : `${sum.battles} fights today.`);
  if (sum.harvest) out.push(`Brought in ${sum.harvest} food from the fields.`);
  const built = [...new Set(entries.map((e) => /^(.+?) finished at /.exec(e.text)).filter(Boolean).map((m) => m[1]))].filter(isBuilding).slice(0, 2);
  if (sum.builds && built.length) out.push(`The ${built.join(" and the ").toLowerCase()} ${sum.builds === 1 ? "is" : "are"} done.`);
  if (sum.trades) out.push(sum.trades === 1 ? "Did some trading." : `${sum.trades} trades.`);
  const sick = entries.filter((e) => /came down with|got a (deep cut|sprain)/.test(e.text)).length;
  if (sick) out.push(sick === 1 ? "Someone's sick or hurt." : `${sick} sick or hurt.`);
  if (out.length === 1) out.push(pick(["A quiet day.", "Nothing much happened.", "We kept our heads down.", "Quiet. I'll take it."]));
  const L = survivorById(state, sum.leaderId);
  return { text: out.join(" "), by: L ? firstName(L.name) : "" };
}

function summaryChips(sum) {
  const bits = [];
  if (sum.deaths) bits.push(`<span class="danger">✝ ${plural(sum.deaths, "death")}</span>`);
  if (sum.desertions) bits.push(`<span class="danger">🚪 ${sum.desertions} left</span>`);
  if (sum.arrivals) bits.push(`<span class="good">＋${sum.arrivals} joined</span>`);
  if (sum.battles) bits.push(`<span class="warn">⚔ ${plural(sum.battles, "fight")}</span>`);
  if (sum.harvest) bits.push(`<span class="good">🌾 ${sum.harvest} food</span>`);
  if (sum.builds) bits.push(`<span>🔨 ${sum.builds} built</span>`);
  if (sum.trades) bits.push(`<span>🤝 ${plural(sum.trades, "trade")}</span>`);
  return bits;
}

function dayHead(state, dayNo) {
  const se = seasonOfDay(dayNo - 1), w = weatherOnDay(state, dayNo);
  return { icons: `${se.icon}${w.icon}`, text: `${se.icon} ${se.name} ${se.dayOfSeason}/${SEASON_DAYS} · ${w.icon} ${w.name}, ${Math.round(w.lo)} to ${Math.round(w.hi)} °C` };
}

function entryLine(e, dayNo) {
  return `<div class="k-${e.kind} dy-line"><span class="t">${dayNo != null ? `D${dayNo} ` : ""}${hh(e.hour)}</span>${linkText(e.text, e.refs)}</div>`;
}

export function diaryModal(state, ui) {
  diarySync(state);
  const p = prefs(ui);
  const today = day(state);
  const sel = Math.max(1, Math.min(today, p.day || today));
  const q = p.q.trim().toLowerCase();
  const filtering = q || p.cats !== ALL_CATS || !p.robot;
  // Matching lines per day (only worked out when a filter or search is on).
  const match = new Map();
  if (filtering) for (let d = 1; d <= today; d++) match.set(d, diaryEntries(state, d).filter((e) => passes(e, p.cats, p.robot, q, "")));
  const all = p.cats === ALL_CATS;
  const chips = `<button class="lgchip ${all ? "active" : ""}" data-action="dy-cat" data-c="all"${tip("Show every kind of line")}>All</button>` +
    CATEGORIES.map(([c, , label, icon]) => `<button class="lgchip ${!all && p.cats.includes(c) ? "active" : ""}" data-action="dy-cat" data-c="${c}"${tip(`Show ${label.toLowerCase()} (click more to add them; All shows everything)`)}>${icon} ${label}</button>`).join("") +
    `<button class="lgchip ${p.robot ? "active" : ""}" data-action="dy-robot"${tip(p.robot ? "Autopilot notes (🤖) are shown. Click to hide them." : "Autopilot notes (🤖) are hidden. Click to show them.")}>🤖 Autopilot</button>`;
  const search = `<input class="dy-search" data-action="dy-search" placeholder="Search the diary, then Enter" value="${esc(p.q)}"${tip("Type a name, a place or a word and press Enter: every day of the run is searched")}>` +
    (p.q ? `<button data-action="dy-clear"${tip("Clear the search")}>✕ Clear</button>` : "");

  // Day list, newest first.
  const rows = [];
  for (let d = today; d >= 1; d--) {
    const sum = daySummary(state, d);
    const head = dayHead(state, d);
    const m = match.get(d);
    const bits = summaryChips(sum);
    const right = filtering ? `<span class="${m.length ? "" : "muted"}">${plural(m.length, "line")}</span>` :
      bits.length ? bits.join(" ") : `<span class="muted">${sum.lines ? plural(sum.lines, "line") : "quiet"}</span>`;
    rows.push(`<div class="dy-day ${d === sel ? "on" : ""} ${filtering && !m.length ? "dim" : ""}" data-action="dy-day" data-d="${d}"><b>Day ${d}</b> <span class="dy-ico">${head.icons}</span> <span class="small">${right}</span></div>`);
  }

  let body;
  if (q) {
    // Search results across the whole run, newest first.
    const out = [];
    let n = 0;
    for (let d = today; d >= 1 && n < 300; d--) {
      const m = match.get(d);
      if (!m.length) continue;
      out.push(`<h3 class="dy-link" data-action="dy-day" data-d="${d}"${tip("Open this day")}>Day ${d}</h3>`);
      for (const e of m) { if (n++ >= 300) break; out.push(entryLine(e, null)); }
    }
    const total = [...match.values()].reduce((a, m) => a + m.length, 0);
    body = `<div class="dy-dayhead"><b>${plural(total, "line")} with “${esc(p.q)}”</b>${total > 300 ? ` <span class="muted small">(the newest 300 shown)</span>` : ""}</div>${out.join("") || `<div class="muted">Nothing in the diary matches.</div>`}`;
  } else {
    const head = dayHead(state, sel);
    const sum = daySummary(state, sel);
    const entries = filtering ? match.get(sel) : diaryEntries(state, sel);
    const le = leaderEntry(state, sel);
    const groups = CATEGORIES.map(([c, , label, icon]) => {
      const list = entries.filter((e) => e.cat === c);
      return list.length ? `<h3>${icon} ${label} (${list.length})</h3>${list.map((e) => entryLine(e, null)).join("")}` : "";
    }).join("");
    const bits = summaryChips(sum);
    body = `<div class="dy-dayhead"><b class="dy-big">Day ${sel}</b> <span class="muted">${esc(head.text)}</span>
        <span class="row" style="margin-left:auto"><button data-action="dy-day" data-d="${sel - 1}" ${sel <= 1 ? "disabled" : ""}${tip("The day before")}>◀</button><button data-action="dy-day" data-d="${sel + 1}" ${sel >= today ? "disabled" : ""}${tip("The day after")}>▶</button></span></div>
      <div class="dy-note"${tip("The leader's note for the day, written from what happened")}>“${esc(le.text)}”${le.by ? ` <span class="muted">— ${esc(le.by)}</span>` : ""}</div>
      ${bits.length ? `<div class="row small">${bits.join(" · ")}</div>` : ""}
      ${groups || `<div class="muted" style="margin-top:0.6rem">${sum.lines ? "Nothing on this day matches the filters." : "Nothing was written down this day."}</div>`}
      ${sum.more ? `<div class="muted small" style="margin-top:0.5rem">+${sum.more} more line${sum.more === 1 ? "" : "s"} that day were only counted (the diary keeps ${DIARY_CAP} a day).</div>` : ""}`;
  }
  const st = diaryStats(state);
  return `<div class="box diarybox">
    <div class="spread"><h1>📖 Diary</h1><span class="muted small"${tip("Every log line of the run is kept here, day by day (the log under the map keeps only the latest lines)")}>Day ${today} · ${st.lines} lines kept${st.dropped ? `, ${st.dropped} only counted` : ""}</span><button class="primary" data-action="dy-close"${tip("Close the diary (J or Esc)")}>Close</button></div>
    <div class="row dy-filters">${chips}</div>
    <div class="row dy-filters">${search}${p.msg ? `<span class="warn small">${esc(p.msg)}</span>` : ""}</div>
    <div class="dy-cols"><div class="dy-days basebody">${rows.join("")}</div><div class="dy-body">${body}</div></div>
  </div>`;
}

// ---------- actions ----------
const toggleCat = (cats, c) => {
  if (c === "all") return ALL_CATS;
  if (cats === ALL_CATS) return c; // from "everything", a chip picks just that kind
  const next = cats.includes(c) ? cats.replace(c, "") : cats + c;
  return next ? CATEGORIES.map((x) => x[0]).filter((x) => next.includes(x)).join("") : ALL_CATS;
};
export function openDiary(ui, dayNo = null) {
  const p = prefs(ui);
  p.msg = "";
  if (dayNo != null) p.day = dayNo;
  ui.roster = null;
  ui.diary = true;
}
export const DIARY_ACTIONS = {
  "dy-open": (state, ui, d) => { ui.logMsg = ""; openDiary(ui, d.d != null ? Number(d.d) : null); },
  "dy-close": (state, ui) => { ui.diary = null; },
  "dy-day": (state, ui, d) => {
    const p = prefs(ui);
    p.day = Math.max(1, Math.min(day(state), Number(d.d) || 1));
    p.q = ""; // a search hit opens its day (the category filters stay)
    p.msg = "";
  },
  "dy-cat": (state, ui, d) => { const p = prefs(ui); p.cats = toggleCat(p.cats, d.c); p.msg = ""; },
  "dy-robot": (state, ui) => { const p = prefs(ui); p.robot = !p.robot; },
  "dy-clear": (state, ui) => { prefs(ui).q = ""; },
  "lg-cat": (state, ui, d) => { const f = logPrefs(ui); f.cats = toggleCat(f.cats, d.c); ui.logMsg = ""; },
  "lg-robot": (state, ui) => { const f = logPrefs(ui); f.robot = !f.robot; },
  lk: (state, ui, d, act) => followLink(state, ui, d, act),
};
export const DIARY_CHANGE = {
  "dy-search": (state, ui, el) => { const p = prefs(ui); p.q = String(el.value ?? "").slice(0, 60); p.msg = ""; },
  "lg-base": (state, ui, el) => { logPrefs(ui).base = el.value || ""; },
};
export { CAT };
