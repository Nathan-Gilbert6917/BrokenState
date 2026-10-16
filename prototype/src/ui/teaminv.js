// The team inventory window: every member's paper doll and the team's cargo side by side (moving things between
// them works as in the one-person inventory), and, while the team stands on one of your bases' tiles, the two
// transfer views: Drop off (the team's things into the base's armory and stores) and Load (the base's armory and
// stores onto a member or into the team's cargo). Rules live in sim/teaminv.js; this file draws and picks.
// ui.inv = { sid, team: partyId, tab: "team" | "drop" | "load" } (ui.inv.sid: the member whose inventory a click on
// a cargo item sends things to, as in ui/inventory.js); ui.tiPick = { items: { loc: true }, sup: { key: qty } };
// ui.tiTarget = "cargo" | a member's id (where loaded items go).
import { SUPPLIES, supWeight } from "../sim/data.js";
import { survivorById } from "../sim/world.js";
import { partyMembers, partyTile, tileLabel } from "../sim/parties.js";
import { SLOT_NAMES, parseLoc, itemLoad } from "../sim/inventory.js";
import { teamBase, transferProblem, teamsAtBase, teamHoldings, baseHoldings, dropOff, dropAllCargo, dropAllSupplies, loadFromBase, isPlayerTeam, dropHeldOff, pendingUnpack, unpackSpots, unpackHome } from "../sim/teaminv.js";
import { recText, HANDS_KG } from "../sim/carry.js"; // the supplies each member holds (pockets, pack, arms)
import { holdSection } from "./carry.js"; // under each paper doll: the supplies they carry, moved about as in their own inventory
import { doll, storageBox, selBar, tile, SUPPLY_ICON, INV_ACTIONS } from "./inventory.js";
import { supplyIcon } from "./stackmove.js"; // a supply's own drawing (ui/itemart.js)
import { survivorURL, spriteImg } from "./sprites.js";
import { shortName } from "./names.js";
import { supplyName } from "../sim/itemnames.js";
import { isRoundKey } from "../sim/rounds.js"; // rounds in the stores: "… FMJ — loose", the count on the right

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const kg = (x) => `${Math.round(x * 10) / 10}`;
const qty = (q) => (Math.abs(q - Math.round(q)) < 1e-6 ? String(Math.round(q)) : kg(q));
const first = (s) => esc(shortName(s));
const bar = (load, cap) => `<div class="bar"><i style="width:${Math.min(100, (load / Math.max(1, cap)) * 100)}%;background:${load > cap * 0.9 ? "var(--danger)" : "var(--info)"}"></i></div>`;
const partyOf = (state, ui) => (ui.inv && ui.inv.team != null ? state.parties.find((x) => x.id === ui.inv.team) || null : null);
const freshPick = () => ({ items: {}, sup: {} });

// ---------- ways in ----------
// The team panel's buttons (ui/expedition.js): the team inventory, and Drop off / Load while on a base's tile.
export function teamInvBar(state, p, live = true) {
  if (!live || !isPlayerTeam(p)) return "";
  const base = teamBase(state, p);
  const why = base ? transferProblem(state, p, base) : "";
  const b = (tab, label, hint, off = false) => `<button class="mini" data-action="ti-open" data-id="${p.id}" data-tab="${tab}" ${off ? "disabled" : ""}${tip(hint)}>${label}</button>`;
  return `<div class="row" style="margin-top:0.3rem;flex-wrap:wrap;gap:0.25rem">${b("team", "🎒 Team inventory", "Every member's kit (worn, held, pockets, rig, pack) and the team's cargo side by side: move things between them")}${base ? `${b("drop", `Drop off at ${esc(base.name)}…`, why || `Pick what goes from the team (its people's kit, the cargo, the supplies) into ${base.name}'s armory and stores`, !!why)}${b("load", `Load from ${esc(base.name)}…`, why || `Pick what the team takes from ${base.name}'s armory and stores: onto a member or into the cargo`, !!why)}` : ""}</div>`;
}
// The tile view's "Your teams here" card on one of your bases (ui/ui.js, next to Enter base): Drop off and Load, only
// when they can be used now.
export function transferButtons(state, p) {
  const base = isPlayerTeam(p) ? teamBase(state, p) : null;
  if (!base || transferProblem(state, p, base)) return "";
  return `<button data-action="ti-open" data-id="${p.id}" data-tab="drop"${tip(`Pick what goes from the team into ${base.name}'s armory and stores (the team stays out here)`)}>Drop off…</button><button data-action="ti-open" data-id="${p.id}" data-tab="load"${tip(`Pick what the team takes from ${base.name}'s armory and stores`)}>Load…</button>`;
}
// The base screen's Armory tab (ui/ui.js): your teams standing on the base's tile, with Load and Drop off.
export function teamsHereCard(state, base) {
  const list = teamsAtBase(state, base);
  if (!list.length) return "";
  return `<h3${tip("Your teams standing on this base's tile (gone inside or not). Load them from the armory and stores, or take their things in.")}>Teams here (${list.length})</h3><div class="card small">${list.map((p) => {
    const names = partyMembers(state, p).map(first).join(", ");
    const why = transferProblem(state, p, base);
    return `<div class="spread" style="margin-bottom:0.25rem"><span><b>${names}</b></span><span class="row" style="gap:0.25rem">
      <button class="mini" data-action="ti-open" data-id="${p.id}" data-tab="load" ${why ? "disabled" : ""}${tip(why || "Move things from the armory and stores onto a member or into the team's cargo")}>Load team…</button>
      <button class="mini" data-action="ti-open" data-id="${p.id}" data-tab="drop" ${why ? "disabled" : ""}${tip(why || "Move the team's things into the armory and stores")}>Drop off…</button>
      <button class="mini" data-action="ti-open" data-id="${p.id}" data-tab="team"${tip("The team's inventory: every member and the cargo")}>Inventory</button></span></div>`;
  }).join("")}</div>`;
}

// ---------- the window ----------
export function teamInvModal(state, ui) {
  const p = partyOf(state, ui);
  const members = p ? partyMembers(state, p) : [];
  if (!p || !members.length) { ui.inv = null; ui.tiPick = null; return null; }
  if (!members.some((m) => m.id === ui.inv.sid)) ui.inv.sid = members[0].id;
  const base = teamBase(state, p);
  const why = base ? transferProblem(state, p, base) : "The team is not at one of your bases.";
  let tab = ui.inv.tab || "team";
  if (tab !== "team" && why) tab = ui.inv.tab = "team";
  ui.tiPick = ui.tiPick || freshPick();
  const tabBtn = (t, label, hint, off = false) => `<button class="mini ${tab === t ? "active" : ""}" data-action="ti-tab" data-tab="${t}" ${off ? "disabled" : ""}${tip(hint)}>${label}</button>`;
  const tabs = `<div class="invwho">${tabBtn("team", "Inventory", "Every member and the team's cargo: move things between them")}${tabBtn("drop", base ? `Drop off at ${esc(base.name)}` : "Drop off", why || "Pick the team's things to put in the base's armory and stores", !!why)}${tabBtn("load", base ? `Load from ${esc(base.name)}` : "Load from base", why || "Pick things from the base's armory and stores to take", !!why)}</div>`;
  const body = tab === "team" ? teamTab(state, ui, p, members) : transferTab(state, ui, p, base, tab);
  return `<div class="box wide invbox loot">
    <div class="spread"><h1>Team inventory: ${members.map(first).join(", ")}</h1><span class="muted">${base ? `at ${esc(base.name)}` : esc(tileLabel(state, partyTile(p)))}</span></div>
    ${tabs}
    ${ui.invMsg ? `<div class="result small">${esc(ui.invMsg)}</div>` : ""}
    ${body}
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button class="primary" data-action="inv-close">Close</button></div>
  </div>`;
}

// Everyone's paper doll and the cargo; clicks and drags move things as in the one-person inventory.
function teamTab(state, ui, p, members) {
  const user = survivorById(state, ui.inv.sid);
  const cols = members.map((s) => `<div class="invcol" style="flex:0 0 17rem"><div class="spread"><b>${s.leader ? "★ " : ""}${first(s)}</b>${s.id === ui.inv.sid ? `<span class="small muted"${tip("A cargo item clicked twice goes to this person")}>receives</span>` : ""}</div>${doll(state, ui, s, `s:${s.id}`, spriteImg(survivorURL(s, state.seed), 5), { user: s })}${holdSection(state, ui, s)}</div>`).join("");
  const packed = Object.entries(p.supplies || {}).filter(([k, v]) => SUPPLIES[k] && v >= 1).map(([k, v]) => `${SUPPLY_ICON[k] || (SUPPLIES[k] && SUPPLIES[k].icon) || "▪"} ${Math.floor(v)} ${SUPPLIES[k].name.toLowerCase()}`).join(" · ");
  const cargo = `<div class="invcol" style="flex:1 0 17rem">${storageBox(state, ui, `party:${p.id}`, user)}${packed ? `<div class="small muted"${tip("Packed at the start: shared out among the people (or riding in the vehicle) and eaten first on the road")}>Packed: ${esc(packed)}</div>` : ""}</div>`;
  const html = `<div class="row" style="align-items:flex-start;gap:1rem;overflow-x:auto;padding-bottom:0.4rem">${cols}${cargo}</div>
    ${selBar(state, ui, `party:${p.id}`)}
    <div class="small muted" style="margin-top:0.5rem">Click an item, then where it should go (another member's slot, pocket or pack cell, or the cargo), or drag it. Click an item twice: off a person into the cargo, or out of the cargo onto the person marked "receives" (the last one you clicked).</div>`;
  return html.replace(/data-action="inv-click"/g, 'data-action="ti-click"');
}

// A row of item tiles (picked ones lit); pickable: clicking one picks or unpicks it.
function pickTiles(ui, list, user, pickable) {
  return list.map(({ item, loc, label }) => `<div class="islot store${ui.tiPick.items[loc] ? " sel" : ""}"${pickable ? ` data-action="ti-pick" data-loc="${loc}"` : ""}${tip(`${label ? `${label}: ` : ""}${item.name}, ${kg(itemLoad(item))} kg${pickable ? ". Click to pick it (again to leave it)." : ""}`)}>${label ? `<span class="islab">${esc(label)}</span>` : ""}${tile(item, loc, user, false)}</div>`).join("");
}
function supTiles(ui, sup, pickable, side) {
  return Object.entries(sup).map(([k, n]) => {
    const amt = typeof n === "number" ? n : n.all;
    const extra = typeof n === "number" ? "" : n.packed >= 0.05 && n.found >= 0.05 ? ` (${qty(n.packed)} packed, ${qty(n.found)} found)` : n.found >= 0.05 ? " (found)" : " (packed)";
    const picked = ui.tiPick.sup[k] != null;
    return `<div class="islot store${picked ? " sel" : ""}"${pickable ? ` data-action="ti-sup" data-key="${k}" data-side="${side}"` : ""}${tip(`${qty(amt)} ${SUPPLIES[k].name.toLowerCase()}${extra}, ${kg(supWeight(k) * amt)} kg (${supWeight(k)} kg each)${pickable ? ". Click to pick it; set how many below." : ""}`)}><div class="itile"><span class="iico">${supplyIcon(k)}</span><span class="iname">${esc(supplyName(k))}</span><span class="icount">×${qty(amt)}</span><span class="ikg">${kg(supWeight(k) * amt)}</span></div></div>`;
  }).join("");
}
const whereLabel = (loc) => { const L = parseLoc(loc); return L.slot === "rig" && L.i != null ? SLOT_NAMES.pouch : L.slot === "insert" ? `${L.i === "front" ? "Front" : "Back"} plate` : SLOT_NAMES[L.slot] || L.slot; };

// The team's supplies a member holds (sim/carry.js: pockets, pack, arms), with Drop off for them alone.
function heldLine(m, drop) {
  const h = m.hold;
  if (!h || !(h.kg > 0.05)) return "";
  const parts = [["hands", "arms"], ["pack", "pack"], ["pocket", "pockets"]].filter(([pl]) => Object.keys(h[pl] || {}).length).map(([pl, w]) => `${w}: ${esc(recText(h[pl]))}`);
  return `<div class="small ${h.handsKg > 0 ? "warn" : "muted"}" style="margin-top:0.2rem"${tip(`The team's supplies ${m.s.name.split(" ")[0]} holds (part of the totals in the cargo below)${h.handsKg > 0 ? `; ${kg(h.handsKg)}/${HANDS_KG} kg in the arms: no weapon in a fight until it is set down` : ""}`)}>Holds ${kg(h.kg)} kg: ${parts.join(" · ")}${drop ? ` <button class="mini" data-action="ti-dropheld" data-sid="${m.s.id}"${tip(`Put everything of the team's supplies ${m.s.name.split(" ")[0]} holds (arms, pack, pockets) in the stores`)}>Drop off what ${first(m.s)} holds</button>` : ""}</div>`;
}
// Drop off (team → base) and Load (base → team): the team on the left, the base on the right.
function transferTab(state, ui, p, base, tab) {
  const drop = tab === "drop";
  const H = teamHoldings(state, p);
  const B = baseHoldings(state, base);
  const target = ui.tiTarget == null ? "cargo" : ui.tiTarget;
  const tgtBtn = (val, label, hint) => (drop ? "" : `<button class="mini ${String(target) === String(val) ? "active" : ""}" data-action="ti-target" data-v="${val}"${tip(hint)}>${String(target) === String(val) ? "✓ " : ""}${label}</button>`);
  // The team.
  const people = H.members.map((m) => `<div style="margin-top:0.5rem"><div class="spread"><b>${m.s.leader ? "★ " : ""}${first(m.s)}</b><span class="row" style="gap:0.3rem"><span class="small ${m.worn > m.max ? "danger" : "muted"}"${tip("Worn and carried on them (kg) against their max load (40, 28 with a Bad Back, 48 with a Strong Back, + the pack, a rig and Packrat)")}>${kg(m.worn)}/${m.max} kg</span>${tgtBtn(m.s.id, `Onto ${first(m.s)}`, `Loaded items go onto ${m.s.name.split(" ")[0]}: their own slot if free, a rig pouch, a pocket or the pack (and the team must still carry its load)`)}</span></div>
      <div class="istore" style="min-height:2.5rem">${pickTiles(ui, m.spots.map((x) => ({ ...x, label: whereLabel(x.loc) })), m.s, drop) || `<span class="small muted">Nothing on them.</span>`}</div>${heldLine(m, drop)}</div>`).join("");
  const cargo = `<div style="margin-top:0.7rem"><div class="spread"><b${tip(H.cargo.vehicle ? "The team's cargo rides in its vehicle; the packed and found supplies with it" : "On foot the cargo and the supplies are shared out among the people")}>${esc(H.cargo.name)}</b><span class="row" style="gap:0.3rem"><span class="small ${H.load > H.cap ? "danger" : "muted"}"${tip("Supplies and cargo against what the team can carry on top of what it wears (and its vehicle)")}>load ${Math.round(H.load)}/${Math.round(H.cap)} kg</span>${tgtBtn("cargo", "Into the cargo", "Loaded items go into the team's cargo (as long as it can carry them)")}</span></div>${bar(H.load, H.cap)}
    <div class="istore" style="min-height:2.5rem">${pickTiles(ui, H.cargo.gear, survivorById(state, ui.inv.sid), drop)}${supTiles(ui, H.cargo.supplies, drop, "team") || ""}${!H.cargo.gear.length && !Object.keys(H.cargo.supplies).length ? `<span class="small muted">Empty.</span>` : ""}</div>
    ${Object.keys(H.cargo.held || {}).length ? `<div class="small muted"${tip("The team's supplies riding in the vehicle (part of the totals above)")}>In the vehicle: ${esc(recText(H.cargo.held))}</div>` : ""}
    ${H.cargo.bodies ? `<div class="small muted">${H.cargo.bodies} bod${H.cargo.bodies === 1 ? "y" : "ies"} in the car (Drop off all cargo lays ${H.cargo.bodies === 1 ? "it" : "them"} out at the base)</div>` : ""}</div>`;
  // The base.
  const armory = `<div style="margin-top:0.5rem"><div class="spread"><b${tip("Gear stored at this base")}>Armory</b><span class="small muted">${B.armory.length} item${B.armory.length === 1 ? "" : "s"}</span></div>
    <div class="istore">${pickTiles(ui, B.armory, survivorById(state, typeof target === "number" ? target : ui.inv.sid), !drop) || `<span class="small muted">Empty.</span>`}</div></div>`;
  const stores = `<div style="margin-top:0.7rem"><b${tip("The base's stores: food, water, fuel, meds, rounds by calibre and type, parts…")}>Stores</b>
    <div class="istore">${supTiles(ui, B.stock, !drop, "base") || `<span class="small muted">Empty.</span>`}</div></div>`;
  // What is picked, with how many of each supply, and the button.
  const pickedItems = Object.keys(ui.tiPick.items).length;
  const supRows = Object.entries(ui.tiPick.sup).map(([k, q]) => {
    const have = drop ? (H.cargo.supplies[k] ? H.cargo.supplies[k].all : 0) : B.stock[k] || 0;
    if (!(have > 0) || !SUPPLIES[k]) return "";
    const v = Math.min(have, q);
    return `<span class="chip">${supplyIcon(k)} <input type="number" class="qty" min="0" max="${qty(have)}" step="1" value="${qty(v)}" data-action="ti-qty" data-key="${k}" style="width:4em"${tip(`How many of the ${qty(have)} ${SUPPLIES[k].name.toLowerCase()} (${supWeight(k)} kg each)`)}> of ${qty(have)} ${esc(SUPPLIES[k].name.toLowerCase())} <button class="mini" data-action="ti-sup" data-key="${k}" data-side="${drop ? "team" : "base"}"${tip("Leave it")}>×</button></span>`;
  }).join(" ");
  const tgtName = String(target) === "cargo" ? `the team's cargo${H.cargo.vehicle ? ` (${esc(H.cargo.name.replace(/ \(team cargo\)$/, ""))})` : ""}` : (() => { const s = survivorById(state, Number(target)); return s ? first(s) : "the cargo"; })();
  const any = pickedItems || supRows;
  const go = drop
    ? `<button class="primary" data-action="ti-go" ${any ? "" : "disabled"}${tip(`Put what is picked in ${base.name}'s armory and stores. Something a member wears that the team needs to carry its load (a pack, a rig) stays.`)}>Drop off picked</button>`
    : `<button class="primary" data-action="ti-go" ${any ? "" : "disabled"}${tip("Items go where the ✓ is (a member, or the cargo); supplies into the team's packed supplies. Only what the team can carry moves.")}>Load picked</button>`;
  const quick = drop
    ? `<button class="mini" data-action="ti-dropcargo"${tip(`Everything in the cargo: its gear, the found supplies${H.cargo.bodies ? " and the bodies in the car" : ""}, as when the team comes home. The kit on the people and the packed supplies stay.`)}>Drop off all cargo</button>
       <button class="mini" data-action="ti-dropsup"${tip("Every supply the team has, packed and found (food, water, rounds, meds…). The kit stays on the people.")}>Drop off all supplies</button>`
    : "";
  const bottom = `<div class="invsel small" style="margin-top:0.6rem">${any ? `Picked: ${pickedItems ? `<b>${pickedItems} item${pickedItems === 1 ? "" : "s"}</b>` : ""} ${supRows}` : `Click ${drop ? "the team's" : "the base's"} items and supplies to pick them.`}
    ${drop ? "" : `<span class="muted">Items go to: <b>${tgtName}</b>.</span>`}
    <div class="row" style="margin-top:0.4rem;gap:0.3rem;flex-wrap:wrap">${go}${any ? `<button class="mini" data-action="ti-clear">Clear</button>` : ""}${drop ? `<button class="mini" data-action="ti-all"${tip("Pick everything in the cargo")}>Pick all cargo</button>` : ""}${quick}</div></div>`;
  const left = `<div class="invcol"><div class="invlabel">The team${drop ? "" : ": where things go"}</div>${people}${cargo}</div>`;
  const right = `<div class="invcol"><div class="invlabel">${esc(base.name)}</div>${armory}${stores}</div>`;
  return `<div class="invcols">${left}${right}</div>${bottom}`;
}

// ---------- actions (wired in main.js) ----------
const resetPick = (ui) => { ui.tiPick = freshPick(); };
export const TEAMINV_ACTIONS = {
  "ti-open": (state, ui, d) => {
    const p = state.parties.find((x) => x.id === Number(d.id));
    const m = p ? partyMembers(state, p)[0] : null;
    if (!p || !m) return;
    ui.inv = { sid: m.id, team: p.id, tab: d.tab || "team", loot: false };
    ui.invSel = null; ui.invMsg = ""; ui.tiTarget = "cargo";
    resetPick(ui);
  },
  "ti-tab": (state, ui, d) => { if (!ui.inv || ui.inv.team == null) return; ui.inv.tab = d.tab; ui.invSel = null; ui.invMsg = ""; resetPick(ui); },
  // The team tab: a click on a member's item makes them the one a cargo item clicked twice goes to.
  "ti-click": (state, ui, d, ev) => {
    if (!ui.inv) return;
    const L = parseLoc(d.loc);
    if (L.o === "s" && !ui.invSel) ui.inv.sid = L.id;
    INV_ACTIONS["inv-click"](state, ui, d, ev);
  },
  "ti-pick": (state, ui, d) => {
    if (!ui.tiPick) resetPick(ui);
    if (ui.tiPick.items[d.loc]) delete ui.tiPick.items[d.loc];
    else ui.tiPick.items[d.loc] = true;
  },
  "ti-sup": (state, ui, d) => {
    const p = partyOf(state, ui);
    if (!p) return;
    if (!ui.tiPick) resetPick(ui);
    if (ui.tiPick.sup[d.key] != null) { delete ui.tiPick.sup[d.key]; return; }
    const base = teamBase(state, p);
    const have = d.side === "team" ? (teamHoldings(state, p).cargo.supplies[d.key] || { all: 0 }).all : base ? base.stock[d.key] || 0 : 0;
    if (have > 0) ui.tiPick.sup[d.key] = have; // all of it until changed
  },
  "ti-target": (state, ui, d) => { ui.tiTarget = d.v === "cargo" ? "cargo" : Number(d.v); },
  "ti-clear": (state, ui) => resetPick(ui),
  "ti-all": (state, ui) => {
    const p = partyOf(state, ui);
    if (!p) return;
    const H = teamHoldings(state, p);
    resetPick(ui);
    for (const g of H.cargo.gear) ui.tiPick.items[g.loc] = true;
    for (const [k, e] of Object.entries(H.cargo.supplies)) if (e.found > 0) ui.tiPick.sup[k] = e.found;
  },
  "ti-go": (state, ui) => {
    const p = partyOf(state, ui);
    if (!p || !ui.tiPick) return;
    const base = teamBase(state, p);
    const items = Object.keys(ui.tiPick.items);
    const supplies = {};
    for (const [k, q] of Object.entries(ui.tiPick.sup)) {
      const have = ui.inv.tab === "drop" ? (teamHoldings(state, p).cargo.supplies[k] || { all: 0 }).all : base ? base.stock[k] || 0 : 0;
      supplies[k] = q >= have - 1e-9 ? Infinity : q; // all of it: fractions too
    }
    const r = ui.inv.tab === "drop" ? dropOff(state, p, { items, supplies }) : loadFromBase(state, p, { items, supplies }, ui.tiTarget == null ? "cargo" : ui.tiTarget);
    ui.invMsg = r.text;
    resetPick(ui);
  },
  "ti-dropheld": (state, ui, d) => { const p = partyOf(state, ui); if (p) { ui.invMsg = dropHeldOff(state, p, Number(d.sid)).text; resetPick(ui); } },
  "ti-dropcargo": (state, ui) => { const p = partyOf(state, ui); if (p) { ui.invMsg = dropAllCargo(state, p).text; resetPick(ui); } },
  "ti-dropsup": (state, ui) => { const p = partyOf(state, ui); if (p) { ui.invMsg = dropAllSupplies(state, p).text; resetPick(ui); } },
};
// Typed in: how many of a picked supply.
export const TEAMINV_CHANGE = {
  "ti-qty": (state, ui, el) => {
    if (!ui.tiPick || ui.tiPick.sup[el.dataset.key] == null) return;
    ui.tiPick.sup[el.dataset.key] = Math.max(0, Number(el.value) || 0);
  },
};

// ---------- home from a trip (INV-01: sim/teaminv.js pendingUnpack / unpackHome) ----------
// The window over the map when a team is home and its people carry things on them: each person's pack, bag in the
// arms and pockets, ticked or not (the pack, the bag, rounds and a job's tool ticked to start with); Put away moves the
// ticked ones into the armory (rounds and ammo cans on into the stores), Keep everything leaves them on the people.
// ui.unpackPick = { baseId, hour, items: { loc: true|false } } (the ticks; made fresh for each pending unpack).
export const unpackUp = (state, ui) => !state.autopilot && ui.started && !state.combat && !!pendingUnpack(state);
function unpackTicks(state, ui, u) {
  if (!ui.unpackPick || ui.unpackPick.baseId !== u.baseId || ui.unpackPick.hour !== u.hour) ui.unpackPick = { baseId: u.baseId, hour: u.hour, items: {} };
  const P = ui.unpackPick.items;
  const people = u.sids.map((id) => survivorById(state, id)).filter(Boolean);
  for (const s of people) for (const x of unpackSpots(s)) if (P[x.loc] == null) P[x.loc] = x.def;
  return people;
}
export function unpackModal(state, ui) {
  const u = pendingUnpack(state);
  if (!u) { ui.unpackPick = null; return null; }
  const base = state.bases.find((b) => b.id === u.baseId);
  const people = unpackTicks(state, ui, u);
  const P = ui.unpackPick.items;
  let n = 0;
  const rows = people.map((s) => {
    const spots = unpackSpots(s);
    const cells = spots.map((x) => {
      const on = !!P[x.loc];
      if (on) n++;
      return `<label class="row small" style="gap:0.35rem;margin:0.1rem 0"${tip(`${SLOT_NAMES[x.where] || x.where}: ${x.item.name}, ${kg(x.kg)} kg. Ticked: into ${base.name}'s armory${isRoundKey(x.item.key) ? " (the rounds into its stores)" : ""}.`)}><input type="checkbox" data-action="up-tick" data-loc="${x.loc}"${on ? " checked" : ""}><span class="muted" style="width:5.5rem">${esc(SLOT_NAMES[x.where] || x.where)}</span><span>${esc(x.item.name)}</span><span class="muted">${kg(x.kg)} kg</span></label>`;
    }).join("");
    return `<div class="card small" style="margin:0.3rem 0"><div class="spread"><b>${esc(s.name)}</b><span class="row" style="gap:0.25rem"><button class="mini" data-action="up-person" data-sid="${s.id}" data-v="1">All</button><button class="mini" data-action="up-person" data-sid="${s.id}" data-v="0">None</button></span></div>${cells}</div>`;
  }).join("");
  return `<div class="box" style="max-width:36rem">
    <h1>Home from a trip: ${esc(base ? base.name : "")}</h1>
    <div class="small">${esc(u.team || "The team")} is home.${u.stored ? ` Already in the stores: <b>${esc(u.stored)}</b>.` : " Nothing new went into the stores."}</div>
    <div class="small muted" style="margin:0.3rem 0">What they still carry on them: tick what goes into ${esc(base ? base.name : "the base")}'s armory (boxes of rounds go into its stores and count in its ammo). The rest stays on them.</div>
    <div style="max-height:55vh;overflow:auto">${rows}</div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end;gap:0.4rem"><button data-action="up-keep"${tip("Everyone keeps what they carry")}>Keep everything</button><button class="primary" data-action="up-store"${tip("Put the ticked things in the armory")}>Put away ${n} thing${n === 1 ? "" : "s"}</button></div>
  </div>`;
}
export const UNPACK_ACTIONS = {
  "up-tick": (state, ui, d) => { if (ui.unpackPick) ui.unpackPick.items[d.loc] = !ui.unpackPick.items[d.loc]; },
  "up-person": (state, ui, d) => { const s = survivorById(state, Number(d.sid)); if (!ui.unpackPick || !s) return; for (const x of unpackSpots(s)) ui.unpackPick.items[x.loc] = d.v === "1"; },
  "up-store": (state, ui) => {
    const u = pendingUnpack(state);
    if (!u) return;
    unpackTicks(state, ui, u);
    const locs = Object.entries(ui.unpackPick.items).filter(([, on]) => on).map(([loc]) => loc);
    unpackHome(state, u.baseId, locs);
    ui.unpackPick = null;
  },
  "up-keep": (state, ui) => { const u = pendingUnpack(state); if (u) unpackHome(state, u.baseId, []); ui.unpackPick = null; },
};
