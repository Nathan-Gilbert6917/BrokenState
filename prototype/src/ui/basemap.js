// The base map in the interface (sim/basemap.js): the base window's Base map tab (what stands on the map and where,
// placed by hand or by the game; open the map, lift a thing off it) and the layout mode of the battle screen (the
// map itself, drawn by ui/isoview.js as any battle: pick something to build from the Build list, or a placed building,
// field, defence or car from the lists, its outline follows the mouse (green where it fits, red where it does not,
// with the reason), R turns it, a click puts it down; a click on a placed thing selects it (its card: what is inside
// a general building, the buildings it stands against and the doorways between them, Move, Auto, Demolish), a
// second click lifts it to move it; every store's contents can be looked at). Base building (docs/base-building/plan.md
// Part C, the user's request 2026-10-19). Also the contents card of a store container during a battle (ui/combat.js:
// a click on a container, or its button).
import { baseById } from "../sim/world.js";
import { openBaseMap, layoutOf, itemByKey, unplaceItem, baseMapSummary, storeContents, gridOfCell, buildMenu, fittingsIn, hostedItems, neighboursOf, canLink, FOOT, GRID, STEAL, NO_BUILD } from "../sim/basemap.js";
import { BUILDINGS, demolishRefund, pieceName, ringMat } from "../sim/buildings.js";
import { badge, hint, costChips, chip } from "./uikit.js";
import { fold } from "./panelfold.js"; // the Build list's groups fold, and remember it (the toggle listener)

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const GROUPS = [["house", "Buildings"], ["roof", "Buildings"], ["prop", "Yard things"], ["pen", "Yard things"], ["field", "Crop plots"], ["wall", "Walls and gates"], ["gate", "Walls and gates"], ["stand", "Wall stands"], ["defence", "Defences"], ["vehicle", "Parked cars"]];
const groupOf = (kind) => (GROUPS.find(([k]) => k === kind) || [null, "Other"])[1];
const whereText = (e) => (!e.at ? "nowhere it fits (left off the map)" : `${e.auto ? "placed by the game" : "placed by hand"} at ${e.at[0]}, ${e.at[1]}${e.at[2] ? ` turned ${e.at[2]}` : ""}`);
const sizeText = (it) => `${it.w} × ${it.h}`;
const HOSTS = "a hut, cabin, lodge, hall or barn";
// What each Build group is (the fold's tooltip).
const MENU_TIP = {
  "General buildings": `Empty shells of five sizes (the hut to the barn): once one stands, fittings and benches go on its floor. No plot: the map is the limit. Two standing against each other can share a doorway.`,
  Fittings: `Built only on the floor inside ${HOSTS}: bunk beds (+2 beds), storage shelves and lockers (containers: the Storage tab), a wood stove (a cook fire indoors).`,
  Buildings: "The buildings with a roof of their own (on a building plot) and the yard's roofed stores.",
  "Yard things": "The small things in the yard (on a utility plot): benches, barrels, the well, crates… A bench, a crate or a locker may stand inside a general building too.",
  Defences: "Barricades, spike pits, the trench, sandbags, floodlights, the watchtower, and the wall's pieces (walls 1×1, 1×2, 1×4 of the wall's material, the 1×4 gate, wall stands): anywhere on the map, inside the yard or out in front of the wall; a wall that would close a ring with no gate in it is refused. (The wire, the guard towers and the minefield lay themselves round the wall.)",
};
const NB_TEXT = `The no-build margin: nothing is built within ${NO_BUILD} cells of the map's edge`;
const refundText = (rec) => { const r = demolishRefund(rec); const t = Object.entries(r).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${k}`).join(", "); return t ? ` (${t})` : ""; };

// ---------- the base window's tab ----------
export function baseMapTab(state, b, ui) {
  const sm = baseMapSummary(state, b);
  const g = GRID[sm.tier === "Camp" ? "camp" : sm.tier === "Shelter" || sm.tier === "Outpost camp" ? "shelter" : sm.tier === "Main hub" ? "hub" : "outpost"];
  const lay = layoutOf(state, b);
  const groups = new Map();
  for (const e of lay) { const k = groupOf(e.it.kind); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const row = (e) => `<div class="spread small" style="margin-top:0.2rem"><span${tip(`${e.it.label}: ${sizeText(e.it)} cells. ${whereText(e)}.`)}>${esc(e.it.label)}${e.it.built ? "" : badge("Going up", "busy", "Under construction: its outline is on the map until it is finished")} ${e.at ? (e.auto ? badge("Auto", "muted", "Placed by the game: open the map to put it where you want") : badge("Placed", "good", `At ${e.at[0]}, ${e.at[1]}`)) : badge("Off the map", "bad", "Nowhere it fits: the yard is full. Place things closer together, or lift some.")}</span>
    <span class="row"><button class="mini" data-action="bm-open" data-base="${b.id}" data-key="${e.it.key}"${tip(e.at && !e.auto ? "Open the map with it lifted: click where it goes" : "Open the map with it picked: click where it goes")}>${e.at && !e.auto ? "Move" : "Place"}</button>${e.at && !e.auto ? `<button class="mini" data-action="bm-reset" data-base="${b.id}" data-key="${e.it.key}"${tip("Let the game place it again")}>Auto</button>` : ""}</span></div>`;
  let html = `<div class="grid2"><div>
    <h3>The base map</h3>
    <div class="card small"${tip("Every base has a square map of its own with the base itself in the middle. The map is what a horde or a raid fights over when it reaches the base: where things stand is where they are defended, and the attack comes from any side.")}>
      <div class="kv"><div>Grid</div><div><b>${sm.grid} × ${sm.grid}</b> cells (${esc(sm.tier.toLowerCase())}: ${2 * g.yard + 4 + 2 * g.out} to ${Math.min(300, 2 * g.cap + 4 + 2 * g.out)})</div>
      <div>Yard</div><div><b>${sm.yard} × ${sm.yard}</b> in the middle, ${sm.walled ? "walled in: the wall pieces close round the base" : sm.wall.walls + sm.wall.gates ? `<span class="warn">its wall is open</span> (${sm.wall.gap ? `a way in near ${sm.wall.gap[0]}, ${sm.wall.gap[1]}` : "a gap"})` : "with no wall round it yet"}</div>
      <div>On the map</div><div>${sm.items} things: ${sm.byHand} placed by hand, ${sm.items - sm.byHand - sm.off} by the game${sm.off ? `, <span class="danger">${sm.off} left off (no room)</span>` : ""}</div></div>
      <div class="row" style="margin-top:0.5rem"><button class="primary" data-action="bm-open" data-base="${b.id}"${tip("Open the map: the base as a battle would find it, with the buildings going up as outlines. Build anything from its Build list where you click, or pick anything from the lists and click where it goes.")}>Open the base map</button></div>
    </div>
    ${hint(`<b>Build on the map.</b> Open it and pick a type from its Build list: its outline follows the mouse, a click where it fits queues it there (the cost paid now, the builders put it up). <b>General buildings</b> (a hut, cabin, lodge, hall or barn) are empty shells: once one stands, <b>fittings</b> go on its floor (bunk beds, storage shelves, lockers, a wood stove) and so do benches and crates. Two buildings standing wall to wall can share a <b>doorway</b> (select one: Open a doorway). Nothing is built within <b>${NO_BUILD} cells</b> of the map's edge (the tinted margin). Anything else goes anywhere, in the yard or out beyond the wall, right against anything else: only never on top of something else, on the ring where the game lays the wall (walls, gates and stands may go there) or in a doorway (the cell outside every door and either side of a gate stays open). <b>Always a way in and out</b>: everything must be reachable on foot from the map's edge (gates and doors count), so a wall piece that would close a ring with no gate in it is refused. Anything you do not place, the game places: wall pieces round the ring (gates in the middle of its sides first, stands just inside); a building you queue on the Construction tab opens the map to place its outline.`, "The rules of the map (sim/basemap.js)")}
    ${hint(`The base's goods are kept in <b>containers</b> (the Storage tab): the base itself, the storehouse, cellars, the cold store, the freezer, crates, shelves and lockers, and the cars parked here; what fits in none lies in the yard. In a raid every container is on the map with what it holds, and you can look into any of them at any time. Raiders go for them once the wall is passed (about ${Math.round(STEAL.SHARE * 100)}% of a raid), the yard's goods first, carry off up to ${STEAL.KG} kg each and make for the edge of the map: what they get away with is gone; what they drop stays. The dead and raiders batter doors, windows, walls, barricades and parked cars in their way, and what was battered wears afterwards (Repairs tab).`, "Containers and raids on the map")}
  </div><div>`;
  for (const [name, list] of groups) html += `<h3>${esc(name)} <span class="muted small">${list.length}</span></h3><div class="card small">${list.map(row).join("")}</div>`;
  if (!lay.length) html += `<div class="muted small">Nothing to place yet: the base itself stands in the middle of the map.</div>`;
  return html + `</div></div>`;
}

// ---------- the battle screen in layout mode ----------
// The side panel: the header; the thing being built or placed; the selected thing's card; what is under the mouse and
// the last message; the Build list (sim/basemap.js buildMenu, by group); what is placed, by group (a click selects);
// the stores; the close button. cui: ui/combat.js's state (the message, the store being looked at).
export function layoutPanel(state, b, cui, preview = "") {
  const L = b.layout, base = baseById(state, L.baseId);
  if (!base) return "";
  const lay = layoutOf(state, base);
  const picked = L.pick ? itemByKey(state, base, L.pick) : null;
  const pickD = L.pickType ? BUILDINGS[L.pickType] : null, pickF = L.pickType ? FOOT[L.pickType] : null;
  let html = `<div class="cbhead"><div class="cbtitle">Base map: ${esc(base.name)}</div>
    <div class="small muted">Pick something to build from the Build list and click where it goes (its outline follows the mouse: green fits, red does not; R turns it). Click a placed thing, on the map or in the lists, to select it: its card has Move, the doorways and Demolish; a second click on the map lifts it to move it. Nothing is built within ${NO_BUILD} cells of the edge (the tinted margin). Esc puts the pick down. Nobody is on the map; the clock stands still.</div></div>`;
  if (pickD && pickF) html += `<div class="card small" style="margin-top:0.4rem"><div class="spread"><b>Building: ${esc(pickD.piece ? pieceName({ type: L.pickType, mat: pickD.piece === "stand" ? 0 : ringMat(base) }) : pickD.name)}</b><span class="muted">${pickF.w} × ${pickF.h}${L.rot & 1 ? " (turned)" : ""}</span></div>
    <div class="muted">Click where it goes (R turns it); ${pickF.fit ? `a fitting goes on the floor inside ${HOSTS}` : pickF.general ? "an empty shell: fittings (bunks, shelves, lockers, a stove) and benches go on its floor once it stands" : pickF.kind === "wall" ? "a wall piece goes anywhere, the ring round the yard too, of the wall's own material (the Defenses tab picks another); leave no gap, and a gate before the ring closes" : pickF.kind === "gate" ? "a gate: your people walk through it, attackers batter it; the cell either side of it stays open" : pickF.kind === "stand" ? "a wall stand: put it right behind a wall so whoever climbs it sees and shoots over it" : pickF.kind === "defence" ? "a defence goes anywhere on the map, inside the yard or out in front of the wall" : "anywhere on the map, right against anything else, only the cell outside its door kept open"}. The cost is paid when it is placed; the builders do the rest.</div>
    <div class="cbactions" style="margin-top:0.3rem"><button data-action="cb-deploy" data-v="rotate" data-tip="Turn it a quarter (R)">Turn <span class="key">R</span></button><button data-action="cb-deploy" data-v="pickType" data-bt="" data-tip="Put it down without building it (Esc)">Cancel <span class="key">Esc</span></button></div></div>`;
  else if (picked) html += `<div class="card small" style="margin-top:0.4rem"><div class="spread"><b>${esc(picked.label)}</b><span class="muted">${sizeText(picked)}${L.rot & 1 ? " (turned)" : ""}</span></div>
    <div class="muted">${picked.fit ? `A fitting: on the floor inside ${HOSTS}.` : picked.kind === "wall" ? "A wall piece: anywhere on the map, the ring round the yard too. R turns it. Walls only hold where they close round the base (a house's walls count): leave no gap, and put a gate in before the ring closes (always a way in and out)." : picked.kind === "gate" ? "A gate (1×4): your people walk through it, attackers batter it. The cell either side of it stays open. R turns it." : picked.kind === "stand" ? "A wall stand: a platform a level up. Put it right behind a wall so whoever climbs it sees and shoots over it. R turns it." : picked.kind === "defence" ? "A defence: anywhere on the map, right next to anything, inside the yard or out in front of the wall." : picked.kind === "field" ? "A crop plot: anywhere on the map, right next to anything else." : picked.kind === "vehicle" ? "A parked car: anywhere on the map, right next to anything else; raiders and the dead batter it if it stands in their way." : picked.general ? "A general building: anywhere on the map, right next to anything else, the cell outside its door kept open; what stands inside moves with it." : "A building: anywhere on the map, right next to anything else, only the cell outside its door kept open."}</div>
    <div class="cbactions" style="margin-top:0.3rem"><button data-action="cb-deploy" data-v="rotate" data-tip="Turn it a quarter (R)">Turn <span class="key">R</span></button><button data-action="cb-deploy" data-v="pick" data-k="" data-tip="Put the pick down without placing it (Esc)">Cancel <span class="key">Esc</span></button>${["wall", "gate", "stand"].includes(picked.kind) && picked.key.startsWith("b:") ? `<button data-action="demolish" data-base="${base.id}" data-id="${picked.rec.id}" data-ok="1" data-tip="Pull this piece down for good: half its scrap and parts come back. A gap it leaves in the wall is a way in.">Pull it down</button>` : ""}</div></div>`;
  html += selectionCard(state, base, L, lay);
  html += preview; // what is under the mouse (ui/combat.js previewHtml: the pick's fit, a placed thing, a store)
  const msg = cui.msg || L.msg; // the last order's refusal first (ui/combat.js act), else what the map said it did
  if (msg) html += `<div class="small ${cui.msg ? "warn" : "good"} cbmsg">${esc(msg)}</div>`;
  html += buildHtml(state, base, L);
  const groups = new Map();
  for (const e of lay) { const k = groupOf(e.it.kind); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  html += `<h3 data-tip="${esc("Everything that stands on the map, or should: click one to select it (its card at the top: Move, the doorways, Demolish). A thing the game placed stays where it is until you move it; one that fits nowhere is left off the map.")}">Placed</h3>`;
  for (const [name, list] of groups) {
    html += `<h4 class="muted">${esc(name)} <span class="small">${list.length}</span></h4><div class="cbroster">`;
    for (const e of list) {
      const on = L.sel === e.it.key, lifted = L.pick === e.it.key;
      html += `<div class="cbunit${on || lifted ? " on" : ""}" data-action="cb-deploy" data-v="select" data-k="${e.it.key}" data-tip="${esc(`${e.it.label}: ${sizeText(e.it)}. ${whereText(e)}. ${lifted ? "Lifted: click where it goes." : on ? "Selected: its card is at the top." : "Click to select it."}`)}">
        <div class="spread"><span><b>${esc(e.it.label)}</b>${e.it.built ? "" : ` <span class="chip">outline</span>`}${e.it.rec && e.it.rec.host != null ? ` <span class="chip"${tip("Inside a general building")}>inside</span>` : ""}</span><span class="small muted">${lifted ? "lifted" : !e.at ? `<button class="mini" data-action="cb-deploy" data-v="pick" data-k="${e.it.key}"${tip("Off the map (nowhere it fits): pick it and click where it goes")}>Place</button>` : e.auto ? "auto" : "placed"}</span></div></div>`;
    }
    html += `</div>`;
  }
  if (!lay.length) html += `<div class="muted small">Nothing placed yet: the base itself stands in the middle of the map.</div>`;
  html += storesHtml(b, cui);
  html += `<div class="cbfoot"><button class="primary" data-action="cb-deploy" data-v="endLayout" data-tip="Close the map. Everything placed and queued stays.">Close the map</button></div>`;
  return html;
}
// The Build list (sim/basemap.js buildMenu): the five groups as folds, each type a row with its size, cost against
// the stores, work-hours and a Build button (disabled with why not). The picked type is lit; Build on it again puts
// it down.
function buildHtml(state, base, L) {
  const menu = buildMenu(state, base);
  const groups = new Map();
  for (const m of menu) { if (!groups.has(m.group)) groups.set(m.group, []); groups.get(m.group).push(m); }
  let html = `<h3 data-tip="${esc("What can be built on the map: pick a type, its outline follows the mouse, a click where it fits queues it there (the cost paid now, the builders put it up). Grey: why not, in its tooltip. The Construction tab queues the same things; a building queued there opens the map to place it.")}">Build</h3>`;
  for (const [name, list] of groups) {
    const ready = list.filter((m) => m.ok).length;
    const body = list.map((m) => {
      const on = L.pickType === m.type;
      const short = !m.ok && /^Needs \d/.test(m.why); // short of materials: the red chips say it
      return `<div class="bmrow${on ? " on" : ""}${m.ok ? "" : " off"}"${tip(`${m.name}: ${m.w} × ${m.h} cells, ${m.hours} work-hours. ${m.desc}${m.ok ? "" : ` ${m.why}.`}`)}>
        <div class="spread"><span><b>${esc(m.name)}</b> <span class="small muted">${m.w} × ${m.h}</span></span><button class="mini${on ? " active" : m.ok ? " primary" : ""}" data-action="cb-deploy" data-v="pickType" data-bt="${on ? "" : m.type}" ${m.ok ? "" : "disabled"}${tip(m.ok ? (on ? "Picked: click where it goes on the map (click here again to put it down)" : "Pick it: its outline follows the mouse; click where it goes") : m.why)}>${on ? "Picked" : "Build"}</button></div>
        <div class="bmfoot">${costChips(m.cost, base.stock)}${chip({ icon: "⏱", name: `${m.hours}h`, t: `${m.hours} work-hours for the builders` })}</div>
        ${m.ok || short || !m.why ? "" : `<div class="small bmwhy">${esc(m.why)}</div>`}</div>`;
    }).join("");
    html += fold(`bm:${name}`, `<b>${esc(name)}</b> ${badge(`${ready} ready`, ready ? "good" : "muted", `${ready} of ${list.length} can be built now`)}`, body, { cls: "pf-card bmfold", open: name === "General buildings" || list.some((m) => m.type === L.pickType), tipText: MENU_TIP[name] || "" });
  }
  return html;
}
// The selected thing's card (L.sel): its name, size and spot; inside a general building, its fittings and the floor
// left; the buildings it stands against, each with Open a doorway / Close the doorway (sim/basemap.js canLink); Move
// (lift), Auto (placed by the game again), Place (off the map), Demolish or Cancel the job, Deselect.
function selectionCard(state, base, L, lay) {
  const e = L.sel ? lay.find((q) => q.it.key === L.sel) : null;
  if (!e) return "";
  const it = e.it, rec = it.rec;
  const isBld = it.key.startsWith("b:"), isJob = it.key.startsWith("c:");
  let inside = "";
  if (it.general) {
    const seen = new Map();
    for (const o of [...(isBld ? fittingsIn(state, base, rec.id) : []), ...(e.at ? hostedItems(state, base, { ...it, at: e.at }) : [])]) seen.set(o.key, o);
    const floor = (it.w - 2) * (it.h - 2), used = [...seen.values()].reduce((a, o) => a + o.w * o.h, 0);
    inside = `<div class="small" style="margin-top:0.25rem"><span class="muted">Inside:</span> ${seen.size ? [...seen.values()].map((o) => `<span class="chip"${tip(`${o.label}: ${sizeText(o)} on its floor${o.built ? "" : " (going up)"}. Click it on the map to select it.`)}>${esc(o.label)}${o.built ? "" : " ⌛"}</span>`).join("") : `<span class="muted">nothing yet</span>`} <span class="muted">· ${isBld ? `${Math.max(0, floor - used)} of ${floor} floor cells free` : `${floor} floor cells once it stands`}</span></div>`;
  }
  let doors = "";
  if (it.kind === "house" && e.at) {
    const nb = neighboursOf(state, base, it.key);
    doors = nb.length ? `<div class="small" style="margin-top:0.25rem"><span class="muted">Against:</span>${nb.map((n) => {
      const why = n.linked ? "" : canLink(state, base, it.key, n.key);
      return `<div class="spread" style="margin-top:0.15rem"><span>${esc(n.label)} <span class="muted">(${n.run} cell${n.run === 1 ? "" : "s"} of shared wall)</span>${n.linked ? ` ${badge("Doorway", "good", `A doorway is open between them: a barred door in each wall at ${n.a[0]}, ${n.a[1]} and ${n.b[0]}, ${n.b[1]}`)}` : ""}</span>${n.linked
        ? `<button class="mini" data-action="cb-deploy" data-v="unlink" data-a="${it.key}" data-b="${n.key}"${tip("Wall the doorway up again")}>Close the doorway</button>`
        : `<button class="mini" data-action="cb-deploy" data-v="link" data-a="${it.key}" data-b="${n.key}" ${why ? "disabled" : ""}${tip(why || `Open a doorway in the shared wall (the middle of the run, at ${n.a[0]}, ${n.a[1]}): a barred door in each wall, no outside cell to keep clear`)}>Open a doorway</button>`}</div>`;
    }).join("")}</div>` : `<div class="small muted" style="margin-top:0.25rem">Stands against no other building: put one right against its wall to open a doorway between them.</div>`;
  }
  const btns = [];
  if (e.at) btns.push(`<button data-action="cb-deploy" data-v="lift" data-k="${it.key}"${tip("Lift it off the map and click where it goes (R turns it); or click it on the map again")}>Move</button>`);
  if (e.at && !e.auto) btns.push(`<button data-action="cb-deploy" data-v="unplace" data-k="${it.key}"${tip("Let the game place it again")}>Auto</button>`);
  if (!e.at) btns.push(`<button data-action="cb-deploy" data-v="pick" data-k="${it.key}"${tip("Pick it and click where it goes")}>Place</button>`);
  if (isBld) btns.push(`<button class="danger" data-action="cb-deploy" data-v="demolish" data-k="${it.key}"${tip(`Pull it down (asks first): about half its scrap and parts come back${refundText(rec)}${it.general ? "; what stands inside comes down with it" : ""}`)}>Demolish</button>`);
  if (isJob) btns.push(`<button class="danger" data-action="cb-deploy" data-v="demolish" data-k="${it.key}"${tip("Cancel the job: half the materials come back")}>Cancel the job</button>`);
  btns.push(`<button data-action="cb-deploy" data-v="select" data-k="" data-tip="Deselect (Esc)">✕</button>`);
  return `<div class="card small bmsel" style="margin-top:0.4rem"><div class="spread"><b>${esc(it.label)}</b><span class="muted">${sizeText(it)}${it.built ? "" : " · going up"}</span></div>
    <div class="muted">${esc(whereText(e)[0].toUpperCase() + whereText(e).slice(1))}.${rec && rec.host != null ? " Inside a general building." : ""}${rec && rec.broken ? ' <span class="danger">Broken.</span>' : ""}</div>
    ${inside}${doors}
    <div class="cbactions" style="margin-top:0.3rem">${btns.join("")}</div></div>`;
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
// The hover line in layout mode: the pick's fit, the no-build margin, or what stands there.
export function layoutHover(state, b, h, ghost) {
  const L = b.layout, base = baseById(state, L.baseId);
  if (!base) return "";
  const [gx, gy] = gridOfCell(b, h.x, h.y);
  if (ghost) return ghost.ok ? `<span class="good">Fits here.</span> Click to ${L.pickType ? "build" : "place"} it at ${gx}, ${gy}${ghost.host ? " (inside)" : ""}.` : `<span class="danger">${esc(ghost.why)}.</span>`;
  const picked = L.pick ? itemByKey(state, base, L.pick) : null;
  if (picked) return `Click where ${esc(picked.label)} goes.`;
  if (L.pickType) return `Click where the ${esc(BUILDINGS[L.pickType] ? BUILDINGS[L.pickType].name.toLowerCase() : L.pickType)} goes.`;
  const cell = b.cells[h.y * b.w + h.x];
  if (cell && cell.nb) return `<span class="danger">${NB_TEXT}.</span>`;
  const F = b.deployPlan && b.deployPlan.fort;
  const o = F && F.outlines.find((q) => h.x >= q.x0 && h.x < q.x0 + q.w && h.y >= q.y0 && h.y < q.y0 + q.h);
  const e = layoutOf(state, base).find((q) => q.at && gx >= q.at[0] && gy >= q.at[1] && gx < q.at[0] + (q.at[2] & 1 ? q.it.h : q.it.w) && gy < q.at[1] + (q.at[2] & 1 ? q.it.w : q.it.h));
  const how = e && L.sel === e.it.key ? "Selected: click again to lift and move it." : "Click to select it.";
  if (o) return `<b>${esc(o.name)}</b> <span class="muted">(going up: its outline, open ground in a raid). ${how}</span>`;
  if (e) return `<b>${esc(e.it.label)}</b> <span class="muted">${whereText(e)}. ${how}</span>`;
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
    ui.mapFrom = { id: b.id, tab: d.tab || "basemap" }; // back to the tab it was opened from (the Construction tab's buttons)
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
