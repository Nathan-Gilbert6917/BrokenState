// The pixel studio (board/src/studio.css for its styles): mounted by art.js into the Art school page. Built by build.js.
// An Aseprite-like editor made for a phone first: one finger draws, two fingers pinch to zoom and pan, the colours, the
// tools, the frames and the panel tabs are strips under the canvas, and a panel opens as a sheet above them; on a
// desktop the same DOM spreads into a grid (tools left, panels right) and takes the keyboard. The document is the
// model of studio-brief.md, shared with formats.js (window.AseFormats): layers bottom first, frames with durations,
// cels of straight-alpha RGBA, tags, a palette; it is the single source of truth (api.getDoc() returns the live one).
// Templates (the game's sprite and tile sizes with their guides, seed drawings and the tiled previews) live here too.
// Sections: helpers · icons · colours · templates · storage · mount (state, rendering, gestures, tools, history,
// autosave, strips, panels, files, keyboard, api). window.PixelStudio.mount(host, opts) returns the api art.js uses
// (newFromTemplate, openDoc, getDoc, exportBytes, scrollIntoView, getView, undo, redo); PixelStudio.api is the last one.
window.PixelStudio = (function () {
  "use strict";
  const MAX = 256, PHONE = 760, HIST_MAX = 100, HIST_BYTES = 96 * 1024 * 1024;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const TOOLS = [["pencil", "Pencil", "B"], ["eraser", "Eraser", "E"], ["fill", "Fill", "G"], ["line", "Line", "L"], ["rect", "Rectangle", "U"],
    ["ellipse", "Ellipse", "O"], ["select", "Select", "M"], ["move", "Move", "V"], ["pick", "Pick", "I"], ["pan", "Pan", "H"]];
  const PANELS = [["layers", "Layers"], ["palette", "Palette"], ["frames", "Frames"], ["preview", "Preview"], ["canvas", "Canvas"], ["file", "File"]];
  const DIRS = [["forward", "forward"], ["reverse", "reverse"], ["pingpong", "ping-pong"], ["pingpong-reverse", "ping-pong reverse"]];
  const TAG_COLOURS = ["#2f6fb3", "#b8332b", "#2c7a4b", "#8a6408", "#6b5a92", "#3f6f8f"];
  const safeName = s => String(s || "sprite").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "sprite";
  const newId = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- icons: inline SVG, drawn here, stroked with the current colour ----------
  const SVG = "http://www.w3.org/2000/svg";
  const ICONS = {
    pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
    eraser: '<path d="M4 15l8-8 6 6-5 5H8z"/><path d="M6 20h14"/>',
    fill: '<path d="M6 11l6-6 7 7-6 6z"/><path d="M12 5l-3-3"/><path d="M18 14c1 2 2 3 2 4a2 2 0 0 1-4 0c0-1 1-2 2-4z"/>',
    line: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="5" r="1.6"/>',
    rect: '<rect x="4" y="6" width="16" height="12"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
    select: '<path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4"/>',
    move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
    pick: '<path d="M4 20l1-4 8-8 3 3-8 8z"/><path d="M12 7l2-2 3 3-2 2"/><path d="M4 20l-1 1"/>',
    pan: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11V4.5a1.5 1.5 0 0 1 3 0V11V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2 7-6 7-3 0-4-2-6-5l-2-3a1.5 1.5 0 0 1 2.4-1.6L8 14"/>',
    undo: '<path d="M8 7H3v5"/><path d="M3.5 12a8 8 0 1 1 2.3 5.7"/>',
    redo: '<path d="M16 7h5v5"/><path d="M20.5 12a8 8 0 1 0-2.3 5.7"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    dup: '<rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    full: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10 5.5A10 10 0 0 1 22 12a14 14 0 0 1-3 3.5M6.5 7.5A14 14 0 0 0 2 12s4 7 10 7a9 9 0 0 0 4-1"/>',
    lock: '<rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
    swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5M11 8v6M8 11h6"/>',
    zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5M8 11h6"/>',
    fit: '<rect x="3" y="3" width="18" height="18"/><path d="M8 8h8v8H8z"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    left: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    cut: '<circle cx="7" cy="17" r="3"/><circle cx="17" cy="17" r="3"/><path d="M9 15L19 4M15 15L5 4"/>',
    copy: '<rect x="9" y="9" width="11" height="11"/><path d="M15 9V4H4v11h5"/>',
    paste: '<rect x="5" y="5" width="14" height="16"/><path d="M9 5V3h6v2M9 12h6M9 16h4"/>',
    flipH: '<path d="M12 3v18M4 7l5 5-5 5zM20 7l-5 5 5 5z"/>',
    flipV: '<path d="M3 12h18M7 4l5 5 5-5zM7 20l5-5 5 5z"/>',
    rotate: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
    all: '<rect x="4" y="4" width="16" height="16" stroke-dasharray="3 2"/><path d="M8 12l3 3 5-6"/>',
    none: '<rect x="4" y="4" width="16" height="16" stroke-dasharray="3 2"/>'
  };
  function icon(name) {
    const s = document.createElementNS(SVG, "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.setAttribute("class", "pxs-ic");
    s.innerHTML = ICONS[name] || ""; return s;
  }

  // ---------- colours ----------
  const parseHex = s => { const m = /^\s*#?([0-9a-f]{6})([0-9a-f]{2})?\s*$/i.exec(String(s || "")); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255]; };
  const h2 = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  const toHex = c => "#" + h2(c[0]) + h2(c[1]) + h2(c[2]) + (c[3] < 255 ? h2(c[3]) : "");
  const cssRgba = c => "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + (c[3] / 255).toFixed(3) + ")";
  const sameCol = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
    if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
    return [h, mx ? d / mx : 0, mx];
  }
  function hsvToRgb(h, s, v) {
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c; let r, g, b;
    if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  const lightness = c => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]);
  // "rgb(r, g, b)" / "rgba(...)" / "#hex" from a computed style -> [r, g, b]
  function parseCss(s) { const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(s || ""); if (m) return [+m[1], +m[2], +m[3]]; const h = parseHex(s); return h ? h.slice(0, 3) : [128, 128, 128]; }
  const mixCss = (a, b, t) => "rgb(" + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",") + ")";

  // ---------- templates: the game's sprite and tile shapes (presets.json), their masks, guides, seeds and tiling ----------
  // Is the cell centre (x, y) inside the template's shape? A tile's pixels belong inside; the guide shades the rest.
  function inShape(shape, w, h, x, y) {
    if (shape === "hexpointy") { const dx = Math.abs(x - w / 2), dy = Math.abs(y - h / 2); return dx <= w / 2 && dy <= h / 2 && dy <= h / 2 - (dx / (w / 2)) * (h / 4); }
    if (shape === "hexflat") { const dx = Math.abs(x - w / 2), dy = Math.abs(y - h / 2); return dy <= h / 2 && dx <= w / 2 && dx <= w / 2 - (dy / (h / 2)) * (w / 4); }
    if (shape === "diamond") return Math.abs(x - w / 2) / (w / 2) + Math.abs(y - h / 2) / (h / 2) <= 1;
    if (shape === "block") { const t = w / 2, dx = Math.abs(x - w / 2); return y >= (t / 2) * (dx / (w / 2)) - .01 && y <= h - (t / 2) * (dx / (w / 2)) + .01; }
    return true;
  }
  const topFace = (w, x, y) => { const t = w / 2; return Math.abs(x - w / 2) / (w / 2) + Math.abs(y - t / 2) / (t / 2) <= 1; };
  function guessTemplate(presets, w, h) { for (const k of Object.keys(presets || {})) if (presets[k].w === w && presets[k].h === h) return k; return null; }
  // The dashed outline of the template over the sprite rect (0, 0, W, H) in screen pixels; char: ground line and pivot.
  function traceGuide(ctx, shape, W, H, P, z, h) {
    const poly = pts => { ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]); ctx.closePath(); };
    ctx.beginPath();
    if (shape === "hexpointy") poly([[W / 2, 0], [W, H / 4], [W, 3 * H / 4], [W / 2, H], [0, 3 * H / 4], [0, H / 4]]);
    else if (shape === "hexflat") poly([[W / 4, 0], [3 * W / 4, 0], [W, H / 2], [3 * W / 4, H], [W / 4, H], [0, H / 2]]);
    else if (shape === "diamond") poly([[W / 2, 0], [W, H / 2], [W / 2, H], [0, H / 2]]);
    else if (shape === "block") { const t = W / 2; poly([[W / 2, 0], [W, t / 2], [W, H - t / 2], [W / 2, H], [0, H - t / 2], [0, t / 2]]); ctx.moveTo(0, t / 2); ctx.lineTo(W / 2, t); ctx.lineTo(W, t / 2); ctx.moveTo(W / 2, t); ctx.lineTo(W / 2, H); }
    else if (shape === "char") {
      const gy = (P.pivotY != null ? P.pivotY : h - 2) * z;
      ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
      ctx.beginPath(); ctx.setLineDash([]); ctx.ellipse(W / 2, gy, W * .32, W * .16, 0, 0, Math.PI * 2); ctx.moveTo(W / 2 - 8, gy); ctx.lineTo(W / 2 + 8, gy);
    } else return;
    ctx.stroke();
  }
  // A starting drawing on frame 0 so a template opens doing something (the old studio's seeds, now in RGBA).
  function seedDoc(doc, kind, P) {
    const w = doc.w, h = doc.h, cel = doc.cels[0][0] || (doc.cels[0][0] = { data: new Uint8ClampedArray(w * h * 4), opacity: 255 });
    const d = cel.data, put = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) { const rgba = parseHex(c); if (rgba) d.set(rgba, (y * w + x) * 4); } };
    const inM = (x, y) => inShape(P.shape, w, h, x + .5, y + .5);
    if (kind === "hexgrass" || kind === "isofloor" || kind === "isoblock") {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inM(x, y)) {
        const n = (x * 7 + y * 13 + ((x * y) % 5)) % 11, r = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 23;
        let c = kind === "isoblock" ? "#8a6a48" : (r === 0 ? "#7a8f4e" : r === 1 ? "#3c4734" : "#5d6b4f");
        if (kind === "isoblock") c = topFace(w, x + .5, y + .5) ? (n < 3 ? "#c9cfc9" : "#8b938c") : (x < w / 2 ? "#6b4f35" : "#8a6a48");
        if (kind === "isofloor") c = n < 3 ? "#8b938c" : "#c9cfc9";
        put(x, y, c);
      }
    } else if (kind === "beans") {
      for (let y = 3; y < 14; y++) for (let x = 4; x < 12; x++) put(x, y, x === 4 || x === 11 ? "#2c3832" : y < 6 || y > 11 ? "#8b938c" : "#b8332b");
      for (let x = 5; x < 11; x++) { put(x, 3, "#c9cfc9"); put(x, 8, "#e0b44a"); put(x, 9, "#e0b44a"); }
      for (let x = 4; x < 12; x++) { put(x, 2, "#2c3832"); put(x, 14, "#2c3832"); }
    } else if (kind === "survivor") {
      const cx = Math.floor(w / 2), base = (P.pivotY != null ? P.pivotY : h - 4) + 1;
      const rect = (x0, y0, rw, rh, c) => { for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) put(x, y, c); };
      rect(cx - 3, base - 10, 2, 10, "#2c3832"); rect(cx + 1, base - 10, 2, 10, "#2c3832");
      rect(cx - 4, base - 22, 8, 12, "#2f6fb3"); rect(cx - 5, base - 21, 1, 9, "#d9a37a"); rect(cx + 4, base - 21, 1, 9, "#d9a37a");
      rect(cx - 3, base - 29, 6, 7, "#d9a37a"); rect(cx - 3, base - 30, 6, 2, "#6b4f35"); put(cx - 2, base - 26, "#17201c"); put(cx + 1, base - 26, "#17201c");
      rect(cx - 4, base - 1, 3, 1, "#17201c"); rect(cx + 1, base - 1, 3, 1, "#17201c");
    }
  }
  // The tile laid out the way the engine will: hex rows, iso diamonds, a wall on an iso floor, a character on the
  // floor, or a plain grid. fc: the flattened frame as a canvas; tok: the page's colours.
  function drawTiled(t, W, H, fc, w, h, P, tok) {
    t.imageSmoothingEnabled = false; t.fillStyle = tok.sunk; t.fillRect(0, 0, W, H);
    const shape = P ? P.shape : "free", sc = (P && P.tileScale) || (w > 96 ? 1 : 2), tw = w * sc, th = h * sc;
    const blit = (x, y) => t.drawImage(fc, Math.round(x), Math.round(y), tw, th);
    if (shape === "hexpointy") { for (let r = -1; r < H / (th * .75) + 1; r++) for (let q = -1; q < W / tw + 1; q++) blit(q * tw + (r & 1 ? tw / 2 : 0), r * th * .75); }
    else if (shape === "hexflat") { for (let q = -1; q < W / (tw * .75) + 1; q++) for (let r = -1; r < H / th + 1; r++) blit(q * tw * .75, r * th + (q & 1 ? th / 2 : 0)); }
    else if (shape === "diamond" || shape === "block") {
      const dh = tw / 2, ox = W / 2 - tw / 2, oy = shape === "block" ? th - dh - 10 : 0, N = Math.ceil(Math.max(W / tw, H / dh)) + 2;
      if (shape === "diamond") { for (let s = 0; s < 2 * N; s++) for (let i = 0; i <= s; i++) blit(ox + (i - s + i) * tw / 2, s * dh / 2); }
      else {
        // a floor of plain diamonds, then an L-shaped wall drawn back to front so nearer blocks cover farther ones (y-sort)
        for (let s = 0; s < 2 * N; s++) for (let i = 0; i <= s; i++) {
          const j = s - i, x = ox + (i - j) * tw / 2, y = oy + th - dh + (i + j) * dh / 2;
          t.fillStyle = (i + j) % 2 ? tok.panel : tok.bg; t.beginPath(); t.moveTo(x + tw / 2, y); t.lineTo(x + tw, y + dh / 2); t.lineTo(x + tw / 2, y + dh); t.lineTo(x, y + dh / 2); t.closePath(); t.fill();
        }
        const wall = []; for (let k = 1; k < 6; k++) wall.push([k, 2]); for (let k = 3; k < 6; k++) wall.push([1, k]);
        wall.sort((p, q) => (p[0] + p[1]) - (q[0] + q[1])).forEach(([i, j]) => blit(ox + (i - j) * tw / 2, oy + (i + j) * dh / 2));
      }
    } else if (shape === "char") {
      const cw = 32 * sc, ch = 16 * sc, ox = W / 2 - cw / 2; t.strokeStyle = tok.rule;
      for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
        const x = ox + (i - j) * cw / 2, y = (i + j) * ch / 2 - 40;
        t.fillStyle = (i + j) % 2 ? tok.panel : tok.bg; t.beginPath(); t.moveTo(x + cw / 2, y); t.lineTo(x + cw, y + ch / 2); t.lineTo(x + cw / 2, y + ch); t.lineTo(x, y + ch / 2); t.closePath(); t.fill(); t.stroke();
      }
      for (const [i, j] of [[3, 3], [4, 2], [2, 5]]) { const cx = ox + (i - j) * cw / 2 + cw / 2, cy = (i + j) * ch / 2 - 40 + ch / 2; t.drawImage(fc, Math.round(cx - tw / 2), Math.round(cy - (P.pivotY != null ? P.pivotY : h - 2) * sc), tw, th); }
    } else { for (let y = 0; y < H; y += th + 6) for (let x = 0; x < W; x += tw + 6) blit(x, y); }
  }

  // ---------- storage: the sprites kept on the device (IndexedDB; localStorage as base64 when it is not there) ----------
  function makeStorage() {
    const DB = "bs-studio", META = "bs-studio-meta", DATA = "bs-studio-data-";
    let dbp = null;
    const idb = () => dbp || (dbp = new Promise(res => {
      try {
        if (!window.indexedDB) return res(null);
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "id" }); if (!d.objectStoreNames.contains("data")) d.createObjectStore("data", { keyPath: "id" }); };
        r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); dbp = null; }; res(r.result); };
        r.onerror = () => res(null); r.onblocked = () => res(null);
      } catch (e) { res(null); }
    }));
    const req = (db, stores, mode, fn) => new Promise((res, rej) => {
      let out; try { const t = db.transaction(stores, mode); out = fn(t); t.oncomplete = () => res(out && "result" in out ? out.result : out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); } catch (e) { rej(e); }
    });
    const lget = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
    const lset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
    const lrm = k => { try { localStorage.removeItem(k); } catch (e) {} };
    const toB64 = b => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
    const fromB64 = s => { const bin = atob(s), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
    async function list() {
      const db = await idb(); let out = null;
      if (db) { try { out = await req(db, "meta", "readonly", t => t.objectStore("meta").getAll()); } catch (e) { out = null; } }
      if (!out) out = lget(META, []);
      return (out || []).slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    }
    async function load(id) {
      const db = await idb();
      if (db) { try { const d = await req(db, "data", "readonly", t => t.objectStore("data").get(id)); if (d && d.bytes) return d.bytes instanceof Uint8Array ? d.bytes : new Uint8Array(d.bytes); } catch (e) {} }
      const b = lget(DATA + id, null); return b ? fromB64(b) : null;
    }
    async function save(meta, bytes) {
      const db = await idb();
      if (db) { try { await req(db, ["meta", "data"], "readwrite", t => { t.objectStore("meta").put(meta); t.objectStore("data").put({ id: meta.id, bytes }); }); return "db"; } catch (e) {} }
      const all = lget(META, []).filter(m => m.id !== meta.id); all.push(meta);
      return lset(DATA + meta.id, toB64(bytes)) && lset(META, all) ? "local" : "";
    }
    async function remove(id) {
      const db = await idb();
      if (db) { try { await req(db, ["meta", "data"], "readwrite", t => { t.objectStore("meta").delete(id); t.objectStore("data").delete(id); }); } catch (e) {} }
      lset(META, lget(META, []).filter(m => m.id !== id)); lrm(DATA + id);
    }
    return { list, load, save, remove };
  }

  // ---------- mount: the studio in a host element ----------
  function mount(host, opts) {
    const { el, store, formats, saveFile } = opts;
    const presets = opts.presets || {}, presetKeys = Object.keys(presets);
    const boardPalette = (opts.palette && opts.palette.length ? opts.palette : ["#000000", "#ffffff"]).map(String);
    const storage = makeStorage();
    const dpr = () => window.devicePixelRatio || 1;
    let doc = null;                                       // the live document: api.getDoc() returns this very object
    let cur = { id: null, template: null, saved: false }; // the sprite entry on the device and its template
    const uiSaved = store.get("bs-studio-ui", {}) || {};
    const ui = {
      tool: TOOLS.some(t => t[0] === uiSaved.tool) ? uiSaved.tool : "pencil",
      size: clamp(Math.round(num(uiSaved.size, 1)), 1, 4), pixelPerfect: uiSaved.pixelPerfect !== false, fillGlobal: !!uiSaved.fillGlobal,
      shapeFill: !!uiSaved.shapeFill, wrap: !!uiSaved.wrap, mirrorX: !!uiSaved.mirrorX, mirrorY: !!uiSaved.mirrorY,
      grid: uiSaved.grid !== false, guide: uiSaved.guide !== false, onion: !!uiSaved.onion,
      onionPrev: clamp(Math.round(num(uiSaved.onionPrev, 1)), 0, 3), onionNext: clamp(Math.round(num(uiSaved.onionNext, 1)), 0, 3), onionAlpha: clamp(num(uiSaved.onionAlpha, 40), 5, 90),
      panel: PANELS.some(p => p[0] === uiSaved.panel) ? uiSaved.panel : null, open: Object.assign({ frames: false, canvas: false, file: false }, uiSaved.open || {}),
      pvScale: clamp(Math.round(num(uiSaved.pvScale, 0)), 0, 8), recent: Array.isArray(uiSaved.recent) ? uiSaved.recent.filter(c => parseHex(c)).slice(0, 12) : [],
      zoom: 8, panX: 0, panY: 0, zoomFor: uiSaved.zoomFor || null,
      fg: parseHex(boardPalette[2] || boardPalette[0]) || [0, 0, 0, 255], bg: [0, 0, 0, 0], fgIndex: boardPalette[2] ? 2 : 0,
      frame: 0, layer: 0, playing: false, playTag: null, playDir: 1, sel: null, float: null, clip: null, full: false,
      editTarget: "fg", hover: null, space: false, spaceUsed: false, alt: false, phone: true, fitted: false
    };
    let saveUiT = 0;
    function saveUi() {
      clearTimeout(saveUiT);
      saveUiT = setTimeout(() => store.set("bs-studio-ui", { tool: ui.tool, size: ui.size, pixelPerfect: ui.pixelPerfect, fillGlobal: ui.fillGlobal, shapeFill: ui.shapeFill, wrap: ui.wrap,
        mirrorX: ui.mirrorX, mirrorY: ui.mirrorY, grid: ui.grid, guide: ui.guide, onion: ui.onion, onionPrev: ui.onionPrev, onionNext: ui.onionNext, onionAlpha: ui.onionAlpha,
        panel: ui.panel, open: ui.open, pvScale: ui.pvScale, recent: ui.recent, zoom: ui.zoom, zoomFor: doc ? doc.w + "x" + doc.h : null }), 200);
    }

    // ---- the DOM: one tree, laid out by studio.css as strips (phone) or a grid (desktop) ----
    const ib = (name, label, onclick, cls) => el("button", { type: "button", class: "pxs-ib" + (cls ? " " + cls : ""), "aria-label": label, title: label, onclick }, icon(name));
    const btn = (text, onclick, cls) => el("button", { type: "button", class: "pxs-btn" + (cls ? " " + cls : ""), onclick, text });
    const root = el("div", { class: "pxs", "data-ready": "0" });
    const probe = el("span", { class: "pxs-probe", "aria-hidden": "true" });
    const cv = el("canvas", { class: "pxs-cv", tabindex: "0", "aria-label": "Pixel canvas" });
    const ctx = cv.getContext("2d");
    const zoomV = el("span", { class: "pxs-zoomv", text: "100%", "aria-live": "off" });
    const zoomBox = el("div", { class: "pxs-zoom", role: "toolbar", "aria-label": "Zoom" }, ib("zoomOut", "Zoom out", () => zoomStep(-1)), zoomV, ib("fit", "Fit the sprite in the view", () => fitZoom()), ib("zoomIn", "Zoom in", () => zoomStep(1)));
    const selBar = el("div", { class: "pxs-selbar", role: "toolbar", "aria-label": "Selection", hidden: true });
    const view = el("div", { class: "pxs-view" }, cv, selBar, zoomBox);
    const status = el("div", { class: "pxs-status", role: "status" });
    const nameEl = el("span", { class: "pxs-nm", text: "" }), dimEl = el("span", { class: "pxs-dim", text: "" });
    const nameBtn = el("button", { type: "button", class: "pxs-ib pxs-name", "aria-label": "Rename the sprite", title: "Rename", onclick: () => renameSprite() }, nameEl, dimEl);
    const savedEl = el("span", { class: "pxs-saved", text: "" });
    const undoBtn = ib("undo", "Undo", () => undo()), redoBtn = ib("redo", "Redo", () => redo()), fullBtn = ib("full", "Full screen", () => setFull(!ui.full));
    const top = el("div", { class: "pxs-top", role: "toolbar", "aria-label": "Sprite" }, nameBtn, savedEl, undoBtn, redoBtn, fullBtn);
    const sw = (label, onclick) => el("button", { type: "button", class: "pxs-sw", "aria-label": label, title: label, onclick }, el("i"));
    const fgSw = sw("Foreground colour: tap to edit it", () => openColour("fg")), bgSw = sw("Background colour: tap to edit it", () => openColour("bg"));
    bgSw.classList.add("pxs-bg");
    const palStrip = el("div", { class: "pxs-pal", role: "toolbar", "aria-label": "Palette" });
    const colours = el("div", { class: "pxs-colours", role: "toolbar", "aria-label": "Colours" }, el("div", { class: "pxs-fgbg" }, fgSw, ib("swap", "Swap the foreground and background colours (X)", () => swapColours()), bgSw), palStrip);
    const toolBtns = {};
    const tools = el("div", { class: "pxs-tools", role: "toolbar", "aria-label": "Tools" }, TOOLS.map(([k, label, key]) =>
      (toolBtns[k] = el("button", { type: "button", class: "pxs-ib pxs-tool", "data-tool": k, "aria-label": label + " (" + key + ")", title: label + " (" + key + ")", "aria-pressed": "false", onclick: () => setTool(k) }, icon(k), el("small", { text: label })))));
    const optsBar = el("div", { class: "pxs-opts", role: "toolbar", "aria-label": "Tool options" });
    const playBtn = ib("play", "Play", () => togglePlay());
    const frs = el("div", { class: "pxs-frs", role: "group", "aria-label": "Frame thumbnails" });
    const time = el("div", { class: "pxs-time", role: "toolbar", "aria-label": "Frames" }, playBtn, frs, ib("plus", "Add frame", () => addFrame()), ib("dup", "Duplicate frame", () => dupFrame()), ib("trash", "Delete frame", () => delFrame()));
    const tabBtns = {};
    const tabs = el("div", { class: "pxs-tabs", role: "toolbar", "aria-label": "Panels" }, PANELS.map(([k, label]) =>
      (tabBtns[k] = el("button", { type: "button", class: "pxs-ib pxs-tab", "aria-pressed": "false", "aria-controls": "pxs-panel-" + k, onclick: () => togglePanel(k), text: label }))));
    const panelEls = {}, panelBodies = {};
    function panel(key, title, collapsible) {
      const body = el("div", { class: "pxs-panel-b" });
      const head = el("h4", { class: "pxs-panel-h" },
        collapsible ? el("button", { type: "button", class: "pxs-ib pxs-collapse", "aria-expanded": String(!!ui.open[key]), "aria-label": "Show or hide " + title, onclick: () => toggleOpen(key) }, icon("chevron")) : null,
        el("span", { text: title }),
        el("button", { type: "button", class: "pxs-ib pxs-close", "aria-label": "Close the " + title + " panel", onclick: () => closePanel() }, icon("close")));
      const sec = el("section", { class: "pxs-panel" + (collapsible && !ui.open[key] ? " pxs-closed" : ""), id: "pxs-panel-" + key, "data-panel": key, "aria-label": title }, head, body);
      panelEls[key] = sec; panelBodies[key] = body; return sec;
    }
    const panels = el("div", { class: "pxs-panels" }, panel("colour", "Colour"), panel("layers", "Layers"), panel("palette", "Palette"), panel("preview", "Preview"), panel("frames", "Frames", true), panel("canvas", "Canvas", true), panel("file", "File", true));
    root.append(probe, top, view, colours, tools, optsBar, time, tabs, panels, status);
    host.append(root);
    let sayT = 0;
    function say(msg, keep) { status.textContent = msg || ""; clearTimeout(sayT); if (msg && !keep) sayT = setTimeout(() => { if (status.textContent === msg) status.textContent = ""; }, 8000); }

    // ---- the page's colours, read through a probe so the canvas matches light and dark ----
    let tok = null, tokAt = -1e9, pattern = null, patKey = "";
    function tokens() {
      const now = performance.now(); if (tok && now - tokAt < 1500) return tok; tokAt = now;
      const get = n => { probe.style.color = "var(" + n + ")"; return getComputedStyle(probe).color; };
      const panel = get("--panel"), ink = get("--ink"), pa = parseCss(panel), ia = parseCss(ink);
      probe.style.fontFamily = "var(--mono)";
      tok = { panel, ink, sunk: get("--sunk"), bg: get("--bg"), rule: get("--rule"), accent: get("--accent"), hive: get("--hive"), muted: get("--muted"), gold: get("--gold"),
        mono: getComputedStyle(probe).fontFamily || "monospace", checkA: mixCss(pa, ia, .13), checkB: mixCss(pa, ia, .04) };
      return tok;
    }
    function checker() {
      const t = tokens(), key = t.checkA + t.checkB; if (pattern && key === patKey) return pattern;
      const c = document.createElement("canvas"); c.width = c.height = 16; const x = c.getContext("2d");
      x.fillStyle = t.checkB; x.fillRect(0, 0, 16, 16); x.fillStyle = t.checkA; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
      pattern = ctx.createPattern(c, "repeat"); patKey = key; return pattern;
    }

    // ---- rendering: per-layer 1:1 canvases from the cels, composed scaled on the view canvas with the overlays ----
    const lcs = []; let lcsFrame = -1;           // {cv, ctx, dirty} per layer, for the frame lcsFrame
    const flatCache = new Map(), onionCache = new Map();   // frame -> canvas (flattened), frame -> {prev, next} tinted
    let maskCv = null, maskKey = "";
    const asClamped = d => d instanceof Uint8ClampedArray ? d : new Uint8ClampedArray(d.buffer, d.byteOffset, d.length);
    function layerCanvas(l) {
      let L = lcs[l]; if (!L) { const c = document.createElement("canvas"); L = lcs[l] = { cv: c, ctx: c.getContext("2d"), dirty: true }; }
      if (L.cv.width !== doc.w || L.cv.height !== doc.h) { L.cv.width = doc.w; L.cv.height = doc.h; L.dirty = true; }
      if (lcsFrame !== ui.frame) { lcs.forEach(x => x.dirty = true); lcsFrame = ui.frame; }
      if (L.dirty) { const cel = doc.cels[l][ui.frame]; if (cel) L.ctx.putImageData(new ImageData(asClamped(cel.data), doc.w, doc.h), 0, 0); else L.ctx.clearRect(0, 0, doc.w, doc.h); L.dirty = false; }
      return L.cv;
    }
    function dataCanvas(data, w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").putImageData(new ImageData(asClamped(data), w, h), 0, 0); return c; }
    function flatData(f) { return formats.flatten(doc, f); }
    function flatCanvas(f) { let c = flatCache.get(f); if (!c) { c = dataCanvas(flatData(f), doc.w, doc.h); flatCache.set(f, c); } return c; }
    function onionCanvas(f, kind) {
      let o = onionCache.get(f); if (!o) { o = {}; onionCache.set(f, o); }
      if (!o[kind]) {
        const c = document.createElement("canvas"); c.width = doc.w; c.height = doc.h; const x = c.getContext("2d");
        x.drawImage(flatCanvas(f), 0, 0); x.globalCompositeOperation = "source-atop"; x.fillStyle = kind === "prev" ? "rgba(200,40,40,.55)" : "rgba(40,90,220,.55)"; x.fillRect(0, 0, doc.w, doc.h); o[kind] = c;
      }
      return o[kind];
    }
    function maskCanvas(P) {
      const key = cur.template + ":" + doc.w + "x" + doc.h; if (maskCv && maskKey === key) return maskCv;
      const c = document.createElement("canvas"); c.width = doc.w; c.height = doc.h; const x = c.getContext("2d"); x.fillStyle = "rgba(120,30,25,.24)";
      for (let y = 0; y < doc.h; y++) for (let px = 0; px < doc.w; px++) if (!inShape(P.shape, doc.w, doc.h, px + .5, y + .5)) x.fillRect(px, y, 1, 1);
      maskCv = c; maskKey = key; return c;
    }
    // a cel changed: the layer canvas, the flattened frame and its onion skins are stale
    function markCel(l, f) { if (l == null) l = ui.layer; if (f == null) f = ui.frame; if (lcs[l] && f === lcsFrame) lcs[l].dirty = true; flatCache.delete(f); onionCache.delete(f - 1); onionCache.delete(f); onionCache.delete(f + 1); }
    function markAll() { lcs.forEach(x => x.dirty = true); lcsFrame = -1; flatCache.clear(); onionCache.clear(); maskCv = null; }
    let drawQueued = false;
    function requestDraw() { drawQueued = true; }
    function layout() {
      const W = view.clientWidth, H = view.clientHeight; if (!W || !H) return false;
      const d = dpr(), pw = Math.round(W * d), ph = Math.round(H * d);
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
      return true;
    }
    function spriteRect() { const d = dpr(); return { x: Math.round(ui.panX * d) / d, y: Math.round(ui.panY * d) / d, w: doc.w * ui.zoom, h: doc.h * ui.zoom }; }
    function draw() {
      drawQueued = false; if (!doc || !layout()) return;
      const d = dpr(), W = view.clientWidth, H = view.clientHeight, z = ui.zoom, w = doc.w, h = doc.h, t = tokens(), r = spriteRect(), ox = r.x, oy = r.y;
      ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, W, H); ctx.imageSmoothingEnabled = false;
      ctx.save(); ctx.translate(ox, oy); ctx.fillStyle = checker(); ctx.fillRect(0, 0, r.w, r.h); ctx.restore();
      if (ui.onion && doc.frames.length > 1 && !ui.playing) {
        for (let k = ui.onionPrev; k >= 1; k--) { const f = ui.frame - k; if (f >= 0) { ctx.globalAlpha = (ui.onionAlpha / 100) / k; ctx.drawImage(onionCanvas(f, "prev"), ox, oy, r.w, r.h); } }
        for (let k = 1; k <= ui.onionNext; k++) { const f = ui.frame + k; if (f < doc.frames.length) { ctx.globalAlpha = (ui.onionAlpha / 100) / k; ctx.drawImage(onionCanvas(f, "next"), ox, oy, r.w, r.h); } }
        ctx.globalAlpha = 1;
      }
      for (let l = 0; l < doc.layers.length; l++) {
        const L = doc.layers[l], cel = doc.cels[l][ui.frame]; if (!L.visible || !cel) { if (lcs[l] && lcsFrame !== ui.frame) lcs[l].dirty = true; continue; }
        ctx.globalAlpha = (L.opacity / 255) * ((cel.opacity == null ? 255 : cel.opacity) / 255); ctx.drawImage(layerCanvas(l), ox, oy, r.w, r.h);
      }
      ctx.globalAlpha = 1;
      if (ui.float) { if (!ui.float.cv) ui.float.cv = dataCanvas(ui.float.data, ui.float.w, ui.float.h); ctx.drawImage(ui.float.cv, ox + ui.float.x * z, oy + ui.float.y * z, ui.float.w * z, ui.float.h * z); }
      const P = cur.template && presets[cur.template];
      if (ui.guide && P && P.shape !== "free") {
        if (P.shape !== "char") ctx.drawImage(maskCanvas(P), ox, oy, r.w, r.h);
        ctx.save(); ctx.translate(ox, oy); ctx.strokeStyle = t.accent; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); traceGuide(ctx, P.shape, r.w, r.h, P, z, h); ctx.restore();
      }
      if (ui.grid && z >= 6) {
        ctx.strokeStyle = "rgba(128,140,132,.32)"; ctx.lineWidth = 1 / d; ctx.beginPath(); const x0 = Math.max(0, Math.floor(-ox / z)), x1 = Math.min(w, Math.ceil((W - ox) / z)), y0 = Math.max(0, Math.floor(-oy / z)), y1 = Math.min(h, Math.ceil((H - oy) / z));
        for (let x = x0; x <= x1; x++) { const px = Math.round((ox + x * z) * d) / d; ctx.moveTo(px, oy + y0 * z); ctx.lineTo(px, oy + y1 * z); }
        for (let y = y0; y <= y1; y++) { const py = Math.round((oy + y * z) * d) / d; ctx.moveTo(ox + x0 * z, py); ctx.lineTo(ox + x1 * z, py); }
        ctx.stroke();
      }
      if (ui.mirrorX || ui.mirrorY) {
        ctx.strokeStyle = t.hive; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.beginPath();
        if (ui.mirrorX) { ctx.moveTo(ox + r.w / 2, oy - 6); ctx.lineTo(ox + r.w / 2, oy + r.h + 6); }
        if (ui.mirrorY) { ctx.moveTo(ox - 6, oy + r.h / 2); ctx.lineTo(ox + r.w + 6, oy + r.h / 2); }
        ctx.stroke(); ctx.setLineDash([]);
      }
      const s = ui.float ? { x: ui.float.x, y: ui.float.y, w: ui.float.w, h: ui.float.h } : ui.sel;
      if (s) {
        ctx.lineWidth = 1; ctx.setLineDash([]); ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.strokeRect(ox + s.x * z + .5, oy + s.y * z + .5, s.w * z - 1, s.h * z - 1);
        ctx.strokeStyle = "rgba(0,0,0,.9)"; ctx.setLineDash([4, 4]); ctx.strokeRect(ox + s.x * z + .5, oy + s.y * z + .5, s.w * z - 1, s.h * z - 1); ctx.setLineDash([]);
      }
      if (ui.hover && !stroke && ["pencil", "eraser", "line", "rect", "ellipse"].includes(ui.tool)) {
        const sz = ui.size, o = (sz - 1) >> 1, hx = ui.hover.x - o, hy = ui.hover.y - o;
        if (hx + sz > 0 && hy + sz > 0 && hx < w && hy < h) { ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,.85)"; ctx.strokeRect(ox + hx * z + .5, oy + hy * z + .5, sz * z - 1, sz * z - 1); ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.strokeRect(ox + hx * z - .5, oy + hy * z - .5, sz * z + 1, sz * z + 1); }
      }
    }
    // ---- zoom and pan ----
    function setZoom(z, at) {
      z = clamp(z, 0.25, 64); const p = at || { x: view.clientWidth / 2, y: view.clientHeight / 2 };
      ui.panX = p.x - (p.x - ui.panX) * z / ui.zoom; ui.panY = p.y - (p.y - ui.panY) * z / ui.zoom; ui.zoom = z;
      clampPan(); zoomV.textContent = Math.round(z * 100) + "%"; requestDraw(); saveUi();
    }
    function zoomStep(dir) { const steps = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]; const z = ui.zoom; const next = dir > 0 ? steps.find(s => s > z + 1e-6) : steps.slice().reverse().find(s => s < z - 1e-6); if (next) setZoom(next); }
    function fitZoom() {
      const W = view.clientWidth, H = view.clientHeight; if (!W || !H || !doc) return;
      let z = Math.min((W - 24) / doc.w, (H - 24) / doc.h); z = z >= 1 ? Math.floor(z) : Math.max(0.25, Math.floor(z * 4) / 4);
      ui.zoom = z; ui.panX = Math.round((W - doc.w * z) / 2); ui.panY = Math.round((H - doc.h * z) / 2); zoomV.textContent = Math.round(z * 100) + "%"; requestDraw(); saveUi();
    }
    function clampPan() { const W = view.clientWidth, H = view.clientHeight, m = 32; ui.panX = clamp(ui.panX, m - doc.w * ui.zoom, W - m); ui.panY = clamp(ui.panY, m - doc.h * ui.zoom, H - m); }

    // ---- pixel operations on a cel's RGBA data ----
    const ERASE = [0, 0, 0, 0];
    function setPx(data, x, y, c) { if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return; const i = (y * doc.w + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = c[3]; }
    function getPx(data, x, y) { const i = (y * doc.w + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; }
    // one pixel, and its mirrors when mirroring is on
    function put(data, x, y, c) {
      setPx(data, x, y, c);
      if (ui.mirrorX) setPx(data, doc.w - 1 - x, y, c); if (ui.mirrorY) setPx(data, x, doc.h - 1 - y, c); if (ui.mirrorX && ui.mirrorY) setPx(data, doc.w - 1 - x, doc.h - 1 - y, c);
    }
    // the brush: a square of ui.size cells around (x, y)
    function stamp(data, x, y, c) { const s = ui.size, o = (s - 1) >> 1; for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) put(data, x - o + xx, y - o + yy, c); }
    function bresenham(a, b, fn) {
      let x0 = a.x, y0 = a.y; const x1 = b.x, y1 = b.y, dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
      for (let n = 0; n < 100000; n++) { fn(x0, y0); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
    }
    function rectShape(a, b, filled, outline, inside) {
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      if (filled) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) inside(x, y); return; }
      for (let x = x0; x <= x1; x++) { outline(x, y0); outline(x, y1); } for (let y = y0 + 1; y < y1; y++) { outline(x0, y); outline(x1, y); }
    }
    // the midpoint ellipse in the box a..b (Zingl's rasterisation of a rectangle-bounded ellipse)
    function ellipseShape(a, b, filled, outline, inside) {
      let x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      const rows = new Map(); const plot = (x, y) => { if (filled) { const r = rows.get(y); if (!r) rows.set(y, [x, x]); else { r[0] = Math.min(r[0], x); r[1] = Math.max(r[1], x); } } else outline(x, y); };
      let aa = Math.abs(x1 - x0), bb = Math.abs(y1 - y0), b1 = bb & 1, dx = 4 * (1 - aa) * bb * bb, dy = 4 * (b1 + 1) * aa * aa, err = dx + dy + b1 * aa * aa, e2;
      y0 += (bb + 1) >> 1; y1 = y0 - b1; aa *= 8 * aa; b1 = 8 * bb * bb;
      let guard = 0;
      do { plot(x1, y0); plot(x0, y0); plot(x0, y1); plot(x1, y1); e2 = 2 * err; if (e2 <= dy) { y0++; y1--; err += dy += aa; } if (e2 >= dx || 2 * err > dy) { x0++; x1--; err += dx += b1; } } while (x0 <= x1 && guard++ < 100000);
      while (y0 - y1 < bb) { plot(x0 - 1, y0); plot(x1 + 1, y0++); plot(x0 - 1, y1); plot(x1 + 1, y1--); }
      if (filled) for (const [y, r] of rows) for (let x = r[0]; x <= r[1]; x++) inside(x, y);
    }
    const pack = c => ((c[3] << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
    const u32 = data => new Uint32Array(data.buffer, data.byteOffset, data.length >> 2);
    function flood(u, w, h, x, y, target, rep) {
      const st = [y * w + x];
      while (st.length) { const i = st.pop(); if (u[i] !== target) continue; u[i] = rep; const cx = i % w; if (cx > 0) st.push(i - 1); if (cx < w - 1) st.push(i + 1); if (i >= w) st.push(i - w); if (i + w < w * h) st.push(i + w); }
    }
    function doFill(data, c, col) {
      if (c.x < 0 || c.y < 0 || c.x >= doc.w || c.y >= doc.h) return;
      const seeds = [c]; if (ui.mirrorX) seeds.push({ x: doc.w - 1 - c.x, y: c.y }); if (ui.mirrorY) seeds.push({ x: c.x, y: doc.h - 1 - c.y }); if (ui.mirrorX && ui.mirrorY) seeds.push({ x: doc.w - 1 - c.x, y: doc.h - 1 - c.y });
      const u = u32(data), rep = pack(col);
      for (const s of seeds) { const target = u[s.y * doc.w + s.x]; if (target === rep) continue; if (ui.fillGlobal) { for (let i = 0; i < u.length; i++) if (u[i] === target) u[i] = rep; } else flood(u, doc.w, doc.h, s.x, s.y, target, rep); }
    }
    // dst = src shifted by (dx, dy), wrapping round or dropping what leaves the canvas
    function shiftInto(dst, src, w, h, dx, dy, wrap) {
      const d = u32(dst), s = u32(src); d.fill(0);
      for (let y = 0; y < h; y++) { let sy = y - dy; if (wrap) sy = ((sy % h) + h) % h; else if (sy < 0 || sy >= h) continue;
        for (let x = 0; x < w; x++) { let sx = x - dx; if (wrap) sx = ((sx % w) + w) % w; else if (sx < 0 || sx >= w) continue; d[y * w + x] = s[sy * w + sx]; } }
    }
    // source-over of a small RGBA block onto a cel at (x, y), straight alpha, clipped to the canvas
    function blitAt(dst, dw, dh, src, sw, sh, x, y) {
      for (let j = 0; j < sh; j++) { const ty = y + j; if (ty < 0 || ty >= dh) continue;
        for (let i = 0; i < sw; i++) { const tx = x + i; if (tx < 0 || tx >= dw) continue; const si = (j * sw + i) * 4, sa = src[si + 3]; if (!sa) continue; const di = (ty * dw + tx) * 4;
          if (sa === 255) { dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = 255; continue; }
          const da = dst[di + 3], a = sa + da * (255 - sa) / 255; if (!a) continue;
          for (let k = 0; k < 3; k++) dst[di + k] = Math.round((src[si + k] * sa + dst[di + k] * da * (255 - sa) / 255) / a); dst[di + 3] = Math.round(a); } }
    }
    function copyRect(data, r) { const out = new Uint8ClampedArray(r.w * r.h * 4); for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) { const x = r.x + i, y = r.y + j; if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) continue; out.set(data.subarray((y * doc.w + x) * 4, (y * doc.w + x) * 4 + 4), (j * r.w + i) * 4); } return out; }
    function clearRect(data, r) { for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) setPx(data, r.x + i, r.y + j, ERASE); }
    const normRect = (x0, y0, x1, y1) => { const a = clamp(Math.min(x0, x1), 0, doc.w - 1), b = clamp(Math.max(x0, x1), 0, doc.w - 1), c = clamp(Math.min(y0, y1), 0, doc.h - 1), d = clamp(Math.max(y0, y1), 0, doc.h - 1); return { x: a, y: c, w: b - a + 1, h: d - c + 1 }; };
    const inRect = (r, c) => c.x >= r.x && c.y >= r.y && c.x < r.x + r.w && c.y < r.y + r.h;
    function ensureCel(l, f) { let cel = doc.cels[l][f]; if (!cel) cel = doc.cels[l][f] = { data: new Uint8ClampedArray(doc.w * doc.h * 4), opacity: 255 }; return cel; }
    function cantDraw() {
      const L = doc.layers[ui.layer]; if (!L) return "There is no layer to draw on.";
      if (!L.visible) return "The layer “" + L.name + "” is hidden: show it (the eye in Layers) to draw on it.";
      if (L.locked) return "The layer “" + L.name + "” is locked: unlock it in Layers to draw on it.";
      return null;
    }

    // ---- gestures: one pointer draws with the tool, two touch pointers pinch to zoom and pan, the mouse wheel zooms ----
    const ptrs = new Map();
    let stroke = null, pinch = null, panDrag = null;
    const pt = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const cellOf = p => ({ x: Math.floor((p.x - ui.panX) / ui.zoom), y: Math.floor((p.y - ui.panY) / ui.zoom) });
    cv.addEventListener("pointerdown", e => {
      if (!doc) return; e.preventDefault(); try { cv.focus({ preventScroll: true }); } catch (x) {}
      const p = pt(e); ptrs.set(e.pointerId, { x: p.x, y: p.y, type: e.pointerType });
      try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      if (e.pointerType === "touch" && ptrs.size === 2) {
        // the second finger: a pinch; a stroke that had only just started is taken back, a longer one ends
        if (stroke) { if (performance.now() - stroke.t0 < 200 && stroke.far < 2) cancelStroke(); else endStroke(); }
        panDrag = null; const [a, b] = [...ptrs.values()];
        pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: ui.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, px: ui.panX, py: ui.panY }; return;
      }
      if (ptrs.size > 1 || pinch) return;
      if (e.button === 1 || ui.space || ui.tool === "pan") { panDrag = { x: p.x, y: p.y, px: ui.panX, py: ui.panY }; ui.spaceUsed = true; cv.classList.add("pxs-cur-pan"); return; }
      if (e.button !== 0 && e.button !== 2) return;
      beginStroke(e, p);
    });
    cv.addEventListener("pointermove", e => {
      if (!doc) return; const p = pt(e); const q = ptrs.get(e.pointerId); if (q) { q.x = p.x; q.y = p.y; }
      if (pinch) {
        const v = [...ptrs.values()]; if (v.length < 2) return; const [a, b] = v;
        const z = clamp(pinch.z0 * (Math.hypot(a.x - b.x, a.y - b.y) || 1) / pinch.d0, 0.25, 64), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ui.panX = mx - (pinch.mx - pinch.px) * z / pinch.z0; ui.panY = my - (pinch.my - pinch.py) * z / pinch.z0; ui.zoom = z; clampPan(); zoomV.textContent = Math.round(z * 100) + "%"; requestDraw(); return;
      }
      if (panDrag) { ui.panX = panDrag.px + p.x - panDrag.x; ui.panY = panDrag.py + p.y - panDrag.y; clampPan(); requestDraw(); return; }
      if (stroke && stroke.pid === e.pointerId) moveStroke(p);
      else if (e.pointerType === "mouse") { ui.hover = cellOf(p); requestDraw(); }
    });
    function pointerEnd(e, cancelled) {
      ptrs.delete(e.pointerId);
      if (pinch) { if (ptrs.size < 2) { pinch = null; saveUi(); } return; }
      if (panDrag) { panDrag = null; if (ui.tool !== "pan") cv.classList.remove("pxs-cur-pan"); return; }
      if (stroke && stroke.pid === e.pointerId) { if (cancelled && stroke.tool !== "select") cancelStroke(); else endStroke(); }
    }
    cv.addEventListener("pointerup", e => pointerEnd(e, false));
    cv.addEventListener("pointercancel", e => pointerEnd(e, true));
    cv.addEventListener("pointerleave", () => { ui.hover = null; requestDraw(); });
    cv.addEventListener("contextmenu", e => e.preventDefault());
    cv.addEventListener("wheel", e => { if (!doc) return; e.preventDefault(); setZoom(ui.zoom * Math.exp(-e.deltaY * 0.0015), pt(e)); }, { passive: false });

    // ---- the tools: a stroke is one pointer's work from down to up, rendered live on the cel ----
    function beginStroke(e, p) {
      const c = cellOf(p), right = e.button === 2, tool = ui.alt && e.pointerType === "mouse" ? "pick" : ui.tool;
      stroke = { pid: e.pointerId, tool, t0: performance.now(), c0: c, cur: c, last: c, far: 0, right, col: right ? ui.bg : ui.fg, path: [], drawn: 0, dirty: false, tok: null, snap: null };
      if (tool === "pick") { pickAt(c, right); return; }
      if (tool === "select") { selectDown(c); return; }
      const why = cantDraw(); if (why) { say(why); stroke = null; return; }
      if (ui.float) commitFloat();
      const cel = ensureCel(ui.layer, ui.frame); stroke.tok = celStep(ui.layer, ui.frame); stroke.snap = cel.data.slice();
      if (tool === "fill") { doFill(cel.data, c, stroke.col); markCel(); requestDraw(); endStroke(); return; }
      if (tool === "move") { cv.classList.add("pxs-cur-move"); return; }
      if (tool === "eraser") stroke.col = ERASE;
      addPathCell(c); renderStroke();
    }
    function moveStroke(p) {
      const s = stroke, c = cellOf(p); s.far = Math.max(s.far, Math.abs(c.x - s.c0.x), Math.abs(c.y - s.c0.y));
      if (s.tool === "pick") { pickAt(c, s.right); return; }
      if (s.tool === "select") { selectMove(c); return; }
      if (s.tool === "move") { const cel = doc.cels[ui.layer][ui.frame]; shiftInto(cel.data, s.snap, doc.w, doc.h, c.x - s.c0.x, c.y - s.c0.y, ui.wrap); markCel(); requestDraw(); return; }
      if (c.x === s.last.x && c.y === s.last.y) return;
      if (s.tool === "pencil" || s.tool === "eraser") { let first = true; bresenham(s.last, c, (x, y) => { if (first) { first = false; return; } addPathCell({ x, y }); }); }
      else s.cur = c;
      renderStroke();
    }
    // pixel-perfect: when the last three cells make an L, the corner's middle cell goes (a one-pixel line stays clean)
    function addPathCell(c) {
      const P = stroke.path; P.push(c);
      if (ui.pixelPerfect && ui.size === 1 && stroke.tool === "pencil" && P.length >= 3) {
        const a = P[P.length - 3], b = P[P.length - 2];
        if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1 && Math.abs(b.x - c.x) + Math.abs(b.y - c.y) === 1 && Math.abs(a.x - c.x) === 1 && Math.abs(a.y - c.y) === 1) { P.splice(P.length - 2, 1); stroke.dirty = true; }
      }
      stroke.last = c;
    }
    function renderStroke() {
      const s = stroke, data = doc.cels[ui.layer][ui.frame].data;
      if (s.tool === "pencil" || s.tool === "eraser") {
        if (s.dirty) { data.set(s.snap); s.drawn = 0; s.dirty = false; }
        for (let i = s.drawn; i < s.path.length; i++) stamp(data, s.path[i].x, s.path[i].y, s.col);
        s.drawn = s.path.length;
      } else {
        data.set(s.snap); const out = (x, y) => stamp(data, x, y, s.col), inside = (x, y) => put(data, x, y, s.col);
        if (s.tool === "line") bresenham(s.c0, s.cur, out);
        else if (s.tool === "rect") rectShape(s.c0, s.cur, ui.shapeFill, out, inside);
        else if (s.tool === "ellipse") ellipseShape(s.c0, s.cur, ui.shapeFill, out, inside);
      }
      markCel(); requestDraw();
    }
    function endStroke() {
      const s = stroke; if (!s) return; stroke = null; cv.classList.remove("pxs-cur-move");
      if (s.tool === "select") { selectUp(s); return; }
      if (s.tok && commitCel(s.tok)) changed();
    }
    function cancelStroke() {
      const s = stroke; if (!s) return; stroke = null; cv.classList.remove("pxs-cur-move");
      if (s.tool === "select") { if (s.moveSel && ui.float) { ui.float = null; doc.cels[ui.layer][ui.frame] = s.tok.before ? { data: s.tok.before.data.slice(), opacity: s.tok.before.opacity } : null; markCel(); } else if (s.marq) ui.sel = null; requestDraw(); refreshSelBar(); return; }
      if (s.tok) { doc.cels[s.tok.l][s.tok.f] = s.tok.before ? { data: s.tok.before.data.slice(), opacity: s.tok.before.opacity } : null; markCel(s.tok.l, s.tok.f); requestDraw(); }
    }
    function pickAt(c, right) {
      if (c.x < 0 || c.y < 0 || c.x >= doc.w || c.y >= doc.h) return;
      const col = getPx(flatData(ui.frame), c.x, c.y); if (!col[3]) return;
      setColour(right ? "bg" : "fg", col);
    }
    // the rectangle select: drag a marquee, or drag inside the selection to move its pixels (they float until the pointer lifts)
    function selectDown(c) {
      const s = ui.sel;
      if (s && inRect(s, c)) {
        const why = cantDraw(); if (why) { say(why); stroke = null; return; }
        const cel = ensureCel(ui.layer, ui.frame); stroke.tok = celStep(ui.layer, ui.frame);
        ui.float = { x: s.x, y: s.y, w: s.w, h: s.h, data: copyRect(cel.data, s) }; clearRect(cel.data, s); ui.sel = null;
        stroke.moveSel = { x0: s.x, y0: s.y, c0: c }; markCel(); requestDraw();
      } else { stroke.marq = { x0: c.x, y0: c.y }; ui.sel = null; requestDraw(); refreshSelBar(); }
    }
    function selectMove(c) {
      if (stroke.moveSel) { ui.float.x = stroke.moveSel.x0 + c.x - stroke.moveSel.c0.x; ui.float.y = stroke.moveSel.y0 + c.y - stroke.moveSel.c0.y; requestDraw(); }
      else if (stroke.marq) { ui.sel = normRect(stroke.marq.x0, stroke.marq.y0, c.x, c.y); requestDraw(); }
    }
    function selectUp(s) {
      if (s.moveSel) { commitFloat(); if (commitCel(s.tok)) changed(); }
      else if (s.marq && s.far === 0) ui.sel = null;
      requestDraw(); refreshSelBar();
    }
    function commitFloat() {
      const f = ui.float; if (!f) return; ui.float = null;
      const cel = ensureCel(ui.layer, ui.frame); blitAt(cel.data, doc.w, doc.h, f.data, f.w, f.h, f.x, f.y);
      const x0 = clamp(f.x, 0, doc.w - 1), y0 = clamp(f.y, 0, doc.h - 1), x1 = clamp(f.x + f.w - 1, 0, doc.w - 1), y1 = clamp(f.y + f.h - 1, 0, doc.h - 1);
      ui.sel = f.x + f.w > 0 && f.y + f.h > 0 && f.x < doc.w && f.y < doc.h ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
      markCel(); requestDraw(); refreshSelBar();
    }
    function setTool(k) {
      if (stroke) endStroke(); if (ui.float) commitFloat();
      ui.tool = k; for (const t in toolBtns) toolBtns[t].setAttribute("aria-pressed", String(t === k));
      const label = TOOLS.find(t => t[0] === k); cv.setAttribute("aria-label", "Pixel canvas, " + (label ? label[1].toLowerCase() : k) + " tool: one finger or the mouse draws, two fingers zoom and pan");
      cv.classList.toggle("pxs-cur-pan", k === "pan"); cv.classList.toggle("pxs-cur-move", k === "move"); cv.classList.toggle("pxs-cur-pick", k === "pick");
      renderOpts(); saveUi(); requestDraw();
    }

    // ---- history: up to 100 steps; a step is the touched cel (before and after) or the whole doc for structural changes ----
    const hist = { undo: [], redo: [], bytes: 0 };
    const celCopy = cel => cel ? { data: cel.data.slice(), opacity: cel.opacity == null ? 255 : cel.opacity } : null;
    const celBytes = cel => cel ? cel.data.length : 0;
    function sameCel(a, b) { if (!a && !b) return true; if (!a || !b || a.opacity !== b.opacity || a.data.length !== b.data.length) return false; const x = u32(a.data), y = u32(b.data); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; }
    function celStep(l, f) { return { kind: "cel", l, f, before: celCopy(doc.cels[l][f]) }; }
    function commitCel(tok) { tok.after = celCopy(doc.cels[tok.l][tok.f]); if (sameCel(tok.before, tok.after)) return false; tok.bytes = celBytes(tok.before) + celBytes(tok.after); push(tok); return true; }
    const docBytes = d => d.cels.reduce((n, L) => n + L.reduce((m, c) => m + celBytes(c), 0), 0) + 2048;
    function docStep(fn) {
      if (stroke) endStroke(); if (ui.float) commitFloat();
      const before = formats.cloneDoc(doc), uiBefore = { layer: ui.layer, frame: ui.frame }; fn(); const after = formats.cloneDoc(doc);
      push({ kind: "doc", before, after, bytes: docBytes(before) + docBytes(after), uiBefore, uiAfter: { layer: ui.layer, frame: ui.frame } });
      structural(); changed();
    }
    function push(step) {
      hist.undo.push(step); for (const s of hist.redo) hist.bytes -= s.bytes; hist.redo.length = 0; hist.bytes += step.bytes;
      while (hist.undo.length > HIST_MAX || (hist.bytes > HIST_BYTES && hist.undo.length > 1)) hist.bytes -= hist.undo.shift().bytes;
      updateUndo();
    }
    function applyStep(s, toBefore) {
      if (s.kind === "cel") { doc.cels[s.l][s.f] = celCopy(toBefore ? s.before : s.after); ui.layer = s.l; ui.frame = s.f; lcsFrame = -1; markCel(s.l, s.f); ui.sel = clampSel(ui.sel); ui.float = null; refreshTimeline(); refreshPanels(); }
      else { replaceDoc(formats.cloneDoc(toBefore ? s.before : s.after)); const u = toBefore ? s.uiBefore : s.uiAfter; ui.layer = u.layer; ui.frame = u.frame; ui.float = null; structural(); }
      changed(); refreshSelBar();
    }
    function undo() { if (stroke) endStroke(); if (ui.float) commitFloat(); const s = hist.undo.pop(); if (!s) { say("Nothing to undo."); return; } hist.redo.push(s); applyStep(s, true); updateUndo(); }
    function redo() { if (stroke) endStroke(); if (ui.float) commitFloat(); const s = hist.redo.pop(); if (!s) { say("Nothing to redo."); return; } hist.undo.push(s); applyStep(s, false); updateUndo(); }
    function updateUndo() { undoBtn.disabled = !hist.undo.length; redoBtn.disabled = !hist.redo.length; }
    function replaceDoc(src) { for (const k of Object.keys(doc)) delete doc[k]; Object.assign(doc, src); }
    function clampSel(s) { if (!s) return null; const r = normRect(s.x, s.y, s.x + s.w - 1, s.y + s.h - 1); return r.w > 0 && r.h > 0 ? r : null; }
    // after a structural change: caches, indices, strips and panels
    function structural() {
      markAll(); ui.layer = clamp(ui.layer, 0, doc.layers.length - 1); ui.frame = clamp(ui.frame, 0, doc.frames.length - 1);
      if (ui.playTag != null && !doc.tags[ui.playTag]) ui.playTag = null; ui.sel = clampSel(ui.sel);
      refreshTop(); refreshTimeline(); refreshColours(); refreshPanels(); refreshSelBar(); requestDraw();
    }
    // after any change to the document: redraw, thumbnails, the autosave
    function changed() { requestDraw(); scheduleThumbs(); scheduleSave(); }

    // ---- autosave: the doc as .aseprite bytes on the device, 500 ms after the last change ----
    let saveT = 0, saveBusy = false, saveAgain = false;
    function setSaved(t, dirty) { savedEl.textContent = t; savedEl.classList.toggle("pxs-dirty", !!dirty); }
    function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(autosave, 500); setSaved("Unsaved", true); }
    function thumbUrl(d) { try { const c = document.createElement("canvas"); const sc = Math.min(1, 48 / Math.max(d.w, d.h)); c.width = Math.max(1, Math.round(d.w * sc)); c.height = Math.max(1, Math.round(d.h * sc)); const x = c.getContext("2d"); x.imageSmoothingEnabled = false; x.drawImage(d === doc ? flatCanvas(0) : dataCanvas(formats.flatten(d, 0), d.w, d.h), 0, 0, c.width, c.height); return c.toDataURL("image/png"); } catch (e) { return ""; } }
    const metaOf = (d, id, template) => ({ id, name: d.name, template, updated: Date.now(), w: d.w, h: d.h, frames: d.frames.length, thumb: thumbUrl(d) });
    async function autosave() {
      if (!doc) return; if (saveBusy) { saveAgain = true; return; } saveBusy = true;
      try {
        if (!cur.id) cur.id = newId();
        const bytes = await formats.encodeAseprite(doc), where = await storage.save(metaOf(doc, cur.id, cur.template), bytes);
        if (where) { store.set("bs-studio-last", cur.id); cur.saved = true; setSaved(where === "db" ? "Saved" : "Saved (local)", false); if (ui.panel === "file" || !ui.phone) refreshSpriteList(); }
        else setSaved("Not saved", true);
      } catch (e) { setSaved("Not saved", true); say("Could not save the sprite on this device: " + ((e && e.message) || e)); }
      saveBusy = false; if (saveAgain) { saveAgain = false; autosave(); }
    }

    // ---- colours: the foreground / background pair and the palette strip ----
    function paintSw(b, c) { b.style.setProperty("--c", cssRgba(c)); b.classList.toggle("pxs-none", c[3] === 0); }
    function scrollStrip(strip, child) { if (!child) return; const l = child.offsetLeft - strip.offsetLeft, r = l + child.offsetWidth; if (l < strip.scrollLeft) strip.scrollLeft = l; else if (r > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = r - strip.clientWidth; }
    function refreshColours() {
      paintSw(fgSw, ui.fg); paintSw(bgSw, ui.bg); fgSw.title = "Foreground " + toHex(ui.fg); bgSw.title = "Background " + (ui.bg[3] ? toHex(ui.bg) : "transparent");
      palStrip.textContent = "";
      doc.palette.forEach((hex, i) => { const c = parseHex(hex) || [0, 0, 0, 255]; const b = sw("Colour " + (i + 1) + " of " + doc.palette.length + ", " + hex, () => pickPalette(i)); b.setAttribute("aria-pressed", String(i === ui.fgIndex)); paintSw(b, c); palStrip.append(b); });
      scrollStrip(palStrip, palStrip.children[ui.fgIndex]); syncColourPanel(); refreshPaletteGrid();
    }
    function pickPalette(i) { const c = parseHex(doc.palette[i]); if (!c) return; ui.fgIndex = i; setColour("fg", c, true); }
    function addRecent(hex) { ui.recent = [hex, ...ui.recent.filter(h => h !== hex)].slice(0, 12); }
    function setColour(which, c, fromPalette) {
      ui[which] = c.slice();
      if (which === "fg") { if (!fromPalette) ui.fgIndex = doc.palette.findIndex(h => { const p = parseHex(h); return p && sameCol(p, c); }); if (ui.tool === "eraser") setTool("pencil"); }
      if (!fromPalette) { addRecent(toHex(c)); saveUi(); }
      refreshColours();
    }
    function swapColours() { const f = ui.fg; ui.fg = ui.bg; ui.bg = f; ui.fgIndex = doc.palette.findIndex(h => { const p = parseHex(h); return p && sameCol(p, ui.fg); }); refreshColours(); }

    // ---- the tool options strip ----
    function renderOpts() {
      optsBar.textContent = ""; const t = ui.tool;
      const tog = (label, key, aria) => el("button", { type: "button", class: "pxs-ib", "aria-pressed": String(!!ui[key]), "aria-label": aria || label, onclick: () => { ui[key] = !ui[key]; renderOpts(); refreshToggles(); saveUi(); requestDraw(); }, text: label });
      if (["pencil", "eraser", "line", "rect", "ellipse"].includes(t)) optsBar.append(el("span", { class: "pxs-sizes", role: "group", "aria-label": "Brush size" }, [1, 2, 3, 4].map(s => el("button", { type: "button", class: "pxs-ib", "aria-label": "Brush size " + s, "aria-pressed": String(ui.size === s), onclick: () => { ui.size = s; renderOpts(); saveUi(); requestDraw(); }, text: String(s) }))));
      if (t === "pencil") optsBar.append(tog("Pixel-perfect", "pixelPerfect"));
      if (t === "fill") optsBar.append(tog("Global", "fillGlobal", "Global fill: every pixel of that colour"));
      if (t === "rect" || t === "ellipse") optsBar.append(tog("Filled", "shapeFill"));
      if (t === "move") optsBar.append(tog("Wrap", "wrap", "Wrap round the edges (for tiles)"));
      if (t !== "pick" && t !== "pan") optsBar.append(tog("Mirror X", "mirrorX"), tog("Mirror Y", "mirrorY"));
      if (t === "select") optsBar.append(el("span", { class: "pxs-note", text: "Drag to select; drag inside the selection to move it." }));
      if (t === "pick") optsBar.append(el("span", { class: "pxs-note", text: "Tap a pixel to take its colour (the right button sets the background)." }));
      if (t === "pan") optsBar.append(el("span", { class: "pxs-note", text: "Drag to move the view; pinch to zoom." }));
    }

    // ---- the timeline strip and the frame thumbnails ----
    const thumbCvs = [];
    function drawThumb(c, f) { const x = c.getContext("2d"); x.imageSmoothingEnabled = false; x.clearRect(0, 0, c.width, c.height); const sc = Math.min(c.width / doc.w, c.height / doc.h), w = doc.w * sc, h = doc.h * sc; x.drawImage(flatCanvas(f), (c.width - w) / 2, (c.height - h) / 2, w, h); }
    function refreshTimeline() {
      frs.textContent = ""; thumbCvs.length = 0; const d = Math.min(2, dpr());
      doc.frames.forEach((fr, i) => {
        const c = el("canvas", { class: "pxs-thumb", width: 36 * d, height: 30 * d }); thumbCvs[i] = c; drawThumb(c, i);
        frs.append(el("button", { type: "button", class: "pxs-fr", "aria-pressed": String(i === ui.frame), "aria-label": "Frame " + (i + 1) + " of " + doc.frames.length + ", " + fr.duration + " ms", onclick: () => setFrame(i) }, c, el("span", { text: String(i + 1) })));
      });
      scrollStrip(frs, frs.children[ui.frame]);
      playBtn.replaceChildren(icon(ui.playing ? "pause" : "play")); playBtn.setAttribute("aria-label", ui.playing ? "Pause" : "Play"); playBtn.title = ui.playing ? "Pause" : "Play"; playBtn.setAttribute("aria-pressed", String(ui.playing));
    }
    let thumbsT = 0;
    function scheduleThumbs() { clearTimeout(thumbsT); thumbsT = setTimeout(() => { if (!doc) return; const c = thumbCvs[ui.frame]; if (c) drawThumb(c, ui.frame); refreshLayerThumbs(); }, 150); }
    function setFrame(i, quiet) {
      i = clamp(i, 0, doc.frames.length - 1); if (i === ui.frame) return; if (stroke) endStroke(); if (ui.float) commitFloat();
      ui.frame = i; for (let k = 0; k < frs.children.length; k++) frs.children[k].setAttribute("aria-pressed", String(k === i)); scrollStrip(frs, frs.children[i]);
      requestDraw(); scheduleThumbs(); if (!quiet) refreshPanels("frames");
    }

    // ---- playback: the current frame advances by the durations, inside a tag's range and direction when one plays ----
    let playLast = 0;
    function stepFrame(f, tag, st) {
      const n = doc.frames.length, from = tag ? clamp(tag.from, 0, n - 1) : 0, to = tag ? clamp(tag.to, from, n - 1) : n - 1, dir = tag ? tag.direction : "forward";
      if (f < from || f > to) return dir === "reverse" || dir === "pingpong-reverse" ? to : from;
      if (dir === "forward") return f + 1 > to ? from : f + 1;
      if (dir === "reverse") return f - 1 < from ? to : f - 1;
      let nx = f + st.playDir; if (nx > to || nx < from) { st.playDir = -st.playDir; nx = f + st.playDir; if (nx > to || nx < from) nx = from; } return nx;
    }
    function togglePlay(tagIndex) {
      if (tagIndex !== undefined) { ui.playTag = tagIndex; ui.playing = true; } else ui.playing = !ui.playing;
      playLast = performance.now(); const tag = ui.playTag != null ? doc.tags[ui.playTag] : null;
      ui.playDir = tag && (tag.direction === "reverse" || tag.direction === "pingpong-reverse") ? -1 : 1;
      refreshTimeline(); if (!ui.playing) refreshPanels("frames"); requestDraw();
    }
    function tickPlay(now) {
      if (!ui.playing || !doc) return; const fr = doc.frames[ui.frame]; if (now - playLast < Math.max(20, fr ? fr.duration : 100)) return; playLast = now;
      setFrame(stepFrame(ui.frame, ui.playTag != null ? doc.tags[ui.playTag] : null, ui), true);
    }

    // ---- layers ----
    const newLayer = name => ({ name, visible: true, locked: false, opacity: 255, blend: "normal" });
    function addLayer() { docStep(() => { const i = ui.layer + 1; doc.layers.splice(i, 0, newLayer("Layer " + (doc.layers.length + 1))); doc.cels.splice(i, 0, doc.frames.map(() => null)); ui.layer = i; }); }
    function dupLayer() { docStep(() => { const i = ui.layer, L = doc.layers[i]; doc.layers.splice(i + 1, 0, Object.assign({}, L, { name: L.name + " copy" })); doc.cels.splice(i + 1, 0, doc.cels[i].map(celCopy)); ui.layer = i + 1; }); }
    function delLayer() { if (doc.layers.length < 2) { say("A sprite keeps at least one layer."); return; } docStep(() => { doc.layers.splice(ui.layer, 1); doc.cels.splice(ui.layer, 1); ui.layer = clamp(ui.layer - 1, 0, doc.layers.length - 1); }); }
    function scaleAlpha(data, k) { const out = data.slice(); for (let i = 3; i < out.length; i += 4) out[i] = Math.round(out[i] * k); return out; }
    function mergeDown() {
      if (ui.layer < 1) { say("There is no layer below this one to merge into."); return; }
      docStep(() => { const l = ui.layer, U = doc.layers[l];
        for (let f = 0; f < doc.frames.length; f++) { const up = doc.cels[l][f]; if (!up) continue; const lo = ensureCel(l - 1, f), k = (U.opacity / 255) * ((up.opacity == null ? 255 : up.opacity) / 255); blitAt(lo.data, doc.w, doc.h, k < 1 ? scaleAlpha(up.data, k) : up.data, doc.w, doc.h, 0, 0); }
        doc.layers.splice(l, 1); doc.cels.splice(l, 1); ui.layer = l - 1; });
    }
    function moveLayer(dir) { const l = ui.layer, m = l + dir; if (m < 0 || m >= doc.layers.length) return; docStep(() => { [doc.layers[l], doc.layers[m]] = [doc.layers[m], doc.layers[l]]; [doc.cels[l], doc.cels[m]] = [doc.cels[m], doc.cels[l]]; ui.layer = m; }); }
    function flattenLayers() { if (doc.layers.length < 2) { say("There is only one layer."); return; } docStep(() => { const cels = doc.frames.map((fr, f) => ({ data: formats.flatten(doc, f), opacity: 255 })); doc.layers = [newLayer("Layer 1")]; doc.cels = [cels]; ui.layer = 0; }); }
    function setLayerProp(l, key, value) { docStep(() => { doc.layers[l][key] = value; }); }

    // ---- frames and tags ----
    function addFrame() { docStep(() => { const f = ui.frame; doc.frames.splice(f + 1, 0, { duration: doc.frames[f].duration }); doc.cels.forEach(L => L.splice(f + 1, 0, null)); tagsAfterInsert(f + 1); ui.frame = f + 1; }); }
    function dupFrame() { docStep(() => { const f = ui.frame; doc.frames.splice(f + 1, 0, { duration: doc.frames[f].duration }); doc.cels.forEach(L => L.splice(f + 1, 0, celCopy(L[f]))); tagsAfterInsert(f + 1); ui.frame = f + 1; }); }
    function tagsAfterInsert(at) { for (const t of doc.tags) { if (t.from <= at - 1 && t.to >= at - 1) t.to++; else if (t.from >= at) { t.from++; t.to++; } } }
    function delFrame() {
      if (doc.frames.length < 2) { say("A sprite keeps at least one frame."); return; }
      docStep(() => { const f = ui.frame; doc.frames.splice(f, 1); doc.cels.forEach(L => L.splice(f, 1));
        doc.tags = doc.tags.map(t => Object.assign({}, t, { from: t.from > f ? t.from - 1 : t.from, to: t.to >= f ? t.to - 1 : t.to })).filter(t => t.to >= t.from && t.from < doc.frames.length);
        ui.frame = clamp(f, 0, doc.frames.length - 1); });
    }
    function moveFrame(dir) { const f = ui.frame, g = f + dir; if (g < 0 || g >= doc.frames.length) return; docStep(() => { [doc.frames[f], doc.frames[g]] = [doc.frames[g], doc.frames[f]]; doc.cels.forEach(L => { [L[f], L[g]] = [L[g], L[f]]; }); ui.frame = g; }); }
    function setDuration(ms, all) { ms = clamp(Math.round(num(ms, 100)), 1, 65535); docStep(() => { if (all) doc.frames.forEach(fr => fr.duration = ms); else doc.frames[ui.frame].duration = ms; }); }

    // ---- the selection's actions (an internal clipboard) ----
    function flipBuf(buf, w, h, fx, fy) { const out = new Uint8ClampedArray(buf.length), s = u32(buf), d = u32(out); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = s[(fy ? h - 1 - y : y) * w + (fx ? w - 1 - x : x)]; return out; }
    function rotateBuf(buf, w, h) { const out = new Uint8ClampedArray(buf.length), s = u32(buf), d = u32(out); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[x * h + (h - 1 - y)] = s[y * w + x]; return out; }
    function selOp(kind) {
      if (ui.float) commitFloat(); const s = ui.sel;
      if (kind === "all") { ui.sel = { x: 0, y: 0, w: doc.w, h: doc.h }; if (ui.tool !== "select") setTool("select"); requestDraw(); refreshSelBar(); return; }
      if (kind === "none") { ui.sel = null; requestDraw(); refreshSelBar(); return; }
      if (kind === "paste") {
        if (!ui.clip) { say("Nothing to paste yet: copy or cut a selection first."); return; } const why = cantDraw(); if (why) { say(why); return; }
        const cel = ensureCel(ui.layer, ui.frame), tok = celStep(ui.layer, ui.frame), x = s ? s.x : 0, y = s ? s.y : 0;
        blitAt(cel.data, doc.w, doc.h, ui.clip.data, ui.clip.w, ui.clip.h, x, y); ui.sel = normRect(x, y, x + ui.clip.w - 1, y + ui.clip.h - 1);
        markCel(); if (commitCel(tok)) changed(); if (ui.tool !== "select") setTool("select"); requestDraw(); refreshSelBar(); say("Pasted: drag inside the selection to move it."); return;
      }
      if (!s) { say("Select an area first, with the Select tool."); return; }
      const cel = doc.cels[ui.layer][ui.frame];
      if (kind === "copy") { ui.clip = { w: s.w, h: s.h, data: cel ? copyRect(cel.data, s) : new Uint8ClampedArray(s.w * s.h * 4) }; say("Copied " + s.w + " × " + s.h + " px."); refreshSelBar(); return; }
      const why = cantDraw(); if (why) { say(why); return; }
      const c2 = ensureCel(ui.layer, ui.frame), tok = celStep(ui.layer, ui.frame);
      if (kind === "cut") { ui.clip = { w: s.w, h: s.h, data: copyRect(c2.data, s) }; clearRect(c2.data, s); say("Cut " + s.w + " × " + s.h + " px."); }
      else if (kind === "delete") clearRect(c2.data, s);
      else {
        let buf = copyRect(c2.data, s), w = s.w, h = s.h; clearRect(c2.data, s);
        if (kind === "flipH") buf = flipBuf(buf, w, h, true, false); else if (kind === "flipV") buf = flipBuf(buf, w, h, false, true); else if (kind === "rotate") { buf = rotateBuf(buf, w, h); const t = w; w = h; h = t; }
        blitAt(c2.data, doc.w, doc.h, buf, w, h, s.x, s.y); ui.sel = normRect(s.x, s.y, s.x + w - 1, s.y + h - 1);
      }
      markCel(); if (commitCel(tok)) changed(); requestDraw(); refreshSelBar();
    }
    const SEL_ACTIONS = [["cut", "Cut", "cut"], ["copy", "Copy", "copy"], ["paste", "Paste", "paste"], ["trash", "Delete the selected pixels", "delete"], ["flipH", "Flip the selection horizontally", "flipH"], ["flipV", "Flip the selection vertically", "flipV"], ["rotate", "Rotate the selection 90°", "rotate"], ["all", "Select all", "all"], ["none", "Deselect", "none"]];
    const selBtns = SEL_ACTIONS.map(([ic, label, op]) => { const b = ib(ic, label, () => selOp(op)); b.dataset.op = op; return b; });
    selBar.append(...selBtns);
    function refreshSelBar() {
      selBar.hidden = !(ui.sel || ui.float || ui.tool === "select");
      for (const b of selBtns) b.disabled = (b.dataset.op === "paste" ? !ui.clip : b.dataset.op !== "all" && b.dataset.op !== "none" && !ui.sel);
    }

    // ---- the whole sprite: resize, scale, crop, flip, rotate, shift, clip to the template ----
    function eachCel(fn) { doc.cels.forEach((L, l) => L.forEach((cel, f) => { if (cel) fn(cel, l, f); })); }
    function afterResize() { ui.sel = null; ui.float = null; const P = presets[cur.template]; if (!(P && P.w === doc.w && P.h === doc.h)) cur.template = guessTemplate(presets, doc.w, doc.h); }
    function resizeTo(w, h, ox, oy) {
      w = clamp(Math.round(num(w, doc.w)), 1, MAX); h = clamp(Math.round(num(h, doc.h)), 1, MAX);
      docStep(() => { eachCel(cel => { const out = new Uint8ClampedArray(w * h * 4); blitAt(out, w, h, cel.data, doc.w, doc.h, ox, oy); cel.data = out; }); doc.w = w; doc.h = h; afterResize(); }); fitZoom();
    }
    function resizeCanvas(w, h, ax, ay) { w = clamp(Math.round(num(w, doc.w)), 1, MAX); h = clamp(Math.round(num(h, doc.h)), 1, MAX); resizeTo(w, h, Math.round((w - doc.w) * ax), Math.round((h - doc.h) * ay)); }
    function scaleBuf(src, sw, sh, dw, dh) { const out = new Uint8ClampedArray(dw * dh * 4), s = u32(src), d = u32(out); for (let y = 0; y < dh; y++) { const sy = Math.floor(y * sh / dh); for (let x = 0; x < dw; x++) d[y * dw + x] = s[sy * sw + Math.floor(x * sw / dw)]; } return out; }
    function scaleSprite(k) {
      const w = Math.round(doc.w * k), h = Math.round(doc.h * k);
      if (w > MAX || h > MAX) { say("That would be bigger than " + MAX + " × " + MAX + " px."); return; } if (w < 1 || h < 1) { say("That would be smaller than a pixel."); return; }
      docStep(() => { eachCel(cel => { cel.data = scaleBuf(cel.data, doc.w, doc.h, w, h); }); doc.w = w; doc.h = h; afterResize(); }); fitZoom();
    }
    function cropToSel() { const s = ui.sel; if (!s) { say("Select the area to keep first, with the Select tool."); return; } resizeTo(s.w, s.h, -s.x, -s.y); }
    function flipSprite(fx, fy) { docStep(() => eachCel(cel => { cel.data = flipBuf(cel.data, doc.w, doc.h, fx, fy); })); }
    function rotateSprite() { docStep(() => { eachCel(cel => { cel.data = rotateBuf(cel.data, doc.w, doc.h); }); const t = doc.w; doc.w = doc.h; doc.h = t; afterResize(); }); fitZoom(); }
    function shiftSprite(dx, dy, wrap) { dx = Math.round(num(dx, 0)); dy = Math.round(num(dy, 0)); if (!dx && !dy) return; docStep(() => eachCel(cel => { const out = new Uint8ClampedArray(cel.data.length); shiftInto(out, cel.data, doc.w, doc.h, dx, dy, wrap); cel.data = out; })); }
    function clipToTemplate() {
      const P = presets[cur.template]; if (!P || P.shape === "free" || P.shape === "char") { say("This template has no outline to clip to."); return; }
      docStep(() => doc.cels.forEach(L => { const cel = L[ui.frame]; if (!cel) return; for (let y = 0; y < doc.h; y++) for (let x = 0; x < doc.w; x++) if (!inShape(P.shape, doc.w, doc.h, x + .5, y + .5)) setPx(cel.data, x, y, ERASE); }));
    }

    // ---- the panels: a sheet on a phone, sections on a desktop ----
    function togglePanel(k) { if (ui.panel === k && root.classList.contains("pxs-open")) closePanel(); else openPanel(k); }
    function openPanel(k) {
      ui.panel = k; for (const p in panelEls) panelEls[p].classList.toggle("pxs-active", p === k); for (const t in tabBtns) tabBtns[t].setAttribute("aria-pressed", String(t === k));
      root.classList.add("pxs-open"); refreshPanels(k);
      if (!ui.phone && k !== "colour" && k in ui.open) { ui.open[k] = true; applyOpen(k); }
      saveUi();
    }
    function closePanel() { root.classList.remove("pxs-open"); for (const p in panelEls) panelEls[p].classList.remove("pxs-active"); for (const t in tabBtns) tabBtns[t].setAttribute("aria-pressed", "false"); ui.panel = null; saveUi(); }
    function applyOpen(k) { panelEls[k].classList.toggle("pxs-closed", !ui.open[k]); const b = panelEls[k].querySelector(".pxs-collapse"); if (b) b.setAttribute("aria-expanded", String(!!ui.open[k])); }
    function toggleOpen(k) { ui.open[k] = !ui.open[k]; applyOpen(k); if (ui.open[k]) refreshPanels(k); saveUi(); }
    function refreshToggles() { renderOpts(); const b = panelBodies.canvas; if (b) b.querySelectorAll("[data-ui]").forEach(i => { i.checked = !!ui[i.dataset.ui]; }); }

    // ---- full screen: the studio fixed over the whole viewport (and the browser's own full screen where it exists) ----
    let nativeFs = false;
    function setFull(on) {
      if (ui.full === on) return; ui.full = on; root.classList.toggle("pxs-full", on); document.body.style.overflow = on ? "hidden" : "";
      fullBtn.replaceChildren(icon(on ? "close" : "full")); fullBtn.setAttribute("aria-label", on ? "Close full screen" : "Full screen"); fullBtn.title = on ? "Close full screen (Escape)" : "Full screen"; fullBtn.setAttribute("aria-pressed", String(on));
      if (on) { try { const p = root.requestFullscreen && root.requestFullscreen(); if (p && p.then) p.then(() => { nativeFs = true; }, () => {}); } catch (e) {} }
      else if (nativeFs) { nativeFs = false; try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch (e) {} }
      setTimeout(() => { onResize(); fitZoom(); }, 60);
    }
    document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && nativeFs) { nativeFs = false; if (ui.full) setFull(false); } });

    // ---- the top strip ----
    function refreshTop() { nameEl.textContent = doc.name; dimEl.textContent = doc.w + " × " + doc.h + (doc.frames.length > 1 ? " · " + doc.frames.length + " fr" : ""); }
    function inlineEdit(anchor, value, done) {
      const inp = el("input", { type: "text", class: "pxs-inline", value, "aria-label": "New name" }); let fin = false;
      const finish = ok => { if (fin) return; fin = true; inp.replaceWith(anchor); if (ok) done(inp.value.trim()); };
      inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") finish(false); e.stopPropagation(); });
      inp.addEventListener("blur", () => finish(true)); anchor.replaceWith(inp); inp.focus(); inp.select();
    }
    function renameSprite() { inlineEdit(nameBtn, doc.name, v => { const n = safeName(v); if (n !== doc.name) docStep(() => { doc.name = n; }); }); }
