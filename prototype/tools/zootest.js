// Zoos (issue #59 of the round-2 epic #39, the user's request 2026-10-26: "zoos"; maps up to 500 × 500): src/sim/zoo.js
// lays out the site, src/sim/zoolayout.js its buildings, rooms and scenes. Checks:
// - the plans: twelve variants or more registered with the shared picker (variantpick.js "zoo", #41), each pinned
//   builds its own map (spec vid / vname on the map, #40), within ZOO.CAP (500) and its REAL_SIZE sizes row (#24), and
//   no two variants share a plan signature (tools/plansig.js: their rooms, doors and ways in differ);
// - the site, per variant: the entrance building with its turnstile hall straight through to the zoo, the animal
//   houses' dens, the enclosures (a fence ring with a keepers' gate; a moat where the paddock has one; a big cat's
//   perimeter fence), the keepers' room, the food prep's freezers and butcher's cases, the vet hospital's dart cabinet,
//   the café and the gift shop, the entrance plaza, the service road down the east side, the car park;
// - every walkable cell of the grounds reachable from the way in (nothing walled off: the guard's work), every
//   enclosure's inside through its gate, every building's front door;
// - the same zoo is the same map every visit, and two zoos differ;
// - placement (#42): the placement table's row; a huge zoo only on a city's centre or its city blocks; the picker gives
//   a city's big zoo or aquarium there and a small one out in the country; a new world has zoos, an older one none;
// - loot: the food prep's meat spoiled (its freezers' and cases' cold rule), the dart cabinet's tranquilliser darts,
//   loot found by a search roll across zoos;
// - the scenes (registerScene, with when): empty cages, the keepers' last stand and an escaped enclosure all turn up;
// - the animals: a raid on a zoo places the dead beasts (deadbeasts.js) inside their enclosures, never more of the
//   dead than ZOO.DEAD_MAX.
// Usage: node tools/zootest.js [seeds, default 6; BS_QUICK=1: 3]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { buildingMap, BUILDINGS, SITES } from "../src/sim/buildingmaps.js";
import { ZOO, ZOO_VARIANTS, ZOO_PADDOCKS, zooVariant } from "../src/sim/zoo.js";
import { ZOO_STYLES } from "../src/sim/zoolayout.js";
import { variantsOf, pickVariant, variantSize } from "../src/sim/variantpick.js";
import { REAL_SIZE } from "../src/sim/data-buildingsize.js";
import { PLACEMENT, BIG_KINDS } from "../src/sim/data-placement.js";
import { placementCtx, tileClass, sizeFor, PLACE_EXTRA, cityDistance, PLACE, sizeClassOf } from "../src/sim/placement.js";
import { CELL, BOX_LOOT, boxLoot, createBattle, registerCombatHandler } from "../src/sim/combat.js";
import { LOCATIONS, GEAR } from "../src/sim/data.js";
import { MAP_CAP } from "../src/sim/battlesize.js";
import { LOOT_SENSE } from "../src/sim/lootsense.js";
import { launchExpedition } from "../src/sim/parties.js";
import { ensurePois } from "../src/sim/pois.js";
import { planSignature } from "./plansig.js";

const SEEDS = Number(process.argv[2]) || (process.env.BS_QUICK ? 3 : 6);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };

const state = createWorld({ seed: 4242, factionCount: 4 });
const city = state.tiles.find((t) => t.loc && t.loc.type === "city");
const build = (id, plan, tile = city) => buildingMap(state, tile.id, { id, key: "zoo", name: "Zoo", plan }, null);

// ---------- the table: the plans, the cap, the rows ----------
check(variantsOf("zoo").length >= 12 && ZOO_VARIANTS.length >= 12, `${variantsOf("zoo").length} zoo plans registered (want 12+)`);
check(new Set(ZOO_VARIANTS.map((v) => v.id)).size === ZOO_VARIANTS.length, "every plan has its own id");
check(BUILDINGS.zoo && BUILDINGS.zoo.zoo && SITES.zoo && SITES.zoo[0] === "zoo", "BUILDINGS.zoo and SITES.zoo: a zoo POI opens the zoo's map");
check(MAP_CAP.zoo === 500 && ZOO.CAP === 500, "the zoo's map cap is 500 × 500 (battlesize.js MAP_CAP)");
check(!!LOCATIONS.zoo && !!LOOT_SENSE.zoo && !!PLACEMENT.zoo, "the zoo has a location, a loot-sense row and a placement row");
check(ZOO_VARIANTS.every((v) => REAL_SIZE.zoo.sizes[v.id]), "every plan has its REAL_SIZE sizes row (#24)");
check(!!GEAR.tranqdarts && GEAR.tranqdarts.cat === "medical", "the tranquilliser darts are an item");
check(pickVariant("zoo", null, { legacy: true }) === null, "an older save's pick is null");

// ---------- each plan, pinned ----------
const W = (m, f = 0) => (m.floors ? m.floors[f].cells : m.cells);
const sigs = new Map();
const sizes = {}, areas = {};
for (const V of ZOO_VARIANTS) {
  for (let s = 0; s < SEEDS; s++) {
    let m;
    try { m = build(`zt:${V.id}:${s}`, V.id); } catch (e) { check(false, `${V.id} seed ${s}: ${e.stack.split("\n").slice(0, 3).join(" | ")}`); continue; }
    const tag = `${V.id} #${s}`;
    const P = m.plan, cells = W(m), I = (x, y) => y * m.w + x;
    const rooms = m.rooms.filter((r) => !r.outdoor);
    const houses = P.houses;
    (sizes[V.id] = sizes[V.id] || []).push([m.w, m.h]);
    (areas[V.id] = areas[V.id] || []).push(houses.reduce((a, h) => a + h.w * h.h * (h.storeys || 1), 0));
    if (s === 0) { const g = planSignature(m); sigs.set(V.id, g.key); }
    check(m.vid === V.id && m.vname === V.name && P.zoo, `${tag}: the map carries its plan (vid ${m.vid}, vname ${m.vname})`);
    check(m.w <= ZOO.CAP && m.h <= ZOO.CAP, `${tag}: ${m.w} × ${m.h} within ${ZOO.CAP}`);
    const row = REAL_SIZE.zoo.sizes[V.id];
    check(m.w >= row.w[0] - 2 && m.w <= row.w[1] + 2 && m.h >= row.d[0] - 2 && m.h <= row.d[1] + 2, `${tag}: ${m.w} × ${m.h} within its REAL_SIZE row ${row.w.join("–")} × ${row.d.join("–")}`);
    check(houses.every((h) => h.storeys <= row.storeys[1]), `${tag}: no building taller than its row's ${row.storeys[1]} storeys`);
    // The entrance: its turnstile hall, the plaza before it.
    const ent = houses.find((h) => h.zooKind === "entrance");
    check(!!ent && rooms.some((r) => r.house === ent.k && r.zoo === "turnstiles") && rooms.some((r) => r.house === ent.k && r.zoo === "giftshop"), `${tag}: the entrance building with its turnstile hall and gift shop`);
    check((P.grounds || []).some((g) => g.kind === "plaza"), `${tag}: the entrance plaza`);
    check((P.grounds || []).some((g) => g.kind === "lot"), `${tag}: the visitor car park`);
    // The service road down the east side (road cells in a column east of the grounds, from near the top to the road).
    const roadCols = new Set(); for (let x = Math.floor(m.w / 2); x < m.w; x++) { let n = 0; for (let y = 0; y < m.h; y++) if (cells[I(x, y)].f === "road") n++; if (n > m.h * 0.6) roadCols.add(x); }
    check(roadCols.size >= ZOO.SERVICE, `${tag}: the service road down the east side`);
    // The back of house: the keepers' room, the food prep's freezers and cases.
    check(rooms.some((r) => r.zoo === "keeperroom" && r.type === "zookeeper"), `${tag}: a keepers' room`);
    const food = rooms.filter((r) => r.type === "zoofood");
    const foodBoxes = m.containers.filter((c) => food.some((r) => r.id === c.area));
    check(food.length >= 2 && foodBoxes.some((c) => c.kind === "freezer" || c.kind === "meatcase" || c.kind === "freezershelf"), `${tag}: the food prep with its freezers and butcher's cases (${foodBoxes.map((c) => c.kind).join(",")})`);
    // The vet hospital (every plan with one): #14's vet rooms and the dart cabinet.
    const wantsVet = V.boh.some((b) => b.startsWith("vethospital")) || V.list.some((e) => e.key === "vethospital");
    if (wantsVet) check(m.containers.some((c) => c.kind === "dartcab") && rooms.some((r) => r.type === "vet" && r.role === "theatre"), `${tag}: the vet hospital's surgery and dart cabinet`);
    // The animal houses' dens; the café and the gift shop where the plan has them.
    if (V.list.some((e) => e.t === "house" && e.animal !== "barn")) check(rooms.some((r) => r.den), `${tag}: an animal house's dens`);
    if (V.list.some((e) => e.key === "cafe")) check(houses.some((h) => h.zooKind === "cafe"), `${tag}: a café or a kiosk`);
    // The enclosures: a fence ring with a gate; a moat or a pool where the plan has one; a big cat's perimeter fence.
    const enc = P.grounds.filter((g) => g.kind === "enclosure");
    check(enc.length >= 2, `${tag}: ${enc.length} enclosures`);
    check(enc.every((g) => g.fence.length >= 8 && g.gate && cells[I(g.gate[0], g.gate[1])].k === "fieldgate"), `${tag}: every enclosure fenced with a keepers' gate`);
    const kinds = V.list.map((e) => e.kind || e.paddock).filter(Boolean);
    if (kinds.some((k) => ZOO_PADDOCKS[k] && ZOO_PADDOCKS[k].moat)) check(enc.some((g) => g.moat), `${tag}: a moat before a paddock`);
    if (kinds.some((k) => ZOO_PADDOCKS[k] && ZOO_PADDOCKS[k].pool)) check(enc.some((g) => g.pool), `${tag}: a pool`);
    if (kinds.some((k) => ZOO_PADDOCKS[k] && ZOO_PADDOCKS[k].fence === "pfence")) check(enc.some((g) => g.fenceKind === "pfence" && g.fence.some(([x, y]) => cells[I(x, y)].k === "pfence")), `${tag}: a perimeter fence round a dangerous animal's paddock`);
    // Every walkable ground cell reachable from the way in (doors open, the gates walkable).
    const z = m.zones[0], seen = new Uint8Array(m.w * m.h), stack = [I(z.x0 + 1, z.y0 + 1)];
    const walk = (c) => (CELL[c.k] && CELL[c.k].walk) || ["idoor", "odoor", "door", "fieldgate", "bdoor"].includes(c.k);
    seen[stack[0]] = 1;
    while (stack.length) { const i = stack.pop(), x = i % m.w, y = (i - x) / m.w; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= m.w || Y >= m.h) continue; const j = I(X, Y); if (!seen[j] && walk(cells[j])) { seen[j] = 1; stack.push(j); } } }
    let cut = 0; for (let i = 0; i < cells.length; i++) if (walk(cells[i]) && cells[i].f !== "floor" && !seen[i]) cut++;
    check(cut === 0, `${tag}: ${cut} walkable cells of the grounds cut off from the way in`);
    check(enc.every((g) => { for (let y = g.y0 + 1; y < g.y0 + g.h - 1; y++) for (let x = g.x0 + 1; x < g.x0 + g.w - 1; x++) if (walk(cells[I(x, y)]) && seen[I(x, y)]) return true; return false; }), `${tag}: every enclosure's inside reachable through its gate`);
    check(houses.every((h) => !h.front || [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => seen[I(h.front.x + dx, h.front.y + dy)])), `${tag}: every building's front door on reachable ground`);
  }
}
for (const V of ZOO_VARIANTS) {
  const a = areas[V.id] || [], mean = a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  check(sizeClassOf(mean, 1, 1) === variantSize("zoo", V), `${V.id}: its buildings' floor area (${Math.round(mean)} m² a site) is its registered size class (${variantSize("zoo", V)})`);
}
check(new Set(sigs.values()).size === ZOO_VARIANTS.length, `the ${ZOO_VARIANTS.length} plans have ${new Set(sigs.values()).size} distinct plan signatures (want every one its own)`);
console.log("\nMap sizes by plan (w × h over the seeds):");
for (const [id, list] of Object.entries(sizes)) console.log(`  ${id.padEnd(13)} ${list.map(([w, h]) => `${w}×${h}`).join("  ")}`);

// ---------- the same zoo, the same map ----------
{
  const hash = (m) => { let h = 0; for (const c of W(m)) h = (h * 31 + c.k.length * 7 + c.k.charCodeAt(0) + (c.f ? c.f.charCodeAt(0) : 0)) | 0; return `${m.w}x${m.h}:${h}:${m.containers.length}`; };
  const a = hash(build("ztsame", "townzoo")), b = hash(build("ztsame", "townzoo")), c = hash(build("ztother", "townzoo"));
  check(a === b, "the same zoo is the same map every visit");
  check(a !== c, "two zoos of a plan differ");
}

// ---------- placement (#42) ----------
{
  const row = PLACEMENT.zoo;
  check(BIG_KINDS.includes("zoo") && row.size.centre === "huge" && row.size.city === "huge", "the placement table: a city's big zoo by the centre (huge)");
  check(Object.entries(row.size).every(([cls, sz]) => sz !== "huge" || cls === "centre" || cls === "city"), "a huge zoo only on a city's centre or its city blocks");
  check(["rural", "highway"].every((cls) => sizeFor("zoo", cls) === "medium"), "the country's zoos are medium at most (a petting zoo, a roadside zoo, a sanctuary): #42's rule for rural tiles");
  check(PLACE_EXTRA.some(([k]) => k === "zoo"), "placement.js PLACE_EXTRA puts zoos where the old POI pools have no slot");
  const byCls = {};
  for (const t of state.tiles) {
    const cls = tileClass(state, t);
    if (byCls[cls] && byCls[cls].length >= 30) continue;
    (byCls[cls] = byCls[cls] || []).push(zooVariant(state, t.id, { id: "ztplace" }).id);
  }
  const huge = new Set(ZOO_VARIANTS.filter((v) => variantSize("zoo", v) === "huge").map((v) => v.id));
  const medium = new Set(ZOO_VARIANTS.filter((v) => variantSize("zoo", v) === "medium").map((v) => v.id));
  for (const cls of ["centre", "city"]) if (byCls[cls]) check(byCls[cls].every((id) => huge.has(id)), `a ${cls} tile's zoo is a big one (${[...new Set(byCls[cls])].join(", ")})`);
  for (const cls of ["rural", "highway", "town", "coast"]) if (byCls[cls]) check(byCls[cls].every((id) => medium.has(id)), `a ${cls} tile's zoo is a medium one (${[...new Set(byCls[cls])].join(", ")})`);
  for (const cls of ["scenic", "suburb"]) if (byCls[cls]) check(byCls[cls].every((id) => !huge.has(id)), `a ${cls} tile's zoo is never a huge one (${[...new Set(byCls[cls])].join(", ")})`);
  check(placementCtx(state, city, "zoo").size === "huge", "placementCtx gives a city's zoo the huge size class");
  // A new world has zoos, each by the table; an older one none.
  let n = 0, far = 0, byKind = {};
  for (const seed of [11, 12, 13]) {
    const w = createWorld({ seed, factionCount: 4 });
    for (const t of w.tiles) for (const p of t.pois || []) if (p.kind === "zoo") {
      n++;
      const V = zooVariant(w, t.id, { id: "poi" });
      byKind[V.id] = (byKind[V.id] || 0) + 1;
      if (huge.has(V.id) && cityDistance(w, t.id) > PLACE.BIG_R) far++;
    }
  }
  console.log(`\nZoos in three new worlds: ${n} (${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  check(n > 0, "a new world has zoos");
  check(far === 0, `${far} huge zoos farther than ${PLACE.BIG_R} tiles from a city's heart`);
  const old = createWorld({ seed: 11, factionCount: 4 });
  old.placeLegacy = true; // a save from before the placement table (save.js placeLegacy): its POIs regenerated as they were
  for (const t of old.tiles) delete t.pois;
  ensurePois(old);
  const oldN = old.tiles.reduce((a, t) => a + (t.pois || []).filter((p) => p.kind === "zoo").length, 0);
  check(oldN === 0, `an older world (no placement table) has no zoos (${oldN})`);
}

// ---------- loot ----------
{
  check(!!BOX_LOOT.freezer.cold && !!BOX_LOOT.meatcase.cold, "the food prep's freezers and butcher's cases spoil (their cold rule: good only in winter)");
  check(BOX_LOOT.dartcab && BOX_LOOT.dartcab.gear.some(([k]) => k === "tranqdarts"), "the vet's dart cabinet holds the tranquilliser darts");
  check(boxLoot("zoofood", "freezer").loot.food[0] < 0.5, "a zoo freezer's food is mostly gone bad out of winter");
  check(Object.keys(ZOO_STYLES).length >= 20, "the zoo's room styles");
}

// ---------- the scenes ----------
{
  const got = {};
  for (let s = 0; s < 18; s++) { const m = build(`ztscene:${s}`, ZOO_VARIANTS[s % ZOO_VARIANTS.length].id); for (const sc of (m.scenes && m.scenes.list) || []) got[sc.kind] = (got[sc.kind] || 0) + 1; }
  console.log(`\nScenes over 18 zoos: ${Object.entries(got).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  for (const k of ["emptycages", "keepersstand", "escaped"]) check(got[k] > 0, `the zoo's scene "${k}" turns up`);
}

// ---------- the animals in a raid ----------
{
  registerCombatHandler("zootest", () => {});
  const st = createWorld({ seed: 77, factionCount: 4 });
  st.started = true; st.cards.length = 0; st.crashNext = 1e9;
  const h = hub(st), crew = atBase(st, h.id).slice(0, 4);
  const t = st.tiles.find((x) => x.terrain === "plains" && !x.loc && x.id !== h.tile);
  let beasts = 0, inside = 0, dead = 0, raids = 0;
  const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 60, meds: 2 } }).party;
  p.path = [t.id]; p.idx = 0; p.dest = t.id; p.phase = "engaged";
  for (const plan of ["safari", "petting", "cityzoo"]) {
    const setup = { mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "zootest", enemy: { kind: "zombies", count: 20, power: 3, groups: [{ kind: "zombies", count: 20, power: 3 }] }, raid: { heat0: 5, place: { id: `zoo:raid:${plan}`, key: "zoo", name: "Zoo", plan } }, context: {} };
    const b = createBattle(st, setup);
    raids++;
    const enc = (b.raid.plan.grounds || []).filter((g) => g.kind === "enclosure" && g.beast);
    const zs = b.units.filter((u) => u.side === "enemy" && u.kind === "zombie");
    dead = Math.max(dead, zs.length);
    for (const u of zs) if (u.ztype && /^dead(stag|hog|hound|cow|cat)$/.test(u.ztype)) { beasts++; if (enc.some((g) => u.x > g.x0 && u.x < g.x0 + g.w - 1 && u.y > g.y0 && u.y < g.y0 + g.h - 1)) inside++; }
    st.combat = null;
  }
  console.log(`\nThe animals: ${beasts} dead beasts over ${raids} raids, ${inside} inside their enclosures; the most dead on one map ${dead}`);
  check(beasts > 0, "a raid on a zoo has dead beasts (the animals the worm killed)");
  check(beasts > 0 && inside === beasts, `the dead beasts start inside their enclosures (${inside} of ${beasts})`);
  check(dead <= ZOO.DEAD_MAX, `never more than ${ZOO.DEAD_MAX} of the dead on a zoo (${dead})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
