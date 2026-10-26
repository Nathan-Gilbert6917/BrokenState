// Gyms and bowling alleys (src/sim/reclayout.js; issue #56 of the round-2 epic #39, the user's request 2026-10-26:
// "gym, bowling alley"):
// - the registry: 12+ variants each (variantpick.js "gym", "bowling"), each a plan of its own (distinct room lists);
// - each variant's footprint and storeys within its size row (GYM.SIZE, BOWL.SIZE; a bowling alley's width its lanes'),
//   data-buildingsize.js REAL_SIZE's sizes rows equal to them;
// - each variant's signature rooms and pieces (the weight floor's racks and benches, the cardio floor's treadmills,
//   the ring's posts, the climbing walls, the pool's tiles, the spa's hot tub; a pinsetter and pins at every lane, the
//   ball returns, the scorers, the lane boards, the bar, the arcade, the pro shop);
// - everything connected: every container reached from the way in (the stairs on an upper floor);
// - the loot by room (the desk's first aid, the smoothie bar's protein, the bar's liquor, the pinsetter room's tools);
// - placement: the rows in data-placement.js, a variant of every size class the rows ask for; the picker's pick by the
//   tile class (a rural tile's small-town alley, a centre's YMCA or health club); new worlds hold gyms and bowling
//   alleys as POIs and as crawl places, an older world none;
// - the scenes on their maps.
// Usage: node tools/rectest.js [seeds]
import { createWorld } from "../src/sim/world.js";
import { BUILDINGS, assemble } from "../src/sim/buildingmaps.js";
import { GYM, BOWL, GYM_KEYS, BOWL_KEYS, laneWidth, gymPlan, bowlPlan } from "../src/sim/reclayout.js";
import { variantsOf, variantSize } from "../src/sim/variantpick.js";
import { REAL_SIZE } from "../src/sim/data-buildingsize.js";
import { PLACEMENT_ROWS } from "../src/sim/data-placement.js";
import { sizeFor, classesOf } from "../src/sim/placement.js";
import { ensurePois } from "../src/sim/pois.js";
import * as CC from "../src/sim/citycrawl.js";
import { gridOf, cellsOf, keyOf } from "../src/sim/citygrid.js";
import { CELL, AREAS } from "../src/sim/combat.js";
import { rollScenes } from "../src/sim/interiorscenes.js";
import { Rng } from "../src/sim/rng.js";

const QUICK = !!process.env.BS_QUICK;
const SEEDS = Number(process.argv[2] || (QUICK ? 3 : 6));
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const TYPES = { gym: { keys: GYM_KEYS, plan: gymPlan }, bowling: { keys: BOWL_KEYS, plan: bowlPlan } };

const build = (key, variant, s) => {
  const rng = new Rng(5600 + s * 7919 + variant.length * 131);
  const spec = BUILDINGS[key].make(rng, { variant });
  const m = assemble(rng, spec, { key, id: `${key}${s}`, name: key, withVehicle: s % 2 === 1 });
  return { spec, m };
};
const floorsOf = (m) => (m.floors && m.floors.length ? m.floors.map((F) => F.cells) : [m.cells]);
const kindsOf = (m) => { const out = {}; for (const cells of floorsOf(m)) for (const c of cells) out[c.k] = (out[c.k] || 0) + 1; return out; };
const floorsCount = (m, fl) => floorsOf(m).reduce((n, cells) => n + cells.filter((c) => c.k === "open" && c.fl === fl).length, 0);
// 4-way walk over walkable cells and doors from a set of start cells.
function walk(m, cells, starts) {
  const W = m.w, H = m.h, seen = new Uint8Array(W * H), q = [];
  for (const [x, y] of starts) { seen[y * W + x] = 1; q.push(y * W + x); }
  const pass = (c) => (CELL[c.k] && CELL[c.k].walk) || c.k === "door" || c.k === "idoor" || c.k === "odoor";
  while (q.length) {
    const i = q.pop(), x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!seen[j] && pass(cells[j])) { seen[j] = 1; q.push(j); }
    }
  }
  return seen;
}
// Every container has a reached cell beside it, on its floor (the ground floor from the front zone's edge, an upper
// floor from its stairs).
function unreached(m) {
  const fl = floorsOf(m), bad = [];
  fl.forEach((cells, f) => {
    const edge = [];
    for (let x = 0; x < m.w; x++) for (const y of [0, m.h - 1]) if (CELL[cells[y * m.w + x].k] && CELL[cells[y * m.w + x].k].walk) edge.push([x, y]);
    const starts = f === 0 ? edge : (m.stairs || []).map(([x, y]) => [x, y]);
    const seen = walk(m, cells, starts);
    for (const b of (m.containers || []).filter((c) => (c.f || 0) === f)) {
      let ok = false;
      for (let dy = -1; dy <= (b.h || 1) && !ok; dy++) for (let dx = -1; dx <= (b.w || 1) && !ok; dx++) { const x = b.x + dx, y = b.y + dy; if (x >= 0 && y >= 0 && x < m.w && y < m.h && seen[y * m.w + x]) ok = true; }
      if (!ok) bad.push(`${b.kind}@${f}:${b.x},${b.y}`);
    }
  });
  return bad;
}

console.log("The registry and the sizes");
for (const [key, T] of Object.entries(TYPES)) {
  const list = variantsOf(key);
  check(list.length >= 12 && list.length === T.keys.length, `${key}: ${list.length} variants registered (12 at least)`);
  check(list.every((e) => e.id && e.name), `${key}: every variant has an id and a name (spec.vid, spec.vname)`);
  const sizes = REAL_SIZE[key] && REAL_SIZE[key].sizes;
  const off = T.keys.filter((v) => {
    const S = key === "gym" ? GYM.SIZE[v] : { ...BOWL.SIZE[v], w: [laneWidth(BOWL.SIZE[v].lanes), laneWidth(BOWL.SIZE[v].lanes)] };
    const r = sizes && sizes[v];
    return !r || String(r.w) !== String(S.w) || String(r.d) !== String(S.h) || String(r.storeys) !== String(S.storeys);
  });
  check(!off.length, `${key}: REAL_SIZE's sizes row per variant matches the plans' (${off.join(", ") || "all " + T.keys.length})`);
  // Every size class the placement row asks for has variants of it.
  const want = [...new Set(classesOf(key).map((c) => sizeFor(key, c)))];
  const have = new Set(list.map((e) => variantSize(key, e)));
  check(want.every((s) => have.has(s)), `${key}: a variant of every size class its placement row asks for (${want.join(", ")}; the variants' ${[...have].join(", ")})`);
}
check(!!PLACEMENT_ROWS.gym && !!PLACEMENT_ROWS.bowling, "both have a placement row (data-placement.js)");

console.log(`\nThe plans (${SEEDS} seeds a variant)`);
const SIG = {
  gym: {
    chain24: { pieces: ["treadmill", "exbike", "squatrack", "dumbbells", "weightbench", "locker", "frontdesk"], areas: ["gymdesk", "gymfloor", "gymlocker"] },
    boxing: { pieces: ["ringpost", "punchbag", "locker"], areas: ["gymfloor", "gymlocker"] },
    crossfit: { pieces: ["squatrack", "rower", "punchbag"], areas: ["gymfloor", "gymstore"] },
    ymca: { pieces: ["treadmill", "squatrack", "bleachers", "locker"], areas: ["gymdesk", "gymlocker", "gymfloor"], floors: { pool: 1 }, storeys: 2 },
    climbing: { pieces: ["climbwall", "locker"], areas: ["smoothie", "gymdesk"], floors: { mat: 1 } },
    dojo: { pieces: ["yogamats"], areas: ["gymfloor", "gymlocker"], floors: { mat: 1 } },
    yoga: { pieces: ["yogamats"], areas: ["gymdesk", "smoothie"] },
    club: { pieces: ["hottub", "treadmill", "squatrack", "coldcase"], areas: ["smoothie", "gymspa", "gymlocker"], floors: { pool: 1 }, storeys: 2 },
    strip: { pieces: ["treadmill", "squatrack"], areas: ["gymdesk", "gymlocker"] },
    barn: { pieces: ["squatrack", "dumbbells"], areas: ["gymfloor"] },
    fitness: { pieces: ["treadmill"], areas: ["gymfloor"] },
    circuit: { pieces: ["exbike"], areas: ["gymdesk", "gymfloor"] },
    iron: { pieces: ["squatrack", "dumbbells", "displaycase"], areas: ["gymdesk", "gymfloor"], storeys: 2 },
  },
  bowling: Object.fromEntries(BOWL_KEYS.map((v) => [v, { pieces: ["pins", "pinsetter", "ballreturn", "scorer"], areas: ["lanes", "pinsetter", ...(["bowlbar", "legion", "billiards", "downtown", "mega", "glow", "league"].includes(v) ? ["bowlbar"] : ["shoecounter"])], floors: { lane: 1, gutter: 1 }, ...(v === "downtown" ? { storeys: 2 } : {}) }])),
};
SIG.bowling.mega.areas.push("arcade", "proshop"); SIG.bowling.family.areas.push("arcade"); SIG.bowling.league.areas.push("proshop");
for (const [key, T] of Object.entries(TYPES)) {
  const shapes = new Set(), bad = [], size = [], sig = [], conn = [], lanes = [];
  for (const v of T.keys) {
    for (let s = 0; s < SEEDS; s++) {
      const { spec, m } = build(key, v, s);
      const S = key === "gym" ? GYM.SIZE[v] : BOWL.SIZE[v];
      const w = key === "gym" ? S.w : [laneWidth(S.lanes), laneWidth(S.lanes)];
      if (spec.vid !== v || !spec.vname) bad.push(`${v}: vid ${spec.vid}`);
      if (spec.bw < w[0] || spec.bw > w[1] || spec.bh < S.h[0] || spec.bh > S.h[1] || spec.storeys < S.storeys[0] || spec.storeys > S.storeys[1]) size.push(`${v} ${spec.bw}×${spec.bh}×${spec.storeys}`);
      const k = kindsOf(m), areas = new Set(m.areas ? m.areas.map((a) => a.type) : (m.rooms || []).map((r) => r.type));
      const want = SIG[key][v];
      const miss = [...want.pieces.filter((p) => !k[p]), ...want.areas.filter((a) => !areas.has(a)), ...Object.keys(want.floors || {}).filter((f) => floorsCount(m, f) < want.floors[f]).map((f) => `fl ${f}`)];
      if (want.storeys && (m.floors || []).length < want.storeys) miss.push(`${want.storeys} storeys`);
      if (miss.length) sig.push(`${v}#${s}: ${miss.join(", ")}`);
      if (key === "bowling" && (k.pinsetter < S.lanes - 2 || k.pins < S.lanes - 3)) lanes.push(`${v}#${s}: ${k.pinsetter} pinsetters, ${k.pins} pins for ${S.lanes} lanes`);
      const u = unreached(m);
      if (u.length) conn.push(`${v}#${s}: ${u.slice(0, 3).join(" ")}`);
      shapes.add(`${v}:${(m.rooms || []).map((r) => r.name.replace(/ \d+$/, "")).sort().join("|")}`);
    }
  }
  const distinct = new Set([...shapes].map((x) => x.split(":")[1]));
  check(distinct.size >= 12, `${key}: ${distinct.size} distinct room plans among the variants (12 at least)`);
  check(!bad.length, `${key}: every spec names its variant (${bad.slice(0, 3).join("; ") || "all"})`);
  check(!size.length, `${key}: footprints and storeys within each variant's row (${size.slice(0, 3).join("; ") || "all"})`);
  check(!sig.length, `${key}: each variant's signature pieces, rooms and floors (${sig.slice(0, 4).join("; ") || "all"})`);
  if (key === "bowling") check(!lanes.length, `bowling: a pinsetter and pins at (almost) every lane (${lanes.slice(0, 3).join("; ") || "all"})`);
  check(!conn.length, `${key}: every container reached from the way in (${conn.slice(0, 3).join("; ") || "all"})`);
}

console.log("\nThe loot by room");
{
  const gear = (a) => (AREAS[a] && AREAS[a].gear ? AREAS[a].gear.map(([k]) => k) : []);
  const loot = (a) => (AREAS[a] && AREAS[a].loot ? Object.keys(AREAS[a].loot) : []);
  check(gear("gymdesk").includes("bandagekit") && loot("gymdesk").includes("food") && loot("smoothie").includes("food") && loot("smoothie").includes("water"), "a gym's desk holds first aid and bars, its smoothie bar drinks and protein");
  check(["whiskey", "vodka"].every((k) => gear("bowlbar").includes(k)) && ["hammer", "crowbar", "toolbox"].every((k) => gear("pinsetter").includes(k)) && loot("pinsetter").includes("parts"), "a bowling alley's bar holds liquor, its pinsetter room tools and parts");
  check(["gymfloor", "gymdesk", "smoothie", "gymlocker", "gymspa", "gymstore", "lanes", "shoecounter", "bowlbar", "pinsetter", "proshop"].every((a) => AREAS[a] && !gear(a).some((k) => /pistol|revolver|rifle|shotgun/.test(k))), "no gun in any of their rooms' tables");
}

console.log("\nThe picks by place");
{
  const pick = (key, cls, s) => TYPES[key].plan(new Rng(900 + s), { where: cls === "coast" || cls === "scenic" ? "rural" : cls, tileClass: cls }, (c) => sizeFor(key, c)).vid;
  const at = (key, cls) => { const out = {}; for (let s = 0; s < 200; s++) { const v = pick(key, cls, s); out[v] = (out[v] || 0) + 1; } return out; };
  const rural = at("bowling", "rural"), centreGym = at("gym", "centre"), townGym = at("gym", "town"), suburb = at("bowling", "suburb");
  check(Object.keys(rural).every((v) => ["smalltown", "legion", "candlepin", "duckpin", "classic", "roadside", "bowlbar", "billiards", "downtown"].includes(v)) && (rural.smalltown || 0) + (rural.legion || 0) > 80, `a rural tile's bowling alley a small-town alley or a Legion post's most often (${JSON.stringify(rural)})`);
  check(Object.keys(centreGym).every((v) => v === "ymca" || v === "club"), `a city centre's gym a YMCA or a health club (${JSON.stringify(centreGym)})`);
  check(!townGym.ymca && !townGym.club && Object.keys(townGym).length >= 4, `a town's gyms small ones of several kinds (${JSON.stringify(townGym)})`);
  check(Object.keys(suburb).every((v) => ["mega", "family", "glow", "league"].includes(v)), `the suburbs' bowling centres the big ones (${JSON.stringify(suburb)})`);
}

console.log("\nIn the world");
{
  const tally = { gym: 0, bowling: 0, crawl: { gym: 0, bowling: 0 }, old: 0, oldCrawl: 0 };
  for (let w = 0; w < (QUICK ? 3 : 6); w++) {
    for (const legacy of [false, true]) {
      const st = createWorld({ seed: 56000 + w, factionCount: 3, size: "small" });
      if (legacy) st.placeLegacy = true;
      for (const t of st.tiles) delete t.pois;
      ensurePois(st);
      for (const t of st.tiles) for (const p of t.pois || []) if (p.kind === "gym" || p.kind === "bowling") { if (legacy) tally.old++; else tally[p.kind]++; }
      for (const type of ["city", "town"]) {
        const t = st.tiles.find((x) => x.loc && x.loc.type === type);
        if (!t) continue;
        const g = gridOf(st, t);
        const c = { tile: t.id, grid: { size: g.size, r: g.r, town: g.town }, blocks: {}, visit: 1, alert: 0, trail: {}, cell: null };
        for (const [x, y] of cellsOf(c.grid)) for (const p of CC.genBlock(st, c, keyOf(x, y)).places) if (p.key === "gym" || p.key === "bowling") { if (legacy) tally.oldCrawl++; else tally.crawl[p.key]++; }
      }
    }
  }
  check(tally.gym > 0 && tally.bowling > 0, `new worlds hold gyms and bowling alleys as POIs (${tally.gym} gyms, ${tally.bowling} bowling alleys)`);
  check(tally.crawl.gym > 0 && tally.crawl.bowling > 0, `and in their crawls (${tally.crawl.gym} gyms, ${tally.crawl.bowling} bowling alleys)`);
  check(tally.old === 0 && tally.oldCrawl === 0, `an older world none (${tally.old} POIs, ${tally.oldCrawl} crawl places)`);
}

console.log("\nThe scenes");
{
  const seen = new Set();
  for (const [key, T] of Object.entries(TYPES)) for (const v of T.keys) for (let s = 0; s < 8; s++) {
    const { m } = build(key, v, s);
    const out = rollScenes(m, new Rng(70 + s * 13 + v.length), key);
    for (const x of (out && out.list) || []) seen.add(x.kind || x.key || x.name);
  }
  const want = ["recshelter", "lockerhold", "pinhide", "leaguenight"];
  check(want.every((k) => seen.has(k)), `the scenes turn up on their maps (${[...seen].filter((k) => want.includes(k)).join(", ") || "none"})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
