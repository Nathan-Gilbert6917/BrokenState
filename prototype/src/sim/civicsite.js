// @ts-check
// Civic and medical sites of several buildings (issue #49 of the round-2 epic #39, the user's request 2026-10-26:
// "updating the map size of civic and medical buildings to be max size of 350x350"). Four of #49's new plans
// (civicvariants.js, a world made since #49 only: worldcfg.js legacyCivic) are a building on a site of its own, and the
// raid map is the whole site (buildingmaps.js buildingMap: spec.civicSite), built on compound.js (#30's shared
// multi-building code, as #28's campuses and #31's prisons):
//
//   medcampus   a city medical centre: its bed tower (the plan's own building), a second tower (the hospital's
//               "Regional medical tower" plan), the emergency department (civicvariants.js SITE_PLANS.er) with its
//               ambulances on the apron outside and the helipad beside it (a crashed medevac helicopter on it at
//               times), the clinic building (the clinic's "Multi-specialty medical centre"), the parking garage
//               (#28's) and the staff lot;
//   churchyard  a parish church (its own building) and its parish hall (SITE_PLANS.hall), the churchyard round behind
//               them: headstones in rows (data-furniture.js headstone), a hedge round it with a lychgate, its yews;
//   policehq    a police headquarters (its own building), the impound lot behind it (a chain-link fence with its gate
//               and a guard booth, the impounded cars in rows: each a container) with its office (SITE_PLANS.impound),
//               the staff lot;
//   firehq      a fire headquarters (its own building), its training ground behind: the drill tower (SITE_PLANS.
//               drilltower: five storeys of drill floors), the drill yard (oil drums, crates, a burnt-out car to cut
//               open), the staff lot.
//
// The layout (layout): two rows of buildings and grounds, every front to the south. The front row stands along the
// road at the bottom of the map (the main building first), the back row behind a promenade (paths from each front
// door to it and to the road). Each building is built the usual way (buildingmaps.js assemble, its own dice: the
// site's seed and its number), the main one from the plan as realScale laid it out, the others at real scale too;
// its signs of survival (interiorscenes.js) rolled on it and copied in with it. The map is as big as the site needs,
// never past battlesize.js MAP_CAP for its kind (CIVIC_SITE.CAP: 350; a lot shrinks first, then the back row's last
// items go). Ways out: both ends of the road (the team comes in at the west end with its vehicle), the north edge and
// the west and east edges. The dead: the site's roster × CIVIC_SITE.DEAD (map.deadScale), placed through the
// buildings and the grounds as a building's are (placeInterior). Containers carry c.house (the building's number:
// poicont.js keeps each building apart).
import { Rng } from "./rng.js";
import { hash01 } from "./skills.js";
import { BUILDINGS, assemble, realScale, stampLootK } from "./buildingmaps.js"; // call-time only (buildingmaps.js imports this module)
import { compoundGrid, placeBuilding, guard, parkingLot, compoundResult, compoundVehicle } from "./compound.js";
import { rollScenes, sceneRng } from "./interiorscenes.js";
import { mapCap } from "./battlesize.js";
import { SITE_PLANS } from "./civicvariants.js";

export const CIVIC_SITE = {
  CAP: 350,          // a site's map at most (battlesize.js MAP_CAP: a hospital's and a church's 350, the police's and fire's 300)
  EDGE: 6,           // the ground between the map's edges and the rows (the north, west and east ways out)
  GAP: [6, 9],       // between two things in a row
  WALK: 3,           // the promenade between the back row's fronts and the front row's backs
  FRONT: 3,          // the ground between the front row and the road's sidewalk
  ROAD: 5,           // the road along the south edge (the way in)
  CARS: 0.5,         // a staff lot's share of bays with a car in them
  IMPOUND: 0.7,      // an impound lot's
  DEAD: { medcampus: 2, churchyard: 0.9, policehq: 1.3, firehq: 1.1 }, // the site's roster × this (map.deadScale)
  HELO: 0.35,        // a crashed medevac helicopter on the helipad
  AMBULANCES: [2, 4],
  SITES: {
    medcampus: { name: "medical centre", key: "hospital", main: "Bed Tower" },
    churchyard: { name: "churchyard", key: "church", main: "Parish Church" },
    policehq: { name: "police headquarters", key: "police", main: "Police Headquarters" },
    firehq: { name: "fire headquarters", key: "firestation", main: "Fire Headquarters" },
  },
};

const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const seedOf = (state, ...keys) => Math.floor(hash01(state.seed, "civicsite", ...keys) * 4294967296) || 1;

// A building at real scale of kind key with these options (a plan pinned), in a city or a town.
/** @param {any} rng @param {string} key @param {any} o @param {string} setting */
const real = (rng, key, o, setting) => realScale(rng, BUILDINGS[key].make(rng, { ...o, civicReal: true, setting }), key, { setting });

/**
 * The things on a site, front row then back row: { b: (rng) → spec, key, name } a building, { g, w, h, name } a ground.
 * @param {string} site @param {any} rng @param {string} setting @param {string} mainName @returns {any[][]}
 */
function siteRows(site, rng, setting, mainName) {
  const B = (key, name, make) => ({ key, name, make });
  const G = (g, name, w, h) => ({ g, name, w, h });
  switch (site) {
    case "medcampus": {
      const second = rng.chance(0.5) ? "East Tower" : "West Tower";
      return [
        [{ main: true, name: mainName }, B("hospital", "Emergency Department", (r) => SITE_PLANS.er(r)), G("apron", "Ambulance apron", rng.int(16, 20), rng.int(16, 20)), G("helipad", "Helipad", 15, 15)],
        [B("hospital", second, (r) => real(r, "hospital", { plan: "tower" }, setting)), B("clinic", "Medical Office Building", (r) => real(r, "clinic", { plan: "multi" }, setting)), B("parkgarage", "Parking Garage", (r) => /** @type {any} */ (BUILDINGS).parkgarage.make(r, { maxStoreys: 4 })), G("lot", "Staff parking", rng.int(36, 48), rng.int(30, 36))],
      ];
    }
    case "churchyard":
      return [
        [{ main: true, name: mainName }, B("church", "Parish Hall", (r) => SITE_PLANS.hall(r)), G("lot", "Church parking", rng.int(20, 26), 22)],
        [G("cemetery", "Churchyard", rng.int(46, 64), rng.int(26, 34))],
      ];
    case "policehq":
      return [
        [{ main: true, name: mainName }, G("lot", "Staff parking", rng.int(28, 36), rng.int(24, 30))],
        [B("police", "Impound Office", (r) => SITE_PLANS.impound(r)), G("impound", "Impound lot", rng.int(44, 56), rng.int(30, 36))],
      ];
    case "firehq":
      return [
        [{ main: true, name: mainName }, G("lot", "Staff parking", rng.int(22, 28), rng.int(18, 24))],
        [B("firestation", "Drill Tower", (r) => SITE_PLANS.drilltower(r)), G("drillyard", "Drill yard", rng.int(30, 40), rng.int(22, 28))],
      ];
    default: return [[{ main: true, name: mainName }]];
  }
}

/**
 * The raid map of a civic site (buildingmaps.js buildingMap, for a spec with civicSite): the same every visit (its dice
 * from the world seed, the tile and the option id). spec: the main building's, as makeSpec made it (realScale's).
 * @param {any} state @param {number} tileId @param {{ id: string, key: string, name: string }} option @param {any} withVehicle @param {any} spec
 */
export function civicSiteMap(state, tileId, option, withVehicle, spec) {
  const CS = CIVIC_SITE, site = spec.civicSite, S = CS.SITES[site] || { name: "site", key: option.key, main: null };
  const rng = new Rng(seedOf(state, "map", tileId, option.id));
  const tile = state.tiles[tileId], setting = tile && tile.loc && tile.loc.type === "town" ? "town" : "city";
  const cap = Math.min(CS.CAP, mapCap(option.key) || CS.CAP);
  const mainName = S.main || BUILDINGS[option.key].name; // the main building's name on the site (its rooms: "Nave, Parish Church")
  // ---------- the things: each building its own plan and map, its signs of survival rolled on it ----------
  let k = 0;
  /** @type {any[][]} */
  const rows = siteRows(site, rng, setting, mainName).map((row) => row.map((/** @type {any} */ it) => {
    if (it.g) return { ...it, ground: true };
    const id = `${option.id}#${k + 1}`, hr = new Rng(seedOf(state, "bldg", tileId, id));
    const sp = it.main ? { ...spec } : it.make(hr);
    sp.margins = { front: 1, back: 1, left: 1, right: 1 };
    sp.ground = "none";
    const key = it.main ? option.key : it.key;
    const m = assemble(hr, sp, { key, id, name: it.name, legacy: false });
    stampLootK(m, sp); // its containers' worth at real scale (civicvariants.js LOOT_K)
    rollScenes(m, sceneRng(state, tileId, { id }), key);
    return { ...it, k: k++, id, key, m, w: m.building.w, h: m.building.h, nat: sp.natW ? [sp.natW, sp.natH] : null };
  }));
  // ---------- the layout: the rows' widths and depths, within the cap ----------
  const gap = rng.int(CS.GAP[0], CS.GAP[1]);
  const width = (row) => row.reduce((a, it) => a + it.w, 0) + gap * Math.max(0, row.length - 1);
  const avail = cap - 2 * CS.EDGE;
  for (const row of rows) {
    // Too wide: the grounds shrink (to two thirds at most), then the row's last things go (never a building before a ground).
    for (const it of row) if (width(row) > avail && it.ground) it.w = Math.max(Math.ceil((it.w * 2) / 3), it.w - (width(row) - avail));
    while (width(row) > avail && row.length > 1) { const j = row.map((it) => !!it.ground).lastIndexOf(true); row.splice(j >= 0 ? j : row.length - 1, 1); }
  }
  const back = rows[1] || [], front = rows[0];
  const depth = (row) => (row.length ? Math.max(...row.map((it) => it.h)) : 0);
  let backD = depth(back);
  const fixed = CS.EDGE + depth(front) + CS.FRONT + CS.ROAD + 3 + (back.length ? CS.WALK + 2 : 0);
  if (fixed + backD > cap) { for (const it of back) if (it.ground) it.h = Math.max(10, it.h - (fixed + backD - cap)); backD = depth(back); }
  const W = clampN(Math.max(width(front), width(back)) + 2 * CS.EDGE, 60, cap), H = clampN(fixed + backD, 50, cap);
  // The rows' y: the back row's fronts on the promenade, the front row's on the lawn by the road.
  const roadY = H - CS.ROAD - 2, frontY = roadY - 1 - CS.FRONT - depth(front), walkY = frontY - 2 - CS.WALK + 1, backY = walkY - 1 - backD;
  const place = (row, y0, D) => {
    const extra = Math.max(0, W - 2 * CS.EDGE - width(row)), each = row.length > 1 ? Math.min(12, Math.floor(extra / (row.length + 1))) : 0;
    let x = CS.EDGE + Math.floor((extra - each * Math.max(0, row.length - 1)) / 2);
    for (const it of row) { it.x0 = x; it.y0 = y0 + D - it.h; x += it.w + gap + each; }
  };
  place(front, frontY, depth(front));
  if (back.length) place(back, backY, backD);
  // ---------- the grid, the road, the promenade, the paths ----------
  const storeys = Math.max(1, ...rows.flat().filter((it) => it.m).map((it) => it.m.storeys || 1));
  const C = compoundGrid(W, H, storeys, () => (setting === "town" ? "grass" : "grass"));
  const cells = C.cells, keep = C.keep, I = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const paint = (x0, y0, w, h, f, mark = true) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (inside(x, y)) { cells[I(x, y)].f = f; if (mark) keep[I(x, y)] = 1; } };
  paint(0, roadY, W, CS.ROAD, "road");
  paint(0, roadY - 1, W, 1, "gravel"); paint(0, roadY + CS.ROAD, W, 1, "gravel"); // the sidewalks
  if (back.length) {
    paint(CS.EDGE - 3, walkY, W - 2 * (CS.EDGE - 3), CS.WALK, "gravel"); // the promenade
    paint(CS.EDGE - 3, walkY, 2, roadY - walkY, "gravel"); paint(W - CS.EDGE + 1, walkY, 2, roadY - walkY, "gravel"); // its paths down to the road at both ends
  }
  // ---------- the buildings copied in (compound.js placeBuilding), their scenes moved with them ----------
  const sceneList = [], sceneBodies = [], scenePiles = [], scenePieces = [];
  for (const it of rows.flat()) {
    if (!it.m) continue;
    const m = it.m, R = m.building;
    const part = placeBuilding(C, m, { x0: it.x0, y0: it.y0, face: "s", k: it.k, name: it.name, key: it.key });
    it.part = part;
    const S2 = m.scenes;
    if (S2) {
      const tx = (x) => it.x0 + (x - R.x0), ty = (y) => it.y0 + (y - R.y0);
      const ids = new Map(m.rooms.filter((a) => !a.outdoor).map((a, j) => [a.id, part.rooms[j]]));
      for (const sc of S2.list) sceneList.push({ ...sc, x: tx(sc.x), y: ty(sc.y), room: sc.room == null ? null : ids.get(sc.room) ?? null, house: it.k });
      for (const o of S2.bodies) sceneBodies.push({ ...o, x: tx(o.x), y: ty(o.y) });
      for (const q of S2.piles) scenePiles.push({ ...q, x: tx(q.x), y: ty(q.y), area: q.area == null ? null : ids.get(q.area) ?? null });
      for (const q of S2.pieces) scenePieces.push({ ...q, x: tx(q.x), y: ty(q.y) });
    }
    // A path from its front door (and from a roller door on its front: a drive) to the promenade or the road.
    const to = front.includes(it) ? roadY - 1 : walkY;
    const toWalk = (x, y) => { for (let q = y + 1; q < to && inside(x, q); q++) { keep[I(x, q)] = 1; if (cells[I(x, q)].k === "open") cells[I(x, q)].f = "gravel"; } };
    for (const [x, y] of (part.front && part.front.cells) || []) toWalk(x, y);
    for (const ex of part.exits) if (ex.side === "s") for (const [x, y] of ex.cells) toWalk(x, y);
    // The back doors (an ambulance bay, a sally port, a bay door) onto paved ground behind it.
    for (const ex of part.exits) if (ex.side === "n" && ex.roller) for (const [x, y] of ex.cells) for (let q = y - 1; q >= Math.max(0, y - 6); q--) if (inside(x, q) && cells[I(x, q)].k === "open") { cells[I(x, q)].f = "road"; keep[I(x, q)] = 1; }
  }
  // ---------- the grounds ----------
  const entry0 = [1, roadY + 2];
  const G = guard(C, entry0[0], entry0[1]);
  /** @type {any[]} */
  const grounds = [];
  const area = (type, name, r) => { const a = { id: C.areas.length, type, name, outdoor: true, f: 0, x0: r.x0, y0: r.y0, w: r.w, h: r.h, house: null }; C.areas.push(a); return a; };
  const vehicle = (r, x, y, ax, L, kind, body, box, a, label) => { // a parked vehicle (a container of area a), or null
    const rect = G.car(x, y, ax, L, kind, rng.int(0, 1e6));
    if (!rect) return null;
    if (body) for (let yy = rect.y0; yy < rect.y0 + rect.h; yy++) for (let xx = rect.x0; xx < rect.x0 + rect.w; xx++) if (cells[I(xx, yy)].car) cells[I(xx, yy)].car.body = body;
    C.containers.push({ id: C.cid++, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, f: 0, area: a.id, kind: box, searched: false, label: `${a.name}: ${label}`, house: null });
    return rect;
  };
  for (const it of rows.flat()) {
    if (!it.ground) continue;
    const r = { x0: it.x0, y0: it.y0, w: it.w, h: it.h };
    /** @type {any} */
    const g = { kind: it.g, name: it.name, ...r };
    grounds.push(g);
    switch (it.g) {
      case "lot": { const lot = parkingLot(C, G, r, rng, { name: it.name, parked: CS.CARS }); g.cars = lot ? C.containers.filter((c) => c.area === lot.id).length : 0; break; }
      case "apron": { // the ER's apron: asphalt, the ambulances backed up to it in a row
        paint(r.x0, r.y0, r.w, r.h, "road", false);
        const a = area("medwreck", it.name, r);
        let n = 0;
        const want = rng.int(CS.AMBULANCES[0], CS.AMBULANCES[1]);
        for (let x = r.x0 + 1; x + 2 <= r.x0 + r.w - 1 && n < want; x += 4) if (vehicle(r, x, r.y0 + 2, "y", 4, "truck", "ambulance", "ambulance", a, "ambulance")) n++;
        g.ambulances = n;
        break;
      }
      case "helipad": { // a concrete pad, its ring painted, at times a medevac helicopter crashed on it
        paint(r.x0, r.y0, r.w, r.h, "road", false);
        for (let x = r.x0 + 2; x < r.x0 + r.w - 2; x++) for (let y = r.y0 + 2; y < r.y0 + r.h - 2; y++) if (cells[I(x, y)].k === "open") cells[I(x, y)].f = "conc";
        if (rng.chance(CS.HELO)) { const a = area("medwreck", it.name, r); g.helo = !!vehicle(r, r.x0 + Math.floor(r.w / 2) - 1, r.y0 + Math.floor(r.h / 2) - 2, "y", 5, "truck", "helo", "helo", a, "medevac helicopter wreck"); }
        break;
      }
      case "cemetery": { // a hedge round it, a lychgate at the front, headstones in rows, yews
        const gate = r.x0 + Math.floor(r.w / 2);
        for (let x = r.x0; x < r.x0 + r.w; x++) for (const y of [r.y0, r.y0 + r.h - 1]) if (!(y === r.y0 + r.h - 1 && Math.abs(x - gate) <= 1) && G.block(x, y, "fence")) cells[I(x, y)].hedge = true;
        for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) for (const x of [r.x0, r.x0 + r.w - 1]) if (G.block(x, y, "fence")) cells[I(x, y)].hedge = true;
        paint(gate - 1, r.y0 + 1, 3, r.h - 2, "gravel"); // the path up the middle
        let stones = 0;
        for (let y = r.y0 + 2; y < r.y0 + r.h - 2; y += 3) for (let x = r.x0 + 2; x < r.x0 + r.w - 2; x += 2) { if (Math.abs(x - gate) <= 2 || !rng.chance(0.85)) continue; if (G.block(x, y, "headstone")) { keep[I(x, y)] = 1; stones++; } }
        for (let t = 0, n = 0; t < 30 && n < Math.max(2, Math.round(r.w / 12)); t++) { const x = rng.int(r.x0 + 2, r.x0 + r.w - 3), y = rng.int(r.y0 + 2, r.y0 + r.h - 3); if (cells[I(x, y)].k === "open" && !keep[I(x, y)] && G.block(x, y, "tree")) n++; }
        g.headstones = stones;
        break;
      }
      case "impound": { // a chain-link fence with its gate (a guard booth by it), the impounded cars in rows
        const gate = r.x0 + Math.floor(r.w / 2) - 1;
        for (let x = r.x0; x < r.x0 + r.w; x++) for (const y of [r.y0, r.y0 + r.h - 1]) if (!(y === r.y0 + r.h - 1 && x >= gate && x <= gate + 2)) G.block(x, y, "wirefence");
        for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) for (const x of [r.x0, r.x0 + r.w - 1]) G.block(x, y, "wirefence");
        paint(r.x0 + 1, r.y0 + 1, r.w - 2, r.h - 2, "gravel", false);
        G.block(gate + 4, r.y0 + r.h - 2, "guardbooth");
        const a = area("wreck", it.name, r);
        let n = 0;
        for (let y = r.y0 + 2; y + 4 <= r.y0 + r.h - 4; y += 7) for (let x = r.x0 + 2; x + 2 <= r.x0 + r.w - 2; x += 3) if (rng.chance(CS.IMPOUND) && vehicle(r, x, y, "y", rng.chance(0.3) ? 4 : 3, "car", null, "car", a, "impounded car")) n++;
        g.cars = n;
        break;
      }
      case "drillyard": { // asphalt, oil drums and crates, a burnt-out car for the rescue drills
        paint(r.x0, r.y0, r.w, r.h, "road", false);
        for (let t = 0, n = 0; t < 40 && n < 8; t++) { const x = rng.int(r.x0 + 1, r.x0 + r.w - 2), y = rng.int(r.y0 + 1, r.y0 + r.h - 2); if (G.block(x, y, rng.chance(0.6) ? "barrel" : "crate")) n++; }
        const a = area("wreck", it.name, r);
        g.wreck = !!vehicle(r, r.x0 + Math.floor(r.w / 2), r.y0 + Math.floor(r.h / 2) - 2, "x", 3, "car", null, "car", a, "burnt-out car");
        break;
      }
    }
  }
  // ---------- the ways out ----------
  const Z = 3, zy = roadY + 1;
  const zones = [
    { x0: 0, y0: zy, w: Z, h: Z, side: "west", exit: "west", name: "West end of the road", vehicle: false },
    { x0: W - Z, y0: zy, w: Z, h: Z, side: "east", exit: "east", name: "East end of the road", vehicle: false },
    { x0: Math.floor(W / 2) - 1, y0: 0, w: Z, h: Z, side: "north", exit: "north", name: `North edge of the ${S.name}`, vehicle: false },
    { x0: 0, y0: Math.floor(roadY / 2), w: Z, h: Z, side: "west", exit: "west", name: `West edge of the ${S.name}`, vehicle: false },
    { x0: W - Z, y0: Math.floor(roadY / 2), w: Z, h: Z, side: "east", exit: "east", name: `East edge of the ${S.name}`, vehicle: false },
  ];
  for (const z of zones) for (let q = z.y0 - 1; q <= z.y0 + z.h; q++) for (let p = z.x0 - 1; p <= z.x0 + z.w; p++) if (inside(p, q)) { keep[I(p, q)] = 1; const c = cells[I(p, q)]; if (c.k === "tree" || c.k === "fence" || c.k === "wirefence") { c.k = "open"; delete c.hedge; G.passAt(I(p, q)); } }
  // ---------- the result (compound.js compoundResult: a street's shape; plan.houses are the buildings) ----------
  const veh = compoundVehicle(C, zones[0], withVehicle);
  const scenes = sceneList.length ? { list: sceneList.map((sc, i) => ({ ...sc, id: i + 1 })), bodies: sceneBodies, piles: scenePiles, pieces: scenePieces, seed: (seedOf(state, "scenebattle", tileId, option.id) % 2147483646) + 1 } : null;
  const map = compoundResult(C, { key: option.key, id: option.id, name: option.name, zones, vehicle: veh, kind: site, extra: { street: true, word: "buildings", civicSite: site, vid: spec.vid, vname: spec.vname, grounds } });
  // Each building's plan at its own size (realScale's natW, natH): what its containers hold (campus.js campusLootShare).
  for (const h of map.plan.houses) { const it = rows.flat().find((x) => x.m && x.k === h.k); if (it && it.nat) { h.natW = it.nat[0]; h.natH = it.nat[1]; } }
  // natMap: the main building's plan's map (citycrawl.js's quick search: what a container holds, as a building's at real size).
  const nat = [(spec.natW || spec.bw) + 9, (spec.natH || spec.bh) + 9];
  return Object.assign(map, { street: true, civicSite: site, deadScale: CS.DEAD[site] ?? 1, natMap: nat, scenes });
}
