// The land order box (the user's request 2026-10-23: "For gathering LAND orders for Forage, Hunt, Fish, Cut Wood,
// Gather Stones when you select provide a input dialogue to set how many hours and estimated amount of yield depending
// on how many hours and the gear of the team/survivor(s) inventory and skills"). Picking Forage, Hunt, Fish, Cut wood or
// Gather stone (the team panel's Land row, the map's right-click menu, the low-food list's Go) opens it: the hours
// (2 to 24: a slider, a number and 4 / 8 / 12 / 24), what that many hours would bring (sim/landest.js: the team's
// people, their skills and the tool or weapon each would use, the land, the season and the clock), the same for the
// other lengths, and how much to bring back at most (the old "how much?" box, ui/carry.js, for the kinds it carried).
//   ui.landAsk  { via ("xp" | "tc" | "ctxhunt": the action it runs again), d (that action's data), type, tile,
//                startHour, hours, qty (null: as much as fits) }
// The action runs again with d.hours, d.qty and d.asked = "1" (main.js: "xp-order", "tc-do", ctxhunt).
// main.js: LAND_ACTIONS / LAND_CHANGE are registered like the carry box's; landHtml is drawn with the confirmation box;
// landKey takes Enter / Esc while it is up. tools/landordertest.js.
import { partyTile, tileLabel, partyMembers } from "../sim/parties.js";
import { collectInfo, COLLECT } from "../sim/carry.js";
import { landEstimate, landEstimates, isLandJob, LAND_VERB, LAND_HOURS, clampHours } from "../sim/landest.js";
import { subTeam, isSome } from "../sim/detach.js"; // some of the team picked to do it (ui/teamctx.js): their gear and skills

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n1 = (x) => (Math.abs(x) >= 10 || Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : String(Math.round(x * 10) / 10)); // whole from 10 up
const amountText = (e) => `~${n1(e.amount)} ${e.unit}`;

// Opens the box for a land job not yet asked (d.asked) and not for the autopilot. Returns true when it did.
// o: { via, type, tile, startHour, hours }.
export function askLand(state, ui, d, o) {
  if (!isLandJob(o.type) || (d && d.asked === "1") || state.autopilot) return false;
  const p = state.parties.find((x) => x.id === Number(d.id));
  if (!p || !partyMembers(state, p).length) return false;
  const data = {};
  for (const k of Object.keys(d || {})) if (k !== "asked" && k !== "qty") data[k] = d[k];
  ui.landAsk = { via: o.via, d: data, type: o.type, tile: o.tile ?? partyTile(p), startHour: o.startHour ?? state.hour, hours: clampHours(o.hours ?? d.hours ?? LAND_HOURS.def), qty: null };
  return true;
}

// The box's model (the tools read it): the estimate for the hours set, the other lengths, the quantity's limits.
export function landModel(state, ui) {
  const a = ui.landAsk;
  const team = a && state.parties.find((x) => x.id === Number(a.d.id));
  if (!team) return null;
  const who = a.d.who ? String(a.d.who).split(",").map(Number) : null;
  const p = who && isSome(state, team, who) ? subTeam(state, team, who, a.type) : team; // only those picked, with what they take along
  const opts = { tile: a.tile, startHour: a.startHour };
  const info = COLLECT[a.type] ? collectInfo(state, p, a.type) : null;
  const qty = info && a.qty != null ? Math.max(0, Math.min(info.max, Math.floor(a.qty))) : null;
  const est = landEstimate(state, p, a.type, { ...opts, hours: a.hours, qty });
  const lengths = landEstimates(state, p, a.type, LAND_HOURS.presets, { ...opts, qty });
  // Every length the slider can take, for the headline as it is dragged (before the box is drawn again on release).
  const all = [];
  for (let h = LAND_HOURS.min; h <= LAND_HOURS.max; h++) all.push(amountText(landEstimate(state, p, a.type, { ...opts, hours: h, qty })));
  return { p, a, est, lengths, all, info, qty };
}

function qtyRow(m) {
  const { info, qty, a } = m;
  if (!info) return `<div class="small muted" style="margin-top:0.4rem">The team brings back as much as it can carry: ${n1(m.est.room)} kg free.</div>`;
  const q = qty ?? info.max;
  const hands = Math.max(0, Math.min(q, Math.ceil(m.est.amount)) - info.stowed); // of what the job is expected to bring
  return `<div class="small" style="margin-top:0.5rem"${tip("The work stops early once that much is in. What does not fit in packs, pockets or a vehicle is carried in the arms: whoever carries it cannot shoot or fight with a weapon until it is set down.")}><b>Bring back at most</b> <span class="muted">(${esc(info.name)}, ${n1(info.kg)} kg each; room for ${info.max})</span></div>
    <div class="row" style="gap:0.5rem;align-items:center;margin:0.2rem 0">
      <input type="range" min="0" max="${info.max}" step="1" value="${q}" data-action="land-qty" style="flex:1" oninput="this.nextElementSibling.value=this.value">
      <input type="number" min="0" max="${info.max}" step="1" value="${q}" data-action="land-qty" style="width:5rem">
      <button class="mini${a.qty == null || q >= info.max ? " active" : ""}" data-action="land-setqty" data-n=""${tip("As much as the team can carry")}>Max</button>
      ${Number.isFinite(info.stowed) && info.stowed > 0 && info.stowed < info.max ? `<button class="mini" data-action="land-setqty" data-n="${info.stowed}"${tip("As much as goes in the packs, pockets and the vehicle: nobody's hands full")}>Packs only (${info.stowed})</button>` : ""}
    </div>${hands > 0 ? `<div class="small warn">About ${hands} of what it brings would be carried in the arms (no weapon in a fight until set down).</div>` : ""}`;
}

function landBox(state, ui) {
  const m = landModel(state, ui);
  if (!m) { ui.landAsk = null; return ""; }
  const { a, est, p } = m;
  const verb = LAND_VERB[a.type];
  const wait = a.startHour - state.hour;
  const when = a.tile === partyTile(p) && wait < 0.5 ? "here, starting now" : `${esc(tileLabel(state, a.tile))}, starting in about ${n1(wait)}h`;
  const presets = m.lengths.map((x) => `<button class="mini${x.hours === a.hours ? " active" : ""}" data-action="land-sethours" data-h="${x.hours}"${tip(`${verb} ${x.hours} hours: ~${n1(x.amount)} ${est.unit}`)}>${x.hours}h · ~${n1(x.amount)}</button>`).join("");
  const crew = est.crew.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.gear)}</td><td>${c.mult > 0 ? `×${n1(c.mult)}` : "—"}</td><td class="muted">${esc(c.skills)}</td></tr>`).join("");
  const capped = est.capped ? `<div class="small warn">About ${n1(est.all)} ${esc(est.unit)} worked in all: the rest is left (no room to carry it${a.qty != null ? ", or past the most asked for" : ""}).</div>` : "";
  return `<div class="askwrap"><div class="askbox" role="dialog" style="max-width:34rem">
    <div class="asktitle">${esc(verb)}: how long?</div>
    <div class="asktext small muted">${partyMembers(state, p).length} ${partyMembers(state, p).length === 1 ? "person" : "people"}, ${when}.</div>
    ${est.why ? `<div class="small danger">Cannot now: ${esc(est.why)}</div>` : ""}
    <div class="row" style="gap:0.5rem;align-items:center;margin:0.5rem 0 0.2rem">
      <input type="range" min="${LAND_HOURS.min}" max="${LAND_HOURS.max}" step="1" value="${a.hours}" data-action="land-hours" data-est="${esc(JSON.stringify(m.all))}" style="flex:1" oninput="this.nextElementSibling.value=this.value;const t=JSON.parse(this.dataset.est),e=document.getElementById('landest');if(e)e.textContent=t[this.value-${LAND_HOURS.min}]">
      <input type="number" min="${LAND_HOURS.min}" max="${LAND_HOURS.max}" step="1" value="${a.hours}" data-action="land-hours" style="width:4rem"> hours
    </div>
    <div class="row" style="gap:0.3rem;flex-wrap:wrap">${presets}</div>
    <div class="card" style="margin-top:0.5rem"><div${tip("An average from the land, the season, the weather, the time of day and the team: a run can bring more or less")}>Expected in ${a.hours}h: <b id="landest">${esc(amountText(est))}</b> <span class="muted">(${n1(est.kg)} kg${est.perHour > 0 ? `, about ${n1(est.perHour)} an hour` : ""})</span></div>${capped}
      ${est.kit ? `<div class="small muted">Gear: ${esc(est.kit)}.</div>` : ""}
      <table class="small" style="width:100%;margin-top:0.3rem"><tr class="muted"><td>Who</td><td>Gear</td><td${tip("How much each one brings, from their skills, health and gear (1 = an average person with the usual gear); the best counts full, each one more a little less")}>Rate</td><td>Skills</td></tr>${crew}</table>
      ${est.notes.map((t) => `<div class="small muted">${esc(t)}</div>`).join("")}
    </div>
    ${qtyRow(m)}
    <div class="askbtns"><button class="primary" data-action="land-go" data-tip="Enter"${est.why ? " disabled" : ""}>${esc(verb)} ${a.hours}h</button><button data-action="land-close" data-tip="Esc">Cancel</button></div>
  </div></div>`;
}

export const landHtml = (state, ui) => (ui.landAsk ? landBox(state, ui) : "");
export function landKey(state, ui, e, actions) {
  if (!ui.landAsk) return false;
  if (e.code === "Escape") ui.landAsk = null;
  else if (e.code === "Enter" || e.code === "NumpadEnter") LAND_ACTIONS["land-go"](state, ui, {}, null, actions);
  return true;
}

// The action the box was opened for, again, with the hours and the quantity.
const VIA = { xp: "xp-order", tc: "tc-do", ctxhunt: "ctxhunt" };
export const LAND_ACTIONS = {
  "land-sethours": (state, ui, d) => { if (ui.landAsk) ui.landAsk.hours = clampHours(d.h); },
  "land-setqty": (state, ui, d) => { if (ui.landAsk) ui.landAsk.qty = d.n === "" || d.n == null ? null : Math.max(0, Math.floor(Number(d.n) || 0)); },
  "land-go": (state, ui, d, ev, actions) => {
    const a = ui.landAsk;
    if (!a) return;
    const m = landModel(state, ui);
    if (m && m.est.why) return;
    ui.landAsk = null;
    const qty = m && m.info && a.qty != null && a.qty < m.info.max ? String(Math.max(0, Math.floor(a.qty))) : "";
    const fn = actions && actions[VIA[a.via]];
    if (fn) fn({ ...a.d, hours: String(a.hours), qty, asked: "1" });
  },
  "land-close": (state, ui) => { ui.landAsk = null; },
};
export const LAND_CHANGE = {
  "land-hours": (state, ui, el) => { if (ui.landAsk) ui.landAsk.hours = clampHours(el.value); },
  "land-qty": (state, ui, el) => { if (ui.landAsk) ui.landAsk.qty = Math.max(0, Math.floor(Number(el.value) || 0)); },
};
