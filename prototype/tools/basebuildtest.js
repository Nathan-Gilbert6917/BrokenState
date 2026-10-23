// Base building (src/sim/basemap.js, src/sim/buildings.js; docs/base-building/plan.md Part A, the user's request
// 2026-10-19): the no-build margin round every base's map, general buildings with fittings and indoor props inside
// them, doorways between buildings standing against each other, and the Base map view's Build.
// Checks: the margin (a placement within 5 cells of the edge refused with the reason, the auto layout never inside it,
// the view's cells marked, a camp still places everything it can build); general buildings and fittings (a hut and a
// cabin queued and finished with their spots, a fitting inside, refused outside, on the wall and inside the door, bunks
// counting as beds, the stove as a cook fire, a crafting bench inside and outside, the host moved and turned taking
// what is inside along, lifted and put down again, demolished with its fittings, the auto layout putting an unplaced
// fitting inside and leaving one off the map when nothing has room, shelves as a store on the map with its key, the
// yard pile); doorways (two cabins linked: canLink, neighboursOf, the two barred doors on the built map in both
// buildings' door lists, the cell inside kept clear, a stale link dropped when one is moved away, a queued building's
// link rewritten when it finishes); the view with no units, pickType + build queuing and placing a job (and a fitting
// onto a host), a refused spot leaving no job, demolish and select; buildMenu's groups; and a save / load round trip
// keeping hosts and links. A way in and out (plan Part F, reachProblem): a ring of huts round the core refused when
// the last one closes it (its door in: nothing could walk to it; its door out: the core shut off), allowed with a hall
// or a doorway link letting the walk through; a hut closing a pocket round a crate refused, the empty pocket fine; a
// fitting in a reached hut fine; a car across the lane to a hut's door refused; wall pieces (merged from the wall
// pieces branch): a ring of them laid by hand refused on its closing piece while it has no gate (GATE_WHY), the same
// ring with a gate closing, walled, everything inside reached; the auto layout leaving a gateless ring's closing piece
// off the map and closing it with its gates; the hover's reason and build refusing it; the auto layout of a built-up
// hub and a camp (its Ring wall too) placing everything reachable; 50 checks on the 300 × 300 grid in time.
// Usage: node tools/basebuildtest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { registerCombatHandler } from "../src/sim/combat.js";
import { BUILDINGS, addBuilding, queueBuild, constructionHour, canBuild, placeProblem, count, countAll, baseBeds, demolish, CAMP, SHELTER } from "../src/sim/buildings.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { createVehicle } from "../src/sim/vehicles.js";
import * as BM from "../src/sim/basemap.js";

const seed = Number(process.argv[2] || 11);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
registerCombatHandler("bbt", () => {});
// landOff: the land (basescatter.js) is tools/baseviewtest.js's. The hub without its start's Lodge, beds and tent
// (world.js HUB_LAYOUT): the general buildings here are the test's own.
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.hour = 24 * 3 + 12; st.landOff = true; st.bases[0].buildings = st.bases[0].buildings.filter((b) => b.type === "farm_plot"); return st; };
const rich = (base) => Object.assign(base.stock, { scrap: 999, parts: 99, buildmat: 99, electronics: 9, meds: 20, wood: 99999 });
const asCamp = (base) => { base.tier = 0; base.camp = true; base.buildings = []; base.construction = []; delete base.plan; return base; };
// Finishes every job in the queue (as the builders would).
const finishAll = (st, base) => { for (let i = 0; i < 40 && base.construction.length; i++) { for (const j of base.construction) j.progress = j.hours; constructionHour(st); } };
const byType = (base, type) => base.buildings.filter((b) => b.type === type);
const last = (base, type) => byType(base, type)[byType(base, type).length - 1];
const keyOf = (b) => `b:${b.id}`;
const inMargin = (base, it, at) => { const B = BM.gridBox(base), N = BM.NO_BUILD, r = BM.rectOf(it, at); return r.x0 < B.x0 + N || r.y0 < B.y0 + N || r.x0 + r.w > B.x1 - N || r.y0 + r.h > B.y1 - N; };
const openView = (st, base, pick = null) => { globalThis.window = {}; try { return BM.openBaseMap(st, base.id, pick); } finally { delete globalThis.window; } };
const cellAt = (b, gx, gy) => { const F = b.deployPlan.fort; return b.cells[(gy + F.oy) * b.w + gx + F.ox]; };

section("The no-build margin");
{
  const st = world();
  const h = hub(st);
  rich(h);
  const bunk = addBuilding(h, "bunkhouse");
  const G = BM.gridHalf(h), N = G - BM.NO_BUILD;
  check(BM.NO_BUILD === 5, `NO_BUILD is ${BM.NO_BUILD}`);
  const why = BM.placeItem(st, h, keyOf(bunk), G - 6, 0, 0);
  check(why === "Within 5 cells of the map's edge (nothing is built there)", `a bunkhouse reaching into the margin: refused (${why})`);
  check(BM.placeItem(st, h, keyOf(bunk), -N, -N, 0) === "" && bunk.at && bunk.at[0] === -N, `right up against the margin: fine (at ${bunk.at})`);
  check(/Off the map/.test(BM.placeItem(st, h, keyOf(bunk), -G - 1, 0, 0)), "off the map is still off the map");
  BM.unplaceItem(st, h, keyOf(bunk));
  // The camp: a 500 × 500 grid like every base's; everything a camp may build still finds a spot.
  const st2 = world(seed + 1), c2 = asCamp(hub(st2));
  rich(c2);
  // (Farm plots: as many as its soil takes, not its list's most: buildings.js canBuild soilRoom; four here.)
  for (const t of Object.keys(CAMP.build)) if (BM.FOOT[t] && !BM.FOOT[t].fit && !BUILDINGS[t].piece) for (let i = 0; i < (t === "farm_plot" ? 4 : CAMP.build[t]); i++) addBuilding(c2, t);
  const hut = last(c2, "gen_hut");
  for (const t of ["bunks", "stove"]) addBuilding(c2, t);
  addBuilding(c2, "walls"); // a Ring wall's pieces (buildings.js addRing): the ring round the camp's yard lies inside the margin
  const lay = BM.layoutOf(st2, c2);
  const ringN = lay.filter((e) => BM.WALL_KINDS.has(e.it.kind)).length;
  check(lay.length >= 12 && ringN >= 8 && lay.every((e) => e.at), `a camp with everything it can build (${lay.length} things, ${lay.filter((e) => e.it.kind === "defence").length} defences, ${ringN} wall pieces): all placed by the game`);
  check(BM.wallInfo(st2, c2).enclosed, "the camp's ring of pieces closes round it (its gates laid first)");
  check(lay.every((e) => !inMargin(c2, e.it, e.at)), "none of it inside the margin");
  const bunksLay = lay.find((e) => e.it.type === "bunks"), hutLay = lay.find((e) => e.it.key === keyOf(hut));
  const floor = new Set(BM.floorCellsOf(hutLay.it, hutLay.at).map(([x, y]) => `${x},${y}`));
  check(bunksLay.at && floor.has(`${bunksLay.at[0]},${bunksLay.at[1]}`), `the bunks stand on the hut's floor (${bunksLay.at} in the hut at ${hutLay.at})`);
  check(!openView(st2, c2) && st2.combat && st2.combat.deployPlan.fort.noBuild === BM.NO_BUILD, "the camp's map opens; the fort record carries noBuild");
  const b = st2.combat, F = b.deployPlan.fort;
  const Gc = BM.gridHalf(c2);
  check(Gc === BM.GRID_MAX && F.W < 2 * Gc && F.W >= 2 * (BM.yardHalf(c2) + 2), `the camp's grid is 500 × 500; its view the yard and what stands round it (${F.W} × ${F.H})`);
  check(F.W === (2 * BM.VIEW_HALF.camp) && F.H === (2 * BM.VIEW_HALF.camp) && F.ox === BM.VIEW_HALF.camp && F.oy === BM.VIEW_HALF.camp, `the view is never less than ${(2 * BM.VIEW_HALF.camp)} × ${(2 * BM.VIEW_HALF.camp)}, the camp in its middle (the user's request 2026-10-23; ${F.W} × ${F.H}, the camp at ${F.ox}, ${F.oy})`);
  st2.combat = null;
  // Set up near the map's edge (base.plan.origin, the camp's own spot): the view stops at the edge, its five cells tinted.
  c2.plan.origin = [BM.SITE_RANGE, 0];
  check(!openView(st2, c2) && !!st2.combat, "a camp near the east edge opens its map");
  const E = BM.gridBox(c2).x1, b3 = st2.combat;
  check(cellAt(b3, E - 1, 0).nb === 1 && cellAt(b3, E - 5, 0).nb === 1 && !cellAt(b3, E - 6, 0).nb && !cellAt(b3, 0, 0).nb, "the view marks the margin's five cells (c.nb) and nothing nearer the camp");
  check(BM.gridOf(c2).cap <= BM.edgeRoom(c2) && BM.yardHalf(c2) + 2 + BM.NO_BUILD <= E, "its yard and the wall's band stop short of the margin");
  const F3 = b3.deployPlan.fort;
  check(F3.W === (2 * BM.VIEW_HALF.camp) && F3.H === (2 * BM.VIEW_HALF.camp) && E + F3.ox === F3.W, `by the edge the view is still ${(2 * BM.VIEW_HALF.camp)} × ${(2 * BM.VIEW_HALF.camp)}, slid back onto the map (${F3.W} × ${F3.H}, its east side the map's edge)`);
  st2.combat = null;
  delete c2.plan.origin;
}

section("General buildings and fittings");
{
  const st = world();
  const h = hub(st);
  rich(h);
  check(placeProblem(h, "bunks") === "Needs a building to stand in (a hut, cabin, lodge, hall or barn)" && !canBuild(st, h, "bunks").ok, `no hut yet: ${placeProblem(h, "bunks")}`);
  check(canBuild(st, h, "gen_hut").ok && canBuild(st, h, "gen_barn").ok && !BUILDINGS.gen_hut.plot, "a hut and a barn can go up at the main base (no plot)");
  check(/queued/.test(queueBuild(st, h, "gen_hut")) && /queued/.test(queueBuild(st, h, "gen_cabin")), "a hut and a cabin queued");
  const jobH = h.construction.find((c) => c.type === "gen_hut"), jobC = h.construction.find((c) => c.type === "gen_cabin");
  check(!BM.placeItem(st, h, `c:${jobH.id}`, 10, 10, 0) && !BM.placeItem(st, h, `c:${jobC.id}`, 20, 10, 0), "their outlines placed by hand");
  check(placeProblem(h, "bunks") !== "" , "a hut going up is not yet a building to stand in");
  finishAll(st, h);
  const hut = last(h, "gen_hut"), cabin = last(h, "gen_cabin");
  check(!!hut && !!cabin && hut.at.join() === "10,10,0" && cabin.at.join() === "20,10,0", "finished where their outlines were");
  check(placeProblem(h, "bunks") === "" && canBuild(st, h, "bunks").ok, "now the bunks have a building to stand in");
  const cells = BM.cellsOf(BM.itemByKey(st, h, keyOf(hut)), hut.at);
  check(!cells.some((c) => c.k === "counter" || c.k === "loft" || c.k === "stairs") && cells.filter((c) => c.k === "bdoor").length === 1 && BM.floorCellsOf(BM.itemByKey(st, h, keyOf(hut)), hut.at).length === 4, "a plain house: no counter, no loft, one door, a 2 × 2 floor");
  const door = cells.find((c) => c.door);
  check(door.inn && door.out && door.inn[0] === door.x && door.inn[1] === door.y - 1 && door.out[1] === door.y + 1, `the door at ${door.x}, ${door.y} knows the cell inside (${door.inn}) and outside (${door.out})`);
  const beds0 = baseBeds(h);
  const bunks = addBuilding(h, "bunks"), stove = addBuilding(h, "stove"), bench = addBuilding(h, "craftbench");
  check(BM.placeItem(st, h, keyOf(bunks), 20, 20, 0) === "Only inside a building", `bunks in the yard: refused (${BM.placeItem(st, h, keyOf(bunks), 20, 20, 0)})`);
  check(/^On top of Hut/.test(BM.placeItem(st, h, keyOf(bunks), 10, 10, 0)), `on the hut's wall: refused (${BM.placeItem(st, h, keyOf(bunks), 10, 10, 0)})`);
  check(/^In the doorway of Hut/.test(BM.placeItem(st, h, keyOf(bunks), 11, 12, 0)), `across the cell inside the door: refused (${BM.placeItem(st, h, keyOf(bunks), 11, 12, 0)})`);
  check(BM.placeItem(st, h, keyOf(bunks), 11, 11, 0) === "" && bunks.host === hut.id, `bunks on the hut's floor: placed, host ${bunks.host} (the hut ${hut.id})`);
  check(BM.placeItem(st, h, keyOf(stove), 11, 12, 0) === "" && stove.host === hut.id, "the stove beside them");
  check(/^On top of Bunk beds/.test(BM.placeItem(st, h, keyOf(addBuilding(h, "lockers")), 12, 11, 0)), "lockers on top of the bunks: refused");
  h.buildings.splice(h.buildings.indexOf(last(h, "lockers")), 1);
  check(baseBeds(h) === beds0 + 2, `the bunks count as 2 beds (${beds0} → ${baseBeds(h)})`);
  check(count(h, "cookhouse") === 1 && countAll(h, "cookhouse") === 0, "the stove counts as a cook fire (count), not as one for the limit (countAll)");
  check(/^On top of Cabin/.test(BM.placeItem(st, h, keyOf(addBuilding(h, "well")), 23, 11, 0)), `a well never on a floor cell (${BM.placeItem(st, h, keyOf(last(h, "well")), 23, 11, 0)})`);
  h.buildings.splice(h.buildings.indexOf(last(h, "well")), 1);
  // An indoor prop: the crafting bench inside the cabin (turned, in the column the doors leave free) and outside.
  check(BM.placeItem(st, h, keyOf(bench), 21, 11, 1) === "" && bench.host === cabin.id, `a crafting bench inside the cabin (host ${bench.host})`);
  check(BM.placeItem(st, h, keyOf(bench), 30, 30, 0) === "" && bench.host == null, "the same bench out in the yard: no host");
  check(BM.placeItem(st, h, keyOf(bench), 21, 11, 1) === "" && bench.host === cabin.id, "and back inside");
  // Moving the host takes what is inside along.
  check(BM.placeItem(st, h, keyOf(hut), 10, 20, 0) === "" && bunks.at.join() === "11,21,0" && stove.at.join() === "11,22,0" && bunks.host === hut.id && stove.host === hut.id, `the hut moved to 10, 20: the bunks (${bunks.at}) and the stove (${stove.at}) went with it`);
  check(BM.placeItem(st, h, keyOf(hut), 10, 20, 1) === "" && bunks.at && bunks.at.join() === "11,21,0" && !stove.at && stove.host == null, "turned where it stands: the bunks stay, the stove now in the doorway is unplaced");
  check(BM.placeItem(st, h, keyOf(stove), 12, 22, 0) === "" && stove.host === hut.id, "the stove put down again on the floor");
  check(BM.unplaceItem(st, h, keyOf(hut)) === "" && !bunks.at && !stove.at && bunks.host == null && hut.carry && hut.carry.length === 2, "the hut lifted: what was inside is off the map, remembered on the hut");
  check(BM.placeItem(st, h, keyOf(hut), 10, 10, 1) === "" && bunks.at && bunks.at.join() === "11,11,0" && stove.at && stove.at.join() === "12,12,0" && !hut.carry, "put down at 10, 10: the bunks and the stove back inside at the same offsets");
  // The auto layout: an unplaced fitting goes inside (the hut's last floor cell is 1 × 1, so into the cabin's free
  // column, turned); one nothing has room for is left off the map.
  const more = addBuilding(h, "bunks");
  const e = BM.layoutOf(st, h).find((q) => q.it.key === keyOf(more));
  check(e.at && e.auto && e.at[2] === 1 && BM.floorCellsOf(BM.itemByKey(st, h, keyOf(cabin)), cabin.at).some(([x, y]) => x === e.at[0] && y === e.at[1]), `a second pair of bunks: the game puts them turned into the cabin's free column (${e.at})`);
  const third = addBuilding(h, "bunks");
  check(!BM.layoutOf(st, h).find((q) => q.it.key === keyOf(third)).at && countAll(h, "bunks") === 3, "a third pair: nothing has room for 2 × 1 any more, left off the map (it still counts)");
  BM.unplaceItem(st, h, keyOf(stove));
  const e2 = BM.layoutOf(st, h).find((q) => q.it.key === keyOf(stove));
  check(e2.at && e2.auto && BM.floorCellsOf(BM.itemByKey(st, h, keyOf(hut)), hut.at).some(([x, y]) => x === e2.at[0] && y === e2.at[1]), `the stove lifted off: the game puts it back inside the hut (${e2.at})`);
  h.buildings.splice(h.buildings.indexOf(third), 1);
  // The benches the game places stay in the yard.
  const yardBench = addBuilding(h, "med_station");
  const e4 = BM.layoutOf(st, h).find((q) => q.it.key === keyOf(yardBench));
  check(e4.at && !BM.floorHostAt(BM.occupancy(st, h, null, BM.autoLayout(st, h)), e4.at[0], e4.at[1]) && !BM.occupancy(st, h, keyOf(yardBench), null).floor.has((e4.at[1] + 2048) * 4096 + e4.at[0] + 2048), "an indoor prop the game places goes in the yard, never inside");
  // The map: the fittings over the floor, shelves as a store with its key, the yard pile.
  const shelves = addBuilding(h, "shelves");
  check(BM.placeItem(st, h, keyOf(shelves), 23, 11, 1) === "", "shelves in the cabin's other column");
  check(!openView(st, h), "the view opens");
  const b = st.combat, F = b.deployPlan.fort;
  check(cellAt(b, 11, 11).k === "bed" && cellAt(b, 12, 11).k === "bed" && F.indoor[(11 + F.oy) * b.w + 11 + F.ox] === 1 && cellAt(b, 23, 11).k === "shelf" && cellAt(b, 21, 11).k === "counter", "the bunks, the shelves and the bench stand on the floors of their buildings");
  const keys = F.stores.map((s) => s.key);
  check(keys.includes("core") && keys.includes(keyOf(shelves)) && F.stores.every((s) => s.key), `every store carries a key: ${keys.join(", ")}`);
  // Merged with dev's base storage limits: no Yard pile any more; what the base has no room for lies on dev's piles
  // (basemap.js layPiles), keyed "outside" (containers.js OUTSIDE), crates on open ground with no room of their own.
  const piles = F.stores.filter((s) => s.pile);
  check(piles.length === 0 || piles.every((s) => s.key === "outside" && s.weight === 0 && s.label.startsWith(BM.PILE.LABEL) && cellAt(b, s.x - F.ox, s.y - F.oy).k === "crate"), `the piles of what lies outside: key "outside", crates, no room (${piles.length})`);
  check(!F.stores.some((s) => s.key === "yard" || s.label === "Yard pile"), "no Yard pile");
  check(F.buildings.find((s) => s.bid === hut.id) && F.buildings.find((s) => s.bid === hut.id).storeys === 1, "the hut is one of the map's buildings");
  st.combat = null;
  // Demolishing the host pulls the fittings down with it, refunds too; the bench inside the cabin goes back to the yard.
  const scrap0 = h.stock.scrap, nBunks = countAll(h, "bunks");
  const text = demolish(st, h, hut.id);
  check(!h.buildings.includes(hut) && countAll(h, "bunks") === nBunks - 1 && !h.buildings.includes(stove), `the hut pulled down with the bunks and the stove in it (${text})`);
  check(h.stock.scrap === scrap0 + [BUILDINGS.gen_hut, BUILDINGS.bunks, BUILDINGS.stove].reduce((a, d) => a + Math.floor((d.cost.scrap || 0) / 2), 0) && /bunk beds/.test(text) && /wood stove/.test(text) && !/plot is free/.test(text), `their halves salvaged too (${h.stock.scrap - scrap0} scrap), no plot to free`);
  const textC = demolish(st, h, cabin.id);
  check(h.buildings.includes(bench) && !bench.at && bench.host == null && !h.buildings.includes(shelves) && /shelves/.test(textC), "the cabin down: the bench stays (back to the yard), the shelves went with it");
  check(placeProblem(h, "bunks") !== "" && BM.layoutOf(st, h).filter((q) => q.it.fit).every((q) => !q.at), "with no building left to stand in, the fittings are off the map and no more can be queued");
}

section("Doorways between buildings");
{
  const st = world();
  const h = hub(st);
  rich(h);
  const A = addBuilding(h, "gen_cabin"), B = addBuilding(h, "gen_cabin"), far = addBuilding(h, "gen_hut");
  check(!BM.placeItem(st, h, keyOf(A), 12, -12, 0) && !BM.placeItem(st, h, keyOf(B), 17, -12, 0) && !BM.placeItem(st, h, keyOf(far), 12, 20, 0), "two cabins side by side, a hut apart");
  const nb = BM.neighboursOf(st, h, keyOf(A));
  check(nb.length === 1 && nb[0].key === keyOf(B) && nb[0].run === 2 && !nb[0].linked, `the cabin's neighbours: ${nb.map((n) => `${n.label} (a run of ${n.run})`).join(", ")}`);
  check(BM.canLink(st, h, keyOf(A), keyOf(B)) === "" && /against each other/.test(BM.canLink(st, h, keyOf(A), keyOf(far))) && BM.canLink(st, h, keyOf(A), keyOf(A)) !== "", `canLink: the pair "${BM.canLink(st, h, keyOf(A), keyOf(B))}", the hut apart "${BM.canLink(st, h, keyOf(A), keyOf(far))}"`);
  check(BM.linkBuildings(st, h, keyOf(A), keyOf(B)) === "" && h.plan.links.length === 1 && /already/.test(BM.linkBuildings(st, h, keyOf(B), keyOf(A))), "linked (base.plan.links); not twice");
  const links = BM.linksOf(st, h);
  check(links.length === 1 && links[0].da.join() === "16,-11" && links[0].db.join() === "17,-11", `the doorway: ${links[0].da} in the first cabin facing ${links[0].db} in the second`);
  const stove = addBuilding(h, "stove");
  check(/^In the doorway of/.test(BM.placeItem(st, h, keyOf(stove), 15, -11, 0)), `the cell inside the doorway stays clear (${BM.placeItem(st, h, keyOf(stove), 15, -11, 0)})`);
  check(!BM.placeItem(st, h, keyOf(stove), 13, -11, 0), "the stove elsewhere on the floor");
  check(!openView(st, h), "the view opens");
  let b = st.combat, F = b.deployPlan.fort;
  const dA = cellAt(b, 16, -11), dB = cellAt(b, 17, -11);
  check(dA.k === "bdoor" && dB.k === "bdoor" && dA.hp === 45 && dB.mhp === 45 && dA.link === 1, "both wall cells are barred doors with a door's hit points");
  const fA = F.buildings.find((s) => s.bid === A.id), fB = F.buildings.find((s) => s.bid === B.id);
  const has = (list, gx, gy) => list.some(([x, y]) => x === gx + F.ox && y === gy + F.oy);
  check(has(F.doors, 16, -11) && has(F.doors, 17, -11) && has(fA.doors, 16, -11) && has(fB.doors, 17, -11) && !has(fA.doors, 17, -11), "in F.doors and in each building's own doors list (settleBaseBattle wears them)");
  check(!has(F.windows, 16, -11) && F.indoor[(-11 + F.oy) * b.w + 16 + F.ox] === 1 && cellAt(b, 16, -10).k === "window", "the window there gave way to the door; the other window stays");
  st.combat = null;
  // Moved away: the link is dropped when read.
  check(!BM.placeItem(st, h, keyOf(B), 24, -12, 0), "the second cabin moved away");
  check(BM.linksOf(st, h).length === 0 && h.plan.links.length === 0, "the stale link dropped");
  // A queued cabin against the first: linked as c:<job>, the link rewritten when it finishes.
  check(/queued/.test(queueBuild(st, h, "gen_cabin")), "a third cabin queued");
  const job = h.construction.find((c) => c.type === "gen_cabin");
  check(!BM.placeItem(st, h, `c:${job.id}`, 17, -12, 0) && BM.linkBuildings(st, h, keyOf(A), `c:${job.id}`) === "", "its outline against the first cabin and linked");
  check(BM.linksOf(st, h).length === 1, "the link is live (as a plan) while it goes up");
  openView(st, h); b = st.combat;
  check(cellAt(b, 16, -11).k !== "bdoor" && cellAt(b, 17, -11).k === "outline", "but no door is laid into an outline");
  st.combat = null;
  finishAll(st, h);
  const C = last(h, "gen_cabin");
  check(C !== A && C !== B && h.plan.links[0].b === keyOf(C) && BM.linksOf(st, h).length === 1 && BM.linksOf(st, h)[0].db.join() === "17,-11", `finished: the link names the new building (${h.plan.links[0].a} ↔ ${h.plan.links[0].b})`);
  check(BM.unlinkBuildings(st, h, keyOf(C), keyOf(A)) === "" && h.plan.links.length === 0 && BM.unlinkBuildings(st, h, keyOf(C), keyOf(A)) !== "", "unlinked (either order); not twice");
  // Save / load keeps hosts and links.
  BM.linkBuildings(st, h, keyOf(A), keyOf(C));
  const s2 = loadFromString(saveToString(st));
  const h2 = hub(s2), stove2 = h2.buildings.find((x) => x.id === stove.id);
  check(h2.plan.links.length === 1 && h2.plan.links[0].a === keyOf(A) && stove2 && stove2.host === A.id && stove2.at.join() === "13,-11,0" && BM.linksOf(s2, h2).length === 1, "save / load keeps the stove's host and the doorway");
}

section("The view: nobody on it, Build, the menu");
{
  const st = world();
  const h = hub(st);
  rich(h);
  check(!openView(st, h), "the base map opens");
  let b = st.combat, L = b.layout;
  check(b.units.length === 0 && L.sel === null && L.pickType === null && L.pick === null, "nobody on the map; sel and pickType empty");
  const menu = BM.buildMenu(st, h);
  const groups = [...new Set(menu.map((m) => m.group))];
  check(groups.join("|") === "Tents|General buildings|Fittings|Furniture|Power|Buildings|Yard things|Defences", `the menu's groups in order: ${groups.join(", ")}`);
  const hutM = menu.find((m) => m.type === "gen_hut"), bunksM = menu.find((m) => m.type === "bunks"), bunkM = menu.find((m) => m.type === "bunkhouse"), pitsM = menu.find((m) => m.type === "spike_pits");
  check(hutM && hutM.group === "General buildings" && hutM.ok && hutM.w === 4 && hutM.h === 4 && hutM.cost.scrap === BUILDINGS.gen_hut.cost.scrap && hutM.cost.wood === BUILDINGS.gen_hut.cost.wood && hutM.hours === 14 && hutM.desc.length > 20, `the hut: ${hutM.w} × ${hutM.h}, ${hutM.cost.scrap} scrap + ${hutM.cost.wood} wood, ${hutM.hours} h, ok`);
  check(bunksM && bunksM.group === "Fittings" && !bunksM.ok && /Needs a building to stand in/.test(bunksM.why), `the bunks: ${bunksM.why}`);
  check(bunkM && bunkM.group === "Buildings" && pitsM && pitsM.group === "Defences" && menu.find((m) => m.type === "craftbench").group === "Yard things" && !menu.some((m) => m.type === "walls" || m.type === "reload_bench"), "a bunkhouse under Buildings, pits under Defences, the bench under Yard things; no wall, no upgrade in place");
  // pickType + build: queues a hut and places its outline at the ghost. (The view is made again after every change
  // and its crop grows with the yard: map coordinates are taken from the view of the moment.)
  const mapX = (gx) => gx + st.combat.deployPlan.fort.ox, mapY = (gy) => gy + st.combat.deployPlan.fort.oy;
  check(BM.layoutAct(st, b, { type: "pickType", bt: "gen_hut" }) === "" && L.pickType === "gen_hut", "the hut picked to build");
  const g = BM.ghostAt(st, b, mapX(14), mapY(14));
  check(g && g.ok && g.cells.length === 16 && g.type === "gen_hut" && g.at.join() === "12,12,0", `the ghost at 14, 14: ${g.cells.length} cells, ${g.ok ? "fits" : g.why}`);
  const scrap0 = h.stock.scrap, n0 = h.construction.length;
  check(BM.layoutAct(st, b, { type: "build", x: mapX(14), y: mapY(14) }) === "" && h.construction.length === n0 + 1 && h.stock.scrap === scrap0 - (BUILDINGS.gen_hut.cost.scrap || 0), "a click builds: the hut queued and paid for");
  const job = h.construction[h.construction.length - 1];
  check(job.type === "gen_hut" && job.at && job.at.join() === "12,12,0" && st.combat !== b && st.combat.layout === L && L.sel === `c:${job.id}` && /queued and placed/.test(L.msg), `the job placed at the ghost (${job.at}), selected, the view made again`);
  b = st.combat;
  // A refused spot: nothing is queued or paid.
  const bad = BM.layoutAct(st, b, { type: "build", x: mapX(12), y: mapY(12) });
  check(/^On top of/.test(bad) && h.construction.length === n0 + 1 && h.stock.scrap === scrap0 - (BUILDINGS.gen_hut.cost.scrap || 0), `on top of the outline: refused (${bad}), nothing queued or paid`);
  const G = BM.gridHalf(h);
  const far = BM.layoutAct(st, b, { type: "build", x: mapX(G - 2), y: mapY(0) });
  check(/edge|Off the map/.test(far) && h.construction.length === n0 + 1, `in the margin: refused (${far})`);
  // A fitting: only onto a host with room.
  check(/Needs a building/.test(canBuild(st, h, "bunks").reason), "bunks: nothing stands to take them yet");
  st.combat = null;
  finishAll(st, h);
  const hut = last(h, "gen_hut");
  check(hut && hut.at.join() === "12,12,0", "the hut finished where the outline was");
  openView(st, h);
  b = st.combat; L = b.layout;
  check(BM.layoutAct(st, b, { type: "pickType", bt: "bunks" }) === "", "bunks picked to build");
  const F2 = b.deployPlan.fort;
  const gy = BM.ghostAt(st, b, 30 + F2.ox, 30 + F2.oy), gf = BM.ghostAt(st, b, 14 + F2.ox, 13 + F2.oy);
  check(gy && !gy.ok && gy.fit && gy.why === "Only inside a building", `the ghost in the yard is red (${gy.why})`);
  check(gf && gf.ok && gf.host === keyOf(hut) && gf.at.join() === "13,13,0", `over the hut's floor it is green, host ${gf.host}`);
  check(BM.layoutAct(st, b, { type: "build", x: 14 + F2.ox, y: 13 + F2.oy }) === "", "built there");
  const jb = h.construction.find((c) => c.type === "bunks");
  check(jb && jb.at.join() === "13,13,0" && jb.host === hut.id, `the bunks job placed on the floor with its host (${jb.host})`);
  b = st.combat;
  check(BM.layoutAct(st, b, { type: "select", key: keyOf(hut) }) === "" && b.layout.sel === keyOf(hut), "select");
  const scrap1 = h.stock.scrap;
  check(BM.layoutAct(st, b, { type: "demolish", key: `c:${jb.id}` }) === "" && !h.construction.includes(jb) && h.stock.scrap === scrap1 + BUILDINGS.bunks.cost.scrap && /Cancelled/.test(st.combat.layout.msg), "demolish on a queued job cancels it and refunds");
  b = st.combat;
  check(BM.layoutAct(st, b, { type: "demolish", key: keyOf(hut) }) === "" && !h.buildings.includes(hut) && /pulled down/.test(st.combat.layout.msg) && st.combat.layout.sel === null, "demolish on a standing building pulls it down and clears the selection");
  check(BM.layoutAct(st, st.combat, { type: "endLayout" }) === "" && !st.combat, "the map closed");
  check(SHELTER.build.gen_hut === 2 && SHELTER.build.gen_cabin === 1 && CAMP.build.gen_hut === 1 && CAMP.build.bunks === 2 && CAMP.build.stove === 1 && !CAMP.build.lockers, "a camp may build a hut, bunks, shelves and a stove; a shelter two huts or a cabin");
}

section("A way in and out");
{
  // A ring of huts round the hub's core (docs/base-building/plan.md Part F): a storehouse (a flat roof: no door) and a
  // barricade fill each corner (the inner corner cell left empty: a pocket nobody needs), four huts a side with every
  // door facing in. The last hut closes the ring: with its door facing in nothing could walk to it; turned so its
  // door faces out it is a dead end that shuts the core off. The ring is let in by a hall (two doors) in place of two
  // huts, or by a hut with its door out and a doorway link to its neighbour.
  const ring = (st, h, { last = "in", hall = false, link = false } = {}) => {
    const put = (b, x, y, r) => BM.placeItem(st, h, keyOf(b), x, y, r);
    const errs = [];
    for (const [sx, sy, bx, by] of [[-12, -14, -12, -11], [8, -14, 9, -11], [-12, 7, -12, 6], [8, 7, 9, 6]]) errs.push(put(addBuilding(h, "storehouse"), sx, sy, 0), put(addBuilding(h, "barricades"), bx, by, 0));
    const slots = [];
    for (let x = -8; x < 8; x += 4) slots.push([x, -14, 0]);  // the north row, doors south (in)
    for (let y = -10; y < 6; y += 4) slots.push([-12, y, 3]); // the west column, doors east
    for (let x = -8; x < 8; x += 4) slots.push([x, 6, 2]);    // the south row, doors north
    for (let y = -10; y < 6; y += 4) slots.push([8, y, 1]);   // the east column, doors west
    if (hall) { slots.splice(1, 2); errs.push(put(addBuilding(h, "gen_hall"), -4, -14, 0)); } // the north row's two middle huts
    let linked = "";
    if (link) { // the north row's third hut turned (its door out), its neighbour in, the doorway between them
      const A = addBuilding(h, "gen_hut"), B = addBuilding(h, "gen_hut");
      errs.push(put(A, 0, -14, 2), put(B, 4, -14, 0));
      linked = BM.linkBuildings(st, h, keyOf(A), keyOf(B));
      slots.splice(2, 2);
    }
    const huts = slots.map(() => addBuilding(h, "gen_hut"));
    for (let i = 0; i < slots.length - 1; i++) errs.push(put(huts[i], ...slots[i]));
    const s = slots[slots.length - 1];
    const why = put(huts[huts.length - 1], s[0], s[1], last === "out" ? (s[2] + 2) & 3 : s[2]);
    return { errs: errs.filter(Boolean), why, linked };
  };
  check(typeof BM.PATH === "object" && BM.PATH.WIDTH === 1, `PATH.WIDTH is ${BM.PATH.WIDTH}`);
  const st = world();
  const h = hub(st);
  rich(h);
  const r1 = ring(st, h);
  check(r1.errs.length === 0 && r1.why === BM.REACH_WHY, `the ring closed by a hut with its door in: refused (${r1.why}); the rest placed (${r1.errs.join("; ") || "no errors"})`);
  const st2 = world(seed + 2), h2 = hub(st2);
  const r2 = ring(st2, h2, { last: "out" });
  check(r2.errs.length === 0 && r2.why === "That would shut off Main house: no way to walk to it from outside the base", `closed by a hut with its door out (a dead end): refused (${r2.why})`);
  const st3 = world(seed + 3), h3 = hub(st3);
  const r3 = ring(st3, h3, { hall: true });
  check(r3.errs.length === 0 && r3.why === "", `the same ring with a hall (a door out and a door in) in place of two huts: allowed (${r3.why || r3.errs.join("; ") || "placed"})`);
  const st4 = world(seed + 4), h4 = hub(st4);
  const r4 = ring(st4, h4, { link: true });
  check(r4.errs.length === 0 && r4.linked === "" && r4.why === "", `the same ring with one hut turned door-out and a doorway into its neighbour: allowed (${r4.why || r4.linked || r4.errs.join("; ") || "placed"})`);
  // Every hut in the closed-with-a-hall ring is still reached (through the hall), and the core.
  const lay3 = BM.layoutOf(st3, h3).filter((e) => e.at);
  check(lay3.every((e) => BM.reachProblem(st3, h3, e.it, e.at, null) === ""), `every placed thing of that base passes the check on its own (${lay3.length} things)`);
  // A pocket in the yard: barricades above and below, crates at the west end, a crate inside; the hut that closes the
  // east end shuts the crate inside off. An empty pocket closed is nobody's loss.
  {
    const st = world(seed + 5), h = hub(st);
    const barN = addBuilding(h, "barricades"), barS = addBuilding(h, "barricades"), crA = addBuilding(h, "crates"), crB = addBuilding(h, "crates"), hut = addBuilding(h, "gen_hut");
    check(!BM.placeItem(st, h, keyOf(barN), 8, 9, 0) && !BM.placeItem(st, h, keyOf(barS), 8, 11, 0) && !BM.placeItem(st, h, keyOf(crA), 7, 10, 0), "a pocket: barricades above and below, crates at its west end");
    check(BM.placeItem(st, h, keyOf(hut), 11, 8, 0) === "", "a hut closing the east end of the empty pocket: fine");
    BM.unplaceItem(st, h, keyOf(hut));
    check(!BM.placeItem(st, h, keyOf(crB), 9, 10, 0), "a second crate inside the pocket");
    const why = BM.placeItem(st, h, keyOf(hut), 11, 8, 0);
    check(why === "That would shut off Storage crates 2: no way to walk to it from outside the base" && !hut.at, `the hut closing it now: refused (${why})`);
    check(BM.placeItem(st, h, keyOf(hut), 12, 8, 0) === "" && hut.at, "one cell further east, a way round the crate left: fine");
    // A fitting inside a hut whose door is reached is fine; a car parked so it closes the hut's door is not.
    const bunks = addBuilding(h, "bunks");
    check(BM.placeItem(st, h, keyOf(bunks), 13, 9, 0) === "" && bunks.host === hut.id, "bunks inside the hut: fine");
    const hut2 = addBuilding(h, "gen_hut"), bw = addBuilding(h, "barricades"), be = addBuilding(h, "barricades");
    check(!BM.placeItem(st, h, keyOf(hut2), 20, 20, 0) && !BM.placeItem(st, h, keyOf(bw), 21, 24, 1) && !BM.placeItem(st, h, keyOf(be), 23, 24, 1), "a hut with barricades either side of the lane from its door");
    const car = createVehicle(st, "sedan", { kind: "base", baseId: h.id });
    const whyCar = BM.placeItem(st, h, `v:${car.id}`, 22, 27, 0);
    check(whyCar === "That would shut off Hut 2: no way to walk to it from outside the base" && !car.at, `the car parked across the end of the lane: refused (${whyCar})`);
    check(BM.placeItem(st, h, `v:${car.id}`, 22, 28, 0) === "" && car.at, "a cell further off, the lane open: fine");
  }
  // The wall pieces (claude/kind-hawking-a4gby2, merged at integration): wall pieces block, gates and stands walk. A
  // ring of wall pieces laid by hand round the ring line closes on its last piece: refused while it has no gate
  // (GATE_WHY); with a gate in place of one of its sections the same last piece closes it, the base is walled and
  // everything inside (and the game's layout of the rest) is reached through the gate.
  {
    const st = world(seed + 6), h = hub(st);
    rich(h);
    const R = BM.ensureRing(h), sides = BM.ringSides(R);
    const runs = []; // the ring line in 1×4s, then a 1×2 and a 1×1 where a side's length leaves them
    for (const sd of sides) for (let i = 0; i < sd.cells.length;) { const n = sd.cells.length - i, len = n >= 4 ? 4 : n >= 2 ? 2 : 1; runs.push({ at: [sd.cells[i][0], sd.cells[i][1], sd.horiz ? 0 : 1], len, side: sd.side }); i += len; }
    const pieces = runs.map((r) => ({ ...r, b: addBuilding(h, `wall${r.len}`) }));
    const errs = pieces.slice(0, -1).map((p) => BM.placeItem(st, h, keyOf(p.b), ...p.at)).filter(Boolean);
    check(errs.length === 0, `${pieces.length - 1} wall pieces round the ring by hand, all but the last: placed (${errs.slice(0, 3).join("; ") || "no errors"})`);
    const lastP = pieces[pieces.length - 1];
    const whyG = BM.placeItem(st, h, keyOf(lastP.b), ...lastP.at);
    check(whyG === "Needs a gate in the wall first: the wall would shut everything inside off from the outside" && whyG === BM.GATE_WHY && !lastP.b.at, `the piece that would close a ring with no gate: refused (${whyG})`);
    check(!BM.wallInfo(st, h).enclosed, "the ring stays open");
    // A gate in place of a 1×4 in the middle of the north side.
    const north = pieces.filter((p) => p.side === "north" && p.len === 4);
    const mid = north[Math.floor(north.length / 2)];
    demolish(st, h, mid.b.id);
    const gate = addBuilding(h, "gate4");
    check(BM.placeItem(st, h, keyOf(gate), ...mid.at) === "", `a gate where that section stood (${mid.at}): placed`);
    const whyL = BM.placeItem(st, h, keyOf(lastP.b), ...lastP.at);
    check(whyL === "" && lastP.b.at, `the same last piece now closes a ring with a gate in it: fine (${whyL || "placed"})`);
    const wi = BM.wallInfo(st, h);
    check(wi.enclosed && wi.gates === 1, `the ring closes round the base: walled (${wi.walls} walls, ${wi.gates} gate)`);
    const lay = BM.layoutOf(st, h), auto = BM.autoLayout(st, h);
    const inside = lay.filter((e) => e.at && !BM.WALL_KINDS.has(e.it.kind));
    const bad = lay.filter((e) => e.at && BM.reachProblem(st, h, e.it, e.at, null, { auto }) !== "");
    check(inside.length >= 3 && bad.length === 0 && lay.every((e) => e.at), `everything inside the gated ring (${inside.length} things, the game's layout too) is reached through the gate${bad.length ? ` (not: ${bad.map((e) => e.it.label).join(", ")})` : ""}`);
    // A wall stand by the gate walks: no ring is closed by one, so the stands never need a gate.
    const stand = addBuilding(h, "stand4");
    check(BM.placeItem(st, h, keyOf(stand), mid.at[0], mid.at[1] + 3, 0) === "", "a wall stand inside the gate: fine (stands walk)");
    // Built: the gate's cells are the gate, the wall's palisade.
    check(!openView(st, h), "the view opens");
    const F = st.combat.deployPlan.fort;
    check(F.walled && F.pieces.some((p) => p.kind === "gate") && Object.values(F.gates).flat().length === 4 && st.combat.cells[(mid.at[1] + F.oy) * st.combat.w + mid.at[0] + F.ox].k === "gate", "the built map: walled, the gate's four cells barred gates");
    st.combat = null;
  }
  // The auto layout keeps the rule too: a Ring wall's pieces (addRing) with its gates taken away leave the closing piece
  // off the map; with a gate again, every piece is laid and the ring closes.
  {
    const st = world(seed + 11), camp = asCamp(hub(st));
    addBuilding(camp, "walls");
    const gates = camp.buildings.filter((b) => b.type === "gate4");
    check(gates.length >= 1, `a camp's Ring wall: ${camp.buildings.filter((b) => BUILDINGS[b.type].piece).length} pieces, ${gates.length} gates`);
    camp.buildings = camp.buildings.filter((b) => b.type !== "gate4");
    const extra = [4, 4, 4, 4].map((n) => addBuilding(camp, `wall${n}`)); // the gates' cells in walls instead
    const lay = BM.layoutOf(st, camp);
    const off = lay.filter((e) => !e.at && BM.WALL_KINDS.has(e.it.kind));
    check(off.length >= 1 && !BM.wallInfo(st, camp).enclosed, `no gate: the game leaves the closing piece${off.length > 1 ? "s" : ""} off the map (${off.length}) and the ring open`);
    for (const g of gates) camp.buildings.push(g);
    camp.buildings = camp.buildings.filter((b) => !extra.includes(b));
    const lay2 = BM.layoutOf(st, camp), auto2 = BM.autoLayout(st, camp);
    check(lay2.every((e) => e.at) && BM.wallInfo(st, camp).enclosed, `with the gates back: every piece laid (${lay2.filter((e) => BM.WALL_KINDS.has(e.it.kind)).length}) and the ring closed`);
    check(lay2.every((e) => BM.reachProblem(st, camp, e.it, e.at, null, { auto: auto2 }) === ""), "and everything walked to through the gates");
    check(BM.autoLayout(st, camp) === auto2, "the layout is deterministic and cached");
  }
  // The hover's reason and build: the ghost over the spot that would close the pocket is red with the reason, and a
  // click there queues nothing.
  {
    const st = world(seed + 7), h = hub(st);
    rich(h);
    const barN = addBuilding(h, "barricades"), barS = addBuilding(h, "barricades"), crA = addBuilding(h, "crates"), crB = addBuilding(h, "crates");
    check(!BM.placeItem(st, h, keyOf(barN), 8, 9, 0) && !BM.placeItem(st, h, keyOf(barS), 8, 11, 0) && !BM.placeItem(st, h, keyOf(crA), 7, 10, 0) && !BM.placeItem(st, h, keyOf(crB), 9, 10, 0), "the pocket again, a crate inside");
    check(!openView(st, h) && BM.layoutAct(st, st.combat, { type: "pickType", bt: "gen_hut" }) === "", "the view opens, a hut picked to build");
    const b = st.combat, F = b.deployPlan.fort;
    const g = BM.ghostAt(st, b, 13 + F.ox, 10 + F.oy);
    check(g && !g.ok && g.at.join() === "11,8,0" && g.why === "That would shut off Storage crates 2: no way to walk to it from outside the base", `the ghost at 11, 8 is red: ${g && g.why}`);
    const n0 = h.construction.length, scrap0 = h.stock.scrap;
    const err = BM.layoutAct(st, b, { type: "build", x: 13 + F.ox, y: 10 + F.oy });
    check(/^That would shut off Storage crates 2/.test(err) && h.construction.length === n0 && h.stock.scrap === scrap0, `build there: refused (${err}), nothing queued or paid`);
    const g2 = BM.ghostAt(st, b, 14 + F.ox, 10 + F.oy);
    check(g2 && g2.ok && g2.why === "", "one cell east the ghost is green");
    check(BM.layoutAct(st, b, { type: "build", x: 14 + F.ox, y: 10 + F.oy }) === "" && h.construction.length === n0 + 1 && h.construction[n0].at.join() === "12,8,0", "and a click there builds");
    st.combat = null;
  }
  // The auto layout never leaves anything unreachable: a built-up walled hub with huts, a cabin, fittings, fields,
  // defences and a parked car, everything placed by the game and every placed thing passing the check.
  {
    const st = world(seed + 8), h = hub(st);
    for (const t of ["walls", "walls", "barricades", "barricades", "barricades", "watchtower", "bunkhouse", "storehouse", "ammo_bench", "infirmary", "cistern", "well", "gate", "rain_catcher", "spike_pits", "spike_pits", "trench", "floodlights", "gen_hut", "gen_hut", "gen_cabin", "bunks", "bunks", "shelves", "stove", "crates", "crates", "animal_pen", "machine_shop", "garage"]) addBuilding(h, t);
    createVehicle(st, "sedan", { kind: "base", baseId: h.id });
    createVehicle(st, "truck", { kind: "base", baseId: h.id });
    const lay = BM.layoutOf(st, h), auto = BM.autoLayout(st, h);
    const off = lay.filter((e) => !e.at), bad = lay.filter((e) => e.at && BM.reachProblem(st, h, e.it, e.at, null, { auto }) !== "");
    check(lay.length >= 30 && off.length === 0, `a built-up walled hub: ${lay.length} things, all placed by the game${off.length ? ` (off the map: ${off.map((e) => e.it.label).join(", ")})` : ""}`);
    check(bad.length === 0, `every one of them can be walked to from outside${bad.length ? ` (not: ${bad.map((e) => `${e.it.label} at ${e.at}`).join(", ")})` : ""}`);
    const again = BM.autoLayout(st, h);
    check(again === auto, "the layout is cached by its key");
    // The camp and a shelter still place everything they can build.
    const stC = world(seed + 9), camp = asCamp(hub(stC));
    // (Farm plots: as many as its soil takes, not its list's most: buildings.js canBuild soilRoom; four here.)
    for (const t of Object.keys(CAMP.build)) if (BM.FOOT[t] && !BM.FOOT[t].fit && !BUILDINGS[t].piece) for (let i = 0; i < (t === "farm_plot" ? 4 : CAMP.build[t]); i++) addBuilding(camp, t);
    for (const t of ["bunks", "stove", "walls"]) addBuilding(camp, t); // what the hut's 2 × 2 floor has room for; the Ring wall's pieces
    const layC = BM.layoutOf(stC, camp), autoC = BM.autoLayout(stC, camp);
    check(layC.length >= 12 && layC.every((e) => e.at) && layC.every((e) => BM.reachProblem(stC, camp, e.it, e.at, null, { auto: autoC }) === ""), `a camp with everything on its list: ${layC.length} things placed, all reachable`);
  }
  // Performance: the check on a big hub (every base's grid is 500 × 500).
  {
    const st = world(seed + 10), h = hub(st);
    for (let i = 0; i < 30; i++) addBuilding(h, i % 2 ? "bunkhouse" : "common_room");
    addBuilding(h, "walls");
    check(BM.gridSize(h) === BM.BASE_GRID, `a hub with 30 buildings: a ${BM.gridSize(h)} × ${BM.gridSize(h)} grid`);
    const it = { ...BM.FOOT.gen_hut, key: null, type: "gen_hut", label: "Hut", built: true };
    const occ = BM.occupancy(st, h, null, null);
    const tp = Date.now();
    let why = "";
    for (let i = 0; i < 50; i++) why = BM.reachProblem(st, h, it, [30 + (i % 5), 30, 0], occ);
    const ms = Date.now() - tp;
    check(ms < 2000 && why === "", `50 checks in ${ms} ms`);
  }
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
