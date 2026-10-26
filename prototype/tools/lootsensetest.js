// Loot that makes sense for every building type (src/sim/lootsense.js; issue #43, the user's request 2026-10-26: "Each
// building type here and and existing should have loot that makes sense").
// Every buildingmaps.js BUILDINGS key, 100 buildings of it (25 of a compound: a mall, a campus, a prison, each dozens
// of buildings; the same under BS_QUICK: the economy's band needs every plan's mean; about 2 minutes), laid out by
// buildingMap as a raid lays them out, every container rolled as a search rolls it (combat.js boxFinds: its table and
// a small find; areaExtras: the per-area finds on their own dice), bodies and the scenes' stashes left out:
// - the table: every building type has a LOOT_SENSE row, every row a building type, every group a GROUPS entry
// - signature finds: each row's sig groups turn up in at least that share of its buildings
// - never: none of a row's never groups in its own rooms; none of PERSONAL_NEVER (the Army's weapons) in the people's
//   own rooms (a house's, a flat's, a guest room's)
// - the economy: each kind's loot (the tables' value of every container, as tools/shopstest.js values it) within ±10%
//   of BASELINE (today's per kind, measured on dev at 016f555 before this ticket's fixes; the same plans, so per area
//   too), unless SHIFTED says why a row was clearly wrong
// Usage: node tools/lootsensetest.js [key ...] [--report] [--why <group>] [--baseline]
//   --report: every kind's rate for every group; --why <group>: where that group came from (item, room, piece, the
//   table or the extras); --baseline: print each kind's value as a BASELINE line.
import { createWorld } from "../src/sim/world.js";
import { BUILDINGS, SITES, buildingMap } from "../src/sim/buildingmaps.js";
import { boxLoot, boxFinds, areaExtras } from "../src/sim/combat.js";
import { GEAR, supValue } from "../src/sim/data.js";
import { Rng } from "../src/sim/rng.js";
import { GROUPS, PERSONAL, PERSONAL_NEVER, LOOT_SENSE, groupsOf } from "../src/sim/lootsense.js";

const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true; };
const REPORT = flag("--report"), BASE = flag("--baseline");
const whyAt = args.indexOf("--why"), WHY = whyAt >= 0 ? args.splice(whyAt, 2)[1] : null;
const ONLY = args.length ? args : null;
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);

// Today's loot per kind (the tables' value of all its containers, a building's mean over its seeds below), measured on
// dev at 016f555 with --baseline before this ticket's fixes. A new building type adds its line (--baseline <key>).
const BASELINE = {
  house: 173.8, farmhouse: 230.0, cabin: 88.9, lodge: 278.4, ranger: 115.4, grocery: 191.5, corner: 238.7,
  pharmacy: 599.7, gunstore: 610.7, pawnshop: 537.8, sportshop: 470.7, electronics: 336.8, radioshop: 214.4,
  bookstore: 42.3, petstore: 237.8, garden: 274.0, clothing: 142.6, liquor: 89.7, restaurant: 309.7, pizza: 343.0,
  bar: 196.9, dealer: 382.0, bank: 169.4, library: 69.7, vet: 248.6, hardware: 713.5, feedstore: 292.0, diner: 191.9,
  gasstation: 210.9, truckstop: 706.1, supermarket: 1784.2, deptstore: 421.2, clinic: 336.7, infirmary: 511.4,
  hospital: 2093.3, police: 376.1, school: 244.6, offices: 419.3, lab: 396.5, barracks: 1540.5, armorybldg: 794.1,
  cellblock: 164.2, messhall: 323.7, control: 238.9, radio: 218.4, radiotower: 223.3, terminal: 348.4, firestation: 512.7, hq: 752.7,
  aidstation: 212.6, gatehouse: 371.0, tower: 459.6, flightops: 318.6, warehouse: 283.2, factory: 347.9,
  hangar: 444.5, motorpool: 503.0, autoshop: 205.2, garage: 108.8, workshop: 136.0, machineshed: 102.7, barn: 161.7,
  church: 112.6, motel: 328.2, apartments: 623.0, hotel: 811.0, storefront: 43.4, bizpark: 288.6, cityhall: 423.5,
  courthouse: 402.6, callcenter: 205.4, techoffice: 231.8, station: 169.8, neighbourhood: 653.7, prison: 3437.2,
  jail: 989.3, campus: 10023.8, dorm: 339.8, lecturehall: 121.6, sciencehall: 330.7, univlibrary: 139.4,
  studentunion: 384.7, dininghall: 268.6, athletics: 105.8, admin: 260.0, security: 191.0, maintenance: 180.0,
  theatre: 73.7, parkgarage: 557.6, chapel: 152.2, healthcentre: 508.4, milbunker: 1415.1, mountainbunker: 1827.5,
  govbunker: 1037.7, shelter: 151.4, prepper: 273.0, regionalmall: 17794.1, stripmall: 2735.9, outlet: 3947.1,
  cinema: 52.7, arcade: 53.4, mallservices: 89.9, mallrestrooms: 18.5, vacantunit: 5.9,
  gym: 117.6, bowling: 180.5, // issue #56 (a campus athletics building 105.8)
};
// Kinds whose loot moved past ±10% because a row was clearly wrong: the reason.
const SHIFTED = {
  bookstore: "its shelves (data-shops.js AREA_DEFS books) held no books of their own: novels, comics, magazines, a few skill books",
  library: "its stacks are the bookstore's \"books\" rooms (above)",
  univlibrary: "its stacks are the bookstore's \"books\" rooms (above)",
};

const BIG = (key) => !!(BUILDINGS[key].compound || BUILDINGS[key].campus || BUILDINGS[key].complex);
const cat = (k) => (GEAR[k] && GEAR[k].cat) || "";
const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
const listOf = (s) => (Array.isArray(SITES[s]) ? SITES[s] : SITES[s].list).map((e) => (Array.isArray(e) ? e[0] : e));
const siteOf = (key) => (LOOT_SENSE[key] && LOOT_SENSE[key].site) || (SITES[key] && listOf(key).includes(key) ? key : Object.keys(SITES).find((s) => listOf(s).includes(key)) || null);

const st = createWorld({ seed: 42, factionCount: 7 });
st.started = true;
const city = st.tiles.find((t) => t.loc && t.loc.type === "city");
const tileFor = (site) => st.tiles.find((t) => t.loc && t.loc.type === site) || city;

// One kind: its buildings' containers rolled. rate[g]: the share of buildings with g anywhere; own[g] / mine[g]: the
// containers with g in the kind's own rooms / the personal rooms ([count, an example]); v: the mean value a building.
function survey(key) {
  const n = BIG(key) ? 25 : 100, site = siteOf(key), tile = tileFor(site);
  const rate = {}, own = {}, mine = {}, why = {};
  let v = 0, boxes = 0;
  for (let i = 0; i < n; i++) {
    const m = buildingMap(st, tile.id, { id: `sense:${key}:${i}`, key, name: BUILDINGS[key].name }, false);
    const rooms = new Map((m.rooms || []).map((r) => [r.id, r]));
    const rng = new Rng(4300 + i * 7919 + key.length), seen = new Set();
    for (const c of m.containers || []) {
      const a = rooms.get(c.area);
      if (c.kind === "body" || c.stash || !a || !a.type) continue;
      boxes++;
      const def = boxLoot(a.type, c.kind, false);
      v += value(def);
      const bid = `${key}${i}#${c.id}`;
      const got = boxFinds(st, rng, { def, type: a.type, rich: 1, scav: 0, reward: 1, site, gunSite: site, deep: null, tileId: tile.id, bid });
      const ex = areaExtras(st, tile.id, a.type, c.kind, site, site, `box${bid}`);
      const sup = { ...got.sup };
      for (const [k, q] of Object.entries(ex.sup)) sup[k] = (sup[k] || 0) + q;
      const tab = got.gear.map((it) => it.key), add = ex.gear.map((it) => it.key);
      const gs = groupsOf(sup, [...tab, ...add], cat), personal = PERSONAL.has(a.type) && !(LOOT_SENSE[key] && LOOT_SENSE[key].strict);
      const where = `${a.type}/${c.kind} (${String(a.name).replace(/ \d+\b/g, "").replace(/ \(upstairs\)/, "")})`;
      for (const g of gs) {
        seen.add(g);
        const T = personal ? mine : own;
        if (!T[g]) T[g] = [0, null];
        T[g][0]++;
        if (!T[g][1]) T[g][1] = where;
        if (g === WHY) {
          const d = GROUPS[g];
          const items = [...tab.map((k) => [k, "table"]), ...add.map((k) => [k, "extras"])].filter(([k]) => d.item && d.item(k, cat(k)));
          const sups = (d.sup || []).filter((k) => (sup[k] || 0) > 0).map((k) => [k, "table"]);
          for (const [k, from] of [...items, ...sups]) { const w = `${k} in ${where} [${from}]${personal ? " personal" : ""}`; why[w] = (why[w] || 0) + 1; }
        }
      }
    }
    for (const g of seen) rate[g] = (rate[g] || 0) + 1 / n;
  }
  return { n, rate, own, mine, why, v: v / n, boxes: boxes / n, site };
}

const keys = ONLY || Object.keys(BUILDINGS);
const G = Object.keys(GROUPS);

section("The table (lootsense.js LOOT_SENSE)");
if (!ONLY) {
  const missing = Object.keys(BUILDINGS).filter((k) => !LOOT_SENSE[k]);
  check(!missing.length, `every building type has a row (${Object.keys(BUILDINGS).length} types${missing.length ? `; none for ${missing.join(", ")}` : ""})`);
  const stray = Object.keys(LOOT_SENSE).filter((k) => !BUILDINGS[k]);
  check(!stray.length, `every row is a building type${stray.length ? ` (not: ${stray.join(", ")})` : ""}`);
}
const badG = Object.entries(LOOT_SENSE).flatMap(([k, r]) => [...Object.keys(r.sig || {}), ...(r.never || [])].filter((g) => !GROUPS[g]).map((g) => `${k}: ${g}`));
check(!badG.length, `every group a row names is a GROUPS entry${badG.length ? ` (${badG.join(", ")})` : ""}`);
const noSig = Object.entries(LOOT_SENSE).filter(([, r]) => !Object.keys(r.sig || {}).length).map(([k]) => k);
check(!noSig.length, `every row names its signature finds${noSig.length ? ` (none: ${noSig.join(", ")})` : ""}`);

const out = {};
for (const key of keys) out[key] = survey(key);

if (REPORT) {
  section("Rates by kind (% of buildings with the group anywhere)");
  console.log("kind".padEnd(15) + G.map((g) => g.slice(0, 6).padStart(7)).join(""));
  for (const key of keys) console.log(key.padEnd(15) + G.map((g) => { const r = out[key].rate[g] || 0; return (r ? (r * 100).toFixed(0) : ".").padStart(7); }).join("") + `  (${out[key].boxes.toFixed(0)} boxes, ${out[key].site})`);
}
if (WHY) {
  section(`Where ${WHY} came from`);
  for (const key of keys) {
    const w = Object.entries(out[key].why).sort((a, b) => b[1] - a[1]);
    if (w.length) console.log(`${key}:\n${w.slice(0, 12).map(([s, n]) => `   ${n}× ${s}`).join("\n")}`);
  }
}
if (BASE) {
  section("BASELINE lines");
  console.log(keys.map((k) => `${k}: ${out[k].v.toFixed(1)}`).join(", "));
}

section("Signature finds");
for (const key of keys) {
  const r = LOOT_SENSE[key];
  if (!r) continue;
  const low = Object.entries(r.sig || {}).filter(([g, p]) => (out[key].rate[g] || 0) < p).map(([g, p]) => `${GROUPS[g] ? GROUPS[g].label : g} ${((out[key].rate[g] || 0) * 100).toFixed(0)}% (wants ${(p * 100).toFixed(0)}%)`);
  check(!low.length, `${key}: ${low.length ? low.join("; ") : Object.keys(r.sig || {}).map((g) => `${g} ${((out[key].rate[g] || 0) * 100).toFixed(0)}%`).join(", ")} (${out[key].n} buildings)`);
}

section("Never there");
for (const key of keys) {
  const r = LOOT_SENSE[key];
  if (!r) continue;
  const bad = (r.never || []).filter((g) => out[key].own[g]).map((g) => `${GROUPS[g].label} in ${out[key].own[g][0]} containers, e.g. ${out[key].own[g][1]}`);
  const badMine = PERSONAL_NEVER.filter((g) => out[key].mine[g]).map((g) => `${GROUPS[g].label} in ${out[key].mine[g][0]} personal containers, e.g. ${out[key].mine[g][1]}`);
  check(!bad.length && !badMine.length, `${key}: ${[...bad, ...badMine].join("; ") || `none of ${(r.never || []).join(", ") || "-"}`}`);
}

section("The economy: loot per kind within ±10% of today's");
{
  const off = [], rows = [], fresh = [];
  for (const key of keys) {
    const b = BASELINE[key], a = out[key].v;
    if (b == null) { fresh.push(`${key} ${a.toFixed(1)}`); continue; }
    const d = a / b - 1;
    rows.push(`${key} ${d >= 0 ? "+" : ""}${(d * 100).toFixed(0)}%`);
    if (Math.abs(d) > 0.1 && !SHIFTED[key]) off.push(`${key} ${a.toFixed(1)} against ${b.toFixed(1)}`);
  }
  check(!off.length, `every kind within ±10% (${off.length ? off.join("; ") : rows.join(", ")})`);
  for (const [k, why] of Object.entries(SHIFTED)) if (keys.includes(k) && BASELINE[k] != null) console.log(`  shifted on purpose: ${k} ${((out[k].v / BASELINE[k] - 1) * 100).toFixed(0)}%: ${why}`);
  if (fresh.length) console.log(`  no baseline yet (a new type: add its line with --baseline): ${fresh.join(", ")}`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
