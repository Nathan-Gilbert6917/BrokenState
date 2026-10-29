// The file formats of the pixel studio (board/src/studio.js), with no DOM and no canvas: the .aseprite file read and
// written, the palette files Aseprite reads and writes (.gpl, .pal, .act, .hex, Paint.NET .txt), the sprite-sheet
// layout with its JSON, and an animated GIF. build.js inlines it first into the board's page, where it sets
// window.AseFormats; board/tools/formats-test.js requires it in Node, where it is module.exports.
// The document model, shared with studio.js (a plain object):
//   { name, w, h (1..256), layers: [{ name, visible, locked, opacity, blend }] (index 0 is the bottom layer),
//     frames: [{ duration }] (ms), cels: [per layer [per frame { data: Uint8ClampedArray w*h*4 RGBA, straight alpha,
//     opacity } | null]], tags: [{ name, from, to, direction, repeat, color }], palette: ["#rrggbb[aa]"...],
//     transparentIndex, warnings: [] }
// The .aseprite format follows aseprite/docs/ase-file-specs.md: everything little-endian, a 128-byte header, then one
// block a frame made of chunks (DWORD size with the 6-byte chunk header, WORD type, data). Compressed cels are zlib
// streams, which CompressionStream / DecompressionStream("deflate") produce and read in browsers and in Node 22. No
// host global is touched at load time, so the file evaluates anywhere.
(function () {
  "use strict";
  const BLEND = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color_dodge", "color_burn", "hard_light",
    "soft_light", "difference", "exclusion", "hsl_hue", "hsl_saturation", "hsl_color", "hsl_luminosity", "addition", "subtract", "divide"];
  const DIRECTIONS = ["forward", "reverse", "pingpong", "pingpong-reverse"];
  const DEFAULT_PALETTE = ["#000000", "#ffffff"];
  const MAX_SIDE = 256, APP = "Broken State pixel studio";
  const int = (v, lo, hi, dflt) => { v = v == null ? NaN : Math.round(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt; };
  const hex2 = n => int(n, 0, 255, 0).toString(16).padStart(2, "0");
  const ascii = s => Uint8Array.from(s, c => c.charCodeAt(0));
  const utf8 = s => new TextEncoder().encode(String(s));
  const text = b => new TextDecoder().decode(b);

  // ---------- colours ----------
  function rgbaToHex(r, g, b, a) { const s = "#" + hex2(r) + hex2(g) + hex2(b); return a === undefined || a >= 255 ? s : s + hex2(a); }
  function hexToRgba(hex) {
    let s = String(hex || "").trim().replace(/^(#|0x)/i, "");
    if (s.length === 3 || s.length === 4) s = s.replace(/./g, c => c + c);
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return [0, 0, 0, 0];
    const n = parseInt(s.slice(0, 6), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255, s.length === 8 ? parseInt(s.slice(6), 16) : 255];
  }
  // The distinct colours of RGBA data in reading order, fully transparent pixels skipped, at most `max`.
  function uniqueColors(data, max = 256) {
    const seen = new Set(), out = [];
    for (let i = 0; i + 3 < data.length && out.length < max; i += 4) {
      const a = data[i + 3]; if (!a) continue;
      const k = (data[i] << 24 | data[i + 1] << 16 | data[i + 2] << 8 | a) >>> 0;
      if (!seen.has(k)) { seen.add(k); out.push(rgbaToHex(data[i], data[i + 1], data[i + 2], a)); }
    }
    return out;
  }

  // ---------- the document ----------
  function newDoc(opts = {}) {
    const w = int(opts.w, 1, MAX_SIDE, 32), h = int(opts.h, 1, MAX_SIDE, 32);
    const palette = Array.isArray(opts.palette) && opts.palette.length ? opts.palette.slice(0, 256) : DEFAULT_PALETTE.slice();
    return { name: opts.name || "sprite", w, h, layers: [{ name: "Layer 1", visible: true, locked: false, opacity: 255, blend: "normal" }],
      frames: [{ duration: 100 }], cels: [[{ data: new Uint8ClampedArray(w * h * 4), opacity: 255 }]], tags: [], palette, transparentIndex: 0, warnings: [] };
  }
  function cloneDoc(doc) {
    return { ...doc, layers: doc.layers.map(l => ({ ...l })), frames: doc.frames.map(f => ({ ...f })),
      cels: doc.cels.map(row => row.map(c => c ? { ...c, data: new Uint8ClampedArray(c.data) } : null)),
      tags: (doc.tags || []).map(t => ({ ...t })), palette: (doc.palette || []).slice(), warnings: (doc.warnings || []).slice() };
  }
  // Source-over in integer maths with straight alpha: the result's alpha is the union of the two, its colour the mean
  // of the two weighted by what each contributes (not premultiplied). alphaScale (0..255) scales the source's alpha.
  function blit(dst, src, w, h, alphaScale) {
    if (alphaScale == null) alphaScale = 255;
    const n = w * h * 4;
    for (let i = 0; i < n; i += 4) {
      const sa = alphaScale >= 255 ? src[i + 3] : (src[i + 3] * alphaScale + 127) / 255 | 0;
      if (sa === 0) continue;
      const da = dst[i + 3];
      if (sa === 255 || da === 0) { dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2]; dst[i + 3] = sa; continue; }
      const db = (da * (255 - sa) + 127) / 255 | 0, oa = sa + db, half = oa >> 1;
      dst[i] = (src[i] * sa + dst[i] * db + half) / oa | 0;
      dst[i + 1] = (src[i + 1] * sa + dst[i + 1] * db + half) / oa | 0;
      dst[i + 2] = (src[i + 2] * sa + dst[i + 2] * db + half) / oa | 0;
      dst[i + 3] = oa;
    }
    return dst;
  }
  // One frame flattened: the visible layers bottom to top (or exactly `layers`, for onion skins), normal blend, the
  // layer's and the cel's opacity multiplied. Other blend modes are drawn as normal.
  function flatten(doc, frame = 0, opts) {
    const out = new Uint8ClampedArray(doc.w * doc.h * 4);
    const only = opts && opts.layers ? new Set(opts.layers) : null;
    doc.layers.forEach((layer, l) => {
      if (only ? !only.has(l) : layer.visible === false) return;
      const cel = doc.cels[l] && doc.cels[l][frame]; if (!cel) return;
      const scale = ((layer.opacity ?? 255) * (cel.opacity ?? 255) + 127) / 255 | 0;
      if (scale > 0) blit(out, cel.data, doc.w, doc.h, scale);
    });
    return out;
  }

  // ---------- bytes ----------
  // A growable little-endian byte builder and a bounds-checked reader.
  function writer(size = 1024) {
    let buf = new Uint8Array(size), dv = new DataView(buf.buffer), pos = 0;
    const need = n => { if (pos + n <= buf.length) return; let len = buf.length * 2; while (len < pos + n) len *= 2; const b = new Uint8Array(len); b.set(buf); buf = b; dv = new DataView(b.buffer); };
    const w = {
      get pos() { return pos; },
      u8(v) { need(1); buf[pos++] = v; }, u16(v) { need(2); dv.setUint16(pos, v, true); pos += 2; },
      i16(v) { need(2); dv.setInt16(pos, v, true); pos += 2; }, u32(v) { need(4); dv.setUint32(pos, v, true); pos += 4; },
      bytes(b) { need(b.length); buf.set(b, pos); pos += b.length; }, zeros(n) { need(n); pos += n; },
      str(s) { const b = utf8(s); w.u16(b.length); w.bytes(b); },
      patch32(at, v) { dv.setUint32(at, v, true); }, done() { return buf.slice(0, pos); },
    };
    return w;
  }
  function reader(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const r = { pos: 0,
      need(n) { if (r.pos + n > bytes.length) throw new Error("Truncated file"); },
      u8() { r.need(1); return bytes[r.pos++]; }, u16() { r.need(2); const v = dv.getUint16(r.pos, true); r.pos += 2; return v; },
      i16() { r.need(2); const v = dv.getInt16(r.pos, true); r.pos += 2; return v; }, u32() { r.need(4); const v = dv.getUint32(r.pos, true); r.pos += 4; return v; },
      bytes(n) { r.need(n); const b = bytes.subarray(r.pos, r.pos + n); r.pos += n; return b; }, skip(n) { r.need(n); r.pos += n; },
      str() { return text(r.bytes(r.u16())); } };
    return r;
  }
  // zlib through the streams API. The write is left pending while the output is drained, then awaited, so a big cel
  // never deadlocks on a full pipe.
  async function pump(stream, input) {
    const wr = stream.writable.getWriter(), done = wr.write(input).then(() => wr.close()).catch(() => {});
    const rd = stream.readable.getReader(), parts = []; let total = 0;
    for (;;) { const { value, done: end } = await rd.read(); if (end) break; parts.push(value); total += value.length; }
    await done;
    const out = new Uint8Array(total); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }
  const canDeflate = () => typeof CompressionStream !== "undefined";
  const deflate = bytes => pump(new CompressionStream("deflate"), bytes);
  async function inflate(bytes) {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot read compressed Aseprite files (no DecompressionStream)");
    try { return await pump(new DecompressionStream("deflate"), bytes); } catch (e) { throw new Error("Corrupt compressed cel (" + ((e && e.message) || e) + ")"); }
  }
  const isAse = b => b.length >= 128 && b[4] === 0xE0 && b[5] === 0xA5;

  // ---------- .aseprite in ----------
  async function decodeAseprite(input, opts = {}) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!isAse(bytes)) throw new Error("Not an Aseprite file");
    const r = reader(bytes);
    r.skip(6);  // file size, magic
    const nFrames = r.u16(), w = r.u16(), h = r.u16(), depth = r.u16(), flags = r.u32();
    r.skip(10);  // speed (deprecated), two reserved DWORDs
    const transparentIndex = r.u8(); r.pos = 128;
    if (!w || !h || !nFrames) throw new Error("Not an Aseprite file (an empty sprite)");
    if (w > MAX_SIDE || h > MAX_SIDE) throw new Error("The sprite is " + w + "×" + h + " pixels; the studio takes up to " + MAX_SIDE + "×" + MAX_SIDE);
    if (depth !== 32 && depth !== 16 && depth !== 8) throw new Error("Unknown colour depth " + depth);
    const bpp = depth / 8;
    const doc = { name: opts.name || "sprite", w, h, layers: [], frames: [], cels: [], tags: [], palette: [], transparentIndex, warnings: [] };
    const warn = s => { if (!doc.warnings.includes(s)) doc.warnings.push(s); };
    const fileLayers = [];   // every layer chunk, groups included: a cel's layer index counts them all
    const groups = [];       // the group open at each child level, for the effective visibility
    const pal = [];          // [r, g, b, a] by index
    const raw = [];          // the cels as read, converted once the layers and the palette are complete
    let sawNewPalette = false, lastTags = null, tagCursor = 0;
    for (let f = 0; f < nFrames; f++) {
      const start = r.pos, size = r.u32();
      if (r.u16() !== 0xF1FA) throw new Error("Not an Aseprite file (bad frame header)");
      const oldCount = r.u16(), duration = r.u16(); r.skip(2); const newCount = r.u32();
      const count = newCount || oldCount;
      doc.frames.push({ duration: duration || 100 });
      for (let c = 0; c < count; c++) {
        const cStart = r.pos, cSize = r.u32(), type = r.u16(), cEnd = cStart + cSize;
        if (cSize < 6 || cEnd > bytes.length) throw new Error("Truncated file");
        if (type !== 0x2020 && type !== 0x2018) lastTags = null;  // the user data after a tags chunk is the tags' own
        if (type === 0x2004) {
          const lf = r.u16(), lt = r.u16(), level = r.u16(); r.skip(4); const blend = r.u16(), op = r.u8(); r.skip(3); const name = r.str();
          const parent = level > 0 ? groups[level - 1] : null;
          const L = { visible: !!(lf & 1) && (!parent || parent.visible), background: !!(lf & 8), model: -1 };
          groups.length = level;
          if (lt === 1) groups[level] = L;
          else if (lt === 2) warn("Tilemap layer “" + name + "” skipped: the studio has no tilemaps");
          else {
            L.model = doc.layers.length;
            doc.layers.push({ name, visible: L.visible, locked: !(lf & 2), opacity: flags & 1 ? op : 255, blend: BLEND[blend] || "normal" });
            if (blend > 0) warn("Layer “" + name + "” uses the " + (BLEND[blend] || blend) + " blend mode, which the studio draws as normal");
          }
          fileLayers.push(L);
        } else if (type === 0x2005) {
          const li = r.u16(), x = r.i16(), y = r.i16(), opacity = r.u8(), ct = r.u16(); r.skip(7);  // z-index, 5 reserved bytes
          if (ct === 1) raw.push({ li, f, link: r.u16(), opacity });
          else if (ct === 0 || ct === 2) {
            const cw = r.u16(), ch = r.u16();
            const px = ct === 0 ? r.bytes(cw * ch * bpp) : await inflate(r.bytes(cEnd - r.pos));
            if (px.length < cw * ch * bpp) throw new Error("Truncated file");
            raw.push({ li, f, x, y, cw, ch, px, opacity });
          }  // type 3 is a tilemap cel: its layer already carries the warning
        } else if (type === 0x0004 || type === 0x0011) {
          // The old palette chunks, ignored once a new one has been seen; 0x0011 holds 6-bit values.
          if (!sawNewPalette) {
            const packets = r.u16(); let i = 0;
            for (let p = 0; p < packets; p++) { i += r.u8(); let n = r.u8() || 256; while (n--) { const c = [r.u8(), r.u8(), r.u8(), 255]; if (type === 0x0011) for (let k = 0; k < 3; k++) c[k] = (c[k] << 2) | (c[k] >> 4); pal[i++] = c; } }
          }
        } else if (type === 0x2019) {
          sawNewPalette = true;
          const n = r.u32(), first = r.u32(), last = r.u32(); r.skip(8);
          pal.length = Math.min(n, 65536);
          for (let i = first; i <= last; i++) { const fl = r.u16(); pal[i] = [r.u8(), r.u8(), r.u8(), r.u8()]; if (fl & 1) r.str(); }
        } else if (type === 0x2018) {
          const n = r.u16(); r.skip(8); lastTags = []; tagCursor = 0;
          for (let i = 0; i < n; i++) {
            const from = r.u16(), to = r.u16(), dir = r.u8(), repeat = r.u16(); r.skip(6); const color = rgbaToHex(r.u8(), r.u8(), r.u8()); r.skip(1);
            const t = { name: r.str(), from: Math.min(from, nFrames - 1), to: Math.min(Math.max(from, to), nFrames - 1), direction: DIRECTIONS[dir] || "forward", repeat, color };
            doc.tags.push(t); lastTags.push(t);
          }
        } else if (type === 0x2020 && lastTags && tagCursor < lastTags.length) {
          const fl = r.u32(); if (fl & 1) r.str();
          if (fl & 2) lastTags[tagCursor].color = rgbaToHex(r.u8(), r.u8(), r.u8());
          tagCursor++;
        } else if (type === 0x2022) warn("Slices are not kept");
        r.pos = cEnd;  // trailing bytes, unknown chunks, user data, colour profiles, external files, tilesets
      }
      if (size < 16 || start + size > bytes.length) throw new Error("Truncated file");
      r.pos = start + size;
    }
    if (pal.length > 256) warn("The palette has " + pal.length + " colours; the studio keeps the first 256");
    doc.palette = pal.length ? pal.slice(0, 256).map(c => rgbaToHex(...(c || [0, 0, 0, 255]))) : DEFAULT_PALETTE.slice();
    // The cels: each into a full-canvas RGBA buffer, clipped to the canvas, a linked cel a copy of its target.
    const toCanvas = c => {
      const out = new Uint8ClampedArray(w * h * 4);
      const x0 = Math.max(0, c.x), y0 = Math.max(0, c.y), x1 = Math.min(w, c.x + c.cw), y1 = Math.min(h, c.y + c.ch);
      if (x0 >= x1 || y0 >= y1) return null;
      const background = fileLayers[c.li].background;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const s = ((y - c.y) * c.cw + (x - c.x)) * bpp, d = (y * w + x) * 4;
        if (bpp === 4) { out[d] = c.px[s]; out[d + 1] = c.px[s + 1]; out[d + 2] = c.px[s + 2]; out[d + 3] = c.px[s + 3]; }
        else if (bpp === 2) { out[d] = out[d + 1] = out[d + 2] = c.px[s]; out[d + 3] = c.px[s + 1]; }
        else { const i = c.px[s]; if (!background && i === transparentIndex) continue; const col = pal[i] || [0, 0, 0, 255]; out[d] = col[0]; out[d + 1] = col[1]; out[d + 2] = col[2]; out[d + 3] = col[3]; }
      }
      return out;
    };
    doc.cels = doc.layers.map(() => doc.frames.map(() => null));
    const byKey = new Map(raw.map(c => [c.li + ":" + c.f, c]));
    for (const c of raw) {
      const L = fileLayers[c.li]; if (!L || L.model < 0) continue;  // a cel on a group or a tilemap layer, or a stray one
      let src = c, hops = 0; while (src && src.link !== undefined && hops++ < 64) src = byKey.get(src.li + ":" + src.link);
      if (!src || src.link !== undefined) continue;
      if (!("data" in src)) src.data = toCanvas(src);
      doc.cels[L.model][c.f] = src.data ? { data: src === c ? src.data : new Uint8ClampedArray(src.data), opacity: c.opacity } : null;
    }
    return doc;
  }

  // ---------- .aseprite out ----------
  // The bounding box of the opaque pixels, and that box cut out of a full-canvas cel.
  function trim(data, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function crop(data, w, t) {
    const out = new Uint8Array(t.w * t.h * 4);
    for (let y = 0; y < t.h; y++) { const at = ((t.y + y) * w + t.x) * 4; out.set(data.subarray(at, at + t.w * 4), y * t.w * 4); }
    return out;
  }
  // What Aseprite writes: the header, then frame 0 with the colour profile, the palette (the old chunk too when
  // every colour is opaque), the layers, the tags and the cels; every later frame its cels only. Always RGBA, every
  // non-empty cel trimmed to its opaque box, an empty cel left out, linked cels never.
  async function encodeAseprite(doc, opts = {}) {
    const compress = opts.compress !== false && canDeflate(), W = doc.w, H = doc.h;
    const palette = (doc.palette && doc.palette.length ? doc.palette : DEFAULT_PALETTE).slice(0, 256).map(hexToRgba);
    const opaque = palette.every(c => c[3] === 255);
    const out = writer(4096);
    const chunk = (type, body) => { const at = out.pos; out.u32(0); out.u16(type); body(); out.patch32(at, out.pos - at); };
    out.u32(0); out.u16(0xA5E0); out.u16(doc.frames.length); out.u16(W); out.u16(H); out.u16(32); out.u32(1); out.u16(100); out.u32(0); out.u32(0);
    out.u8(int(doc.transparentIndex, 0, 255, 0)); out.zeros(3); out.u16(palette.length); out.u8(1); out.u8(1); out.i16(0); out.i16(0); out.u16(16); out.u16(16); out.zeros(84);
    for (let f = 0; f < doc.frames.length; f++) {
      const chunks = [];
      if (f === 0) {
        chunks.push(() => chunk(0x2007, () => { out.u16(1); out.u16(0); out.u32(0); out.zeros(8); }));  // sRGB
        if (opaque) chunks.push(() => chunk(0x0004, () => { out.u16(1); out.u8(0); out.u8(palette.length & 255); for (const c of palette) { out.u8(c[0]); out.u8(c[1]); out.u8(c[2]); } }));
        chunks.push(() => chunk(0x2019, () => { out.u32(palette.length); out.u32(0); out.u32(palette.length - 1); out.zeros(8); for (const c of palette) { out.u16(0); out.u8(c[0]); out.u8(c[1]); out.u8(c[2]); out.u8(c[3]); } }));
        for (const L of doc.layers) chunks.push(() => chunk(0x2004, () => {
          out.u16((L.visible === false ? 0 : 1) | (L.locked ? 0 : 2)); out.u16(0); out.u16(0); out.u16(0); out.u16(0);
          out.u16(Math.max(0, BLEND.indexOf(L.blend))); out.u8(int(L.opacity, 0, 255, 255)); out.zeros(3); out.str(L.name || "Layer");
        }));
        if (doc.tags && doc.tags.length) chunks.push(() => chunk(0x2018, () => {
          out.u16(doc.tags.length); out.zeros(8);
          for (const t of doc.tags) {
            const c = hexToRgba(t.color || "#000000"), from = int(t.from, 0, doc.frames.length - 1, 0);
            out.u16(from); out.u16(int(t.to, from, doc.frames.length - 1, from)); out.u8(Math.max(0, DIRECTIONS.indexOf(t.direction))); out.u16(int(t.repeat, 0, 65535, 0));
            out.zeros(6); out.u8(c[0]); out.u8(c[1]); out.u8(c[2]); out.u8(0); out.str(t.name || "");
          }
        }));
      }
      for (let l = 0; l < doc.layers.length; l++) {
        const cel = doc.cels[l] && doc.cels[l][f]; if (!cel) continue;
        const t = trim(cel.data, W, H); if (!t) continue;
        const px = crop(cel.data, W, t), data = compress ? await deflate(px) : px, opacity = int(cel.opacity, 0, 255, 255);
        chunks.push(() => chunk(0x2005, () => { out.u16(l); out.i16(t.x); out.i16(t.y); out.u8(opacity); out.u16(compress ? 2 : 0); out.i16(0); out.zeros(5); out.u16(t.w); out.u16(t.h); out.bytes(data); }));
      }
      const at = out.pos;
      out.u32(0); out.u16(0xF1FA); out.u16(Math.min(chunks.length, 0xFFFF)); out.u16(int(doc.frames[f].duration, 1, 65535, 100)); out.zeros(2); out.u32(chunks.length);
      for (const c of chunks) c();
      out.patch32(at, out.pos - at);
    }
    out.patch32(0, out.pos);
    return out.done();
  }

  // ---------- palettes ----------
  const num = t => /^\d+$/.test(t);
  const rgbLine = t => t.length >= 3 && num(t[0]) && num(t[1]) && num(t[2]);
  // GIMP's .gpl, with Aseprite's "Channels: RGBA" header (then four values a row) and the names after the values.
  function parseGpl(src) {
    let name = "", rgba = false; const colors = [];
    for (const raw of src.split(/\r?\n/)) {
      const line = raw.trim(); if (!line || /^GIMP Palette/i.test(line)) continue;
      const m = line.match(/^(Name|Columns|Channels):\s*(.*)$/i);
      if (m) { if (/^name$/i.test(m[1])) name = m[2].trim(); else if (/^channels$/i.test(m[1])) rgba = /rgba/i.test(m[2]); continue; }
      if (line[0] === "#") continue;
      const t = line.split(/\s+/); if (!rgbLine(t)) continue;
      colors.push(rgbaToHex(+t[0], +t[1], +t[2], rgba && t[3] !== undefined && num(t[3]) ? +t[3] : 255));
    }
    return { name, colors };
  }
  // JASC-PAL: the header lines have no three numbers, so every "r g b [a]" line is a colour.
  function parseJasc(src) {
    const colors = [];
    for (const line of src.split(/\r?\n/)) { const t = line.trim().split(/\s+/); if (rgbLine(t)) colors.push(rgbaToHex(+t[0], +t[1], +t[2], t[3] !== undefined && num(t[3]) ? +t[3] : 255)); }
    return colors;
  }
  // A Microsoft RIFF .pal: "RIFF" size "PAL " then a "data" chunk with WORD version, WORD count, count × (r, g, b, flags).
  function parseRiffPal(b) {
    const colors = []; let at = 12;
    while (at + 8 <= b.length) {
      const id = text(b.subarray(at, at + 4)), size = b[at + 4] | b[at + 5] << 8 | b[at + 6] << 16 | b[at + 7] << 24;
      if (id === "data") { const n = b[at + 10] | b[at + 11] << 8; for (let i = 0, p = at + 12; i < n && p + 3 < b.length; i++, p += 4) colors.push(rgbaToHex(b[p], b[p + 1], b[p + 2])); break; }
      at += 8 + size + (size & 1);
    }
    return colors;
  }
  // Adobe .act: 256 RGB triplets, then (when fewer colours were saved) a big-endian WORD count and transparent index.
  function parseAct(b) {
    let n = Math.min(256, b.length / 3 | 0);
    if (b.length >= 772) { const c = b[768] << 8 | b[769]; if (c >= 1 && c <= 256) n = c; }
    const colors = []; for (let i = 0; i < n; i++) colors.push(rgbaToHex(b[i * 3], b[i * 3 + 1], b[i * 3 + 2]));
    return colors;
  }
  // Hex lists (Lospec's .hex: rrggbb or rrggbbaa, with or without # or 0x, one a line or separated by commas or spaces;
  // Paint.NET's .txt: aarrggbb, alpha first). Comments start with ; or //, or with a # that is not a colour.
  function parseHexList(src, alphaFirst) {
    const colors = [];
    for (let line of src.split(/\r?\n/)) {
      line = line.replace(/\/\/.*$|;.*$/, "").trim();
      if (!line || /^#(?![0-9a-f]{6}(?:[0-9a-f]{2})?(?:[\s,]|$))/i.test(line)) continue;
      for (const tok of line.split(/[\s,]+/)) {
        const m = tok.match(/^(?:#|0x)?([0-9a-f]{6}|[0-9a-f]{8})$/i); if (!m) continue;
        const s = m[1].length === 8 && alphaFirst ? m[1].slice(2) + m[1].slice(0, 2) : m[1];
        colors.push(rgbaToHex(...hexToRgba(s)));
      }
    }
    return colors;
  }
  const PALETTE_EXTS = ["gpl", "pal", "act", "hex", "txt", "ase", "aseprite"];
  async function parsePalette(fileName, bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const base = String(fileName || "").replace(/^.*[\\/]/, ""), dot = base.lastIndexOf(".");
    let name = dot > 0 ? base.slice(0, dot) : base || "palette", ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
    const known = PALETTE_EXTS.includes(ext), head = text(bytes.subarray(0, 64));
    // The content decides when it is unmistakable, then the extension, then plain hex lines.
    if (isAse(bytes)) ext = "aseprite";
    else if (/^GIMP Palette/i.test(head)) ext = "gpl";
    else if (/^JASC-PAL/i.test(head) || /^RIFF/.test(head)) ext = "pal";
    else if (!known) ext = bytes.length === 768 || bytes.length === 772 ? "act" : "hex";
    let colors, format = ext === "ase" ? "aseprite" : ext;
    if (ext === "ase" || ext === "aseprite") { if (!isAse(bytes)) throw new Error("Cannot read " + base + ": not an Aseprite file"); colors = (await decodeAseprite(bytes)).palette; }
    else if (ext === "act") colors = parseAct(bytes);
    else if (ext === "pal" && /^RIFF/.test(head)) colors = parseRiffPal(bytes);
    else {
      const src = text(bytes);
      if (ext === "gpl") { const g = parseGpl(src); colors = g.colors; if (g.name) name = g.name; }
      else if (ext === "pal") colors = parseJasc(src);
      else colors = parseHexList(src, ext === "txt");
    }
    if (!colors.length) throw new Error(known || PALETTE_EXTS.includes(ext) && ext !== "hex" ? "No colours found in " + base : "Cannot read " + base + ": not a palette the studio knows (.gpl, .pal, .act, .hex, .txt, .aseprite)");
    return { name, colors: colors.slice(0, 256), format };
  }
  function encodePalette(format, colors, name = "palette") {
    const cols = (colors || []).slice(0, 256).map(hexToRgba), alpha = cols.some(c => c[3] < 255), pad = v => String(v).padStart(3, " ");
    let s, bytes, mime = "text/plain";
    if (format === "gpl") s = ["GIMP Palette", "Name: " + String(name).replace(/[\r\n]+/g, " "), "Columns: 0", ...(alpha ? ["Channels: RGBA"] : []), "#",
      ...cols.map(c => pad(c[0]) + " " + pad(c[1]) + " " + pad(c[2]) + (alpha ? " " + pad(c[3]) : "") + "\t" + rgbaToHex(...c).slice(1))].join("\n") + "\n";
    else if (format === "pal") s = ["JASC-PAL", "0100", String(cols.length), ...cols.map(c => c[0] + " " + c[1] + " " + c[2])].join("\n") + "\n";
    else if (format === "hex") s = cols.map(c => rgbaToHex(...c).slice(1)).join("\n") + "\n";
    else if (format === "act") {
      bytes = new Uint8Array(cols.length < 256 ? 772 : 768); mime = "application/octet-stream";
      cols.forEach((c, i) => bytes.set(c.slice(0, 3), i * 3));
      if (cols.length < 256) { bytes[768] = cols.length >> 8; bytes[769] = cols.length & 255; bytes[770] = bytes[771] = 255; }
    } else throw new Error("Unknown palette format " + format);
    return { bytes: bytes || utf8(s), ext: format, mime };
  }

  // ---------- sprite sheets ----------
  // Where each frame goes on a sheet: one row, a grid of `columns`, or one row a tag with the untagged frames last
  // (a frame in two tags appears twice, with its tag on the entry).
  function sheetLayout(doc, opts = {}) {
    const mode = opts.mode || "row", pad = Math.max(0, opts.padding | 0), n = doc.frames.length, w = doc.w, h = doc.h, rows = [];
    if (mode === "rows-by-tag" && doc.tags && doc.tags.length) {
      const tagged = new Set();
      for (const t of doc.tags) { const row = []; for (let i = t.from; i <= t.to && i < n; i++) { row.push({ index: i, tag: t.name }); tagged.add(i); } if (row.length) rows.push(row); }
      const rest = []; for (let i = 0; i < n; i++) if (!tagged.has(i)) rest.push({ index: i }); if (rest.length) rows.push(rest);
    } else if (mode === "grid") {
      const cols = Math.max(1, Math.min(n, (opts.columns | 0) || Math.ceil(Math.sqrt(n))));
      for (let i = 0; i < n; i++) { if (i % cols === 0) rows.push([]); rows[rows.length - 1].push({ index: i }); }
    } else rows.push(Array.from({ length: n }, (_, i) => ({ index: i })));
    const frames = []; let W = 0;
    rows.forEach((row, r) => { row.forEach((fr, c) => frames.push({ ...fr, x: c * (w + pad), y: r * (h + pad) })); W = Math.max(W, row.length * (w + pad) - pad); });
    return { w: Math.max(1, W), h: Math.max(1, rows.length * (h + pad) - pad), frames, mode, padding: pad };
  }
  // Aseprite's sprite-sheet JSON (the hash format), the frames keyed "<name> <index>.aseprite".
  function sheetJson(doc, layout, imageName) {
    const frames = {};
    for (const f of layout.frames) {
      const fr = doc.frames[f.index] || { duration: 100 };
      let key = doc.name + " " + f.index + ".aseprite";
      if (key in frames && f.tag !== undefined) key = doc.name + " (" + f.tag + ") " + f.index + ".aseprite";
      for (let k = 2; key in frames; k++) key = doc.name + " " + f.index + " #" + k + ".aseprite";
      frames[key] = { frame: { x: f.x, y: f.y, w: doc.w, h: doc.h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: doc.w, h: doc.h }, sourceSize: { w: doc.w, h: doc.h }, duration: fr.duration };
    }
    const meta = { app: APP, version: "1.0", image: imageName || doc.name + ".png", format: "RGBA8888", size: { w: layout.w, h: layout.h }, scale: "1",
      frameTags: (doc.tags || []).map(t => { const c = hexToRgba(t.color || "#000000"); return { name: t.name, from: t.from, to: t.to, direction: t.direction === "pingpong-reverse" ? "pingpong_reverse" : t.direction || "forward",
        ...(t.repeat ? { repeat: String(t.repeat) } : {}), color: rgbaToHex(c[0], c[1], c[2]) + "ff" }; }),
      layers: doc.layers.filter(l => l.visible !== false).map(l => ({ name: l.name, opacity: l.opacity ?? 255, blendMode: l.blend || "normal" })), slices: [] };
    return { frames, meta };
  }

  // ---------- GIF ----------
  // Median cut over the distinct colours (weighted by their pixel counts) down to `max` colours: the box with the
  // widest channel is split at its median until there are enough boxes, each box its weighted mean.
  function medianCut(colors, counts, max) {
    const range = box => { const lo = [255, 255, 255], hi = [0, 0, 0]; for (const i of box) for (let k = 0; k < 3; k++) { const v = colors[i][k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; } let axis = 0; for (let k = 1; k < 3; k++) if (hi[k] - lo[k] > hi[axis] - lo[axis]) axis = k; return { axis, span: hi[axis] - lo[axis] }; };
    const boxes = [colors.map((_, i) => i)], ranges = [range(boxes[0])];
    while (boxes.length < max) {
      let bi = -1, best = -1;
      for (let i = 0; i < boxes.length; i++) if (boxes[i].length > 1 && ranges[i].span > best) { best = ranges[i].span; bi = i; }
      if (bi < 0) break;
      const b = boxes[bi], axis = ranges[bi].axis; b.sort((p, q) => colors[p][axis] - colors[q][axis]);
      const lo = b.slice(0, b.length >> 1), hi = b.slice(b.length >> 1);
      boxes.splice(bi, 1, lo, hi); ranges.splice(bi, 1, range(lo), range(hi));
    }
    return boxes.map(b => { const sum = [0, 0, 0]; let n = 0; for (const i of b) { for (let k = 0; k < 3; k++) sum[k] += colors[i][k] * counts[i]; n += counts[i]; } return sum.map(v => Math.round(v / n)); });
  }
  // The index of the table colour nearest to c.
  function nearest(table, c) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < table.length; i++) { const t = table[i], dd = (c[0] - t[0]) * (c[0] - t[0]) + (c[1] - t[1]) * (c[1] - t[1]) + (c[2] - t[2]) * (c[2] - t[2]); if (dd < bd) { bd = dd; best = i; } }
    return best;
  }
  // GIF's LZW: a clear code, codes growing from minCode + 1 to 12 bits, the dictionary reset when it is full, the
  // bytes in sub-blocks of at most 255.
  function lzw(out, px, minCode) {
    const clear = 1 << minCode, eoi = clear + 1; let codeSize = minCode + 1, next = eoi + 1, dict = new Map(), acc = 0, nbits = 0;
    const block = [];
    const emit = code => { acc |= code << nbits; nbits += codeSize; while (nbits >= 8) { block.push(acc & 255); acc >>>= 8; nbits -= 8; if (block.length === 255) { out.u8(255); out.bytes(block); block.length = 0; } } };
    emit(clear); let prefix = -1;
    for (let i = 0; i < px.length; i++) {
      const k = px[i]; if (prefix < 0) { prefix = k; continue; }
      const key = prefix << 8 | k, code = dict.get(key);
      if (code !== undefined) { prefix = code; continue; }
      emit(prefix);
      if (next < 4096) { dict.set(key, next++); if (next > (1 << codeSize) && codeSize < 12) codeSize++; }
      else { emit(clear); dict = new Map(); codeSize = minCode + 1; next = eoi + 1; }
      prefix = k;
    }
    if (prefix >= 0) emit(prefix); emit(eoi);
    if (nbits > 0) block.push(acc & 255);
    if (block.length) { out.u8(block.length); out.bytes(block); } out.u8(0);
  }
  // GIF89a: one global colour table from every frame's colours (quantised when they exceed 255 plus a transparent
  // slot), a NETSCAPE2.0 loop extension, and per frame a graphic control extension (restore to background, the
  // transparent index when the frame has holes, the delay in 1/100 s, at least 2) and a full-size image.
  function encodeGif(frames, w, h, opts) {
    opts = opts || {};
    const scale = Math.max(1, opts.scale | 0), loop = int(opts.loop, 0, 65535, 0), W = w * scale, H = h * scale, n = w * h;
    // First every colour of every frame, counted for the quantiser (alpha under 128 is a hole: GIF has one bit of alpha).
    const index = new Map(), colors = [], counts = [], keyOf = (d, s) => d[s] << 16 | d[s + 1] << 8 | d[s + 2]; let transparent = false;
    for (const fr of frames) for (let p = 0, d = fr.data; p < n; p++) {
      const s = p * 4;
      if (d[s + 3] < 128) { transparent = true; continue; }
      const k = keyOf(d, s); let i = index.get(k);
      if (i === undefined) { i = colors.length; index.set(k, i); colors.push([d[s], d[s + 1], d[s + 2]]); counts.push(0); }
      counts[i]++;
    }
    let table = colors, remap = null;
    if (colors.length > (transparent ? 255 : 256)) {
      table = medianCut(colors, counts, transparent ? 255 : 256);
      remap = colors.map(c => nearest(table, c));
    }
    const tIndex = table.length, total = tIndex + (transparent ? 1 : 0);
    let bits = 1; while ((1 << bits) < total) bits++;
    const size = 1 << bits, minCode = Math.max(2, bits), out = writer(4096);
    out.bytes(ascii("GIF89a")); out.u16(W); out.u16(H); out.u8(0xF0 | (bits - 1)); out.u8(0); out.u8(0);
    for (let i = 0; i < size; i++) { const c = table[i] || [0, 0, 0]; out.u8(c[0]); out.u8(c[1]); out.u8(c[2]); }
    out.bytes([0x21, 0xFF, 0x0B]); out.bytes(ascii("NETSCAPE2.0")); out.bytes([3, 1]); out.u16(loop); out.u8(0);
    for (const fr of frames) {
      // The frame's indices at the output size (nearest neighbour), one buffer at a time.
      const d = fr.data, ix = new Uint8Array(W * H); let holes = false;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const s = ((y / scale | 0) * w + (x / scale | 0)) * 4;
        if (d[s + 3] < 128) { ix[y * W + x] = tIndex; holes = true; continue; }
        const i = index.get(keyOf(d, s)); ix[y * W + x] = remap ? remap[i] : i;
      }
      out.bytes([0x21, 0xF9, 4, (2 << 2) | (holes ? 1 : 0)]); out.u16(Math.max(2, Math.round((fr.duration || 100) / 10))); out.u8(holes ? tIndex : 0); out.u8(0);
      out.u8(0x2C); out.u16(0); out.u16(0); out.u16(W); out.u16(H); out.u8(0);
      out.u8(minCode); lzw(out, ix, minCode);
    }
    out.u8(0x3B);
    return out.done();
  }

  const AseFormats = { newDoc, cloneDoc, flatten, blit, decodeAseprite, encodeAseprite, parsePalette, encodePalette, uniqueColors,
    sheetLayout, sheetJson, encodeGif, hexToRgba, rgbaToHex, blendModes: BLEND.slice(), directions: DIRECTIONS.slice() };
  if (typeof window !== "undefined") window.AseFormats = AseFormats;
  if (typeof module !== "undefined" && module.exports) module.exports = AseFormats;
})();
