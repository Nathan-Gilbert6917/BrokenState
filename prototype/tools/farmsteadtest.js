// Farms renovated (issue #62, the user's request 2026-10-26: "renovations to Farms Farm houses ranches farm stands
// sheds"): sim/farmstead.js's farm and ranch sites as one map each, sim/farmplans.js's sheds, farm stands and farm
// buildings. Checks:
//   - the site layouts: 12+ farms and 12+ ranches, each built pinned (its buildings, its plots, its yard's pieces, cars
//     to search), the ground and every building's front door reached from the way in, within the map cap (300), the same
//     map twice; the pick weighs the terrain (a grain farm on the plains, a vineyard or an orchard on the hills);
//   - a new save's farm and ranch open the whole place; an older save (farmLegacy) keeps its pick of buildings, and its
//     shed and farm stand POIs their old buildings, while a new save's open their own types named by their layout;
//   - the loot: the farm's finds turn up (seed packets, feed sacks, rope, the wormer, fuel, jars, the farmhouse's guns);
//   - the new types' plans: 12+ each, every one built with containers to search.
// Usage: node tools/farmsteadtest.js [seeds a layout, default 3; BS_QUICK=1: 2]
import { createWorld } from "../src/sim/world.js";
import { buildingMap, siteBuildings, BUILDINGS } from "../src/sim/buildingmaps.js";
import { FARM_LAYOUTS, RANCH_LAYOUTS, farmLayout } from "../src/sim/farmstead.js";
import { FARM_PLANS } from "../src/sim/farmplans.js";
import { LAYOUTS } from "../src/sim/buildvariants.js";
import { poiPlace } from "../src/sim/poiraid.js";
import { poisOf, poiName, generatePois } from "../src/sim/pois.js";
import { boxLoot, CELL } from "../src/sim/combat.js";

const SEEDS = Number(process.argv[2]) || (process.env.BS_QUICK ? 2 : 3);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };

const state = createWorld({ seed: 4242, factionCount: 4 });
state.roomsLegacy = false;
const farm = state.tiles.find((t) => t.loc && t.loc.type === "farm");
check(!!farm, "a farm site on the map");

// ---------- the site layouts ----------
console.log("\nThe site layouts (pinned, the first seed):");
const reached = (m) => {
  const W = m.w, H = m.h, cells = m.floors ? m.floors[0].cells : m.cells, seen = new Uint8Array(W * H);
  const walk = (c) => !!c && ((CELL[c.k] && CELL[c.k].walk) || c.k === "door" || c.k === "boarded"); // a locked door, a boarded one (a scene's barricade): ways through
  const z = m.zones[0], st = [];
  for (let y = z.y0; y < z.y0 + z.h; y++) for (let x = z.x0; x < z.x0 + z.w; x++) if (walk(cells[y * W + x])) { seen[y * W + x] = 1; st.push(y * W + x); }
  while (st.length) { const i = st.pop(), x = i % W; for (const j of [i + 1, i - 1, i + W, i - W]) { if (j < 0 || j >= W * H || (Math.abs((j % W) - x) > 1) || seen[j] || !walk(cells[j])) continue; seen[j] = 1; st.push(j); } }
  // The ground outside the buildings (inside, a scene's barricade may shut a room on purpose: interiortest.js holds
  // the plans) and each building's front door.
  const inB = new Uint8Array(W * H);
  for (const h of m.plan.houses) for (let y = h.y0; y < h.y0 + h.h; y++) for (let x = h.x0; x < h.x0 + h.w; x++) inB[y * W + x] = 1;
  let cut = 0;
  for (let i = 0; i < W * H; i++) if (!inB[i] && walk(cells[i]) && !seen[i] && cells[i].k !== "vehicle") cut++;
  for (const h of m.plan.houses) if (h.front && !seen[h.front.y * W + h.front.x]) cut++;
  return cut;
};
for (const [key, list] of [["farm", FARM_LAYOUTS], ["ranch", RANCH_LAYOUTS]]) {
  check(list.length >= 12, `${key}: ${list.length} site layouts (want 12+)`);
  check(new Set(list.map((L) => L.id)).size === list.length, `${key}: layout ids unique`);
  for (const L of list) {
    for (let s = 0; s < SEEDS; s++) {
      const opt = { id: `${key}${s}`, key, name: key, layout: L.id };
      let m;
      try { m = buildingMap(state, farm.id, opt, { kind: "pickup" }); } catch (e) { check(false, `${key} ${L.id}: ${e.message}`); continue; }
      const P = m.plan;
      check(P.layout === L.id && P.vname === L.name, `${key} ${L.id}: the plan is its layout (${P.layout})`);
      check(P.houses.length === L.b.length, `${key} ${L.id}: ${P.houses.length} buildings (want ${L.b.length})`);
      check(m.w <= 300 && m.h <= 300, `${key} ${L.id}: ${m.w} × ${m.h} within 300 × 300`);
      check(P.grounds.length >= 1, `${key} ${L.id}: its back land`);
      check(m.containers.length >= 20, `${key} ${L.id}: ${m.containers.length} containers (want 20+)`);
      check(m.containers.some((c) => c.kind === "car"), `${key} ${L.id}: the farm's vehicles to search`);
      const cut = reached(m);
      check(cut === 0, `${key} ${L.id} seed ${s}: ${cut} cells of ground or front doors cut off from the way in`);
      check(m.deadScale >= 1, `${key} ${L.id}: its dead (deadScale ${m.deadScale})`);
      if (s === 0) {
        const again = buildingMap(state, farm.id, opt, { kind: "pickup" });
        check(JSON.stringify(again.cells.map((c) => c.k)) === JSON.stringify(m.cells.map((c) => c.k)) && again.containers.length === m.containers.length, `${key} ${L.id}: the same map twice`);
        console.log(`  ${key.padEnd(5)} ${L.name.padEnd(24)} ${m.w} × ${m.h}  ${P.houses.map((h) => h.name).join(", ")}; ${P.grounds.map((g) => g.name.toLowerCase()).join(", ")}; ${m.containers.length} containers`);
      }
    }
  }
}
// The pick by terrain: a grain farm on the plains, an orchard or a vineyard on the hills.
{
  const count = (terrain, key) => { const c = {}; const t = { ...farm, terrain }; const st = { ...state, tiles: state.tiles.map((x) => (x.id === farm.id ? t : x)) }; for (let i = 0; i < 300; i++) { const L = farmLayout(st, farm.id, { id: `p${i}`, key }); c[L.id] = (c[L.id] || 0) + 1; } return c; };
  const plains = count("plains", "farm"), hills = count("hills", "farm");
  check((plains.grain || 0) > (hills.grain || 0) && (hills.vineyard || 0) + (hills.orchard || 0) > (plains.vineyard || 0) + (plains.orchard || 0), `farms by terrain: grain ${plains.grain || 0} plains / ${hills.grain || 0} hills; vineyards and orchards ${(plains.vineyard || 0) + (plains.orchard || 0)} / ${(hills.vineyard || 0) + (hills.orchard || 0)}`);
  check(Object.keys(plains).length >= 10 && Object.keys(count("hills", "ranch")).length >= 10, "the dice reach most layouts on any terrain");
}

// ---------- new saves and older ones ----------
{
  const sb = siteBuildings(farm, state);
  check(sb && sb.single && sb.options[0].key === "farm", "a new save's farm opens the whole place");
  const ranch = state.tiles.find((t) => t.loc && t.loc.type === "ranch");
  if (ranch) check(siteBuildings(ranch, state).options[0].key === "ranch", "a new save's ranch opens the whole place");
  const old = { ...state, farmLegacy: true };
  const osb = siteBuildings(farm, old);
  check(osb && !osb.single && osb.options.map((o) => o.key).join() === "farmhouse,barn", "an older save's farm keeps its pick of buildings");
  // POIs: a new save's shed and farm stand are their own types; an older save's (regenerated on load) keep theirs.
  let sheds = 0, stands = 0, named = 0;
  for (const t of state.tiles) {
    const ps = poisOf(t);
    ps.forEach((p, i) => {
      if (!p || (p.kind !== "shed" && p.kind !== "farmstand") || p.site) return;
      const pl = poiPlace(t, i);
      if (p.kind === "shed") sheds++; else stands++;
      if (pl && pl.key === p.kind && pl.name === poiName(t, i)) named++;
    });
  }
  check(sheds > 0 && stands > 0 && named === sheds + stands, `a new save's ${sheds} sheds and ${stands} farm stands open their own types, named by their layouts (${named})`);
  const oldTile = state.tiles.find((t) => poisOf(t).some((p) => p && p.kind === "shed" && !p.site));
  if (oldTile) {
    const ps = generatePois(old, oldTile), i = ps.findIndex((p) => p && p.kind === "shed");
    const t2 = { ...oldTile, pois: ps };
    check(i >= 0 && !ps[i].lay && poiPlace(t2, i).key === "machineshed", "an older save's shed POI keeps its machine shed's building");
  }
}

// ---------- the loot ----------
{
  const found = {};
  for (const L of [...FARM_LAYOUTS, ...RANCH_LAYOUTS]) {
    const key = RANCH_LAYOUTS.includes(L) ? "ranch" : "farm";
    const m = buildingMap(state, farm.id, { id: `loot${key}`, key, name: key, layout: L.id }, null);
    for (const c of m.containers) {
      const a = m.rooms.find((r) => r.id === c.area);
      if (!a || !a.type) continue;
      const t = boxLoot(a.type, c.kind);
      for (const [k] of t.gear) found[k] = (found[k] || 0) + 1;
      for (const k of Object.keys(t.loot)) found[`sup:${k}`] = (found[`sup:${k}`] || 0) + 1;
    }
  }
  for (const k of ["seeds", "feedsack", "rope", "dewormer", "barbedwire", "huntrifle", "shotgun", "sup:fuel", "sup:jars", "sup:preserved", "sup:food"]) check(found[k] > 0, `the farms' containers can hold ${k} (${found[k] || 0} containers)`);
}

// ---------- the new types' plans ----------
for (const key of ["shed", "farmstand", "farmbldg"]) {
  check(LAYOUTS[key].length >= 12 && Object.keys(FARM_PLANS[key]).length === LAYOUTS[key].length, `${key}: ${LAYOUTS[key].length} layouts, each with its plan`);
  const tileId = state.tiles.find((t) => t.terrain === "plains" && !t.loc).id;
  for (const l of LAYOUTS[key]) {
    const m = buildingMap(state, tileId, { id: `nt${l.id}`, key, name: BUILDINGS[key].name, layout: l.id }, null);
    check(m.plan.vid === l.id && m.containers.length >= 1, `${key} ${l.id}: built as itself (${m.plan.vid}), ${m.containers.length} containers`);
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
