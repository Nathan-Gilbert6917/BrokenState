// Volunteers (sim/volunteers.js) on screen: the request window (which group, which team, how many, how long, what you
// offer, and their answer before you ask), the "choose who" window for a group's ask of you, the team panel's
// Volunteers card, the Ask for volunteers buttons (a group's card, the radio panel, a team card) and the trip
// planner's row. Handlers: VOL_ACTIONS / VOL_CHANGE (main.js registers them).
import { supplyAmt } from "../sim/rounds.js"; // food in days
import { SUPPLIES } from "../sim/data.js";
import { factionById, hub, combatPower } from "../sim/world.js";
import { partyMembers, tileLabel, MISSIONS } from "../sim/parties.js";
import {
  VOL, askQuote, askVolunteers, askableGroups, groupProblem, teamProblem, volunteersWith, volunteersComing, missionOf, offerProblem,
  askById, answerAsk, lendable, declineCost, volLine, ensureVols,
} from "../sim/volunteers.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const first = (s) => String(s.name).split(" ")[0];
const sign = (v) => `${v > 0 ? "+" : ""}${Math.round(v * 100) / 100}`;
const DAYS = [3, 5, 7, 10, 14, 20, 30];
const myTeams = (state) => state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy" && partyMembers(state, p).some((s) => !s.vol));
const teamLabel = (state, p) => `${MISSIONS[p.mission] ? MISSIONS[p.mission].name : "Team"}: ${partyMembers(state, p).filter((s) => !s.vol).map(first).join(", ")} (${tileLabel(state, p.dest)})`;
export const VOL_HELP = `Volunteers: ask an allied group for 1–${VOL.MAX} of its people to join one of your teams for a span of days. They decide by goodwill, pacts and the coalition, jobs you did for them, the mission's danger (a hive crawl or an assault is a big ask), how many and how long, their own trouble and what you offer. Volunteers carry, eat the team's food and fight beside your people, but in a battle their group's AI moves them: you cannot give them orders.`;

// ---------- buttons ----------
export function volAskButton(state, f, label = "Ask for volunteers…") {
  if (!f || !f.alive || !f.known) return "";
  const why = groupProblem(state, f);
  return `<button class="mini" data-action="vol-open" data-fid="${f.id}" ${why || !myTeams(state).length ? "disabled" : ""}${tip(why || (!myTeams(state).length ? "You have no team out to send them to. Form a team first." : VOL_HELP))}>${esc(label)}</button>`;
}
export function teamVolButton(state, p) {
  const why = teamProblem(state, p);
  return `<button class="mini" data-action="vol-open" data-party="${p.id}" ${why ? "disabled" : ""}${tip(why || VOL_HELP)}>Ask allies for volunteers…</button>`;
}

// ---------- the team panel ----------
export function teamVolBlock(state, p) {
  const withUs = volunteersWith(state, p), coming = volunteersComing(state, p);
  const rows = [
    ...withUs.map((s) => `<div${tip(`${volLine(state, s)}. Health ${Math.round(s.health)}. ${s.gear.weapon ? s.gear.weapon.name : "Fists"}. Power ${combatPower(s).toFixed(1)}.`)}><span class="vol-tag">VOL</span> <b>${esc(s.name)}</b> <span class="muted">· ${esc(s.vol.group)} · health ${Math.round(s.health)} · ${esc(s.gear.weapon ? s.gear.weapon.name : "fists")} · ${Math.max(0, Math.ceil((s.vol.until - state.hour) / 24))} days left</span></div>`),
    ...coming.map((s) => `<div class="muted"${tip("On their way from their base to the team; they join it wherever it is (not in the middle of a fight).")}><span class="vol-tag">VOL</span> ${esc(s.name)} (${esc(s.vol.group)}): on the way, about ${Math.max(0, s.location.eta - state.hour)} h</div>`),
  ].join("");
  return `<div class="card small"><div class="spread"><b${tip(VOL_HELP)}>🤝 Volunteers</b>${teamVolButton(state, p)}</div>${rows || `<div class="muted">None. An allied group may lend you people for this team.</div>`}</div>`;
}
// The team card line (Teams tab): how many volunteers are with it.
export function teamVolLine(state, p) {
  const n = volunteersWith(state, p).length, c = volunteersComing(state, p).length;
  if (!n && !c) return "";
  return ` · <span class="vol-text"${tip("Volunteers from allied groups: their own orders in a fight")}>+${n} volunteer${n === 1 ? "" : "s"}${c ? ` (${c} coming)` : ""}</span>`;
}

// ---------- the request window ----------
function req(ui) { return ui.volReq; }
export function volRequestModal(state, ui) {
  const r = req(ui);
  const groups = askableGroups(state);
  const teams = myTeams(state);
  const f = factionById(state, r.fid) || (groups.find((g) => !g.why) || groups[0] || {}).f;
  const p = teams.find((x) => x.id === r.partyId) || teams[0];
  if (f) r.fid = f.id;
  if (p) r.partyId = p.id;
  const offer = r.offerQty > 0 ? { key: r.offerKey || "food", qty: r.offerQty } : null;
  const q = f && p ? askQuote(state, f, p, { n: r.n, days: r.days, offer, favour: r.favour, share: r.share || 0 }) : null;
  const op = p ? offerProblem(state, p, offer) : "";
  const m = p ? missionOf(state, p) : null;
  const h = hub(state);
  const answer = !q ? `<div class="muted">Pick a group and a team.</div>`
    : q.refuse ? `<div class="danger">${esc(q.refuse)}</div>`
    : `<table class="t small"><tr><th>What weighs</th><th>Points</th></tr>${q.parts.map((x) => `<tr><td>${esc(x.label)}</td><td class="${x.v < 0 ? "danger" : "good"}">${sign(x.v)}</td></tr>`).join("")}<tr><td><b>Total</b></td><td><b>${sign(q.points)}</b></td></tr></table>
       <div class="${q.yes ? "good" : "danger"}" style="margin-top:0.3rem">${q.yes ? `They would agree: ${q.n} of their people for ${q.days} days.${!offer && !r.favour && !(r.share > 0) ? ` Asking with nothing in return costs ${VOL.ASK_GW} goodwill.` : ""}` : "They would say no. Offer something, ask for fewer or for less time, or do them a job first."}</div>`;
  return `<div class="box wide vol-req"><h1>🤝 Ask for volunteers</h1>
    <div class="small muted" style="margin-bottom:0.5rem">${esc(VOL_HELP)}</div>
    <div class="grid2">
      <div>
        <h3>Group</h3>
        <select data-action="vol-group">${groups.map((g) => `<option value="${g.f.id}" ${f === g.f ? "selected" : ""}${g.why ? " disabled" : ""}>${esc(g.f.name)}${g.why ? " (cannot ask)" : ` · goodwill ${Math.round(g.f.goodwill)}`}</option>`).join("")}</select>
        ${f && groupProblem(state, f) ? `<div class="small danger">${esc(groupProblem(state, f))}</div>` : f ? `<div class="small muted">${Math.round(f.pop)} people${f.pact ? ` · ${f.pact === "trade" ? "trade pact" : "non-aggression pact"}` : ""}</div>` : ""}
        <h3>For which team</h3>
        <select data-action="vol-team">${teams.map((x) => `<option value="${x.id}" ${p === x ? "selected" : ""}>${esc(teamLabel(state, x))}</option>`).join("")}</select>
        ${m ? `<div class="small muted">The job: ${esc(m.label)}${m.danger ? ` (danger ${m.danger})` : ""}</div>` : ""}
        <h3>How many</h3>
        <div class="row">${[1, 2, 3, 4].map((n) => `<button data-action="vol-n" data-v="${n}" class="${r.n === n ? "active" : ""}">${n}</button>`).join("")}</div>
        <h3>How long</h3>
        <select data-action="vol-days">${DAYS.map((d) => `<option value="${d}" ${r.days === d ? "selected" : ""}>${d} days</option>`).join("")}</select>
      </div>
      <div>
        <h3${tip(`Goods from ${p ? "the team's home base" : "the hub"}: every ${VOL.P.goodsPer} worth of trade value is a point.`)}>What you offer</h3>
        <div class="row"><select data-action="vol-offer-key">${VOL.OFFER_KEYS.map((k) => `<option value="${k}" ${(r.offerKey || "food") === k ? "selected" : ""}>${esc(k === "ammo" ? "Rounds (the calibres your guns need least)" : k === "food" ? "Food (days of it)" : SUPPLIES[k].name)}</option>`).join("")}</select>
          <input type="number" min="0" step="5" value="${r.offerQty || 0}" data-action="vol-offer-qty" style="width:5rem"${tip(h ? `${h.name} has ${Math.floor(supplyAmt(h.stock, r.offerKey || "food"))}${(r.offerKey || "food") === "food" ? " days of food" : ""}` : "")}></div>
        <label class="small"${tip(`+${VOL.P.favour} points. They will ask you for people one day soon; declining then costs three times the usual.`)}><input type="checkbox" data-action="vol-favour" ${r.favour ? "checked" : ""}> Owe them a favour</label>
        <div class="row small" style="margin-top:0.3rem"${tip(`A share of what the team's cargo gains while they are with it, to their group's stores when the last of them leaves (+goodwill). Points: the share × ${VOL.SHARE.points}.`)}>Share of the haul: ${VOL.SHARE.choices.map((v) => `<button class="mini ${(r.share || 0) === v ? "active" : ""}" data-action="vol-share" data-v="${v}">${Math.round(v * 100)}%</button>`).join("")}</div>
        ${op ? `<div class="small danger">${esc(op)}</div>` : ""}
        <h3>Their answer</h3>
        ${answer}
      </div>
    </div>
    ${r.msg ? `<div class="result">${esc(r.msg)}</div>` : ""}
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button data-action="vol-close">Close</button><button class="primary" data-action="vol-ask" ${!q || q.refuse || op ? "disabled" : ""}${tip(q && !q.yes ? "They will say no; asking anyway means they will not hear you again for a few days" : "Ask them on the radio")}>Ask them</button></div>
  </div>`;
}

// ---------- a group's ask: choose who goes ----------
export function volPickModal(state, ui) {
  const pk = ui.volPick;
  const ask = askById(state, pk.askId);
  if (!ask) return `<div class="box"><h1>Volunteers</h1><div class="text">They no longer ask.</div><div class="row"><button class="primary" data-action="vol-pick-close">Close</button></div></div>`;
  const f = factionById(state, ask.fid);
  const pool = lendable(state);
  const sel = pk.sel || [];
  return `<div class="box wide"><h1>${esc(f ? f.name : "A group")} ask for volunteers</h1>
    <div class="text">They need people for ${esc(ask.label)}: up to ${ask.n} for about ${ask.days} days. Whoever goes is with them, out of your orders, and comes back with a share of what is taken, hurt, or not at all.</div>
    <h3>Who goes (${sel.length} of up to ${ask.n})</h3>
    <div class="vol-pick">${pool.map((s) => `<label class="row small"><input type="checkbox" data-action="vol-pick-toggle" data-id="${s.id}" ${sel.includes(s.id) ? "checked" : ""} ${!sel.includes(s.id) && sel.length >= ask.n ? "disabled" : ""}> <b>${esc(s.name)}</b> <span class="muted">· health ${Math.round(s.health)} · ${esc(s.gear.weapon ? s.gear.weapon.name : "fists")} · power ${combatPower(s).toFixed(1)}</span></label>`).join("") || `<div class="muted">Nobody fit to go at the hub.</div>`}</div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button data-action="vol-pick-close"${tip("Decide later (the ask stays open a while)")}>Later</button><button data-action="vol-pick-decline"${tip(f ? `−${declineCost(f, ask)} goodwill` : "")}>Decline</button><button class="primary" data-action="vol-pick-send" ${sel.length ? "" : "disabled"}>Send ${sel.length || ""}</button></div>
  </div>`;
}

// ---------- the trip planner ----------
export function plannerVolRow(state, pl) {
  const v = pl.vol || {};
  const groups = askableGroups(state).filter((g) => !g.why);
  if (!groups.length) return "";
  const f = v.fid != null ? factionById(state, v.fid) : null;
  const q = f ? askQuote(state, f, { mission: pl.mission, dest: pl.dest, members: [] }, { n: v.n || 1, days: VOL.SPAN.def }) : null;
  return `<div class="row small" style="margin-top:0.4rem"${tip(`${VOL_HELP} Asked when the team leaves (for ${VOL.SPAN.def} days); they walk out to meet it.`)}>🤝 Volunteers:
    <select data-action="pl-vol-group"><option value="">none</option>${groups.map((g) => `<option value="${g.f.id}" ${v.fid === g.f.id ? "selected" : ""}>${esc(g.f.name)}</option>`).join("")}</select>
    ${f ? `<select data-action="pl-vol-n">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${(v.n || 1) === n ? "selected" : ""}>${n}</option>`).join("")}</select>
    <span class="${q && q.yes && !q.refuse ? "good" : "danger"}">${q ? (q.refuse ? esc(q.refuse) : q.yes ? `they would agree (${sign(q.points)})` : `they would say no (${sign(q.points)})`) : ""}</span>` : ""}</div>`;
}
// main.js after a launch: the planner's ask goes out for the new team.
export function plannerVolAsk(state, pl, party) {
  const v = pl.vol;
  if (!v || v.fid == null || !party) return "";
  const f = factionById(state, v.fid);
  return f ? askVolunteers(state, f, party, { n: v.n || 1, days: VOL.SPAN.def }).text : "";
}

// ---------- handlers ----------
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
export function openVolRequest(ui, d = {}) {
  ui.volReq = { fid: d.fid != null && d.fid !== "" ? Number(d.fid) : null, partyId: d.party != null && d.party !== "" ? Number(d.party) : null, n: 1, days: VOL.SPAN.def, offerKey: "food", offerQty: 0, favour: false, share: 0, msg: "" };
}
export const VOL_ACTIONS = {
  "vol-open": (state, ui, d) => { openVolRequest(ui, d); ui.radioWith = null; ui.diplo = null; },
  "vol-close": (state, ui) => { ui.volReq = null; },
  "vol-share": (state, ui, d) => { if (ui.volReq && VOL.SHARE.choices.includes(Number(d.v))) ui.volReq.share = Number(d.v); },
  "vol-n": (state, ui, d) => { if (ui.volReq) ui.volReq.n = Math.max(1, Math.min(VOL.MAX, num(d.v, 1))); },
  "vol-ask": (state, ui) => {
    const r = ui.volReq;
    if (!r) return;
    const f = factionById(state, r.fid), p = state.parties.find((x) => x.id === r.partyId);
    if (!f || !p) { r.msg = "Pick a group and a team."; return; }
    const res = askVolunteers(state, f, p, { n: r.n, days: r.days, offer: r.offerQty > 0 ? { key: r.offerKey || "food", qty: r.offerQty } : null, favour: r.favour, share: r.share || 0 });
    r.msg = res.text;
    if (res.ok) { r.offerQty = 0; r.favour = false; }
  },
  "vol-pick-toggle": (state, ui, d) => {
    const pk = ui.volPick;
    if (!pk) return;
    const id = Number(d.id);
    pk.sel = pk.sel || [];
    pk.sel = pk.sel.includes(id) ? pk.sel.filter((x) => x !== id) : [...pk.sel, id];
  },
  "vol-pick-send": (state, ui) => { const pk = ui.volPick; if (!pk) return; const t = answerAsk(state, pk.askId, pk.sel || []); ui.volPick = null; ui.cardResult = { title: "Volunteers", text: t }; },
  "vol-pick-decline": (state, ui) => { const pk = ui.volPick; if (!pk) return; const t = answerAsk(state, pk.askId, null); ui.volPick = null; ui.cardResult = { title: "Volunteers", text: t }; },
  "vol-pick-close": (state, ui) => { ui.volPick = null; },
};
export const VOL_CHANGE = {
  "vol-group": (state, ui, el) => { if (ui.volReq) ui.volReq.fid = Number(el.value); },
  "vol-team": (state, ui, el) => { if (ui.volReq) ui.volReq.partyId = Number(el.value); },
  "vol-days": (state, ui, el) => { if (ui.volReq) ui.volReq.days = num(el.value, VOL.SPAN.def); },
  "vol-offer-key": (state, ui, el) => { if (ui.volReq && VOL.OFFER_KEYS.includes(el.value)) ui.volReq.offerKey = el.value; },
  "vol-offer-qty": (state, ui, el) => { if (ui.volReq) ui.volReq.offerQty = Math.max(0, Math.round(num(el.value, 0))); },
  "vol-favour": (state, ui, el) => { if (ui.volReq) ui.volReq.favour = !!el.checked; },
  "pl-vol-group": (state, ui, el) => { if (ui.planner) ui.planner.vol = el.value === "" ? null : { fid: Number(el.value), n: (ui.planner.vol && ui.planner.vol.n) || 1 }; },
  "pl-vol-n": (state, ui, el) => { if (ui.planner && ui.planner.vol) ui.planner.vol.n = Math.max(1, Math.min(VOL.MAX, num(el.value, 1))); },
};
// A card's "Choose who…" (sim/volunteers.js askCard: uiAction volpick).
export function openVolPick(ui, askId) { ui.volPick = { askId, sel: [] }; }
export { ensureVols };
