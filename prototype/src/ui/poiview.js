// What the player knows of a tile's points of interest (sim/pois.js), as the tile panel (ui.js renderRight) and the
// map's hover text (render.js tileTooltip) show it: the known POIs by name with how picked over each is, as seen
// now or as last seen (the snapshot's pool), whether anything may still be hidden, and when the tile was surveyed.
// Never a count of what is hidden: a tile with a hidden remainder says "possibly more unknown", a tile in the
// unknown zone with nothing known says "POIs unknown" (even when it holds nothing), a known-zone tile with nothing
// known "nothing of note" (its top POI would be known), so the words give away only the zone, which the map shows.
import { LOCATIONS, DANGER_NAMES, siteDanger } from "../sim/data.js";
import { poisOf, poiAt, isSitePoi, poiName, knownPois, morePoisHidden, poiEligible, inKnownZone, poiLootBand, poiKnowledge, permanentSite } from "../sim/pois.js";
import { LOOT_BANDS } from "../sim/aiscav.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * The tile's POIs as known: null when the tile can hold none (water, a city or town centre, a hive).
 * rows: the known POIs in list order ({ i, kind, name, site, band: 0–3 or null when never seen, then: as last seen });
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
    return { i, kind: p.kind, name: poiName(t, i), site: isSitePoi(t, i), band: pool === null ? null : poiLootBand(t, i, pool), then: !isLive && pool != null };
  });
  const more = morePoisHidden(state, t);
  const k = poiKnowledge(state, id);
  return { rows, more, unknown: !rows.length && !inKnownZone(state, t), empty: !rows.length && inKnownZone(state, t), surveyed: k && k.surveyed != null ? k.surveyed : null, looked: k && k.looked != null ? k.looked : null, hasSite: permanentSite(t) };
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
    out.push(`<div title="${esc(`${def.name}: danger ${DANGER_NAMES[siteDanger({ type: r.kind, zone: def.cat })].toLowerCase()}. Loot left here against what it held: rich, some, little, picked clean.`)}">${esc(r.name)}</div><div>${bandText(r)}</div>`);
  }
  if (v.unknown) out.push(`<div>Places</div><div class="muted">POIs unknown. Survey the tile to find what stands here.</div>`);
  else if (v.empty) out.push(`<div>Places</div><div class="muted">Nothing of note here as far as you know.</div>`);
  else if (!out.length && v.hasSite && !v.more) out.push(`<div>Places</div><div class="muted">Nothing besides the site.</div>`);
  if (v.more && !v.unknown) out.push(`<div>Hidden</div><div class="muted">Possibly more unknown. A survey here may find them.</div>`);
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
