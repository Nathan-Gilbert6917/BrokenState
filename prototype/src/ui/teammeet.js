// The "Teams together" window: your teams standing on one tile (any number of them) side by side, two at a time (pick
// either side from the chips), to move people across, split some off as a new team, merge two teams, or hand goods
// from one to the other. Rules live in sim/teammeet.js; this file draws and picks.
// ui.meet = { tile, a, b (party ids), tab: "people" | "goods", people: { sid: true }, items: { loc: true },
//             sup: { key: qty }, target: "cargo" | a survivor id of team b, msg }.
// Ways in: the tile panel's "Your teams here" (two or more teams), the team panel, the right-click menu (ui/teamctx.js).
import { SUPPLIES, supWeight } from "../sim/data.js";
import { partyMembers, partyTile, tileLabel, teamName, partyCapacity, poolLoad } from "../sim/parties.js";
import { itemLoad } from "../sim/inventory.js";
import { wornLoad, maxLoad } from "../sim/load.js";
import { teamHoldings } from "../sim/teaminv.js";
import { teamsOnTile, teamsTogether, meetProblem, standProblem, giveGoods, moveMembers, mergeTeams } from "../sim/teammeet.js";
import { partyFleet, vehicleLabel } from "../sim/vehicles.js";
import { supplyName } from "../sim/itemnames.js";
import { shortName } from "./names.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const kg = (x) => `${Math.round(x * 10) / 10}`;
const qty = (q) => (Math.abs(q - Math.round(q)) < 1e-6 ? String(Math.round(q)) : kg(q));
const first = (s) => esc(shortName(s));
const byId = (state, id) => state.parties.find((q) => q.id === Number(id)) || null;
const fresh = (m) => { m.people = {}; m.items = {}; m.sup = {}; m.target = "cargo"; };

// ---------- ways in ----------
// The tile panel's line under "Your teams here" when two or more of your teams stand on the tile.
export function meetButton(state, tile) {
  const here = teamsOnTile(state, tile);
  if (!here.length) return "";
  return `<button data-action="tm-open" data-tile="${tile}"${tip(`${here.length} of your teams stand here: move people between them, split some off, merge them, or hand goods over`)}>Teams together (${here.length})…</button>`;
}
// The team panel's line: the other teams on its tile.
export function meetLine(state, p) {
  const others = teamsTogether(state, p);
  if (!others.length) return "";
  return `<div class="row small" style="margin-top:0.3rem;gap:0.3rem;flex-wrap:wrap"><span class="muted">Here too: ${others.map((q) => esc(teamName(state, q))).join(", ")}</span><button class="mini" data-action="tm-open" data-tile="${partyTile(p)}" data-a="${p.id}"${tip("Move people between the teams, split some off, merge, or hand goods over")}>Teams together…</button></div>`;
}

// ---------- the window ----------
export function teamMeetModal(state, ui) {
  const m = ui.meet;
  const here = m ? teamsOnTile(state, m.tile) : [];
  if (!m || here.length < 2) { if (m) ui.meet = null; return null; }
  if (!here.some((q) => q.id === m.a)) m.a = here[0].id;
  if (m.b === m.a || !here.some((q) => q.id === m.b)) m.b = (here.find((q) => q.id !== m.a) || here[1]).id;
  const A = /** @type {any} */ (byId(state, m.a)), B = /** @type {any} */ (byId(state, m.b));
  const chips = (side, cur) => here.map((q) => `<button class="mini ${q.id === cur ? "active" : ""}" data-action="tm-side" data-side="${side}" data-id="${q.id}" ${q.id === (side === "a" ? m.b : m.a) ? "disabled" : ""}>${esc(teamName(state, q))}</button>`).join("");
  const tabBtn = (t, label, hint) => `<button class="mini ${m.tab === t ? "active" : ""}" data-action="tm-tab" data-tab="${t}"${tip(hint)}>${label}</button>`;
  const why = meetProblem(state, A, B);
  const body = m.tab === "goods" ? goodsTab(state, m, A, B, why) : peopleTab(state, m, A, B, why);
  return `<div class="box wide invbox">
    <div class="spread"><h1>Teams together</h1><span class="muted">${esc(tileLabel(state, m.tile))}</span></div>
    <div class="row small" style="gap:0.25rem;flex-wrap:wrap"><span class="muted" style="min-width:4rem">Left:</span>${chips("a", m.a)}</div>
    <div class="row small" style="gap:0.25rem;flex-wrap:wrap;margin-top:0.2rem"><span class="muted" style="min-width:4rem">Right:</span>${chips("b", m.b)}<button class="mini" data-action="tm-swap"${tip("Swap the two sides")}>⇄</button></div>
    <div class="invwho" style="margin-top:0.4rem">${tabBtn("people", "People", "Move people across, split some off as a new team, or merge the two teams")}${tabBtn("goods", "Goods", "Hand items and supplies from the left team to the right one")}</div>
    ${why ? `<div class="warn small">${esc(why)}</div>` : ""}
    ${m.msg ? `<div class="result small">${esc(m.msg)}</div>` : ""}
    ${body}
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button class="primary" data-action="tm-close">Close</button></div>
  </div>`;
}
// A team's head line: its people, vehicles and load.
function teamHead(state, p) {
  const v = partyFleet(state, p);
  const load = poolLoad(p), cap = partyCapacity(state, p);
  return `<div class="spread"><b>${esc(teamName(state, p))}</b><span class="small ${load > cap ? "danger" : "muted"}"${tip("Supplies and cargo against what the team can carry on top of what it wears (and its vehicles)")}>${v ? `${esc(vehicleLabel(v))} · ` : ""}load ${Math.round(load)}/${Math.round(cap)} kg</span></div>`;
}
function peopleTab(state, m, A, B, why) {
  const col = (p, side) => {
    const rows = partyMembers(state, p).map((s) => {
      const on = !!m.people[s.id];
      return `<div class="row small" style="gap:0.3rem"><button class="mini ${on ? "active" : ""}" data-action="tm-person" data-id="${s.id}" data-side="${side}"${tip(on ? "Picked: click to leave them" : "Pick them")}>${on ? "✓" : "○"}</button><span style="flex:1">${s.leader ? "★ " : ""}${first(s)}${s.vol ? ` <span class="muted">(volunteer)</span>` : ""}</span><span class="muted"${tip("Worn and carried on them against their max load")}>${kg(wornLoad(s))}/${maxLoad(s)} kg</span></div>`;
    }).join("");
    const picked = partyMembers(state, p).filter((s) => m.people[s.id]).map((s) => s.id);
    const other = side === "a" ? B : A;
    const busy = standProblem(state, p);
    return `<div class="invcol">${teamHead(state, p)}${rows}
      <div class="row" style="margin-top:0.4rem;gap:0.3rem;flex-wrap:wrap">
        <button class="mini" data-action="tm-move" data-from="${p.id}" data-to="${other.id}" ${picked.length && !why ? "" : "disabled"}${tip(why || (picked.length ? `They join ${teamName(state, other)}, with what they wear and carry on them` : "Pick people first"))}>Move picked ${side === "a" ? "→" : "←"}</button>
        <button class="mini" data-action="tm-split" data-from="${p.id}" ${picked.length && !busy ? "" : "disabled"}${tip(busy || (picked.length ? "They become a team of their own on this tile, waiting for orders, with their share of the packed food and water" : "Pick people first"))}>Split picked off</button>
      </div></div>`;
  };
  const merge = (into, from, label) => `<button class="mini" data-action="tm-merge" data-into="${into.id}" data-from="${from.id}" ${why ? "disabled" : ""}${tip(why || `${teamName(state, from)} joins ${teamName(state, into)}: its people, supplies, cargo, vehicles and prisoners; ${teamName(state, into)} keeps its orders`)}>${label}</button>`;
  return `<div class="invcols">${col(A, "a")}${col(B, "b")}</div>
    <div class="row" style="margin-top:0.5rem;gap:0.3rem;flex-wrap:wrap"><span class="small muted">Merge:</span>${merge(A, B, "Right into left")}${merge(B, A, "Left into right")}</div>`;
}
function goodsTab(state, m, A, B, why) {
  const H = teamHoldings(state, A);
  const pick = (loc, item, label) => `<div class="islot store${m.items[loc] ? " sel" : ""}" data-action="tm-item" data-loc="${esc(loc)}"${tip(`${label ? `${label}: ` : ""}${item.name}, ${kg(itemLoad(item))} kg. Click to pick it (again to leave it).`)}><div class="itile"><span class="iname">${esc(item.name)}</span><span class="ikg">${kg(itemLoad(item))}</span></div></div>`;
  const people = H.members.map((x) => `<div style="margin-top:0.3rem"><b class="small">${first(x.s)}</b><div class="istore">${x.spots.map((sp) => pick(sp.loc, sp.item, sp.where)).join("") || `<span class="small muted">Nothing on them.</span>`}</div></div>`).join("");
  const sups = Object.entries(H.cargo.supplies).map(([k, e]) => {
    const on = m.sup[k] != null;
    return `<div class="islot store${on ? " sel" : ""}" data-action="tm-sup" data-key="${k}"${tip(`${qty(e.all)} ${SUPPLIES[k].name.toLowerCase()} (${qty(e.packed)} packed, ${qty(e.found)} found), ${kg(supWeight(k) * e.all)} kg. Click to pick it; set how many below.`)}><div class="itile"><span class="iname">${esc(supplyName(k))}</span><span class="icount">×${qty(e.all)}</span></div></div>`;
  }).join("");
  const cargo = `<div style="margin-top:0.5rem"><b class="small">${esc(H.cargo.name)}</b><div class="istore">${H.cargo.gear.map((g) => pick(g.loc, g.item, "Cargo")).join("")}${sups}${!H.cargo.gear.length && !sups ? `<span class="small muted">Empty.</span>` : ""}</div></div>`;
  const tgt = (val, label, hint) => `<button class="mini ${String(m.target) === String(val) ? "active" : ""}" data-action="tm-target" data-v="${val}"${tip(hint)}>${String(m.target) === String(val) ? "✓ " : ""}${label}</button>`;
  const targets = `${tgt("cargo", "Into the cargo", `Items go into ${teamName(state, B)}'s cargo (as long as it can carry them)`)}${partyMembers(state, B).map((s) => tgt(s.id, `Onto ${first(s)}`, `Items go onto ${s.name.split(" ")[0]}: their own slot if free, a rig pouch, a pocket or the pack`)).join("")}`;
  const supRows = Object.entries(m.sup).map(([k, q]) => {
    const have = H.cargo.supplies[k] ? H.cargo.supplies[k].all : 0;
    if (!(have > 0)) return "";
    return `<span class="chip">${esc(supplyName(k))} <input type="number" class="qty" min="0" max="${qty(have)}" step="1" value="${qty(Math.min(have, q))}" data-action="tm-qty" data-key="${k}" style="width:4em"> of ${qty(have)} <button class="mini" data-action="tm-sup" data-key="${k}"${tip("Leave it")}>×</button></span>`;
  }).join(" ");
  const any = Object.keys(m.items).length || supRows;
  return `<div class="invcols"><div class="invcol"><div class="invlabel">From</div>${teamHead(state, A)}${people}${cargo}</div>
    <div class="invcol"><div class="invlabel">To</div>${teamHead(state, B)}<div class="row small" style="margin-top:0.4rem;gap:0.25rem;flex-wrap:wrap">${targets}</div>
    <div class="small muted" style="margin-top:0.4rem">Supplies go as they were: packed supplies into its packed supplies, found cargo into its cargo. Only what it can carry moves; nobody gives away a pack or rig their team needs to carry its load.</div></div></div>
    <div class="invsel small" style="margin-top:0.6rem">${any ? `Picked: ${Object.keys(m.items).length ? `<b>${Object.keys(m.items).length} item(s)</b> ` : ""}${supRows}` : "Click the left team's items and supplies to pick them."}
    <div class="row" style="margin-top:0.4rem;gap:0.3rem"><button class="primary" data-action="tm-give" ${any && !why ? "" : "disabled"}${tip(why || `Hand what is picked to ${teamName(state, B)}`)}>Give picked →</button>${any ? `<button class="mini" data-action="tm-clear">Clear</button>` : ""}</div></div>`;
}

// ---------- actions (wired in main.js) ----------
export const TEAMMEET_ACTIONS = {
  "tm-open": (state, ui, d) => {
    const tile = Number(d.tile);
    const here = teamsOnTile(state, tile);
    if (here.length < 2) return;
    const a = d.a != null && here.some((q) => q.id === Number(d.a)) ? Number(d.a) : here[0].id;
    ui.meet = { tile, a, b: (here.find((q) => q.id !== a) || here[1]).id, tab: d.tab || "people", msg: "" };
    fresh(ui.meet);
  },
  "tm-close": (state, ui) => { ui.meet = null; },
  "tm-tab": (state, ui, d) => { if (ui.meet) { ui.meet.tab = d.tab; ui.meet.msg = ""; fresh(ui.meet); } },
  "tm-side": (state, ui, d) => { if (ui.meet) { ui.meet[d.side === "a" ? "a" : "b"] = Number(d.id); ui.meet.msg = ""; fresh(ui.meet); } },
  "tm-swap": (state, ui) => { const m = ui.meet; if (m) { [m.a, m.b] = [m.b, m.a]; m.msg = ""; fresh(m); } },
  "tm-person": (state, ui, d) => { const m = ui.meet; if (!m) return; if (m.people[d.id]) delete m.people[d.id]; else m.people[d.id] = true; },
  "tm-move": (state, ui, d) => {
    const m = ui.meet, from = byId(state, d.from), to = byId(state, d.to);
    if (!m || !from || !to) return;
    const sids = partyMembers(state, from).filter((s) => m.people[s.id]).map((s) => s.id);
    m.msg = moveMembers(state, from, to, sids).text;
    fresh(m);
  },
  "tm-split": (state, ui, d) => {
    const m = ui.meet, from = byId(state, d.from);
    if (!m || !from) return;
    const sids = partyMembers(state, from).filter((s) => m.people[s.id]).map((s) => s.id);
    const r = moveMembers(state, from, null, sids);
    m.msg = r.text;
    if (r.party && !r.error) { if (from.id === m.a) m.b = r.party.id; else m.a = r.party.id; } // the new team on the other side
    fresh(m);
  },
  "tm-merge": (state, ui, d) => {
    const m = ui.meet, into = byId(state, d.into), from = byId(state, d.from);
    if (!m || !into || !from) return;
    m.msg = mergeTeams(state, into, from).text;
    if (ui.expedition === from.id && !state.parties.includes(from)) ui.expedition = into.id; // its panel shows the merged team
    fresh(m);
  },
  "tm-item": (state, ui, d) => { const m = ui.meet; if (!m) return; if (m.items[d.loc]) delete m.items[d.loc]; else m.items[d.loc] = true; },
  "tm-sup": (state, ui, d) => {
    const m = ui.meet, A = m ? byId(state, m.a) : null;
    if (!m || !A) return;
    if (m.sup[d.key] != null) { delete m.sup[d.key]; return; }
    const e = teamHoldings(state, A).cargo.supplies[d.key];
    if (e && e.all > 0) m.sup[d.key] = e.all; // all of it until changed
  },
  "tm-target": (state, ui, d) => { if (ui.meet) ui.meet.target = d.v === "cargo" ? "cargo" : Number(d.v); },
  "tm-clear": (state, ui) => { if (ui.meet) fresh(ui.meet); },
  "tm-give": (state, ui) => {
    const m = ui.meet, A = m ? byId(state, m.a) : null, B = m ? byId(state, m.b) : null;
    if (!m || !A || !B) return;
    const H = teamHoldings(state, A);
    const supplies = {};
    for (const [k, q] of Object.entries(m.sup)) { const have = H.cargo.supplies[k] ? H.cargo.supplies[k].all : 0; supplies[k] = q >= have - 1e-9 ? Infinity : q; }
    m.msg = giveGoods(state, A, B, { items: Object.keys(m.items), supplies }, m.target).text;
    const keep = m.target;
    fresh(m);
    if (keep !== "cargo" && partyMembers(state, B).some((s) => s.id === keep)) m.target = keep;
  },
};
// Typed in: how many of a picked supply.
export const TEAMMEET_CHANGE = {
  "tm-qty": (state, ui, el) => { const m = ui.meet; if (m && m.sup[el.dataset.key] != null) m.sup[el.dataset.key] = Math.max(0, Number(el.value) || 0); },
};
