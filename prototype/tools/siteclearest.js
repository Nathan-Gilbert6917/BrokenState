// The base maps' towns, cities and hills, and clearing the camp's spot of the dead (the user's request 2026-10-22: "Add
// more variety to the bare base maps with elevations in hill tiles, houses, roads and stores in town tiles and similar
// but more city like for city tiles. If it is a safe area you can build with no problem typically out of city etc. but
// if it is in a city tile or town tile or higher infection rate you will need to clear the zombies first before
// establishing the base ... do not have reinforcements come due to heat just spawn a decent amount of zombies based on
// the era and infection rate ... Farmland and far from town and city tiles should have very few if any zombies").
//   1. the land: a town's streets and houses, a city's blocks and stores, the hills' high ground (sim/basescatter.js
//      townLayer, highLayer), laid cell by cell on a map (layLand), cleared whole (CLEAR);
//   2. the dead at the spot (sim/siteclear.js siteThreat): by the place, the infection and the year;
//   3. the fight (layout "siteClear"): the tile's land round the spot, the dead round it, none drawn in; won, the camp
//      goes up; pulled back, the team waits for orders.
// Usage: node tools/siteclearest.js [seed]
import { createWorld } from "../src/sim/world.js";
import { giveOrder, awaitOrders } from "../src/sim/parties.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { pendingSite, pickSite } from "../src/sim/staging.js";
import * as BM from "../src/sim/basemap.js";
import { townLayer, reliefLayer, layLand, CLEAR, clearOf, TOWN } from "../src/sim/basescatter.js";
import { applyRelief } from "../src/sim/relief.js";
import { CELL, finishCombat } from "../src/sim/combat.js";
import { siteThreat, SITE_CLEAR } from "../src/sim/siteclear.js";
import { CS_ACTIONS, sitePanel } from "../src/ui/campsite.js";
import { campProblem } from "../src/sim/staging.js";
import { missionProblem } from "../src/sim/parties.js";
import { crawlTile } from "../src/sim/citycrawl.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok   ${msg}`); } else { fails++; console.log(`  FAIL ${msg}`); } return !!ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------- 1. the land ----------
section("The land: a town's streets and houses, a city's blocks, the hills' high ground");
{
  const town = townLayer(1234, "town", 125), city = townLayer(1234, "city", 125);
  const n = (L, k) => L.pieces.filter((p) => p.k === k).length;
  check(n(town, "house") > 60 && n(town, "store") >= 3 && n(town, "wreck") > 20 && town.floors.some((f) => f[2] === "road"), `a town: ${n(town, "house")} houses, ${n(town, "store")} stores, ${n(town, "wreck")} wrecks, streets`);
  check(n(city, "block") > 30 && n(city, "store") > 10 && city.floors.some((f) => f[2] === "deck") && n(city, "house") === 0, `a city: ${n(city, "block")} city buildings, ${n(city, "store")} stores, sidewalks, no houses`);
  check(TOWN.city.BLOCK < TOWN.town.BLOCK && TOWN.city.STREET_CAR_P > TOWN.town.STREET_CAR_P, "the city's blocks are tighter and its streets fuller of wrecks");
  // Every building: walled, a door on the street, every bit of floor walked to from its front door.
  let bad = 0, rooms = 0, furn = 0;
  for (const b of [...town.pieces, ...city.pieces].filter((p) => p.parts)) {
    const K = new Map(b.cells.map(([x, y], i) => [`${x},${y}`, b.parts[i].k]));
    const doors = b.cells.filter((_, i) => b.parts[i].k === "doorway");
    const open = [...K].filter(([, v]) => v === "open").map(([k]) => k);
    const seen = new Set(), q = [];
    for (const [x, y] of doors) { seen.add(`${x},${y}`); q.push([x, y]); }
    while (q.length) { const [x, y] = q.pop(); for (const [dx, dy] of ORTHO) { const k = `${x + dx},${y + dy}`, v = K.get(k); if (!seen.has(k) && (v === "open" || v === "doorway")) { seen.add(k); q.push([x + dx, y + dy]); } } }
    if (!doors.length || open.some((k) => !seen.has(k)) || !b.parts.every((p) => p.f === "floor") || !b.parts.every((p) => CELL[p.k])) bad++;
    const xs = b.cells.map((c) => c[0]), ys = b.cells.map((c) => c[1]), X0 = Math.min(...xs), X1 = Math.max(...xs), Y0 = Math.min(...ys), Y1 = Math.max(...ys);
    if (b.cells.some(([x, y], i) => b.parts[i].k === "wall" && x > X0 && x < X1 && y > Y0 && y < Y1)) rooms++; // a wall inside: rooms
    if (b.parts.some((p) => ["bed", "table", "shelf", "counter", "cabinet", "rack"].includes(p.k))) furn++;
  }
  const all = [...town.pieces, ...city.pieces].filter((p) => p.parts).length;
  check(!bad, `every building has a door and every bit of its floor is walked to from one (${all} buildings, ${bad} not)`);
  check(rooms > all / 3 && furn > all * 0.8, `inside: rooms walled off (${rooms}), furniture (${furn} of ${all})`);
  // The lie of the land (the user's word 2026-10-23): hills up to three levels, a mountain's crag; no hollows.
  const hills = reliefLayer(99, "hills", 125), mtn = reliefLayer(99, "mountain", 125), farm = reliefLayer(99, "farm", 125);
  const lv = (r) => { const c = {}; for (const [, , h] of r.heights) c[h] = (c[h] || 0) + 1; return c; };
  const hc = lv(hills);
  check(hc[1] > 500 && hc[2] > 50 && hc[3] > 10 && !hc[4] && hills.heights.every(([, , h]) => h > 0) && mtn.heights.every(([, , h]) => h > 0), `the hills: ${JSON.stringify(hc)} cells by level (1 to 3 up; nothing below the ground: the playtest 2026-10-23)`);
  check(mtn.crags.length > 200 && !hills.crags.length && (lv(farm)[1] || 0) < hc[1] && !lv(farm)[2], `a mountain's crag (${mtn.crags.length} cells of ridge), none in the hills; farmland near flat`);
  const HM = new Map(hills.heights.map(([x, y, h]) => [`${x},${y}`, h]));
  check(hills.heights.every(([x, y, h]) => [-1, 0, 1].every((dy) => [-1, 0, 1].every((dx) => Math.abs((HM.get(`${x + dx},${y + dy}`) || 0) - h) <= 1))), "never more than a level between neighbours: walked up and down anywhere");
  // No spur or finger a cell wide (the playtest 2026-10-23): every raised cell in a 2 × 2 as high or higher, every sunk one as deep.
  const cragS = new Set(mtn.crags.map(([x, y]) => `${x},${y}`)), MH = new Map(mtn.heights.map(([x, y, h]) => [`${x},${y}`, h]));
  const wide = (r, M, cr) => r.heights.every(([x, y, h]) => [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([ox, oy]) => [[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dy]) => { const k = `${x + ox + dx},${y + oy + dy}`, v = cr.has(k) ? (h > 0 ? 9 : -9) : M.get(k) || 0; return h > 0 ? v >= h : v <= h; })));
  check(wide(hills, HM, new Set()) && wide(mtn, MH, cragS), "no spur a cell wide: every hill and hollow at least two cells across at each level");
  // One mass rising to a peak (the playtest 2026-10-23: "combine into the center", "more pointed"): its crag all joined,
  // higher in from its edge.
  {
    const cs = new Map(mtn.crags.map(([x, y, lv]) => [`${x},${y}`, lv])), first = mtn.crags[0], seen = new Set([`${first[0]},${first[1]}`]), q = [first];
    for (let i = 0; i < q.length; i++) { const [x, y] = q[i]; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = `${x + dx},${y + dy}`; if (cs.has(k) && !seen.has(k)) { seen.add(k); q.push([x + dx, y + dy]); } } }
    const top = Math.max(...cs.values());
    check(seen.size === cs.size && top >= 8 && Math.min(...cs.values()) === 3, `a mountain is one mass (${seen.size} of ${cs.size} cells joined), 3 levels at its edge up to a peak of ${top}`);
  }
  check(CELL.crag && !CELL.crag.walk && CELL.crag.los && CELL.crag.tall >= 3, "crag: no way over it, no sight through it");
{
  // Laid on a fight's map: the heights under the trees and the open ground, level round the floors and at the edges.
  const fc = Array.from({ length: 40 * 30 }, (_, i) => ({ k: i % 7 === 0 ? "tree" : "open" }));
  for (let y = 12; y < 18; y++) for (let x = 18; x < 24; x++) fc[y * 40 + x].f = "floor";
  const nr = applyRelief(fc, 40, 30, { id: 4, terrain: "hills" });
  const fat = (x, y) => fc[y * 40 + x];
  check(nr > 30 && fc.some((c) => c.ter && c.k === "tree") && [0, 1, 2, 37, 38, 39].every((x) => [...Array(30).keys()].every((y) => !fat(x, y).ter)) && fc.every((c) => !(c.f === "floor" && c.ter)), `a fight on a hills tile: ${nr} cells raised or sunk, trees on them, the edges and round the floors level`);
}
  // Cleared whole: what a building gives.
  check(clearOf({ k: "house" }).hours === CLEAR.house.hours && CLEAR.house.get.wood > 0 && CLEAR.store.get.metalsheet > 0 && CLEAR.block.get.buildmat > 0 && clearOf({ k: "rise", h: 3 }).hours === CLEAR.rise.hours * 3 && clearOf({ k: "dip", h: -2 }).hours === CLEAR.dip.hours * 2 && !clearOf({ k: "crag" }), "a house, a store and a city building are pulled down whole for wood, scrap, building materials, metal sheets; high ground dug down and a hollow filled in a level at a time; the mountainside never");
  // Laid on a map: each cell its own kind and floor.
  const W = 60, H = 60, cells = Array.from({ length: W * H }, () => ({ k: "open" }));
  const h = town.pieces.find((p) => p.k === "house");
  const land = { list: [h], floors: new Map(), pieces: new Map() };
  const ox = 30 - h.cells[0][0], oy = 30 - h.cells[0][1];
  layLand({ cells, W, H, ox, oy, land, ok: () => true });
  const laid = h.cells.map(([x, y]) => cells[(y + oy) * W + x + ox]);
  check(laid.every((c, i) => c.k === h.parts[i].k && c.f === "floor"), `a house laid on a map: walls, windows, its door, furniture, floorboards (${[...new Set(laid.map((c) => c.k))].join(", ")})`);
}

// ---------- 2. the dead at the spot ----------
section("The dead at the spot: by the place, the infection, the year");
const st = createWorld({ seed: SEED, factionCount: 7, mode: "hardcore" });
st.noWanderers = true;
const tiles = Object.values(st.tiles).filter((t) => t.terrain !== "water" && !t.hive && !st.bases.some((b) => b.tile === t.id) && t.owner == null);
const city = tiles.find((t) => t.terrain === "city"), suburb = tiles.find((t) => t.terrain === "suburb");
const calm = tiles.find((t) => (t.terrain === "plains" || t.terrain === "forest") && (t.infection || 0) < SITE_CLEAR.INF);
{
  const tc = siteThreat(st, city.id), ts = siteThreat(st, suburb.id), tq = siteThreat(st, calm.id);
  check(tc.count >= SITE_CLEAR.BASE.city && ts.count >= SITE_CLEAR.BASE.town && tc.count > ts.count, `a city's spot holds more of the dead (${tc.count}) than a town's (${ts.count})`);
  check(tq.count === 0, `quiet land (${calm.terrain}, infection ${(calm.infection || 0).toFixed(2)}): nothing to clear`);
  // Farmland and land far from any town: a few at most, even badly infected.
  const far = tiles.find((t) => t.terrain === "plains" && !st.grid.within(t.id, SITE_CLEAR.NEAR).some((id) => ["city", "suburb"].includes(st.tiles[id].terrain)));
  const inf0 = far.infection;
  far.infection = 0.9;
  const tf = siteThreat(st, far.id);
  far.infection = inf0;
  check(tf.count > 0 && tf.count <= Math.ceil((SITE_CLEAR.BASE.land + 0.9 * SITE_CLEAR.INF_N) * SITE_CLEAR.FAR) && tf.count < ts.count, `farmland far from any town, badly infected: a few (${tf.count})`);
  // More by the year (eras.js hordeGrowth).
  const h0 = st.hour;
  st.hour += 24 * 365 * 5;
  const late = siteThreat(st, suburb.id);
  st.hour = h0;
  check(late.count > ts.count, `years on, more of the dead in the town (${ts.count} → ${late.count})`);
  check(tc.count <= SITE_CLEAR.MAX && tc.power >= 2, `at most ${SITE_CLEAR.MAX}, power ${tc.power}`);
}

// The ban is on the crawl tiles only (the user's word 2026-10-23): a town's or a city's centre is gone through block by
// block, never settled; the suburbs and a city tile with a place of its own take a camp once cleared.
{
  const crawl = Object.values(st.tiles).find((t) => crawlTile(t) && !t.hive);
  check(!!campProblem(st, crawl.id) && /crawl/.test(missionProblem(st, crawl.id, "outpost") || "") && /crawl/.test(missionProblem(st, crawl.id, "camp") || ""), `no base on a crawl tile (${crawl.loc ? crawl.loc.type : crawl.terrain}): ${campProblem(st, crawl.id)}`);
  check(!campProblem(st, suburb.id) && !missionProblem(st, suburb.id, "outpost") && !missionProblem(st, suburb.id, "camp"), "a camp, a home or an outpost may go up in the suburbs (the dead cleared first)");
}

// ---------- 3. the fight ----------
section("The fight: on the tile's map round the spot, the dead round it, none drawn in");
{
  const p = roadTeam(st);
  const goTo = (t) => { p.path = [t.id]; p.idx = 0; p.dest = t.id; p.progress = 0; delete p.siteClear; delete p.campAt; }; // asked again where the camp goes
  goTo(suburb);
  giveOrder(st, p, "camp");
  check(pendingSite(st) === p && p.task && p.task.type === "pitch", "on a town's tile the team asks where the camp goes first");
  st.combat = { site: { partyId: p.id, tile: suburb.id, sel: null } };
  const panel = sitePanel(st, st.combat, null);
  st.combat = null;
  check(/The dead: about \d+ here/.test(panel), "the spot's panel says how many of the dead are to be cleared first");
  // Picked: the fight on a map (a window: played, not by the numbers).
  globalThis.window = {};
  let b;
  try {
    st.combat = { site: { partyId: p.id, tile: suburb.id, sel: BM.defaultSite(st, suburb.id) } };
    CS_ACTIONS["cs-ok"](st);
    b = st.combat;
  } finally { delete globalThis.window; }
  check(!!b && b.setup && b.setup.layout === "siteClear" && p.phase === "engaged" && p.task && p.task.type === "pitch", "picked: the view closes and the fight opens; the setup waits");
  if (b) {
    const foes = b.units.filter((u) => u.side === "enemy"), [cx, cy] = b.siteSpot;
    check(b.reinfMax === 0, "no more of the dead drawn in by the noise");
    check(foes.length === siteThreat(st, suburb.id).count && foes.every((u) => Math.hypot(u.x - cx, u.y - cy) <= SITE_CLEAR.SPREAD + 0.01), `${foes.length} of the dead, all round the spot`);
    check(b.cells.some((c) => c.f === "floor" && c.k === "wall") && b.cells.some((c) => c.f === "road"), "the town's houses and streets are on the fight's map");
    // Pulled back: no camp, the team waits for orders.
    const bases0 = st.bases.length;
    finishCombat(st, b.setup, { outcome: "retreat", enemiesKilled: 1, enemiesLeft: foes.length - 1, survivorsHurt: [], survivorsDead: [], ammoUsed: 0, loot: { supplies: {}, gear: [] }, tactical: true, worn: true });
    check(st.bases.length === bases0 && p.phase !== "task" && p.siteClear == null, "pulled back: no camp, the team waits for orders");
  }
  // Again, won: the camp goes up.
  goTo(suburb);
  giveOrder(st, p, "camp");
  globalThis.window = {};
  try {
    st.combat = { site: { partyId: p.id, tile: suburb.id, sel: BM.defaultSite(st, suburb.id) } };
    CS_ACTIONS["cs-ok"](st);
    b = st.combat;
  } finally { delete globalThis.window; }
  if (b && b.setup) finishCombat(st, b.setup, { outcome: "victory", enemiesKilled: 9, enemiesLeft: 0, survivorsHurt: [], survivorsDead: [], ammoUsed: 0, loot: { supplies: {}, gear: [] }, tactical: true, worn: true });
  check(p.siteClear === suburb.id && p.phase === "task" && p.task && p.task.type === "pitch", "won: the spot is clear and the setup goes on");
  // Quiet land: no fight at all.
  awaitOrders(st, p, "");
  goTo(calm);
  giveOrder(st, p, "camp");
  if (pendingSite(st) === p) pickSite(st, p, BM.defaultSite(st, calm.id));
  check(!st.combat && p.phase === "task" && p.task && p.task.type === "pitch", `on quiet land the camp goes up with no fight (${p.phase}, ${p.task && p.task.type}, ${!!st.combat})`);
}
// Nobody to ask (a spot already picked; the autopilot): the fight by the numbers at once, then the camp or the orders.
{
  const w = createWorld({ seed: SEED + 1, factionCount: 7, mode: "hardcore" });
  w.noWanderers = true;
  const c = Object.values(w.tiles).find((t) => t.terrain === "city" && !crawlTile(t) && !t.hive && !w.bases.some((b) => b.tile === t.id) && t.owner == null); // a city tile with a place of its own (not the crawl)
  const p = roadTeam(w);
  p.path = [c.id]; p.idx = 0; p.dest = c.id; p.progress = 0;
  p.campAt = BM.defaultSite(w, c.id);
  const n0 = w.log.length;
  giveOrder(w, p, "camp");
  const said = w.log.slice(0, w.log.length - n0).map((l) => l.text).join(" | "); // the newest first
  const gone = !w.parties.includes(p);
  const won = !gone && p.siteClear === c.id && p.phase === "task" && p.task && p.task.type === "pitch";
  const lost = !gone && p.siteClear == null && !(p.task && p.task.type === "pitch");
  check(!w.combat && (won || lost || gone) && /of the dead between the team and its camp's spot/.test(said), `by the numbers at once (${siteThreat(w, c.id).count} of the dead in the city): ${won ? "won, the setup goes on" : lost ? "lost, the team waits for orders" : "the team died there"}`);
}
// The game's own spot keeps off buildings and high ground.
{
  const d = BM.defaultSite(st, suburb.id), land = BM.siteLand(st, suburb.id);
  let big = 0;
  for (let y = d[1] - 2; y <= d[1] + 2; y++) for (let x = d[0] - 2; x <= d[0] + 2; x++) { const q = land.pieces.get(`${x},${y}`); if (q && ["house", "store", "block", "rise", "slope", "dip", "crag"].includes(q.k)) big++; }
  check(!big, `the game's own spot in a town keeps off the houses (${d})`);
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
