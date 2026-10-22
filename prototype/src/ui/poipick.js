// The POI dialogue: which place on the tile a scavenge / raid goes into (sim/poiraid.js poiPickCard, drawn here in
// place of the plain card). One row per known place: its kind, the visit history, how picked over it is, what the
// container ledger says (what you opened and left there, looted by others since), whether another group is in it
// right now, and the threat you make of it (a word with skulls, the look's age, "stale" past two weeks; "threat
// unknown" until a survey or a visit). Never a count of what is still hidden: "possibly more unknown" at most. The
// buttons are the card's own choices (data-action="choice"), so main.js handles them as any card's. A site with
// several buildings (a farm, a military base) is one row with a button per building and the street under it. Each row
// says how far it is on foot from where the team stands (sim/poiwalk.js: 5–20 minutes; "you are here").
//
// The screen (the user's request 2026-10-22): the tile drawn large (ui/poimap.js) with the places where they stand,
// the team's dot on the edge it came in by and the way on foot to each with its minutes; a place is picked on the
// map (data-action "poisel", kept on the card: card.poiPick.sel) or in the list of places, a side panel folded away
// by default (its button, data-action "poilist": card.poiPick.list). The picked place's details sit beside the map
// with the button to walk there and raid it (a site's: one per building and the street). The ways off the tile are
// arrows on its sides (the card's exit choices) and "Leave for another tile…" (the State Map's move mode).
//
// The walk itself (tileViewModal, the user's request 2026-10-22: "In the POI map show the team move to the POI
// selected when you unpause"): once a place or a side is picked, the same map stays up as the tile view (ui.tileView,
// opened by main.js's choice; it never stops the clock) with the team's dot walking the route as the minutes go by
// (tileViewFrame, every frame), a Run / Pause button, Stop and Close. It goes when the walk does: the raid's battle
// screen, or the team off the tile.
import { partyMembers, tileLabel, clockFrac } from "../sim/parties.js";
import { poiRows, poiRowText } from "../sim/poiraid.js";
import { walkMap, walkPos } from "../sim/poiwalk.js";
import { tileMapBg, poiMapSvg, PM_W, PM_H, toMap } from "./poimap.js";
import { morePoisHidden, tileHeatEstimate } from "../sim/pois.js";
import { LOCATIONS } from "../sim/data.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const BAND_COLOR = ["var(--good)", "var(--text)", "var(--warn)", "var(--danger)"];
const THREAT_COLOR = ["var(--good)", "var(--text)", "var(--warn)", "var(--danger)"];

// The threat cell: the word with skulls and the look's age; muted and marked stale when old; "threat unknown" without a look.
export function threatHtml(est) {
  if (!est) return `<span class="muted"${tip("Nobody has sized this place up: a Survey of the tile (8h) or a visit records a threat estimate.")}>threat unknown</span>`;
  const when = `${est.src === "survey" ? "surveyed" : "seen"} ${est.age < 1 ? "today" : `${Math.floor(est.age)}d ago`}`;
  return `<span style="color:${THREAT_COLOR[est.band]}"${tip(`What your people made of it when they looked (${when}): the kind of place, the infection here, how stirred up the tile is (its heat), hive land. An estimate: the error grows with the days since (${Math.round(est.err * 100)}% now), so an old look says less. True threat decides the fight.`)}>${esc(est.word)}${est.skulls ? ` ${est.skulls}` : ""}</span> <span class="muted small">(${when}${est.stale ? ", stale" : ""})</span>`;
}

// The tile's heat as last seen (sim/pois.js tileHeatEstimate): a line over the rows, or "" without a look.
export function heatLine(state, tile) {
  const h = tileHeatEstimate(state, tile);
  if (!h) return "";
  return `<div class="text small"><span${tip("Tile heat: how stirred up this tile is by raids on its places (going in, coming out, the noise and shots; others' raids too). It fades about 10% a day. A hot tile draws more of the dead, and when very hot a horde or a wandering band may turn up. As last seen: new heat since is not known.")}>Tile heat: <span style="color:${THREAT_COLOR[h.band]}">${esc(h.word)}</span></span> <span class="muted">(seen ${h.age < 1 ? "today" : `${Math.floor(h.age)}d ago`}${h.stale ? ", stale" : ""})</span></div>`;
}

// The card's screen: the tile map, the picked place's details and its buttons, the list of places folded at the side.
export function poiPickModal(state, card) {
  const p = state.parties.find((x) => x.id === card.partyId);
  const tile = card.poiPick.tile, t = state.tiles[tile];
  const rows = p ? poiRows(state, p, tile) : [];
  const byPoi = new Map(card.choices.map((c, i) => [c.poi, i]).filter(([poi, i]) => poi != null && card.choices[i].building == null));
  const byBuilding = (poi) => card.choices.map((c, i) => ({ c, i })).filter(({ c }) => c.poi === poi && c.building != null);
  const more = p ? morePoisHidden(state, tile, p) : false;
  const who = p ? partyMembers(state, p).map((s) => s.name.split(" ")[0]).join(", ") : "";
  const sel = rows.some((r) => r.i === card.poiPick.sel) ? card.poiPick.sel : null;
  const open = !!card.poiPick.list;
  const likely = (r) => { const def = LOCATIONS[r.kind]; return `${def ? def.name : r.kind}: likely ${Object.keys((def && def.loot) || {}).slice(0, 4).join(", ") || "little"}.`; };
  const walk = (r) => `<span class="${r.mins ? "" : "muted"}"${tip(r.mins ? "Minutes on foot from where the team stands on the tile (the place it last went into, else the edge it came onto the tile by), over the ground between: brush, slopes, rubble, a road. Picking it starts the walk when the clock runs, then the raid." : "The team stands at this place: it goes straight in.")}>${r.mins ? `🚶 ${r.mins} min` : "📍 You are here"}</span>`;
  // What is known of a place: its visits and threat, then the campsite, the containers, another group in it now.
  const facts = (r) => `<span class="muted">${esc(r.visits)}</span> · ${threatHtml(r.threat)}${r.camp ? `<br><span${tip("A campsite: abandoned (a few of the dead about, the best loot left), overrun (a pack of the dead among the tents) or an active raider camp (a band round a lit fire; at night some asleep in the tents). As your people last saw it: a survey or a visit looks again. Tents can be taken down and carried off.")}>${esc(r.camp)}</span>` : ""}${r.cont ? `<br><span class="muted">${esc(r.cont)}</span>` : ""}${r.raiding ? `<br><span class="danger">Another group is raiding it right now.</span>` : ""}`;
  const bandHtml = (r) => `<span style="color:${BAND_COLOR[r.band]}"${tip("What is left against what the place held untouched: rich (60%+), some (30%+), little (10%+), picked clean. Each place has its own loot, and nothing grows back.")}>${esc(r.bandName)}</span>`;
  // The map.
  const wm = p ? walkMap(state, p, rows.map((r) => r.i), tile) : { from: { spot: [0, 0], poi: null, edge: null }, places: [] };
  const bg = tileMapBg(state, t, [...wm.places.map((x) => x.spot), wm.from.spot]);
  const tipOf = (i) => { const r = rows.find((x) => x.i === i); return r ? `${r.name}: ${poiRowText(r)}. ${likely(r)} Click to pick it.` : ""; };
  const exits = card.choices.map((c, i) => ({ c, i })).filter(({ c }) => c.exit != null).map(({ c, i }) => ({ via: c.exit, mins: c.mins, i, tip: `${c.label}: ${c.hint}` }));
  const map = `<div class="pm-map" style="width:${PM_W}px;height:${PM_H}px${bg ? `;background-image:url(${bg})` : ""}">${poiMapSvg(state, t, wm, rows, sel, tipOf, { exits })}</div>`;
  // The picked place: what is known of it and the way in.
  const r = rows.find((x) => x.i === sel);
  let detail;
  if (!r) detail = `<div class="pm-hint muted">Pick a place on the map${rows.length > 1 ? " (or in the list of places)" : ""} to see what is known of it and send the team there. The dashed lines are the ways on foot from where your team stands, with their minutes.</div>`;
  else {
    const subs = byBuilding(r.i);
    const go = (i, label, hint) => `<button data-action="choice" data-i="${i}" class="pm-go"${tip(hint)}>${esc(label)}</button>`;
    const verb = r.mins ? `Walk there (${r.mins} min) and raid it` : "Go in";
    const btns = !subs.length ? (byPoi.has(r.i) ? go(byPoi.get(r.i), verb, `${likely(r)} ${r.mins ? "The team walks there when you run the clock, then the raid starts." : "The team is here: the raid starts at once."}`) : "")
      : subs.map(({ c, i }) => {
        const o = (r.buildings || []).find((x) => x.id === c.building) || {};
        const size = [o.size, o.rooms ? `${o.rooms} rooms` : "", o.map ? `map ${o.map}` : ""].filter(Boolean).join(", ");
        return `<button data-action="choice" data-i="${i}" class="small pm-go"${tip(o.hint)}>${esc(o.id === "street" ? "The street" : o.name || c.building)}${size ? ` <span class="muted">${esc(size)}</span>` : ""}</button>`;
      }).join("");
    detail = `<div class="pm-detail"><div class="spread"><b>${esc(r.name)}</b>${bandHtml(r)}</div>
      <div class="small">${walk(r)}${r.desc ? ` · <span class="muted">${esc(r.desc)}</span>` : ""}</div>
      <div class="small" style="margin-top:4px">${facts(r)}</div>
      <div class="small muted" style="margin-top:4px">${esc(likely(r))}</div>
      ${subs.length ? `<div class="small" style="margin-top:6px">Several buildings stand here: ${r.mins ? `walk there (${r.mins} min) and ` : ""}go into one, or the street around them.</div>` : ""}
      <div class="pm-gos">${btns}</div></div>`;
  }
  // The list of places: folded away by default, a button to open it.
  const rowHtml = (x) => `<button data-action="poisel" data-poi="${x.i}" class="poirow${x.i === sel ? " on" : ""}" style="display:block;width:100%;text-align:left"${tip(likely(x))}>
      <div class="spread"><b>${esc(x.name)}</b>${walk(x)}${bandHtml(x)}</div><div class="small">${facts(x)}</div></button>`;
  const list = open
    ? `<aside class="pm-list open"><button data-action="poilist" class="pm-listbtn"${tip("Fold the list of places away")}>▸ Places (${rows.length})</button><div class="pm-rows">${rows.map(rowHtml).join("")}</div></aside>`
    : `<aside class="pm-list"><button data-action="poilist" class="pm-listbtn pm-tab"${tip("Open the list of places: every place known here with its minutes, what is left, its visits and threat")}>◂ Places (${rows.length})</button></aside>`;
  const rest = card.choices.map((c, i) => ({ c, i })).filter(({ c }) => c.poi == null && c.exit == null);
  return `<div class="box wide poipick">
    <h1>${esc(card.title)}</h1>
    <div class="where">${esc(tileLabel(state, tile))}${who ? ` · ${esc(who)}` : ""}</div>
    ${heatLine(state, tile)}
    <div class="text small">${rows.length === 1 ? "One place is known here" : `${rows.length} places are known here`}${more ? `, <span${tip("Something here may still be off your map: a Survey of the tile (8h) finds what hides, a Quick look (2h) has a chance at each. Never a count.")}>possibly more unknown</span>` : ""}. The team goes into one at a time, walking there first: pick a place, then run the clock. The arrows on the sides leave the tile that way.</div>
    <div class="pm-body">${map}<div class="pm-side">${detail}</div>${list}</div>
    <div class="choices">${rest.map(({ c, i }) => `<button data-action="choice" data-i="${i}"${tip(c.hint)}>${esc(c.label)}${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ""}</button>`).join("")}</div>
  </div>`;
}

// ---------- the tile view: the walk under way ----------
// The team the tile view follows, while it walks (a place or out to an edge), else null.
function viewWalker(state, ui) {
  const v = ui.tileView;
  const p = v ? state.parties.find((x) => x.id === v.partyId) : null;
  return p && p.phase === "task" && p.task && p.task.type === "poiwalk" ? p : null;
}
/** Is the tile view up (main.js and ui/ui.js pickModal)? Clears it once the walk is over. @param {any} state @param {any} ui */
export function tileViewUp(state, ui) {
  if (!ui.tileView) return false;
  if (!viewWalker(state, ui)) { ui.tileView = null; return false; }
  return true;
}
/** The tile view: the tile map with the team walking its route. @param {any} state @param {any} ui */
export function tileViewModal(state, ui) {
  const p = viewWalker(state, ui);
  if (!p) return "";
  const tile = p.path[p.idx], t = state.tiles[tile], w = p.task;
  const rows = poiRows(state, p, tile);
  const wm = walkMap(state, { ...p, atPoi: undefined }, rows.map((r) => r.i), tile);
  const bg = tileMapBg(state, t, [...wm.places.map((x) => x.spot), wm.from.spot]);
  const pos = walkPos(state, p, clockFrac(state));
  const tipOf = (i) => { const r = rows.find((x) => x.i === i); return r ? `${r.name}: ${r.bandName.toLowerCase()}; ${r.visits}` : ""; };
  const what = w.exit ? `Leaving ${tileLabel(state, tile)}: walking to its edge, then on to ${w.name}` : `Walking to ${w.name}`;
  const then = w.exit ? "Then the team sets off across the map." : "Then the raid starts there.";
  const running = ui.speed > 0;
  return `<div class="box wide poipick tileview">
    <h1>${esc(what)}</h1>
    <div class="where">${esc(tileLabel(state, tile))} · ${esc(partyMembers(state, p).map((s) => s.name.split(" ")[0]).join(", "))}</div>
    <div class="pm-body"><div class="pm-map" style="width:${PM_W}px;height:${PM_H}px${bg ? `;background-image:url(${bg})` : ""}">${poiMapSvg(state, t, wm, rows, null, tipOf, { walk: pos })}</div>
      <div class="pm-side"><div class="pm-detail">
        <div class="big"><span id="pm-left">${pos ? pos.mins : w.mins}</span> min left <span class="muted small">of ${w.mins}</span></div>
        <div class="pm-bar"><div id="pm-bar" style="width:${Math.round((pos ? pos.u : 0) * 100)}%"></div></div>
        <div class="small">${running ? "On the way." : "The clock is stopped: run it and the team walks."} ${esc(then)}</div>
        <div class="pm-gos">
          ${running ? `<button data-action="speed" data-speed="0"${tip("Pause (Space)")}>⏸ Pause</button>` : `<button class="primary" data-action="speed" data-speed="${ui.lastSpeed || 1}"${tip(`Run at ${ui.lastSpeed || 1}× (Space)`)}>▶ Run</button>`}
          <button data-action="tv-stop"${tip("Stop the walk: the team stays where it was and waits for orders.")}>✋ Stop the walk</button>
          <button data-action="tv-close"${tip("Close this view (Esc): the walk goes on; the State Map shows the team on its tile.")}>Close</button>
        </div></div></div></div>
  </div>`;
}
/** Every frame (main.js): the team's dot and the minutes left, moved as the clock's minutes pass. @param {any} state @param {any} ui */
export function tileViewFrame(state, ui) {
  if (!ui.tileView || typeof document === "undefined") return;
  const p = viewWalker(state, ui), el = document.getElementById("pm-team");
  if (!p || !el) return;
  const pos = walkPos(state, p, clockFrac(state));
  if (!pos) return;
  const [x, y] = toMap([pos.x, pos.y]);
  el.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)})`);
  const left = document.getElementById("pm-left"), bar = document.getElementById("pm-bar");
  if (left && left.textContent !== String(pos.mins)) left.textContent = String(pos.mins);
  if (bar) bar.style.width = `${Math.round(pos.u * 100)}%`;
}
