// @ts-check
// Farms and ranches as whole sites (issue #62 of the round-2 epic #39, the user's request 2026-10-26: "renovations to
// Farms Farm houses ranches farm stands sheds"). A farm site (data.js LOCATIONS farm) and a ranch (LOCATIONS ranch) open
// one raid map with the whole place on it (farmsteadMap), laid out through compound.js (the multi-building map shared
// with the malls, #30, the campus, #28, and the prisons, #31), instead of a pick of one building. New saves only: an
// older save (worldcfg.js legacyFarms, no state.farmV) keeps its pick of buildings (buildingmaps.js SITES farm, ranch).
//
// THE SITE LAYOUTS (FARM_LAYOUTS, RANCH_LAYOUTS: the shared picker's "farm:layouts" and "ranch:layouts", variantpick.js):
// fourteen farms and thirteen ranches, each a list of buildings, each building a type and its plan (the farmhouse's,
// the barn's and the machine shed's dozen layouts, #32's; the shed's, the farm stand's and the farm building's,
// farmplans.js), what stands in the farmyard (silos, grain bins, a fuel tank, calf hutches, hay, beehives, stock tanks)
// and what lies out back (crop fields, pastures, corrals with a squeeze chute, an orchard, a vineyard, a manure lagoon,
// a riding arena, an airstrip, a pumpkin patch, Christmas trees, a sugarbush). The pick: the site's dice (hash dice of the
// world seed and the tile) weighed by the farm's terrain (w.plains, w.hills: a grain farm on the plains, an orchard or a
// vineyard on the hills; w.any elsewhere), with #42's placement context (placement.js placementCtx); option.layout pins one (tile.loc.farm too: a render's).
//
// THE MAP (south to north): the county road along the south edge (its two ends the ways in and out, the team's
// vehicle at the west end), the front row (the farmhouse, the farm stand by the road, the small sheds) facing it, the
// farmyard (gravel, the lane up from the road, the yard's pieces and the farm's vehicles), the back row (the barns, the
// sheds, the working buildings) facing the yard, and the back land to the north edge (the fields and the rest, each
// fenced with a gate). Every building is its own plan from its own dice (the option id and its number), copied in with
// its rooms, doors, locks and containers (c.house: poicont.js keeps each building's apart) and its signs of survival
// (interiorscenes.js, rolled on each before it is copied in). The map is FARM.W / FARM.H by the layout, at most MAP_CAP
// (battlesize.js: 300, the default).
// The dead: the site's roster × FARM.DEAD by the map's area (map.deadScale). Loot: each room's own (farmplans.js's
// farm rooms, the farmhouse's guns), the farm vehicles' (a wreck area of cars).
import { Rng } from "./rng.js";
import { hash01 } from "./skills.js";
import { registerVariants, pickVariant, variantFor } from "./variantpick.js"; // the shared picker (issue #41)
import { BUILDINGS, assemble, realScale } from "./buildingmaps.js"; // call-time only (buildingmaps.js builds the farms through here)
import { compoundGrid, placeBuilding, guard, compoundResult, compoundVehicle } from "./compound.js";
import { rollScenes, sceneRng } from "./interiorscenes.js";
import { placementCtx } from "./placement.js";
import { mapCap } from "./battlesize.js";

export const FARM = {
  EDGE: 4,          // the land between the map's west, east and north edges and anything laid out
  ROAD: 4,          // the county road along the south edge
  SOUTH: 3,         // the verge south of the road
  FRONT: 6,         // the front yard between the front row and the road
  YARD: [12, 16],   // the farmyard's depth between the front row's backs and the back row's fronts
  ROWGAP: 8,        // between two back rows
  GAP: [5, 10],     // between two buildings of a row
  LANE: 3,          // the lane from the road up through the yard
  BACK: [26, 48],   // the back land's depth
  DEAD: 1.4,        // the site's roster × this × (the map's area / 150²), at least 1 (map.deadScale)
  CARS: [1, 3],     // the farm's vehicles parked in the yard (each a container: AREAS.wreck)
};
export const FARM_SITE_KEYS = ["farm", "ranch"]; // the site keys (buildingmaps.js BUILDINGS: farmstead: true)

// ---------- the site layouts ----------
// b: the buildings: [key, plan id or ids (the building's dice pick one), count?]; yard: [piece, [min, max]]; back:
// the back land's plots in order, west to east ([kind, share of the width]).
/** @typedef {{ id: string, name: string, w: Record<string, number>, map: number[], b: any[], yard: any[], back: any[] }} FarmLayout */
/** @param {string} id @param {string} name @param {Record<string, number>} w @param {number[]} map [W min, W max] @param {any[]} b @param {any[]} yard @param {any[]} back @returns {FarmLayout} */
const L = (id, name, w, map, b, yard, back) => ({ id, name, w: { any: 0.5, ...w }, map, b, yard, back });
export const FARM_LAYOUTS = [
  L("dairy", "Dairy farm", { plains: 2, hills: 1.2 }, [123, 156],
    [["farmhouse", ["foursquare", "bigfarm"]], ["barn", "dairy"], ["farmbldg", "milkhouse"], ["machineshed", ["shed", "tractor"]], ["barn", "hay"], ["shed", "coop"]],
    [["silo", [2, 3]], ["calfhutch", [6, 10]], ["hay", [4, 8]]], [["pasture", 0.4], ["lagoon", 0.2], ["field", 0.4]]),
  L("grain", "Grain farm", { plains: 3, hills: 0.4 }, [131, 164],
    [["farmhouse", ["farmhouse", "modern"]], ["machineshed", "grain"], ["machineshed", "pole"], ["machineshed", "fuel"], ["shed", "gen"]],
    [["grainbin", [4, 6]], ["fueltank", [1, 2]], ["drum", [2, 4]]], [["field", 0.35], ["field", 0.35], ["field", 0.3]]),
  L("hog", "Hog farm", { plains: 1.5, hills: 0.6 }, [123, 148],
    [["farmhouse", "ranchfarm"], ["barn", "hog"], ["barn", "hog"], ["farmbldg", "feedmill"], ["shed", "tool"]],
    [["grainbin", [2, 3]], ["fueltank", [1, 1]]], [["corral", 0.3], ["lagoon", 0.25], ["field", 0.45]]),
  L("poultry", "Poultry farm", { plains: 1.2, hills: 0.8 }, [131, 164],
    [["farmhouse", ["tenant", "modern"]], ["barn", "poultry"], ["barn", "poultry"], ["barn", "poultry"], ["shed", "gen"], ["machineshed", "shed"]],
    [["grainbin", [2, 4]], ["drum", [2, 3]]], [["field", 0.6], ["pasture", 0.4]]),
  L("orchard", "Orchard", { plains: 0.6, hills: 1.6 }, [123, 156],
    [["farmhouse", "oldfarm"], ["farmstand", "cider"], ["farmbldg", "packshed"], ["farmbldg", "coldstore"], ["shed", "tool"]],
    [["crate", [3, 6]], ["beehive", [2, 4]]], [["orchard", 0.7], ["pasture", 0.3]]),
  L("vegetable", "Vegetable farm", { plains: 1.5, hills: 0.6 }, [123, 156],
    [["farmhouse", "farmhouse"], ["farmstand", "producebarn"], ["farmbldg", "greenhouse"], ["farmbldg", "greenhouse"], ["shed", "potting"], ["machineshed", "tractor"]],
    [["crate", [4, 8]], ["barrel", [2, 4]]], [["field", 0.35], ["field", 0.35], ["field", 0.3]]),
  L("horse", "Horse farm", { plains: 1, hills: 1 }, [139, 172],
    [["farmhouse", ["bigfarm", "foursquare"]], ["barn", "horse"], ["farmbldg", "stable"], ["farmbldg", "arena"], ["shed", "wood"]],
    [["hay", [4, 8]], ["stocktank", [1, 2]]], [["arena", 0.3], ["pasture", 0.35], ["pasture", 0.35]]),
  L("homestead", "Homestead", { plains: 0.6, hills: 1.4 }, [107, 131],
    [["farmhouse", ["homestead", "dogtrot"]], ["shed", "coop"], ["shed", "smoke"], ["shed", "rootcellar"], ["shed", "outhouse"], ["shed", "wood"], ["shed", "spring"]],
    [["hay", [2, 4]], ["barrel", [2, 3]]], [["field", 0.35], ["pasture", 0.35], ["orchard", 0.3]]),
  L("amish", "Amish farm", { plains: 1, hills: 1 }, [123, 148],
    [["farmhouse", ["ihouse", "stonehouse"]], ["barn", "bank"], ["barn", "crib"], ["shed", "outhouse"], ["shed", "ice"], ["shed", "smoke"], ["farmstand", "egg"]],
    [["hay", [4, 8]], ["barrel", [2, 4]]], [["field", 0.35], ["field", 0.3], ["pasture", 0.35]]),
  L("vineyard", "Vineyard and winery", { plains: 0.5, hills: 1.6 }, [123, 156],
    [["farmhouse", ["modern", "stonehouse"]], ["farmbldg", "winery"], ["machineshed", "shop"], ["shed", "tool"]],
    [["drum", [2, 4]], ["crate", [3, 5]]], [["vineyard", 0.75], ["orchard", 0.25]]),
  L("hobby", "Hobby farm", { plains: 1, hills: 1 }, [107, 131],
    [["farmhouse", ["modern", "summer"]], ["barn", "sheep"], ["shed", "coop"], ["shed", "potting"], ["farmstand", "honey"]],
    [["beehive", [3, 6]], ["hay", [2, 3]]], [["pasture", 0.5], ["field", 0.5]]),
  L("tobacco", "Tobacco farm", { plains: 1, hills: 1 }, [131, 164],
    [["farmhouse", ["ihouse", "tenant"]], ["barn", "tobacco"], ["barn", "tobacco"], ["barn", "tobacco"], ["machineshed", "tractor"], ["shed", "well"]],
    [["drum", [1, 3]], ["hay", [2, 4]]], [["field", 0.5], ["field", 0.5]]),
  L("pumpkin", "Pumpkin and tree farm", { plains: 0.8, hills: 0.8 }, [123, 148],
    [["farmhouse", "summer"], ["farmstand", "pumpkin"], ["farmstand", "xmas"], ["shed", "tool"]],
    [["hay", [6, 10]], ["crate", [2, 4]]], [["pumpkins", 0.5], ["trees", 0.5]]),
  L("sugarbush", "Sugarbush farm", { plains: 0.2, hills: 1.2 }, [115, 139],
    [["farmhouse", "oldfarm"], ["farmbldg", "sugarhouse"], ["farmstand", "maple"], ["shed", "wood"], ["shed", "spring"]],
    [["barrel", [3, 6]], ["drum", [1, 2]]], [["sugarbush", 0.7], ["pasture", 0.3]]),
];
export const RANCH_LAYOUTS = [
  L("cattle", "Cattle ranch", { plains: 2, hills: 1 }, [148, 189],
    [["farmhouse", "ranchfarm"], ["farmbldg", "bunkhouse"], ["barn", "horse"], ["barn", "hay"], ["machineshed", "shed"]],
    [["stocktank", [2, 3]], ["hay", [4, 8]], ["fueltank", [1, 1]]], [["corral", 0.3], ["pasture", 0.7]]),
  L("guest", "Guest ranch", { plains: 1, hills: 1.4 }, [148, 180],
    [["farmhouse", "bigfarm"], ["farmbldg", "cookhouse"], ["farmbldg", "bunkhouse"], ["farmbldg", "bunkhouse"], ["barn", "horse"], ["shed", "outhouse"]],
    [["hay", [3, 6]], ["stocktank", [1, 2]]], [["arena", 0.3], ["corral", 0.25], ["pasture", 0.45]]),
  L("sheep", "Sheep station", { plains: 0.8, hills: 2 }, [139, 172],
    [["farmhouse", ["ranchfarm", "homestead"]], ["barn", "sheep"], ["barn", "sheep"], ["farmbldg", "bunkhouse"], ["shed", "tool"]],
    [["hay", [4, 8]], ["stocktank", [1, 3]]], [["corral", 0.3], ["pasture", 0.35], ["pasture", 0.35]]),
  L("bison", "Bison ranch", { plains: 1.5, hills: 0.8 }, [156, 197],
    [["farmhouse", "ranchfarm"], ["barn", "cattle"], ["farmbldg", "processing"], ["machineshed", "truck"]],
    [["stocktank", [2, 3]], ["hay", [6, 10]]], [["corral", 0.25], ["pasture", 0.75]]),
  L("desert", "Desert ranch", { plains: 1, hills: 0.6 }, [139, 172],
    [["farmhouse", ["homestead", "ranchfarm"]], ["shed", "well"], ["shed", "pump"], ["shed", "gen"], ["barn", "pole"], ["farmbldg", "bunkhouse"]],
    [["stocktank", [3, 5]], ["fueltank", [1, 2]], ["drum", [2, 4]]], [["corral", 0.35], ["range", 0.65]]),
  L("airstrip", "Ranch with an airstrip", { plains: 1.2, hills: 0.3 }, [164, 213],
    [["farmhouse", "modern"], ["machineshed", "quonset"], ["machineshed", "fuel"], ["barn", "horse"], ["farmbldg", "bunkhouse"]],
    [["fueltank", [1, 2]], ["drum", [3, 5]], ["stocktank", [1, 2]]], [["airstrip", 1]]),
  L("horse", "Horse ranch", { plains: 1, hills: 1 }, [148, 180],
    [["farmhouse", "bigfarm"], ["farmbldg", "stable"], ["farmbldg", "arena"], ["barn", "hay"], ["shed", "tool"]],
    [["hay", [4, 8]], ["stocktank", [1, 2]]], [["arena", 0.3], ["pasture", 0.35], ["pasture", 0.35]]),
  L("feedlot", "Feedlot", { plains: 1.5, hills: 0.3 }, [156, 197],
    [["farmhouse", ["ranchfarm", "modern"]], ["farmbldg", "feedmill"], ["farmbldg", "scalehouse"], ["barn", "cattle"], ["machineshed", "truck"]],
    [["silo", [2, 3]], ["grainbin", [2, 4]], ["fueltank", [1, 1]]], [["corral", 0.25], ["corral", 0.25], ["corral", 0.25], ["lagoon", 0.25]]),
  L("cowcamp", "Cow camp", { plains: 0.6, hills: 1.5 }, [131, 164],
    [["farmhouse", "homestead"], ["farmbldg", "cookhouse"], ["farmbldg", "bunkhouse"], ["barn", "hay"], ["shed", "outhouse"]],
    [["hay", [3, 6]], ["stocktank", [1, 2]], ["barrel", [2, 3]]], [["corral", 0.35], ["range", 0.65]]),
  L("rodeo", "Rodeo ranch", { plains: 1, hills: 0.8 }, [148, 180],
    [["farmhouse", "ranchfarm"], ["barn", "horse"], ["farmbldg", "arena"], ["farmbldg", "bunkhouse"], ["shed", "tool"]],
    [["hay", [4, 8]], ["stocktank", [1, 2]]], [["arena", 0.4], ["corral", 0.3], ["corral", 0.3]]),
  L("goat", "Goat ranch", { plains: 0.8, hills: 1.5 }, [123, 156],
    [["farmhouse", "tenant"], ["barn", "sheep"], ["farmstand", "creamery"], ["farmbldg", "milkhouse"], ["shed", "coop"]],
    [["hay", [3, 6]], ["stocktank", [1, 2]]], [["corral", 0.3], ["pasture", 0.7]]),
  L("family", "Family ranch", { plains: 1.2, hills: 1 }, [148, 180],
    [["farmhouse", ["ranchfarm", "foursquare"]], ["barn", "cattle"], ["barn", "horse"], ["machineshed", "shop"], ["shed", "coop"], ["shed", "rootcellar"]],
    [["hay", [4, 8]], ["stocktank", [1, 2]], ["fueltank", [1, 1]]], [["corral", 0.25], ["pasture", 0.45], ["field", 0.3]]),
  L("hunting", "Hunting ranch", { plains: 0.5, hills: 1.6 }, [139, 172],
    [["farmhouse", "modern"], ["farmbldg", "bunkhouse"], ["farmbldg", "processing"], ["machineshed", "shop"], ["shed", "gen"]],
    [["drum", [2, 3]], ["hay", [2, 4]]], [["range", 0.6], ["pasture", 0.4]]),
];
registerVariants("farm:layouts", FARM_LAYOUTS);
registerVariants("ranch:layouts", RANCH_LAYOUTS);
const layoutsOf = (key) => (key === "ranch" ? RANCH_LAYOUTS : FARM_LAYOUTS);

const dice = (state, ...keys) => hash01(state.seed, "farmstead", ...keys);
const seedOf = (state, ...keys) => Math.floor(dice(state, ...keys) * 4294967296) || 1;

/**
 * The site layout of a farm or a ranch (option.key): option.layout pins one; else the site's dice by its terrain and
 * the placement table's context (placement.js placementCtx).
 * @param {any} state @param {number} tileId @param {{ id: string, key: string, layout?: string | null }} option @returns {FarmLayout}
 */
export function farmLayout(state, tileId, option) {
  const key = option.key === "ranch" ? "ranch" : "farm", tile = state.tiles[tileId];
  const ctx = { ...(tile ? placementCtx(state, tile, key) : {}), site: tile ? tile.terrain : null, plan: option.layout || (tile && tile.loc && tile.loc.farm) || null, r: dice(state, "layout", tileId, option.id) };
  return /** @type {FarmLayout} */ (pickVariant(`${key}:layouts`, null, ctx) || layoutsOf(key)[0]);
}
/** A layout by id (null for none). @param {string} key @param {string | null | undefined} id */
export const farmLayoutById = (key, id) => /** @type {FarmLayout | null} */ (variantFor(`${key === "ranch" ? "ranch" : "farm"}:layouts`, id));

// The buildings of a site's layout, each its spec from its own dice: [{ k, key, id, hr, spec }].
function farmBuildingsOf(state, tileId, option, LY) {
  const out = [];
  LY.b.forEach(([key, plans], k) => {
    const id = `${option.id}#${k + 1}`;
    const hr = new Rng(seedOf(state, "bldg", tileId, id));
    const list = Array.isArray(plans) ? plans : [plans];
    const plan = list[Math.floor(dice(state, "plan", tileId, id) * list.length)];
    let spec = BUILDINGS[key].make(hr, { layout: plan, lset: "rural", setting: "rural", site: option.key, shapes: false });
    spec = realScale(hr, spec, key, { setting: "rural" });
    spec.margins = { front: 1, back: 1, left: 1, right: 1 };
    spec.ground = "none";
    out.push({ k, key, id, hr, spec, plan, front: key === "farmhouse" || key === "farmstand" || (key === "shed" && LY.b.length > 5 && k % 2 === 1) });
  });
  return out;
}
/** How many buildings a farm or a ranch has (poicont.js poiHouses: the search goes through them a building at a time). @param {any} state @param {any} tile @param {any} option */
export function farmBuildingCount(state, tile, option) { return farmLayout(state, tile.id, option).b.length; }

/**
 * The map of a farm or a ranch (buildingmaps.js buildingMap for BUILDINGS farm and ranch): the same every visit.
 * @param {any} state @param {number} tileId @param {{ id: string, key: string, name: string, layout?: string | null }} option @param {any} withVehicle
 */
export function farmsteadMap(state, tileId, option, withVehicle) {
  const F = FARM, LY = farmLayout(state, tileId, option);
  const rng = new Rng(seedOf(state, "map", tileId, option.id));
  const built = farmBuildingsOf(state, tileId, option, LY);
  for (const B of built) {
    B.m = assemble(B.hr, B.spec, { key: B.key, id: B.id, name: BUILDINGS[B.key].name, legacy: false });
    B.w = B.m.building.w; B.h = B.m.building.h;
    B.name = B.spec.vname || BUILDINGS[B.key].name;
    rollScenes(B.m, sceneRng(state, tileId, { id: B.id }), B.key);
  }
  // A second of a name numbered ("Poultry house 2").
  const seen = {};
  for (const B of built) { seen[B.name] = (seen[B.name] || 0) + 1; if (seen[B.name] > 1) B.name = `${B.name} ${seen[B.name]}`; }
  for (const B of built) if (seen[B.name] > 1 && !/ \d+$/.test(B.name)) B.name = `${B.name} 1`;
  // ---------- the rows: the front row by the road, the back rows behind the yard ----------
  const cap = mapCap(option.key) || 300;
  let W = Math.min(cap, rng.int(LY.map[0], LY.map[1]));
  const avail = () => W - 2 * F.EDGE - F.LANE - 4;
  const rowsOf = (list) => {
    const rows = [[]];
    let x = 0;
    for (const B of list) {
      const gap = rng.int(F.GAP[0], F.GAP[1]);
      if (rows[rows.length - 1].length && x + gap + B.w > avail()) { rows.push([]); x = 0; }
      const row = rows[rows.length - 1];
      B.gap = row.length ? gap : 0;
      x += B.gap + B.w;
      row.push(B);
    }
    return rows.filter((r) => r.length);
  };
  W = Math.max(W, Math.min(cap, Math.max(...built.map((B) => B.w)) + 2 * F.EDGE + F.LANE + 6));
  const front = rowsOf(built.filter((B) => B.front)).slice(0, 1), frontSet = new Set(front.flat());
  const back = rowsOf(built.filter((B) => !frontSet.has(B)));
  const depth = (row) => Math.max(...row.map((B) => B.h));
  const yardD = rng.int(F.YARD[0], F.YARD[1]), backD = rng.int(F.BACK[0], F.BACK[1]);
  const need = F.EDGE + backD + 2 + back.reduce((a, r) => a + depth(r) + F.ROWGAP, 0) + yardD + (front.length ? depth(front[0]) : 0) + F.FRONT + F.ROAD + F.SOUTH;
  const H = Math.min(cap, Math.max(need, Math.round(W * 0.8)));
  const backH = Math.max(12, backD + (H - need));
  // y positions, north to south.
  let y = F.EDGE + backH + 2;
  const laneX = F.EDGE + Math.floor(avail() / 2) + rng.int(-8, 8);
  const placeRow = (row, y0) => {
    const D = depth(row), used = row.reduce((a, B) => a + B.gap + B.w, 0);
    let x = F.EDGE + 2 + Math.floor((avail() - used) / 2);
    for (const B of row) {
      x += B.gap;
      if (x <= laneX + F.LANE && x + B.w >= laneX - 1) x = laneX + F.LANE + 2; // never across the lane
      B.x0 = Math.min(x, W - F.EDGE - B.w); B.y0 = y0 + D - B.h; x = B.x0 + B.w;
    }
    return D;
  };
  const backRows = back.map((row) => { const y0 = y; y += placeRow(row, y0) + F.ROWGAP; return { row, y0 }; });
  y = Math.max(y - F.ROWGAP, F.EDGE + backH + 2);
  const yardY0 = y, yardY1 = y + yardD;
  y = yardY1;
  if (front.length) y += placeRow(front[0], y);
  const roadY = Math.max(y + F.FRONT, H - F.ROAD - F.SOUTH);
  const storeys = Math.max(1, ...built.map((B) => B.m.storeys || 1));
  const C = compoundGrid(W, H, storeys, () => (option.key === "ranch" ? "grass" : "field"));
  const cells = C.cells, keep = C.keep;
  const I = (x, yy) => yy * W + x;
  const inside = (x, yy) => x >= 0 && yy >= 0 && x < W && yy < H;
  const paint = (x0, y0, w, h, f, mark = true) => { for (let yy = y0; yy < y0 + h; yy++) for (let x = x0; x < x0 + w; x++) if (inside(x, yy)) { cells[I(x, yy)].f = f; if (mark) keep[I(x, yy)] = 1; } };
  // ---------- the road, the lane, the yard ----------
  paint(0, roadY, W, F.ROAD, "road");
  paint(0, roadY - 1, W, 1, "dirt", false); paint(0, roadY + F.ROAD, W, 1, "dirt", false);
  paint(F.EDGE, yardY0, W - 2 * F.EDGE, yardD, "gravel", false);
  paint(laneX, F.EDGE + 2, F.LANE, roadY - F.EDGE - 2, "gravel");
  // ---------- the buildings copied in ----------
  const sceneList = [], sceneBodies = [], scenePiles = [], scenePieces = [];
  for (const B of built) {
    const m = B.m, Rb = m.building;
    const part = placeBuilding(C, m, { x0: B.x0, y0: B.y0, face: "s", k: B.k, name: B.name, key: B.key, tag: { room: { bldg: B.key } } }); // bldg: its type (indoorlight.js: a barn's rooms have no wiring)
    B.part = part;
    const S = m.scenes;
    if (S) {
      const tx = (x) => B.x0 + (x - Rb.x0), ty = (yy) => B.y0 + (yy - Rb.y0);
      const ids = new Map(m.rooms.filter((a) => !a.outdoor).map((a, j) => [a.id, part.rooms[j]]));
      for (const sc of S.list) sceneList.push({ ...sc, x: tx(sc.x), y: ty(sc.y), room: sc.room == null ? null : ids.get(sc.room) ?? null, house: B.k });
      for (const o of S.bodies) sceneBodies.push({ ...o, x: tx(o.x), y: ty(o.y) });
      for (const q of S.piles) scenePiles.push({ ...q, x: tx(q.x), y: ty(q.y), area: q.area == null ? null : ids.get(q.area) ?? null });
      for (const q of S.pieces) scenePieces.push({ ...q, x: tx(q.x), y: ty(q.y) });
    }
    // A path from each door on its front down to the yard or the road.
    const stop = frontSet.has(B) ? roadY : yardY0;
    const toward = (x, yy) => { for (let q = yy + 1; q < stop && inside(x, q); q++) { if (C.built[I(x, q)]) break; keep[I(x, q)] = 1; if (cells[I(x, q)].f !== "road") cells[I(x, q)].f = frontSet.has(B) ? "dirt" : "gravel"; } };
    for (const [x, yy] of (part.front && part.front.cells) || []) toward(x, yy);
    for (const ex of part.exits) if (ex.side === "s") for (const [x, yy] of ex.cells) toward(x, yy);
    // Doors on its back and sides: a step of ground kept clear outside them.
    for (const ex of part.exits) if (ex.side !== "s") for (const [x, yy] of ex.cells) for (let d = 1; d <= 2; d++) { const [px, py] = ex.side === "n" ? [x, yy - d] : ex.side === "e" ? [x + d, yy] : ex.side === "w" ? [x - d, yy] : [x, yy + d]; if (inside(px, py) && !C.built[I(px, py)]) keep[I(px, py)] = 1; }
  }
  // ---------- the ways out (the road's two ends first: the team comes in at the west end) ----------
  const Z = 3, zy = roadY + 1;
  const zones = [
    { x0: 0, y0: zy, w: Z, h: Z, side: "west", exit: "west", name: "West end of the county road", vehicle: false },
    { x0: W - Z, y0: zy, w: Z, h: Z, side: "east", exit: "east", name: "East end of the county road", vehicle: false },
    { x0: laneX, y0: 0, w: Z, h: Z, side: "north", exit: "north", name: `North edge of the ${option.key === "ranch" ? "range" : "fields"}`, vehicle: false },
    { x0: 0, y0: yardY0 + 2, w: Z, h: Z, side: "west", exit: "west", name: "West edge of the farmyard", vehicle: false },
    { x0: W - Z, y0: yardY0 + 2, w: Z, h: Z, side: "east", exit: "east", name: "East edge of the farmyard", vehicle: false },
  ];
  for (const z of zones) for (let q = z.y0 - 1; q <= z.y0 + z.h; q++) for (let p = z.x0 - 1; p <= z.x0 + z.w; p++) if (inside(p, q)) keep[I(p, q)] = 1;
  paint(0, yardY0 + 2, F.EDGE + 1, Z, "dirt"); paint(W - F.EDGE - 1, yardY0 + 2, F.EDGE + 1, Z, "dirt"); // tracks to the yard's edges
  paint(F.EDGE, yardY0 + 2, W - 2 * F.EDGE, 2, "gravel");
  // ---------- the guard and the pieces ----------
  const G = guard(C, 1, roadY + 2);
  /** A piece of w × h on free ground: all its cells or none. */
  const piece = (x, yy, k, w = 1, h = 1, extra = null) => {
    const done = [];
    for (let q = yy; q < yy + h; q++) for (let p = x; p < x + w; p++) {
      if (G.block(p, q, k, extra)) done.push(I(p, q));
      else { for (const i of done) { cells[i].k = "open"; G.passAt(i); } return false; }
    }
    for (const i of done) keep[i] = 1;
    return true;
  };
  const scatter = (k, n, x0, y0, x1, y1, w = 1, h = 1) => { let got = 0; for (let t = 0; t < n * 20 && got < n; t++) if (piece(rng.int(x0, x1 - w), rng.int(y0, y1 - h), k, w, h)) got++; return got; };
  // The yard's pieces, in the yard strip (and beside the back rows).
  const yard = { x0: F.EDGE + 1, y0: yardY0 + 4, x1: W - F.EDGE - 1, y1: yardY1 - 2 };
  const yardList = [];
  for (const [k, [lo, hi]] of LY.yard) {
    const n = rng.int(lo, hi), sz = k === "fueltank" ? [2, 1] : [1, 1];
    if (k === "silo" || k === "grainbin") { // in a row by the back row's barns, two cells apart
      let got = 0, sx = rng.int(yard.x0 + 2, Math.max(yard.x0 + 3, yard.x1 - n * 3)), sy = yard.y0 + rng.int(0, 2);
      for (let i = 0; i < n * 3 && got < n; i++, sx += 3) if (sx < yard.x1 - 1 && piece(sx, sy, k)) got++;
      yardList.push([k, got]);
    } else if (k === "calfhutch") {
      let got = 0, sx = rng.int(yard.x0 + 2, Math.max(yard.x0 + 3, yard.x1 - n * 2)), sy = yard.y1 - 3;
      for (let i = 0; i < n * 2 && got < n; i++, sx += 2) if (piece(sx, sy, k)) got++;
      yardList.push([k, got]);
    } else yardList.push([k, scatter(k, n, yard.x0, yard.y0, yard.x1, yard.y1, sz[0], sz[1])]);
  }
  // The farm's vehicles: an outdoor area of cars (a pickup, a stock truck, the old sedan) to search.
  const carsArea = { id: C.areas.length, type: "wreck", name: "Farm vehicles", outdoor: true, f: 0, x0: yard.x0, y0: yard.y0, w: yard.x1 - yard.x0, h: yard.y1 - yard.y0, house: null };
  let cars = 0;
  for (let t = 0, n = rng.int(F.CARS[0], F.CARS[1]); t < 40 && cars < n; t++) {
    const rect = G.car(rng.int(yard.x0 + 1, yard.x1 - 5), rng.int(yard.y0, yard.y1 - 3), "x", rng.chance(0.4) ? 4 : 3, rng.chance(0.5) ? "truck" : "car", rng.int(0, 1e6));
    if (!rect) continue;
    C.containers.push({ id: C.cid++, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, f: 0, area: carsArea.id, kind: "car", searched: false, label: `${carsArea.name}: ${rect.w > 3 ? "truck" : "car"}`, house: null });
    cars++;
  }
  if (cars) C.areas.push(carsArea);
  // ---------- the back land: plots side by side across the back, fenced, a gate onto the lane or the yard ----------
  const grounds = [];
  const bx0 = F.EDGE, bx1 = W - F.EDGE, by0 = F.EDGE, by1 = F.EDGE + backH; // the back land's rect (to the back rows)
  let px = bx0;
  const total = LY.back.reduce((a, [, s]) => a + s, 0);
  LY.back.forEach(([kind, share], j) => {
    const pw = j === LY.back.length - 1 ? bx1 - px : Math.floor((bx1 - bx0) * share / total);
    const r = { x0: px + 1, y0: by0 + 1, w: Math.max(6, pw - 3), h: by1 - by0 - 2 };
    px += pw;
    if (r.x0 <= laneX + F.LANE && r.x0 + r.w >= laneX) { // the lane runs through: the plot keeps to one side of it
      const left = laneX - 1 - r.x0, right = r.x0 + r.w - (laneX + F.LANE + 1);
      if (left >= right) r.w = left; else { r.x0 = laneX + F.LANE + 1; r.w = right; }
    }
    if (r.w < 6 || r.h < 6) return;
    grounds.push({ kind, name: PLOT_NAME[kind] || kind, ...r });
    plot(kind, r);
  });
  /** One plot of the back land. @param {string} kind @param {{ x0: number, y0: number, w: number, h: number }} r */
  function plot(kind, r) {
    const x1 = r.x0 + r.w - 1, y1 = r.y0 + r.h - 1;
    const fence = (k = "wirefence", gateK = "fieldgate") => { // a fence round it, its gate in the south side's middle and one more on the north
      const gx = r.x0 + Math.floor(r.w / 2);
      for (let x = r.x0; x <= x1; x++) for (const yy of [r.y0, y1]) { if (Math.abs(x - gx) <= 1) { if (inside(x, yy) && cells[I(x, yy)].k === "open") cells[I(x, yy)].k = gateK; continue; } piece(x, yy, k); }
      for (let yy = r.y0 + 1; yy < y1; yy++) for (const x of [r.x0, x1]) piece(x, yy, k);
      for (let x = gx - 1; x <= gx + 1; x++) for (let yy = y1 + 1; yy <= y1 + 2; yy++) if (inside(x, yy)) keep[I(x, yy)] = 1;
    };
    const fillF = (f) => paint(r.x0, r.y0, r.w, r.h, f, false);
    switch (kind) {
      case "field": fillF("field"); fence(); scatter("hay", rng.int(0, 3), r.x0 + 2, r.y0 + 2, x1 - 1, y1 - 1); break;
      case "pasture": fillF("grass"); fence(); scatter("stocktank", 1, r.x0 + 2, r.y0 + 2, x1 - 1, y1 - 1); scatter("tree", rng.int(1, 4), r.x0 + 2, r.y0 + 2, x1 - 1, y1 - 1); break;
      case "range": fillF(option.key === "ranch" ? "dirt" : "grass"); fence(); scatter("stocktank", rng.int(1, 2), r.x0 + 2, r.y0 + 2, x1 - 1, y1 - 1); scatter("bush", rng.int(6, 14), r.x0 + 2, r.y0 + 2, x1 - 1, y1 - 1); scatter("tree", rng.int(2, 6), r.x0 + 2, r.y0 + 2, x1 - 1, y1 - 1); break;
      case "corral": { // a board fence, the squeeze chute by the gate, a stock tank and hay inside
        fillF("dirt"); fence("fence", "gate");
        const gx = r.x0 + Math.floor(r.w / 2);
        piece(gx + 3, y1 - 2, "chute"); piece(gx + 3, y1 - 3, "chute");
        scatter("stocktank", 1, r.x0 + 2, r.y0 + 2, x1 - 1, y1 - 3); scatter("hay", rng.int(1, 3), r.x0 + 2, r.y0 + 2, x1 - 1, y1 - 3);
        break;
      }
      case "arena": fillF("dirt"); fence("fence", "gate"); scatter("hay", 2, r.x0 + 2, r.y0 + 2, x1 - 1, y1 - 1); for (let x = r.x0 + 3; x + 1 < x1 - 2; x += 3) piece(x, r.y0 + 2, "bleachers", 2, 2) || null; break;
      case "lagoon": { // the manure lagoon: a pond of slurry behind its fence, a dirt bank round it
        fillF("dirt"); fence();
        for (let yy = r.y0 + 3; yy <= y1 - 3; yy++) for (let x = r.x0 + 3; x <= x1 - 3; x++) piece(x, yy, "water", 1, 1, { lagoon: true });
        break;
      }
      case "orchard": case "sugarbush": { fillF("grass"); fence(); const step = kind === "orchard" ? 4 : 3; for (let yy = r.y0 + 2; yy < y1 - 1; yy += step) for (let x = r.x0 + 2 + ((yy / step) & 1); x < x1 - 1; x += step) if (kind === "orchard" || rng.chance(0.8)) piece(x, yy, "tree"); if (kind === "sugarbush") scatter("barrel", rng.int(2, 5), r.x0 + 2, r.y0 + 2, x1 - 1, y1 - 1); break; }
      case "vineyard": fillF("dirt"); fence(); for (let yy = r.y0 + 2; yy < y1 - 1; yy += 3) for (let x = r.x0 + 2; x < x1 - 1; x++) if ((x - r.x0) % 12 !== 6) piece(x, yy, "trellis"); break;
      case "pumpkins": fillF("field"); fence(); scatter("hay", rng.int(6, 12), r.x0 + 2, r.y0 + 2, x1 - 1, y1 - 1); break;
      case "trees": fillF("grass"); fence(); for (let yy = r.y0 + 2; yy < y1 - 1; yy += 3) for (let x = r.x0 + 2; x < x1 - 1; x += 2) if (rng.chance(0.75)) piece(x, yy, "tree"); break;
      case "airstrip": { // a graded strip of gravel across the back, a windsock's pole, fuel drums at its end
        fillF("grass");
        const sy = r.y0 + Math.floor(r.h / 2) - 4;
        paint(r.x0, sy, r.w, 8, "gravel", false);
        for (let x = r.x0; x < x1; x += 6) { const c = cells[I(x, sy)]; if (c) c.f = "road"; const d = cells[I(x, sy + 7)]; if (d) d.f = "road"; }
        piece(r.x0 + 2, sy - 2, "lamp"); scatter("drum", 3, r.x0 + 2, sy + 9, r.x0 + 14, Math.min(y1, sy + 14));
        break;
      }
      default: fillF("grass");
    }
  }
  // Trees along the road and the map's edges (a windbreak).
  for (let t = 0, n = Math.round(W / 6); t < n * 4; t++) { const x = rng.int(0, W - 1), yy = rng.chance(0.5) ? rng.int(0, F.EDGE - 1) : rng.int(roadY - 3, roadY - 2); if (inside(x, yy) && cells[I(x, yy)].k === "open" && !keep[I(x, yy)]) piece(x, yy, "tree"); }
  // ---------- the result ----------
  const vehicle = compoundVehicle(C, zones[0], withVehicle);
  const scenes = sceneList.length ? { list: sceneList.map((sc, i) => ({ ...sc, id: i + 1 })), bodies: sceneBodies, piles: scenePiles, pieces: scenePieces, seed: (seedOf(state, "scenebattle", tileId, option.id) % 2147483646) + 1 } : null;
  const map = compoundResult(C, { key: option.key, id: option.id, name: option.name, zones, vehicle, kind: option.key, extra: { street: true, farmstead: true, farmKind: option.key, layout: LY.id, layoutName: LY.name, grounds, yard: yardList } });
  for (const h of map.plan.houses) { const B = built[h.k]; h.plan = B.spec.vid || null; h.row = frontSet.has(B) ? 0 : 1 + backRows.findIndex((r) => r.row.includes(B)); }
  return Object.assign(map, { street: true, farmstead: true, scenes, deadScale: Math.max(1, F.DEAD * (W * H) / (150 * 150)) });
}
const PLOT_NAME = { field: "Crop field", pasture: "Pasture", range: "Range", corral: "Corral", arena: "Riding arena", lagoon: "Manure lagoon", orchard: "Orchard", sugarbush: "Sugarbush", vineyard: "Vineyard", pumpkins: "Pumpkin patch", trees: "Christmas trees", airstrip: "Airstrip" };

/** The raid's opening line on a farm or a ranch. @param {any} b the battle */
export function farmIntro(b) {
  const R = b.raid || {}, P = R.plan || {};
  const n = (P.houses || []).length, plots = (P.grounds || []).map((g) => g.name.toLowerCase());
  return `${P.layoutName || "The farm"}: ${n} buildings round the yard${plots.length ? `, and out back ${[...new Set(plots)].join(", ")}` : ""}.`;
}
