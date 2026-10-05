// Tile texture design preview (design/tiles.html). Draws one hand-made sample region in every style at three
// zoom levels with the real site, base, team and horde sprites on top, measures what each style costs on a Huge
// map's chunk cache, and can save every panel as a PNG (only when served by a dev server that accepts
// POST /__save/<name>.png; the plain server.cjs ignores it). Nothing in the game imports this.
import { HexGrid } from "../src/sim/hex.js";
import { LOCATIONS, SITE_ZONES, siteDanger } from "../src/sim/data.js";
import { generateMap } from "../src/sim/mapgen.js";
import { Rng } from "../src/sim/rng.js";
import { poiSpriteCanvas, partySpriteCanvas, hordeSpriteCanvas, baseSpriteCanvas, skullCanvas, drawMapSprite, gridW } from "../src/ui/mapsprites.js";
import { STYLES, HEX, drawGround, prepWorld, tilesIn, bucketOf, hash } from "./tilestyles.js";

const PR = 2;                       // device px per CSS px for the panels (a 4K screen at 200%)
const PW = 640, PH = 400;           // panel size, CSS px
const BG = "#0d0f12";
const PLAYER_COLOR = "#4f8fd6";
const ZOOMS = [
  { key: "far", name: "Zoomed out (0.42)", zoom: 0.42 },
  { key: "mid", name: "Mid (1.0)", zoom: 1.0 },
  { key: "close", name: "Close (2.2)", zoom: 2.2 },
];

// ---------- the sample region: every terrain, a river with a bridge, roads, a city, snow, infection, fog ----------
function sampleWorld() {
  const GW = 30, GH = 20, grid = new HexGrid(GW, GH), tiles = [];
  for (let id = 0; id < grid.size; id++) {
    const [x, y] = grid.xy(id);
    tiles.push({ id, x, y, terrain: "plains", road: false, roadLinks: [], river: false, bridge: false, loc: null, infection: 0, fog: 0, snow: false });
  }
  const at = (x, y) => tiles[grid.id(x, y)];
  const dist = (t, x, y) => grid.distance(t.id, grid.id(x, y));
  const wob = (t) => (hash(t.x * 7, t.y * 13) % 1000) / 1000;
  for (const t of tiles) {
    const w = wob(t);
    const df = dist(t, 5, 10), dm = dist(t, 22, 3), dc = dist(t, 19, 10);
    if (df <= 3 || (df === 4 && w < 0.55) || dist(t, 12, 12) <= 1 || (dist(t, 12, 12) === 2 && w < 0.45) || dist(t, 11, 4) <= 1) t.terrain = "forest";
    if (dist(t, 5, 2) <= 1 || (dist(t, 5, 2) === 2 && w < 0.6)) t.terrain = "hills";
    if (dm <= 1 || (dm === 2 && w < 0.55)) t.terrain = "mountain";
    else if (dm <= 3 || (dm === 4 && w < 0.6)) t.terrain = "hills";
    if (dc <= 1) t.terrain = "city";
    else if (dc <= 2 || (dc === 3 && w < 0.7)) t.terrain = "suburb";
    if (dist(t, 24, 15) <= 1) t.terrain = "suburb";
    if (dist(t, 4, 16) <= 1 || (t.x === 6 && t.y === 17)) t.terrain = "water";
  }
  for (const [x, y] of [[15, 8], [16, 8], [16, 7], [15, 7], [18, 6]]) at(x, y).terrain = "hills";
  for (const [x, y] of [[17, 7], [17, 6]]) at(x, y).terrain = "mountain";
  // A river from the north edge to the south edge, steered toward a gentle meander.
  let x = 14;
  for (let y = 0; y < GH; y++) {
    const t = at(x, y);
    t.terrain = "water"; t.river = true;
    if (y === GH - 1) break;
    const tx = 14 + Math.round(1.6 * Math.sin((y + 1) * 0.55));
    const opts = y & 1 ? [x, x + 1] : [x - 1, x];
    x = Math.abs(opts[0] - tx) <= Math.abs(opts[1] - tx) ? opts[0] : opts[1];
  }
  // Roads along hex lines between waypoints.
  const line = (a, b) => {
    const A = grid.cube(grid.id(...a)), B = grid.cube(grid.id(...b)), n = grid.distance(grid.id(...a), grid.id(...b)), out = [];
    for (let i = 0; i <= n; i++) {
      const f = n ? i / n : 0, q = A[0] + (B[0] - A[0]) * f + 1e-6, r = A[1] + (B[1] - A[1]) * f + 2e-6, s = -q - r;
      let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
      const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
      if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
      out.push(grid.fromCube(rq, rr));
    }
    return out;
  };
  for (const [a, b] of [[[0, 10], [10, 10]], [[10, 10], [19, 10]], [[19, 10], [29, 4]], [[19, 10], [21, 19]], [[10, 10], [8, 14]], [[19, 10], [24, 15]]]) {
    const ids = line(a, b);
    for (let i = 0; i < ids.length; i++) {
      const t = tiles[ids[i]];
      t.road = true;
      if (t.terrain === "water") t.bridge = true;
      if (i) { const p = tiles[ids[i - 1]]; if (!p.roadLinks.includes(t.id)) p.roadLinks.push(t.id); if (!t.roadLinks.includes(p.id)) t.roadLinks.push(p.id); }
    }
  }
  const site = (x, y, type, name, extra = {}) => (at(x, y).loc = { type, name, zone: LOCATIONS[type].cat, ...extra });
  site(19, 10, "city", "Calder City");
  site(24, 15, "town", "Millbrook");
  site(20, 12, "hospital", "Mercy General");
  site(20, 8, "police", "North Precinct");
  site(16, 10, "gas", "Gas station");
  site(8, 14, "farm", "Hollis Farm");
  site(5, 8, "cabin", "Pine Cabin");
  site(16, 8, "radiotower", "Radio tower");
  const hub = at(10, 10);
  hub.base = { name: "Haven" };
  for (const t of tiles) {
    const d = dist(t, 10, 10), w = wob(t);
    t.fog = d <= 7 ? 0 : d <= 11 ? 1 : 2;
    const dc = dist(t, 19, 10), dt = dist(t, 24, 15);
    t.infection = Math.max(0, dc <= 4 ? 0.8 - dc * 0.17 + (w - 0.5) * 0.1 : 0, dt <= 2 ? 0.45 - dt * 0.15 : 0);
    t.snow = t.y <= 7 && t.x >= 15 && !(t.y === 7 && w < 0.3 && t.x > 17);
  }
  return { grid, tiles, hub: hub.id, team: grid.id(12, 10), horde: grid.id(16, 11) };
}

// ---------- what sits on the map (copied in spirit from render.js: same sprites, plates, names and skulls) ----------
function drawObjects(ctx, W, scene, zoom, S) {
  const zb = Math.max(1, Math.sqrt(0.9 / zoom)), X = W.X, Y = W.Y;
  const sp = (cv, x, y, w, o) => drawMapSprite(ctx, cv, x, y, w, o, S);
  const labels = [];
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const t of scene.tiles) {
    if (!t.loc) continue;
    const px = X[t.id], py = Y[t.id], tier = t.loc.type === "city" ? 0 : t.loc.type === "town" ? 1 : 2;
    const zone = SITE_ZONES[t.loc.zone] || SITE_ZONES.special;
    if (tier === 2 && zoom < 0.7) {
      ctx.beginPath(); ctx.arc(px, py, 2.6 / zoom, 0, Math.PI * 2); ctx.fillStyle = zone.color; ctx.fill();
      continue;
    }
    const s = tier < 2 ? zb : 1, cv = poiSpriteCanvas(t.loc.type, "", 0), w = gridW(cv) * 1.1 * s, h = w * (cv.height / cv.width);
    const foot = py + 7 * s, rx = Math.max(9 * s, w * 0.46), ry = (tier < 2 ? 4.5 : 3.6) * s;
    ctx.beginPath(); ctx.ellipse(px, foot, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fill();
    ctx.strokeStyle = zone.color; ctx.lineWidth = tier < 2 ? 1.8 : 1.3; ctx.stroke();
    sp(cv, px, foot - h / 2 + 0.6 * s, w);
    const named = tier < 2 || zoom > 1.3, skulls = zoom > 1.0 ? siteDanger(t.loc) : 0;
    if (named || skulls) labels.push({ text: named ? t.loc.name : "", x: px, y: foot + ry + 6, pri: named ? tier : 3, screen: tier < 2, bold: tier === 0, size: tier === 0 ? 12 : tier === 1 ? 10 : 9, skulls });
  }
  // Your hub: the walled-town sprite on a blue plate.
  {
    const px = X[scene.hub], py = Y[scene.hub], w = 46 * zb, cy = py - 6 * zb;
    ctx.beginPath(); ctx.ellipse(px, py + 9 * zb, 22 * zb, 6 * zb, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fill(); ctx.strokeStyle = PLAYER_COLOR; ctx.lineWidth = 2; ctx.stroke();
    const cv = baseSpriteCanvas({ kind: "hub", color: PLAYER_COLOR, walls: 2, tower: true, radio: true, hosp: 0, farms: 1, workshop: true, big: true });
    sp(cv, px, cy, w);
    labels.push({ text: "Haven", x: px, y: cy + (w * cv.height) / cv.width / 2 + 6, pri: -1, screen: true, color: "#cfe2f7", size: 10, bold: true });
  }
  // A team walking the road east, with its ground ring.
  {
    const px = X[scene.team], py = Y[scene.team];
    ctx.beginPath(); ctx.ellipse(px, py + 7 * zb, 13 * zb, 5 * zb, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fill(); ctx.strokeStyle = "#7fd0ff"; ctx.lineWidth = 2; ctx.stroke();
    sp(partySpriteCanvas("walkers", PLAYER_COLOR, 3), px, py, 22 * zb);
  }
  // A horde of about 45 on the edge of the suburbs.
  {
    const px = X[scene.horde], py = Y[scene.horde], cv = hordeSpriteCanvas(5), w = gridW(cv) * 1.15 * zb, h = w * (cv.height / cv.width), y = py + 3 * zb;
    ctx.beginPath(); ctx.ellipse(px, y + h / 2 - 1.5 * zb, w * 0.52, 4 * zb, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(120,20,20,0.42)"; ctx.fill(); ctx.strokeStyle = "#ff8a7f"; ctx.lineWidth = 1.5; ctx.stroke();
    sp(cv, px, y, w, { facing: -1 });
  }
  // Names with a dark halo, danger skulls under them (render.js drawLabels, without the overlap fallbacks).
  labels.sort((a, b) => a.pri - b.pri);
  const boxes = [], hits = (x0, y0, w, h) => boxes.some((b) => x0 < b[0] + b[2] && b[0] < x0 + w && y0 < b[1] + b[3] && b[1] < y0 + h);
  for (const l of labels) {
    let top = l.y - 5;
    if (l.text) {
      const size = l.screen && zoom < 1 ? l.size / zoom : l.size;
      ctx.font = `${l.bold ? "bold " : ""}${size.toFixed(1)}px Segoe UI`;
      const w = ctx.measureText(l.text).width + size * 0.4, h = size * 1.2, x0 = l.x - w / 2, y0 = l.y - h / 2;
      top = y0;
      if (!hits(x0, y0, w, h)) {
        boxes.push([x0, y0, w, h]);
        ctx.lineWidth = size * 0.3; ctx.strokeStyle = "rgba(13,15,18,0.75)"; ctx.strokeText(l.text, l.x, l.y);
        ctx.fillStyle = l.color || "rgba(230,226,216,0.9)"; ctx.fillText(l.text, l.x, l.y);
        top = y0 + h + 0.5;
      }
    }
    if (!l.skulls) continue;
    const sw = 9, gap = sw * 0.12, w = l.skulls * sw + (l.skulls - 1) * gap, x0 = l.x - w / 2;
    for (let i = 0; i < l.skulls; i++) sp(skullCanvas(), x0 + sw / 2 + i * (sw + gap), top + sw / 2, sw, { alpha: 0.95 });
  }
}

// ---------- panels ----------
const texCache = new Map();
function texFor(style, R) {
  const k = `${style.key}:${R}`;
  if (!texCache.has(k)) { const t0 = performance.now(); const tex = style.build(R || 1); tex.ms = performance.now() - t0; texCache.set(k, tex); }
  return texCache.get(k);
}
const prepped = new WeakMap();
function prepFor(style, W) {
  let s = prepped.get(W);
  if (!s) prepped.set(W, (s = new Set()));
  if (style.prep && !s.has(style.prep)) { style.prep(W); s.add(style.prep); }
}
function viewCenter(W, z) {
  if (z.key === "far") return [(W.X[W.cols - 1] + HEX) / 2, (W.Y[W.n - 1] + HEX * 0.5) / 2];
  if (z.key === "mid") return [W.X[W.grid.id(16, 9)], W.Y[W.grid.id(16, 9)] + 10];
  return [W.X[W.grid.id(14, 10)] + 6, W.Y[W.grid.id(14, 10)] - 12];
}
function drawPanel(cv, style, W, scene, z) {
  const ctx = cv.getContext("2d"), S = z.zoom * PR, [cx, cy] = viewCenter(W, z), b = bucketOf(z.zoom, S);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(S, 0, 0, S, -(cx - PW / 2 / z.zoom) * S, -(cy - PH / 2 / z.zoom) * S);
  prepFor(style, W);
  const tex = b.far ? { bytes: 0 } : texFor(style, b.R);
  const all = Int32Array.from({ length: W.n }, (_, i) => i), roads = Int32Array.from(W.tiles.filter((t) => t.road).map((t) => t.id));
  drawGround(ctx, style, W, all, W.n, roads, roads.length, tex, { S, far: b.far });
  drawObjects(ctx, W, scene, z.zoom, S);
}

// ---------- the benchmark: a Huge map's chunk cache, drawn the way render.js paintChunk does ----------
const chunkSize = (S) => 64 * Math.max(2, Math.min(8, Math.round(S * 6))); // render.js
const ROAD_REACH = HEX * Math.sqrt(3) + 3;
function hugeWorld() {
  const map = generateMap(new Rng(20261004), "huge");
  for (const t of map.tiles) { t.fog = 0; t.snow = true; } // worst case: everything live and in snow
  return prepWorld(map.grid, map.tiles);
}
function benchOne(style, W, cfg, pool) {
  const S = cfg.zoom * cfg.dpr, C = chunkSize(S), b = bucketOf(cfg.zoom, S);
  const mapW = HEX * Math.sqrt(3) * (W.cols + 0.5) * S, mapH = HEX * (1.5 * (W.rows - 1) + 2) * S;
  let i0 = 0, j0 = 0, i1 = Math.ceil(mapW / C) - 1, j1 = Math.ceil(mapH / C) - 1;
  if (cfg.screen) { // one 4K screen's worth of chunks in the middle of the map
    const ox = Math.round(mapW / 2 - 1920), oy = Math.round(mapH / 2 - 1080);
    i0 = Math.floor(ox / C); i1 = Math.floor((ox + 3839) / C); j0 = Math.floor(oy / C); j1 = Math.floor((oy + 2159) / C);
  }
  const t0 = performance.now();
  prepFor(style, W);
  const tPrep = performance.now() - t0;
  const tex = b.far ? { bytes: 0 } : texFor(style, b.R);
  const list = new Int32Array(W.n), rl = new Int32Array(W.n), reach = (style.reach || HEX + 1.5);
  const run = () => {
    const t1 = performance.now();
    let k = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      let cv = pool[k];
      if (!cv || cv.width !== C) { cv = pool[k] = document.createElement("canvas"); cv.width = cv.height = C; }
      k++;
      const ctx = cv.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, C, C);
      ctx.setTransform(S, 0, 0, S, -i * C, -j * C);
      const x0 = (i * C) / S, y0 = (j * C) / S, x1 = ((i + 1) * C) / S, y1 = ((j + 1) * C) / S;
      const n = tilesIn(W, x0 - reach, y0 - reach, x1 + reach, y1 + reach, list);
      let nr = 0;
      const m = tilesIn(W, x0 - ROAD_REACH, y0 - ROAD_REACH, x1 + ROAD_REACH, y1 + ROAD_REACH, rl);
      for (let a = 0; a < m; a++) if (W.tiles[rl[a]].road) rl[nr++] = rl[a];
      drawGround(ctx, style, W, list, n, rl, nr, tex, { S, far: b.far });
    }
    // Make the GPU finish: read one pixel after copying every chunk into it.
    const one = document.createElement("canvas"); one.width = one.height = 1;
    const oc = one.getContext("2d", { willReadFrequently: true });
    for (let a = 0; a < k; a++) oc.drawImage(pool[a], 0, 0, 1, 1);
    oc.getImageData(0, 0, 1, 1);
    return { ms: performance.now() - t1, chunks: k };
  };
  const cold = run(), warm = run(), warm2 = run();
  const ms = Math.min(warm.ms, warm2.ms);
  return { style: style.key, cfg: cfg.key, chunks: warm.chunks, C, cold: cold.ms, ms, perChunk: ms / warm.chunks, texMs: tex.ms || 0, texMB: (tex.bytes || 0) / 1048576, prepMs: tPrep, chunkMB: (warm.chunks * C * C * 4) / 1048576 };
}
const BENCH_CFGS = [
  { key: "far-full", name: "Whole Huge map, zoom 0.42 (flat bucket)", zoom: 0.42, dpr: 1 },
  { key: "mid-full", name: "Whole Huge map, zoom 1.0", zoom: 1.0, dpr: 1 },
  { key: "close-4k", name: "One 4K screen, zoom 2.2, 100% scaling", zoom: 2.2, dpr: 1, screen: true },
  { key: "close-4k-200", name: "One 4K screen, zoom 2.2, 200% scaling", zoom: 2.2, dpr: 2, screen: true },
];
async function runBench(out) {
  out.textContent = "Generating a Huge map…";
  await new Promise((r) => setTimeout(r, 30));
  const W = hugeWorld(), results = [], pool = [];
  for (const cfg of BENCH_CFGS) for (const style of STYLES) {
    out.textContent = `Measuring ${style.short} — ${cfg.name}…`;
    await new Promise((r) => setTimeout(r, 10));
    results.push(benchOne(style, W, cfg, pool));
  }
  window.BENCH = results;
  const mem = STYLES.map((s) => {
    const r1 = texCache.get(`${s.key}:1`), r2 = texCache.get(`${s.key}:2`), r4 = texCache.get(`${s.key}:4`);
    const b = (t) => (t ? t.bytes / 1048576 : 0);
    const world = s.key === "B" ? W.decals.items.byteLength + W.decals.runs.byteLength : s.key === "C" ? W.fmask.byteLength : 0;
    return { style: s.key, r1: b(r1), mid: b(r2), close: b(r4), worldKB: world / 1024, gen1: (r1 && r1.ms) || 0, genMid: (r2 && r2.ms) || 0, genClose: (r4 && r4.ms) || 0 };
  });
  window.BENCH_MEM = mem;
  const f = (v, d = 1) => v.toFixed(d);
  let html = `<table><tr><th>Style</th>${BENCH_CFGS.map((c) => `<th>${c.name}<br><small>ms total (ms per chunk) · chunks</small></th>`).join("")}<th>Texture memory<br><small>R=1 / R=2 / R=4 bucket</small></th><th>Texture build<br><small>R=1 / R=2 / R=4, once</small></th><th>Per-world data</th></tr>`;
  for (const s of STYLES) {
    html += `<tr><td>${s.name}</td>`;
    for (const c of BENCH_CFGS) { const r = results.find((x) => x.style === s.key && x.cfg === c.key); html += `<td>${f(r.ms)} (${f(r.perChunk, 2)}) · ${r.chunks}<br><small>first run ${f(r.cold)}</small></td>`; }
    const m = mem.find((x) => x.style === s.key);
    html += `<td>${f(m.r1)} / ${f(m.mid)} / ${f(m.close)} MB</td><td>${f(m.gen1, 0)} / ${f(m.genMid, 0)} / ${f(m.genClose, 0)} ms</td><td>${f(m.worldKB, 0)} KB</td></tr>`;
  }
  html += `</table><p class="note">Chunk cache memory is the same for every style (the textures are baked into the chunks render.js already keeps): mid zoom whole map ${f(results.find((r) => r.cfg === "mid-full").chunkMB)} MB of chunks, one 4K screen ${f(results.find((r) => r.cfg === "close-4k").chunkMB)} MB.</p>`;
  out.innerHTML = html;
  return results;
}

// ---------- page ----------
const scene = sampleWorld();
const W = prepWorld(scene.grid, scene.tiles);
const panels = [];
function build() {
  const root = document.getElementById("panels");
  for (const style of STYLES) {
    const row = document.createElement("section");
    row.className = "row";
    row.innerHTML = `<h2>${style.name}</h2><p>${style.blurb}</p><div class="cells"></div>`;
    const cells = row.querySelector(".cells");
    for (const z of ZOOMS) {
      const fig = document.createElement("figure"), cv = document.createElement("canvas");
      cv.width = PW * PR; cv.height = PH * PR;
      cv.style.width = PW + "px"; cv.style.height = PH + "px";
      fig.append(cv);
      const cap = document.createElement("figcaption");
      cap.textContent = z.name;
      fig.append(cap);
      cells.append(fig);
      panels.push({ cv, style, z, name: `${style.key === "flat" ? "0-today" : style.key + "-" + style.short.split(" ")[1].toLowerCase()}-${z.key}` });
    }
    root.append(row);
  }
  for (const p of panels) drawPanel(p.cv, p.style, W, scene, p.z);
}

// One comparison sheet: rows = styles, columns = zoom levels, at half the panels' resolution.
function sheet() {
  const k = 0.5, cw = PW * PR * k, chh = PH * PR * k, left = 230, top = 84, gap = 10;
  const cv = document.createElement("canvas");
  cv.width = left + 3 * (cw + gap);
  cv.height = top + STYLES.length * (chh + gap);
  const c = cv.getContext("2d");
  c.fillStyle = "#15181d"; c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = "#e6e2d8"; c.font = "bold 22px Segoe UI"; c.textBaseline = "middle";
  c.fillText("Broken State: tile texture styles", 14, 28);
  c.font = "16px Segoe UI";
  ZOOMS.forEach((z, i) => c.fillText(z.name, left + i * (cw + gap) + 8, top - 14));
  STYLES.forEach((s, r) => {
    c.font = "bold 17px Segoe UI";
    const y = top + r * (chh + gap);
    const words = s.name.split(" "), lines = [];
    let cur = "";
    for (const w of words) { if ((cur + " " + w).length > 20) { lines.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; }
    lines.push(cur);
    lines.forEach((ln, i) => c.fillText(ln, 14, y + chh / 2 - (lines.length - 1) * 11 + i * 22));
    ZOOMS.forEach((z, i) => { const p = panels.find((q) => q.style === s && q.z === z); c.drawImage(p.cv, left + i * (cw + gap), y, cw, chh); });
  });
  return cv;
}
async function save(cv, name) {
  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  const res = await fetch(`/__save/${name}.png`, { method: "POST", body: blob });
  return res.ok;
}
window.exportPNGs = async () => {
  const done = [];
  for (const p of panels) if (await save(p.cv, p.name)) done.push(p.name);
  if (await save(sheet(), "comparison-sheet")) done.push("comparison-sheet");
  return done;
};
window.runBench = () => runBench(document.getElementById("bench"));
window.showSheet = () => { const s = sheet(); s.style.width = "100%"; document.getElementById("sheet").replaceChildren(s); };

build();
document.getElementById("benchBtn").onclick = () => window.runBench();
document.getElementById("sheetBtn").onclick = () => window.showSheet();
