// Seasonal trees (ui/seasontrees.js; ui/isoview.js seasonTree / seasonBush; ui/terraindeco.js SEASON_LOOK; ui/render.js
// the forests' flat colour), the user's request 2026-10-23: "In fall the trees should be red orange and brown in
// winter the trees are leaf less and have snow on them.":
// - the style picker: autumn's FALL palette (red, orange, brown, rust) in autumn, some still green in its first days;
//   bare with snow in winter (bare without it when the snow is known not to lie); green in spring and summer; the same
//   style for the same cell every time; a battle's look from the calendar and its tile's snow;
// - the State Map: SEASON_LOOK turns every broadleaf tree and bush (autumn's colours, winter's bare ones, the same size),
//   pines and the rest unchanged; the forests' flat colour by the season;
// - the battle view on stub canvases (a forest field fight): the sprites' cache keyed by the season: a new season paints
//   new tree sprites (autumn's reds and oranges, winter's snow, no green leaves left), the same season again paints
//   nothing new and keeps the cell looks; summer's trees are green.
// Usage: node tools/seasontreestest.js
import { battles } from "./isobattles.js";
import * as S from "../src/ui/seasontrees.js";
import * as T from "../src/ui/terraindeco.js";
import { seasonOfDay, weatherAt, dayIndex } from "../src/sim/weather.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();
// A campaign day index in a season, on its nth day.
const dayIn = (key, n = 15) => { for (let d = 0; d < 200; d++) { const s = seasonOfDay(d); if (s.key === key && s.dayOfSeason === n) return d; } return -1; };

// ---------- 1. the style picker ----------
console.log("The style picker");
{
  const grid = (look) => { const out = []; for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) out.push(S.treeStyle(look, x, y)); return out; };
  check(S.treeSeason("spring", 10) === "green" && S.treeSeason("summer", 20, true) === "green", "spring and summer: green (snow or not)");
  check(S.treeSeason("autumn", 20) === "fall" && S.treeSeason("autumn", 1) === "fall0" && S.treeSeason("autumn", 9) === "fall2" && S.treeSeason("autumn", 10) === "fall", "autumn: fall0..fall2 its first nine days, then fall");
  check(S.treeSeason("winter", 5, true) === "snow" && S.treeSeason("winter", 5, null) === "snow" && S.treeSeason("winter", 5, false) === "bare", "winter: bare with snow (snow lying, or not known), bare without it when none lies");
  const fall = grid("fall"), leaves = new Set(fall.map((s) => s.leaf));
  check(fall.every((s) => s.kind === "fall" && s.leaf >= 0 && s.leaf < S.FALL.length && !s.snow), "late autumn: every tree in a FALL colour");
  check(leaves.size === S.FALL.length && S.FALL_NAMES.slice(0, 3).join() === "red,orange,brown", `the mix: all ${S.FALL.length} colours (${S.FALL_NAMES.join(", ")}) among 1,600 cells`);
  const share = S.FALL.map((_, i) => fall.filter((s) => s.leaf === i).length / fall.length);
  check(share.every((p) => p > 0.15 && p < 0.35), `each colour a fair share: ${share.map((p) => p.toFixed(2)).join(", ")}`);
  const early = grid("fall0"), g0 = early.filter((s) => s.kind === "green").length / early.length, g2 = grid("fall2").filter((s) => s.kind === "green").length / early.length;
  check(Math.abs(g0 - S.FALL_GREEN[0]) < 0.06 && Math.abs(g2 - S.FALL_GREEN[2]) < 0.05 && g2 < g0, `early autumn: some still green (${g0.toFixed(2)} on days 1-3, ${g2.toFixed(2)} on days 7-9)`);
  const stay = early.filter((s, i) => s.kind === "fall" && fall[i].leaf !== s.leaf).length;
  check(!stay, "a tree that has turned keeps its colour as more turn (fall0's colour is fall's)");
  const winter = grid("snow"), bare = grid("bare");
  check(winter.every((s) => s.kind === "bare" && s.snow) && bare.every((s) => s.kind === "bare" && !s.snow), "winter: every tree bare, snow on it while snow lies");
  check(grid("green").every((s) => s.kind === "green" && S.styleKey(s) === ""), "green: the old look (no key of its own: the old sprites)");
  // Deterministic: the same cell the same style, whatever was asked before or in what order.
  const again = []; for (let y = 39; y >= 0; y--) for (let x = 39; x >= 0; x--) again[y * 40 + x] = S.treeStyle("fall", x, y);
  check(again.every((s, i) => S.styleKey(s) === S.styleKey(fall[i])), "deterministic per cell (asked again in reverse order: the same 1,600 styles)");
  const keys = new Set([...fall, ...winter, ...bare].map(S.styleKey));
  check(keys.size === S.FALL.length + 2 && [...keys].every((k) => /^(f\d|bs?)$/.test(k)), `style keys: ${[...keys].sort().join(" ")}`);

  // A battle's look from the calendar and the tile's snow.
  const { st, b } = battles(7, ["field-forest"])[0];
  const at = (d) => { st.hour = d * 24 + 12; return S.treeLookFor(st, b); };
  check(at(dayIn("summer")) === "green" && at(dayIn("spring", 20)) === "green", "a battle in spring or summer: green");
  check(at(dayIn("autumn", 2)) === "fall0" && at(dayIn("autumn", 20)) === "fall", "a battle in autumn: fall0 early, then fall");
  let snowy = -1, clear = -1;
  for (let d = dayIn("winter", 1); d < dayIn("winter", 28); d++) {
    const c = weatherAt(st, b.tileId, d * 24 + 12).snowCover || 0;
    if (c >= 0.3 && snowy < 0) snowy = d;
    if (c < S.SNOW_ON_TREES && clear < 0) clear = d;
  }
  check(snowy >= 0 && at(snowy) === "snow", `winter with snow lying on the tile (day ${snowy}): bare with snow`);
  if (clear >= 0) check(at(clear) === "bare", `winter with no snow lying (day ${clear}): bare, no snow`);
  if (clear >= 0) { st.hour = clear * 24 + 12; check(S.treeLookFor(st, { ...b, snowLie: 0.5 }) === "snow", "the battle's own snow lying (b.snowLie, sim/ponds.js) goes first"); }
  const bare0 = { hour: dayIn("winter", 5) * 24 + 12 };
  check(S.treeLookFor(bare0, { tileId: null }) === "snow", "no weather and no tile to go by: winter means snow");
  let look = null;
  try { look = S.treeLookFor({}, null); } catch { look = "threw"; }
  check(look === "green" || look === "fall0", `a bare state (no hour): day 1's look, no throw (${look})`);
}

// ---------- 2. the State Map ----------
console.log("The State Map");
{
  const L = T.SEASON_LOOK, sets = T.DECO_SETS;
  check(["fall", "fallbush", "bare", "barebush"].every((k) => sets.includes(k)), "the seasons' sprites are in the atlas (fall, fallbush, bare, barebush)");
  // The sprites each look draws in place of another.
  const n = L.spring.length;
  const changed = (look) => { const out = []; for (let i = 0; i < n; i++) if (look[i] !== i) out.push(i); return out; };
  const summer = changed(L.summer), autumn = changed(L.autumn), winter = changed(L.winter), early = changed(L.autumn0);
  check(L.summer === L.spring && summer.length === 2, `spring and summer: only the autumn decals map back to green trees (${summer.length})`);
  check(autumn.length === 3 + 2 + 2, `autumn: the 3 green trees, the 2 autumn decals and the 2 bushes turn (${autumn.length})`);
  check(winter.length === 3 + 2 + 2, `winter: the same 7 go bare (${winter.length})`);
  check(early.length > summer.length && early.length < autumn.length, `early autumn: some turned, some still green (${early.length} of ${autumn.length})`);
  check(new Set(autumn.map((i) => L.autumn[i])).size >= 4, "autumn: at least 4 different turned sprites among them (red, orange, brown, rust)");
  check(winter.every((i) => L.winter[i] !== L.autumn[i]), "winter's sprites differ from autumn's");
  const same = (look) => { let bad = 0; for (let i = 0; i < n; i++) if (look[i] !== i && !autumn.includes(i) && !summer.includes(i)) bad++; return bad; };
  check(!same(L.autumn) && !same(L.winter), "pines, rocks, houses and the rest are drawn as they are");
  const [tw, th] = T.decalSize("tree"), [fw, fh] = T.decalSize("fall"), [bw, bh] = T.decalSize("bare"), [uw, uh] = T.decalSize("bush"), [xw, xh] = T.decalSize("barebush");
  check(tw === fw && th === fh && tw === bw && th === bh && uw === xw && uh === xh, "a turned or bare tree is the size of the green one (it keeps its spot)");
  check(S.mapSeason("autumn", 3) === "autumn0" && S.mapSeason("autumn", 20) === "autumn" && S.mapSeason("winter", 1) === "winter" && S.mapSeason("summer", 4) === "summer" && S.mapSeason("bogus") === "spring", "mapSeason: autumn0 early, then autumn; winter; summer");
  check(S.FOREST_FLAT.autumn && S.FOREST_FLAT.winter && !S.FOREST_FLAT.summer && !S.FOREST_FLAT.spring, "the forests' flat colour: its own in autumn and winter, the terrain's in spring and summer");
}

// ---------- 3. the battle view: sprites by the season ----------
console.log("The battle view");
{
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
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent({}) });
  let clock = 1e6;
  const { st, b } = battles(7, ["field-forest"])[0];
  st.combat = b;
  const trees = b.cells.filter((c) => c.k === "tree").length;
  // Draws a frame on that day; the sprite pictures painted in it (small: not the ground, the fog or the skirt) and
  // their pixels by colour: autumn's (red to orange to brown, warm), green leaves, snow.
  const frame = (d) => {
    st.hour = d * 24 + 12;
    imgs = [];
    const s0 = ISO.iso.builds.sprites, l0 = ISO.iso.builds.looks;
    let err = "";
    try { clock += 50; UI.drawCombat(st, clock); } catch (e) { err = e.stack.split("\n").slice(0, 3).join(" "); }
    const px = { warm: 0, green: 0, snow: 0 };
    for (const im of imgs) {
      if (im.width > 160 || im.height > 200) continue;
      const a = im.data;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i + 3] < 255) continue;
        const r = a[i], g = a[i + 1], bl = a[i + 2];
        if (r > 70 && r > g * 1.45 && g > bl * 0.9) px.warm++;
        else if (g > 35 && g > r * 1.12 && g > bl * 1.25) px.green++;
        else if (r > 200 && g > 205 && bl > 210) px.snow++;
      }
    }
    imgs = null;
    return { err, sprites: ISO.iso.builds.sprites - s0, looks: ISO.iso.builds.looks - l0, px };
  };
  const sum = frame(dayIn("summer")), sum2 = frame(dayIn("summer") + 1);
  check(!sum.err && !nan && trees > 20, `a forest fight (${trees} trees) drawn in summer, no error or NaN${sum.err ? ` (${sum.err})` : ""}`);
  check(sum.px.green > 2000 && sum.px.green > sum.px.warm * 4, `summer: green leaves (${sum.px.green} green px, ${sum.px.warm} warm)`);
  check(sum2.sprites === 0 && sum2.looks === 0, `the next day of summer: no new look, no sprite painted again (${sum2.sprites} sprites, ${sum2.looks} looks)`);
  const aut = frame(dayIn("autumn", 20)), aut2 = frame(dayIn("autumn", 21));
  check(!aut.err && aut.looks === 1 && aut.sprites > 0, `autumn: the looks made again once, new tree sprites painted (${aut.sprites})`);
  check(aut.px.warm > 2000 && aut.px.warm > aut.px.green * 3, `autumn: the new sprites red, orange and brown (${aut.px.warm} warm px, ${aut.px.green} green)`);
  check(aut2.sprites === 0 && aut2.looks === 0, "the next day of autumn: nothing painted again (no per-frame cost: the season is only in the cache keys)");
  // Winter: the snow on the tile as the season's own (find a snowy day).
  let wd = -1;
  for (let d = dayIn("winter", 1); d < dayIn("winter", 28) && wd < 0; d++) if ((weatherAt(st, b.tileId, d * 24 + 12).snowCover || 0) >= 0.3) wd = d;
  const win = frame(wd);
  check(!win.err && win.sprites > 0 && win.looks === 1, `winter (day ${dayIndex(st) + 1}): the looks made again, new sprites (${win.sprites})`);
  check(win.px.snow > 200 && win.px.green < sum.px.green / 10 && win.px.warm < aut.px.warm / 10, `winter: leafless (${win.px.green} green px, ${win.px.warm} warm), snow on them (${win.px.snow} snow px)`);
  const back = frame(dayIn("summer"));
  check(back.looks === 1 && back.sprites <= trees, `back to summer: its looks again; its tree sprites still cached by their season's key (${back.sprites} painted)`);
}

const ms = Math.round(performance.now() - t0);
console.log(`\n${passed} passed, ${failed} failed (${ms} ms)`);
process.exit(failed ? 1 : 0);
