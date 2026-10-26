// Sports stadiums and arenas (issue #57, src/sim/stadium.js, stadiumlayout.js, data-stadiums.js; the user's request
// 2026-10-26: "different sports stadiums 500x500 max"). Checks:
//   - the registry: a dozen venues or more (variantpick.js "stadium"), ids unique, each with its REAL_SIZE sizes row;
//     the picker by #42's tile class: a city centre's venues huge (the pro ones), a town's large, the country's a rodeo;
//   - every venue, over SEEDS seeds: its map within STADIUM.CAP (MAP_CAP.stadium 500) and its plan named (vid, vname);
//     the bowl or grandstand with seats on two storeys or more; a concourse with concession stands and restrooms; the
//     field, court or track; the home and visitors' locker rooms and the players' tunnel; the press box and a luxury
//     suite; the ticket office and the gates with their turnstiles; security and the first-aid room; the team store;
//     groundskeeping; a parking lot or a garage; the stands' rail on the field side with steps down to the field; the
//     tunnel open onto the field; every walkable cell of every floor reached from the way in (doors as ways through,
//     the stairs between floors); the same map every visit;
//   - the scenes: a FEMA shelter on the field and a last stand on a concourse both turn up;
//   - a raid on one: the battle starts, the dead are on the map, the intro names the venue.
// Usage: node tools/stadiumtest.js [seeds]   (BS_QUICK=1: fewer)
import { createHash } from "node:crypto";
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { buildingMap, BUILDINGS, SITES } from "../src/sim/buildingmaps.js";
import { STADIUM, STADIUM_VARIANTS } from "../src/sim/stadium.js";
import { variantsOf, variantSize, pickVariant } from "../src/sim/variantpick.js";
import { REAL_SIZE } from "../src/sim/data-buildingsize.js";
import { mapCap } from "../src/sim/battlesize.js";
import { CELL, createBattle, registerCombatHandler } from "../src/sim/combat.js";
import { launchExpedition } from "../src/sim/parties.js";
import { Rng } from "../src/sim/rng.js";

const QUICK = !!process.env.BS_QUICK;
const SEEDS = Number(process.argv[2]) || (QUICK ? 2 : 4);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return !!ok; };
const t0 = performance.now();

const st = createWorld({ seed: 5757, factionCount: 4 });
const tile = st.tiles.find((t) => t.terrain === "plains" && !t.loc);

// ---------- the registry and the picker ----------
console.log("The venues");
{
  const list = variantsOf("stadium");
  check(list.length >= 12 && new Set(list.map((v) => v.id)).size === list.length, `${list.length} venues registered, ids unique`);
  check(list.every((v) => REAL_SIZE.stadium.sizes[v.id]), "each venue has its REAL_SIZE sizes row");
  check(mapCap("stadium") === 500 && STADIUM.CAP === 500, "the map cap is 500 × 500 (battlesize.js MAP_CAP.stadium)");
  check(SITES.stadium && SITES.stadium[0] === "stadium" && BUILDINGS.stadium.venue, "the site opens the venue (SITES.stadium)");
  const by = (ctx) => { const out = new Set(); for (let i = 0; i < 300; i++) out.add(pickVariant("stadium", new Rng(17 + i * 131), ctx).id); return out; }; // the ctx as #42's placementCtx gives it
  const centre = by({ tileClass: "centre", setting: "centre", size: "huge" }), town = by({ tileClass: "town", setting: "town", size: "large" }), rural = by({ tileClass: "rural", setting: "rural", size: "medium" });
  check([...centre].every((id) => variantSize("stadium", STADIUM_VARIANTS.find((v) => v.id === id)) === "huge") && centre.has("profootball") && centre.has("arena"), `a city centre's venues are the huge ones (${[...centre].join(", ")})`);
  check([...town].every((id) => variantSize("stadium", STADIUM_VARIANTS.find((v) => v.id === id)) === "large") && town.has("highschool") && town.has("minorleague"), `a town's are large: its high school stadium, its minor league ballpark (${[...town].join(", ")})`);
  check(rural.size === 1 && rural.has("rodeo"), `the country's is a rodeo arena (${[...rural].join(", ")})`);
}
// ---------- every venue ----------
const floorsOf = (m) => m.floors.map((F) => F.cells);
const walk = (c) => !!c && ((CELL[c.k] && CELL[c.k].walk) || ["door", "idoor", "odoor", "boarded", "bdoor", "doorway"].includes(c.k) || !!c.moved || !!c.frame) && c.k !== "void"; // a scene's boarded door or shoved piece: a way through for whoever batters or shoves it (scenestest's rule)
function lostCells(m) {
  const W = m.w, H = m.h, Fs = floorsOf(m), seen = Fs.map(() => new Uint8Array(W * H));
  const starts = [];
  for (const z of m.zones) for (let y = z.y0; y < z.y0 + z.h; y++) for (let x = z.x0; x < z.x0 + z.w; x++) if (walk(Fs[0][y * W + x])) starts.push([0, y * W + x]); // the vehicle stands in the first
  const stack = starts.slice(0, 1);
  while (stack.length) {
    const [f, i] = stack.pop();
    if (f < 0 || f >= Fs.length || seen[f][i] || !walk(Fs[f][i])) continue;
    seen[f][i] = 1;
    const x = i % W, y = (i / W) | 0, c = Fs[f][i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) stack.push([f, ny * W + nx]); }
    if (c.k === "stairs" && (c.top || c.step == null)) { stack.push([f + 1, i]); stack.push([f - 1, i]); }
  }
  let lost = 0;
  Fs.forEach((cells, f) => cells.forEach((c, i) => { if (walk(c) && c.f === "floor" && !seen[f][i]) { lost++; if (process.env.LOST && lost < 4) { const a = m.rooms.find((r) => !r.outdoor && (r.f || 0) === f && i % W >= r.x0 && i % W < r.x0 + r.w && ((i / W) | 0) >= r.y0 && ((i / W) | 0) < r.y0 + r.h); console.log(`    lost f${f} ${i % W},${(i / W) | 0} ${c.k} in ${a ? a.name : "?"}`); } } }));
  return lost;
}
const hashMap = (m) => createHash("sha1").update(JSON.stringify(m.floors.map((F) => F.cells.map((c) => c.k + (c.f || "")).join("")))).digest("hex").slice(0, 12);
const kindsIn = (m, a) => { const out = new Set(), cells = m.floors[a.f || 0].cells; for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) out.add(cells[y * m.w + x].k); return out; };

console.log(`\nEvery venue, ${SEEDS} seeds each`);
const sceneSeen = {};
const sizes = [];
for (const V of STADIUM_VARIANTS) {
  const errs = [];
  let w = 0, h = 0;
  for (let s = 0; s < SEEDS; s++) {
    const opt = { id: `st${V.id}${s}`, key: "stadium", name: "Stadium", plan: V.id };
    let m;
    try { m = buildingMap(st, tile.id, opt, s % 2 ? { kind: "car", id: 1 } : null); } catch (e) { errs.push(`seed ${s}: ${e.stack.split("\n").slice(0, 3).join(" ")}`); continue; }
    w = Math.max(w, m.w); h = Math.max(h, m.h);
    const R = m.rooms.filter((a) => !a.outdoor), named = (re) => R.filter((a) => re.test(a.name));
    const err = (msg) => errs.push(`seed ${s}: ${msg}`);
    if (m.w > STADIUM.CAP || m.h > STADIUM.CAP) err(`map ${m.w} × ${m.h}`);
    if (m.plan.vid !== V.id || m.vname !== V.name || !m.plan.venue) err("its plan not named");
    const seatsOn = new Set(R.filter((a) => a.role === "stands" && [...kindsIn(m, a)].some((k) => k === "stadseat" || k === "bleachers")).map((a) => a.f || 0));
    if (seatsOn.size < 2) err(`seats on ${seatsOn.size} storey(s)`);
    if (!R.some((a) => a.role === "concourse")) err("no concourse");
    if (named(/^Concession stand/).length < 2 || !R.some((a) => a.role === "restroom")) err("no concession stands or restrooms");
    if (!m.plan.field && !R.some((a) => a.stad === "court")) err("no field or court");
    if (R.filter((a) => a.role === "lockerroom").length < 2) err("fewer than two locker rooms");
    const tunnel = R.find((a) => a.tunnel);
    if (!tunnel) err("no players' tunnel");
    if (!named(/^Press box/).length || !R.some((a) => a.role === "suite")) err("no press box or suite");
    const gates = R.filter((a) => a.role === "gate");
    if (!named(/^Ticket office/).length || !gates.length || !gates.some((a) => kindsIn(m, a).has("turnstile"))) err("no ticket office or gates with turnstiles");
    if (!R.some((a) => a.type === "stadsec") || !named(/^First-aid/).length) err("no security or first aid");
    if (!R.some((a) => a.type === "proshop")) err("no team store");
    if (!R.some((a) => a.type === "groundskeep")) err("no groundskeeping");
    if (!(m.plan.grounds || []).some((g) => g.kind === "lot") && !m.plan.houses.some((p) => p.key === "parkgarage")) err("no parking");
    if (!m.floors.some((F) => F.cells.some((c) => c.k === "rail"))) err("no rail on the field side");
    if (m.plan.field) { // the tunnel and the steps open onto the field
      const F0 = m.floors[0].cells, W = m.w, ground = (c) => c && c.k === "open" && c.f !== "floor";
      const onto = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => ground(F0[(y + dy) * W + x + dx]));
      let steps = 0;
      for (let i = 0; i < F0.length; i++) { const c = F0[i]; if (c.k === "open" && c.f === "floor" && onto(i % W, (i / W) | 0)) steps++; }
      if (steps < 4) err(`${steps} ways down onto the field`);
    }
    const lost = lostCells(m);
    if (lost) err(`${lost} walkable cells cut off`);
    if (s === 0) { const again = buildingMap(st, tile.id, opt, null); if (hashMap(again) !== hashMap(buildingMap(st, tile.id, opt, null))) err("not the same map twice"); }
    for (const sc of (m.scenes && m.scenes.list) || []) sceneSeen[sc.kind] = (sceneSeen[sc.kind] || 0) + 1;
  }
  sizes.push(`${V.id} ${w}×${h}`);
  check(!errs.length, `${V.name}: ${errs.length ? errs.slice(0, 3).join("; ") : "as the issue lays it out"}`);
}
console.log(`  map sizes: ${sizes.join(", ")}`);
// More seeds for the scenes (they roll on each venue's own dice).
for (let s = 0; s < (QUICK ? 10 : 24) && !(sceneSeen.femashelter && sceneSeen.concoursestand); s++) for (const id of ["college", "soccer", "tennis"]) {
  const m = buildingMap(st, tile.id, { id: `sc${id}${s}`, key: "stadium", name: "Stadium", plan: id }, null);
  for (const sc of (m.scenes && m.scenes.list) || []) sceneSeen[sc.kind] = (sceneSeen[sc.kind] || 0) + 1;
}
check(sceneSeen.femashelter > 0 && sceneSeen.concoursestand > 0, `the scenes turn up: a FEMA shelter on the field (${sceneSeen.femashelter || 0}), a last stand on a concourse (${sceneSeen.concoursestand || 0})`);

// ---------- a raid ----------
console.log("\nA raid");
{
  registerCombatHandler("stadiumtest", () => {});
  st.started = true; st.cards.length = 0;
  const h = hub(st), crew = atBase(st, h.id).slice(0, 3);
  const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4, ammo: 30 } }).party;
  const t = st.tiles.find((x) => x.terrain === "city" && x.id !== h.tile) || tile;
  p.path = [t.id]; p.idx = 0; p.dest = t.id; p.phase = "engaged";
  const b = createBattle(st, { mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "stadiumtest", enemy: { kind: "zombies", count: 20, power: 3, groups: [{ kind: "zombies", count: 20, power: 3 }] }, raid: { heat0: 5, place: { id: "stadium:t", key: "stadium", name: "Stadium", plan: "soccer" } } });
  const dead = b.units.filter((u) => u.kind === "zombie" && !u.dead).length;
  const intro = (b.log || []).map((l) => (typeof l === "string" ? l : l.text || "")).join(" ");
  check(b.raid && b.raid.plan && b.raid.plan.venue && dead > 0, `the battle starts on the venue's map (${b.w} × ${b.h}, ${b.raid && b.raid.storeys} floors, ${dead} of the dead)`);
  check(/Soccer stadium/.test(intro), "the intro names the venue");
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
