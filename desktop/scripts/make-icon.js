// Draws the app icon (a 16x16 pixel-art skull) and writes icons/icon.png (256 px) and icons/icon.ico
// (16, 24, 32, 48, 64 and 256 px). No dependencies: PNG and ICO are written by hand with Node's zlib.
// Also the web app's icons in ../prototype/icons (manifest.webmanifest, index.html), from the same art so the two never
// drift: 192 and 512 as the desktop icon (transparent corners), a maskable 512 and the 180 px apple-touch-icon
// (both opaque, see WEB below), and favicon.ico (the desktop .ico as is; its 16 px entry is the art pixel for pixel).
//   node scripts/make-icon.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ART = [
  "..kkkkkkkkkkkk..",
  ".kkkkkkkkkkkkkk.",
  "kkkkwwwwwwwwkkkk",
  "kkkwwhhwwwwwwkkk",
  "kkwwhwwwwwwwwwkk",
  "kkwwwwwwwwwwwwkk",
  "kkweeewwwweeewkk",
  "kkweerwwwwreewkk",
  "kkweeewwwweeewkk",
  "kkwwwwweewwwwskk",
  "kkswwwweewwwsskk",
  "kkksswwwwwwsskkk",
  "kkkkwswswswskkkk",
  "kkkkwswswswskkkk",
  ".kkkkkkkkkkkkkk.",
  "..kkkkkkkkkkkk..",
];
const COLORS = {
  ".": [0, 0, 0, 0],
  k: [0x1b, 0x1e, 0x23, 255], // panel dark
  w: [0xe6, 0xe2, 0xd8, 255], // bone
  h: [0xff, 0xfd, 0xf4, 255], // highlight
  s: [0xa9, 0xa3, 0x92, 255], // bone in shade
  e: [0x0c, 0x0d, 0x10, 255], // eye socket, nose
  r: [0xe2, 0x68, 0x5f, 255], // the glint in the eye
};
const N = ART.length;

// Nearest-neighbour scale to size x size RGBA (top row first). opts.cell: whole screen pixels per art pixel, the art
// centred in the square (a size that is not a multiple of 16 stays crisp, every art pixel the same width); opts.bg:
// what shows where the art is transparent or absent (an opaque icon). Without opts: the art fills the square, as before.
function raster(size, opts) {
  const px = Buffer.alloc(size * size * 4);
  const cell = opts && opts.cell, off = cell ? Math.floor((size - cell * N) / 2) : 0;
  const bg = (opts && opts.bg) || COLORS["."];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ax = cell ? Math.floor((x - off) / cell) : Math.floor((x * N) / size), ay = cell ? Math.floor((y - off) / cell) : Math.floor((y * N) / size);
      const c = ax >= 0 && ay >= 0 && ax < N && ay < N ? COLORS[ART[ay][ax]] : bg;
      px.set(c[3] ? c : bg, (y * size + x) * 4);
    }
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, opts) {
  const px = raster(size, opts);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); // filter byte 0 per row
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; // 8 bit RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// Classic 32-bit BMP entry for the small sizes (every Windows tool reads these); bottom row first, plus the 1-bit mask.
function dib(size) {
  const px = raster(size);
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0); head.writeInt32LE(size, 4); head.writeInt32LE(size * 2, 8); head.writeUInt16LE(1, 12); head.writeUInt16LE(32, 14);
  head.writeUInt32LE(size * size * 4, 20);
  const xor = Buffer.alloc(size * size * 4);
  const maskRow = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(maskRow * size);
  for (let y = 0; y < size; y++) {
    const dst = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4, o = (dst * size + x) * 4;
      xor[o] = px[i + 2]; xor[o + 1] = px[i + 1]; xor[o + 2] = px[i]; xor[o + 3] = px[i + 3]; // BGRA
      if (px[i + 3] === 0) and[dst * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([head, xor, and]);
}

function ico(sizes) {
  const images = sizes.map((s) => (s >= 256 ? png(s) : dib(s)));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(images[i].length, 8); e.writeUInt32LE(offset, 12);
    offset += images[i].length;
    return e;
  });
  return Buffer.concat([header, ...dir, ...images]);
}

const out = path.join(__dirname, "..", "icons");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "icon.png"), png(256));
const icoFile = ico([16, 24, 32, 48, 64, 256]);
fs.writeFileSync(path.join(out, "icon.ico"), icoFile);
console.log(`Wrote ${path.join(out, "icon.png")} and icon.ico`);

// The web app's. The maskable one is cropped by the launcher to a circle, squircle or rounded square that only
// promises the middle 80% (a circle of radius 205 in 512): on the panel colour edge to edge, the skull's bone (12 of
// the 16 art pixels across) at 22 px an art pixel is 264 px square, its corners inside that circle. iOS fills a
// transparent apple-touch-icon with black and rounds the corners itself: opaque, 10 px an art pixel with a margin.
const PANEL = COLORS.k;
const WEB = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-512.png", 512, { cell: 22, bg: PANEL }],
  ["apple-touch-icon.png", 180, { cell: 10, bg: PANEL }],
];
const web = path.join(__dirname, "..", "..", "prototype", "icons");
fs.mkdirSync(web, { recursive: true });
for (const [name, size, opts] of WEB) fs.writeFileSync(path.join(web, name), png(size, opts));
fs.writeFileSync(path.join(web, "favicon.ico"), icoFile);
console.log(`Wrote ${WEB.map(([n]) => n).join(", ")} and favicon.ico in ${web}`);
