// Draws the app icon (a 16x16 pixel-art skull) and writes icons/icon.png (256 px) and icons/icon.ico
// (16, 24, 32, 48, 64 and 256 px). No dependencies: PNG and ICO are written by hand with Node's zlib.
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

// Nearest-neighbour scale to size x size RGBA (top row first).
function raster(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = COLORS[ART[Math.floor((y * N) / size)][Math.floor((x * N) / size)]];
      px.set(c, (y * size + x) * 4);
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
function png(size) {
  const px = raster(size);
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
fs.writeFileSync(path.join(out, "icon.ico"), ico([16, 24, 32, 48, 64, 256]));
console.log(`Wrote ${path.join(out, "icon.png")} and icon.ico`);
