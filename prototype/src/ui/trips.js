// Order templates and Repeat trip on screen (sim/trips.js): the planner's Templates box (apply one, Save as
// template, the retreat policy, ↶ Undo), the Teams tab's Templates and Recent trips lists, and the alert when a team
// sent from the planner gets home. main.js registers TRIP_ACTIONS / TRIP_CHANGE with an api: { plan, autofill }
// (its "plan" action, which opens the planner on a tile, and the planner's auto-fill).
import { tileLabel } from "../sim/parties.js";
import { RETREAT_POLICIES, POLICY_ORDER } from "../sim/breakoff.js";
import {
  TRIPS, templates, recentTrips, templateById, recentById, saveTemplate, renameTemplate, deleteTemplate, applySpec,
  applyPacking, specSummary, recentLabel, defaultTemplateName,
} from "../sim/trips.js";
import { undoBtn } from "./undo.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const when = (h) => `day ${Math.floor(h / 24) + 1}, ${String(h % 24).padStart(2, "0")}:00`;
const destOk = (state, t) => Number.isInteger(t) && t >= 0 && t < state.tiles.length;

// ---------- the planner ----------
export function plannerTrips(state, ui) {
  const pl = ui.planner;
  if (!pl) return "";
  const list = templates(state);
  const use = list.map((t) => `<button class="mini" data-action="tpl-use" data-id="${t.id}"${tip(`Apply "${t.name}" to this trip: ${specSummary(t)}. Anyone who cannot go gets a stand-in with the same job; what changed is listed here.`)}>${esc(t.name)}</button>`).join("");
  const pol = pl.policy && RETREAT_POLICIES[pl.policy] ? pl.policy : "";
  const policy = `<label class="small"${tip("Retreat if it goes badly: when the team's fights are resolved by the numbers it breaks them off by this rule (you can change it later on its cards). Not set: it fights it out.")}>Retreat <select data-action="pl-policy"><option value="" ${pol ? "" : "selected"}>Not set (fight it out)</option>${POLICY_ORDER.map((k) => `<option value="${k}" ${pol === k ? "selected" : ""}>${esc(RETREAT_POLICIES[k].name)}</option>`).join("")}</select></label>`;
  const notes = pl.tplNotes;
  return `<div class="card small tplbox" style="margin-bottom:0.5rem">
    <div class="row" style="flex-wrap:wrap;gap:0.3rem"><b${tip("Saved team setups: mission, stance, retreat policy, crew (with stand-ins by job when someone cannot go), vehicle, supplies, tablets and lights, and the plan's steps. The Teams tab lists them too, with the recent trips to repeat.")}>Templates</b>
      ${use || `<span class="muted">none yet</span>`}
      <span style="margin-left:auto" class="row">
        <input type="text" class="tiny" style="width:9rem" maxlength="${TRIPS.NAME_LEN}" data-action="tpl-name" placeholder="${esc(defaultTemplateName(state, pl))}" value="${esc(ui.tplName || "")}"${tip("The template's name (the same name again updates that template)")}>
        <button class="mini" data-action="tpl-save" ${pl.crew.size ? "" : "disabled"}${tip(pl.crew.size ? "Keep this setup under the name to send it again in a click (saved with the campaign)" : "Pick a crew first")}>Save as template</button>
        ${undoBtn(state, ui, "plan")}
      </span></div>
    <div class="row" style="margin-top:0.25rem">${policy}</div>
    ${notes ? `<div class="${notes.notes.length ? "warn" : "good"}" style="margin-top:0.25rem">${esc(notes.name)}: ${notes.notes.length ? notes.notes.map(esc).join(" ") : "everything as saved."}</div>` : ""}
    ${pl.note ? `<div class="muted" style="margin-top:0.25rem">${esc(pl.note)}</div>` : ""}
  </div>`;
}

// ---------- the Teams tab ----------
export function teamsTrips(state, ui) {
  const list = templates(state), recent = recentTrips(state);
  const tpl = list.map((t) => {
    const armed = ui.tplArmed === t.id, del = ui.tplDelArm === t.id;
    const target = destOk(state, t.dest) ? tileLabel(state, t.dest) : null;
    return `<div class="card small">
      <input type="text" class="tiny" style="width:100%" maxlength="${TRIPS.NAME_LEN}" data-action="tpl-rename" data-id="${t.id}" value="${esc(t.name)}"${tip("Rename (Enter)")}>
      <div class="muted">${esc(specSummary(t))}</div>
      <div class="row" style="margin-top:0.25rem;flex-wrap:wrap;gap:0.25rem">${target ? `<button class="mini" data-action="tpl-plan" data-id="${t.id}"${tip(`Open the planner for ${target} (where it was saved) with this setup`)}>Plan → ${esc(target)}</button>` : ""}<button class="mini ${armed ? "active" : ""}" data-action="tpl-pick" data-id="${t.id}"${tip(armed ? "Picking a target: right-click a tile and choose a trip (or Plan a trip in its panel). Click again to stop." : "Pick another target on the map: the next trip you plan gets this setup")}>${armed ? "Picking…" : "Pick target…"}</button><button class="mini ${del ? "danger" : ""}" data-action="tpl-del" data-id="${t.id}"${tip(del ? "Click again to delete it" : "Delete this template")}>${del ? "Delete?" : "✕"}</button></div></div>`;
  }).join("");
  const trips = recent.map((r) => `<div class="card small"><div class="spread"><b>${esc(recentLabel(state, r))}</b><button class="mini" data-action="tr-repeat" data-id="${r.id}"${tip("Open the planner with the same target, mission, plan and supplies, the same people if they are fit (stand-ins by job if not): Send team confirms")}>Repeat trip</button></div>
      <span class="muted">${esc(r.label)} · home ${when(r.home)}</span></div>`).join("");
  return `<h3${tip("Saved team setups (the planner's Save as template). Plan → sends one to the target it was saved at; Pick target… applies it to the next trip you plan.")}>Templates</h3>
    ${tpl || `<div class="muted small">None yet: in the trip planner, Save as template keeps a setup to send again in a click.</div>`}
    ${trips ? `<h3${tip("The last trips sent from the planner that got home")}>Recent trips</h3>${trips}` : ""}
    ${ui.tripMsg ? `<div class="small result">${esc(ui.tripMsg)}</div>` : ""}`;
}

// ---------- Help (ui/help.js) ----------
export function tripsHelp() {
  return `<b>Order templates.</b> In the trip planner the <i>Templates</i> box keeps a setup under a name (<i>Save as template</i>; the same name again updates it): the mission, stance, retreat policy (the box's <i>Retreat</i> list), the crew, the vehicle, supplies, tablets and lights, and the plan's steps and conditions. Click a template there to apply it to the trip you are planning. The Teams tab lists your templates: rename them, delete them (✕ twice), <i>Plan →</i> sends one to the target it was saved at, <i>Pick target…</i> applies it to the next trip you plan (right-click a tile and pick a trip). Anyone who cannot go (dead, away, hurt under ${TRIPS.FIT_HEALTH} health, in a hospital bed, too ill) gets a stand-in: the best fit person at the hub with the same job, else the same best skills. A missing vehicle becomes one of its kind, <i>Move to a site</i> steps planned from another target are dropped, and supplies are packed as saved as far as the hub has them. The box lists everything that changed; the planner's warnings check the supplies against the new trip.<br><br>
    <b>Repeat trip.</b> A team sent from the planner remembers its setup. When it gets home an alert (🔁) offers to repeat it for a day, and the Teams tab keeps the last ${TRIPS.RECENT} under <i>Recent trips</i>: <i>Repeat trip</i> opens the planner on the same target with the same mission, plan, supplies and people (stand-ins as above). <i>Send team</i> confirms.<br><br>
    <b>Undo.</b> ↶ Undo, or <b>Ctrl+Z</b> while the screen is open, takes back the last change, one step at a time (up to 20): in the trip planner, a base's Construction tab (queueing, cancelling and moving jobs with ▲ ▼; the first job is the one being built) and the Work tab (priorities, roles, schedules, crews' settings). What has already happened stays: a team sent, a building finished, a job the builders started on, materials used since. Never in a battle.`;
}

// ---------- the alert (ui/alerts.js) ----------
export function tripAlerts(state, out) {
  for (const r of recentTrips(state)) {
    if (state.hour - r.home >= TRIPS.HOME_HOURS) continue;
    out.push({ key: `trip:${r.id}`, kind: "trip", icon: "🔁", tone: "good", text: `Home from ${recentLabel(state, r)}: repeat it?`, tip: `${r.label} is home. Click to open the planner with the same target, mission, plan and supplies, and the same people if they are fit (stand-ins by job if not): Send team confirms.`, go: { act: "tr-repeat", id: r.id }, event: true });
  }
}

// ---------- applying a setup ----------
// Opens the planner on dest with spec applied; name heads the notes on what changed.
function openWith(state, ui, api, spec, dest, name) {
  ui.tplArmed = null;
  api.plan({ tile: dest, mission: spec.mission });
  const pl = ui.planner;
  if (!pl) return null;
  fill(state, pl, api, spec, name);
  return pl;
}
function fill(state, pl, api, spec, name) {
  const notes = applySpec(state, pl, spec);
  api.autofill(pl);
  notes.push(...applyPacking(state, pl, spec));
  pl.tplNotes = { name, notes };
}
// main.js "plan" action: a template picked on the Teams tab goes onto the planner just opened.
export function useArmedTemplate(state, ui, pl, autofill) {
  const t = ui.tplArmed != null ? templateById(state, ui.tplArmed) : null;
  ui.tplArmed = null;
  if (t && pl) fill(state, pl, { autofill }, t, `Template "${t.name}"`);
}

export const TRIP_ACTIONS = {
  "tpl-use": (state, ui, d, api) => { const t = templateById(state, d.id); if (t && ui.planner) { fill(state, ui.planner, api, t, `Template "${t.name}"`); ui.plannerError = ""; } },
  "tpl-save": (state, ui) => {
    if (!ui.planner) return;
    const r = saveTemplate(state, ui.planner, ui.tplName);
    ui.planner.note = r.msg;
    if (r.template) ui.tplName = "";
  },
  "tpl-plan": (state, ui, d, api) => { const t = templateById(state, d.id); if (t && destOk(state, t.dest)) openWith(state, ui, api, t, t.dest, `Template "${t.name}"`); },
  "tpl-pick": (state, ui, d) => {
    const t = templateById(state, d.id);
    if (!t) return;
    ui.tplArmed = ui.tplArmed === t.id ? null : t.id;
    ui.tripMsg = ui.tplArmed != null ? `Pick the target for "${t.name}": right-click a tile and choose a trip; the planner opens with the template applied.` : "";
  },
  "tpl-del": (state, ui, d) => {
    const id = Number(d.id);
    if (ui.tplDelArm !== id) { ui.tplDelArm = id; ui.tripMsg = "Click ✕ again to delete the template."; return; }
    ui.tplDelArm = null;
    if (ui.tplArmed === id) ui.tplArmed = null;
    ui.tripMsg = deleteTemplate(state, id);
  },
  "tr-repeat": (state, ui, d, api) => {
    const r = recentById(state, d.id);
    if (r && destOk(state, r.dest)) openWith(state, ui, api, r.spec, r.dest, `Repeat: ${recentLabel(state, r)}`);
  },
};
export const TRIP_CHANGE = {
  "tpl-name": (state, ui, el) => { ui.tplName = String(el.value || "").slice(0, TRIPS.NAME_LEN); },
  "tpl-rename": (state, ui, el) => { ui.tripMsg = renameTemplate(state, el.dataset.id, el.value); },
  "pl-policy": (state, ui, el) => { if (ui.planner) ui.planner.policy = RETREAT_POLICIES[el.value] ? el.value : null; },
};
