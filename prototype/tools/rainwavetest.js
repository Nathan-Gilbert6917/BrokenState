// Rain in waves (sim/weather.js WAVE; the user's request 2026-10-23: "Change the rain on the world map to move like a
// wave across the map in different directions not covering the whole state kinda like how it works in real life"):
//  1. Never the whole state: over a year on several seeds the share of the map raining at once stays under 0.95
//     (it was 1 on a third of rainy hours), and some of the map rains on a rain day.
//  2. In different directions: the rain belts come in from at least three map edges, heading at least four ways.
//  3. A wave: a belt is a band across its heading (WAVE.across, WAVE.along), and a tile under one now is out from
//     under it some hours later as it moves on.
//  4. Balance: a tile gets about as many rain days a year as when rain covered the state (about 30).
//  5. Old saves: a rain day made before the belts (no d.wave) keeps its rain over the whole state between fronts.
//  6. The same seed, the same belts.
// Usage: node tools/rainwavetest.js
import { createWorld } from "../src/sim/world.js";
import * as W from "../src/sim/weather.js";

let passed = 0, fails = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const wetK = (k) => k === "rain" || k === "storm";

let maxShare = 0, rainHours = 0, sumShare = 0, rainDays = 0, tilesN = 0;
const edges = new Set(), heads = new Set();
for (const seed of [3, 8, 11]) {
  const st = createWorld({ seed, factionCount: 3 });
  const N = st.tiles.length;
  for (let h = 48; h < 114 * 24; h += 4) {
    let n = 0, m = 0;
    for (let id = 0; id < N; id += 7) { m++; if (wetK(W.skyAt(st, id, h))) n++; }
    const s = n / m; if (s > 0) { rainHours++; sumShare += s; maxShare = Math.max(maxShare, s); }
  }
  for (let id = 0; id < N; id += 41) { tilesN++; for (let d = 3; d < 115; d++) if (W.weatherOnDay(st, d, id).rain > 0) rainDays++; }
  const g = st.grid, D = { w: g.width - 0.5, h: (g.height - 1) * Math.sqrt(3) / 2 };
  for (const f of st.weather.fronts.filter((x) => x.sh)) {
    edges.add(f.x < 0 ? "w" : f.x > D.w ? "e" : f.y < 0 ? "n" : f.y > D.h ? "s" : "in");
    heads.add(Math.round(Math.atan2(f.vy, f.vx) / (Math.PI / 4)) & 7);
  }
}
console.log(`  raining: ${rainHours} sampled hours, ${(sumShare / rainHours).toFixed(2)} of the map on average, ${maxShare.toFixed(2)} at most; ${(rainDays / tilesN).toFixed(1)} rain days a tile a year; edges ${[...edges].sort().join(",")}; headings ${heads.size} of 8`);
check(rainHours > 100, "it rains on many hours of the year");
check(maxShare < 0.95, `never the whole state at once (at most ${maxShare.toFixed(2)})`);
check(sumShare / rainHours < 0.5, "while it rains, most of the state is dry");
check([...edges].filter((e) => e !== "in").length >= 3, `belts from three or more edges (${[...edges].join(",")})`);
check(heads.size >= 4, `belts heading four or more ways (${heads.size})`);
const perYear = rainDays / tilesN;
check(perYear > 24 && perYear < 38, `about as many rain days a tile a year as before (${perYear.toFixed(1)}; about 30 before)`);

// 3. A band, and a wave that passes.
{
  const st = createWorld({ seed: 8, factionCount: 3 });
  W.weatherAt(st, 0, 60 * 24);
  const f = st.weather.fronts.find((x) => x.sh && x.t1 - x.t0 > 30 && x.k === "rain");
  if (check(!!f, "a rain belt that stays on the map a while")) {
    const h = f.t0 + 12, a = W.visibleFronts({ ...st, hour: h }).find((x) => x.id === f.id);
    const v = Math.hypot(f.vx, f.vy), ax = f.vx / v, ay = f.vy / v;
    const inside = (h2, ux, uy) => { const b = W.visibleFronts({ ...st, hour: h2 }).find((x) => x.id === f.id); if (!b) return false; const dx = ux - b.x, dy = uy - b.y, al = (dx * ax + dy * ay) / (b.r * W.WAVE.along), ac = (dy * ax - dx * ay) / (b.r * W.WAVE.across); return al * al + ac * ac <= 1; };
    check(a && a.sh === 1, "visibleFronts marks the belt as a band");
    check(inside(h, a.x - ay * a.r * 1.5, a.y + ax * a.r * 1.5) && !inside(h, a.x + ax * a.r * 0.9, a.y + ay * a.r * 0.9), "a band: 1.5 radii across its way inside, 0.9 radii along it outside");
    const later = [6, 10, 14, 18].some((dt) => !inside(h + dt, a.x, a.y));
    check(later, "the point under its middle now is out from under it within 18 hours (it moves on)");
  }
}

// 5. Old saves: a rain day without d.wave keeps its statewide rain.
{
  const st = createWorld({ seed: 11, factionCount: 3 });
  let d0 = -1;
  for (let d = 3; d < 200 && d0 < 0; d++) { W.weatherAt(st, 0, d * 24 + 12); const day = st.weather.days[d]; if (day.k === "rain" && day.wave) d0 = d; }
  if (check(d0 >= 0, "a rain day")) {
    const h = d0 * 24 + 12, N = st.tiles.length;
    const share = () => { let n = 0, m = 0; for (let id = 0; id < N; id += 7) { m++; if (wetK(W.skyAt(st, id, h))) n++; } return n / m; };
    const now = share();
    delete st.weather.days[d0].wave;
    W.dropWeatherCaches();
    const old = share();
    check(now < 0.95 && old === 1, `with belts ${now.toFixed(2)} of the map rains; the same day made before them rains everywhere (${old})`);
  }
}

// 6. The same seed, the same belts.
{
  const a = createWorld({ seed: 21, factionCount: 3 }), b = createWorld({ seed: 21, factionCount: 3 });
  W.weatherAt(a, 0, 40 * 24); W.weatherAt(b, 0, 40 * 24);
  const key = (s) => JSON.stringify(s.weather.fronts.filter((f) => f.sh).map((f) => [f.x, f.y, f.vx, f.vy, f.r, f.t0]));
  check(key(a) === key(b) && key(a).length > 10, "the same seed, the same rain belts");
}

console.log(`${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
