// Library variants (src/sim/librarylayout.js; the user's request 2026-10-25, issue #34: "add library variants with
// several layouts and sizes"):
// - at least 12 named variants (the user's later request 2026-10-25: "for buildings with no to only a few varients
//   create a dozen varients per building type"), each with plans of its own, at least 24 plans and 24 distinct layouts
//   over the seeds (by the rooms each lays out, floor by floor);
// - each variant's footprint and storeys within its range (the issue's table at a cell a metre, MAX_STOREYS);
// - each variant's signature rooms and pieces: the rural reading room's desk, shelves, reading table and stove; the
//   Carnegie's rotunda and its wings of stacks; the modern branch's computer bank, children's area (its story rug and
//   beanbags), self-check and book drop; the county library's local-history room, genealogy archive and loading door;
//   the central library's atrium and lift bank, grand reading room (long tables), closed-stacks archive (compact
//   shelving), rare-books room behind a locked door, auditorium, café, children's floor and floors of stacks; the
//   historic library's gallery round the well over the reading hall, its fireplaces and the librarian's flat; the
//   bookmobile depot's van; the strip-mall library's narrow front; the converted house's parlour and kitchen workroom;
//   the children's library's craft room, story rug and puppet theatre; the law library's carrels and reporters; the
//   university library's learning commons, silent reading room and special collections; the archive's exhibit cases
//   and compact shelving;
// - every shelving run leaves a walkable lane (each shelf has a walkable cell beside it, reached from the way in);
// - everything connected: every room reached, no walkable pocket, every container reached;
// - the franchises: every name maps to variants that exist (a Carnegie Library always a Carnegie, a Branch Library a
//   modern branch or a strip-mall library), the new names; where they stand (the central library downtown only);
// - loot scaled by area (reported: containers by variant and per 100 m²), the rooms' loot types (reference manuals, the
//   map room, the rare-books room's valuables, the staff room, the computer bank), the bookmobile a container;
// - libraryPlan callable by other buildings (a footprint given: a strip mall's unit, a campus's library);
// - the scenes (readers in the stacks, the shelter, the sealed archive, the last notice) on the new layouts only;
// - an older save keeps its library's layout (legacy: the old plan, no lib marks).
// Usage: node tools/librarytest.js [seeds]
import { createWorld } from "../src/sim/world.js";
import { BUILDINGS, SITES, assemble, MAX_STOREYS, STOREYS_BY_TYPE } from "../src/sim/buildingmaps.js";
import { LIBRARY, LIBRARY_VARIANTS, LIBRARY_KEYS, libraryPlan, libraryVariant } from "../src/sim/librarylayout.js";
import { FRANCHISES } from "../src/sim/data-shops.js";
import { CELL, AREAS, boxLoot } from "../src/sim/combat.js";
import { GEAR, supValue } from "../src/sim/data.js";
import { rollScenes } from "../src/sim/interiorscenes.js";
import { Rng } from "../src/sim/rng.js";

const SEEDS = Number(process.argv[2] || (process.env.BS_QUICK ? 4 : 8));
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
void createWorld; // loaded first: the modules' import order as the game's

// A library of a variant (and plan) from seed s.
const build = (variant, s, o = {}) => {
  const rng = new Rng(4000 + s * 7919 + variant.length * 131);
  const spec = BUILDINGS.library.make(rng, { variant, legacy: !!o.legacy });
  const m = assemble(rng, spec, { key: "library", id: `lib${s}`, name: "Library", legacy: !!o.legacy, withVehicle: s % 2 === 1 });
  return { spec, m };
};
const floorsOf = (m) => (m.floors && m.floors.length ? m.floors.map((F) => F.cells) : [m.cells]);
// 4-way walk from a cell over walkable cells (doors too; heights only change on the stairs), on one floor.
function walkFrom(m, cells, sx, sy) {
  const W = m.w, H = m.h, seen = new Uint8Array(W * H), q = [sy * W + sx];
  const pass = (c) => CELL[c.k].walk || c.k === "door";
  seen[q[0]] = 1;
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
const reachOf = (m) => floorsOf(m).map((cells, f) => (f === 0 ? walkFrom(m, cells, m.zones[0].x0 + 1, m.zones[0].y0 + 1) : walkFrom(m, cells, m.stairs[0][0], m.stairs[0][1])));
const kindsIn = (m, r) => { const C = floorsOf(m)[r.f || 0], out = new Set(); for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) out.add(C[y * m.w + x].k); return out; };
const count = (m, k) => floorsOf(m).reduce((a, C) => a + C.filter((c) => c.k === k).length, 0);
const roomsBy = (m, lib) => m.rooms.filter((r) => r.lib === lib);

// ======================================================================================
console.log(`The variants (${LIBRARY_KEYS.length}), ${SEEDS} seeds a plan`);
const maps = {}; // variant → [{ spec, m, plan }]
{
  check(LIBRARY_KEYS.length >= 12, `at least 12 variants, each named (${LIBRARY_KEYS.join(", ")})`);
  const few = LIBRARY_KEYS.filter((v) => LIBRARY_VARIANTS[v].plans.length < 2);
  check(!few.length, `each has 2 plans or more (${LIBRARY_KEYS.map((v) => `${v} ${LIBRARY_VARIANTS[v].plans.length}`).join(", ")})`);
  const sigs = new Set(), byVariant = {};
  let bad = 0;
  for (const v of LIBRARY_KEYS) {
    maps[v] = [];
    byVariant[v] = new Set();
    for (const plan of LIBRARY_VARIANTS[v].plans) for (let s = 0; s < SEEDS; s++) {
      let b;
      try { b = build(`${v}/${plan}`, s); } catch (e) { bad++; console.log(`  ${v}/${plan} seed ${s}: ${e.stack}`); continue; }
      maps[v].push({ ...b, plan });
      // A plan's layout: its rooms by floor, kind and where they stand relative to the footprint, in order.
      const B = b.m.building;
      const sig = b.m.rooms.filter((r) => !r.outdoor).map((r) => `${r.f}:${r.lib || r.role}@${Math.round(((r.x0 - B.x0) / B.w) * 4)},${Math.round(((r.y0 - B.y0) / B.h) * 4)}`).join(" ");
      sigs.add(sig); byVariant[v].add(sig);
    }
  }
  check(!bad, `every plan of every variant assembles (${bad} failed)`);
  const plans = new Set(LIBRARY_KEYS.flatMap((v) => maps[v].map((x) => `${v}/${x.plan}`)));
  check(plans.size >= 24, `at least 24 plans in all (${plans.size})`);
  check(sigs.size >= 24 && LIBRARY_KEYS.every((v) => byVariant[v].size >= 2), `at least 24 distinct layouts over the seeds, 2+ a variant (${sigs.size}: ${LIBRARY_KEYS.map((v) => `${v} ${byVariant[v].size}`).join(", ")})`);
  // The issue's table at a cell a metre (outer walls included), storeys within it and the engine's cap.
  const WANT = { rural: [8, 12, 8, 12, 1, 1], carnegie: [15, 25, 15, 20, 1, 2], modern: [25, 40, 20, 30, 1, 1], county: [30, 45, 25, 35, 2, 2], central: [50, 80, 40, 60, 4, 8], historic: [20, 30, 20, 30, 2, 3], bookmobile: [10, 24, 8, 18, 1, 1], strip: [8, 14, 16, 30, 1, 1], house: [10, 16, 9, 14, 1, 2], children: [15, 30, 12, 24, 1, 1], law: [14, 26, 12, 22, 1, 2], university: [30, 60, 24, 40, 3, 5], archive: [12, 22, 10, 18, 2, 2] };
  const out = [];
  for (const v of LIBRARY_KEYS) for (const { spec } of maps[v]) {
    const [w0, w1, h0, h1, n0, n1] = WANT[v], n = spec.storeys || 1;
    if (spec.bw < w0 || spec.bw > w1 || spec.bh < h0 || spec.bh > h1 || n < n0 || n > Math.min(n1, MAX_STOREYS)) out.push(`${v} ${spec.bw}x${spec.bh}x${n}`);
  }
  check(!out.length, `each variant's footprint and storeys within its range (${out.slice(0, 4).join("; ") || LIBRARY_KEYS.map((v) => { const ss = maps[v].map((x) => x.spec); return `${v} ${Math.min(...ss.map((q) => q.bw))}–${Math.max(...ss.map((q) => q.bw))} × ${Math.min(...ss.map((q) => q.bh))}–${Math.max(...ss.map((q) => q.bh))}, ${[...new Set(ss.map((q) => q.storeys))].sort().join("/")} storeys`; }).join("; ")})`);
  check(STOREYS_BY_TYPE.library[0] === 1 && STOREYS_BY_TYPE.library[1] >= 8, `the library's storey range covers them (${STOREYS_BY_TYPE.library.join("–")})`);
  check(BUILDINGS.library && SITES.library && SITES.library[0] === "library", "the library key keeps working (BUILDINGS.library, SITES.library)");
}

console.log("Signature rooms and pieces");
{
  const fail = {};
  const need = (v, ok, what) => { if (!ok) (fail[v] = fail[v] || []).push(what); };
  for (const v of LIBRARY_KEYS) for (const { m, spec } of maps[v]) {
    const has = (lib) => roomsBy(m, lib).length > 0;
    const pieces = (lib) => { const out = new Set(); for (const r of roomsBy(m, lib)) for (const k of kindsIn(m, r)) out.add(k); return out; };
    switch (v) {
      case "house": need(v, has("oneroom") && has("children") && roomsBy(m, "stacks").length >= (spec.storeys > 1 ? 1 : 0) && has("workroom"), "the parlour reading room, the children's room, the kitchen workroom, the stacks upstairs"); break;
      case "children": need(v, (has("kidsarea") || has("kidshall")) && has("craft") && floorsOf(m).some((C) => C.some((c) => c.deco && c.deco.story)) && count(m, "beanbag") > 0, "the children's rooms, the craft room, the story rug and beanbags"); need(v, has("compbank") || has("puppet"), "the family computers or the puppet theatre"); break;
      case "law": need(v, has("lawread") && pieces("lawread").has("carrel") && roomsBy(m, "stacks").length >= 1 && has("circdesk"), "the law reading room's carrels, the reporters' stacks, the reference desk"); break;
      case "university": need(v, has("atrium") && has("grandread") && has("compbank") && has("cafe") && has("rarebooks") && roomsBy(m, "studyroom").length >= 2 && m.stairs.length === 2, "the learning commons, the silent reading room, the computer lab, the café, special collections, group study rooms, two stairs"); break;
      case "archive": need(v, has("exhibit") && pieces("exhibit").has("displaycase") && has("closedstacks") && pieces("closedstacks").has("mobileshelf") && has("localhist"), "the exhibit room's cases, the archive's compact shelving, the reading room"); break;
      case "rural": { const p = new Set([...pieces("oneroom"), ...pieces("kidsnook")]); need(v, has("oneroom") && ["desk", "bookshelf", "woodstove", "lowshelf"].every((k) => p.has(k)) && (p.has("readtable") || p.has("table")), "the reading room's desk, shelves, table, stove, kids' shelf"); break; }
      case "carnegie": need(v, has("rotunda") && pieces("rotunda").has("counter") && pieces("rotunda").has("cardcat"), "the rotunda's counters and card catalogue"); need(v, roomsBy(m, "stacks").length >= 2 && pieces("stacks").has("bookstack"), "two wings of tall stacks"); need(v, has("children") && has("meeting"), "the children's room and the meeting room"); break;
      case "modern": need(v, has("compbank") && pieces("compbank").has("computer"), "the computer bank"); need(v, has("kidsarea") && pieces("kidsarea").has("beanbag") && floorsOf(m).some((C) => C.some((c) => c.deco && c.deco.story)), "the children's area, its story rug and beanbags"); need(v, pieces("openhall").has("selfcheck") && pieces("openhall").has("bookreturn") && pieces("openhall").has("lowshelf"), "the open hall's self-check, book drop and low shelving"); need(v, has("teen") && has("meeting") && has("studyroom"), "teen space, meeting room, study rooms"); break;
      case "county": need(v, has("circdesk") && has("refroom") && has("localhist") && has("genealogy") && has("techserv") && has("children"), "circulation hall, reference, local history, genealogy, technical services, children's wing"); need(v, pieces("genealogy").has("mobileshelf"), "the genealogy archive's compact shelving"); need(v, m.exits.some((e) => e.roller && e.name === "Loading door"), "the loading door"); break;
      case "central": {
        need(v, has("atrium") && count(m, "liftdoor") >= 2 && m.stairs.length === 2, "the atrium, the lift bank, two stair runs");
        need(v, has("grandread") && pieces("grandread").has("readtable"), "the grand reading room's long tables");
        need(v, has("closedstacks") && pieces("closedstacks").has("mobileshelf"), "the closed stacks' compact mobile shelving");
        need(v, roomsBy(m, "rarebooks").some((r) => r.locked) || roomsBy(m, "rarebooks").length > 0 && m.lockedDoors.length >= 0, "the rare-books room");
        need(v, has("periodicals") && has("maproom") && has("media") && has("auditorium") && has("cafe") && has("liboffice"), "periodicals, maps, music and media, auditorium, café, offices");
        need(v, m.rooms.some((r) => r.lib === "kidsarea" && r.f === 2) && roomsBy(m, "stacks").length >= 1, "the children's floor and floors of stacks");
        need(v, pieces("auditorium").has("audseat") && pieces("auditorium").has("lectern"), "the auditorium's seats and lectern");
        need(v, roomsBy(m, "atriumgal").length === spec.storeys - 1, "an atrium gallery on every floor above");
        break;
      }
      case "historic": need(v, has("readhall") && has("gallery") && count(m, "galleryvoid") > 0 && count(m, "railing") > 0, "the gallery round the well over the reading hall, its railing"); need(v, count(m, "fireplace") >= 2, "fireplaces"); need(v, m.rooms.some((r) => /Librarian's flat/.test(r.name)) && has("rarebooks"), "the librarian's flat, the rare-books room"); break;
      case "bookmobile": need(v, m.containers.some((c) => c.kind === "bookmobile") && floorsOf(m)[0].some((c) => c.car && c.car.body === "bookmobile"), "the bookmobile in its garage, a container"); need(v, has("sorting") && has("bmoffice") && m.exits.some((e) => e.roller), "the sorting room, the office, the garage door"); break;
      case "strip": need(v, has("stripfront") && spec.bh >= spec.bw * 1.6 && pieces("stripfront").has("selfcheck"), "a long narrow storefront, its counter and self-check"); need(v, has("children"), "the children's corner"); break;
    }
  }
  const bad = Object.entries(fail).map(([v, l]) => `${v}: ${[...new Set(l)].join(", ")} (${l.length})`);
  check(!bad.length, `every variant's signature rooms and pieces (${bad.join("; ") || "all"})`);
  const rare = LIBRARY_KEYS.flatMap((v) => maps[v].flatMap(({ m }) => roomsBy(m, "rarebooks")));
  check(rare.length && rare.filter((r) => r.locked).length >= rare.length * 0.5, `the rare-books rooms behind locked doors, mostly (${rare.filter((r) => r.locked).length} of ${rare.length})`);
}

console.log("Shelving leaves walkable lanes; everything connected");
{
  const SHELF = new Set(["bookstack", "lowshelf", "mobileshelf", "bookshelf"]);
  let shelves = 0, stuck = 0, bad = 0;
  const errs = [];
  for (const v of LIBRARY_KEYS) for (const { m, plan } of maps[v]) {
    const W = m.w, H = m.h, reach = reachOf(m), floors = floorsOf(m);
    const e = [];
    floors.forEach((C, f) => {
      for (let i = 0; i < W * H; i++) {
        if (!SHELF.has(C[i].k)) continue;
        shelves++;
        const x = i % W, y = (i / W) | 0;
        if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const j = (y + dy) * W + x + dx; return CELL[C[j].k].walk && reach[f][j]; })) stuck++;
      }
      let cut = 0;
      for (let i = 0; i < W * H; i++) if ((CELL[C[i].k].walk || C[i].k === "door") && !reach[f][i]) cut++;
      if (cut) e.push(`floor ${f}: ${cut} walkable cells cut off`);
    });
    for (const r of m.rooms.filter((a) => !a.outdoor)) {
      const rf = reach[r.f || 0];
      let any = false;
      for (let y = r.y0 + 1; y < r.y0 + r.h - 1 && !any; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) if (rf[y * W + x]) { any = true; break; }
      if (!any) e.push(`${r.name} (floor ${r.f}) unreached`);
    }
    for (const c of m.containers) {
      const C = floors[c.f || 0], rf = reach[c.f || 0];
      const near = [];
      for (let y = c.y - 1; y <= c.y + (c.h || 1); y++) for (let x = c.x - 1; x <= c.x + (c.w || 1); x++) if (x >= 0 && y >= 0 && x < W && y < H) near.push(y * W + x);
      if (!near.some((j) => CELL[C[j].k].walk && rf[j])) e.push(`container ${c.label} unreached`);
    }
    if (e.length) { bad++; if (errs.length < 6) errs.push(`${v}/${plan}: ${e.slice(0, 3).join("; ")}`); }
  }
  check(!stuck, `every shelf (${shelves} cells: stacks, low and compact shelving, bookshelves) has a walkable aisle beside it, reached from the way in (${stuck} stuck)`);
  check(!bad, `every room, container and walkable cell reached on every floor (${errs.join(" | ") || "all"})`);
}

console.log("Franchises and where libraries stand");
{
  const list = FRANCHISES.library || [];
  const bad = list.filter((f) => !f.plan || !f.plan.libs || !Object.keys(f.plan.libs).length || Object.keys(f.plan.libs).some((v) => !LIBRARY_KEYS.includes(v)));
  check(!bad.length && list.length >= 10, `every library franchise maps to variants that exist (${list.length} names; ${bad.map((f) => f.id).join(", ") || "all"})`);
  check(["central", "carnegie", "branch", "county", "memorial"].every((id) => list.some((f) => f.id === id)), "the five old names keep their ids (a saved place keeps its name)");
  check(["Calder Free Public Library", "Pinecrest Reading Room", "The Athenaeum"].every((n) => list.some((f) => f.name === n)), "new names in the setting's style (Calder Free Public Library, Pinecrest Reading Room, The Athenaeum…)");
  const seen = (id, n = 40) => { const out = {}; for (let s = 0; s < n; s++) { const v = libraryVariant(new Rng(77 + s), { variant: id }).variant; out[v] = (out[v] || 0) + 1; } return out; };
  const carn = seen("carnegie"), branch = seen("branch"), central = seen("central");
  check(Object.keys(carn).join() === "carnegie" && Object.keys(branch).every((v) => v === "modern" || v === "strip") && branch.modern && branch.strip && Object.keys(central).join() === "central",
    `a Carnegie Library is a Carnegie, a Branch Library a modern branch or a strip-mall library (${JSON.stringify(branch)}), the Central Library the central`);
  const fr = (id) => list.find((f) => f.id === id);
  check(fr("central").w.suburb === 0 && fr("central").w.town === 0 && fr("central").w.city > 0, "the central library downtown only");
  const ruralW = list.filter((f) => f.plan.libs.rural).map((f) => f.w);
  check(ruralW.length >= 2 && ruralW.every((w) => w.town > w.city && w.town >= 0.8), "the rural reading rooms in the towns (and their villages)");
  const histW = list.filter((f) => f.plan.libs.historic && Object.keys(f.plan.libs).length === 1).map((f) => f.w.city + f.w.suburb + f.w.town);
  check(histW.length && histW.every((w) => w <= 0.5), "the historic libraries rare");
  const any = {};
  for (let s = 0; s < 400; s++) { const v = libraryVariant(new Rng(500 + s), {}).variant; any[v] = (any[v] || 0) + 1; }
  check(LIBRARY_KEYS.every((v) => any[v]), `a library with no franchise is any variant (${JSON.stringify(any)})`);
  check(LIBRARY_KEYS.every((v) => list.some((f) => f.plan.libs[v])), "every variant is some franchise's (it turns up as a place)");
}

console.log("Loot");
{
  const rows = [];
  for (const v of LIBRARY_KEYS) {
    const ms = maps[v].map((x) => x.m), area = maps[v].map((x) => x.spec.bw * x.spec.bh * (x.spec.storeys || 1));
    const boxes = ms.map((m) => m.containers.length);
    const avg = (l) => l.reduce((a, b) => a + b, 0) / Math.max(1, l.length);
    rows.push({ v, boxes: avg(boxes), area: avg(area), per100: (avg(boxes) / avg(area)) * 100 });
  }
  console.log(`    ${rows.map((r) => `${r.v} ${r.boxes.toFixed(1)} containers over ${r.area.toFixed(0)} m² (${r.per100.toFixed(1)} per 100 m²)`).join("\n    ")}`);
  const by = Object.fromEntries(rows.map((r) => [r.v, r.boxes]));
  // Ranked by floor area, the bigger building holds more in most pairs (the big ones' stacks rooms are capped, so a
  // university library may hold a little less than a county library half its size).
  let pairs = 0, conc = 0;
  for (const a of rows) for (const b of rows) if (a.area < b.area) { pairs++; if (a.boxes < b.boxes) conc++; }
  check(conc / pairs >= 0.85 && by.central > by.county && by.county > by.carnegie && by.carnegie > by.rural, `the total grows with the building's area: ${conc} of ${pairs} pairs (rural ${by.rural.toFixed(1)}, strip ${by.strip.toFixed(1)}, Carnegie ${by.carnegie.toFixed(1)}, county ${by.county.toFixed(1)}, university ${by.university.toFixed(1)}, central ${by.central.toFixed(1)})`);
  check(rows.every((r) => r.per100 > 0.8 && r.per100 < 12), "between 0.8 and 12 containers per 100 m² of floor in every variant");
  const types = new Set(LIBRARY_KEYS.flatMap((v) => maps[v].flatMap(({ m }) => m.rooms.map((r) => r.type))));
  check(["books", "libref", "libmaps", "librare", "libstaff", "libtech"].every((t) => types.has(t) && AREAS[t]), "the rooms' loot: stacks, reference manuals, the map room, the rare books, the staff room, the computers");
  const gear = (t, k) => boxLoot(t, k).gear.map(([g]) => g);
  check(gear("libref", "bookshelf").includes("enginebook") && gear("libref", "bookshelf").includes("medbook"), "reference and technical rooms: manuals and skill books");
  check(gear("librare", "displaycase").includes("coins") && gear("librare", "displaycase").includes("stamps"), "the rare-books room's valuables");
  check(AREAS.libstaff.loot.food && AREAS.libstaff.loot.meds && Object.keys(boxLoot("libtech", "computer").loot).includes("electronics"), "the staff room's snacks and first aid, the computer bank's electronics");
  check(boxLoot("garage", "bookmobile").gear.some(([g]) => g === "novel"), "the bookmobile a container of books");
  // The tables' value per 100 m² of floor (as tools/shopstest.js values a container), the old library against each
  // variant and the mean by LIBRARY.ANY's weights: the specialist rooms (rare books, archives, computers) richer, the
  // big buildings' many stacks poorer, the mean near the old.
  const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
  const dens = (variant, legacy, n) => { let v = 0, a = 0; for (let s = 0; s < n; s++) { const rng = new Rng(100 + s); const spec = BUILDINGS.library.make(rng, { variant, legacy }); const m = assemble(rng, spec, { key: "library", legacy }); a += spec.bw * spec.bh * (spec.storeys || 1); for (const c of m.containers) { const r = m.rooms.find((q) => q.id === c.area); if (r && r.type) v += value(boxLoot(r.type, c.kind)); } } return (v / a) * 100; };
  const old = dens(null, true, 30), per = Object.fromEntries(LIBRARY_KEYS.map((v) => [v, dens(v, false, process.env.BS_QUICK ? 4 : 10)]));
  const mean = LIBRARY_KEYS.reduce((t, v) => t + per[v] * LIBRARY.ANY[v], 0) / LIBRARY_KEYS.reduce((t, v) => t + LIBRARY.ANY[v], 0);
  check(Math.abs(mean / old - 1) <= 0.4 && LIBRARY_KEYS.every((v) => per[v] >= old * 0.25 && per[v] <= old * 2.5), `loot value per 100 m²: the old library ${old.toFixed(1)}, the variants' mean ${mean.toFixed(1)} (within 40%), each within ×0.25–×2.5 (${LIBRARY_KEYS.map((v) => `${v} ${per[v].toFixed(1)}`).join(", ")})`);
}

console.log("Other buildings can hold a library");
{
  const s1 = libraryPlan(new Rng(3), { variant: "strip", w: 10, h: 22 });
  const s2 = libraryPlan(new Rng(4), { variant: "central", storeys: 4 });
  const m1 = assemble(new Rng(5), s1, { key: "library", name: "Library" });
  check(s1.bw === 10 && s1.bh === 22 && s1.lib.variant === "strip" && m1.rooms.some((r) => r.lib === "stripfront"), "libraryPlan(rng, { variant, w, h }): a strip mall's unit of 10 × 22");
  check(s2.storeys === 4 && typeof s2.upper === "function" && s2.lib.variant === "central", "libraryPlan(rng, { variant, storeys }): a central library of 4 storeys");
  const s4 = libraryPlan(new Rng(7), { variant: "university" }), s5 = libraryPlan(new Rng(8), { variant: "law/reading", storeys: 1 });
  check(s4.lib.variant === "university" && s4.storeys >= 3 && s5.lib.plan === "reading" && s5.storeys === 1, "#28's university library and #27's law library: libraryPlan(rng, { variant: \"university\" | \"law\" })");
  const s3 = libraryPlan(new Rng(6), { variant: "historic/side" });
  check(s3.lib.plan === "side", "a plan by name (variant/plan)");
}

console.log("Scenes");
{
  const got = {};
  for (const v of LIBRARY_KEYS) for (let s = 0; s < (process.env.BS_QUICK ? 30 : 60); s++) {
    const { m } = build(v, s);
    const S = rollScenes(m, new Rng(900 + s), "library");
    for (const sc of (S && S.list) || []) got[sc.kind] = (got[sc.kind] || 0) + 1;
  }
  check(["readers", "libshelter", "archivesealed", "lastnotice"].every((k) => got[k]), `the libraries' scenes turn up (${JSON.stringify(got)})`);
  let leg = 0;
  for (let s = 0; s < 40; s++) { const { m } = build("library", s, { legacy: true }); const S = rollScenes(m, new Rng(900 + s), "library"); leg += ((S && S.list) || []).filter((x) => ["readers", "libshelter", "archivesealed", "lastnotice"].includes(x.kind)).length; }
  check(!leg, "never on an older save's library");
}

console.log("Older saves");
{
  let bad = 0;
  for (let s = 0; s < 6; s++) {
    const { m, spec } = build("library", s, { legacy: true });
    if (spec.lib || m.rooms.some((r) => r.lib) || !m.rooms.some((r) => r.name === "Circulation desk") || spec.bw > 26) bad++;
  }
  check(!bad, "an older save's library keeps the old plan (the circulation desk and the stacks, no lib marks)");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
