// @ts-check
// Restaurants by kind of food, format and size (the user's request 2026-10-25, issue #33 of the interiors epic #7:
// "there should be a few dozen varients, sizes layout and kind of food for resauraunts"). A new save's restaurant,
// pizza place, diner or bar is one of data-eateries.js VARIANTS (its franchise's eat: a cuisine, a format, a size), and
// this module makes its building: the plan by format and size (eateryPlan: buildingmaps.js shop calls it for the four
// food kinds; an older save keeps the one plan they had, the roomsLegacy rule), its rooms furnished on roomlayout.js's
// helpers (EATERY_STYLES, merged into shoplayout.js COMMERCIAL_STYLES: the plan's leaves name them by lay, so the lanes,
// the backs to the walls and the containers are #10's and #16's rules), what stands outside (eateryOutside: assemble's
// spec.outside), and their signs of survival (registerScene). #29's hotels and #30's mall food court pick their places
// from the same table (eateryVariant).
//
// The plans (EATERY.SIZE: data-eateries.js EAT_SIZE, a cell about a metre; the front room across the street side, the
// back of house behind it in a row, the kitchen at one end):
//   fastfood    the dining room (the order counter across it with its tills and the menu boards behind, booths, tables),
//               a play area with its play structure (most medium and large ones), the kitchen with the drive-through
//               window in its side wall and the lane outside it (a menu board on its post, cars queued in it now and
//               then), a walk-in cold room and a freezer, the dry store, the manager's office, the restroom;
//   fastcasual  the order counter (the assembly line along the back wall: steam tables, a cold case; the till), booths;
//   cafe        the espresso bar (pastry cases, the espresso machine, the till), sofas and armchairs, tables;
//   diner       the long counter with its stools, the pie case, the open grill behind the counter, booths;
//   family      the host stand's lobby (the stand, the till, chairs to wait on), the dining room of booths and tables;
//   fine        the lobby, the dining room of white-cloth tables, the bar (wine racks behind it), a private dining room,
//               a wine cellar, a big kitchen with a second line of stations;
//   buffet      the lobby, the buffet hall (long steam tables, the salad bar, the dessert station: a pastry case and a
//               soft-serve machine, tables);
//   pub         the pub (the long bar with its tap towers and stools, a jukebox, booths, a pool table in a big one), a
//               brewpub's brewhouse of brewing tanks behind glass on the street, the keg room;
//   kiosk       the counter and a tiny line, a walk-in the size of a cupboard; a food truck's commissary has its truck
//               parked beside it (a container: its stock and propane);
//   ghost       a pickup counter and a big kitchen with two lines;
//   banquet     the foyer, the ballroom (the stage, round tables of four to six, a bar with its till), a big kitchen.
//   Every kitchen has its cuisine's line (data-eateries.js CUISINES line and sig: a tandoor, wok ranges, deck ovens,
//   smokers, a char grill...), a range, a deep fryer where they fry, stainless counters, a sink, the dish pit's dish
//   machine, a fire extinguisher; every one a walk-in cold room behind a steel door. A BBQ has a pit room of smokers and
//   smokers out back; the back door has a grease trap beside it; a patio of umbrella tables out front now and then.
// Loot (EATERY.DENSITY): containers by area, so a big place holds more and a kiosk little; the walk-ins, the dry store,
// the freezers and the cases hold food of the cuisine (the rooms' mix: foods.js MIXES "eat:<cuisine>", its keeps for
// the preserved draws, combat.js reads the area's mix), the kitchens knives and cleavers (blades.js kitchen), a BBQ's
// pit room and a food truck propane.
import { registerScene, SCENES, SCENE_KINDS } from "./interiorscenes.js";
import { COMMERCIAL_STYLES, fill, full, P, checkout, share, counterRow, stools, tables, booths, some, rowFrom, frontDoor } from "./shoplayout.js";
import { EAT_SIZE, FORMATS, CUISINES, VARIANTS, SITDOWN, COUNTER, variantById } from "./data-eateries.js";

export const EATERY = {
  SIZE: EAT_SIZE,
  // Containers a room holds: its inside cells × this (roomlayout.js's target is area / 10, capped; a restaurant's
  // rooms by these, tuned with tools/restauranttest.js so a place holds what the old restaurants did per area ±10%).
  DENSITY: { front: 0.045, kitchen: 0.09, cold: 0.25, dry: 0.3, office: 0.15, small: 0.12 },
  KIND: { diner: 1.2, bar: 0.74, pizza: 0.9 }, // × DENSITY by the food kind (the old diners held more per area than the bars)
  KITCHEN: { tiny: 4, small: 6, medium: 7, large: 9, huge: 12 }, // a kitchen's least width (cells)
  PLAY: 0.7,          // a medium or large fast-food place's play area
  PATIO: 0.45,        // a patio of umbrella tables out front (the counters and the sit-downs that are not fine dining)
  DRIVE_CARS: 0.55,   // cars queued in the drive-through lane
  SMOKERS: [1, 2],    // a BBQ's smokers out back
};
const SIZE_FOOT = { tiny: "small", small: "small", medium: "medium", large: "large", huge: "huge" };

// ---------- the variant table ----------
/** A place's restaurant variant by its kind (restaurant, pizza, diner, bar) and franchise id; none: one by the dice. */
export function eateryOf(kind, id, r = 0) {
  const k = kind === "pizza" || kind === "diner" || kind === "bar" ? kind : "restaurant";
  const v = variantById(k, id);
  if (v) return v;
  const list = VARIANTS.filter((x) => x.kind === k);
  return list[Math.floor(r * list.length) % list.length];
}
/**
 * A variant for another building's restaurant (#29's hotels, #30's mall food court, a truck stop): by format (one or
 * a list; SITDOWN / COUNTER from data-eateries.js), cuisine (one or a list), setting (one of the places: "main",
 * "strip", "highway", "city", "mall", "hotel", "truckstop"; or "city" / "suburb" / "town" for the franchise weights)
 * and size (one or a list); avoid: ids already on the map or the block (two places are rarely the same variant).
 * r: the caller's dice (0–1). Returns the variant ({ id, name, kind, cuisine, format, size, look, plan }) or null when
 * nothing fits; the filters are dropped in turn (size, cuisine, setting) before giving up, so a call always finds one
 * when the format exists.
 * @param {{ format?: string | string[], cuisine?: string | string[], setting?: string, size?: string | string[], avoid?: string[], r?: number }} [q]
 */
export function eateryVariant(q = {}) {
  const as = (x) => (x == null ? null : Array.isArray(x) ? x : [x]);
  const fmt = as(q.format), cui = as(q.cuisine), sz = as(q.size), avoid = new Set(q.avoid || []), set = q.setting || null;
  const W = { city: 1, suburb: 1, town: 1 };
  const weight = (v) => (set && W[set] ? v.w[set] : 1) || 0;
  const tiers = [
    (v) => (!sz || sz.includes(v.size)) && (!cui || cui.includes(v.cuisine)) && (!set || W[set] || v.at.includes(set)),
    (v) => (!cui || cui.includes(v.cuisine)) && (!set || W[set] || v.at.includes(set)),
    (v) => !set || W[set] || v.at.includes(set),
    () => true,
  ];
  for (const ok of tiers) {
    for (const fresh of [true, false]) {
      const list = VARIANTS.filter((v) => (!fmt || fmt.includes(v.format)) && ok(v) && (!fresh || !avoid.has(v.id)) && weight(v) > 0);
      if (!list.length) continue;
      const tot = list.reduce((a, v) => a + weight(v), 0);
      let x = (q.r ?? 0.5) * tot;
      for (const v of list) { x -= weight(v); if (x < 0) return v; }
      return list[list.length - 1];
    }
  }
  return null;
}
/** The cuisine × format × size combinations in the table (tools/restauranttest.js). */
export const eateryCombos = () => [...new Set(VARIANTS.map((v) => `${v.cuisine}|${v.format}|${v.size}`))];

// ---------- the plans ----------
const mixOf = (v) => `eat:${v.cuisine}`;
/**
 * A restaurant's building spec (buildingmaps.js assemble) by its variant v: the footprint by its size, the rooms by its
 * format, the front room with the franchise's floor, name and wall colour (look). New saves only (shop: o.legacy keeps
 * the old plan).
 * @param {any} rng @param {any} v @param {{ fl?: string, room?: string, look?: any, truck?: boolean }} plan
 */
export function eateryPlan(rng, v, plan = {}) {
  const S = EAT_SIZE[v.size] || EAT_SIZE.medium, C = CUISINES[v.cuisine] || CUISINES.burgers, F = FORMATS[v.format] || FORMATS.family;
  const bw = rng.int(S.w[0], S.w[1]), bh = rng.int(S.h[0], S.h[1]);
  const big = v.size === "large" || v.size === "huge", huge = v.size === "huge", tiny = v.size === "tiny", small = v.size === "small";
  const mix = mixOf(v), eat = v.cuisine;
  const R = (o) => ({ eat, mix, kind: v.kind, tint: v.tint || C.tint, ...o });
  const frontRoom = (o) => R({ role: "dining", entry: true, hub: true, type: "store", name: plan.room || F.room, ...(plan.fl ? { fl: plan.fl } : {}), ...(plan.look ? { wallc: plan.look.wall } : {}), ...o });
  const cold = R({ role: "pantry", name: "Walk-in cold room", type: "kitchen", cold: true, dk: "steel", windows: false, fl: "steel", lay: "walkin" });
  const freezer = R({ role: "pantry", name: "Walk-in freezer", type: "kitchen", cold: true, dk: "steel", windows: false, fl: "steel", lay: "walkfreezer" });
  const dry = R({ role: "pantry", name: "Dry store", type: "kitchen", windows: false, fl: "conc", lay: "eatdry" });
  const office = R({ role: "office", name: "Manager's office", boxLock: ["safe", 1], lay: "manager" });
  const rest = (name = "Restroom") => ({ role: "restroom", name });
  const restrooms = (n) => (n > 1 ? { split: "y", parts: [["*", rest("Men's restroom")], ["*", rest("Women's restroom")]] } : rest());
  const coldCol = (n) => (n > 1 ? { split: "y", parts: [["*", cold], ["*", freezer], ...(n > 2 ? [["*", R({ ...cold, name: C.cold || "Walk-in cold room" })]] : [])] } : cold);
  const fry = C.line.includes("fryer") || ["fastfood", "diner", "pub", "kiosk"].includes(v.format);
  const left = rng.chance(0.5); // the kitchen at the building's left (the drive-through lane on that side) or right
  const drive = v.format === "fastfood";
  const kitchen = R({ role: "kitchen", name: "Kitchen", type: "kitchen", lay: "eatkitchen", fry, big, ...(drive ? { drive: left ? "w" : "e" } : {}), ...(v.format === "ghost" || v.format === "fine" || huge ? { stations: true } : {}) });
  let fd = Math.round(bh * 0.6), front, back;
  switch (v.format) {
    case "kiosk":
      fd = Math.max(3, Math.round(bh * 0.4));
      front = frontRoom({ lay: "eatkiosk" });
      back = [["*", kitchen], [2, cold]]; // a walk-in the size of a cupboard
      break;
    case "ghost":
      fd = Math.max(4, Math.round(bh * 0.32));
      front = frontRoom({ lay: "eatpickup" });
      back = [["*", kitchen], [4, coldCol(small ? 1 : 2)], [3, dry], [3, office], [small ? 2 : 3, rest()]];
      break;
    case "fastfood": {
      fd = Math.round(bh * 0.55);
      const play = !small && rng.chance(EATERY.PLAY);
      front = play ? { split: "x", parts: [["*", frontRoom({ lay: "eatcounter" })], [big ? 7 : 6, R({ role: "lobby", name: "Play area", type: "store", lay: "eatplay", hub: false })]] } : frontRoom({ lay: "eatcounter" });
      back = [["*", kitchen], [4, coldCol(small ? 1 : 2)], [3, dry], [3, office], [3, restrooms(big ? 2 : 1)]];
      break;
    }
    case "fastcasual": case "cafe":
      fd = Math.round(bh * 0.6);
      front = frontRoom({ lay: v.format === "cafe" ? "eatcafe" : "eatline" });
      back = tiny ? [["*", kitchen], [3, cold]] : [["*", kitchen], [3, cold], ...(bw >= 13 ? [[3, dry]] : []), ...(small ? [] : [[3, office]]), [small ? 2 : 3, rest()]];
      break;
    case "diner":
      fd = Math.round(bh * 0.6);
      front = frontRoom({ lay: "eatdiner" });
      back = [["*", kitchen], [4, coldCol(small ? 1 : 2)], ...(small ? [] : [[3, dry]]), [3, office], [3, restrooms(big ? 2 : 1)]];
      break;
    case "family":
      fd = Math.round(bh * 0.6);
      front = { split: "x", parts: [[big ? 6 : 5, R({ role: "lobby", name: "Host stand", type: "store", lay: "eathost", hub: true })], ["*", frontRoom({ lay: "eatdining", entry: false })]] };
      back = [["*", kitchen], [4, coldCol(v.cuisine === "steak" && big ? 3 : 2)], [3, dry], [3, office], [big ? 4 : 3, restrooms(big ? 2 : 1)]];
      if (v.cuisine === "bbq") back.splice(1, 0, [5, R({ role: "storage", name: "Pit room", type: "pitroom", lay: "eatpit", fl: "conc", pit: true })]);
      break;
    case "fine":
      fd = Math.round(bh * 0.62);
      front = { split: "x", parts: [[6, R({ role: "lobby", name: "Host stand", type: "store", lay: "eathost", hub: true })], ["*", frontRoom({ lay: "eatdining", fine: true, entry: false })], [8, R({ role: "dining", name: "Bar", type: "bar", lay: "eatbar", hub: true })]] };
      back = [["*", kitchen], [6, R({ role: "dayroom", name: "Private dining room", type: "store", lay: "eatprivate", fl: "carpet" })], [4, coldCol(v.cuisine === "steak" ? 3 : 2)], [4, R({ role: "storage", name: "Wine cellar", type: "bar", lay: "eatcellar", windows: false, fl: "conc" })], [4, dry], [4, office], [4, restrooms(2)]];
      break;
    case "buffet":
      fd = Math.round(bh * 0.65);
      front = { split: "x", parts: [[5, R({ role: "lobby", name: "Entrance", type: "store", lay: "eathost", hub: true })], ["*", frontRoom({ lay: "eatbuffet", entry: false })]] };
      back = [["*", kitchen], [5, coldCol(2)], [4, dry], [4, office], [4, restrooms(2)]];
      break;
    case "pub": {
      fd = Math.round(bh * 0.62);
      const pub = frontRoom({ type: "bar", lay: "eatpub" });
      front = v.brew ? { split: "x", parts: [["*", pub], [big ? 8 : 6, R({ role: "storage", name: "Brewhouse", type: "bar", lay: "eatbrew", glass: true, fl: "conc", hub: false })]] } : pub;
      back = [["*", kitchen], [small ? 3 : 4, R({ role: "pantry", name: "Keg room", type: "bar", lay: "kegroom" })], [3, cold], ...(small ? [] : [[3, dry]]), [3, office], [3, restrooms(big ? 2 : 1)]];
      break;
    }
    case "banquet":
      fd = Math.round(bh * 0.68);
      front = { split: "x", parts: [[7, R({ role: "lobby", name: "Foyer", type: "store", lay: "eathost", hub: true })], ["*", frontRoom({ lay: "eatballroom", entry: false })]] };
      back = [["*", kitchen], [5, coldCol(2)], [4, dry], [4, office], [5, restrooms(2)]];
      break;
    default:
      front = frontRoom({ lay: "eatdining" });
      back = [["*", kitchen], [3, cold], [3, office], [2, rest()]];
  }
  // The kitchen keeps its width (EATERY.KITCHEN by size): the rooms beside it that a narrow building has no room for go,
  // the last first (a restroom, the office, the dry store), never the walk-in.
  const need = EATERY.KITCHEN[v.size] || 6, keep = (l) => l === kitchen || l === cold || l.pit || (l.split && l.parts.some(([, q]) => q === cold));
  const tight = () => back.reduce((a, [w]) => a + (typeof w === "number" ? w : 0), 0) + need + back.length - 1 > bw - 2; // the sizes are inside cells, a wall between each
  for (let i = back.length - 1; i >= 0 && tight(); i--) if (!keep(back[i][1])) back.splice(i, 1);
  if (!left) back = back.slice().reverse();
  const outside = { drive: drive ? (left ? "w" : "e") : null, patio: ![...["fine", "banquet", "kiosk", "ghost"]].includes(v.format) && rng.chance(EATERY.PATIO), smokers: v.cuisine === "bbq", truck: !!(v.truck || (plan && plan.truck)), grease: !tiny };
  const margins = { ...(outside.drive ? { [left ? "left" : "right"]: 6 } : {}), ...(outside.truck ? { [left ? "right" : "left"]: 5 } : {}), ...(outside.patio ? { front: 4 } : {}), ...(outside.smokers ? { back: 4 } : outside.grease ? { back: 3 } : {}) };
  return {
    bw, bh, front: { width: tiny || small ? 1 : 2 }, openDoors: 0.3, ground: ["fastfood", "buffet", "kiosk"].includes(v.format) ? "lot" : "town", storeys: 1, upper: null, foot: SIZE_FOOT[v.size] || "medium",
    stairs: { roles: ["kitchen", "pantry", "office"] }, margins, eat: { ...outside, cuisine: v.cuisine, format: v.format, size: v.size, id: v.id },
    program: { split: "y", parts: [[fd, front], ["*", { split: "x", parts: back }]] },
    exits: [
      { side: "back", roles: ["kitchen", "pantry", "storage", "office"], chance: 1, lock: 0.3, name: "Back door" },
      { side: left ? "right" : "left", roles: ["dining", "lobby"], chance: big ? 0.8 : 0.3, lock: 0.4, name: "Fire exit" },
    ],
    outside: (api) => eateryOutside(api, outside, v),
  };
}

// ---------- outside ----------
/**
 * What stands outside a restaurant (buildingmaps.js assemble's spec.outside, after the pumps and the dock): the
 * drive-through lane on the kitchen's side (its menu board on a post, cars queued in it: searchable, an outdoor area
 * of its own, "Drive-through lane"), a patio of umbrella tables out front, a BBQ's smokers out back, the food truck at
 * its commissary (a container over the whole of it: BOX_LOOT foodtruck), the grease trap by the back door. Each part
 * keeps every way open (the api's block and car refuse a cell that would cut the lot in two).
 */
export function eateryOutside(api, o, v) {
  const { rng, bx0, bx1, by0, by1 } = api;
  if (o.drive) {
    const xs = o.drive === "w" ? [bx0 - 3, bx0 - 2] : [bx1 + 2, bx1 + 3];
    const a = api.area({ type: "wreck", name: "Drive-through lane", drive: true });
    const sign = xs.map((x) => [x + (o.drive === "w" ? -1 : 1), by1 - 1]).find(([x, y]) => api.free(x, y));
    if (sign) api.block(sign[0], sign[1], "menuboard");
    if (rng.chance(EATERY.DRIVE_CARS)) {
      const n = rng.int(1, 3);
      let y = by0 + 1, made = 0;
      for (let t = 0; t < 8 && made < n && y + 3 <= by1 + 3; t++) {
        const rect = api.car(xs[0], y, "y", 3, "car");
        if (rect) { api.container(rect, a, "car", "car"); made++; y += rect.h + 1; } else y++;
      }
      a.cars = made;
    }
    Object.assign(a, { x0: Math.min(...xs) - 1, y0: by0 - 1, w: 4, h: by1 - by0 + 3 });
  }
  if (o.truck) {
    const a = api.area({ type: "kitchen", name: "Food truck" });
    const x = o.drive === "e" || o.drive == null ? bx0 - 4 : bx1 + 2;
    for (const xx of [x, x === bx0 - 4 ? bx1 + 2 : bx0 - 4]) {
      const rect = api.car(xx, by0 + 1, "y", 4, "truck", "truck");
      if (rect) { api.container(rect, a, "foodtruck", "food truck"); Object.assign(a, { x0: rect.x0 - 1, y0: rect.y0 - 1, w: rect.w + 2, h: rect.h + 2 }); break; }
    }
    if (a.x0 == null) Object.assign(a, { x0: bx0, y0: by0, w: 1, h: 1, empty: true });
  }
  if (o.patio) {
    let n = 0;
    for (let x = bx0 + 1; x <= bx1 - 1 && n < 4; x += 3) { const y = by1 + 2; if (api.free(x, y) && api.free(x + 1, y) && api.block(x, y, "patiotable")) { api.block(x + 1, y, "chair"); n++; } }
  }
  if (o.smokers) {
    const n = rng.int(EATERY.SMOKERS[0], EATERY.SMOKERS[1]);
    let made = 0;
    for (const y of [by0 - 2, by0 - 3, by1 + 3]) for (let x = bx0; x + 1 <= bx1 && made < n; x += 3) {
      if (!api.free(x, y) || !api.free(x + 1, y) || !api.block(x, y, "smoker")) continue;
      if (!api.block(x + 1, y, "smoker")) api.unblock(x, y); else made++;
    }
  }
  if (o.grease) for (const e of api.exits.filter((q) => q.side === "back")) { const [ex, ey] = e.cells[0]; for (const dx of [2, -2, 3, -3]) if (api.free(ex + dx, ey - 1) && api.block(ex + dx, ey - 1, "greasetrap")) break; }
}

// ---------- the rooms (by the plan leaf's lay) ----------
/** @typedef {import("./shoplayout.js").Lay} Lay */
const cuisine = (L) => CUISINES[L.room.eat] || CUISINES.burgers;
/** The room's containers by its area (EATERY.DENSITY). @param {Lay} L */
function quota(L, d) { if (L.c.target > 0) L.c.target = Math.max(1, Math.round(L.c.w * L.c.h * d * (EATERY.KIND[L.room.kind] || 1))); }
/** The cuisine's own pieces for the dining room (a lobster tank, a fish tank, a salad bar, a dipping cabinet...). @param {Lay} L */
function frontPieces(L, skip = []) {
  for (const k of cuisine(L).front || []) {
    if (skip.includes(k) || L.has(k)) continue;
    if (k === "sushibar") { sushi(L); continue; }
    if (k === "kbbqtable") { for (let i = 0; i < Math.max(1, Math.floor((L.c.w * L.c.h) / 22)); i++) { const t = L.centre("kbbqtable"); if (!t) break; L.around(t, "chair", 4); } if (!L.has("kbbqtable")) L.need("kbbqtable"); continue; }
    L.wall(k, P(L, { prefer: "corner" })) || L.centre(k, P(L)) || L.need(k, P(L));
  }
}
/** A sushi bar: the conveyor counter across the room with its stools. @param {Lay} L */
function sushi(L) {
  const c = L.c, row = counterRow(L, rowFrom(L, c.y0 + 1), "sushibar", { from: 1, to: 1 });
  if (row.length) stools(L, row); else L.need("sushibar");
}
/** The menu boards on the back wall (where it is free). @param {Lay} L */
const menus = (L, n = 2) => some(L, "menuboard", n, { sides: ["n"], prefer: "middle" }).length || some(L, "menuboard", 1, { prefer: "middle" }).length;
/** The order counter across the room with its tills (a till every few cells), the menu boards behind it. @param {Lay} L */
function orderCounter(L, behind = []) {
  const c = L.c, deep = c.h >= 6;
  if (deep) L.run(["menuboard", ...behind, "menuboard"], ["n"], { plain: () => full(L) });
  const row = counterRow(L, rowFrom(L, deep ? c.y0 + 2 : c.y0), "counter", { box: "checkout", every: 3, from: 1, to: 1 });
  if (!row.some((p) => p.k === "checkout")) checkout(L);
  if (!deep) menus(L, 1);
  return row;
}
/**
 * Up to n tables of kind k spread over the floor in a grid (a walk between them: every `step` cells, 4 with four chairs,
 * 3 with two), each with its chairs; what the grid does not take (a small room the lanes cut up) goes nearest the middle.
 * @param {Lay} L
 */
function spread(L, n, chairs = 2, k = "table") {
  const c = L.c, step = chairs > 2 ? 4 : 3, off = L.variant(2, "grid");
  let made = 0;
  for (let y = c.y0 + 1 + off, row = 0; y <= c.y1 - 1 && made < n; y += step, row++)
    for (let x = c.x0 + 1 + (row % 2 ? 1 : 0); x <= c.x1 - 1 && made < n; x += step) {
      if (!L.ok(x, y)) continue;
      const t = L.place(k, [[x, y]]);
      if (!t) continue;
      L.around(t, "chair", chairs);
      made++;
    }
  if (!made) made = tables(L, Math.min(n, 2), chairs, k);
  return made;
}
const dinerTables = (L, per, chairs = 2, k = "table") => spread(L, Math.max(1, Math.floor((L.c.w * L.c.h) / per)), chairs, k);

/** @type {Record<string, (L: Lay) => void>} */
export const EATERY_STYLES = {
  // Fast food: the order counter with its tills, menu boards behind, a soft-serve machine and a drinks case on the back
  // wall; booths along the side walls, tables.
  eatcounter(L) {
    quota(L, EATERY.DENSITY.front);
    orderCounter(L, ["coldcase", ...(cuisine(L).sig.includes("softserve") ? [] : ["softserve"])]);
    frontPieces(L);
    booths(L, Math.max(2, Math.floor(L.c.h / 3)), ["w", "e"]);
    dinerTables(L, 18, 2);
    fill(L, ["counter", "shelf"]);
  },
  // Fast-casual: the assembly line along the back wall (steam tables, a cold case, the cuisine's case), the till at its
  // end, menu boards, booths, tables.
  eatline(L) {
    quota(L, EATERY.DENSITY.front);
    const c = L.c;
    L.run(["menuboard", "steamtable", "coldcase", "counter"], ["n"], { plain: () => full(L) });
    if (!L.has("steamtable")) L.wall("steamtable", { sides: ["n", "e", "w"] }) || L.wall("coldcase", P(L, { sides: ["n", "e", "w"] }));
    if (c.h >= 6) counterRow(L, rowFrom(L, c.y0 + 2), "counter", { box: "checkout", every: 4, from: 1, to: 2 });
    if (!L.has("checkout")) checkout(L);
    frontPieces(L);
    booths(L, 2, ["w", "e"]);
    dinerTables(L, 16, 2);
    fill(L, ["counter", "shelf"]);
  },
  // A café or a coffee shop: the espresso bar (the counter with the pastry cases in it, the espresso machine behind),
  // the till, a sofa and armchairs, small tables.
  eatcafe(L) {
    quota(L, EATERY.DENSITY.front);
    const c = L.c;
    L.run(["espresso", "counter", "espresso", "menuboard"], ["n"], { plain: () => full(L) });
    if (c.h >= 6) counterRow(L, rowFrom(L, c.y0 + 2), "counter", { box: "pastrycase", every: 2, from: 1, to: 2 });
    else L.wall("pastrycase", P(L, { sides: ["w", "e"] }));
    checkout(L);
    frontPieces(L, ["espresso"]);
    L.wall("sofa", { sides: ["w", "e", "s"], prefer: "corner" });
    L.wall("armchair", { prefer: "corner" });
    dinerTables(L, 14, 2);
    fill(L, ["pastrycase", "counter", "shelf"]);
  },
  // A diner: the long counter with its stools, the open grill and a coffee machine behind it, the pie case at its end,
  // booths along the walls, the till.
  eatdiner(L) {
    quota(L, EATERY.DENSITY.front);
    const c = L.c, deep = c.h >= 7;
    if (deep) L.run(["flattop", "espresso", "menuboard", "coldcase"], ["n"], { plain: () => full(L) });
    const row = counterRow(L, rowFrom(L, deep ? c.y0 + 2 : c.y0 + 1), "barcounter", c.w >= 6 ? { from: 1, to: 2 } : { from: 0, to: 0 });
    if (c.h >= 4) stools(L, row);
    L.wall("pastrycase", P(L, { sides: ["e", "w"], near: [c.x1, c.y0] })) || L.centre("pastrycase", P(L)); // the pie case
    if (!deep) L.wall("flattop", { sides: ["w", "e"] });
    checkout(L);
    frontPieces(L);
    booths(L, 3, ["w", "e", "s"]);
    dinerTables(L, 24, 2);
    fill(L, ["counter", "shelf"]);
  },
  // A host stand by the door (a lobby, an entrance, a foyer): the stand, the till, chairs to wait on, a plant.
  eathost(L) {
    quota(L, EATERY.DENSITY.small);
    const door = frontDoor(L);
    L.wall("hoststand", { near: door }) || L.centre("hoststand", { near: door }) || L.need("hoststand");
    checkout(L);
    some(L, "chair", 3, { prefer: "corner" });
    if (L.room.name === "Foyer") L.run(["counter", "counter"], ["n"], { plain: () => full(L) }); // the coat check
    fill(L, ["counter", "cabinet"]);
  },
  // A sit-down's dining room: the cuisine's pieces (a sushi conveyor, a lobster tank, a fish tank, grill tables...),
  // booths along the walls, tables with chairs (white-cloth tables at fine dining), a till where there is no host stand.
  eatdining(L) {
    quota(L, EATERY.DENSITY.front);
    const fine = !!L.room.fine;
    frontPieces(L);
    if (!fine) booths(L, Math.max(2, Math.floor((L.c.w + L.c.h) / 5)), ["w", "e", "n"]);
    dinerTables(L, fine ? 12 : 16, fine ? 2 : 4, fine ? "clothtable" : "table");
    if (!L.has("table") && !L.has("clothtable") && !L.has("kbbqtable")) tables(L, 1, 2);
    checkout(L);
    fill(L, fine ? ["cabinet", "winerack"] : ["counter", "shelf"]);
  },
  // A bar (fine dining's): the bar counter with stools, the wine racks and the shelves behind it, the till.
  eatbar(L) {
    quota(L, EATERY.DENSITY.front);
    const c = L.c, deep = c.h >= 5;
    if (deep) L.run(["winerack", "shelf", "winerack", "coldcase"], ["n"], { plain: () => full(L) });
    const row = counterRow(L, rowFrom(L, deep ? c.y0 + 2 : c.y0), "barcounter", { from: 0, to: 1 });
    stools(L, row);
    L.wall("beertower", { sides: ["w", "e"] });
    checkout(L);
    tables(L, 1, 2);
    fill(L, ["winerack", "shelf"]);
  },
  // A pub: the long bar with its stools, the tap towers at its ends, the liquor shelves and the beer fridge behind; a
  // jukebox, a pool table in a big room, booths, tables, the till.
  eatpub(L) {
    quota(L, EATERY.DENSITY.front);
    const c = L.c, deep = c.h >= 6;
    if (deep) L.run(["shelf", "coldcase", "beertower", "shelf", "beertower"], ["n"], { plain: () => full(L) });
    const row = counterRow(L, rowFrom(L, deep ? c.y0 + 2 : c.y0), "barcounter", { from: 1, to: deep ? 2 : 1 });
    stools(L, row);
    if (!L.has("beertower")) L.wall("beertower", { sides: ["w", "e"] }) || L.centre("beertower");
    checkout(L);
    L.wall("jukebox", { sides: ["w", "e"], prefer: "corner" });
    if (c.w * c.h >= 60) L.centre("pooltable");
    if (cuisine(L) === CUISINES.wings) some(L, "tvstand", 2, { sides: ["w", "e"] });
    booths(L, 2, ["w", "e", "s"]);
    dinerTables(L, 22, 2);
    fill(L, ["shelf", "coldcase"]);
  },
  // A brewpub's brewhouse: brewing tanks in rows, kegs (barrels), a shelf.
  eatbrew(L) {
    const c = L.c;
    for (let y = c.y0 + 1; y <= c.y1 - 1; y += 2) for (let x = c.x0 + 1; x <= c.x1 - 1; x += 2) if (L.ok(x, y)) L.place("brewtank", [[x, y]]);
    if (!L.has("brewtank")) L.need("brewtank");
    some(L, "barrel", 2, { prefer: "corner" });
    fill(L, ["shelf"]);
  },
  // A buffet hall: long steam tables down the middle, the salad bar, the dessert station (a pastry case and a soft-serve
  // machine against a wall), tables round them, the till.
  eatbuffet(L) {
    quota(L, EATERY.DENSITY.front);
    const c = L.c, n = Math.max(2, Math.floor(c.w / 5));
    // The buffet line: rows of steam tables (two cells each, a walk between) across the middle of the hall.
    const mid = c.y0 + Math.floor(c.h / 2), rows = c.h >= 12 ? [mid - 3, mid + 2] : [mid];
    let laid = 0;
    for (const y of rows) for (let x = c.x0 + 3; x + 1 <= c.x1 - 3 && laid < n; x += 3) if (L.ok(x, y) && L.ok(x + 1, y) && L.place("steamtable", [[x, y], [x + 1, y]])) laid++;
    for (let i = laid; i < 2; i++) L.centre("steamtable") || L.wall("steamtable", { sides: ["n"] });
    if (!L.has("steamtable")) L.need("steamtable");
    L.centre("saladbar") || L.need("saladbar");
    L.wall("pastrycase", P(L, { sides: ["n", "e", "w"], prefer: "corner" }));
    L.wall("softserve", { sides: ["n", "e", "w"], prefer: "corner" });
    frontPieces(L, ["saladbar"]);
    dinerTables(L, 14, 4);
    checkout(L);
    fill(L, ["pastrycase", "counter"]);
  },
  // A kiosk's counter (or a food truck's commissary counter): the counter with its till and the cuisine's case, a menu
  // board, a table to stand at.
  eatkiosk(L) {
    quota(L, EATERY.DENSITY.small);
    const c = L.c;
    counterRow(L, rowFrom(L, c.y0), "counter", { box: "checkout", every: 3, from: 0, to: 1 });
    if (!L.has("checkout")) checkout(L);
    frontPieces(L);
    menus(L, 1);
    tables(L, 1, 1) || L.wall("table") || L.need("table");
    fill(L, ["counter"]);
  },
  // A takeaway's pickup counter: the counter and its till, a menu board, chairs and a table to wait at.
  eatpickup(L) {
    quota(L, EATERY.DENSITY.small);
    const c = L.c;
    counterRow(L, rowFrom(L, c.y0), "counter", { box: "checkout", every: 4, from: 1, to: 1 });
    if (!L.has("checkout")) checkout(L);
    menus(L, 1);
    tables(L, 1, 2) || L.need("table");
    fill(L, ["counter"]);
  },
  // A banquet hall's ballroom: the stage at the back wall's middle, round tables of four to six, a bar along a side
  // wall with its till.
  eatballroom(L) {
    quota(L, EATERY.DENSITY.front);
    L.wall("stage", { sides: ["n"], prefer: "middle" }) || L.need("stage");
    L.run(["barcounter", "barcounter", "barcounter", "coldcase"], [L.variant(2, "bar") ? "e" : "w"], { plain: () => full(L) });
    checkout(L);
    dinerTables(L, 12, 4);
    fill(L, ["counter", "cabinet"]);
  },
  // A fast-food play area: the play structure, a table or two for the parents.
  eatplay(L) { L.centre("playplace") || L.need("playplace"); tables(L, 2, 2); fill(L, ["shelf"]); },
  // A private dining room: white-cloth tables pushed together with chairs round, a wine rack.
  eatprivate(L) { quota(L, EATERY.DENSITY.small); tables(L, Math.max(1, Math.floor((L.c.w * L.c.h) / 10)), 4, "clothtable"); L.wall("winerack", P(L)); fill(L, ["cabinet", "winerack"]); },
  // A wine cellar: wine racks round the walls.
  eatcellar(L) { quota(L, EATERY.DENSITY.dry); fill(L, ["winerack"]); if (!L.has("winerack")) L.need("winerack"); },
  // A BBQ's pit room: the smokers against the walls, a prep counter, shelves.
  eatpit(L) { quota(L, EATERY.DENSITY.small); some(L, "smoker", 2, { prefer: "corner" }); if (!L.has("smoker")) L.need("smoker"); L.wall("counter", P(L)); fill(L, ["shelf", "counter"]); },
  // The dry store: dry-goods shelving round the walls (sacks and tins of the cuisine's food).
  eatdry(L) { quota(L, EATERY.DENSITY.dry); fill(L, ["dryshelf"]); if (!L.has("dryshelf")) L.need("dryshelf"); },
  // The kitchen: the cuisine's cooking line along the walls, a range, a deep fryer where they fry, stainless counters, a
  // sink, the dish pit's dish machine, a fire extinguisher; the drive-through window in its side wall at fast food; a
  // second line of stations at fine dining, a takeaway, a banquet (a prep island and a second range); shelves.
  eatkitchen(L) {
    quota(L, EATERY.DENSITY.kitchen);
    const c = L.c, C = cuisine(L), ws = L.walls();
    if (!ws.length) return;
    if (L.room.drive) L.wall("drivewindow", { sides: [L.room.drive], prefer: "middle" }) || L.need("drivewindow", { sides: [L.room.drive] });
    // The pieces it must have first (a small kitchen fills up): the cuisine's signature, the range, the dish pit, the sink.
    const must = [...new Set([...C.sig.filter((k) => C.line.includes(k)), "range", "dishpit", "sink"])];
    const line = [...must, ...C.line.filter((k) => !must.includes(k)), ...(L.room.fry && !C.line.includes("fryer") ? ["fryer"] : []), "counter", "counter", "extinguisher"];
    L.run(line, ws.slice(0, 3).map((w) => w.side), { plain: () => full(L) });
    for (const k of must) if (!L.has(k)) L.need(k);
    if (!L.has("sink")) L.wall("sink");
    if (!L.has("extinguisher")) L.wall("extinguisher");
    if (L.room.stations && c.w * c.h >= 24) { L.centre("counter", P(L)); L.centre("range") || L.wall("range"); L.centre("steamtable"); }
    else if (c.w * c.h >= 16) L.centre("counter", P(L)); // the prep island
    fill(L, ["shelf", "counter"]);
  },
};
// Each style runs, then its booths take the place's colour (c.tint: ui/isoview.js draws the seats in it).
for (const [k, style] of Object.entries(EATERY_STYLES)) COMMERCIAL_STYLES[k] = (L) => { style(L); if (L.room.tint) for (const p of L.placed) if (p.k === "booth") for (const [x, y] of p.cells) L.c.cell(x, y).tint = L.room.tint; };

// ======================================================================================
// A restaurant's signs of survival (interiorscenes.js registerScene; only on a map laid out by these styles: an area
// carries its style as `shop`):
//   drivethru    the drive-through line: the cars still queued in the lane, their drivers dead at the wheel or by the
//                doors (blood on the lane's tarmac does not show: bodies only);
//   dinebarricade the dining room barricaded: tables and chairs shoved inside the front doors in a line (a gap left),
//                the one who held it behind with spent brass, the dead in front of it;
//   kitchenfire  a kitchen fire's aftermath: scorch on the floor round the line (c.scorch, ui/battlemarks.js), the
//                extinguisher emptied on the floor by it, a body now and then;
//   lastmeal     a last meal: a table still set, the diners dead at it (quiet: they took something, or the cold).
//   The walk-in freezer with someone shut inside is #22's freezershut, and the walk-in cold room #16's walkin (the same
//   styles): both now roll at the four food kinds' walk-ins too.
// ======================================================================================
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const FOOD = ["restaurant", "pizza", "diner", "bar"];
const eatRooms = (ctx, styles) => ctx.rng.shuffle(ctx.rooms.filter((r) => styles.includes(r.shop) && !r.scene && !r.locked));
const nearest = (cells, x, y) => cells.slice().sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y));
const eatStyled = (ctx) => ctx.rooms.some((r) => typeof r.shop === "string" && r.shop.startsWith("eat"));
const FRONTS = ["eatcounter", "eatline", "eatcafe", "eatdiner", "eatdining", "eatpub", "eatbuffet", "eatballroom"];

function driveThru(ctx) {
  const { rng, map } = ctx;
  const lane = (map.rooms || []).find((a) => a.outdoor && a.drive && a.cars && !a.scene);
  if (!lane) return null;
  lane.scene = { kind: "drivethru" };
  const cars = (map.containers || []).filter((c) => c.area === lane.id && c.kind === "car");
  let n = 0;
  for (const car of cars) {
    const side = [];
    for (let y = car.y; y < car.y + car.h; y++) for (const x of [car.x - 1, car.x + car.w]) { const c = ctx.at(0, x, y); if (c && c.k === "open" && !ctx.used(0, x, y)) side.push([x, y]); }
    if (!side.length) continue;
    const [x, y] = rng.pick(side);
    ctx.body(0, x, y, { human: true, quiet: rng.chance(0.3) });
    n++;
  }
  if (!n) return null;
  const [x, y] = [cars[0].x, cars[0].y];
  return ctx.done("drivethru", null, x, y, `The drive-through line never moved: ${cars.length === 1 ? "a car" : `${cars.length} cars`} still in the lane, ${n === 1 ? "a driver" : `${n} of their drivers`} dead beside ${cars.length === 1 ? "it" : "them"}.`);
}
function dineBarricade(ctx) {
  const { rng } = ctx;
  for (const r of eatRooms(ctx, FRONTS)) {
    const f = r.f || 0, doors = (r.doors || []).filter((d) => ctx.exit(d[0], d[1], f));
    if (!doors.length) continue;
    const [dx, dy] = rng.pick(doors);
    const ring = nearest(ctx.freeIn(r), dx, dy).filter(([x, y]) => Math.max(Math.abs(x - dx), Math.abs(y - dy)) === 2);
    if (ring.length < 3) continue;
    const gap = rng.int(0, ring.length - 1);
    ring.forEach(([x, y], i) => { if (i !== gap) ctx.piece(f, x, y, rng.pick(["table", "table", "chair", "counter"])); });
    const behind = nearest(ctx.freeIn(r).filter(([x, y]) => Math.max(Math.abs(x - dx), Math.abs(y - dy)) >= 3), dx, dy);
    if (behind.length) {
      const [bx, by] = behind[0];
      ctx.body(f, bx, by, { human: true });
      ctx.splatter(f, bx, by, "human", rng.int(1, 2));
      for (const [x, y] of behind.slice(1, 3)) { const c = ctx.at(f, x, y); c.brass = rng.int(SCENES.BRASS[0], SCENES.BRASS[1]); }
    }
    const front = nearest(ctx.freeIn(r).filter(([x, y]) => Math.max(Math.abs(x - dx), Math.abs(y - dy)) <= 1), dx, dy);
    const dead = Math.min(front.length, rng.int(1, 3));
    for (const [x, y] of front.slice(0, dead)) { ctx.body(f, x, y, {}); ctx.splatter(f, x, y, "zombie", rng.int(1, 2)); }
    return ctx.done("dinebarricade", r, dx, dy, `The ${String(r.name || "dining room").toLowerCase()} was barricaded: tables and chairs shoved inside the doors, ${dead ? `${dead} of the dead in front of them` : "a gap left to get out"}.`);
  }
  return null;
}
function kitchenFire(ctx) {
  const { rng } = ctx;
  for (const r of eatRooms(ctx, ["eatkitchen"])) {
    const f = r.f || 0, line = ctx.inner(r).filter(([x, y]) => ["range", "fryer", "flattop", "wokrange", "chargrill", "stockpot"].includes((ctx.at(f, x, y) || {}).k));
    if (!line.length) continue;
    const [lx, ly] = rng.pick(line);
    let burnt = 0;
    for (const [x, y] of ctx.inner(r)) { if (Math.hypot(x - lx, y - ly) > 2.5) continue; const c = ctx.at(f, x, y); if (c && ctx.floorCell(f, x, y)) { c.scorch = rng.int(1, 3); burnt++; } }
    const spot = nearest(ctx.freeIn(r), lx, ly)[0];
    if (spot) ctx.piece(f, spot[0], spot[1], "extinguisher");
    if (rng.chance(0.35)) { const b = nearest(ctx.freeIn(r), lx, ly)[0]; if (b) ctx.body(f, b[0], b[1], { human: true, quiet: true }); }
    return ctx.done("kitchenfire", r, lx, ly, `A fire went up the kitchen's line and burnt itself out: scorch across the floor, ${burnt > 6 ? "the walls black" : "the hood black"}, an emptied extinguisher on the tiles.`);
  }
  return null;
}
function lastMeal(ctx) {
  const { rng } = ctx;
  for (const r of eatRooms(ctx, ["eatdining", "eatprivate", "eatdiner", "eatcounter", "eatpub", "eatballroom", "eatbuffet"])) {
    const f = r.f || 0;
    const tabs = ctx.inner(r).filter(([x, y]) => ["table", "clothtable", "kbbqtable"].includes((ctx.at(f, x, y) || {}).k));
    for (const [tx, ty] of rng.shuffle(tabs)) {
      const seats = NEXT4.map(([dx, dy]) => [tx + dx, ty + dy]).filter(([x, y]) => ctx.free(f, x, y) || (ctx.at(f, x, y) || {}).k === "chair");
      const free = seats.filter(([x, y]) => ctx.free(f, x, y));
      if (free.length < 2) continue;
      const n = Math.min(free.length, rng.int(2, 4));
      for (const [x, y] of free.slice(0, n)) ctx.body(f, x, y, { human: true, quiet: true });
      return ctx.done("lastmeal", r, tx, ty, `A table still set for a last meal: plates, a bottle, ${n} of them dead in their seats round it.`);
    }
  }
  return null;
}
registerScene("drivethru", { w: 4, place: driveThru, kinds: FOOD, when: (ctx) => eatStyled(ctx) && (ctx.map.rooms || []).some((a) => a.outdoor && a.drive && a.cars) });
registerScene("dinebarricade", { w: 3, place: dineBarricade, kinds: FOOD, when: eatStyled });
registerScene("kitchenfire", { w: 2, place: kitchenFire, kinds: FOOD, when: eatStyled });
registerScene("lastmeal", { w: 2, place: lastMeal, kinds: FOOD, when: eatStyled });
// #22's freezer and #16's walk-in (the same styles: walkfreezer, walkin) roll at the four food kinds' walk-ins too.
for (const name of ["freezershut", "walkin"]) if (SCENE_KINDS[name]) SCENE_KINDS[name].kinds = [...new Set([...(SCENE_KINDS[name].kinds || []), ...FOOD])];
export const EAT_SCENES = ["drivethru", "dinebarricade", "kitchenfire", "lastmeal", "freezershut", "walkin"];
