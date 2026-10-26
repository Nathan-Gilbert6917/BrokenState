// @ts-check
// The amusement parks' buildings and rooms (issue #60 of the round-2 epic #39; the user's request 2026-10-26:
// "amusement parks"): the floor plans of the small buildings a park is made of (amusement.js lays them out on one map
// with its rides, its paths and its lots, on compound.js), their room roles (PARK_ROLES, merged into buildingmaps.js
// ROLES), the styles that furnish them (PARK_STYLES, by a plan leaf's pk mark; parkStyle, run by buildingmaps.js
// assemble) on roomlayout.js's placement helpers (lanes kept clear, backs to the walls, the lootable pieces the
// containers), and the parks' signs of survival (interiorscenes.js registerScene, each with a when: only a park's map).
//
// The buildings (PARK_PLANS, by kind; every one built facing +y, its front door on the path):
//   stand      a concession stand: the counter with the popcorn machine, a fryer or a soft-serve machine, the chest
//              freezer, the shelves of snacks (AREAS concession: snacks and drinks, candy), a store room behind.
//   booth      a games booth of the midway: its counter across the front, the prize shelves round the walls (AREAS
//              midway: the stuffed prize bears, candy), a ring-toss table.
//   gift       the gift shop: shelves and racks, the checkout, a stock room and an office behind.
//   aid        the first-aid station: a cot and an exam bed, the medicine cabinets (AREAS parkaid), a nurse's office.
//   maint      the maintenance shop: a bay with the workbench, the tool chest, the compressor and an engine stand
//              (AREAS ridemaint: tools and parts), a parts store, the fuel store (drums: fuel for the generators and the
//              karts) behind a steel door.
//   admin      guest services and the cash office (a locked room: the safe's cash box), the park office; upstairs on
//              two storeys the managers' offices.
//   staff      the employee area: the lounge (a table, a fridge, a microwave, the vending machine), the locker room.
//   station    a ride's station: the load platform with its turnstile and queue posts, the operator's booth (the
//              control panel). The ride itself stands outside (amusement.js: its track, its wheel, its cups).
//   pavilion   a covered ride hall: bumper cars on their floor, or a carousel's.
//   arcade     the arcade (its cabinets, as a mall's: malllayout.js) and its prize counter.
//   hall       a fair's exhibition hall: display cases and cloth tables of jams, quilts and pies (AREAS exhibit).
//   barn       a fair's livestock barn: pens of hay bales and crates (AREAS barn).
//   changing   a water park's changing rooms and lockers, the lifeguards' first-aid room.
//   jumphall   a trampoline park's hall: the trampoline courts, the café, the party room, the front desk, first aid.
// Older saves: none of these buildings existed before, so there is nothing to keep.
import { registerScene, SCENES, scenePieces } from "./interiorscenes.js";

// ---------- the rooms ----------
const role = (name, type, extra = {}) => ({ name, type, furnish: "none", ...extra });
export const PARK_ROLES = {
  pkstand:   role("Concession stand", "concession", { hub: true, fl: "lino", maxBoxes: 3 }),
  pkbooth:   role("Games booth", "midway", { hub: true, fl: "plank", maxBoxes: 3 }),
  pkgift:    role("Gift shop", "giftshop", { hub: true, fl: "tile", maxBoxes: 5 }),
  pkaid:     role("First-aid station", "parkaid", { fl: "lino", maxBoxes: 3 }),
  pkshop:    role("Maintenance shop", "ridemaint", { hub: true, fl: "conc", maxBoxes: 5 }),
  pkfuel:    role("Fuel store", "parkfuel", { fl: "conc", windows: false, maxBoxes: 3 }),
  pkcash:    role("Cash office", "cashoffice", { fl: "carpet", windows: false, maxBoxes: 2 }),
  pkstaff:   role("Employee lounge", "parkstaff", { fl: "lino", maxBoxes: 4 }),
  pkstation: role("Ride station", "ridestation", { hub: true, fl: "steel", maxBoxes: 2 }),
  pkcontrol: role("Operator's booth", "ridestation", { fl: "steel", maxBoxes: 1 }),
  pkride:    role("Ride hall", null, { hub: true, fl: "steel" }),
  pkhall:    role("Exhibition hall", "exhibit", { hub: true, fl: "conc", maxBoxes: 6 }),
  pkbarn:    role("Livestock barn", "barn", { hub: true, fl: "barn", maxBoxes: 4 }),
  pkchange:  role("Changing room", "parkstaff", { fl: "tile", windows: false, maxBoxes: 3 }),
  pkcourt:   role("Trampoline court", null, { hub: true, fl: "rubber" }),
};

// ---------- the plans ----------
const leaves = (list) => list.map(([s, r]) => [s, typeof r === "string" ? { role: r } : r]);
const R = (role, name, pk, extra = {}) => ({ role, name, pk, ...extra });
const range = (rng, [a, b]) => rng.int(a, b);
const back = (side = "back", lock = 0.4, o = {}) => ({ side, roles: null, chance: 1, lock, name: "Service door", ...o });
// A plan's spec for compound.js (a ring of one cell, no ground of its own: the park's round it).
const spec = (bw, bh, program, o = {}) => ({ bw, bh, front: { width: o.fw || 1 }, ground: "none", margins: { front: 1, back: 1, left: 1, right: 1 }, storeys: o.storeys || 1, foot: o.foot || "small", program, exits: o.exits || [], ...(o.upper ? { upper: o.upper, stairs: o.stairs || { roles: ["corridor", "lobby"], n: 1, len: 2 } } : {}) });

/** @type {Record<string, (rng: any, o?: any) => any>} */
export const PARK_PLANS = {
  stand(rng, o = {}) {
    const bw = range(rng, [8, 11]), bh = range(rng, [6, 8]);
    return spec(bw, bh, { split: "x", parts: leaves([["*", R("pkstand", o.name || "Concession stand", "stand", { entry: true })], [3, R("storage", "Stand store room", "store", { type: "concession", maxBoxes: 1 })]]) }, { exits: [back("back", 0.5)] });
  },
  booth(rng, o = {}) {
    const bw = range(rng, [6, 9]), bh = range(rng, [5, 6]);
    return spec(bw, bh, R("pkbooth", o.name || "Games booth", "booth", { entry: true }), { fw: 2 });
  },
  gift(rng, o = {}) {
    const bw = range(rng, [14, 20]), bh = range(rng, [10, 13]);
    return spec(bw, bh, { split: "y", parts: [["*", R("pkgift", o.name || "Gift shop", "gift", { entry: true })], [4, { split: "x", parts: leaves([["*", R("storage", "Gift shop stock room", "store", { type: "giftshop", maxBoxes: 2 })], [5, R("office", "Shop office", "office", { type: "cashoffice", maxBoxes: 1, boxLock: ["safe", 0.5] })]]) }]] }, { fw: 2, foot: "medium", exits: [back("back", 0.5)] });
  },
  aid(rng, o = {}) {
    const bw = range(rng, [10, 13]), bh = range(rng, [8, 10]);
    return spec(bw, bh, { split: "y", parts: [[4, { split: "x", parts: leaves([["*", R("pkaid", "Nurse's office", "nurse")], [4, { role: "restroom" }]]) }], ["*", R("pkaid", o.name || "First-aid station", "aid", { entry: true, hub: true })]] });
  },
  maint(rng, o = {}) {
    const bw = range(rng, [22, 30]), bh = range(rng, [14, 18]);
    const rest = ["*", { split: "y", parts: leaves([["*", R("storage", "Parts store", "parts", { type: "ridemaint", maxBoxes: 3 })], ["*", R("pkfuel", "Fuel store", "fuel", { lock: ["door", 0.4], dk: "steel" })]]) }];
    return spec(bw, bh, { split: "x", parts: [[0.55, R("pkshop", o.name || "Maintenance shop", "shop", { entry: true })], rest] }, { foot: "medium", exits: [{ side: "front", roles: ["pkshop"], chance: 1, roller: true, width: 3, lock: 0.3, name: "Shop door" }, back("back", 0.5)] });
  },
  admin(rng, o = {}) {
    const bw = range(rng, [16, 22]), bh = range(rng, [12, 14]), storeys = o.storeys || 1;
    const front = { split: "x", parts: leaves([["*", R("lobby", "Guest services", "guest", { entry: true, type: "cashoffice", maxBoxes: 1 })], [6, R("office", "Park office", "office", { type: "parkstaff", maxBoxes: 2 })]]) };
    const backRow = { split: "x", parts: leaves([["*", R("pkcash", "Cash office", "cash", { lock: ["door", 0.7], dk: "steel", boxLock: ["safe", 0.8] })], [5, { role: "restroom" }]]) };
    const upper = () => ({ split: "y", parts: [["*", { split: "x", parts: leaves([["*", R("office", "General manager's office", "office", { type: "cashoffice", maxBoxes: 2, boxLock: ["safe", 0.4] })], ["*", R("office", "Operations office", "office", { type: "parkstaff", maxBoxes: 2 })]]) }], [2, { role: "corridor" }], ["*", { split: "x", parts: leaves([["*", R("pkstaff", "Staff room", "staff")], ["*", R("office", "Security office", "office", { type: "parkstaff", maxBoxes: 2 })]]) }]] });
    return spec(bw, bh, { split: "y", parts: [["*", backRow], [2, { role: "corridor" }], ["*", front]] }, { foot: "medium", storeys, ...(storeys > 1 ? { upper } : {}), exits: [back("back", 0.6)] });
  },
  staff(rng, o = {}) {
    const bw = range(rng, [14, 18]), bh = range(rng, [10, 12]);
    return spec(bw, bh, { split: "y", parts: [[5, { split: "x", parts: leaves([["*", R("pkchange", "Employee locker room", "lockers")], [4, { role: "restroom" }]]) }], ["*", R("pkstaff", o.name || "Employee lounge", "staff", { entry: true, hub: true })]] }, { exits: [back("back", 0.4)] });
  },
  station(rng, o = {}) {
    const bw = range(rng, [10, 14]), bh = range(rng, [7, 9]);
    return spec(bw, bh, { split: "x", parts: leaves([["*", R("pkstation", `${o.ride || "Ride"} station`, "station", { entry: true })], [4, R("pkcontrol", "Operator's booth", "control")]]) }, { fw: 2, exits: [{ side: "back", roles: ["pkstation"], chance: 1, lock: 0, width: 2, name: "Exit ramp" }] });
  },
  pavilion(rng, o = {}) {
    const bw = range(rng, [20, 26]), bh = range(rng, [14, 18]);
    return spec(bw, bh, { split: "x", parts: leaves([["*", R("pkride", o.name || "Bumper cars", o.ride || "bumper", { entry: true })], [4, R("pkcontrol", "Operator's booth", "control")]]) }, { fw: 2, foot: "medium", exits: [{ side: "left", roles: ["pkride"], chance: 0.8, lock: 0.2 }] });
  },
  arcade(rng, o = {}) {
    const bw = range(rng, [16, 22]), bh = range(rng, [12, 15]);
    return spec(bw, bh, { split: "y", parts: [["*", R("arcade", o.name || "Arcade", "arcade", { entry: true, lay: "arcade" })], [4, R("pkbooth", "Prize counter", "prizes")]] }, { fw: 2, foot: "medium", exits: [back("back", 0.5)] });
  },
  hall(rng, o = {}) {
    const bw = range(rng, [30, 40]), bh = range(rng, [18, 24]);
    return spec(bw, bh, { split: "x", parts: leaves([["*", R("pkhall", o.name || "Exhibition hall", "hall", { entry: true })], [5, { split: "y", parts: leaves([["*", R("office", "Fair office", "office", { type: "cashoffice", maxBoxes: 1, boxLock: ["safe", 0.5] })], [4, { role: "restroom" }]]) }]]) }, { fw: 2, foot: "large", exits: [{ side: "left", roles: ["pkhall"], chance: 1, lock: 0.3, width: 2 }, { side: "right", roles: ["pkhall"], chance: 0.7, lock: 0.3 }] });
  },
  barn(rng, o = {}) {
    const bw = range(rng, [24, 32]), bh = range(rng, [12, 16]);
    return spec(bw, bh, { split: "x", parts: leaves([["*", R("pkbarn", o.name || "Livestock barn", "barn", { entry: true })], [5, R("storage", "Feed room", "feed", { type: "barn", maxBoxes: 2 })]]) }, { fw: 3, foot: "medium", exits: [{ side: "back", roles: ["pkbarn"], chance: 1, roller: true, width: 3, lock: 0.2, name: "Barn door" }] });
  },
  changing(rng, o = {}) {
    const bw = range(rng, [18, 24]), bh = range(rng, [10, 12]);
    return spec(bw, bh, { split: "x", parts: leaves([["*", R("pkchange", "Men's changing room", "lockers")], [6, R("pkaid", "Lifeguard station", "aid", { entry: true, hub: true })], ["*", R("pkchange", "Women's changing room", "lockers")]]) }, { fw: 2, foot: "medium" });
  },
  jumphall(rng, o = {}) {
    const bw = range(rng, [64, 84]), bh = range(rng, [46, 60]);
    const frontRow = { split: "x", parts: leaves([["*", R("pkstand", "Café", "stand")], [10, R("pkstaff", "Party room", "staff")], ["*", R("lobby", "Front desk", "guest", { entry: true, type: "cashoffice", maxBoxes: 1, boxLock: ["safe", 0.5] })], [8, R("pkaid", "First aid", "aid")], [5, R("pkcash", "Cash office", "cash", { lock: ["door", 0.6], dk: "steel", boxLock: ["safe", 0.8] })], [4, { role: "restroom" }]]) };
    return spec(bw, bh, { split: "y", parts: [["*", R("pkcourt", o.name || "Trampoline court", "court")], [10, frontRow]] }, { fw: 2, foot: "large", storeys: o.storeys || 1, exits: [{ side: "back", roles: ["pkcourt"], chance: 1, lock: 0.4, name: "Fire exit" }, { side: "left", roles: ["pkcourt"], chance: 1, lock: 0.4, name: "Fire exit" }] });
  },
};

// ---------- the styles ----------
/** @typedef {any} Lay */
const full = (L) => L.boxes() >= L.target();
const top = (L, kinds) => { for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) if (L.wall(kinds[i % kinds.length], { prefer: "corner" })) miss = 0; else miss++; };
const many = (L, k, n, o = {}) => { let got = 0; for (let i = 0; i < n; i++) if (L.wall(k, o)) got++; return got; };
/** @type {Record<string, (L: Lay) => void>} */
export const PARK_STYLES = {
  // The counter along the back with the machines on it, the freezer, the snack shelves.
  stand(L) {
    L.wall("counter", { sides: ["n"], prefer: "middle", plain: full(L) });
    L.wall(["concession", "fryer", "softserve"][L.variant(3, "machine")], { sides: ["n"], prefer: "middle" });
    L.wall("freezer", { prefer: "corner", plain: full(L) });
    top(L, ["shelf", "counter"]);
    L.wall("menuboard", {});
  },
  store(L) { top(L, ["shelf", "crate"]); },
  // The prize shelves round the walls, the counter across the open front.
  booth(L) {
    many(L, "shelf", 2, { sides: ["n", "e", "w"], prefer: "corner" });
    L.wall("counter", { sides: ["s"], prefer: "middle", plain: full(L) });
    top(L, ["shelf"]);
    L.centre("table", {});
  },
  prizes(L) { L.wall("counter", { sides: ["s"], prefer: "middle" }); top(L, ["shelf"]); },
  gift(L) {
    L.wall("checkout", { sides: ["s"], prefer: "corner" });
    many(L, "clothesrack", 2, { prefer: "middle" });
    top(L, ["shelf", "shelf", "counter"]);
  },
  office(L) {
    const d = L.wall("desk", { prefer: "middle" }) || L.centre("desk", {});
    if (d) L.around(d, "chair", 1);
    top(L, ["cabinet", "filing"]);
    if (L.room.boxLock) L.wall("safe", { prefer: "corner" });
  },
  guest(L) { L.wall("counter", { sides: ["n"], prefer: "middle", plain: full(L) }); L.wall("stanchion", {}); top(L, ["cabinet"]); L.wall("vending", { prefer: "corner", plain: true }); },
  cash(L) { L.wall("safe", { prefer: "corner" }); const d = L.wall("desk", { prefer: "middle" }); if (d) L.around(d, "chair", 1); top(L, ["cabinet", "counter"]); },
  nurse(L) { L.wall("desk", { prefer: "middle" }); top(L, ["medcab", "cabinet"]); },
  aid(L) {
    L.wall("exambed", { prefer: "corner" }) || L.wall("cot", { prefer: "corner" });
    L.wall("cot", { prefer: "corner" });
    top(L, ["medcab", "cabinet", "shelf"]);
  },
  shop(L) {
    L.wall("workbench", { prefer: "middle" });
    L.wall("toolchest", { prefer: "corner", plain: full(L) });
    L.wall("compressor", { prefer: "corner" });
    L.centre("enginestand", {});
    top(L, ["crate", "locker", "shelf"]);
  },
  parts(L) { top(L, ["shelf", "crate"]); },
  fuel(L) { many(L, "drum", 3, { prefer: "corner" }); top(L, ["crate"]); },
  staff(L) {
    L.wall("fridge", { prefer: "corner", plain: true });
    L.wall("microwave", {});
    L.wall("vending", { prefer: "corner", plain: true });
    const t = L.centre("table", {});
    if (t) L.around(t, "chair", 3);
    top(L, ["locker", "cabinet"]);
  },
  lockers(L) { many(L, "locker", 3, { prefer: "corner" }); L.centre("campusbench", {}); top(L, ["locker"]); },
  // The load platform: the turnstile, the queue posts, a cabinet of the ride's spares.
  station(L) {
    L.wall("turnstile", { sides: ["s"] });
    many(L, "stanchion", 3, { prefer: "middle" });
    top(L, ["cabinet", "locker"]);
  },
  control(L) { L.wall("ctrlpanel", { prefer: "middle" }); L.wall("chair", {}); top(L, ["cabinet"]); },
  bumper(L) {
    const c = L.c;
    for (let y = c.y0 + 2; y <= c.y1 - 2; y += 3) for (let x = c.x0 + 2; x <= c.x1 - 2; x += 3) if (L.variant(3, `bc${x},${y}`)) L.place("bumpercar", [[x, y]], { face: "s" });
  },
  carousel(L) { const c = L.c, x = Math.floor((c.x0 + c.x1) / 2), y = Math.floor((c.y0 + c.y1) / 2); L.place("carousel", [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]], { face: "s" }); },
  // The arcade: cabinets along the walls (the ones past the room's share plain), the change counter.
  arcade(L) {
    for (let i = 0, miss = 0; !full(L) && miss < 2; i++) if (L.wall("arcadecab", { prefer: "corner" })) miss = 0; else miss++;
    for (let i = 0; i < 6; i++) if (!L.wall("arcadecab", { plain: true })) break;
    L.wall("counter", { sides: ["n"], plain: full(L) });
  },
  hall(L) {
    const c = L.c;
    for (let y = c.y0 + 2; y <= c.y1 - 2; y += 4) for (let x = c.x0 + 2; x + 1 <= c.x1 - 2; x += 5) L.place(L.variant(2, `ht${x},${y}`) ? "clothtable" : "displaycase", [[x, y]], { face: "s" });
    top(L, ["shelf", "counter"]);
  },
  barn(L) {
    const c = L.c;
    for (let x = c.x0 + 1; x <= c.x1 - 1; x += 3) { L.place("hay", [[x, c.y0]], {}); L.place("hay", [[x, c.y1]], {}); }
    top(L, ["crate", "shelf"]);
  },
  feed(L) { top(L, ["crate", "shelf"]); L.wall("barrel", {}); },
  court(L) {
    const c = L.c;
    for (let y = c.y0 + 2; y + 1 <= c.y1 - 2; y += 4) for (let x = c.x0 + 2; x + 1 <= c.x1 - 2; x += 4) L.place("trampoline", [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]], { face: "s" });
  },
};
/** The park style for a room (buildingmaps.js assemble): its plan leaf's pk mark, else null. @param {any} room */
export function parkStyle(room) {
  return room && room.pk && PARK_STYLES[room.pk] ? PARK_STYLES[room.pk] : null;
}

// ======================================================================================
// The parks' signs of survival (interiorscenes.js registerScene; their own dice there):
//   stalledride  a ride stopped where the power died: the dead still strapped in its cars or slumped round its wheel
//                on the grounds, a ride operator's body by the controls' building, blood (the issue's stalled rides).
//   stationstand a last stand in a ride's station: the pieces shoved across its doors, spent brass behind them, a
//                defender's body inside, the dead piled at the doors.
// ======================================================================================
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const AROUND = [...NEXT4, [1, 1], [1, -1], [-1, 1], [-1, -1]];
const isPark = (ctx) => !!(ctx.map && ctx.map.plan && ctx.map.plan.park);
export const PARK_SCENE = { RIDE_DEAD: [2, 5], STAND_DEAD: [3, 6], BRASS: [3, 9] };

function stalledRide(ctx) {
  const { rng } = ctx;
  const rides = rng.shuffle((ctx.map.rooms || []).filter((a) => a.outdoor && a.ride && !a.scene));
  for (const a of rides) {
    const near = [];
    for (let y = a.y0; y < a.y0 + a.h; y++) for (let x = a.x0; x < a.x0 + a.w; x++) {
      if (!ctx.free(0, x, y)) continue;
      if (AROUND.some(([dx, dy]) => /^(coastertrack|coastercar|ferriswheel|teacup|waterslide|carousel)$/.test((ctx.at(0, x + dx, y + dy) || {}).k))) near.push([x, y]);
    }
    if (near.length < 4) continue;
    const n = Math.min(near.length - 1, rng.int(PARK_SCENE.RIDE_DEAD[0], PARK_SCENE.RIDE_DEAD[1]));
    const spots = rng.shuffle(near).slice(0, n + 1);
    for (let i = 0; i < n; i++) { const [x, y] = spots[i]; ctx.body(0, x, y, {}); ctx.splatter(0, x, y, "zombie", rng.int(1, 2)); }
    const [hx, hy] = spots[n];
    ctx.body(0, hx, hy, { human: true }); ctx.splatter(0, hx, hy, "human", 2);
    a.scene = { kind: "stalledride" };
    return ctx.done("stalledride", null, hx, hy, `The ${a.name} stopped where the power died. The riders never got off: the dead are still slumped round it.`, { ride: a.id });
  }
  return null;
}
function stationStand(ctx) {
  const { rng } = ctx;
  for (const r of rng.shuffle(ctx.rooms.filter((q) => q.role === "pkstation" && !q.scene && (q.doors || []).length))) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (free.length < 4) continue;
    const ins = [], outs = [];
    for (const [dx, dy] of r.doors) for (const [ox, oy] of NEXT4) {
      const x = dx + ox, y = dy + oy, inR = x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1;
      const c = ctx.at(f, x, y), bare = !!c && c.k === "open" && !ctx.used(f, x, y) && !ctx.stair(x, y); // by a door: ctx.free keeps a door's sides, a stand takes them
      if (inR && bare) ins.push([x, y]); else if (!inR && bare) outs.push([x, y]);
    }
    if (!ins.length) continue;
    const ks = scenePieces(r, rng, ins.length, { half: true });
    ins.forEach(([x, y], i) => ctx.piece(f, x, y, ks[i]));
    const behind = rng.shuffle(ctx.freeIn(r)).slice(0, 4);
    for (const [x, y] of behind.slice(0, 3)) ctx.at(f, x, y).brass = rng.int(PARK_SCENE.BRASS[0], PARK_SCENE.BRASS[1]);
    if (behind[3]) { const [x, y] = behind[3]; ctx.body(f, x, y, { human: true }); ctx.splatter(f, x, y, "human", 2); }
    const n = rng.int(PARK_SCENE.STAND_DEAD[0], PARK_SCENE.STAND_DEAD[1]);
    for (const [x, y] of rng.shuffle(outs).slice(0, n)) { ctx.body(f, x, y, {}); ctx.splatter(f, x, y, "zombie", 1); }
    return ctx.done("stationstand", r, r.doors[0][0], r.doors[0][1], `Someone made a last stand in the ${r.name.replace(/,.*$/, "").toLowerCase()}: the queue rails and the benches shoved across the doors, spent brass behind them, the dead piled outside.`);
  }
  return null;
}
export const PARK_SCENES = ["stalledride", "stationstand"];
// Registered on the first park map (amusement.js parkMap), not at load: this module is reached from buildingmaps.js
// while interiorscenes.js may still be loading (combat.js → interiorscenes.js → … → buildingmaps.js), so its tables are
// not there yet. Every park's scenes are rolled after its map is made, so they are always registered in time.
let registered = false;
export function registerParkScenes() {
  if (registered) return;
  registered = true;
  registerScene("stalledride", { w: 4, place: stalledRide, when: isPark });
  registerScene("stationstand", { w: 3, place: stationStand, when: isPark });
  SCENES.ODDS.amusement = SCENES.ODDS.amusement ?? 0.9;
  SCENES.COUNT_BY.amusement = SCENES.COUNT_BY.amusement || [0.7, 0.4]; // many rides and buildings: more of them
}
