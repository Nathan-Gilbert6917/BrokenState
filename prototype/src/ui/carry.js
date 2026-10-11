// Carrying the team's supplies (sim/carry.js): where each person keeps food, water, firewood and the rest (pockets,
// pack, carried in the arms, the vehicle), setting things down on the ground and picking them up again, and the
// "how much?" box before a team collects water, firewood, wild food or game.
//   ui.carry     the open box: { kind: "qty", d (the order's data), qty } or { kind: "pick", partyId }
//   ui.carrySel  the selected stack in an inventory: { pid, sid, place, key }   ui.carryN: how many to move
//   ui.carryMsg  the last message
// main.js: CARRY_ACTIONS / CARRY_CHANGE are registered like the inventory's; askQty runs first in "xp-order";
// carryHtml is drawn with the confirmation box; carryKey takes Enter / Esc while a box is up.
import { SUPPLIES } from "../sim/data.js"; // a food item's icon (sim/foods.js)
import { partyMembers, partyTile, cargoRoom } from "../sim/parties.js";
import { parseLoc, placeOfLoc, itemAt, isCarryable, moveItem, itemLoad } from "../sim/inventory.js";
import {
  COLLECT, HANDS_KG, PLACE_NAMES, holdView, unitKg, stackText, recText, qtyText, holdName, moveHeld, dropHeld, dropHands,
  dropItemToGround, pickUpGround, pickUpAll, groundAt, groundItemText, collectInfo, roomAt,
} from "../sim/carry.js";
import { supplyName } from "../sim/itemnames.js";
import { cartSpec, feltKg } from "../sim/carts.js"; // a wheelbarrow, a hand cart: a place for the supplies
import { isRoundKey } from "../sim/rounds.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const first = (s) => esc(String(s.name).split(" ")[0]);
const kg = (x) => Math.round(x * 10) / 10;
const ICON = { water: "💧", rawwater: "🪣", food: "🥫", meat: "🍖", fuel: "⛽", jars: "🫙", wood: "🪵", parts: "⚙", scrap: "🔩", carparts: "🛞" };
const partyOfSurvivor = (state, s) => (s && s.location && s.location.kind === "party" ? state.parties.find((x) => x.id === s.location.partyId && x.owner === "player") : null);

// ---------- how much to collect ----------
const VERB = { water: "Fetch water", wood: "Cut wood", forage: "Forage", hunt: "Hunt", fish: "Fish" };
// "xp-order": a collecting order without a quantity opens the box (the governor and the AI never come through here).
export function askQty(state, ui, d) {
  if (!COLLECT[d.type] || (d.qty != null && d.qty !== "") || state.autopilot) return false;
  const p = state.parties.find((x) => x.id === Number(d.id));
  const info = p ? collectInfo(state, p, d.type) : null;
  if (!info) return false;
  ui.carry = { kind: "qty", d: { ...d }, qty: info.max };
  return true;
}
function qtyBox(state, ui) {
  const c = ui.carry;
  const p = state.parties.find((x) => x.id === Number(c.d.id));
  const info = p ? collectInfo(state, p, c.d.type) : null;
  if (!info) { ui.carry = null; return ""; }
  const q = Math.max(0, Math.min(info.max, Math.floor(c.qty ?? info.max)));
  c.qty = q;
  const hands = Math.max(0, q - info.stowed);
  const exact = c.d.type === "water";
  return `<div class="askwrap"><div class="askbox" role="dialog" style="max-width:30rem">
    <div class="asktitle">${esc(VERB[c.d.type])}: how much?</div>
    <div class="asktext">${exact ? "Fill" : "Bring back at most"} <b>${q}</b> ${esc(info.name)} (${kg(q * info.kg)} kg, ${info.kg} kg each).
      The team can carry ${kg(info.room)} kg more: up to ${info.max}. ${Number.isFinite(info.stowed) ? `${Math.min(info.stowed, info.max)} fit in packs, pockets${info.stowed > 0 && p.vehicleId ? " and the vehicle" : ""}` : "The vehicle takes it all"}${hands > 0 ? `; <span class="warn">the other ${hands} are carried in the arms: whoever carries them cannot shoot or fight with a weapon until they set it down</span>` : ""}.${exact ? "" : " The work stops early once that much is in."}</div>
    <div class="row" style="gap:0.5rem;align-items:center;margin:0.5rem 0">
      <input type="range" min="0" max="${info.max}" step="1" value="${q}" data-action="carry-qty" style="flex:1" oninput="this.nextElementSibling.value=this.value">
      <input type="number" min="0" max="${info.max}" step="1" value="${q}" data-action="carry-qty" style="width:5rem">
    </div>
    <div class="row" style="gap:0.3rem;flex-wrap:wrap">
      <button class="mini" data-action="carry-setqty" data-n="${Number.isFinite(info.stowed) ? info.stowed : info.max}"${tip("As much as goes in the packs, pockets and the vehicle: nobody's hands full")}>Packs only (${Number.isFinite(info.stowed) ? info.stowed : info.max})</button>
      <button class="mini" data-action="carry-setqty" data-n="${info.max}"${tip("As much as the team can carry")}>Max (${info.max})</button>
    </div>
    <div class="askbtns"><button class="primary" data-action="carry-go" data-tip="Enter">${esc(VERB[c.d.type])}${q ? ` (${q})` : ""}</button><button data-action="carry-close" data-tip="Esc">Cancel</button></div>
  </div></div>`;
}

// ---------- picking up from the ground ----------
function pickBox(state, ui) {
  const p = state.parties.find((x) => x.id === ui.carry.partyId);
  if (!p) { ui.carry = null; return ""; }
  const site = groundAt(state, partyTile(p));
  const rows = site && site.items.length ? site.items.map((it, i) => {
    const stack = it.kind === "supply";
    const k = it.fresh ? "meat" : it.key;
    const fit = stack ? Math.min(it.qty, Math.floor(cargoRoom(state, p) / unitKg(k) + 1e-6)) : 1;
    return `<div class="spread small" style="margin:0.15rem 0"><span>${stack ? ICON[k] || (SUPPLIES[k] && SUPPLIES[k].icon) || "▪" : "🎒"} ${esc(groundItemText(it))}${stack ? ` <span class="muted">(${unitKg(k)} kg each)</span>` : ""}</span><span class="row" style="gap:0.25rem">
      ${stack ? `<input type="number" min="1" max="${Math.max(1, Math.ceil(it.qty))}" value="${Math.max(1, Math.floor(fit))}" data-action="carry-pickn" data-i="${i}" style="width:4rem">` : ""}
      <button class="mini" data-action="carry-take" data-i="${i}"${tip(stack ? `Pick up that many (as far as the team has room: ${kg(cargoRoom(state, p))} kg free)` : `Pick up the ${it.name}`)}>Take</button>
      ${!stack && it.item && isCarryable(it.item) ? partyMembers(state, p).filter((m) => !m.gear.carry).map((m) => `<button class="mini" data-action="carry-take" data-i="${i}" data-arms="${m.id}"${tip(`${m.name.split(" ")[0]} ${it.cartKg != null ? "pushes" : "carries"} the ${it.name} in their arms, with what is in it (${kg(itemLoad(it.item))} kg): no weapon until it is set down`)}>${first(m)} ${it.cartKg != null ? "pushes" : "carries"}</button>`).join("") : ""}</span></div>`;
  }).join("") : `<div class="small muted">Nothing on the ground here.</div>`;
  return `<div class="askwrap"><div class="askbox" role="dialog" style="max-width:32rem">
    <div class="asktitle">Pick up from the ground</div>
    <div class="asktext">${esc(partyMembers(state, p).map((s) => s.name.split(" ")[0]).join(", "))} can carry ${kg(cargoRoom(state, p))} kg more.${ui.carryMsg ? `<div class="result small">${esc(ui.carryMsg)}</div>` : ""}</div>
    ${rows}
    <div class="askbtns"><button class="primary" data-action="carry-takeall"${tip("Everything that fits: supplies first, then items, the most valuable first")}>Take all that fits</button><button data-action="carry-close" data-tip="Esc">Done</button></div>
  </div></div>`;
}

export function carryHtml(state, ui) {
  if (!ui.carry) return "";
  return ui.carry.kind === "qty" ? qtyBox(state, ui) : ui.carry.kind === "pick" ? pickBox(state, ui) : "";
}
export function carryKey(state, ui, e, actions) {
  if (!ui.carry) return false;
  if (e.code === "Escape") ui.carry = null;
  else if ((e.code === "Enter" || e.code === "NumpadEnter") && ui.carry.kind === "qty") CARRY_ACTIONS["carry-go"](state, ui, {}, null, actions);
  return true;
}

// ---------- in a person's inventory ----------
// A chip's name, its count on the right (sim/itemnames.js: rounds are "… FMJ — loose", never "23 .308 …").
const chipName = (k) => (isRoundKey(k) ? supplyName(k) : holdName(k));
const chip = (ui, pid, sid, place, k, q) => {
  const sel = ui.carrySel && ui.carrySel.pid === pid && ui.carrySel.sid === sid && ui.carrySel.place === place && ui.carrySel.key === k;
  return `<button class="mini${sel ? " active" : ""}" data-action="carry-sel" data-pid="${pid}" data-sid="${sid ?? ""}" data-place="${place}" data-key="${k}"${tip(`${stackText(k, q)}, ${kg(q * unitKg(k))} kg. Click to choose it, then where it goes.`)}>${ICON[k] || (SUPPLIES[k] && SUPPLIES[k].icon) || "▪"} ${esc(chipName(k))} <span class="icount">×${qtyText(q)}</span></button>`;
};
const placeRow = (ui, pid, sid, place, rec, extra = "") => `<div class="small" style="margin:0.15rem 0"><b>${PLACE_NAMES[place]}</b>${extra} ${Object.keys(rec).length ? Object.entries(rec).map(([k, q]) => chip(ui, pid, sid, place, k, q)).join(" ") : `<span class="muted">nothing</span>`}</div>`;
// The "Supplies carried" box under a team member's paper doll (ui/inventory.js inventoryModal).
export function holdSection(state, ui, s) {
  const p = partyOfSurvivor(state, s);
  const v = p ? holdView(state, p) : null;
  if (!v) return "";
  const me = v.people.find((x) => x.s.id === s.id);
  if (!me) return "";
  const pid = p.id;
  let html = `<div class="card small" style="margin-top:0.5rem"><div class="spread"><b>Supplies ${first(s)} carries</b><span class="muted">${kg(me.kg)} kg</span></div>
    ${placeRow(ui, pid, s.id, "pocket", me.pocket, ` <span class="muted">(${me.pocketUsed} of ${me.freePockets} free pocket${me.freePockets === 1 ? "" : "s"} used)</span>`)}
    ${placeRow(ui, pid, s.id, "pack", me.pack, me.freePack || me.packUsed ? ` <span class="muted">(${me.packUsed} of ${me.freePack} free pack slot${me.freePack === 1 ? "" : "s"} used)</span>` : ` <span class="muted">(no pack, or it is full of items)</span>`)}
    ${me.cartItem ? "" : placeRow(ui, pid, s.id, "hands", me.hands, ` <span class="${me.handsKg > 0 ? "warn" : "muted"}">(${kg(me.handsKg)}/${HANDS_KG} kg${me.handsKg > 0 ? ": hands full, no weapon in a fight until it is set down" : ""})</span>`)}
    ${me.cartItem ? placeRow(ui, pid, s.id, "cart", me.cart, ` <span class="muted"${tip(`The team's supplies in the ${me.cartItem.name.toLowerCase()}: ${first(s)} feels ${Math.round(cartSpec(me.cartItem).frac * 100)}% of them. Its items are in its grid above; together up to ${cartSpec(me.cartItem).cap} kg.`)}>(${esc(me.cartItem.name)}: ${kg(me.cartKg)} kg, ${kg(me.cartRoom)} kg free)</span>`) : ""}
    ${v.hasCar || v.rack ? placeRow(ui, pid, null, "car", v.car, v.rack ? ` <span class="muted">(${kg(v.carKg)}/${v.rack} kg on the racks)</span>` : "") : ""}`;
  const sel = ui.carrySel && ui.carrySel.pid === pid ? ui.carrySel : null;
  if (sel) {
    const from = sel.place === "car" ? { place: "car" } : { sid: sel.sid, place: sel.place };
    const have = sel.place === "car" ? v.car[sel.key] || 0 : ((v.people.find((x) => x.s.id === sel.sid) || {})[sel.place] || {})[sel.key] || 0;
    if (have <= 0) ui.carrySel = null;
    else {
      const n = Math.max(1, Math.min(Math.ceil(have), Math.floor(ui.carryN || have)));
      const dest = (w, label) => { const room = roomAt(state, p, w, sel.key); return `<button class="mini" data-action="carry-move" data-sid="${w.sid ?? ""}" data-place="${w.place}" ${room > 0 ? "" : "disabled"}${tip(room > 0 ? `Up to ${qtyText(Math.min(room, have))} go there` : "No room there")}>${label}</button>`; };
      const mates = v.people.filter((x) => x.s.id !== s.id);
      html += `<div class="invsel small" style="margin-top:0.3rem">Move <input type="number" min="1" max="${Math.ceil(have)}" value="${n}" data-action="carry-n" style="width:4rem"> of ${esc(stackText(sel.key, have))} to:
        ${dest({ sid: s.id, place: "pocket" }, "Pockets")} ${dest({ sid: s.id, place: "pack" }, "Pack")} ${me.cartItem ? dest({ sid: s.id, place: "cart" }, esc(me.cartItem.name)) : dest({ sid: s.id, place: "hands" }, "Carry")}
        ${v.hasCar || v.rack ? dest({ place: "car" }, "Vehicle") : ""}
        ${mates.map((m) => dest({ sid: m.s.id, place: m.cartItem && roomAt(state, p, { sid: m.s.id, place: "cart" }, sel.key) > 0 ? "cart" : roomAt(state, p, { sid: m.s.id, place: "pack" }, sel.key) > 0 ? "pack" : "hands" }, `${first(m.s)}${m.cartItem ? ` (${esc(m.cartItem.name.toLowerCase())})` : ""}`)).join(" ")}
        <button class="mini" data-action="carry-dropsel"${tip("Put it on the ground here: it stays on this tile (a marker on the map) for any team to pick up, until scavengers find it; food spoils")}>Ground</button>
        <button class="mini" data-action="carry-unsel">Cancel</button></div>`;
    }
  }
  if (me.bag && me.cartItem) html += `<div class="small warn" style="margin-top:0.2rem">Pushing the ${esc(me.bag.name.toLowerCase())} (${kg(me.bagKg + me.cartKg)} kg in all, ${kg(feltKg(me.bag) + me.cartKg * cartSpec(me.bag).frac)} kg felt): hands full, no weapon in a fight until it is let go. Set it down to leave it on this tile with everything in it.</div>`;
  else if (me.bag) html += `<div class="small warn" style="margin-top:0.2rem">In arms: the ${esc(me.bag.name)} (${kg(me.bagKg)} kg with what is in it): hands full, no weapon in a fight until it is set down. Move it to Backpack to wear it.</div>`;
  if (me.handsKg > 0 || me.bag) html += `<div style="margin-top:0.3rem"><button class="mini" data-action="carry-drophands" data-pid="${pid}" data-sid="${s.id}"${tip("Put everything carried in the arms on the ground of this tile (pick it up again from the team panel)")}>Set down what ${first(s)} carries</button></div>`;
  const loc = ui.invSel ? parseLoc(ui.invSel) : null;
  const place = loc && loc.o !== "body" ? placeOfLoc(state, loc) : null;
  const selItem = ui.invSel && loc && loc.o !== "body" ? itemAt(state, ui.invSel) : null;
  if (selItem && isCarryable(selItem) && ui.invSel !== `s:${s.id}:carry`) html += `<div style="margin-top:0.3rem"><button class="mini" data-action="carry-bag" data-sid="${s.id}" ${s.gear.carry ? "disabled" : ""}${tip(s.gear.carry ? `${s.name.split(" ")[0]} already carries the ${s.gear.carry.name}: set it down or put it on first` : `${s.name.split(" ")[0]} carries the ${selItem.name} in their arms with everything in it (${kg(itemLoad(selItem))} kg): no weapon until it is set down`)}>Carry the ${esc(selItem.name)} in arms</button></div>`;
  if (place === `party:${pid}` && itemAt(state, ui.invSel)) html += `<div style="margin-top:0.3rem"><button class="mini" data-action="carry-dropitem"${tip("Put the selected item on the ground of this tile: any team here can pick it up again")}>Put the ${esc(itemAt(state, ui.invSel).name)} on the ground</button></div>`;
  if (ui.carryMsg) html += `<div class="result small">${esc(ui.carryMsg)}</div>`;
  return html + `</div>`;
}

// ---------- in the team panel ----------
export function teamCarryCard(state, ui, p) {
  const v = holdView(state, p);
  if (!v) return "";
  const lines = v.people.map((x) => {
    const parts = [["pocket", "pockets"], ["pack", "pack"], ["hands", "carried"], ["cart", x.cartItem ? x.cartItem.name.toLowerCase() : "cart"]].filter(([pl]) => Object.keys(x[pl]).length).map(([pl, w]) => `${esc(w)}: ${esc(recText(x[pl]))}`);
    if (x.bag) parts.push(x.cartItem ? `pushes the ${esc(x.bag.name.toLowerCase())} (${kg(x.bagKg + x.cartKg)} kg in all)` : `in arms: the ${esc(x.bag.name)} (${kg(x.bagKg)} kg)`);
    return `<div${x.handsKg > 0 || x.bag ? ' class="warn"' : ""}>${first(x.s)}: ${parts.join(" · ") || '<span class="muted">nothing</span>'}${x.handsKg > 0 || x.bag ? ` <button class="mini" data-action="carry-drophands" data-pid="${p.id}" data-sid="${x.s.id}"${tip(`Set down what ${x.s.name.split(" ")[0]} carries in the arms (${kg(x.handsKg + x.bagKg)} kg) on this tile's ground`)}>Set down</button>` : ""}</div>`;
  }).join("");
  const carriers = v.people.filter((x) => x.handsKg > 0 || x.bag).length;
  const site = groundAt(state, partyTile(p));
  return `<div class="card small"><div class="spread"><b${tip("Who keeps the team's food, water, firewood and the rest where: pockets, packs, carried in the arms (no weapon in a fight until set down), the vehicle. Open someone's inventory to move it about.")}>Carried</b>${carriers > 1 ? `<button class="mini" data-action="carry-drophands" data-pid="${p.id}">Everyone set down</button>` : ""}</div>
    ${lines}${Object.keys(v.car).length ? `<div>Vehicle: ${esc(recText(v.car))}</div>` : ""}
    ${site && site.items.length ? `<div class="spread" style="margin-top:0.3rem"><span${tip("On the ground of this tile: put down by a team, or left after a fight")}>On the ground here: ${esc(site.items.slice(0, 4).map(groundItemText).join(", "))}${site.items.length > 4 ? "…" : ""}</span><button class="mini" data-action="carry-pick" data-pid="${p.id}">Pick up…</button></div>` : ""}
  </div>`;
}

// ---------- actions ----------
const partyFor = (state, ui) => state.parties.find((x) => ui.carrySel && x.id === ui.carrySel.pid);
export const CARRY_ACTIONS = {
  "carry-setqty": (state, ui, d) => { if (ui.carry && ui.carry.kind === "qty") ui.carry.qty = Math.max(0, Math.floor(Number(d.n) || 0)); },
  "carry-go": (state, ui, d, ev, actions) => {
    const c = ui.carry;
    if (!c || c.kind !== "qty") return;
    ui.carry = null;
    if (actions && actions["xp-order"]) actions["xp-order"]({ ...c.d, qty: String(Math.max(0, Math.floor(c.qty || 0))) });
  },
  "carry-close": (state, ui) => { ui.carry = null; ui.carryMsg = ""; },
  "carry-sel": (state, ui, d) => {
    const s = { pid: Number(d.pid), sid: d.sid === "" ? null : Number(d.sid), place: d.place, key: d.key };
    const same = ui.carrySel && ui.carrySel.pid === s.pid && ui.carrySel.sid === s.sid && ui.carrySel.place === s.place && ui.carrySel.key === s.key;
    ui.carrySel = same ? null : s;
    ui.carryN = null;
    ui.carryMsg = "";
  },
  "carry-unsel": (state, ui) => { ui.carrySel = null; },
  "carry-move": (state, ui, d) => {
    const p = partyFor(state, ui);
    if (!p) return;
    const sel = ui.carrySel;
    const from = sel.place === "car" ? { place: "car" } : { sid: sel.sid, place: sel.place };
    const to = d.place === "car" ? { place: "car" } : { sid: Number(d.sid), place: d.place };
    ui.carryMsg = moveHeld(state, p, sel.key, ui.carryN ?? Infinity, from, to);
    ui.carryN = null;
  },
  "carry-dropsel": (state, ui) => {
    const p = partyFor(state, ui);
    if (!p) return;
    const sel = ui.carrySel;
    ui.carryMsg = dropHeld(state, p, sel.key, ui.carryN ?? Infinity, sel.place === "car" ? { place: "car" } : { sid: sel.sid, place: sel.place });
    ui.carryN = null;
  },
  "carry-drophands": (state, ui, d) => {
    const p = state.parties.find((x) => x.id === Number(d.pid));
    if (!p) return;
    ui.carryMsg = dropHands(state, p, d.sid ? Number(d.sid) : null);
    ui.xpMsg = ui.carryMsg;
  },
  "carry-bag": (state, ui, d) => { // the selected bag (storage, cargo, a body, another's pack) into this person's arms
    if (!ui.invSel) return;
    const msg = moveItem(state, ui.invSel, `s:${Number(d.sid)}:carry`);
    ui.carryMsg = msg;
    if (!/^(Only|Items only|Too heavy|That slot|Nothing|Bodies|No room)/.test(msg)) ui.invSel = null;
  },
  "carry-dropitem": (state, ui) => {
    if (!ui.invSel) return;
    ui.carryMsg = dropItemToGround(state, ui.invSel);
    ui.invSel = null;
  },
  "carry-pick": (state, ui, d) => { ui.carry = { kind: "pick", partyId: Number(d.pid) }; ui.carryMsg = ""; ui.carryPick = {}; },
  "carry-take": (state, ui, d) => {
    const p = ui.carry && state.parties.find((x) => x.id === ui.carry.partyId);
    if (!p) return;
    const i = Number(d.i);
    const n = ui.carryPick && ui.carryPick[i] != null ? ui.carryPick[i] : Infinity;
    ui.carryMsg = pickUpGround(state, p, i, n, d.arms ? Number(d.arms) : null);
    ui.carryPick = {};
  },
  "carry-takeall": (state, ui) => {
    const p = ui.carry && state.parties.find((x) => x.id === ui.carry.partyId);
    if (p) ui.carryMsg = pickUpAll(state, p);
  },
};
export const CARRY_CHANGE = {
  "carry-qty": (state, ui, el) => { if (ui.carry && ui.carry.kind === "qty") ui.carry.qty = Math.max(0, Math.floor(Number(el.value) || 0)); },
  "carry-n": (state, ui, el) => { ui.carryN = Math.max(1, Math.floor(Number(el.value) || 1)); },
  "carry-pickn": (state, ui, el) => { ui.carryPick = { ...(ui.carryPick || {}), [Number(el.dataset.i)]: Math.max(1, Number(el.value) || 1) }; },
};
