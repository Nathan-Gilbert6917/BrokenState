// @ts-check
// Writes the Godot rebuild's golden terrain files (tests/golden/) from the prototype's land generator, so the C# port
// in src/BrokenState.Sim can prove its noise terrain matches the prototype's for a seed (exact parity: the same
// mulberry32 dice, the same value noise, the same elevation and thresholds).
//   node tools/hexgolden.js            writes tests/golden/terrain-64x42-seed12345.json (every tile's elevation, the
//                                      terrain and a digest) and terrain-300x150-seed12345.json (the terrain and digest)
// Each tile's elevation is kept (no later pass changes it). Its terrain is kept only where the noise pass decided it:
// a tile a river, a city or a suburb overwrote is "?" (the C# test skips it). The digest is FNV-1a 64 over the
// elevations rounded to 6 decimals, joined by commas, then the terrain letters.
import { writeFileSync, mkdirSync } from "node:fs";
import { Rng } from "../src/sim/rng.js";
import { generateMap } from "../src/sim/mapgen.js";
import { customDef } from "../src/sim/worldsize.js";

const LETTER = { water: "w", plains: "p", forest: "f", hills: "h", mountain: "m", suburb: "s", city: "c" };
const OVERWRITTEN = new Set(["water", "suburb", "city"]);

function build(seed, w, h) {
  const rng = new Rng(seed);
  const map = generateMap(rng, customDef(w, h), { seed });
  const elev = map.tiles.map((t) => Math.round(t.elev * 1e6) / 1e6);
  const terrain = map.tiles.map((t) => (OVERWRITTEN.has(t.terrain) || t.river ? "?" : LETTER[t.terrain])).join("");
  return { seed, width: w, height: h, elev, terrain };
}
function fnv1a64(s) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) h = ((h ^ BigInt(s.charCodeAt(i))) * 0x100000001b3n) & 0xffffffffffffffffn;
  return h.toString(16).padStart(16, "0");
}
const digestOf = (g) => fnv1a64(g.elev.map((e) => e.toFixed(6)).join(",") + "|" + g.terrain);

mkdirSync(new URL("../../tests/golden/", import.meta.url), { recursive: true });
const seed = 12345;
const small = build(seed, 64, 42);
writeFileSync(new URL("../../tests/golden/terrain-64x42-seed12345.json", import.meta.url), JSON.stringify({ ...small, digest: digestOf(small) }));
const big = build(seed, 300, 150);
const { elev: _bigElev, ...bigRest } = big; // the big file keeps the terrain mask and the digest, not 45,000 elevations
writeFileSync(new URL("../../tests/golden/terrain-300x150-seed12345.json", import.meta.url), JSON.stringify({ ...bigRest, digest: digestOf(big) }));
console.log("ok", small.elev.length, "tiles small;", big.terrain.length, "tiles big, digest", digestOf(big));
