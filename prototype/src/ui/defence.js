// The Defence tab (a base screen tab): the watch roster (sim/watch.js), the defence plans (sim/defenceplan.js) and
// concealment (sim/hiding.js: how well hidden the base is, Run silent; ui/intel.js).
// The roster: the watches (preset or by hand), who stands each, and a 24-hour strip of how many are on watch each hour
// (red: nobody). The plan: where each defender stands when the base is attacked, laid out in a drill on the base's
// own battle map and taken up by itself at the deploy step of every attack (changed there for that fight if need be).
import { atBase, baseById, hourOfDay, skill } from "../sim/world.js";
import { ROLES } from "../sim/economy.js";
import { isManaged } from "../sim/work.js";
import { holdSummary } from "../sim/defences.js";
import { BUILDINGS, count, wallOf, wallName } from "../sim/buildings.js";
import { minesLeft } from "../sim/mines.js"; // a minefield's mines still in the ground // the defenses built here (Construction, Defenses)
import {
  WATCH_PRESETS, SHIFT_MAX, shiftText, shiftHours, watchCoverage, watchLine, watchWhy, setWatchPreset, addShift, removeShift,
  setShiftHours, renameShift, toggleWatch, fillWatch, pruneWatch,
} from "../sim/watch.js";
import { startDrill, clearPlan, planPeople, plansOf, planTags, deletePlan, PLAN, PLAN_MAPS, PLAN_ROLES } from "../sim/defenceplan.js";
import { planChange } from "./combat.js"; // the drill's and the deploy step's plan picker, name and tags
import { rosterStrain, tiredLevel, TIRED, TIRED_WORDS } from "../sim/sleep.js"; // the watch's toll (roster card)
import { tiredChip } from "./needs.js";
import { concealCard } from "./intel.js"; // how well hidden the base is, Run silent (sim/hiding.js)

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const first = (s) => s.name.split(" ")[0];
const hh = (h) => String(h).padStart(2, "0");
const prefs = (ui) => ui.defence || (ui.defence = { msg: "" });
const say = (ui, msg) => { prefs(ui).msg = msg || ""; };

export function defenceTab(state, b, ui) {
  const pr = prefs(ui);
  pruneWatch(state, b);
  const people = atBase(state, b.id);
  const hold = holdSummary(state, b);
  return `<div class="deftab">
    ${pr.msg ? `<div class="result small">${esc(pr.msg)}</div>` : ""}
    <div class="grid2">
      <div>${rosterCard(state, b, people)}</div>
      <div>${planCard(state, b, people)}
        ${concealCard(state, b)}
        <h3>Holding the walls now</h3>
        <div class="card small"${tip("What this base's walls hold off before a horde breaks in (defences.js): the walls, everyone on guard (the watch counts here), the defence buildings and the armory's kit. A Wallbreaker cuts it.")}>
          <div class="kv"><div>Hold limit</div><div><b>${hold.limit}</b> of the dead (${hold.boss} with a Wallbreaker)</div>
          <div>On guard now</div><div>${people.filter((s) => s.role === "guard").map((s) => esc(first(s)) + tiredChip(s)).join(", ") || "nobody"}</div>
          <div>Defenses built</div><div>${esc(builtDefenses(b))}</div></div>
          <div class="row" style="margin-top:0.3rem"><button class="mini" data-action="cxtab" data-tab="defenses"${tip("Construction's Defenses list: walls by tier, wire, trenches and more for this size of base")}>Build defenses</button></div>
        </div>
      </div>
    </div>
  </div>`;
}

// What stands of the Defenses tab's list here (sim/buildings.js tab "defenses"), for the hold card.
function builtDefenses(b) {
  const w = wallOf(b);
  const rest = Object.entries(BUILDINGS).filter(([k, d]) => d.tab === "defenses" && k !== "walls" && count(b, k)).map(([k, d]) => `${count(b, k) > 1 ? `${count(b, k)} × ` : ""}${d.name.toLowerCase()}${k === "minefield" ? ` (${minesLeft(b)} mines)` : ""}`);
  return [w ? wallName(w) : "no wall", ...rest].join(", ");
}

// ---------- the watch roster ----------
function rosterCard(state, b, people) {
  const W = b.watch;
  const presetSel = `<select data-action="dwatch-preset" data-base="${b.id}"${tip("Set the watches at once. People on a watch with the same name or hours keep it.")}>
    <option value="">${W ? (W.preset && WATCH_PRESETS[W.preset] ? esc(WATCH_PRESETS[W.preset].name) : W.gov ? "The governor's night watch" : "Your own watches") : "No roster"}…</option>
    ${Object.entries(WATCH_PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join("")}
    ${W ? `<option value="none">No roster</option>` : ""}</select>`;
  let html = `<h3>Watch roster</h3>
    <div class="row">${presetSel}
      ${W && W.shifts.length < SHIFT_MAX ? `<button class="mini" data-action="dwatch-add" data-base="${b.id}"${tip("Add a watch (22–06 to start with; set its hours below)")}>+ Watch</button>` : ""}
      ${W ? `<button class="mini" data-action="dwatch-fill" data-base="${b.id}"${tip("Spread the people here over the watches: best shots first, the night watches first, about a third of everyone on the roster (at least one a watch). Replaces who stands each.")}>Fill from the people here</button>` : ""}
    </div>`;
  if (!W) {
    return html + `<div class="small muted" style="margin-top:0.4rem">No watch roster: lookouts come from work priorities (Guard) and the roles' schedules. A roster names who stands guard at which hours, whatever their job: pick a preset to start.</div>${watchHelp()}`;
  }
  html += coverageStrip(state, b);
  html += `<div class="small" style="margin:0.2rem 0 0.4rem">${esc(watchLine(state, b))}</div>`;
  const h = hourOfDay(state);
  W.shifts.forEach((sh, i) => {
    const now = shiftHours(sh) && ((sh.from === sh.to) || (sh.from < sh.to ? h >= sh.from && h < sh.to : h >= sh.from || h < sh.to));
    const on = sh.ids.map((id) => state.survivors.find((s) => s.id === id)).filter(Boolean);
    const chips = on.map((s) => {
      const why = watchWhy(state, b, s);
      const job = isManaged(state, s) ? "on work priorities" : `Manual: ${ROLES[(s.watchWas && s.watchWas.role) || s.role] ? ROLES[(s.watchWas && s.watchWas.role) || s.role].name : s.role} the rest of the day`;
      const lv = tiredLevel(s);
      return `<button class="chip ${why ? "off" : "on"}" data-action="dwatch-toggle" data-base="${b.id}" data-i="${i}" data-id="${s.id}"${tip(`${s.name} (Shooting ${skill(s, "shooting")}, ${job})${why ? `: not standing it: ${why}` : ""}${lv ? `. ${TIRED_WORDS[lv]}: owes ${Math.ceil(s.tired)} h of sleep` : ""}. Click to take them off this watch.`)}>${esc(first(s))}${lv ? ` <span class="${lv === 2 ? "danger" : "warn"}">${lv === 2 ? "Exhausted" : "Tired"}</span>` : ""} ✕</button>`;
    }).join("");
    const free = people.filter((s) => !sh.ids.includes(s.id) && !s.pinned);
    const hours = (k, v) => `<select data-action="dwatch-hours" data-base="${b.id}" data-i="${i}" data-k="${k}"${tip(k === "from" ? "Starts at" : "Ends at (the same hour as the start: all day)")}>${Array.from({ length: 24 }, (_, x) => `<option value="${x}" ${x === v ? "selected" : ""}>${hh(x)}:00</option>`).join("")}</select>`;
    html += `<div class="card small dshift${now ? " now" : ""}">
      <div class="spread"><span><input class="dshname" data-action="dwatch-name" data-base="${b.id}" data-i="${i}" value="${esc(sh.name)}" maxlength="20"${tip("Rename this watch")}> ${hours("from", sh.from)} – ${hours("to", sh.to)} <span class="muted">${shiftHours(sh)} h${now ? " · now" : ""}</span></span>
        <button class="mini" data-action="dwatch-del" data-base="${b.id}" data-i="${i}"${tip("Remove this watch")}>✕</button></div>
      <div style="margin-top:0.25rem">${chips || `<span class="muted">Nobody on this watch.</span>`}
        ${free.length ? `<select data-action="dwatch-addp" data-base="${b.id}" data-i="${i}"${tip("Put someone on this watch")}><option value="">+ Add…</option>${free.map((s) => `<option value="${s.id}">${esc(s.name)} (Shooting ${skill(s, "shooting")})</option>`).join("")}</select>` : ""}</div>
    </div>`;
  });
  return html + strainWarnings(state, b) + watchHelp();
}
const watchHelp = () => `<div class="small muted" style="margin-top:0.4rem">On their watch people stand guard whatever their job (and whatever their role's schedule says, so a night watch replaces the night's sleep): they count in the walls' hold limit, guard the cells and put down anyone who turns. People on work priorities take it before their priorities; Manual people go back to their job when it ends. The hurt, the sick, anyone away and pinned people do not stand it. Raid and horde warnings still send everyone with Guard set to the walls.<br>
  A watch in someone's sleep hours (their role's Sleep hours, else 22–06) keeps them up: off a long one they sleep until rested (people on work priorities miss work for it). Standing watches back to back, or night after night with too little sleep between, makes them Tired (aim ${TIRED.AIM[1]}, mood falls) and then Exhausted (aim ${TIRED.AIM[2]}, half as good on guard, and they may doze off).<br>
  At night someone awake on watch sees raiders and hordes coming two tiles sooner; with nobody on watch (and no tripwire alarm) an attack at night catches everyone asleep: raiders are over the wall before anyone wakes (the walls do not count, everyone but the guards fights half-asleep), a horde finds the defences unmanned (the defence buildings count half), and a battle opens with their volley.</div>`;
// The roster's toll on each person on it (sleep.js rosterStrain, from rested over a few days): back-to-back watches,
// and anyone it would leave Tired or Exhausted.
function strainWarnings(state, b) {
  const ids = [...new Set(b.watch.shifts.flatMap((sh) => sh.ids))];
  const out = [];
  for (const id of ids) {
    const s = state.survivors.find((x) => x.id === id);
    if (!s || !s.alive) continue;
    const mine = b.watch.shifts.filter((sh) => sh.ids.includes(id));
    const st = rosterStrain(state, b, s);
    const longest = Math.max(...mine.map(shiftHours));
    if (mine.length > 1 && st.run > longest) out.push(`${first(s)} stands ${mine.map((sh) => sh.name).join(" and ")} back to back: ${st.run >= 24 ? "round the clock" : `${st.run} hours on watch in a row`}.`);
    if (st.level) out.push(`${first(s)} would end up ${TIRED_WORDS[st.level]} on this roster (owing up to ${Math.ceil(st.peak)} h of sleep): too little sleep between watches.`);
  }
  return out.length ? `<div class="warn small" style="margin-top:0.3rem"${tip("What this roster does to the people on it over a few days, from rested (sim/sleep.js): Tired from " + TIRED.TIRED + " hours of sleep owed, Exhausted from " + TIRED.EXHAUSTED + ".")}>${out.map(esc).join("<br>")}</div>` : "";
}

function coverageStrip(state, b) {
  const cov = watchCoverage(state, b);
  const h = hourOfDay(state);
  const max = Math.max(1, ...cov.map((c) => c.n));
  return `<div class="dcov">${cov.map((c) => {
    const names = c.who.map(first).join(", ");
    const shifts = c.shifts.map((sh) => `${sh.name} ${shiftText(sh)}`).join(", ");
    const cls = c.n ? "" : " gap";
    return `<div class="dcell${cls}${c.h === h ? " cur" : ""}"${tip(`${hh(c.h)}:00 · ${c.n ? `${c.n} on watch: ${names}` : "nobody on watch"}${shifts ? ` (${shifts})` : " (no watch set)"}`)}><i style="height:${Math.round((c.n / max) * 100)}%"></i><span>${c.h % 3 === 0 ? hh(c.h) : ""}</span></div>`;
  }).join("")}</div>`;
}

// ---------- the defence plans ----------
// Each plan: its name and tags (who attacks, day or night: the attack takes up the one that fits best), the maps it
// has posts on, who holds a post by name and how many posts go by role; a drill to change it, delete.
function planCard(state, b, people) {
  const plans = plansOf(b);
  const inPlan = planPeople(state, b);
  const outOf = people.filter((s) => !inPlan.has(s));
  let html = `<h3>Defence plans</h3><div class="card small">`;
  if (!plans.length) html += `<div class="muted">No plan yet: in an attack your people take the default posts (the toughest in the gate, the best shots on the towers and the walkway, the rest behind cover).</div>`;
  for (const p of plans) {
    const maps = Object.entries(p.maps);
    const names = [], roles = {};
    for (const [, m] of maps) for (const [sid, , , role] of m.posts) {
      if (role) { roles[role] = (roles[role] || 0) + 1; continue; }
      const s = state.survivors.find((x) => x.id === sid);
      if (s && s.alive && !names.includes(first(s))) names.push(first(s));
    }
    const roleText = Object.entries(roles).map(([r, n]) => `${n} ${PLAN_ROLES[r].toLowerCase()}${n === 1 ? "" : "s"}`).join(", ");
    html += `<div class="dplan"><div class="spread"><span><b>${esc(p.name)}</b> <span class="muted">· ${esc(planTags(p))}</span></span>
      <span><button class="mini" data-action="dplan-drill" data-base="${b.id}" data-id="${p.id}" ${people.length ? "" : "disabled"}${tip(`Change the "${p.name}" plan in a drill (its name and tags too).`)}>Drill</button>
      <button class="mini" data-action="dplan-del" data-base="${b.id}" data-id="${p.id}"${tip(`Forget the "${p.name}" plan.`)}>✕</button></span></div>
      <div class="muted">${maps.length ? maps.map(([k, m]) => `${esc(PLAN_MAPS[k] || k)}: ${m.posts.length} post${m.posts.length === 1 ? "" : "s"}, day ${m.day}${m.lit ? `, floodlights ${m.lit}` : ""}`).join(" · ") : "No posts yet: open it in a drill and Save as plan."}</div>
      ${names.length || roleText ? `<div>${names.length ? `By name: ${esc(names.join(", "))}` : ""}${names.length && roleText ? " · " : ""}${roleText ? `By role: ${esc(roleText)}` : ""}</div>` : ""}</div>`;
  }
  const byRole = plans.some((p) => Object.values(p.maps).some((m) => m.posts.some((q) => q[3])));
  if (plans.length && outOf.length && !byRole) html += `<div class="warn" style="margin-top:0.3rem"${tip("People not in a plan by name take a post by role if one is free, else the default posts around the planned ones.")}>In no plan by name: ${esc(outOf.map(first).join(", "))}</div>`;
  html += `<div class="row" style="margin-top:0.4rem"><button class="primary" data-action="dplan-drill" data-base="${b.id}" ${people.length ? "" : "disabled"}${tip(people.length ? "Open this base's battle map as an attack would lay it out, with everyone here on it and nobody to fight: place them, Save as plan, close. In the drill: New plan, its name, who it is for (the dead, people) and when (day, night), posts by role. The clock stands still meanwhile." : "Nobody is here to drill.")}>${plans.length ? "Drill (plans)" : "Plan the defence (drill)"}</button></div>
    <div class="muted" style="margin-top:0.3rem">When the base is attacked the plan that fits the attack best is taken up by itself at the deploy step (a plan for the dead or for people beats one for any attack, a night or day plan beats one for both), and you can pick another or move people for that fight. Fights played out without you start from it as well. Up to ${PLAN.MAX} plans. A plan is for the map it was made on: when the base grows (walls, more buildings) plan it again. A post by role (best shot, close fighter, anyone) is filled by whoever fits it best, so it holds when people are away or new.</div>
    <div class="muted" style="margin-top:0.3rem">An attack on a base whose defences are not manned (no warning, no Prepare defenses) finds only the people on watch at their posts: the rest start in the buildings and come out once the attackers have moved.</div>
  </div>`;
  return html;
}

// ---------- actions ----------
const baseOf = (state, d) => baseById(state, Number(d.base));
export const DEFENCE_ACTIONS = {
  "dwatch-add": (state, ui, d) => { const b = baseOf(state, d); if (b) say(ui, addShift(state, b)); },
  "dwatch-del": (state, ui, d) => { const b = baseOf(state, d); if (b) say(ui, removeShift(state, b, Number(d.i))); },
  "dwatch-fill": (state, ui, d) => { const b = baseOf(state, d); if (b) say(ui, fillWatch(state, b)); },
  "dwatch-toggle": (state, ui, d) => { const b = baseOf(state, d); if (b) say(ui, toggleWatch(state, b, Number(d.i), d.id)); },
  "dplan-drill": (state, ui, d) => { const b = baseOf(state, d); if (!b) return; const err = startDrill(state, b.id, d.id != null ? Number(d.id) : null); if (err) say(ui, err); else { say(ui, ""); ui.baseView = null; ui.drillFrom = b.id; } }, // main.js tidyUi: back to this tab after
  "dplan-del": (state, ui, d) => { const b = baseOf(state, d); if (b) say(ui, deletePlan(state, b, Number(d.id))); },
};
export const DEFENCE_CHANGE = {
  "dwatch-preset": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b && el.value) say(ui, setWatchPreset(state, b, el.value)); },
  "dwatch-hours": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b) setShiftHours(state, b, Number(el.dataset.i), el.dataset.k === "from" ? el.value : null, el.dataset.k === "to" ? el.value : null); },
  "dwatch-name": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b) renameShift(state, b, Number(el.dataset.i), el.value); },
  "dwatch-addp": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b && el.value) say(ui, toggleWatch(state, b, Number(el.dataset.i), el.value)); },
  // The battle screen's plan controls (the drill, the deploy step: ui/combat.js planRow).
  "dplan-pick": (state, ui, el) => planChange(state, "pick", el.value),
  "dplan-name": (state, ui, el) => planChange(state, "name", el.value),
  "dplan-who": (state, ui, el) => planChange(state, "who", el.value),
  "dplan-when": (state, ui, el) => planChange(state, "when", el.value),
};
