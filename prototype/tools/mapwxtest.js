// Headless check of rain and fog on the State Map (ui/wxmap.js drawWeatherFx; the user's request 2026-10-23) and of
// fog cutting sight on the map (sim/weather.js sightCut):
//  1. Which tiles get rain and fog: a tile under a fog bank gets fog (a blizzard a whiteout), under a rain belt rain,
//     under a thunderstorm heavy rain; a rain day rains only under its belts, never the whole map (weather.js WAVE);
//     a clear or grey sky nothing. The hour's grid (wxFxGrid) is the tiles' own weather (wxFxAt, skyAt) and the
//     same however often it is asked.
//  2. Drawing (stub canvas): the rainy tiles in view filled in at most 2 × RAIN.LEVELS fills, at most FOG.MAX_DRAWS
//     fog puffs (zoomed out over a big bank too); an hour with no rain or fog on the map draws nothing and asks for
//     no frames; with the Weather layer's view off the map, nothing.
//  3. Fog cuts sight on the map, deterministically and the same for you and the groups: your team sees a tile less
//     in fog than on a clear tile at the same hour (never below its own tile at night, never below 1 by day), a base's
//     lookouts and a watch tower a tile less (night unchanged), the groups' parties on the road (partySaw) and
//     scavenging (scavSaw) see your bases a tile less far; clear weather changes nothing. The tooltip says so.
// Usage: node tools/mapwxtest.js [seed]
import { createWorld, hub, baseVision, isNight } from "../src/sim/world.js";
import { sightRadius } from "../src/sim/parties.js";
import { opticsCarried } from "../src/sim/optics.js";
import { towerRadius, FIELD } from "../src/sim/fieldworks.js";
import { partySaw, scavSaw, knowsOf, KNOW } from "../src/sim/groupworld.js";
import * as W from "../src/sim/weather.js";
import { LAYERS } from "../src/sim/markers.js";
import { wxFxGrid, wxFxAt, wxCode, drawWeatherFx, weatherTipLines, fxStats, RAIN, FOG, dropWxFx } from "../src/ui/wxmap.js";

const seed = Number(process.argv[2] || 11);
let passed = 0, fails = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const ROW = Math.sqrt(3) / 2;
const tileAt = (st, ux, uy) => {
  const y = Math.round(uy / ROW), x = Math.round(ux - 0.5 * (y & 1));
  return x >= 0 && y >= 0 && x < st.grid.width && y < st.grid.height ? st.grid.id(x, y) : -1;
};

const st = createWorld({ seed, factionCount: 3 });
const g = st.grid, home = hub(st);
const hod = (h) => ((h % 24) + 24) % 24;
// The first hour (by day if `day`) with a front of kind k on the map whose middle tile has that weather.
function findFront(k, day = true, from = 48) {
  const keep = st.hour;
  for (let h = from; h < from + 112 * 24 * 2; h++) {
    if (day && (hod(h) < 8 || hod(h) > 17)) continue;
    st.hour = h;
    for (const f of W.visibleFronts(st)) {
      if (f.k !== k || f.r < 3) continue;
      const id = tileAt(st, f.x, f.y);
      if (id >= 0 && W.skyAt(st, id) === k) { st.hour = keep; return { h, id, f }; }
    }
  }
  st.hour = keep;
  return null;
}
// A tile with plain sky (no rain, fog, snow or blizzard) at hour h.
function clearTile(h, near = null) {
  const ids = st.tiles.map((t) => t.id).filter((id) => !wxCode(W.skyAt(st, id, h)) && W.skyAt(st, id, h) !== "snow" && st.tiles[id].terrain !== "water");
  if (near != null) ids.sort((a, b) => g.distance(a, near) - g.distance(b, near));
  return ids[0] ?? -1;
}

// ---------- 1. which tiles get rain and fog ----------
console.log("Rain and fog by the tiles' weather");
const fog = findFront("fog"), rain = findFront("rain", false), storm = findFront("storm", false);
check(fog, "a fog bank by day within two years");
check(rain || storm, "a rain belt or a thunderstorm within two years");
if (fog) {
  st.hour = fog.h;
  check(wxFxAt(st, fog.id).fog === 1 && wxFxAt(st, fog.id).rain === 0, `fog bank's middle tile shows fog (${JSON.stringify(wxFxAt(st, fog.id))})`);
  const c = clearTile(st.hour);
  check(c >= 0 && wxFxAt(st, c).fog === 0 && wxFxAt(st, c).rain === 0, "a clear tile shows nothing");
  const grid = wxFxGrid(st, st.hour);
  let same = true;
  for (let id = 0; id < st.tiles.length; id++) if (grid[id] !== wxCode(W.skyAt(st, id))) { same = false; break; }
  check(same, "the hour's grid is every tile's own weather");
  check(grid[fog.id] === 3, "fog is code 3 in the grid");
  dropWxFx();
  const again = wxFxGrid(st, st.hour);
  check(again !== grid && again.every((v, i) => v === grid[i]), "the grid comes out the same asked again");
  // Fog tiles: exactly those whose sky is fog, and every one of them inside a fog front.
  const fogTiles = [...grid.keys()].filter((id) => grid[id] === 3);
  check(fogTiles.length > 5 && fogTiles.every((id) => { const a = W.frontAt(st, id); return a && a.f.k === "fog"; }), `fog only under fog banks (${fogTiles.length} tiles)`);
}
for (const [ex, code] of [[rain, 1], [storm, 2]]) {
  if (!ex) continue;
  st.hour = ex.h;
  check(wxFxAt(st, ex.id).rain === code && wxFxAt(st, ex.id).fog === 0, `${ex.f.k} front's middle tile shows rain ${code} (${JSON.stringify(wxFxAt(st, ex.id))})`);
  check(wxFxGrid(st, st.hour)[ex.id] === code, `${ex.f.k}: code ${code} in the grid`);
}
// A rain day: the rain comes in belts (weather WAVE), never over the whole map: rain only under a rain belt or a
// storm, and some of the map dry.
{
  let h0 = -1;
  for (let d = 2; d < 224 && h0 < 0; d++) {
    const h = d * 24 + 12;
    W.weatherAt(st, home.tile, h); // the day made
    const day = st.weather.days[d];
    if (day.wave && day.k === "rain" && W.visibleFronts({ ...st, hour: h }).some((f) => f.sh)) h0 = h;
  }
  if (check(h0 >= 0, "a rain day with rain belts on the map")) {
    const grid = wxFxGrid(st, h0);
    const wet = grid.filter((v) => v > 0).length;
    check(wet > 0 && wet < grid.length * 0.9, `a rain day: rain on ${wet} of ${grid.length} tiles, not the whole map`);
    check(grid.every((v, id) => !v || (W.frontAt(st, id, h0) && ["rain", "storm"].includes(W.skyAt(st, id, h0)))), "every raining tile is under a rain belt or a storm");
  }
}
// Clear and grey skies, snow, heat: nothing.
for (const k of ["clear", "overcast", "heat", "drought", "frost", "snow"]) check(wxCode(k) === 0, `${k}: nothing drawn`);
check(wxCode("blizzard") === 4 && wxCode("fog") === 3 && wxCode("rain") === 1 && wxCode("storm") === 2, "codes: rain 1, storm 2, fog 3, whiteout 4");

// ---------- 2. drawing on a stub canvas ----------
console.log("Drawing: bounded, nothing when clear");
{
  const calls = { fill: 0, drawImage: 0, rect: 0, pattern: 0 };
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : k === "createPattern" ? () => { calls.pattern++; return {}; } : k === "createRadialGradient" ? () => ({ addColorStop() {} }) : k in calls ? () => { calls[k]++; } : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const cvs = () => { const c = { width: 0, height: 0 }; c.getContext = () => ctx; return c; };
  globalThis.document = { createElement: cvs };
  const HEX = 26, colW = HEX * Math.sqrt(3);
  const whole = { minX: -HEX * 2, minY: -HEX * 2, maxX: colW * (g.width + 1), maxY: HEX * 1.5 * g.height + HEX * 2 };
  const reset = () => { for (const k in calls) calls[k] = 0; };
  for (const ex of [fog, rain, storm].filter(Boolean)) {
    st.hour = ex.h;
    reset();
    drawWeatherFx(ctx, st, { hex: HEX, view: whole, frac: 0, t: 1234, zoom: 0.3 });
    const grid = wxFxGrid(st, st.hour);
    const nRain = grid.filter((v) => v === 1 || v === 2).length, nFog = grid.filter((v) => v >= 3).length;
    check(fxStats.rain === nRain && fxStats.fog === nFog, `${ex.f.k}: counts the rainy (${fxStats.rain}/${nRain}) and foggy (${fxStats.fog}/${nFog}) tiles in view`);
    check(calls.fill <= 2 * RAIN.LEVELS && (nRain === 0 || calls.fill >= 1), `${ex.f.k}: rain in ${calls.fill} fills (≤ ${2 * RAIN.LEVELS})`);
    check(calls.drawImage <= FOG.MAX_DRAWS && (nFog === 0 || calls.drawImage >= 1), `${ex.f.k}: ${calls.drawImage} fog puffs (≤ ${FOG.MAX_DRAWS})`);
    check(nFog === 0 || fxStats.puffs === calls.drawImage, `${ex.f.k}: puff count`);
    // Half into the hour: the next hour's tiles count too, nothing above the limits.
    reset();
    drawWeatherFx(ctx, st, { hex: HEX, view: whole, frac: 0.5, t: 99999, zoom: 0.3 });
    check(calls.fill <= 2 * RAIN.LEVELS && calls.drawImage <= FOG.MAX_DRAWS, `${ex.f.k}: easing into the next hour stays bounded`);
    // A view far off the map: nothing.
    reset();
    drawWeatherFx(ctx, st, { hex: HEX, view: { minX: -9000, minY: -9000, maxX: -8000, maxY: -8000 }, t: 5 });
    check(fxStats.rain === 0 && fxStats.fog === 0 && calls.fill === 0 && calls.drawImage === 0, `${ex.f.k}: nothing off screen`);
  }
  // An hour with no rain or fog anywhere: nothing drawn (so render.js asks for no frames).
  let hc = -1;
  for (let h = 48; h < 224 * 24 && hc < 0; h += 5) if (wxFxGrid(st, h).every((v) => v === 0) && wxFxGrid(st, h + 1).every((v) => v === 0)) hc = h;
  if (check(hc >= 0, "an hour with no rain or fog on the map")) {
    st.hour = hc;
    reset();
    const r = drawWeatherFx(ctx, st, { hex: HEX, view: whole, frac: 0.4, t: 777, zoom: 1 });
    check(r.rain === 0 && r.fog === 0 && calls.fill === 0 && calls.drawImage === 0 && calls.pattern === 0, "clear: nothing drawn, no frames wanted");
  }
  // A big fog bank seen zoomed out: the puffs go every other tile, still under the limit.
  if (fog) {
    st.hour = fog.h;
    reset();
    const t0 = performance.now();
    drawWeatherFx(ctx, st, { hex: HEX, view: whole, t: 1, zoom: 0.2 });
    const ms = performance.now() - t0;
    check(calls.drawImage <= FOG.MAX_DRAWS, `fog zoomed out: ${calls.drawImage} puffs`);
    console.log(`  whole map at ${fog.h}: ${fxStats.fog} foggy tiles, ${calls.drawImage} puffs, ${ms.toFixed(2)} ms (stub canvas)`);
  }
  const t0 = performance.now();
  dropWxFx();
  wxFxGrid(st, st.hour);
  console.log(`  an hour's grid for ${st.tiles.length} tiles: ${(performance.now() - t0).toFixed(2)} ms`);
  delete globalThis.document;
}

// ---------- 3. fog cuts sight on the map ----------
console.log("Fog cuts sight: your teams, bases, towers and the groups' parties");
if (fog) {
  st.hour = fog.h;
  const F = fog.id, C = clearTile(st.hour, F);
  check(!isNight(st), "the fog hour is by day");
  check(W.sightCut(st, F) === -1 && W.sightCut(st, C) === 0, "sightCut: -1 in fog, 0 in the clear");
  check(W.travelEffects(st, st.hour, F).sight === -1 && W.travelEffects(st, st.hour, C).sight === 0, "travelEffects agrees");
  check(W.travelEffects(st, st.hour, F).lines.some((l) => /see 1 tile less/.test(l)), "the travel lines say sight is cut");
  // Your team: a scout (scouting 10: 2 tiles by day) with no optics.
  const s = st.survivors.find((x) => x.alive && !opticsCarried([x]).length);
  const keepSk = s.skills.scouting;
  s.skills.scouting = 12;
  const team = (tile) => ({ id: 9999, owner: "player", kind: "expedition", members: [s.id], path: [tile], idx: 0, phase: "waiting", cargo: {} });
  const rc = sightRadius(st, team(C)), rf = sightRadius(st, team(F));
  check(rc >= 2 && rf === rc - 1, `your team sees ${rc} tiles in the clear, ${rf} in fog`);
  s.skills.scouting = 0;
  check(sightRadius(st, team(F)) === 1, "never below 1 by day");
  s.skills.scouting = keepSk;
  // Your base's lookouts and a watch tower.
  const bc = baseVision({ ...home, tile: C }, st), bf = baseVision({ ...home, tile: F }, st);
  check(bf === Math.max(1, bc - 1) && bc === baseVision(home), `a base sees ${bc} in the clear, ${bf} in fog`);
  check(baseVision({ ...home, tile: F }) === baseVision(home), "a base's clear-day view (no state) is unchanged");
  check(towerRadius(st, F) === FIELD.TOWER.day - 1 && towerRadius(st, C) === FIELD.TOWER.day && towerRadius(st) === FIELD.TOWER.day, `a tower sees ${towerRadius(st, F)} in fog, ${towerRadius(st, C)} clear`);
  // The groups: a party on the road and a scavenging party see your base a tile less far in fog.
  const f = st.factions.find((x) => x.alive && !x.outsider && x.bases.length);
  knowsOf(st, f);
  const keepTile = home.tile;
  const ring = (center, d) => st.tiles.map((t) => t.id).filter((id) => g.distance(id, center) === d && st.tiles[id].terrain !== "water" && !st.bases.some((b) => b.tile === id) && !st.factions.some((o) => o.bases.includes(id)));
  const learns = (fn, at, baseTile) => { home.tile = baseTile; delete f.knows.bases[baseTile]; fn(st, f, at); const k = !!f.knows.bases[baseTile]; delete f.knows.bases[baseTile]; home.tile = keepTile; return k; };
  const passF = ring(F, KNOW.PASS), passC = ring(C, KNOW.PASS);
  check(passF.length && passF.every((b) => !learns(partySaw, F, b)), `a group's party in fog does not see a base ${KNOW.PASS} tiles off`);
  check(passC.some((b) => learns(partySaw, C, b)), `in the clear it does (${KNOW.PASS} tiles)`);
  const seeF = ring(F, KNOW.SEE), seeC = ring(C, KNOW.SEE), nearF = ring(F, KNOW.SEE - 1);
  check(seeF.length && seeF.every((b) => !learns(scavSaw, F, b)), `scavengers in fog miss a base ${KNOW.SEE} tiles off`);
  check(seeC.length && seeC.every((b) => learns(scavSaw, C, b)), `scavengers in the clear see it`);
  check(nearF.length && nearF.every((b) => learns(scavSaw, F, b)), `scavengers in fog see it ${KNOW.SEE - 1} tiles off`);
  // Same answer asked again (no dice).
  check(sightRadius(st, team(F)) === sightRadius(st, team(F)) && W.sightCut(st, F) === W.sightCut(st, F), "deterministic");
  // The tooltip.
  const tip = weatherTipLines(st, F).join(" | ");
  check(/sees 1 tile less/.test(tip), `the tooltip says fog cuts sight (${tip.slice(0, 90)}…)`);
  check(!weatherTipLines(st, C).some((l) => /tile less/.test(l)), "no such line on a clear tile");
}
// At night: a base sees NIGHT_BASE_VISION, fog or not; a team in fog sees its own tile.
{
  const nf = findFront("fog", false, 24 * 60);
  if (nf) {
    let h = nf.h;
    while (hod(h) >= 6 && hod(h) < 20 && h > nf.f.t0) h--;
    st.hour = h;
    if (isNight(st) && W.sightCut(st, nf.id) < 0) {
      check(baseVision({ ...home, tile: nf.id }, st) === 1, "night in fog: a base sees 1");
      const s = st.survivors.find((x) => x.alive && !opticsCarried([x]).length && !(x.gear && x.gear.tool && ["nvg", "thermal"].includes(x.gear.tool.key)));
      check(sightRadius(st, { id: 9998, owner: "player", members: [s.id], path: [nf.id], idx: 0, phase: "waiting", cargo: {} }) === 0, "night in fog: a team sees its own tile");
    }
  }
}
// A blizzard cuts sight the same way, and shows a whiteout.
{
  const bz = findFront("blizzard", false);
  if (bz) {
    st.hour = bz.h;
    check(W.sightCut(st, bz.id) === -1 && wxFxAt(st, bz.id).fog === 2, "a blizzard: sight -1, a whiteout drawn");
  } else console.log("  (no blizzard front in two years on this seed)");
}

// Live coverage only, and no fronts for players (the user's word 2026-10-23: "Weather fronts are not shown to players
// and rain only shows in live coverage tiles in the world map").
console.log("Rain and fog only on the tiles seen live; the fronts are not shown");
if (rain) {
  st.hour = rain.h;
  const HEX = 26, whole = { minX: -HEX * 2, minY: -HEX * 2, maxX: HEX * Math.sqrt(3) * (st.grid.width + 1), maxY: HEX * 1.5 * st.grid.height + HEX * 2 };
  const grid = wxFxGrid(st, st.hour), wet = [];
  grid.forEach((v, id) => { if (v === 1 || v === 2) wet.push(id); });
  const half = new Set(wet.filter((_, i) => i % 2 === 0));
  drawWeatherFx({}, st, { hex: HEX, view: whole, live: half });
  check(wet.length > 1 && fxStats.rain === half.size, `rain drawn on the ${half.size} rainy tiles seen live of ${wet.length}`);
  drawWeatherFx({}, st, { hex: HEX, view: whole, live: new Set() });
  check(fxStats.rain === 0 && fxStats.fog === 0, "nothing seen live: no rain, no fog");
  const lines = weatherTipLines(st, rain.id, new Set());
  check(!lines.some((l) => /Rain|Storm|Fog/.test(l)), `a tile not seen live: no weather in its tooltip (${lines.join(" | ") || "none"})`);
  const seen = weatherTipLines(st, rain.id, new Set([rain.id])).join(" | ");
  check(/Rain|Storm/.test(seen) && !/belt|front|over this tile/i.test(seen), `a tile seen live: its rain, never the front by name (${seen})`);
}
check(!("fronts" in LAYERS), "no Weather fronts layer for players");
check(!/Weather fronts on the map/.test(W.weatherReport(st)), "the clock's weather report lists no fronts");

console.log(`\n${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
