// Canvas renderer for the State Map. Reads the simulation; never changes it.
import { TERRAIN, LOCATIONS, SITE_ZONES, DANGER_NAMES, siteDanger } from "../sim/data.js";
import { hub, day, factionById, RADIO_RANGE } from "../sim/world.js";
import { partyTile, plannedTile } from "../sim/parties.js";
import { MARKER_TYPES, LAYER_OF } from "../sim/markers.js";
import { vehicleById } from "../sim/vehicles.js";
import { BUILDINGS, count } from "../sim/buildings.js";
import { weatherTint } from "../sim/weather.js";
import { radioNodes } from "../sim/radio.js";
import { HIVE } from "../sim/hiveconst.js";
import { redSkullCanvas, wallbreakerMapCanvas, siteSpriteCanvas } from "./hivesprites.js";
import {
  partySpriteCanvas, drawMapSprite, baseSpriteCanvas, factionBaseCanvas, campSpriteCanvas, markerSpriteCanvas, poiSpriteCanvas, skullCanvas,
  groupPartyCanvas, siegeCampCanvas, hordeSpriteCanvas, hiveSpriteCanvas, iconCanvas, wakeCanvas, bridgeCanvas, gridW,
} from "./mapsprites.js";

export const HEX = 26;

export const camera = { x: 0, y: 0, zoom: 1 };
const DEFAULT_LAYERS = ["pois", "territory", "teams", "hordes", "deaths", "vehicles", "finds", "weather"];
export const view = { selected: -1, hover: -1, preview: null, devReveal: false, layers: new Set(DEFAULT_LAYERS) };
const on = (k) => view.layers.has(k);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// A new world starts with the default view: nothing selected, the fog back on, the standard layers, zoom 1.
export function resetView() {
  view.selected = -1;
  view.hover = -1;
  view.preview = null;
  view.devReveal = false;
  view.layers = new Set(DEFAULT_LAYERS);
  camera.zoom = 1;
}

// Dev tools "Reveal map": every tile counts as live for drawing. Display only (see ui/devtools.js).
let allLive = null;
export const liveSet = (state) => {
  if (!view.devReveal) return state.live;
  if (!allLive || allLive.size !== state.tiles.length) allLive = new Set(state.tiles.map((t) => t.id));
  return allLive;
};

let canvas, ctx, W = 0, H = 0, dpr = 1;

export function initRenderer(el) {
  canvas = el;
  ctx = canvas.getContext("2d");
  resize();
  window.addEventListener("resize", resize);
}

export function resize() {
  dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  W = r.width;
  H = r.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
}

export function centerOn(state, tileId) {
  const [px, py] = state.grid.toPixel(tileId, HEX);
  camera.x = px - W / (2 * camera.zoom);
  camera.y = py - H / (2 * camera.zoom);
}

export function screenToTile(state, sx, sy) {
  const wx = sx / camera.zoom + camera.x;
  const wy = sy / camera.zoom + camera.y;
  return state.grid.fromPixel(wx, wy, HEX);
}

// Size of the whole map in world pixels (set from the grid each frame): zooming out stops once all of it fits.
let mapPx = null;
const setMapPx = (grid) => (mapPx = { w: HEX * Math.sqrt(3) * (grid.width + 0.5), h: HEX * (1.5 * (grid.height - 1) + 2) });
const minZoom = () => (mapPx && W && H ? Math.max(0.15, Math.min(0.45, 0.95 * Math.min(W / mapPx.w, H / mapPx.h))) : 0.45);

export function zoomAt(sx, sy, factor) {
  const wx = sx / camera.zoom + camera.x;
  const wy = sy / camera.zoom + camera.y;
  // Never below the normal minimum, unless the view is already further out (the timelapse fits the whole map):
  // then zooming out stays put instead of jumping in.
  camera.zoom = Math.max(Math.min(minZoom(), camera.zoom), Math.min(2.6, camera.zoom * factor));
  camera.x = wx - sx / camera.zoom;
  camera.y = wy - sy / camera.zoom;
}

const HEX_CORNERS = Array.from({ length: 6 }, (_, i) => [Math.cos((Math.PI / 180) * (60 * i - 30)), Math.sin((Math.PI / 180) * (60 * i - 30))]);
// Adds a hex to the current path (several can share one fill).
function hexSub(cx, cy, s) {
  ctx.moveTo(cx + s * HEX_CORNERS[0][0], cy + s * HEX_CORNERS[0][1]);
  for (let i = 1; i < 6; i++) ctx.lineTo(cx + s * HEX_CORNERS[i][0], cy + s * HEX_CORNERS[i][1]);
  ctx.closePath();
}
function hexPath(cx, cy, s) {
  ctx.beginPath();
  hexSub(cx, cy, s);
}

const shadeMemo = new Map();
function shade(hex, f) {
  const key = hex + f;
  let v = shadeMemo.get(key);
  if (v) return v;
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  v = `rgb(${r},${g},${b})`;
  shadeMemo.set(key, v);
  return v;
}

function ageText(state, snap) {
  const h = state.hour - snap.hour;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function render(state) {
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0d0f12";
  ctx.fillRect(0, 0, W, H);
  ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, -camera.x * dpr * camera.zoom, -camera.y * dpr * camera.zoom);

  const g = state.grid;
  setMapPx(g);
  const live = liveSet(state);
  const k = state.knowledge;
  const minX = camera.x - HEX * 2, minY = camera.y - HEX * 2;
  const maxX = camera.x + W / camera.zoom + HEX * 2, maxY = camera.y + H / camera.zoom + HEX * 2;
  const visible = [];

  // Terrain. Geography is known from pre-war maps; current conditions are not. Only tiles on screen are drawn,
  // batched by color (one fill per color), so the whole map stays cheap when zoomed out.
  const batches = new Map();
  for (const t of state.tiles) {
    const [px, py] = g.toPixel(t.id, HEX);
    if (px < minX || px > maxX || py < minY || py > maxY) continue;
    visible.push(t);
    const color = shade(TERRAIN[t.terrain].color, live.has(t.id) ? 1 : k[t.id] ? 0.72 : 0.42);
    let list = batches.get(color);
    if (!list) batches.set(color, (list = []));
    list.push(px, py);
  }
  for (const [color, list] of batches) {
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 2) hexSub(list[i], list[i + 1], HEX + 0.5);
    ctx.fillStyle = color;
    ctx.fill();
  }
  // Season and weather wash over the land (weather.js): one fill for every visible land tile.
  const tint = on("weather") && (state.weather || !state.timelapse) ? weatherTint(state) : null;
  if (tint) {
    ctx.beginPath();
    for (const t of visible) if (t.terrain !== "water") { const [px, py] = g.toPixel(t.id, HEX); hexSub(px, py, HEX + 0.5); }
    ctx.fillStyle = tint;
    ctx.fill();
  }
  for (const t of on("infection") ? visible : []) {
    const isLive = live.has(t.id), snap = k[t.id];
    if (!isLive && !snap) continue;
    const [px, py] = g.toPixel(t.id, HEX);
    hexPath(px, py, HEX + 0.5);
    ctx.fillStyle = `rgba(220,40,40,${(isLive ? t.infection : snap.infection) * 0.55})`;
    ctx.fill();
  }
  // Territory (only what you know).
  for (const t of on("territory") ? visible : []) {
    const snap = live.has(t.id) ? { owner: t.owner } : k[t.id];
    if (!snap || snap.owner == null) continue;
    const [px, py] = g.toPixel(t.id, HEX);
    let color = "#4f8fd6";
    if (snap.owner !== "player") {
      const f = factionById(state, snap.owner);
      if (!f) continue;
      color = f.color;
    }
    hexPath(px, py, HEX - 1.5);
    ctx.fillStyle = color + "2a";
    ctx.fill();
    ctx.strokeStyle = color + "88";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  // Roads.
  ctx.strokeStyle = "#cdbb8a";
  ctx.lineWidth = 2.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const t of visible) {
    if (!t.road) continue;
    const [ax, ay] = g.toPixel(t.id, HEX);
    for (const n of t.roadLinks) {
      if (n < t.id) continue;
      const [bx, by] = g.toPixel(n, HEX);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
  }
  ctx.stroke();
  // Bridges: a railed deck turned along the road.
  for (const t of visible) {
    if (!t.bridge) continue;
    const [px, py] = g.toPixel(t.id, HEX);
    const [a, b] = t.roadLinks.length > 1 ? t.roadLinks : [t.id, t.roadLinks[0] ?? t.id];
    const [ax, ay] = g.toPixel(a, HEX), [bx, by] = g.toPixel(b, HEX);
    drawMapSprite(ctx, bridgeCanvas(), px, py, 24, { angle: ax === bx && ay === by ? 0 : Math.atan2(by - ay, bx - ax) });
  }

  // Hives you know about (live, or in the last report): their land is tinted dark red, the ring right around each
  // hive brighter, with a red skull on every ring tile when zoomed in (the dead there are much tougher). Sites
  // inside a hive's land show at least 3 skulls, red ones on the ring (labels below).
  const hiveTiles = [];
  for (const t of state.tiles) if (live.has(t.id) ? t.hive : k[t.id] && k[t.id].hive) hiveTiles.push(t.id);
  const hiveDist = (id) => { let d = Infinity; for (const h of hiveTiles) { const x = g.distance(h, id); if (x < d) d = x; } return d; };
  const ringSkulls = [];
  if (on("hordes") && hiveTiles.length) {
    ctx.beginPath();
    for (const t of visible) { const d = hiveDist(t.id); if (d <= HIVE.TERRITORY && d > HIVE.RING) { const [px, py] = g.toPixel(t.id, HEX); hexSub(px, py, HEX - 0.5); } }
    ctx.fillStyle = "rgba(150,20,30,0.13)";
    ctx.fill();
    ctx.beginPath();
    for (const t of visible) { const d = hiveDist(t.id); if (d <= HIVE.RING) { const [px, py] = g.toPixel(t.id, HEX); hexSub(px, py, HEX - 0.5); if (d > 0 && camera.zoom > SKULL_ZOOM * 0.7 && !t.loc) ringSkulls.push([px, py]); } }
    ctx.fillStyle = "rgba(200,25,25,0.22)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,70,60,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
    for (const [px, py] of ringSkulls) drawMapSprite(ctx, redSkullCanvas(), px, py + 13, SKULL_W, { alpha: 0.9 });
  }

  // Locations: other groups' bases as compound sprites in their color, plain sites as pixel sprites (one per site
  // type) on a plate in their zone's color (city, small town, countryside, landmark); picked-over sites are faded
  // and up close skulls show the danger. Zoomed out, minor sites shrink to dots and only the bigger places keep
  // their names. Tiles with one of your bases are drawn with the base below. A site with a team, horde or marker
  // on it is drawn faded so they stand out.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const ownBase = new Set(state.bases.map((b) => b.tile));
  const busy = busyTiles(state, live);
  // Base tiles with a horde, a siege or a party standing beside the base: the base's name moves below them.
  const crowded = (id) => busy.has(id) || (on("hordes") && !live.has(id) && !!k[id] && k[id].hordeSize > 0);
  // Tiles drawn as a base (yours, or another group's as far as you know), with half the sprite's width.
  baseTiles = new Map(state.bases.map((b) => [b.tile, ((b.type === "hub" ? PLACE_W.hub : PLACE_W.outpost) * zoomBoost()) / 2]));
  spriteBoxes = [];
  besideCount = new Map();
  const labels = []; // drawn last (over parties, hordes and markers), most important first, skipping any that would overlap
  for (const t of visible) {
    if (!t.loc || ownBase.has(t.id)) continue;
    const [px, py] = g.toPixel(t.id, HEX);
    const isLive = live.has(t.id);
    const snap = isLive ? null : k[t.id];
    const fb = isLive ? state.factions.find((f) => f.alive && f.bases.includes(t.id)) : snap && snap.factionBase ? factionById(state, snap.factionBase) : null;
    if (!fb && !on("pois")) continue; // the Locations layer hides plain sites, not other groups' bases
    // Tier 0 = city centers, 1 = towns, landmarks and group bases, 2 = everything else (shops, farms, cabins…).
    const zone = SITE_ZONES[t.loc.zone || LOCATIONS[t.loc.type].cat] || SITE_ZONES.special;
    const tier = t.loc.type === "city" ? 0 : fb || t.loc.type === "town" || t.loc.zone === "special" ? 1 : 2;
    let labelY = py + 19, side = null;
    if (fb) {
      const s = zoomBoost(), w = PLACE_W.faction * s, cy = py - 5 * s;
      const besieged = isLive && state.parties.some((q) => q.phase === "siege" && q.target && q.target.kind === "faction" && q.target.tile === t.id);
      ownerPlate(px, py, fb.color, s, 18, besieged);
      const cv = factionBaseCanvas(fb.type, fb.color);
      drawMapSprite(ctx, cv, px, cy, w);
      noteSprite(px, cy, w, spriteH(cv, w));
      baseTiles.set(t.id, w / 2);
      labelY = crowded(t.id) ? py + BESIDE_LABEL_Y * Math.min(s, BESIDE_MAX) : cy + spriteH(cv, w) / 2 + 6;
    } else if (tier === 2 && camera.zoom < 0.7) {
      // Zoomed out, minor sites are small dots in their zone's color so the map does not clutter.
      ctx.beginPath();
      ctx.arc(px, py, 2.6 / camera.zoom, 0, Math.PI * 2);
      ctx.fillStyle = zone.color;
      ctx.fill();
      continue;
    } else {
      const d = drawSite(state, t, px, py, tier, zone, isLive, snap, busy.has(t.id) ? 0.55 : 1);
      labelY = d.labelY;
      side = d.side;
    }
    // Danger skulls go in a row under the name; where the name is not shown at this zoom, under the sprite.
    // Cities, towns, landmarks and group bases keep their names at every zoom (overlapping ones give way, the
    // most important first); small sites only up close.
    const named = tier < 2 || camera.zoom > 1.3;
    const hd = hiveTiles.length && !fb ? hiveDist(t.id) : Infinity; // inside a known hive's land: at least 3 skulls, red on the ring
    const skulls = !fb && camera.zoom > SKULL_ZOOM ? Math.max(siteDanger(t.loc), hd <= HIVE.TERRITORY ? 3 : 0) : 0;
    if (named || skulls) {
      labels.push({ text: named ? (tier === 2 ? siteLabel(state, t) : t.loc.name) : "", x: px, y: labelY, pri: named ? tier : 3, screen: tier < 2, bold: tier === 0, size: tier === 0 ? 12 : tier === 1 ? 10 : 9, skulls, red: hd <= HIVE.RING, side });
    }
  }
  // Hives you know about: a festering mound, bigger and redder on badly infected ground; live ones pulse.
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 420);
  for (const t of on("hordes") ? visible : []) {
    const isLive = live.has(t.id);
    const snap = k[t.id];
    const hive = isLive ? t.hive : snap && snap.hive;
    if (!hive) continue;
    const [px, py] = g.toPixel(t.id, HEX);
    const s = zoomBoost(), inf = (isLive ? t.infection : snap.infection) || 0;
    const level = inf >= 0.8 ? 2 : inf >= 0.5 ? 1 : 0, w = (28 + level * 4) * s;
    if (isLive) {
      ctx.beginPath();
      ctx.ellipse(px, py + 5 * s, w * 0.55, w * 0.22, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,50,35,${(0.1 + 0.16 * pulse * (1 + level * 0.4)).toFixed(3)})`;
      ctx.fill();
    }
    drawMapSprite(ctx, hiveSpriteCanvas(level), px, py - 1 * s, w, { alpha: isLive ? 1 : 0.8 });
  }
  // Hive build sites you know about: a raw mound of the dead with bones sticking up (glowing once the building has
  // started) and how much of the 1,000 dead it needs has gone into it.
  const siteAt = new Map((state.hiveSites || []).map((x) => [x.tile, x]));
  for (const t of on("hordes") ? visible : []) {
    const isLive = live.has(t.id);
    const st = isLive ? siteAt.get(t.id) : k[t.id] && k[t.id].site;
    if (!st) continue;
    const [px, py] = g.toPixel(t.id, HEX);
    const s = zoomBoost(), w = 26 * s, started = st.started != null && st.started !== false;
    drawMapSprite(ctx, siteSpriteCanvas(started), px, py + 2 * s, w, { alpha: isLive ? 1 : 0.75 });
    const bw = 24 * s, bx = px - bw / 2, by = py + 11 * s, frac = Math.max(0, Math.min(1, (st.biomass || 0) / HIVE.SITE_BIOMASS));
    ctx.fillStyle = "rgba(13,15,18,0.8)";
    ctx.fillRect(bx - 1, by - 1, bw + 2, 4 * s + 2);
    ctx.fillStyle = started ? "#e2412f" : "#8a5a5a";
    ctx.fillRect(bx, by, bw * frac, 4 * s);
  }
  // Player bases: a walled town for the hub, a cabin for outposts, showing walls and notable buildings.
  for (const b of state.bases) {
    const [px, py] = g.toPixel(b.tile, HEX);
    const s = zoomBoost(), isHub = b.type === "hub";
    const w = (isHub ? PLACE_W.hub : PLACE_W.outpost) * s, cy = py - (isHub ? 6 : 5) * s;
    const besieged = state.parties.some((q) => q.phase === "siege" && q.target && q.target.kind === "player" && q.target.baseId === b.id);
    ownerPlate(px, py, PLAYER_COLOR, s, isHub ? 22 : 16, besieged);
    const cv = baseSpriteCanvas(baseLook(b));
    drawMapSprite(ctx, cv, px, cy, w);
    const h = spriteH(cv, w);
    noteSprite(px, cy, w, h);
    if (b.alert) drawMapSprite(ctx, iconCanvas("alert", "#ff9f43"), px + w / 2 - 3 * s, cy - h / 2 + 5 * s, ICON_W * s);
    labels.push({ text: b.name, x: px, y: crowded(b.tile) ? py + BESIDE_LABEL_Y * Math.min(s, BESIDE_MAX) : cy + h / 2 + 6, pri: -1, screen: true, color: "#cfe2f7", size: 10, bold: isHub });
    // Radio coverage (radio.js): a station's circle, and a relay's when it is linked (red when it is not, or offline).
    const node = radioNodes(state).find((n) => n.base === b);
    if (node) {
      ctx.strokeStyle = node.linked ? "rgba(143,180,224,0.18)" : "rgba(224,120,110,0.3)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(px, py, node.range * HEX * Math.sqrt(3), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // Markers you know about: death sites, abandoned vehicles, spotted finds, as sprites on a faint ring in their
  // layer's color (dots when zoomed far out, like minor sites). Older reports fade; dealt-with finds show emptied.
  const slot = new Map(), perTile = new Map();
  for (const m of state.markers) if (on(LAYER_OF[m.type])) perTile.set(m.tile, (perTile.get(m.tile) || 0) + 1);
  for (const m of state.markers) {
    if (!on(LAYER_OF[m.type])) continue;
    const [px, py] = g.toPixel(m.tile, HEX);
    if (px < minX || px > maxX || py < minY || py > maxY) continue;
    const n = slot.get(m.tile) || 0;
    slot.set(m.tile, n + 1);
    const ageDays = (state.hour - m.hour) / 24;
    const alpha = m.info?.emptied ? 0.6 : Math.max(0.45, 1 - ageDays / 20);
    const color = LAYER_COLOR[LAYER_OF[m.type]];
    if (camera.zoom < 0.7) {
      ctx.beginPath();
      ctx.arc(px + (n - (perTile.get(m.tile) - 1) / 2) * 7 / camera.zoom, py - 6, 3 / camera.zoom, 0, Math.PI * 2);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#0d0f12";
      ctx.lineWidth = 1 / camera.zoom;
      ctx.stroke();
      ctx.globalAlpha = 1;
      continue;
    }
    // On a site or base: tucked into the tile's upper left; elsewhere centered, side by side when there are several.
    const s = zoomBoost(), w = (MARKER_W[m.type] || 14) * s;
    const tucked = state.tiles[m.tile].loc || ownBase.has(m.tile);
    const x = tucked ? px + (-14 + n * 14) * s : px + (n - (perTile.get(m.tile) - 1) / 2) * 17 * s;
    const y = tucked ? py - 13 * s : py + 1 * s;
    const cv = markerSpriteCanvas(m.type, PLAYER_COLOR, markerLook(state, m));
    const h = spriteH(cv, w);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.ellipse(x, y + h / 2 - 1 * s, w * 0.48, 3 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.globalAlpha = 1;
    drawMapSprite(ctx, cv, x, y, w, { alpha });
  }
  // Hordes: a crowd of the dead (more figures for bigger hordes) facing where they drift, their size on a badge;
  // stale ghosts (faded, "N?") where you saw them last. On a base's tile they stand beside it, not on top of it.
  const hordeAt = new Map();
  for (const h of on("hordes") ? state.hordes : []) {
    const e = hordeAt.get(h.tile);
    if (e) { e.size += h.size; e.bosses += h.bosses || 0; }
    else hordeAt.set(h.tile, { size: h.size, target: h.target, bosses: h.bosses || 0 });
  }
  for (const t of on("hordes") ? visible : []) {
    const isLive = live.has(t.id);
    let size = 0, stale = false, target = null, bosses = 0;
    if (isLive) ({ size = 0, target = null, bosses = 0 } = hordeAt.get(t.id) || {});
    else if (k[t.id] && k[t.id].hordeSize) { size = k[t.id].hordeSize; bosses = k[t.id].hordeBoss || 0; stale = true; }
    if (!size) continue;
    const [px, py] = g.toPixel(t.id, HEX);
    // Beside, not on top of: a base you can see or last saw there (never one you do not know about), a hive or a build site.
    const based = baseTiles.has(t.id) || hiveTiles.includes(t.id) || siteAt.has(t.id) || !!(k[t.id] && k[t.id].site && !isLive);
    const s = zoomBoost() * (based ? 0.85 : 1), o = Math.min(zoomBoost(), BESIDE_MAX); // the offset stays inside the tile when zoomed out
    const x = based ? px + 17 * o : px, y = based ? py + 13 * o : py + 3 * s;
    const cv = hordeSpriteCanvas(hordeFigures(size)), w = gridW(cv) * 1.15 * s, h = spriteH(cv, w);
    const facing = target != null && target !== t.id && g.toPixel(target, HEX)[0] < px ? -1 : 1;
    ctx.beginPath();
    ctx.ellipse(x, y + h / 2 - 1.5 * s, w * 0.52, 4 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = stale ? "rgba(120,20,20,0.18)" : "rgba(120,20,20,0.42)";
    ctx.fill();
    ctx.strokeStyle = stale ? "rgba(255,120,110,0.5)" : "#ff8a7f";
    ctx.setLineDash(stale ? [3, 3] : []);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    drawMapSprite(ctx, cv, x, y, w, { facing, alpha: stale ? 0.45 : 1 });
    // A Wallbreaker with the horde: the brute with the concrete fist stands at its head.
    if (bosses) drawMapSprite(ctx, wallbreakerMapCanvas(), x - facing * (w / 2 + 2 * s), y - 2 * s, 14 * s * 1.2, { facing, alpha: stale ? 0.5 : 1 });
    pill(x + w / 2, y - h / 2 + 2 * s, stale ? `${size}?` : `${size}`, stale ? "rgba(122,28,24,0.6)" : "#8a1c18", s);
  }
  // Other groups' parties you can currently see, by group type: convoys by vehicle (spiked pickup, humvee, armored
  // truck, caravan, tractor…), raids and convoys on foot in the group's colors. Raids stand on a red-tinted ring; a
  // siege pitches a camp beside the besieged base, the attackers on the other side and crossed swords over it.
  for (const p of state.parties) {
    if (p.owner === "player" || !on("teams")) continue;
    const tile = partyTile(p);
    if (!live.has(tile)) continue;
    const f = factionById(state, p.owner);
    const [px, py] = g.toPixel(tile, HEX);
    const color = f ? f.color : "#cccccc", type = f ? f.type : "fortress";
    const kind = p.vehicle || p.kind === "caravan" ? "convoy" : p.kind === "raid" ? "raid" : "walk"; // a caravan: their wagon or truck
    const n = p.members ? p.members.length + (p.kind === "raid" ? 1 : 0) : p.strength >= 15 ? 4 : p.strength >= 7 ? 3 : 2;
    const cv = groupPartyCanvas(type, kind, color, n), s = zoomBoost();
    const w = gridW(cv) * (kind === "convoy" ? 1.2 : 1.1) * s;
    if (p.phase === "siege") {
      const o = Math.min(s, BESIDE_MAX);
      drawMapSprite(ctx, siegeCampCanvas(color), px - 25 * o, py + 17 * o, 26 * s);
      groundRing(px + 24 * o, py + 12 * o, color, false, true);
      drawMapSprite(ctx, cv, px + 24 * o, py + 12 * o - 3, w, { facing: -1 });
      drawMapSprite(ctx, iconCanvas("siege"), px, py - 30 * s, ICON_W * 1.2 * s);
      noteSprite(px + 24 * o, py + 12 * o - 3, w, spriteH(cv, w));
      continue;
    }
    // On a base's tile (passing through, or arriving) the party stands beside the base, not on top of it.
    const [x, y, k2] = besideBase(tile, px, py);
    groundRing(x, y, color, false, p.kind === "raid");
    drawMapSprite(ctx, cv, x, y - 3, w * k2, { facing: facingOf(state, p) });
    noteSprite(x, y - 3, w * k2, spriteH(cv, w * k2));
  }
  // Your parties: actual position with radio contact, otherwise only the plan.
  for (const p of state.parties) {
    if (p.owner !== "player" || !on("teams")) continue;
    drawPlayerParty(state, p);
  }
  // Names (and danger skulls) last, so nothing drawn on the map covers them.
  drawLabels(labels, spriteBoxes);
  // Trip preview from the planner.
  if (view.preview && view.preview.length > 1) {
    ctx.strokeStyle = "rgba(224,168,79,0.95)";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    view.preview.forEach((id, i) => {
      const [x, y] = g.toPixel(id, HEX);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Hover and selection.
  for (const [id, color, w] of [[view.hover, "rgba(255,255,255,0.5)", 1.5], [view.selected, "#e0a84f", 3]]) {
    if (id < 0) continue;
    const [px, py] = g.toPixel(id, HEX);
    hexPath(px, py, HEX - 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
  }
}

// ---------- party sprites ----------
const PLAYER_COLOR = "#4f8fd6";    // your teams (same blue as your bases)
const ROUTE_COLOR = "#c9e07a";     // trade-route convoys
const SUPPLY_COLOR = "#5cc8b4";    // supply runs between your bases
const PHASE_COLOR = { waiting: "#ffd166", task: "#9be39b" }; // ring under your teams; moving: light blue
const lastFacing = new WeakMap();   // UI only: keeps a team facing the way it last moved

const PLACE_W = { hub: 46, outpost: 34, faction: 40 }; // base sprite widths in world pixels (before zoomBoost)
const MARKER_W = { death: 13, cache: 15, car: 19, camp: 16, vehicle: 20 };
const LAYER_COLOR = { vehicles: "#7fb0e6", deaths: "#d8cfb8", finds: "#c9b98a" }; // marker rings and far-out dots
const ICON_W = 11;                 // status icons (alert, work, radio, siege, "?")
// Site sprites: world pixels per sprite pixel, and a size factor by zone so a shop drawn for a city block comes out
// a little smaller in a small town (and a town shop smaller out in the countryside).
const POI_PX = 1.1;
const ZONE_K = { urban: 1, town: 0.93, rural: 0.87, special: 1 };
const SKULL_W = 9;        // danger skulls under a site's name: world pixels each (twice the old pips)
const SKULL_ZOOM = 1.0;   // skulls show when zoomed in past this (names of small sites only past 1.3)
const CAMP_TENT = "#d2b36c"; // a camping team's tent: canvas, so it does not blend with the blue walkers in front
const BESIDE_MAX = 1.15;  // parties, hordes and siege camps beside a base stay inside its tile when zoomed out
const BESIDE_LABEL_Y = 31; // a base's name drops below whatever stands beside the base

// Per frame: tiles drawn as a base, sprites the skull rows keep clear of (bases and parties), and parties already
// placed beside a base.
let baseTiles = new Map(), spriteBoxes = [], besideCount = new Map(); // baseTiles: tile -> half the base sprite's width
const noteSprite = (x, y, w, h) => spriteBoxes.push([x - w / 2, y - h / 2, w, h]);
// Where a party on this tile is drawn: beside the base (lower left, further left for a second one) at 85% size
// when the tile has a base, otherwise on the tile. Returns [x, y, scale].
function besideBase(tile, px, py) {
  if (!baseTiles.has(tile)) return [px, py, 1];
  const n = besideCount.get(tile) || 0;
  besideCount.set(tile, n + 1);
  const o = Math.min(zoomBoost(), BESIDE_MAX);
  return [px - Math.min(baseTiles.get(tile) * 0.8 + 8, 28) - 12 * n * o, py + 12 * o, 0.85];
}

// A site's sprite on its zone plate, picked-over sites faded. Returns where its label goes (labelY) and the spot
// beside the plate (side) that the danger skulls fall back to when there is no room under the name.
function drawSite(state, t, px, py, tier, zone, isLive, snap, alpha) {
  const s = tier < 2 ? zoomBoost() : 1, def = LOCATIONS[t.loc.type];
  // Loot as you know it: the real value only for a tile in view, the last report otherwise; never-seen sites look untouched.
  const loot = state.timelapse ? null : isLive ? t.loot : snap ? snap.loot : null;
  const faded = loot != null && t.loc.type !== "city" && t.loc.type !== "town" && loot < 0.35 * def.richness;
  const cv = poiSpriteCanvas(t.loc.type, t.loc.type === "military" && / depot$/i.test(t.loc.name) ? "depot" : "", faded);
  const w = gridW(cv) * POI_PX * s * ((ZONE_K[t.loc.zone] || 1) / (ZONE_K[t.loc.type === "city" ? "urban" : def.cat] || 1));
  const h = spriteH(cv, w), foot = py + 7 * s, rx = Math.max(9 * s, w * 0.46), ry = (tier < 2 ? 4.5 : 3.6) * s;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.ellipse(px, foot, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fill();
  ctx.strokeStyle = zone.color;
  ctx.lineWidth = tier < 2 ? 1.8 : 1.3;
  ctx.stroke();
  ctx.globalAlpha = 1;
  drawMapSprite(ctx, cv, px, foot - h / 2 + 0.6 * s, w, { alpha });
  return { labelY: foot + ry + 6, side: [px + rx + 2 * s, foot] };
}

// Tiles with something drawn over a site (a team or group party, a horde): the site sprite fades there. Markers
// do not fade it: they sit in the tile's corner and can stay for the whole game.
function busyTiles(state, live) {
  const out = new Set();
  if (on("hordes")) for (const h of state.hordes) if (live.has(h.tile)) out.add(h.tile);
  if (on("teams")) for (const p of state.parties) {
    if (!p.path || !p.path.length) continue;
    const tile = partyTile(p);
    if (p.owner === "player" ? p.radioLive || p.kind === "convoy" || p.phase === "waiting" || p.phase === "task" : live.has(tile)) out.add(tile);
  }
  return out;
}

// Which marker sprite variant: the vehicle's type, fuel and damage; an emptied find; a death site with nothing left.
function markerLook(state, m) {
  const i = m.info || {};
  if (m.type === "vehicle") {
    const v = i.vehicleId != null ? vehicleById(state, i.vehicleId) : null;
    return { vehicle: v && v.type === "sedan" ? "sedan" : "truck", needsFuel: i.fuel != null && i.fuel < 3, damaged: i.condition != null && i.condition < 25 };
  }
  if (m.type === "death") return { empty: i.items === 0 };
  return { emptied: !!i.emptied };
}

// Figures in a horde sprite by its size.
const hordeFigures = (size) => (size < 15 ? 2 : size < 25 ? 3 : size < 40 ? 4 : size < 60 ? 5 : size < 90 ? 6 : 7);

// What one of your bases looks like on the map (also the cache key for its sprite).
function baseLook(b) {
  const def = (x) => BUILDINGS[x.type] || {};
  const hosp = Math.max(0, ...b.buildings.map((x) => (def(x).family === "hospital" ? def(x).tier : 0)));
  const farms = count(b, "farm_plot");
  return {
    kind: b.type === "hub" ? "hub" : "outpost", color: PLAYER_COLOR, walls: Math.min(3, count(b, "walls")),
    tower: !!b.watchtower, radio: !!b.radio || count(b, "relay") > 0, hosp, farms: farms >= 4 ? 2 : farms ? 1 : 0,
    workshop: b.buildings.some((x) => def(x).station), big: b.buildings.length >= 4,
  };
}

const spriteH = (cv, w) => (cv ? w * (cv.height / cv.width) : w * 0.75);

// Oval under a base in its owner's color; a pulsing red ring while it is under siege.
function ownerPlate(x, y, color, s, rx, besieged) {
  ctx.beginPath();
  ctx.ellipse(x, y + 9 * s, rx * s, 6 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  if (!besieged) return;
  const t = (Date.now() % 1200) / 1200;
  ctx.beginPath();
  ctx.ellipse(x, y + 9 * s, (rx + 2 + t * 8) * s, (8 + t * 5) * s, 0, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,90,79,${(1 - t).toFixed(2)})`;
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

// Place names with a dark halo so they read over sprites and terrain. labels: { text, x, y, pri (lower first),
// size, bold, color, screen (keep the size on screen when zoomed out), skulls (danger 0-3), side }. A label that
// would overlap one already drawn is skipped, so crowded city blocks show their most important names first.
// Danger skulls sit in a centred row right under the name (or in the name's place when it is not shown), never on
// a name and clear of the base and party sprites in `avoid`; with no room there they go beside the site's plate, smaller.
function drawLabels(labels, avoid = []) {
  labels.sort((a, b) => a.pri - b.pri);
  const boxes = [];
  const hits = (list, x0, y0, w, h) => list.some((b) => x0 < b[0] + b[2] && b[0] < x0 + w && y0 < b[1] + b[3] && b[1] < y0 + h);
  for (const l of labels) {
    let top = l.y - 5; // top edge of the skull row
    if (l.text) {
      const size = l.screen && camera.zoom < 1 ? l.size / camera.zoom : l.size;
      ctx.font = `${l.bold ? "bold " : ""}${size.toFixed(1)}px Segoe UI`;
      const w = ctx.measureText(l.text).width + size * 0.4, h = size * 1.2;
      const x0 = l.x - w / 2, y0 = l.y - h / 2;
      top = y0;
      if (!hits(boxes, x0, y0, w, h)) {
        boxes.push([x0 - size * 0.3, y0, w + size * 0.6, h]); // a little air between names on one line
        ctx.lineWidth = size * 0.3;
        ctx.strokeStyle = "rgba(13,15,18,0.75)";
        ctx.strokeText(l.text, l.x, l.y);
        ctx.fillStyle = l.color || "rgba(230,226,216,0.9)";
        ctx.fillText(l.text, l.x, l.y);
        top = y0 + h + 0.5;
      }
    }
    if (!l.skulls) continue;
    const row = (cx, cy, sw) => {
      const gap = sw * 0.12, w = l.skulls * sw + (l.skulls - 1) * gap;
      const x0 = cx - w / 2, y0 = cy - sw / 2;
      if (hits(boxes, x0, y0, w, sw) || hits(avoid, x0, y0, w, sw)) return false;
      boxes.push([x0, y0, w, sw]);
      for (let i = 0; i < l.skulls; i++) drawMapSprite(ctx, l.red ? redSkullCanvas() : skullCanvas(), x0 + sw / 2 + i * (sw + gap), cy, sw, { alpha: 0.95 });
      return true;
    };
    if (row(l.x, top + SKULL_W / 2, SKULL_W) || !l.side) continue;
    const small = SKULL_W * 0.7;
    row(l.side[0] + (l.skulls * small * 1.12) / 2, l.side[1], small);
  }
}

// A town's or city's own sites drop its name on the map ("Calder City North Precinct" → "North Precinct").
function siteLabel(state, t) {
  const home = t.loc.settlement != null && t.loc.settlement !== t.id ? state.tiles[t.loc.settlement].loc : null;
  return home && t.loc.name.startsWith(home.name + " ") ? t.loc.name.slice(home.name.length + 1) : t.loc.name;
}

// Grows sprites a little when zoomed far out so they stay readable.
const zoomBoost = () => Math.max(1, Math.sqrt(0.9 / camera.zoom));
// Sprite width in world pixels.
const PARTY_W = { walkers: 22, raid: 22, scouts: 18, relief: 26, cart: 26, supplycart: 26, boat: 30, raft: 30, convoy: 30, supply: 30 };
const spriteW = (kind) => (PARTY_W[kind] || 28) * zoomBoost();

// 1 = right, -1 = left: toward the next tile on the path (or the far shore while crossing).
function facingOf(state, p) {
  const g = state.grid;
  const from = partyTile(p);
  const next = p.phase === "task" && p.task?.type === "cross" ? p.task.tile : p.path && p.path[p.idx + 1];
  let f = lastFacing.get(p) || 1;
  if (next != null && next !== from) {
    const dx = g.toPixel(next, HEX)[0] - g.toPixel(from, HEX)[0];
    if (Math.abs(dx) > 0.5) f = dx > 0 ? 1 : -1;
  }
  lastFacing.set(p, f);
  return f;
}

// Which sprite one of your parties gets and in what color: convoys carry crates (trade routes) or drums (supply
// runs), by truck or pulling a handcart; recon teams on foot are scouts with binoculars, relief squads march
// behind a banner.
function partyLook(state, p) {
  const color = p.kind === "convoy" ? (p.routeKind === "supply" ? SUPPLY_COLOR : ROUTE_COLOR) : PLAYER_COLOR;
  const v = p.vehicle ? vehicleById(state, p.vehicleId) : null;
  const supply = p.routeKind === "supply";
  const kind = p.kind === "convoy" ? (p.vehicle ? (supply ? "supply" : "convoy") : supply ? "supplycart" : "cart")
    : p.vehicle ? (v && v.type === "sedan" ? "sedan" : "truck") : p.mission === "recon" ? "scouts" : p.mission === "help" ? "relief" : "walkers";
  return { color, kind, count: (p.members || []).length };
}

// Oval "shadow" under a sprite: phase color for your teams, owner color for others. dashed: position is a guess;
// raid: tinted red.
function groundRing(x, y, color, dashed, raid = false) {
  const s = zoomBoost();
  ctx.beginPath();
  ctx.ellipse(x, y + 7 * s, 13 * s, 5 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = raid ? "rgba(170,30,25,0.45)" : dashed ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.35)";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash(dashed ? [3, 3] : []);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Status icon at a sprite's top right: "alert" (waiting for orders), "work", "radio", "unknown" ("?" in color).
function badge(x, y, kind, color) {
  const s = zoomBoost();
  drawMapSprite(ctx, iconCanvas(kind, color), x + 12 * s, y - 12 * s, ICON_W * s);
}

// Number badge (horde sizes): a pill with white text centered on (x, y).
function pill(x, y, text, bg, s) {
  ctx.font = `bold ${Math.round(9 * s)}px Segoe UI`;
  const h = 11 * s, w = Math.max(h, ctx.measureText(text).width + 6 * s);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  else ctx.rect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = "#0d0f12";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.fillText(text, x, y + 0.5);
}

function drawPlayerParty(state, p) {
  const g = state.grid;
  const color = p.kind === "convoy" ? "#c9e07a" : p.phase === "waiting" ? "#ffd166" : p.phase === "task" ? "#9be39b" : "#7fd0ff";
  const look = partyLook(state, p);
  const ring = p.kind === "convoy" ? look.color : PHASE_COLOR[p.phase] || "#7fd0ff";
  // Waiting or working on the spot (camp, repairs): you know where they are.
  if (p.radioLive || p.kind === "convoy" || p.phase === "waiting" || p.phase === "task") {
    let [px, py] = g.toPixel(partyTile(p), HEX);
    // Remaining path.
    ctx.strokeStyle = (p.kind === "convoy" ? look.color : color) + "aa";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = p.idx; i < p.path.length; i++) {
      const [x, y] = g.toPixel(p.path[i], HEX);
      if (i === p.idx) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    const facing = facingOf(state, p);
    const cross = p.phase === "task" && p.task && p.task.type === "cross" ? p.task : null;
    if (cross) {
      // The planned crossing, and the boat out on the water once it is launched.
      const [fx, fy] = g.toPixel(cross.from, HEX), [tx, ty] = g.toPixel(cross.tile, HEX);
      ctx.strokeStyle = "rgba(169,203,224,0.85)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      if (cross.afloat) {
        const f = Math.min(1, Math.max(0, (cross.done - cross.build + 0.5) / cross.cross));
        px = fx + (tx - fx) * f;
        py = fy + (ty - fy) * f;
        const kind = cross.mode === "raft" ? "raft" : "boat";
        const s = zoomBoost();
        drawMapSprite(ctx, wakeCanvas(), px - facing * 10 * s, py + 5 * s, 30 * s, { facing });
        drawMapSprite(ctx, partySpriteCanvas(kind, look.color), px, py, spriteW(kind), { facing });
        return;
      }
    }
    let k2 = 1;
    [px, py, k2] = besideBase(partyTile(p), px, py); // on a base's tile: beside the base, not on top of it
    const camping = p.phase === "task" && p.task && p.task.type === "camp";
    if (camping) { // tent and campfire behind the team
      const s = zoomBoost();
      drawMapSprite(ctx, campSpriteCanvas(CAMP_TENT), px + 14 * s, py - 8 * s, 26 * s);
    }
    groundRing(px, py, ring, false);
    const cvp = partySpriteCanvas(look.kind, look.color, look.count), wp = spriteW(look.kind) * k2;
    drawMapSprite(ctx, cvp, px, py - 3, wp, { facing });
    noteSprite(px, py - 3, wp, spriteH(cvp, wp));
    if (p.phase === "waiting") badge(px, py, "alert", "#ffd166");
    else if (p.phase === "task" && !camping) badge(px, py, "work");
    else if (p.kind !== "convoy" && p.radioLive && !state.timelapse) badge(px, py, "radio"); // timelapse: everything is live
    return;
  }
  // No contact: dashed planned route and an estimated position.
  ctx.strokeStyle = color + "66";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  const plan = p.planPath || p.path; // read only: the renderer never changes the sim
  plan.forEach((id, i) => {
    const [x, y] = g.toPixel(id, HEX);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  let est;
  if (p.etaOut != null) est = plannedTile(state, p); // same stepping as the sim, so it reaches the end on the arrival hour
  else {
    const elapsed = state.hour - p.departed;
    const half = p.plannedHours / 2;
    const frac = elapsed < half ? elapsed / half : Math.max(0, 1 - (elapsed - half) / half);
    est = plan[Math.min(plan.length - 1, Math.round(frac * (plan.length - 1)))];
  }
  const [tx, ty] = g.toPixel(est, HEX);
  const [ex, ey, ke] = besideBase(est, tx, ty);
  // Faded sprite on a dashed ring: where the team should be if the plan held.
  groundRing(ex, ey, color, true);
  const cve = partySpriteCanvas(look.kind, look.color, look.count), we = spriteW(look.kind) * ke;
  drawMapSprite(ctx, cve, ex, ey - 3, we, { facing: lastFacing.get(p) || 1, alpha: 0.5 });
  noteSprite(ex, ey - 3, we, spriteH(cve, we));
  badge(ex, ey, "unknown", color);
}

export function tileTooltip(state, id) {
  const t = state.tiles[id];
  const isLive = liveSet(state).has(id);
  const snap = state.knowledge[id];
  const lines = [`<b>${esc(t.loc ? t.loc.name : TERRAIN[t.terrain].name)}</b>`];
  const ownHere = state.bases.find((b) => b.tile === id);
  if (ownHere) lines.push(`<span style="color:#cfe2f7">${esc(ownHere.name)}</span>`);
  if (t.loc) {
    const def = LOCATIONS[t.loc.type], zone = SITE_ZONES[t.loc.zone || def.cat];
    lines.push(`<span class="muted">${def.name}${zone ? ` · ${zone.name.toLowerCase()}` : ""} · ${TERRAIN[t.terrain].name}${t.road ? " · road" : " · off-road"}</span>`);
    lines.push(`<span class="muted">Danger: ${DANGER_NAMES[siteDanger(t.loc)].toLowerCase()}</span>`);
  }
  else lines.push(`<span class="muted">${TERRAIN[t.terrain].name}${t.road ? " · road" : ""}</span>`);
  if (isLive) lines.push(`<span class="good">Live view</span>`);
  else if (snap) lines.push(`<span class="muted">Last seen ${ageText(state, snap)}</span>`);
  else lines.push(`<span class="muted">No current intel</span>`);
  for (const m of state.markers.filter((m) => m.tile === id)) lines.push(`${MARKER_TYPES[m.type].glyph} ${esc(m.label)} <span class="muted">· spotted ${ageText(state, m)}${m.info?.emptied ? " · emptied" : ""}</span>`);
  for (const p of state.parties.filter((p) => p.owner === "player" && p.phase === "waiting" && partyTile(p) === id)) lines.push(`<span style="color:#ffd166">Team waiting for orders</span>`);
  const held = state.survivors.filter((s) => s.alive && s.location && s.location.kind === "captive" && s.location.tile === id);
  if (held.length) lines.push(`<span style="color:#ff6b6b">Holds your people: ${held.map((s) => esc(s.name.split(" ")[0])).join(", ")}</span>`);
  return lines.join("<br>");
}

export { ageText, day, hub };
