// @ts-check
// Farm buildings: sheds, farm stands and the farm's working buildings, a dozen plans and more a type (issue #62 of the
// round-2 epic #39, the user's request 2026-10-26: "renovations to Farms Farm houses ranches farm stands sheds").
//
// THE TYPES (buildingmaps.js BUILDINGS keys; their layouts are buildvariants.js LAYOUTS rows, so the shared picker,
// variantpick.js, has them as "layout:<key>" and a POI's layout names it, pois.js poi.lay):
//   shed       tool shed, potting shed, pump house, smokehouse, root cellar, springhouse, chicken coop, woodshed, corn
//              crib, outhouse, well house, generator shed, icehouse: a shed POI (pois.js) in a new save, and a farm's or a
//              ranch's outbuildings (farmstead.js).
//   farmstand  a roadside shack, a produce barn, a pick-your-own stand, a honey stand, a pumpkin-patch stand, a
//              Christmas tree lot's trailer, a farmers' market shed, an egg stand, a cider mill stand, a berry stand, a
//              flower stand, a maple sugar store, a farm creamery: a farm stand POI in a new save, and a farm's own stand.
//   farmbldg   the milk house, a greenhouse, a packing shed, cold storage, a winery, a bunkhouse, an indoor riding arena,
//              a show stable, a sugarhouse, a meat processing shed, a ranch cookhouse, a feed mill, a scale house: a farm's
//              or a ranch's working buildings only (farmstead.js lays them out; data-placement.js "of farm").
// Each plan is a distinct floor plan, not a recolour: its own set of rooms and which open onto which (tools/varianttest.js
// holds every pair of a type's layouts to two differences or more). Sizes: data-buildingsize.js REAL_SIZE <key>.sizes,
// one row a plan (realFoot), drawn at that size (planned: realScale leaves it as it is); every plan is one storey.
//
// THE ROOMS: a leaf's farm mark picks its style here (FARM_STYLES: roomlayout.js's helpers, the industrial styles'
// way); a leaf's ind mark takes industrylayout.js's (a cold room, a greenhouse, a packing room, bunks). Their loot is
// the room's type (combat.js AREAS): the farm's own kinds (feedroom: feed, seed, wormer, rope, wire; rootcellar: jars,
// canned and cellar food; toolshed: tools, rope, fencing; vetroom: livestock medicine; fuelstore: fuel and propane;
// standshop: produce, honey, jars, seed) and the old ones (a barn's, a kitchen's, a garage's).
// Older saves: none of these types stands in an older save (worldcfg.js legacyFarms: its shed and farm stand POIs keep
// a machine shed's and a corner shop's building); built with opts.legacy (the roomsLegacy rule) a type takes its first
// plan with no name or id.
import { pickLayout } from "./buildvariants.js";
import { realFoot } from "./data-buildingsize.js";
import { registerScene } from "./interiorscenes.js"; // the farm buildings' signs of survival (below)

export const FARM_KEYS = ["shed", "farmstand", "farmbldg"];

/** A split of parts along x or y: [size, leaf] (size: cells, a share under 1, or "*"). */
const X = (...parts) => ({ split: "x", parts });
const Y = (...parts) => ({ split: "y", parts });
/** A room: its role (buildingmaps.js ROLES), its name, its farm style (FARM_STYLES) and the rest. */
const R = (role, name, farm, o = {}) => ({ role, name, ...(farm ? { farm } : {}), ...o });
const D = (side, roles, o = {}) => ({ side, roles, chance: 1, lock: 0.15, ...o }); // a door that is always there
const footOf = (bw, bh) => (bw * bh < 150 ? "small" : bw * bh < 360 ? "medium" : "large");

// ---------- the plans: (rng) → the program, the exits and the extras; the size is the REAL_SIZE row's ----------
/** @type {Record<string, Record<string, (rng: any) => any>>} */
export const FARM_PLANS = {
  shed: {
    tool: () => ({ program: X(["*", R("workshop", "Tool shed", "tools", { type: "toolshed", entry: true })], [3, R("storage", "Lean-to", "lumber", { type: "toolshed" })]) }),
    potting: () => ({ program: X(["*", R("greenhouse", "Potting shed", null, { ind: "greenhouse", type: "garden", entry: true })], [3, R("storage", "Seed store", "seed", { type: "feedroom" })]) }),
    pump: () => ({ program: X(["*", R("genroom", "Pump room", "pump", { type: "fuelstore", entry: true })], [3, R("waterstore", "Pressure tank", "tank", { type: "toolshed" })]) }),
    smoke: () => ({ program: Y(["*", R("pantry", "Smoke room", "smoke", { type: "rootcellar", fl: "dirt" })], [2, R("workshop", "Butchering bench", "butcher", { type: "kitchen", entry: true })]) }),
    rootcellar: () => ({ program: Y(["*", R("pantry", "Root cellar", "cellar", { type: "rootcellar", fl: "dirt", windows: false })], [2, R("corridor", "Cellar steps", null, { entry: true })]) }),
    spring: () => ({ program: X(["*", R("waterstore", "Spring trough", "spring", { type: "rootcellar", entry: true, fl: "conc" })], [3, R("pantry", "Cold shelf", "cellar", { type: "rootcellar" })]) }),
    coop: () => ({ program: X(["*", R("hayloft", "Roost", "coop", { type: "feedroom", entry: true, fl: "dirt" })], [3, R("storage", "Feed bin", "feed", { type: "feedroom" })]), exits: [D("back", ["hayloft"], { lock: 0, name: "Pop hole" })] }),
    wood: () => ({ program: R("storage", "Woodshed", "wood", { type: "toolshed", entry: true, fl: "dirt" }), exits: [D("back", ["storage"], { lock: 0.05 })] }),
    crib: () => ({ program: X([3, R("storage", "Corn crib", "crib", { type: "feedroom" })], ["*", R("barnfloor", "Drive-through", null, { type: "barn", entry: true })]) }),
    outhouse: () => ({ program: X(["*", R("restroom", "Two-holer", null, { entry: true, fl: "plank" })], [4, R("storage", "Lime bin", "lime", { type: "toolshed" })]) }),
    well: () => ({ program: X(["*", R("waterstore", "Well room", "pump", { type: "toolshed", entry: true })], [3, R("workshop", "Pump bench", "tools", { type: "toolshed" })]) }),
    gen: () => ({ program: X(["*", R("genroom", "Generator shed", "gen", { type: "fuelstore", entry: true })], [3, R("storage", "Fuel cans", "fuel", { type: "fuelstore" })]) }),
    ice: () => ({ program: X(["*", R("coldroom", "Ice room", null, { ind: "coldroom", type: "rootcellar", windows: false })], [3, R("storage", "Sawdust bin", "lumber", { type: "toolshed", entry: true })]) }),
  },
  farmstand: {
    shack: () => ({ program: Y(["*", R("sales", "Stand", "stand", { type: "standshop", entry: true })], [2, R("storage", "Back room", "seed", { type: "standshop" })]) }),
    producebarn: () => ({ program: Y(["*", R("sales", "Produce barn", "stand", { type: "standshop", entry: true, maxBoxes: 6 })], [4, X(["*", R("coldroom", "Cooler", null, { ind: "coldroom", type: "rootcellar" })], [4, R("office", "Farm office", null, { type: "office" })])]), exits: [D("back", ["coldroom"], { roller: true, width: 2, name: "Loading door" })] }),
    pyo: () => ({ program: X(["*", R("reception", "Weigh station", "weigh", { type: "standshop", entry: true })], [3, R("storage", "Basket store", "baskets", { type: "standshop" })]), exits: [D("back", ["reception"], { lock: 0, name: "To the fields" })] }),
    honey: () => ({ program: X(["*", R("sales", "Honey stand", "honey", { type: "standshop", entry: true })], [4, R("workshop", "Extracting room", "extract", { type: "standshop" })]) }),
    pumpkin: () => ({ program: X(["*", R("barnfloor", "Hay barn", "pumpkin", { type: "barn" })], [0.4, R("sales", "Pumpkin stand", "stand", { type: "standshop", entry: true })]), exits: [D("back", ["barnfloor"], { width: 2, lock: 0, name: "To the patch" })] }),
    xmas: () => ({ program: X(["*", R("office", "Lot trailer", "trailer", { type: "standshop", entry: true })], [4, R("workshop", "Netting shed", "netting", { type: "toolshed" })]) }),
    market: () => ({ program: R("sales", "Market shed", "market", { type: "standshop", entry: true, maxBoxes: 8 }), exits: [D("left", ["sales"], { lock: 0, width: 2, name: "Market aisle (west)" }), D("right", ["sales"], { lock: 0, width: 2, name: "Market aisle (east)" })] }),
    egg: () => ({ program: X(["*", R("sales", "Egg stand", "stand", { type: "standshop", entry: true })], [3, R("pantry", "Egg cooler", "eggs", { type: "rootcellar" })]) }),
    cider: () => ({ program: X(["*", R("sales", "Cider stand", "stand", { type: "standshop", entry: true })], [0.45, R("process", "Cider press", "press", { type: "standshop" })]) }),
    berry: () => ({ program: Y(["*", R("sales", "Berry stand", "stand", { type: "standshop", entry: true })], [3, R("kitchen", "Jam kitchen", null, { type: "kitchen" })]) }),
    flower: () => ({ program: X(["*", R("greenhouse", "Flower house", null, { ind: "greenhouse", type: "garden" })], [0.4, R("sales", "Flower stand", "stand", { type: "standshop", entry: true })]) }),
    maple: () => ({ program: X(["*", R("sales", "Maple store", "stand", { type: "standshop", entry: true })], [0.45, R("genroom", "Evaporator room", "sugar", { type: "fuelstore" })]) }),
    creamery: () => ({ program: Y(["*", R("sales", "Creamery shop", "stand", { type: "standshop", entry: true })], [3, X(["*", R("kitchen", "Cheese room", null, { type: "kitchen" })], [4, R("coldroom", "Milk cooler", null, { ind: "coldroom", type: "rootcellar" })])]) }),
  },
  farmbldg: {
    milkhouse: () => ({ program: X(["*", R("coldroom", "Bulk tank room", null, { ind: "coldroom", type: "rootcellar", entry: true, fl: "steel" })], [3, R("restroom", "Wash-up", null)]), exits: [D("back", ["coldroom"], { name: "To the parlour" })] }),
    greenhouse: () => ({ program: X(["*", R("greenhouse", "Greenhouse", null, { ind: "greenhouse", type: "garden" })], [5, R("workshop", "Head house", "tools", { type: "toolshed", entry: true })]), exits: [D("left", ["greenhouse"], { lock: 0.05 })] }),
    packshed: () => ({ program: Y(["*", R("sorting", "Packing line", null, { ind: "packing", type: "standshop", entry: true })], [5, X(["*", R("coldroom", "Cold storage", null, { ind: "coldroom", type: "rootcellar" })], [5, R("office", "Packing office", null, { type: "office" })])]), exits: [D("back", ["coldroom"], { roller: true, width: 3, name: "Loading dock" })] }),
    coldstore: () => ({ program: Y([5, R("dock", "Loading dock", null, { ind: "dock", type: "warehouse", entry: true })], ["*", X(["*", R("coldroom", "Apple store", null, { ind: "coldroom", type: "rootcellar" })], ["*", R("coldroom", "Potato store", null, { ind: "coldroom", type: "rootcellar" })])]), exits: [D("front", ["dock"], { roller: true, width: 3, name: "Dock door" })] }),
    winery: () => ({ program: X(["*", Y(["*", R("process", "Crush pad and tanks", "tanks", { type: "standshop" })], [0.45, R("storage", "Barrel cellar", "barrels", { type: "rootcellar", windows: false })])], [0.35, R("sales", "Tasting room", "tasting", { type: "standshop", entry: true })]), exits: [D("back", ["process"], { roller: true, width: 3, name: "Crush pad door" })] }),
    bunkhouse: () => ({ program: X(["*", R("bunk", "Bunk room", null, { ind: "bunks", type: "cabin" })], [5, Y(["*", R("kitchen", "Cook room", null, { type: "kitchen", entry: true })], [3, R("bath", "Wash room", null, { type: "house" })])]), exits: [D("back", ["bunk"], { lock: 0.05 })] }),
    arena: () => ({ program: X(["*", R("barnfloor", "Riding arena", "arena", { type: "barn", entry: true, fl: "dirt" })], [6, Y(["*", R("tack", "Tack room", "tack", { type: "barn" })], ["*", R("living", "Viewing room", null, { type: "house" })])]), exits: [D("left", ["barnfloor"], { width: 3, roller: true, name: "Arena door" })] }),
    stable: () => ({ program: X([5, R("office", "Stable office", null, { type: "vetroom", entry: true })], ["*", Y(["*", X(["*", R("hayloft", "Stall", "stall", { type: "barn", fl: "dirt" })], ["*", R("hayloft", "Stall", "stall", { type: "barn", fl: "dirt" })], ["*", R("tack", "Tack room", "tack", { type: "barn" })])], [2, R("corridor", "Aisle")], ["*", X(["*", R("hayloft", "Stall", "stall", { type: "barn", fl: "dirt" })], ["*", R("hayloft", "Stall", "stall", { type: "barn", fl: "dirt" })], ["*", R("hayloft", "Wash stall", "stall", { type: "vetroom", fl: "conc" })])])]), exits: [D("right", ["corridor"], { width: 2, name: "Aisle door" })] }),
    sugarhouse: () => ({ program: X(["*", R("genroom", "Evaporator", "sugar", { type: "fuelstore", entry: true })], [4, R("storage", "Wood room", "wood", { type: "toolshed" })]), exits: [D("back", ["storage"], { lock: 0.05 })] }),
    processing: () => ({ program: X(["*", R("workshop", "Cutting room", "butcher", { type: "kitchen", entry: true, fl: "conc" })], [5, R("coldroom", "Hanging cooler", null, { ind: "coldroom", type: "rootcellar" })]) }),
    cookhouse: () => ({ program: X(["*", R("mess", "Mess hall", null, { type: "kitchen", entry: true })], [6, R("kitchen", "Cookhouse kitchen", null, { type: "kitchen" })]), exits: [D("back", ["kitchen"], { name: "Kitchen door" })] }),
    feedmill: () => ({ program: X(["*", R("process", "Mixer room", "mill", { type: "feedroom", entry: true })], [6, R("storage", "Bagged feed", "feed", { type: "feedroom" })]), exits: [D("back", ["storage"], { roller: true, width: 2, name: "Loading door" })] }),
    scalehouse: () => ({ program: X(["*", R("office", "Farm office", null, { type: "office", entry: true })], [4, R("control", "Scale room", "scale", { type: "office" })]) }),
  },
};

/**
 * The spec of a building of a farm type: its layout (buildvariants.js pickLayout: a pinned one, else the building's
 * dice by the setting), drawn at its REAL_SIZE row's size. An older save's (o.legacy) the first plan, unnamed.
 * @param {string} key @param {any} rng @param {any} [o]
 */
export function farmPlan(key, rng, o = {}) {
  const plans = FARM_PLANS[key], ids = Object.keys(plans);
  const lay = pickLayout(key, rng.state, o);
  const id = lay && plans[lay.id] ? lay.id : ids[0];
  const foot = realFoot(rng, key, id) || { bw: 8, bh: 6 };
  const p = plans[id](rng);
  const spec = {
    bw: foot.bw, bh: foot.bh, front: { width: key === "shed" ? 1 : 2 }, ground: "farm", storeys: 1, foot: footOf(foot.bw, foot.bh), openDoors: 0.4,
    program: p.program, exits: p.exits || [], realSize: id, ...(p.extra || {}),
  };
  return lay ? { ...spec, vid: lay.id, vname: lay.name } : spec;
}

// ======================================================================================
// The rooms (FARM_STYLES, by the plan leaf's farm mark; roomlayout.js's helpers)
// ======================================================================================
const full = (L) => L.boxes() >= L.target();
const P = (L, o = {}) => ({ ...o, plain: full(L) });
/** Lootable pieces of these kinds against the walls, then off them, until the room holds its share. */
function fill(L, kinds) {
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.wall(kinds[i % kinds.length], { prefer: "corner" })) miss = 0; else miss++; }
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.centre(kinds[i % kinds.length])) miss = 0; else miss++; }
  if (!L.boxes()) L.need(kinds[0]);
}
/** Up to n of k against the walls (no container unless the room wants one). */
const some = (L, k, n) => { for (let i = 0; i < n; i++) if (!L.wall(k, P(L, { prefer: "corner" }))) break; };

/** @type {Record<string, (L: any) => void>} */
export const FARM_STYLES = {
  tools(L) { L.wall("workbench", P(L, { prefer: "middle" })); fill(L, ["toolchest", "shelf", "crate"]); },
  lumber(L) { fill(L, ["crate", "shelf"]); },
  seed(L) { L.wall("barrel", { plain: true }); fill(L, ["crate", "shelf", "crate"]); },
  feed(L) { some(L, "hay", 1); fill(L, ["crate", "crate", "drum"]); },
  pump(L) { L.wall("watertank", { prefer: "corner" }) || L.wall("compressor", { prefer: "corner" }); fill(L, ["toolchest", "shelf"]); },
  tank(L) { L.wall("watertank", { prefer: "corner" }); fill(L, ["shelf", "toolchest"]); },
  smoke(L) { L.centre("smoker") || L.wall("smoker") || L.need("smoker"); fill(L, ["rack", "shelf"]); },
  butcher(L) { L.centre("table"); L.wall("sink", { plain: true }); fill(L, ["freezer", "counter", "shelf"]); },
  cellar(L) { L.wall("barrel", { plain: true }); fill(L, ["shelf", "shelf", "crate"]); },
  spring(L) { L.wall("watertank", { prefer: "corner" }); fill(L, ["shelf", "crate"]); },
  coop(L) { some(L, "nestbox", 3); if (!L.has("nestbox")) L.need("nestbox"); some(L, "hay", 1); fill(L, ["crate"]); },
  wood(L) { fill(L, ["crate", "crate", "toolchest"]); },
  crib(L) { L.wall("grainbin", { prefer: "corner" }); fill(L, ["crate", "crate"]); },
  lime(L) { fill(L, ["shelf", "crate"]); },
  gen(L) { L.wall("fueltank", { prefer: "corner" }) || L.need("fueltank"); L.wall("compressor", { prefer: "corner" }); fill(L, ["drum", "toolchest", "shelf"]); },
  fuel(L) { fill(L, ["drum", "drum", "shelf"]); },
  stand(L) { L.wall("checkout", P(L, { prefer: "middle" })) || L.wall("counter", P(L, { prefer: "middle" })); fill(L, ["producebin", "producebin", "shelf"]); },
  market(L) { for (let i = 0; i < 4; i++) if (!L.centre("producebin")) break; fill(L, ["producebin", "counter", "crate"]); },
  weigh(L) { L.wall("counter", P(L, { prefer: "middle" })); fill(L, ["producebin", "crate"]); },
  baskets(L) { fill(L, ["crate", "shelf"]); },
  honey(L) { L.wall("counter", P(L, { prefer: "middle" })); L.wall("beehive", { prefer: "corner", plain: true }); fill(L, ["shelf", "producebin"]); },
  extract(L) { L.centre("vat") || L.wall("vat"); fill(L, ["shelf", "crate"]); },
  pumpkin(L) { some(L, "hay", 3); fill(L, ["crate", "producebin"]); },
  trailer(L) { const d = L.wall("desk", P(L, { prefer: "middle" })); if (d) L.around(d, "chair", 1); fill(L, ["cabinet", "shelf"]); },
  netting(L) { L.centre("workbench") || L.wall("workbench"); fill(L, ["crate", "shelf"]); },
  eggs(L) { fill(L, ["coldshelf", "shelf"]); },
  press(L) { L.centre("vat") || L.wall("vat"); fill(L, ["crate", "drum"]); },
  sugar(L) { L.wall("woodstove", { prefer: "corner" }); L.centre("vat") || L.wall("vat"); fill(L, ["shelf", "crate"]); },
  tanks(L) { for (let i = 0; i < 3; i++) if (!L.centre("brewtank")) break; fill(L, ["drum", "shelf"]); },
  barrels(L) { fill(L, ["winerack", "winerack", "crate"]); },
  tasting(L) { L.wall("barcounter", { prefer: "middle" }); fill(L, ["winerack", "cabinet"]); },
  arena(L) { some(L, "hay", 2); fill(L, ["saddlerack", "crate"]); },
  tack(L) { fill(L, ["saddlerack", "saddlerack", "shelf"]); },
  stall(L) { some(L, "hay", 1); fill(L, ["crate"]); },
  mill(L) { L.centre("machine", { size: [2, 1] }) || L.wall("machine"); fill(L, ["crate", "crate"]); },
  scale(L) { L.wall("ctrlpanel", { plain: true }); fill(L, ["filing", "desk"]); },
};
/** The style of a farm plan's room (its farm mark), or null. @param {any} room */
export const farmStyle = (room) => (room && room.farm && FARM_STYLES[room.farm] ? FARM_STYLES[room.farm] : null);

// ======================================================================================
// The farm buildings' signs of survival (interiorscenes.js registerScene; their own dice there), only in these plans'
// rooms (when: a room with a farm or an ind mark of these plans, so no older building rolls them):
//   cellarhide  a family hid in the root cellar, the springhouse or the cold store: the door shut, the jars and the bins
//               round them, and they are still there;
//   bunkstand   the hands made their stand in the bunk room: bunks and footlockers shoved against the door, the ones
//               who held it, and the blood where the dead came through.
// ======================================================================================
const farmRooms = (ctx, test) => ctx.rng.shuffle(ctx.rooms.filter((r) => (r.farm || r.ind) && test(r) && !r.scene && !r.locked));
const cellarLike = (r) => r.type === "rootcellar" && /cellar|spring|store|cooler|ice/i.test(r.name || "");
const lower = (r) => String(r.name || "room").toLowerCase();
function cellarHide(ctx) {
  const { rng } = ctx;
  for (const r of farmRooms(ctx, cellarLike)) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (free.length < 3) continue;
    const n = Math.min(free.length - 1, rng.int(2, 4)), spots = rng.shuffle(free).slice(0, n);
    for (const [x, y] of spots) ctx.body(f, x, y, { human: true, quiet: true });
    return ctx.done("cellarhide", r, spots[0][0], spots[0][1], `A family hid in the ${lower(r)} with the jars and the potatoes, and shut the door. ${n} of them are still there.`);
  }
  return null;
}
function bunkStand(ctx) {
  const { rng } = ctx;
  for (const r of farmRooms(ctx, (q) => q.ind === "bunks")) {
    const f = r.f || 0, d = (r.doors || [])[0], free = ctx.freeIn(r);
    if (!d || free.length < 4) continue;
    const byDoor = free.sort((p, q) => Math.abs(p[0] - d[0]) + Math.abs(p[1] - d[1]) - (Math.abs(q[0] - d[0]) + Math.abs(q[1] - d[1])));
    const [cx, cy] = byDoor[0];
    ctx.piece(f, cx, cy, "footlocker");
    const rest = byDoor.slice(1, 4), n = Math.min(rest.length, rng.int(1, 3));
    for (const [x, y] of rest.slice(0, n)) { ctx.body(f, x, y, { human: true }); ctx.splatter(f, x, y, "human", rng.int(1, 2)); }
    return ctx.done("bunkstand", r, cx, cy, `The hands made their stand in the ${lower(r)}: a footlocker shoved against the door, and ${n === 1 ? "one who held it" : `${n} who held it`}.`);
  }
  return null;
}
registerScene("cellarhide", { w: 3, place: cellarHide, kinds: ["shed", "farmbldg", "farmstand"], when: (ctx) => ctx.rooms.some((r) => (r.farm || r.ind) && cellarLike(r)) });
registerScene("bunkstand", { w: 4, place: bunkStand, kinds: ["farmbldg"], when: (ctx) => ctx.rooms.some((r) => r.ind === "bunks") });
