// The POI dialogue's tile map (ui/poipick.js): the tile being raided drawn large as one hexagon, with its known
// places where they stand (sim/poiwalk.js poiSpot), the team where it stands (the edge it came onto the tile by,
// the place it last went into, or the middle) and the way on foot to each place over the tile's weighted map
// (sim/poiwalk.js walkMap: the route and its minutes).
//
// - The ground (tileMapBg): the terrain's colour with a little mottling, the water along the sides that touch a
//   river or lake (reeds on the bank), the roads from the middle to the sides they lead out by (tile.roadLinks), and
//   the State Map's own decals scattered thick (ui/terraindeco.js drawDecal: trees and pines in a forest, crop rows,
//   fences and hay on a farm, mounds and rocks in the hills, peaks on a mountain, houses, yards and cars in the
//   suburbs, blocks, ruins and rubble in the city), kept off the roads, the places and the team's spot. No grid:
//   one picture of the land. Placed by the tile's own dice (never state.rng); painted once per tile, season and snow
//   into a canvas kept as a data URL.
// - Over it (poiMapSvg): every route as a dashed line with its minutes at the middle (where that is clear of the
//   places), the team's dot ("You"), and
//   each place as its map sprite (ui/mapsprites.js poiSpriteCanvas: its kind, its franchise, faded by how picked
//   over it is) with its name and minutes under it. A place is a button (data-action "poisel"): it selects it, and
//   the dialogue shows what is known of it and the button to walk there. Hovering one lights its route.
import { TERRAIN } from "../sim/data.js";
import { hash01 } from "../sim/skills.js";
import { season } from "../sim/weather.js";
import { poiAt } from "../sim/pois.js";
import { drawDecal, decalSize, SEASON_LOOK } from "./terraindeco.js";
import { poiSpriteCanvas } from "./mapsprites.js";

export const PM = { R: 190, PAD: 14, DPR: 2, DECAL: 2 }; // hex radius and margin (css px), canvas px per css px, css px a decal px
const SQ3 = Math.sqrt(3);
export const PM_W = Math.round(SQ3 * PM.R + PM.PAD * 2), PM_H = Math.round(2 * PM.R + PM.PAD * 2);
const CX = PM_W / 2, CY = PM_H / 2;
/** A spot in hex radii to css px on the map. @param {[number, number]} s @returns {[number, number]} */
export const toMap = ([x, y]) => [CX + x * PM.R, CY + y * PM.R];
const hexCorners = (r) => Array.from({ length: 6 }, (_, k) => { const a = (Math.PI / 180) * (60 * k - 30); return [CX + Math.cos(a) * r, CY + Math.sin(a) * r]; });
const inHex = (x, y, r) => { const ax = Math.abs(x - CX), ay = Math.abs(y - CY); return ax <= (SQ3 / 2) * r && ay <= r - ax / SQ3; };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rgb = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
const shade = (hex, f, a = 1) => { const [r, g, b] = rgb(hex); return `rgba(${Math.round(Math.min(255, r * f))},${Math.round(Math.min(255, g * f))},${Math.round(Math.min(255, b * f))},${a})`; };
// Distance from (x, y) to the segment a-b.
const segDist = (x, y, [ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, u = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0; return Math.hypot(x - ax - dx * u, y - ay - dy * u); };

// What dresses each terrain: [decal set, how many]. Farmland round a farm or a barn grows crops.
const DRESS = {
  forest: [["tree", 34], ["pine", 20], ["bush", 9], ["deadtree", 2]],
  plains: [["tuft", 20], ["bush", 7], ["tree", 6], ["fence", 3], ["crops", 2], ["hay", 2]],
  farm: [["crops", 7], ["fence", 5], ["hay", 6], ["tuft", 14], ["tree", 4], ["bush", 3]],
  hills: [["mound", 9], ["rock", 12], ["tuft", 12], ["tree", 5], ["pine", 4]],
  mountain: [["peak", 7], ["rock", 16], ["pine", 5], ["tuft", 4]],
  suburb: [["house", 11], ["burnt", 3], ["tree", 11], ["bush", 5], ["fence", 6], ["car", 3], ["wreck", 2]],
  city: [["building", 11], ["ruin", 4], ["rubble", 9], ["wreck", 4], ["car", 3]],
};
const FARMY = new Set(["farm", "barn", "farmstand", "ranch"]);

// The tile's dice: a small stream from the world seed and the tile.
function dice(state, t, salt) { let k = 0; return () => hash01(state.seed, "poimap", t.id, salt, k++); }

// The sides of the tile: [neighbour, the side's middle in css px, its direction] for each neighbour.
function sides(state, t) {
  const [ax, ay] = state.grid.toPixel(t.id, 1);
  return state.grid.neighbors(t.id).map((m) => { const [bx, by] = state.grid.toPixel(m, 1), d = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / d, uy = (by - ay) / d; return { m, ux, uy, mid: [CX + ux * PM.R * (SQ3 / 2), CY + uy * PM.R * (SQ3 / 2)] }; });
}

const bgCache = new Map();
/** The ground of tile t as a data URL ("" headless). spots: the places' and the team's spots (hex radii), kept clear. @param {any} state @param {any} t @param {[number, number][]} spots */
export function tileMapBg(state, t, spots = []) {
  const sea = season(state).key, snow = sea === "winter";
  const key = `${state.seed}:${t.id}:${sea}:${spots.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(";")}`;
  if (bgCache.has(key)) return bgCache.get(key);
  if (typeof document === "undefined" || !document.createElement) return "";
  const cv = document.createElement("canvas");
  cv.width = PM_W * PM.DPR; cv.height = PM_H * PM.DPR;
  const ctx = cv.getContext("2d");
  if (!ctx) return "";
  ctx.scale(PM.DPR, PM.DPR);
  ctx.imageSmoothingEnabled = false;
  const hex = hexCorners(PM.R);
  const path = () => { ctx.beginPath(); hex.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  ctx.save();
  path();
  ctx.clip();
  // The ground and its mottling.
  const col = (TERRAIN[t.terrain] || TERRAIN.plains).color, r = dice(state, t, "ground");
  ctx.fillStyle = col;
  ctx.fillRect(0, 0, PM_W, PM_H);
  for (let k = 0; k < 140; k++) {
    const x = r() * PM_W, y = r() * PM_H, rad = 6 + r() * 26;
    ctx.fillStyle = shade(col, r() < 0.5 ? 0.88 : 1.1, 0.18 + r() * 0.12);
    ctx.beginPath(); ctx.ellipse(x, y, rad, rad * (0.5 + r() * 0.4), r() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  if (snow) { ctx.fillStyle = "rgba(235,240,248,0.35)"; ctx.fillRect(0, 0, PM_W, PM_H); }
  // Water along the sides that touch it.
  const sd = sides(state, t), water = TERRAIN.water.color;
  const wet = sd.filter((s) => state.tiles[s.m] && state.tiles[s.m].terrain === "water");
  for (const s of wet) {
    // The side (its corners half a radius either way of its middle), and a wavy bank parallel to it inside.
    const [mx, my] = s.mid, px = -s.uy, py = s.ux, half = PM.R * 0.62, depth = PM.R * 0.2;
    ctx.fillStyle = water;
    ctx.beginPath();
    ctx.moveTo(mx + px * half + s.ux * 10, my + py * half + s.uy * 10);
    ctx.lineTo(mx - px * half + s.ux * 10, my - py * half + s.uy * 10);
    for (let k = 0; k <= 12; k++) { const f = -1 + (2 * k) / 12, d = depth + (r() - 0.5) * 8; ctx.lineTo(mx + px * half * f - s.ux * d, my + py * half * f - s.uy * d); }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(170,200,220,0.35)"; ctx.lineWidth = 1;
    for (let k = 0; k < 7; k++) { const f = r() * 1.6 - 0.8, d = depth * (0.25 + r() * 0.5), x = mx + px * half * f - s.ux * d, y = my + py * half * f - s.uy * d; ctx.beginPath(); ctx.moveTo(x - px * 6, y - py * 6); ctx.lineTo(x + px * 6, y + py * 6); ctx.stroke(); }
  }
  // Roads: the middle out to the sides they lead by.
  const roads = sd.filter((s) => (t.roadLinks || []).includes(s.m));
  for (const [w, c] of [[16, "#4e463c"], [12, "#6b6153"]]) {
    ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = "round";
    for (const s of roads) { ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(s.mid[0] + s.ux * 6, s.mid[1] + s.uy * 6); ctx.stroke(); }
  }
  ctx.strokeStyle = "rgba(220,206,150,0.55)"; ctx.lineWidth = 1.2; ctx.setLineDash([6, 6]);
  for (const s of roads) { ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(s.mid[0], s.mid[1]); ctx.stroke(); }
  ctx.setLineDash([]);
  // The decals, thick, off the roads, the water, the places and the team's spot; farther back first.
  const farm = t.terrain === "plains" && (t.pois || []).some((q) => FARMY.has(q.kind));
  const rules = t.terrain === "water" ? [] : DRESS[farm ? "farm" : t.terrain] || [];
  const clear = spots.map(toMap), rd = roads.map((s) => [[CX, CY], s.mid]), dr = dice(state, t, "decals");
  const put = [];
  for (const [set, n] of rules) for (let k = 0; k < n; k++) {
    const v = Math.floor(dr() * 8), [sw, sh] = decalSize(set, v), w = sw * PM.DECAL, h = sh * PM.DECAL;
    for (let tries = 0; tries < 12; tries++) {
      const x = PM.PAD + dr() * (PM_W - 2 * PM.PAD), y = PM.PAD + dr() * (PM_H - 2 * PM.PAD);
      if (!inHex(x - w / 2, y - h, PM.R - 6) || !inHex(x + w / 2, y - h, PM.R - 6) || !inHex(x - w / 2, y, PM.R - 6) || !inHex(x + w / 2, y, PM.R - 6)) continue;
      if (clear.some(([cx, cy]) => Math.hypot(cx - x, cy - (y - h / 2)) < 30 + w / 2)) continue;
      if (rd.some(([a, b]) => segDist(x, y - h / 2, a, b) < 10 + Math.max(w, h) / 2)) continue;
      if (wet.some((s) => (x - s.mid[0]) * -s.ux + (y - s.mid[1]) * -s.uy < PM.R * 0.26)) continue;
      if (put.some((q) => Math.abs(q.x - x) < (q.w + w) * 0.35 && Math.abs(q.y - y) < (q.h + h) * 0.3)) continue;
      put.push({ set, v, x, y, w, h });
      break;
    }
  }
  for (const s of wet) for (let k = 0; k < 5; k++) { const f = dr() * 1.2 - 0.6, x = s.mid[0] + -s.uy * PM.R * 0.6 * f - s.ux * PM.R * 0.24, y = s.mid[1] + s.ux * PM.R * 0.6 * f - s.uy * PM.R * 0.24; if (inHex(x, y, PM.R - 8)) put.push({ set: "reeds", v: k, x, y, w: 12, h: 12 }); }
  put.sort((a, b) => a.y - b.y);
  const look = SEASON_LOOK[sea] || SEASON_LOOK.spring;
  for (const q of put) drawDecal(ctx, q.set, q.v, q.x, q.y, PM.DECAL, { snow, look });
  // The tile's edge: a shadow inside, a line on it.
  ctx.restore();
  path();
  ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.stroke();
  ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255,236,190,0.55)"; ctx.stroke();
  const url = cv.toDataURL("image/png");
  if (bgCache.size > 24) bgCache.clear();
  bgCache.set(key, url);
  return url;
}

// A place's sprite as a data URL, with its size in css px: { url, w, h }.
const spriteCache = new Map();
function spriteOf(kind, variant, band) {
  const key = `${kind}:${variant || ""}:${band}`;
  if (spriteCache.has(key)) return spriteCache.get(key);
  let out = { url: "", w: 40, h: 34 };
  try {
    const cv = poiSpriteCanvas(kind, variant || "", band >= 3 ? 2 : band >= 2 ? 1 : 0);
    if (cv && typeof cv.toDataURL === "function") { const w = 44, h = Math.round((w * cv.height) / cv.width); out = { url: cv.toDataURL("image/png"), w, h }; }
  } catch { /* headless: no canvas */ }
  spriteCache.set(key, out);
  return out;
}

// A point halfway along a route by its length.
function midOf(pts) {
  let tot = 0;
  for (let k = 1; k < pts.length; k++) tot += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  let left = tot / 2;
  for (let k = 1; k < pts.length; k++) {
    const d = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    if (left <= d) { const f = d ? left / d : 0; return [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f]; }
    left -= d;
  }
  return pts[pts.length - 1] || [CX, CY];
}

const BAND_COLOR = ["#8fd18f", "#e6e1d3", "#f0c060", "#e07070"];
// An arrow on a side of the tile, pointing out (a way off the tile): at the side's middle, a little inside.
function exitArrow(state, t, x, attrs, cls = "") {
  const sd = sides(state, t).find((q) => q.m === x.via);
  if (!sd) return "";
  const ax = CX + sd.ux * PM.R * 0.78, ay = CY + sd.uy * PM.R * 0.78, deg = (Math.atan2(sd.uy, sd.ux) * 180) / Math.PI;
  const side = sd.uy > 0.1 ? -1 : 1, lx = ax - sd.uy * 22 * side, ly = ay + sd.ux * 22 * side + 4; // along the edge, beside the arrow
  return `<g class="pm-exit${cls}"${attrs}><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="11"/><path d="M-4,-6 L4,0 L-4,6" transform="translate(${ax.toFixed(1)},${ay.toFixed(1)}) rotate(${deg.toFixed(1)})"/>${x.mins != null ? `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}">${x.mins}m</text>` : ""}</g>`;
}

/**
 * The map's overlay: routes, minutes, the team and the places as buttons. wm: sim/poiwalk.js walkMap; rows: poiraid.js
 * poiRows (the same places); sel: the selected place or null; tips: a place's hover text by index.
 * opts.exits: the ways off the tile as the card's choices ({ via, mins, i: the choice's index, tip }), an arrow on each side;
 * opts.walk: the walk under way (sim/poiwalk.js walkPos): only its route, the team's dot where it is now (#pm-team,
 * moved every frame by ui/poipick.js tileViewFrame), the places not clickable.
 * @param {any} state @param {any} t @param {any} wm @param {any[]} rows @param {number | null} sel @param {(i: number) => string} tips @param {{ exits?: any[], walk?: any }} [opts]
 */
export function poiMapSvg(state, t, wm, rows, sel, tips, opts = {}) {
  const walk = opts.walk || null;
  if (walk) return walkSvg(state, t, wm, rows, tips, walk);
  const byI = new Map(rows.map((r) => [r.i, r]));
  const routes = [], chips = [], places = [], hov = [];
  // A route's minutes go at its middle, unless that falls on a place, its name or the team's dot (they show there anyway).
  const busy = [...wm.places.map((x) => toMap(x.spot)), toMap(wm.from.spot)];
  const free = ([mx, my]) => busy.every(([x, y]) => Math.abs(mx - x) > 44 || my < y - 40 || my > y + 44);
  for (const pl of wm.places) {
    const r = byI.get(pl.i);
    if (!r) continue;
    const pts = pl.route.map(toMap), on = sel === pl.i;
    if (pts.length > 1) {
      routes.push(`<polyline class="pm-route${on ? " on" : ""}" data-poi="${pl.i}" points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}"/>`);
      const [mx, my] = midOf(pts), txt = `${pl.mins}m`, w = 8 + txt.length * 6.4;
      if (free([mx, my])) chips.push(`<g class="pm-chip${on ? " on" : ""}" data-poi="${pl.i}" transform="translate(${mx.toFixed(1)},${my.toFixed(1)})"><rect x="${-w / 2}" y="-8" width="${w}" height="16" rx="8"/><text y="4">${txt}</text></g>`);
    }
    const [x, y] = toMap(pl.spot), sp = spriteOf(r.kind, (poiAt(t, pl.i) || {}).v, r.band);
    const label = r.name.length > 22 ? `${r.name.slice(0, 21)}…` : r.name;
    places.push(`<g class="pm-poi${on ? " on" : ""}${r.stripped ? " stripped" : ""}" data-action="poisel" data-poi="${pl.i}" data-tip="${esc(tips(pl.i))}" tabindex="0" role="button" aria-label="${esc(r.name)}">
      <ellipse class="pm-plate" cx="${x.toFixed(1)}" cy="${(y + 4).toFixed(1)}" rx="24" ry="9" style="stroke:${BAND_COLOR[r.band]}"/>
      ${sp.url ? `<image href="${sp.url}" x="${(x - sp.w / 2).toFixed(1)}" y="${(y + 6 - sp.h).toFixed(1)}" width="${sp.w}" height="${sp.h}" style="image-rendering:pixelated"/>` : `<circle cx="${x}" cy="${y - 8}" r="10" fill="#bbb"/>`}
      ${r.raiding ? `<circle class="pm-alarm" cx="${(x + 20).toFixed(1)}" cy="${(y - sp.h + 8).toFixed(1)}" r="5"/>` : ""}
      <text class="pm-name" x="${x.toFixed(1)}" y="${(y + 24).toFixed(1)}">${esc(label)}</text>
      <text class="pm-mins" x="${x.toFixed(1)}" y="${(y + 37).toFixed(1)}">${pl.mins ? `🚶 ${pl.mins} min` : "📍 here"}</text>
    </g>`);
    hov.push(`.pm-svg:has(.pm-poi[data-poi="${pl.i}"]:hover) .pm-route[data-poi="${pl.i}"],.pm-svg:has(.pm-poi[data-poi="${pl.i}"]:hover) .pm-chip[data-poi="${pl.i}"]{stroke-opacity:1;opacity:1}`);
  }
  // The team: at a place (a ring under it), else its dot on the edge it came in by, or in the middle.
  const f = wm.from, [ux, uy] = toMap(f.spot);
  const you = f.poi != null
    ? `<g class="pm-you"><ellipse cx="${ux.toFixed(1)}" cy="${(uy + 4).toFixed(1)}" rx="30" ry="12" class="pm-youring"/></g>`
    : `<g class="pm-you" data-tip="${esc(f.edge != null ? "Your team: where it came onto the tile. The minutes to each place are from here." : "Your team, in the middle of the tile. The minutes to each place are from here.")}"><circle class="pm-pulse" cx="${ux.toFixed(1)}" cy="${uy.toFixed(1)}" r="9"/><circle class="pm-dot" cx="${ux.toFixed(1)}" cy="${uy.toFixed(1)}" r="6"/><text class="pm-youtxt" x="${ux.toFixed(1)}" y="${(uy - 12).toFixed(1)}">You</text></g>`;
  const exits = (opts.exits || []).map((x) => exitArrow(state, t, x, ` data-action="choice" data-i="${x.i}" data-tip="${esc(x.tip || "")}" role="button" tabindex="0"`)).join("");
  return `<svg class="pm-svg" viewBox="0 0 ${PM_W} ${PM_H}" width="${PM_W}" height="${PM_H}"><style>${hov.join("")}</style>${routes.join("")}${you}${places.join("")}${chips.join("")}${exits}</svg>`;
}

// The map while the team walks (the tile view, ui/poipick.js tileViewModal): the places (not buttons), the walk's
// route lit, an arrow on the side it leaves by, and the team's dot where it is at this minute.
function walkSvg(state, t, wm, rows, tips, walk) {
  const places = rows.map((r) => {
    const pl = wm.places.find((x) => x.i === r.i);
    if (!pl) return "";
    const [x, y] = toMap(pl.spot), sp = spriteOf(r.kind, (poiAt(t, r.i) || {}).v, r.band), on = walk.poi === r.i;
    const label = r.name.length > 22 ? `${r.name.slice(0, 21)}…` : r.name;
    return `<g class="pm-poi still${on ? " on" : ""}${r.stripped ? " stripped" : ""}" data-tip="${esc(tips(r.i))}"><ellipse class="pm-plate" cx="${x.toFixed(1)}" cy="${(y + 4).toFixed(1)}" rx="24" ry="9" style="stroke:${BAND_COLOR[r.band]}"/>${sp.url ? `<image href="${sp.url}" x="${(x - sp.w / 2).toFixed(1)}" y="${(y + 6 - sp.h).toFixed(1)}" width="${sp.w}" height="${sp.h}" style="image-rendering:pixelated"/>` : ""}<text class="pm-name" x="${x.toFixed(1)}" y="${(y + 24).toFixed(1)}">${esc(label)}</text></g>`;
  }).join("");
  const pts = walk.route.map(toMap), [dx, dy] = toMap([walk.x, walk.y]);
  const route = `<polyline class="pm-route on" points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}"/>`;
  const exit = walk.exit ? exitArrow(state, t, { via: walk.exit.via, mins: null }, "", " on") : "";
  const team = `<g id="pm-team" class="pm-you" transform="translate(${dx.toFixed(1)},${dy.toFixed(1)})"><circle class="pm-pulse" r="9"/><circle class="pm-dot" r="6"/><text class="pm-youtxt" y="-12">You</text></g>`;
  return `<svg class="pm-svg" viewBox="0 0 ${PM_W} ${PM_H}" width="${PM_W}" height="${PM_H}">${route}${exit}${places}${team}</svg>`;
}
