// Layout variants for every building type (the user's requests 2026-10-25, issue #32: "add motel varients. every
// building should have several varients"; "for buildings with no to only a few varients create a dozen varients per
// building type"). For every BUILDINGS key, builds the building over many seeds and the three settings (rural, town,
// city; each franchise of its kind in turn where it has franchises, and each of this ticket's layouts pinned a few
// times), and counts its distinct plans by the plan signature (tools/plansig.js: the room roles, the role pairs with a
// door between them, the ways in, the footprint class or "multi" for several buildings on one map).
// Every type must show MIN_PLANS (12) distinct plans. A type with layouts here (buildvariants.js LAYOUTS: the motel,
// the homes, the rural buildings) must also have that many named layouts, every one built, and each layout's most
// common plan must differ from every other layout's in at least two of roles, adj, ent, shape, the storeys and
// corridor-or-open-plan, so a variant is a distinct plan and not a recolour; an older save's building takes none (the
// roomsLegacy rule); a POI's layout names it (pois.js poiName); the motel's are each checked for their own rooms
// (motelChecks); every layout's loot is printed (the tables' value and the containers a building).
// PENDING_OWNER: the types whose owner (#32's split and the other tickets of the epic) has not yet reached 12, and
// this ticket's own while it gets there: reported, never failed. Empty since 2026-10-26: every type of the epic (#7)
// reaches 12 (a new type that falls short goes here with its ticket until it does).
// THE REGISTRY (variantpick.js, issue #41: the shared picker every type's plans go through): every registered type
// (variantKeys; a plan's own sub-plans, opts.sub, aside) has MIN_PLANS entries or more, ids unique; every entry is
// reachable by the dice (some setting, site or franchise its table names, some roll) and its pin returns it (by id; by
// index or name where the type pins so); an older save's pick is null.
// Usage: node tools/varianttest.js [seeds per setting, default 24; BS_QUICK=1: 20]
import { createWorld } from "../src/sim/world.js";
import { BUILDINGS, buildingMap, buildingSpec } from "../src/sim/buildingmaps.js";
import { LAYOUTS, layoutName } from "../src/sim/buildvariants.js";
import { FRANCHISES } from "../src/sim/data-shops.js";
import { poisOf, poiName } from "../src/sim/pois.js";
import { poiPlace } from "../src/sim/poiraid.js";
import { planSignature } from "./plansig.js";
import { boxLoot } from "../src/sim/combat.js";
import { GEAR, supValue } from "../src/sim/data.js";
import { variantKeys, variantsOf, variantOpts, pickVariant, pickFrom, variantFor } from "../src/sim/variantpick.js";

// The types another ticket owns until it lands (issue #32 "Ownership"): none left (every ticket of the epic has landed).
export const PENDING_OWNER = {
};


// The distinct plans every type must show (the user's request 2026-10-25: "for buildings with no to only a few varients
// create a dozen varients per building type"), the motel's too; the layouts of a type with them here at least as many.
export const MIN_PLANS = 12;

const SEEDS = Number(process.argv[2]) || (process.env.BS_QUICK ? 20 : 24);
const SETTINGS = ["rural", "town", "city"];
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };

const state = createWorld({ seed: 4242, factionCount: 4 });
state.roomsLegacy = false;
const tileId = Object.values(state.tiles).find((t) => t.terrain === "plains" && !t.loc).id;

const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };

// ---------- the motel's first five as laid out (the user's request: "add motel varients"), every motel room ----------
// Each motel layout as the issue lays it out: every room a bed, a TV stand, a chest of drawers and its bathroom (a
// toilet); the motor court's (#23's L or U round its lot in a new save: its laundry, the manager's room; as a rectangle) outdoor stair, ice and vending nook, laundry, manager's flat and empty pool behind its
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
  for (const a of rooms) { const k = kinds(a); for (const p of ["bed", "dresser"]) if (!k.has(p)) { err(`${a.name}: no ${p}`); break; } }
  const tv = rooms.filter((a) => kinds(a).has("tvstand")).length; // the TV stand where the room has the wall for it (a real-size wing's narrow room may not)
  if (tv < rooms.length * 0.85) err(`a TV stand in ${tv} of ${rooms.length} rooms`);
  if (!rooms.length || baths.length < rooms.length) err(`${baths.length} bathrooms for ${rooms.length} rooms`);
  const studio = (a) => { const k = kinds(a); return k.has("stove") && k.has("fridge") && k.has("sink"); };
  const cells0 = grid(0);
  if (lay === "court" && m.building && m.building.parts) { // a new save's motor court round its lot (#23's L or U: buildingmaps.js motelShaped)
    if (m.storeys !== 2 || m.building.parts.length < 3) err("not an L or a U of two storeys");
    if (!named(/Laundry/).length || !named(/Manager/).length) err("no laundry or manager's room");
  } else if (lay === "court") {
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

// ---------- the plan signature (tools/plansig.js, shared with the owners' own variant tests) ----------
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
    const g = planSignature(m, buildingSpec(state, tileId, opt).foot || null), k = g.key;
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
  const need = MIN_PLANS;
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

// ---------- the registry (variantpick.js) ----------
{
  const keys = variantKeys(), types = keys.filter((k) => !variantOpts(k).sub);
  check(types.length >= 100, `${types.length} registered types (want every type with named plans)`);
  const unreachable = [], short = [], pins = [], dup = [];
  const ROLLS = Array.from({ length: 240 }, (_, i) => (i + 0.5) / 240);
  for (const key of keys) {
    const list = variantsOf(key), opts = variantOpts(key);
    if (!opts.sub && list.length < MIN_PLANS) short.push(`${key} ${list.length}`);
    if (new Set(list.map((e) => e.id)).size !== list.length) dup.push(key);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (pickVariant(key, null, { plan: e.id }) !== e) pins.push(`${key}/${e.id}`);
      if (opts.index && pickVariant(key, null, { plan: i }) !== e) pins.push(`${key}#${i}`);
    }
    // Reachable: some roll, with no setting or one of the words its weights name (a setting, a site), alone or with a
    // franchise its plans name.
    const words = [null, ...new Set(list.flatMap((e) => Object.keys(e.w || {})))];
    const frs = [null, ...new Set(list.flatMap((e) => e.fr || []))];
    const seen = new Set();
    for (const w of words) for (const fr of frs) for (const r of ROLLS) {
      for (const ctx of [{ setting: w, franchise: fr, r }, { site: w, franchise: fr, r }]) { const got = pickVariant(key, null, ctx); if (got) seen.add(got.id); }
    }
    for (const e of list) if (!seen.has(e.id)) unreachable.push(`${key}/${e.id}`);
    check(pickVariant(key, null, { legacy: true }) === null, `${key}: an older save's pick is null`);
  }
  check(!short.length, `registered types with fewer than ${MIN_PLANS} plans: ${short.join(", ")}`);
  check(!dup.length, `registered types with an id twice: ${dup.join(", ")}`);
  check(!pins.length, `${pins.length} pins that do not return their plan (${pins.slice(0, 5).join(", ")})`);
  check(!unreachable.length, `${unreachable.length} plans the dice never reach (${unreachable.slice(0, 8).join(", ")})`);
  // The rules on a list of its own (pickFrom: not registered, so the counts above stay the game's).
  const D = [
    { id: "a", name: "A", w: { city: 1, rural: 0 }, fr: ["chain"] },
    { id: "b", name: "B", w: { city: 0, rural: 1, coast: 3 }, sizeClass: "small" },
    { id: "c", name: "C", w: { any: 1 }, sizeClass: "large", tile: ["scenic"] },
  ];
  const all = (ctx, o = {}) => new Set(ROLLS.map((r) => (pickFrom(D, null, { ...ctx, r }, o) || {}).id));
  const eq = (set, ids) => set.size === ids.length && ids.every((i) => set.has(i));
  check(pickFrom(D, null, { plan: "b", setting: "city", r: 0.1 }) === D[1] && pickFrom(D, null, { plan: 2, r: 0.1 }, { index: true }) === D[2] && pickFrom(D, null, { plan: 2, r: 0.1 }) !== null, "a pinned plan always wins (by id; by index where the type pins so)");
  check(eq(all({ franchise: "chain" }), ["a"]) && eq(all({ franchise: "none" }), ["a", "b", "c"]), "a franchise narrows the pool (one with no plans of its own: all)");
  check(eq(all({ setting: "city" }), ["a", "c"]) && eq(all({ setting: "rural" }), ["b", "c"]), "the setting's weights: a plan weighed 0 there never stands there; w.any where unnamed");
  check(eq(all({ size: "small" }), ["b"]) && eq(all({ tileClass: "scenic" }), ["c"]), "the size class and the tile class narrow the pool (#42's placementCtx)");
  check(eq(all({ tileClass: "coast" }), ["b", "c"]) && [...ROLLS].filter((r) => pickFrom(D, null, { tileClass: "coast", r }) === D[1]).length > ROLLS.length / 2, "an entry's w keyed by tile class weighs it there (3 to w.any's 1; unnamed and no w.any: 0)");
  check(pickFrom(D, null, { legacy: true, plan: "a" }) === null, "an older save's pick is null, pinned or not");
  check(variantFor(types[0], variantsOf(types[0])[0].id) === variantsOf(types[0])[0] && variantFor(types[0], "no such plan") === null, "variantFor finds a plan by id, null for none");
  const S = { state: 12345 };
  check(pickFrom(D, S, {}) === pickFrom(D, S, {}) && S.state === 12345, "no dice given: hash dice read from the building's dice, never consumed");
  console.log(`\nThe registry: ${types.length} types (${keys.length - types.length} sub-plan lists), ${keys.reduce((a, k) => a + variantsOf(k).length, 0)} plans`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
