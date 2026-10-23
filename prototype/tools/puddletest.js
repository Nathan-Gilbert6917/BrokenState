// Puddles after rain (sim/puddles.js; ui/groundlook.js puddleField, puddleTexel; ui/isoview.js floorColor, groundFor,
// flatGroundFor; ui/battlewx.js the rings in the rain), the user's request 2026-10-23: "Add water puddles on the ground
// as decor when it's raining and after a tile has been rained on for x hours.":
//   1. the rules: the water from the tile's rain hours (none before AFTER hours of rain, rising to FULL, drying over
//      DRY hours once the rain stops, a storm's hour counting STORM), the share of the ground, the hover words;
//   2. the world's weather: a tile's level from its own sky (the rain belts), none on frozen or snowy ground, nor under
//      the ground, nor on a snowy map;
//   3. a raid on a tile after long rain: puddles only on the level outdoor ground (never a building's floor, a pond, a
//      raised cell, a hill), in patches, none on a dry tile at the same hour; the same seed the same puddles; the
//      game's dice untouched;
//   4. decor only: a step through a puddle costs what it did (reachable, distField), for people and the dead;
//   5. the base map has them too;
//   6. the view on stub canvases: the water painted (grey-blue, darker on asphalt), the ground painted once per level,
//      rings on the puddles while it rains.
// Usage: node tools/puddletest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, registerCombatHandler, reachable, distField } from "../src/sim/combat.js";
import * as PD from "../src/sim/puddles.js";
import * as L from "../src/ui/groundlook.js";
import { weatherAt, skyAt, seasonOfDay } from "../src/sim/weather.js";
import { pondIce } from "../src/sim/ponds.js";
import { openBaseMap } from "../src/sim/basemap.js";

const SEED = Number(process.argv[2] || 7);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return !!ok; };
const t0 = performance.now();
registerCombatHandler("pd", () => {});
const world = () => { const st = createWorld({ seed: SEED, factionCount: 6 }); st.started = true; st.hour = 3 * 24 + 12; return st; };
const st = world();
const h = hub(st);
const people = atBase(st, h.id).slice(0, 2).map((s) => s.id);
const raid = (S, tile) => createBattle(S, { mode: "raid", tile, baseId: hub(S).id, fighterIds: atBase(S, hub(S).id).slice(0, 2).map((s) => s.id), canRetreat: true, ambush: null, handler: "pd", enemy: { kind: "zombies", count: 2, power: 3 }, raid: { heat0: 0 }, context: {} });
const fight = (tile) => createBattle(st, { tile, baseId: h.id, fighterIds: people, enemy: { kind: "zombies", count: 2, power: 3, name: "T" }, ambush: null, canRetreat: false, handler: "pd", context: {} });
const puds = (b) => b.cells.filter((c) => c.pud);
const { AFTER, FULL, DRY, STORM } = PD.PUDDLE;
const rep = (k, n) => Array(n).fill(k);

// ---------- 1. the rules ----------
console.log("The rules");
{
  const lv = (skies) => PD.levelOf(PD.waterOf(skies));
  check(lv(rep("rain", AFTER - 1)) === 0 && lv([...rep("clear", 20), ...rep("rain", AFTER - 1)]) === 0, `raining, but fewer than ${AFTER} hours of it: no puddles yet`);
  check(lv(rep("rain", AFTER)) > 0 && Math.abs(PD.puddleShare(lv(rep("rain", AFTER))) - PD.PUDDLE.SHARE.MIN) < 1e-9, `after ${AFTER} hours of rain the first puddles (${PD.PUDDLE.SHARE.MIN * 100}% of the ground)`);
  const up = [AFTER, 5, 7, FULL].map((n) => lv(rep("rain", n)));
  check(up.every((v, i) => i === 0 || v > up[i - 1]) && lv(rep("rain", FULL)) === 1 && lv(rep("rain", 30)) === 1 && Math.abs(PD.puddleShare(1) - PD.PUDDLE.SHARE.MAX) < 1e-9, `more the longer it rains (${up.join(", ")}), the most at ${FULL} hours (${PD.PUDDLE.SHARE.MAX * 100}%)`);
  const after = (n) => lv([...rep("rain", FULL), ...rep("clear", n)]);
  const dry = [0, 3, 6, 9, DRY - 1].map(after);
  check(dry.every((v, i) => i === 0 || v < dry[i - 1]) && dry[dry.length - 1] > 0 && after(DRY) === 0, `after the rain they shrink (${dry.join(", ")}) and are gone ${DRY} hours on`);
  check(lv([...rep("rain", AFTER), ...rep("overcast", 2)]) > 0 && lv([...rep("rain", AFTER), ...rep("overcast", DRY)]) === 0, "a few hours of rain: puddles that linger a while after it, and dry sooner");
  check(lv([...rep("rain", FULL), ...rep("clear", DRY), ...rep("rain", AFTER - 1)]) === 0, `dried out, then rain again: no puddles until ${AFTER} hours of it`);
  check(lv([...rep("rain", FULL), ...rep("clear", 4), "rain"]) > after(4), "rain again before they have dried: topped up");
  check(lv(rep("storm", Math.ceil(AFTER / STORM))) > 0 && lv(rep("storm", Math.ceil(AFTER / STORM) - 1)) === 0, `a thunderstorm's hour counts ${STORM}: puddles after ${Math.ceil(AFTER / STORM)} hours of it`);
  check(lv(rep("snow", 20)) === 0 && lv(rep("fog", 20)) === 0 && lv(rep("blizzard", 20)) === 0, "snow, fog, a blizzard: no puddles");
  const sh = [0, 0.1, 0.3, 0.5, 0.8, 1].map(PD.puddleShare);
  check(sh[0] === 0 && sh.every((v, i) => i === 0 || v > sh[i - 1]), `the share of the ground by the level: ${sh.map((v) => v.toFixed(3)).join(", ")}`);
  const w = PD.puddleWord({ pud: 0.5 });
  check(/Puddles/.test(w) && /no effect on movement/.test(w) && PD.puddleWord({}) === "", `the hover words: "${w.replace(/<[^>]+>/g, "")}"`);
  check(PD.puddleGround({ k: "open", f: "grass" }) && PD.puddleGround({ k: "open", f: "road" }) && PD.puddleGround({ k: "open", f: "dirt", gnd: "mud" }) && !PD.puddleGround({ k: "open", f: "floor" }) && !PD.puddleGround({ k: "open", f: "grass", wet: "wade" }) && !PD.puddleGround({ k: "wall", f: "grass" }) && !PD.puddleGround({ k: "open", f: "grass", ter: true, h: 1 }) && !PD.puddleGround({ k: "open", f: "grass", gnd: "snow" }), "where: the level outdoor ground (mud too), not a building's floor, a pond, a wall, a hill or the snow");
}

// ---------- 2. the world's weather ----------
console.log("The world's weather");
let wetTile = null, dryTile = null, wetHour = -1;
{
  // An hour when some open tile has had long rain (level 0.8+) and another none at all.
  const open = st.tiles.filter((t) => !t.water && t.terrain !== "mountains" && t.terrain !== "water").map((t) => t.id);
  for (let H = 5 * 24; H < 60 * 24 && wetTile == null; H += 5) {
    st.hour = H;
    if (seasonOfDay(Math.floor(H / 24)).key === "winter") continue;
    const wet = open.find((t) => PD.puddleLevel(st, t) >= 0.8 && st.tiles[t].terrain !== "city");
    const dry = wet != null ? open.find((t) => PD.puddleLevel(st, t) === 0 && PD.rainWater(st, t).rain === 0 && st.tiles[t].terrain === st.tiles[wet].terrain) : null;
    if (wet != null && dry != null) { wetTile = wet; dryTile = dry; wetHour = H; }
  }
  check(wetTile != null, `found tile ${wetTile} (${wetTile != null ? st.tiles[wetTile].terrain : "?"}) after long rain at hour ${wetHour}, tile ${dryTile} dry`);
  st.hour = wetHour;
  const water = PD.rainWater(st, wetTile);
  const skies = []; for (let H = wetHour - PD.PUDDLE.LOOKBACK + 1; H <= wetHour; H++) skies.push(skyAt(st, wetTile, H));
  check(water.rain >= AFTER && water.rain === skies.filter((k) => k === "rain" || k === "storm").length, `its own sky: ${water.rain} hours of rain in the last ${PD.PUDDLE.LOOKBACK} (now ${skies[skies.length - 1]}, ${water.since} h since the last)`);
  // Never on frozen or snowy ground: late autumn to early spring, every 40th tile, every third hour.
  let wetWinter = 0, bad = 0, frozenWet = 0;
  const w0 = (() => { for (let d = 60; d < 260; d++) if (seasonOfDay(d).key === "winter" && seasonOfDay(d).dayOfSeason === 1) return d; return 60; })();
  for (let H = (w0 - 10) * 24; H < (w0 + 38) * 24; H += 3) {
    st.hour = H;
    for (let t = 0; t < st.tiles.length; t += 40) {
      const wa = PD.rainWater(st, t);
      if (!wa.formed) continue;
      wetWinter++;
      const wx = weatherAt(st, t, H), cold = wx.frozen || (wx.snowCover || 0) >= PD.PUDDLE.SNOW_MIN || pondIce(st, Math.floor(H / 24));
      if (cold) { frozenWet++; if (PD.puddleLevel(st, t) !== 0) bad++; }
      else if (PD.puddleLevel(st, t) === 0) bad++;
    }
  }
  check(bad === 0 && frozenWet > 0, `late autumn to early spring: ${wetWinter} wet tile-hours, ${frozenWet} of them on frozen or snowy ground, none with puddles there; the rest have them`);
  st.hour = wetHour;
  check(PD.puddleLevel(st, wetTile, wetHour, { setup: { layout: "hivechamber" } }) === 0 && PD.puddleLevel(st, wetTile, wetHour, { snowLie: 0.5 }) === 0 && PD.puddleLevel(st, wetTile, wetHour, {}) > 0, "none under the ground (a hive's chamber) or on a map where snow lies");
}

// ---------- 3. a raid after long rain ----------
console.log("A raid after long rain");
let rb = null;
{
  st.hour = wetHour;
  rb = raid(st, wetTile);
  const p = puds(rb), ground = rb.cells.filter((c) => PD.puddleGround(c) && !(c.ter && c.h)).length;
  check(p.length > 0 && rb.puddles && rb.puddles.n === p.length, `a raid on tile ${wetTile}: ${p.length} puddle cells (b.puddles level ${rb.puddles && rb.puddles.level}, share ${rb.puddles && rb.puddles.share})`);
  check(Math.abs(p.length / ground - rb.puddles.share) < 0.08, `about the share of the level ground: ${(p.length / ground).toFixed(3)} of ${ground} cells (wanted ${rb.puddles.share})`);
  check(p.every((c) => PD.puddleGround(c) && PD.PUDDLE.FLOORS.has(c.f) && c.f !== "floor" && !c.wet && !(c.ter && c.h) && c.pud > 0 && c.pud <= 1), "only on the level outdoor ground: never a building's floor, a pond, a raised cell or a hill");
  const floors = rb.cells.filter((c) => c.f === "floor");
  check(floors.length > 0 && floors.every((c) => !c.pud), `none on the ${floors.length} cells of the buildings' floors`);
  const at = (x, y) => (x >= 0 && y >= 0 && x < rb.w && y < rb.h ? rb.cells[y * rb.w + x] : null);
  let joined = 0;
  rb.cells.forEach((c, i) => { if (!c.pud) return; const x = i % rb.w, y = (i / rb.w) | 0; if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx, y + dy)?.pud)) joined++; });
  check(joined / p.length > 0.6, `in patches: ${joined} of ${p.length} beside another`);
  const db = raid(st, dryTile);
  check(!puds(db).length && !db.puddles, `a raid on dry tile ${dryTile} at the same hour: no puddles`);
  // The same seed, the same puddles; the game's dice not touched by them.
  const s2 = world();
  s2.hour = wetHour;
  const rb2 = raid(s2, wetTile);
  check(rb2.cells.length === rb.cells.length && rb2.cells.every((c, i) => (c.pud || 0) === (rb.cells[i].pud || 0)), "the same seed, the same raid: the same puddles");
  const copy = { ...rb, cells: rb.cells.map((c) => { const o = { ...c }; delete o.pud; return o; }), puddles: undefined };
  const r0 = JSON.stringify(st.rng.state ?? st.rng);
  const n = PD.puddlesBattle(st, copy, wetTile);
  check(JSON.stringify(st.rng.state ?? st.rng) === r0 && n === p.length && copy.cells.every((c, i) => (c.pud || 0) === (rb.cells[i].pud || 0)), "laid again on the same map: the same cells, the game's dice untouched");
  const f = fight(wetTile);
  check(puds(f).length > 0 && puds(f).every((c) => PD.puddleGround(c)), `a fight in the open there too: ${puds(f).length} puddle cells`);
  const cave = { w: 4, h: 1, cells: rep(0, 4).map(() => ({ k: "open", f: "dirt" })), setup: { layout: "hivechamber" } };
  check(PD.puddlesBattle(st, cave, wetTile) === 0 && cave.cells.every((c) => !c.pud), "not on a hive chamber's map");
}

// ---------- 4. decor only ----------
console.log("Decor only: no move cost");
{
  const b = rb, u = b.units.find((x) => x.side === "player" && x.hp > 0);
  const z = b.units.find((x) => x.side !== "player" && x.hp > 0);
  const with1 = reachable(b, u, 30).dist.slice();
  b._fields = null;
  const f1 = distField(b, [[u.x, u.y]], z || u).slice();
  const saved = b.cells.map((c) => c.pud);
  for (const c of b.cells) delete c.pud;
  const with0 = reachable(b, u, 30).dist.slice();
  b._fields = null;
  const f0 = distField(b, [[u.x, u.y]], z || u).slice();
  b.cells.forEach((c, i) => { if (saved[i]) c.pud = saved[i]; });
  b._fields = null;
  const same = (a, c) => a.length === c.length && a.every((v, i) => v === c[i] || (Number.isNaN(v) && Number.isNaN(c[i])));
  const reached = with1.filter((v, i) => Number.isFinite(v) && v < 1e6 && b.cells[i].pud).length;
  check(same(with1, with0) && reached > 0, `your person's moves the same with the puddles as without (${reached} puddle cells in reach)`);
  check(same(f1, f0), "the dead's (and every walker's) field the same too");
}

// ---------- 5. the base map ----------
console.log("The base map");
{
  let H0 = -1;
  for (let H = 5 * 24; H < 80 * 24 && H0 < 0; H += 2) { st.hour = H; if (PD.puddleLevel(st, h.tile) >= 0.6) H0 = H; }
  if (check(H0 >= 0, `a wet hour at the hub (hour ${H0}, level ${PD.puddleLevel(st, h.tile)})`)) {
    st.hour = H0; st.combat = null;
    openBaseMap(st, h.id);
    const b = st.combat, p = b ? puds(b) : [];
    check(b && p.length > 0 && p.every((c) => PD.puddleGround(c)) && b.cells.filter((c) => c.f === "floor").every((c) => !c.pud), `the hub's map: ${p.length} puddle cells in the yard, none on the buildings' floors`);
    st.combat = null;
  }
}

// ---------- 6. the view ----------
console.log("The view");
{
  const ISO = await import("../src/ui/isoview.js");
  const UI = await import("../src/ui/combat.js");
  const WX = await import("../src/ui/battlewx.js");
  let imgs = null, nan = 0;
  const silent = (cv) => new Proxy({ createImageData: (w, h2) => ({ width: w, height: h2, data: new Uint8ClampedArray(w * h2 * 4) }), putImageData: (img) => { if (imgs) imgs.push(img); }, measureText: (t) => ({ width: String(t).length * 6 }) }, {
    get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; }),
    set: (o, k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nan++; o[k] = v; return true; },
  });
  const cvs = (w, h2) => { const cv = { width: w, height: h2, toDataURL: () => "data:," }; const g = silent(cv); cv.getContext = () => g; return cv; };
  globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  ISO.setIsoCanvas(cvs);
  WX.setWxCanvas(cvs);
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent({}) });
  let clock = 1e6;
  // A frame: the ground pictures painted (the map's: b.w × 16 across) and its grey-blue water px.
  const frame = (b) => {
    st.combat = b;
    imgs = [];
    const g0 = ISO.iso.builds.ground;
    let err = "";
    try { clock += 50; UI.drawCombat(st, clock); } catch (e) { err = e.stack.split("\n").slice(0, 3).join(" "); }
    let water = 0, all = 0;
    for (const im of imgs) {
      if (im.width !== b.w * 16) continue;
      const a = im.data;
      for (let i = 0; i < a.length; i += 4) { all++; const r = a[i], g = a[i + 1], bl = a[i + 2]; if (bl > r + 8 && bl > g && bl > 50) water++; }
    }
    imgs = null;
    return { err, ground: ISO.iso.builds.ground - g0, water, all };
  };
  st.hour = wetHour;
  const b = raid(st, dryTile), pudless = frame(b), again = frame(b);
  check(!pudless.err && pudless.ground >= 1 && again.ground === 0, `a dry raid drawn (${pudless.all} ground px), the next frame not painted again${pudless.err ? ` (${pudless.err})` : ""}`);
  const wb = raid(st, wetTile), wet = frame(wb), wet2 = frame(wb);
  const pc = puds(wb).length;
  check(!wet.err && wet.ground >= 1 && wet2.ground === 0, `a raid after long rain drawn, the ground painted once (${wet.ground}, then ${wet2.ground})${wet.err ? ` (${wet.err})` : ""}`);
  check(wet.water > pc * 16 * 16 * 0.3 && wet.water > pudless.water * 3 + 1000, `the water on the ground: ${wet.water} grey-blue px over ${pc} puddle cells (dry tile ${pudless.water})`);
  // A new level (the same map's puddles laid again at a drier hour): painted once more, then not.
  let H2 = -1;
  for (let H = wetHour + 1; H < wetHour + 40 && H2 < 0; H++) { st.hour = H; const l = PD.puddleLevel(st, wetTile); if (l > 0 && Math.abs(PD.puddleShare(l) - wb.puddles.share) > 0.02) H2 = H; }
  if (H2 >= 0) {
    for (const c of wb.cells) delete c.pud;
    delete wb.puddles;
    PD.puddlesBattle(st, wb, wetTile);
    const nx = frame(wb), nx2 = frame(wb);
    check(nx.ground >= 1 && nx2.ground === 0, `${H2 - wetHour} h on, a new level (share ${wb.puddles && wb.puddles.share}): painted again once (${nx.ground}), then not (${nx2.ground})`);
  }
  // Asphalt: darker water than on grass.
  const g = L.puddleTexel([80, 100, 60], { f: "grass" }, 40, 40, 0.9), r = L.puddleTexel([70, 70, 72], { f: "road" }, 40, 40, 0.9);
  const lum = (c) => c[0] + c[1] + c[2];
  check(L.puddleTexel([80, 100, 60], { f: "grass" }, 40, 40, 0) [0] === 80 && g[2] > g[0] && r[2] >= r[0] && lum(r) < lum([70, 70, 72]) * 1.6, `a texel of water: grey-blue on grass (${g.map(Math.round)}), on asphalt (${r.map(Math.round)})`);
  // The rings on the puddles while it rains (ui/battlewx.js drawBattleWx with the cells' places: spot; Light: none;
  // only cells in sight: spot null).
  st.hour = wetHour;
  const rr = raid(st, wetTile);
  rr.wx = "rain";
  const ctx = silent({}), spot = (x, y) => [100 + x * 30, 50 + y * 15], none = () => null;
  let rings = 0, frames = 0;
  for (let k = 0; k < 20; k++) { WX.drawBattleWx(ctx, 1600, 900, st, rr, 1e6 + k * 137, 800, 450, spot, 30); rings = Math.max(rings, WX.wxStats.ripples); if (WX.wxStats.ripples) frames++; }
  check(rings > 0 && rings <= WX.WX_FX.RIPPLE && frames > 10, `rain on the puddles: up to ${rings} rings a frame (at most ${WX.WX_FX.RIPPLE}), in ${frames} of 20 frames`);
  WX.drawBattleWx(ctx, 1600, 900, st, rr, 1e6, 800, 450, none, 30);
  check(WX.wxStats.ripples === 0, "none on puddles out of sight");
  WX.setWxLevel("low");
  WX.drawBattleWx(ctx, 1600, 900, st, rr, 1e6, 800, 450, spot, 30);
  check(WX.wxStats.ripples === 0, "Light weather: no rings");
  WX.setWxLevel("full");
  const fr = frame(rr);
  check(!fr.err && WX.wxStats.kind === "rain", "a raid in the rain with puddles drawn through the view");
  rr.wx = "clear";
  check(WX.drawBattleWx(ctx, 1600, 900, st, rr, 1e6, 800, 450, spot, 30) === "" , "no rain: no rings (the puddles stay)");
  check(!nan, "no NaN anywhere");
  st.combat = null;
}

const ms = Math.round(performance.now() - t0);
console.log(`\n${passed} passed, ${failed} failed (${ms} ms)`);
process.exit(failed ? 1 : 0);
