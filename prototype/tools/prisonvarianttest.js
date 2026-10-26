// Prisons and jails, a dozen plans a building type and a dozen layouts a complex (issue #31 of the interiors epic #7;
// the user's rule relayed 2026-10-25: "each prison building type needs at least 12 distinct layout variants ... the
// cellblock, the new prison buildings, and the prison site layouts"; issue #32's MIN_PLANS = 12):
// - every type in sim/prison.js PRISON_PLANS (the housing unit, central control, the chow hall, the infirmary, the
//   chapel, education, industries, administration, the armory, the gatehouse, the jail building) has 12+ named plans,
//   their ids and names their own; pinned (o.plan), the plans are as many distinct signatures (#32's: the rooms'
//   roles, the role pairs with a door between them, the ways in, the footprint class);
// - every plan, pinned, over several seeds: it assembles; every walkable cell reached (on the ground from its entry,
//   upstairs from the stairs); a housing unit's cells (its cell doors) on every tier;
// - by the dice every plan turns up;
// - every prison layout (PRISON_LAYOUTS: a state prison's or a penitentiary's) and every jail layout, pinned: the map
//   builds at its kind's size, its layout and its buildings' plans named on the plan, every housing unit joined to
//   control indoors, every walkable cell reachable from the way in; the layouts stand as many ways (the housing's,
//   control's and the yard's places); by the dice every layout turns up.
// Usage: node tools/prisonvarianttest.js [seeds]  (BS_QUICK=1: fewer seeds)
import { createWorld } from "../src/sim/world.js";
import { Rng } from "../src/sim/rng.js";
import { assemble } from "../src/sim/buildingmaps.js";
import { PRISON_PLANS, PRISON_BUILDERS, PRISON_LAYOUTS, JAIL_LAYOUTS, PRISON, openTiers, prisonMap, prisonKind } from "../src/sim/prison.js";
import { CELL } from "../src/sim/combat.js";

void createWorld;
const QUICK = !!process.env.BS_QUICK;
const SEEDS = Number(process.argv[2] || (QUICK ? 2 : 4));
const MIN_PLANS = 12;
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const pass = (c) => !!c && ((CELL[c.k] && CELL[c.k].walk) || c.k === "door");

function make(type, s, layout) {
  const rng = new Rng(s * 100003 + type.length * 7919 + 17);
  const sp = PRISON_BUILDERS[type](rng, layout ? { plan: layout } : {});
  const m = assemble(rng, sp, { key: "pblock", id: `${type}:${s}`, name: type });
  openTiers(m, sp);
  return { sp, m };
}
// #32's plan signature.
function signature(sp, m) {
  const rooms = m.rooms.filter((a) => !a.outdoor);
  const roles = [...new Set(rooms.map((a) => a.role))].sort();
  const byDoor = new Map();
  for (const a of rooms) for (const d of a.doors || []) { const k = `${a.f || 0}:${d[0]},${d[1]}`; const l = byDoor.get(k) || []; l.push(a.role); byDoor.set(k, l); }
  const adj = new Set();
  for (const l of byDoor.values()) if (l.length >= 2) adj.add([...l].sort().join("-"));
  const ways = 1 + (m.exits || []).filter((e) => e.zone >= 0).length;
  return `${roles.join(",")}|${[...adj].sort().join(",")}|${ways}|${sp.foot}`;
}
function flood(W, H, cells, starts) {
  const seen = new Uint8Array(W * H), q = [];
  for (const i of starts) if (pass(cells[i]) && !seen[i]) { seen[i] = 1; q.push(i); }
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
// The cells of a building nobody reaches: on the ground from its entry room, upstairs from the stairs.
function lostCells(m) {
  const W = m.w, H = m.h, B = m.building, out = [];
  const inB = (i) => { const x = i % W, y = (i / W) | 0; return x >= B.x0 && y >= B.y0 && x < B.x0 + B.w && y < B.y0 + B.h; };
  for (let f = 0; f < m.floors.length; f++) {
    const cells = m.floors[f].cells;
    let starts;
    if (f === 0) {
      const e = m.rooms.find((r) => !(r.f > 0) && r.entry) || m.rooms.find((r) => !(r.f > 0));
      starts = []; for (let y = e.y0 + 1; y < e.y0 + e.h - 1; y++) for (let x = e.x0 + 1; x < e.x0 + e.w - 1; x++) starts.push(y * W + x);
    } else starts = cells.map((c, i) => (c.k === "stairs" ? i : -1)).filter((i) => i >= 0);
    const seen = flood(W, H, cells, starts);
    let lost = 0, first = null;
    cells.forEach((c, i) => { if (inB(i) && CELL[c.k] && CELL[c.k].walk && c.k !== "void" && !seen[i]) { lost++; first ??= `${c.k} at ${i % W},${(i / W) | 0}`; } });
    if (lost) out.push(`floor ${f + 1}: ${lost} (the first ${first})`);
  }
  return out;
}

// ---------- 1. the plans of each building type ----------
section(`Each building type: ${MIN_PLANS}+ named plans, distinct when pinned`);
for (const [type, plans] of Object.entries(PRISON_PLANS)) {
  const ids = new Set(plans.map((v) => v.id)), names = new Set(plans.map((v) => v.name));
  check(plans.length >= MIN_PLANS && ids.size === plans.length && names.size === plans.length && plans.every((v) => v.id && v.name), `${type}: ${plans.length} plans, ids and names their own`);
  const sigs = new Map(), bad = [];
  let cellsOk = true;
  for (const v of plans) {
    for (let s = 0; s < SEEDS; s++) {
      let got;
      try { got = make(type, s, v.id); } catch (e) { bad.push(`${v.id} (seed ${s}): ${e.message}`); continue; }
      const { sp, m } = got;
      if (sp.vid !== v.id) bad.push(`${v.id}: built ${sp.vid}`);
      const lost = lostCells(m);
      if (lost.length) bad.push(`${v.id} (seed ${s}) cut off: ${lost.join("; ")}`);
      if (s === 0) sigs.set(signature(sp, m), v.id);
      if (type === "housing" && sp.unit.kind === "cells") for (let f = 0; f < m.floors.length; f++) if (!m.floors[f].cells.some((c) => c.cellDoor)) { cellsOk = false; bad.push(`${v.id}: no cells on floor ${f + 1}`); }
    }
  }
  check(!bad.length, `${type}: every plan assembles over ${SEEDS} seeds, every walkable cell reached${bad.length ? ` (${bad.slice(0, 3).join(" | ")})` : ""}`);
  check(sigs.size === plans.length, `${type}: the ${plans.length} plans pinned are ${sigs.size} signatures`);
  if (type === "housing") check(cellsOk, "housing: a cells plan's cells on every tier");
  // By the dice.
  const seen = new Set();
  for (let s = 0; s < 40 * plans.length && seen.size < plans.length; s++) { const rng = new Rng(s * 7 + 1); seen.add(PRISON_BUILDERS[type](rng, {}).vid); }
  check(seen.size === plans.length, `${type}: by the dice every plan turns up (${seen.size} of ${plans.length})`);
}
// ---------- 2. the layouts of each complex ----------
const opt = (key, layout) => ({ key, id: key, name: key, ...(layout ? { layout } : {}) });
const tileOf = (st, kind) => { for (let t = 0; t < 400; t++) if (prisonKind(st, t, opt("prison")) === kind) return t; return -1; };
// From the way in (the first zone): every walkable cell reached; every unit's officers' station reached from control
// (the jail's: from its building's secure corridor) over indoor floor.
function complexCheck(m, kind) {
  const W = m.w, H = m.h, cells = m.cells, P = m.plan, z = m.zones[0];
  const seen = flood(W, H, cells, [(z.y0 + 1) * W + z.x0 + 1]);
  let lost = 0;
  cells.forEach((c, i) => { if (CELL[c.k] && CELL[c.k].walk && !seen[i]) lost++; });
  const from = kind === "jail" ? m.rooms.find((a) => a.role === "corridor" && a.house === P.control && !(a.f > 0)) : m.rooms.find((a) => a.prison === "control");
  const ins = [];
  for (let y = from.y0 + 1; y < from.y0 + from.h - 1; y++) for (let x = from.x0 + 1; x < from.x0 + from.w - 1; x++) ins.push(y * W + x);
  const inside = new Uint8Array(W * H), q = [];
  for (const i of ins) if (pass(cells[i])) { inside[i] = 1; q.push(i); }
  while (q.length) { const i = q.pop(), x = i % W, y = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (!inside[j] && pass(cells[j]) && cells[j].f === "floor") { inside[j] = 1; q.push(j); } } }
  const apart = P.units.filter((u) => { const pk = m.rooms.find((a) => a.prison === "picket" && a.unitId === u.unitId && !(a.f > 0)); if (!pk) return true; for (let y = pk.y0 + 1; y < pk.y0 + pk.h - 1; y++) for (let x = pk.x0 + 1; x < pk.x0 + pk.w - 1; x++) if (inside[y * W + x]) return false; return true; });
  return { lost, apart: apart.map((u) => u.name) };
}
for (const [kind, layouts] of [["state", PRISON_LAYOUTS], ["max", PRISON_LAYOUTS], ["jail", JAIL_LAYOUTS]]) {
  const K = PRISON.KINDS[kind];
  section(`${K.name}: ${layouts.length} layouts`);
  const ids = new Set(layouts.map((v) => v.id)), names = new Set(layouts.map((v) => v.name));
  check(layouts.length >= MIN_PLANS && ids.size === layouts.length && names.size === layouts.length, `${layouts.length} layouts, ids and names their own`);
  const bad = [], shapes = new Map();
  for (const L of layouts) for (let s = 0; s < SEEDS; s++) {
    const st = { seed: 100 + s * 7 }, t = kind === "jail" ? 7 : tileOf(st, kind);
    let m;
    try { m = prisonMap(st, t, opt(kind === "jail" ? "jail" : "prison", L.id), false); } catch (e) { bad.push(`${L.id} (seed ${s}): ${e.message}`); continue; }
    const P = m.plan;
    if (P.layout !== L.id || !P.layoutName) bad.push(`${L.id}: the plan names ${P.layout}`);
    if (!P.plans || P.plans.length < (kind === "jail" ? 3 : 10) || !P.plans.every((b) => b.plan && b.planName)) bad.push(`${L.id}: ${(P.plans || []).length} buildings' plans named`);
    if (m.w > PRISON.CAP || m.h > PRISON.CAP || (kind === "jail" && (m.w > 130 || m.h > 130))) bad.push(`${L.id}: ${m.w} × ${m.h}`);
    if (kind !== "jail" && P.units.length < 2) bad.push(`${L.id}: ${P.units.length} units`);
    const { lost, apart } = complexCheck(m, kind);
    if (lost) bad.push(`${L.id} (seed ${s}): ${lost} cells cut off`);
    if (apart.length) bad.push(`${L.id} (seed ${s}): ${apart.join(", ")} not joined`);
    if (kind === "jail" && !m.rooms.some((a) => a.role === "yard" && a.doors.length >= (L.pen === "shared" ? 2 : 1))) bad.push(`${L.id} (seed ${s}): no pen`);
    // The layout's shape: where control and the housing stand (a pole's or a comb's), or the pods'.
    if (s === 0) {
      const hs = P.houses.filter((h) => P.units.some((u) => u.house === h.k)), c = P.houses.find((h) => h.k === P.control), y = m.rooms.find((a) => a.role === "yard") || {};
      const k = `${hs.map((h) => `${Math.round(h.x0 / 10)},${Math.round(h.y0 / 10)}`).join(";")}|${Math.round(c.x0 / 10)},${Math.round(c.y0 / 10)}|${Math.round(y.x0 / 10)},${Math.round(y.y0 / 10)},${y.w}`;
      if (shapes.has(k)) bad.push(`${L.id} stands as ${shapes.get(k)} does`);
      shapes.set(k, L.id);
    }
  }
  check(!bad.length, `every layout, pinned over ${SEEDS} seeds: built, named, every unit joined indoors, every walkable cell reachable${bad.length ? ` (${bad.slice(0, 3).join(" | ")})` : ""}`);
  check(shapes.size === layouts.length, `the ${layouts.length} layouts stand ${shapes.size} ways (the housing's, control's and the yard's places)`);
  const seen = new Set();
  for (let s = 0; s < 30 * layouts.length && seen.size < layouts.length; s++) { const st = { seed: 1000 + s }, t = kind === "jail" ? 7 : tileOf(st, kind); if (t < 0) continue; seen.add(prisonMap(st, t, opt(kind === "jail" ? "jail" : "prison"), false).plan.layout); if (s > 60 && QUICK) break; }
  check(QUICK || seen.size === layouts.length, `by the dice every layout turns up (${seen.size} of ${layouts.length}${QUICK ? ", quick: reported" : ""})`);
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
