// Snow on the buildings (ui/roofsnow.js; ui/isoview.js roofSprite / roofSnow / snowPrims), the user's request
// 2026-10-23: "In raid and base view: Winter has snow on buildings.":
// - the amount: the snow lying in quarters (b.snowLie first, else the tile's snow cover; a base's map: the base's
//   tile), none below a dusting and none with nothing to go by;
// - the sprites on stub canvases: a roof white with snow by the depth, more on a flat tar roof than on shingles, its
//   outside edges barer than its middle; none without snow (the old sprite, the old key); walls, fences, sandbags, tents
//   and the rest out in the open snow-topped; the cache keyed by the snow;
// - the raid's map and the base's map drawn: snow on the buildings while snow lies, none in summer, nothing painted
//   again from one frame to the next with the same snow (the snow is only in the cache keys).
// Usage: node tools/roofsnowtest.js
import { battles } from "./isobattles.js";
import * as R from "../src/ui/roofsnow.js";
import { seasonOfDay, weatherAt } from "../src/sim/weather.js";
import { hub } from "../src/sim/world.js";
import { openBaseMap } from "../src/sim/basemap.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();
const dayIn = (key, n = 15) => { for (let d = 0; d < 200; d++) { const s = seasonOfDay(d); if (s.key === key && s.dayOfSeason === n) return d; } return -1; };
// A white of snow: light and a little cool (not the doors' cream trim or a pump's white band).
const isSnow = (r, g, bl) => r > 200 && g > 205 && bl > 210 && bl >= r - 4;
const snowPx = (img) => { let n = 0; if (!img) return 0; const a = img.data; for (let i = 0; i < a.length; i += 4) if (a[i + 3] === 255 && isSnow(a[i], a[i + 1], a[i + 2])) n++; return n; };

// ---------- 1. the amount ----------
console.log("The snow lying");
{
  check(R.snowQuarter(0) === 0 && R.snowQuarter(0.1) === 0 && R.snowQuarter(R.SNOW_MIN) === 0.25 && R.snowQuarter(0.5) === 0.5 && R.snowQuarter(0.8) === 0.75 && R.snowQuarter(3) === 1, "in quarters from a dusting (SNOW_MIN) up, at most 1");
  const { st, b } = battles(7, ["raid"])[0];
  let snowy = -1, clear = -1;
  for (let d = dayIn("winter", 1); d < dayIn("winter", 28); d++) {
    const c = weatherAt(st, b.tileId, d * 24 + 12).snowCover || 0;
    if (c >= 0.3 && snowy < 0) snowy = d;
  }
  clear = dayIn("summer");
  const at = (d, bb = b) => { st.hour = d * 24 + 12; return R.snowOnFor(st, bb); };
  check(at(clear) === 0, "summer: no snow");
  check(snowy >= 0 && at(snowy) > 0 && at(snowy) === R.snowQuarter(weatherAt(st, b.tileId, snowy * 24 + 12).snowCover), `winter with snow on the tile (day ${snowy}): its cover in quarters (${at(snowy)})`);
  check(at(clear, { ...b, snowLie: 0.75 }) === 0.75, "the battle's own snow lying (b.snowLie, sim/ponds.js) goes first");
  st.hour = 5;
  check(R.snowOnFor({ hour: 5 }, { tileId: null }) === 0 && R.snowOnFor({}, null) === 0, "nothing to go by (no weather, no tile): none, no throw");
}

// ---------- 2. the sprites ----------
console.log("The sprites");
const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
let imgs = null, nan = 0;
const silent = (cv) => new Proxy({ createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: (img) => { cv.img = img; if (imgs) imgs.push(img); }, measureText: (t) => ({ width: String(t).length * 6 }) }, {
  get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; }),
  set: (o, k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nan++; o[k] = v; return true; },
});
const cvs = (w, h) => { const cv = { width: w, height: h, toDataURL: () => "data:," }; const g = silent(cv); cv.getContext = () => g; return cv; };
globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
ISO.setIsoCanvas(cvs);
{
  const P = ISO.snowProbe, B = ISO.iso.builds;
  const roof = (mat, edges, sn, v = 0) => snowPx(P.roofSprite(mat, 34, edges, false, sn, v).cv.img);
  const dry = P.roofSprite(0, 34, 15, false), dry2 = P.roofSprite(0, 34, 15, false, 0, 3);
  check(snowPx(dry.cv.img) === 0 && dry2 === dry, "no snow: the old roof (no white, the same cached sprite whatever the variant)");
  const tar = [0.25, 0.5, 0.75, 1].map((sn) => roof(0, 0, sn));
  check(tar[0] > 20 && tar.every((n, i) => !i || n >= tar[i - 1]) && tar[3] > tar[0] * 1.5, `a flat tar roof: white with snow, more the deeper it lies (${tar.join(", ")} px by the quarter)`);
  const area = (() => { const im = dry.cv.img; let n = 0; for (let i = 3; i < im.data.length; i += 4) if (im.data[i] === 255) n++; return n; })();
  check(tar[3] > area * 0.6, `deep snow covers most of it (${tar[3]} of ${area} px)`);
  const sh = roof(2, 0, 0.5), mt = roof(1, 0, 0.5), cc = roof(3, 0, 0.5);
  check(sh < tar[1] && mt < tar[1] && Math.abs(cc - tar[1]) < tar[1] * 0.25, `pitched roofs hold less (at half: tar ${tar[1]}, concrete ${cc}, metal ${mt}, shingles ${sh})`);
  const edge = roof(0, 15, 0.25), mid = roof(0, 0, 0.25);
  check(edge < mid, `a roof's outside edges barer than its middle at a dusting (${edge} px with all four edges, ${mid} with none)`);
  const vs = [0, 1, 2, 3].map((v) => P.roofSprite(0, 34, 0, false, 0.5, v));
  check(new Set(vs).size === 4 && new Set(vs.map((s) => s.cv.img.data.join(""))).size === 4, "four drift variants (by the cell): four different pictures");
  const n0 = B.sprites;
  P.roofSprite(0, 34, 0, false, 0.5, 2); P.roofSprite(0, 34, 0, false, 1, 0);
  check(B.sprites === n0, "asked again: from the cache, nothing painted");
  // Props out in the open.
  const o = (extra = {}) => ({ v: 1, alt: 0, j: 0, n: null, top: 34, mat: 0, dmg: 0, dir: null, f: "", wet: "", wl: 0, snow: 0, ...extra });
  const kinds = [["sandbag", o({ j: 3 })], ["fence", o({ j: 3 })], ["palisade", o({ j: 3, mat: 1 })], ["tent", o({ j: 4 })], ["wall", o()], ["crate", o({ v: 2 })], ["barricade", o()], ["car", o()], ["boulder", o()], ["roof", o()]];
  const res = kinds.map(([k, oo]) => {
    const a = snowPx(P.sprite(k, oo, false).cv.img), s = P.sprite(k, { ...oo, sn: 0.75 }, false), c = snowPx(s.cv.img);
    return { k, a, c, again: P.sprite(k, { ...oo, sn: 0.75 }, false) === s };
  });
  check(res.every((r) => r.k === "car" || r.a === 0), `no snow: none on them (${res.filter((r) => r.a).map((r) => r.k).join(", ") || "none"})`);
  check(res.every((r) => r.c > r.a + 3), `snow on their tops: ${res.map((r) => `${r.k} ${r.c}`).join(", ")}`);
  check(res.every((r) => r.again), "cached by the snow (o.sn in the key)");
  check(kinds.every(([k]) => P.SNOW_ON.has(k)) && !["tree", "bush", "firepit", "well", "hivewall", "crag", "rise", "table"].some((k) => P.SNOW_ON.has(k)), "SNOW_ON: the walls and the yard's things, not trees, fires, a well's mouth, the hive, the hills or furniture");
}

// ---------- 3. the raid's map and the base's map ----------
// Draws a frame at that hour; the snow px in the sprites painted in it (small: not the ground, the fog or the skirt).
UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent({}) });
let clock = 1e6;
const frame = (st, hour) => {
  st.hour = hour;
  imgs = [];
  const s0 = ISO.iso.builds.sprites, l0 = ISO.iso.builds.looks;
  let err = "", snow = 0;
  try { clock += 50; UI.drawCombat(st, clock); } catch (e) { err = e.stack.split("\n").slice(0, 3).join(" "); }
  for (const im of imgs) if (im.width <= 160 && im.height <= 200) snow += snowPx(im);
  imgs = null;
  return { err, sprites: ISO.iso.builds.sprites - s0, looks: ISO.iso.builds.looks - l0, snow };
};
console.log("The raid's map");
{
  const { st, b } = battles(7, ["raid"])[0];
  st.combat = b;
  delete b.snowLie;
  const h0 = dayIn("summer") * 24 + 12;
  const sum = frame(st, h0), sum2 = frame(st, h0 + 1);
  check(!sum.err && !nan, `a raid drawn in summer, no error or NaN${sum.err ? ` (${sum.err})` : ""}`);
  check(sum.snow < 40, `summer: no snow on the buildings (${sum.snow} white px)`);
  check(sum2.sprites === 0 && sum2.looks === 0, `the next hour: nothing painted again (${sum2.sprites} sprites, ${sum2.looks} looks)`);
  b.snowLie = 1;
  const deep = frame(st, h0 + 2), deep2 = frame(st, h0 + 3);
  check(!deep.err && deep.looks === 1 && deep.sprites > 0, `snow lying (b.snowLie 1): the looks made again once, new sprites (${deep.sprites})`);
  check(deep.snow > 3000 && deep.snow > sum.snow * 20, `snow on the roofs and walls (${deep.snow} white px)`);
  check(deep2.sprites === 0 && deep2.looks === 0, "the next hour with the same snow: nothing painted again (no per-frame cost)");
  b.snowLie = 0.25;
  const thin = frame(st, h0 + 4);
  check(thin.sprites > 0 && thin.snow > 200 && thin.snow < deep.snow * 0.8, `a dusting (0.25): new sprites, less white (${thin.snow} px)`);
  delete b.snowLie;
  const back = frame(st, h0 + 5);
  check(back.looks === 1 && back.sprites === 0, `the snow gone: the old looks, the old sprites still cached (${back.sprites} painted)`);
}
console.log("The base's map");
{
  const { st } = battles(7, ["field-town"])[0];
  st.combat = null;
  const h = hub(st);
  let wd = -1;
  for (let d = dayIn("winter", 1); d < dayIn("winter", 28) && wd < 0; d++) if ((weatherAt(st, h.tile, d * 24 + 12).snowCover || 0) >= 0.5) wd = d;
  st.hour = wd * 24 + 12;
  const msg = openBaseMap(st, h.id), b = st.combat;
  check(!msg && b && b.layout, `the hub's base map open (${msg || "ok"})`);
  delete b.snowLie; // the base's tile then (a map with no hills has none of its own)
  const sn = R.snowOnFor(st, b);
  check(wd >= 0 && sn >= 0.5, `winter (day ${wd}): the base's tile's snow (${sn})`);
  const roofs = b.cells.filter((c) => c.f === "floor").length;
  const win = frame(st, wd * 24 + 13);
  check(!win.err && roofs > 0 && win.snow > 1500, `snow on its buildings and yard (${win.snow} white px; ${roofs} roofed cells)${win.err ? ` ${win.err}` : ""}`);
  const sum = frame(st, dayIn("summer") * 24 + 12);
  check(!sum.err && sum.snow < win.snow / 20, `the same base in summer: none (${sum.snow} px)`);
}

const ms = Math.round(performance.now() - t0);
console.log(`\n${passed} passed, ${failed} failed (${ms} ms)`);
process.exit(failed ? 1 : 0);
