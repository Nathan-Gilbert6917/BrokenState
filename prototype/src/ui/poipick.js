// The POI dialogue: which place on the tile a scavenge / raid goes into (sim/poiraid.js poiPickCard, drawn here in
// place of the plain card). One row per known place: its kind, the visit history, how picked over it is, what the
// container ledger says (what you opened and left there, looted by others since), whether another group is in it
// right now, and the threat you make of it (a word with skulls, the look's age, "stale" past two weeks; "threat
// unknown" until a survey or a visit). Never a count of what is still hidden: "possibly more unknown" at most. The
// buttons are the card's own choices (data-action="choice"), so main.js handles them as any card's. A site with
// several buildings (a farm, a military base) is one row with a button per building and the street under it.
import { partyMembers, tileLabel } from "../sim/parties.js";
import { poiRows } from "../sim/poiraid.js";
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

// The card's screen: a row per known place, each a button of the card's choices (the crawl and "Not now" after them).
export function poiPickModal(state, card) {
  const p = state.parties.find((x) => x.id === card.partyId);
  const tile = card.poiPick.tile;
  const rows = p ? poiRows(state, p, tile) : [];
  const byPoi = new Map(card.choices.map((c, i) => [c.poi, i]).filter(([poi, i]) => poi != null && card.choices[i].building == null));
  const byBuilding = (poi) => card.choices.map((c, i) => ({ c, i })).filter(({ c }) => c.poi === poi && c.building != null);
  const more = p ? morePoisHidden(state, tile, p) : false;
  const who = p ? partyMembers(state, p).map((s) => s.name.split(" ")[0]).join(", ") : "";
  const rowHtml = (r) => {
    const def = LOCATIONS[r.kind];
    const likely = `${def ? def.name : r.kind}: likely ${Object.keys((def && def.loot) || {}).slice(0, 4).join(", ") || "little"}.`;
    const body = `<div class="spread"><b>${esc(r.name)}</b><span style="color:${BAND_COLOR[r.band]}"${tip("What is left against what the place held untouched: rich (60%+), some (30%+), little (10%+), picked clean. Each place has its own loot, and nothing grows back.")}>${esc(r.bandName)}</span></div>
      <div class="small"><span class="muted">${esc(r.visits)}</span> · ${threatHtml(r.threat)}${r.camp ? `<br><span${tip("A campsite: abandoned (a few of the dead about, the best loot left), overrun (a pack of the dead among the tents) or an active raider camp (a band round a lit fire; at night some asleep in the tents). As your people last saw it: a survey or a visit looks again. Tents can be taken down and carried off.")}>${esc(r.camp)}</span>` : ""}${r.cont ? `<br><span class="muted">${esc(r.cont)}</span>` : ""}${r.raiding ? `<br><span class="danger">Another group is raiding it right now.</span>` : ""}</div>`;
    const subs = byBuilding(r.i);
    if (!subs.length) return `<button data-action="choice" data-i="${byPoi.get(r.i)}" class="poirow" style="display:block;width:100%;text-align:left"${tip(likely)}>${body}</button>`;
    // The site's buildings: the place's line once, a button per building (what it likely holds, its size) and the street.
    const sub = ({ c, i }) => {
      const o = (r.buildings || []).find((x) => x.id === c.building) || {};
      const size = [o.size, o.rooms ? `${o.rooms} rooms` : "", o.map ? `map ${o.map}` : ""].filter(Boolean).join(", ");
      return `<button data-action="choice" data-i="${i}" class="small" style="text-align:left"${tip(o.hint)}>${esc(o.id === "street" ? "The street" : o.name || c.building)}${size ? ` <span class="muted">${esc(size)}</span>` : ""}</button>`;
    };
    return `<div class="poirow"${tip(`${likely} Several buildings stand here: pick the one to go into, or the street around them.`)}>${body}
      <div class="poibldg" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${subs.map(sub).join("")}</div>
    </div>`;
  };
  const rest = card.choices.map((c, i) => ({ c, i })).filter(({ c }) => c.poi == null);
  return `<div class="box">
    <h1>${esc(card.title)}</h1>
    <div class="where">${esc(tileLabel(state, tile))}${who ? ` · ${esc(who)}` : ""}</div>
    ${heatLine(state, tile)}
    <div class="text small">${rows.length === 1 ? "One place is known here" : `${rows.length} places are known here`}${more ? `, <span${tip("Something here may still be off your map: a Survey of the tile (8h) finds what hides, a Quick look (2h) has a chance at each. Never a count.")}>possibly more unknown</span>` : ""}. The team goes into one at a time.</div>
    <div class="choices">${rows.map(rowHtml).join("")}
      ${rest.map(({ c, i }) => `<button data-action="choice" data-i="${i}"${tip(c.hint)}>${esc(c.label)}${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ""}</button>`).join("")}</div>
  </div>`;
}
