// The roster (R or the Roster button in the top bar): every survivor in one table — where they are, role, health,
// mood and the risk of leaving, conditions, every skill (with the progress to the next point when skills.js has
// it), weapon, armor and traits. Sort by any column, filter by base, role and status, change roles in the row or
// for every ticked row at once, click a name for the survivor screen.
import { alive, skill, baseById, factionById } from "../sim/world.js";
import { SKILLS, SKILL_NAMES, TRAITS } from "../sim/data.js";
import { ROLES } from "../sim/economy.js";
import * as Buildings from "../sim/buildings.js";
import { conditionsOf } from "../sim/health.js";
import { condChip, wormChip } from "./health.js"; // icon, name and days left; the worm once spotted
import { moodRisk, MOOD_RISK_TIP } from "../sim/morale.js";
import { armorPower } from "../sim/inventory.js";
import { contactable } from "../sim/orders.js";
import { MISSIONS } from "../sim/parties.js";
import * as Skills from "../sim/skills.js";
import { roleOf, roleById, toManual } from "../sim/work.js";
import { roleSelect, taskChip, applyRoleChoice } from "./work.js";
import { gaugeMini } from "./needs.js";
import { hungerOf, thirstOf } from "../sim/needs.js";
import { rosterChildren } from "./family.js"; // the children under the table (sim/family.js)

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const SHORT = { shooting: "Shoot", stealth: "Stealth", scavenging: "Scav", scouting: "Scout", medicine: "Med", mechanics: "Mech", farming: "Farm", speech: "Speech", leadership: "Lead" };

// Skill progress from skills.js (XP to the next point), when it offers skillProgress(s, key).
let skillProgress = typeof Skills.skillProgress === "function" ? Skills.skillProgress : null;
export const setSkillProgress = (fn) => { skillProgress = typeof fn === "function" ? fn : null; }; // tests
// 0..1 to the next point, or null. Takes a number (0..1 or a percent) or an object ({ frac | progress | pct | xp + need/next }).
export function progressOf(s, key) {
  if (!skillProgress) return null;
  let r;
  try { r = skillProgress(s, key); } catch { return null; }
  let f = null;
  if (typeof r === "number") f = r > 1 ? r / 100 : r;
  else if (r && typeof r === "object") {
    if (typeof r.frac === "number") f = r.frac;
    else if (typeof r.fraction === "number") f = r.fraction;
    else if (typeof r.progress === "number") f = r.progress > 1 ? r.progress / 100 : r.progress;
    else if (typeof r.pct === "number") f = r.pct / 100;
    else if (typeof r.xp === "number" && (r.need || r.next || r.max)) f = r.xp / (r.need || r.next || r.max);
  }
  return f == null || !Number.isFinite(f) ? null : Math.max(0, Math.min(1, f));
}

// In touch: at a base, escorting a route, or on a team you have contact with (the People tab's rule).
function known(state, s) {
  const k = s.location && s.location.kind;
  if (k === "base" || k === "route") return true;
  if (k !== "party") return false;
  const p = state.parties.find((x) => x.id === s.location.partyId);
  return !!p && (p.kind === "convoy" || contactable(p));
}
function where(state, s) {
  const l = s.location || {};
  if (l.kind === "base") { const b = baseById(state, l.baseId); return { key: `b${l.baseId}`, text: b ? b.name : "a base", sort: `0 ${b ? b.name : ""}` }; }
  if (l.kind === "party") {
    const p = state.parties.find((x) => x.id === l.partyId);
    const m = p && MISSIONS[p.teamMission || p.mission];
    return { key: "team", text: p ? (p.kind === "convoy" ? "Convoy" : `${m ? m.name : "Team"} team`) : "On a team", sort: `1 ${m ? m.name : ""}` };
  }
  if (l.kind === "route") return { key: "away", text: "Trade route escort", sort: "2" };
  if (l.kind === "errand") return { key: "away", text: `Errand (back ~day ${l.until})`, sort: "2" };
  if (l.kind === "captive") { const f = factionById(state, l.factionId); return { key: "away", text: `Held by ${f && f.known ? f.name : "captors"}`, sort: "3" }; }
  return { key: "away", text: "Away", sort: "4" };
}

// ---------- state ----------
const prefs = (ui) => ui.rosterPrefs || (ui.rosterPrefs = { sort: "name", dir: 1, base: "all", role: "all", status: "all", sel: [], msg: "" });
export function openRoster(ui) {
  prefs(ui).msg = "";
  ui.diary = null;
  ui.roster = true;
}
const STATUS = {
  all: ["Everyone", () => true],
  hurt: ["Hurt (health below 70)", (s, k) => k && s.health < 70],
  sick: ["Sick or injured", (s, k) => k && conditionsOf(s).length > 0],
  unhappy: ["Unhappy (risk of leaving)", (s, k) => k && !!moodRisk(s) && moodRisk(s).level >= 1],
  fine: ["Fit and content", (s, k) => k && s.health >= 70 && !conditionsOf(s).length && !(moodRisk(s) && moodRisk(s).level >= 1)],
  nocontact: ["No contact", (s, k) => !k],
};
export function rosterRows(state, ui) {
  const p = prefs(ui);
  const rows = alive(state).map((s) => ({ s, w: where(state, s), k: known(state, s) }));
  const st = STATUS[p.status] || STATUS.all;
  const out = rows.filter((r) => (p.base === "all" || r.w.key === p.base) && (p.role === "all" || r.s.role === p.role) && st[1](r.s, r.k));
  const val = (r) => {
    const s = r.s, k = p.sort;
    if (k === "name") return s.name;
    if (k === "where") return r.w.sort + r.w.text;
    if (k === "role") return r.w.key.startsWith("b") ? (ROLES[s.role] ? ROLES[s.role].name : s.role) : "~";
    if (k === "health") return r.k ? s.health : -1;
    if (k === "mood") return r.k ? s.mood : -1;
    if (k === "needs") return r.k ? Math.min(hungerOf(s), thirstOf(s)) : -1; // the lower of hunger and thirst (sim/needs.js)
    if (k === "cond") return r.k ? conditionsOf(s).reduce((a, c) => a + 100 + (c.sev || 0), 0) : -1;
    if (k === "weapon") return s.gear && s.gear.weapon ? s.gear.weapon.name : "~";
    if (k === "armor") return armorPower(s);
    if (k === "traits") return s.traits.map((t) => (TRAITS[t] ? TRAITS[t].name : t)).join(", ");
    if (k.startsWith("sk:")) return skill(s, k.slice(3)) + (progressOf(s, k.slice(3)) || 0) / 2;
    return 0;
  };
  return out.sort((a, b) => {
    const x = val(a), y = val(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return (c || a.s.name.localeCompare(b.s.name)) * p.dir;
  });
}

// ---------- the table ----------
export function rosterModal(state, ui) {
  const p = prefs(ui);
  const rows = rosterRows(state, ui);
  const living = alive(state);
  p.sel = p.sel.filter((id) => living.some((s) => s.id === id)); // the dead and departed drop out of the selection
  const sel = new Set(p.sel);
  const th = (k, label, t) => `<th><button class="ro-th ${p.sort === k ? "on" : ""}" data-action="ro-sort" data-k="${k}"${tip(`${t ? `${t} ` : ""}Click to sort${p.sort === k ? " the other way" : ""}`)}>${label}${p.sort === k ? (p.dir > 0 ? " ▲" : " ▼") : ""}</button></th>`;
  const roleSel = (s) => `${roleSelect(state, s)}${taskChip(state, s)}`; // work roles and fixed jobs (ui/work.js)
  const body = rows.map(({ s, w, k }) => {
    const risk = k ? moodRisk(s) : null;
    const hp = n0(s.health);
    const skills = SKILLS.map((key) => {
      const v = skill(s, key), pr = progressOf(s, key);
      return `<td class="ro-sk"${tip(`${SKILL_NAMES[key]} ${v}${pr != null ? ` · ${Math.round(pr * 100)}% to the next point` : ""}`)}><b class="${v >= 12 ? "good" : v <= 3 ? "muted" : ""}">${v}</b>${pr != null ? `<span class="ro-xp"><i style="width:${Math.round(pr * 100)}%"></i></span>` : ""}</td>`;
    }).join("");
    const weapon = s.gear && s.gear.weapon ? s.gear.weapon.name : "";
    const body2 = s.gear && s.gear.armor ? s.gear.armor.name : "";
    const ap = Math.round(armorPower(s) * 10) / 10;
    return `<tr class="${sel.has(s.id) ? "on" : ""}">
      <td><input type="checkbox" data-action="ro-sel" data-id="${s.id}" ${sel.has(s.id) ? "checked" : ""}${tip("Tick to change roles for several people at once")}></td>
      <td class="ro-name"><a class="lk" data-action="ro-open" data-id="${s.id}"${tip("Open their survivor screen: skills, traits, gear, inventory")}>${s.leader ? "★ " : ""}${esc(s.name)}</a></td>
      <td>${esc(w.text)}</td>
      <td>${w.key.startsWith("b") ? roleSel(s) : `<span class="muted"${tip("Roles are set at a base")}>${esc(ROLES[s.role] ? ROLES[s.role].name : s.role)}</span>`}</td>
      <td>${k ? `<div class="ro-hp"><span class="${hp < 40 ? "danger" : hp < 70 ? "warn" : "good"}">${hp}</span><div class="bar"><i style="width:${hp}%;background:${hp < 40 ? "var(--danger)" : "var(--good)"}"></i></div></div>` : `<span class="muted"${tip("No contact: unknown until the team reports in")}>?</span>`}</td>
      <td>${k ? `${n0(s.mood)}${risk ? ` <span class="${risk.tone}"${tip(MOOD_RISK_TIP)}>${esc(risk.text)}</span>` : ""}` : `<span class="muted">?</span>`}</td>
      <td>${k ? gaugeMini(s) : `<span class="muted">?</span>`}</td>
      <td>${k ? wormChip(state, s) + conditionsOf(s).map((c) => condChip(state, s, c)).join("") + (s.woundInfected ? `<span class="chip off">Infected wound</span>` : "") + (s.inBed ? `<span class="chip">in bed</span>` : "") : ""}</td>
      ${skills}
      <td>${esc(weapon) || `<span class="muted">none</span>`}</td>
      <td${tip(`Armor ${ap} from worn pieces`)}>${body2 ? esc(body2) : `<span class="muted">none</span>`}${ap ? ` <span class="muted">(${ap})</span>` : ""}</td>
      <td>${s.traits.map((t) => `<span class="chip trait"${tip(TRAITS[t] ? TRAITS[t].desc : "")}>${esc(TRAITS[t] ? TRAITS[t].name : t)}</span>`).join("")}</td>
    </tr>`;
  }).join("");
  const baseOpts = [["all", "All places"], ...state.bases.map((b) => [`b${b.id}`, b.name]), ["team", "On teams"], ["away", "Away (errands, routes, captives)"]];
  const sel1 = (action, cur, opts, t) => `<select data-action="${action}"${tip(t)}>${opts.map(([v, l]) => `<option value="${v}" ${cur === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const visibleIds = rows.map((r) => r.s.id);
  const allOn = visibleIds.length > 0 && visibleIds.every((id) => sel.has(id));
  return `<div class="box rosterbox">
    <div class="spread"><h1>👥 Roster</h1><span class="muted">${rows.length} of ${living.length} shown${sel.size ? ` · ${sel.size} ticked` : ""}</span><button class="primary" data-action="ro-close"${tip("Close the roster (R or Esc)")}>Close</button></div>
    <div class="row ro-bar">
      ${sel1("ro-filter-base", p.base, baseOpts, "Show people at one base, on teams, or away")}
      ${sel1("ro-filter-role", p.role, [["all", "All roles"], ...Object.entries(ROLES).map(([k, r]) => [k, r.name])], "Show one role")}
      ${sel1("ro-filter-status", p.status, Object.entries(STATUS).map(([k, v]) => [k, v[0]]), "Show by health and mood")}
      <span class="ro-sep"></span>
      <span${tip("People away from a base keep their role until they are back")}>Set role for ${sel.size} ticked:</span>
      <select data-action="ro-bulkrole" ${sel.size ? "" : "disabled"}${tip("Pick a role: everyone ticked who is at a base gets it")}><option value="">Choose…</option>${state.work ? `<optgroup label="Work roles (priorities)">${state.work.roles.map((r) => `<option value="w:${esc(r.id)}">${esc(r.name)}</option>`).join("")}</optgroup>` : ""}<optgroup label="Fixed job (Manual)">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}">${esc(r.name)}</option>`).join("")}</optgroup></select>
      ${sel.size ? `<button data-action="ro-clearsel"${tip("Untick everyone")}>Clear</button>` : ""}
      ${p.msg ? `<span class="warn">${esc(p.msg)}</span>` : ""}
    </div>
    <div class="basebody ro-wrap"><table class="t ro-table"><thead><tr>
      <th><input type="checkbox" data-action="ro-selall" ${allOn ? "checked" : ""}${tip("Tick or untick everyone shown")}></th>
      ${th("name", "Name")}${th("where", "Where")}${th("role", "Role")}${th("health", "Health")}${th("mood", "Mood")}${th("needs", "Needs", "Hunger, thirst and mood bars (sorted by the lower of hunger and thirst).")}${th("cond", "Conditions")}
      ${SKILLS.map((k) => th(`sk:${k}`, SHORT[k] || k, SKILL_NAMES[k] + ".")).join("")}
      ${th("weapon", "Weapon")}${th("armor", "Armor", "Body armor and the armor of all worn pieces.")}${th("traits", "Traits")}
    </tr></thead><tbody>${body || `<tr><td colspan="${11 + SKILLS.length}" class="muted">Nobody matches the filters.</td></tr>`}</tbody></table>${rosterChildren(state)}</div>
  </div>`;
}

// ---------- actions ----------
// Same rule as the role drop-down on the People tab (main.js): off a station unless operating, then the base's
// stations are handed out again.
export function setRole(state, s, role) {
  if (!s || !s.location || s.location.kind !== "base") return false;
  if (String(role).startsWith("w:")) return !!applyRoleChoice(state, s, role) && !!roleOf(state, s); // a work role (ui/work.js)
  if (!ROLES[role]) return false;
  toManual(state, s); // a fixed job: off work priorities
  s.role = role;
  if (role !== "operate") s.station = null;
  const b = baseById(state, s.location.baseId);
  if (b && typeof Buildings.assignStations === "function") Buildings.assignStations(state, b);
  return true;
}
export const ROSTER_ACTIONS = {
  "ro-toggle": (state, ui) => { if (ui.roster) ui.roster = null; else openRoster(ui); },
  "ro-open": (state, ui, d) => { ui.survivor = Number(d.id); },
  "ro-close": (state, ui) => { ui.roster = null; },
  "ro-sort": (state, ui, d) => { const p = prefs(ui); if (p.sort === d.k) p.dir = -p.dir; else { p.sort = d.k; p.dir = ["name", "where", "role", "weapon", "traits"].includes(d.k) ? 1 : -1; } },
  "ro-sel": (state, ui, d) => { const p = prefs(ui), id = Number(d.id); p.sel = p.sel.includes(id) ? p.sel.filter((x) => x !== id) : [...p.sel, id]; p.msg = ""; },
  "ro-selall": (state, ui) => {
    const p = prefs(ui), ids = rosterRows(state, ui).map((r) => r.s.id);
    p.sel = ids.every((id) => p.sel.includes(id)) ? p.sel.filter((id) => !ids.includes(id)) : [...new Set([...p.sel, ...ids])];
    p.msg = "";
  },
  "ro-clearsel": (state, ui) => { const p = prefs(ui); p.sel = []; p.msg = ""; },
};
export const ROSTER_CHANGE = {
  "ro-filter-base": (state, ui, el) => { prefs(ui).base = el.value || "all"; },
  "ro-filter-role": (state, ui, el) => { prefs(ui).role = el.value || "all"; },
  "ro-filter-status": (state, ui, el) => { prefs(ui).status = el.value || "all"; },
  "ro-bulkrole": (state, ui, el) => {
    const p = prefs(ui), role = el.value;
    const work = String(role).startsWith("w:") ? roleById(state, role.slice(2)) : null;
    if (!ROLES[role] && !work) return;
    let done = 0, skipped = 0;
    for (const id of p.sel) setRole(state, state.survivors.find((s) => s.id === id), role) ? done++ : skipped++;
    p.msg = `${done} set to ${work ? work.name : ROLES[role].name}${skipped ? `; ${skipped} not at a base kept their role` : ""}.`;
  },
};
