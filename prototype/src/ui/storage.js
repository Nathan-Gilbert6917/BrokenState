// The base window's Storage tab (sim/containers.js over sim/basestorage.js; docs/base-building/plan.md Part C and
// "Merged with dev's base storage limits", the user's requests 2026-10-19): where the base keeps its goods. The base's
// books (stock, armory) stay the truth. Its room is basestorage.js's (the core by tier, the storage buildings and
// fittings, the parked cars, opened boxes); a container only says where some of it is kept, the rest fills the room
// left by worth a kg, and what does not fit lies outside: it weathers, it is on the piles of the base map, and raiders
// take it first. The tab: the storage in kg and a warning when goods lie outside; one card per container (the base
// itself, the storage buildings, shelves and lockers, the cars parked here, an opened box) with its room bar and what
// is kept in it, then the goods put away nowhere (inside, wherever there is room) and those outside; a mover (a source
// and a destination, so many of a supply or an item at a time, Move all food / gear); Tidy up (autoStore with
// everything laid out afresh) and Put the rest away (only the unassigned). ui.storage = { from, to, qty }.
import { baseById } from "../sim/world.js";
import { containersOf, containerByKey, putItem, putSupply, autoStore, kgOf, LOOSE, OUTSIDE } from "../sim/containers.js";
import { storageOf, storageSummary, itemRoomKg } from "../sim/basestorage.js";
import { rowName } from "../sim/itemnames.js";
import { FOODS } from "../sim/foods.js";
import { badge, hint, pbar, chip, supName, supIcon } from "./uikit.js";
import { fold } from "./panelfold.js"; // a container with many kinds of goods folds its list

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const r0 = (v) => Math.round(Number(v) || 0);
const r1 = (v) => Math.round((Number(v) || 0) * 10) / 10;
const EPS = 1e-6;
const supLabel = (k) => (FOODS[k] ? FOODS[k].name : supName(k));
const KIND = { core: "the base itself", building: "a storage building", vehicle: "a parked car", box: "an opened box", tent: "a pitched tent", loose: "inside, put away nowhere", outside: "outside, in the open" };
const KIND_TIP = {
  core: "The base itself: the shack, the outpost's house, the main house and its cellar (a camp has none). Behind the best door; dear things (meds, parts) go here first.",
  building: "A storage building or fitting: a storage box, crates, a shed, the storehouse, a warehouse, a cellar, the cold store, the freezer, the armory, shelves or lockers. Food keeps only where it says so (never in lockers or the armory).",
  vehicle: "A car parked at the base: its load space is room while it is parked here. The game never loads a car on its own, but the goods put away nowhere may fill it; if it drives off, its room goes with it and what was in it is put away nowhere again.",
  box: "An opened lock box or case in the armory: room for the base's goods (what is still inside it fills it first). It is an item, so nothing is put in it by hand.",
  tent: "A tent pitched here (sim/tents.js): room out of the weather (a one-person tent 15 kg, a two-person 30, a four-person 60). Food or gear can be kept in it (From here / To here); it keeps dry, and the goods put away nowhere fill what is left. Tidy up leaves it to you. Struck, what was kept in it is put away nowhere again.",
  loose: "Goods put away nowhere that still fit the base's room: kept inside wherever there is room left (the most valuable for their weight first). Put them away to say where.",
  outside: "What the base has no room for: it lies in the open, on piles of crates on the base map. Things wear a little every day there (twice as fast in rain or snow) and raiders go for the piles first and grab twice as much. Build storage, or park a vehicle here.",
};
const UNASSIGNED = new Set([LOOSE, OUTSIDE]);
const FOLD_AT = 14; // a container showing more kinds of goods than this folds them
const stOf = (ui) => (ui.storage && typeof ui.storage === "object" ? ui.storage : (ui.storage = { from: null, to: null, qty: {} }));
const baseOf = (state, d) => baseById(state, Number(d.base));
const nowhere = "put away nowhere";
// What autoStore put away, as a line.
const tidyText = (r, all) => { const kinds = Object.keys(r.sup).length; return r.kg > 0 || r.gear ? `${all ? "Tidied up" : "Put away"}: ${kinds ? `${kinds} kind${kinds === 1 ? "" : "s"} of supplies` : ""}${kinds && r.gear ? " and " : ""}${r.gear ? `${r.gear} item${r.gear === 1 ? "" : "s"}` : ""} (${r0(r.kg)} kg) put in the containers with room.` : all ? "Tidied up: everything was in its place already (or nothing has room left)." : "Nothing more fits anywhere: the containers are full."; };

// ---------- the tab ----------
export function storageTab(state, b, ui) {
  const S = stOf(ui);
  if (!S.qty || typeof S.qty !== "object") S.qty = {};
  const L = containersOf(state, b);
  const st = storageOf(state, b);
  const byKey = {};
  for (const c of L) byKey[c.key] = c;
  const real = L.filter((c) => c.assignable);
  // The mover's source and destination: what lies outside when anything does, else what is put away nowhere, else the
  // first container with goods; the destination the container with the most room (never a car unless picked).
  if (!S.from || !byKey[S.from]) S.from = ((byKey[OUTSIDE].kg > 0 ? byKey[OUTSIDE] : null) || (byKey[LOOSE].kg > 0 ? byKey[LOOSE] : null) || real.find((c) => c.kg > 0) || byKey[LOOSE]).key;
  if (!S.to || !byKey[S.to] || S.to === S.from || (UNASSIGNED.has(S.to) && UNASSIGNED.has(S.from)) || byKey[S.to].kind === "box") S.to = (real.filter((c) => c.key !== S.from && c.kind !== "vehicle").sort((a, c) => c.free - a.free)[0] || real.find((c) => c.key !== S.from) || (UNASSIGNED.has(S.from) ? null : byKey[LOOSE]) || byKey[LOOSE]).key; // the most room first, never a car unless picked
  const from = byKey[S.from], to = byKey[S.to];
  const toNowhere = UNASSIGNED.has(to.key);
  const pct = st.cap > 0 ? Math.min(100, (st.inside / st.cap) * 100) : 0;
  const cars = real.filter((c) => c.kind === "vehicle");
  const over = st.used > st.cap + EPS;
  const rows = storageSummary(state, b); // basestorage.js: "Storage 420 / 650 kg", the room, what lies outside
  const summary = `<div class="card small"${tip("The base's room in all (sim/basestorage.js: the base itself by its size, the storage buildings and fittings, the cars parked here, opened boxes) and the goods in it. What you put in a container fills it first; the rest fills the room left, the most valuable for their weight first; what does not fit lies outside.")}>
    <div class="spread"><b>Storage</b><span class="muted">${real.length} container${real.length === 1 ? "" : "s"}${cars.length ? ` (${cars.length === 1 ? "one of them a car" : `${cars.length} of them cars`})` : ""}</span></div>
    ${pbar(pct, pct > 95 ? "bad" : pct > 80 ? "warn" : "info", `${r0(st.inside)} / ${r0(st.cap)} kg`, `${Math.round(pct)}% used`, null, `${r0(st.inside)} kg kept inside ${r0(st.cap)} kg of room`)}
    <div class="small muted">${rows.slice(1, 2).map(esc).join("")}</div>
    ${st.outsideKg > 0 ? `<div class="small warn"${tip(KIND_TIP.outside)}>⚠ <b>${r0(st.outsideKg)} kg lie outside: they weather, and raiders take them first.</b> ${over ? "The base's storage is too small for its goods: build a storage box, crates, a shed or a storehouse, shelves and lockers inside a general building, or park a vehicle here." : "Tidy up to make room."}</div>` : `<div class="small good">Nothing lies outside.</div>`}
    ${byKey[LOOSE].kg > 0 ? `<div class="small muted" style="margin-top:0.2rem"${tip(KIND_TIP.loose)}>${r0(byKey[LOOSE].kg)} kg ${nowhere}, inside wherever there is room.</div>` : ""}
    ${cars.some((c) => c.kg > 0) ? `<div class="small muted" style="margin-top:0.2rem">Goods in a car stay on the base's books: if the car drives off they are ${nowhere} again (it does not take them); on the map a raid can loot the car where it stands.</div>` : ""}
    <div class="row" style="margin-top:0.4rem;flex-wrap:wrap"><button class="mini primary" data-action="st-tidy" data-base="${b.id}"${tip("Lay everything out afresh (what is in a car stays), the most valuable for their weight first: food where it keeps (cellar, cold store, freezer, storehouse, crates, shelves), rounds and guns in the armory, dear things (meds, parts) in the base itself and the storehouse, gear in the lockers, the rest in the warehouse or the storehouse first. The game does this daily on the autopilot.")}>Tidy up</button><button class="mini" data-action="st-rest" data-base="${b.id}" ${byKey[LOOSE].kg + byKey[OUTSIDE].kg > 0 ? "" : "disabled"}${tip(byKey[LOOSE].kg + byKey[OUTSIDE].kg > 0 ? `Put what is ${nowhere} into the containers with room; what is in a container stays where it is.` : `Nothing is ${nowhere}.`)}>Put the rest away</button></div>
  </div>`;
  // The mover.
  const opt = (c) => `${esc(c.label)} (${UNASSIGNED.has(c.key) ? `${r0(c.kg)} kg${c.key === OUTSIDE ? " in the open" : ""}` : `${r0(c.kg)} / ${r0(c.cap)} kg`})`;
  const sel = (act, val, t, list) => `<select data-action="${act}" data-base="${b.id}"${tip(t)}>${list.map((c) => `<option value="${esc(c.key)}"${c.key === val ? " selected" : ""}>${opt(c)}</option>`).join("")}</select>`;
  const sups = Object.entries(from.sup).sort(([a], [c]) => supLabel(a).localeCompare(supLabel(c)));
  const foods = sups.filter(([k]) => FOODS[k]);
  const canTake = (k, n) => (toNowhere ? "" : FOODS[k] && !to.foodOk ? `Food does not keep in the ${to.label.toLowerCase()}` : n * kgOf(k) > to.free + EPS ? `No room in the ${to.label.toLowerCase()} for ${n}` : "");
  const toWord = toNowhere ? nowhere : to.label;
  const supRows = sups.map(([k, q0]) => {
    const q = Math.floor(q0);
    const want = S.qty[k] != null ? Math.max(1, Math.min(q, Math.floor(S.qty[k]))) : q;
    const why = q < 1 ? "Less than one" : canTake(k, want);
    return `<div class="row small strow"><span style="flex:1;min-width:8rem"${tip(`${r1(q0)} ${supLabel(k)} here, ${r1(kgOf(k))} kg each (${r1(q0 * kgOf(k))} kg)`)}>${supIcon(k)} ${r1(q0)} ${esc(supLabel(k))} <span class="muted">${r1(q0 * kgOf(k))} kg</span></span><input type="number" min="1" max="${q}" value="${want}" data-action="st-qty" data-base="${b.id}" data-k="${esc(k)}"${tip("How many to move (the whole stack unless you say otherwise)")}><button class="mini" data-action="st-move" data-base="${b.id}" data-k="${esc(k)}" ${why ? "disabled" : ""}${tip(why || `Move ${want} ${supLabel(k)} to ${toWord}`)}>Move</button></div>`;
  }).join("");
  const itemRows = from.gear.map((g) => {
    const kg = itemRoomKg(g.item);
    const why = toNowhere ? "" : kg > to.free + EPS ? `No room in the ${to.label.toLowerCase()} for it` : "";
    return `<div class="row small strow"><span style="flex:1;min-width:8rem"${tip(`${rowName(g.item)}: ${r1(kg)} kg`)}>${esc(rowName(g.item))} <span class="muted">${r1(kg)} kg</span></span><button class="mini" data-action="st-moveitem" data-base="${b.id}" data-ai="${g.ai}" ${why ? "disabled" : ""}${tip(why || `Move it to ${toWord}`)}>Move</button></div>`;
  }).join("");
  const foodOk = foods.length && (toNowhere || to.foodOk), gearOk = from.gear.length > 0;
  const fromList = L.filter((c) => c.kind !== "box"), toList = [...real, byKey[LOOSE]]; // a tent is a container like any other (sim/tents.js)
  const mover = `<div class="card small"${tip(`Move goods between two containers: pick where from and where to, then so many of a supply, or an item. To "${byKey[LOOSE].label}": out of its container (put away nowhere: the room left takes it, or it lies outside). From outside or from what is put away nowhere: the goods in no container only.`)}>
    <div class="spread"><b>Move goods</b><button class="mini" data-action="st-swap" data-base="${b.id}"${tip("Swap from and to")}>⇄</button></div>
    <div class="kv" style="margin-top:0.3rem"><div>From</div><div>${sel("st-from", S.from, "Where the goods are now", fromList)}</div><div>To</div><div>${sel("st-to", S.to, "Where they go", toList)}</div></div>
    <div class="small muted" style="margin:0.3rem 0 0.2rem">${esc(to.label)}: ${toNowhere ? "out of any container" : `${r0(to.free)} kg of room${to.foodOk ? "" : ", no food"}`}.</div>
    <div class="row small" style="flex-wrap:wrap"><button class="mini" data-action="st-allfood" data-base="${b.id}" ${foodOk ? "" : "disabled"}${tip(foods.length ? foodOk ? `Every kind of food here, as much as fits, to ${toWord}` : `Food does not keep in the ${to.label.toLowerCase()}` : "No food here")}>Move all food</button><button class="mini" data-action="st-allgear" data-base="${b.id}" ${gearOk ? "" : "disabled"}${tip(gearOk ? `Every item here that fits, to ${toWord}` : "No items here")}>Move all gear</button></div>
    ${sups.length ? `<div class="small muted" style="margin-top:0.3rem">Supplies in ${esc(from.label)}</div>${supRows}` : ""}
    ${from.gear.length ? `<div class="small muted" style="margin-top:0.3rem">Items in ${esc(from.label)}</div>${itemRows}` : ""}
    ${sups.length || from.gear.length ? "" : `<div class="small muted" style="margin-top:0.3rem">Nothing in ${esc(from.label)}.</div>`}
  </div>`;
  // One card per container.
  const card = (c) => {
    const list = Object.entries(c.sup).sort(([a], [d]) => supLabel(a).localeCompare(supLabel(d)));
    const n = list.length + c.gear.length;
    const p = c.cap === Infinity ? 0 : Math.min(100, (c.kg / Math.max(1, c.cap)) * 100);
    const body = `${list.length ? `<div class="stchips">${list.map(([k, q]) => chip({ icon: supIcon(k), name: `${r1(q)} ${supLabel(k)}`, t: `${r1(q)} ${supLabel(k)}: ${r1(q * kgOf(k))} kg` })).join("")}</div>` : ""}
      ${c.gear.length ? `<div class="small" style="margin-top:0.2rem">${c.gear.map((g) => `<span class="chip"${tip(`${rowName(g.item)}: ${r1(itemRoomKg(g.item))} kg`)}>${esc(rowName(g.item))}</span>`).join("")}</div>` : ""}
      ${c.kind === "box" ? `<div class="small muted">${r1(c.kg)} kg of its own contents.</div>` : n ? "" : `<div class="small muted">${c.kind === "tent" ? `Nothing kept in it: ${r0(c.cap)} kg of room out of the weather.` : "Empty."}</div>`}`;
    const pick = c.kind === "box" ? "" : `<div class="row small" style="margin-top:0.3rem"><button class="mini${c.key === S.from ? " active" : ""}" data-action="st-pick" data-base="${b.id}" data-w="from" data-k="${esc(c.key)}"${tip("The mover takes from here")}>From here</button>${c.key === OUTSIDE ? "" : `<button class="mini${c.key === S.to ? " active" : ""}" data-action="st-pick" data-base="${b.id}" data-w="to" data-k="${esc(c.key)}"${tip(c.key === LOOSE ? "The mover takes things out of their container" : "The mover puts things here")}>To here</button>`}</div>`;
    return `<div class="card small stcard${c.key === OUTSIDE && c.kg > 0 ? " attn" : ""}"${tip(KIND_TIP[c.kind] || "")}>
      <div class="spread"><b>${esc(c.label)}</b><span class="small muted">${KIND[c.kind] || c.kind}${c.assignable && !c.foodOk ? " · no food" : ""}${c.key === S.from ? ` ${badge("From", "info", "The mover takes from here")}` : ""}${c.key === S.to ? ` ${badge("To", "busy", "The mover puts things here")}` : ""}</span></div>
      ${c.key === OUTSIDE ? `<div class="small ${c.kg > 0 ? "warn" : "muted"}">${r0(c.kg)} kg in the open${c.kg > 0 ? ": weathering, and raiders take these first" : ""}</div>` : c.key === LOOSE ? `<div class="small muted">${r0(c.kg)} kg inside wherever there is room (${r0(st.free)} kg of room left)</div>` : pbar(p, p > 95 ? "bad" : p > 80 ? "warn" : "info", `${r0(c.kg)} / ${r0(c.cap)} kg`, `${r0(c.free)} kg free`, null, `${r0(c.kg)} kg of ${r0(c.cap)} kept here; ${r0(c.free)} kg of room left`)}
      ${n > FOLD_AT ? fold(`st:${c.key}`, `<span class="small muted">${list.length} kind${list.length === 1 ? "" : "s"} of supplies, ${c.gear.length} item${c.gear.length === 1 ? "" : "s"}</span>`, body, { cls: "pf-card", tipText: "Click to see everything in it" }) : body}
      ${pick}
    </div>`;
  };
  return `<div class="grid2"><div>
    <h3>Storage</h3>${summary}${mover}
    ${hint(`The base's room comes from the base itself (a camp has none), its storage buildings and fittings, the cars parked here and opened boxes. Containers only say where the goods are kept; nothing leaves the base's books. What is ${nowhere} fills the room left, the most valuable for their weight first, and the rest lies outside on piles on the base map, where it weathers and raiders take it first. On the autopilot the game tidies up daily. Shelves and lockers built inside a general building (the Base map's Build list) add room.`, "How storage works (sim/basestorage.js, sim/containers.js)")}
  </div><div>
    <h3>Containers <span class="muted small">${real.length}</span></h3>
    ${real.length ? "" : `<div class="small muted">No storage yet: park a vehicle here or build a storage box.</div>`}
    ${L.map(card).join("")}
  </div></div>`;
}

// ---------- actions (main.js) ----------
export const STORAGE_ACTIONS = {
  "st-tidy": (state, ui, d) => { const b = baseOf(state, d); if (b) ui.baseMsg = tidyText(autoStore(state, b, { all: true }), true); },
  "st-rest": (state, ui, d) => { const b = baseOf(state, d); if (b) ui.baseMsg = tidyText(autoStore(state, b), false); },
  "st-pick": (state, ui, d) => { const S = stOf(ui); if (d.w === "to") S.to = d.k; else S.from = d.k; if (S.to === S.from) { if (d.w === "to") S.from = null; else S.to = null; } ui.baseMsg = ""; },
  "st-swap": (state, ui) => { const S = stOf(ui); [S.from, S.to] = [S.to, S.from]; ui.baseMsg = ""; },
  "st-move": (state, ui, d) => {
    const b = baseOf(state, d), S = stOf(ui);
    if (!b) return;
    const from = containerByKey(state, b, S.from), to = containerByKey(state, b, S.to);
    const have = Math.floor((from && from.sup[d.k]) || 0);
    const n = S.qty && S.qty[d.k] != null ? Math.max(1, Math.min(have, Math.floor(S.qty[d.k]))) : have;
    const err = putSupply(state, b, d.k, n, S.to, S.from);
    ui.baseMsg = err || `${n} ${supLabel(d.k)} moved ${to && to.assignable ? `to ${to.label}` : `out: ${nowhere}`}.`;
    if (S.qty) delete S.qty[d.k];
  },
  "st-moveitem": (state, ui, d) => {
    const b = baseOf(state, d), S = stOf(ui);
    const it = b && b.armory[Number(d.ai)];
    if (!it) { ui.baseMsg = "That is not in the armory any more."; return; }
    const to = containerByKey(state, b, S.to);
    const err = putItem(state, b, it, S.to);
    ui.baseMsg = err || `${rowName(it)} moved ${to && to.assignable ? `to ${to.label}` : `out: ${nowhere}`}.`;
  },
  "st-allfood": (state, ui, d) => {
    const b = baseOf(state, d), S = stOf(ui);
    if (!b) return;
    const from = containerByKey(state, b, S.from), to = containerByKey(state, b, S.to);
    if (!from || !to) return;
    let moved = 0, kinds = 0, why = "";
    for (const [k, q0] of Object.entries(from.sup)) {
      if (!FOODS[k]) continue;
      const q = Math.floor(q0);
      const fit = !to.assignable ? q : Math.min(q, Math.floor((containerByKey(state, b, S.to).free + EPS) / Math.max(0.001, kgOf(k))));
      if (fit <= 0) { why = `No room in the ${to.label.toLowerCase()} for more`; continue; }
      const err = putSupply(state, b, k, fit, S.to, S.from);
      if (err) { why = err; continue; }
      moved += fit; kinds++;
    }
    ui.baseMsg = moved ? `${moved} of food (${kinds} kind${kinds === 1 ? "" : "s"}) moved ${to.assignable ? `to ${to.label}` : `out: ${nowhere}`}.${why ? ` ${why}.` : ""}` : why || "No food here.";
  },
  "st-allgear": (state, ui, d) => {
    const b = baseOf(state, d), S = stOf(ui);
    if (!b) return;
    const from = containerByKey(state, b, S.from), to = containerByKey(state, b, S.to);
    if (!from || !to) return;
    let moved = 0, why = "";
    for (const g of from.gear) { const err = putItem(state, b, g.item, S.to); if (err) why = err; else moved++; }
    ui.baseMsg = moved ? `${moved} item${moved === 1 ? "" : "s"} moved ${to.assignable ? `to ${to.label}` : `out: ${nowhere}`}.${why ? ` ${why}.` : ""}` : why || "No items here.";
  },
};
export const STORAGE_CHANGE = {
  "st-from": (state, ui, el) => { const S = stOf(ui); S.from = el.value; if (S.to === S.from) S.to = null; ui.baseMsg = ""; },
  "st-to": (state, ui, el) => { const S = stOf(ui); S.to = el.value; if (S.to === S.from) S.from = null; ui.baseMsg = ""; },
  "st-qty": (state, ui, el) => { const S = stOf(ui); if (!S.qty) S.qty = {}; const n = Math.floor(Number(el.value)); if (Number.isFinite(n) && n > 0) S.qty[el.dataset.k] = n; else delete S.qty[el.dataset.k]; },
};
