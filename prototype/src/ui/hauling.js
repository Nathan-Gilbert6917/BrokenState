// The Hauling panel (the base window's Supply runs tab, sim/hauling.js): the standing haul orders between this base and
// the others (what moves, which way, what is kept, what waits to go now), the haulers here and what they are doing,
// the vehicles set to hauling, and a small form to add an order. Actions (main.js): hl-f (the form's fields), hl-add,
// hl-del, hl-veh.
import { haulOrders, orderText, orderWant, inTransit, addHaulOrder, removeHaulOrder, haulKeys, WHAT_SPECIAL, CATS, whatName, haulTripState, HAUL } from "../sim/hauling.js";
import { atBase, baseById } from "../sim/world.js";
import { describeActivity } from "../sim/activity.js";
import { supWeight } from "../sim/data.js";
import { DAY_KG } from "../sim/foods.js";
import { isCar, payloadOf } from "../sim/vehicles.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => ` data-tip="${esc(t)}"`;
const first = (s) => s.name.split(" ")[0];

/** The form's state: ui.haulForm = { base, other, dir ("to" | "from"), what, mode, qty }. */
export function haulForm(state, ui, b) {
  const others = state.bases.filter((x) => x.id !== b.id);
  let f = ui.haulForm;
  if (!f || f.base !== b.id) f = ui.haulForm = { base: b.id, other: others[0] ? others[0].id : null, dir: "to", what: "food", mode: "stock", qty: 10 };
  if (!others.some((x) => x.id === f.other)) f.other = others[0] ? others[0].id : null;
  return f;
}
const wantKgText = (w) => { const kg = Object.entries(w).reduce((a, [k, q]) => a + q * (k === "food" ? DAY_KG : supWeight(k)), 0); return kg >= 0.5 ? `~${Math.round(kg)} kg waiting` : "nothing waiting"; };

export function haulPanel(state, b, ui) {
  const others = state.bases.filter((x) => x.id !== b.id);
  const orders = haulOrders(state).filter((o) => o.from === b.id || o.to === b.id);
  const transit = inTransit(state);
  const haulers = atBase(state, b.id).filter((s) => s.role === "haul");
  const cars = (state.vehicles || []).filter((v) => isCar(v) && ((v.loc && v.loc.kind === "base" && v.loc.baseId === b.id) || (v.haulOut && v.haulOut.home === b.id)));
  const f = haulForm(state, ui, b);
  const whatOpts = [...Object.keys(WHAT_SPECIAL), ...CATS.map((c) => `cat:${c}`), ...haulKeys()];
  const row = (o) => `<div class="spread"><span${tip(o.why ? `The governor's: ${o.why}` : "Your standing order")}>${o.gov ? "⚙ " : ""}${esc(orderText(state, o))}</span><span class="row"><span class="muted">${esc(wantKgText(orderWant(state, o, transit)))}</span><button class="mini" data-action="hl-del" data-id="${o.id}"${tip("Remove this order")}>✕</button></span></div>`;
  const hRow = (s) => { const st = haulTripState(state, s); return `<div class="spread"><a class="link" data-action="survivor" data-id="${s.id}">${esc(first(s))}</a><span class="muted">${esc(st ? st.text : describeActivity(state, s).text)}</span></div>`; };
  return `<h3>Hauling</h3>
    <div class="card small"${tip(`Haulers (the Haul job) carry goods between your bases by these standing orders: a round trip by the map's route at the teams' pace, out from 0${HAUL.start}:00 and home by ${HAUL.end}:00, as much as their weight limit, pack and rig allow (a cart from the armory multiplies it; a vehicle set to hauling takes its payload). The goods go into the other base's storage as far as it has room (the woodpile does not count). With nothing to move they haul near the base: stockpiles, salvage on the base map, scrap from the ruins. An order between an outpost and the main hub, with a hauler at either end, takes over the midnight shipping that way.`)}>
      <div><b>Haulers here (${haulers.length})</b></div>
      ${haulers.length ? haulers.map(hRow).join("") : `<div class="muted">Nobody on Haul at ${esc(b.name)}: give someone the Haul job (Overview, or the People list).</div>`}
      <div style="margin-top:0.4rem"><b>Routes</b></div>
      ${orders.length ? orders.map(row).join("") : `<div class="muted">No haul orders from or to ${esc(b.name)}.</div>`}
      ${cars.length ? `<div style="margin-top:0.4rem"><b>Vehicles</b></div>${cars.map((v) => `<div class="spread"><span>${esc(v.name)} <span class="muted">(${Math.round(payloadOf(v))} kg${v.haulOut ? ", out hauling" : ""})</span></span><button class="mini${v.haul ? " active" : ""}" data-action="hl-veh" data-id="${v.id}"${tip(v.haul ? "Set to hauling: the haulers here drive it (fuel for the round trip). Click to take it off hauling." : "Let the haulers here drive it (its payload, fuel for the round trip)")}>${v.haul ? "Hauling ✓" : "Use for hauling"}</button></div>`).join("")}` : ""}
      ${others.length ? `<div class="row" style="margin-top:0.5rem;flex-wrap:wrap;gap:0.3rem">
        <select data-action="hl-f" data-f="dir"><option value="to" ${f.dir === "to" ? "selected" : ""}>Send to</option><option value="from" ${f.dir === "from" ? "selected" : ""}>Bring from</option></select>
        <select data-action="hl-f" data-f="other">${others.map((x) => `<option value="${x.id}" ${f.other === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
        <select data-action="hl-f" data-f="what">${whatOpts.map((k) => `<option value="${esc(k)}" ${f.what === k ? "selected" : ""}>${esc(whatName(k))}</option>`).join("")}</select>
        <select data-action="hl-f" data-f="mode"><option value="send" ${f.mode === "send" ? "selected" : ""}>over (kept at the sender)</option><option value="stock" ${f.mode === "stock" ? "selected" : ""}>keep stocked there at</option></select>
        <input type="number" min="0" step="1" style="width:4.5rem" data-action="hl-f" data-f="qty" value="${Number(f.qty) || 0}">
        <button class="mini" data-action="hl-add" data-base="${b.id}">Add order</button>
      </div>` : `<div class="muted" style="margin-top:0.4rem">You need a second base to haul between.</div>`}
    </div>`;
}
// main.js: the form's fields.
export function haulFormChange(ui, el) {
  const f = ui.haulForm;
  if (!f) return;
  const k = el.dataset.f;
  f[k] = k === "other" || k === "qty" ? Number(el.value) || 0 : el.value;
}
// main.js: Add order. Returns the line for the base window.
export function haulAdd(state, ui, baseId) {
  const f = ui.haulForm;
  const b = baseById(state, Number(baseId));
  if (!f || !b) return "";
  const from = f.dir === "to" ? b.id : f.other, to = f.dir === "to" ? f.other : b.id;
  const res = addHaulOrder(state, { from, to, what: f.what, mode: f.mode, qty: f.qty });
  return res.error ? res.error : `Haul order: ${orderText(state, res.order)}.`;
}
export const haulDel = (state, id) => removeHaulOrder(state, id);
export function haulVeh(state, id) {
  const v = (state.vehicles || []).find((x) => x.id === Number(id));
  if (!v) return;
  if (v.haul) delete v.haul; else v.haul = true;
}
