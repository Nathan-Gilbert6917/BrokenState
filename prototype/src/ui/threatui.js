// Knowing the threat level on screen (the heat epic #64 §12, issue #67; sim/threatknow.js): the lines the tile panel
// (ui/poiview.js poiPanelRows), the POI dialogue (ui/poipick.js) and the map's hover text show of the dead and the
// raiders on a tile and in a place, as your people last saw them or live while they are there:
//   "The dead here: medium ☠☠ (2 days ago)"   "Raiders: low ☠ (live)"
// and the State Map's "The dead on the land" layer (drawThreatOverlay: a wash on each known tile by its band).
import { tileThreatEstimate, poiDeadEstimate, threatOverlay, earshotEstimate, bandText, THREATKNOW } from "../sim/threatknow.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
// A band's colour (none … overrun).
export const BAND_COLOR = ["var(--good)", "var(--text)", "var(--warn)", "var(--danger)", "var(--danger)"];
const word = (b) => `<span style="color:${BAND_COLOR[b.band] || "var(--text)"}${b.band >= 4 ? ";font-weight:700" : ""}">${esc(bandText(b))}</span>`;
const when = (e) => `<span class="muted">(${esc(e.when)})</span>`;

export const TILE_TIP = "How many of the dead and of the raiders are about this tile and its places against what the land can hold: none, low, medium, high, overrun (a skull a band). A full Survey (8h) gives an approximate level, a look at a place a rougher one; while a team of yours or a base is on the tile it is live. After you leave it is as last seen: what changed since is not known, and the guess gets rougher with the days (stale after two weeks). Kills bring it down; noise draws the tile's dead in, and the places refill from it.";
export const POI_TIP = "The dead and the raiders in this place as your people last saw them: a full Survey of the tile gives each place it knows an estimate; a Quick look or a visit a rougher, general one. Live while a team of yours or a base is on the tile.";

/** The tile panel's rows (a .kv grid's cells): "The dead here" and "Raiders", or "threat unknown". @param {any} state @param {number} id */
export function tileThreatRows(state, id) {
  const e = tileThreatEstimate(state, id);
  if (!e) return `<div${tip(TILE_TIP)}>The dead here</div><div class="muted">threat unknown: survey the tile</div>`;
  return `<div${tip(TILE_TIP)}>The dead here</div><div>${word(e.dead)} ${when(e)}</div>`
    + (e.raiders ? `<div${tip(TILE_TIP)}>Raiders</div><div>${word(e.raiders)} ${when(e)}</div>` : "");
}
/** The POI dialogue's line over the places: "The dead here: medium ☠☠ (2 days ago) · Raiders: low ☠", or "" without a look. @param {any} state @param {number} tile */
export function tileThreatLine(state, tile) {
  const e = tileThreatEstimate(state, tile);
  if (!e) return "";
  return `<div class="text small"><span${tip(TILE_TIP)}>The dead here: ${word(e.dead)}${e.raiders ? ` · Raiders: ${word(e.raiders)}` : ""}</span> ${when(e)}</div>`;
}
/** A place's estimate in a row: "The dead: low ☠ · raiders: none (today)", or "" without one. @param {any} est poiDeadEstimate's */
export function poiThreatCell(est) {
  if (!est) return "";
  return `<span${tip(POI_TIP)}>The dead: ${word(est.dead)}${est.raiders && est.raiders.band > 0 ? ` · raiders: ${word(est.raiders)}` : ""}</span> <span class="muted small">(${esc(est.when)})</span>`;
}
/** The same as plain text (a card's hint, the hover text). @param {any} state @param {number} tile @param {number} i */
export function poiThreatPlain(state, tile, i) {
  const e = poiDeadEstimate(state, tile, i);
  return e ? `the dead ${bandText(e.dead)}${e.raiders.band > 0 ? `, raiders ${bandText(e.raiders)}` : ""} (${e.when})` : "";
}
/** The map's hover line on a known tile: "The dead: medium ☠☠ · raiders low ☠ (live)", or "". @param {any} state @param {number} id */
export function tileThreatTip(state, id) {
  const e = tileThreatEstimate(state, id);
  if (!e) return "";
  return `<span style="color:${BAND_COLOR[e.dead.band]}">The dead: ${esc(bandText(e.dead))}${e.raiders ? ` · raiders ${esc(bandText(e.raiders))}` : ""}</span> <span class="muted">(${esc(e.when)})</span>`;
}

/**
 * The State Map's "The dead on the land" layer (ui/render.js, under the sites): a wash in its band's colour over each
 * tile with an estimate (known tiles only: sim/threatknow.js threatOverlay), a dashed edge on the live ones, the skulls
 * written when zoomed in. Cached per hour. Returns how many tiles it drew.
 * @param {CanvasRenderingContext2D} ctx @param {any} state @param {{ G: any, inView: (id: number) => boolean, hexPath: (x: number, y: number, s: number) => void, hex: number, zoom: number }} o
 */
export function drawThreatOverlay(ctx, state, o) {
  const list = overlayOf(state);
  let n = 0;
  ctx.save();
  for (const x of list) {
    if (!o.inView(x.tile)) continue;
    const px = o.G.x[x.tile], py = o.G.y[x.tile];
    ctx.beginPath();
    o.hexPath(px, py, o.hex);
    ctx.fillStyle = THREATKNOW.COLORS[x.level] || THREATKNOW.COLORS[0];
    ctx.globalAlpha = x.stale ? 0.55 : 1;
    ctx.fill();
    if (x.live) { ctx.setLineDash([3, 3]); ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
    if (o.zoom > 1.2 && x.level > 0) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(240,230,220,0.85)";
      ctx.font = `${Math.round(o.hex * 0.42)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(THREATKNOW.SKULL.repeat(x.level), px, py - o.hex * 0.45);
    }
    n++;
  }
  ctx.restore();
  return n;
}
const memo = { state: null, hour: NaN, n: -1, list: [] };
function overlayOf(state) {
  let n = (state.parties || []).length * 7 + (state.bases || []).length; // a stamp written within the hour changes this too
  for (const k of Object.values(state.poiKnow || {})) if (k && k.threat) n += 1 + k.threat.h;
  if (memo.state !== state || memo.hour !== state.hour || memo.n !== n) Object.assign(memo, { state, hour: state.hour, n, list: threatOverlay(state) });
  return memo.list;
}

/**
 * The raid strip's chip (ui/combat.js): "Earshot: ~12 more on this tile", the open ground's dead a fight here can still
 * draw in as your people make it out (sim/threatknow.js earshotEstimate, less those already come), and a warning when
 * the selected survivor's weapon is loud. "" without an estimate.
 * @param {any} state @param {number} tile @param {number} drawn @param {boolean} loud
 */
export function earshotChip(state, tile, drawn, loud) {
  const e = tile != null ? earshotEstimate(state, tile, drawn) : null;
  if (!e) return "";
  const why = `The dead of this tile's open ground within earshot of the fight, as your people make it out: a rough number (the tile's level ${e.live ? "seen live" : "as last seen"}, less the ${drawn || 0} already come). Noise draws them in: a gunshot, a car alarm, a thrown bottle, breaking glass. Quiet kills (blades, bows, a suppressor) draw none. Each one killed is one fewer on the tile.`;
  const warn = loud && e.n > 0 ? ` <span class="warn" data-tip="${esc("The selected survivor's weapon is loud: a shot here draws the tile's dead in.")}">⚠ a shot draws them</span>` : "";
  return `<span class="ct-sub" data-tip="${esc(why)}">Earshot: <b>${esc(e.text)}</b> more on this tile</span>${warn}`;
}
