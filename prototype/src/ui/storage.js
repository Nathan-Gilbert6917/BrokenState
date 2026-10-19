// The base window's Storage tab (sim/containers.js; docs/base-building/plan.md Part C, the user's request 2026-10-19):
// where the base keeps its goods. The base's books (stock, armory) stay the truth; a container only says where some
// of it is kept, and a raider on the base map goes for what lies in the yard first. The tab: the capacity used and a
// warning when goods lie in the yard; one card per container (the base itself, the storage buildings, shelves and
// lockers, the cars parked here, the yard) with its capacity bar, its supplies as chips and its items; a mover (a
// source and a destination, so many of a supply or an item at a time, Move all food / gear); Tidy up (autoStore with
// everything laid out afresh) and Store what lies in the yard (only the unassigned). ui.storage = { from, to, qty }.
import { baseById } from "../sim/world.js";
import { containersOf, containerByKey, putItem, putSupply, autoStore, storageSummary, kgOf } from "../sim/containers.js";
import { itemKg } from "../sim/inventory.js";
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
const KIND = { core: "the base itself", store: "a storage building", vehicle: "a parked car", yard: "the open" };
const KIND_TIP = {
  core: "The base itself: the camp's cache, the shack, the main house and its cellar. Behind the best door; dear things (meds, parts, rounds, guns) go here first.",
  store: "A storage building: the storehouse, a cellar, the cold store, the freezer, crates, shelves or lockers. Food keeps only where it says so (never in lockers).",
  vehicle: "A car parked at the base: it holds up to its payload. The game never loads a car on its own; what you put in stays on the base's books (if the car drives off it is unassigned again) and a raid can loot the car where it stands on the map.",
  yard: "What is in no container: unlimited, in the open, the first thing a raider finds. Store it, or build a storehouse, crates or shelves.",
};
const FOLD_AT = 14; // a container showing more kinds of goods than this folds them
const stOf = (ui) => (ui.storage && typeof ui.storage === "object" ? ui.storage : (ui.storage = { from: null, to: null, qty: {} }));
const baseOf = (state, d) => baseById(state, Number(d.base));
// What autoStore put away, as a line.
const tidyText = (r, all) => { const kinds = Object.keys(r.sup).length; return r.kg > 0 || r.gear ? `${all ? "Tidied up" : "Stored"}: ${kinds ? `${kinds} kind${kinds === 1 ? "" : "s"} of supplies` : ""}${kinds && r.gear ? " and " : ""}${r.gear ? `${r.gear} item${r.gear === 1 ? "" : "s"}` : ""} (${r0(r.kg)} kg) put in the containers with room.` : all ? "Tidied up: everything was in its place already (or nothing has room left)." : "Nothing in the yard fits anywhere: the containers are full."; };

// ---------- the tab ----------
export function storageTab(state, b, ui) {
  const S = stOf(ui);
  if (!S.qty || typeof S.qty !== "object") S.qty = {};
  const L = containersOf(state, b);
  const sum = storageSummary(state, b);
  const byKey = {};
  for (const c of L) byKey[c.key] = c;
  // The mover's source and destination: the yard when goods lie there, else the first container with goods; the
  // destination the other one with the most room (never a car unless picked).
  if (!S.from || !byKey[S.from]) S.from = ((byKey.yard && byKey.yard.kg > 0 ? byKey.yard : null) || L.find((c) => c.kg > 0) || byKey.yard || L[0]).key;
  if (!S.to || !byKey[S.to] || S.to === S.from) S.to = (L.filter((c) => c.key !== S.from && c.kind !== "yard" && c.kind !== "vehicle").sort((a, c) => c.free - a.free)[0] || L.find((c) => c.key !== S.from) || L[0]).key; // the most room first, never a car unless picked
  const from = byKey[S.from], to = byKey[S.to];
  const pct = sum.cap > 0 ? Math.min(100, (sum.used / sum.cap) * 100) : 0;
  const cars = L.filter((c) => c.kind === "vehicle");
  const over = sum.used + sum.yard > sum.cap;
  const summary = `<div class="card small"${tip("The containers' room in all (the yard not counted) and how much of it is used. Food goes where it keeps, dear things behind the best door, gear to the lockers; what fits nowhere lies in the yard.")}>
    <div class="spread"><b>Storage</b><span class="muted">${L.length - 1} container${L.length === 2 ? "" : "s"}${cars.length ? ` (${cars.length === 1 ? "one of them a car" : `${cars.length} of them cars`})` : ""}</span></div>
    ${pbar(pct, pct > 95 ? "bad" : pct > 80 ? "warn" : "info", `${r0(sum.used)} / ${r0(sum.cap)} kg`, `${Math.round(pct)}% used`, null, `${r0(sum.used)} kg kept in ${r0(sum.cap)} kg of room`)}
    ${sum.yard > 0 ? `<div class="small warn"${tip(KIND_TIP.yard)}>⚠ <b>${r0(sum.yard)} kg lie in the yard: raiders take them first.</b> ${over ? "The containers are too small for the stock: build a storehouse, crates, or shelves and lockers inside a general building." : "Store what lies in the yard, or Tidy up."}</div>` : `<div class="small good">Nothing lies in the yard.</div>`}
    ${cars.some((c) => c.kg > 0) ? `<div class="small muted" style="margin-top:0.2rem">Goods in a car stay on the base's books: if the car drives off they are unassigned again (it does not take them); on the map a raid can loot the car where it stands.</div>` : ""}
    <div class="row" style="margin-top:0.4rem;flex-wrap:wrap"><button class="mini primary" data-action="st-tidy" data-base="${b.id}"${tip("Lay everything out afresh (what is in a car stays): food where it keeps (cellar, cold store, freezer, storehouse, crates, shelves), dear things (meds, parts, rounds, guns, armour) in the base itself and the storehouse, gear in the lockers, the rest in the storehouse first. The game does this daily on the autopilot.")}>Tidy up</button><button class="mini" data-action="st-yard" data-base="${b.id}" ${sum.yard > 0 ? "" : "disabled"}${tip(sum.yard > 0 ? "Put what lies in the yard into the containers with room; what is in a container stays where it is." : "Nothing lies in the yard.")}>Store what lies in the yard</button></div>
  </div>`;
  // The mover.
  const sel = (act, val, t) => `<select data-action="${act}" data-base="${b.id}"${tip(t)}>${L.map((c) => `<option value="${esc(c.key)}"${c.key === val ? " selected" : ""}>${esc(c.label)} (${c.kind === "yard" ? `${r0(c.kg)} kg in the open` : `${r0(c.kg)} / ${r0(c.cap)} kg`})</option>`).join("")}</select>`;
  const sups = Object.entries(from.sup).sort(([a], [c]) => supLabel(a).localeCompare(supLabel(c)));
  const foods = sups.filter(([k]) => FOODS[k]);
  const canTake = (k, n) => (to.kind === "yard" ? "" : FOODS[k] && !to.foodOk ? `Food does not keep in the ${to.label.toLowerCase()}` : n * kgOf(k) > to.free + EPS ? `No room in the ${to.label.toLowerCase()} for ${n}` : "");
  const supRows = sups.map(([k, q]) => {
    const want = S.qty[k] != null ? Math.max(1, Math.min(q, Math.floor(S.qty[k]))) : q;
    const why = canTake(k, want);
    return `<div class="row small strow"><span style="flex:1;min-width:8rem"${tip(`${q} ${supLabel(k)} here, ${r1(kgOf(k))} kg each (${r1(q * kgOf(k))} kg)`)}>${supIcon(k)} ${q} ${esc(supLabel(k))} <span class="muted">${r1(q * kgOf(k))} kg</span></span><input type="number" min="1" max="${q}" value="${want}" data-action="st-qty" data-base="${b.id}" data-k="${esc(k)}"${tip("How many to move (the whole stack unless you say otherwise)")}><button class="mini" data-action="st-move" data-base="${b.id}" data-k="${esc(k)}" ${why ? "disabled" : ""}${tip(why || `Move ${want} ${supLabel(k)} to ${to.label}`)}>Move</button></div>`;
  }).join("");
  const itemRows = from.gear.map((g) => {
    const kg = itemKg(g.item);
    const why = to.kind === "yard" ? "" : kg > to.free + EPS ? `No room in the ${to.label.toLowerCase()} for it` : "";
    return `<div class="row small strow"><span style="flex:1;min-width:8rem"${tip(`${rowName(g.item)}: ${r1(kg)} kg`)}>${esc(rowName(g.item))} <span class="muted">${r1(kg)} kg</span></span><button class="mini" data-action="st-moveitem" data-base="${b.id}" data-ai="${g.ai}" ${why ? "disabled" : ""}${tip(why || `Move it to ${to.label}`)}>Move</button></div>`;
  }).join("");
  const foodOk = foods.length && (to.kind === "yard" || to.foodOk), gearOk = from.gear.length > 0;
  const mover = `<div class="card small"${tip("Move goods between two containers: pick where from and where to, then so many of a supply, or an item. To the yard: out of its container (unassigned: the game places it again). A supply moved from the yard is taken from the unassigned goods only.")}>
    <div class="spread"><b>Move goods</b><button class="mini" data-action="st-swap" data-base="${b.id}"${tip("Swap from and to")}>⇄</button></div>
    <div class="kv" style="margin-top:0.3rem"><div>From</div><div>${sel("st-from", S.from, "Where the goods are now")}</div><div>To</div><div>${sel("st-to", S.to, "Where they go")}</div></div>
    <div class="small muted" style="margin:0.3rem 0 0.2rem">${esc(to.label)}: ${to.kind === "yard" ? "out of any container" : `${r0(to.free)} kg of room${to.foodOk ? "" : ", no food"}`}.</div>
    <div class="row small" style="flex-wrap:wrap"><button class="mini" data-action="st-allfood" data-base="${b.id}" ${foodOk ? "" : "disabled"}${tip(foods.length ? foodOk ? `Every kind of food here, as much as fits, to ${to.label}` : `Food does not keep in the ${to.label.toLowerCase()}` : "No food here")}>Move all food</button><button class="mini" data-action="st-allgear" data-base="${b.id}" ${gearOk ? "" : "disabled"}${tip(gearOk ? `Every item here that fits, to ${to.label}` : "No items here")}>Move all gear</button></div>
    ${sups.length ? `<div class="small muted" style="margin-top:0.3rem">Supplies in ${esc(from.label)}</div>${supRows}` : ""}
    ${from.gear.length ? `<div class="small muted" style="margin-top:0.3rem">Items in ${esc(from.label)}</div>${itemRows}` : ""}
    ${sups.length || from.gear.length ? "" : `<div class="small muted" style="margin-top:0.3rem">Nothing in ${esc(from.label)}.</div>`}
  </div>`;
  // One card per container.
  const card = (c) => {
    const list = Object.entries(c.sup).sort(([a], [d]) => supLabel(a).localeCompare(supLabel(d)));
    const n = list.length + c.gear.length;
    const p = c.cap === Infinity ? 0 : Math.min(100, (c.kg / Math.max(1, c.cap)) * 100);
    const body = `${list.length ? `<div class="stchips">${list.map(([k, q]) => chip({ icon: supIcon(k), name: `${q} ${supLabel(k)}`, t: `${q} ${supLabel(k)}: ${r1(q * kgOf(k))} kg` })).join("")}</div>` : ""}
      ${c.gear.length ? `<div class="small" style="margin-top:0.2rem">${c.gear.map((g) => `<span class="chip"${tip(`${rowName(g.item)}: ${r1(itemKg(g.item))} kg`)}>${esc(rowName(g.item))}</span>`).join("")}</div>` : ""}
      ${n ? "" : `<div class="small muted">Empty.</div>`}`;
    return `<div class="card small stcard${c.kind === "yard" && c.kg > 0 ? " attn" : ""}"${tip(KIND_TIP[c.kind] || "")}>
      <div class="spread"><b>${esc(c.label)}</b><span class="small muted">${KIND[c.kind] || c.kind}${c.kind !== "yard" && !c.foodOk ? " · no food" : ""}${c.key === S.from ? ` ${badge("From", "info", "The mover takes from here")}` : ""}${c.key === S.to ? ` ${badge("To", "busy", "The mover puts things here")}` : ""}</span></div>
      ${c.kind === "yard" ? `<div class="small ${c.kg > 0 ? "warn" : "muted"}">${r0(c.kg)} kg in the open${c.kg > 0 ? ": raiders take these first" : ""}</div>` : pbar(p, p > 95 ? "bad" : p > 80 ? "warn" : "info", `${r0(c.kg)} / ${r0(c.cap)} kg`, `${r0(c.free)} kg free`, null, `${r0(c.kg)} kg of ${r0(c.cap)}; ${r0(c.free)} kg of room left`)}
      ${n > FOLD_AT ? fold(`st:${c.key}`, `<span class="small muted">${list.length} kind${list.length === 1 ? "" : "s"} of supplies, ${c.gear.length} item${c.gear.length === 1 ? "" : "s"}</span>`, body, { cls: "pf-card", tipText: "Click to see everything in it" }) : body}
      <div class="row small" style="margin-top:0.3rem"><button class="mini${c.key === S.from ? " active" : ""}" data-action="st-pick" data-base="${b.id}" data-w="from" data-k="${esc(c.key)}"${tip("The mover takes from here")}>From here</button><button class="mini${c.key === S.to ? " active" : ""}" data-action="st-pick" data-base="${b.id}" data-w="to" data-k="${esc(c.key)}"${tip(c.kind === "yard" ? "The mover takes things out of their container" : "The mover puts things here")}>To here</button></div>
    </div>`;
  };
  return `<div class="grid2"><div>
    <h3>Storage</h3>${summary}${mover}
    ${hint("Containers only say where the goods are kept; nothing leaves the base's books. On the autopilot the game tidies up daily; without it, the unassigned goods are spread into whatever room is left when a raid comes, and the rest lies in the yard pile on the map. Shelves and lockers built inside a general building (the Base map's Build list) add room.", "How storage works (sim/containers.js)")}
  </div><div>
    <h3>Containers <span class="muted small">${L.length}</span></h3>
    ${L.map(card).join("")}
  </div></div>`;
}

// ---------- actions (main.js) ----------
export const STORAGE_ACTIONS = {
  "st-tidy": (state, ui, d) => { const b = baseOf(state, d); if (b) ui.baseMsg = tidyText(autoStore(state, b, { all: true }), true); },
  "st-yard": (state, ui, d) => { const b = baseOf(state, d); if (b) ui.baseMsg = tidyText(autoStore(state, b), false); },
  "st-pick": (state, ui, d) => { const S = stOf(ui); if (d.w === "to") S.to = d.k; else S.from = d.k; if (S.to === S.from) { if (d.w === "to") S.from = null; else S.to = null; } ui.baseMsg = ""; },
  "st-swap": (state, ui) => { const S = stOf(ui); [S.from, S.to] = [S.to, S.from]; ui.baseMsg = ""; },
  "st-move": (state, ui, d) => {
    const b = baseOf(state, d), S = stOf(ui);
    if (!b) return;
    const from = containerByKey(state, b, S.from), to = containerByKey(state, b, S.to);
    const have = (from && from.sup[d.k]) || 0;
    const n = S.qty && S.qty[d.k] != null ? Math.max(1, Math.min(have, Math.floor(S.qty[d.k]))) : have;
    const err = putSupply(state, b, d.k, n, S.to, S.from);
    ui.baseMsg = err || `${n} ${supLabel(d.k)} moved to ${to ? to.label : "the yard"}.`;
    if (S.qty) delete S.qty[d.k];
  },
  "st-moveitem": (state, ui, d) => {
    const b = baseOf(state, d), S = stOf(ui);
    const it = b && b.armory[Number(d.ai)];
    if (!it) { ui.baseMsg = "That is not in the armory any more."; return; }
    const to = containerByKey(state, b, S.to);
    const err = putItem(state, b, it, S.to);
    ui.baseMsg = err || `${rowName(it)} moved to ${to ? to.label : "the yard"}.`;
  },
  "st-allfood": (state, ui, d) => {
    const b = baseOf(state, d), S = stOf(ui);
    if (!b) return;
    const from = containerByKey(state, b, S.from), to = containerByKey(state, b, S.to);
    if (!from || !to) return;
    let moved = 0, kinds = 0, why = "";
    for (const [k, q] of Object.entries(from.sup)) {
      if (!FOODS[k]) continue;
      const fit = to.kind === "yard" ? q : Math.min(q, Math.floor((containerByKey(state, b, S.to).free + EPS) / Math.max(0.001, kgOf(k))));
      if (fit <= 0) { why = `No room in the ${to.label.toLowerCase()} for more`; continue; }
      const err = putSupply(state, b, k, fit, S.to, S.from);
      if (err) { why = err; continue; }
      moved += fit; kinds++;
    }
    ui.baseMsg = moved ? `${moved} of food (${kinds} kind${kinds === 1 ? "" : "s"}) moved to ${to.label}.${why ? ` ${why}.` : ""}` : why || "No food here.";
  },
  "st-allgear": (state, ui, d) => {
    const b = baseOf(state, d), S = stOf(ui);
    if (!b) return;
    const from = containerByKey(state, b, S.from), to = containerByKey(state, b, S.to);
    if (!from || !to) return;
    let moved = 0, why = "";
    for (const g of from.gear) { const err = putItem(state, b, g.item, S.to); if (err) why = err; else moved++; }
    ui.baseMsg = moved ? `${moved} item${moved === 1 ? "" : "s"} moved to ${to.label}.${why ? ` ${why}.` : ""}` : why || "No items here.";
  },
};
export const STORAGE_CHANGE = {
  "st-from": (state, ui, el) => { const S = stOf(ui); S.from = el.value; if (S.to === S.from) S.to = null; ui.baseMsg = ""; },
  "st-to": (state, ui, el) => { const S = stOf(ui); S.to = el.value; if (S.to === S.from) S.from = null; ui.baseMsg = ""; },
  "st-qty": (state, ui, el) => { const S = stOf(ui); if (!S.qty) S.qty = {}; const n = Math.floor(Number(el.value)); if (Number.isFinite(n) && n > 0) S.qty[el.dataset.k] = n; else delete S.qty[el.dataset.k]; },
};
