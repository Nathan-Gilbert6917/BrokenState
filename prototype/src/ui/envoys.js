// The Diplomacy window's Envoys tab (sim/envoys.js): how word reaches each group you know (radio or envoy), the
// composer (what to send, the goods, and without a radio link the envoy: at least one survivor, a vehicle if you like,
// with the route and the hours there and back, the food and water packed and the load), the messages in flight with
// their status (travelling, awaiting return, overdue, lost, returned and the answer), and their requests waiting for
// your answer (Answer now puts the card first). Handlers: ENVOY_ACTIONS / ENVOY_CHANGE (merged into ui/diplomacy.js's).
import { factionById, hub, atBase } from "../sim/world.js";
import { attitude } from "../sim/factions.js";
import { tileLabel } from "../sim/parties.js";
import { vehicleLabel, isBike } from "../sim/vehicles.js";
import { foodIn } from "../sim/foods.js";
import { supplyAmt } from "../sim/rounds.js";
import { KINDS, GOODS, GET_GOODS, commsWith, communicate, envoyPlan, messageProblem, messageList, pendingFrom, answerNow, ENVOY } from "../sim/envoys.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const swatch = (c) => `<span class="swatch" style="background:${c}"></span>`;
const WORD = { food: "Food (days)", water: "Water", meds: "Meds", ammo: "Rounds", fuel: "Fuel", scrap: "Scrap", parts: "Machine parts" };
const STATUS = { travelling: ["muted", "travelling"], delivered: ["muted", "delivered"], "awaiting return": ["muted", "delivered: awaiting return"], overdue: ["danger", "overdue: no word"], lost: ["danger", "lost: no word"], returned: ["good", "returned"] };
const hours = (h) => (h >= 36 ? `${Math.round(h / 24)} days` : `${Math.round(h)}h`);

// The form (UI only): ui.envoy = { fid, kind, goods, give, get, key, qty, pact, members, vehicleId, msg }.
function form(ui) {
  if (!ui.envoy) ui.envoy = { fid: null, kind: "aid", goods: {}, give: {}, get: {}, key: "food", qty: 10, pact: "nonaggression", members: [], vehicleId: null, msg: "" };
  return ui.envoy;
}
const payloadOf = (e) => (e.kind === "aid" ? { goods: { ...e.goods } } : e.kind === "trade" ? { give: { ...e.give }, get: { ...e.get } } : e.kind === "askaid" ? { key: e.key, qty: Math.max(0, Math.floor(Number(e.qty) || 0)) } : e.kind === "pact" ? { pact: e.pact } : {});
const have = (b, k) => Math.floor(k === "food" ? foodIn(b.stock) : k === "ammo" ? supplyAmt(b.stock, "ammo") : b.stock[k] || 0);

// A group's comms in a word, with the button that opens the composer for it (the Groups tab card, this tab).
export function commsButton(state, f) {
  if (!f || !f.alive || !f.known) return "";
  const via = commsWith(state, f);
  return `<button class="mini" data-action="ev-open" data-fid="${f.id}"${tip(via === "radio" ? "A radio link both ways: the answer comes at once (goods still go by envoy)." : "No radio link: an envoy carries your message there and the answer home.")}>${via === "radio" ? "📻" : "✉"} Communicate…</button>`;
}

export function envoysTab(state, ui) {
  const e = form(ui);
  const known = state.factions.filter((f) => f.alive && f.known && f.bases.length);
  const rows = known.map((f) => `<tr><td>${swatch(f.color)}${esc(f.name)}</td><td class="muted">${attitude(f)}</td><td>${commsWith(state, f) === "radio" ? `<span class="good">📻 radio</span>` : `<span class="muted">✉ envoy</span>`}</td><td>${commsButton(state, f)}</td></tr>`).join("");
  return `<h3${tip("Two groups talk by radio only when both have a working link: your station or a linked relay reaching their base (+6 tiles), and a set of their own. Starting bases have none; only military bases do. Otherwise word goes in person, by envoy.")}>How word reaches them</h3>
    ${known.length ? `<table class="t small"><tr><th>Group</th><th></th><th>By</th><th></th></tr>${rows}</table>` : `<div class="muted small">You know no group yet.</div>`}
    ${e.fid != null && factionById(state, e.fid) ? composer(state, ui, e) : ""}
    ${inFlight(state)}
    ${pendingBlock(state)}`;
}

function goodsRows(state, base, rec, keys, field) {
  return keys.map((k) => `<span style="white-space:nowrap">${esc(WORD[k])} <input type="number" min="0" step="1" class="mini" style="width:4.2rem" data-action="ev-good" data-f="${field}" data-k="${k}" value="${Math.max(0, Math.floor(rec[k] || 0))}">${base && field !== "get" ? ` <span class="muted">/${have(base, k)}</span>` : ""}</span>`).join(" ");
}
function composer(state, ui, e) {
  const f = factionById(state, e.fid);
  const base = hub(state);
  const via = commsWith(state, f);
  const P = payloadOf(e);
  const opt = (k) => `<option value="${k}" ${e.kind === k ? "selected" : ""}>${esc(KINDS[k].label)}</option>`;
  let what = "";
  if (e.kind === "aid") what = `<div class="small">Give: ${goodsRows(state, base, e.goods, GOODS, "goods")}</div>`;
  else if (e.kind === "trade") what = `<div class="small">You give: ${goodsRows(state, base, e.give, GOODS, "give")}</div><div class="small">You want: ${goodsRows(state, base, e.get, GET_GOODS, "get")}</div>`;
  else if (e.kind === "askaid") what = `<div class="small">Ask for <select class="mini" data-action="ev-key">${GET_GOODS.map((k) => `<option value="${k}" ${e.key === k ? "selected" : ""}>${esc(WORD[k])}</option>`).join("")}</select> <input type="number" min="1" step="1" class="mini" style="width:4.2rem" data-action="ev-qty" value="${Math.max(1, Math.floor(Number(e.qty) || 1))}"></div>`;
  else if (e.kind === "pact") what = `<div class="small"><select class="mini" data-action="ev-pact"><option value="nonaggression" ${e.pact !== "trade" ? "selected" : ""}>Non-aggression pact</option><option value="trade" ${e.pact === "trade" ? "selected" : ""}>Trade pact</option></select></div>`;
  const why = messageProblem(state, f, e.kind, P, base);
  // Without a link (or with goods to carry) the envoy: who goes, the vehicle, the route there and back.
  const needsEnvoy = via === "envoy" || KINDS[e.kind].carry;
  let envoy = "";
  if (needsEnvoy && base) {
    const people = atBase(state, base.id);
    const cars = state.vehicles.filter((v) => v.loc.kind === "base" && v.loc.baseId === base.id && v.condition > 0 && !isBike(v));
    const plan = envoyPlan(state, { fid: f.id, kind: e.kind, payload: P, memberIds: e.members, vehicleId: e.vehicleId });
    envoy = `<div class="small" style="margin-top:0.3rem"><b${tip(`At least one survivor carries the message (and the goods) there and back. They are away from ${base.name} meanwhile: no work, no walls. Locked to the errand: no other orders.`)}>The envoy</b> from ${esc(base.name)}:</div>
      <div class="row small" style="flex-wrap:wrap;gap:0.2rem">${people.map((s) => `<button class="mini ${e.members.includes(s.id) ? "active" : ""}" data-action="ev-member" data-id="${s.id}">${esc(s.name.split(" ")[0])}</button>`).join("") || `<span class="muted">Nobody at ${esc(base.name)}.</span>`}</div>
      <div class="small">Vehicle: <select class="mini" data-action="ev-vehicle"><option value="">on foot</option>${cars.map((v) => `<option value="${v.id}" ${e.vehicleId === v.id ? "selected" : ""}>${esc(vehicleLabel(v))} (${Math.floor(v.fuel || 0)} fuel)</option>`).join("")}</select></div>
      ${plan.dest != null && plan.path.length ? `<div class="small">To ${esc(f.name)} at ${esc(tileLabel(state, plan.dest))}: ${plan.path.length - 1} tiles, there in about <b>${hours(plan.hoursOut)}</b>, back about <b>${hours(plan.hoursBack)}</b> later (the answer when they are home). Packs ${plan.food} days of food and ${plan.water} water${plan.fuel ? `, ${plan.fuel} fuel` : ""}; load ${Math.ceil(plan.load)} of ${Math.floor(plan.cap)} kg. No word after ${hours((plan.hoursOut + plan.hoursBack + 6) * ENVOY.OVERDUE + ENVOY.OVERDUE_H)}.</div>` : ""}
      ${plan.why ? `<div class="danger small">${esc(plan.why)}</div>` : ""}`;
    if (!why && plan.why) e.planWhy = plan.why; else e.planWhy = "";
  }
  const block = why || (needsEnvoy ? e.planWhy : "");
  return `<div class="card small" style="margin-top:0.5rem">
    <div class="spread"><b>${swatch(f.color)}To ${esc(f.name)}</b><span class="${via === "radio" ? "good" : "muted"}">${via === "radio" ? "📻 by radio: the answer at once" : "✉ by envoy: the answer when it is home"}</span></div>
    <div class="row small"><select class="mini" data-action="ev-kind">${Object.keys(KINDS).map(opt).join("")}</select> <span class="muted">${esc(KINDS[e.kind].desc)}</span></div>
    ${what}${envoy}
    ${why ? `<div class="danger small">${esc(why)}</div>` : ""}
    ${e.msg ? `<div class="result">${esc(e.msg)}</div>` : ""}
    <div class="row" style="margin-top:0.3rem"><button class="primary mini" data-action="ev-send" ${block ? "disabled" : ""}${tip(block || (via === "radio" && !KINDS[e.kind].carry ? "Say it on the radio" : "The envoy sets out"))}>${via === "radio" && !KINDS[e.kind].carry ? "Call them" : "Send the envoy"}</button><button class="mini" data-action="ev-close">Close</button></div>
  </div>`;
}

function inFlight(state) {
  const list = messageList(state);
  if (!list.length) return `<h3>Messages</h3><div class="muted small">No messages sent or received yet.</div>`;
  return `<h3${tip("Your envoys and theirs: travelling, delivered (on the way back), overdue (no word), lost, or returned with the answer. You learn an answer only when your envoy is home.")}>Messages</h3>
    <table class="t small"><tr><th></th><th>With</th><th>What</th><th>Status</th><th>Answer</th></tr>${list.map((r) => {
      const [cls, word] = STATUS[r.status] || ["muted", r.status];
      return `<tr><td>${r.mine ? "→" : "←"}</td><td>${esc(r.who)}</td><td>${esc(r.what)}${r.via === "radio" ? ` <span class="muted">(radio)</span>` : ""}</td><td class="${cls}">${esc(word)}</td><td>${esc(r.answer)}</td></tr>`;
    }).join("")}</table>`;
}

function pendingBlock(state) {
  const rows = [];
  for (const f of state.factions) if (f.alive && f.known) for (const { i, card } of pendingFrom(state, f)) rows.push(`<div class="small">${swatch(f.color)}${esc(card.title)} <button class="mini" data-action="ev-answer" data-i="${i}"${tip("Bring the card up now to answer it")}>Answer now</button></div>`);
  return rows.length ? `<h3${tip("Their requests waiting for your answer. A request their envoy brought goes home with your answer: they hear it when the envoy gets there.")}>Their requests</h3>${rows.join("")}` : "";
}

// ---------- handlers ----------
export const ENVOY_ACTIONS = {
  "ev-open": (state, ui, d) => { const e = form(ui); const fid = Number(d.fid); if (e.fid !== fid) Object.assign(e, { fid, members: [], vehicleId: null, msg: "" }); ui.diplo = { tab: "envoys" }; ui.diploMsg = ""; },
  "ev-close": (state, ui) => { form(ui).fid = null; },
  "ev-member": (state, ui, d) => { const e = form(ui), id = Number(d.id); e.members = e.members.includes(id) ? e.members.filter((x) => x !== id) : [...e.members, id]; e.msg = ""; },
  "ev-answer": (state, ui, d) => { const t = answerNow(state, Number(d.i)); ui.diplo = null; ui.diploMsg = t; },
  "ev-send": (state, ui) => {
    const e = form(ui);
    const r = communicate(state, { fid: e.fid, kind: e.kind, payload: payloadOf(e), memberIds: e.members, vehicleId: e.vehicleId, fromBaseId: (hub(state) || {}).id });
    e.msg = r.text;
    if (r.ok) { e.members = []; e.goods = {}; e.give = {}; e.get = {}; }
  },
};
export const ENVOY_CHANGE = {
  "ev-kind": (state, ui, el) => { if (KINDS[el.value]) { form(ui).kind = el.value; form(ui).msg = ""; } },
  "ev-good": (state, ui, el) => { const e = form(ui), fld = el.dataset.f, k = el.dataset.k; if (!["goods", "give", "get"].includes(fld) || !GOODS.includes(k)) return; e[fld] = { ...e[fld], [k]: Math.max(0, Math.floor(Number(el.value) || 0)) }; e.msg = ""; },
  "ev-key": (state, ui, el) => { if (GET_GOODS.includes(el.value)) form(ui).key = el.value; },
  "ev-qty": (state, ui, el) => { form(ui).qty = Math.max(1, Math.floor(Number(el.value) || 1)); },
  "ev-pact": (state, ui, el) => { form(ui).pact = el.value === "trade" ? "trade" : "nonaggression"; },
  "ev-vehicle": (state, ui, el) => { form(ui).vehicleId = el.value ? Number(el.value) : null; },
};
