// Hotel shape variants (issue #50 of the round-2 epic #39, the user's request 2026-10-26: "Hotel shape variants"):
// eight of the 48 hotel variants (data-hotels.js) stand in footprints of their own in a new save (hotellayout.js
// SHAPES, #23's shapeOf): an L-shaped motor inn, a T conference hotel with its ballroom wing, a U round a pool
// courtyard, an E-plan golf resort, a crescent beach resort, a podium-and-tower, twin towers on a podium, a courtyard
// block round the Palm Court.
// - every shaped variant over several seeds: its shape, its box within its REAL_SIZE sizes row, 2+ parts, its name;
//   every room and every walkable cell reached; the hotel's own rooms (the front desk, its key rack and locked safe,
//   guest rooms with beds and en suites, housekeeping on every guest floor, the laundry, the kitchen and its walk-in)
//   and the variant's own (the same as its rectangle's: tools/hotelvarianttest.js VARIANT_ROOMS); its grounds
// - corridors follow the wings: every guest wing's corridor opens onto a lift lobby (a junction's, a crescent's
//   joint's); its stair runs all placed (spec.stairs.n), each in a stairwell
// - each a plan of its own: its footprint not its box, its plan signature not its rectangle's
// - loot a floor cell (the built cells of every floor) within ×0.8–×1.25 of its rectangle's
// - older saves: no shapes asked (an older save: save.js shapesLegacy) the 48 rectangles cell for cell as before the
//   shapes (a hash of them taken on dev at de58b4c); the other 40 variants the same with shapes asked
// - in the game: a new world's hotel of a shaped variant is shaped (a tower 4 floors built, its penthouse on the top
//   one), an older save's the rectangle; the map within 200 × 200; the time a map takes
// Usage: node tools/hotelshapetest.js [seed]
import { createHash } from "node:crypto";
import { createWorld } from "../src/sim/world.js";
import { Rng } from "../src/sim/rng.js";
import { BUILDINGS, assemble, buildingMap } from "../src/sim/buildingmaps.js";
import { HOTEL_VARIANTS, hotelVariantById } from "../src/sim/data-hotels.js";
import { REAL_SIZE, sizeOf } from "../src/sim/data-buildingsize.js";
import { FRANCHISES } from "../src/sim/data-shops.js";
import { CELL, AREAS, boxLoot } from "../src/sim/combat.js";
import { GEAR, supValue } from "../src/sim/data.js";

const QUICK = !!process.env.BS_QUICK;
const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = performance.now();

// The shaped variants, their shapes and their own rooms (as their rectangles': tools/hotelvarianttest.js).
const SHAPED = {
  "biz-highway": ["L", ["indoorpool", "breakfast", "hotelgym"]],
  "biz-conference": ["T", ["ballroom", "atrium", "conference", "loading"]],
  "res-family": ["U", ["kidsclub", "arcade", "buffet", "hotelgym"]],
  "res-golf": ["E", ["giftshop", "barroom", "bootroom", "cartbarn"]],
  "res-beach": ["crescent", ["giftshop", "barroom", "beachstore", "buffet", "spa"]],
  "tow-podium": ["podium", ["giftshop", "buffet", "chemist", "barber", "penthouse"]],
  "tow-twin": ["twin", ["atrium", "penthouse", "parking"]],
  "tow-grand": ["courtyard", ["barber", "library", "arcade", "spa", "ballroom", "penthouse"]],
};
const GROUNDS = { "res-family": ["Pool deck", "Tennis court"], "res-golf": ["Pool deck"], "res-beach": ["Pool deck"] };
const GUEST = ["guestroom", "studio"];

const make = (o, s) => {
  const rng = new Rng(seed * 100003 + s * 7919);
  const spec = BUILDINGS.hotel.make(rng, o);
  const m = assemble(rng, spec, { key: "hotel", name: "Hotel", withVehicle: s % 2 === 1 });
  return { spec, m };
};
function walkFrom(m, starts, cells) {
  const W = m.w, H = m.h, seen = new Uint8Array(W * H), q = starts.map(([x, y]) => y * W + x);
  const pass = (c) => CELL[c.k].walk || c.k === "door";
  for (const i of q) seen[i] = 1;
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
// #32's plan signature (tools/hotelvarianttest.js): the room roles, the role pairs with a door between them, the ways out, the footprint class.
function signature(spec, m) {
  const rooms = m.rooms.filter((a) => !a.outdoor);
  const roles = [...new Set(rooms.map((a) => a.role))].sort();
  const byDoor = new Map();
  for (const a of rooms) for (const d of a.doors || []) { const k = `${a.f || 0}:${d[0]},${d[1]}`; const l = byDoor.get(k) || []; l.push(a.role); byDoor.set(k, l); }
  const adj = new Set();
  for (const l of byDoor.values()) if (l.length >= 2) adj.add([...l].sort().join("-"));
  return `${roles.join(",")}|${[...adj].sort().join(",")}|${1 + (m.exits || []).filter((e) => e.zone >= 0).length}|${spec.foot}`;
}
const grids = (m) => m.floors || [{ cells: m.cells }];
const builtCells = (m) => grids(m).reduce((t, F) => t + F.cells.filter((c) => c.f === "floor").length, 0);

// ---------- 1. every shaped variant ----------
section("Every shaped variant (a new save's), pinned: its shape, reached, its rooms");
const N = QUICK ? 3 : 6;
for (const [id, [kind, own]] of Object.entries(SHAPED)) {
  const v = hotelVariantById(id), R = sizeOf(`hotel${v.kind}`, id), errs = [];
  let rooms0 = 0, junctions = 0;
  const dims = [];
  for (let s = 0; s < N; s++) {
    let spec, m;
    try { ({ spec, m } = make({ plan: id, shapes: true }, 1000 + s)); } catch (e) { errs.push(`seed ${s}: ${e.message}`); continue; }
    const tag = `seed ${s}`, b = m.plan.building;
    dims.push(`${spec.bw}×${spec.bh}`);
    if (!spec.shape || spec.shape.kind !== kind || !b.parts || b.parts.length < 2) errs.push(`${tag}: shape ${spec.shape ? spec.shape.kind : "none"}`);
    if (spec.vid !== id || m.plan.variant !== v.name || spec.hotel !== v.kind) errs.push(`${tag}: name ${m.plan.variant}`);
    if (spec.bw < R.w[0] || spec.bw > R.w[1] || spec.bh < R.d[0] || spec.bh > R.d[1]) errs.push(`${tag}: ${spec.bw}×${spec.bh} out of its sizes row`);
    if (m.w > 200 || m.h > 200) errs.push(`${tag}: map ${m.w}×${m.h}`);
    const G = grids(m), at = (f, x, y) => G[f].cells[y * m.w + x];
    const inside = (a) => { const out = []; for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) out.push(at(a.f || 0, x, y).k); return out; };
    const rooms = m.rooms.filter((a) => !a.outdoor), shop = (k) => rooms.filter((a) => a.shop === k);
    rooms0 += rooms.length;
    // Reached: the ground floor from the front zone, a floor up from its stairs.
    const z0 = m.zones[0];
    const reach = G.map((F, f) => walkFrom(m, f === 0 ? [[z0.x0 + 1, z0.y0 + 1]] : [m.stairs[0]], F.cells));
    for (const r of rooms) {
      let any = false;
      for (let y = r.y0 + 1; y < r.y0 + r.h - 1 && !any; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) if (reach[r.f || 0][y * m.w + x]) { any = true; break; }
      if (!any) errs.push(`${tag}: ${r.name} (floor ${r.f || 0}) not reached`);
    }
    G.forEach((F, f) => { let cut = 0; for (let i = 0; i < m.w * m.h; i++) if ((CELL[F.cells[i].k].walk || F.cells[i].k === "door") && !reach[f][i]) cut++; if (cut) errs.push(`${tag}: floor ${f}: ${cut} cells cut off`); });
    if (rooms.some((a) => !a.shop && !["corridor", "stairwell"].includes(a.role))) errs.push(`${tag}: unstyled ${rooms.filter((a) => !a.shop && !["corridor", "stairwell"].includes(a.role)).map((a) => a.name).slice(0, 3).join(", ")}`);
    // The hotel's own.
    const lobby = shop("hotellobby").find((a) => (a.f || 0) === 0);
    if (!lobby || !inside(lobby).includes("frontdesk") || !inside(lobby).includes("keyrack")) errs.push(`${tag}: no reception desk and key rack on the ground floor`);
    else if (!m.containers.some((c) => c.area === lobby.id && c.kind === "safe" && c.lockKind)) errs.push(`${tag}: no locked safe at the front desk`);
    const guest = rooms.filter((a) => GUEST.includes(a.shop));
    if (guest.length < 10) errs.push(`${tag}: ${guest.length} guest rooms`);
    for (const r of guest) {
      if (!inside(r).includes("bed")) errs.push(`${tag}: ${r.name} has no bed`);
      const bath = rooms.find((a) => a.shop === "ensuite" && a.unit && a.unit === r.unit);
      if (!bath) { errs.push(`${tag}: ${r.name} has no en suite`); continue; }
      const k = inside(bath);
      if (!k.includes("toilet") || !k.includes("sink") || !(k.includes("bathtub") || k.includes("shower"))) errs.push(`${tag}: ${bath.name} lacks a toilet, a sink or a tub`);
    }
    if (new Set(guest.map((r) => `${r.f || 0}:${r.name}`)).size !== guest.length) errs.push(`${tag}: two guest rooms of one number on a floor`);
    for (const f of new Set(guest.map((r) => r.f || 0))) if (!shop("housekeeping").some((a) => (a.f || 0) === f && inside(a).includes("linencart"))) errs.push(`${tag}: floor ${f} has no housekeeping`);
    if (!shop("hotellaundry").some((a) => inside(a).includes("washer") && inside(a).includes("dryer"))) errs.push(`${tag}: no laundry`);
    if (!shop("galley").some((a) => inside(a).includes("range"))) errs.push(`${tag}: no kitchen with its range`);
    if (!shop("walkin").length) errs.push(`${tag}: no walk-in`);
    if (v.kind === "tower" && !shop("penthouse").some((a) => (a.f || 0) === m.storeys - 1)) errs.push(`${tag}: no penthouse on the top floor`);
    if (shop("liftlobby").length && !shop("liftlobby").every((a) => inside(a).includes("liftdoor"))) errs.push(`${tag}: a lift lobby with no lift doors`);
    for (const k of own) if (!shop(k).length) errs.push(`${tag}: no ${k}`);
    for (const n of GROUNDS[id] || []) if (!m.rooms.some((a) => a.outdoor && a.name === n)) errs.push(`${tag}: no ${n} in the grounds`);
    if (id === "res-family") { // the pool in the courtyard: between the wings, behind the main block
      const deck = m.rooms.find((a) => a.outdoor && a.name === "Pool deck"), mainY = b.y0 + spec.bh - 22;
      if (!deck || deck.y0 + deck.h > mainY || deck.y0 + deck.h < mainY - 4 || deck.x0 < b.x0 + 21 || deck.x0 + deck.w > b.x0 + spec.bw - 21) errs.push(`${tag}: the pool deck not in the courtyard`);
    }
    // The stairs: every run placed, each in a stairwell; every guest wing's corridor onto a lift lobby.
    const runs = (m.runs || []).filter((r) => !r.single);
    if (runs.length < Math.min(spec.stairs.n, 2) || runs.length !== spec.stairs.n) errs.push(`${tag}: ${runs.length} stair runs of ${spec.stairs.n}`);
    for (const r of runs) { const room = rooms.find((a) => (a.f || 0) === 0 && r.x > a.x0 && r.x < a.x0 + a.w - 1 && r.y > a.y0 && r.y < a.y0 + a.h - 1); if (!room || room.role !== "stairwell") errs.push(`${tag}: a stair run in ${room ? room.name : "no room"}`); }
    const parts = spec.shape.parts;
    parts.forEach((p, k) => {
      if (!p.wing || !rooms.some((a) => a.part === k && a.role === "corridor")) return;
      for (const f of new Set(rooms.filter((a) => a.part === k && a.role === "corridor").map((a) => a.f || 0))) {
        const cor = rooms.filter((a) => a.part === k && a.role === "corridor" && (a.f || 0) === f);
        const lifts = shop("liftlobby").filter((a) => (a.f || 0) === f);
        const onto = cor.some((c) => c.doors.some(([x, y]) => lifts.some((l) => l.doors.some(([u, w]) => u === x && w === y))));
        if (!onto) errs.push(`${tag}: ${p.name}'s corridor (floor ${f}) not onto a lift lobby`); else junctions++;
      }
    });
  }
  check(!errs.length, `${v.kind} ${v.name}: ${kind}, ${[...new Set(dims)].join(", ")}, ${Math.round(rooms0 / N)} rooms, all reached, ${junctions} wing floors onto a lift lobby${errs.length ? ` (${[...new Set(errs)].slice(0, 4).join("; ")})` : ""}`);
}

// ---------- 2. a plan of its own; loot ----------
section("Each a plan of its own; its loot a floor cell against its rectangle's");
const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
const lootOf = (m) => { let v = 0; for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (a && a.type && AREAS[a.type]) v += value(boxLoot(a.type, c.kind)); } return v; };
const LS = QUICK ? 4 : 10;
for (const id of Object.keys(SHAPED)) {
  let ws = 0, as = 0, wr = 0, ar = 0, own = true, notBox = true;
  for (let s = 0; s < LS; s++) {
    const a = make({ plan: id, shapes: true }, 3000 + s), b = make({ plan: id }, 3000 + s);
    ws += lootOf(a.m); as += builtCells(a.m); wr += lootOf(b.m); ar += builtCells(b.m);
    if (signature(a.spec, a.m) === signature(b.spec, b.m)) own = false;
    if (grids(a.m).every((F) => F.cells.filter((c) => c.f === "floor").length >= a.spec.bw * a.spec.bh)) notBox = false; // a courtyard block's court roofed on the ground floor: open above it
  }
  const r = (ws / as) / (wr / ar);
  check(own && notBox && r >= 0.8 && r <= 1.25, `${hotelVariantById(id).name}: its footprint not its box, its plan not its rectangle's; loot ${((ws / as) * 100).toFixed(1)} a 100 floor cells against ${((wr / ar) * 100).toFixed(1)} (×${r.toFixed(2)})`);
}

// ---------- 3. older saves ----------
section("Older saves: their hotels the rectangles they were");
{
  // The 48 rectangles as on dev before the shapes (de58b4c), cell for cell.
  const h = createHash("sha256"), h2 = createHash("sha256");
  let same = true;
  for (const v of HOTEL_VARIANTS) for (let s = 0; s < 2; s++) {
    const build = (extra) => { const rng = new Rng(9100 + s * 31 + v.id.length); const spec = BUILDINGS.hotel.make(rng, { plan: v.id, ...extra }); const m = assemble(rng, spec, { key: "hotel", name: "Hotel" }); return JSON.stringify([m.w, m.h, grids(m).map((f) => f.cells), m.containers, m.rooms.map((r) => [r.name, r.x0, r.y0, r.w, r.h])]); };
    const old = build({}), off = build({ shapes: false });
    h.update(old); h2.update(off);
    if (!SHAPED[v.id] && build({ shapes: true }) !== old) same = false;
  }
  const RECT = "8d795ec53da07f41";
  check(h.digest("hex").slice(0, 16) === RECT && h2.digest("hex").slice(0, 16) === RECT, `no shapes asked (an older save's): the 48 variants' rectangles as before the shapes (hash ${RECT})`);
  check(same, "the 40 variants without a shape: the same with shapes asked");
}

// ---------- 4. in the game ----------
section("In the game: a new world's hotel shaped, an older save's the rectangle");
{
  const st = createWorld({ seed: 9 + seed, factionCount: 2 }), tile = st.tiles.find((t) => t.loc && t.loc.type === "city") || st.tiles.find((t) => t.loc);
  const times = [];
  for (const id of Object.keys(SHAPED)) {
    const v = hotelVariantById(id), f = FRANCHISES.hotel.find((x) => x.plan.hotel === v.kind && x.plan.variants.includes(id)) || FRANCHISES.hotel.find((x) => x.plan.hotel === v.kind);
    const opt = { key: "hotel", id: `hs-${id}`, name: "Hotel", variant: f.id, plan: id };
    const ta = performance.now();
    const m = buildingMap(st, tile.id, opt, false);
    times.push(performance.now() - ta);
    const old = buildingMap({ ...st, shapesLegacy: true }, tile.id, opt, false);
    const R = REAL_SIZE[`hotel${v.kind}`];
    const top = v.kind !== "tower" || (m.storeys === 4 && (m.rooms || []).some((a) => a.shop === "penthouse" && (a.f || 0) === m.storeys - 1));
    check(m.plan.building.shape === SHAPED[id][0] && !old.plan.building.shape && m.plan.variant === v.name && old.plan.variant === v.name && m.w <= 200 && m.h <= 200 && top && m.storeys >= R.storeys[0] - (v.kind === "tower" ? 4 : 0),
      `${v.name}: ${m.plan.building.shape} in a new world (${m.w} × ${m.h}, ${m.storeys} floors built of ${m.height}), the rectangle in an older save (${old.w} × ${old.h})`);
  }
  const worst = Math.max(...times);
  check(worst < 4000, `a shaped hotel's map at most ${Math.round(worst)} ms (mean ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)} ms)`);
}

console.log(`\n${passes} passed, ${fails} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(fails ? 1 : 0);
