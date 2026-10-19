// The base map in the interface (sim/basemap.js): the base window's Base map tab (what stands on the map and where,
// placed by hand or by the game; open the map, lift a thing off it) and the layout mode of the battle screen (the
// map itself, drawn by ui/isoview.js as any battle: pick a building, field, defence or car from the list, its outline
// follows the mouse (green where it fits, red where it does not, with the reason), R turns it, a click puts it down;
// a click on a placed thing lifts it to move it; every store's contents can be looked at). Also the contents card of a
// store container during a battle (ui/combat.js: a click on a container, or its button).
import { baseById } from "../sim/world.js";
import { openBaseMap, layoutOf, itemByKey, unplaceItem, baseMapSummary, storeContents, gridOfCell, FOOT, GRID, STEAL, BUFFER } from "../sim/basemap.js";
import { BUILDINGS } from "../sim/buildings.js";
import { badge, hint } from "./uikit.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const GROUPS = [["house", "Buildings"], ["roof", "Buildings"], ["prop", "Yard things"], ["pen", "Yard things"], ["field", "Crop plots"], ["defence", "Defences"], ["vehicle", "Parked cars"]];
const groupOf = (kind) => (GROUPS.find(([k]) => k === kind) || [null, "Other"])[1];
const whereText = (e) => (!e.at ? "nowhere it fits (left off the map)" : `${e.auto ? "placed by the game" : "placed by hand"} at ${e.at[0]}, ${e.at[1]}${e.at[2] ? ` turned ${e.at[2]}` : ""}`);
const sizeText = (it) => `${it.w} × ${it.h}`;

// ---------- the base window's tab ----------
export function baseMapTab(state, b, ui) {
  const sm = baseMapSummary(state, b);
  const g = GRID[sm.tier === "Camp" ? "camp" : sm.tier === "Shelter" || sm.tier === "Outpost camp" ? "shelter" : sm.tier === "Main hub" ? "hub" : "outpost"];
  const lay = layoutOf(state, b);
  const groups = new Map();
  for (const e of lay) { const k = groupOf(e.it.kind); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const row = (e) => `<div class="spread small" style="margin-top:0.2rem"><span${tip(`${e.it.label}: ${sizeText(e.it)} cells${e.it.kind === "defence" ? ", no buffer (it may stand right next to anything)" : e.it.kind === "vehicle" || e.it.kind === "field" || BUILDINGS[e.it.type] ? `, with ${BUFFER} cell kept clear round it` : ""}. ${whereText(e)}.`)}>${esc(e.it.label)}${e.it.built ? "" : badge("Going up", "busy", "Under construction: its outline is on the map until it is finished")} ${e.at ? (e.auto ? badge("Auto", "muted", "Placed by the game: open the map to put it where you want") : badge("Placed", "good", `At ${e.at[0]}, ${e.at[1]}`)) : badge("Off the map", "bad", "Nowhere it fits: the yard is full. Place things closer together, or lift some.")}</span>
    <span class="row"><button class="mini" data-action="bm-open" data-base="${b.id}" data-key="${e.key}"${tip(e.at && !e.auto ? "Open the map with it lifted: click where it goes" : "Open the map with it picked: click where it goes")}>${e.at && !e.auto ? "Move" : "Place"}</button>${e.at && !e.auto ? `<button class="mini" data-action="bm-reset" data-base="${b.id}" data-key="${e.key}"${tip("Let the game place it again")}>Auto</button>` : ""}</span></div>`;
  let html = `<div class="grid2"><div>
    <h3>The base map</h3>
    <div class="card small"${tip("Every base has a square map of its own with the base itself in the middle. The map is what a horde or a raid fights over when it reaches the base: where things stand is where they are defended, and the attack comes from any side.")}>
      <div class="kv"><div>Grid</div><div><b>${sm.grid} × ${sm.grid}</b> cells (${esc(sm.tier.toLowerCase())}: ${2 * g.yard + 4 + 2 * g.out} to ${Math.min(300, 2 * g.cap + 4 + 2 * g.out)})</div>
      <div>Yard</div><div><b>${sm.yard} × ${sm.yard}</b> in the middle, ${sm.walled ? "inside the wall ring" : "with no wall round it yet"}</div>
      <div>On the map</div><div>${sm.items} things: ${sm.byHand} placed by hand, ${sm.items - sm.byHand - sm.off} by the game${sm.off ? `, <span class="danger">${sm.off} left off (no room)</span>` : ""}</div></div>
      <div class="row" style="margin-top:0.5rem"><button class="primary" data-action="bm-open" data-base="${b.id}"${tip("Open the map: the base as a battle would find it, with the buildings going up as outlines. Pick anything from the list and click where it goes.")}>Open the base map</button></div>
    </div>
    ${hint("Buildings, crop plots and parked cars go in the yard, never on top of each other, with a cell kept clear between them and the cell outside every door free. Defences (barricades, spike pits, the trench, floodlights, the watchtower) have no buffer: they stand right next to anything, in the yard or out in front of the wall. Anything you do not place, the game places; a building you queue opens the map to place its outline.", "The rules of the map (sim/basemap.js)")}
    ${hint(`In a raid the stores are on the map: every building that keeps goods (the base itself, the storehouse, cellars, the cold store, the freezer, the crates) holds a share of the real stock and armory, and you can look into any of them at any time. Raiders go for them once the wall is passed (about ${Math.round(STEAL.SHARE * 100)}% of a raid), carry off up to ${STEAL.KG} kg each and make for the edge of the map: what they get away with is gone; what they drop stays. The dead and raiders batter doors, windows, walls, barricades and parked cars in their way, and what was battered wears afterwards (Repairs tab).`, "Raids on the map")}
  </div><div>`;
  for (const [name, list] of groups) html += `<h3>${esc(name)} <span class="muted small">${list.length}</span></h3><div class="card small">${list.map(row).join("")}</div>`;
  if (!lay.length) html += `<div class="muted small">Nothing to place yet: the base itself stands in the middle of the map.</div>`;
  return html + `</div></div>`;
}

// ---------- the battle screen in layout mode ----------
// The side panel: what is picked, the lists to pick from, the stores, the close button. cui: ui/combat.js's state
// (the message, the store being looked at).
export function layoutPanel(state, b, cui, preview = "") {
  const L = b.layout, base = baseById(state, L.baseId);
  if (!base) return "";
  const lay = layoutOf(state, base);
  const picked = L.pick ? itemByKey(state, base, L.pick) : null;
  let html = `<div class="cbhead"><div class="cbtitle">Base map: ${esc(base.name)}</div>
    <div class="small muted">Pick something below, then click where it goes (its outline follows the mouse: green fits, red does not). R turns it. Click a placed thing to lift and move it. Esc puts the pick down. Nothing is fought here; the clock stands still.</div></div>`;
  if (picked) html += `<div class="card small" style="margin-top:0.4rem"><div class="spread"><b>${esc(picked.label)}</b><span class="muted">${sizeText(picked)}${L.rot & 1 ? " (turned)" : ""}</span></div>
    <div class="muted">${picked.kind === "defence" ? "A defence: no buffer, right next to anything, inside the yard or out in front of the wall." : picked.kind === "field" ? "A crop plot: in the yard, a cell clear of anything else." : picked.kind === "vehicle" ? "A parked car: in the yard, a cell clear of anything else; raiders and the dead batter it if it stands in their way." : "A building: in the yard, a cell clear of anything else, the cell outside its door free."}</div>
    <div class="cbactions" style="margin-top:0.3rem"><button data-action="cb-deploy" data-v="rotate" data-tip="Turn it a quarter (R)">Turn <span class="key">R</span></button><button data-action="cb-deploy" data-v="pick" data-k="" data-tip="Put the pick down without placing it (Esc)">Cancel <span class="key">Esc</span></button></div></div>`;
  html += preview; // what is under the mouse (ui/combat.js previewHtml: the pick's fit, a placed thing, a store)
  const msg = L.msg || cui.msg;
  if (msg) html += `<div class="small ${cui.msg ? "warn" : "good"} cbmsg">${esc(msg)}</div>`;
  const groups = new Map();
  for (const e of lay) { const k = groupOf(e.it.kind); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  for (const [name, list] of groups) {
    html += `<h3>${esc(name)}</h3><div class="cbroster">`;
    for (const e of list) {
      const on = L.pick === e.it.key;
      html += `<div class="cbunit${on ? " on" : ""}" data-action="cb-deploy" data-v="${e.at && !e.auto && !on ? "lift" : "pick"}" data-k="${e.it.key}" data-tip="${esc(`${e.it.label}: ${sizeText(e.it)}. ${whereText(e)}. ${on ? "Picked: click where it goes." : e.at && !e.auto ? "Click to lift it and move it." : "Click to pick it, then click where it goes."}`)}">
        <div class="spread"><span><b>${esc(e.it.label)}</b>${e.it.built ? "" : ` <span class="chip">outline</span>`}</span><span class="small muted">${!e.at ? '<span class="danger">off the map</span>' : e.auto ? "auto" : "placed"}</span></div></div>`;
    }
    html += `</div>`;
  }
  html += storesHtml(b, cui);
  html += `<div class="cbfoot"><button class="primary" data-action="cb-deploy" data-v="endLayout" data-tip="Close the map. Everything placed stays placed.">Close the map</button></div>`;
  return html;
}
// The stores on the map (any base battle): a button a container, and the contents of the one being looked at.
export function storesHtml(b, cui) {
  if (!b.stores || !b.stores.containers.length) return "";
  let html = `<h3 data-tip="${esc("The base's own stock and armory, spread over the buildings that hold goods. Click one here or on the map to see what is in it. In a raid, raiders go for them once the wall is passed; what they get away with is gone.")}">Stores on the map</h3><div class="cbactions">`;
  for (const c of b.stores.containers) html += `<button class="${cui.storeView === c.id ? "active" : ""}" data-action="cb-store" data-id="${c.id}" data-tip="${esc(`${c.label}: about ${Math.round(c.kg)} kg of goods. Click to see what is in it.`)}">${esc(c.label)} <span class="key">${Math.round(c.kg)} kg</span></button>`;
  html += `</div>`;
  const c = cui.storeView != null ? b.stores.containers.find((x) => x.id === cui.storeView) : null;
  if (c) {
    const s = storeContents(c);
    html += `<div class="card small" style="margin-top:0.4rem;flex-shrink:0"><div class="spread"><b>${esc(c.label)}</b><button class="mini" data-action="cb-store" data-id="" data-tip="Close">✕</button></div>
      ${s.sup.length || s.gear.length ? `<div class="small">${s.sup.map(([n, q]) => `${q} ${esc(n.toLowerCase())}`).join(", ")}${s.sup.length && s.gear.length ? "; " : ""}${s.gear.map(esc).join(", ")}</div>` : `<div class="small muted">Empty.</div>`}
      <div class="small muted">About ${s.kg} kg in all.</div></div>`;
  }
  return html;
}
// The hover line in layout mode: the pick's fit, or what stands there.
export function layoutHover(state, b, h, ghost) {
  const L = b.layout, base = baseById(state, L.baseId);
  if (!base) return "";
  const [gx, gy] = gridOfCell(b, h.x, h.y);
  if (ghost) return ghost.ok ? `<span class="good">Fits here.</span> Click to place it at ${gx}, ${gy}.` : `<span class="danger">${esc(ghost.why)}.</span>`;
  const picked = L.pick ? itemByKey(state, base, L.pick) : null;
  if (picked) return `Click where ${esc(picked.label)} goes.`;
  const F = b.deployPlan && b.deployPlan.fort;
  const o = F && F.outlines.find((q) => h.x >= q.x0 && h.x < q.x0 + q.w && h.y >= q.y0 && h.y < q.y0 + q.h);
  if (o) return `<b>${esc(o.name)}</b> <span class="muted">(going up: its outline, open ground in a raid). Click to lift and move it.</span>`;
  const e = layoutOf(state, base).find((q) => q.at && gx >= q.at[0] && gy >= q.at[1] && gx < q.at[0] + (q.at[2] & 1 ? q.it.h : q.it.w) && gy < q.at[1] + (q.at[2] & 1 ? q.it.w : q.it.h));
  if (e) return `<b>${esc(e.it.label)}</b> <span class="muted">${whereText(e)}. Click to lift and move it.</span>`;
  return `Cell ${gx}, ${gy}.`;
}
// A store container under the mouse in any base battle.
export function storeHover(c) {
  const s = storeContents(c);
  return `<b>${esc(c.label)}</b> · stores<br><span class="muted">${s.sup.length || s.gear.length ? `${s.sup.slice(0, 4).map(([n, q]) => `${q} ${esc(n.toLowerCase())}`).join(", ")}${s.sup.length > 4 || s.gear.length ? ", …" : ""}` : "empty"} (about ${s.kg} kg). Click it, or its button in the panel, to see everything in it.</span>`;
}

// ---------- actions (main.js) ----------
export const BASEMAP_ACTIONS = {
  "bm-open": (state, ui, d) => {
    const b = baseById(state, Number(d.base));
    if (!b) return;
    const err = openBaseMap(state, b.id, d.key || null);
    if (err) { ui.baseMsg = err; return; }
    ui.mapFrom = { id: b.id, tab: "basemap" };
    ui.baseView = null; ui.baseMsg = "";
  },
  "bm-reset": (state, ui, d) => { const b = baseById(state, Number(d.base)); if (b) ui.baseMsg = unplaceItem(state, b, d.key) || "Placed by the game again."; },
};
// After Build on the Construction tab (main.js queuebuild): the map opens with the new job picked.
export function openForJob(state, ui, base, type) {
  if (!base || !FOOT[type]) return false;
  const job = base.construction.filter((c) => c.type === type && !c.target).pop();
  if (!job) return false;
  const err = openBaseMap(state, base.id, `c:${job.id}`);
  if (err) return false;
  ui.mapFrom = { id: base.id, tab: "construction" };
  ui.baseView = null;
  return true;
}
