// The Work tab (a base screen tab): the RimWorld-style work grid, the role editor, the schedule and the crews
// (sim/work.js, sim/crews.js). Rows are the people at the base, columns the work types; a cell holds a priority
// 1–5 or blank (never). A plain number is the role's default; a bold number with a ring is this person's own
// setting. Left-click counts up (blank → 1 → 2 … 5 → blank), right-click counts down, Shift+click changes the
// role's default for everyone in it, the number keys 1–5 set the cell under the mouse, 0 / Backspace / Delete
// clear it, R puts it back to the role's default.
import { atBase, survivorById, baseById, skill, hub } from "../sim/world.js";
import { ROLES } from "../sim/economy.js";
import { SKILL_NAMES } from "../sim/data.js";
import { assignStations } from "../sim/buildings.js";
import { COOK_SECOND, cookPlusOf, setCookPlus } from "../sim/kitchen.js"; // Cook + a second job (fixed, part-time)
import { assignedRole } from "../sim/noidle.js"; // a Manual person helping elsewhere this hour keeps their own job
import { STANCES } from "../sim/parties.js";
import { vehiclesAtBase } from "../sim/vehicles.js";
import { PERSONALITIES } from "../sim/autopilot.js";
import { RETREAT_POLICIES, POLICY_ORDER, STYLE_POLICY } from "../sim/breakoff.js";
import {
  WORK_TYPES, WORK_KEYS, PRIO_MAX, SCHED, SCHED_PRESETS, DEFAULT_ROLES, workState, roleById, roleOf, isManaged, cellOf,
  setCell, clearCell, setRoleCell, setRoleMin, setSched, schedAt, schedText, assignRole, toManual, createRole, duplicateRole,
  renameRole, deleteRole, roleMembers, everyoneOnPriorities, setNewcomers, taskLabel, taskWhy, planBase, MOOD_LOW, MOOD_BACK,
} from "../sim/work.js";
import { FIELD_TYPES, FIELD_KEYS, crewStatus, planCrewTrip, crewHold } from "../sim/crews.js";
import { SICK_REST_MODES, sickRestMode, setSickRest, sickRestLabel } from "../sim/sickrest.js"; // "Sick people rest"
import { LUNCH_HOURS, lunchHour, setLunchHour } from "../sim/meals.js"; // the lunch hour (every base)
import { statusIcons } from "./status.js"; // low mood, starving, thirsty, low health, infected, sick
import { undoBtn } from "./undo.js"; // ↶ Undo (and Ctrl+Z) for the edits on this tab
import { ask } from "./confirm.js"; // deleting a role asks first (one confirmation style)

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const first = (s) => s.name.split(" ")[0];
const prefs = (ui) => ui.work || (ui.work = { filter: "all", edit: null, msg: "" });
const up = (p) => (p >= PRIO_MAX ? 0 : p + 1);
const down = (p) => (p <= 0 ? PRIO_MAX : p - 1);
const PNAME = ["never", "1 (first)", "2", "3", "4", "5 (last)"];

// ---------- the role drop-down (base screen, roster, medical tab) ----------
// One list: the work roles (priorities) first, then the fixed jobs (Manual). Before the Work tab was ever opened
// the default roles are offered by name.
// The Cook (sim/kitchen.js) as a fixed job comes two ways: "Cook (kitchen all day)", or a part-time "Cook + <second
// job>" (value "cook+farm": the cooking hours at the stove, the second job the rest of the day).
export const COOK_PLUS_LABEL = "Cook (+ second job)";
export const cookPlusName = (k) => `Cook + ${ROLES[k] ? ROLES[k].name : k}`;
export function roleSelect(state, s, extra = "") {
  const role = roleOf(state, s);
  const plus = cookPlusOf(state, s);
  const roles = state.work ? state.work.roles.map((r) => [r.id, r.name, r.kind]) : DEFAULT_ROLES().map((r) => [`@${r.name}`, r.name, r.kind || "base"]);
  const own = assignedRole(s); // sim/noidle.js: their job, not the one they help with this hour
  const desc = role ? `${role.name}: works by its priorities (Work tab)${role.kind === "crew" ? " and goes on the crew's trips" : ""}.` : plus ? `Manual: ${cookPlusName(plus)}: cooks in the cooking hours (05:00–06:00, 16:00–20:00) and works as ${ROLES[plus].name} the rest of the day (counted at ${ROLES[plus].name} for the day's work).` : ROLES[own] ? `Manual: ${ROLES[own].desc}${own !== s.role && ROLES[s.role] ? ` (No work for it this hour: helping with ${ROLES[s.role].name} meanwhile.)` : ""}` : "Role";
  const fixedName = (k, r) => (k === "cook" ? "Cook (kitchen all day)" : r.name);
  return `<select data-action="role" data-id="${s.id}"${tip(desc)}${extra}>
    <optgroup label="Work roles (priorities)">${roles.map(([id, name, kind]) => `<option value="w:${esc(id)}" ${role && role.id === id ? "selected" : ""}>${esc(name)}${kind === "crew" ? " (crew)" : ""}</option>`).join("")}</optgroup>
    <optgroup label="Fixed job (Manual)">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${!role && !plus && own === k ? "selected" : ""}>${esc(fixedName(k, r))}</option>`).join("")}</optgroup>
    <optgroup label="${esc(COOK_PLUS_LABEL)}">${COOK_SECOND.map((k) => `<option value="cook+${k}" ${!role && plus === k ? "selected" : ""}>${esc(cookPlusName(k))}</option>`).join("")}</optgroup>
  </select>`;
}
// What they do now, for people on priorities; for Manual and pinned people only while they rest sick (sickrest.js).
export function taskChip(state, s) {
  if (!isManaged(state, s)) { const l = sickRestLabel(state, s); return l ? `<span class="small muted wtask"${tip(sickTip(s))}>→ ${esc(l)}</span>` : ""; }
  const t = taskLabel(state, s);
  if (!t) return "";
  return `<span class="small muted wtask"${tip(taskWhy(state, s))}>→ ${esc(t)}</span>`;
}
// A Manual or pinned person resting sick: what comes back when they are well.
export const sickTip = (s) => `Sick people rest (the Work tab): resting until it is gone (resting heals it faster)${s.sickWas && ROLES[s.sickWas.role] ? `; back to ${ROLES[s.sickWas.role].name} when well` : ""}.`;
// The Work tab's "Sick people rest" setting (sim/sickrest.js), for every base.
function sickRestSelect(state) {
  const m = sickRestMode(state);
  const desc = `Sick people rest, at every base: ${Object.values(SICK_REST_MODES).map((x) => `${x.name}: ${x.desc}`).join(" ")} Manual and pinned people too; they go back to their job when well. Any illness counts (an upset stomach from un-purified water or uncooked food too); injuries keep their own rules. A raid or a horde at the walls still takes them, and they fight if the base is attacked.`;
  return `<span${tip(desc)}>Sick people rest</span><select data-action="wsick"${tip(desc)}>${Object.entries(SICK_REST_MODES).map(([k, x]) => `<option value="${k}" ${m === k ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`;
}

// The lunch hour, at every base (sim/meals.js): an hour's break from all work, eaten to 80–100% full.
const hh = (h) => `${String(h).padStart(2, "0")}:00`;
const LUNCH_DESC = "Lunch, at every base: an hour when all work stops and everyone eats until they are 80–100% full (each their own target), with a small lift to mood. Building, crafting, repairs and the garage stop for it; people out on a job trip (wood, foraging, scavenging, water) stop where they are and eat from their pack (they take at least a day of food out with them), and that hour does not count toward their load. Guards stay on the walls. Breakfast (06:00; 10:00 for hunters and fishers) and dinner (20:00) stay where they are.";
function lunchSelect(state) {
  const L = lunchHour(state);
  return `<span class="row" style="flex-wrap:nowrap"><span${tip(LUNCH_DESC)}>Lunch</span><select data-action="wlunch"${tip(LUNCH_DESC)}>${LUNCH_HOURS.map((h) => `<option value="${h}" ${L === h ? "selected" : ""}>${hh(h)}–${hh(h + 1)}</option>`).join("")}</select></span>`;
}

// The role drop-down's change: a work role ("w:…") or a fixed job (Manual). Returns a message.
export function applyRoleChoice(state, s, value) {
  if (!s) return "";
  const v = String(value || "");
  let msg = "";
  delete s.helpWas; // sim/noidle.js: the job picked now holds (not given back as last hour's help ends)
  if (v.startsWith("w:")) {
    workState(state);
    const key = v.slice(2);
    const role = key.startsWith("@") ? state.work.roles.find((r) => r.name === key.slice(1)) : roleById(state, key);
    if (!role) return "That role is gone.";
    msg = assignRole(state, s, role.id);
  } else if (ROLES[v]) {
    toManual(state, s);
    delete s.cookPlus; // a fixed job of its own (sim/kitchen.js: not a Cook + second job any more)
    s.role = v;
    if (v !== "operate") s.station = null;
    msg = `${first(s)}: ${v === "cook" ? "Cook, the kitchen all day" : ROLES[v].name} (Manual).`;
  } else if (v.startsWith("cook+") && COOK_SECOND.includes(v.slice(5))) {
    toManual(state, s);
    setCookPlus(state, s, v.slice(5));
    msg = `${first(s)}: ${cookPlusName(v.slice(5))} (Manual): the cooking hours at the stove, ${ROLES[v.slice(5)].name} the rest of the day.`;
  } else return "";
  if (s.location.kind === "base") {
    const b = baseById(state, s.location.baseId);
    if (b) { planBase(state, b); assignStations(state, b); }
  }
  return msg;
}

// ---------- cells ----------
function cellHtml(c, attrs, title, extra = "") {
  const cls = `wcell p${c.p}${c.over ? " over" : ""}${c.watch ? " watch" : ""}${extra}`;
  return `<button class="${cls}" ${attrs}${tip(title)}>${c.p || ""}</button>`;
}
const cellTip = (T, c, who, role) => `${T.name} for ${who}: ${c.p ? `priority ${PNAME[c.p]}` : "never"}${c.watch ? ` (moved up from ${c.watch} by the watchtower's alarm: a horde is near; back to ${c.watch} when it has gone, or set it yourself to end that)` : c.over ? ` (their own; ${role.name}: ${c.def ? c.def : "never"})` : ` (${role.name}'s default)`}. ${T.desc} Left-click up, right-click down, Shift+click: the whole role, 1–5 / 0 / R on the keyboard.`;

// ---------- the tab ----------
export function workTab(state, b, ui) {
  const pr = prefs(ui);
  const w = state.work;
  const people = atBase(state, b.id);
  const roles = w ? w.roles : [];
  const shown = people.filter((s) => pr.filter === "all" || (pr.filter === "manual" ? !roleOf(state, s) : s.work && s.work.role === pr.filter));
  const managed = people.filter((s) => isManaged(state, s)).length;
  const head = `<tr><th>Survivor</th><th>Role</th>${WORK_KEYS.map((k) => `<th class="wth"${tip(`${WORK_TYPES[k].name}: ${WORK_TYPES[k].desc}${WORK_TYPES[k].skill ? ` Skill: ${SKILL_NAMES[WORK_TYPES[k].skill] || WORK_TYPES[k].skill}.` : ""}`)}>${esc(WORK_TYPES[k].short)}</th>`).join("")}<th>Now</th></tr>`;
  const rows = shown.map((s) => {
    const role = roleOf(state, s);
    const name = `<a class="link" data-action="survivor" data-id="${s.id}">${s.leader ? "★ " : ""}${esc(s.name)}</a>${statusIcons(state, s)}`; // people at a base: always in touch
    if (!role) {
      const sl = sickRestLabel(state, s);
      return `<tr class="wmanual"><td>${name}</td><td>${roleSelect(state, s)}</td><td colspan="${WORK_KEYS.length}" class="small muted">Manual: always ${esc(ROLES[s.role] ? ROLES[s.role].name : s.role)}. Pick a work role to let them choose their work by priorities.</td><td>${sl ? `<b${tip(sickTip(s))}>${esc(sl)}</b>` : ""}</td></tr>`;
    }
    const cells = WORK_KEYS.map((k) => {
      const c = cellOf(state, s, k);
      const min = role.min && role.min[k] && WORK_TYPES[k].skill && skill(s, WORK_TYPES[k].skill) < role.min[k];
      return `<td>${cellHtml(c, `data-action="wc" data-rc="1" data-id="${s.id}" data-k="${k}"`, cellTip(WORK_TYPES[k], c, first(s), role) + (min ? ` Below ${role.name}'s minimum (${SKILL_NAMES[WORK_TYPES[k].skill]} ${role.min[k]}): skipped.` : ""), min ? " below" : "")}</td>`;
    }).join("");
    const now = s.pinned ? `<span class="muted"${tip(`Pinned: keeps their job; priorities wait until you unpin them${sickRestLabel(state, s) ? `. ${sickTip(s)}` : ""}`)}>📌 Pinned (${esc(sickRestLabel(state, s) || (ROLES[s.role] ? ROLES[s.role].name : s.role))})</span>` :
      `<b>${esc(taskLabel(state, s) || "—")}</b><div class="small muted wwhy">${esc(taskWhy(state, s) || "Planned at the start of the next hour.")}</div>`;
    const overs = s.work && s.work.over && Object.keys(s.work.over).length;
    return `<tr><td>${name}${overs ? ` <button class="mini" data-action="wreset" data-id="${s.id}"${tip("Clear their own settings: back to the role's defaults")}>↺</button>` : ""}</td><td>${roleSelect(state, s)}</td>${cells}<td class="wnow">${now}</td></tr>`;
  }).join("");
  const filterOpts = [["all", "Everyone here"], ...roles.map((r) => [r.id, r.name]), ["manual", "Manual"]];
  const newcomers = w ? w.newcomers : null;
  return `<div class="worktab">
    <div class="row wbar">
      <select data-action="wfilter"${tip("Show one role")}>${filterOpts.map(([v, l]) => `<option value="${esc(v)}" ${pr.filter === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <button class="primary" data-action="weveryone" data-base="${b.id}"${tip("Everyone here on Manual gets a work role by what they do now: farmers Farmer, builders Builder, medics Medic, crafters and operators Crafter, everyone else (guards too) Generalist. Newcomers join Generalist.")}>Everyone here on priorities</button>
      <span${tip("The role new people get when they join (recruits, strangers, rescued people). Manual: they keep the job they come with.")}>Newcomers join</span>
      <select data-action="wnew">${[["", "Manual"], ...roles.map((r) => [r.id, r.name])].map(([v, l]) => `<option value="${esc(v)}" ${String(newcomers || "") === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
      ${sickRestSelect(state)}
      ${lunchSelect(state)}
      <span class="muted small">${managed} of ${people.length} here on priorities</span>
      ${undoBtn(state, ui, "work")}
    </div>
    ${pr.msg ? `<div class="result small">${esc(pr.msg)}</div>` : ""}
    <div class="wscroll"><table class="t worktbl">${head}${rows || `<tr><td colspan="${WORK_KEYS.length + 3}" class="muted">Nobody here matches.</td></tr>`}</table></div>
    <div class="small muted whelp">Every hour each person does the first work type, priority 1 first, that has work and room for more hands; at the same priority the most urgent work and the best skilled go first. Nothing at 1: they try 2, and so on; nothing at all: they rest. Before that: the badly hurt and the sick rest; a raid or horde warning sends everyone with Guard set to the walls; while a watchtower sees a horde near, Guard counts as priority 1 for anyone who has it lower (a backup job: the cell turns red) and the walls take more lookouts, until it has gone; the role's schedule (guard watch, free time, sleep); mood below ${MOOD_LOW} means free time until ${MOOD_BACK}. Manual people keep their fixed job and pinned people theirs; stewards only move Manual people. Stations follow their standing orders (Workshops tab).</div>
    ${roleEditor(state, ui, b)}
    ${crewsSection(state, ui)}
  </div>`;
}

// ---------- roles ----------
function roleEditor(state, ui, b) {
  const pr = prefs(ui);
  const w = state.work;
  if (!w) return `<h3>Roles</h3><div class="card small">The default roles (Generalist, Farmer, Builder, Guard, Medic, Crafter, Night watch and a Scavengers crew) appear when someone joins a role. <button data-action="wroles-init"${tip("Set up the default roles now without moving anyone")}>Show the roles</button></div>`;
  const role = roleById(state, pr.edit) || w.roles[0];
  const list = w.roles.map((r) => `<button class="${role && r.id === role.id ? "active" : ""}" data-action="wrole-edit" data-role="${r.id}"${tip(`${r.name}: ${roleMembers(state, r).length} member${roleMembers(state, r).length === 1 ? "" : "s"}${r.kind === "crew" ? " · a crew" : ""} · ${schedText(r)}`)}>${esc(r.name)}${r.kind === "crew" ? " 🚚" : ""} <span class="muted">${roleMembers(state, r).length}</span></button>`).join("");
  if (!role) return `<h3>Roles</h3><div class="row">${list}<button data-action="wrole-new">+ New role</button></div>`;
  const cells = WORK_KEYS.map((k) => {
    const c = { p: role.pri[k] || 0, over: false };
    return `<td>${cellHtml(c, `data-action="wrc" data-rc="1" data-role="${role.id}" data-k="${k}"`, `${WORK_TYPES[k].name} for ${role.name}: ${c.p ? `priority ${PNAME[c.p]}` : "never"}. Members follow this unless they have their own setting. ${WORK_TYPES[k].desc}`)}</td>`;
  }).join("");
  const mins = WORK_KEYS.map((k) => {
    const T = WORK_TYPES[k];
    if (!T.skill) return "<td></td>";
    const v = (role.min && role.min[k]) || 0;
    return `<td><select class="wmin" data-action="wmin" data-role="${role.id}" data-k="${k}"${tip(`Minimum ${SKILL_NAMES[T.skill] || T.skill} for ${T.name} in this role (members below it skip it)`)}>${[0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15].map((n) => `<option value="${n}" ${v === n ? "selected" : ""}>${n ? `${n}+` : "–"}</option>`).join("")}</select></td>`;
  }).join("");
  const L = lunchHour(state);
  const sched = Array.from({ length: 24 }, (_, h) => {
    const c = schedAt(role, h);
    const lunch = h === L && c === "w" ? " Lunch: all work stops for this hour (set at the top of the tab)." : "";
    return `<button class="wsch s-${c}${lunch ? " lunch" : ""}" data-action="wsched" data-rc="1" data-role="${role.id}" data-h="${h}"${tip(`${String(h).padStart(2, "0")}:00 ${SCHED[c].name}: ${SCHED[c].desc}${lunch} Click to change (Work → Guard → Free → Sleep), right-click back.`)}>${SCHED[c].short}</button>`;
  }).join("");
  return `<h3>Roles</h3>
    <div class="row wroles">${list}<button data-action="wrole-new"${tip("A new base role")}>+ New role</button><button data-action="wrole-new-crew"${tip("A new crew: its members go on trips by themselves (Crews below)")}>+ New crew</button></div>
    <div class="card wrolecard">
      <div class="spread"><input class="wname" data-action="wrole-name" data-role="${role.id}" maxlength="30" value="${esc(role.name)}"${tip("Rename the role (Enter)")}>
        <span><button data-action="wrole-dup" data-role="${role.id}"${tip("A copy of this role, with no members")}>Duplicate</button> <button data-action="wrole-del" data-role="${role.id}"${tip("Delete the role: its members go to Manual and keep the job they have now")}>Delete</button></span></div>
      <table class="t worktbl wroletbl"><tr><th></th>${WORK_KEYS.map((k) => `<th class="wth"${tip(WORK_TYPES[k].desc)}>${esc(WORK_TYPES[k].short)}</th>`).join("")}</tr>
        <tr><td class="small">Priority</td>${cells}</tr>
        <tr><td class="small"${tip("The least skill a member needs to do this work in this role")}>Min skill</td>${mins}</tr></table>
      <div class="spread" style="margin-top:0.5rem"><b class="small">Schedule</b><span class="small muted">${esc(schedText(role))}</span>
        <select data-action="wsched-preset" data-role="${role.id}"${tip("Set the whole day at once")}><option value="">Preset…</option>${Object.entries(SCHED_PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join("")}</select></div>
      <div class="wsched">${sched}</div>
      <div class="small muted">W work · G guard watch · F free time · S sleep. The underlined hour is lunch (${hh(L)}): all work stops for it. Free time and sleep give the Rest role's mood by the hour. Farming, stations, scavenging and study are counted at midnight: someone asleep then counts at their last work of the day.</div>
    </div>`;
}

// ---------- crews ----------
function crewsSection(state, ui) {
  const w = state.work;
  if (!w) return "";
  const crews = w.roles.filter((r) => r.kind === "crew");
  if (!crews.length) return "";
  const h = hub(state);
  return `<h3>Crews</h3>${crews.map((r) => crewCard(state, r, h)).join("")}`;
}
const num = (role, f, v, min, max, step, t) => `<label class="wcf"${tip(t)}>${esc(f[0])} <input type="number" data-action="wcrew-set" data-role="${role.id}" data-f="${f[1]}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
function crewCard(state, role, h) {
  const c = role.crew;
  const members = roleMembers(state, role);
  const field = FIELD_KEYS.map((k) => {
    const p = (c.field && c.field[k]) || 0;
    return `<label class="wcf">${cellHtml({ p, over: false }, `data-action="wfc" data-rc="1" data-role="${role.id}" data-k="${k}"`, `${FIELD_TYPES[k].name}: ${p ? `priority ${PNAME[p]}` : "never"}. ${FIELD_TYPES[k].desc}`)} ${esc(FIELD_TYPES[k].name)}</label>`;
  }).join("");
  const veh = h ? vehiclesAtBase(state, h.id) : [];
  const vOpts = [["auto", "Auto (a vehicle for 3+ tiles)"], ["foot", "On foot"], ...veh.map((v) => [String(v.id), v.name])];
  const r = c.rules || {};
  const hold = crewHold(state, role);
  return `<div class="card wcrew">
    <div class="spread"><b>🚚 ${esc(role.name)}</b><span class="small">${esc(crewStatus(state, role))}</span></div>
    <div class="small muted">${members.length ? `Members: ${members.map((s) => `${esc(first(s))}${s.location.kind === "base" && h && s.location.baseId === h.id ? "" : " (away)"}`).join(", ")}` : "No members yet: pick this role for people at the hub."} Trips leave from ${esc(h ? h.name : "the hub")} at 07:00; at home members work by the role's priorities.</div>
    <div class="row" style="margin-top:0.4rem">
      <button class="${c.paused ? "primary" : ""}" data-action="wcrew-pause" data-role="${role.id}"${tip(c.paused ? "Resume: the crew plans trips again" : "Pause: no new trips (a team out comes home as planned)")}>${c.paused ? "Resume" : "Pause"}</button>
      <button data-action="wcrew-go" data-role="${role.id}" ${hold ? "disabled" : ""}${tip(hold ? `Not now: ${hold}` : "Plan and send a trip now instead of at 07:00")}>Send now</button>
      <label${tip("Off: the crew stops and asks you about fights with people, hives, recruits, raids and jobs. On: it answers everything the way the governor would (risky).")}><input type="checkbox" data-action="wcrew-all" data-role="${role.id}" ${c.handleAll ? "checked" : ""}> Handle everything</label>
    </div>
    <div class="small" style="margin-top:0.4rem"><b>Field priorities</b> (1 first; the best trip within the limits)</div>
    <div class="row wfield">${field}</div>
    <div class="row wcrewset">
      ${num(role, ["Range (tiles)", "range"], c.range, 2, 40, 1, "Farthest tile from the hub a trip may go")}
      ${num(role, ["Max hours out", "maxHours"], c.maxHours, 4, 96, 2, "Longest way out, in hours")}
      ${num(role, ["Team size", "size"], c.size, 1, 6, 1, "People on a trip (the fittest members go)")}
      ${num(role, ["Rounds each", "ammo"], c.ammo, 0, 40, 1, "Rounds packed per person, of their own gun's calibre (the hub keeps 20)")}
      ${num(role, ["Meds", "meds"], c.meds, 0, 6, 1, "Meds packed (only while the hub has 4+)")}
      ${num(role, ["Rest days", "rest"], c.rest, 0, 7, 1, "Days at home between trips")}
      <label class="wcf"${tip("Pace on the road")}>Stance <select data-action="wcrew-set" data-role="${role.id}" data-f="stance">${Object.entries(STANCES).map(([k, s]) => `<option value="${k}" ${c.stance === k ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
      <label class="wcf"${tip("Which vehicle the team takes")}>Vehicle <select data-action="wcrew-set" data-role="${role.id}" data-f="vehicle">${vOpts.map(([v, l]) => `<option value="${esc(v)}" ${String(c.vehicle) === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <label class="wcf"${tip("The governor's judgement it uses for sites, searches and road cards")}>Style <select data-action="wcrew-set" data-role="${role.id}" data-f="style">${Object.entries(PERSONALITIES).filter(([, p]) => !p.base).map(([k, p]) => `<option value="${k}" ${c.style === k ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
      <label class="wcf"${tip("Retreat if it goes badly: when the crew's fights are resolved by the numbers, it breaks them off by this rule (by its style: Cautious and Balanced if losing, Aggressive when most are down)")}>Retreat <select data-action="wcrew-set" data-role="${role.id}" data-f="retreat"><option value="" ${!RETREAT_POLICIES[c.retreat] ? "selected" : ""}>By style (${esc(RETREAT_POLICIES[STYLE_POLICY[c.style || "balanced"] || "losing"].name.toLowerCase())})</option>${POLICY_ORDER.map((k) => `<option value="${k}" ${c.retreat === k ? "selected" : ""}>${esc(RETREAT_POLICIES[k].name)}</option>`).join("")}</select></label>
    </div>
    <div class="row wcrewset small"><b>Come home when</b>
      ${num(role, ["anyone is below (health)", "rules.hurt"], r.hurt || 0, 0, 90, 5, "0 = never for this reason")}
      ${num(role, ["food is below (days)", "rules.food"], r.food || 0, 0, 10, 0.5, "0 = never for this reason")}
      <label><input type="checkbox" data-action="wcrew-cargo" data-role="${role.id}" ${r.cargo ? "checked" : ""}> the cargo is full</label>
    </div>
    ${(c.log || []).length ? `<div class="small" style="margin-top:0.4rem"><b>Last trips</b>${c.log.map((e) => `<div class="muted">Day ${e.day}: ${esc(e.why)} · ${esc(e.result)} (${e.hours}h)</div>`).join("")}</div>` : `<div class="small muted" style="margin-top:0.4rem">No trips yet.</div>`}
  </div>`;
}

// ---------- actions ----------
const say = (ui, msg) => { prefs(ui).msg = msg || ""; };
function cellClick(state, ui, d, dir, shift) {
  const s = survivorById(state, Number(d.id));
  const role = roleOf(state, s);
  if (!s || !role) return;
  const c = cellOf(state, s, d.k);
  if (shift) { setRoleCell(state, role, d.k, dir > 0 ? up(c.def) : down(c.def)); say(ui, `${role.name}: ${WORK_TYPES[d.k].name} ${role.pri[d.k] || "never"} for everyone in the role.`); }
  else setCell(state, s, d.k, dir > 0 ? up(c.p) : down(c.p));
  replan(state, s);
}
function replan(state, s) {
  if (s && s.location.kind === "base") { const b = baseById(state, s.location.baseId); if (b) planBase(state, b); }
}
const replanAll = (state) => { if (state.work) for (const b of state.bases) planBase(state, b); };
const roleOfD = (state, d) => roleById(state, d.role);
function roleCell(state, ui, d, dir) {
  const r = roleOfD(state, d);
  if (!r) return;
  setRoleCell(state, r, d.k, dir > 0 ? up(r.pri[d.k] || 0) : down(r.pri[d.k] || 0));
  replanAll(state);
}
function fieldCell(state, d, dir) {
  const r = roleOfD(state, d);
  if (!r || !r.crew) return;
  r.crew.field = r.crew.field || {};
  const v = dir > 0 ? up(r.crew.field[d.k] || 0) : down(r.crew.field[d.k] || 0);
  if (v) r.crew.field[d.k] = v; else delete r.crew.field[d.k];
}
const SCHED_ORDER = ["w", "g", "f", "s"];
function schedCell(state, d, dir) {
  const r = roleOfD(state, d);
  if (!r) return;
  const h = Number(d.h);
  const i = SCHED_ORDER.indexOf(schedAt(r, h));
  setSched(r, h, SCHED_ORDER[(i + (dir > 0 ? 1 : 3)) % 4]);
  replanAll(state);
}

// Click actions get (state, ui, dataset, event); right-click arrives with ev.button === 2 (main.js).
export const WORK_ACTIONS = {
  wc: (state, ui, d, ev) => cellClick(state, ui, d, ev && ev.button === 2 ? -1 : 1, !!(ev && ev.shiftKey)),
  wrc: (state, ui, d, ev) => roleCell(state, ui, d, ev && ev.button === 2 ? -1 : 1),
  wfc: (state, ui, d, ev) => fieldCell(state, d, ev && ev.button === 2 ? -1 : 1),
  wsched: (state, ui, d, ev) => schedCell(state, d, ev && ev.button === 2 ? -1 : 1),
  wreset: (state, ui, d) => { const s = survivorById(state, Number(d.id)); if (s && s.work) { s.work.over = {}; replan(state, s); say(ui, `${first(s)} follows the role's defaults again.`); } },
  weveryone: (state, ui, d) => { const b = baseById(state, Number(d.base)); if (b) { say(ui, everyoneOnPriorities(state, b)); planBase(state, b); } },
  "wroles-init": (state) => { workState(state); },
  "wrole-edit": (state, ui, d) => { prefs(ui).edit = d.role; },
  "wrole-new": (state, ui) => { const r = createRole(state); prefs(ui).edit = r.id; say(ui, `${r.name} created: set its priorities below.`); },
  "wrole-new-crew": (state, ui) => { const r = createRole(state, "New crew", "crew"); prefs(ui).edit = r.id; say(ui, `${r.name} created: pick members at the hub and set its field priorities under Crews.`); },
  "wrole-dup": (state, ui, d) => { const r = duplicateRole(state, roleOfD(state, d)); if (r) { prefs(ui).edit = r.id; say(ui, `${r.name} created.`); } },
  "wrole-del": (state, ui, d) => {
    const role = roleOfD(state, d);
    if (role && ask(ui, d, "wrole-del", { kind: "delrole", title: `Delete the role ${role.name || ""}?`, text: "Its priorities are gone for good. Its members go to Manual and keep the job they have now.", yes: "Delete it" })) return;
    say(ui, deleteRole(state, role)); prefs(ui).edit = null;
  },
  "wcrew-pause": (state, ui, d) => { const r = roleOfD(state, d); if (r && r.crew) { r.crew.paused = !r.crew.paused; say(ui, `${r.name}: ${r.crew.paused ? "paused" : "trips again"}.`); } },
  "wcrew-all": (state, ui, d) => { const r = roleOfD(state, d); if (r && r.crew) r.crew.handleAll = !r.crew.handleAll; },
  "wcrew-cargo": (state, ui, d) => { const r = roleOfD(state, d); if (r && r.crew) { r.crew.rules = r.crew.rules || {}; r.crew.rules.cargo = !r.crew.rules.cargo; } },
  "wcrew-go": (state, ui, d) => { const r = roleOfD(state, d); if (r && r.crew) say(ui, planCrewTrip(state, r) || `${r.name}: ${r.crew.status || crewHold(state, r) || "no trip"}.`); },
};
export const WORK_CHANGE = {
  wfilter: (state, ui, el) => { prefs(ui).filter = el.value || "all"; },
  wnew: (state, ui, el) => { setNewcomers(state, el.value || null); say(ui, el.value ? `Newcomers join ${roleById(state, el.value).name}.` : "Newcomers keep the job they come with (Manual)."); },
  wlunch: (state, ui, el) => { if (setLunchHour(state, el.value)) say(ui, `Lunch at every base: ${hh(state.lunchHour)}–${hh(state.lunchHour + 1)}. All work stops for the hour.`); },
  wsick: (state, ui, el) => { const m = setSickRest(state, el.value); if (m) { for (const b of state.bases) planBase(state, b); say(ui, m); } },
  "wrole-name": (state, ui, el) => { say(ui, renameRole(state, roleById(state, el.dataset.role), el.value)); },
  wmin: (state, ui, el) => { setRoleMin(state, roleById(state, el.dataset.role), el.dataset.k, el.value); replanAll(state); },
  "wsched-preset": (state, ui, el) => { const r = roleById(state, el.dataset.role); const p = SCHED_PRESETS[el.value]; if (r && p) { r.sched = p.sched; replanAll(state); say(ui, `${r.name}: ${p.name}.`); } },
  "wcrew-set": (state, ui, el) => {
    const r = roleById(state, el.dataset.role);
    if (!r || !r.crew) return;
    const f = el.dataset.f;
    const c = r.crew;
    const n = Number(el.value);
    if (f === "stance") { if (STANCES[el.value]) c.stance = el.value; return; }
    if (f === "vehicle") { c.vehicle = el.value || "auto"; return; }
    if (f === "style") { if (PERSONALITIES[el.value]) c.style = el.value; return; }
    if (f === "retreat") { c.retreat = RETREAT_POLICIES[el.value] ? el.value : null; return; } // breakoff.js
    if (!Number.isFinite(n)) return;
    const lim = { range: [2, 40], maxHours: [4, 96], size: [1, 6], ammo: [0, 40], meds: [0, 6], rest: [0, 7], "rules.hurt": [0, 90], "rules.food": [0, 10] }[f];
    if (!lim) return;
    const v = Math.max(lim[0], Math.min(lim[1], f === "rules.food" ? Math.round(n * 2) / 2 : Math.round(n)));
    if (f.startsWith("rules.")) { c.rules = c.rules || {}; c.rules[f.slice(6)] = v; } else c[f] = v;
  },
};

// Number keys over a cell (main.js keydown): 1–5 set, 0 / Backspace / Delete clear, R back to the role's default.
export function workKey(state, ui, e) {
  const hv = ui.workHover;
  if (!hv || !ui.baseView || ui.baseView.tab !== "work") return false;
  const m = /^(Digit|Numpad)([0-5])$/.exec(e.code);
  const clear = e.code === "Backspace" || e.code === "Delete";
  const reset = e.code === "KeyR";
  if (!m && !clear && !reset) return false;
  const v = m ? Number(m[2]) : 0;
  if (hv.action === "wc") {
    const s = survivorById(state, Number(hv.id));
    if (!s || !roleOf(state, s)) return false;
    if (reset) clearCell(state, s, hv.k); else setCell(state, s, hv.k, v);
    replan(state, s);
    return true;
  }
  const r = roleById(state, hv.role);
  if (!r || reset) return false;
  if (hv.action === "wrc") { setRoleCell(state, r, hv.k, v); replanAll(state); return true; }
  if (hv.action === "wfc" && r.crew) { r.crew.field = r.crew.field || {}; if (v) r.crew.field[hv.k] = v; else delete r.crew.field[hv.k]; return true; }
  return false;
}
