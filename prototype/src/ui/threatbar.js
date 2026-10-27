// The top bar's threat forecast meter (docs/suggestions-5.md #19: "A 7-day threat forecast. One meter in the top bar
// for the coming week, combining weather, nearby hordes and their drift, raider intent you have heard on the radio,
// and food or water running out. Hover lists the causes. Feel: pressure you can see coming and plan for, instead of
// surprise."). A strip of seven small bars, today first, each as tall and as hot as the worst thing coming that day
// (calm, watch, danger, severe: colour and height both, so it reads without colour too), with the week's word over it.
// The days past what the sky can be read for (weather.js forecastRange) have a dashed edge: less is known of them.
// Hovering it, clicking it (a touch screen, a TV) or tabbing to it opens the causes day by day: what, how sure, whom
// it hits and where it comes from; a click on one shows it (the base's window, the team, the horde on the map). It
// opens and closes like the Needs button (ui/needsbar.js initNeedsBar); main.js writes its button, head and list as
// slots of their own, so an open list keeps the mouse and its scroll position. Everything in it is sim/forecast.js's.
import { threatForecast, levelName } from "../sim/forecast.js";
import { fogged } from "../sim/hardrules.js";
import { partyTile } from "../sim/parties.js";
import { baseById, survivorById } from "../sim/world.js";
import { initNeedsBar } from "./needsbar.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
export const TF_CLS = { btn: "tf-btn", panel: "tf-panel", open: "tf-open" };
const dayName = (d) => (d.offset === 0 ? "Today" : d.offset === 1 ? "Tomorrow" : `In ${d.offset} days`);
const pct = (c) => `${Math.round(c * 100)}%`;

// One cause: a button (a click shows it), its icon, the line, and under it where it comes from, how sure and whom it hits.
const rowHTML = (it) => {
  const meta = [it.source, `${it.sure} ${pct(it.confidence)}`, it.target && it.target.name].filter(Boolean).map(esc).join(" · ");
  const go = it.go ? ` data-action="tfc-go" data-key="${esc(it.key)}"` : " disabled";
  return `<button type="button" class="tf-row tf-l${it.level}"${go}${tip(`${levelName(it.level)}. ${it.why}${it.go ? " Click to see it." : ""}`)}><span class="tf-ic" aria-hidden="true">${it.icon || "•"}</span><span class="tf-txt">${esc(it.text)}<small>${meta}</small></span></button>`;
};

// The meter (the button), the panel's head and its list; the whole of it as one string (renderTopbar, tests).
export function threatBar(state, fc = null) {
  if (fogged(state, "forecast")) return `<span class="tf-title muted"${tip("Hardcore: no threat forecast. Watch the land yourself")}>No forecast (Hardcore)</span>`; // sim/hardrules.js
  fc = fc || threatForecast(state);
  const lvl = fc.level;
  const cells = fc.days.map((d) => `<i class="tf-cell tf-l${d.level}${d.known ? "" : " tf-far"}"></i>`).join("");
  const worst = fc.days.find((d) => d.level === lvl && lvl > 0);
  const aria = `Threat forecast, the next ${fc.days.length} days: ${levelName(lvl)}${worst ? `, worst ${dayName(worst).toLowerCase()}` : ""}. ${fc.days.map((d) => `${dayName(d)} ${levelName(d.level).toLowerCase()}`).join(", ")}.`;
  const btn = `<span class="tf-top"><span class="tf-word tf-l${lvl}">${levelName(lvl)}</span></span><span class="tf-cells" aria-hidden="true">${cells}</span><span class="tf-sr">${esc(aria)}</span>`;
  const n = fc.items.length;
  const head = `<span class="tf-title">Threat forecast · ${fc.days.length} days</span><span class="tf-sum small"><span class="tf-word tf-l${lvl}">${levelName(lvl)}</span>${n ? ` · ${n} ${n === 1 ? "cause" : "causes"}` : ""}</span>`;
  let list = "";
  if (fc.week.length) list += `<div class="tf-day tf-l${Math.max(...fc.week.map((x) => x.level))}"><span class="tf-dname">All week</span><span class="tf-dlvl">no day to it</span></div>${fc.week.map(rowHTML).join("")}`;
  let calm = [];
  const flushCalm = () => {
    if (!calm.length) return;
    const a = calm[0], b = calm[calm.length - 1];
    const name = calm.length === 1 ? `${dayName(a)} · day ${a.day}` : `Days ${a.day}–${b.day}`;
    list += `<div class="tf-day tf-l0 tf-quiet"><span class="tf-dname">${name}</span><span class="tf-dlvl">nothing seen coming</span></div>`;
    calm = [];
  };
  for (const d of fc.days) {
    if (!d.items.length) { calm.push(d); continue; }
    flushCalm();
    list += `<div class="tf-day tf-l${d.level}"><span class="tf-dname">${dayName(d)} · day ${d.day}</span><span class="tf-dlvl">${levelName(d.level)}</span></div>${d.items.map(rowHTML).join("")}`;
  }
  flushCalm();
  const range = fc.range;
  list += `<div class="tf-foot muted small"${tip("The forecast is what your people know: hordes in sight, tracked by a watchtower or seen in the last day; raids the lookouts saw or you heard on a group's channel (Listen in); outsiders you can see or hear; the stores at today's rates; the weather as far as it can be read. A horde you never saw is not on it.")}>Only what your people know. The sky reads ${range} days ahead${range < 5 ? ` (${range < 4 ? "a watchtower 4, " : ""}a radio station 5)` : ""}; dashed days are beyond it.</div>`;
  return { btn, head, list, level: lvl, html: threatSkeleton(btn, head, list) };
}
export const threatSkeleton = (btn = "", head = "", list = "") =>
  `<button type="button" class="tf-btn" id="tf-btn" aria-haspopup="true" aria-expanded="false" aria-controls="tf-panel">${btn}</button>` +
  `<div class="tf-panel" id="tf-panel" role="region" aria-label="Threat forecast: what is coming in the next days"><div class="tf-head" id="tf-head">${head}</div><div class="tf-list" id="tf-list" tabindex="0">${list}</div></div>`;

// Hover, click, focus, Esc and a click elsewhere, as the Needs button (its open state is a class on #tb-threat).
export const initThreatBar = (root, doc = document, win = window) => initNeedsBar(root, doc, win, TF_CLS);

// A cause clicked: the base's window (its tab), the team's panel, the horde or the place on the map, the person.
export const THREAT_ACTIONS = {
  "tfc-go": (state, ui, d, act) => {
    const it = threatForecast(state).items.find((x) => x.key === d.key);
    const g = it && it.go;
    if (!g) return;
    ui.diary = null;
    ui.roster = null;
    if (g.team != null) {
      const p = state.parties.find((x) => x.id === g.team);
      if (!p) return;
      act["xp-open"]({ id: p.id });
      act.center({ tile: partyTile(p) });
    } else if (g.base != null) {
      if (baseById(state, g.base)) act.openbase({ id: g.base, tab: g.tab || "overview" });
    } else if (g.tile != null) act.center({ tile: g.tile });
    else if (g.surv != null && survivorById(state, g.surv)) ui.survivor = g.surv;
  },
};
