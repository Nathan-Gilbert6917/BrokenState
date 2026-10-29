// Checks board/src/formats.js (the pixel studio's file formats), headless, plain Node 22, no dependencies:
// - newDoc and cloneDoc, flatten and blit (layer and cel opacity, a hidden layer, the `layers` override, straight alpha);
// - .aseprite round trips, compressed and raw: pixels, layer names, visibility, lock, opacity and blend, durations,
//   tags in all four directions, a palette with alpha, a cel trimmed on export back in place, an empty cel null,
//   the header and chunk layout Aseprite expects, and the raw fallbacks when the streams API is missing;
// - hand-built files: indexed with a transparent index and a background layer (old and new palette chunks, the
//   palette before the layers), grayscale, groups with a hidden child, a linked cel, a tilemap layer skipped with
//   a warning, unknown chunks and user data skipped, the readable errors;
// - every palette format round-trips and reads real-world shaped samples; uniqueColors;
// - sheetLayout and sheetJson for "row", "grid" and "rows-by-tag"; encodeGif parsed back (LZW decoded);
// - optional: Aseprite's own test sprites, fetched with curl into <tmp>/bs-aseprite-samples when they are not there
//   (BS_ASE_SAMPLES=<dir> points at a copy instead; a missing file is a `skip` line, never a FAIL).
// Prints `ok <name>` or `FAIL <name>: <why>` a check and a summary line; exits 1 on any FAIL.
// Usage: node board/tools/formats-test.js
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const F = require(path.join(__dirname, "..", "src", "formats.js"));
const DEFAULT_SAMPLES = path.join(os.tmpdir(), "bs-aseprite-samples");
const SAMPLE_URL = "https://raw.githubusercontent.com/aseprite/aseprite/main/tests/sprites/";
const SAMPLES = ["abcd.aseprite", "2f-index-3x3.aseprite", "groups3abc.aseprite", "tags3.aseprite", "link.aseprite", "point4frames.aseprite", "1empty3.aseprite"];

let fails = 0, passes = 0;
const check = (c, name, why) => { if (c) { passes++; console.log("ok " + name); } else { fails++; console.log("FAIL " + name + ": " + (why || "expected true")); } };
const J = v => JSON.stringify(ArrayBuffer.isView(v) ? Array.from(v) : v);
const eq = (a, b, name) => check(J(a) === J(b), name, "got " + J(a) + ", expected " + J(b));
const throws = async (fn, re, name) => { try { await fn(); check(false, name, "did not throw"); } catch (e) { check(re.test(e.message), name, "threw " + JSON.stringify(e.message)); } };
const px = (data, w, x, y) => Array.from(data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));
const put = (cel, w, x, y, rgba) => cel.data.set(rgba, (y * w + x) * 4);
const le16 = (b, at) => b[at] | b[at + 1] << 8, le32 = (b, at) => (b[at] | b[at + 1] << 8 | b[at + 2] << 16 | b[at + 3] << 24) >>> 0;

// ---------- a small .aseprite builder for hand-made files ----------
function bw() {
  const parts = []; const o = { u8: v => parts.push([v & 255]), u16: v => parts.push([v & 255, v >> 8 & 255]), i16: v => o.u16(v & 0xFFFF),
    u32: v => parts.push([v & 255, v >> 8 & 255, v >> 16 & 255, v >>> 24 & 255]), bytes: b => parts.push(Array.from(b)), zeros: n => parts.push(new Array(n).fill(0)),
    str: s => { const b = Buffer.from(s, "utf8"); o.u16(b.length); o.bytes(b); }, out: () => Uint8Array.from(parts.flat()) };
  return o;
}
const chunk = (type, body) => { const b = bw(); body(b); const d = b.out(), c = bw(); c.u32(d.length + 6); c.u16(type); c.bytes(d); return c.out(); };
function ase({ w, h, depth = 32, transparentIndex = 0, frames, oldCountOnly = false }) {
  const body = frames.map(f => { const fb = bw(), all = f.chunks.flatMap(c => Array.from(c)); fb.u32(16 + all.length); fb.u16(0xF1FA); fb.u16(f.chunks.length); fb.u16(f.duration || 100); fb.zeros(2); fb.u32(oldCountOnly ? 0 : f.chunks.length); fb.bytes(all); return fb.out(); });
  const b = bw(); b.u32(128 + body.reduce((s, x) => s + x.length, 0)); b.u16(0xA5E0); b.u16(frames.length); b.u16(w); b.u16(h); b.u16(depth); b.u32(1); b.u16(100); b.u32(0); b.u32(0);
  b.u8(transparentIndex); b.zeros(3); b.u16(0); b.u8(1); b.u8(1); b.i16(0); b.i16(0); b.u16(16); b.u16(16); b.zeros(84);
  for (const x of body) b.bytes(x);
  return b.out();
}
const layerChunk = ({ flags = 3, type = 0, level = 0, blend = 0, opacity = 255, name = "L" }) => chunk(0x2004, b => { b.u16(flags); b.u16(type); b.u16(level); b.u16(0); b.u16(0); b.u16(blend); b.u8(opacity); b.zeros(3); b.str(name); if (type === 2) b.u32(0); });
const celChunk = ({ layer, x = 0, y = 0, opacity = 255, type = 0, w, h, pixels, link }) => chunk(0x2005, b => { b.u16(layer); b.i16(x); b.i16(y); b.u8(opacity); b.u16(type); b.i16(0); b.zeros(5);
  if (type === 1) b.u16(link); else { b.u16(w); b.u16(h); if (type === 3) { b.u16(32); b.u32(0x1fffffff); b.u32(0x20000000); b.u32(0x40000000); b.u32(0x80000000); b.zeros(10); } b.bytes(pixels); } });
const palChunk = cols => chunk(0x2019, b => { b.u32(cols.length); b.u32(0); b.u32(cols.length - 1); b.zeros(8); for (const c of cols) { b.u16(c.length > 4 ? 1 : 0); b.u8(c[0]); b.u8(c[1]); b.u8(c[2]); b.u8(c[3]); if (c.length > 4) b.str(c[4]); } });
const oldPalChunk = (cols, type = 0x0004) => chunk(type, b => { b.u16(1); b.u8(0); b.u8(cols.length & 255); for (const c of cols) { b.u8(c[0]); b.u8(c[1]); b.u8(c[2]); } });
const tagsChunk = tags => chunk(0x2018, b => { b.u16(tags.length); b.zeros(8); for (const t of tags) { b.u16(t.from); b.u16(t.to); b.u8(t.dir); b.u16(t.repeat || 0); b.zeros(6); b.u8(t.rgb[0]); b.u8(t.rgb[1]); b.u8(t.rgb[2]); b.u8(0); b.str(t.name); } });
const userData = ({ text, color }) => chunk(0x2020, b => { b.u32((text ? 1 : 0) | (color ? 2 : 0)); if (text) b.str(text); if (color) b.bytes(color); });
// The chunk types of a frame of an encoded file, with a few cel fields.
function chunksOf(bytes, frame) {
  let p = 128; for (let f = 0; f < frame; f++) p += le32(bytes, p);
  const n = le32(bytes, p + 12) || le16(bytes, p + 6), out = []; let q = p + 16;
  for (let c = 0; c < n; c++) { const size = le32(bytes, q), type = le16(bytes, q + 4), o = { type, size };
    if (type === 0x2005) Object.assign(o, { layer: le16(bytes, q + 6), x: le16(bytes, q + 8) << 16 >> 16, y: le16(bytes, q + 10) << 16 >> 16, opacity: bytes[q + 12], celType: le16(bytes, q + 13), w: le16(bytes, q + 22), h: le16(bytes, q + 24) });
    out.push(o); q += size; }
  return out;
}
const trimBox = (cel, w, h) => { let x0 = w, y0 = h, x1 = -1, y1 = -1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cel.data[(y * w + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1]; };

// ---------- a GIF walker with an LZW decoder ----------
function lzwDecode(data, minCode, n) {
  const clear = 1 << minCode, eoi = clear + 1; let codeSize, next, dict, acc = 0, nbits = 0, pos = 0, prev = null; const out = [];
  const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; next = eoi + 1; codeSize = minCode + 1; };
  reset();
  while (out.length < n) {
    while (nbits < codeSize && pos < data.length) { acc |= data[pos++] << nbits; nbits += 8; }
    if (nbits < codeSize) break;
    const code = acc & ((1 << codeSize) - 1); acc >>>= codeSize; nbits -= codeSize;
    if (code === clear) { reset(); prev = null; continue; }
    if (code === eoi) break;
    let entry; if (code < next && dict[code]) entry = dict[code]; else if (prev && code === next) entry = [...prev, prev[0]]; else throw new Error("bad LZW code " + code);
    out.push(...entry);
    if (prev && next < 4096) { dict[next++] = [...prev, entry[0]]; if (next >= (1 << codeSize) && codeSize < 12) codeSize++; }
    prev = entry;
  }
  return out;
}
function parseGif(b) {
  const g = { sig: Buffer.from(b.subarray(0, 6)).toString(), w: le16(b, 6), h: le16(b, 8), packed: b[10], loop: null, frames: [], tableSize: 0 };
  let p = 13;
  if (g.packed & 0x80) { g.tableSize = 1 << ((g.packed & 7) + 1); g.table = []; for (let i = 0; i < g.tableSize; i++, p += 3) g.table.push([b[p], b[p + 1], b[p + 2]]); }
  const subBlocks = () => { const parts = []; while (b[p] !== 0) { const n = b[p++]; parts.push(...b.subarray(p, p + n)); p += n; } p++; return parts; };
  let gce = null;
  while (p < b.length) {
    const t = b[p++];
    if (t === 0x3B) { g.trailer = true; break; }
    if (t === 0x21) { const label = b[p++]; const d = subBlocks();
      if (label === 0xF9) gce = { disposal: d[0] >> 2 & 7, transparentFlag: d[0] & 1, delay: d[1] | d[2] << 8, transparentIndex: d[3] };
      else if (label === 0xFF && Buffer.from(d.slice(0, 11)).toString() === "NETSCAPE2.0") g.loop = d[12] | d[13] << 8;
    } else if (t === 0x2C) { const fr = { x: le16(b, p), y: le16(b, p + 2), w: le16(b, p + 4), h: le16(b, p + 6), packed: b[p + 8], gce }; p += 9;
      if (fr.packed & 0x80) p += 3 * (1 << ((fr.packed & 7) + 1));
      fr.minCode = b[p++]; fr.indices = lzwDecode(Uint8Array.from(subBlocks()), fr.minCode, fr.w * fr.h); g.frames.push(fr); gce = null;
    } else throw new Error("unknown GIF block 0x" + t.toString(16) + " at " + (p - 1));
  }
  return g;
}

(async () => {
  // ---------- colours, newDoc, cloneDoc ----------
  eq(F.hexToRgba("#ff8000"), [255, 128, 0, 255], "hexToRgba #rrggbb");
  eq(F.hexToRgba("0a0b0c80"), [10, 11, 12, 128], "hexToRgba rrggbbaa without #");
  eq(F.hexToRgba("#f00"), [255, 0, 0, 255], "hexToRgba short form");
  eq(F.hexToRgba("nope"), [0, 0, 0, 0], "hexToRgba garbage is transparent");
  eq([F.rgbaToHex(255, 128, 0), F.rgbaToHex(255, 128, 0, 255), F.rgbaToHex(1, 2, 3, 4)], ["#ff8000", "#ff8000", "#01020304"], "rgbaToHex with and without alpha");
  const d0 = F.newDoc({ w: 4, h: 3, name: "t", palette: ["#ff0000", "#00ff0080"] });
  eq([d0.w, d0.h, d0.name, d0.layers.length, d0.frames.length, d0.frames[0].duration, d0.cels.length, d0.cels[0].length, d0.tags.length, d0.transparentIndex, d0.warnings.length], [4, 3, "t", 1, 1, 100, 1, 1, 0, 0, 0], "newDoc shape");
  eq([d0.layers[0].name, d0.layers[0].visible, d0.layers[0].locked, d0.layers[0].opacity, d0.layers[0].blend], ["Layer 1", true, false, 255, "normal"], "newDoc layer");
  check(d0.cels[0][0].data instanceof Uint8ClampedArray && d0.cels[0][0].data.length === 48 && d0.cels[0][0].data.every(v => v === 0) && d0.cels[0][0].opacity === 255, "newDoc has one empty full-canvas cel");
  const palIn = ["#123456"]; const d1 = F.newDoc({ w: 300, h: 0, palette: palIn });
  check(d1.w === 256 && d1.h === 1 && d1.palette !== palIn && d1.palette[0] === "#123456", "newDoc clamps the size to 1..256 and copies the palette");
  check(F.newDoc({}).palette.length >= 1, "newDoc without a palette still has one");
  put(d0.cels[0][0], 4, 1, 1, [1, 2, 3, 4]);
  const c0 = F.cloneDoc(d0); c0.cels[0][0].data[0] = 99; c0.layers[0].name = "x"; c0.palette.push("#000000"); c0.frames[0].duration = 7;
  check(d0.cels[0][0].data[0] === 0 && d0.layers[0].name === "Layer 1" && d0.palette.length === 2 && d0.frames[0].duration === 100 && J(c0.cels[0][0].data.subarray(20, 24)) === J([1, 2, 3, 4]), "cloneDoc is a deep copy");

  // ---------- flatten and blit ----------
  {
    const d = F.newDoc({ w: 2, h: 1 });
    d.layers.push({ name: "top", visible: true, locked: false, opacity: 128, blend: "normal" }, { name: "hidden", visible: false, locked: false, opacity: 255, blend: "normal" });
    d.cels.push([{ data: new Uint8ClampedArray(8), opacity: 255 }], [{ data: new Uint8ClampedArray(8), opacity: 255 }]);
    put(d.cels[0][0], 2, 0, 0, [255, 0, 0, 255]); put(d.cels[1][0], 2, 0, 0, [0, 0, 255, 128]); put(d.cels[1][0], 2, 1, 0, [0, 255, 0, 100]); put(d.cels[2][0], 2, 0, 0, [0, 0, 0, 255]);
    const out = F.flatten(d, 0);
    const sa = 128 * 128 / 255 / 255, exp = [255 * (1 - sa), 0, 255 * sa, 255];  // a float reference for pixel 0: blue at 128 × layer 128 over opaque red
    const got = px(out, 2, 0, 0);
    check(got.every((v, i) => Math.abs(v - exp[i]) <= 1), "flatten multiplies the layer opacity into the cel's alpha over an opaque pixel", J(got) + " vs " + J(exp.map(Math.round)));
    const g1 = px(out, 2, 1, 0), a1 = Math.round(100 * 128 / 255);
    check(g1[0] === 0 && g1[1] === 255 && g1[2] === 0 && Math.abs(g1[3] - a1) <= 1, "a half-transparent pixel over nothing keeps its colour, alpha scaled, not premultiplied", J(g1));
    check(px(out, 2, 0, 0)[0] > 0, "the hidden layer is not drawn");
    const onion = F.flatten(d, 0, { layers: [2] });
    eq(px(onion, 2, 0, 0), [0, 0, 0, 255], "the layers override draws a hidden layer alone");
    d.cels[1][0].opacity = 0; const o2 = F.flatten(d, 0); eq(px(o2, 2, 0, 0), [255, 0, 0, 255], "a cel with opacity 0 adds nothing");
    const dst = new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0]), src = new Uint8ClampedArray([200, 100, 0, 255, 1, 2, 3, 200]);
    check(F.blit(dst, src, 2, 1, 255) === dst && J(dst) === J([200, 100, 0, 255, 1, 2, 3, 200]), "blit returns dst; an opaque source replaces, a source over nothing copies");
    const d2 = new Uint8ClampedArray([0, 0, 0, 128]); F.blit(d2, new Uint8ClampedArray([255, 255, 255, 128]), 1, 1, 255);
    const ua = 128 + Math.round(128 * 127 / 255), uc = Math.round(255 * 128 / ua);  // white at 128 over black at 128: alpha 192, grey 170
    check(Math.abs(d2[3] - ua) <= 1 && Math.abs(d2[0] - uc) <= 1 && d2[0] === d2[1] && d2[1] === d2[2], "blit's union alpha and weighted colour", J(d2) + " expected about " + J([uc, uc, uc, ua]));
  }

  // ---------- .aseprite round trips ----------
  function sampleDoc() {
    const d = F.newDoc({ w: 7, h: 5, name: "rt", palette: ["#000000", "#ff0000", "#00ff0080", "#0000ff"] });
    d.layers[0] = { name: "Back ground é", visible: true, locked: true, opacity: 200, blend: "multiply" };
    d.layers.push({ name: "Top", visible: false, locked: false, opacity: 255, blend: "normal" });
    d.frames = [{ duration: 100 }, { duration: 250 }, { duration: 33 }];
    d.cels = [[null, null, null], [null, null, null]];
    const cel = () => ({ data: new Uint8ClampedArray(7 * 5 * 4), opacity: 255 });
    d.cels[0][0] = cel(); put(d.cels[0][0], 7, 2, 1, [255, 0, 0, 255]); put(d.cels[0][0], 7, 4, 3, [0, 255, 0, 128]); put(d.cels[0][0], 7, 3, 2, [10, 20, 30, 1]);
    d.cels[0][1] = cel(); d.cels[0][1].opacity = 77; put(d.cels[0][1], 7, 0, 0, [1, 2, 3, 255]); put(d.cels[0][1], 7, 6, 4, [4, 5, 6, 255]);
    d.cels[1][2] = cel(); put(d.cels[1][2], 7, 6, 0, [9, 9, 9, 9]);
    d.cels[1][1] = cel();  // all transparent: not written, comes back null
    d.tags = [{ name: "walk", from: 0, to: 1, direction: "forward", repeat: 0, color: "#ff0000" }, { name: "back", from: 1, to: 2, direction: "reverse", repeat: 3, color: "#00ff00" },
      { name: "pp", from: 0, to: 2, direction: "pingpong", repeat: 0, color: "#0000ff" }, { name: "ppr", from: 2, to: 2, direction: "pingpong-reverse", repeat: 1, color: "#808080" }];
    d.transparentIndex = 2;
    return d;
  }
  const same = (a, b, name) => {
    const probs = [];
    if (a.w !== b.w || a.h !== b.h) probs.push("size");
    if (J(a.layers) !== J(b.layers)) probs.push("layers " + J(b.layers));
    if (J(a.frames) !== J(b.frames)) probs.push("frames " + J(b.frames));
    if (J(a.tags) !== J(b.tags)) probs.push("tags " + J(b.tags));
    if (J(a.palette) !== J(b.palette)) probs.push("palette " + J(b.palette));
    if (a.transparentIndex !== b.transparentIndex) probs.push("transparentIndex");
    a.cels.forEach((row, l) => row.forEach((c, f) => { const o = b.cels[l] && b.cels[l][f];
      const empty = !c || c.data.every((v, i) => i % 4 !== 3 || v === 0);
      if (empty) { if (o) probs.push("cel " + l + "/" + f + " should be null"); return; }
      if (!o) { probs.push("cel " + l + "/" + f + " missing"); return; }
      if (o.opacity !== c.opacity) probs.push("cel " + l + "/" + f + " opacity " + o.opacity);
      for (let i = 0; i < c.data.length; i += 4) if ((c.data[i + 3] || o.data[i + 3]) && J(c.data.subarray(i, i + 4)) !== J(o.data.subarray(i, i + 4))) { probs.push("cel " + l + "/" + f + " pixel " + i / 4 + " " + J(o.data.subarray(i, i + 4))); break; } }));
    check(!probs.length, name, probs.join("; "));
  };
  const src = sampleDoc();
  const zipped = await F.encodeAseprite(src);
  check(zipped instanceof Uint8Array && le32(zipped, 0) === zipped.length && le16(zipped, 4) === 0xA5E0, "encodeAseprite: the file-size field is the whole file, magic 0xA5E0");
  eq([le16(zipped, 6), le16(zipped, 8), le16(zipped, 10), le16(zipped, 12), le32(zipped, 14), le16(zipped, 18), zipped[28], le16(zipped, 32), zipped[34], zipped[35], le16(zipped, 40), le16(zipped, 42)], [3, 7, 5, 32, 1, 100, 2, 4, 1, 1, 16, 16], "header: frames, size, depth 32, flag 1, speed, transparent index, colours, pixel ratio, grid 16");
  const f0 = chunksOf(zipped, 0);
  eq(f0.map(c => c.type), [0x2007, 0x2019, 0x2004, 0x2004, 0x2018, 0x2005], "frame 0: colour profile, palette (no old chunk: a colour has alpha), layers, tags, cel");
  eq(chunksOf(zipped, 1).map(c => c.type), [0x2005], "frame 1: cels only (the fully transparent cel is not written)");
  eq(chunksOf(zipped, 2).map(c => c.type), [0x2005], "frame 2: one cel on the top layer");
  const c00 = f0[5]; eq([c00.layer, c00.x, c00.y, c00.w, c00.h, c00.celType, c00.opacity], [0, 2, 1, 3, 3, 2, 255], "the cel is trimmed to its opaque box and compressed");
  const c12 = chunksOf(zipped, 2)[0]; eq([c12.layer, c12.x, c12.y, c12.w, c12.h], [1, 6, 0, 1, 1], "a one-pixel cel on the top layer at (6, 0)");
  let p = 128; for (let f = 0; f < 3; f++) p += le32(zipped, p); check(p === zipped.length, "the frames' byte counts add up to the file");
  const back = await F.decodeAseprite(zipped);
  same(src, back, "compressed round trip keeps pixels, layers, frames, tags, palette");
  check(back.cels[1][1] === null && back.cels[1][0] === null && back.cels[0][2] === null, "empty cels come back null");
  check(back.cels[0][1].opacity === 77, "cel opacity round-trips");
  const raw = await F.encodeAseprite(src, { compress: false });
  eq(chunksOf(raw, 0)[5].celType, 0, "compress: false writes raw cels");
  same(src, await F.decodeAseprite(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)), "raw round trip (from an ArrayBuffer)");
  const opaqueDoc = F.newDoc({ w: 2, h: 2, palette: ["#000000", "#ffffff"] });
  const ob = await F.encodeAseprite(opaqueDoc);
  eq(chunksOf(ob, 0).map(c => c.type), [0x2007, 0x0004, 0x2019, 0x2004], "an all-opaque palette also gets the old palette chunk; no cel for an empty doc");
  eq((await F.decodeAseprite(ob)).palette, ["#000000", "#ffffff"], "the opaque palette round-trips");
  // The streams API missing: raw cels out, a readable error in.
  const cs = Object.getOwnPropertyDescriptor(globalThis, "CompressionStream"), ds = Object.getOwnPropertyDescriptor(globalThis, "DecompressionStream");
  delete globalThis.CompressionStream; delete globalThis.DecompressionStream;
  try {
    const nb = await F.encodeAseprite(src); eq(chunksOf(nb, 0)[5].celType, 0, "without CompressionStream the cels are raw");
    same(src, await F.decodeAseprite(nb), "raw cels decode without DecompressionStream");
    await throws(() => F.decodeAseprite(zipped), /DecompressionStream/, "a compressed file without DecompressionStream is a readable error");
  } finally { Object.defineProperty(globalThis, "CompressionStream", cs); Object.defineProperty(globalThis, "DecompressionStream", ds); }
  same(src, await F.decodeAseprite(zipped), "the streams API is back");

  // ---------- hand-built files ----------
  {
    // Indexed, 4×2: the palette chunk before the layers, an old palette chunk first that the new one overrides,
    // a background layer (flag 8) under a transparent layer, transparent index 1.
    const pal = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 128, "blue"], [9, 9, 9, 255]];
    const bytes = ase({ w: 4, h: 2, depth: 8, transparentIndex: 1, frames: [{ duration: 50, chunks: [
      oldPalChunk([[1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4]]), palChunk(pal),
      layerChunk({ flags: 1 | 2 | 8, name: "Background" }), layerChunk({ flags: 3, name: "Sprite" }),
      celChunk({ layer: 0, w: 4, h: 2, pixels: [1, 1, 1, 1, 1, 1, 1, 1] }), celChunk({ layer: 1, x: 1, y: 0, w: 2, h: 2, pixels: [0, 1, 2, 3] }) ] }] });
    const d = await F.decodeAseprite(bytes);
    eq(d.palette, ["#ff0000", "#00ff00", "#0000ff80", "#090909"], "indexed: the new palette chunk wins over the old one, alpha and names read");
    eq([d.w, d.h, d.transparentIndex, d.frames[0].duration, d.layers.map(l => l.name)], [4, 2, 1, 50, ["Background", "Sprite"]], "indexed: header and layers");
    eq(px(d.cels[0][0].data, 4, 0, 0), [0, 255, 0, 255], "on a background layer the transparent index is an opaque colour");
    eq([px(d.cels[1][0].data, 4, 1, 0), px(d.cels[1][0].data, 4, 2, 0), px(d.cels[1][0].data, 4, 1, 1), px(d.cels[1][0].data, 4, 2, 1), px(d.cels[1][0].data, 4, 0, 0)],
      [[255, 0, 0, 255], [0, 0, 0, 0], [0, 0, 255, 128], [9, 9, 9, 255], [0, 0, 0, 0]], "on a transparent layer the transparent index is alpha 0; the offset cel lands at x 1");
    const old = await F.decodeAseprite(ase({ w: 1, h: 1, depth: 8, frames: [{ chunks: [oldPalChunk([[63, 0, 31]], 0x0011), layerChunk({ name: "L", flags: 1 | 2 | 8 }), celChunk({ layer: 0, w: 1, h: 1, pixels: [0] })] }] }));
    eq([old.palette, px(old.cels[0][0].data, 1, 0, 0)], [["#ff007d"], [255, 0, 125, 255]], "the old 6-bit palette chunk alone is scaled to 8 bits ((v << 2) | (v >> 4)) and applied");
    const gray = await F.decodeAseprite(ase({ w: 2, h: 1, depth: 16, frames: [{ chunks: [layerChunk({ name: "G" }), celChunk({ layer: 0, w: 2, h: 1, pixels: [100, 255, 50, 20] })] }] }));
    eq(Array.from(gray.cels[0][0].data), [100, 100, 100, 255, 50, 50, 50, 20], "grayscale cels become (v, v, v, a)");
    check(gray.palette.length >= 1, "a file without a palette chunk still gets one");
    // Groups: a visible group with a hidden child, a hidden group with a visible child, a nested group, a cel on
    // the group itself; the cel layer indices count the groups.
    const pix = (r, g, b) => [r, g, b, 255];
    const gb = ase({ w: 2, h: 1, frames: [{ chunks: [
      layerChunk({ flags: 3, type: 1, name: "G1" }), layerChunk({ flags: 3, level: 1, name: "a" }), layerChunk({ flags: 2, level: 1, name: "b" }),
      layerChunk({ flags: 2, type: 1, name: "G2" }), layerChunk({ flags: 3, level: 1, name: "c" }), layerChunk({ flags: 3, type: 1, level: 1, name: "G2.1" }), layerChunk({ flags: 3, level: 2, name: "d" }),
      layerChunk({ flags: 3, name: "e" }),
      celChunk({ layer: 0, w: 1, h: 1, pixels: pix(7, 7, 7) }), celChunk({ layer: 1, w: 1, h: 1, pixels: pix(1, 0, 0) }), celChunk({ layer: 4, w: 1, h: 1, pixels: pix(2, 0, 0) }), celChunk({ layer: 6, x: 1, w: 1, h: 1, pixels: pix(3, 0, 0) }), celChunk({ layer: 7, w: 1, h: 1, pixels: pix(4, 0, 0) }) ] }] });
    const g = await F.decodeAseprite(gb);
    eq(g.layers.map(l => l.name + (l.visible ? "+" : "-")), ["a+", "b-", "c-", "d-", "e+"], "groups are dropped; a hidden group hides its children at every level");
    eq([px(g.cels[0][0].data, 2, 0, 0), px(g.cels[2][0].data, 2, 0, 0), px(g.cels[3][0].data, 2, 1, 0), px(g.cels[4][0].data, 2, 0, 0)].map(v => v[0]), [1, 2, 3, 4], "cels map through the file's layer indices, groups counted; the group's own cel is dropped");
    check(g.cels[1][0] === null, "a layer without a cel has null");
    // A linked cel, resolved into an independent copy; a link to nothing is null.
    const lb = ase({ w: 2, h: 1, frames: [
      { chunks: [layerChunk({ name: "L" }), layerChunk({ name: "M" }), celChunk({ layer: 0, w: 2, h: 1, pixels: [1, 2, 3, 255, 4, 5, 6, 255] })] },
      { chunks: [celChunk({ layer: 0, type: 1, link: 0, opacity: 200 }), celChunk({ layer: 1, type: 1, link: 0 })] },
      { chunks: [celChunk({ layer: 0, type: 1, link: 1 })] } ] });
    const l = await F.decodeAseprite(lb);
    check(l.cels[0][1] && J(l.cels[0][1].data) === J(l.cels[0][0].data) && l.cels[0][1].opacity === 200, "a linked cel is a copy of its target");
    check(l.cels[0][2] && J(l.cels[0][2].data) === J(l.cels[0][0].data), "a link to a link resolves");
    l.cels[0][1].data[0] = 200; check(l.cels[0][0].data[0] === 1 && l.cels[0][2].data[0] === 1, "the copies are independent");
    check(l.cels[1][1] === null, "a link to a missing cel is null");
    // A tilemap layer with a tilemap cel is skipped with one warning; the layer after it keeps its cels.
    const tb = ase({ w: 2, h: 1, frames: [{ chunks: [layerChunk({ name: "Tiles", type: 2 }), layerChunk({ name: "Art" }),
      celChunk({ layer: 0, type: 3, w: 1, h: 1, pixels: [1, 2, 3, 4, 5] }), celChunk({ layer: 1, w: 1, h: 1, pixels: [8, 8, 8, 255] })] }] });
    const t = await F.decodeAseprite(tb);
    eq(t.layers.map(x => x.name), ["Art"], "a tilemap layer is dropped");
    check(t.warnings.length === 1 && /tilemap/i.test(t.warnings[0]) && /Tiles/.test(t.warnings[0]), "with one warning naming it", J(t.warnings));
    eq(px(t.cels[0][0].data, 2, 0, 0), [8, 8, 8, 255], "the layer after the tilemap keeps its cel");
    // Unknown chunks, user data, a colour profile with ICC data, a slice, the old chunk count only, cel pixels
    // partly outside the canvas, a cel wholly outside.
    const ub = ase({ w: 2, h: 2, oldCountOnly: true, frames: [{ chunks: [
      chunk(0x7777, b => { b.bytes([1, 2, 3, 4, 5]); }), chunk(0x2007, b => { b.u16(2); b.u16(0); b.u32(0); b.zeros(8); b.u32(3); b.bytes([9, 9, 9]); }),
      layerChunk({ name: "L", blend: 1, opacity: 90 }), userData({ text: "hello", color: [1, 2, 3, 4] }),
      tagsChunk([{ name: "t", from: 0, to: 0, dir: 0, rgb: [1, 2, 3] }]), userData({ color: [10, 20, 30, 255] }),
      chunk(0x2022, b => { b.u32(1); b.u32(0); b.u32(0); b.str("slice"); b.u32(0); b.u32(0); b.u32(0); b.u32(1); b.u32(1); }),
      celChunk({ layer: 0, x: -1, y: 1, w: 2, h: 2, pixels: [1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255, 4, 4, 4, 255] }) ] },
      { chunks: [celChunk({ layer: 0, x: 5, y: 5, w: 1, h: 1, pixels: [1, 1, 1, 255] })] } ] });
    const u = await F.decodeAseprite(ub);
    eq([u.layers[0].blend, u.layers[0].opacity, u.tags[0].name, u.tags[0].color], ["multiply", 90, "t", "#0a141e"], "unknown chunks skipped; a blend mode and opacity read; the tag's user-data colour applied");
    check(u.warnings.some(w => /multiply/.test(w)) && u.warnings.some(w => /slice/i.test(w)), "warnings for the blend mode and the slice", J(u.warnings));
    eq([px(u.cels[0][0].data, 2, 0, 1), px(u.cels[0][0].data, 2, 1, 1), px(u.cels[0][0].data, 2, 0, 0)], [[2, 2, 2, 255], [0, 0, 0, 0], [0, 0, 0, 0]], "a cel partly outside the canvas is clipped");
    check(u.cels[0][1] === null, "a cel wholly outside the canvas is null");
    await throws(() => F.decodeAseprite(new Uint8Array(200)), /Not an Aseprite file/, "garbage is 'Not an Aseprite file'");
    await throws(() => F.decodeAseprite(zipped.subarray(0, 200)), /Truncated file/, "a cut file is 'Truncated file'");
    await throws(() => F.decodeAseprite(ase({ w: 300, h: 10, frames: [{ chunks: [] }] })), /300×10/, "a sprite over 256 is refused with its size");
  }

  // ---------- palettes ----------
  {
    const cols = ["#000000", "#ff0000", "#00ff0080", "#0000ff", "#fedcba"];
    for (const fmt of ["gpl", "pal", "act", "hex"]) {
      const e = F.encodePalette(fmt, cols, "Mine");
      check(e.bytes instanceof Uint8Array && e.ext === fmt && typeof e.mime === "string", "encodePalette " + fmt + " shape");
      const r = await F.parsePalette("mine." + fmt, e.bytes);
      const exp = fmt === "gpl" || fmt === "hex" ? cols : cols.map(c => c.slice(0, 7));  // only gpl and hex carry alpha
      eq(r.colors, exp, "palette " + fmt + " round trip"); eq(r.format, fmt, "palette " + fmt + " format");
    }
    eq((await F.parsePalette("mine.gpl", F.encodePalette("gpl", cols, "Mine").bytes)).name, "Mine", "the GPL name comes from its Name: line");
    const gplText = Buffer.from(F.encodePalette("gpl", cols, "Mine").bytes).toString();
    check(/^GIMP Palette\nName: Mine\nColumns: 0\nChannels: RGBA\n#\n  0   0   0 255\t000000\n/.test(gplText) && /\n  0 255   0 128\t00ff0080\n/.test(gplText), "GPL is written in Aseprite's shape with RGBA channels", JSON.stringify(gplText));
    check(!/Channels/.test(Buffer.from(F.encodePalette("gpl", ["#ffffff"], "w").bytes).toString()), "GPL without alpha has no Channels line");
    check(Buffer.from(F.encodePalette("pal", cols, "x").bytes).toString().startsWith("JASC-PAL\n0100\n5\n0 0 0\n255 0 0\n"), "JASC-PAL shape");
    eq(Buffer.from(F.encodePalette("hex", cols).bytes).toString(), "000000\nff0000\n00ff0080\n0000ff\nfedcba\n", "hex shape: no #, alpha only when needed");
    const act = F.encodePalette("act", cols).bytes;
    check(act.length === 772 && act[3] === 255 && act[768] === 0 && act[769] === 5 && act[770] === 255 && act[771] === 255 && act[15] === 0, "ACT: 768 bytes padded with black, count and 0xFFFF appended");
    check(F.encodePalette("act", Array.from({ length: 256 }, (_, i) => F.rgbaToHex(i, 0, 0))).bytes.length === 768, "ACT with 256 colours has no trailer");
    await throws(() => Promise.resolve(F.encodePalette("png", cols)), /Unknown palette format/, "encodePalette rejects an unknown format");
    const txt = s => Buffer.from(s, "utf8");
    const gpl = await F.parsePalette("/some/dir/Endesga 32.gpl", txt("GIMP Palette\nName: Endesga-ish\nColumns: 16\nChannels: RGBA\n#\n  0   0   0 255\tblack\n255   0   0 128\tred half\n\n# a comment\n 10  20  30 255 named 7\n"));
    eq([gpl.name, gpl.colors, gpl.format], ["Endesga-ish", ["#000000", "#ff000080", "#0a141e"], "gpl"], "a GPL with Channels: RGBA and names");
    const gpl2 = await F.parsePalette("db32.gpl", txt("GIMP Palette\r\nName: DB32\r\nColumns: 8\r\n#\r\n0 0 0\tBlack\r\n34 32 52 1\r\n255 255 255\r\n"));
    eq(gpl2.colors, ["#000000", "#222034", "#ffffff"], "a GPL without Channels: a numeric 4th column is a name, CRLF fine");
    const jasc = await F.parsePalette("pal.pal", txt("JASC-PAL\r\n0100\r\n3\r\n0 0 0\r\n255 128 0\r\n1 2 3 4\r\n"));
    eq(jasc.colors, ["#000000", "#ff8000", "#01020304"], "a JASC-PAL with CRLF and a tolerated alpha");
    const riff = Buffer.concat([txt("RIFF"), Buffer.from([0, 0, 0, 0]), txt("PAL data"), Buffer.from([12, 0, 0, 0, 0, 3, 2, 0, 1, 2, 3, 0, 4, 5, 6, 0])]);
    eq((await F.parsePalette("win.pal", riff)).colors, ["#010203", "#040506"], "a RIFF .pal");
    const actBytes = new Uint8Array(772); actBytes.set([1, 2, 3, 4, 5, 6, 7, 8, 9]); actBytes[769] = 3; actBytes[770] = 255; actBytes[771] = 255;
    eq((await F.parsePalette("a.act", actBytes)).colors, ["#010203", "#040506", "#070809"], "an ACT with the trailing count");
    const full = (await F.parsePalette("a.act", actBytes.subarray(0, 768))).colors; check(full.length === 256 && full[2] === "#070809" && full[255] === "#000000", "an ACT without the trailer is all 256");
    eq((await F.parsePalette("lospec.hex", txt("ff0000\n00ff00\r\n0000ff80\n"))).colors, ["#ff0000", "#00ff00", "#0000ff80"], "a Lospec hex list without #");
    eq((await F.parsePalette("lospec.hex", txt("; comment\n// another\n# a comment too\n#ff0000\n#00FF00, 0x0000ff  ABCDEF\n\n#123456ff\n"))).colors, ["#ff0000", "#00ff00", "#0000ff", "#abcdef", "#123456"], "a hex list with #, 0x, comments, commas");
    eq((await F.parsePalette("paint.txt", txt("; paint.net Palette File\n80FF0000\nFF00FF00\n"))).colors, ["#ff000080", "#00ff00"], "Paint.NET AARRGGBB lines");
    eq((await F.parsePalette("mystery", txt("GIMP Palette\n#\n1 2 3\n"))).colors, ["#010203"], "an unknown extension is sniffed (GPL)");
    eq((await F.parsePalette("mystery.dat", txt("JASC-PAL\n0100\n1\n9 8 7\n"))).colors, ["#090807"], "an unknown extension is sniffed (JASC)");
    eq((await F.parsePalette("mystery.bin", actBytes)).colors.length, 3, "a 772-byte unknown file is an ACT");
    eq((await F.parsePalette("mystery", txt("aabbcc ddeeff"))).colors, ["#aabbcc", "#ddeeff"], "an unknown text file is read as hex colours");
    const fromAse = await F.parsePalette("rt.aseprite", zipped); eq([fromAse.colors, fromAse.format, fromAse.name], [src.palette, "aseprite", "rt"], "the palette of an .aseprite file");
    eq((await F.parsePalette("rt.ase", zipped)).format, "aseprite", ".ase too");
    await throws(() => F.parsePalette("empty.gpl", txt("GIMP Palette\n#\n")), /No colours/, "a GPL without colours throws");
    await throws(() => F.parsePalette("junk.xyz", new Uint8Array([0, 1, 2, 3, 200, 201])), /Cannot read junk.xyz/, "an unknown binary file throws a readable error");
    await throws(() => F.parsePalette("bad.aseprite", txt("nope")), /not an Aseprite file/, "an .aseprite that is not one throws");
    const many = Array.from({ length: 300 }, (_, i) => F.rgbaToHex(i & 255, i >> 8, 0)).join("\n");
    eq((await F.parsePalette("many.hex", txt(many))).colors.length, 256, "never more than 256 colours");
    const data = new Uint8ClampedArray([1, 2, 3, 255, 1, 2, 3, 255, 0, 0, 0, 0, 1, 2, 3, 128, 9, 9, 9, 255]);
    eq(F.uniqueColors(data), ["#010203", "#01020380", "#090909"], "uniqueColors: reading order, duplicates dropped, transparent skipped");
    eq(F.uniqueColors(data, 2), ["#010203", "#01020380"], "uniqueColors honours max");
  }

  // ---------- sheets ----------
  {
    const d = F.newDoc({ w: 10, h: 6, name: "hero" }); d.frames = Array.from({ length: 5 }, (_, i) => ({ duration: 100 + i })); d.cels = [d.frames.map(() => null)];
    d.tags = [{ name: "idle", from: 0, to: 1, direction: "forward", repeat: 0, color: "#ff0000" }, { name: "run", from: 1, to: 3, direction: "pingpong-reverse", repeat: 2, color: "#00ff00" }];
    const row = F.sheetLayout(d, { mode: "row", padding: 2 });
    eq([row.w, row.h, row.frames.map(f => [f.index, f.x, f.y])], [58, 6, [[0, 0, 0], [1, 12, 0], [2, 24, 0], [3, 36, 0], [4, 48, 0]]], "sheetLayout row with padding");
    const grid = F.sheetLayout(d, { mode: "grid", columns: 2 });
    eq([grid.w, grid.h, grid.frames.map(f => [f.index, f.x, f.y])], [20, 18, [[0, 0, 0], [1, 10, 0], [2, 0, 6], [3, 10, 6], [4, 0, 12]]], "sheetLayout grid of 2 columns");
    eq(F.sheetLayout(d, { mode: "grid" }).w, 30, "grid without columns is about square");
    const byTag = F.sheetLayout(d, { mode: "rows-by-tag", padding: 1 });
    eq([byTag.w, byTag.h, byTag.frames.map(f => [f.index, f.x, f.y, f.tag || ""])], [32, 20, [[0, 0, 0, "idle"], [1, 11, 0, "idle"], [1, 0, 7, "run"], [2, 11, 7, "run"], [3, 22, 7, "run"], [4, 0, 14, ""]]], "sheetLayout rows-by-tag: a row a tag, the untagged frame last");
    eq(F.sheetLayout(F.newDoc({ w: 3, h: 3 }), { mode: "rows-by-tag" }).frames, [{ index: 0, x: 0, y: 0 }], "rows-by-tag without tags is one row");
    const js = F.sheetJson(d, row, "hero.png");
    eq(Object.keys(js.frames), ["hero 0.aseprite", "hero 1.aseprite", "hero 2.aseprite", "hero 3.aseprite", "hero 4.aseprite"], "sheetJson frame keys");
    eq(js.frames["hero 1.aseprite"], { frame: { x: 12, y: 0, w: 10, h: 6 }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: 10, h: 6 }, sourceSize: { w: 10, h: 6 }, duration: 101 }, "sheetJson frame entry");
    eq([js.meta.app, js.meta.version, js.meta.image, js.meta.format, js.meta.size, js.meta.scale, js.meta.slices], ["Broken State pixel studio", "1.0", "hero.png", "RGBA8888", { w: 58, h: 6 }, "1", []], "sheetJson meta");
    eq(js.meta.frameTags, [{ name: "idle", from: 0, to: 1, direction: "forward", color: "#ff0000ff" }, { name: "run", from: 1, to: 3, direction: "pingpong_reverse", repeat: "2", color: "#00ff00ff" }], "sheetJson frameTags in Aseprite's names");
    eq(js.meta.layers, [{ name: "Layer 1", opacity: 255, blendMode: "normal" }], "sheetJson layers");
    const js2 = F.sheetJson(d, byTag);
    check(Object.keys(js2.frames).length === 6 && "hero (run) 1.aseprite" in js2.frames && js2.meta.image === "hero.png", "a frame in two tags gets a second key with its tag", J(Object.keys(js2.frames)));
  }

  // ---------- GIF ----------
  {
    const f1 = new Uint8ClampedArray(3 * 2 * 4), f2 = new Uint8ClampedArray(3 * 2 * 4);
    f1.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 255, 255]);
    f2.set([0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 9, 9, 9, 255, 9, 9, 9, 255, 9, 9, 9, 255]);
    const gif = F.encodeGif([{ data: f1, duration: 100 }, { data: f2, duration: 5 }], 3, 2, { scale: 2, loop: 0 });
    const g = parseGif(gif);
    eq([g.sig, g.w, g.h, g.packed & 0x80, g.tableSize, g.loop, g.frames.length, g.trailer], ["GIF89a", 6, 4, 0x80, 8, 0, 2, true], "GIF89a header, scaled size, global table of 8, loop forever, two images, trailer");
    eq(g.frames.map(f => [f.gce.delay, f.gce.disposal, f.gce.transparentFlag]), [[10, 2, 1], [2, 2, 0]], "delays in 1/100 s (min 2), restore to background, transparency only where there are holes");
    const rgbAt = (fr, x, y) => fr.indices[y * fr.w + x] === fr.gce.transparentIndex && fr.gce.transparentFlag ? "t" : g.table[fr.indices[y * fr.w + x]].join(",");
    eq([rgbAt(g.frames[0], 0, 0), rgbAt(g.frames[0], 1, 1), rgbAt(g.frames[0], 2, 0), rgbAt(g.frames[0], 4, 1), rgbAt(g.frames[0], 5, 3)], ["255,0,0", "255,0,0", "0,255,0", "t", "255,255,255"], "frame 1 decodes to its colours, upscaled 2×, the hole transparent");
    eq([rgbAt(g.frames[1], 0, 0), rgbAt(g.frames[1], 5, 3)], ["0,255,0", "9,9,9"], "frame 2 decodes too");
    check(g.frames.every(f => f.minCode === 3 && f.w === 6 && f.h === 4 && f.x === 0 && f.y === 0), "minimum code size 3 for 8 colours, full-size images");
    const loop3 = parseGif(F.encodeGif([{ data: f2, duration: 100 }], 3, 2, { loop: 3 })); eq([loop3.loop, loop3.w, loop3.h], [3, 3, 2], "loop count and scale 1");
    const big = new Uint8ClampedArray(20 * 20 * 4); for (let i = 0; i < 400; i++) big.set([i & 255, i >> 3, (i * 7) & 255, 255], i * 4);
    const q = parseGif(F.encodeGif([{ data: big, duration: 40 }], 20, 20));
    check(q.tableSize === 256 && q.frames[0].indices.length === 400 && q.frames[0].indices.every(i => i < 256) && q.frames[0].minCode === 8, "400 colours are quantised to a 256-colour table");
    const near = q.frames[0].indices.every((ix, i) => { const c = q.table[ix]; return Math.abs(c[0] - (i & 255)) + Math.abs(c[1] - (i >> 3)) + Math.abs(c[2] - ((i * 7) & 255)) < 120; });
    check(near, "the quantised colours stay near the originals");
    big[3] = 0; const q2 = parseGif(F.encodeGif([{ data: big, duration: 40 }], 20, 20));
    check(q2.tableSize === 256 && q2.frames[0].gce.transparentFlag === 1 && q2.frames[0].indices[0] === q2.frames[0].gce.transparentIndex && q2.frames[0].gce.transparentIndex === 255, "with a hole the table keeps 255 colours and a transparent slot");
    const two = new Uint8ClampedArray(4 * 4 * 4); two.fill(255); const t2 = parseGif(F.encodeGif([{ data: two, duration: 10 }], 4, 4));
    check(t2.tableSize === 2 && t2.frames[0].minCode === 2 && t2.frames[0].indices.every(i => i === 0), "one colour: a 2-entry table and a minimum code size of 2");
    const long = new Uint8ClampedArray(200 * 100 * 4); for (let i = 0; i < 20000; i++) big && long.set([(i * 37) & 255, (i * 11) & 255, (i * 3) & 255, 255], i * 4);
    const ql = parseGif(F.encodeGif([{ data: long, duration: 10 }], 200, 100));
    check(ql.frames[0].indices.length === 20000 && ql.tableSize === 256, "a 200×100 frame with thousands of colours encodes (the LZW table fills and clears)");
  }

  // ---------- Aseprite's own test sprites (optional) ----------
  {
    const dir = process.env.BS_ASE_SAMPLES || DEFAULT_SAMPLES, isDefault = !process.env.BS_ASE_SAMPLES;
    let canFetch = isDefault;
    const load = name => {
      const file = path.join(dir, name);
      if (!fs.existsSync(file) && canFetch) {
        try { fs.mkdirSync(dir, { recursive: true }); const r = spawnSync("curl", ["-sSf", "--connect-timeout", "5", "-m", "20", "-o", file, SAMPLE_URL + name], { stdio: "ignore" }); if (r.status !== 0) { canFetch = false; try { fs.unlinkSync(file); } catch (e) { /* nothing written */ } } }
        catch (e) { canFetch = false; }
      }
      if (!fs.existsSync(file)) { console.log("skip " + name + ": not in " + dir + (isDefault ? " and not downloaded" : "")); return null; }
      return fs.readFileSync(file);
    };
    const sample = async (name, fn) => { const b = load(name); if (!b) return; try { await fn(await F.decodeAseprite(b, { name })); } catch (e) { check(false, name, e.message); } };
    await sample("abcd.aseprite", d => {
      eq([d.w, d.h, d.frames.length, d.layers.map(l => l.name), d.palette.length], [32, 32, 1, ["a", "b", "c", "d"], 5], "abcd: four layers a, b, c, d, 32×32, indexed with 5 colours");
      eq(d.cels.map(r => trimBox(r[0], 32, 32)), [[5, 5, 5, 7], [21, 3, 5, 9], [5, 20, 4, 7], [21, 18, 5, 9]], "abcd: each letter's cel sits where the file puts it");
      check(d.cels.every(r => F.uniqueColors(r[0].data).every(c => d.palette.includes(c))), "abcd: every colour is in the palette");
    });
    await sample("2f-index-3x3.aseprite", d => {
      eq([d.w, d.h, d.frames.length, d.layers.length, d.transparentIndex, d.cels[0].every(Boolean)], [3, 3, 2, 1, 21, true], "2f-index-3x3: two 3×3 indexed frames, transparent index 21");
      check(d.cels[0].every(c => F.uniqueColors(c.data).every(x => d.palette.includes(x))), "2f-index-3x3: the colours come from the palette");
    });
    await sample("groups3abc.aseprite", d => {
      eq(d.layers.map(l => l.name + (l.visible ? "+" : "-")), ["a+", "b+", "c+", "a+", "b-", "c+", "a-", "b-", "c-"], "groups3abc: three groups of a, b, c; a hidden layer and a hidden group");
      eq(d.cels.map(r => trimBox(r[0], 9, 11)), [[0, 0, 3, 3], [3, 0, 3, 3], [6, 0, 3, 3], [0, 4, 3, 3], [3, 4, 3, 3], [6, 4, 3, 3], [0, 8, 3, 3], [3, 8, 3, 3], [6, 8, 3, 3]], "groups3abc: the cels follow the file's layer indices past the groups");
    });
    await sample("tags3.aseprite", d => {
      eq(d.tags.map(t => [t.name, t.from, t.to, t.direction]), [["forward", 0, 3, "forward"], ["reverse", 4, 7, "reverse"], ["pingpong", 8, 11, "pingpong"]], "tags3: three tags over 12 frames");
      check(d.frames.length === 12 && d.cels[0].every(c => c && J(c.data) === J(d.cels[0][0].data)), "tags3: layer a's linked cels all equal frame 0");
    });
    await sample("link.aseprite", d => {
      check(d.frames.length === 2 && d.layers.length === 3 && J(d.cels[1][1].data) === J(d.cels[1][0].data) && J(d.cels[2][1].data) === J(d.cels[2][0].data), "link: L2 and L3's second cels are copies of the first");
      check(J(d.cels[0][1].data) !== J(d.cels[0][0].data) && d.tags.length === 1, "link: L1's second cel is its own; one tag");
    });
    await sample("point4frames.aseprite", d => {
      eq([d.frames.length, d.w, d.h, d.layers.map(l => l.name), d.cels[0].map(c => trimBox(c, 16, 16)), d.cels[1].map(c => c ? 1 : null)], [4, 16, 16, ["a", "b"], [[0, 0, 5, 5], [4, 4, 5, 5], [7, 7, 5, 5], [11, 11, 5, 5]], [null, 1, 1, null]], "point4frames: a point moving over four frames, layer b in the middle two");
    });
    await sample("1empty3.aseprite", d => {
      eq([d.frames.length, d.cels.map(r => r.map(c => c ? 1 : 0)), d.tags.map(t => t.name + t.from + t.to)], [3, [[1, 0, 1], [1, 0, 1]], ["a01", "b22"]], "1empty3: frame 1 of 3 is empty on both layers");
    });
  }

  console.log("\n" + (fails ? fails + " of " + (passes + fails) + " checks failed" : "all " + passes + " format checks passed"));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log("FAIL unexpected: " + (e && e.stack || e)); process.exit(1); });
