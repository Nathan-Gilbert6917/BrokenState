// Layout variants for every building type (the user's request 2026-10-25, issue #32: "add motel varients. every
// building should have several varients"). For every BUILDINGS key, builds the building over many seeds and the three
// settings (rural, town, city; each franchise of its kind in turn where it has franchises, and each layout pinned a few
// times), and counts its distinct plans by a plan signature:
//   roles   the set of room roles;
//   adj     the role pairs that share a wall (rooms side by side, on the same floor);
//   ent     the ground floor's ways in from outside (outer door openings; 5 or more as one);
//   shape   the footprint's shape class (rect; notched: a footprint that is not its bounding box; multi: several
//           buildings on one map);
//   st      the storeys (3 and more as one).
// Every type this ticket owns must show at least 3 distinct plans (the motel 5) and at least as many named layouts
// (buildvariants.js LAYOUTS, spec.variant); every layout of a type must turn up; each layout's most common plan must
// differ from every other layout's in at least two of roles, adj, ent, shape, st and corridor-or-open-plan (corridor:
// it has a corridor or a hall), so a variant is a distinct plan and not a recolour. An older save's building takes no
// variant (the roomsLegacy rule). A POI's layout names it (pois.js poiName). The motel's five are each checked for
// their own rooms (motelChecks), and every layout's loot is printed (the tables' value and the containers a building;
// every layout has some to search).
// Types another ticket owns are in PENDING_OWNER (the open tickets', and the closed ones' the epic's integration pass
// takes up: #32's split, 2026-10-25: #33 restaurants, #34 the library, #35 shops and services, #36 civic and medical,
// #37 industrial): reported, never failed. The integration pass that closes the epic (#7) empties the map, and then
// every type is held to it: a type with layouts here (buildvariants.js) to all of the above, any other to its 3
// distinct plans.
// Usage: node tools/varianttest.js [seeds per setting, default 24; BS_QUICK=1: 20]
import { createWorld } from "../src/sim/world.js";
import { BUILDINGS, buildingMap, buildingSpec } from "../src/sim/buildingmaps.js";
import { LAYOUTS, layoutName } from "../src/sim/buildvariants.js";
import { FRANCHISES } from "../src/sim/data-shops.js";
import { poisOf, poiName } from "../src/sim/pois.js";
import { poiPlace } from "../src/sim/poiraid.js";
import { boxLoot } from "../src/sim/combat.js";
import { GEAR, supValue } from "../src/sim/data.js";

// The types another ticket owns until it lands (issue #32 "Ownership"): their plans come from their own tickets.
export const PENDING_OWNER = {
  school: "#23",
  // #25 (closed: the epic's integration pass), the military buildings
  barracks: "#25", armorybldg: "#25", motorpool: "#25", messhall: "#25", hangar: "#25", terminal: "#25", control: "#25", radio: "#25",
  hq: "#25", aidstation: "#25", gatehouse: "#25", tower: "#25", flightops: "#25",
  milbunker: "#26", mountainbunker: "#26", govbunker: "#26", shelter: "#26", prepper: "#26", // #26 (closed), the bunkers
  offices: "#27", storefront: "#27", bizpark: "#27", cityhall: "#27", courthouse: "#27", callcenter: "#27", techoffice: "#27", station: "#27", // #27 (closed)
  hotel: "#29", // #29 (closed)
  deptstore: "#30",
  cellblock: "#31",
  restaurant: "#33", pizza: "#33", diner: "#33", bar: "#33",
  library: "#34",
  // #35: shops and services
  pharmacy: "#35", gasstation: "#35", truckstop: "#35", gunstore: "#35", pawnshop: "#35", sportshop: "#35", electronics: "#35", radioshop: "#35",
  bookstore: "#35", petstore: "#35", garden: "#35", clothing: "#35", liquor: "#35", hardware: "#35", feedstore: "#35", dealer: "#35",
  autoshop: "#35", garage: "#35", workshop: "#35", bank: "#35", corner: "#35", grocery: "#35", supermarket: "#35",
  hospital: "#36", infirmary: "#36", clinic: "#36", vet: "#36", church: "#36", police: "#36", firestation: "#36", // #36: civic and medical
  warehouse: "#37", factory: "#37", lab: "#37", // #37: industrial (industrylayout.js, on dev; its own test: tools/industryvarianttest.js)
};

const MIN = { motel: 5 }; // plans and layouts at least (else 3)

const SEEDS = Number(process.argv[2]) || (process.env.BS_QUICK ? 20 : 24);
const SETTINGS = ["rural", "town", "city"];
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };

const state = createWorld({ seed: 4242, factionCount: 4 });
state.roomsLegacy = false;
const tileId = Object.values(state.tiles).find((t) => t.terrain === "plains" && !t.loc).id;

const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };

// ---------- the motel's five (the user's request: "add motel varients") ----------
// Each motel layout as the issue lays it out: every room a bed, a TV stand, a chest of drawers and its bathroom (a
// toilet); the motor court's outdoor stair, ice and vending nook, laundry, manager's flat and empty pool behind its
// fence; the strip's one storey, neon sign and shed; the chain's breakfast area and rooms off a corridor on 2–3
// storeys; the motor lodge's several buildings (the lodge's diner, cabins with a kitchenette); the extended stay's
// studios with a stove, a fridge and a sink, its guest laundry and gym.
const motelErrs = {};
function motelChecks(m, lay) {
  const err = (msg) => { (motelErrs[lay] = motelErrs[lay] || []).push(msg); };
  const grid = (f) => (m.floors ? m.floors[f].cells : m.cells);
  const kinds = (a) => { const out = new Set(); for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) out.add(grid(a.f || 0)[y * m.w + x].k); return out; };
  const R = m.rooms.filter((a) => !a.outdoor), named = (re) => R.filter((a) => re.test(a.name));
  const rooms = R.filter((a) => a.role === "motelroom"), baths = R.filter((a) => a.role === "bath" && kinds(a).has("toilet"));
  for (const a of rooms) { const k = kinds(a); for (const p of ["bed", "tvstand", "dresser"]) if (!k.has(p)) { err(`${a.name}: no ${p}`); break; } }
  if (!rooms.length || baths.length < rooms.length) err(`${baths.length} bathrooms for ${rooms.length} rooms`);
  const studio = (a) => { const k = kinds(a); return k.has("stove") && k.has("fridge") && k.has("sink"); };
  const cells0 = grid(0);
  if (lay === "court") {
    if (m.storeys !== 2 || !(m.runs || []).some((r) => r.out)) err("not two storeys up an outside stair");
    if (!named(/Ice and vending/).some((a) => kinds(a).has("vending"))) err("no ice and vending nook");
    if (!named(/Laundry/).length) err("no laundry");
    if (!named(/Manager/).length) err("no manager's flat");
    if (!cells0.some((c) => c.f === "pool") || !cells0.some((c) => c.k === "fence")) err("no empty pool behind a fence");
  }
  if (lay === "strip") {
    if (m.storeys !== 1) err(`${m.storeys} storeys`);
    if (!cells0.some((c) => c.neon)) err("no neon sign");
    if (!named(/Shed/).length) err("no shed");
  }
  if (lay === "chain") {
    if (m.storeys < 2 || !R.some((a) => a.role === "corridor") || !named(/Breakfast area/).length) err("not a corridor motel with a breakfast area on 2+ storeys");
    if ((m.runs || []).some((r) => r.out)) err("an outside stair");
  }
  if (lay === "cabins") {
    if (!m.plan.street || (m.plan.houses || []).length < 5) err(`${(m.plan.houses || []).length} buildings`);
    if (!named(/Diner/).length) err("no diner");
    const cabins = rooms.filter((a) => /Cabin \d+$/.test(a.name));
    if (!cabins.length || !cabins.every(studio)) err("a cabin with no kitchenette");
  }
  if (lay === "extended") {
    if (m.storeys < 2 || !named(/Gym/).length || !named(/Guest laundry/).length) err("no gym or guest laundry on 2+ storeys");
    if (!rooms.length || !rooms.every(studio)) err("a studio with no kitchenette");
  }
}

// ---------- the plan signature ----------
const DOORISH = new Set(["idoor", "odoor", "door"]);
function signature(m) {
  const rooms = m.rooms.filter((r) => !r.outdoor);
  const roles = [...new Set(rooms.map((r) => r.role))].sort();
  const adj = new Set();
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i], b = rooms[j];
    if (a.f !== b.f) continue;
    const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) >= 2; // overlapping by an inside cell at least
    const side = ((a.x0 + a.w - 1 === b.x0 || b.x0 + b.w - 1 === a.x0) && ov(a.y0, a.y0 + a.h - 1, b.y0, b.y0 + b.h - 1)) ||
      ((a.y0 + a.h - 1 === b.y0 || b.y0 + b.h - 1 === a.y0) && ov(a.x0, a.x0 + a.w - 1, b.x0, b.x0 + b.w - 1));
    if (side) adj.add([a.role, b.role].sort().join("|"));
  }
  // The ground floor's ways in: door cells with outside ground beside them (runs of door cells along a wall as one).
  const C = m.floors ? m.floors[0].cells : m.cells, W = m.w, H = m.h;
  const outside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && C[y * W + x].f !== "floor" && C[y * W + x].k !== "void";
  const seen = new Set();
  let ent = 0;
  for (let i = 0; i < W * H; i++) {
    if (seen.has(i) || !DOORISH.has(C[i].k)) continue;
    const x = i % W, y = (i / W) | 0;
    if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => outside(x + dx, y + dy))) continue;
    ent++;
    const q = [i]; seen.add(i);
    while (q.length) { const j = q.pop(), jx = j % W, jy = (j / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = jx + dx, ny = jy + dy, k = ny * W + nx; if (nx >= 0 && ny >= 0 && nx < W && ny < H && !seen.has(k) && DOORISH.has(C[k].k)) { seen.add(k); q.push(k); } } }
  }
  // The footprint: the building cells (f "floor") of the ground floor, in one piece or several.
  const comp = new Int32Array(W * H).fill(-1), parts = [];
  for (let i = 0; i < W * H; i++) {
    if (comp[i] >= 0 || C[i].f !== "floor") continue;
    const id = parts.length, q = [i]; comp[i] = id;
    let n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    while (q.length) {
      const j = q.pop(), jx = j % W, jy = (j / W) | 0; n++;
      x0 = Math.min(x0, jx); y0 = Math.min(y0, jy); x1 = Math.max(x1, jx); y1 = Math.max(y1, jy);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = jx + dx, ny = jy + dy, k = ny * W + nx; if (nx >= 0 && ny >= 0 && nx < W && ny < H && comp[k] < 0 && C[k].f === "floor") { comp[k] = id; q.push(k); } }
    }
    parts.push({ n, box: (x1 - x0 + 1) * (y1 - y0 + 1) });
  }
  const big = parts.filter((p) => p.n >= 12);
  const shape = big.length > 1 ? "multi" : big.length && big[0].n < big[0].box ? "notched" : "rect";
  const st = Math.min(3, m.storeys || 1);
  const corridor = roles.includes("corridor") || roles.includes("hall");
  return { roles: roles.join(","), adj: [...adj].sort().join(","), ent: Math.min(5, ent), shape, st, corridor };
}
const sigKey = (g) => `${g.roles}#${g.adj}#${g.ent}#${g.shape}#${g.st}`;
const DIMS = ["roles", "adj", "ent", "shape", "st", "corridor"];

// ---------- every type ----------
const frKind = (key) => (key === "gasstation" ? "gas" : key);
const rows = [];
for (const key of Object.keys(BUILDINGS)) {
  const owner = PENDING_OWNER[key], lays = LAYOUTS[key] || [];
  const frs = FRANCHISES[frKind(key)] || [];
  const sigs = new Map(), byLay = new Map(), errs = [], loot = new Map();
  const add = (opt) => {
    let m;
    try { m = buildingMap(state, tileId, opt, null); } catch (e) { errs.push(`${opt.id}: ${e.message}`); return; }
    if (opt.layout) { // the loot of a pinned layout (the tables' value, as tools/shopstest.js; the containers)
      const L = loot.get(opt.layout) || { n: 0, v: 0, boxes: 0 };
      L.n++;
      for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (a && a.type && !a.outdoor) { L.v += value(boxLoot(a.type, c.kind)); L.boxes++; } }
      loot.set(opt.layout, L);
      if (key === "motel") motelChecks(m, opt.layout);
    }
    const g = signature(m), k = sigKey(g);
    sigs.set(k, (sigs.get(k) || 0) + 1);
    const lay = m.plan && m.plan.vid ? m.plan.vid : null; // the layout it was built as (assemble's plan.vid; its name plan.variant)
    if (!lay) return;
    if (!byLay.has(lay)) byLay.set(lay, { n: 0, sigs: new Map(), name: m.plan.variant });
    const L = byLay.get(lay);
    L.n++;
    const e = L.sigs.get(k) || { g, n: 0 };
    e.n++;
    L.sigs.set(k, e);
  };
  for (const setting of SETTINGS) for (let s = 0; s < SEEDS; s++) {
    const fr = frs.length && s % 4 !== 3 ? frs[s % frs.length] : null; // the franchises in turn, now and then none
    add({ id: `vt${setting}${s}`, key, name: BUILDINGS[key].name, setting, ...(fr ? { variant: fr.id, kind: frKind(key) } : {}) });
  }
  for (const l of lays) for (let s = 0; s < 4; s++) add({ id: `vtpin${l.id}${s}`, key, name: BUILDINGS[key].name, setting: SETTINGS[s % 3], layout: l.id });
  const need = MIN[key] || 3;
  rows.push({ key, plans: sigs.size, layouts: byLay.size, owner, loot: [...loot].map(([id, L]) => `${id} ${(L.v / L.n).toFixed(0)}/${(L.boxes / L.n).toFixed(1)}`).join("  ") });
  if (owner) continue;
  check(!errs.length, `${key}: ${errs.length} maps failed (${errs.slice(0, 2).join("; ")})`);
  check(sigs.size >= need, `${key}: ${sigs.size} distinct plans, want ${need}+`);
  if (!LAYOUTS[key]) continue; // a type whose ticket has landed and is closed: its distinct plans; its layouts are its own module's
  check(lays.length >= need, `${key}: ${lays.length} layouts in buildvariants.js LAYOUTS, want ${need}+`);
  for (const l of lays) check(byLay.has(l.id), `${key}: layout ${l.id} never built`);
  for (const [id, L] of loot) check(L.boxes / L.n >= 1.5, `${key}: layout ${id} has ${(L.boxes / L.n).toFixed(1)} containers a building (want some to search)`);
  // Each layout's most common plan differs from every other layout's in two dimensions or more.
  const modal = [...byLay].map(([id, L]) => [id, [...L.sigs.values()].sort((a, b) => b.n - a.n)[0].g]);
  for (let i = 0; i < modal.length; i++) for (let j = i + 1; j < modal.length; j++) {
    const [ia, a] = modal[i], [ib, b] = modal[j];
    const diff = DIMS.filter((d) => a[d] !== b[d]);
    check(diff.length >= 2, `${key}: ${ia} and ${ib} differ in ${diff.length ? diff.join(", ") : "nothing"} (want two or more)`);
  }
  // An older save's building takes no layout (the roomsLegacy rule).
  const old = { ...state, roomsLegacy: true };
  check(!buildingSpec(old, tileId, { id: "vtold", key, name: BUILDINGS[key].name }).vid, `${key}: an older save's building has a layout`);
}

for (const l of LAYOUTS.motel) check(!motelErrs[l.id], `the motel's ${l.name}: as laid out (${motelErrs[l.id] ? motelErrs[l.id].slice(0, 3).join("; ") : "rooms, bathrooms and its own rooms"})`);

console.log(`\nPlans by type (${SEEDS} seeds a setting, ${SETTINGS.join("/")}, franchises in turn, each layout pinned 4 times):`);
console.log("  type            plans  layouts  owner");
for (const r of rows) console.log(`  ${r.key.padEnd(15)} ${String(r.plans).padStart(5)}  ${String(r.layouts).padStart(7)}  ${r.owner ? `PENDING_OWNER ${r.owner}` : ""}`);
console.log("\nLoot by layout (pinned: the tables' value / containers a building):");
for (const r of rows) if (r.loot) console.log(`  ${r.key.padEnd(15)} ${r.loot}`);

// ---------- a POI's layout names it ----------
{
  let named = 0, wrong = 0;
  for (const t of Object.values(state.tiles)) {
    const ps = poisOf(t);
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!p || !p.lay || p.site) continue;
      const place = poiPlace(t, i);
      if (!place || place.layout !== p.lay) { wrong++; continue; }
      if (!p.v && !p.site && poiName(t, i) !== layoutName(place.key, p.lay)) wrong++;
      named++;
    }
  }
  check(named > 0, "no POI has a layout");
  check(!wrong, `${wrong} POIs whose building or name does not follow their layout`);
  console.log(`\nPOIs with a layout: ${named}`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
