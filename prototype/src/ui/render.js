// Canvas renderer for the State Map. Reads the simulation; never changes it.
import { PAL } from "./palette.js"; // good / bad colours (the colour-blind-safe set swaps them: ui/display.js)
import { TERRAIN, LOCATIONS, SITE_ZONES, DANGER_NAMES, siteDanger } from "../sim/data.js";
import { hub, day, factionById, RADIO_RANGE, isNight } from "../sim/world.js";
import { partyTile, plannedPos, outpostScrap, glideAt, partyMembers, clockText, reportsLive } from "../sim/parties.js";
import { contactable } from "../sim/orders.js";
import { LIGHTS, lightOf } from "../sim/lights.js"; // a team's lights glow at night
import { holdsNextHour } from "./pacing.js"; // a team holding for a tray card does not glide
import { heldUp } from "../sim/roadblocks.js"; // "Road blocked" over a team held up on the road
import { MARKER_TYPES, LAYER_OF } from "../sim/markers.js";
import { vehicleById, partyVehicles, raidHumvees } from "../sim/vehicles.js";
import { conditionsOf, CONDITIONS } from "../sim/health.js"; // a lone walker's limp
import { BUILDINGS, count, tierUpJob, gatherCap, isCamp, CAMP } from "../sim/buildings.js";
import { weatherTint, season, iceRow } from "../sim/weather.js";
import { drawFronts, weatherTipLines } from "./wxmap.js"; // weather fronts over the land, frozen rivers in the tooltip
import { radioNodes } from "../sim/radio.js";
import { tunedNetworks } from "../sim/radiolisten.js"; // a channel you listen in on: its coverage in the group's colour
import { heatInfo } from "../sim/fieldheat.js";
import { HIVE } from "../sim/hiveconst.js";
import { buildSiteLabel, isMarked } from "../sim/hivebirth.js"; // a build site's days to a hive, a marked gathering
import { festivalNow } from "../sim/festival.js"; // the hub's harvest festival: extra fires
import { activeCrashes, daysLeft, crashTip } from "../sim/crashes.js";
import { activeConvoys, convoyDaysLeft, convoyTip } from "../sim/miltrucks.js";
import { rumoursOf, surveyTip } from "../sim/survey.js";
import { hasKey } from "../sim/locks.js";
import { lootBand, LOOT_BANDS } from "../sim/aiscav.js";
import { jobPins } from "./diplomacy.js";
import { inCoverage } from "../sim/radio.js";
import { visitorTipLines } from "../sim/visitors.js";
import { caravanTipLines } from "../sim/caravanraids.js"; // the groups' caravans and convoys you can see
import { hcMapBands, bandTipLines } from "../sim/hardcore-groups.js";
import { stagingTip } from "../sim/staging.js";
import { unseenOutpost } from "../sim/hiding.js"; // the groups' hidden outposts
import { siteKnown, hiddenSites, searchedVersion, searchedDay } from "../sim/discovery.js";
import { countedMembers, baseRadius, controlRadius, ALLIANCE } from "../sim/alliance.js";
import { claimText, wellText } from "../sim/claims.js"; // land claims: the Territory layer and the hover text
import { drawFieldWorks, fwTooltipLine } from "./fieldworks.js"; // field works: sprites, the tile picker, hover lines
import { outsiderPartyCanvas, OUTSIDER_COLORS, ruinSpriteCanvas, emptyBaseSpriteCanvas } from "./mapsprites.js";
import { occupyPreview } from "../sim/occupy.js"; // empty bases: the tooltip
import { redSkullCanvas, wallbreakerMapCanvas, siteSpriteCanvas, growthCanvas } from "./hivesprites.js";
import {
  partySpriteCanvas, upsCode, drawMapSprite, baseSpriteCanvas, factionBaseCanvas, campSpriteCanvas, markerSpriteCanvas, poiSpriteCanvas, skullCanvas, stagingSpriteCanvas,
  groupPartyCanvas, siegeCampCanvas, hordeSpriteCanvas, herdSpriteCanvas, hiveSpriteCanvas, iconCanvas, wakeCanvas, bridgeCanvas, gridW, searchSmokeCanvas,
  soloSpriteCanvas, cyclistSpriteCanvas, groupSoloCanvas, soloKind, outsiderSoloCanvas,
} from "./mapsprites.js";
import { deco, decoAlpha, decoAtlas, decoScale, waterTexture, waterPattern, placeDecor, drawDecor, SEASON_LOOK } from "./terraindeco.js";
import { drawMapNotes, noteTip, notesHash } from "./mapnotes.js"; // the player's own notes on the map (sim/mapnotes.js)
import { blocOf, blocColorOf } from "../sim/blocs.js"; // AI blocs: a ring in the bloc's colour round its members' bases
import { drawWorkers } from "./workermap.js"; // your bases' people out on job trips (sim/jobtrips.js), the groups' walkers
import { drawNight } from "./nightfx.js"; // the time-of-day shade and the lights through it
import { lightningFrame, drawLightning, lightningWants } from "./lightningfx.js"; // lightning in storms: lifts the night shade, flashes after it

export const HEX = 26;
const BRIDGE_W = Math.round(HEX * Math.sqrt(3)); // a bridge's deck spans the hex edge to edge along the road (ui/mapsprites.js paintBridge)

export const camera = { x: 0, y: 0, zoom: 1 };
const DEFAULT_LAYERS = ["pois", "territory", "teams", "workers", "hordes", "deaths", "vehicles", "finds", "weather"];
// hourFrac: how much of the coming hour has gone by (main.js): your moving teams glide between tiles by it.
export const view = { selected: -1, hover: -1, preview: null, devReveal: false, layers: new Set(DEFAULT_LAYERS), hourFrac: 0, clockSpeed: 1, pick: null, workerHover: null }; // pick: "kind:id" ringed in gold (ui/mapselect.js)
const on = (k) => view.layers.has(k);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// A new world starts with the default view: nothing selected, the fog back on, the standard layers, zoom 1.
export function resetView() {
  view.selected = -1;
  view.pick = null;
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
// The site on a tile as the player may see it (sim/discovery.js: a hidden site nobody has found is bare ground), or
// null. Dev Reveal and the timelapse show every site.
export const mapLoc = (state, id) => {
  const t = state.tiles[id];
  return t && t.loc && (siteKnown(state, id) || liveSet(state).has(id)) ? t.loc : null;
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
  forceDraw = true;
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

// ---------- cached map layers ----------
// The ground (terrain, weather wash, infection, territory, roads, bridges, hive land with its ring skulls) and the
// sites (plates, sprites, far-out dots, other groups' bases) are drawn into offscreen square chunks of device pixels,
// laid out on the world at the current zoom, so a frame copies a few images instead of filling thousands of
// hexes. Every drawn frame a pass over the tiles works out what each tile shows as far as you know (fog, owner,
// infection, hive land, the site's look); a tile that changed marks only the chunks it touches, and those are drawn
// again when they are next on screen. A change that touches everything (another world, a layer switched, the
// weather wash, the device pixel ratio) drops the cache. Chunks are kept per zoom level (a few levels, oldest
// dropped first), so zooming back and forth and panning reuse them. Things that move or pulse (parties, hordes,
// hives, markers, your bases, a besieged group base, names, hover, selection, the planner's path) are drawn on top
// every frame. When nothing changed and nothing pulses, the frame is not drawn at all (the canvas keeps the last one).
// Device pixels per side of a chunk: 512 up close, smaller when zoomed out so a chunk never holds too many tiles
// (a change redraws less).
const chunkSize = (S) => 64 * Math.max(2, Math.min(8, Math.round(S * 6)));
const BG = "#0d0f12";      // the map's background (off the map)
const IDLE_MS = 250;       // nothing seems to change: draw this often anyway (catches changes the frame check misses)
const ANIM_MS = 25;        // only a pulse animates (a live hive, a siege): about 40 frames a second
const REACH = HEX + 1.5;   // how far a tile's ground drawing reaches from its center (hexes are drawn at HEX + 0.5)
const ROAD_REACH = HEX * Math.sqrt(3) + 3; // a road runs to the next tile's center
const SHADES = [1, 0.72, 0.42]; // terrain brightness: live, known from a report, unknown
const FAR = 1 << 20;       // hive distance when there is no hive
const MAX_LEVELS = 4;      // zoom levels kept

let lastFrac = 0; // the clock's minutes at the last frame: the fronts glide while they change
let curS = 1; // device pixels per world pixel this frame: passed to drawMapSprite so it need not read the transform
const sprite = (cv, x, y, w, o) => drawMapSprite(ctx, cv, x, y, w, o, curS);
// ---------- animation ----------
// The sprites are single cached canvases; they come alive by motion and small overlays drawn each frame: teams and
// parties on the move bob in step (vehicles rumble and raise dust), boats rock, live hordes shamble, herds graze,
// campfires flicker and smoke, inhabited bases smoke from the hearth, a crash's smoke drifts, badges pulse. Each wants
// frames at SLOW_MS (about 15 a second) while it is on screen (wantFrames); nothing animated on screen: the map
// draws only when something changes (IDLE_MS). anim.on (Settings, Map animations) turns it all off.
export const anim = { on: true };
export const setMapAnim = (v) => { anim.on = !!v; forceDraw = true; };
// Readability (Menu → Options → Display, ui/display.js): text drawn on the map (names, badges, crew tags) this many
// times bigger; still: reduce motion (teams jump from tile to tile instead of gliding, nothing pulses).
export const readable = { text: 1, still: false };
export const setReadable = (o) => { Object.assign(readable, o); forceDraw = true; };
const hourFrac = () => (readable.still ? 0 : view.hourFrac || 0);
const SLOW_MS = 66;
let animNeed = Infinity;   // this frame: the shortest frame gap an animation on screen wants
let animNow = 0;           // this frame's clock (ms)
const wantFrames = (ms = SLOW_MS) => { if (ms < animNeed) animNeed = ms; };
const phaseOf = (k) => (((Math.imul(k | 0, 2654435761) >>> 0) % 1000) / 1000); // a fixed offset per thing, so they do not move in lockstep
const animOn = () => anim.on && !lastTimelapse;
let lastTimelapse = false;
// A step's bob (map px, up is negative): |sin| over a step of periodMs.
function stepBob(k, amp, periodMs = 380) {
  if (!animOn()) return 0;
  wantFrames();
  const t = (animNow / periodMs + phaseOf(k)) % 1;
  return -Math.abs(Math.sin(t * Math.PI)) * amp;
}
// A slow sway (radians), and a matching small bob, for the shambling dead and grazing herds.
function sway(k, amp, periodMs) {
  if (!animOn()) return 0;
  wantFrames();
  return Math.sin((animNow / periodMs + phaseOf(k)) * Math.PI * 2) * amp;
}
// A lone walker's frame (mapsprites.js paintSolo), in step with stepBob over the same period: standing still 0; on the
// way the two strides (1, 3) at the low points of the bob and the passing step (2) at its top. Animations off: a stride, held.
// A limp ("limp"): over two steps, a long stride onto the good leg, the passing step, a short dragged step on the hurt
// one (frame 4), the passing step.
function walkFrame(k, moving, periodMs = 380, gait = "") {
  if (!moving) return 0;
  if (!animOn()) return gait === "limp" ? 4 : 1;
  wantFrames();
  const u = animNow / periodMs + phaseOf(k), t = u % 1;
  if (gait === "limp") { const c = (u / 2) % 1; return c < 0.4 ? 1 : c < 0.5 ? 2 : c < 0.8 ? 4 : 2; }
  return t >= 0.25 && t < 0.75 ? 2 : Math.floor(u + 0.25) % 2 ? 3 : 1;
}
// A lone cyclist's pedalling frame (mapsprites.js paintCyclist): 0 stopped, then 1 and 2 by turns.
function pedalFrame(k, moving, periodMs = 240) {
  if (!moving) return 0;
  if (!animOn()) return 1;
  wantFrames();
  return Math.floor(animNow / periodMs + phaseOf(k) * 2) % 2 ? 2 : 1;
}
// An engine's rumble: a fraction of a pixel of jitter, a few times a second.
function rumble(k, amp) {
  if (!animOn()) return 0;
  wantFrames();
  return (Math.floor(animNow / 90 + phaseOf(k) * 7) % 2 ? amp : -amp);
}
// Rising smoke from (x, y): n puffs that grow, drift and fade as they climb `rise` map px.
function smokeWisps(k, x, y, s, { n = 3, rise = 16, color = "170,170,165", alpha = 0.35, periodMs = 2400 } = {}) {
  if (!animOn()) return;
  wantFrames();
  const ph = phaseOf(k);
  for (let i = 0; i < n; i++) {
    const t = (animNow / periodMs + i / n + ph) % 1;
    const px = x + Math.sin(t * 5 + ph * 9) * 1.6 * s + t * 3 * s, py = y - t * rise * s, r = (0.9 + t * 2.4) * s;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${color},${(alpha * (1 - t) * Math.min(1, t * 5)).toFixed(3)})`;
    ctx.fill();
  }
}
// A fire's flicker: a warm glow that breathes, and a spark now and then rising from it.
function fireGlow(k, x, y, s) {
  if (!animOn()) return;
  wantFrames();
  const ph = phaseOf(k), f = 0.5 + 0.25 * Math.sin(animNow / 110 + ph * 20) + 0.25 * Math.sin(animNow / 47 + ph * 7);
  ctx.beginPath();
  ctx.ellipse(x, y, (3.2 + f) * s, (2.2 + f * 0.6) * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,150,60,${(0.12 + f * 0.16).toFixed(3)})`;
  ctx.fill();
  const t = (animNow / 700 + ph) % 1;
  if (t < 0.6) { ctx.fillStyle = `rgba(255,200,90,${(0.8 * (1 - t / 0.6)).toFixed(3)})`; ctx.fillRect(x + Math.sin(t * 9 + ph * 5) * 1.2 * s - 0.4 * s, y - (1 + t * 7) * s, 0.8 * s, 0.8 * s); }
}
// Dust behind a vehicle on the move (facing: +1 heading east, -1 west).
function dustTrail(k, x, y, s, facing, w) {
  if (!animOn()) return;
  wantFrames();
  for (let i = 0; i < 3; i++) {
    const t = (animNow / 650 + i / 3 + phaseOf(k)) % 1;
    ctx.beginPath();
    ctx.arc(x - facing * (w / 2 + t * 9 * s), y - t * 2.5 * s, (1 + t * 2.2) * s, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(160,140,110,${(0.32 * (1 - t)).toFixed(3)})`;
    ctx.fill();
  }
}
// A point on a sprite's painter grid (gx, gy: mapsprites.js painter cells) as drawn at (cx, cy), w wide.
function gridPoint(cv, cx, cy, w, gx, gy, facing = 1) {
  const gw = gridW(cv) || 1, u = w / gw, h = spriteH(cv, w);
  const lx = (gx + 0.5) * u - w / 2;
  return [cx + (facing < 0 ? -lx : lx), cy - h / 2 + (gy + 0.5) * u];
}


// Per-world data that never changes (tile centers, terrain colors, bridges, which tiles are sites) plus the arrays
// the per-frame pass fills, allocated once so a frame allocates nothing that grows with the map.
let geo = null;
function geometry(state) {
  const g = state.grid, tiles = state.tiles;
  if (geo && geo.tiles === tiles && geo.grid === g && geo.n === tiles.length) return geo;
  const n = tiles.length, keys = Object.keys(TERRAIN);
  const G = {
    tiles, grid: g, n, cols: g.width, rows: g.height,
    x: new Float64Array(n), y: new Float64Array(n), q: new Int32Array(n), r: new Int32Array(n),
    color: new Int32Array(n), water: new Uint8Array(n), angle: new Float64Array(n).fill(NaN), sites: [],
    terrColors: [], ownerIds: new Map(), ownerColors: [null],
    // What each tile shows: bits 0-1 fog (0 live, 1 reported, 2 unknown), 2-3 hive land (0 hive, 1 ring, 2 land,
    // 3 none), 4+ owner color (0 none). inf: infection as known (-1 none).
    key: new Int32Array(n).fill(-1), inf: new Float64Array(n).fill(-2), nkey: new Int32Array(n), ninf: new Float64Array(n),
    hives: new Int32Array(n), nHives: 0, oldHives: new Int32Array(n), nOld: -1, dist: new Int32Array(n).fill(FAR),
    hordeT: new Int32Array(n), nHorde: 0, buildT: new Int32Array(n), nBuild: 0,
    siteCode: new Int32Array(n).fill(-1), siteDesc: new Array(n).fill(null), descZoom: NaN,
    list: new Int32Array(n), roads: new Int32Array(n), buckets: [],
    // Terrain detail (ui/terraindeco.js): decal placements (made the first time they are drawn), and the tiles whose
    // clear zone is in use (a site, base, hive or hive build site is drawn there), as a flag and a list.
    deco: null, clr: new Uint8Array(n), clrAt: new Int32Array(n), clrGen: 0, clrList: new Int32Array(n), nClr: 0, clrNew: new Int32Array(n),
    // The overlays worked out only when their data changes (see updateKnown, updateCoalition): the six neighbours of
    // each tile (-1 off the map), how each tile shows on the Known area layer (0 not searched, 1 long ago, 2 lately),
    // its coalition owner (0 none, 1 you, 2+ a member) and whether it is within the coalition's reach (water too).
    nb: new Int32Array(n * 6).fill(-1), srch: new Uint8Array(n), srchSig: null, nSrch: 0,
    coal: new Uint8Array(n), coalIn: new Uint8Array(n), coalSig: null, coalColors: [], nCoal: 0,
    // Ruins you know of (shown 1, yours 2) and empty bases you know of (a group's 3, your old outpost 4: sim/groupworld.js
    // state.abandoned, as your live view or last report shows it), and the list of them this frame.
    ruin: new Uint8Array(n), ruinT: new Int32Array(n), nRuin: 0,
  };
  for (let i = 0; i < n; i++) {
    const t = tiles[i];
    [G.x[i], G.y[i]] = g.toPixel(t.id, HEX);
    [G.q[i], G.r[i]] = g.cube(t.id);
    G.color[i] = Math.max(0, keys.indexOf(t.terrain)) * 3;
    G.water[i] = t.terrain === "water" ? 1 : 0;
    g.neighbors(t.id).forEach((m, j) => (G.nb[i * 6 + j] = m));
    if (t.loc && !t.loc.crash && !t.loc.convoy) G.sites.push(i); // crash sites and convoys come and go: drawn on their own (sim/crashes.js, sim/miltrucks.js)
    if (t.bridge) {
      const [a, b] = t.roadLinks.length > 1 ? t.roadLinks : [t.id, t.roadLinks[0] ?? t.id];
      const [ax, ay] = g.toPixel(a, HEX), [bx, by] = g.toPixel(b, HEX);
      G.angle[i] = ax === bx && ay === by ? 0 : Math.atan2(by - ay, bx - ax);
    }
  }
  for (const k of keys) for (const f of SHADES) G.terrColors.push(shade(TERRAIN[k].color, f));
  G.waterIdx = keys.indexOf("water");
  for (let i = 0; i < G.terrColors.length; i++) G.buckets.push([]);
  geo = G;
  dropCache();
  return G;
}
const ownerId = (G, color) => {
  let id = G.ownerIds.get(color);
  if (!id) { id = G.ownerColors.length; G.ownerIds.set(color, id); G.ownerColors.push(color); }
  return id;
};

// Chunk cache: zoom -> { zoom, S, C (chunk side), chunks: Map(key -> { cv, dirty, empty, used }), used }.
const levels = new Map();
const pool = [];           // canvases of dropped chunks, reused
let cacheKey = "", cacheDpr = 0, frameNo = 0;
// Chunks that only show something out of date (a tile changed, the weather wash) are drawn again within this many
// ms a frame, the rest on the next frames; chunks that have never been drawn are always drawn at once.
export const mapTuning = { budgetMs: 3 };
// Counters for performance checks (frames drawn and skipped, chunks drawn and the ms spent on them).
export const mapStats = { drawn: 0, skipped: 0, chunks: 0, chunkMs: 0 };
const ckey = (i, j) => (i + 1024) * 4096 + (j + 1024);
function dropLevel(L) {
  for (const ch of L.chunks.values()) if (ch.cv) pool.push(ch.cv);
  L.chunks.clear();
}
// Everything is to be drawn again (the weather wash or a layer changed), reusing the chunks' canvases.
function dirtyAll() {
  for (const L of levels.values()) for (const ch of L.chunks.values()) ch.dirty = true;
}
function dropCache() {
  for (const L of levels.values()) dropLevel(L);
  levels.clear();
}
function levelFor(zoom, S) {
  let L = levels.get(zoom);
  if (!L) {
    L = { zoom, S, C: chunkSize(S), chunks: new Map(), used: 0 };
    levels.set(zoom, L);
    if (levels.size > MAX_LEVELS) {
      let old = null;
      for (const x of levels.values()) if (x !== L && (!old || x.used < old.used)) old = x;
      dropLevel(old);
      levels.delete(old.zoom);
    }
  }
  L.used = frameNo;
  return L;
}
// Marks the chunks under a world rectangle (every kept zoom level) to be drawn again.
function markDirty(x0, y0, x1, y1) {
  for (const L of levels.values()) {
    if (!L.chunks.size) continue;
    const S = L.S, C = L.C, i0 = Math.floor((x0 * S) / C), i1 = Math.floor((x1 * S) / C), j0 = Math.floor((y0 * S) / C), j1 = Math.floor((y1 * S) / C);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const ch = L.chunks.get(ckey(i, j)); if (ch) ch.dirty = true; }
  }
}
// A site's look changed: its sprites grow when zoomed out, so each level gets a reach that covers them there.
function markSite(px, py) {
  for (const L of levels.values()) {
    if (!L.chunks.size) continue;
    const r = 64 * Math.max(1, Math.sqrt(0.9 / L.zoom)) + 8, S = L.S, C = L.C;
    const i0 = Math.floor(((px - r) * S) / C), i1 = Math.floor(((px + r) * S) / C), j0 = Math.floor(((py - r) * S) / C), j1 = Math.floor(((py + r) * S) / C);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const ch = L.chunks.get(ckey(i, j)); if (ch) ch.dirty = true; }
  }
}
// Tile ids (ascending) whose centers lie in a world rectangle, into out; returns the count.
function tilesIn(G, x0, y0, x1, y1, out) {
  const rowH = HEX * 1.5, colW = HEX * Math.sqrt(3);
  const r0 = Math.max(0, Math.ceil(y0 / rowH)), r1 = Math.min(G.rows - 1, Math.floor(y1 / rowH));
  let n = 0;
  for (let r = r0; r <= r1; r++) {
    const off = 0.5 * (r & 1);
    const c0 = Math.max(0, Math.ceil(x0 / colW - off)), c1 = Math.min(G.cols - 1, Math.floor(x1 / colW - off));
    for (let c = c0; c <= c1; c++) out[n++] = r * G.cols + c;
  }
  return n;
}

// This frame's switches for the cached layers.
// deco: how much terrain detail shows (0 flat .. 1, ui/terraindeco.js decoAlpha), dsc its atlas scale, snow: the
// snow-capped decals (the weather's snow-cover wash is on); season: broadleaf trees green, turning or bare.
const F = { zoom: 1, tint: null, iceRow: -1, infOn: false, terrOn: false, hordesOn: false, poisOn: false, knownOn: false, coalOn: false, ringSkulls: false, deco: 0, dsc: null, snow: false, season: "spring" };
const WATER_RGB = [1, 3, 5].map((k) => parseInt(TERRAIN.water.color.slice(k, k + 2), 16));
const ICE_FILL = ["rgba(214,232,244,0.88)", "rgba(170,188,200,0.7)", "rgba(110,122,132,0.5)"]; // frozen river: live, reported, unknown
const DECO_REACH = 35; // a tile's decals reach at most this far from its center (terraindeco.js MAX_REACH + 1)
// The current world's decal placement (ui/terraindeco.js placeDecor), for the headless tools.
export const mapDecor = () => (geo ? geo.deco : null);
const reach = () => (F.deco > 0 ? Math.max(REACH, geo && geo.deco ? geo.deco.reach : DECO_REACH) : REACH);
const ownerColor = new Map(), fbAt = new Map(), factionIdx = new Map(), besiegedFb = new Set();

// ---------- overlays worked out only when their data changes ----------
// Known area (sim/discovery.js state.searched): searched within the last KNOWN_RECENT days shows stronger. Worked
// out again when a report adds searched tiles (searchedVersion), another world or save is loaded, or a day passes;
// the chunks of tiles whose shading changed are drawn again. Counts for the tools in overlayStats.
export const KNOWN_RECENT = 30;
export const overlayStats = { known: 0, coalition: 0 };
// What the last drawn frame holds on the overlays, for the headless tools: ruins drawn (tile ids), tiles shaded as
// searched (1 long ago, 2 lately) and coalition owners per tile.
export const mapOverlay = () => (geo ? { ruins: Array.from(geo.ruinT.subarray(0, geo.nRuin)).filter((id) => geo.ruin[id] <= 2), empty: Array.from(geo.ruinT.subarray(0, geo.nRuin)).filter((id) => geo.ruin[id] >= 3), srch: geo.srch, coal: geo.coal, nSrch: geo.nSrch, nCoal: geo.nCoal } : null);
function updateKnown(state) {
  const G = geo, s = state.searched || null, d = day(state);
  const sig = G.srchSig;
  if (sig && sig.arr === s && sig.rev === searchedVersion() && sig.day === d) return;
  G.srchSig = { arr: s, rev: searchedVersion(), day: d };
  overlayStats.known++;
  let n = 0;
  for (let i = 0; i < G.n; i++) {
    const v = s && i < s.length ? s[i] : 0, lvl = !v ? 0 : d - v < KNOWN_RECENT ? 2 : 1;
    if (lvl) n++;
    if (lvl !== G.srch[i]) { G.srch[i] = lvl; markDirty(G.x[i] - REACH, G.y[i] - REACH, G.x[i] + REACH, G.y[i] + REACH); }
  }
  G.nSrch = n;
}

// Coalition land (sim/alliance.js controlledLand): the same land tiles, each given to the nearest centre's owner
// (you first on a tie, then the members in order), memoized by the centres and the members' colors so a frame only
// builds a short key. owner: 0 none, 1 you, 2 + i member i; within: 1 for every tile in reach (water too: it closes
// the outer border over rivers and lakes).
let coalMemo = null;
function coalitionCentres(state) {
  const ms = countedMembers(state); // the members whose land counts (alliance.js memberLand: a year in, at peace)
  const out = state.bases.map((b) => ({ tile: b.tile, r: baseRadius(state, b), o: 1 }));
  ms.forEach((f, i) => { for (const t of f.bases) out.push({ tile: t, r: controlRadius(state, "outpost"), o: 2 + i }); });
  return { out, ms };
}
export function coalitionLand(state) {
  const { out, ms } = coalitionCentres(state);
  const key = `${state.tiles.length}|${out.map((c) => `${c.tile}:${c.r}:${c.o}`).join(",")}|${ms.map((f) => `${f.id}${f.color}`).join(",")}`;
  if (coalMemo && coalMemo.key === key && coalMemo.tiles === state.tiles) return coalMemo;
  overlayStats.coalition++;
  const g = state.grid, n = state.tiles.length;
  const owner = new Uint8Array(n), within = new Uint8Array(n), best = new Int32Array(n).fill(1 << 30);
  for (const c of out) for (const id of g.within(c.tile, c.r)) {
    const dd = g.distance(c.tile, id);
    within[id] = 1;
    if (dd < best[id] || (dd === best[id] && c.o < owner[id])) { best[id] = dd; owner[id] = c.o; }
  }
  let land = 0, held = 0;
  for (let i = 0; i < n; i++) {
    if (state.tiles[i].terrain === "water") { owner[i] = 0; continue; }
    land++;
    if (owner[i]) held++;
  }
  const owners = [null, { name: "You", color: PLAYER_COLOR }, ...ms.map((f) => ({ name: f.name, color: f.color, id: f.id }))];
  coalMemo = { key, tiles: state.tiles, owner, within, held, land, pct: land ? held / land : 0, goal: ALLIANCE.LAND_NEEDED, owners };
  return coalMemo;
}
function updateCoalition(state) {
  const G = geo, C = coalitionLand(state);
  if (G.coalSig === C) return;
  G.coalSig = C;
  G.coalColors = C.owners.map((o) => (o ? o.color : null));
  let n = 0;
  const R = REACH + HEX; // a border runs along the edge it shares with a neighbour: redraw a little wider
  for (let i = 0; i < G.n; i++) {
    if (C.owner[i]) n++;
    if (C.owner[i] !== G.coal[i] || C.within[i] !== G.coalIn[i]) {
      G.coal[i] = C.owner[i];
      G.coalIn[i] = C.within[i];
      markDirty(G.x[i] - R, G.y[i] - R, G.x[i] + R, G.y[i] + R);
    }
  }
  G.nCoal = n;
}

// Ruins (sim/conquest.js, factions.js tile.ruin): a ruin you can see, or one burned before your last look at the
// tile (a report from before it burned still shows what stood there). The timelapse shows its frame's ruins.
export function ruinKnown(state, id, live = liveSet(state)) {
  const t = state.tiles[id];
  if (!t || !t.ruin) return false;
  if (live.has(id)) return true;
  const snap = state.knowledge && state.knowledge[id];
  return !!snap && (t.ruin.day == null || snap.hour >= (t.ruin.day - 1) * 24);
}
// An empty base you know of (sim/groupworld.js state.abandoned): in view, the record itself; out of view, your last report
// of the tile (it may have been taken or fallen in since). null: none known there.
export function emptyKnown(state, id, live = liveSet(state)) {
  if (state.bases.some((b) => b.tile === id)) return null;
  if (live.has(id)) return (state.abandoned || []).find((r) => r.tile === id) || null;
  const snap = state.knowledge && state.knowledge[id];
  return (snap && snap.abandoned) || null;
}
// "Empty: Oak Hill Outpost" (your old one) or "Empty base (Long Haul Co.)".
export const emptyTitle = (em) => (em.from === "player" ? `Empty: ${em.fromName}` : `Empty base (${em.fromName})`);
// "Ruins of Oak Hill Outpost"; open ground keeps its name out of it ("Ruins of a burned base").
export function ruinTitle(ruin) {
  const name = ruin && ruin.name ? String(ruin.name) : "";
  return !name || /\(\d+,\d+\)$/.test(name) ? "Ruins of a burned base" : `Ruins of ${name}`;
}
// What the tile panel and tooltip say about a ruin you know of: its title, who burned it and when, the danger (the
// site's, at least 3 on a known hive's land, as the map's skulls), the salvage left as you know it and what an
// outpost there costs (sim/parties.js outpostScrap: 5 scrap on the ruins).
export function ruinInfo(state, id) {
  const t = state.tiles[id], live = liveSet(state);
  if (!ruinKnown(state, id, live)) return null;
  const isLive = live.has(id), snap = state.knowledge && state.knowledge[id];
  const loot = isLive ? t.loot : snap ? snap.loot : null;
  const G = geo && geo.tiles === state.tiles ? geo : null;
  const inHive = G && G.nHives > 0 && G.dist[id] <= HIVE.TERRITORY;
  const danger = Math.max(siteDanger(mapLoc(state, id)), inHive ? 3 : 0);
  const r = t.ruin;
  return {
    title: ruinTitle(r), by: r.by || "raiders", day: r.day, yours: !!r.yours, from: r.from && r.from !== "you" ? r.from : "",
    danger, dangerName: DANGER_NAMES[danger], salvage: LOOT_BANDS[lootBand(t, loot)], salvageLive: isLive, scrap: CAMP.ruinScrap, // a camp here builds up for less scrap (sim/buildings.js tierUpJobFor)
  };
}

// The per-frame pass: what every tile shows as far as you know (never more: `live` decides), the hives, hordes and
// hive build sites you know about, and the look of every site. Marks what changed.
function scanTiles(state, live, k, hordeAt, siteAt, busy, ownBase) {
  const G = geo, tiles = state.tiles, n = G.n;
  ownerColor.clear();
  for (const f of state.factions) if (!ownerColor.has(f.id)) ownerColor.set(f.id, f.color);
  let nh = 0, nhz = 0, nbs = 0, nr = 0;
  const emptyAt = new Map((state.abandoned || []).map((r) => [r.tile, r]));
  for (let i = 0; i < n; i++) {
    const t = tiles[i], isLive = live.has(i), snap = isLive ? null : k[i];
    let key = isLive ? 0 : snap ? 1 : 2, inf = -1;
    // A ruin you know of (ruinKnown, inlined): drawn with the sites (Locations layer) in place of whatever stood there.
    // Else an empty base as you know of it (emptyKnown, inlined): in view, or in your last report of the tile.
    const em = !ownBase.has(i) && key < 2 ? (isLive ? emptyAt.get(i) : snap.abandoned) : null;
    const ru = F.poisOn && t.ruin && key < 2 && !ownBase.has(i) && (isLive || t.ruin.day == null || snap.hour >= (t.ruin.day - 1) * 24) ? (t.ruin.yours ? 2 : 1)
      : F.poisOn && em ? (em.from === "player" ? 4 : 3) : 0;
    if (ru) G.ruinT[nr++] = i;
    if (ru !== G.ruin[i]) {
      if (G.ruin[i]) markSite(G.x[i], G.y[i]);
      G.ruin[i] = ru;
      if (ru) markSite(G.x[i], G.y[i]);
    }
    if (key < 2) {
      if (F.infOn) inf = isLive ? t.infection : snap.infection;
      if (F.terrOn) {
        const owner = isLive ? t.owner : snap.owner;
        const claim = state.claims ? state.claims[i] : null; // sim/claims.js: your claims are always known to you
        if (claim && claim.owner === "player") key |= ownerId(G, CLAIM_COLOR) << 4;
        else if (owner != null) {
          const color = owner === "player" ? PLAYER_COLOR : ownerColor.get(owner);
          if (color) key |= ownerId(G, color) << 4;
        }
      }
      if (isLive ? t.hive : snap.hive) G.hives[nh++] = i;
      if (isLive ? hordeAt.has(i) : snap.hordeSize) G.hordeT[nhz++] = i;
      if (isLive ? siteAt.has(i) : snap.site) G.buildT[nbs++] = i;
    }
    G.nkey[i] = key;
    G.ninf[i] = inf;
  }
  G.nHives = nh; G.nHorde = nhz; G.nBuild = nbs; G.nRuin = nr;
  // Distance to the nearest known hive, worked out again only when the hives you know about change.
  let same = nh === G.nOld;
  for (let a = 0; same && a < nh; a++) same = G.hives[a] === G.oldHives[a];
  if (!same) {
    G.oldHives.set(G.hives.subarray(0, nh));
    G.nOld = nh;
    for (let i = 0; i < n; i++) {
      let d = FAR;
      for (let a = 0; a < nh; a++) {
        const h = G.hives[a], dq = G.q[i] - G.q[h], dr = G.r[i] - G.r[h], x = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
        if (x < d) d = x;
      }
      G.dist[i] = d;
    }
  }
  for (let i = 0; i < n; i++) {
    let key = G.nkey[i];
    if (F.hordesOn && nh) { const d = G.dist[i]; key |= (d === 0 ? 0 : d <= HIVE.RING ? 1 : d <= HIVE.TERRITORY ? 2 : 3) << 2; }
    else key |= 3 << 2;
    const inf = G.ninf[i], was = G.inf[i];
    if (key !== G.key[i] || (inf !== was && !(inf !== inf && was !== was))) {
      G.key[i] = key;
      G.inf[i] = inf;
      markDirty(G.x[i] - REACH, G.y[i] - REACH, G.x[i] + REACH, G.y[i] + REACH);
    }
  }
  // Sites: a code for how each looks (0 not drawn; low bits 1 group base, 3 site; 4 busy, 8 faded or besieged;
  // 16 and up the group, or for a site its loot band). A changed code redraws the chunks around it; a new zoom only works out the sizes again.
  fbAt.clear(); factionIdx.clear(); besiegedFb.clear();
  state.factions.forEach((f, i) => {
    factionIdx.set(f, i);
    if (f.alive) for (const b of f.bases) if (!fbAt.has(b) && !unseenOutpost(state, b)) fbAt.set(b, f); // sim/hiding.js: a hidden outpost you have not found
  });
  for (const q of state.parties) if (q.phase === "siege" && q.target && q.target.kind === "faction") besiegedFb.add(q.target.tile);
  const rezoom = G.descZoom !== F.zoom;
  G.descZoom = F.zoom;
  for (const id of G.sites) {
    const t = tiles[id];
    let code = 0, fb = null;
    // A hidden site nobody has found (sim/discovery.js) is not drawn at all; found, its code changes and the chunks
    // around it are drawn again.
    if (!ownBase.has(id) && !G.ruin[id] && (live.has(id) || siteKnown(state, id))) {
      const isLive = live.has(id), snap = isLive ? null : k[id];
      fb = isLive ? fbAt.get(id) : snap && snap.factionBase ? factionById(state, snap.factionBase) : null;
      if (fb) code = 1 | ((factionIdx.get(fb) + 1) << 4) | (isLive && besiegedFb.has(id) ? 8 : 0) | (blocNo(state, fb) << 16); // sim/blocs.js: its bloc's ring
      else if (F.poisOn) {
        // Loot as you know it: the real value only for a tile in view, the last report otherwise; never-seen sites look
        // untouched. The sprite fades by the loot band (aiscav.js: rich, some, little, picked clean; bits 16 and 32).
        const loot = state.timelapse ? null : isLive ? t.loot : snap ? snap.loot : null;
        const band = loot == null || t.loc.type === "city" || t.loc.type === "town" ? 0 : lootBand(t, loot);
        code = 3 | (busy.has(id) ? 4 : 0) | (band >= 2 ? 8 : 0) | (band << 4);
      }
    }
    if (code !== G.siteCode[id]) {
      if (G.siteCode[id] > 0) markSite(G.x[id], G.y[id]);
      G.siteCode[id] = code;
      G.siteDesc[id] = code ? siteDesc(state, id, code, fb) : null;
      if (code) markSite(G.x[id], G.y[id]);
    } else if (rezoom && code) G.siteDesc[id] = siteDesc(state, id, code, fb);
  }
  // Clear zones of the terrain decals: tiles drawn with a site, a base, a hive or a hive build site keep their decals
  // (and those under the name hanging down from them) out of the way. A change redraws the chunks around it.
  const gen = ++G.clrGen;
  let nn = 0;
  const keep = (i) => { if (G.clrAt[i] !== gen) { G.clrAt[i] = gen; G.clrNew[nn++] = i; } };
  for (const id of G.sites) if (G.siteCode[id] > 0) keep(id);
  for (const id of ownBase) keep(id);
  for (let a = 0; a < nh; a++) keep(G.hives[a]);
  for (let a = 0; a < nbs; a++) keep(G.buildT[a]);
  for (let a = 0; a < nr; a++) keep(G.ruinT[a]);
  for (let a = 0; a < nn; a++) { const i = G.clrNew[a]; if (!G.clr[i]) { G.clr[i] = 1; markClear(i); } }
  for (let a = 0; a < G.nClr; a++) { const i = G.clrList[a]; if (G.clrAt[i] !== gen) { G.clr[i] = 0; markClear(i); } }
  const t = G.clrList; G.clrList = G.clrNew; G.clrNew = t; G.nClr = nn;
}
// A tile's clear zone switched (ui/terraindeco.js CLEAR_ZONE): the decals of it and its neighbours that touch the zone.
const markClear = (i) => markDirty(geo.x[i] - 52, geo.y[i] - 48, geo.x[i] + 52, geo.y[i] + 56);

// How a site is drawn at this zoom: kind 1 another group's base (dyn: besieged, drawn every frame for the pulse),
// 2 a dot (minor sites zoomed out), 3 a site sprite on its zone plate. Also where its name goes.
function siteDesc(state, id, code, fb) {
  const t = state.tiles[id], px = geo.x[id], py = geo.y[id], kind = code & 3;
  const zone = SITE_ZONES[t.loc.zone || LOCATIONS[t.loc.type].cat] || SITE_ZONES.special;
  // Tier 0 = city centers, 1 = towns, landmarks and group bases, 2 = everything else (shops, farms, cabins…).
  const tier = t.loc.type === "city" ? 0 : fb || t.loc.type === "town" || t.loc.zone === "special" ? 1 : 2;
  if (kind === 1) {
    const s = zoomBoost(), w = PLACE_W.faction * s, cy = py - 5 * s, cv = factionBaseCanvas(fb.type, fb.color), h = spriteH(cv, w);
    return { kind, tier, zone, fb, s, w, h, cy, cv, dyn: !!(code & 8), labelY: cy + h / 2 + 6, side: null, bloc: code >> 16 ? blocColorOf(state, fb) : null };
  }
  if (tier === 2 && F.zoom < 0.7) return { kind: 2, tier, zone, dyn: false }; // zoomed out: a dot in the zone's color
  return { kind, tier, zone, dyn: false, alpha: code & 4 ? 0.55 : 1, ...siteLook(t, px, py, tier, (code >> 4) & 3) };
}

function paintSite(d, px, py) {
  if (d.kind === 1) {
    if (d.bloc) blocRing(px, py, d.bloc, d.s);
    ownerPlate(px, py, d.fb.color, d.s, 18, d.dyn);
    sprite(d.cv, px, d.cy, d.w);
  } else if (d.kind === 2) {
    ctx.beginPath();
    ctx.arc(px, py, 2.6 / camera.zoom, 0, Math.PI * 2);
    ctx.fillStyle = d.zone.color;
    ctx.fill();
  } else drawSite(d, px, py, d.zone, d.alpha);
}

// Offscreen canvases need a DOM (the headless tools draw onto a stub context without one).
const canCache = () => typeof document !== "undefined" && !!document && typeof document.createElement === "function";
// Without offscreen canvases: the ground and the sites of the visible area drawn straight onto the map.
function drawDirect(state, S, ox, oy, cw, chh) {
  const G = geo, x0 = ox / S, y0 = oy / S, x1 = (ox + cw) / S, y1 = (oy + chh) / S, rc = reach();
  const n = tilesIn(G, x0 - rc, y0 - rc, x1 + rc, y1 + rc, G.list);
  let nr = 0;
  const m = tilesIn(G, x0 - ROAD_REACH, y0 - ROAD_REACH, x1 + ROAD_REACH, y1 + ROAD_REACH, G.roads);
  for (let a = 0; a < m; a++) if (state.tiles[G.roads[a]].road) G.roads[nr++] = G.roads[a];
  ctx.setTransform(S, 0, 0, S, -ox, -oy);
  ctx.lineCap = "round";
  drawGround(state, n, nr, x0, y0, x1, y1);
  const pad = 80 * zoomBoost();
  for (const id of G.sites) {
    const d = G.siteDesc[id];
    if (d && !d.dyn && G.x[id] > x0 - pad && G.x[id] < x1 + pad && G.y[id] > y0 - pad && G.y[id] < y1 + pad) paintSite(d, G.x[id], G.y[id]);
  }
  paintRuins(x0, y0, x1, y1, pad, true);
}

// The ruins (G.ruinT) whose sprites reach into a world rectangle: drawn when draw is set; returns how many.
function paintRuins(x0, y0, x1, y1, pad, draw) {
  const G = geo;
  let k = 0;
  for (let a = 0; a < G.nRuin; a++) {
    const id = G.ruinT[a], px = G.x[id], py = G.y[id];
    if (px <= x0 - pad || px >= x1 + pad || py <= y0 - pad || py >= y1 + pad) continue;
    k++;
    if (draw) paintRuin(px, py, G.ruin[id]);
  }
  return k;
}
// A ruin: the burned-out compound on a scorched plate with a smouldering rim (yours: a torn blue rag on a pole). An
// empty base (code 3, yours 4): the grey, overgrown outpost on a plate with a moss-grey rim.
const RUIN_W = 32, RUIN_RIM = "#a0603a", RUIN_LABEL = "#d2b39a", EMPTY_RIM = "#7f8a72", EMPTY_LABEL = "#b9c2ae";
function paintRuin(px, py, code) {
  const empty = code >= 3, yours = code === 2 || code === 4;
  const s = zoomBoost(), cv = empty ? emptyBaseSpriteCanvas(yours) : ruinSpriteCanvas(yours), w = RUIN_W * s, h = spriteH(cv, w), foot = py + 7 * s;
  ctx.beginPath();
  ctx.ellipse(px, foot, Math.max(9 * s, w * 0.46), 4.5 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fill();
  ctx.strokeStyle = empty ? EMPTY_RIM : RUIN_RIM;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  sprite(cv, px, foot - h / 2 + 0.6 * s, w);
}

// Draws one chunk: the ground of every tile that reaches into it, then the sites, in the same order as a full frame.
function paintChunk(state, L, ch, i, j) {
  const G = geo, S = L.S, C = L.C;
  const x0 = (i * C) / S, y0 = (j * C) / S, x1 = ((i + 1) * C) / S, y1 = ((j + 1) * C) / S, rc = reach();
  const n = tilesIn(G, x0 - rc, y0 - rc, x1 + rc, y1 + rc, G.list);
  let nr = 0;
  const m = tilesIn(G, x0 - ROAD_REACH, y0 - ROAD_REACH, x1 + ROAD_REACH, y1 + ROAD_REACH, G.roads);
  for (let a = 0; a < m; a++) if (state.tiles[G.roads[a]].road) G.roads[nr++] = G.roads[a];
  let ns = 0;
  const pad = 80 * Math.max(1, Math.sqrt(0.9 / L.zoom));
  for (const id of G.sites) if (G.siteDesc[id] && !G.siteDesc[id].dyn && G.x[id] > x0 - pad && G.x[id] < x1 + pad && G.y[id] > y0 - pad && G.y[id] < y1 + pad) ns++;
  const nru = paintRuins(x0, y0, x1, y1, pad, false);
  ch.dirty = false;
  if (!n && !ns && !nr && !nru) {
    ch.empty = true;
    if (ch.cv) { pool.push(ch.cv); ch.cv = null; }
    return;
  }
  ch.empty = false;
  if (!ch.cv) {
    const k = pool.findIndex((cv) => cv.width === C);
    ch.cv = k >= 0 ? pool.splice(k, 1)[0] : document.createElement("canvas");
    if (ch.cv.width !== C) ch.cv.width = C;
    if (ch.cv.height !== C) ch.cv.height = C;
  }
  const main = ctx;
  ctx = ch.cv.getContext("2d");
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, C, C);
    ctx.setTransform(S, 0, 0, S, -i * C, -j * C);
    ctx.lineCap = "round";
    drawGround(state, n, nr, x0, y0, x1, y1);
    if (ns) for (const id of G.sites) {
      const d = G.siteDesc[id];
      if (d && !d.dyn && G.x[id] > x0 - pad && G.x[id] < x1 + pad && G.y[id] > y0 - pad && G.y[id] < y1 + pad) paintSite(d, G.x[id], G.y[id]);
    }
    if (nru) paintRuins(x0, y0, x1, y1, pad, true);
  } finally {
    ctx = main;
  }
}

// The ground of the tiles in geo.list (and the roads of those in geo.roads), into the current context; x0..y1: the
// world rectangle being drawn (the Known area's hatching is laid across it).
function drawGround(state, n, nr, x0, y0, x1, y1) {
  const G = geo, list = G.list, X = G.x, Y = G.y;
  // Terrain. Geography is known from pre-war maps; current conditions are not. Batched by color (one fill each).
  for (const b of G.buckets) b.length = 0;
  for (let a = 0; a < n; a++) { const id = list[a]; G.buckets[G.color[id] + (G.key[id] & 3)].push(id); }
  G.buckets.forEach((b, ci) => {
    if (!b.length) return;
    ctx.beginPath();
    for (const id of b) hexSub(X[id], Y[id], HEX + 0.5);
    ctx.fillStyle = G.terrColors[ci];
    ctx.fill();
  });
  // Terrain detail (ui/terraindeco.js), fading in as you zoom in: rippled water in rivers and lakes, then the decals
  // (trees, fields, rocks, houses, wrecks…), both pre-shaded for live, reported and unknown tiles.
  if (F.deco > 0 && G.deco) {
    const sm0 = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = F.dsc.smooth;
    ctx.imageSmoothingQuality = "low";
    for (let f = 0; f < 3; f++) {
      const b = G.buckets[G.waterIdx * 3 + f], pat = b.length ? waterPattern(ctx, waterTexture(F.dsc.R, WATER_RGB, f)) : null;
      if (!pat) continue;
      ctx.beginPath();
      for (const id of b) hexSub(X[id], Y[id], HEX + 0.5);
      ctx.globalAlpha = F.deco;
      ctx.fillStyle = pat;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    drawDecor(ctx, G.deco, list, n, G.key, G.clr, decoAtlas(F.dsc.R), F.snow, F.deco, SEASON_LOOK[F.season]);
    ctx.imageSmoothingEnabled = sm0;
  }
  // Frozen rivers (sim/weather.js ICE: the rows down to F.iceRow): pale ice over the water, as bright as the land
  // around it (live, reported, unknown). Only the chunks of rows that freeze or thaw are drawn again (render).
  if (F.iceRow >= 0) {
    for (let f = 0; f < 3; f++) {
      let k = 0;
      ctx.beginPath();
      for (let a = 0; a < n; a++) {
        const id = list[a];
        if (G.water[id] && G.r[id] <= F.iceRow && (G.key[id] & 3) === f && G.angle[id] !== G.angle[id]) { hexSub(X[id], Y[id], HEX + 0.5); k++; }
      }
      if (!k) continue;
      ctx.fillStyle = ICE_FILL[f];
      ctx.fill();
      ctx.strokeStyle = "rgba(120,150,175,0.35)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }
  // Season and weather wash over the land (weather.js): one fill for every land tile.
  if (F.tint) {
    ctx.beginPath();
    for (let a = 0; a < n; a++) if (!G.water[list[a]]) hexSub(X[list[a]], Y[list[a]], HEX + 0.5);
    ctx.fillStyle = F.tint;
    ctx.fill();
  }
  // Infection as you know it, one fill per shade.
  if (F.infOn) {
    const byColor = new Map();
    for (let a = 0; a < n; a++) {
      const id = list[a];
      if ((G.key[id] & 3) === 2 || !(G.inf[id] > 0)) continue;
      const color = `rgba(${PAL.infRgb},${G.inf[id] * 0.55})`;
      let l = byColor.get(color);
      if (!l) byColor.set(color, (l = []));
      l.push(id);
    }
    for (const [color, l] of byColor) {
      ctx.beginPath();
      for (const id of l) hexSub(X[id], Y[id], HEX + 0.5);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }
  // Territory (only what you know): one fill and one outline per owner.
  if (F.terrOn) {
    const byOwner = new Map();
    for (let a = 0; a < n; a++) {
      const o = G.key[list[a]] >> 4;
      if (!o) continue;
      let l = byOwner.get(o);
      if (!l) byOwner.set(o, (l = []));
      l.push(list[a]);
    }
    for (const [o, l] of byOwner) {
      const color = G.ownerColors[o];
      ctx.beginPath();
      for (const id of l) hexSub(X[id], Y[id], HEX - 1.5);
      ctx.fillStyle = color + "2a";
      ctx.fill();
      ctx.strokeStyle = color + "88";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
  if (F.knownOn && G.nSrch) drawKnown(n, x0, y0, x1, y1);
  if (F.coalOn && G.nCoal) drawCoalition(n);
  // Roads.
  ctx.strokeStyle = "#cdbb8a";
  ctx.lineWidth = 2.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let a = 0; a < nr; a++) {
    const id = G.roads[a];
    for (const m of state.tiles[id].roadLinks) {
      if (m < id) continue;
      ctx.moveTo(X[id], Y[id]);
      ctx.lineTo(X[m], Y[m]);
    }
  }
  ctx.stroke();
  // Bridges: a railed concrete deck turned along the road, bank to bank (the hex's width between its edges).
  for (let a = 0; a < n; a++) { const id = list[a]; if (G.angle[id] === G.angle[id]) sprite(bridgeCanvas(), X[id], Y[id], BRIDGE_W, { angle: G.angle[id] }); }
  // Hives you know about (live, or in the last report): their land is tinted dark red, the ring right around each
  // hive brighter, with a red skull on every ring tile when zoomed in (the dead there are much tougher). Sites
  // inside a hive's land show at least 3 skulls, red ones on the ring (labels).
  if (F.hordesOn && G.nHives) {
    ctx.beginPath();
    for (let a = 0; a < n; a++) { const id = list[a]; if (((G.key[id] >> 2) & 3) === 2) hexSub(X[id], Y[id], HEX - 0.5); }
    ctx.fillStyle = `rgba(${PAL.hiveRgb},0.13)`;
    ctx.fill();
    ctx.beginPath();
    for (let a = 0; a < n; a++) { const id = list[a]; if (((G.key[id] >> 2) & 3) <= 1) hexSub(X[id], Y[id], HEX - 0.5); }
    ctx.fillStyle = `rgba(${PAL.ringRgb},0.22)`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${PAL.ringEdgeRgb},0.35)`;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (F.ringSkulls) for (let a = 0; a < n; a++) {
      const id = list[a];
      if (((G.key[id] >> 2) & 3) === 1 && !mapLoc(state, id)) sprite(redSkullCanvas(), X[id], Y[id] + 13, SKULL_W, { alpha: 0.9 });
    }
  }
}

// The edge tile a shares with its neighbour b, pulled in toward a's centre by inset world pixels (added to the path).
const SQ3 = Math.sqrt(3);
function edgeTo(a, b, inset) {
  const ax = geo.x[a], ay = geo.y[a], dx = geo.x[b] - ax, dy = geo.y[b] - ay;
  const k = 0.5 - inset / (HEX * SQ3), mx = ax + dx * k, my = ay + dy * k, ex = -dy / (2 * SQ3), ey = dx / (2 * SQ3);
  ctx.moveTo(mx + ex, my + ey);
  ctx.lineTo(mx - ex, my - ey);
}

// Known area (the layer of that name): tiles your people looked hard at, hatched in teal (fainter when it was more
// than KNOWN_RECENT days ago; a faint teal wash on the recent ones) with a thin line around the searched area, so the
// unhatched ground is where nobody has looked for hidden places yet. The hatching follows world coordinates, so it
// runs on unbroken from chunk to chunk; it opens out when zoomed out (about 5 screen pixels apart).
const KNOWN_WASH = "rgba(110,215,205,0.10)", KNOWN_HATCH = [null, "rgba(150,228,218,0.2)", "rgba(165,240,230,0.42)"], KNOWN_EDGE = "rgba(140,225,215,0.6)";
function drawKnown(n, x0, y0, x1, y1) {
  const G = geo, list = G.list, X = G.x, Y = G.y;
  let k = 0;
  ctx.beginPath();
  for (let a = 0; a < n; a++) { const id = list[a]; if (G.srch[id] === 2) { hexSub(X[id], Y[id], HEX + 0.5); k++; } }
  if (k) { ctx.fillStyle = KNOWN_WASH; ctx.fill(); }
  const sp = Math.max(6, 5 / curS), lw = Math.max(1, 0.9 / curS);
  for (const lvl of [1, 2]) {
    k = 0;
    ctx.save();
    ctx.beginPath();
    for (let a = 0; a < n; a++) { const id = list[a]; if (G.srch[id] === lvl) { hexSub(X[id], Y[id], HEX + 0.5); k++; } }
    if (k) {
      ctx.clip();
      ctx.beginPath();
      const ya = y0 - 2 * HEX, yb = y1 + 2 * HEX, c1 = x1 + yb + 2 * HEX;
      for (let c = Math.floor((x0 + ya - 2 * HEX) / sp) * sp; c <= c1; c += sp) { ctx.moveTo(c - ya, ya); ctx.lineTo(c - yb, yb); }
      ctx.strokeStyle = KNOWN_HATCH[lvl];
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.beginPath();
  for (let a = 0; a < n; a++) {
    const id = list[a];
    if (!G.srch[id]) continue;
    for (let j = 0; j < 6; j++) { const m = G.nb[id * 6 + j]; if (m >= 0 && !G.srch[m]) edgeTo(id, m, 0.8); }
  }
  ctx.strokeStyle = KNOWN_EDGE;
  ctx.lineWidth = lw * 1.2;
  ctx.stroke();
}

// Coalition land (the layer of that name): each owner's land (you, each member) washed in its color with a border
// in that color where another owner's land begins, and a thin gold line with a dark edge around the coalition's land
// as a whole (water in reach counts as inside there, so rivers and lakes do not cut it up).
const COAL_EDGE = "#f3d27a", COAL_EDGE_DARK = "rgba(13,15,18,0.6)";
function drawCoalition(n) {
  const G = geo, list = G.list, X = G.x, Y = G.y, cols = G.coalColors;
  const by = new Map();
  for (let a = 0; a < n; a++) {
    const id = list[a], o = G.coal[id];
    if (!o) continue;
    let l = by.get(o);
    if (!l) by.set(o, (l = []));
    l.push(id);
  }
  for (const [o, l] of by) {
    ctx.beginPath();
    for (const id of l) hexSub(X[id], Y[id], HEX + 0.5);
    ctx.fillStyle = cols[o] + "26";
    ctx.fill();
  }
  for (const [o, l] of by) {
    let k = 0;
    ctx.beginPath();
    for (const id of l) for (let j = 0; j < 6; j++) { const m = G.nb[id * 6 + j]; if (m >= 0 && G.coal[m] && G.coal[m] !== o) { edgeTo(id, m, 2.2); k++; } }
    if (!k) continue;
    ctx.strokeStyle = cols[o] + "e0";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  let k = 0;
  ctx.beginPath();
  for (let a = 0; a < n; a++) {
    const id = list[a];
    if (!G.coalIn[id]) continue;
    for (let j = 0; j < 6; j++) { const m = G.nb[id * 6 + j]; if (m >= 0 && !G.coalIn[m]) { edgeTo(id, m, 0); k++; } }
  }
  if (!k) return;
  ctx.strokeStyle = COAL_EDGE_DARK;
  ctx.lineWidth = Math.max(3.2, 2.4 / curS);
  ctx.stroke();
  ctx.strokeStyle = COAL_EDGE;
  ctx.lineWidth = Math.max(1.4, 1.1 / curS);
  ctx.stroke();
}

// ---------- frame check: skip a frame when nothing on the map changed ----------
const last = { detail: true, canvas: null, cw: -1, ch: -1, state: null, live: null, know: null, hour: NaN, x: NaN, y: NaN, zoom: NaN, dpr: 0, hover: -2, sel: -2, preview: null, plen: -1, reveal: null, layers: "", hash: NaN, at: -Infinity, anim: false, glide: false, fk: 0 };
let forceDraw = true;
let glidingNow = false; // a team of yours was drawn between two tiles this frame (drawPlayerParty)
const GLIDE_STEPS = 600; // the map is drawn again each 1/600 of an hour while a team glides (30 a second at 1×)
// The same 30 a second below 1× (0.5×, 0.25×: an hour takes 40 or 80 seconds), so a glide never steps along.
const glideSteps = () => GLIDE_STEPS / Math.max(0.25, Math.min(1, view.clockSpeed || 1));
// A cheap fingerprint of what moves on the map between ticks (orders given while paused, a base built, a horde).
function moverHash(state) {
  let h = state.parties.length * 7919 + state.markers.length * 104729 + state.bases.length * 15485863 + (state.hiveSites ? state.hiveSites.length : 0) + (state.hiveGrowths ? state.hiveGrowths.length * 613 : 0);
  for (const p of state.parties) h = (h * 31 + (p.idx | 0) * 17 + (p.path ? p.path.length * 5 : 0) + (p.phase ? p.phase.length : 0) + (p.radioLive ? 3 : 0) + (p.planPath ? 7 : 0)) % 2147483647;
  for (const x of state.hordes) h = (h * 31 + x.tile * 13 + (x.size | 0)) % 2147483647;
  for (const x of state.herds || []) h = (h * 31 + x.tile * 5 + x.size) % 2147483647; // infested herds (sim/worm.js)
  for (const v of state.visitors || []) h = (h * 31 + v.tile * 7 + (v.phase ? v.phase.length : 0)) % 2147483647; // outsiders (sim/visitors.js)
  for (const b of hcMapBands(state)) h = (h * 31 + b.tile * 11 + b.pop) % 2147483647; // hardcore bands and the strike force (sim/hardcore-groups.js)
  for (const b of state.bases) h = (h * 31 + b.buildings.length + (b.alert ? 5 : 0) + b.tile + (b.tier === 0 ? campStage(b) * 7 + (b.fire === false ? 3 : 0) : 0)) % 2147483647; // a camp's or shelter's look (its step up, its fire)
  if (state.staging) h = (h * 31 + state.staging.tile * 3 + Math.round(oldCampPct(state.staging) * 50)) % 2147483647; // a timelapse frame's camp (sim/chronicle.js)
  // Hidden sites found (sim/discovery.js), also while paused (intel bought, a prisoner questioned).
  if (state.knowledge && !state.timelapse) for (const id of hiddenSites(state)) if (state.knowledge[id]) h = (h * 31 + id) % 2147483647;
  // The overlays' data: a report of searched ground, the coalition's members (an invitation answered while paused).
  h = (h * 31 + searchedVersion() * 7 + (state.alliance ? state.alliance.members.length * 3 : 0) + (state.claims ? Object.keys(state.claims).length * 11 : 0)) % 2147483647; // claims (sim/claims.js) made or lost while paused
  if (state.mapNotes) h = (h * 31 + notesHash(state)) % 2147483647;
  if (state.fieldworks) for (const fw of state.fieldworks.list) h = (h * 31 + fw.tile * 3 + Math.round(fw.hp) + (fw.built ? 7 : 0) + (fw.garrison ? fw.garrison.length * 5 : 0) + (typeof fw.owner === "number" ? fw.owner * 11 : 0) + (fw.found ? 13 : 0) + (fw.held ? fw.held.length * 17 : 0)) % 2147483647; // field works (sim/fieldworks.js)
  if (state.fieldworks) for (const j of state.fieldworks.jobs) h = (h * 31 + Math.floor(j.progress)) % 2147483647;
  if (view.fwPlace) h = (h * 31 + view.fwPlace.length * 13 + 1) % 2147483647; // the tile picker's highlight // map notes added or edited while paused (ui/mapnotes.js)
  return h;
}
function unchanged(state, now) {
  let layers = "";
  for (const k of view.layers) layers += k + ",";
  const live = liveSet(state), hash = moverHash(state), plen = view.preview ? view.preview.length : -1;
  const fk = last.glide ? Math.floor(hourFrac() * glideSteps()) : 0;
  const same = !forceDraw && last.canvas === canvas && last.cw === canvas.width && last.ch === canvas.height && last.state === state &&
    last.live === live && last.know === state.knowledge && last.hour === state.hour && last.x === camera.x && last.y === camera.y &&
    last.zoom === camera.zoom && last.dpr === dpr && last.hover === view.hover && last.wh === view.workerHover && last.sel === view.selected && last.preview === view.preview &&
    last.plen === plen && last.reveal === view.devReveal && last.layers === layers && last.hash === hash && last.detail === deco.detail && last.fk === fk;
  if (same && now - last.at < (last.anim ? ANIM_MS : Math.min(IDLE_MS, last.animMs ?? Infinity))) return true; // last.animMs: the slower animations (wantFrames)
  Object.assign(last, { canvas, cw: canvas.width, ch: canvas.height, state, live, know: state.knowledge, hour: state.hour, x: camera.x, y: camera.y, zoom: camera.zoom, dpr, hover: view.hover, wh: view.workerHover, sel: view.selected, preview: view.preview, plen, reveal: view.devReveal, layers, hash, at: now, anim: false, detail: deco.detail, fk });
  forceDraw = false;
  return false;
}
// The next render draws even if nothing seems to have changed; all: also draw the cached layers again from scratch.
export function redrawMap(all = false) {
  forceDraw = true;
  if (all) { dropCache(); geo = null; }
}

export function render(state) {
  if (!ctx) return;
  const now = performance.now();
  if (lightningWants(now)) forceDraw = true; // ui/lightningfx.js: a flash running or a strike due
  if (!state.timelapse && unchanged(state, now)) { mapStats.skipped++; return; }
  frameNo++;
  mapStats.drawn++;
  animNeed = Infinity; animNow = now; lastTimelapse = !!state.timelapse;
  const g = state.grid;
  setMapPx(g);
  const live = liveSet(state);
  const k = state.knowledge;
  const G = geometry(state);
  const zoom = camera.zoom, S = dpr * zoom;
  curS = S;
  F.zoom = zoom;
  F.infOn = on("infection");
  F.terrOn = on("territory");
  F.hordesOn = on("hordes");
  F.poisOn = on("pois");
  F.knownOn = on("known") && !state.timelapse;
  F.coalOn = on("coalition") && !state.timelapse;
  F.tint =on("weather") && (state.weather || !state.timelapse) ? weatherTint(state) : null;
  // Frozen rivers: the rows that froze or thawed since the last frame are drawn again (their chunks, every zoom level).
  const ir = state.timelapse || !state.weather ? -1 : iceRow(state);
  if (ir !== F.iceRow) {
    const a = Math.min(ir, F.iceRow) + 1, b = Math.max(ir, F.iceRow);
    markDirty(-HEX * 2, a * HEX * 1.5 - HEX * 2, G.cols * HEX * Math.sqrt(3) + HEX * 2, b * HEX * 1.5 + HEX * 2);
    F.iceRow = ir;
  }
  F.ringSkulls = zoom > SKULL_ZOOM * 0.7;
  // Terrain detail: none zoomed out or with the Flat option; snow caps while the snow-cover wash is on (weather.js).
  F.deco = decoAlpha(zoom);
  F.dsc = decoScale(S);
  F.snow = !!F.tint && F.tint.startsWith("rgba(235,240,248,");
  F.season = season(state).key;
  if (F.deco > 0 && (!G.deco || G.deco.tiles !== state.tiles)) G.deco = placeDecor(state, HEX);
  const key = `${F.tint}|${F.infOn}|${F.terrOn}|${F.hordesOn}|${F.poisOn}|${F.knownOn}|${F.coalOn}|${!!state.timelapse}|${state.factions.length}|${deco.detail}|${F.season}`;
  if (dpr !== cacheDpr) { cacheDpr = dpr; dropCache(); }
  else if (key !== cacheKey) dirtyAll();
  cacheKey = key;
  // The overlays, worked out again only when their data changed (the chunks they touch are drawn again).
  if (F.knownOn) updateKnown(state);
  if (F.coalOn) updateCoalition(state);

  const ownBase = new Set(state.bases.map((b) => b.tile));
  const busy = busyTiles(state, live);
  const hordeAt = new Map();
  for (const h of on("hordes") ? state.hordes : []) {
    const e = hordeAt.get(h.tile);
    if (e) { e.size += h.size; e.bosses += h.bosses || 0; }
    else hordeAt.set(h.tile, { size: h.size, target: h.target, bosses: h.bosses || 0 });
  }
  const siteAt = new Map((state.hiveSites || []).map((x) => [x.tile, x]));
  scanTiles(state, live, k, hordeAt, siteAt, busy, ownBase);

  // The cached layers: the chunks on screen, drawn again where something changed, then copied 1:1 to whole device
  // pixels (the camera is rounded to a device pixel, so the copies are exact).
  const L = levelFor(zoom, S);
  const ox = Math.round(camera.x * S), oy = Math.round(camera.y * S), cw = canvas.width, chh = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, cw, chh);
  if (canCache()) {
    ctx.imageSmoothingEnabled = false;
    let spent = 0, behind = false;
    const C = L.C, i0 = Math.floor(ox / C), i1 = Math.floor((ox + cw - 1) / C), j0 = Math.floor(oy / C), j1 = Math.floor((oy + chh - 1) / C);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const ck = ckey(i, j);
      let ch = L.chunks.get(ck);
      if (!ch) L.chunks.set(ck, (ch = { cv: null, dirty: true, empty: false, drawn: false, used: 0, i, j }));
      if (ch.dirty) {
        if (!ch.drawn || state.timelapse || spent < mapTuning.budgetMs) { // the timelapse redraws every frame anyway
          const t0 = performance.now();
          paintChunk(state, L, ch, i, j);
          ch.drawn = true;
          spent += performance.now() - t0;
          mapStats.chunks++;
        } else behind = true;
      }
      ch.used = frameNo;
      if (!ch.empty) ctx.drawImage(ch.cv, i * C - ox, j * C - oy);
    }
    ctx.imageSmoothingEnabled = true;
    // Keep about twice the screen's worth of chunks (plus some), dropping the longest unused first.
    const budget = 2 * (i1 - i0 + 1) * (j1 - j0 + 1) + 24;
    let held = 0;
    for (const x of levels.values()) for (const ch of x.chunks.values()) if (ch.cv) held++;
    if (held > budget) {
      const all = [];
      for (const x of levels.values()) for (const [ck, ch] of x.chunks) if (ch.used !== frameNo) all.push([ch.used, x, ck, ch]);
      all.sort((a, b) => a[0] - b[0]);
      for (let a = 0; a < all.length && held > budget; a++) {
        const [, x, ck, ch] = all[a];
        if (ch.cv) { pool.push(ch.cv); held--; }
        x.chunks.delete(ck);
      }
      if (pool.length > 32) pool.length = 32;
    }
    if (behind) forceDraw = true; // chunks still out of date: draw again next frame
    mapStats.chunkMs += spent;
  } else drawDirect(state, S, ox, oy, cw, chh); // no offscreen canvases (headless tools): the cached layers straight onto the map

  ctx.setTransform(S, 0, 0, S, -ox, -oy);
  ctx.lineCap = "round";
  const minX = camera.x - HEX * 2, minY = camera.y - HEX * 2;
  const maxX = camera.x + W / camera.zoom + HEX * 2, maxY = camera.y + H / camera.zoom + HEX * 2;
  // Weather fronts drifting over the land (ui/wxmap.js): faint on the Weather layer, strong with Weather fronts.
  if (!state.timelapse && (on("weather") || on("fronts"))) {
    // They glide while the clock runs (Reduce motion: they jump an hour at a time, nothing asks for frames).
    const moving = view.hourFrac !== lastFrac;
    lastFrac = view.hourFrac;
    if (drawFronts(ctx, state, { hex: HEX, view: { minX, maxX, minY, maxY }, frac: hourFrac(), strong: on("fronts"), zoom: zoom / (readable.text || 1) }) && animOn() && !readable.still && moving) wantFrames(150);
  }
  // Night (ui/nightfx.js): the shade over the ground and the cached sites, the lights cutting through it; what is drawn
  // after it (bases, teams, hordes, labels, icons, selection) stays at full brightness.
  lightningFrame({ state, cw, ch: chh, S, ox, oy, hex: HEX, frac: hourFrac(), timelapse: !!state.timelapse, now }); // ui/lightningfx.js: strikes due; a flash lifts the shade
  drawNight(ctx, { state, cw, ch: chh, S, ox, oy, boost: zoomBoost(), G, frac: hourFrac(), timelapse: !!state.timelapse });
  drawLightning(ctx); // ui/lightningfx.js: the flash and the bolt (what is drawn after it is never flashed)
  const inView = (id) => { const px = G.x[id], py = G.y[id]; return !(px < minX || px > maxX || py < minY || py > maxY); };
  let animating = false;
  glidingNow = false;

  // Locations: other groups' bases as compound sprites in their color, plain sites as pixel sprites (one per site
  // type) on a plate in their zone's color (city, small town, countryside, landmark); picked-over sites are faded
  // and up close skulls show the danger. Zoomed out, minor sites shrink to dots and only the bigger places keep
  // their names. Tiles with one of your bases are drawn with the base below. A site with a team, horde or marker
  // on it is drawn faded so they stand out. All of them are in the cached chunks except a besieged group base
  // (its ring pulses), drawn here.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Base tiles with a horde, a siege or a party standing beside the base: the base's name moves below them.
  const crowded = (id) => busy.has(id) || (on("hordes") && !live.has(id) && !!k[id] && k[id].hordeSize > 0);
  // Tiles drawn as a base (yours, or another group's as far as you know), with half the sprite's width.
  baseTiles = new Map(state.bases.map((b) => [b.tile, (placeW(b) * zoomBoost()) / 2]));
  if (state.staging) baseTiles.set(state.staging.tile, (STAGING_W * zoomBoost()) / 2); // a timelapse frame's camp
  spriteBoxes = [];
  besideCount = new Map();
  const labels = []; // drawn last (over parties, hordes and markers), most important first, skipping any that would overlap
  const hasHives = G.nHives > 0;
  for (const id of G.sites) {
    const d = G.siteDesc[id];
    if (!d || d.kind === 2 || !inView(id)) continue;
    const t = state.tiles[id], px = G.x[id], py = G.y[id], fb = d.kind === 1;
    let labelY = d.labelY;
    if (fb) {
      if (d.dyn) { paintSite(d, px, py); animating = true; }
      noteSprite(px, d.cy, d.w, d.h);
      baseTiles.set(id, d.w / 2);
      if (crowded(id)) labelY = py + BESIDE_LABEL_Y * Math.min(d.s, BESIDE_MAX);
    }
    // Danger skulls go in a row under the name; where the name is not shown at this zoom, under the sprite.
    // Cities, towns, landmarks and group bases keep their names at every zoom (overlapping ones give way, the
    // most important first); small sites only up close.
    const tier = d.tier, named = tier < 2 || camera.zoom > 1.3;
    const hd = hasHives && !fb ? G.dist[id] : Infinity; // inside a known hive's land: at least 3 skulls, red on the ring
    const skulls = !fb && camera.zoom > SKULL_ZOOM ? Math.max(siteDanger(t.loc), hd <= HIVE.TERRITORY ? 3 : 0) : 0;
    if (named || skulls) {
      labels.push({ text: named ? (tier === 2 ? siteLabel(state, t) : t.loc.name) : "", x: px, y: labelY, pri: named ? tier : 3, screen: tier < 2, bold: tier === 0, size: tier === 0 ? 12 : tier === 1 ? 10 : 9, skulls, red: hd <= HIVE.RING, side: d.side });
    }
  }
  // Ruins (drawn in the cached chunks): their names, "Ruins of Oak Hill Outpost", the same size as a town's.
  for (let a = 0; a < G.nRuin; a++) {
    const id = G.ruinT[a];
    if (!inView(id)) continue;
    const s = zoomBoost();
    const em = G.ruin[id] >= 3 ? emptyKnown(state, id) : null;
    const text = em ? emptyTitle(em) : ruinTitle(state.tiles[id].ruin);
    if (text) labels.push({ text, x: G.x[id], y: G.y[id] + 7 * s + 4.5 * s + 6, pri: 1, screen: true, color: em ? EMPTY_LABEL : RUIN_LABEL, size: 9 });
  }
  // Hives you know about: a festering mound, bigger and redder on badly infected ground; live ones pulse.
  const pulse = readable.still ? 0.5 : 0.5 + 0.5 * Math.sin(Date.now() / 420);
  for (let a = 0; on("hordes") && a < G.nHives; a++) {
    const id = G.hives[a];
    if (!inView(id)) continue;
    const t = state.tiles[id], isLive = live.has(id), snap = k[id];
    const px = G.x[id], py = G.y[id];
    const s = zoomBoost(), inf = (isLive ? t.infection : snap.infection) || 0;
    const level = inf >= 0.8 ? 2 : inf >= 0.5 ? 1 : 0, w = (28 + level * 4) * s;
    if (isLive) {
      animating = true;
      ctx.beginPath();
      ctx.ellipse(px, py + 5 * s, w * 0.55, w * 0.22, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${PAL.ringEdgeRgb},${(0.1 + 0.16 * pulse * (1 + level * 0.4)).toFixed(3)})`;
      ctx.fill();
    }
    sprite(hiveSpriteCanvas(level), px, py - 1 * s, w, { alpha: isLive ? 1 : 0.8 });
    // How deep your crawls got (sim/hivecrawl.js hive.crawlRec): "⛏ 4/7", a star once its core was found.
    const hv = state.hives && state.hives.find((h) => h.tile === id);
    const rec = hv && hv.crawlRec && hv.den ? hv.crawlRec : null;
    if (rec) labels.push({ text: `⛏ ${Math.min(rec.deepest || 0, hv.den.depth)}/${hv.den.depth}${rec.core ? " ★" : rec.coreHeard ? " ☆" : ""}`, x: px, y: py + 9 * s + 6, pri: 1, screen: true, color: rec.core ? "#ffcf6a" : "#e0a080", size: 9 });
  }
  // A hive's growths (sim/hivetech.js) you know about: small organic structures beside it, smaller and faint while
  // still growing, grey husks once their hive is gone. Live ones as they are, the rest as last reported.
  if (on("hordes")) {
    const drawGrowth = (id, gi, isLive) => {
      if (!gi || !inView(id)) return;
      const s = zoomBoost(), w = (gi.growing ? 14 : 19) * s;
      const swell = isLive && !gi.withered ? 1 + sway(id * 11 + 3, gi.growing ? 0.06 : 0.025, gi.growing ? 1300 : 2400) : 1;
      sprite(growthCanvas(gi.kind, gi.withered), G.x[id], G.y[id] + 1 * s, w * swell, { alpha: (gi.growing ? 0.65 : 1) * (isLive ? 1 : 0.75) });
    };
    for (const gr of state.hiveGrowths || []) if (live.has(gr.tile)) drawGrowth(gr.tile, { kind: gr.kind, growing: gr.withered == null && state.hour < gr.ready, withered: gr.withered != null }, true);
    if (k) for (let id = 0; id < G.n; id++) if (!live.has(id) && k[id] && k[id].growth) drawGrowth(id, k[id].growth, false);
  }
  // Hive build sites you know about: a raw mound of the dead with bones sticking up (glowing once the building has
  // started) and how much of the 1,000 dead it needs has gone into it.
  for (let a = 0; on("hordes") && a < G.nBuild; a++) {
    const id = G.buildT[a];
    if (!inView(id)) continue;
    const isLive = live.has(id);
    const st = isLive ? siteAt.get(id) : k[id] && k[id].site;
    if (!st) continue;
    const px = G.x[id], py = G.y[id];
    // sim/hivebirth.js: the mound grows with the dead massed there (as you know it), a red ring when you marked it.
    const massed = isLive ? (hordeAt.get(id) || { size: 0 }).size : (k[id].hordeSize || 0);
    const s = zoomBoost(), w = 26 * s * (0.85 + 0.55 * Math.min(1, massed / 600)), started = st.started != null && st.started !== false;
    if (isMarked(state, id)) { ctx.strokeStyle = "rgba(226,65,47,0.75)"; ctx.lineWidth = 1.5 * s; ctx.setLineDash([3 * s, 3 * s]); ctx.beginPath(); ctx.arc(px, py + 2 * s, w * 0.72, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    if (started && isLive && animOn()) { wantFrames(); const f = 0.5 + 0.5 * Math.sin(animNow / 520 + phaseOf(id) * 6); ctx.beginPath(); ctx.ellipse(px, py + 6 * s, w * 0.5, w * 0.2, 0, 0, Math.PI * 2); ctx.fillStyle = `rgba(226,65,47,${(0.08 + 0.14 * f).toFixed(3)})`; ctx.fill(); }
    sprite(siteSpriteCanvas(started), px, py + 2 * s, w, { alpha: isLive ? 1 : 0.75 });
    const bw = 24 * s, bx = px - bw / 2, by = py + 11 * s, frac = Math.max(0, Math.min(1, (st.biomass || 0) / HIVE.SITE_BIOMASS));
    ctx.fillStyle = "rgba(13,15,18,0.8)";
    ctx.fillRect(bx - 1, by - 1, bw + 2, 4 * s + 2);
    ctx.fillStyle = started ? "#e2412f" : "#8a5a5a";
    ctx.fillRect(bx, by, bw * frac, 4 * s);
    const eta = buildSiteLabel(state, id); // "Hive in ~12 days" (a "?" when the look is old)
    if (eta) labels.push({ text: eta, x: px, y: by + 4 * s + 7, pri: 0, screen: true, color: isLive ? "#f08a7a" : "#c99a92", size: 9 });
  }
  // A timelapse frame's camp (sim/chronicle.js: { tile, progress, work }; a live camp is a base, drawn below).
  const camp = state.staging;
  if (camp && inView(camp.tile)) {
    const px = G.x[camp.tile], py = G.y[camp.tile], s = zoomBoost();
    ownerPlate(px, py, PLAYER_COLOR, s, 15, false);
    const f = oldCampPct(camp);
    const cv = stagingSpriteCanvas(f >= 0.85 ? 3 : f >= 0.5 ? 2 : f >= 0.2 ? 1 : 0, PLAYER_COLOR, camp.fire !== false), w = STAGING_W * s, cy = py - 4 * s;
    sprite(cv, px, cy, w);
    const h = spriteH(cv, w);
    noteSprite(px, cy, w, h);
    buildBarOnMap(px, cy - h / 2 - 7 * s, s, f, f);
    labels.push({ text: `Camp ${Math.round(f * 100)}%`, x: px, y: cy + h / 2 + 9 * s, pri: -1, screen: true, color: "#cfe2f7", size: 9 });
  }
  // A team on its way to set up camp (Establish base): a dashed ring where it will stand.
  if (!camp && !state.bases.length) for (const p of state.parties) {
    if (p.owner !== "player" || p.mission !== "establish" || !(p.phase === "out" || p.phase === "back") || !p.path || !p.path.length) continue;
    const dest = p.path[p.path.length - 1];
    if (!inView(dest)) continue;
    const px = G.x[dest], py = G.y[dest], s = zoomBoost();
    ctx.strokeStyle = "rgba(255,209,102,0.8)"; ctx.lineWidth = 1.5 * s; ctx.setLineDash([3 * s, 3 * s]);
    ctx.beginPath(); ctx.arc(px, py, 13 * s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    labels.push({ text: "Camp site", x: px, y: py + 13 * s + 7, pri: -1, screen: true, color: "#ffd166", size: 9 });
  }
  // Player bases: a walled town for the hub, a cabin for outposts, showing walls and notable buildings.
  const nodes = radioNodes(state);
  for (const b of state.bases) {
    const [px, py] = g.toPixel(b.tile, HEX);
    const s = zoomBoost(), isHub = b.type === "hub" && b.tier !== 0; // a shelter (tier 0): its own smaller sprite
    if (isCamp(b)) { // a camp (sim/staging.js): the staging sprite on your plate, its fire, its step up's bar and its name
      ownerPlate(px, py, PLAYER_COLOR, s, 15, false);
      const lit = b.fire !== false;
      const cv = stagingSpriteCanvas(campStage(b), PLAYER_COLOR, lit), w = STAGING_W * s, cy = py - 4 * s;
      sprite(cv, px, cy, w);
      if (lit) { const [fx, fy] = gridPoint(cv, px, cy, w, 13.5, 15); fireGlow(b.tile * 3 + 1, fx, fy, s); smokeWisps(b.tile * 3 + 2, fx, fy - 2 * s, s, { n: 3, rise: 14 }); } // mapsprites.js paintStaging: campfire at 12, 17
      const h = spriteH(cv, w);
      noteSprite(px, cy, w, h);
      const up = tierUpJob(b);
      const f = up && up.hours ? up.progress / up.hours : 0;
      if (up) buildBarOnMap(px, cy - h / 2 - 7 * s, s, f, up.paid ? gatherCap(up) : undefined);
      labels.push({ text: `${b.name} (${up ? `camp: ${b.type === "outpost" ? "establishing" : "building up"} ${Math.round(f * 100)}%` : "camp"})`, x: px, y: crowded(b.tile) ? py + BESIDE_LABEL_Y * Math.min(s, BESIDE_MAX) : cy + h / 2 + 9 * s, pri: -1, screen: true, color: "#cfe2f7", size: 10, bold: b.type === "hub" });
      continue;
    }
    const w = placeW(b) * s, cy = py - (isHub ? 6 : 5) * s;
    const besieged = state.parties.some((q) => q.phase === "siege" && q.target && q.target.kind === "player" && q.target.baseId === b.id);
    if (besieged) animating = true;
    ownerPlate(px, py, PLAYER_COLOR, s, isHub ? 22 : 16, besieged);
    const look = baseLook(b), cv = baseSpriteCanvas(look);
    sprite(cv, px, cy, w);
    const h = spriteH(cv, w);
    noteSprite(px, cy, w, h);
    // Somebody home: smoke from the hearth (a shelter's stovepipe, with its fire pit glowing while lit).
    if (state.survivors.some((x) => x.alive && x.location && x.location.kind === "base" && x.location.baseId === b.id)) {
      if (look.kind === "shelter") {
        const [sx, sy] = gridPoint(cv, px, cy, w, 23, 0);
        smokeWisps(b.id * 3 + 1, sx, sy, s, { n: 3, rise: 15 });
        if (look.fire !== false) { const [fx, fy] = gridPoint(cv, px, cy, w, 12.5, 16); fireGlow(b.id * 3 + 2, fx, fy, s); }
      } else smokeWisps(b.id * 3 + 1, px - w * 0.16, cy - h / 2 + 3 * s, s, { n: 3, rise: 17, alpha: 0.28 });
    }
    if (festivalNow(state, b)) for (let i = 0; i < 4; i++) fireGlow(b.id * 7 + 40 + i, px + (i - 1.5) * w * 0.24, cy + h / 2 - (i % 2 ? 1 : 3) * s, s); // sim/festival.js: bonfires on the festival day
    if (b.alert) sprite(iconCanvas("alert", "#ff9f43"), px + w / 2 - 3 * s, cy - h / 2 + 5 * s + stepBob(b.id * 3 + 3, 1.6 * s, 900), ICON_W * s);
    // A shelter building up into a base (buildings.js hub_up), an outpost camp being established (outpost_up): a bar of
    // the work above it (its lighter part: what the materials delivered allow).
    const up = b.tier === 0 && tierUpJob(b);
    if (up) buildBarOnMap(px, cy - h / 2 - 7 * s, s, up.hours ? up.progress / up.hours : 0, up.paid ? gatherCap(up) : undefined);
    const upPct = up ? Math.round((up.hours ? up.progress / up.hours : 0) * 100) : 0;
    labels.push({ text: b.tier === 0 ? `${b.name} (${b.type === "outpost" ? (up ? `camp: establishing ${upPct}%` : "camp") : up ? `building a base: ${upPct}%` : "shelter"})` : b.name, x: px, y: crowded(b.tile) ? py + BESIDE_LABEL_Y * Math.min(s, BESIDE_MAX) : cy + h / 2 + 6, pri: -1, screen: true, color: "#cfe2f7", size: 10, bold: isHub });
    // Radio coverage (radio.js): a station's circle, and a relay's when it is linked (red when it is not, or offline).
    const node = nodes.find((n) => n.base === b && !n.field); // a relay mast out on its land (sim/fieldworks.js) is not the base's own
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
  // A group's channel one of your receivers is tuned to (sim/radiolisten.js): its coverage, dotted, in its colour.
  for (const net of state.timelapse ? [] : tunedNetworks(state)) {
    ctx.strokeStyle = net.color || "#aaa";
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 5]);
    for (const n of net.nodes) {
      const [px, py] = g.toPixel(n.tile, HEX);
      ctx.beginPath();
      ctx.arc(px, py, n.range * HEX * Math.sqrt(3), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  // Markers you know about: death sites, abandoned vehicles, spotted finds, as sprites on a faint ring in their
  // layer's color (dots when zoomed far out, like minor sites). Older reports fade; dealt-with finds show emptied.
  const slot = new Map(), perTile = new Map();
  for (const m of state.markers) if (on(LAYER_OF[m.type])) perTile.set(m.tile, (perTile.get(m.tile) || 0) + 1);
  for (const m of state.markers) {
    if (!on(LAYER_OF[m.type])) continue;
    const px = G.x[m.tile], py = G.y[m.tile];
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
    const tucked = mapLoc(state, m.tile) || ownBase.has(m.tile);
    const x = tucked ? px + (-14 + n * 14) * s : px + (n - (perTile.get(m.tile) - 1) / 2) * 17 * s;
    const y = tucked ? py - 13 * s : py + 1 * s;
    const look = markerLook(state, m);
    const cv = markerSpriteCanvas(look.wreck ? "car" : m.type, PLAYER_COLOR, look); // a vehicle blown up: a wreck on the map
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
    sprite(cv, x, y, w, { alpha });
  }
  // Crash events (sim/crashes.js): until someone finds it, a dashed search circle with a smoke column and the days
  // left; then the wreck itself on its tile. Drawn every frame, not in the cached site layer: they come and go.
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const c of activeCrashes(state)) {
    const s = zoomBoost();
    const left = `${Math.max(0, Math.ceil(daysLeft(state, c)))}d`;
    if (!c.found) {
      const px = G.x[c.center], py = G.y[c.center], r = (c.radius + 0.5) * HEX * Math.sqrt(3);
      if (px + r < minX || px - r > maxX || py + r < minY || py - r > maxY) continue;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,150,60,0.07)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,160,70,0.8)";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      const cv = searchSmokeCanvas();
      sprite(cv, px, py - 6 * s, 20 * s);
      const [fx, fy] = gridPoint(cv, px, py - 6 * s, 20 * s, 4.5, 11); // mapsprites.js paintSearchSmoke: the fire at 4, 12
      fireGlow(c.center * 3 + 1, fx, fy, s);
      smokeWisps(c.center * 3 + 2, fx, fy - 2 * s, s, { n: 4, rise: 30, color: "110,110,108", alpha: 0.45, periodMs: 3200 });
      pill(px + 13 * s, py - 18 * s, `? ${left}`, "#a0521c", s);
      continue;
    }
    const px = G.x[c.tile], py = G.y[c.tile];
    if (px < minX || px > maxX || py < minY || py > maxY) continue;
    const t = state.tiles[c.tile];
    const cv = poiSpriteCanvas(t.loc ? t.loc.type : "crashsite", "", c.stripped > 0 || (t.loot || 0) < 0.3);
    const w = (gridW(cv) || 22) * POI_PX * 1.3 * s, h = spriteH(cv, w);
    ctx.beginPath();
    ctx.ellipse(px, py + 7 * s, Math.max(9 * s, w * 0.46), 4.5 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fill();
    ctx.strokeStyle = "#ff9f43";
    ctx.lineWidth = 1.8;
    ctx.stroke();
    sprite(cv, px, py + 7 * s - h / 2, w);
    pill(px + w / 2, py - h / 2, left, "#a0521c", s);
    labels.push({ text: t.loc && LOCATIONS[t.loc.type] ? LOCATIONS[t.loc.type].name : "Wreck", x: px, y: py + 7 * s + 12, pri: 1, screen: true, color: "#ffb07a", size: 9 });
  }
  // The abandoned Army convoys (sim/miltrucks.js): the site on its tile with the days left, like a found wreck.
  for (const c of activeConvoys(state)) {
    const s = zoomBoost();
    const px = G.x[c.tile], py = G.y[c.tile];
    if (px < minX || px > maxX || py < minY || py > maxY) continue;
    const t = state.tiles[c.tile];
    const cv = poiSpriteCanvas("convoy", "", c.stripped > 0 || (t.loot || 0) < 0.3);
    const w = (gridW(cv) || 26) * POI_PX * 1.2 * s, h = spriteH(cv, w);
    ctx.beginPath();
    ctx.ellipse(px, py + 7 * s, Math.max(9 * s, w * 0.46), 4.5 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fill();
    ctx.strokeStyle = "#a8b46a";
    ctx.lineWidth = 1.8;
    ctx.stroke();
    sprite(cv, px, py + 7 * s - h / 2, w);
    pill(px + w / 2, py - h / 2, `${Math.max(0, Math.ceil(convoyDaysLeft(state, c)))}d`, "#56602e", s);
    labels.push({ text: "Army convoy", x: px, y: py + 7 * s + 12, pri: 1, screen: true, color: "#c8d48a", size: 9 });
  }
  ctx.restore();
  // Field works (sim/fieldworks.js): yours and the groups' you know of, and the tile picker's green tiles.
  drawFieldWorks(state, { ctx, G, inView, s: zoomBoost(), zoom: camera.zoom, hover: view.hover, selected: view.selected, sight: on("towersight"), live, knowledge: k, place: state.timelapse ? null : view.fwPlace, colorOf: (o) => (o === "player" ? PLAYER_COLOR : (state.factions.find((f) => f.id === o) || {}).color || "#cccccc") });
  drawSurveys(state, minX, maxX, minY, maxY, labels);
  // Hordes: a crowd of the dead (more figures for bigger hordes) facing where they drift, their size on a badge;
  // stale ghosts (faded, "N?") where you saw them last. On a base's tile they stand beside it, not on top of it.
  for (let a = 0; on("hordes") && a < G.nHorde; a++) {
    const id = G.hordeT[a];
    if (!inView(id)) continue;
    const isLive = live.has(id);
    let size = 0, stale = false, target = null, bosses = 0;
    if (isLive) ({ size = 0, target = null, bosses = 0 } = hordeAt.get(id) || {});
    else if (k[id] && k[id].hordeSize) { size = k[id].hordeSize; bosses = k[id].hordeBoss || 0; stale = true; }
    if (!size) continue;
    const px = G.x[id], py = G.y[id];
    // Beside, not on top of: a base you can see or last saw there (never one you do not know about), a hive or a build site.
    const based = baseTiles.has(id) || (hasHives && G.dist[id] === 0) || siteAt.has(id) || !!(k[id] && k[id].site && !isLive);
    const s = zoomBoost() * (based ? 0.85 : 1), o = Math.min(zoomBoost(), BESIDE_MAX); // the offset stays inside the tile when zoomed out
    const x = based ? px + 17 * o : px, y = based ? py + 13 * o : py + 3 * s;
    const cv = hordeSpriteCanvas(hordeFigures(size)), w = gridW(cv) * 1.15 * s, h = spriteH(cv, w);
    const facing = target != null && target !== id && G.x[target] < px ? -1 : 1;
    ctx.beginPath();
    ctx.ellipse(x, y + h / 2 - 1.5 * s, w * 0.52, 4 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = stale ? "rgba(120,20,20,0.18)" : "rgba(120,20,20,0.42)";
    ctx.fill();
    ctx.strokeStyle = stale ? "rgba(255,120,110,0.5)" : PAL.foe;
    ctx.setLineDash(stale ? [3, 3] : []);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    const moving = !stale && target != null && target !== id;
    const sw = stale ? 0 : sway(id * 7 + 1, moving ? 0.06 : 0.025, moving ? 1400 : 2600), hb = stale ? 0 : stepBob(id * 7 + 3, (moving ? 1.3 : 0.5) * s, moving ? 700 : 1700);
    sprite(cv, x, y + hb, w, { facing, alpha: stale ? 0.45 : 1, angle: sw });
    // A Wallbreaker with the horde: the brute with the concrete fist stands at its head.
    if (bosses) sprite(wallbreakerMapCanvas(), x - facing * (w / 2 + 2 * s), y - 2 * s + (stale ? 0 : stepBob(id * 7 + 5, (moving ? 1.6 : 0.6) * s, moving ? 900 : 2000)), 14 * s * 1.2, { facing, alpha: stale ? 0.5 : 1 });
    pill(x + w / 2, y - h / 2 + 2 * s, stale ? `${size}?` : `${size}`, stale ? "rgba(122,28,24,0.6)" : "#8a1c18", s);
  }
  // Infested animals (sim/worm.js): herds you can see now, grey and gaunt on a pale ring, their number on a badge.
  for (const hd of on("hordes") ? state.herds || [] : []) {
    if (!live.has(hd.tile) || !inView(hd.tile)) continue;
    const s = zoomBoost(), px = G.x[hd.tile] - 14 * Math.min(s, BESIDE_MAX), py = G.y[hd.tile] + 10 * Math.min(s, BESIDE_MAX);
    const cv = herdSpriteCanvas(hd.kind, hd.size >= 6 ? 3 : hd.size >= 4 ? 2 : 1), w = gridW(cv) * 1.1 * s, h = spriteH(cv, w);
    ctx.beginPath();
    ctx.ellipse(px, py + h / 2 - 1.5 * s, w * 0.52, 3.5 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(150,140,120,0.3)";
    ctx.fill();
    ctx.strokeStyle = "#c9b98f";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    sprite(cv, px, py + stepBob(hd.tile * 5 + 11, 0.7 * s, 1900), w, { angle: sway(hd.tile * 5 + 13, 0.02, 3100) });
    pill(px + w / 2, py - h / 2 + 2 * s, `${hd.size}`, "#6b5a3a", s);
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
    const kind = p.vehicle || p.kind === "caravan" ? "convoy" : p.kind === "raid" ? "raid" : p.kind === "scav" ? "scav" : "walk"; // a caravan: their wagon or truck; scavengers with their sack
    const n = p.members ? p.members.length + (p.kind === "raid" ? 1 : 0) : p.strength >= 15 ? 4 : p.strength >= 7 ? 3 : 2;
    const fo = facingOf(state, p), onWay = p.path && p.idx < p.path.length - 1;
    const solo = kind !== "convoy" && n === 1 && p.phase !== "siege"; // a party of one on foot: one figure, walking (as your teams of one)
    const cv = solo ? groupSoloCanvas(type, kind, color, walkFrame(p.id, onWay)) : groupPartyCanvas(type, kind, color, n), s = zoomBoost();
    const w = gridW(cv) * (solo ? SOLO_PX : kind === "convoy" ? 1.2 : 1.1) * s;
    if (p.phase === "siege") {
      const o = Math.min(s, BESIDE_MAX);
      sprite(siegeCampCanvas(color), px - 25 * o, py + 17 * o, 26 * s);
      smokeWisps(p.id * 3 + 1, px - 25 * o, py + 17 * o - 8 * s, s, { n: 3, rise: 14 });
      groundRing(px + 24 * o, py + 12 * o, color, false, true);
      if (view.pick === `group:${p.id}`) pickRing(px + 24 * o, py + 12 * o);
      sprite(cv, px + 24 * o, py + 12 * o - 3, w, { facing: -1 });
      sprite(iconCanvas("siege"), px, py - 30 * s, ICON_W * 1.2 * s);
      noteSprite(px + 24 * o, py + 12 * o - 3, w, spriteH(cv, w));
      continue;
    }
    // On a base's tile (passing through, or arriving) the party stands beside the base, not on top of it.
    const [x, y, k2] = besideBase(tile, px, py);
    groundRing(x, y, color, false, p.kind === "raid");
    if (view.pick === `group:${p.id}`) pickRing(x, y); // selected on the map (ui/mapselect.js)
    if (onWay && kind === "convoy") dustTrail(p.id, x, y + 4 * s, s, fo, w * k2);
    const dy = !onWay ? 0 : kind === "convoy" ? rumble(p.id, 0.35 * s) : stepBob(p.id, 1.1 * s, 380);
    // A raid with its vehicles (vehicles.js assignRaidHumvee) is a mixed party too: its vehicle behind the people on foot.
    const hv = kind === "raid" && p.humvee != null ? raidHumvees(state, p) : [];
    if (hv.length) {
      const cvv = groupPartyCanvas(type, "convoy", color), wv = gridW(cvv) * 1.05 * s * k2;
      if (onWay) dustTrail(p.id * 3 + 1, x - fo * w * k2 * 0.45, y + 2 * s, s, fo, wv);
      sprite(cvv, x - fo * w * k2 * 0.45, y - 6 * s + (onWay ? rumble(p.id * 3 + 1, 0.35 * s) : 0), wv, { facing: fo });
    }
    sprite(cv, x, y - 3 + dy, w * k2, { facing: fo });
    noteSprite(x, y - 3, w * k2, spriteH(cv, w * k2));
  }
  // Hardcore mode (sim/hardcore-groups.js): bands on the road that will found a group, in that group's colors, where
  // you can see them; the military's strike force on its way to the city hive as its convoy of trucks.
  if (on("teams")) for (const b of hcMapBands(state)) {
    if (!live.has(b.tile)) continue;
    const [px, py] = g.toPixel(b.tile, HEX);
    const cv = groupPartyCanvas(b.type, b.convoy ? "convoy" : "walk", b.color, b.pop >= 15 ? 4 : b.pop >= 7 ? 3 : 2), s = zoomBoost();
    const w = gridW(cv) * 1.1 * s;
    const next = b.path && b.path[b.idx + 1];
    const facing = next != null && next !== b.tile ? (g.toPixel(next, HEX)[0] >= px ? 1 : -1) : 1;
    const [x, y, k2] = besideBase(b.tile, px, py);
    groundRing(x, y, b.color, false, false);
    if (view.pick === `band:${b.id}`) pickRing(x, y);
    const onWay = next != null && next !== b.tile;
    if (onWay && b.convoy) dustTrail(b.tile * 13 + 7, x, y + 4 * s, s, facing, w * k2);
    sprite(cv, x, y - 3 + (!onWay ? 0 : b.convoy ? rumble(b.tile * 13, 0.35 * s) : stepBob(b.tile * 13 + 1, 1.1 * s, 380)), w * k2, { facing });
    noteSprite(x, y - 3, w * k2, spriteH(cv, w * k2));
  }
  // Outsiders (sim/visitors.js): raiders from outside in dark red, merchants in gold, travellers in grey. Drawn where
  // you can see them; in radio coverage only (heard, not seen) faded on a dashed ring. The timelapse shows them all.
  if (on("teams")) for (const v of state.visitors || []) {
    const seen = live.has(v.tile);
    const heard = !seen && !state.timelapse && inCoverage(state, v.tile);
    if (!seen && !heard) continue;
    const color = OUTSIDER_COLORS[v.kind] || "#8a8a86";
    const [px, py] = g.toPixel(v.tile, HEX);
    // Merchants by their escort (sim/escorts.js): a guard ahead of the wagon, a pickup behind it, a Humvee or an MRAP leading it.
    const esc = v.kind === "merchants" && v.escort ? { tier: v.escort.tier, vehicle: v.vehicleLost ? "" : v.escort.vehicle } : null;
    const cv = outsiderPartyCanvas(v.kind, v.sub, Math.ceil(v.size / 2), esc), s = zoomBoost();
    const w = gridW(cv) * (v.kind === "merchants" ? (esc && esc.tier !== "light" ? 1.75 : 1.4) : 1.15) * s;
    const next = v.path && v.path[v.idx + 1];
    const facing = next != null && next !== v.tile ? (g.toPixel(next, HEX)[0] >= px ? 1 : -1) : 1;
    const [x, y, k2] = besideBase(v.tile, px, py);
    groundRing(x, y, color, heard, v.kind === "raiders");
    if (view.pick === `visitor:${v.id}`) pickRing(x, y);
    const onWay = !heard && next != null && next !== v.tile;
    const few = v.kind !== "merchants" && v.size >= 1 && v.size <= 2; // one or two: walkers of their own (mapsprites.js outsiderSoloCanvas)
    if (few) for (let i = v.size - 1; i >= 0; i--) { // the second a step behind and up, drawn first
      const k = (v.id || v.tile) * 17 + 3 + i * 11, cvi = outsiderSoloCanvas(v.kind, v.sub, i, walkFrame(k, onWay));
      const ox = v.size === 2 ? (i ? -5 : 4) * facing * s * k2 : 0, oy = v.size === 2 ? (i ? -2.5 : 1) * s * k2 : 0;
      sprite(cvi, x + ox, y - 3 + oy + (onWay ? stepBob(k, 1.1 * s, 380) : 0), gridW(cvi) * SOLO_PX * s * k2, { facing, alpha: heard ? 0.55 : 1 });
    }
    else sprite(cv, x, y - 3 + (onWay ? stepBob((v.id || v.tile) * 17 + 3, 1.1 * s, v.kind === "merchants" ? 520 : 380) : 0), w * k2, { facing, alpha: heard ? 0.55 : 1 });
    noteSprite(x, y - 3, w * k2, spriteH(cv, w * k2));
    if (v.phase === "siege") sprite(iconCanvas("siege"), x, y - 26 * s, ICON_W * s);
  }
  // Your bases' people out on job trips (ui/workermap.js, sim/jobtrips.js): walking out over the base's land, at work
  // with a ring filling over them, home with the load and a "+18 meat" over the base; the groups' walkers in view.
  if (on("workers") && !state.timelapse) {
    const t = state.hour + hourFrac();
    const walking = drawWorkers(ctx, state, {
      HEX, toPixel: (id) => [G.x[id], G.y[id]], sprite, walkFrame, stepBob, zoom: zoomBoost(), baseHalf: (PLACE_W.hub * zoomBoost()) / 2, t, color: PLAYER_COLOR, live, groups: true, hoverSid: view.workerHover, // the hovered worker: their route (main.js)
      near: (x, y) => !(x < minX - HEX * 3 || x > maxX + HEX * 3 || y < minY - HEX * 3 || y > maxY + HEX * 3),
    });
    if (walking && !readable.still) glidingNow = true; // drawn again as the minutes go by
  }
  // Your parties: actual position with radio contact, otherwise only the plan.
  for (const p of state.parties) {
    if (p.owner !== "player" || !on("teams")) continue;
    drawPlayerParty(state, p);
  }
  // Jobs you took for other groups (ui/diplomacy.js jobPins): a gold tag with the job's icon over its target.
  if (on("teams")) for (const pin of jobPins(state)) {
    const [px, py] = g.toPixel(pin.tile, HEX);
    pill(px, py - 24 * zoomBoost(), `${pin.icon} Job`, "#9a7410", zoomBoost());
  }
  // The player's map notes (ui/mapnotes.js): a pin per note, its text when zoomed in.
  if (state.mapNotes && !state.timelapse) drawMapNotes(ctx, state, { toPixel: (id) => [G.x[id], G.y[id]], zoom, boost: zoomBoost(), inView: (px, py) => !(px < minX || px > maxX || py < minY || py > maxY) });
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
  last.anim = animating || glidingNow;
  last.animMs = animNeed;
  last.glide = glidingNow;
}

// ---------- party sprites ----------
const PLAYER_COLOR = "#4f8fd6";    // your teams (same blue as your bases)
const CLAIM_COLOR = "#8db9ea";     // the tiles your teams claimed (sim/claims.js): a lighter player blue on the Territory layer
const ROUTE_COLOR = "#c9e07a";     // trade-route convoys
const SUPPLY_COLOR = "#5cc8b4";    // supply runs between your bases
const PHASE_COLOR = { waiting: "#ffd166", task: "#9be39b" }; // ring under your teams; moving: light blue
const lastFacing = new WeakMap();   // UI only: keeps a team facing the way it last moved

const PLACE_W = { hub: 46, outpost: 34, shelter: 38, faction: 40 }; // base sprite widths in world pixels (before zoomBoost)
const placeW = (b) => (isCamp(b) ? STAGING_W : b.tier === 0 ? PLACE_W.shelter : b.type === "hub" ? PLACE_W.hub : PLACE_W.outpost);
const STAGING_W = 34; // a camp's sprite width (sim/staging.js), an outpost's
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

// Where a site's sprite goes on its zone plate, where its label goes (labelY), and the spot beside the plate (side)
// that the danger skulls fall back to when there is no room under the name. faded: the loot band (0–3, aiscav.js).
function siteLook(t, px, py, tier, faded) {
  const s = tier < 2 ? zoomBoost() : 1, def = LOCATIONS[t.loc.type];
  const cv = poiSpriteCanvas(t.loc.type, t.loc.type === "military" && / depot$/i.test(t.loc.name) ? "depot" : "", faded);
  const w = gridW(cv) * POI_PX * s * ((ZONE_K[t.loc.zone] || 1) / (ZONE_K[t.loc.type === "city" ? "urban" : def.cat] || 1));
  const h = spriteH(cv, w), foot = py + 7 * s, rx = Math.max(9 * s, w * 0.46), ry = (tier < 2 ? 4.5 : 3.6) * s;
  return { s, cv, w, h, foot, rx, ry, lw: tier < 2 ? 1.8 : 1.3, labelY: foot + ry + 6, side: [px + rx + 2 * s, foot] };
}

// A site's sprite (look from siteLook) on its zone plate; alpha 0.55 when something stands on it.
function drawSite(d, px, py, zone, alpha) {
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.ellipse(px, d.foot, d.rx, d.ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fill();
  ctx.strokeStyle = zone.color;
  ctx.lineWidth = d.lw;
  ctx.stroke();
  ctx.globalAlpha = 1;
  sprite(d.cv, px, d.foot - d.h / 2 + 0.6 * d.s, d.w, { alpha });
}

// Tiles with something drawn over a site (a team or group party, a horde): the site sprite fades there. Markers
// do not fade it: they sit in the tile's corner and can stay for the whole game.
function busyTiles(state, live) {
  const out = new Set();
  if (on("hordes")) for (const h of state.hordes) if (live.has(h.tile)) out.add(h.tile);
  if (on("teams")) for (const p of state.parties) {
    if (!p.path || !p.path.length) continue;
    const tile = partyTile(p);
    if (p.owner === "player" ? p.kind === "convoy" || contactable(p) : live.has(tile)) out.add(tile);
  }
  return out;
}

// Which marker sprite variant: the vehicle's type, fuel and damage; an emptied find; a death site with nothing left.
function markerLook(state, m) {
  const i = m.info || {};
  if (m.type === "vehicle") {
    const v = i.vehicleId != null ? vehicleById(state, i.vehicleId) : null;
    const bike = v && v.type === "bike";
    return { vehicle: bike ? "bike" : v && v.type === "sedan" ? "sedan" : v && v.type === "miltruck" ? "miltruck" : "truck", needsFuel: !bike && i.fuel != null && i.fuel < 3, damaged: i.condition != null && i.condition < 25, ups: v ? upsCode(v.upgrades) : "", wreck: !!(v && v.destroyed) }; // ups: plates, glass, a gun on the roof (mapsprites.js); wreck: blown up (drawn as a wreck)
  }
  if (m.type === "death") return { empty: i.items === 0 };
  return { emptied: !!i.emptied };
}

// Figures in a horde sprite by its size.
const hordeFigures = (size) => (size < 15 ? 2 : size < 25 ? 3 : size < 40 ? 4 : size < 60 ? 5 : size < 90 ? 6 : 7);

// What one of your bases looks like on the map (also the cache key for its sprite).
// A camp's stage on the map (mapsprites.js paintStaging 0-3) by how far its step up is built: 0 tarps and crates, 1 the
// first stakes, 2 a frame and half a barricade, 3 nearly done. A plain camp (nothing building): 0.
function campStage(b) {
  const up = tierUpJob(b);
  const f = up && up.hours ? up.progress / up.hours : 0;
  return f >= 0.85 ? 3 : f >= 0.5 ? 2 : f >= 0.2 ? 1 : 0;
}
const oldCampPct = (c) => (c.work > 0 ? Math.max(0, Math.min(1, c.progress / c.work)) : 1);
function baseLook(b) {
  const def = (x) => BUILDINGS[x.type] || {};
  const hosp = Math.max(0, ...b.buildings.map((x) => (def(x).family === "hospital" ? def(x).tier : 0)));
  const farms = count(b, "farm_plot");
  return {
    kind: b.tier === 0 ? "shelter" : b.type === "hub" ? "hub" : "outpost", color: PLAYER_COLOR, walls: Math.min(3, count(b, "walls")),
    rain: count(b, "rain_catcher") > 0, rack: count(b, "smoker") > 0, fire: b.fire, // a shelter's look (mapsprites.js paintShelter)
    tower: !!b.watchtower, radio: !!b.radio || count(b, "relay") > 0, hosp, farms: farms >= 4 ? 2 : farms ? 1 : 0,
    workshop: b.buildings.some((x) => def(x).station), big: b.buildings.length >= 4,
  };
}

const spriteH = (cv, w) => (cv ? w * (cv.height / cv.width) : w * 0.75);

// Oval under a base in its owner's color; a pulsing red ring while it is under siege.
// A bloc's members (sim/blocs.js): a dashed ring in the bloc's colour round the plate.
function blocRing(x, y, color, s) {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y + 9 * s, 23 * s, 9.5 * s, 0, 0, Math.PI * 2);
  ctx.setLineDash([5 * s, 3 * s]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}
// A construction bar under a sprite, centered at x with its top at y: the work done (amber, green once full) and,
// lighter, as far as the materials allow (cap). Returns the y of its bottom edge.
function buildBarOnMap(x, y, s, f, cap = f) {
  const bw = 30 * s, bh = 4 * s, bx = x - bw / 2;
  ctx.fillStyle = "rgba(13,15,18,0.85)";
  ctx.fillRect(bx - 1.5, y - 1.5, bw + 3, bh + 3);
  if (cap > f) { ctx.fillStyle = "rgba(224,168,79,0.35)"; ctx.fillRect(bx, y, bw * Math.min(1, cap), bh); }
  ctx.fillStyle = f >= 1 ? PAL.good : "#e0a84f";
  ctx.fillRect(bx, y, bw * Math.max(0, Math.min(1, f)), bh);
  return y + bh;
}
// The bloc a group's base belongs to, as a small number for the site code (0: none).
const blocNo = (state, f) => { const b = blocOf(state, f); return b ? (b.id % 255) + 1 : 0; };
function ownerPlate(x, y, color, s, rx, besieged) {
  ctx.beginPath();
  ctx.ellipse(x, y + 9 * s, rx * s, 6 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  if (!besieged) return;
  const t = readable.still ? 0.35 : (Date.now() % 1200) / 1200;
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
      const size = (l.screen && camera.zoom < 1 ? l.size / camera.zoom : l.size) * readable.text;
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
      for (let i = 0; i < l.skulls; i++) sprite(l.red ? redSkullCanvas() : skullCanvas(), x0 + sw / 2 + i * (sw + gap), cy, sw, { alpha: 0.95 });
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
// A team of one (mapsprites.js soloSpriteCanvas, cyclistSpriteCanvas, groupSoloCanvas): map px per sprite pixel, a little
// bigger than a group's figures so one person reads at a glance.
const SOLO_PX = 1.3;

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
    : p.vehicle === true ? (v && v.type === "sedan" ? "sedan" : v && v.type === "miltruck" ? "miltruck" : "truck") : p.mission === "recon" ? "scouts" : p.mission === "help" ? "relief" : "walkers";
  const count = (p.members || []).length;
  // A team of one: a lone walker, or a rider on a bike (a car keeps its vehicle sprite).
  const solo = p.kind === "convoy" || count !== 1 ? "" : p.vehicle === "bike" ? "cyclist" : !p.vehicle && soloKind(kind) ? "walker" : "";
  return { color, kind, count, solo, ups: v && p.kind !== "convoy" ? upsCode(v.upgrades) : "" }; // ups: its upgrades (mapsprites.js upsCode)
}

// The sprite for one of your teams this frame: a team of one gets its own figure (walking or standing, a rider pedalling
// or stopped; at night the light it carries is lit); the rest the cached party sprite. Returns [canvas, width in map px].
// Also how the lone walker's step bobs: [canvas, width, bob] (bob: map px, 0 standing or for the rest).
function teamCanvas(state, p, look, moving, night = false) {
  if (!look.solo) return [partySpriteCanvas(look.kind, look.color, look.count, look.ups), spriteW(look.kind), 0];
  const s = partyMembers(state, p)[0], light = night && s ? lightOf(s) || "" : "", sz = zoomBoost();
  if (look.solo === "cyclist") { const cv = cyclistSpriteCanvas(look.color, pedalFrame(p.id, moving)); return [cv, gridW(cv) * SOLO_PX * sz, moving ? stepBob(p.id, 0.4 * sz, 480) : 0]; }
  const gait = soloGait(p, s), ms = GAIT_MS[gait], f = walkFrame(p.id, moving, ms, gait);
  const cv = soloSpriteCanvas(look.kind, look.color, f, light, gait);
  // A limp dips on the hurt leg; a heavy load bobs less.
  const bob = !moving ? 0 : stepBob(p.id, (gait === "heavy" ? 0.7 : 1.1) * sz, ms) + (f === 4 && animOn() ? 0.8 * sz : 0);
  return [cv, gridW(cv) * SOLO_PX * sz, bob];
}
// How a lone walker goes: "limp" when hurt (under 60% health, an infected wound, or a cut or sprain: health.js injuries),
// "heavy" when their load is Heavy or more (load.js bands, as last weighed: p.burden), else "" (a steady walk).
const GAIT_MS = { "": 380, heavy: 520, limp: 560 };
const WOUNDED_BELOW = 60;
function soloGait(p, s) {
  if (s && (s.health < WOUNDED_BELOW || s.woundInfected || conditionsOf(s).some((c) => CONDITIONS[c.key] && CONDITIONS[c.key].kind === "injury"))) return "limp";
  return p.burden && p.burden.band >= 2 ? "heavy" : "";
}
// Who goes beside a team's vehicle (a mixed team): people without a seat walk beside it (sim/walkers.js p.walkers), or
// the bikes ride along with the cars (a fleet: vehicles.js). "walker" | "cyclist" | "".
function sideFigure(state, p) {
  if (p.vehicle !== true || p.kind === "convoy") return ""; // (bike teams of two or more already draw as people)
  if (p.walkers > 0) return "walker";
  if (partyVehicles(state, p).some((v) => v.type === "bike")) return "cyclist";
  return "";
}
// Draws that figure beside and a little behind the vehicle (cx, cy its center, w its width), walking or riding.
function drawSideFigure(p, side, color, cx, cy, w, facing, moving, k2 = 1, alpha = 1) {
  const sz = zoomBoost(), k = p.id * 7 + 5;
  const cv = side === "cyclist" ? cyclistSpriteCanvas(color, pedalFrame(k, moving)) : soloSpriteCanvas("walkers", color, walkFrame(k, moving));
  const bob = moving ? stepBob(k, (side === "cyclist" ? 0.4 : 1.1) * sz, side === "cyclist" ? 480 : 380) : 0;
  sprite(cv, cx - facing * w * 0.46, cy + 3 * sz + bob, gridW(cv) * SOLO_PX * sz * 0.9 * k2, { facing, alpha });
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

// The gold ring of a party selected on the map (ui/mapselect.js), around its ground ring: the selected tile's color.
function pickRing(x, y) {
  const s = zoomBoost();
  ctx.beginPath();
  ctx.ellipse(x, y + 7 * s, 17 * s, 7.5 * s, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "#e0a84f";
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

// Status icon at a sprite's top right: "alert" (waiting for orders), "work", "radio", "unknown" ("?" in color).
function badge(x, y, kind, color) {
  const s = zoomBoost();
  const bx = x + 12 * s, by = y - 12 * s, k = Math.round(x * 7 + y * 13);
  if (kind === "radio" && animOn()) { // the signal: a ring that grows and fades every couple of seconds
    wantFrames();
    const t = (animNow / 2200 + phaseOf(k)) % 1;
    ctx.beginPath();
    ctx.arc(bx, by, (3 + t * 9) * s, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(155,227,155,${(0.55 * (1 - t)).toFixed(3)})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  sprite(iconCanvas(kind, color), bx, by + (kind === "alert" ? stepBob(k, 1.6 * s, 900) : 0), ICON_W * s);
}

// Number badge (horde sizes): a pill with white text centered on (x, y).
// Surveys (sim/survey.js): the circle a team sweeps (teal) with the path it has walked and where it goes next (in radio
// contact), and rumours of hidden places (a dashed amber circle with "?" and the days left: the place is inside).
function drawSurveys(state, minX, maxX, minY, maxY, labels) {
  const G = geometry(state);
  const s = zoomBoost();
  const R = HEX * Math.sqrt(3);
  const off = (px, py, r) => px + r < minX || px - r > maxX || py + r < minY || py - r > maxY;
  ctx.save();
  for (const r of rumoursOf(state)) {
    const px = G.x[r.center], py = G.y[r.center], rad = (r.radius + 0.5) * R;
    if (off(px, py, rad)) continue;
    ctx.beginPath();
    ctx.arc(px, py, rad, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(240,200,90,0.06)";
    ctx.fill();
    ctx.strokeStyle = "rgba(240,200,90,0.75)";
    ctx.lineWidth = 1.6;
    ctx.setLineDash([3, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    pill(px, py - 6 * s, `? ${Math.max(1, Math.ceil((r.expires - state.hour) / 24))}d`, "#8a6d1c", s);
    labels.push({ text: `${r.what[0].toUpperCase()}${r.what.slice(1)}?`, x: px, y: py + 10 * s, pri: 1, screen: true, color: "#f0c85a", size: 9 });
  }
  for (const p of state.parties) {
    if (p.owner !== "player" || !p.task || p.task.type !== "sweep" || p.phase !== "task") continue;
    const t = p.task;
    const px = G.x[t.center], py = G.y[t.center], rad = (t.radius + 0.5) * R;
    if (off(px, py, rad)) continue;
    ctx.beginPath();
    ctx.arc(px, py, rad, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(90,200,190,0.07)";
    ctx.fill();
    ctx.strokeStyle = "rgba(110,215,205,0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    // The way it has come (and, reporting live, the next spots): a line through the tiles of its route.
    if (reportsLive(p)) {
      const upto = Math.min(t.route.length - 1, t.done);
      const path = (from, to, style, width) => {
        ctx.beginPath();
        let first = true;
        for (let i = from; i <= to; i++) { const id = t.route[i]; if (first) { ctx.moveTo(G.x[id], G.y[id]); first = false; } else ctx.lineTo(G.x[id], G.y[id]); }
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.stroke();
      };
      path(0, upto, "rgba(110,215,205,0.7)", 2.2);
      ctx.setLineDash([2, 4]);
      path(upto, t.route.length - 1, "rgba(110,215,205,0.35)", 1.5);
      ctx.setLineDash([]);
    }
    pill(px + rad * 0.7, py - rad * 0.7, `${t.done}/${t.hours}h${t.found.length ? ` · ${t.found.length}` : ""}`, "#2f7d76", s);
  }
  ctx.restore();
}

function pill(x, y, text, bg, s) {
  s *= readable.text;
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

// A team's Heat (sim/fieldheat.js) as a small bar under its sprite: green, amber, orange, red by level.
function heatBar(px, py, heat) {
  const s = zoomBoost(), w = 22 * s, h = Math.max(2, 3 * s), x = px - w / 2, y = py + 8 * s;
  ctx.fillStyle = "rgba(13,15,18,0.85)";
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = heat < 25 ? PAL.good : heat < 50 ? "#e8d06a" : heat < 75 ? PAL.mid : PAL.bad;
  ctx.fillRect(x, y, (w * Math.min(100, heat)) / 100, h);
}

// A soft warm glow round a team at night, as wide as its brightest light reaches and stronger the more of them are lit.
function lightGlow(state, p, x, y) {
  let best = null, n = 0;
  for (const s of partyMembers(state, p)) { const k = lightOf(s); if (k) { n++; if (!best || LIGHTS[k].sight > LIGHTS[best].sight) best = k; } }
  if (!best) return;
  const s = zoomBoost(), r = (10 + (LIGHTS[best].sight - 7) * 4) * s, a = Math.min(0.42, 0.18 + 0.06 * n);
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, best === "torch" ? `rgba(255,170,80,${a})` : `rgba(255,236,160,${a})`);
  grad.addColorStop(1, "rgba(255,236,160,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
// The pill over a team waiting on its way (glideAt sit kinds).
const SIT_LABEL = { road: "Clearing road", repair: "Repairing", delay: "Held up" };
function drawPlayerParty(state, p) {
  const g = state.grid;
  const color = p.kind === "convoy" ? "#c9e07a" : p.phase === "waiting" ? "#ffd166" : p.phase === "task" ? PAL.task : "#7fd0ff";
  const look = partyLook(state, p);
  const ring = p.kind === "convoy" ? look.color : p.phase === "task" ? PAL.task : PHASE_COLOR[p.phase] || "#7fd0ff";
  // Your teams are always in reach of your orders (sim/plans.js commandable), so you know where they are.
  if (p.kind === "convoy" || contactable(p)) {
    let [px, py] = g.toPixel(partyTile(p), HEX);
    // On the move: part of the way to the next tile, by the minutes gone of the hour (sim/parties.js glideAt).
    // A team holding for a card in the tray (ui/pacing.js) stays put: it does not move on when the hour ticks.
    const gl = state.timelapse ? null : glideAt(state, p, hourFrac(), holdsNextHour(state, p));
    const glide = gl && gl.to !== gl.from && gl.t > 0 ? gl : null;
    const from = glide ? p.path.indexOf(glide.to, p.idx) : p.idx;
    let gx = px, gy = py;
    if (glide) {
      const [ax, ay] = g.toPixel(glide.from, HEX), [bx, by] = g.toPixel(glide.to, HEX);
      gx = ax + (bx - ax) * glide.t;
      gy = ay + (by - ay) * glide.t;
      glidingNow = true;
    }
    // Remaining path.
    ctx.strokeStyle = (p.kind === "convoy" ? look.color : color) + "aa";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    for (let i = Math.max(p.idx, from); i < p.path.length; i++) {
      const [x, y] = g.toPixel(p.path[i], HEX);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    let facing = facingOf(state, p);
    if (glide) {
      const dx = g.toPixel(glide.to, HEX)[0] - g.toPixel(glide.from, HEX)[0];
      if (Math.abs(dx) > 0.5) { facing = dx > 0 ? 1 : -1; lastFacing.set(p, facing); }
    }
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
        sprite(wakeCanvas(), px - facing * 10 * s, py + 5 * s, 30 * s, { facing });
        sprite(partySpriteCanvas(kind, look.color), px, py + sway(p.id * 3 + 2, 1 * s, 1500), spriteW(kind), { facing, angle: sway(p.id * 3 + 1, 0.07, 1900) }); // the boat rocks
        crewTag(p, px, py);
        return;
      }
    }
    let k2 = 1;
    if (glide) { // from beside a base (or to it) as it sets off or comes in
      const [ax, ay, ka] = besideBase(glide.from, ...g.toPixel(glide.from, HEX));
      const [bx, by, kb] = besideBase(glide.to, ...g.toPixel(glide.to, HEX));
      px = ax + (bx - ax) * glide.t;
      py = ay + (by - ay) * glide.t;
      k2 = ka + (kb - ka) * glide.t;
    } else [px, py, k2] = besideBase(partyTile(p), px, py); // on a base's tile: beside the base, not on top of it
    const camping = p.phase === "task" && p.task && p.task.type === "camp";
    if (camping) { // tent and campfire behind the team
      const s = zoomBoost();
      const cc = campSpriteCanvas(CAMP_TENT);
      sprite(cc, px + 14 * s, py - 8 * s, 26 * s);
      const [fx, fy] = gridPoint(cc, px + 14 * s, py - 8 * s, 26 * s, 14.5, 7); // the campfire (mapsprites.js paintCamp: campfire at 13, 9)
      fireGlow(p.id * 5 + 1, fx, fy, s);
      smokeWisps(p.id * 5 + 2, fx, fy - 2 * s, s, { n: 3, rise: 13 });
    }
    if (isNight(state)) lightGlow(state, p, px, py); // sim/lights.js: a team carrying lights glows in the dark
    groundRing(px, py, ring, false);
    if (view.pick === `team:${p.id}` || view.pick === `convoy:${p.id}`) pickRing(px, py); // selected (ui/mapselect.js)
    // On the move: people bob in step, a cart a little slower; a vehicle rumbles and raises dust.
    const onWay = (p.phase === "out" || p.phase === "back") && p.path && p.idx < p.path.length - 1;
    const [cvp, w1, bob] = teamCanvas(state, p, look, onWay, isNight(state)), wp = w1 * k2;
    const motor = ["truck", "sedan", "convoy", "supply"].includes(look.kind), sz = zoomBoost();
    if (onWay && motor) dustTrail(p.id, px, py + 4 * sz, sz, facing, wp);
    const dy = !onWay ? 0 : look.solo ? bob : motor ? rumble(p.id, 0.35 * sz) : stepBob(p.id, (look.kind.includes("cart") ? 0.8 : 1.1) * sz, look.kind.includes("cart") ? 520 : 380);
    sprite(cvp, px, py - 3 + dy, wp, { facing });
    const side = sideFigure(state, p); // a mixed team: someone walking (or riding a bike) beside the vehicle
    if (side) drawSideFigure(p, side, look.color, px, py - 3, wp, facing, onWay, k2);
    noteSprite(px, py - 3, wp, spriteH(cvp, wp));
    if (p.kind !== "convoy" && (p.heat || 0) >= 5 && !state.timelapse) heatBar(px, py, p.heat); // fieldheat.js: standing still draws attention
    if (p.phase === "waiting") badge(px, py, "alert", "#ffd166");
    else if (p.phase === "task" && !camping) badge(px, py, "work");
    else if (p.kind !== "convoy" && p.radioLive && !state.timelapse) badge(px, py, "radio"); // timelapse: everything is live
    // A wait on the way, with the minutes left of it (sim/parties.js glideAt: the same course the hour will take):
    // a road blockage being cleared, a repair, another delay. Above a crew's name.
    // (Drawn still, the team stands where the hour began: the wait is read at the clock's real minutes.)
    const sit = gl && readable.still ? glideAt(state, p, view.hourFrac || 0, holdsNextHour(state, p)).sit : gl && gl.sit;
    const wait = sit ? sit : !gl && heldUp(state, p) ? { kind: "road", mins: 0 } : null;
    if (wait && !state.timelapse) glidingNow = true; // its minutes count down: drawn again as the clock moves
    if (wait) pill(px, py - (p.crewName ? 34 : 22) * zoomBoost(), `${SIT_LABEL[wait.kind] || "Held up"}${wait.mins ? ` ${clockText(wait.mins / 60)}` : ""}`, "#8a5a1c", zoomBoost());
    crewTag(p, px, py);
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
  let est, gp = null;
  if (p.etaOut != null) {
    // To the minute (sim/parties.js plannedPos: the same stepping as the team's, arriving at its minute).
    gp = plannedPos(state, p, state.timelapse ? 0 : Math.max(0, Math.min(1, hourFrac())));
    est = gp.path[Math.min(gp.path.length - 1, Math.floor(gp.pos + 1e-9))];
  } else {
    const elapsed = state.hour - p.departed;
    const half = p.plannedHours / 2;
    const frac = elapsed < half ? elapsed / half : Math.max(0, 1 - (elapsed - half) / half);
    est = plan[Math.min(plan.length - 1, Math.round(frac * (plan.length - 1)))];
  }
  const [tx, ty] = g.toPixel(est, HEX);
  let [ex, ey, ke] = besideBase(est, tx, ty);
  // Part-way along a step of the planned way, by the minutes gone of the hour.
  if (gp && gp.pos - Math.floor(gp.pos + 1e-9) > 1e-6) {
    const a = Math.floor(gp.pos), k = gp.pos - a;
    const [ax, ay] = g.toPixel(gp.path[a], HEX), [bx, by] = g.toPixel(gp.path[a + 1], HEX);
    ex = ax + (bx - ax) * k;
    ey = ay + (by - ay) * k;
    ke = 1;
    if (Math.abs(bx - ax) > 0.5) lastFacing.set(p, bx > ax ? 1 : -1);
    glidingNow = true;
  }
  // Faded sprite on a dashed ring: where the team should be if the plan held.
  groundRing(ex, ey, color, true);
  if (view.pick === `team:${p.id}` || view.pick === `convoy:${p.id}`) pickRing(ex, ey);
  const cve = look.solo === "walker" ? soloSpriteCanvas(look.kind, look.color, 1) : look.solo ? cyclistSpriteCanvas(look.color, 1) : partySpriteCanvas(look.kind, look.color, look.count, look.ups); // a team of one: mid-stride, held (a guess, not seen)
  const we = (look.solo ? gridW(cve) * SOLO_PX * zoomBoost() : spriteW(look.kind)) * ke;
  sprite(cve, ex, ey - 3, we, { facing: lastFacing.get(p) || 1, alpha: 0.5 });
  const side = sideFigure(state, p);
  if (side) drawSideFigure(p, side, look.color, ex, ey - 3, we, lastFacing.get(p) || 1, false, ke, 0.5);
  noteSprite(ex, ey - 3, we, spriteH(cve, we));
  badge(ex, ey, "unknown", color);
  crewTag(p, ex, ey);
}

// A crew's team (sim/crews.js) carries its role's name above the sprite.
function crewTag(p, x, y) {
  if (!p.crewName) return;
  const s = zoomBoost();
  const size = 10 * s * readable.text;
  ctx.save();
  ctx.font = `bold ${size.toFixed(1)}px Segoe UI`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = size * 0.3;
  ctx.strokeStyle = "rgba(13,15,18,0.85)";
  ctx.strokeText(p.crewName, x, y - 22 * s);
  ctx.fillStyle = "#e0a84f";
  ctx.fillText(p.crewName, x, y - 22 * s);
  ctx.restore();
}

export function tileTooltip(state, id) {
  const t = state.tiles[id];
  const isLive = liveSet(state).has(id);
  const snap = state.knowledge[id];
  const loc = mapLoc(state, id); // a hidden site nobody has found is bare ground (sim/discovery.js)
  const lines = [`<b>${esc(loc ? loc.name : TERRAIN[t.terrain].name)}</b>`];
  const ownHere = state.bases.find((b) => b.tile === id);
  if (ownHere) lines.push(`<span style="color:#cfe2f7">${esc(ownHere.name)}</span>`);
  const campTip = stagingTip(state, id); // sim/staging.js
  if (campTip) lines.push(`<span style="color:#cfe2f7">${esc(campTip)}</span>`);
  if (loc) {
    const def = LOCATIONS[loc.type], zone = SITE_ZONES[loc.zone || def.cat];
    lines.push(`<span class="muted">${def.name}${zone ? ` · ${zone.name.toLowerCase()}` : ""} · ${TERRAIN[t.terrain].name}${t.road ? " · road" : " · off-road"}</span>`);
    lines.push(`<span class="muted">Danger: ${DANGER_NAMES[siteDanger(loc)].toLowerCase()}</span>`);
  }
  else lines.push(`<span class="muted">${TERRAIN[t.terrain].name}${t.road ? " · road" : ""}</span>`);
  if (isLive) lines.push(`<span class="good">Live view</span>`);
  else if (snap) lines.push(`<span class="muted">Last seen ${ageText(state, snap)}</span>`);
  else lines.push(`<span class="muted">No current intel</span>`);
  const ct = claimText(state, id); // sim/claims.js: "Claimed by you (day N)", and the well on it
  if (ct) lines.push(`<span style="color:#8db9ea">${esc(ct)}</span>`);
  const wt = wellText(state, id);
  if (wt) lines.push(`<span style="color:#8db9ea">${esc(wt)}</span>`);
  const fwt = fwTooltipLine(state, id); // sim/fieldworks.js: a field work here
  if (fwt && (isLive || state.bases.length && fwt.includes("yours") || snap)) lines.push(`<span style="color:#cfe2f7">${esc(fwt)}</span>`);
  if (view.fwPlace) { const pl = view.fwPlace.find((x) => x.tile === id); if (pl) lines.push(pl.why ? `<span class="danger">${esc(pl.why)}</span>` : `<span class="good">Click to place it here</span>`); }
  // Loot left as you know it (aiscav.js bands): the live value, else the last you saw or heard (it may be gone since).
  if (loc && !ownHere && (isLive || snap)) lines.push(`<span class="muted">Loot: ${LOOT_BANDS[lootBand(t, isLive ? t.loot : snap.loot)].toLowerCase()}${isLive ? "" : " (then)"}</span>`);
  for (const m of state.markers.filter((m) => m.tile === id)) lines.push(`${MARKER_TYPES[m.type].glyph} ${esc(m.label)} <span class="muted">· spotted ${ageText(state, m)}${m.info?.emptied ? " · emptied" : ""}</span>`);
  for (const p of state.parties.filter((p) => p.owner === "player" && p.phase === "waiting" && partyTile(p) === id)) lines.push(`<span style="color:#ffd166">Team waiting for orders</span>`);
  for (const pin of jobPins(state)) if (pin.tile === id) lines.push(`<span style="color:#e0b84f">${pin.icon} Job: ${pin.label.replace(/[&<>"]/g, "")}</span>`); // ui/diplomacy.js
  // Heat of your teams standing here (sim/fieldheat.js): what the bar under the sprite means.
  for (const p of state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy" && (p.heat || 0) >= 5 && (p.phase === "waiting" || p.phase === "task" || reportsLive(p)) && partyTile(p) === id)) lines.push(`<span class="${p.heat >= 50 ? "warn" : "muted"}">${esc(heatInfo(state, p).text)}</span>`);
  const held = state.survivors.filter((s) => s.alive && s.location && s.location.kind === "captive" && s.location.tile === id);
  if (held.length) lines.push(`<span style="color:#ff6b6b">Holds your people: ${held.map((s) => esc(s.name.split(" ")[0])).join(", ")}</span>`);
  for (const line of crashTip(state, id)) lines.push(`<span style="color:#ffb07a">${esc(line)}</span>`); // sim/crashes.js
  for (const line of convoyTip(state, id)) lines.push(`<span style="color:#c8d48a">${esc(line)}</span>`); // sim/miltrucks.js
  for (const line of surveyTip(state, id)) lines.push(`<span style="color:#f0c85a">${esc(line)}</span>`); // sim/survey.js: surveys and rumours
  for (const o of visitorTipLines(state, id, liveSet(state))) lines.push(`<span style="color:${o.color === "#7a1a1a" ? "#ff8a7f" : o.color}">${esc(o.text)}</span>`); // sim/visitors.js
  for (const line of caravanTipLines(state, id, liveSet(state))) lines.push(`<span style="color:#e0c070">${esc(line)}</span>`); // sim/caravanraids.js: the groups' caravans and convoys
  for (const o of bandTipLines(state, id, liveSet(state))) lines.push(`<span style="color:${o.color}">${esc(o.text)}</span>`); // sim/hardcore-groups.js
  if (hasKey(state, id)) lines.push(`<span class="good">🔑 You hold a key for this place: it opens its locks.</span>`); // sim/locks.js
  // An empty base you know of (sim/occupy.js): what stands and, in view, who is inside (out of view: as last seen).
  const em = ownHere ? null : emptyKnown(state, id);
  if (em) {
    const v = liveSet(state).has(id) ? occupyPreview(state, id) : null;
    lines.push(`<span style="color:${EMPTY_LABEL}">🏚 ${esc(emptyTitle(em))}, empty since day ${em.day}: ${v ? `${esc(v.standing)} · inside: ${esc(v.threatText)}` : `${em.standing} building${em.standing === 1 ? "" : "s"} standing when last seen`}. Right-click: ${em.from === "player" ? "Reoccupy" : "Occupy"}.</span>`);
  }
  const ru = ownHere ? null : ruinInfo(state, id);
  if (ru) lines.push(`<span style="color:${RUIN_LABEL}">${esc(ru.title)}: salvage ${ru.salvage.toLowerCase()}${ru.salvageLive ? "" : " (then)"} · danger ${ru.dangerName.toLowerCase()}</span>`);
  for (const line of weatherTipLines(state, id)) lines.push(`<span style="color:#b9d3ee">${esc(line)}</span>`); // ui/wxmap.js: a front over it, ice
  const sd = searchedDay(state, id);
  if (sd) lines.push(`<span style="color:#8fd8cf">Searched by your people on day ${sd}</span>`); // sim/discovery.js (Known area layer)
  const nt = noteTip(state, id); // your map notes here (ui/mapnotes.js)
  if (nt) lines.push(nt);
  return lines.join("<br>");
}

export { ageText, day, hub };
