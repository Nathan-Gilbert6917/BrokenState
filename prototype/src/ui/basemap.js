// The base map in the interface (sim/basemap.js): the base window's Base map tab (what stands on the map and where,
// placed by hand or by the game; open the map, lift a thing off it) and the layout mode of the battle screen (the
// map itself, drawn by ui/isoview.js as any battle: pick something to build from the Build list, or a placed building,
// field, defence or car from the lists, its outline follows the mouse (green where it fits, red where it does not,
// with the reason), R turns it, a click puts it down; a click on a placed thing selects it (its card: what is inside
// a general building, the buildings it stands against and the doorways between them, Move, Auto, Demolish; the
// orders also in a chip beside it on the map: selChip), a second click lifts it to move it; every store's contents can be looked at). Base building (docs/base-building/plan.md
// Part C, the user's request 2026-10-19). Also the contents card of a store container during a battle (ui/combat.js:
// a click on a container, or its button): a pile of what lies outside the base's storage (sim/basestorage.js) says so
// plainly, and a parked car that is storage is a container too.
// moveCarButton: the Move button for a parked car (the base window's Vehicles tab): the map opens with the car picked.
import { baseById } from "../sim/world.js";
import { openBaseMap, layoutOf, itemByKey, unplaceItem, baseMapSummary, storeContents, gridOfCell, buildMenu, fittingsIn, hostedItems, neighboursOf, canLink, rectOf, FOOT, STEAL, NO_BUILD, landPieceAt, chopToolAt, landWords, bagKindOf, pickFoot, pickName } from "../sim/basemap.js";
import { clearOf, pieceWord, CLEAR } from "../sim/basescatter.js"; // the land: a piece's clearing
import { layoutDone } from "../sim/staging.js"; // Open the build map: the base's ask ends once its map is open
import { groundsFogged, deadText, GROUNDS_LABEL } from "../sim/campscout.js"; // a camp set up blind: its map known round the fire only (2026-10-23)
import { BUILDINGS, demolishRefund, pieceName, ringMat, TENTS, tentKind } from "../sim/buildings.js";
import { chopHands } from "../sim/woodwork.js"; // woodwork: who is felling a clearing
import { fillJobOf, fillHours } from "../sim/tunnels.js"; // the tunnels the dead dug: Fill tunnel
import { TERRA, TERRA_NAME, TERRA_VERB, terraModeOf, terraLevels, terraJobs, terraPct, terraWaits, shovelCrew, crewWords } from "../sim/terraform.js"; // terraforming: dig a hollow, raise a hill
import { DIG } from "../sim/hiveconst.js";
import { nearRect, active } from "../sim/combat.js"; // who of yours stands next to a store of theirs (an assault)
import { HAUL } from "../sim/raidloot.js";
import { badge, hint, costChips, chip } from "./uikit.js";
import { fold } from "./panelfold.js"; // the Build list's groups fold, and remember it (the toggle listener)
import { devText, padHtml } from "./hints.js"; // the map's line in the words of the device in use (a finger, a controller)

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
  Tents: `The Makeshift tent is built (poles and a tarp: 1 bed, −1 mood a day for its sleeper, no storage). A tent bag in the stores is pitched with a click, no builders: a one-person tent (1 bed, 15 kg out of the weather), a two-person (2, 30 kg), a four-person 3 × 3 (4, 60 kg). Strike one to pack it back into its bag. A new camp has no beds until a tent is up.`,
  Furniture: `Beds crafted at the bench (Crafting) and set from the stores on the floor inside ${HOSTS}: a cot (1 bed, −1 mood a day for its sleeper), a bed (1), a bunk bed (2, −0.5 each), a large bed 2 × 2 (2, +1 each; a lodge, hall or barn only: a hut's or a cabin's floor has no room for it). No builders: a click sets it. Demolish picks it up again.`,
  Power: "The power grid (sim/electric.js): found generators carried home and set from the stores on open ground (a click, no builders; fuel by the hour, Heat while they run), mounted spotlights set on a wall stand or the ground (lit in a night fight with power), a fridge on a general building's floor, and the builds that run on power: the breaker panel (wires the buildings: lights, fans and heaters, the switchboard on the Power card), the ammo press, the electric well pump, the fence charger. Demolish picks a set piece up again.",
  Buildings: "The buildings with a roof of their own (on a building plot) and the yard's roofed stores.",
  "Yard things": "The small things in the yard (on a utility plot): benches, barrels, the well, crates… A bench, a crate or a locker may stand inside a general building too.",
  Terrain: `Reshape the ground (sim/terraform.js): dig a hollow or raise a hill over an area of dirt (grass, trodden ground, a field; not the road, paving, rock, trees or buildings). Pick it, click one corner and then the opposite one; R sets how many levels (1 to ${TERRA.LEVELS}). Only builders with a shovel work it, one shovel a person (the armory's and their own): one shovel and three builders, one digs. A hollow gives ${TERRA.DIRT} dirt a cell-level into the heap, a hill takes as much; the slopes are eased as the land's own hills are, and a hill beside another joins it. Nothing is built on uneven ground until it is levelled again.`,
  Defences: "Barricades, spike pits, the trench, sandbags (the 1×1 pieces side by side lie as one sandbag wall; the positions are 4 cells), floodlights, the watchtower, and the wall's pieces (walls 1×1, 1×2, 1×4 of the wall's material, the 1×4 gate, wall stands): anywhere on the map, inside the yard or out in front of the wall; a wall that would close a ring with no gate in it is refused. (The wire, the guard towers and the minefield lay themselves round the wall.)",
};
const NB_TEXT = `The no-build margin: nothing is built within ${NO_BUILD} cells of the map's edge`;
const refundText = (rec) => { const r = demolishRefund(rec); const t = Object.entries(r).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${k}`).join(", "); return t ? ` (${t})` : ""; };
// A pile of what lies outside the base's storage (sim/basemap.js layPiles).
const PILE_NOTE = "Left outside (weathering, easy to steal)";
const PILE_TIP = "Goods the base has no room for (sim/basestorage.js): they lie in the open, things wear a little every day (more in rain and snow), and raiders go for the piles first and grab twice as much a turn. Build storage (a storage box, crates, a shed, a storehouse) or park a vehicle here.";

// "12 east and 30 north" of the map's middle (sim/basemap.js originOf: x east, y south).
const placeWords = ([x, y]) => [x ? `${Math.abs(x)} ${x > 0 ? "east" : "west"}` : "", y ? `${Math.abs(y)} ${y > 0 ? "south" : "north"}` : ""].filter(Boolean).join(" and ");
// ---------- the base window's tab ----------
export function baseMapTab(state, b, ui) {
  const sm = baseMapSummary(state, b);
  const lay = layoutOf(state, b);
  const groups = new Map();
  for (const e of lay) { const k = groupOf(e.it.kind); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const row = (e) => `<div class="spread small" style="margin-top:0.2rem"><span${tip(`${e.it.label}: ${sizeText(e.it)} cells. ${whereText(e)}.`)}>${esc(e.it.label)}${e.it.built ? "" : badge("Going up", "busy", "Under construction: its outline is on the map until it is finished")} ${e.at ? (e.auto ? badge("Auto", "muted", "Placed by the game: open the map to put it where you want") : badge("Placed", "good", `At ${e.at[0]}, ${e.at[1]}`)) : badge("Off the map", "bad", "Nowhere it fits: the yard is full. Place things closer together, or lift some.")}</span>
    <span class="row"><button class="mini" data-action="bm-open" data-base="${b.id}" data-key="${e.it.key}"${tip(e.at && !e.auto ? "Open the map with it lifted: click where it goes" : "Open the map with it picked: click where it goes")}>${e.at && !e.auto ? "Move" : "Place"}</button>${e.at && !e.auto && !e.it.fire ? `<button class="mini" data-action="bm-reset" data-base="${b.id}" data-key="${e.it.key}"${tip("Let the game place it again")}>Auto</button>` : ""}</span></div>`;
  let html = `<div class="grid2"><div>
    <h3>The base map</h3>
    <div class="card small"${tip("Every base has a square map of its own, the same size for a camp as for the main hub, with the base where its camp was set up. The map is what a horde or a raid fights over when it reaches the base: where things stand is where they are defended, and the attack comes from any side.")}>
      <div class="kv"><div>Grid</div><div><b>${sm.grid} × ${sm.grid}</b> cells${sm.origin[0] || sm.origin[1] ? ` <span class="muted">(the camp fire ${placeWords(sm.origin)} of the middle)</span>` : ""}</div>
      <div>Yard</div><div><b>${sm.yard} × ${sm.yard}</b> round the camp fire, ${sm.walled ? "walled in: the wall pieces close round the base" : sm.wall.walls + sm.wall.gates ? `<span class="warn">its wall is open</span> (${sm.wall.gap ? `a way in near ${sm.wall.gap[0]}, ${sm.wall.gap[1]}` : "a gap"})` : "with no wall round it yet"}</div>
      <div>On the map</div><div>${sm.items} things: ${sm.byHand} placed by hand, ${sm.items - sm.byHand - sm.off} by the game${sm.off ? `, <span class="danger">${sm.off} left off (no room)</span>` : ""}</div></div>
      <div class="row" style="margin-top:0.5rem"><button class="primary" data-action="bm-open" data-base="${b.id}"${tip("Open the map: the base as a battle would find it, with the buildings going up as outlines. Build anything from its Build list where you click, or pick anything from the lists and click where it goes.")}>Open the base map</button></div>
    </div>
    ${hint(`<b>Build on the map.</b> Open it and pick a type from its Build list: its outline follows the mouse, a click where it fits queues it there (the cost paid now, the builders put it up). <b>General buildings</b> (a hut, cabin, lodge, hall or barn) are empty shells: once one stands, <b>fittings</b> go on its floor (bunk beds, storage shelves, lockers, a wood stove) and so do benches and crates. Two buildings standing wall to wall can share a <b>doorway</b> (select one: Open a doorway). Nothing is built within <b>${NO_BUILD} cells</b> of the map's edge (the tinted margin). Anything else goes anywhere, in the yard or out beyond the wall, right against anything else: only never on top of something else, on the ring where the game lays the wall (walls, gates and stands may go there) or in a doorway (the cell outside every door and either side of a gate stays open). <b>Always a way in and out</b>: everything must be reachable on foot from the map's edge (gates and doors count), so a wall piece that would close a ring with no gate in it is refused. Anything you do not place, the game places: wall pieces round the ring (gates in the middle of its sides first, stands just inside); a building you queue on the Construction tab opens the map to place its outline.`, "The rules of the map (sim/basemap.js)")}
    ${hint(`In a raid the stores are on the map: every building that keeps goods (the base itself, storage boxes and crates, the shed, the storehouse, the warehouse, cellars, the cold store, the freezer, shelves and lockers inside a general building, the armory's locked gun cage and ammo lockers) and every parked car (its load space is storage while it is parked here) holds the real stock and armory as its containers: what you put in a container (the Storage tab) is in that container, the rest is shared out by the room left. What the base has no room for lies outside on piles of crates in the yard: it weathers, and raiders go for the piles first and grab twice as much a turn from them. You can look into any store at any time. Raiders go for the stores once the wall is passed (about ${Math.round(STEAL.SHARE * 100)}% of a raid), carry off up to ${STEAL.KG} kg each and make for the edge of the map: what they get away with is gone, from its container too; what they drop stays. The dead and raiders batter doors, windows, walls, barricades and parked cars in their way, and what was battered wears afterwards (Repairs tab).`, "Containers and raids on the map")}
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
  const pickD = L.pickType ? BUILDINGS[L.pickType] : null, pickF = L.pickType ? FOOT[L.pickType] : null, pickBag = L.pickType ? bagKindOf(L.pickType) : null;
  let html = `<div class="cbhead"><div class="cbtitle">Base map: ${esc(base.name)}</div>
    <div class="small muted">Pick something to build from the Build list and click where it goes (its outline follows the mouse: green fits, red does not; R turns it). Click a placed thing, on the map or in the lists, to select it: its orders (Move, the doorways, Demolish) show beside it on the map and on its card here; a second click on the map lifts it to move it. Nothing is built within ${NO_BUILD} cells of the edge (the tinted margin). Esc puts the pick down. Nobody is on the map; the clock stands still.</div></div>`;
  if (terraModeOf(L.pickType)) html += terraPickCard(state, base, L); // sim/terraform.js: an area of ground
  if (pickD && pickF) html += `<div class="card small" style="margin-top:0.4rem"><div class="spread"><b>Building: ${esc(pickD.piece ? pieceName({ type: L.pickType, mat: pickD.piece === "stand" ? 0 : ringMat(base) }) : pickD.name)}</b><span class="muted">${pickF.w} × ${pickF.h}${L.rot & 1 ? " (turned)" : ""}</span></div>
    <div class="muted">Click where it goes (R turns it); ${pickF.mount ? "a spotlight: on a wall stand (higher: it lights further) or the open ground; set from the stores, no builders" : pickD.set && pickF.fit ? `set from the stores on the floor inside ${HOSTS}, no builders` : pickD.set ? "set from the stores on open ground, no builders" : pickF.fit ? `a fitting goes on the floor inside ${HOSTS}` : pickF.general ? "an empty shell: fittings (bunks, shelves, lockers, a stove) and benches go on its floor once it stands" : pickF.kind === "wall" ? "a wall piece goes anywhere, the ring round the yard too, of the wall's own material (the Defenses tab picks another); leave no gap, and a gate before the ring closes" : pickF.kind === "gate" ? "a gate: your people walk through it, attackers batter it; the cell either side of it stays open" : pickF.kind === "stand" ? "a wall stand: put it right behind a wall so whoever climbs it sees and shoots over it" : pickF.kind === "defence" ? "a defence goes anywhere on the map, inside the yard or out in front of the wall" : "anywhere on the map, right against anything else, only the cell outside its door kept open"}.${pickD.set ? "" : " The cost is paid when it is placed; the builders do the rest."}</div>
    <div class="cbactions" style="margin-top:0.3rem"><button data-action="cb-deploy" data-v="rotate" data-tip="Turn it a quarter (R)">Turn <span class="key">R</span></button><button data-action="cb-deploy" data-v="pickType" data-bt="" data-tip="Put it down without building it (Esc)">Cancel <span class="key">Esc</span></button></div></div>`;
  else if (pickBag) html += `<div class="card small" style="margin-top:0.4rem"><div class="spread"><b>Pitching: ${esc(pickName(L.pickType))}</b><span class="muted">${pickFoot(L.pickType).w} × ${pickFoot(L.pickType).h}${L.rot & 1 ? " (turned)" : ""}</span></div>
    <div class="muted">Click where it goes (R turns it): on open ground, a way in and out kept. Its bag comes out of the stores; no cost, no builders.</div>
    <div class="cbactions" style="margin-top:0.3rem"><button data-action="cb-deploy" data-v="rotate" data-tip="Turn it a quarter (R)">Turn <span class="key">R</span></button><button data-action="cb-deploy" data-v="pickType" data-bt="" data-tip="Put it down without pitching it (Esc)">Cancel <span class="key">Esc</span></button></div></div>`;
  else if (picked) html += `<div class="card small" style="margin-top:0.4rem"><div class="spread"><b>${esc(picked.label)}</b><span class="muted">${sizeText(picked)}${L.rot & 1 ? " (turned)" : ""}</span></div>
    <div class="muted">${picked.fit ? `A fitting: on the floor inside ${HOSTS}.` : picked.kind === "wall" ? "A wall piece: anywhere on the map, the ring round the yard too. R turns it. Walls only hold where they close round the base (a house's walls count): leave no gap, and put a gate in before the ring closes (always a way in and out)." : picked.kind === "gate" ? "A gate (1×4): your people walk through it, attackers batter it. The cell either side of it stays open. R turns it." : picked.kind === "stand" ? "A wall stand: a platform a level up. Put it right behind a wall so whoever climbs it sees and shoots over it. R turns it." : picked.kind === "defence" ? "A defence: anywhere on the map, right next to anything, inside the yard or out in front of the wall." : picked.kind === "field" ? "A crop plot: anywhere on the map, right next to anything else." : picked.kind === "vehicle" ? "A parked car: anywhere on the map, right next to anything else; raiders and the dead batter it if it stands in their way." : picked.general ? "A general building: anywhere on the map, right next to anything else, the cell outside its door kept open; what stands inside moves with it." : "A building: anywhere on the map, right next to anything else, only the cell outside its door kept open."}</div>
    <div class="cbactions" style="margin-top:0.3rem"><button data-action="cb-deploy" data-v="rotate" data-tip="Turn it a quarter (R)">Turn <span class="key">R</span></button><button data-action="cb-deploy" data-v="pick" data-k="" data-tip="Put the pick down without placing it (Esc)">Cancel <span class="key">Esc</span></button>${["wall", "gate", "stand"].includes(picked.kind) && picked.key.startsWith("b:") ? `<button data-action="demolish" data-base="${base.id}" data-id="${picked.rec.id}" data-ok="1" data-tip="Pull this piece down for good: half its scrap and parts come back. A gap it leaves in the wall is a way in.">Pull it down</button>` : ""}</div></div>`;
  // A camp set up blind (sim/campscout.js): the map past the fire under the fog, the dead out there uncounted.
  if (groundsFogged(base)) html += `<div class="card small warn" style="margin-top:0.4rem"><b>Set up blind</b>: past the camp the ground is unknown (the fog) and so is how many of the dead are out on it (${esc(deadText(base))}). Survey this tile to know it all; ${GROUNDS_LABEL} with a team on the tile, or fight them off as they come.</div>`;
  html += selectionCard(state, base, L, lay);
  cui.selChip = selChip(state, b, base, L, lay); // its orders beside it on the map (ui/combat.js selChipFrame)
  html += landCard(state, base, L);
  html += tunnelCard(state, base, L);
  html += clearingList(state, base);
  html += terraList(state, base);
  html += tunnelList(state, base);
  html += preview; // what is under the mouse (ui/combat.js previewHtml: the pick's fit, a placed thing, a store)
  const msg = cui.msg || L.msg; // the last order's refusal first (ui/combat.js act), else what the map said it did
  if (msg) html += `<div class="small ${cui.msg ? "warn" : "good"} cbmsg">${padHtml(esc(devText(msg, "battle")))}</div>`;
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
      if (m.terra) return terraRow(m, on); // sim/terraform.js: an area, shovels and dirt
      return `<div class="bmrow${on ? " on" : ""}${m.ok ? "" : " off"}"${tip(`${m.name}: ${m.w} × ${m.h} cells, ${m.hours} work-hours. ${m.desc}${m.ok ? "" : ` ${m.why}.`}`)}>
        <div class="spread"><span><b>${esc(m.name)}</b> <span class="small muted">${m.w} × ${m.h}</span></span><button class="mini${on ? " active" : m.ok ? " primary" : ""}" data-action="cb-deploy" data-v="pickType" data-bt="${on ? "" : m.type}" ${m.ok ? "" : "disabled"}${tip(m.ok ? (on ? "Picked: click where it goes on the map (click here again to put it down)" : "Pick it: its outline follows the mouse; click where it goes") : m.why)}>${on ? "Picked" : "Build"}</button></div>
        <div class="bmfoot">${m.tentBag ? chip({ icon: "⛺", name: `${m.have} in the stores`, tone: m.have ? "ok" : "bad", t: "Tent bags are found, traded or carried in: pitched from the stores with a click, no cost and no builders" }) : m.furniture ? chip({ icon: "🛏", name: `${m.have} in the stores`, tone: m.have ? "ok" : "bad", t: "Furniture is crafted at the bench (Crafting) or found, and set from the stores: no cost and no builders" }) : `${costChips(m.cost, base.stock)}${chip({ icon: "⏱", name: `${m.hours}h`, t: `${m.hours} work-hours for the builders` })}`}</div>
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
  const btns = selButtons(it, e, rec, isBld, isJob);
  btns.push(`<button data-action="cb-deploy" data-v="select" data-k="" data-tip="Deselect (Esc)">✕</button>`);
  return `<div class="card small bmsel" style="margin-top:0.4rem"><div class="spread"><b>${esc(it.label)}</b><span class="muted">${sizeText(it)}${it.built ? "" : " · going up"}</span></div>
    <div class="muted">${esc(whereText(e)[0].toUpperCase() + whereText(e).slice(1))}.${rec && rec.host != null ? " Inside a general building." : ""}${rec && rec.broken ? ' <span class="danger">Broken.</span>' : ""}</div>
    ${inside}${doors}
    <div class="cbactions" style="margin-top:0.3rem">${btns.join("")}</div></div>`;
}
// The selected thing's chip on the map (the user's request 2026-10-23: the options next to the selected thing, not
// only in the side panel): its name and its orders (selButtons), the doorways of a building against others, with the
// map cells of its footprint for ui/combat.js to put the chip beside it. null while nothing placed is selected or
// something is picked up.
function selChip(state, b, base, L, lay) {
  const F = b.deployPlan && b.deployPlan.fort;
  const e = L.sel && !L.pick && !L.pickType && F ? lay.find((q) => q.it.key === L.sel) : null;
  if (!e || !e.at) return null;
  const it = e.it, isBld = it.key.startsWith("b:"), isJob = it.key.startsWith("c:");
  const btns = selButtons(it, e, it.rec, isBld, isJob);
  if (it.kind === "house") for (const n of neighboursOf(state, base, it.key)) {
    const why = n.linked ? "" : canLink(state, base, it.key, n.key);
    btns.push(n.linked ? `<button data-action="cb-deploy" data-v="unlink" data-a="${it.key}" data-b="${n.key}"${tip(`Wall the doorway to ${n.label} up again`)}>Close the doorway: ${esc(n.label)}</button>`
      : `<button data-action="cb-deploy" data-v="link" data-a="${it.key}" data-b="${n.key}" ${why ? "disabled" : ""}${tip(why || `Open a doorway to ${n.label} in the shared wall`)}>Open a doorway: ${esc(n.label)}</button>`);
  }
  const r = rectOf(it, e.at);
  return { key: it.key, rect: [r.x0 + F.ox, r.y0 + F.oy, r.w, r.h],
    html: `<div class="bc-head"><b>${esc(it.label)}</b><span class="muted small">${sizeText(it)}${it.built ? "" : " · going up"}</span><button class="mini" data-action="cb-deploy" data-v="select" data-k="" data-tip="Deselect (Esc)">✕</button></div><div class="bc-btns">${btns.join("")}</div>` };
}
// The selected thing's orders (its card in the panel and its chip on the map): Move, Auto, Place, Strike / Pick up /
// Demolish, Cancel the job.
function selButtons(it, e, rec, isBld, isJob) {
  const btns = [];
  if (e.at) btns.push(`<button data-action="cb-deploy" data-v="lift" data-k="${it.key}"${tip("Pick it up: its outline follows the mouse, click where it goes (R turns it, Esc leaves it where it is); or click it on the map again. Nothing else on the map moves.")}>Move</button>`);
  if (e.at && !e.auto && !it.fire) btns.push(`<button data-action="cb-deploy" data-v="unplace" data-k="${it.key}"${tip("Let the game place it again")}>Auto</button>`);
  if (!e.at) btns.push(`<button data-action="cb-deploy" data-v="pick" data-k="${it.key}"${tip("Pick it and click where it goes")}>Place</button>`);
  if (isBld && it.type === "tent" && TENTS[tentKind(rec)].bag) btns.push(`<button data-action="cb-deploy" data-v="demolish" data-k="${it.key}"${tip("Strike it: packed back into its bag, the bag into the stores (sim/tents.js). Its beds and its room out of the weather go with it.")}>Strike</button>`);
  else if (isBld && BUILDINGS[it.type] && BUILDINGS[it.type].furniture) btns.push(`<button data-action="cb-deploy" data-v="demolish" data-k="${it.key}"${tip("Pick it up: back into the stores, whole (sim/beds.js, sim/electric.js)")}>Pick up</button>`);
  else if (isBld) btns.push(`<button class="danger" data-action="cb-deploy" data-v="demolish" data-k="${it.key}"${tip(`Pull it down (asks first): about half its scrap and parts come back${refundText(rec)}${it.general ? "; what stands inside comes down with it (furniture is carried out into the stores)" : ""}`)}>Demolish</button>`);
  if (isJob) btns.push(`<button class="danger" data-action="cb-deploy" data-v="demolish" data-k="${it.key}"${tip("Cancel the job: half the materials come back")}>Cancel the job</button>`);
  return btns;
}
// The stores on the map (any base battle): a button a container, and the contents of the one being looked at.
// u: the selected unit. On an assault (sim/assaultstores.js: their stores, c.contents) the card offers Take (the search
// window) or Force lock to one of yours standing next to it, once the fight has begun.
export function storesHtml(b, cui, u = null) {
  if (!b.stores || !b.stores.containers.length) return "";
  if (b.stores.containers.some((c) => c.contents)) return theirStoresHtml(b, cui, u);
  let html = `<h3 data-tip="${esc("The base's own stock and armory, spread over the buildings that hold goods and the parked cars; what there is no room for lies outside on piles. Click one here or on the map to see what is in it. In a raid, raiders go for them once the wall is passed (the piles first); what they get away with is gone. An armory's gun cage and ammo lockers are locked (🔒) behind its locked security door: a raider has to batter the door down and then the lock open.")}">Stores on the map</h3><div class="cbactions">`;
  for (const c of b.stores.containers) html += `<button class="${cui.storeView === c.id ? "active" : ""}" data-action="cb-store" data-id="${c.id}" data-tip="${esc(`${c.label}: about ${Math.round(c.kg)} kg of goods.${c.lock ? (!(c.lock.hp > 0) ? " Its lock is smashed open." : c.lock.open ? " Unlocked with the key." : ` Locked (${c.lock.hp}/${c.lock.mhp}): a raider has to batter the lock open first.`) : ""} ${c.pile ? ` ${PILE_NOTE}.` : ""} Click to see what is in it.`)}">${esc(c.label)}${lockMark(c)} <span class="key">${Math.round(c.kg)} kg</span></button>`;
  html += `</div>`;
  const c = cui.storeView != null ? b.stores.containers.find((x) => x.id === cui.storeView) : null;
  if (c) {
    const s = storeContents(c);
    html += `<div class="card small" style="margin-top:0.4rem;flex-shrink:0"><div class="spread"><b>${esc(c.label)}</b><button class="mini" data-action="cb-store" data-id="" data-tip="Close">✕</button></div>
      ${c.pile ? `<div class="small warn"${tip(PILE_TIP)}>${PILE_NOTE}</div>` : c.vid != null ? `<div class="small muted">A parked car: its load space is storage while it is parked here.</div>` : ""}
      ${s.sup.length || s.gear.length ? `<div class="small">${s.sup.map(([n, q]) => `${q} ${esc(n.toLowerCase())}`).join(", ")}${s.sup.length && s.gear.length ? "; " : ""}${s.gear.map(esc).join(", ")}</div>` : `<div class="small muted">Empty.</div>`}
      ${lockLine(s.lock)}<div class="small muted">About ${s.kg} kg in all.</div></div>`;
  }
  return html;
}
// Their stores on an assault's map (sim/assaultstores.js): the same buttons and card, their words.
function theirStoresHtml(b, cui, u) {
  let html = `<h3 data-tip="${esc("What this base of theirs really holds, in its storage: their main house, their storage buildings by their room, and what they have no room for on piles in the yard. One of yours next to one takes what they can carry (the search window: hauling takes time, quicker from a pile); a locked one is forced first. What your people carry off is gone from their stores; win and half of what is left is yours too. Lose, and what your people had taken stays with them.")}">Their stores</h3><div class="cbactions">`;
  for (const c of b.stores.containers) html += `<button class="${cui.storeView === c.id ? "active" : ""}" data-action="cb-store" data-id="${c.id}" data-tip="${esc(`${c.label}: about ${Math.round(c.kg)} kg of goods.${c.lock && !c.lock.open ? ` Locked (${c.lock.hp}/${c.lock.mhp}).` : ""}${c.pile ? " Left outside: quicker to haul off." : ""} Click to see what is in it.`)}">${esc(c.label)}${lockMark(c)} <span class="key">${Math.round(c.kg)} kg</span></button>`;
  html += `</div>`;
  const c = cui.storeView != null ? b.stores.containers.find((x) => x.id === cui.storeView) : null;
  if (c) {
    const s = storeContents(c);
    html += `<div class="card small" style="margin-top:0.4rem;flex-shrink:0"><div class="spread"><b>${esc(c.label)}</b><button class="mini" data-action="cb-store" data-id="" data-tip="Close">✕</button></div>
      ${c.pile ? `<div class="small warn">Left outside: no lid, no lock, quicker to haul off.</div>` : ""}
      ${s.sup.length || s.gear.length ? `<div class="small">${s.sup.map(([n, q]) => `${q} ${esc(n.toLowerCase())}`).join(", ")}${s.sup.length && s.gear.length ? "; " : ""}${s.gear.map(esc).join(", ")}</div>` : `<div class="small muted">Empty.</div>`}
      ${theirLockLine(s.lock)}<div class="small muted">About ${s.kg} kg in all.</div>${takeButtons(b, c, u)}</div>`;
  }
  return html;
}
// A store of theirs (an assault): Take (the search window: into the hands, pockets and pack of the one next to it,
// hauling time as a raid's search; a pile quicker) or Force lock (one blow, the rest of the turn).
function takeButtons(b, c, u) {
  if (b.phase === "deploy" || b.over) return `<div class="small muted">Once the assault has begun, one of yours standing next to it can take from it.</div>`;
  const mine = u && u.side === "player" && active(u) ? u : null;
  const near = !!mine && nearRect(c, mine.x, mine.y) && (c.f || 0) === (mine.f || 0);
  const who = mine ? esc(mine.name.split(" ")[0]) : "";
  const locked = !!(c.lock && !c.lock.open);
  if (locked) {
    const why = !mine ? "Pick one of your people next to it." : !near ? `${who} has to stand next to it.` : mine.ap < 1 ? "No actions left this turn." : "";
    return `<div class="row" style="margin-top:0.3rem"><button class="mini" data-action="cb-store-force" data-id="${c.id}"${why ? " disabled" : ""}${tip(why || `${who} batters the lock with what they hold (a crowbar, a fire axe or a sledgehammer twice as hard): one blow, the rest of the turn, loud. At 0 it is open and they can take from it.`)}>Force lock</button></div>`;
  }
  const why = !mine ? "Pick one of your people next to it." : !near ? `${who} has to stand next to it.` : "";
  const rate = c.haulRate > 1 ? ` From a pile it goes ${c.haulRate} times as fast.` : "";
  return `<div class="row" style="margin-top:0.3rem"><button class="mini" data-action="cb-store-take" data-id="${c.id}"${why ? " disabled" : ""}${tip(why || `Open it for ${who}: take what they can carry into their hands, pockets and pack (their max load; two different things carried and their hands are full). Hauling takes time: the first ${HAUL.free} kg a turn are free, then ${HAUL.per} kg an action.${rate} What they carry when the fight ends comes home with them and is gone from their stores; a loss leaves it with them.`)}>Take</button></div>`;
}
const theirLockLine = (L) => (!L ? "" : L.smashed ? `<div class="small good">🔓 The lock is smashed open${L.by ? ` (${esc(L.by)})` : ""}.</div>` : L.open ? `<div class="small good">🔓 Open.</div>` : `<div class="small warn">🔒 Locked (${L.hp}/${L.mhp}): force the lock (next to it, a blow a turn) before anything can be taken.</div>`);
// The armory's locks (sim/basemap.js ARMORY_LOCK): a mark after a locked container's name, and the lock's line in its card.
const lockMark = (c) => (c.lock ? (c.lock.open ? " 🔓" : " 🔒") : "");
const lockLine = (L) => (!L ? "" : L.smashed ? `<div class="small danger">🔓 The lock is smashed open${L.by ? ` (${esc(L.by)})` : ""}: raiders take from it freely.</div>` : L.open ? `<div class="small warn">🔓 Unlocked with the key: raiders take from it freely. Lock (1 action, next to it) locks it again.</div>` : `<div class="small good">🔒 Locked (${L.hp}/${L.mhp}): a raider has to batter the lock open, a blow a turn, before anything can be taken. Your people unlock it with the key (Unlock, 1 action, next to it).</div>`);
// The hover line in layout mode: the pick's fit, the no-build margin, or what stands there.
export function layoutHover(state, b, h, ghost) {
  const L = b.layout, base = baseById(state, L.baseId);
  if (!base) return "";
  const [gx, gy] = gridOfCell(b, h.x, h.y);
  if (ghost && ghost.terraPick) return terraHover(ghost); // sim/terraform.js: the area, its cost and time
  if (!ghost && b.knownMask && !b.knownMask[h.y * b.w + h.x]) return `<span class="muted">Unknown ground: the camp went up blind. Survey this tile to know what lies out here.</span>`; // sim/campscout.js
  if (ghost) return ghost.ok ? `<span class="good">Fits here.</span> Click to ${L.pickType ? "build" : "place"} it at ${gx}, ${gy}${ghost.host ? " (inside)" : ""}.` : ghost.land ? `<span class="warn">${esc(ghost.why)}.</span>` : `<span class="danger">${esc(ghost.why)}.</span>`;
  const picked = L.pick ? itemByKey(state, base, L.pick) : null;
  if (picked) return `Click where ${esc(picked.label)} goes.`;
  if (L.pickType) return `Click where the ${esc(pickName(L.pickType).toLowerCase())} goes.`;
  const cell = b.cells[h.y * b.w + h.x];
  if (cell && cell.nb) return `<span class="danger">${NB_TEXT}.</span>`;
  const F = b.deployPlan && b.deployPlan.fort;
  const o = F && F.outlines.find((q) => h.x >= q.x0 && h.x < q.x0 + q.w && h.y >= q.y0 && h.y < q.y0 + q.h);
  const e = layoutOf(state, base).find((q) => q.at && gx >= q.at[0] && gy >= q.at[1] && gx < q.at[0] + (q.at[2] & 1 ? q.it.h : q.it.w) && gy < q.at[1] + (q.at[2] & 1 ? q.it.w : q.it.h));
  const how = e && L.sel === e.it.key ? "Selected: click again to lift and move it." : "Click to select it.";
  if (o) return `<b>${esc(o.name)}</b> <span class="muted">(going up: its outline, open ground in a raid). ${how}</span>`;
  if (e) return `<b>${esc(e.it.label)}</b> <span class="muted">${whereText(e)}. ${how}</span>`;
  const lp = landPieceAt(state, base, gx, gy)[0];
  if (lp) { const q = base.construction.find((c) => c.type === "clear" && c.pieces && c.pieces.some((p) => p.g === lp.g)); return `<b>${esc(pieceWord(lp).replace(/^an? /, "").replace(/^\w/, (m) => m.toUpperCase()))}</b> <span class="muted">${lp.k === "water" ? "the river: never built on" : lp.spring ? "spring-fed, never dries: never built on nor filled in" : q ? `being cleared (${Math.round((100 * (q.progress || 0)) / Math.max(1e-9, q.hours))}%)` : "the land: click it to clear it (nothing is built on it until then)"}.</span>`; }
  return `Cell ${gx}, ${gy}.`;
}
// A store container under the mouse in any base battle.
export function storeHover(c) {
  const s = storeContents(c);
  const lock = s.lock ? (s.lock.smashed ? " · lock smashed open" : s.lock.open ? " · unlocked" : ` · locked (${s.lock.hp}/${s.lock.mhp})`) : "";
  return `<b>${esc(c.label)}</b> · ${c.pile ? `<span class="warn">${PILE_NOTE}</span>` : "stores"}${lock}<br><span class="muted">${s.sup.length || s.gear.length ? `${s.sup.slice(0, 4).map(([n, q]) => `${q} ${esc(n.toLowerCase())}`).join(", ")}${s.sup.length > 4 || s.gear.length ? ", …" : ""}` : "empty"} (about ${s.kg} kg). Click it, or its button in the panel, to see everything in it.</span>`;
}

// ---------- the land (sim/basescatter.js) ----------
const getText = (get) => Object.entries(get || {}).filter(([, v]) => v > 0).map(([k, v]) => `+${v} ${k === "carparts" ? `car part${v === 1 ? "" : "s"}` : k === "metalsheet" ? `metal sheet${v === 1 ? "" : "s"}` : k}`).join(", ");
// The card of the piece of land clicked (L.land: its grid cell): what it is, and its clearing (alone, with the rest of
// its stand or line, a wreck stripped first), each as a job in the construction queue.
function landCard(state, base, L) {
  if (!L.land) return "";
  const one = landPieceAt(state, base, L.land[0], L.land[1]);
  if (!one.length) return "";
  const p = one[0];
  const close = `<button data-action="cb-deploy" data-v="landClose" data-tip="Close">✕</button>`;
  if (p.k === "water") return `<div class="card small bmsel" style="margin-top:0.4rem"><div class="spread"><b>The river</b>${close}</div><div class="muted">Nothing is built on the water, and it is never cleared: walk across at the fords.</div></div>`;
  if (p.spring) return `<div class="card small bmsel" style="margin-top:0.4rem"><div class="spread"><b>The pond</b>${close}</div><div class="muted">A spring-fed pond in a hollow (this tile has one on the State Map): water whatever the rain, ice when it freezes. Nothing is built on it and it is never filled in; wade its shallows, round its deep middle.</div></div>`; // sim/ponds.js
  const tool = chopToolAt(state, base);
  const all = landPieceAt(state, base, L.land[0], L.land[1], true);
  const c1 = clearOf(p, tool), cs = p.k === "wreck" ? clearOf(p, tool, "strip") : null;
  const queued = base.construction.find((c) => c.type === "clear" && c.pieces && c.pieces.some((q) => q.g === p.g));
  let cAll = null;
  if (all.length > 1) { cAll = { hours: 0, get: {} }; for (const q of all) { const c = clearOf(q, tool); if (!c) continue; cAll.hours += c.hours; for (const [k, v] of Object.entries(c.get)) cAll.get[k] = (cAll.get[k] || 0) + v; } }
  const btn = (label, mode, clump, c, t) => `<button data-action="cb-deploy" data-v="clear" data-mode="${mode}" data-clump="${clump ? 1 : 0}"${queued ? " disabled" : ""}${tip(queued ? "Queued already: the construction queue" : t)}>${label}</button>`;
  const what = p.k === "wreck" ? (p.looted ? "Stripped already: what is left is dragged off." : "Strip it first for its scrap and a car part (once), or clear it, which strips it too.") : CLEAR[p.k] ? "" : "";
  return `<div class="card small bmsel" style="margin-top:0.4rem"><div class="spread"><b>${esc(pieceWord(p).replace(/^an? /, "").replace(/^\w/, (m) => m.toUpperCase()))}</b>${close}</div>
    <div class="muted">The land: nothing is built on it until it is cleared. ${what}${p.k === "tree" && !tool ? " No cutting tool at the base (an axe, a machete): felling takes half as long again." : ""}</div>
    ${queued ? `<div class="small warn" style="margin-top:0.2rem">Queued: ${esc(queued.label)} (${Math.round((100 * (queued.progress || 0)) / Math.max(1e-9, queued.hours))}%)</div>` : ""}
    <div class="cbactions" style="margin-top:0.3rem">${c1 ? btn(`${(CLEAR[p.k] || CLEAR.wreck).verb} it · ${c1.hours}h${getText(c1.get) ? ` · ${getText(c1.get)}` : ""}`, "clear", false, c1, p.k === "tree" || p.k === "log" || p.k === "stump" || p.k === "bush" || p.k === "fence" ? "Queue its felling: the woodcutters (Cut wood) do it before their trips, and the builders from the construction queue, like a building" : "Queue its clearing: the builders do it from the construction queue, like a building") : ""}${cs ? btn(`Strip it · ${cs.hours}h · ${getText(cs.get)}`, "strip", false, cs, "Strip it of its scrap and a car part (once); it still has to be dragged off to build there") : ""}${cAll ? btn(`All ${all.length} · ${Math.round(cAll.hours * 10) / 10}h${getText(cAll.get) ? ` · ${getText(cAll.get)}` : ""}`, "clear", true, cAll, `Clear the whole ${p.k === "tree" ? "stand of trees" : p.k === "bush" ? "hedge" : p.k === "fence" ? "fence run" : "heap"} it is part of (${landWords(all)}) as one job`) : ""}</div></div>`;
}
// The clearing jobs in the queue (the construction queue's own), with how far each is and Cancel.
function clearingList(state, base) {
  const jobs = base.construction.filter((c) => c.type === "clear");
  if (!jobs.length) return "";
  return `<h3 data-tip="${esc("The land being cleared: jobs in the construction queue like the buildings, worked by the builders from the top; the woodcutters (Cut wood) fell the trees, logs, stumps, bushes and fences first, ahead of their trips out for wood. The wood, the scrap and the parts come into the stores when each is done.")}">Clearing <span class="muted small">${jobs.length}</span></h3><div class="card small">${jobs.map((c) => { const pct = Math.round((100 * (c.progress || 0)) / Math.max(1e-9, c.hours)); const who = chopHands(state, base, c); return `<div class="spread" style="margin-top:0.15rem"><span>${esc(c.label)} <span class="muted">${pct}% of ${c.hours}h${getText(c.get) ? ` · ${getText(c.get)}` : ""}${who.length ? ` · ${esc(who.join(", "))} on it` : ""}</span></span><button class="mini" data-action="cb-deploy" data-v="unclear" data-id="${c.id}"${tip("Cancel this clearing")}>Cancel</button></div>`; }).join("")}</div>`;
}

// ---------- the tunnels the dead dug (sim/tunnels.js) ----------
const tunnelWhere = (r) => (r.a ? `from ${r.a[0]}, ${r.a[1]} to ${r.b[0]}, ${r.b[1]}` : "not yet found on the map (it shows once a fight here turns it up)");
const fillPct = (j) => Math.round((100 * (j.progress || 0)) / Math.max(1e-9, j.hours));
// The card of the hole clicked (L.tunnel: the record's id): what it does, and Fill tunnel.
function tunnelCard(state, base, L) {
  const r = L.tunnel != null ? (base.tunnels || []).find((q) => q.id === L.tunnel) : null;
  if (!r) return "";
  const job = fillJobOf(base, r.id), len = r.len || DIG.LEN[0];
  return `<div class="card small bmsel" style="margin-top:0.4rem"><div class="spread"><b>A tunnel the dead dug</b><button data-action="cb-deploy" data-v="tunnelClose" data-tip="Close">✕</button></div>
    <div class="muted">${len} cells under the defences, ${esc(tunnelWhere(r))}. Until it is filled the walls hold less against a horde (−${Math.round(DIG.HOLD * 100)}% a tunnel, at most −${Math.round(DIG.HOLD_MAX * 100)}%) and every fight here starts with it open: the dead crawl through it.</div>
    ${job ? `<div class="small warn" style="margin-top:0.2rem">Queued: ${esc(job.label)} (${fillPct(job)}%)</div>` : ""}
    <div class="cbactions" style="margin-top:0.3rem"><button data-action="cb-deploy" data-v="fillTunnel" data-id="${r.id}"${job ? " disabled" : ""}${tip(job ? "Queued already: the construction queue" : `Queue it first in the construction queue: ${DIG.FILL_BASE} + ${DIG.FILL_PER} work-hours a cell, worked by the builders`)}>Fill tunnel · ${fillHours(len)}h</button></div></div>`;
}
// Every open tunnel at the base: its fill job's progress and Cancel, or Fill tunnel.
function tunnelList(state, base) {
  const list = base.tunnels || [];
  if (!list.length) return "";
  return `<h3 data-tip="${esc("Tunnels the dead dug under the defences (Diggers): open until filled. Each takes some of the walls' hold, and the next horde can crawl through it. Filling is a job in the construction queue, put first, worked by the builders.")}">Tunnels <span class="muted small">${list.length}</span></h3><div class="card small">${list.map((r) => { const j = fillJobOf(base, r.id), len = r.len || DIG.LEN[0]; return `<div class="spread" style="margin-top:0.15rem"><span><a href="#" data-action="cb-deploy" data-v="tunnel" data-id="${r.id}">${len}-cell tunnel</a> <span class="muted">${j ? `filling: ${fillPct(j)}% of ${j.hours}h` : esc(r.a ? "open" : "open, not yet found on the map")}</span></span>${j ? `<button class="mini" data-action="cb-deploy" data-v="unfill" data-id="${j.id}"${tip("Cancel the filling")}>Cancel</button>` : `<button class="mini" data-action="cb-deploy" data-v="fillTunnel" data-id="${r.id}"${tip(`Queue Fill tunnel (${fillHours(len)} work-hours)`)}>Fill · ${fillHours(len)}h</button>`}</div>`; }).join("")}</div>`;
}

// ---------- terraforming (sim/terraform.js, the user's request 2026-10-23) ----------
const signed = (n) => (n >= 0 ? `+${n}` : `−${-n}`);
// A Terrain row of the Build list: Dig or Raise, the shovels (one a person) against the builders, the dirt, the hours.
function terraRow(m, on) {
  const shov = chip({ icon: "⛏", name: `${m.workers} of ${m.builders} builders with shovels`, tone: m.shovels ? "ok" : "bad", t: m.shovels ? `${m.shovels} shovel${m.shovels === 1 ? "" : "s"} here (the armory's and the builders' own): one a person, so ${m.workers} dig at a time` : "No shovel here: the job waits for one (a shovel, an entrenching tool, a pickaxe, or a makeshift shovel crafted from scrap)" });
  const dirt = m.terra === "dig" ? chip({ icon: "🟫", name: `+${TERRA.DIRT} dirt a cell-level`, tone: "ok", t: `Into the heap (${m.dirt} there now): what a hill is raised with` }) : chip({ icon: "🟫", name: "dirt", have: m.dirt, need: TERRA.DIRT, t: `${TERRA.DIRT} dirt a cell-level raised; ${m.dirt} in the heap (dig a hollow for more)` });
  return `<div class="bmrow${on ? " on" : ""}${m.ok ? "" : " off"}"${tip(`${m.name}: ${m.desc}${m.ok ? "" : ` ${m.why}.`}`)}>
    <div class="spread"><span><b>${esc(m.name)}</b> <span class="small muted">an area</span></span><button class="mini${on ? " active" : m.ok ? " primary" : ""}" data-action="cb-deploy" data-v="pickType" data-bt="${on ? "" : m.type}" ${m.ok ? "" : "disabled"}${tip(m.ok ? (on ? "Picked: click one corner of the area on the map, then the opposite one (click here again to put it down)" : "Pick it: click one corner of the area on the map, then the opposite one") : m.why)}>${on ? "Picked" : m.terra === "dig" ? "Dig" : "Raise"}</button></div>
    <div class="bmfoot">${shov}${dirt}${chip({ icon: "⏱", name: `${m.hours}h a cell-level`, t: `${m.hours} work-hour a cell a level, for one builder with a shovel` })}</div>
    ${m.ok || !m.why ? "" : `<div class="small bmwhy">${esc(m.why)}</div>`}</div>`;
}
// The picked order's card: the levels (R), the corner set, who digs, the dirt.
function terraPickCard(state, base, L) {
  const mode = terraModeOf(L.pickType), lv = terraLevels(L.rot), crew = shovelCrew(state, base);
  return `<div class="card small" style="margin-top:0.4rem"><div class="spread"><b>${esc(TERRA_NAME[mode])}</b><span class="muted">${lv} level${lv === 1 ? "" : "s"} ${mode === "raise" ? "up" : "down"}</span></div>
    <div class="muted">${L.anchor ? `First corner at ${L.anchor[0]}, ${L.anchor[1]}: click the opposite corner` : "Click one corner of the area on the map, then the opposite one"} (up to ${TERRA.MAX} × ${TERRA.MAX} cells; R: ${mode === "raise" ? "how high" : "how deep"}, 1 to ${TERRA.LEVELS} levels). Only dirt is worked: the road, paving, rock, trees and what stands are left out (amber), and the slopes are eased so nobody steps more than a level. ${crew.shovels ? `${esc(crewWords(crew))}: one shovel a person.` : `<span class="warn">No shovel here: it waits for one (in the armory or on a builder).</span>`} ${mode === "raise" ? `${Math.floor(base.stock.dirt || 0)} dirt in the heap (${TERRA.DIRT} a cell-level).` : `+${TERRA.DIRT} dirt a cell-level.`}</div>
    <div class="cbactions" style="margin-top:0.3rem"><button data-action="cb-deploy" data-v="rotate" data-tip="${mode === "raise" ? "Higher" : "Deeper"}: 1, 2 or 3 levels (R)">Levels <span class="key">R</span></button><button data-action="cb-deploy" data-v="pickType" data-bt="" data-tip="Put it down (Esc)">Cancel <span class="key">Esc</span></button></div></div>`;
}
// The hover line with the pick up: before the first corner, dirt or not; then the area's plan, or why not.
function terraHover(g) {
  const P = g.terra;
  if (!P) return g.ok ? `<span class="good">Dirt.</span> Click to set one corner of the area (then the opposite one).` : `<span class="danger">${esc(g.why)}.</span>`;
  const R = P.rect, size = `${R.x1 - R.x0 + 1} × ${R.y1 - R.y0 + 1}`;
  if (!P.ok) return `<span class="danger">${esc(P.why)}.</span> <span class="muted">(${size})</span>`;
  const whys = [...new Set(P.out.map((o) => o[2]))].slice(0, 2).map((w) => esc(w.toLowerCase())).join("; ");
  return `<span class="good">${esc(TERRA_NAME[P.mode])}</span> ${size}: ${P.cells.length} cells, ${P.steps} cell-level${P.steps === 1 ? "" : "s"} · ${P.hours} work-hours${P.eta != null ? ` (about ${P.eta} h: ${esc(crewWords(P.crew))})` : P.crew.shovels ? "" : ` · <span class="warn">needs a shovel</span>`} · ${signed(P.dirt)} dirt${P.mode === "raise" ? ` (${P.have} in the heap)` : ""}${P.out.length ? ` · <span class="warn">${P.out.length} left out</span> <span class="muted">(${whys})</span>` : ""}. Click to queue it.`;
}
// The terraforming jobs in the queue: how far, who digs or why it waits, and Cancel (layoutAct unclear).
function terraList(state, base) {
  const jobs = terraJobs(base);
  if (!jobs.length) return "";
  const crew = shovelCrew(state, base);
  return `<h3 data-tip="${esc("Hollows being dug and hills being raised: jobs in the construction queue, worked by the builders with a shovel (one a person), a cell-level at a time. A hollow's dirt comes into the heap as it is dug; a hill takes its dirt as it rises. Cancelled, what is done stays.")}">Terrain <span class="muted small">${jobs.length}</span></h3><div class="card small">${jobs.map((c) => { const why = terraWaits(state, base, c); return `<div class="spread" style="margin-top:0.15rem"><span>${esc(c.label)} <span class="muted">${terraPct(c)}% of ${c.hours}h · ${c.done || 0} of ${c.steps.length} cell-levels · ${signed(c.mode === "raise" ? -TERRA.DIRT : TERRA.DIRT)} dirt each${why ? "" : ` · ${esc(crewWords(crew))}`}</span>${why ? ` <span class="warn">${esc(why)}</span>` : ""}</span><button class="mini" data-action="cb-deploy" data-v="unclear" data-id="${c.id}"${tip(`Cancel ${TERRA_VERB[c.mode].toLowerCase()}: what is done so far stays`)}>Cancel</button></div>`; }).join("")}</div>`;
}

// ---------- actions (main.js) ----------
export const BASEMAP_ACTIONS = {
  "bm-open": (state, ui, d) => {
    const b = baseById(state, Number(d.base));
    if (!b) return;
    const err = openBaseMap(state, b.id, d.key || null);
    if (err) { ui.baseMsg = err; return; }
    ui.mapFrom = { id: b.id, tab: d.tab || "basemap" }; // data-tab: the base window's tab to come back to (the Vehicles tab's Move)
    ui.baseView = null; ui.baseMsg = "";
  },
  "bm-reset": (state, ui, d) => { const b = baseById(state, Number(d.base)); if (b) ui.baseMsg = unplaceItem(state, b, d.key) || "Placed by the game again."; },
};
/**
 * The Move button for a parked car (the base window's Vehicles tab, ui/ui.js): opens the base map with the car picked,
 * its outline under the mouse, to put it on any free cells it fits (in the yard or beyond the wall). "" for a car not
 * parked at this base. Clicked: BASEMAP_ACTIONS["bm-open"] (main.js routes data-action="bm-open" here); closing the
 * map comes back to the Vehicles tab (data-tab).
 * @param {any} state @param {any} base @param {any} v
 */
export function moveCarButton(state, base, v) {
  if (!base || !v || !itemByKey(state, base, `v:${v.id}`)) return "";
  return `<button class="mini" data-action="bm-open" data-base="${base.id}" data-key="v:${v.id}" data-tab="vehicles"${tip("Move it on the base map: click any free cells it fits, in the yard or beyond the wall (R turns it)")}>Move</button>`;
}
// Open the build map (sim/staging.js; a card's button, uiAction "basemap", main.js choice; ui/buildmap.js's alert and
// key): that base's map, nothing picked, its Build list ready; closing it comes back to the base window's tab (the
// Base map tab unless told). The base's ask to be laid out ends (layoutDone). "" when it opened, else why not (the
// base is gone, a battle on): nothing is changed then.
export function openBuildMap(state, ui, baseId, tab = "basemap") {
  const b = baseById(state, Number(baseId));
  if (!b) return "That base is gone: there is no build map to open.";
  const err = openBaseMap(state, b.id);
  if (err) return err;
  layoutDone(state, b.id);
  ui.mapFrom = { id: b.id, tab };
  ui.baseView = null; ui.baseMsg = "";
  return "";
}
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
