// Shopping malls (the user's request 2026-10-25, issue #30 of the interiors epic #7: "add … mall max 500x500 building
// variants"): a strip mall, an enclosed regional mall and an outlet centre, each one raid map of the whole complex,
// built on compound.js (the shared multi-building code: the buildings copied onto one grid, turned to face their
// walkway, kept apart in the POI's ledger by c.house; #28's campuses use the same).
//
// Every unit is a real building made by buildingmaps.js assemble from its own dice (the world seed, the tile, the mall
// and the unit's number), laid out by its own kind's styles: an inline shop is a shop of a weighted kind (MALL.INLINE:
// clothing most, then electronics, sporting goods, books, pets, a pharmacy, restaurants…) with its franchise (its name,
// look and plan: data-shops.js FRANCHISES), forced to its slot's width and the row's depth, with its storefront door on
// the concourse (or the walk) and a service door at the back onto the service corridor (or the alley); its side walls
// shared with its neighbours (no windows). Vacant units are common (MALL.VACANT): an empty floor and a back room, some
// boarded up (the front walled, the door nailed shut: locked), some half-built (bare concrete, crates and drums); a
// unit open for business may have its security grille down (MALL.SHUTTER: a locked roller door).
//
// The kinds (MALL.KINDS, by the site: buildingmaps.js SITES):
//   - stripmall: one row of 5–12 units under one roof (or an L: a second leg facing east at the west end) facing a
//     parking lot across a covered walk, an anchor at the far end (a supermarket, #22's, or a hardware store), a back
//     service alley with the dumpsters, a pad on the lot (a gas station with its pumps, or a fast-food place), the road
//     along the front. About 150 × 100.
//   - regionalmall (the old "mall" site): an enclosed mall of 2–3 levels (1–3 once the cap is 500) along a concourse
//     (a wide indoor walkway: planters, benches, kiosk carts, a fountain and the carousel at the centre court, the
//     directory signs) between two rows of inline units; 2–4 anchors: a department store at each end of the
//     concourse and, with 3–4, one (a department store or #22's supermarket) at the centre court on the north side and
//     the south; upstairs the concourse is a walkway along each row with the atrium open to the floor below, bridges
//     across it where the escalators rise (a stair run up the bridge with the stopped escalator beside it; #9's runs)
//     and the lift (a one-cell lift car between the levels) at the centre court. The food court on the top level: a
//     row of counters (#16's restaurant franchises: their kitchens and walk-ins) behind the seating area of tables and
//     chairs, the shared service corridor behind their kitchens. The cinema on the top level (a lobby with the
//     concession stand, 2–5 screens of tiered seats, the projection booth behind them), an arcade, the mall offices
//     (management, mall security's office and its locker room: a few weapons, cuffs, batons and radios; the first-aid
//     room) and restrooms on every level. Service corridors behind both rows on every level (the units' service
//     doors, the service stairs at their ends, the loading docks' roller doors on the ground floor) run to the docks;
//     entrance vestibules cross the rows to the surface lots round the mall; a parking garage of 2–3 levels stands on
//     the north lot. 300 × 160–300 (the map's cap: MALL.CAP, raised to 500 with #24's big-map engine).
//   - outlet: an open-air village of separate shop buildings facing a pedestrian street (two in a big one) widening to
//     a plaza with a fountain and benches at the middle, neighbours here and there joined by covered walkways
//     (compound.js link), service lanes behind the rows, food pads, parking lots north and south, the road.
//
// What a raid finds (MALL.DEAD, the plan's intro): the dead thickest at the food court and the cinema (their rooms'
// deadW: buildingmaps.js placeInterior weights them), spread elsewhere; the ways out on every side, by the lots; the
// intro (buildingmaps.js interiorIntro) names the anchors and the wings to head for. The loot is each shop's own tables
// (so a mall holds the shops' variety), the food court's kitchens, mall security's few weapons (combat.js AREAS
// mallsec), the anchors' stockrooms, the cars on the lots.
//
// Older saves: a mall raided before keeps its old buildings (buildingmaps.js LEGACY_SITES). The same mall is the same
// map every visit (its dice from the seed, the tile, the option; every unit's its own).
import { Rng } from "./rng.js";
import { hash01 } from "./skills.js";
import { BUILDINGS, assemble, DOOR_KINDS, BMAP } from "./buildingmaps.js";
import { FRANCHISES } from "./data-shops.js";
import { legacyRooms } from "./worldcfg.js";
import { compoundGrid, placeBuilding, link, guard, parkingLot, compoundResult, compoundVehicle, orient, SIDE_NAME } from "./compound.js";

export const MALL = {
  CAP: 300,          // a mall's map is at most this many cells a side (raised to 500 once #24's big-map engine is on dev)
  // The inline units' kinds (buildingmaps.js BUILDINGS, each with its franchises), weighted.
  INLINE: { clothing: 22, electronics: 6, sportshop: 5, bookstore: 4, petstore: 3, pharmacy: 3, restaurant: 4, bar: 1, liquor: 1.2, radioshop: 1, pawnshop: 1, corner: 2, gunstore: 0.5, garden: 0.4 },
  OUTLETS: { clothing: 30, sportshop: 7, electronics: 4, petstore: 1.5, bookstore: 2, liquor: 1, garden: 1 },
  VACANT: 0.14,      // an inline unit stands empty
  BOARDED: 0.4,      // a vacant unit boarded up (front walled, door nailed shut)
  HALFBUILT: 0.25,   // a vacant unit never finished (bare concrete, crates and drums)
  SHUTTER: 0.16,     // a shop with its security grille down (the front door a locked roller)
  BACK_LOCK: 0.25,   // a unit's service door locked
  DOCK_LOCK: 0.3,    // a loading dock's roller door locked
  STRIP: { UNITS: [5, 12], W: [10, 14], D: [16, 19], L: 0.3, ALLEY: 7, WALK: 2, LOT: 36, ROAD: 6, XM: 6 },
  REGIONAL: { LEVELS: [[2, 0.6], [3, 0.4]], LEVELS500: [[1, 0.15], [2, 0.5], [3, 0.35]], ANCHORS: [2, 4], SLOT: [12, 18], D: [16, 19], CW: [10, 13], WALK: 4, XM: 10, LOT: 46, SUPER: 0.35, GARAGE: 0.7 },
  OUTLET: { UNITS: [14, 28], STREET: 10, GAP: [3, 6], D: [15, 19], WALKWAY: 0.35, LANE: 5, LOT: 30, PADS: [1, 3] },
  FOOD: { W: [40, 50], D: 10, COUNTERS: [4, 7] },
  CINEMA: { W: [36, 46], SCREEN: 9 },
  DEAD: { stripmall: 1.0, regionalmall: 1.7, outlet: 1.25 }, // the site's roster × this (× the street's growth with the ground: battlesize.js streetDeadScale)
  DEADW: { foodcourt: 3, screen: 2.5, cinema: 2 },               // a room's weight for the dead (placeInterior): the food court and the cinema crowded
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const seedOf = (...k) => Math.floor(hash01(...k) * 4294967296);
const leaves = (list) => list.map(([s, r]) => [s, typeof r === "string" ? { role: r } : r]);
const pickW = (rng, table) => rng.weighted(Object.keys(table), (k) => table[k]);

// ---------------------------------------------------------------------------------------------------------------------
// The mall's own buildings (buildingmaps.js BUILDINGS cinema, arcade, mallservices, mallrestrooms, vacantunit,
// parkgarage): specs for assemble, o.w × o.d when the slot sets them.
// ---------------------------------------------------------------------------------------------------------------------
export function mallArchetype(kind, rng, o = {}) {
  const back = { side: "back", roles: null, chance: 1, lock: MALL.BACK_LOCK, name: "Service door" };
  const base = (bw, bh, program, extra = {}) => ({ bw, bh, program, exits: [back], front: { width: 2 }, openDoors: 0.5, storeys: 1, upper: null, foot: "medium", ground: "lot", stairs: { roles: ["corridor", "stock", "office"] }, ...extra });
  switch (kind) {
    case "cinema": { // a lobby with the concession stand and the restrooms, the screens behind it, the projection booth at the back
      const bw = o.w || rng.int(MALL.CINEMA.W[0], MALL.CINEMA.W[1]), bh = o.d || rng.int(17, 20);
      const n = clamp(Math.floor((bw - 2) / MALL.CINEMA.SCREEN), 2, 5);
      const screens = Array.from({ length: n }, (_, i) => ["*", { role: "screen", name: `Screen ${i + 1}`, lay: "screen" }]);
      return base(bw, bh, { split: "y", parts: [[6, { split: "x", parts: leaves([["*", { role: "lobby", name: "Cinema lobby", type: "cinema", entry: true, lay: "concession", fl: "carpet", maxBoxes: 3 }], [5, { role: "restroom", name: "Cinema restrooms" }]]) }], ["*", { split: "x", parts: screens }], [3, { role: "projection", name: "Projection booth", hub: true, lay: "projection" }]] }, { foot: "wide", windows: false }); // a real cinema's size: its map up to battlesize.js MAP_CAP.cinema
    }
    case "arcade": {
      const bw = o.w || rng.int(14, 18), bh = o.d || rng.int(16, 19);
      return base(bw, bh, { split: "y", parts: [["*", { role: "arcade", name: "Arcade", entry: true, lay: "arcade" }], [4, { split: "x", parts: leaves([["*", { role: "office", name: "Prize counter office", type: "arcade", lay: "manager" }], [3, "restroom"]]) }]] }, { windows: false });
    }
    case "mallservices": { // management, mall security (its locker room: a few weapons), the first-aid room
      const bw = o.w || rng.int(16, 20), bh = o.d || rng.int(16, 19);
      const rooms = leaves([
        ["*", { role: "office", name: "Mall security", type: "mallsec", lay: "security", maxBoxes: 2 }],
        [4, { role: "armory", name: "Security locker room", type: "mallsec", lay: "seclocker", lock: ["door", 0.6], boxLock: ["locker", 0.35], maxBoxes: 3, dk: "steel" }],
        ["*", { role: "nurse", name: "First-aid room" }],
        ["*", { role: "office", name: "Mall management", lay: "manager", boxLock: ["safe", 0.5] }],
      ]);
      return base(bw, bh, { split: "y", parts: [[3, { role: "corridor", name: "Mall offices", entry: true, hub: true }], ["*", { split: "x", parts: rooms }]] }, { windows: false });
    }
    case "mallrestrooms": {
      const bw = o.w || rng.int(12, 14), bh = o.d || rng.int(16, 19);
      return base(bw, bh, { split: "y", parts: [[3, { role: "corridor", name: "Restroom corridor", entry: true, hub: true }], ["*", { split: "x", parts: leaves([["*", { role: "restroom", name: "Men's restroom" }], ["*", { role: "restroom", name: "Women's restroom" }], [3, { role: "storage", name: "Janitor's closet", type: "warehouse", maxBoxes: 1 }]]) }]] }, { windows: false });
    }
    case "vacantunit": { // o.state: "boarded" | "halfbuilt" | "empty"
      const bw = o.w || rng.int(12, 16), bh = o.d || rng.int(16, 19), half = o.state === "halfbuilt";
      const front = { role: "sales", name: half ? "Unfinished unit" : o.state === "boarded" ? "Boarded-up unit" : "Vacant unit", type: null, furnish: "none", entry: true, hub: true, fl: half ? "conc" : "tile", lay: half ? "halfbuilt" : "vacant", vacant: true };
      return base(bw, bh, half ? front : { split: "y", parts: [["*", front], [rng.int(4, 5), { role: "stock", name: "Back room", type: "store", maxBoxes: 1, lay: "vacant" }]] });
    }
    case "parkgarage": { // decks of parked cars (containers), the ramps between them as stair runs (#9)
      const bw = o.w || rng.int(40, 54), bh = o.d || rng.int(30, 36), storeys = clamp(o.levels || rng.int(2, 3), 2, 3);
      const deck = (f) => ({ role: "deck", name: f ? `Parking deck, level ${f + 1}` : "Parking deck, ground", entry: !f, lay: "deck" });
      return { bw, bh, program: deck(0), upper: (f) => deck(f), storeys, foot: "wide", ground: "lot", front: { width: 4 }, openDoors: 1, exits: [{ side: "back", roles: null, chance: 1, lock: 0, width: 2, name: "Pedestrian exit" }, { side: "left", roles: null, chance: 0.8, lock: 0.2, name: "Stair door" }], stairs: { roles: ["deck"], n: 2, len: 4 } };
    }
    default: throw new Error(`mallArchetype: ${kind}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Units: one building each, from its own dice.
// ---------------------------------------------------------------------------------------------------------------------
const franchiseOf = (kind, rng) => { const list = FRANCHISES[kind] || []; return list.length ? rng.weighted(list, (f) => (f.w.city + f.w.suburb + f.w.town) || 0.1) : null; };
// A unit's spec fitted to its slot: storeys 1, a ring of one cell (the compound's ground replaces it), its service door
// at the back always; w × d forced when given.
function fitSpec(spec, u) {
  if (u.w) spec.bw = u.w;
  if (u.d) spec.bh = u.d;
  spec.margins = { front: 1, back: 1, left: 1, right: 1 };
  spec.ground = "none";
  spec.pumps = 0;
  if (!u.keepStoreys) { spec.storeys = 1; spec.upper = null; }
  else spec.storeys = Math.min(spec.storeys || 1, u.maxStoreys || 3);
  if (u.inline) spec.exits = [{ side: "back", roles: null, chance: 1, lock: MALL.BACK_LOCK, name: "Service door" }];
  return spec;
}
/** Builds unit u ({ kind, variant, w, d, inline, k, state }) from its own dice; returns { m, name, key }. */
function buildUnit(ctx, u) {
  const rng = new Rng(seedOf(ctx.state.seed, "mallunit", ctx.tileId, ctx.option.id, u.k));
  const legacy = legacyRooms(ctx.state);
  let key = u.kind, spec, name;
  if (BUILDINGS[u.kind] && ["cinema", "arcade", "mallservices", "mallrestrooms", "vacantunit", "parkgarage"].includes(u.kind)) {
    spec = mallArchetype(u.kind, rng, { w: u.w, d: u.d, state: u.state, levels: u.levels });
    name = u.name || (u.kind === "vacantunit" ? `${u.state === "boarded" ? "Boarded-up unit" : u.state === "halfbuilt" ? "Unfinished unit" : "Vacant unit"} ${u.no}` : BUILDINGS[u.kind].name);
  } else {
    const fr = u.variant ? (FRANCHISES[u.frKind || u.kind] || []).find((f) => f.id === u.variant) : null;
    spec = BUILDINGS[u.kind].make(rng, { variant: u.variant || null, kind: u.frKind || null, legacy });
    name = u.name || (fr ? fr.name : BUILDINGS[u.kind].name);
  }
  fitSpec(spec, u);
  if (u.kind === "parkgarage") { spec.margins = { front: 1, back: 1, left: 1, right: 1 }; spec.ground = "none"; }
  const m = assemble(rng, spec, { key, id: `${ctx.option.id}#${u.k}`, name, legacy });
  return { m, name, key };
}

// The unit's back (service) door: its exits' back door, else one cut in its back wall where a room's floor is inside.
function backDoorOf(C, part, f) {
  const back = part.exits.find((e) => e.side === { s: "n", n: "s", e: "w", w: "e" }[part.face]);
  if (back) return back;
  const cells = C.floors[f].cells, W = C.W;
  const T = { s: [0, -1], n: [0, 1], e: [-1, 0], w: [1, 0] }[part.face];
  const line = [];
  if (part.face === "s" || part.face === "n") { const y = part.face === "s" ? part.y0 : part.y0 + part.h - 1; for (let x = part.x0 + 1; x < part.x0 + part.w - 1; x++) line.push([x, y]); }
  else { const x = part.face === "e" ? part.x0 : part.x0 + part.w - 1; for (let y = part.y0 + 1; y < part.y0 + part.h - 1; y++) line.push([x, y]); }
  line.sort((a, b) => Math.abs(a[0] - part.x0 - part.w / 2) + Math.abs(a[1] - part.y0 - part.h / 2) - (Math.abs(b[0] - part.x0 - part.w / 2) + Math.abs(b[1] - part.y0 - part.h / 2)));
  for (const [x, y] of line) {
    const c = cells[y * W + x], inC = cells[(y - T[1]) * W + x - T[0]];
    if (!c || (c.k !== "wall" && c.k !== "window") || !inC || inC.k !== "open") continue;
    cells[y * W + x] = { ...c, k: "idoor", dk: "steel", hp: DOOR_KINDS.steel ? DOOR_KINDS.steel.hp : BMAP.DOOR.outer, mhp: DOOR_KINDS.steel ? DOOR_KINDS.steel.hp : BMAP.DOOR.outer };
    delete cells[y * W + x].win;
    const ex = { name: "Service door", roller: false, locked: null, x, y, cells: [[x, y]], side: SIDES_BACK[part.face], ox: x + T[0], oy: y + T[1] };
    part.exits.push(ex);
    return ex;
  }
  return null;
}
const SIDES_BACK = { s: "n", n: "s", e: "w", w: "e" };

// A door cell made a locked one (a grille down, a boarded door): its kind, its hit points, the ledger of locked doors.
function lockDoor(C, f, x, y, dk, area) {
  const c = C.floors[f].cells[y * C.W + x];
  c.k = "door"; c.dk = dk;
  if (dk === "roller") c.roll = true;
  const K = DOOR_KINDS[dk] || DOOR_KINDS.wood;
  c.hp = c.mhp = Math.max(K.hp, BMAP.DOOR.locked);
  C.lockedDoors.push({ x, y, f, area, kind: "door", dk });
}

/** Places unit u's building at (x0, y0) facing face on floor f; its rooms named after it, its front and back kept clear. */
function putUnit(ctx, u, x0, y0, face, f, solid) {
  const { C } = ctx;
  const { m, name, key } = buildUnit(ctx, u);
  const part = placeBuilding(C, m, { x0, y0, face, f0: f, k: C.parts.length, name, key, solid, roomName: (a) => `${a.name.replace(/^Sales floor$/, name)}${/^Sales floor$/.test(a.name) ? "" : `, ${name}`}`, keepRing: false, tag: { part: { role: u.role || "shop", kind: u.kind, ...(u.anchor ? { anchor: true } : {}), ...(u.variant ? { variant: u.variant } : {}), ...(u.state ? { state: u.state } : {}) } } });
  part.role = u.role || "shop";
  if (u.anchor) part.anchor = true;
  ctx.units.push({ ...u, part, name });
  // Its door fronts stay clear of the concourse's dressing.
  const keep = ctx.keep[f];
  if (part.front) for (const [x, y] of part.front.cells) { const dx = part.front.ox - part.front.x, dy = part.front.oy - part.front.y; keep.add((y + dy) * C.W + x + dx); keep.add((y + 2 * dy) * C.W + x + 2 * dx); }
  if (u.inline) { const bd = backDoorOf(C, part, f); if (bd) for (const [x, y] of bd.cells) keep.add((y + (bd.oy - bd.y)) * C.W + x + (bd.ox - bd.x)); }
  for (const e of part.exits) for (const [x, y] of e.cells) keep.add((y + (e.oy - e.y)) * C.W + x + (e.ox - e.x));
  // A vacant unit boarded up: its storefront walled over, its door nailed shut. A shop with its grille down: its door a
  // locked roller.
  const frontRoom = part.front ? C.areas.find((a) => a.house === part.k && a.doors.some(([x, y]) => x === part.front.x && y === part.front.y)) : null;
  if (u.state === "boarded" && part.front) {
    const cells = C.floors[f].cells, fs = part.face;
    for (let y = part.y0; y < part.y0 + part.h; y++) for (let x = part.x0; x < part.x0 + part.w; x++) {
      const onFront = fs === "s" ? y === part.y0 + part.h - 1 : fs === "n" ? y === part.y0 : fs === "e" ? x === part.x0 + part.w - 1 : x === part.x0;
      const c = cells[y * C.W + x];
      if (onFront && (c.k === "window" || c.k === "smashed")) { c.k = "wall"; c.board = true; delete c.win; }
    }
    for (const [x, y] of part.front.cells) lockDoor(C, f, x, y, "wood", frontRoom ? frontRoom.id : null);
  } else if (u.shutter && part.front) for (const [x, y] of part.front.cells) lockDoor(C, f, x, y, "roller", frontRoom ? frontRoom.id : null);
  return part;
}

// A placed building's doors kept clear outside (its front, its exits).
function keepDoors(ctx, part, f) {
  const keep = ctx.keep[f], W = ctx.C.W;
  for (const e of [...(part.front ? [part.front] : []), ...part.exits]) for (const [x, y] of e.cells) { keep.add((y + (e.oy - e.y)) * W + x + (e.ox - e.x)); keep.add((y + 2 * (e.oy - e.y)) * W + x + 2 * (e.ox - e.x)); }
}
// Carving: cells of the compound set directly (the concourse, the service corridors, the walkways).
const floorCell = (fl, extra = {}) => ({ k: "open", f: "floor", fl, ...extra });
const wallCell = () => ({ k: "wall", f: "floor" });
function rectArea(C, o) { const a = { id: C.areas.length, f: o.f || 0, type: o.type ?? null, role: o.role, name: o.name, x0: o.x0, y0: o.y0, w: o.w, h: o.h, doors: [], hub: true, locked: null, up: false, entry: false, noLabel: !!o.noLabel, house: null, mall: o.mall || o.role, ...(o.deadW ? { deadW: o.deadW } : {}) }; C.areas.push(a); return a; }

// A stair run in compound cells on floors f0..f1 (#9's: steps along dx, dy; a landing at each end), or a lift (single).
function addRun(C, r, f0, f1) {
  const steps = r.single ? [[r.x, r.y]] : Array.from({ length: r.len }, (_, i) => [r.x + i * r.dx, r.y + i * r.dy]);
  const lands = r.single ? [] : [[r.x - r.dx, r.y - r.dy], [r.x + r.len * r.dx, r.y + r.len * r.dy]];
  const dir = r.single ? undefined : [[1, 0], [-1, 0], [0, 1], [0, -1]].findIndex(([a, b]) => a === r.dx && b === r.dy);
  for (let f = f0; f <= f1; f++) {
    const cells = C.floors[f].cells;
    steps.forEach(([x, y], s) => { const c = cells[y * C.W + x]; Object.assign(c, { k: "stairs", step: s + 1, len: steps.length, ...(dir != null ? { dir } : {}), ...(s === steps.length - 1 ? { top: true } : {}), ...(r.esc ? { esc: true } : {}), ...(r.lift ? { lift: true } : {}) }); });
    for (const [x, y] of lands) Object.assign(cells[y * C.W + x], { k: "open", landing: true });
  }
  const run = { x: r.x, y: r.y, dx: r.dx, dy: r.dy, len: steps.length, f0, f1, ...(r.single ? { single: true } : {}), ...(r.esc ? { esc: true } : {}), ...(r.lift ? { lift: true } : {}), house: null };
  C.runs.push(run);
  C.stairs.push(steps[steps.length - 1].slice());
  return { run, cells: [...steps, ...lands] };
}

// ---------------------------------------------------------------------------------------------------------------------
// The plan: which kind, its size and levels (cheap: no building is made), from the mall's dice.
// ---------------------------------------------------------------------------------------------------------------------
const kindOf = (key) => (key === "stripmall" ? "stripmall" : key === "outlet" ? "outlet" : "regionalmall");
function rowSlots(rng, x0, x1, reserved, lo, hi) {
  // The free spans between the reserved ones, filled with slots of lo–hi cells (a narrow end piece: a utility closet).
  const spans = [], res = reserved.slice().sort((a, b) => a.x0 - b.x0);
  let x = x0;
  for (const r of res) { if (r.x0 > x) spans.push([x, r.x0 - 1]); x = Math.max(x, r.x0 + r.w); }
  if (x <= x1) spans.push([x, x1]);
  const out = [];
  for (const [a, b] of spans) {
    let p = a;
    while (b - p + 1 > 0) {
      const left = b - p + 1;
      let w = left <= hi ? left : Math.min(rng.int(lo, hi), left - lo);
      if (w < lo && left > hi) w = lo;
      out.push({ x0: p, w });
      p += w;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The map.
// ---------------------------------------------------------------------------------------------------------------------
/** The mall's whole map (buildingmaps.js buildingMap for a compound key). */
export function mallMap(state, tileId, option, withVehicle) {
  const kind = kindOf(option.key);
  const rng = new Rng(seedOf(state.seed, "mall", tileId, option.id));
  const ctx = { state, tileId, option, kind, rng, units: [], C: null, keep: [], extra: {} };
  const out = kind === "stripmall" ? stripMall(ctx, withVehicle) : kind === "outlet" ? outletCentre(ctx, withVehicle) : regionalMall(ctx, withVehicle);
  return out;
}
/** How many buildings the mall's map holds (poicont.js poiHouses: the headless search goes through them one at a time). */
export function mallUnits(state, tileId, option) {
  const m = mallMap(state, tileId, option, false);
  return m.plan.houses.length;
}
/** The dead at a mall: the roster × this (buildingmaps.js placeInterior). */
export const mallDead = (map) => MALL.DEAD[(map.plan && map.plan.kind) || "regionalmall"] || 1.5;

// Rooms the dead crowd; the anchors and wings named for the plan's intro.
function finish(ctx, zones, withVehicle, extra = {}) {
  const { C } = ctx;
  for (const a of C.areas) {
    if (a.role === "foodcourt") a.deadW = MALL.DEADW.foodcourt;
    else if (a.role === "screen") a.deadW = MALL.DEADW.screen;
    else if (a.type === "cinema") a.deadW = MALL.DEADW.cinema;
  }
  const vehicle = compoundVehicle(C, zones[0], withVehicle);
  const shops = ctx.units.filter((u) => u.role === "shop"), anchors = ctx.units.filter((u) => u.anchor);
  const storefronts = ctx.units.filter((u) => ["shop", "vacant", "food", "cinema", "arcade"].includes(u.role)).length;
  return compoundResult(C, {
    key: ctx.option.key, id: ctx.option.id, name: ctx.option.name, zones, vehicle, kind: ctx.kind,
    extra: { mall: true, storefronts, shops: shops.length, vacant: ctx.units.filter((u) => u.role === "vacant").length, anchors: anchors.map((u) => ({ name: u.name, kind: u.kind, k: u.part.k })), levels: C.storeys, wings: ctx.wings || [], ...extra },
  });
}

// The ways out: a 3 × 3 zone, its side's name. The first is where the team comes in.
const zone = (x0, y0, side, name) => ({ x0, y0, w: 3, h: 3, side, exit: side, name, vehicle: false });

// Pick an inline unit: a shop of a weighted kind with its franchise, or vacant, or a grille down.
function inlineUnit(ctx, k, w, d, table = MALL.INLINE) {
  const { rng } = ctx;
  if (rng.chance(MALL.VACANT)) { const st = rng.chance(MALL.BOARDED) ? "boarded" : rng.chance(MALL.HALFBUILT / (1 - MALL.BOARDED)) ? "halfbuilt" : "empty"; ctx.vacantNo = (ctx.vacantNo || 0) + 1; return { kind: "vacantunit", state: st, role: "vacant", w, d, inline: true, k, no: ctx.vacantNo }; }
  const kind = pickW(rng, table), fr = franchiseOf(kind, rng);
  return { kind, variant: fr ? fr.id : null, role: "shop", w, d, inline: true, k, shutter: rng.chance(MALL.SHUTTER) };
}

// ---------------------------------------------------------------------------------------------------------------------
// The strip mall.
// ---------------------------------------------------------------------------------------------------------------------
function stripMall(ctx, withVehicle) {
  const { rng } = ctx, S = MALL.STRIP;
  const n = rng.int(S.UNITS[0], S.UNITS[1]), D = rng.int(S.D[0], S.D[1]);
  const L = n >= 8 && rng.chance(S.L), n2 = L ? Math.floor(n / 3) : 0, n1 = n - n2;
  const widths = Array.from({ length: n }, () => rng.int(S.W[0], S.W[1]));
  const anchorKind = rng.chance(0.55) ? "supermarket" : "hardware";
  const padKind = rng.chance(0.5) ? "gasstation" : "restaurant";
  // The anchor and the pad first (their sizes set the map's).
  let k = 0;
  const aU = { kind: anchorKind, variant: anchorKind === "hardware" ? (franchiseOf("hardware", rng) || {}).id || null : null, role: "anchor", anchor: true, k: k++, w: 0, d: 0 };
  const anchorB = buildUnit(ctx, aU);
  const aw = anchorB.m.building.w, ah = anchorB.m.building.h;
  const pU = padKind === "gasstation" ? { kind: "gasstation", variant: (franchiseOf("gas", rng) || {}).id || null, frKind: "gas", role: "pad", k: k++ } : { kind: "restaurant", variant: (FRANCHISES.restaurant.filter((f) => f.plan && f.plan.back === "fastfood")[rng.int(0, 2)] || {}).id || null, role: "pad", k: k++ };
  const legW = L ? D + S.WALK + 2 : 0;
  const rowW = widths.slice(0, n1).reduce((a, b) => a + b, 0);
  const W = clamp(S.XM * 2 + legW + rowW + aw, 120, MALL.CAP);
  const yF = Math.max(S.ALLEY + D, ah + 2) - 1; // the storefronts' line (the anchor's too)
  const leg2H = L ? widths.slice(n1).reduce((a, b) => a + b, 0) : 0;
  const H = clamp(Math.max(yF + 1 + S.WALK + S.LOT + S.ROAD, yF + S.WALK + 4 + leg2H + 14), 90, MALL.CAP);
  const roadY = H - S.ROAD;
  const C = (ctx.C = compoundGrid(W, H, 1, (x, y) => (y >= roadY + 1 && y < H - 1 ? "road" : y === roadY || y === H - 1 ? "gravel" : y <= yF ? "gravel" : "road")));
  ctx.keep = [new Set()];
  // The main row: west to east (after the L's leg), the anchor at the east end.
  let x = S.XM + legW;
  for (let i = 0; i < n1; i++) { const u = inlineUnit(ctx, k++, widths[i], D); putUnit(ctx, u, x, yF - D + 1, "s", 0, ["w", "e"]); x += widths[i]; }
  const anchorPart = placeBuilding(C, anchorB.m, { x0: x, y0: yF - ah + 1, face: "s", k: C.parts.length, name: anchorB.name, key: anchorKind, solid: ["w"], keepRing: false, tag: { part: { role: "anchor", anchor: true, kind: anchorKind } } });
  anchorPart.role = "anchor"; anchorPart.anchor = true;
  ctx.units.push({ ...aU, part: anchorPart, name: anchorB.name });
  keepDoors(ctx, anchorPart, 0);
  // The L's leg: units facing east at the west end, their backs to the west alley.
  if (L) {
    let y = yF + S.WALK + 2;
    for (let i = n1; i < n; i++) { const u = inlineUnit(ctx, k++, widths[i], D); putUnit(ctx, u, S.XM, y, "e", 0, ["n", "s"]); y += widths[i]; }
    for (let yy = yF + S.WALK + 2; yy < y; yy++) for (let xx = S.XM + D; xx < S.XM + D + S.WALK; xx++) Object.assign(C.cells[yy * W + xx], { f: "floor", fl: "conc", canopy: true });
  }
  // The covered walk along the storefronts.
  for (let yy = yF + 1; yy <= yF + S.WALK; yy++) for (let xx = S.XM; xx < x + aw; xx++) Object.assign(C.cells[yy * W + xx], { f: "floor", fl: "conc", canopy: true });
  const walk = rectArea(C, { role: "walk", name: "Covered walk", x0: S.XM, y0: yF, w: x + aw - S.XM, h: S.WALK + 2, mall: "walk" });
  walk.type = null;
  // The pad on the lot by the road, its pumps in front.
  const pad = buildUnit(ctx, pU);
  const pw = pad.m.building.w, ph = pad.m.building.h;
  const px = clamp(W - S.XM - pw - 4 - Math.floor(rng.next() * 10), S.XM + legW + 2, W - pw - 2), py = roadY - ph - (padKind === "gasstation" ? 7 : 3);
  const padPart = placeBuilding(C, pad.m, { x0: px, y0: py, face: "s", k: C.parts.length, name: pad.name, key: pU.kind, tag: { part: { role: "pad", kind: pU.kind } } });
  padPart.role = "pad";
  ctx.units.push({ ...pU, part: padPart, name: pad.name });
  keepDoors(ctx, padPart, 0);
  // The ways out: the road at both ends of the lot, the alley behind, the side.
  const zones = [zone(Math.floor(W / 2) - 1, H - 3, "south", "The road (front)"), zone(0, roadY + 1, "west", "The road west"), zone(W - 3, roadY + 1, "east", "The road east"), zone(Math.floor(W / 3), 0, "north", "Service alley"), zone(W - 3, Math.max(1, Math.floor(yF / 2)), "east", "Behind the anchor")];
  const G = guard(C, zones[0].x0 + 1, zones[0].y0 + 1, { free: freeOf(ctx, 0, zones) });
  // The pumps (a gas station): an outdoor area of their own.
  if (padKind === "gasstation") {
    const a = { id: C.areas.length, type: "pumps", name: "Fuel pumps", outdoor: true, f: 0, x0: px, y0: py + ph, w: pw, h: 6, house: null };
    let placed = 0;
    for (let xx = px + 1; xx < px + pw - 1 && placed < 3; xx += 4) if (G.block(xx, py + ph + 3, "pump")) { C.containers.push({ id: C.cid++, x: xx, y: py + ph + 3, f: 0, area: a.id, kind: "pump", searched: false, label: "Fuel pumps: fuel pump" }); placed++; }
    if (placed) C.areas.push(a);
  }
  // The lot: bays between the walk and the road.
  const lotX0 = S.XM + legW + 1, lotY0 = yF + S.WALK + 2;
  parkingLot(C, G, { x0: lotX0, y0: lotY0, w: Math.max(10, (padKind ? px - 3 : W - S.XM) - lotX0), h: roadY - 1 - lotY0 }, rng, { name: "Parking lot" });
  // The alley: dumpsters and the odd crate.
  for (let t = 0, put = 0; t < 40 && put < 5; t++) { const xx = rng.int(S.XM, x + aw - 1), yy = rng.int(1, Math.max(1, yF - D - 1)); if (G.block(xx, yy, rng.chance(0.6) ? "dumpster" : "crate")) put++; }
  dressWalk(ctx, G, walk, 0, rng);
  ctx.wings = [L ? "the L's west leg" : null, "the covered walk"].filter(Boolean);
  return finish(ctx, zones, withVehicle);
}

// May dressing go on (x, y) of floor f: open floor, not by a door, not in a zone's ring.
function freeOf(ctx, f, zones) {
  const C = ctx.C, keep = ctx.keep[f], cells = C.floors[f].cells;
  return (x, y) => {
    if (x < 1 || y < 1 || x >= C.W - 1 || y >= C.H - 1) return false;
    const i = y * C.W + x, c = cells[i];
    if (!c || c.k !== "open" || c.landing || keep.has(i)) return false;
    if (f === 0 && C.keep[i]) return false;
    return !(zones || []).some((z) => x >= z.x0 - 1 && x <= z.x0 + z.w && y >= z.y0 - 1 && y <= z.y0 + z.h);
  };
}

// A walk's or a concourse's dressing: benches, planters, a bin now and then (strip mall: along the kerb side).
function dressWalk(ctx, G, a, f, rng) {
  const xs = [];
  for (let x = a.x0 + 3; x < a.x0 + a.w - 3; x += rng.int(6, 10)) xs.push(x);
  for (const x of xs) G.block(x, a.y0 + a.h - 2, rng.chance(0.5) ? "mallbench" : "planter");
}

// ---------------------------------------------------------------------------------------------------------------------
// The enclosed regional mall.
// ---------------------------------------------------------------------------------------------------------------------
function regionalMall(ctx, withVehicle) {
  const { rng } = ctx, R = MALL.REGIONAL, cap = MALL.CAP;
  const levels = rng.weighted((cap >= 500 ? R.LEVELS500 : R.LEVELS), ([, w]) => w)[0];
  const nA = rng.int(R.ANCHORS[0], R.ANCHORS[1]);
  const D = rng.int(R.D[0], R.D[1]), CW = rng.int(R.CW[0], R.CW[1]), WK = R.WALK;
  let k = 0;
  // The anchors: a department store at each end (facing the concourse), one at the centre court north and south.
  const anchorU = (i) => {
    const sup = i >= 2 && rng.chance(R.SUPER);
    return { kind: sup ? "supermarket" : "deptstore", role: "anchor", anchor: true, k: k++, keepStoreys: true, maxStoreys: levels };
  };
  const anchors = Array.from({ length: nA }, (_, i) => { const u = anchorU(i); return { u, b: buildUnit(ctx, u) }; });
  const [aW, aE, aN, aS] = anchors;
  const depthOf = (a) => (a ? a.b.m.building.h : 0), spanOf = (a) => (a ? a.b.m.building.w : 0);
  const W = cap >= 500 ? rng.int(400, cap) : cap;
  const cx0 = R.XM + depthOf(aW), cx1 = W - 1 - R.XM - depthOf(aE);
  const Hb = 2 * (3 + D) + CW; // the service band, a row, the concourse, a row, the band
  const north = Math.max(R.LOT, depthOf(aN) - D - 3 + 14), south = Math.max(R.LOT, depthOf(aS) - D - 3 + 14);
  const H = clamp(north + Hb + south, 120, cap);
  const yb0 = Math.floor((H - Hb) * (north / (north + south))); // the north band's outer wall
  const yN0 = yb0 + 3, yc0 = yN0 + D, yc1 = yc0 + CW - 1, yS0 = yc1 + 1, yS1 = yS0 + D - 1, ybS = yS1 + 3;
  const C = (ctx.C = compoundGrid(W, H, levels, (x, y) => (y < 3 || y >= H - 3 || x < 3 || x >= W - 3 ? "road" : "gravel")));
  ctx.keep = Array.from({ length: levels }, () => new Set());
  const cxm = Math.floor((cx0 + cx1) / 2), L = cx1 - cx0 + 1;
  // ---- the anchors placed ----
  const placeAnchor = (a, x0, y0, face) => {
    const part = placeBuilding(C, a.b.m, { x0, y0, face, k: C.parts.length, name: a.b.name, key: a.u.kind, keepRing: false, tag: { part: { role: "anchor", anchor: true, kind: a.u.kind } } });
    part.role = "anchor"; part.anchor = true;
    ctx.units.push({ ...a.u, part, name: a.b.name });
    keepDoors(ctx, part, 0);
    return part;
  };
  const ymid = Math.floor((yc0 + yc1) / 2);
  const pW = placeAnchor(aW, R.XM, clamp(ymid - Math.floor(spanOf(aW) / 2), 4, H - spanOf(aW) - 4), "e");
  const pE = placeAnchor(aE, cx1 + 1, clamp(ymid - Math.floor(spanOf(aE) / 2), 4, H - spanOf(aE) - 4), "w");
  const pN = aN ? placeAnchor(aN, clamp(cxm - Math.floor(spanOf(aN) / 2), cx0 + 20, cx1 - 20 - spanOf(aN)), yc0 - depthOf(aN), "s") : null;
  const pS = aS ? placeAnchor(aS, clamp(cxm - Math.floor(spanOf(aS) / 2), cx0 + 20, cx1 - 20 - spanOf(aS)), yS0, "n") : null;
  // ---- the spans reserved in each row, by level ----
  const top = levels - 1;
  const foodW = rng.int(MALL.FOOD.W[0], MALL.FOOD.W[1]), cineW = rng.int(MALL.CINEMA.W[0], MALL.CINEMA.W[1]);
  const quarter = (q) => cx0 + Math.floor(L * q);
  const foodX = clamp((pS ? quarter(0.27) : cxm) - Math.floor(foodW / 2), cx0 + 2, cx1 - foodW - 2);
  const cineX = clamp((pN ? quarter(0.73) : quarter(0.3)) - Math.floor(cineW / 2), cx0 + 2, cx1 - cineW - 2);
  const vestW = 6, vests = [quarter(0.38), quarter(0.62)].map((x) => x - 3);
  const res = (row, f) => {
    const out = [];
    const anchorP = row === "n" ? pN : pS;
    if (anchorP) out.push({ x0: anchorP.x0, w: anchorP.w, what: "anchor" });
    if (f === top && row === "s") out.push({ x0: foodX, w: foodW, what: "food" });
    if (f === top && row === "n") out.push({ x0: cineX, w: cineW, what: "cinema" });
    if (f === 0) for (const vx of vests) if (!out.some((r) => vx + vestW > r.x0 - 2 && vx < r.x0 + r.w + 2)) out.push({ x0: vx, w: vestW, what: "vestibule" });
    return out.filter((r) => r.x0 >= cx0 && r.x0 + r.w - 1 <= cx1);
  };
  // ---- carve the concourse, the walkways and the service bands, level by level ----
  const conc = [], bands = [];
  for (let f = 0; f < levels; f++) {
    const cells = C.floors[f].cells;
    for (let y = yc0; y <= yc1; y++) for (let x = cx0; x <= cx1; x++) {
      const walkRow = y < yc0 + WK || y > yc1 - WK;
      if (f === 0 || walkRow) cells[y * W + x] = floorCell(f ? "tile" : "checker", f ? {} : { atrium: !walkRow || undefined });
    }
    conc.push(rectArea(C, { f, role: "concourse", name: f ? `Upper concourse, level ${f + 1}` : "Concourse", type: "store", x0: cx0 - 1, y0: yc0 - 1, w: L + 2, h: CW + 2, mall: "concourse" }));
    // The service bands behind each row (an outer wall, two cells of corridor), cut by an anchor or a vestibule.
    for (const [row, yWall, yA, yB] of [["n", yb0, yb0 + 1, yb0 + 2], ["s", ybS, yS1 + 1, yS1 + 2]]) {
      const cuts = res(row, f).filter((r) => r.what === "anchor" || r.what === "vestibule");
      const segs = [];
      let a = cx0;
      for (const r of cuts.sort((p, q) => p.x0 - q.x0)) { if (r.x0 - 1 > a) segs.push([a, r.x0 - 1]); a = r.x0 + r.w; }
      if (a < cx1) segs.push([a, cx1]);
      for (const [s0, s1] of segs) {
        for (let x = s0 - 1; x <= s1 + 1; x++) if (!/door/.test(cells[yWall * W + x].k)) cells[yWall * W + x] = wallCell();
        for (let x = s0; x <= s1; x++) { cells[yA * W + x] = floorCell("conc"); cells[yB * W + x] = floorCell("conc"); }
        for (const y of [yA, yB]) { if (!/door/.test(cells[y * W + s0 - 1].k)) cells[y * W + s0 - 1] = wallCell(); if (!/door/.test(cells[y * W + s1 + 1].k)) cells[y * W + s1 + 1] = wallCell(); }
        const band = rectArea(C, { f, role: "corridor", name: `Service corridor ${row === "n" ? "north" : "south"}${f ? `, level ${f + 1}` : ""}`, x0: s0 - 1, y0: Math.min(yWall, yA) - (row === "s" ? 1 : 0), w: s1 - s0 + 3, h: 4, mall: "service", noLabel: false });
        bands.push({ row, f, s0, s1, yWall, yA, yB, band });
      }
    }
  }
  // ---- the units, row by row, level by level ----
  const placedSpecial = {};
  for (let f = 0; f < levels; f++) for (const row of ["n", "s"]) {
    const y0 = row === "n" ? yN0 : yS0, face = row === "n" ? "s" : "n";
    const rs = res(row, f);
    const slots = rowSlots(rng, cx0, cx1, rs, R.SLOT[0], R.SLOT[1]);
    // The specials among the slots: the services and the arcade on the ground floor, the restrooms on every level.
    const pickSlot = (want, pref) => { const c = slots.filter((s) => !s.use && s.w >= 12).sort((a, b) => Math.abs(a.x0 - pref) - Math.abs(b.x0 - pref))[0]; if (c) c.use = want; };
    if (row === "s") pickSlot("mallrestrooms", quarter(0.15 + 0.1 * f));
    if (f === 0 && row === "n") { pickSlot("mallservices", quarter(0.12)); pickSlot("arcade", quarter(0.85)); }
    for (const s of slots) {
      if (s.w < 6) { for (let y = y0; y < y0 + D; y++) for (let x = s.x0; x < s.x0 + s.w; x++) C.floors[f].cells[y * W + x] = wallCell(); continue; } // a sliver: solid wall (a duct, a pillar)
      if (s.w < 10) { putUnit(ctx, { kind: "mallrestrooms", role: "service", name: "Utility room", w: s.w, d: D, inline: true, k: k++ }, s.x0, y0, face, f, ["w", "e"]); continue; }
      const u = s.use ? { kind: s.use, role: s.use === "arcade" ? "arcade" : "service", w: s.w, d: D, inline: true, k: k++ } : inlineUnit(ctx, k++, s.w, D);
      putUnit(ctx, u, s.x0, y0, face, f, ["w", "e"]);
    }
    for (const r of rs) {
      if (r.what === "cinema") { putUnit(ctx, { kind: "cinema", role: "cinema", w: r.w, d: D, inline: true, k: k++ }, r.x0, y0, face, f, ["w", "e"]); placedSpecial.cinema = true; }
      if (r.what === "food") { foodCourt(ctx, r, f, y0, D, k); k += 20; placedSpecial.food = true; }
      if (r.what === "vestibule") vestibule(ctx, r, row, y0, D, row === "n" ? yb0 : ybS);
    }
  }
  // ---- the levels joined: escalators up bridges across the atrium, the lift at the centre court, the service stairs ----
  if (levels > 1) {
    const yr = ymid;
    const escX = [quarter(0.2), cxm, quarter(0.8)].map((x) => clamp(x, cx0 + 8, cx1 - 12));
    escX.forEach((ex, i) => {
      const bw = i === 1 ? 14 : 9, bx0 = ex - 4;
      for (let f = 1; f < levels; f++) for (let y = yc0 + WK; y <= yc1 - WK; y++) for (let x = bx0; x < bx0 + bw; x++) C.floors[f].cells[y * W + x] = floorCell("tile", { bridge: true });
      const { cells: rc } = addRun(C, { x: ex - 2, y: yr, dx: 1, dy: 0, len: 4, esc: true }, 0, levels - 1);
      for (const [x, y] of rc) for (let f = 0; f < levels; f++) ctx.keep[f].add(y * W + x);
      // The stopped escalator beside it (the moving stair's look: a fixed piece).
      for (let f = 0; f < levels; f++) for (let x = ex - 2; x <= ex + 1; x++) { const c = C.floors[f].cells[(yr - 1) * W + x]; if (c.k === "open") Object.assign(c, { k: "escalator", fc: "e", pc: 900000 + i * 10 + f }); }
      if (i === 1) { // the lift: a car of one cell between the levels, its walls round it, its door toward the landing
        const lx = ex + 5;
        for (let f = 0; f < levels; f++) for (let y = yr - 1; y <= yr + 1; y++) for (let x = lx - 1; x <= lx + 1; x++) C.floors[f].cells[y * W + x] = x === lx - 1 && y === yr ? { k: "idoor", f: "floor", fl: "steel", dk: "glass", hp: DOOR_KINDS.glass.hp, mhp: DOOR_KINDS.glass.hp } : x === lx && y === yr ? floorCell("steel") : wallCell();
        addRun(C, { x: lx, y: yr, dx: 0, dy: 0, len: 1, single: true, lift: true }, 0, levels - 1);
        for (let f = 0; f < levels; f++) { ctx.keep[f].add(yr * W + lx - 2); rectArea(C, { f, role: "lift", name: "Lift", x0: lx - 1, y0: yr - 1, w: 3, h: 3, mall: "lift", noLabel: false }); }
      }
    });
    // Service stairs at each end of every band that runs the full height.
    for (const bd of bands.filter((b) => b.f === 0)) {
      const up = bands.filter((b) => b.row === bd.row && b.f > 0 && b.s0 <= bd.s0 + 1 && b.s1 >= bd.s0 + 6);
      if (up.length < levels - 1 || bd.s1 - bd.s0 < 10) continue;
      const { cells: rc } = addRun(C, { x: bd.s0 + 1, y: bd.row === "n" ? bd.yA : bd.yB, dx: 1, dy: 0, len: 3 }, 0, levels - 1);
      for (const [x, y] of rc) for (let f = 0; f < levels; f++) ctx.keep[f].add(y * W + x);
    }
  }
  // ---- the loading docks: a roller door in each ground-floor band's outer wall ----
  const zones = [zone(cxm - 1, H - 3, "south", "South lot (front)"), zone(quarter(0.25), H - 3, "south", "South lot, west"), zone(quarter(0.75), 0, "north", "North lot, east"), zone(quarter(0.25), 0, "north", "North lot, west"), zone(0, ymid - 1, "west", "West lot"), zone(W - 3, ymid - 1, "east", "East lot")];
  for (const bd of bands.filter((b) => b.f === 0 && b.s1 - b.s0 >= 6)) {
    const x = rng.int(bd.s0 + 2, bd.s1 - 3), cells = C.cells, out = bd.row === "n" ? -1 : 1;
    for (const xx of [x, x + 1]) { cells[bd.yWall * W + xx] = { k: "idoor", f: "floor", roll: true, dk: "roller", hp: DOOR_KINDS.roller.hp, mhp: DOOR_KINDS.roller.hp }; ctx.keep[0].add((bd.yWall + out) * W + xx); ctx.keep[0].add((bd.yWall - out) * W + xx); C.keep[(bd.yWall + out) * W + xx] = 1; C.keep[(bd.yWall + 2 * out) * W + xx] = 1; }
    if (rng.chance(MALL.DOCK_LOCK)) for (const xx of [x, x + 1]) lockDoor(C, 0, xx, bd.yWall, "roller", bd.band.id);
    bd.band.doors.push([x, bd.yWall], [x + 1, bd.yWall]);
  }
  // ---- the outside: the garage on the north lot, the surface lots ----
  const G = guard(C, zones[0].x0 + 1, zones[0].y0 + 1, { free: freeOf(ctx, 0, zones) });
  const lotsN = [], lotsS = [];
  const nTop = 6, nBot = yb0 - 7, sTop = ybS + 7, sBot = H - 6;
  const avoid = [pW, pE, pN, pS].filter(Boolean);
  const clear = (r) => !avoid.some((p) => r.x0 < p.x0 + p.w + 3 && p.x0 - 3 < r.x0 + r.w && r.y0 < p.y0 + p.h + 3 && p.y0 - 3 < r.y0 + r.h);
  let garage = null;
  if (rng.chance(R.GARAGE) && nBot - nTop >= 34) {
    const gu = { kind: "parkgarage", role: "garage", k: k++, keepStoreys: true, maxStoreys: levels, levels: clamp(levels, 2, 3) };
    const gb = buildUnit(ctx, gu);
    const gw = gb.m.building.w, gh = gb.m.building.h;
    const gx = clamp(cx0 + 4, 4, W - gw - 4), gy = clamp(nBot - gh - 2, nTop, nBot - gh);
    if (clear({ x0: gx, y0: gy, w: gw, h: gh }) && gb.m.storeys <= levels) {
      garage = placeBuilding(C, gb.m, { x0: gx, y0: gy, face: "s", k: C.parts.length, name: gb.name, key: "parkgarage", tag: { part: { role: "garage", kind: "parkgarage" } } });
      garage.role = "garage";
      ctx.units.push({ ...gu, part: garage, name: gb.name });
      keepDoors(ctx, garage, 0);
    }
  }
  const lotRects = [];
  const cut = (y0, y1, side) => { // the strip from y0 to y1 cut round the anchors and the garage
    let xs = 4;
    const blocks = [...avoid, ...(garage ? [garage] : [])].filter((p) => p.y0 <= y1 + 3 && p.y0 + p.h >= y0 - 3).sort((a, b) => a.x0 - b.x0);
    for (const p of blocks) { if (p.x0 - 4 - xs >= 20) lotRects.push({ x0: xs, y0, w: p.x0 - 4 - xs, h: y1 - y0, side }); xs = Math.max(xs, p.x0 + p.w + 4); }
    if (W - 4 - xs >= 20) lotRects.push({ x0: xs, y0, w: W - 4 - xs, h: y1 - y0, side });
  };
  if (nBot - nTop >= 22) cut(nTop, nBot, "north");
  if (sBot - sTop >= 22) cut(sTop, sBot, "south");
  for (const r of lotRects) (r.side === "north" ? lotsN : lotsS).push(parkingLot(C, G, r, rng, { name: `${r.side === "north" ? "North" : "South"} lot` }));
  // ---- the concourse dressed: kiosk carts, benches, planters, the fountain and the carousel, the directory ----
  for (let f = 0; f < levels; f++) dressConcourse(ctx, f, cx0, cx1, yc0, yc1, WK, zones, rng);
  ctx.wings = ["the west wing", "the east wing", ...(pN ? ["the centre court (north)"] : []), ...(pS ? ["the centre court (south)"] : [])];
  ctx.extra = { concourse: conc.map((a) => a.id), foodCourt: !!placedSpecial.food, cinema: !!placedSpecial.cinema, garage: !!garage };
  return finish(ctx, zones, withVehicle, ctx.extra);
}

// An entrance vestibule across a row and its band: glass doors on the outside, open to the concourse.
function vestibule(ctx, r, row, y0, D, yWall) {
  const { C } = ctx, W = C.W, cells = C.cells;
  const ya = row === "n" ? yWall : y0, yb = row === "n" ? y0 + D - 1 : yWall;
  for (let y = ya; y <= yb; y++) for (let x = r.x0; x < r.x0 + r.w; x++) {
    const edge = x === r.x0 || x === r.x0 + r.w - 1;
    cells[y * W + x] = edge ? wallCell() : floorCell("tile");
  }
  const yo = row === "n" ? ya : yb, out = row === "n" ? -1 : 1;
  for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) { cells[yo * W + x] = { k: "idoor", f: "floor", dk: "glass", hp: DOOR_KINDS.glass.hp, mhp: DOOR_KINDS.glass.hp }; C.keep[(yo + out) * W + x] = 1; C.keep[(yo + 2 * out) * W + x] = 1; ctx.keep[0].add((yo + out) * W + x); }
  const a = rectArea(C, { role: "foyer", name: "Mall entrance", x0: r.x0, y0: ya, w: r.w, h: yb - ya + 1, mall: "vestibule" });
  a.entry = true;
  for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) a.doors.push([x, yo]);
}

// The food court: the seating area of tables and chairs open to the concourse, a row of counters (restaurant
// franchises: their kitchens and walk-ins behind) along its back, their service doors on the shared corridor.
function foodCourt(ctx, r, f, y0, D, k0) {
  const { C, rng } = ctx, W = C.W, cells = C.floors[f].cells, FD = MALL.FOOD.D;
  const sy0 = y0, sy1 = y0 + D - FD - 1; // the seating rows (the row's front part), the counters behind
  for (let y = sy0; y <= sy1; y++) for (let x = r.x0; x < r.x0 + r.w; x++) cells[y * W + x] = floorCell("checker");
  for (let y = sy0; y <= sy1 + 1; y++) { cells[y * W + r.x0] = wallCell(); cells[y * W + r.x0 + r.w - 1] = wallCell(); }
  const seat = rectArea(C, { f, role: "foodcourt", name: "Food court", type: "kitchen", x0: r.x0, y0: sy0 - 1, w: r.w, h: sy1 - sy0 + 3, mall: "foodcourt", deadW: MALL.DEADW.foodcourt });
  seat.type = null;
  // The counters: restaurant franchises, a slot each, behind the seating.
  const n = clamp(Math.floor((r.w - 2) / 8), MALL.FOOD.COUNTERS[0], MALL.FOOD.COUNTERS[1]);
  const cw = Math.floor(r.w / n);
  const fast = FRANCHISES.restaurant.filter((f) => f.plan && ["fastfood", "takeout", "cafe"].includes(f.plan.back));
  let x = r.x0; // the counters' walls shared with the seating's sides
  for (let i = 0; i < n; i++) {
    const w = i === n - 1 ? r.x0 + r.w - x : cw;
    const fr = fast.length ? fast[(i + rng.int(0, fast.length - 1)) % fast.length] : null;
    putUnit(ctx, { kind: "restaurant", variant: fr ? fr.id : null, role: "food", w, d: FD, inline: true, k: k0 + i }, x, sy1 + 1, "n", f, ["w", "e"]);
    x += w;
  }
  // Tables with chairs (fixed seating: not searched).
  const G = guard(C, r.x0 + 1, sy0, { f, free: freeOf(ctx, f, []) });
  for (let y = sy0 + 2; y <= sy1 - 2; y += 3) for (let xx = r.x0 + 3; xx < r.x0 + r.w - 3; xx += 4) {
    if (!G.block(xx, y, "table")) continue;
    G.block(xx - 1, y, "chair", { fc: "e" }); G.block(xx + 1, y, "chair", { fc: "w" });
  }
  return seat;
}

// The concourse's dressing on floor f: kiosk carts (searched: the concourse's store loot), benches and planters in
// lines down its middle, the fountain and the carousel at the centre court, the directory signs by the anchors.
function dressConcourse(ctx, f, cx0, cx1, yc0, yc1, WK, zones, rng) {
  const { C } = ctx, W = C.W;
  const conc = C.areas.find((a) => a.role === "concourse" && a.f === f);
  // An upper floor's walk starts from a run's landing (every walkway joins one).
  const start = f === 0 ? [zones[0].x0 + 1, zones[0].y0 + 1] : (() => { for (const r of C.runs) if (r.f0 <= f && r.f1 >= f && !r.single) return [r.x - r.dx, r.y - r.dy]; return [cx0 + 2, yc0 + 1]; })();
  const G = guard(C, start[0], start[1], { f, free: freeOf(ctx, f, f === 0 ? zones : []) });
  const cxm = Math.floor((cx0 + cx1) / 2);
  const rowsY = f === 0 ? [Math.floor((yc0 + yc1) / 2) - 2, Math.floor((yc0 + yc1) / 2) + 2] : [yc0 + Math.floor(WK / 2), yc1 - Math.floor(WK / 2)];
  let kiosks = 0;
  for (const y of rowsY) for (let x = cx0 + 6; x < cx1 - 6; x += rng.int(7, 12)) {
    if (Math.abs(x - cxm) < 9) continue; // the centre court kept for the fountain
    const what = rng.next();
    if (what < 0.32) { if (place2(G, x, y, "kiosk", "e")) { C.containers.push({ id: C.cid++, x, y, w: 2, h: 1, f, area: conc.id, kind: "kiosk", searched: false, label: `${conc.name}: kiosk cart` }); kiosks++; } }
    else if (what < 0.62) place2(G, x, y, "mallbench", rng.chance(0.5) ? "n" : "s");
    else if (what < 0.9) place2(G, x, y, "planter", "s", 2);
    else G.block(x, y, "plant");
  }
  if (f === 0) {
    const y = Math.floor((yc0 + yc1) / 2);
    place2(G, cxm - 6, y - 1, "fountain", "s", 2);
    place2(G, cxm + 5, y + 2, "carousel", "s", 2);
    for (const x of [cx0 + 2, cx1 - 3]) G.block(x, yc0 + 1, "directory", { fc: "s" });
  } else G.block(cx0 + 2, yc0 + 1, "directory", { fc: "s" });
  return kiosks;
}
// A piece of 2 cells along x (or 2 × 2: n = 2), all or nothing; c.pc shared, c.fc its facing.
let pcNo = 800000;
function place2(G, x, y, k, fc, n = 1) {
  const cells = n === 2 ? [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]] : [[x, y], [x + 1, y]];
  const pc = ++pcNo, done = [];
  for (const [cx, cy] of cells) { if (!G.block(cx, cy, k, { fc, pc })) { for (const [ux, uy] of done) G.unblock(ux, uy); return false; } done.push([cx, cy]); }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// The outlet centre.
// ---------------------------------------------------------------------------------------------------------------------
function outletCentre(ctx, withVehicle) {
  const { rng } = ctx, O = MALL.OUTLET;
  const n = rng.int(O.UNITS[0], O.UNITS[1]);
  const streets = n > 18 ? 2 : 1;
  let k = 0;
  // Each building at its own size (an outlet store is a stand-alone shop), its depth the row's.
  const D = rng.int(O.D[0], O.D[1]);
  const units = Array.from({ length: n }, () => { const kind = pickW(rng, MALL.OUTLETS), fr = franchiseOf(kind, rng); return { kind, variant: fr ? fr.id : null, role: "shop", d: D, inline: true, k: k++ }; });
  const builds = units.map((u) => ({ u, b: buildUnit(ctx, u) }));
  const rows = streets * 2, perRow = Math.ceil(n / rows);
  const gaps = builds.map(() => rng.int(O.GAP[0], O.GAP[1]));
  const rowOf = (i) => Math.floor(i / perRow);
  const rowW = (r) => builds.reduce((a, x, i) => a + (rowOf(i) === r ? x.b.m.building.w + gaps[i] : 0), 0);
  const plaza = rng.int(24, 32);
  const W = clamp(Math.max(...Array.from({ length: rows }, (_, r) => rowW(r))) + plaza + 2 * O.LOT, 160, MALL.CAP);
  const blockH = 2 * (D + O.LANE) + O.STREET; // a lane, a row, the street, a row, a lane
  const H = clamp(O.LOT + streets * blockH + 56, 120, MALL.CAP); // the north lot, the streets, the south lot, the pads, the road
  const C = (ctx.C = compoundGrid(W, H, 1, (x, y) => (y >= H - 5 ? "road" : "gravel")));
  ctx.keep = [new Set()];
  const plazaX = Math.floor(W / 2) - Math.floor(plaza / 2);
  const parts = [];
  for (let st = 0; st < streets; st++) {
    const yTop = O.LOT + st * blockH, yStreet = yTop + O.LANE + D;
    for (let y = yStreet; y < yStreet + O.STREET; y++) for (let x = O.LOT - 6; x < W - O.LOT + 6; x++) Object.assign(C.cells[y * W + x], { f: "floor", fl: "tile" });
    for (const side of [0, 1]) {
      const r = st * 2 + side, list = builds.map((x, i) => ({ ...x, i })).filter((x) => rowOf(x.i) === r);
      let x = O.LOT;
      for (const it of list) {
        const bw = it.b.m.building.w;
        if (x < plazaX + plaza && x + bw > plazaX) x = plazaX + plaza; // the plaza kept open
        if (x + bw > W - 4) break;
        const face = side === 0 ? "s" : "n", y0 = side === 0 ? yStreet - D : yStreet + O.STREET;
        const part = placeBuilding(C, it.b.m, { x0: x, y0, face, k: C.parts.length, name: it.b.name, key: it.u.kind, tag: { part: { role: "shop", kind: it.u.kind, variant: it.u.variant } } });
        part.role = "shop";
        ctx.units.push({ ...it.u, part, name: it.b.name });
        parts.push({ part, row: r });
        backDoorOf(C, part, 0);
        if (part.front) for (const [fx, fy] of part.front.cells) ctx.keep[0].add((fy + (part.front.oy - part.front.y)) * W + fx + (part.front.ox - part.front.x));
        for (const e of part.exits) for (const [ex, ey] of e.cells) ctx.keep[0].add((ey + (e.oy - e.y)) * W + ex + (e.ox - e.x));
        x += bw + gaps[it.i];
      }
    }
  }
  // Covered walkways between neighbours in a row, here and there.
  let walkways = 0;
  for (let i = 0; i + 1 < parts.length; i++) {
    const a = parts[i], b = parts[i + 1];
    if (a.row !== b.row || b.part.x0 - (a.part.x0 + a.part.w) > 6 || !rng.chance(O.WALKWAY)) continue;
    if (link(C, a.part, b.part, { kind: "walkway", width: 2, name: `Covered walkway (${a.part.name} – ${b.part.name})` })) walkways++;
  }
  // The plaza.
  const y0p = O.LOT + O.LANE + D, plazaA = rectArea(C, { role: "plaza", name: "Plaza", x0: plazaX, y0: y0p - 4, w: plaza, h: O.STREET + 8, mall: "plaza" });
  plazaA.type = null;
  for (let y = plazaA.y0; y < plazaA.y0 + plazaA.h; y++) for (let x = plazaX; x < plazaX + plaza; x++) Object.assign(C.cells[y * W + x], { f: "floor", fl: "tile" });
  const zones = [zone(Math.floor(W / 2) - 1, H - 3, "south", "The road (front)"), zone(2, H - 3, "south", "South lot, west"), zone(W - 5, H - 3, "south", "South lot, east"), zone(Math.floor(W / 2) - 1, 0, "north", "North lot"), zone(0, Math.floor(H / 2), "west", "West side"), zone(W - 3, Math.floor(H / 2), "east", "East side")];
  const G = guard(C, zones[0].x0 + 1, zones[0].y0 + 1, { free: freeOf(ctx, 0, zones) });
  place2(G, Math.floor(W / 2) - 1, y0p + Math.floor(O.STREET / 2) - 1, "fountain", "s", 2);
  for (let x = plazaX + 3; x < plazaX + plaza - 3; x += 5) { place2(G, x, y0p - 2, "mallbench", "s"); place2(G, x, y0p + O.STREET + 1, "mallbench", "n"); }
  // Food pads by the road.
  const pads = rng.int(O.PADS[0], O.PADS[1]);
  for (let i = 0; i < pads; i++) {
    const fr = FRANCHISES.restaurant[rng.int(0, FRANCHISES.restaurant.length - 1)];
    const u = { kind: "restaurant", variant: fr.id, role: "pad", k: k++ };
    const b = buildUnit(ctx, u);
    const bw = b.m.building.w, bh = b.m.building.h, x = 8 + i * Math.floor((W - 16) / Math.max(1, pads)), y = H - 6 - bh - 2;
    if (y < streets * blockH + O.LOT) continue;
    const part = placeBuilding(C, b.m, { x0: x, y0: y, face: "s", k: C.parts.length, name: b.name, key: "restaurant", tag: { part: { role: "pad", kind: "restaurant" } } });
    part.role = "pad";
    ctx.units.push({ ...u, part, name: b.name });
  }
  // Lots north and south.
  parkingLot(C, G, { x0: 4, y0: 4, w: W - 8, h: O.LOT - 8 }, rng, { name: "North lot" });
  const sY = streets * blockH + O.LOT + 2;
  parkingLot(C, G, { x0: 4, y0: sY, w: W - 8, h: Math.max(10, H - 5 - 22 - sY) }, rng, { name: "South lot" });
  // Benches and planters along the streets.
  for (let st = 0; st < streets; st++) { const ys = O.LOT + st * blockH + O.LANE + D; for (let x = O.LOT; x < W - O.LOT; x += rng.int(8, 14)) { if (x >= plazaX - 2 && x < plazaX + plaza + 2) continue; G.block(x, ys + Math.floor(O.STREET / 2), rng.chance(0.5) ? "planter" : "plant"); } }
  ctx.wings = streets > 1 ? ["the north street", "the south street", "the plaza"] : ["the street", "the plaza"];
  return finish(ctx, zones, withVehicle, { walkways });
}

// ---------------------------------------------------------------------------------------------------------------------
// The hint (buildingmaps.js buildingHint, the crawl's place line): a sample mall's anchors, shops, rooms.
// ---------------------------------------------------------------------------------------------------------------------
export function mallHint(key) {
  const kind = kindOf(key);
  const hint = kind === "stripmall" ? "Likely: food, clothes, a little of everything. A row of shops, an anchor store at the end, a pad on the lot." : kind === "outlet" ? "Likely: clothes, packs, sporting goods. Separate shops round a plaza, food pads, parking." : "Likely: everything a mall sells. Anchor stores, two levels of shops, a food court, a cinema, mall security.";
  const sig = kind === "stripmall" ? [{ name: "Shop", n: 8 }, { name: "Anchor store", n: 1 }] : kind === "outlet" ? [{ name: "Outlet store", n: 18 }, { name: "Plaza", n: 1 }] : [{ name: "Shop", n: 60 }, { name: "Anchor store", n: 3 }, { name: "Food court", n: 1 }, { name: "Cinema", n: 1 }];
  return { hint, size: "huge", rooms: sig.reduce((a, s) => a + s.n, 0) * 3, holds: ["store", "clothes", "kitchen", "office"], sig };
}

/** The plan's intro (buildingmaps.js interiorIntro): the anchors and the wings to head for. */
export function mallIntro(plan) {
  const an = (plan.anchors || []).map((a) => a.name);
  const what = plan.kind === "stripmall" ? "a strip mall" : plan.kind === "outlet" ? "an outlet centre" : `an enclosed mall on ${plan.levels} level${plan.levels > 1 ? "s" : ""}`;
  const parts = [`It is ${what}: ${plan.storefronts} storefronts, ${plan.shops} of them shops, ${plan.vacant} empty.`];
  if (an.length) parts.push(`Anchor${an.length > 1 ? "s" : ""}: ${an.join(", ")}.`);
  if (plan.foodCourt) parts.push("The food court is on the top level; the dead gather there and in the cinema.");
  if ((plan.wings || []).length) parts.push(`Head for ${plan.wings.join(", ")}.`);
  return parts.join(" ");
}
export { orient, SIDE_NAME };
