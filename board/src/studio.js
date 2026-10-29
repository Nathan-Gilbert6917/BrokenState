// The pixel studio (board/src/studio.css for its styles): mounted by art.js into the Art school page. Built by build.js.
// An Aseprite-like editor made for a phone first: one finger draws, two fingers pinch to zoom and pan, the colours, the
// tools, the frames and the panel tabs are strips under the canvas, and a panel opens as a sheet above them; on a
// desktop the same DOM spreads into a grid (tools left, panels right) and takes the keyboard. The document is the
// model of studio-brief.md, shared with formats.js (window.AseFormats): layers bottom first, frames with durations,
// cels of straight-alpha RGBA, tags, a palette; it is the single source of truth (api.getDoc() returns the live one).
// Templates (the game's sprite and tile sizes with their guides, seed drawings and the tiled previews) live here too.
// Sections: helpers · icons · colours · templates · storage · mount (state, rendering, gestures, tools, history,
// autosave, strips, panels, files, keyboard, api). window.PixelStudio.mount(host, opts) returns the api art.js uses
// (newFromTemplate, openDoc, getDoc, exportBytes, scrollIntoView, getView, undo, redo, newCustom, showStart, destroy);
// PixelStudio.api is the last one mounted and PixelStudio.active the one the keyboard goes to. PixelStudio.open(opts)
// puts a fresh studio over the whole page, starting from the start screen (a new sprite with its width and height, an
// import, or a saved sprite), which its Close removes; the top strip's button opens one.
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
    none: '<rect x="4" y="4" width="16" height="16" stroke-dasharray="3 2"/>',
    newwin: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 9h18M12 11.5v5M9.5 14h5"/>',
    home: '<path d="M4 20V10l8-6 8 6v10h-5v-6h-6v6z"/>',
    clear: '<path d="M20 4l-7 7"/><path d="M13 11l-2.5-2.5L5 14l5 5 5.5-5.5z"/><path d="M7.5 16.5L5 21M10 19l-1 2.5"/>'
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
    const startMode = !!opts.start, onClose = typeof opts.onClose === "function" ? opts.onClose : null;   // a fresh studio (PS.open): the start screen first; its Close removes it
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
    const startBtn = onClose ? ib("home", "Start screen: create or import a sprite", () => showStart()) : ib("newwin", "Open a new studio: create or import a sprite", () => PS.open(opts));
    const clearBtn = ib("clear", "Clear the drawing", () => askClear());
    const top = el("div", { class: "pxs-top", role: "toolbar", "aria-label": "Sprite" }, nameBtn, savedEl, startBtn, undoBtn, redoBtn, clearBtn, fullBtn);
    const modal = el("div", { class: "pxs-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "pxs-modal-t", hidden: true });
    const startEl = el("div", { class: "pxs-start", role: "region", "aria-label": "Start a sprite", hidden: true });
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
    root.append(probe, top, view, colours, tools, optsBar, time, tabs, panels, status, startEl, modal);
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
      ui.zoom = z; ui.panX = Math.round((W - doc.w * z) / 2); ui.panY = Math.round((H - doc.h * z) / 2); ui.fitted = true; zoomV.textContent = Math.round(z * 100) + "%"; requestDraw(); saveUi();
      if (ui.restoreZoom) { const rz = ui.restoreZoom; ui.restoreZoom = 0; setZoom(rz); }
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
    let saveT = 0, saveBusy = false, saveAgain = false, savePending = false;
    function setSaved(t, dirty) { savedEl.textContent = t; savedEl.classList.toggle("pxs-dirty", !!dirty); }
    function scheduleSave() { savePending = true; clearTimeout(saveT); saveT = setTimeout(autosave, 500); setSaved("Unsaved", true); }
    function thumbUrl(d) { try { const c = document.createElement("canvas"); const sc = Math.min(1, 48 / Math.max(d.w, d.h)); c.width = Math.max(1, Math.round(d.w * sc)); c.height = Math.max(1, Math.round(d.h * sc)); const x = c.getContext("2d"); x.imageSmoothingEnabled = false; x.drawImage(d === doc ? flatCanvas(0) : dataCanvas(formats.flatten(d, 0), d.w, d.h), 0, 0, c.width, c.height); return c.toDataURL("image/png"); } catch (e) { return ""; } }
    const metaOf = (d, id, template) => ({ id, name: d.name, template, updated: Date.now(), w: d.w, h: d.h, frames: d.frames.length, thumb: thumbUrl(d) });
    async function autosave() {
      if (!doc) return; if (saveBusy) { saveAgain = true; return; } saveBusy = true; savePending = false;
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
    function toggleOpen(k) { ui.open[k] = !ui.open[k]; applyOpen(k); if (ui.open[k]) { refreshPanels(k); panels.scrollTop = panelEls[k].offsetTop - panels.offsetTop; } saveUi(); }
    function refreshToggles() { renderOpts(); const b = panelBodies.canvas; if (b) b.querySelectorAll("[data-ui]").forEach(i => { i.checked = !!ui[i.dataset.ui]; }); }

    // ---- clear: this frame on the layer, this frame, or the whole sprite; a dialog asks first, Undo brings it back ----
    let modalBack = null;
    function askClear() {
      if (!doc) return;
      modal.textContent = "";
      const L = doc.layers[ui.layer], locked = doc.layers.filter(x => x.locked).length;
      const scopes = [["cel", "This frame on the layer “" + (L ? L.name : "") + "”"], ["frame", "This frame, every layer"], ["all", "The whole sprite: every frame and every layer"]];
      let scope = "cel";
      const radios = scopes.map(([v, t], i) => el("label", { class: "pxs-check" }, el("input", { type: "radio", name: "pxs-clear-scope", value: v, checked: i === 0 ? true : null, onchange: () => { scope = v; } }), t));
      const ok = btn("Clear", () => { closeModal(); clearScope(scope); }, "pxs-danger"), cancel = btn("Cancel", () => closeModal());
      modal.append(el("div", { class: "pxs-modal-c" }, el("h4", { id: "pxs-modal-t", text: "Clear the drawing?" }),
        el("p", { class: "pxs-note", text: "The pixels go" + (locked ? ", except on a locked layer" : "") + "; Undo brings them back." }),
        el("div", { class: "pxs-list" }, radios), el("div", { class: "pxs-row" }, ok, cancel)));
      modalBack = document.activeElement; modal.hidden = false; try { ok.focus({ preventScroll: true }); } catch (e) {}
    }
    function closeModal() { if (modal.hidden) return; modal.hidden = true; modal.textContent = ""; try { if (modalBack && modalBack.focus && modalBack.isConnected) modalBack.focus({ preventScroll: true }); } catch (e) {} modalBack = null; }
    modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
    function clearScope(scope) {
      if (scope === "cel") { const why = cantDraw(); if (why) { say(why); return; } }
      const wipe = (l, f) => { const cel = doc.cels[l][f]; if (cel && !doc.layers[l].locked) cel.data.fill(0); };
      docStep(() => {
        if (scope === "cel") wipe(ui.layer, ui.frame);
        else if (scope === "frame") doc.layers.forEach((x, l) => wipe(l, ui.frame));
        else doc.layers.forEach((x, l) => doc.frames.forEach((y, f) => wipe(l, f)));
      });
      ui.sel = null; refreshSelBar(); requestDraw();
      say(scope === "cel" ? "Cleared this frame on the layer." : scope === "frame" ? "Cleared this frame." : "Cleared the whole sprite.");
    }

    // ---- the start screen: a new sprite with its width (x) and height (y), an import, or a saved sprite ----
    function renderStart() {
      startEl.textContent = "";
      const name = el("input", { type: "text", value: "", placeholder: "name", "aria-label": "Name of the new sprite" });
      const w = numIn({ min: 1, max: MAX, value: 32, "aria-label": "Width of the new sprite in pixels (x)" }), h = numIn({ min: 1, max: MAX, value: 32, "aria-label": "Height of the new sprite in pixels (y)" }), nf = numIn({ min: 1, max: 64, value: 1, "aria-label": "Frames of the new sprite" });
      const tsel = el("select", { "aria-label": "Template of the new sprite" }, el("option", { value: "", text: "Custom size" }), presetKeys.map(k => el("option", { value: k, text: presets[k].label })));
      tsel.addEventListener("change", () => { const P = presets[tsel.value]; if (P) { w.value = P.w; h.value = P.h; } });
      // a template at its own size opens with its seed drawing and guide; any other size is a plain sprite of that size
      const create = () => { const n = Math.max(1, Math.round(num(nf.value, 1))), P = presets[tsel.value]; if (P && num(w.value, 0) === P.w && num(h.value, 0) === P.h) newFromTemplate(tsel.value, { frames: n, name: name.value.trim() }); else newCustom(num(w.value, 32), num(h.value, 32), n, name.value.trim()); };
      for (const i of [name, w, h, nf]) i.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); create(); } });
      const fw = numIn({ min: 1, max: MAX, placeholder: "auto", "aria-label": "Frame width, to split a strip" }), fh = numIn({ min: 1, max: MAX, placeholder: "auto", "aria-label": "Frame height, to split a strip" });
      const imp = el("input", { type: "file", multiple: true, accept: ".aseprite,.ase,.png,.gif,.webp,.jpg,.jpeg,.json", "aria-label": "Import a sprite: an Aseprite file, an image, or an image with its Aseprite sheet JSON", onchange: e => { const fs = [...(e.target.files || [])]; e.target.value = ""; importFiles(fs, num(fw.value, 0), num(fh.value, 0)); } });
      const saved = el("div", { class: "pxs-list", role: "list", "aria-label": "Sprites saved on this device" });
      startEl.append(el("h3", { text: "Start a sprite" }),
        el("div", { class: "pxs-cards" },
          el("div", { class: "pxs-card" }, el("h4", { text: "Create a new sprite" }),
            el("div", { class: "pxs-row" }, field("Name", name), field("Template", tsel)),
            el("div", { class: "pxs-row" }, el("span", { class: "pxs-xy" }, field("Width (x)", w), el("span", { class: "pxs-times", text: "×" }), field("Height (y)", h)), field("Frames", nf)),
            el("p", { class: "pxs-note", text: "The sprite's size in pixels, up to " + MAX + " × " + MAX + ". A template fills in the game's size for that kind of sprite." }),
            el("div", { class: "pxs-row" }, btn("Create", create, "pxs-primary"))),
          el("div", { class: "pxs-card" }, el("h4", { text: "Import a sprite" }),
            el("div", { class: "pxs-row" }, imp),
            el("div", { class: "pxs-row" }, field("Frame width", fw), field("Frame height", fh)),
            el("p", { class: "pxs-note", text: "An .aseprite file with its layers, frames, tags and palette; or a PNG, GIF, WebP or JPEG as one frame, a strip split by the frame size, or a sheet with its Aseprite .json chosen alongside." })),
          el("div", { class: "pxs-card" }, el("h4", { text: "Open a saved sprite" }), saved)));
      storage.list().then(items => {
        if (!saved.isConnected) return;
        if (!items.length) { saved.append(el("p", { class: "pxs-note", text: "Nothing is saved on this device yet." })); return; }
        for (const m of items.slice(0, 12)) saved.append(el("div", { class: "pxs-sprite", role: "listitem" }, m.thumb ? el("img", { src: m.thumb, alt: "" }) : null,
          el("span", { class: "pxs-lname" }, el("span", { text: m.name }), el("span", { class: "pxs-dim", text: m.w + " × " + m.h + (m.frames > 1 ? " · " + m.frames + " fr" : "") })), btn("Open", () => openSaved(m))));
      });
    }
    function showStart() { renderStart(); startEl.style.top = top.offsetHeight + "px"; startEl.hidden = false; closePanel(); if (!ui.phone) { const f = startEl.querySelector("input"); if (f) { try { f.focus({ preventScroll: true }); } catch (e) {} } } }
    function hideStart() { if (!startEl.hidden) { startEl.hidden = true; startEl.textContent = ""; } }

    // ---- full screen: the studio fixed over the whole viewport (and the browser's own full screen where it exists) ----
    let nativeFs = false;
    function setFull(on) {
      if (ui.full === on) return;
      if (!on && onClose) { onClose(); return; }   // a fresh studio over the page: leaving full screen closes it
      ui.full = on; root.classList.toggle("pxs-full", on); document.body.style.overflow = on ? "hidden" : "";
      const closeLabel = onClose ? "Close this studio" : "Close full screen";
      fullBtn.replaceChildren(icon(on ? "close" : "full")); fullBtn.setAttribute("aria-label", on ? closeLabel : "Full screen"); fullBtn.title = on ? closeLabel + " (Escape)" : "Full screen"; fullBtn.setAttribute("aria-pressed", String(on));
      if (on) { try { const p = root.requestFullscreen && root.requestFullscreen(); if (p && p.then) p.then(() => { nativeFs = true; }, () => {}); } catch (e) {} }
      else if (nativeFs) { nativeFs = false; try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch (e) {} }
      setTimeout(() => { onResize(); fitZoom(); }, 60);
    }
    const onFsChange = () => { if (!document.fullscreenElement && nativeFs) { nativeFs = false; if (ui.full) setFull(false); } };
    document.addEventListener("fullscreenchange", onFsChange);

    // ---- the top strip ----
    function refreshTop() { nameEl.textContent = doc.name; dimEl.textContent = doc.w + " × " + doc.h + (doc.frames.length > 1 ? " · " + doc.frames.length + " fr" : ""); }
    function inlineEdit(anchor, value, done) {
      const inp = el("input", { type: "text", class: "pxs-inline", value, "aria-label": "New name" }); let fin = false;
      const finish = ok => { if (fin) return; fin = true; inp.replaceWith(anchor); if (ok) done(inp.value.trim()); };
      inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") finish(false); e.stopPropagation(); });
      inp.addEventListener("blur", () => finish(true)); anchor.replaceWith(inp); inp.focus(); inp.select();
    }
    function renameSprite() { inlineEdit(nameBtn, doc.name, v => { const n = safeName(v); if (n !== doc.name) docStep(() => { doc.name = n; }); }); }

    // ---- the panels' contents ----
    const stale = new Set();
    const field = (label, input) => el("label", { class: "pxs-field" }, label, input);
    const numIn = (attrs) => el("input", Object.assign({ type: "number", inputmode: "numeric" }, attrs));
    const check = (label, key, onchange) => el("label", { class: "pxs-check" }, el("input", { type: "checkbox", "data-ui": key, checked: ui[key] ? true : null, onchange: e => { ui[key] = e.target.checked; renderOpts(); saveUi(); requestDraw(); if (onchange) onchange(); } }), label);
    function panelVisible(k) {
      if (location.hash !== "#art") return false;
      if (ui.phone) return ui.panel === k && root.classList.contains("pxs-open");
      return k === "colour" ? panelEls.colour.classList.contains("pxs-active") : (k in ui.open ? !!ui.open[k] : true);
    }
    const RENDER = { layers: renderLayers, palette: renderPalette, frames: renderFrames, preview: renderPreview, canvas: renderCanvas, file: renderFile, colour: syncColourPanel };
    function refreshPanels(only) {
      for (const k of Object.keys(RENDER)) { if (only && k !== only) continue; if (panelVisible(k)) { RENDER[k](panelBodies[k]); stale.delete(k); } else stale.add(k); }
    }
    const openObs = () => { for (const k of [...stale]) if (panelVisible(k)) { RENDER[k](panelBodies[k]); stale.delete(k); } };

    // layers: top to bottom (the model's array is bottom first)
    const layerThumbs = [];
    function drawLayerThumb(c, l) { const x = c.getContext("2d"); x.imageSmoothingEnabled = false; x.clearRect(0, 0, c.width, c.height); const sc = Math.min(c.width / doc.w, c.height / doc.h), w = doc.w * sc, h = doc.h * sc; if (doc.cels[l] && doc.cels[l][ui.frame]) x.drawImage(layerCanvas(l), (c.width - w) / 2, (c.height - h) / 2, w, h); }
    function refreshLayerThumbs() { if (!panelVisible("layers")) return; layerThumbs.forEach((c, l) => { if (c && c.isConnected && doc.layers[l]) drawLayerThumb(c, l); }); }
    function renderLayers(body) {
      body.textContent = ""; layerThumbs.length = 0;
      body.append(el("div", { class: "pxs-row pxs-tight" }, ib("plus", "Add layer", () => addLayer()), ib("dup", "Duplicate layer", () => dupLayer()), ib("trash", "Delete layer", () => delLayer()),
        ib("up", "Move layer up", () => moveLayer(1)), ib("down", "Move layer down", () => moveLayer(-1)), btn("Merge down", () => mergeDown()), btn("Flatten", () => flattenLayers())));
      const list = el("div", { class: "pxs-list", role: "list", "aria-label": "Layers, top first" });
      for (let l = doc.layers.length - 1; l >= 0; l--) {
        const L = doc.layers[l], th = el("canvas", { class: "pxs-lthumb", width: 32, height: 32 }); layerThumbs[l] = th; drawLayerThumb(th, l);
        const pc = Math.round(L.opacity / 255 * 100), op = el("input", { type: "range", min: 0, max: 100, value: pc, "aria-label": "Opacity of " + L.name + " in percent" }), out = el("output", { text: pc + "%" });
        op.addEventListener("input", () => { if (!op.dataset.before) { op.dataset.before = "1"; op._before = formats.cloneDoc(doc); } L.opacity = Math.round(op.value * 255 / 100); out.textContent = op.value + "%"; flatCache.clear(); onionCache.clear(); requestDraw(); });
        op.addEventListener("change", () => { const before = op._before; op._before = null; delete op.dataset.before; if (!before) return; const after = formats.cloneDoc(doc); push({ kind: "doc", before, after, bytes: docBytes(before) + docBytes(after), uiBefore: { layer: ui.layer, frame: ui.frame }, uiAfter: { layer: ui.layer, frame: ui.frame } }); changed(); });
        const nameB = el("button", { type: "button", class: "pxs-ib pxs-lname", "aria-label": "Layer " + L.name + (l === ui.layer ? ", active. Tap to rename it" : ". Tap to make it active"),
          onclick: e => { if (ui.layer === l) inlineEdit(e.currentTarget, L.name, v => { if (v && v !== L.name) setLayerProp(l, "name", v); }); else { ui.layer = l; refreshPanels("layers"); requestDraw(); } } },
          el("span", { text: L.name }), L.blend && L.blend !== "normal" ? el("span", { class: "pxs-dim", text: "(blend: " + L.blend + ")" }) : null);
        list.append(el("div", { class: "pxs-layer", role: "listitem", "aria-current": String(l === ui.layer) },
          ib(L.visible ? "eye" : "eyeOff", (L.visible ? "Hide " : "Show ") + L.name, () => setLayerProp(l, "visible", !L.visible)),
          ib(L.locked ? "lock" : "unlock", (L.locked ? "Unlock " : "Lock ") + L.name, () => setLayerProp(l, "locked", !L.locked)),
          th, nameB, el("label", { class: "pxs-lop" }, op, out)));
      }
      body.append(list);
    }

    // palette
    let palGrid = null;
    function refreshPaletteGrid() {
      if (!palGrid || !palGrid.isConnected) return; palGrid.textContent = "";
      doc.palette.forEach((hex, i) => { const b = sw("Colour " + (i + 1) + ", " + hex, () => pickPalette(i)); b.setAttribute("aria-pressed", String(i === ui.fgIndex)); paintSw(b, parseHex(hex) || [0, 0, 0, 255]); palGrid.append(b); });
    }
    function palOp(kind, colour) {
      const i = ui.fgIndex, hex = toHex(colour || ui.fg);
      if (kind === "add") { if (doc.palette.length >= 256) { say("A palette holds at most 256 colours."); return; } docStep(() => { doc.palette.push(hex); }); ui.fgIndex = doc.palette.length - 1; refreshColours(); return; }
      if (kind === "replace") { if (i < 0 || i >= doc.palette.length) { say("Tap a swatch to replace first."); return; } docStep(() => { doc.palette[i] = hex; }); ui.fgIndex = i; refreshColours(); return; }
      if (kind === "remove") { if (i < 0 || i >= doc.palette.length) { say("Tap a swatch to remove first."); return; } if (doc.palette.length < 2) { say("A palette keeps at least one colour."); return; } docStep(() => { doc.palette.splice(i, 1); }); ui.fgIndex = clamp(i, 0, doc.palette.length - 1); refreshColours(); return; }
      if (kind === "left" || kind === "right") { const j = i + (kind === "left" ? -1 : 1); if (i < 0 || j < 0 || j >= doc.palette.length) return; docStep(() => { [doc.palette[i], doc.palette[j]] = [doc.palette[j], doc.palette[i]]; }); ui.fgIndex = j; refreshColours(); return; }
      if (kind === "hue" || kind === "light") {
        const key = h => { const c = parseHex(h) || [0, 0, 0, 255]; if (kind === "light") return lightness(c); const [hh, s, v] = rgbToHsv(c[0], c[1], c[2]); return s < .08 ? 1000 + v * 100 : hh * 10 + v; };
        docStep(() => { doc.palette = doc.palette.slice().sort((a, b) => key(a) - key(b)); }); ui.fgIndex = doc.palette.indexOf(toHex(ui.fg)); refreshColours(); return;
      }
      if (kind === "board") { docStep(() => { doc.palette = boardPalette.slice(); }); ui.fgIndex = doc.palette.indexOf(toHex(ui.fg)); refreshColours(); say("The board's palette, " + doc.palette.length + " colours."); return; }
      if (kind === "sprite") {
        const seen = new Set(), cols = []; for (let f = 0; f < doc.frames.length && cols.length < 256; f++) for (const c of formats.uniqueColors(flatData(f), 256)) { if (!seen.has(c) && cols.length < 256) { seen.add(c); cols.push(c); } }
        if (!cols.length) { say("The sprite has no colours yet."); return; } docStep(() => { doc.palette = cols; }); ui.fgIndex = doc.palette.indexOf(toHex(ui.fg)); refreshColours(); say(cols.length + " colours from the sprite.");
      }
    }
    function renderPalette(body) {
      body.textContent = ""; palGrid = el("div", { class: "pxs-palgrid", role: "group", "aria-label": "Palette colours: tap one to draw with it" }); refreshPaletteGrid();
      body.append(palGrid,
        el("div", { class: "pxs-row" }, btn("Add FG", () => palOp("add")), btn("Replace selected", () => palOp("replace")), btn("Remove", () => palOp("remove")), el("span", { class: "pxs-sizes", role: "group", "aria-label": "Move the colour" }, ib("left", "Move the colour left", () => palOp("left")), ib("right", "Move the colour right", () => palOp("right")))),
        el("div", { class: "pxs-row" }, btn("Sort by hue", () => palOp("hue")), btn("Sort by lightness", () => palOp("light")), btn("The board's palette", () => palOp("board")), btn("From the sprite", () => palOp("sprite"))),
        el("div", { class: "pxs-h", text: "Import" }),
        el("div", { class: "pxs-row" }, el("input", { type: "file", accept: ".gpl,.pal,.act,.hex,.txt,.ase,.aseprite,.png", "aria-label": "Import a palette: GPL, JASC-PAL, ACT, HEX, Paint.NET TXT, an Aseprite file or a PNG", onchange: e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; importPaletteFile(f); } })),
        el("p", { class: "pxs-note", text: "Aseprite's own palette files (.gpl, .pal, .act, .hex), Paint.NET .txt, the palette of an .aseprite file, or every colour of a PNG." }),
        el("div", { class: "pxs-h", text: "Export" }), el("div", { class: "pxs-row" }, ...["gpl", "pal", "act", "hex", "png"].map(f => btn(f.toUpperCase(), () => exportPalette(f)))));
    }

    // frames, tags and the onion skin
    function renderFrames(body) {
      body.textContent = ""; const f = ui.frame, fr = doc.frames[f];
      const dur = numIn({ min: 1, max: 65535, value: fr.duration, "aria-label": "Duration of this frame in milliseconds", onchange: e => setDuration(e.target.value, false) });
      const tagsList = el("div", { class: "pxs-list", role: "list", "aria-label": "Tags" }), formHost = el("div");
      doc.tags.forEach((t, i) => {
        const playing = ui.playing && ui.playTag === i;
        tagsList.append(el("div", { class: "pxs-tag", role: "listitem", "aria-current": String(ui.playTag === i) }, el("i", { class: "pxs-tagc", style: "background:" + (parseHex(t.color) ? t.color : TAG_COLOURS[i % TAG_COLOURS.length]) }),
          el("div", { class: "pxs-ib pxs-lname" }, el("span", { text: t.name }), el("span", { class: "pxs-dim", text: (t.from + 1) + "–" + (t.to + 1) + " · " + (DIRS.find(d => d[0] === t.direction) || DIRS[0])[1] })),
          ib(playing ? "pause" : "play", playing ? "Pause" : "Play this tag", () => { if (playing) { ui.playing = false; refreshTimeline(); refreshPanels("frames"); } else togglePlay(i); }),
          btn("Edit", () => tagForm(i)), ib("trash", "Delete the tag " + t.name, () => docStep(() => { doc.tags.splice(i, 1); }))));
      });
      function tagForm(i) {
        const t = i == null ? { name: "tag " + (doc.tags.length + 1), from: ui.frame, to: ui.frame, direction: "forward", repeat: 0, color: TAG_COLOURS[doc.tags.length % TAG_COLOURS.length] } : doc.tags[i];
        const name = el("input", { type: "text", value: t.name, "aria-label": "Tag name" }), from = numIn({ min: 1, max: doc.frames.length, value: t.from + 1, "aria-label": "First frame" }), to = numIn({ min: 1, max: doc.frames.length, value: t.to + 1, "aria-label": "Last frame" });
        const dir = el("select", { "aria-label": "Direction" }, DIRS.map(([v, l]) => el("option", { value: v, text: l, selected: v === t.direction ? true : null })));
        formHost.replaceChildren(el("div", { class: "pxs-form" }, el("div", { class: "pxs-row" }, field("Name", name), field("From", from), field("To", to), field("Direction", dir)),
          el("div", { class: "pxs-row" }, btn(i == null ? "Add the tag" : "Save the tag", () => {
            const a = clamp(Math.round(num(from.value, 1)), 1, doc.frames.length) - 1, b = clamp(Math.round(num(to.value, 1)), 1, doc.frames.length) - 1;
            if (b < a) { say("The tag's last frame comes before its first."); return; }
            const nt = { name: name.value.trim() || t.name, from: a, to: b, direction: dir.value, repeat: t.repeat || 0, color: t.color || "#000000" };
            docStep(() => { if (i == null) doc.tags.push(nt); else doc.tags[i] = nt; });
          }, "pxs-primary"), btn("Cancel", () => formHost.textContent = ""))));
        name.focus();
      }
      const onionNum = (label, key) => field(label, numIn({ min: 0, max: 3, value: ui[key], "aria-label": label + " frames in the onion skin", onchange: e => { ui[key] = clamp(Math.round(num(e.target.value, 1)), 0, 3); e.target.value = ui[key]; saveUi(); requestDraw(); } }));
      const op = el("input", { type: "range", min: 5, max: 90, value: ui.onionAlpha, "aria-label": "Onion skin opacity" }); op.addEventListener("input", () => { ui.onionAlpha = +op.value; requestDraw(); }); op.addEventListener("change", saveUi);
      body.append(el("div", { class: "pxs-row" }, el("b", { text: "Frame " + (f + 1) + " of " + doc.frames.length }), field("Duration (ms)", dur), btn("Set all", () => setDuration(dur.value, true)), ib("left", "Move the frame left", () => moveFrame(-1)), ib("right", "Move the frame right", () => moveFrame(1))),
        el("div", { class: "pxs-h", text: "Tags" }), tagsList,
        el("div", { class: "pxs-row" }, btn("+ Add tag", () => tagForm(null)), ui.playTag != null ? btn("Play all frames", () => { ui.playTag = null; refreshPanels("frames"); }) : null), formHost,
        el("div", { class: "pxs-h", text: "Onion skin" }), el("div", { class: "pxs-row" }, check("On", "onion"), onionNum("Previous", "onionPrev"), onionNum("Next", "onionNext"), field("Opacity", op)));
    }

    // preview: the animation at a scale, and the tile laid out as the engine does
    let pvA = null, pvT = null; const pv = { frame: 0, last: 0, playDir: 1 };
    function renderPreview(body) {
      body.textContent = "";
      pvA = el("canvas", { class: "pxs-pv", "aria-label": "Animation preview" }); pvT = el("canvas", { class: "pxs-pv", "aria-label": "Tiled preview: the tile laid out as the engine does, to check its seams" });
      const sel = el("select", { "aria-label": "Preview scale" }, [[0, "fit"], [1, "1×"], [2, "2×"], [3, "3×"], [4, "4×"], [6, "6×"], [8, "8×"]].map(([v, t]) => el("option", { value: v, text: t, selected: ui.pvScale === v ? true : null })));
      sel.addEventListener("change", () => { ui.pvScale = +sel.value; saveUi(); });
      body.append(el("div", { class: "pxs-row" }, field("Scale", sel), el("span", { class: "pxs-note", text: "Plays every frame, or the tag that is playing." })), pvA,
        el("div", { class: "pxs-h", text: "Tiled, as the engine lays it out" }), pvT, el("p", { class: "pxs-note", text: "Look for seams: lines or colour jumps where copies meet. Fix them at the tile's edges." }));
      pv.frame = ui.frame; pv.last = 0;
    }
    function tickPreview(now) {
      if (!pvA || !pvA.isConnected || !panelVisible("preview")) return;
      const n = doc.frames.length; if (pv.frame >= n) pv.frame = 0;
      if (now - pv.last > Math.max(20, doc.frames[pv.frame].duration)) { pv.last = now; pv.frame = n > 1 ? stepFrame(pv.frame, ui.playTag != null ? doc.tags[ui.playTag] : null, pv) : 0; }
      const t = tokens(), d = Math.min(2, dpr()), cw = pvA.clientWidth || 280;
      if (cw <= 0) return;
      const ah = 180; if (pvA.width !== Math.round(cw * d) || pvA.height !== ah * d) { pvA.width = Math.round(cw * d); pvA.height = ah * d; pvA.style.height = ah + "px"; }
      const a = pvA.getContext("2d"); a.setTransform(d, 0, 0, d, 0, 0); a.imageSmoothingEnabled = false; a.fillStyle = t.sunk; a.fillRect(0, 0, cw, ah);
      const sc = ui.pvScale || Math.max(1, Math.floor(Math.min((cw - 16) / doc.w, (ah - 24) / doc.h))), fc = flatCanvas(pv.frame);
      a.drawImage(fc, Math.round((cw - doc.w * sc) / 2), Math.round((ah - 10 - doc.h * sc) / 2), doc.w * sc, doc.h * sc);
      a.fillStyle = t.muted; a.font = "11px " + t.mono; a.fillText("frame " + (pv.frame + 1) + "/" + n + " · " + sc + "×", 6, ah - 6);
      const th = 220; if (pvT.width !== Math.round(cw * d) || pvT.height !== th * d) { pvT.width = Math.round(cw * d); pvT.height = th * d; pvT.style.height = th + "px"; }
      const x = pvT.getContext("2d"); x.setTransform(d, 0, 0, d, 0, 0); drawTiled(x, cw, th, fc, doc.w, doc.h, presets[cur.template] || null, t);
    }

    // canvas: the sprite's size and shape, the template, the view's toggles
    const anchor = { x: .5, y: .5 };
    function renderCanvas(body) {
      body.textContent = "";
      const w = numIn({ min: 1, max: MAX, value: doc.w, "aria-label": "New width" }), h = numIn({ min: 1, max: MAX, value: doc.h, "aria-label": "New height" });
      const grid = el("div", { class: "pxs-anchor", role: "group", "aria-label": "Anchor: where the old pixels stay" });
      const anchors = []; for (const ay of [0, .5, 1]) for (const ax of [0, .5, 1]) { const b = el("button", { type: "button", "aria-label": "Anchor " + (ay === 0 ? "top" : ay === 1 ? "bottom" : "middle") + " " + (ax === 0 ? "left" : ax === 1 ? "right" : "centre"), "aria-pressed": String(anchor.x === ax && anchor.y === ay), onclick: () => { anchor.x = ax; anchor.y = ay; anchors.forEach(q => q.b.setAttribute("aria-pressed", String(q.ax === ax && q.ay === ay))); } }); anchors.push({ b, ax, ay }); grid.append(b); }
      const dx = numIn({ value: 0, "aria-label": "Shift right by" }), dy = numIn({ value: 0, "aria-label": "Shift down by" }), wrap = el("input", { type: "checkbox", checked: ui.wrap ? true : null, "data-ui": "wrap", onchange: e => { ui.wrap = e.target.checked; renderOpts(); saveUi(); } });
      const sameSize = presetKeys.filter(k => presets[k].w === doc.w && presets[k].h === doc.h);
      const tsel = el("select", { "aria-label": "Template guide" }, el("option", { value: "", text: "No template", selected: !cur.template ? true : null }), sameSize.map(k => el("option", { value: k, text: presets[k].label, selected: k === cur.template ? true : null })));
      tsel.addEventListener("change", () => { cur.template = tsel.value || null; maskCv = null; requestDraw(); scheduleSave(); });
      body.append(el("div", { class: "pxs-h", text: "Size" }),
        el("div", { class: "pxs-row" }, field("Width", w), field("Height", h), grid, btn("Resize", () => resizeCanvas(w.value, h.value, anchor.x, anchor.y), "pxs-primary")),
        el("div", { class: "pxs-row" }, btn("Scale ×2", () => scaleSprite(2)), btn("Scale ÷2", () => scaleSprite(.5)), btn("Crop to selection", () => cropToSel())),
        el("div", { class: "pxs-h", text: "Whole sprite (every frame and layer)" }),
        el("div", { class: "pxs-row" }, btn("Flip horizontal", () => flipSprite(true, false)), btn("Flip vertical", () => flipSprite(false, true)), btn("Rotate 90°", () => rotateSprite())),
        el("div", { class: "pxs-row" }, field("Shift x", dx), field("Shift y", dy), btn("Shift", () => shiftSprite(dx.value, dy.value, wrap.checked)), el("label", { class: "pxs-check" }, wrap, "Wrap round"),
          el("span", { class: "pxs-row pxs-tight", role: "group", "aria-label": "Shift by one pixel" }, ib("left", "Shift left by 1", () => shiftSprite(-1, 0, wrap.checked)), ib("right", "Shift right by 1", () => shiftSprite(1, 0, wrap.checked)), ib("up", "Shift up by 1", () => shiftSprite(0, -1, wrap.checked)), ib("down", "Shift down by 1", () => shiftSprite(0, 1, wrap.checked)))),
        el("div", { class: "pxs-h", text: "Template" }),
        el("div", { class: "pxs-row" }, field("Guide", tsel), btn("Guess from the size", () => { cur.template = guessTemplate(presets, doc.w, doc.h); maskCv = null; requestDraw(); refreshPanels("canvas"); say(cur.template ? "Template: " + presets[cur.template].label + "." : "No template is " + doc.w + " × " + doc.h + "."); }), btn("Clip to template", () => clipToTemplate()), btn("Clear…", () => askClear())),
        cur.template && presets[cur.template] ? el("p", { class: "pxs-note", text: presets[cur.template].note + (presets[cur.template].key ? " Art key: " + presets[cur.template].key + "." : "") }) : null,
        el("div", { class: "pxs-h", text: "Selection" }),
        el("div", { class: "pxs-row pxs-tight" }, ...SEL_ACTIONS.map(([ic, label, op]) => ib(ic, label, () => selOp(op)))),
        el("div", { class: "pxs-h", text: "Show" }),
        el("div", { class: "pxs-row" }, check("Grid", "grid"), check("Template guide", "guide"), check("Mirror X", "mirrorX"), check("Mirror Y", "mirrorY"), check("Pixel-perfect", "pixelPerfect"), check("Onion skin", "onion")));
    }

    // file: new, the sprites on this device, import, export
    let listHost = null;
    function renderFile(body) {
      body.textContent = "";
      const name = el("input", { type: "text", value: "", placeholder: "name", "aria-label": "Name of the new sprite" });
      const w = numIn({ min: 1, max: MAX, value: 32, "aria-label": "Width of the new sprite" }), h = numIn({ min: 1, max: MAX, value: 32, "aria-label": "Height of the new sprite" }), nf = numIn({ min: 1, max: 64, value: 1, "aria-label": "Frames of the new sprite" });
      const tsel = el("select", { "aria-label": "Template of the new sprite" }, presetKeys.map(k => el("option", { value: k, text: presets[k].label })), el("option", { value: "", text: "Custom size" }));
      const syncSize = () => { const P = presets[tsel.value]; w.disabled = h.disabled = !!P; if (P) { w.value = P.w; h.value = P.h; } }; tsel.addEventListener("change", syncSize); syncSize();
      listHost = el("div", { class: "pxs-list", role: "list", "aria-label": "Sprites saved on this device" });
      const fw = numIn({ min: 1, max: MAX, placeholder: "auto", "aria-label": "Frame width, to split a strip" }), fh = numIn({ min: 1, max: MAX, placeholder: "auto", "aria-label": "Frame height, to split a strip" });
      const imp = el("input", { type: "file", multiple: true, accept: ".aseprite,.ase,.png,.gif,.webp,.jpg,.jpeg,.json", "aria-label": "Import sprites: Aseprite files, images, or an image with its Aseprite sheet JSON", onchange: e => { const fs = [...(e.target.files || [])]; e.target.value = ""; importFiles(fs, num(fw.value, 0), num(fh.value, 0)); } });
      const lay = el("select", { "aria-label": "Sheet layout" }, [["row", "one row"], ["rows-by-tag", "a row a tag"], ["grid", "a grid of N columns"]].map(([v, t]) => el("option", { value: v, text: t })));
      const cols = numIn({ min: 1, max: 64, value: 8, "aria-label": "Columns of the sheet grid" }), pngScale = numIn({ min: 1, max: 16, value: 1, "aria-label": "Scale of the PNG" }), gifScale = numIn({ min: 1, max: 16, value: 1, "aria-label": "Scale of the GIF" });
      body.append(el("div", { class: "pxs-h", text: "New sprite" }),
        el("div", { class: "pxs-row" }, field("Name", name), field("Template", tsel), field("Width", w), field("Height", h), field("Frames", nf),
          btn("Create", () => { const n = Math.max(1, Math.round(num(nf.value, 1))); if (tsel.value) newFromTemplate(tsel.value, { frames: n, name: name.value.trim() }); else newCustom(num(w.value, 32), num(h.value, 32), n, name.value.trim()); }, "pxs-primary")),
        el("div", { class: "pxs-h", text: "Sprites on this device" }), listHost,
        el("div", { class: "pxs-h", text: "Import" }), el("div", { class: "pxs-row" }, imp), el("div", { class: "pxs-row" }, field("Frame width", fw), field("Frame height", fh), el("span", { class: "pxs-note", text: "For a strip: the size of one frame. Or choose the sheet's .json next to its PNG." })),
        el("div", { class: "pxs-h", text: "Export" }),
        el("div", { class: "pxs-row" }, btn("Save .aseprite", () => exportAse(), "pxs-primary")),
        el("div", { class: "pxs-row" }, field("Sheet", lay), field("Columns", cols), btn("PNG sheet + JSON", () => exportSheet(lay.value, num(cols.value, 8)))),
        el("div", { class: "pxs-row" }, field("Scale", pngScale), btn("PNG of this frame", () => exportFramePng(num(pngScale.value, 1))), field("Scale", gifScale), btn("GIF of the animation", () => exportGif(num(gifScale.value, 1)))),
        el("div", { class: "pxs-row" }, el("span", { class: "pxs-note", text: "Palette:" }), ...["gpl", "pal", "act", "hex", "png"].map(f => btn(f.toUpperCase(), () => exportPalette(f)))));
      refreshSpriteList();
    }
    async function refreshSpriteList() {
      const host = listHost; if (!host || !host.isConnected) return;
      const items = await storage.list(); if (host !== listHost || !host.isConnected) return; host.textContent = "";
      if (!items.length) { host.append(el("p", { class: "pxs-note", text: "No sprites saved on this device yet: the sprite you draw appears here." })); return; }
      for (const m of items) {
        const nameB = el("div", { class: "pxs-ib pxs-lname" }, el("span", { text: m.name }), el("span", { class: "pxs-dim", text: m.w + " × " + m.h + " · " + m.frames + (m.frames === 1 ? " frame" : " frames") }));
        const del = ib("trash", "Delete " + m.name, () => { if (!del.dataset.armed) { del.dataset.armed = "1"; del.style.color = "var(--hive)"; say("Tap the bin again to delete " + m.name + "."); setTimeout(() => { delete del.dataset.armed; del.style.color = ""; }, 4000); return; } delSaved(m); });
        host.append(el("div", { class: "pxs-sprite", role: "listitem", "aria-current": String(m.id === cur.id) }, m.thumb ? el("img", { src: m.thumb, alt: "", width: 40, height: 40 }) : el("span", { class: "pxs-lthumb" }), nameB,
          btn("Open", () => openSaved(m)), ib("pencil", "Rename " + m.name, () => inlineEdit(nameB, m.name, v => renameSaved(m, v))), ib("dup", "Duplicate " + m.name, () => dupSaved(m)), del));
      }
    }

    // the colour editor
    const ce = {};
    function buildColour(body) {
      const sl = (label, max, aria) => { const r = el("input", { type: "range", min: 0, max, step: 1, "aria-label": aria }), o = el("output"); return { r, o, row: el("label", { class: "pxs-slider" }, el("span", { text: label }), r, o) }; };
      Object.assign(ce, { prev: el("div", { class: "pxs-big" }, el("i"), el("b", { text: "" })), H: sl("H", 360, "Hue"), S: sl("S", 100, "Saturation"), V: sl("V", 100, "Value"), A: sl("A", 255, "Alpha"),
        hex: el("input", { type: "text", "aria-label": "Hex colour, #rrggbb or #rrggbbaa", spellcheck: "false", maxlength: 9 }), native: el("input", { type: "color", "aria-label": "The browser's colour picker" }),
        recent: el("div", { class: "pxs-recent", role: "group", "aria-label": "Recent colours" }), fgB: btn("Foreground", () => { ui.editTarget = "fg"; syncColourPanel(); }), bgB: btn("Background", () => { ui.editTarget = "bg"; syncColourPanel(); }), syncing: false });
      const apply = c => { if (ce.syncing) return; setColour(ui.editTarget, c); };
      const fromHsv = () => apply([...hsvToRgb(+ce.H.r.value, ce.S.r.value / 100, ce.V.r.value / 100), +ce.A.r.value]);
      for (const k of ["H", "S", "V", "A"]) ce[k].r.addEventListener("input", fromHsv);
      ce.hex.addEventListener("change", () => { const c = parseHex(ce.hex.value); if (c) apply(c); else say("A colour is written #rrggbb or #rrggbbaa."); });
      ce.native.addEventListener("input", () => { const c = parseHex(ce.native.value); if (c) apply([c[0], c[1], c[2], +ce.A.r.value]); });
      body.append(el("div", { class: "pxs-row pxs-tight", role: "group", "aria-label": "Which colour to edit" }, ce.fgB, ce.bgB), ce.prev, ce.H.row, ce.S.row, ce.V.row, ce.A.row,
        el("div", { class: "pxs-row" }, field("Hex", ce.hex), field("Picker", ce.native), btn("Transparent", () => apply([0, 0, 0, 0]))),
        el("div", { class: "pxs-h", text: "Recent" }), ce.recent,
        el("div", { class: "pxs-row" }, btn("Add to palette", () => palOp("add", ui[ui.editTarget])), btn("Replace selected swatch", () => palOp("replace", ui[ui.editTarget]))));
    }
    function syncColourPanel() {
      if (!ce.prev || !panelVisible("colour")) return; ce.syncing = true;
      const c = ui[ui.editTarget], [h, s, v] = rgbToHsv(c[0], c[1], c[2]);
      ce.prev.style.setProperty("--c", cssRgba(c)); ce.prev.querySelector("b").textContent = (ui.editTarget === "fg" ? "FG " : "BG ") + (c[3] ? toHex(c) : "transparent");
      if (s > 0 && v > 0) ce.H.r.value = Math.round(h); if (v > 0) ce.S.r.value = Math.round(s * 100); ce.V.r.value = Math.round(v * 100); ce.A.r.value = c[3];
      ce.H.o.textContent = ce.H.r.value + "°"; ce.S.o.textContent = ce.S.r.value + "%"; ce.V.o.textContent = ce.V.r.value + "%"; ce.A.o.textContent = Math.round(c[3] / 255 * 100) + "%";
      ce.hex.value = toHex(c); ce.native.value = toHex([c[0], c[1], c[2], 255]);
      ce.fgB.setAttribute("aria-pressed", String(ui.editTarget === "fg")); ce.bgB.setAttribute("aria-pressed", String(ui.editTarget === "bg"));
      ce.recent.textContent = ""; for (const hx of ui.recent) { const rc = parseHex(hx); if (!rc) continue; const b = sw("Recent colour " + hx, () => setColour(ui.editTarget, rc)); paintSw(b, rc); ce.recent.append(b); }
      ce.syncing = false;
    }
    function openColour(which) { ui.editTarget = which; openPanel("colour"); syncColourPanel(); }
    buildColour(panelBodies.colour);

    // ---- documents: new, open, and the sprites on the device ----
    const msg = e => (e && e.message) || String(e);
    function sanitize(d) {
      if (!d || typeof d !== "object") throw new Error("That is not a sprite.");
      d.w = clamp(Math.round(num(d.w, 1)), 1, MAX); d.h = clamp(Math.round(num(d.h, 1)), 1, MAX); d.name = safeName(d.name);
      if (!Array.isArray(d.layers) || !d.layers.length) d.layers = [newLayer("Layer 1")];
      d.layers.forEach((L, i) => { L.name = String(L.name || "Layer " + (i + 1)); L.visible = L.visible !== false; L.locked = !!L.locked; L.opacity = clamp(Math.round(num(L.opacity, 255)), 0, 255); L.blend = L.blend || "normal"; });
      if (!Array.isArray(d.frames) || !d.frames.length) d.frames = [{ duration: 100 }];
      d.frames.forEach(f => { f.duration = clamp(Math.round(num(f.duration, 100)), 1, 65535); });
      const n = d.w * d.h * 4, cels = Array.isArray(d.cels) ? d.cels : [];
      d.cels = d.layers.map((L, l) => d.frames.map((f, i) => { const c = cels[l] && cels[l][i]; if (!c || !c.data) return null; let data = asClamped(c.data); if (data.length !== n) { const fixed = new Uint8ClampedArray(n); fixed.set(data.subarray(0, Math.min(n, data.length))); data = fixed; } return { data, opacity: clamp(Math.round(num(c.opacity, 255)), 0, 255) }; }));
      d.tags = (Array.isArray(d.tags) ? d.tags : []).filter(t => t && typeof t === "object").map(t => { const from = clamp(t.from | 0, 0, d.frames.length - 1); return { name: String(t.name || "tag"), from, to: clamp(Math.max(t.to | 0, from), 0, d.frames.length - 1), direction: DIRS.some(x => x[0] === t.direction) ? t.direction : "forward", repeat: t.repeat | 0, color: parseHex(t.color) ? t.color : "#000000" }; });
      d.palette = (Array.isArray(d.palette) ? d.palette : []).map(String).filter(h => parseHex(h)).slice(0, 256); if (!d.palette.length) d.palette = boardPalette.slice();
      if (d.transparentIndex == null) d.transparentIndex = 0; if (!Array.isArray(d.warnings)) d.warnings = [];
    }
    function openDoc(d, o) {
      o = o || {}; sanitize(d);
      if (stroke) cancelStroke(); ui.float = null; ui.sel = null; ui.playing = false; ui.playTag = null;
      doc = d; cur = { id: o.id || null, template: o.template && presets[o.template] ? o.template : guessTemplate(presets, d.w, d.h), saved: !!o.id };
      hist.undo.length = 0; hist.redo.length = 0; hist.bytes = 0; updateUndo();
      ui.frame = 0; ui.layer = d.layers.length - 1; lcs.length = 0; lcsFrame = -1; markAll();
      ui.fgIndex = d.palette.findIndex(h => { const p = parseHex(h); return p && sameCol(p, ui.fg); });
      refreshTop(); refreshTimeline(); refreshColours(); refreshPanels(); refreshSelBar(); ui.fitted = false; fitZoom(); requestDraw();
      if (o.save) scheduleSave(); else setSaved(cur.saved ? "Saved" : "", false);
      if (d.warnings.length) say(d.warnings.join(" "), true); else if (o.message) say(o.message);
      hideStart();
      return doc;
    }
    function newFromTemplate(key, o) {
      o = o || {}; const k = presets[key] ? key : presetKeys[0], P = presets[k] || { w: 32, h: 32, shape: "free", label: "Sprite" };
      const d = formats.newDoc({ w: P.w, h: P.h, name: safeName(o.name || P.key || k || "sprite"), palette: boardPalette });
      if (P.seed) seedDoc(d, P.seed, P);
      const n = clamp(Math.round(num(o.frames, 1)), 1, 256);
      for (let i = 1; i < n; i++) { d.frames.push({ duration: 100 }); d.cels[0].push(celCopy(d.cels[0][0])); }
      return openDoc(d, { template: k, message: (P.label || "Sprite") + ": " + P.w + " × " + P.h + " px" + (n > 1 ? ", " + n + " frames" : "") + ". " + (P.note || "") });
    }
    function newCustom(w, h, n, name) {
      w = clamp(Math.round(num(w, 32)), 1, MAX); h = clamp(Math.round(num(h, 32)), 1, MAX); n = clamp(Math.round(num(n, 1)), 1, 256);
      const d = formats.newDoc({ w, h, name: safeName(name || "sprite"), palette: boardPalette });
      for (let i = 1; i < n; i++) { d.frames.push({ duration: 100 }); d.cels[0].push(null); }
      return openDoc(d, { message: "New sprite: " + w + " × " + h + " px" + (n > 1 ? ", " + n + " frames" : "") + "." });
    }
    async function flushSave() { if (savePending) { clearTimeout(saveT); savePending = false; await autosave(); } while (saveBusy) await new Promise(r => setTimeout(r, 40)); }
    async function openSaved(m) {
      try {
        await flushSave(); const bytes = await storage.load(m.id); if (!bytes) throw new Error("its data is missing on this device");
        const d = await formats.decodeAseprite(bytes, { name: m.name }); d.name = m.name || d.name;
        openDoc(d, { id: m.id, template: m.template, message: "Opened " + d.name + "." }); store.set("bs-studio-last", m.id); refreshSpriteList();
      } catch (e) { say("Could not open " + m.name + ": " + msg(e)); }
    }
    async function dupSaved(m) {
      try { await flushSave(); const bytes = await storage.load(m.id); if (!bytes) throw new Error("its data is missing on this device"); await storage.save(Object.assign({}, m, { id: newId(), name: m.name + " copy", updated: Date.now() }), bytes); refreshSpriteList(); say("Duplicated " + m.name + "."); }
      catch (e) { say("Could not duplicate " + m.name + ": " + msg(e)); }
    }
    async function renameSaved(m, v) {
      const n = safeName(v); if (!v || n === m.name) { refreshSpriteList(); return; }
      try { if (m.id === cur.id) { docStep(() => { doc.name = n; }); return; } const bytes = await storage.load(m.id); if (!bytes) throw new Error("its data is missing"); await storage.save(Object.assign({}, m, { name: n }), bytes); refreshSpriteList(); }
      catch (e) { say("Could not rename " + m.name + ": " + msg(e)); }
    }
    async function delSaved(m) {
      try { await storage.remove(m.id); if (m.id === cur.id) { cur.id = null; cur.saved = false; setSaved("", false); } if (store.get("bs-studio-last", null) === m.id) store.set("bs-studio-last", null); say("Deleted " + m.name + "."); refreshSpriteList(); }
      catch (e) { say("Could not delete " + m.name + ": " + msg(e)); }
    }

    // ---- import: Aseprite files, images (one frame, a strip by frame size, or a sheet with its Aseprite JSON) ----
    function readImage(file) {
      return new Promise((res, rej) => {
        const url = URL.createObjectURL(file), img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); try { const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0); res({ w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data }); } catch (e) { rej(e); } };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error(file.name + " is not an image this browser can open")); }; img.src = url;
      });
    }
    function docFromImage(img, name, sheet, fw, fh) {
      const { w, h, data } = img; let rects, durations = null, tags = [];
      if (sheet && sheet.frames) {
        const list = Array.isArray(sheet.frames) ? sheet.frames : Object.keys(sheet.frames).map(k => Object.assign({ filename: k }, sheet.frames[k]));
        const ok = list.filter(fr => fr && fr.frame && fr.frame.w > 0 && fr.frame.h > 0); if (!ok.length) throw new Error("the JSON has no frames in Aseprite's sheet format");
        rects = ok.map(fr => fr.frame); durations = ok.map(fr => clamp(Math.round(num(fr.duration, 100)), 1, 65535));
        tags = ((sheet.meta && sheet.meta.frameTags) || []).map(t => ({ name: String(t.name || "tag"), from: Math.max(0, t.from | 0), to: Math.max(0, t.to | 0), direction: DIRS.some(d => d[0] === t.direction) ? t.direction : "forward", repeat: 0, color: parseHex(t.color) ? t.color : "#000000" }));
      } else if (fw > 0 || fh > 0) {
        fw = Math.round(fw) || w; fh = Math.round(fh) || h; rects = [];
        for (let y = 0; y + fh <= h; y += fh) for (let x = 0; x + fw <= w; x += fw) rects.push({ x, y, w: fw, h: fh });
        if (!rects.length) throw new Error("the frame size " + fw + " × " + fh + " is bigger than the image (" + w + " × " + h + ")");
      } else rects = [{ x: 0, y: 0, w, h }];
      const FW = rects[0].w, FH = rects[0].h;
      if (FW > MAX || FH > MAX) throw new Error((rects.length > 1 ? "a frame" : "the image") + " is " + FW + " × " + FH + " px; the studio takes up to " + MAX + " × " + MAX + " (type a frame size to split it)");
      const d = formats.newDoc({ w: FW, h: FH, name: safeName(name), palette: boardPalette }); d.frames = []; d.cels[0] = [];
      rects.forEach((r, i) => {
        const cel = new Uint8ClampedArray(FW * FH * 4);
        for (let y = 0; y < Math.min(FH, r.h); y++) { const sy = r.y + y; if (sy < 0 || sy >= h) continue; for (let x = 0; x < Math.min(FW, r.w); x++) { const sx = r.x + x; if (sx < 0 || sx >= w) continue; cel.set(data.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * FW + x) * 4); } }
        d.frames.push({ duration: durations ? durations[i] : 100 }); d.cels[0].push({ data: cel, opacity: 255 });
      });
      d.tags = tags.filter(t => t.from < d.frames.length).map(t => Object.assign(t, { to: Math.min(t.to, d.frames.length - 1) }));
      const cols = formats.uniqueColors(data, 256); if (cols.length) d.palette = cols;
      return d;
    }
    async function importFiles(files, fw, fh) {
      if (!files.length) return;
      const jsons = files.filter(f => /\.json$/i.test(f.name)), ases = files.filter(f => /\.(ase|aseprite)$/i.test(f.name)), imgs = files.filter(f => !/\.(json|ase|aseprite)$/i.test(f.name));
      try {
        await flushSave(); const got = [];
        for (const f of ases) got.push({ d: await formats.decodeAseprite(new Uint8Array(await f.arrayBuffer()), { name: f.name.replace(/\.[^.]+$/, "") }), name: f.name });
        let sheet = null; if (jsons.length) { try { sheet = JSON.parse(await jsons[0].text()); } catch (e) { throw new Error(jsons[0].name + " is not JSON"); } }
        for (const f of imgs) { const d = docFromImage(await readImage(f), f.name.replace(/\.[^.]+$/, ""), sheet, fw, fh); if (/\.gif$/i.test(f.name) && d.frames.length === 1) d.warnings.push("Only the GIF's first frame is read; export a sheet from Aseprite for the rest."); got.push({ d, name: f.name }); }
        if (!got.length) { say("Choose an .aseprite file or an image" + (jsons.length ? " next to the JSON" : "") + "."); return; }
        for (const g of got.slice(0, -1)) { sanitize(g.d); await storage.save(metaOf(g.d, newId(), guessTemplate(presets, g.d.w, g.d.h)), await formats.encodeAseprite(g.d)); }
        const last = got[got.length - 1], d = last.d;
        openDoc(d, { save: true, message: "Imported " + last.name + (got.length > 1 ? " (and " + (got.length - 1) + " more, in Sprites on this device)" : "") + ": " + d.w + " × " + d.h + " px, " + d.frames.length + (d.frames.length === 1 ? " frame" : " frames") + (d.layers.length > 1 ? ", " + d.layers.length + " layers" : "") + "." });
        refreshSpriteList();
      } catch (e) { say("Could not import: " + msg(e)); }
    }
    async function importPaletteFile(file) {
      if (!file) return;
      try {
        let colors, from = file.name;
        if (/\.png$/i.test(file.name)) { const img = await readImage(file); colors = formats.uniqueColors(img.data, 256); if (!colors.length) throw new Error("No colours found in " + file.name); }
        else { const r = await formats.parsePalette(file.name, new Uint8Array(await file.arrayBuffer())); colors = r.colors; if (r.name) from = r.name; }
        docStep(() => { doc.palette = colors.slice(0, 256); }); pickPalette(0); say("Loaded " + colors.length + " colours from " + from + ".");
      } catch (e) { say(msg(e)); }
    }

    // ---- export, through the page's saveFile ----
    const toBlob = c => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("the PNG could not be made")), "image/png"));
    async function deliver(filename, blob) {
      try { const r = await saveFile({ filename, blob }); say(typeof r === "string" && r ? r : "Saved " + filename + "."); return true; }
      catch (e) { say(msg(e) || ("Could not save " + filename + ".")); return false; }
    }
    async function exportAse() { try { await deliver(safeName(doc.name) + ".aseprite", new Blob([await formats.encodeAseprite(doc)], { type: "application/octet-stream" })); } catch (e) { say("Could not export: " + msg(e)); } }
    async function exportSheet(mode, columns) {
      try {
        const lay = formats.sheetLayout(doc, { mode, columns: clamp(Math.round(num(columns, 8)), 1, 64), padding: 0 });
        const c = document.createElement("canvas"); c.width = lay.w; c.height = lay.h; const x = c.getContext("2d"); x.imageSmoothingEnabled = false;
        for (const f of lay.frames) x.drawImage(flatCanvas(f.index), f.x, f.y);
        const base = safeName(doc.name), png = base + "-sheet.png";
        if (await deliver(png, await toBlob(c))) await deliver(base + "-sheet.json", new Blob([JSON.stringify(formats.sheetJson(doc, lay, png), null, 2)], { type: "application/json" }));
      } catch (e) { say("Could not export the sheet: " + msg(e)); }
    }
    async function exportFramePng(scale) {
      try { scale = clamp(Math.round(num(scale, 1)), 1, 16); const c = document.createElement("canvas"); c.width = doc.w * scale; c.height = doc.h * scale; const x = c.getContext("2d"); x.imageSmoothingEnabled = false; x.drawImage(flatCanvas(ui.frame), 0, 0, c.width, c.height);
        await deliver(safeName(doc.name) + (doc.frames.length > 1 ? "-f" + (ui.frame + 1) : "") + (scale > 1 ? "@" + scale + "x" : "") + ".png", await toBlob(c)); }
      catch (e) { say("Could not export the PNG: " + msg(e)); }
    }
    async function exportGif(scale) {
      try { scale = clamp(Math.round(num(scale, 1)), 1, 16); const bytes = formats.encodeGif(doc.frames.map((fr, f) => ({ data: flatData(f), duration: fr.duration })), doc.w, doc.h, { scale, loop: 0 });
        await deliver(safeName(doc.name) + (scale > 1 ? "@" + scale + "x" : "") + ".gif", new Blob([bytes], { type: "image/gif" })); }
      catch (e) { say("Could not export the GIF: " + msg(e)); }
    }
    async function exportPalette(fmt) {
      try {
        if (fmt === "png") { const c = document.createElement("canvas"); c.width = doc.palette.length; c.height = 1; const x = c.getContext("2d"); doc.palette.forEach((h, i) => { x.fillStyle = cssRgba(parseHex(h) || [0, 0, 0, 255]); x.fillRect(i, 0, 1, 1); }); await deliver(safeName(doc.name) + "-palette.png", await toBlob(c)); return; }
        const r = formats.encodePalette(fmt, doc.palette, doc.name); await deliver(safeName(doc.name) + "." + (r.ext || fmt), new Blob([r.bytes], { type: r.mime || "application/octet-stream" }));
      } catch (e) { say("Could not export the palette: " + msg(e)); }
    }

    // ---- the keyboard (a desktop): only while the Art school shows and no text field has the focus ----
    function inField() { const a = document.activeElement; if (!a) return false; const t = a.tagName; if (t === "TEXTAREA" || t === "SELECT" || a.isContentEditable) return true; return t === "INPUT" && !["range", "checkbox", "radio", "button", "file"].includes(a.type); }
    const onKeyDown = e => {
      if (!doc || PS.active !== api || location.hash !== "#art" || inField()) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key, onCanvas = document.activeElement === cv;
      if (!modal.hidden) { if (k === "Escape") { e.preventDefault(); closeModal(); } return; }
      if (k === "Escape") { if (ui.full) { e.preventDefault(); setFull(false); } else if (ui.float) commitFloat(); else if (ui.sel) selOp("none"); else if (ui.phone && root.classList.contains("pxs-open")) closePanel(); return; }
      if (k === "Alt") { ui.alt = true; cv.classList.add("pxs-cur-pick"); return; }
      if (k === " ") { if (onCanvas) { e.preventDefault(); if (!e.repeat) { ui.space = true; ui.spaceUsed = false; cv.classList.add("pxs-cur-pan"); } } return; }
      if (mod) {
        const lk = k.toLowerCase();
        if (lk === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); } else if (lk === "y") { e.preventDefault(); redo(); }
        else if (lk === "a") { e.preventDefault(); selOp("all"); } else if (lk === "c" && ui.sel) { e.preventDefault(); selOp("copy"); } else if (lk === "x" && ui.sel) { e.preventDefault(); selOp("cut"); } else if (lk === "v" && ui.clip) { e.preventDefault(); selOp("paste"); }
        return;
      }
      if (e.altKey) return;
      const tool = { b: "pencil", e: "eraser", g: "fill", l: "line", u: "rect", o: "ellipse", m: "select", v: "move", i: "pick", h: "pan" }[k.toLowerCase()];
      if (tool) { e.preventDefault(); setTool(tool); return; }
      if (k === "x" || k === "X") { swapColours(); return; }
      if (k === "[" || k === "]") { ui.size = clamp(ui.size + (k === "]" ? 1 : -1), 1, 4); renderOpts(); saveUi(); requestDraw(); return; }
      if (/^[1-9]$/.test(k)) { if (doc.palette[+k - 1]) pickPalette(+k - 1); return; }
      if (k === ",") { setFrame(ui.frame > 0 ? ui.frame - 1 : doc.frames.length - 1); return; }
      if (k === ".") { setFrame((ui.frame + 1) % doc.frames.length); return; }
      if (k === "Enter") { if (ui.float) { e.preventDefault(); commitFloat(); } else if (onCanvas) { e.preventDefault(); togglePlay(); } return; }
      if (k === "Delete" || k === "Backspace") { if (ui.sel) { e.preventDefault(); selOp("delete"); } return; }
      if (k === "+" || k === "=") { zoomStep(1); return; } if (k === "-" || k === "_") { zoomStep(-1); return; } if (k === "0") { fitZoom(); }
    };
    document.addEventListener("keydown", onKeyDown);
    const onKeyUp = e => {
      if (PS.active !== api) return;
      if (e.key === "Alt") { ui.alt = false; if (ui.tool !== "pick") cv.classList.remove("pxs-cur-pick"); }
      if (e.key === " " && ui.space) { ui.space = false; if (ui.tool !== "pan") cv.classList.remove("pxs-cur-pan"); if (!ui.spaceUsed && doc && location.hash === "#art" && document.activeElement === cv) togglePlay(); }
    };
    document.addEventListener("keyup", onKeyUp);

    // ---- layout: phone or desktop by the host's width, the sheet's offset, the canvas's size ----
    function measureBars() { root.style.setProperty("--pxs-bars", (colours.offsetHeight + tools.offsetHeight + optsBar.offsetHeight + time.offsetHeight + tabs.offsetHeight + status.offsetHeight) + "px"); }
    function onResize() {
      const W = root.clientWidth; if (!W) return; const phone = W < PHONE;
      if (phone !== ui.phone) { ui.phone = phone; root.classList.toggle("pxs-phone", phone); root.classList.toggle("pxs-desk", !phone); closePanel(); refreshPanels(); }
      if (phone) measureBars();
      if (!startEl.hidden) startEl.style.top = top.offsetHeight + "px";
      if (layout()) { if (!ui.fitted) fitZoom(); else clampPan(); requestDraw(); }
    }
    ui.phone = null;
    let ro = null, dead = false;
    try { ro = new ResizeObserver(() => onResize()); ro.observe(root); ro.observe(view); } catch (e) { window.addEventListener("resize", onResize); }
    const onHash = () => { if (location.hash === "#art") setTimeout(() => { onResize(); openObs(); refreshPanels(); }, 0); };
    window.addEventListener("hashchange", onHash);
    const onScheme = () => { tokAt = -1e9; requestDraw(); }; let mq = null;
    try { mq = matchMedia("(prefers-color-scheme: dark)"); mq.addEventListener("change", onScheme); } catch (e) {}
    function loop(now) { if (dead) return; requestAnimationFrame(loop); if (!doc || location.hash !== "#art") return; tickPlay(now); tickPreview(now); if (drawQueued) draw(); }
    // the keyboard goes to one studio: the last one touched or focused (a fresh studio over the page takes it as it opens)
    root.addEventListener("pointerdown", () => { PS.active = api; }, true); root.addEventListener("focusin", () => { PS.active = api; });
    // a fresh studio closing: its pending save goes out, its listeners and loop stop, its element leaves the page
    function destroy() {
      dead = true; if (savePending) { clearTimeout(saveT); savePending = false; autosave(); }
      try { if (ro) ro.disconnect(); } catch (e) {} window.removeEventListener("resize", onResize); window.removeEventListener("hashchange", onHash); try { if (mq) mq.removeEventListener("change", onScheme); } catch (e) {}
      document.removeEventListener("keydown", onKeyDown); document.removeEventListener("keyup", onKeyUp); document.removeEventListener("fullscreenchange", onFsChange);
      if (ui.full) { document.body.style.overflow = ""; if (nativeFs) { nativeFs = false; try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch (e) {} } }
      root.remove(); if (PS.api === api) PS.api = null; if (PS.active === api) PS.active = null;
    }
    requestAnimationFrame(loop);
    setTool(ui.tool); refreshSelBar(); updateUndo();
    for (const k of ["frames", "canvas", "file"]) applyOpen(k);

    // ---- the api, and the first document ----
    const api = {
      newFromTemplate: (key, o) => newFromTemplate(key, o), openDoc: (d, o) => openDoc(d, o), getDoc: () => doc, exportBytes: () => formats.encodeAseprite(doc),
      scrollIntoView: () => { const hdr = document.querySelector("header.top"), off = hdr && /sticky|fixed/.test(getComputedStyle(hdr).position) ? hdr.offsetHeight : 0; try { window.scrollTo({ top: window.scrollY + host.getBoundingClientRect().top - off - 6, behavior: "smooth" }); } catch (e) { host.scrollIntoView(); } },
      getView: () => ({ zoom: ui.zoom, panX: ui.panX, panY: ui.panY, frame: ui.frame, layer: ui.layer, tool: ui.tool, panel: ui.panel, phone: ui.phone, full: ui.full, sel: ui.sel ? Object.assign({}, ui.sel) : null, template: cur.template, id: cur.id, playing: ui.playing }),
      undo: () => undo(), redo: () => redo(), root,
      newCustom: (w, h, n, name) => newCustom(w, h, n, name), showStart: () => showStart(), isStart: () => !startEl.hidden, destroy: () => destroy(),
      askClear: () => askClear(), clear: scope => clearScope(scope)
    };
    PS.api = api; PS.active = api;
    async function migrateOldDraft() {
      const d = store.get("bs-art-studio", null); if (!d || !d.w || !d.h || !Array.isArray(d.frames) || !d.frames.length) return null;
      try {
        const w = clamp(d.w | 0, 1, MAX), h = clamp(d.h | 0, 1, MAX), P = presets[d.preset];
        const dd = formats.newDoc({ w, h, name: safeName((P && P.key) || d.preset || "draft"), palette: boardPalette });
        dd.frames = d.frames.map(() => ({ duration: Math.round(1000 / clamp(num(d.fps, 8), 1, 60)) }));
        dd.cels[0] = d.frames.map(f => { const data = new Uint8ClampedArray(w * h * 4); if (Array.isArray(f)) f.forEach((c, i) => { const rgba = c && parseHex(c); if (rgba && i < w * h) data.set(rgba, i * 4); }); return { data, opacity: 255 }; });
        const id = newId();
        if (await storage.save(metaOf(dd, id, P ? d.preset : guessTemplate(presets, w, h)), await formats.encodeAseprite(dd))) { try { localStorage.removeItem("bs-art-studio"); } catch (e) {} return id; }
      } catch (e) {}
      return null;
    }
    async function init() {
      newFromTemplate(presetKeys[0], { frames: 1 }); say("");
      if (startMode) { if (onClose) setFull(true); showStart(); root.dataset.ready = "1"; return; }
      try {
        const migrated = await migrateOldDraft(), last = store.get("bs-studio-last", null) || migrated;
        if (last) {
          const items = await storage.list(), m = items.find(x => x.id === last) || (migrated ? items.find(x => x.id === migrated) : null), bytes = m ? await storage.load(m.id) : null;
          if (m && bytes) {
            const d = await formats.decodeAseprite(bytes, { name: m.name }); d.name = m.name || d.name;
            if (uiSaved.zoom > 0 && uiSaved.zoomFor === d.w + "x" + d.h) ui.restoreZoom = clamp(uiSaved.zoom, 0.25, 64);   // the zoom of the last visit, once the view has a size
            openDoc(d, { id: m.id, template: m.template, message: migrated === m.id ? "Your earlier drawing was moved into the new studio." : "" });
          }
        }
      } catch (e) { say("Could not reopen the last sprite: " + msg(e)); }
      root.dataset.ready = "1";
    }
    init();
    return api;
  }
  // A fresh studio over the whole page, from the start screen (a new sprite with its width and height, an import, or a
  // saved sprite); its Close removes it and the page's own studio carries on where it was.
  function open(opts) {
    const host = document.createElement("div"); host.className = "pxs-overlay"; document.body.append(host);
    const was = PS.active, wasApi = PS.api, back = document.activeElement; let api = null;
    api = mount(host, Object.assign({}, opts, { start: true, onClose: () => {
      if (!api) return; const a = api; api = null; a.destroy(); host.remove(); PS.active = was; PS.api = wasApi;
      if (was && was.root && was.root.isConnected && was.getView().full) document.body.style.overflow = "hidden";
      try { if (back && back.focus && back.isConnected) back.focus({ preventScroll: true }); } catch (e) {}
    } }));
    return api;
  }
  const PS = { mount, open, api: null, active: null };
  return PS;
})();
