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
// variant (the roomsLegacy rule). A POI's layout names it (pois.js poiName).
// Types still owned by an open ticket are in PENDING_OWNER: reported, never failed. The integration pass that closes
// the epic (#7) empties the map, and then every type is held to it.
// Usage: node tools/varianttest.js [seeds per setting, default 24; BS_QUICK=1: 20]
import { createWorld } from "../src/sim/world.js";
import { BUILDINGS, buildingMap, buildingSpec } from "../src/sim/buildingmaps.js";
import { LAYOUTS, layoutName } from "../src/sim/buildvariants.js";
import { FRANCHISES } from "../src/sim/data-shops.js";
import { poisOf, poiName } from "../src/sim/pois.js";
import { poiPlace } from "../src/sim/poiraid.js";

// The types another ticket owns until it lands (issue #32 "Ownership"): their plans come from their own tickets.
export const PENDING_OWNER = {
  grocery: "#22", corner: "#22", supermarket: "#22",
  school: "#23",
  barracks: "#25", armorybldg: "#25", motorpool: "#25", messhall: "#25", hangar: "#25", terminal: "#25", control: "#25", radio: "#25",
  offices: "#27",
  deptstore: "#30",
  cellblock: "#31",
  hq: "#25", aidstation: "#25", gatehouse: "#25", tower: "#25", flightops: "#25", // the new military buildings
  milbunker: "#26", mountainbunker: "#26", govbunker: "#26", shelter: "#26", prepper: "#26", // the bunkers
};
const MIN = { motel: 5 }; // plans and layouts at least (else 3)

const SEEDS = Number(process.argv[2]) || (process.env.BS_QUICK ? 20 : 24);
const SETTINGS = ["rural", "town", "city"];
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };

const state = createWorld({ seed: 4242, factionCount: 4 });
state.roomsLegacy = false;
const tileId = Object.values(state.tiles).find((t) => t.terrain === "plains" && !t.loc).id;

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
  const sigs = new Map(), byLay = new Map(), errs = [];
  const add = (opt) => {
    let m;
    try { m = buildingMap(state, tileId, opt, null); } catch (e) { errs.push(`${opt.id}: ${e.message}`); return; }
    const g = signature(m), k = sigKey(g);
    sigs.set(k, (sigs.get(k) || 0) + 1);
    const lay = m.plan && m.plan.variant ? m.plan.variant.id : null;
    if (!lay) return;
    if (!byLay.has(lay)) byLay.set(lay, { n: 0, sigs: new Map(), name: m.plan.variant.name });
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
  rows.push({ key, plans: sigs.size, layouts: byLay.size, owner });
  if (owner) continue;
  check(!errs.length, `${key}: ${errs.length} maps failed (${errs.slice(0, 2).join("; ")})`);
  check(lays.length >= need, `${key}: ${lays.length} layouts in buildvariants.js LAYOUTS, want ${need}+`);
  check(sigs.size >= need, `${key}: ${sigs.size} distinct plans, want ${need}+`);
  for (const l of lays) check(byLay.has(l.id), `${key}: layout ${l.id} never built`);
  // Each layout's most common plan differs from every other layout's in two dimensions or more.
  const modal = [...byLay].map(([id, L]) => [id, [...L.sigs.values()].sort((a, b) => b.n - a.n)[0].g]);
  for (let i = 0; i < modal.length; i++) for (let j = i + 1; j < modal.length; j++) {
    const [ia, a] = modal[i], [ib, b] = modal[j];
    const diff = DIMS.filter((d) => a[d] !== b[d]);
    check(diff.length >= 2, `${key}: ${ia} and ${ib} differ in ${diff.length ? diff.join(", ") : "nothing"} (want two or more)`);
  }
  // An older save's building takes no layout (the roomsLegacy rule).
  const old = { ...state, roomsLegacy: true };
  check(!buildingSpec(old, tileId, { id: "vtold", key, name: BUILDINGS[key].name }).variant, `${key}: an older save's building has a layout`);
}
// Every type is held to it or waits on its owner.
for (const key of Object.keys(BUILDINGS)) check(LAYOUTS[key] || PENDING_OWNER[key], `${key}: no layouts and no owner`);

console.log(`\nPlans by type (${SEEDS} seeds a setting, ${SETTINGS.join("/")}, franchises in turn, each layout pinned 4 times):`);
console.log("  type            plans  layouts  owner");
for (const r of rows) console.log(`  ${r.key.padEnd(15)} ${String(r.plans).padStart(5)}  ${String(r.layouts).padStart(7)}  ${r.owner ? `PENDING_OWNER ${r.owner}` : ""}`);

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
