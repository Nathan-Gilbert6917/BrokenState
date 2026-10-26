// What the player knows of a tile's points of interest (sim/pois.js), as the tile panel (ui.js renderRight) and the
// map's hover text (render.js tileTooltip) show it: the known POIs by name with how picked over each is, as seen
// now or as last seen (the snapshot's pool), whether anything may still be hidden, when the tile was surveyed, and
// the tile's heat as a team last saw it (pois.js tileHeatEstimate: stale with the days, as the threat).
// Never a count of what is hidden: a tile with a hidden remainder says "possibly more unknown", a tile in the
// unknown zone with nothing known says "POIs unknown" (even when it holds nothing), a known-zone tile with nothing
// known "nothing of note" (its top POI would be known), so the words give away only the zone, which the map shows.
import { LOCATIONS, DANGER_NAMES, siteDanger } from "../sim/data.js";
import { poisOf, poiAt, isSitePoi, poiName, knownPois, morePoisHidden, poiEligible, inKnownZone, poiLootBand, poiKnowledge, permanentSite, tileHeatEstimate } from "../sim/pois.js";
import { LOOT_BANDS } from "../sim/aiscav.js";
import { campSeen } from "../sim/campsite.js"; // a campsite's state as last seen
import { poiPlace } from "../sim/poiraid.js";
import { buildingSpec, siteBuildings } from "../sim/buildingmaps.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * The tile's POIs as known: null when the tile can hold none (water, a city or town centre, a hive).
 * rows: the known POIs in list order ({ i, kind, name, layout (a shop's variant, else ""), site, band: 0–3 or null when never seen, then: as last seen });
 * more: something may still be hidden; unknown: nothing known in the unknown zone; empty: nothing known in the known zone.
 * @param {any} state @param {number} id @param {boolean} isLive @param {any} [snap] the tile's last snapshot when not in view
 */
export function poiView(state, id, isLive, snap = null) {
  const t = state.tiles[id];
  if (!t || !poiEligible(state, t)) return null;
  const known = knownPois(state, t);
  const seen = !isLive && snap && Array.isArray(snap.pois) ? new Map(snap.pois.map((x) => [x.i, x.pool])) : null;
  const rows = known.map((i) => {
    const p = poiAt(t, i);
    const pool = isLive ? undefined : seen && seen.has(i) ? seen.get(i) : null;
    return { i, kind: p.kind, name: poiName(t, i), layout: poiLayout(state, t, i), site: isSitePoi(t, i), band: pool === null ? null : poiLootBand(t, i, pool), then: !isLive && pool != null };
  });
  const more = morePoisHidden(state, t);
  const k = poiKnowledge(state, id);
  return { rows, more, unknown: !rows.length && !inKnownZone(state, t), empty: !rows.length && inKnownZone(state, t), surveyed: k && k.surveyed != null ? k.surveyed : null, looked: k && k.looked != null ? k.looked : null, hasSite: permanentSite(t) };
}

/**
 * The layout variant a known shop or service shows under its name ("Chain drugstore with a drive-through": sim/
 * shopvariants.js, issue #35), its building's own (the spec its raid builds); "" for any other place or an older save.
 * @param {any} state @param {any} t @param {number} i
 */
function poiLayout(state, t, i) {
  if (state.roomsLegacy) return "";
  const sb = isSitePoi(t, i) ? siteBuildings(t) : null;
  const o = sb ? (sb.single ? sb.options[0] : null) : poiPlace(t, i);
  return o ? (buildingSpec(state, t.id, o).layout || {}).name || "" : ""; // only shopvariants.js's specs carry a layout
}

/** The top POI's name for the heading of a bare tile once it is known (a site tile keeps its site's name), else null. @param {any} state @param {number} id */
export function poiHeading(state, id) {
  const t = state.tiles[id];
  if (!t || permanentSite(t) || !poisOf(t).length) return null;
  return knownPois(state, t).includes(0) ? poiName(t, 0) : null;
}

/** A bare tile's known top POI as a site of its kind ({ type, name, zone }: data.js siteDanger, SITE_ZONES), else null. @param {any} state @param {number} id */
export function poiTopLoc(state, id) {
  const name = poiHeading(state, id);
  if (!name) return null;
  const kind = poisOf(state.tiles[id])[0].kind;
  return { type: kind, name, zone: LOCATIONS[kind].cat, poi: true };
}

const bandText = (r) => (r.band == null ? `<span class="muted">not seen yet</span>` : `${LOOT_BANDS[r.band].toLowerCase()}${r.then ? ` <span class="muted">(last seen)</span>` : ""}`);
const stamp = (state, v) => `day ${v}`;

/**
 * The tile panel's Places rows (a .kv grid's cells) for ui.js renderRight: one row per known POI (a site tile's own
 * site is left to its heading), the hidden remainder, the survey stamps. "" when the tile can hold none.
 * @param {any} state @param {number} id @param {boolean} isLive @param {any} [snap]
 */
export function poiPanelRows(state, id, isLive, snap = null) {
  const v = poiView(state, id, isLive, snap);
  if (!v) return "";
  const t = state.tiles[id];
  const out = [];
  for (const r of v.rows) {
    if (r.site) continue;
    const def = LOCATIONS[r.kind];
    const camp = r.kind === "campsite" ? campSeen(state, id, r.i) : null; // sim/campsite.js: abandoned, overrun, raiders (as seen)
    out.push(`<div title="${esc(`${def.name}: danger ${DANGER_NAMES[siteDanger({ type: r.kind, zone: def.cat })].toLowerCase()}. Loot left here against what it held: rich, some, little, picked clean.${r.kind === "campsite" ? " A campsite: who is there (abandoned, overrun by the dead, raiders) as a survey or a visit last saw it." : ""}`)}">${esc(r.name)}${r.layout && r.layout !== r.name ? ` <span class="muted">· ${esc(r.layout)}</span>` : ""}</div><div>${bandText(r)}${r.kind === "campsite" ? ` <span class="muted">· ${camp ? esc(camp.text) : "who is there unknown"}</span>` : ""}</div>`);
  }
  if (v.unknown) out.push(`<div>Places</div><div class="muted">POIs unknown. Survey the tile to find what stands here.</div>`);
  else if (v.empty) out.push(`<div>Places</div><div class="muted">Nothing of note here as far as you know.</div>`);
  else if (!out.length && v.hasSite && !v.more) out.push(`<div>Places</div><div class="muted">Nothing besides the site.</div>`);
  if (v.more && !v.unknown) out.push(`<div>Hidden</div><div class="muted">Possibly more unknown. A survey here may find them.</div>`);
  const heat = tileHeatEstimate(state, id); // pois.js: the tile's heat as a team last saw it (stale with the days, as the threat)
  if (heat) out.push(`<div title="${esc("Tile heat: how many of the dead are about this tile and its places, as your people last saw it (none, low, medium, high, overrun of what the land can hold). Kills bring it down; noise draws the tile's dead in. As last seen: what changed since is not known.")}">Tile heat</div><div>${esc(heat.word)} <span class="muted">(seen ${heat.age < 1 ? "today" : `${Math.floor(heat.age)}d ago`}${heat.stale ? ", stale" : ""})</span></div>`);
  if (v.surveyed != null || v.looked != null) out.push(`<div>Surveyed</div><div class="muted">${v.surveyed != null ? `in full on ${stamp(state, v.surveyed)}` : ""}${v.surveyed != null && v.looked != null && v.looked > v.surveyed ? ", " : ""}${v.looked != null && !(v.surveyed != null && v.looked <= v.surveyed) ? `a quick look on ${stamp(state, v.looked)}` : ""}</div>`);
  return out.join("");
}

/**
 * The hover text's lines (HTML) on the tile's POIs: "Places: House (rich), Shed (picked clean)", the remainder.
 * @param {any} state @param {number} id @param {boolean} isLive @param {any} [snap] @returns {string[]}
 */
export function poiTipLines(state, id, isLive, snap = null) {
  const v = poiView(state, id, isLive, snap);
  if (!v) return [];
  const lines = [];
  const named = v.rows.filter((r) => !r.site);
  if (named.length) lines.push(`<span class="muted">${v.hasSite ? "Also here" : "Places"}: ${named.map((r) => `${esc(r.name)}${r.band == null ? "" : ` (${LOOT_BANDS[r.band].toLowerCase()}${r.then ? ", then" : ""})`}`).join(", ")}</span>`);
  if (v.unknown) lines.push(`<span class="muted">POIs unknown: survey the tile</span>`);
  else if (v.more) lines.push(`<span class="muted">Possibly more unknown</span>`);
  return lines;
}
