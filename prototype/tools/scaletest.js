// Buildings at real size (issue #24, src/sim/data-buildingsize.js, buildingmaps.js realScale). Checks, over SEEDS seeds a
// kind (200 by default; --quick 40):
//   - every archetype's footprint, in metres (CELL_M a cell), within its REAL_SIZE row (#22's and #23's kinds: their
//     archetype's own); its storeys within the row's range for the setting; city offices and apartments reach 6–10,
//     a town's stay 2–4 and 3–6; at most MAX_STOREYS; the floors built never over openStoreys and the stairs up from
//     a taller building's top floor blocked;
//   - every map fits its building and is at most 300 × 300 (a city's building at the largest raid map dial, 300);
//   - rooms and containers per square metre of the ground floor, and the dead per square metre of every floor built,
//     within ±15% of today's (the same archetype's plan at its old size, an older save's: legacyScale), the kind's
//     average over the seeds;
//   - an older save keeps its buildings exactly (the archetype's own footprint and storeys, the map cell for cell);
//   - every kind's map connected (every walkable cell of every floor reached from the front, through the stairs);
//   - the kinds with a dozen named plans (civicvariants.js, issue #36): the checks above on each kind's "general" plan
//     (#14's or #15's, the one realScale lays out); every named plan within its own row ("<kind>.<plan id>": its footprint
//     and storeys, planned: realScale leaves it as it is).
// Prints the size table in metres and the densities, new against old.
// Usage: node tools/scaletest.js [seeds=200] [--quick]
import { createWorld } from "../src/sim/world.js";
import { BUILDINGS, assemble, realScale, MAX_STOREYS, OPEN_STOREYS, openStoreys, buildingMap, buildingSpec, settingOf, BMAP } from "../src/sim/buildingmaps.js";
import { REAL_SIZE, CELL_M, storeyRange } from "../src/sim/data-buildingsize.js";
import { CELL, RAID_W, RAID_H } from "../src/sim/combat.js";
import { cleanCfg } from "../src/sim/worldcfg.js";
import { fitMargins, buildingDeadScale, BIG } from "../src/sim/battlesize.js";
import { Rng } from "../src/sim/rng.js";
import { VARIANTS } from "../src/sim/civicvariants.js"; // a dozen named plans per civic and medical kind (issue #36)

const QUICK = process.argv.includes("--quick") || process.env.BS_QUICK === "1";
const SEEDS = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || (QUICK ? 40 : 200));
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const t0 = Date.now();
const KEYS = Object.keys(BUILDINGS).filter((k) => !BUILDINGS[k].street);
const GENERAL = (key) => (VARIANTS[key] ? { plan: "general" } : {}); // a kind with named plans (issue #36): the one realScale lays out (the named ones: their own rows, below)

// The floor area (cells) and what is on it: rooms, containers, and the dead the map would hold for a roster of 10.
// The dead as placeInterior counts them (a big map's scales on: a world made since the dials), on the map the plan gets
// in a city at the usual largest raid map (TARGET: 56 × 42) and margins fitted to it.
const TARGET = [56, 42];
const oldDead = (w, h) => { const b0 = Math.max(BMAP.DEAD_SCALE[0], Math.min(BMAP.DEAD_SCALE[1], (w * h) / (RAID_W * RAID_H))); return w * h > BIG.FROM ? buildingDeadScale(b0, w, h) : b0; };
const mapOf = (bw, bh) => { const m = fitMargins(bw, bh, BMAP.MARGIN, TARGET); return [bw + m.left + m.right, bh + m.front + m.back]; };
// Rooms and containers on the ground floor over its footprint (like with like: a kind whose storeys changed has upper
// floors of other plans), the dead over every floor built.
function measure(spec, m) {
  const area = spec.bw * spec.bh, floorsArea = area * (m.floors ? m.floors.length : 1);
  const rooms = m.rooms.filter((r) => !r.outdoor && !r.noLabel && !(r.f > 0)).length, boxes = m.containers.filter((c) => !(c.f > 0)).length; // the rooms one searches (no corridors, halls, walkways)
  const deadScale = m.deadK ? oldDead(...mapOf(spec.natW, spec.natH)) * m.deadK : oldDead(...mapOf(spec.bw, spec.bh));
  return { area, floorsArea, rooms, boxes, dead: Math.min(m.deadK ? BMAP.DEAD_CAP : Infinity, 10 * deadScale) };
}
// Every walkable cell of every floor reached from the front entry (the stairs join the floors at their top step).
function connected(m) {
  const floors = m.floors || [{ cells: m.cells }], W = m.w, H = m.h, seen = floors.map(() => new Uint8Array(W * H));
  const pass = (c) => CELL[c.k] && (CELL[c.k].walk || c.k === "door" || c.k === "idoor" || c.k === "odoor");
  const q = [[0, m.front.y * W + m.front.x]];
  seen[0][q[0][1]] = 1;
  while (q.length) {
    const [f, i] = q.pop(), x = i % W, y = (i / W) | 0;
    const c = floors[f].cells[i];
    const go = (g, j) => { if (g >= 0 && g < floors.length && !seen[g][j] && pass(floors[g].cells[j])) { seen[g][j] = 1; q.push([g, j]); } };
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) go(f, ny * W + nx); }
    if (c.k === "stairs" && (c.top || c.step == null)) { go(f + 1, i); go(f - 1, i); }
  }
  let lost = 0;
  floors.forEach((F, f) => F.cells.forEach((c, i) => { if (CELL[c.k] && CELL[c.k].walk && c.k !== "void" && !seen[f][i] && c.f === "floor") lost++; }));
  return lost;
}

console.log(`The size table (CELL_M = ${CELL_M} m a cell), ${SEEDS} seeds a kind`);
const dens = [];
{
  let badFoot = 0, badStorey = 0, badMap = 0, badOpen = 0, badSeal = 0, badConn = 0;
  const city = { offices: new Set(), apartments: new Set() }, town = { offices: new Set(), apartments: new Set() };
  for (const key of KEYS) {
    const R = REAL_SIZE[key];
    if (!check(!!R, `${key}: a row in REAL_SIZE`)) continue;
    const mine = !R.own && !R.planned; // the rows this ticket sizes (the others: #22's, #23's, #25's, #26's and #27's own)
    const acc = { n: { area: 0, floorsArea: 0, rooms: 0, boxes: 0, dead: 0 }, o: { area: 0, floorsArea: 0, rooms: 0, boxes: 0, dead: 0 } };
    let wMin = Infinity, wMax = 0, dMin = Infinity, dMax = 0, wings = 0, tall = 0, scaledN = 0;
    for (let s = 0; s < SEEDS; s++) {
      const setting = s % 3 === 0 ? "city" : s % 3 === 1 ? "town" : "rural";
      const r0 = new Rng(9001 + s * 131 + key.length * 7), nat = BUILDINGS[key].make(r0, GENERAL(key));
      const spec = realScale(r0, nat, key, { setting, storeyBonus: s % 5 === 4 ? 1 : 0 });
      const wm = spec.bw * CELL_M, dm = spec.bh * CELL_M;
      wMin = Math.min(wMin, wm); wMax = Math.max(wMax, wm); dMin = Math.min(dMin, dm); dMax = Math.max(dMax, dm);
      const scaled = spec.natW != null; // laid out by realScale (else a plan drawn at its own size: a planned row's, #37's named plans)
      if (scaled) scaledN++;
      if (R.w && !R.own && scaled) {
        const okW = (wm >= R.w[0] && wm <= R.w[1]) || (R.small && wm >= R.small[1][0] && wm <= R.small[1][1]);
        const okD = (dm >= R.d[0] && dm <= R.d[1]) || (R.small && dm >= R.small[2][0] && dm <= R.small[2][1]);
        if (!okW || !okD) { badFoot++; if (badFoot <= 5) console.log(`    ${key}: ${wm} × ${dm} m outside ${R.w.join("–")} × ${R.d.join("–")}`); }
      } else if (spec.bw !== nat.bw || spec.bh !== nat.bh) { badFoot++; console.log(`    ${key}: another ticket's size changed (${nat.bw}×${nat.bh} → ${spec.bw}×${spec.bh})`); }
      if (!scaled && !R.own && (spec.bw !== nat.bw || spec.bh !== nat.bh || spec.height !== (nat.storeys || 1))) { badFoot++; console.log(`    ${key}: a planned building laid out again (${nat.bw}×${nat.bh} → ${spec.bw}×${spec.bh}, ${nat.storeys} → ${spec.height} storeys)`); }
      const range = storeyRange(key, setting);
      const bonus = s % 5 === 4 ? 1 : 0;
      if (range && R.city && (spec.height < range[0] || spec.height > Math.min(MAX_STOREYS, range[1] + bonus))) { badStorey++; console.log(`    ${key} (${setting}): ${spec.height} storeys outside ${range.join("–")}`); }
      if (range && !R.city && scaled && (spec.height < range[0] || spec.height > range[1])) { badStorey++; console.log(`    ${key}: ${spec.height} storeys outside ${range.join("–")}`); }
      if (spec.height > MAX_STOREYS || (!spec.real && spec.storeys !== openStoreys(spec.height, bonus))) { badOpen++; console.log(`    ${key}: ${spec.storeys} floors built of ${spec.height}`); } // #25's (spec.real): every floor built
      if (city[key] && setting === "city") city[key].add(spec.height);
      if (town[key] && setting === "town") town[key].add(spec.height);
      if (spec.wings > 1) wings++;
      if (spec.height > spec.storeys) tall++;
      // The map, and the same building at its old size (an older save's).
      const heavy = spec.bw * spec.bh * spec.storeys > 6000;
      if (heavy && s % 8) continue; // the biggest kinds' maps every eighth seed (the footprints above on every seed)
      const m = assemble(r0, spec, { key, name: key });
      if (m.w > 300 || m.h > 300 || m.building.w !== spec.bw || m.building.h !== spec.bh || m.w < spec.bw || m.h < spec.bh) { badMap++; console.log(`    ${key}: map ${m.w}×${m.h} for ${spec.bw}×${spec.bh}`); }
      if (spec.height > spec.storeys) {
        const top = m.floors[m.floors.length - 1].cells;
        if (!top.some((c) => c.k === "stairs" && c.sealUp && (c.top || c.step == null))) { badSeal++; console.log(`    ${key}: ${spec.height} storeys, ${spec.storeys} built, the stairs up not blocked`); }
      }
      if (!heavy || s % 16 === 0) { const lost = connected(m); if (lost) { badConn++; if (badConn <= 5) console.log(`    ${key} seed ${s}: ${lost} walkable cells not reached`); } }
      if (!scaled) continue; // the densities of what realScale laid out
      const r1 = new Rng(9001 + s * 131 + key.length * 7), old = BUILDINGS[key].make(r1, GENERAL(key)), mo = assemble(r1, old, { key, name: key });
      const a = measure(spec, m), b = measure(old, mo);
      for (const k of Object.keys(acc.n)) { acc.n[k] += a[k]; acc.o[k] += b[k]; }
    }
    const per = (A, k) => (A[k] / (k === "dead" ? A.floorsArea : A.area)) * 1000;
    dens.push({ key, R, mine: mine && acc.o.area > 0, w: [wMin, wMax], d: [dMin, dMax], wings, tall, acc, rooms: per(acc.n, "rooms") / per(acc.o, "rooms"), boxes: per(acc.n, "boxes") / per(acc.o, "boxes"), dead: per(acc.n, "dead") / per(acc.o, "dead"), areaK: acc.n.floorsArea / acc.o.floorsArea });
  }
  check(!badFoot, `every footprint in metres within its row (${badFoot} outside)`);
  check(!badStorey, `every building's storeys within its row's range for the setting (${badStorey} outside)`);
  check(!badOpen, `at most ${MAX_STOREYS} storeys, the floors built openStoreys of them (${OPEN_STOREYS}, one more deeper in the crawl) (${badOpen} wrong)`);
  check(!badSeal, `a taller building's top floor built has its stairs up blocked (${badSeal} not)`);
  check(!badMap, `every map fits its building and is at most 300 × 300 (${badMap} wrong)`);
  check(!badConn, `every walkable cell of every floor reached from the front (${badConn} maps with cells cut off)`);
  const s = (set) => [...set].sort((a, b) => a - b).join("/");
  check([...city.offices].some((n) => n >= 6) && [...city.offices].every((n) => n >= 6 && n <= 10) && [...city.apartments].some((n) => n >= 6) && [...city.apartments].every((n) => n >= 6 && n <= 10), `city offices (${s(city.offices)}) and apartments (${s(city.apartments)}) stand 6–10 storeys`);
  check([...town.offices].every((n) => n >= 2 && n <= 5) && [...town.apartments].every((n) => n >= 3 && n <= 7), `a town's offices (${s(town.offices)}) 2–4 and apartments (${s(town.apartments)}) 3–6 (+1 deeper in a crawl)`);
}

console.log("\nDensity per square metre of floor, new against today's (the kind's average)");
{
  const TOL = 0.15;
  let off = 0;
  console.log("  kind          metres (w × d)      area ×  wings  tall   rooms   boxes   dead");
  for (const d of dens) {
    const bad = d.mine && [d.rooms, d.boxes, d.dead].some((v) => Math.abs(v - 1) > TOL); // another ticket's design: shown, not judged
    if (bad) off++;
    console.log(`  ${d.key.padEnd(13)} ${`${d.w[0]}–${d.w[1]} × ${d.d[0]}–${d.d[1]}`.padEnd(19)} ${d.areaK.toFixed(1).padStart(5)}  ${String(d.wings).padStart(5)}  ${String(d.tall).padStart(4)}   ${d.rooms.toFixed(2)}    ${d.boxes.toFixed(2)}    ${d.dead.toFixed(2)}${bad ? "  ←" : ""}`);
  }
  check(!off, `rooms, containers and the dead per square metre within ±${TOL * 100}% of today's for every kind this ticket sizes (${off} off; #22's, #23's, #25's and #26's own designs shown, not judged)`);
}

console.log("\nThe named civic and medical plans at their own rows (civicvariants.js, issue #36)");
{
  let bad = 0, n = 0;
  for (const [kind, list] of Object.entries(VARIANTS)) for (const v of list) {
    if (v.id === "general") continue;
    const R = REAL_SIZE[`${kind}.${v.id}`];
    if (!R || !R.planned) { bad++; console.log(`    ${kind}.${v.id}: no planned row`); continue; }
    for (let s = 0; s < 6; s++) {
      const r = new Rng(9101 + s * 131), nat = BUILDINGS[kind].make(r, { plan: v.id }), spec = realScale(r, nat, kind, { setting: ["city", "town", "rural"][s % 3] });
      n++;
      const wm = spec.bw * CELL_M, dm = spec.bh * CELL_M;
      if (spec.natW != null || wm < R.w[0] || wm > R.w[1] || dm < R.d[0] || dm > R.d[1] || spec.height < R.storeys[0] || spec.height > R.storeys[1] || spec.storeys !== openStoreys(spec.height, 0)) { bad++; if (bad <= 5) console.log(`    ${kind}.${v.id}: ${wm} × ${dm} m, ${spec.height} storeys (${spec.storeys} built) against ${R.w.join("–")} × ${R.d.join("–")}, ${R.storeys.join("–")}`); }
    }
  }
  check(!bad, `every named plan's footprint and storeys within its own row, laid out as drawn (${n} builds, ${bad} outside)`);
}

console.log("\nAn older save keeps its buildings exactly; a new world's city towers are tall");
{
  const st = createWorld({ seed: 31, factionCount: 6 });
  const tile = st.tiles.find((t) => t.loc && t.loc.type === "city");
  const opt = { id: "offices", key: "offices", name: "Office building" };
  const fresh = buildingSpec(st, tile.id, opt);
  check(settingOf(tile) === "city" && fresh.height >= 6 && fresh.storeys <= OPEN_STOREYS + 1 && fresh.natW != null, `a new world's city office: ${fresh.bw} × ${fresh.bh} m, ${fresh.height} storeys, ${fresh.storeys} built`);
  st.scaleLegacy = true;
  const old = buildingSpec(st, tile.id, opt);
  const r = new Rng(0); void r;
  check(old.natW == null && old.height == null && old.storeys <= 8, `an older save's office keeps its archetype's own footprint and storeys (${old.bw} × ${old.bh}, ${old.storeys} floors)`);
  st.worldCfg = cleanCfg({ raidMax: 300 });
  const m1 = buildingMap(st, tile.id, opt, false), m2 = buildingMap(st, tile.id, opt, false);
  check(m1.w === m2.w && m1.cells.every((c, i) => JSON.stringify(c) === JSON.stringify(m2.cells[i])), "an older save's building is the same map every visit");
  delete st.scaleLegacy;
  const big = buildingMap(st, tile.id, { id: "hospital", key: "hospital", name: "Hospital", plan: "general" }, false); // the general hospital (issue #36: a named plan has its own row)
  check(big.w <= 300 && big.h <= 300 && big.w >= 290 && big.building.w >= 60, `a city hospital at the largest raid map dial: map ${big.w} × ${big.h}, the building ${big.building.w} × ${big.building.h}`);
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
