// The ground by the season (sim/seasonground.js; ui/groundlook.js; ui/isoview.js floorColor, flatGroundFor, the hills'
// tops), the user's request 2026-10-23: "In raid and base view: Spring can create random mud on dirt tiles slows
// movement speed. Fall can have the red orange and brown leaves on the ground. Winter has snow on the ground slowing
// movement speed.":
//   1. the rules: the share of the dirt in mud (spring only, more after rain, none frozen), the costs (mud, snow, deep
//      snow), the hover words, the snow's cover, the leaves' density (more under the trees);
//   2. on battle maps: spring's mud in patches on the dirt only, the same map the same mud, none in summer; winter's
//      snow on all the outdoor ground of a fight and a raid (not on a building's floor, not under a frozen pond, whose
//      ice keeps its own cost), b.snowLie on a map with no hills too; nothing on a hive chamber's map; the dice untouched;
//   3. moves: a step into mud, snow and deep snow costs more, for your people and the dead alike (reachable, distField:
//      docs/adr/0001-ai-parity.md), ponds' costs as before;
//   4. the base map (sim/basemap.js openBaseMap): the yard's dirt muddy in spring, snow on it in winter;
//   5. the view on stub canvases: the ground painted with the snow, the mud and autumn's leaves (red, orange, brown
//      under the trees); a new season paints the ground once, the same again nothing (no per-frame cost).
// Usage: node tools/seasongroundtest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, registerCombatHandler, reachable, distField } from "../src/sim/combat.js";
import * as G from "../src/sim/seasonground.js";
import * as P from "../src/sim/ponds.js";
import * as L from "../src/ui/groundlook.js";
import { FALL } from "../src/ui/seasontrees.js";
import { seasonOfDay, weatherAt, dayIndex } from "../src/sim/weather.js";
import { openBaseMap } from "../src/sim/basemap.js";

const SEED = Number(process.argv[2] || 7);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return !!ok; };
const t0 = performance.now();
registerCombatHandler("sg", () => {});
const dayIn = (key, n = 15, from = 0) => { for (let d = from; d < from + 200; d++) { const s = seasonOfDay(d); if (s.key === key && s.dayOfSeason === n) return d; } return -1; };
const world = () => { const st = createWorld({ seed: SEED, factionCount: 6 }); st.started = true; st.hour = 3 * 24 + 12; return st; };
const st = world();
const h = hub(st);
const people = atBase(st, h.id).slice(0, 2).map((s) => s.id);
const fight = (tile, extra = {}) => createBattle(st, { tile, baseId: h.id, fighterIds: people, enemy: { kind: "zombies", count: 2, power: 3, name: "T" }, ambush: null, canRetreat: false, handler: "sg", context: {}, ...extra });
const raid = (tile) => createBattle(st, { mode: "raid", tile, baseId: h.id, fighterIds: people, canRetreat: true, ambush: null, handler: "sg", enemy: { kind: "zombies", count: 2, power: 3 }, raid: { heat0: 0 }, context: {} });
const count = (b, k) => b.cells.filter((c) => c.gnd === k).length;

// ---------- 1. the rules ----------
console.log("The rules");
{
  const N = P.PONDS.DRAIN + P.PONDS.MUD;
  check(G.mudShare("summer", 0) === 0 && G.mudShare("autumn", 0) === 0 && G.mudShare("winter", 0) === 0, "mud only in spring");
  check(G.mudShare("spring", 0, true) === 0, "none while the ground is frozen");
  check(Math.abs(G.mudShare("spring", N) - G.MUD.BASE) < 1e-9 && Math.abs(G.mudShare("spring", 0) - (G.MUD.BASE + G.MUD.WET)) < 1e-9 && G.mudShare("spring", 2) > G.mudShare("spring", 5), `spring: ${G.MUD.BASE} of the dirt after a dry spell, up to ${G.MUD.BASE + G.MUD.WET} right after rain, less each dry day`);
  check(G.groundCost({ gnd: "mud" }) === G.MUD.COST && G.MUD.COST === P.PONDS.COST.mud, `mud: +${G.MUD.COST} a step (a hollow's mud's)`);
  check(G.groundCost({ gnd: "snow", sd: 0.25 }) === G.SNOW.COST && G.groundCost({ gnd: "snow", sd: 0.5 }) === G.SNOW.COST && G.groundCost({ gnd: "snow", sd: 0.75 }) === G.SNOW.DEEP_COST && G.groundCost({ gnd: "snow", sd: 1 }) === G.SNOW.DEEP_COST, `snow: +${G.SNOW.COST} a step, deep snow (${G.SNOW.DEEP}+ cover) +${G.SNOW.DEEP_COST}`);
  check(G.groundCost({}) === 0 && G.groundCost(null) === 0 && G.groundWord({}) === "", "bare ground: no cost, no words");
  const wm = G.groundWord({ gnd: "mud" }), ws = G.groundWord({ gnd: "snow", sd: 0.5 }), wd = G.groundWord({ gnd: "snow", sd: 1 });
  check(/mud/i.test(wm) && /\+0\.5/.test(wm) && /Snow/.test(ws) && /\+0\.25/.test(ws) && /Deep snow/.test(wd) && /\+0\.5/.test(wd) && /dead/.test(wd), `the hover words: "${wm.replace(/<[^>]+>/g, "")}" / "${wd.replace(/<[^>]+>/g, "")}"`);
  check(L.snowShare(0) === 0 && L.snowShare(1) === 1 && L.snowShare(0.25) < L.snowShare(0.5) && L.snowShare(0.25) > 0.3, "the snow's cover on the ground grows with its depth, all of it at full cover");
  check(L.leafBase("green") === 0 && L.leafBase("snow") === 0 && L.leafBase("bare") === 0 && L.leafBase("fall0") > 0 && L.leafBase("fall") > L.leafBase("fall0"), "leaves on the ground in autumn only, more as it goes on");
  const W = 20, cells = Array.from({ length: W * W }, () => ({ k: "open", f: "grass" }));
  cells[10 * W + 10].k = "tree";
  const f = L.leafField({ w: W, h: W, cells }, "fall", "t");
  check(f && f[10 * W + 11] > f[10 * W + 13] && f[10 * W + 13] > f[2 * W + 2] && Math.abs(f[2 * W + 2] - L.leafBase("fall")) < 1e-6, `the leaves thickest under a tree (${f[10 * W + 11].toFixed(2)} beside it, ${f[2 * W + 2].toFixed(2)} away)`);
  check(L.leafField({ w: W, h: W, cells }, "green", "t") === null, "no leaf field out of autumn");
  // A texel: the leaves are FALL's colours, the snow white, the mud dark; a building's floor and water untouched.
  const grass = [74, 88, 52];
  let leaf = 0, other = 0;
  for (let i = 0; i < 4000; i++) { const t = L.groundTexel(grass, { f: "grass" }, i % 64, (i / 64) | 0, 1); if (t === grass) other++; else if (FALL.some((c) => Math.abs(c[0] - t[0] / (t[0] / c[0])) < 1e-6 && t[1] / t[0] - c[1] / c[0] < 1e-6)) leaf++; }
  check(leaf > 1000 && other > 1000, `leaves: ${leaf} texels of 4,000 in FALL's colours at density 1, the rest the ground`);
  check(L.groundTexel(grass, { f: "floor" }, 3, 3, 1) === grass && L.groundTexel(grass, { f: "grass", wet: "ice" }, 3, 3, 1) === grass, "no leaves on a building's floor or a pond");
  const snow = L.groundTexel(grass, { gnd: "snow", sd: 1, f: "grass" }, 5, 5), mud = L.groundTexel([92, 79, 62], { gnd: "mud", f: "dirt" }, 40, 40);
  check(snow[0] > 170 && snow[2] > 180 && mud[0] < 92 && mud[0] > mud[2], `snow pale (${snow.map(Math.round)}), mud dark (${mud.map(Math.round)})`);
}

// ---------- 2. on battle maps ----------
console.log("On battle maps");
let mudTile = null, mudDay = -1;
{
  const hilly = st.tiles.filter((t) => t.terrain === "hills" && t.id !== h.tile).slice(0, 30);
  // A spring day just after rain on a hills tile (its floor dirt).
  for (let d = 0; d < 14 && mudTile == null; d++) for (const t of hilly) {
    st.hour = d * 24 + 12;
    const p = P.pondsOn(st, t.id);
    if (seasonOfDay(d).key === "spring" && G.mudShare("spring", p.dry, p.ice) >= G.MUD.BASE + G.MUD.WET * 0.6) { mudTile = t.id; mudDay = d; break; }
  }
  check(mudTile != null, `found a hills tile just after spring rain (tile ${mudTile}, day ${mudDay + 1})`);
  st.hour = mudDay * 24 + 12;
  const rng0 = st.rng.state;
  const b = fight(mudTile);
  const dirt = b.cells.filter((c) => G.MUD.FLOORS.has(c.f) && G.MUD.KINDS.has(c.k) && !c.wet).length, mud = count(b, "mud");
  const p = P.pondsOn(st, mudTile), share = G.mudShare("spring", p.dry, p.ice);
  check(mud > 0 && Math.abs(mud / dirt - share) < 0.15, `spring mud on ${mud} of ${dirt} dirt cells (${(mud / dirt).toFixed(2)}; wanted about ${share.toFixed(2)})`);
  check(b.cells.every((c) => c.gnd !== "mud" || (G.MUD.FLOORS.has(c.f) && !c.wet)), "only on dirt or a field, never on a pond");
  check(!count(b, "snow") && b.ground && b.ground.mud === mud, "no snow; b.ground has the mud (the view's key)");
  // Patches: most muddy cells have a muddy neighbour (not salt and pepper).
  const at = (x, y) => (x >= 0 && y >= 0 && x < b.w && y < b.h ? b.cells[y * b.w + x] : null);
  let joined = 0;
  b.cells.forEach((c, i) => { if (c.gnd !== "mud") return; const x = i % b.w, y = (i / b.w) | 0; if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx, y + dy)?.gnd === "mud")) joined++; });
  check(joined / mud > 0.8, `in patches: ${joined} of ${mud} muddy cells beside another`);
  // The same again: the same mud (the noise is the cell's, the tile's and the year's); the game's dice as createBattle leaves them.
  const again = b.cells.map((c) => ({ k: c.k, f: c.f, wet: c.wet, ter: c.ter, h: c.h }));
  const b2 = { ...b, cells: again, setup: b.setup, snowLie: undefined, ground: undefined };
  const rng1 = st.rng.state;
  G.seasonGround(st, b2, mudTile);
  check(again.every((c, i) => (c.gnd || "") === (b.cells[i].gnd || "")) && st.rng.state === rng1 && rng0 !== undefined, "the same map the same mud, the dice untouched");
  // A dry spell later in spring: less of it, in the same spots.
  let dryDay = -1;
  for (let d = mudDay + 1; d < mudDay + 30 && dryDay < 0; d++) { st.hour = d * 24 + 12; const q = P.pondsOn(st, mudTile); if (seasonOfDay(d).key === "spring" && !q.ice && G.mudShare("spring", q.dry) < share - 0.1) dryDay = d; }
  if (dryDay >= 0) {
    const c2 = b.cells.map((c) => ({ k: c.k, f: c.f, wet: c.wet, ter: c.ter, h: c.h }));
    G.seasonGround(st, { ...b, cells: c2, snowLie: undefined, ground: undefined }, mudTile);
    const m2 = c2.filter((c) => c.gnd === "mud").length;
    check(m2 < mud && c2.every((c, i) => c.gnd !== "mud" || b.cells[i].gnd === "mud"), `${dryDay - mudDay} days on, drier: less mud (${m2}), only where it was`);
  }
  st.hour = dayIn("summer") * 24 + 12;
  const sb = fight(mudTile);
  check(!count(sb, "mud") && !count(sb, "snow") && !sb.ground, "summer: none");
  // The hive's chambers: no sky.
  const cave = { w: 4, h: 1, cells: [{ k: "open", f: "dirt" }, { k: "open", f: "dirt" }, { k: "open", f: "dirt" }, { k: "open", f: "dirt" }], setup: { layout: "hivechamber" } };
  st.hour = mudDay * 24 + 12;
  check(G.seasonGround(st, cave, mudTile) === 0 && cave.cells.every((c) => !c.gnd), "not on a hive chamber's map");
}
// Winter: a snowy day on a plains tile (no hills: b.snowLie set here) and a hills tile with frozen ponds.
let snowDay = -1;
{
  const w0 = dayIn("winter", 1, 60);
  for (let d = w0; d < w0 + 28 && snowDay < 0; d++) if ((weatherAt(st, h.tile, d * 24 + 12).snowCover || 0) >= 0.5) snowDay = d;
  check(snowDay >= 0, `a snowy winter day at the hub (day ${snowDay + 1})`);
  st.hour = snowDay * 24 + 12;
  const plains = st.tiles.find((t) => t.terrain === "plains" && t.id !== h.tile && (weatherAt(st, t.id).snowCover || 0) >= 0.5);
  const b = fight(plains.id);
  const out = b.cells.filter((c) => G.SNOW.FLOORS.has(c.f) && !G.SNOW.RAISED.has(c.k) && !c.wet);
  check(out.length > 100 && out.every((c) => c.gnd === "snow" && c.sd === b.snowLie) && b.snowLie >= 0.5 && b.ground.snow === b.snowLie, `a field fight on the plains: snow on all ${out.length} outdoor ground cells, depth ${b.snowLie} (b.snowLie set on a map with no hills)`);
  check(!count(b, "mud"), "no mud under the snow");
  const r = raid(plains.id);
  const floors = r.cells.filter((c) => c.f === "floor"), yard = r.cells.filter((c) => c.gnd === "snow");
  check(yard.length > 50 && floors.length > 0 && floors.every((c) => !c.gnd), `a raid: snow on the streets and yards (${yard.length} cells), none on the ${floors.length} cells of the buildings' floors`);
  // Frozen ponds on a hills tile: the ice keeps its own cost, no snow cost on it.
  let iceMap = null;
  for (let d = snowDay; d < snowDay + 20 && !iceMap; d++) {
    st.hour = d * 24 + 12;
    for (const t of st.tiles.filter((x) => x.terrain === "hills").slice(0, 25)) {
      if (!P.pondsOn(st, t.id).ice) continue;
      const m = fight(t.id);
      if (m.cells.some((c) => c.wet === "ice") && m.snowLie) { iceMap = m; break; }
    }
  }
  if (check(!!iceMap, "a hills map with frozen ponds under snow")) {
    const ice = iceMap.cells.filter((c) => c.wet === "ice");
    check(ice.every((c) => !c.gnd) && ice.every((c) => P.wetCost(c) + G.groundCost(c) === P.PONDS.COST.ice) && count(iceMap, "snow") > 100, `the ice (${ice.length} cells): no snow cost on it (+${P.PONDS.COST.ice}, slippery, as before); snow round it`);
  }
}

// ---------- 3. moves ----------
console.log("Moves: people and the dead alike");
{
  st.hour = dayIn("summer") * 24 + 12;
  const b = fight(h.tile);
  for (const c of b.cells) { c.k = "open"; c.f = "grass"; for (const k of ["h", "t", "hp", "mhp", "ter", "wet", "wl", "gnd", "sd"]) delete c[k]; }
  b.reach.fill(1); b.losCache.fill(0); b.fires = []; b.smoke = []; b.flares = []; b.soft = undefined; delete b.climbX; b._fields = null;
  const u = b.units.find((x) => x.side === "player"), z = b.units.find((x) => x.side === "enemy");
  b.units.filter((x) => x !== u && x !== z).forEach((o, i) => { o.x = 0; o.y = b.h - 1 - i; });
  u.x = 5; u.y = 10; z.x = 15; z.y = 3;
  const cell = (x, y) => b.cells[y * b.w + x];
  const cost = (who, x, y) => reachable(b, who, 20).dist[y * b.w + x];
  const field = (who, x, y) => { b._fields = null; return distField(b, [[who.x, who.y]], who)[y * b.w + x]; };
  check(cost(u, 6, 10) === 1 && cost(z, 16, 3) === 1, "a step on bare ground: 1");
  for (const [g, n] of [[{ gnd: "mud" }, 1 + G.MUD.COST], [{ gnd: "snow", sd: 0.5 }, 1 + G.SNOW.COST], [{ gnd: "snow", sd: 1 }, 1 + G.SNOW.DEEP_COST]]) {
    Object.assign(cell(6, 10), g); Object.assign(cell(16, 3), g);
    const name = g.gnd === "mud" ? "mud" : g.sd >= G.SNOW.DEEP ? "deep snow" : "snow";
    check(Math.abs(cost(u, 6, 10) - n) < 1e-9 && Math.abs(field(u, 6, 10) - n) < 1e-9, `your person, a step into ${name}: ${n} (reachable and the field)`);
    check(Math.abs(cost(z, 16, 3) - n) < 1e-9 && Math.abs(field(z, 16, 3) - n) < 1e-9, `the dead, a step into ${name}: ${n} (the same)`);
  }
  // Across a field of deep snow: half as far again.
  for (const c of b.cells) Object.assign(c, { gnd: "snow", sd: 1 });
  const far = cost(u, 11, 10);
  check(Math.abs(far - 6 * (1 + G.SNOW.DEEP_COST)) < 1e-9, `six steps through deep snow: ${far} moves`);
  for (const c of b.cells) { delete c.gnd; delete c.sd; }
  cell(6, 10).wet = "ice";
  check(Math.abs(cost(u, 6, 10) - (1 + P.PONDS.COST.ice)) < 1e-9, "a pond's ice as before");
}

// ---------- 4. the base map ----------
console.log("The base map");
{
  // (The yard is the tile's own ground since 2026-10-24, no brown square: mud lies only on the dirt there is, the
  // ground cleared; snow on all the open ground. A built crop plot keeps its own surface.)
  const yardOf = (b) => b.cells.filter((c) => G.MUD.FLOORS.has(c.f) && G.MUD.KINDS.has(c.k) && !c.wet && !c.plot);
  const openOf = (b) => b.cells.filter((c) => G.SNOW.FLOORS.has(c.f) && G.MUD.KINDS.has(c.k) && !c.wet && !c.plot);
  let springB = null, sd = -1;
  for (let d = 0; d < 14 && !springB; d++) {
    if (seasonOfDay(d).key !== "spring") continue;
    st.hour = d * 24 + 12; st.combat = null;
    const p = P.pondsOn(st, h.tile);
    if (G.mudShare("spring", p.dry, p.ice) < G.MUD.BASE + G.MUD.WET * 0.5) continue;
    openBaseMap(st, h.id);
    springB = st.combat; sd = d;
  }
  if (check(!!springB, `the hub's map on a wet spring day (day ${sd + 1})`)) {
    const y = yardOf(springB), m = springB.cells.filter((c) => c.gnd === "mud");
    check(m.every((c) => G.MUD.FLOORS.has(c.f)) && (y.length ? m.length > 0 && m.length < y.length : m.length === 0), `mud only on dirt: ${m.length} of the base's ${y.length} dirt cells (the hub's yard is grass)`);
  }
  st.combat = null; st.hour = snowDay * 24 + 12;
  openBaseMap(st, h.id);
  const wb = st.combat, y = wb ? openOf(wb) : [];
  check(wb && y.length > 20 && y.every((c) => c.gnd === "snow") && wb.cells.filter((c) => c.f === "floor").every((c) => !c.gnd), `the hub's map on a snowy day: snow on the open ground (${y.length} cells), none on the buildings' floors`);
  st.combat = null;
}

// ---------- 5. the view ----------
console.log("The view");
{
  const ISO = await import("../src/ui/isoview.js");
  const UI = await import("../src/ui/combat.js");
  let imgs = null, nan = 0;
  const silent = (cv) => new Proxy({ createImageData: (w, h2) => ({ width: w, height: h2, data: new Uint8ClampedArray(w * h2 * 4) }), putImageData: (img) => { if (imgs) imgs.push(img); }, measureText: (t) => ({ width: String(t).length * 6 }) }, {
    get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; }),
    set: (o, k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nan++; o[k] = v; return true; },
  });
  const cvs = (w, h2) => { const cv = { width: w, height: h2, toDataURL: () => "data:," }; const g = silent(cv); cv.getContext = () => g; return cv; };
  globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  ISO.setIsoCanvas(cvs);
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent({}) });
  // The ground pictures of a frame: since 99952d7 (issue #24, big raid maps) isoview.js flatGroundFor paints the ground
  // in tiles of TILE_CELLS (32) cells a side, 16 px a cell, row by row, not one b.w × 16 picture; the edge skirt's tiles
  // (battleedge.js) come before them. The run of pictures with exactly the tiles' sizes, in order.
  const groundImgs = (b, all) => {
    const want = [];
    for (let y0 = 0; y0 < b.h; y0 += 32) for (let x0 = 0; x0 < b.w; x0 += 32) want.push(`${Math.min(32, b.w - x0) * 16}x${Math.min(32, b.h - y0) * 16}`);
    const got = all.map((im) => `${im.width}x${im.height}`);
    for (let i = 0; i + want.length <= got.length; i++) if (want.every((s, j) => got[i + j] === s)) return all.slice(i, i + want.length);
    return [];
  };
  let clock = 1e6;
  // A frame on that day: the ground pictures painted (its tiles: groundImgs) and their pixels by colour.
  const frame = (b, d) => {
    st.hour = d * 24 + 12; st.combat = b;
    imgs = [];
    const g0 = ISO.iso.builds.ground;
    let err = "";
    try { clock += 50; UI.drawCombat(st, clock); } catch (e) { err = e.stack.split("\n").slice(0, 3).join(" "); }
    const px = { snow: 0, mud: 0, leaf: 0, all: 0 };
    for (const im of groundImgs(b, imgs)) {
      const a = im.data;
      for (let i = 0; i < a.length; i += 4) {
        const r = a[i], g = a[i + 1], bl = a[i + 2];
        px.all++;
        if (r > 160 && g > 165 && bl > 170) px.snow++;
        else if (r > 120 && r > g * 1.5 && g > bl * 0.9) px.leaf++; // red to orange (FALL's warm ones; the ground's own browns are darker)
        else if (r < 90 && g < 62 && r > 30 && r > bl * 1.4 && r - g > 10) px.mud++; // dark wet earth (the dirt itself is paler: g 70+)
      }
    }
    imgs = null;
    return { err, ground: ISO.iso.builds.ground - g0, px };
  };
  // Summer, then autumn on the same forest fight: leaves on the ground, painted once.
  st.hour = dayIn("summer") * 24 + 12;
  const forest = st.tiles.find((t) => t.terrain === "forest" && t.id !== h.tile);
  const fb = fight(forest.id);
  const trees = fb.cells.filter((c) => c.k === "tree").length;
  const sum = frame(fb, dayIn("summer")), sum2 = frame(fb, dayIn("summer") + 1);
  check(!sum.err && !nan && sum.ground >= 1 && sum.px.all > 0, `a forest fight (${trees} trees) drawn in summer, no error or NaN${sum.err ? ` (${sum.err})` : ""}`);
  check(sum2.ground === 0, "the next day: the ground not painted again");
  const aut = frame(fb, dayIn("autumn", 20)), aut2 = frame(fb, dayIn("autumn", 21));
  check(!aut.err && aut.ground === 1 && aut2.ground === 0, `autumn: the ground painted again once (${aut.ground}), the next day not (${aut2.ground})`);
  check(aut.px.leaf > sum.px.leaf + 2000 && aut.px.leaf > aut.px.all * 0.02, `autumn's leaves on the ground: ${aut.px.leaf} red and orange px (summer ${sum.px.leaf})`);
  // Back in summer. Since 99952d7 (issue #24) flatGroundFor keeps a battle's last GROUNDS (6) pictures, so the same
  // battle's summer picture comes back unpainted; the same fight made again (a new battle, its pictures dropped) is
  // painted once, with no leaves.
  const back = frame(fb, dayIn("summer"));
  check(back.ground === 0, "back in summer: the same battle's summer picture is kept, not painted again");
  const fb2 = fight(forest.id), back2 = frame(fb2, dayIn("summer"));
  check(back2.ground === 1 && back2.px.all === sum.px.all && Math.abs(back2.px.leaf - sum.px.leaf) < 50, `back in summer on the same fight made again: painted once, no leaves (${back2.px.leaf} red and orange px, summer ${sum.px.leaf})`);
  // Winter's snow on a field fight made on a snowy day.
  st.hour = snowDay * 24 + 12;
  const wb = fight(h.tile);
  const win = frame(wb, snowDay), win2 = frame(wb, snowDay);
  check(!win.err && win.ground >= 1 && win2.ground === 0 && win.px.snow > win.px.all * 0.5, `winter: the ground snowy (${win.px.snow} of ${win.px.all} px white), painted once`);
  // Spring's mud on the hills.
  st.hour = mudDay * 24 + 12;
  const mb = fight(mudTile);
  const spr = frame(mb, mudDay), mudCells = count(mb, "mud");
  check(!spr.err && spr.px.mud > mudCells * 16 * 16 * 0.2, `spring: mud on the ground (${spr.px.mud} dark wet px over ${mudCells} muddy cells; some of them on the hills' tops, drawn as sprites)`);
  check(!nan, "no NaN anywhere");
}

const ms = Math.round(performance.now() - t0);
console.log(`\n${passed} passed, ${failed} failed (${ms} ms)`);
process.exit(failed ? 1 : 0);
