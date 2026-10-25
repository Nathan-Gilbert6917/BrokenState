// A dozen layout variants per civic and medical type (src/sim/civicvariants.js, issue #36 of the interiors epic #7:
// "every building should have several varients"; "for buildings with no to only a few varients create a dozen varients
// per building type"). In the shape of #32's tools/varianttest.js (MIN_PLANS, a plan signature), for the hospital, the
// infirmary, the clinic, the vet, the church, the police station and the fire station, until it folds in there:
//   - the plans by the dice: each kind over 60+ seeds across the settings (city, suburb, town, rural), its franchises
//     and its sites (a prison's infirmary, an airport's fire station): at least MIN_PLANS distinct plan signatures (the
//     set of room roles, their adjacency through doors, the entrance count, the footprint's shape class), printed per
//     kind;
//   - every plan pinned by its id (o.plan): MIN_PLANS plans a kind with names of their own, the map carrying the
//     plan's name; no two plans share a signature; every two plans differ in at least two of the issue's ways (the room
//     list, the rooms' adjacency, the entrances, corridor or open plan, the size, the storeys);
//   - every plan can turn up: a kind with franchises maps each plan to one of them (and each franchise to two plans or
//     more); every plan has a weight in some setting or site;
//   - the loot per area within ±10% of the kind's plan before #36 (#14's or #15's): the meds (a medical kind) or the
//     value (a civic kind) of every container's table by its floor's richness, over the interior's cells.
// Usage: node tools/variantcivictest.js [seeds]
import { createWorld } from "../src/sim/world.js"; // (first: the modules' import order)
import { BUILDINGS, assemble } from "../src/sim/buildingmaps.js";
import { VARIANTS, VARIANT_KINDS, SIZE } from "../src/sim/civicvariants.js";
import { FRANCHISES } from "../src/sim/data-shops.js";
import { boxLoot, FLOOR_RICH } from "../src/sim/combat.js";
import { GEAR, supValue } from "../src/sim/data.js";
import { Rng } from "../src/sim/rng.js";

void createWorld;
const MIN_PLANS = 12;
const QUICK = !!process.env.BS_QUICK;
const SEEDS = Math.max(60, Number(process.argv[2]) || (QUICK ? 60 : 96));
const PINNED = QUICK ? 4 : 6; // builds of each plan pinned by its id
const LOOT_N = QUICK ? 80 : 160; // builds a kind for the loot by area
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const t0 = performance.now();

const SETTINGS = ["city", "suburb", "town", "rural"];
const SITES = { infirmary: ["prison", "base", "factory"], firestation: ["airport"] };
const MEDICAL = new Set(["hospital", "clinic", "infirmary", "vet"]);
const build = (kind, seed, o) => { const rng = new Rng(seed); const spec = BUILDINGS[kind].make(rng, o); return { spec, m: assemble(rng, spec, { key: kind, name: kind, noDecor: true }) }; };

// The plan signature (#32's): the room roles (a civic room by its style too), their adjacency through doors, the
// entrances (the front door and the exits), the footprint's shape class (#23's; a rectangle until it lands).
const tok = (a) => (a.civic ? `${a.role}/${a.civic}` : a.role);
function features(m, spec) {
  const rooms = m.rooms.filter((a) => !a.outdoor);
  const roles = [...new Set(rooms.map(tok))].sort().join(",");
  const at = new Map();
  for (const a of rooms) for (const [x, y] of a.doors || []) { const k = `${a.f || 0}:${x},${y}`; if (!at.has(k)) at.set(k, []); at.get(k).push(tok(a)); }
  const adj = [...new Set([...at.values()].filter((l) => l.length === 2).map((l) => l.sort().join("|")))].sort().join(",");
  const exits = m.plan.exits || [];
  return {
    roles, adj, entrances: 1 + exits.length, sides: ["front", ...exits.map((e) => e.side)].sort().join(","), shape: spec.shape || "rect",
    corridor: rooms.some((a) => (a.f || 0) === 0 && a.role === "corridor"), area: spec.bw * spec.bh, storeys: m.storeys || 1,
  };
}
const signature = (F) => JSON.stringify([F.roles, F.adj, F.entrances, F.shape]);
const mode = (list) => { const n = new Map(); for (const x of list) n.set(x, (n.get(x) || 0) + 1); return [...n].sort((a, b) => b[1] - a[1])[0][0]; };

// ======================================================================================
console.log(`The plans by the dice: ${SEEDS} seeds a kind across the settings, franchises and sites`);
const byDice = {};
for (const kind of VARIANT_KINDS) {
  const frs = [null, ...(FRANCHISES[kind] || []).map((f) => f.id)], sites = [null, ...(SITES[kind] || [])];
  const sigs = new Set(), ids = new Set();
  for (let s = 0; s < SEEDS; s++) {
    const o = { setting: SETTINGS[s % 4], variant: frs[Math.floor(s / 4) % frs.length], site: sites[Math.floor(s / 4) % sites.length] };
    const { spec, m } = build(kind, 91000 + s * 7919, o);
    sigs.add(signature(features(m, spec)));
    ids.add(spec.vid);
  }
  byDice[kind] = { sigs: sigs.size, ids: ids.size };
  check(sigs.size >= MIN_PLANS, `${kind}: ${sigs.size} distinct plans by the dice (${ids.size} of its ${VARIANTS[kind].length} named plans turned up)`);
}

// ======================================================================================
console.log(`\nEvery plan pinned by its id (${PINNED} builds each)`);
const per = {};
for (const kind of VARIANT_KINDS) {
  const list = VARIANTS[kind];
  per[kind] = {};
  let named = true;
  for (const [vi, v] of list.entries()) {
    const fs = [];
    for (let s = 0; s < PINNED; s++) {
      const { spec, m } = build(kind, 93000 + s * 7919 + vi * 104729, { plan: v.id, setting: SETTINGS[s % 4] });
      if (spec.vid !== v.id || m.plan.vid !== v.id || m.plan.variant !== v.name) named = false;
      fs.push(features(m, spec));
    }
    per[kind][v.id] = fs;
  }
  const names = new Set(list.map((v) => v.name)), ids = new Set(list.map((v) => v.id));
  check(list.length >= MIN_PLANS && names.size === list.length && ids.size === list.length && named, `${kind}: ${list.length} plans, each with a name of its own on the map (${list.map((v) => v.name).join("; ")})`);
  // No two plans share a signature.
  const owner = new Map(), shared = [];
  for (const v of list) for (const F of per[kind][v.id]) { const sg = signature(F); if (owner.has(sg) && owner.get(sg) !== v.id) shared.push(`${owner.get(sg)}/${v.id}`); else owner.set(sg, v.id); }
  check(!shared.length, `${kind}: no two plans share a signature (${owner.size} signatures${shared.length ? `; shared: ${[...new Set(shared)].slice(0, 4).join(", ")}` : ""})`);
  // Every two plans differ in at least two ways.
  const M = Object.fromEntries(list.map((v) => {
    const fs = per[kind][v.id];
    return [v.id, { roles: mode(fs.map((F) => F.roles)), adj: mode(fs.map((F) => F.adj)), sides: mode(fs.map((F) => F.sides)), corridor: mode(fs.map((F) => F.corridor)), area: SIZE[`${kind}.${v.id}`] ? (SIZE[`${kind}.${v.id}`].w[0] + SIZE[`${kind}.${v.id}`].w[1]) * (SIZE[`${kind}.${v.id}`].h[0] + SIZE[`${kind}.${v.id}`].h[1]) / 4 : fs.reduce((a, F) => a + F.area, 0) / fs.length, storeys: `${Math.min(...fs.map((F) => F.storeys))}-${Math.max(...fs.map((F) => F.storeys))}` }];
  }));
  const close = [];
  let least = 9;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = M[list[i].id], b = M[list[j].id];
    const ways = [a.roles !== b.roles, a.adj !== b.adj, a.sides !== b.sides, a.corridor !== b.corridor, Math.abs(a.area / b.area - 1) >= 0.15, a.storeys !== b.storeys].filter(Boolean).length;
    least = Math.min(least, ways);
    if (ways < 2) close.push(`${list[i].id}/${list[j].id} (${ways})`);
  }
  check(!close.length, `${kind}: every two plans differ in at least two ways (the least: ${least})${close.length ? `: ${close.join(", ")}` : ""}`);
}

// ======================================================================================
console.log("\nEvery plan can turn up");
for (const kind of VARIANT_KINDS) {
  const list = VARIANTS[kind], frs = (FRANCHISES[kind] || []).map((f) => f.id);
  const keys = [...SETTINGS, ...(SITES[kind] || [])];
  const weighted = list.filter((v) => keys.some((k) => (v.w[k] || 0) > 0));
  if (frs.length) {
    const lost = list.filter((v) => !(v.fr || []).some((f) => frs.includes(f)));
    const thin = frs.filter((f) => list.filter((v) => (v.fr || []).includes(f)).length < 2);
    check(!lost.length && !thin.length && weighted.length === list.length, `${kind}: every plan is one of its ${frs.length} franchises' (${frs.map((f) => `${f} ${list.filter((v) => (v.fr || []).includes(f)).length}`).join(", ")})${lost.length ? `; none for ${lost.map((v) => v.id)}` : ""}`);
  } else check(weighted.length === list.length, `${kind}: every plan has a weight in a setting or a site (${weighted.length} of ${list.length})`);
}

// ======================================================================================
console.log(`\nThe loot per area: every plan by the dice against the plan before #36 (${LOOT_N} builds each)`);
const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
const meds = (def) => { const r = def.loot.meds; return r ? Math.min(0.95, r[0]) * ((r[1] + r[2]) / 2) : 0; };
const lootBy = {};
for (const kind of VARIANT_KINDS) {
  const measure = MEDICAL.has(kind) ? meds : value;
  const perArea = (pin) => {
    let v = 0, cells = 0;
    const byPlan = {};
    for (let s = 0; s < LOOT_N; s++) {
      const o = pin ? { plan: VARIANTS[kind][0].id } : { setting: SETTINGS[s % 4], site: s % 8 === 7 && SITES[kind] ? SITES[kind][0] : null };
      const { spec, m } = build(kind, 97000 + s * 104729, o);
      let bv = 0, bc = 0;
      for (const a of m.rooms) if (!a.outdoor) bc += Math.max(0, a.w - 2) * Math.max(0, a.h - 2);
      for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (!a || !a.type) continue; bv += measure(boxLoot(a.type, c.kind)) * Math.min(FLOOR_RICH.cap, Math.pow(FLOOR_RICH.perFloor, c.f || 0)); }
      v += bv; cells += bc;
      const id = spec.vid || "?";
      byPlan[id] = byPlan[id] || { v: 0, c: 0 }; byPlan[id].v += bv; byPlan[id].c += bc;
    }
    return { r: v / cells, byPlan };
  };
  const before = perArea(true), after = perArea(false);
  lootBy[kind] = { before: before.r, after: after.r, byPlan: after.byPlan };
  const unit = MEDICAL.has(kind) ? "meds" : "value";
  check(Math.abs(after.r / before.r - 1) <= 0.1, `${kind}: ${unit} per 100 cells ${(after.r * 100).toFixed(2)} against ${(before.r * 100).toFixed(2)} on the plan before (${((after.r / before.r - 1) * 100).toFixed(1)}%); by plan: ${Object.entries(after.byPlan).map(([id, x]) => `${id} ${((x.v / x.c) * 100).toFixed(1)}`).join(", ")}`);
}

console.log(`\nby the dice: ${VARIANT_KINDS.map((k) => `${k} ${byDice[k].sigs}`).join(", ")}`);
console.log(`\n${passes} passed, ${fails} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
