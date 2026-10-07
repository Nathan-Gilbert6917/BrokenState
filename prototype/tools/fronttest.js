// Headless check of regional weather (sim/weather.js fronts, frozen rivers; sim/rivers.js):
//  1. Fronts are seeded: the same seed gives the same fronts, another seed others; looking at the weather never
//     draws from the play RNG. Each front comes in at a map edge (fog forms inland), moves at its kind's speed and
//     lives at most FRONT.maxLife hours; every kind turns up over two years.
//  2. Local weather differs across the map (most hours have more than one kind of weather on it), and home's
//     weather (the hub's tile) is what weather(state) gives.
//  3. Travel slows inside a storm front and not outside it (outside: exactly the day's table); a front not yet on
//     the map is not in an estimate made before it formed (known), and a trip estimated with one on the map matches
//     the real trip; the arrival hour frontsApproaching gives for home is the hour the front gets there.
//  4. Rivers freeze only in deep winter and thaw again, north first: frozen river tiles can be walked (ICE.walk),
//     never driven; a way on foot crosses the ice, a car's does not; a horde crosses frozen water; a team standing
//     on ice that thaws gets ashore; thin ice only near the freezing point.
//  5. Save and load mid-storm: the same fronts, the same weather on every tile, the same world after more hours;
//     a save made before fronts existed (no state.weather.fs) loads and gets them.
// Usage: node tools/fronttest.js [seeds, default 6]
import { createWorld, tickHour, hub } from "../src/sim/world.js";
import { planPath, moveCost, travelHours } from "../src/sim/parties.js";
import { makeHorde, hordesHour } from "../src/sim/hordes.js";
import { riversHour } from "../src/sim/rivers.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import * as W from "../src/sim/weather.js";

const nSeeds = Number(process.argv[2] || 6);
let passed = 0, fails = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const ROW = Math.sqrt(3) / 2;
// The tile under a point in tile units (or -1 off the map).
const tileAt = (st, ux, uy) => {
  const y = Math.round(uy / ROW), x = Math.round(ux - 0.5 * (y & 1));
  return x >= 0 && y >= 0 && x < st.grid.width && y < st.grid.height ? st.grid.id(x, y) : -1;
};
const posAt = (f, h) => [f.x + f.vx * (h - f.t0), f.y + f.vy * (h - f.t0)];

// ---------- 1. seeded fronts ----------
console.log("Fronts: seeded, from the edges, moving");
{
  const a = createWorld({ seed: 42, factionCount: 3 }), b = createWorld({ seed: 42, factionCount: 3 }), c = createWorld({ seed: 43, factionCount: 3 });
  const before = a.rng.state;
  for (const st of [a, b, c]) W.weatherOnDay(st, 230);
  check(a.rng.state === before, "making fronts drew from the play RNG");
  const sig = (st) => JSON.stringify(st.weather.fronts);
  check(sig(a) === sig(b), "same seed, different fronts");
  check(sig(a) !== sig(c), "seeds 42 and 43 have the same fronts");
  const kinds = {};
  let edge = 0, inland = 0, badSpeed = 0, badLife = 0, n = 0;
  const D = { w: a.grid.width - 0.5, h: (a.grid.height - 1) * ROW };
  for (let sd = 1; sd <= nSeeds; sd++) {
    const st = createWorld({ seed: sd * 101, factionCount: 2 });
    W.weatherOnDay(st, 225);
    for (const f of st.weather.fronts) {
      n++;
      kinds[f.k] = (kinds[f.k] || 0) + 1;
      const def = W.FRONT_KINDS[f.k], sp = Math.hypot(f.vx, f.vy);
      if (sp < def.speed[0] - 0.02 || sp > def.speed[1] + 0.02) badSpeed++;
      if (f.t1 - f.t0 > W.FRONT.maxLife || f.t1 <= f.t0) badLife++;
      const out = f.x <= 0.01 || f.y <= 0.01 || f.x >= D.w - 0.01 || f.y >= D.h - 0.01;
      if (f.k === "fog") inland += out ? 0 : 1; else edge += out ? 1 : 0;
    }
  }
  const nonFog = n - (kinds.fog || 0);
  console.log(`  ${n} fronts over ${nSeeds} seeds × 2 years (${(n / nSeeds / 224).toFixed(2)} a day): ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  check(edge === nonFog, `${nonFog - edge} fronts (not fog) started inside the map`);
  check(inland === (kinds.fog || 0), "a fog bank started off the map");
  check(!badSpeed, `${badSpeed} fronts outside their kind's speed`);
  check(!badLife, `${badLife} fronts with a bad lifetime`);
  check(["storm", "rain", "blizzard", "snow", "fog"].every((k) => kinds[k] > 0), "a kind of front never turned up");
  // They move: a front's middle is somewhere else 6 hours on.
  const f = a.weather.fronts.find((x) => x.k !== "fog");
  const [x0, y0] = posAt(f, f.t0 + 2), [x1, y1] = posAt(f, f.t0 + 8);
  check(Math.hypot(x1 - x0, y1 - y0) > 3, "a front did not move");
}

// ---------- 2. local weather ----------
console.log("Local weather across the map");
{
  let differ = 0, hours = 0, homeOk = 0, homeN = 0;
  for (let sd = 1; sd <= nSeeds; sd++) {
    const st = createWorld({ seed: sd * 313, factionCount: 2 });
    const h0 = hub(st).tile;
    for (let h = 24 * 3; h < 24 * 200; h += 11) {
      st.hour = h;
      const ks = new Set();
      for (let id = 0; id < st.tiles.length; id += 23) ks.add(W.weatherAt(st, id).key);
      hours++;
      if (ks.size > 1) differ++;
      homeN++;
      if (JSON.stringify(W.weather(st)) === JSON.stringify(W.weatherAt(st, h0))) homeOk++;
    }
  }
  console.log(`  ${differ}/${hours} sampled hours have more than one kind of weather on the map`);
  check(differ / hours > 0.3, "the weather is the same everywhere too often");
  check(homeOk === homeN, "weather(state) is not the weather at the hub");
  const st = createWorld({ seed: 7, factionCount: 2 });
  st.hour = 24 * 30;
  check(W.wxAt(st, 5, 7).key === W.weatherAt(st, st.grid.id(5, 7)).key, "wxAt(x, y) differs from weatherAt(tile)");
}

// ---------- 3. travel under a front, estimates, arrival times ----------
console.log("Travel inside and outside a storm; what estimates know");
{
  let inside = 0, slower = 0, outsideSame = 0, outsideN = 0, unknownOk = 0, unknownN = 0;
  let etaOk = 0, etaN = 0, tripOk = 0, tripN = 0;
  for (let sd = 1; sd <= nSeeds; sd++) {
    const st = createWorld({ seed: sd * 977, factionCount: 2 });
    W.weatherOnDay(st, 200);
    const storms = st.weather.fronts.filter((f) => (f.k === "storm" || f.k === "blizzard") && f.t1 - f.t0 > 16);
    for (const f of storms.slice(0, 6)) {
      const h = f.t0 + 8;
      st.hour = h - 1;
      const [cx, cy] = posAt(f, h);
      const mid = tileAt(st, cx, cy);
      if (mid < 0 || st.tiles[mid].terrain === "water") continue;
      const a = W.frontAt(st, mid, h);
      if (!a || a.f !== f) continue; // another, stronger front on top: skip
      const d = st.weather.days[Math.floor(h / 24)];
      inside++;
      const fIn = W.travelFactor(st, { vehicle: false, tileId: mid, hour: h });
      if (fIn > d.tf[st.tiles[mid].roadLinks.length ? 0 : 1]) slower++;
      // Far away (no front there at all): exactly the day's table.
      for (const t of st.tiles) {
        if (t.terrain === "water" || W.frontAt(st, t.id, h) || Math.hypot(...posAt(f, h).map((v, i) => v - [t.x + 0.5 * (t.y & 1), t.y * ROW][i])) < f.r + 6) continue;
        outsideN++;
        if (W.travelFactor(st, { vehicle: true, tileId: t.id, hour: h }) === d.tf[t.roadLinks.length ? 2 : 3]) outsideSame++;
        break;
      }
      // Before the front formed, an estimate cannot know it.
      unknownN++;
      if (W.travelFactor(st, { vehicle: false, tileId: mid, hour: h, known: f.t0 - 1 }) <= W.travelFactor(st, { vehicle: false, tileId: mid, hour: h }) &&
          !(W.frontAt(st, mid, h, f.t0 - 1) && W.frontAt(st, mid, h, f.t0 - 1).f === f)) unknownOk++;
      // A walk through the storm, estimated once it is on the map: the estimate equals stepping with all fronts.
      const from = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, mid) === 6);
      if (from) {
        const way = planPath(st, from.id, mid, false);
        if (way) {
          st.hour = f.t0 + 1;
          const est = travelHours(st, way.path, { startHour: st.hour });
          const real = travelHours(st, way.path, { startHour: st.hour, known: Infinity });
          tripN++;
          if (est.hours === real.hours || st.weather.fronts.some((g) => g.t0 > st.hour && g.t0 <= st.hour + real.hours)) tripOk++;
        }
      }
      // frontsApproaching: the hour it says the front reaches a tile ahead of it is the hour it does.
      st.hour = f.t0 + 2;
      const [px, py] = posAt(f, f.t0 + 14);
      const ahead = tileAt(st, px, py);
      if (ahead >= 0) {
        const x = W.frontsApproaching(st, ahead, 30).find((y) => y.f === f);
        if (x && x.eta != null) {
          etaN++;
          let real = null;
          // The hour its edge first covers the tile (another front on top may hide it from frontAt).
          const [ux, uy] = [st.tiles[ahead].x + 0.5 * (st.tiles[ahead].y & 1), st.tiles[ahead].y * ROW];
          for (let k = 1; k <= 30 && real == null; k++) {
            const t = st.hour + k, [fx, fy] = posAt(f, t), r = f.r * Math.min(1, (f.t1 - t) / W.FRONT.fadeHours, (t - f.t0 + 1) / W.FRONT.growHours);
            if (t < f.t1 && (ux - fx) ** 2 + (uy - fy) ** 2 <= r * r) real = k;
          }
          if (real != null && real === x.eta) { const g = W.frontAt(st, ahead, st.hour + real); if (!g) real = -1; } // and the tile has a front then
          if (real === x.eta) etaOk++;
        }
      }
    }
  }
  console.log(`  ${inside} storm or blizzard middles: ${slower} slower than the day's table; ${outsideSame}/${outsideN} far tiles exactly the table; ${unknownOk}/${unknownN} unknown before they formed; ${tripOk}/${tripN} estimates through a known front exact; ${etaOk}/${etaN} arrival hours right`);
  check(inside >= 6, `only ${inside} storms found to test`);
  check(slower === inside, "travel inside a storm was not slower");
  check(outsideSame === outsideN && outsideN > 0, "travel outside every front differs from the day's table");
  check(unknownOk === unknownN, "an estimate knew a front before it formed");
  check(tripOk === tripN && tripN > 0, "an estimate through a front already on the map was off");
  check(etaOk === etaN && etaN > 0, "frontsApproaching gave a wrong arrival hour");
}

// ---------- 4. frozen rivers ----------
console.log("Frozen rivers");
{
  let badSeason = 0, froze = 0, thawed = 0, frozenDays = 0, northFirst = 0, nf = 0;
  for (let sd = 1; sd <= nSeeds; sd++) {
    const st = createWorld({ seed: sd * 59, factionCount: 2 });
    let was = -1;
    for (let i = 0; i < W.YEAR_DAYS * 2; i++) {
      st.hour = i * 24 + 12;
      const row = W.iceRow(st), s = W.seasonOfDay(i);
      if (row >= 0) {
        frozenDays++;
        // Deep winter: in winter, or the first weeks of spring before the ice has melted.
        if (!(s.key === "winter" || (s.key === "spring" && s.dayOfSeason <= 21))) badSeason++;
      }
      if (row >= 0 && was < 0) froze++;
      if (row < 0 && was >= 0) thawed++;
      if (row >= 0 && was >= 0 && row !== was) { nf++; if ((row > was) === (W.iceIndex(st) > W.iceIndex(st, st.hour - 24))) northFirst++; }
      was = row;
    }
  }
  console.log(`  ${froze} freezes, ${thawed} thaws, ${(frozenDays / nSeeds / 2).toFixed(1)} days a year with some river frozen`);
  check(!badSeason, `${badSeason} days with ice outside deep winter`);
  check(froze >= nSeeds && thawed >= nSeeds, "the rivers did not freeze and thaw every winter");
  check(northFirst === nf, "the ice did not spread south as it thickened (and back north as it melted)");

  // Walking, driving, a horde, a thaw under a team.
  const st = createWorld({ seed: 4242, factionCount: 2 });
  let day = W.YEAR_DAYS - 40; // winter of year 1
  while (W.iceRow(st, day * 24 + 1) < Math.floor(st.grid.height * 0.4) && day < W.YEAR_DAYS + 10) day++;
  st.hour = day * 24 + 1;
  riversHour(st);
  const row = W.iceRow(st);
  check(row >= 0, "no ice found in the first winter");
  const ice = st.tiles.find((t) => t.terrain === "water" && !t.bridge && t.y <= row && t.y > 2 &&
    st.grid.neighbors(t.id).filter((n) => st.tiles[n].terrain !== "water").length >= 2);
  if (check(!!ice, "no frozen river tile with land on both sides")) {
    const banks = st.grid.neighbors(ice.id).filter((n) => st.tiles[n].terrain !== "water");
    const [a, b] = [banks[0], banks.find((n) => st.grid.distance(n, banks[0]) === 2) ?? banks[banks.length - 1]];
    check(moveCost(st, a, ice.id, false) === W.ICE.walk, `walking onto the ice costs ${moveCost(st, a, ice.id, false)}`);
    check(moveCost(st, a, ice.id, true) === Infinity && moveCost(st, a, ice.id, "bike") === Infinity, "a vehicle can drive onto the ice");
    check(W.riverFrozen(st, ice.id) && !W.riverFrozen(st, a), "riverFrozen is wrong");
    // A way on foot from bank to bank goes over the ice when that is the short way; it never does by car.
    const foot = planPath(st, a, b, false), car = planPath(st, a, b, true);
    check(!!foot && foot.path.length <= 4, `on foot the way over the ice is ${foot ? foot.path.length : "none"} tiles`);
    check(!car || !car.path.some((id) => st.tiles[id].terrain === "water" && !st.tiles[id].bridge), "a car's way crosses the ice");
    // A horde walks across.
    st.hordes.length = 0;
    const h = makeHorde(st, { tile: a, size: 40, target: b, role: "roam" });
    let crossed = false;
    for (let k = 0; k < 60 && h.tile !== b; k++) { h.move = 1000; hordesHour(st); if (st.tiles[h.tile].terrain === "water" && !st.tiles[h.tile].bridge) crossed = true; }
    check(crossed && h.tile === b, "a horde did not cross the frozen river");
    // A team (any party) standing on the ice when it thaws gets ashore.
    const p = { id: 999001, owner: "player", kind: "convoy", phase: "out", path: [a, ice.id, b], idx: 1, progress: 0, members: [], vehicle: false, stance: "normal" };
    st.parties.push(p);
    const h2 = makeHorde(st, { tile: ice.id, size: 30, target: null, role: "roam" });
    let t = st.hour;
    while (W.iceRow(st, t) >= ice.y && t < st.hour + 24 * 120) t += 24;
    check(W.iceRow(st, t) < ice.y, "the ice never thawed");
    st.hour = t;
    riversHour(st);
    check(st.tiles[p.path[p.idx]].terrain !== "water" || st.tiles[p.path[p.idx]].bridge, "a party was left on thawed water");
    check(st.tiles[h2.tile].terrain !== "water" || st.tiles[h2.tile].bridge, "a horde was left on thawed water");
    check(moveCost(st, a, ice.id, false) === Infinity, "the river can be walked after the thaw");
    st.parties.splice(st.parties.indexOf(p), 1);
    // Thin ice only close to the freezing point.
    let thinBad = 0;
    for (let h3 = st.hour - 24 * 60; h3 < st.hour; h3 += 24) for (const t2 of st.tiles) {
      if (!W.thinIce(st, t2.id, h3)) continue;
      const need = W.ICE.freeze + W.ICE.south * (t2.y / (st.grid.height - 1));
      if (W.iceIndex(st, h3) - need >= W.ICE.thin || !W.riverFrozen(st, t2.id, h3)) thinBad++;
    }
    check(!thinBad, `${thinBad} thin-ice tiles away from the freezing point`);
  }
}

// ---------- 5. save and load mid-storm ----------
console.log("Save and load mid-storm");
{
  const st = createWorld({ seed: 31337, factionCount: 3 });
  st.started = true;
  W.weatherOnDay(st, 60);
  const f = st.weather.fronts.find((x) => x.k === "storm" && x.t0 > 24 * 3);
  if (check(!!f, "no storm in the first 60 days")) {
    while (st.hour < f.t0 + 6) { tickHour(st); st.cards.length = 0; if (st.combat) st.combat = null; }
    const over = st.tiles.filter((t) => W.frontAt(st, t.id)?.f.id === f.id).map((t) => t.id);
    check(over.length > 5, "the storm covers no land");
    const text = saveToString(st);
    const ld = loadFromString(text);
    check(JSON.stringify(ld.weather.fronts) === JSON.stringify(st.weather.fronts), "fronts changed in the save");
    let same = true;
    for (let id = 0; id < st.tiles.length; id += 7) if (JSON.stringify(W.weatherAt(st, id)) !== JSON.stringify(W.weatherAt(ld, id))) same = false;
    check(same, "local weather differs after loading");
    check(over.every((id) => W.frontAt(ld, id)?.f.id === f.id), "the storm is not over the same tiles after loading");
    for (let k = 0; k < 48; k++) { for (const x of [st, ld]) { tickHour(x); x.cards.length = 0; if (x.combat) x.combat = null; } }
    check(JSON.stringify([st.rng.state, st.weather.fronts.length, st.hordes.map((h) => h.tile)]) === JSON.stringify([ld.rng.state, ld.weather.fronts.length, ld.hordes.map((h) => h.tile)]), "the loaded world played out differently");
    // A save from before fronts: no fs, fronts, fd.
    const old = loadFromString(text);
    delete old.weather.fs; delete old.weather.fronts; delete old.weather.fd; delete old.weather.nf; delete old.weather.iceRow;
    for (const d of old.weather.days) delete d.ice;
    const w = W.weather(old);
    check(Number.isFinite(w.temp) && Array.isArray(old.weather.fronts) && old.weather.fronts.length > 0, "an old save did not get fronts");
    W.weatherOnDay(old, 60); // fronts are made a day at a time, as far as anything asks
    check(JSON.stringify(old.weather.fronts.slice(0, 20)) === JSON.stringify(st.weather.fronts.slice(0, 20)), "an old save's fronts are not the seed's");
    check(old.weather.days.every((d) => Number.isFinite(d.ice)), "an old save's days have no ice index");
    for (let k = 0; k < 24; k++) { tickHour(old); old.cards.length = 0; if (old.combat) old.combat = null; }
    check(Number.isFinite(W.weather(old).temp), "an old save broke after a day");
  }
}

console.log(`\n${passed} checks passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
