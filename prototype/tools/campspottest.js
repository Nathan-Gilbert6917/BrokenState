// The camp's own spot and the step ups as buildings (the user's request 2026-10-22: "Increase the Base map sizes to be
// all the same 250x250 base size. Remove base upgrade how it is and turn the next base upgrade into a building to
// place. When you establish a base choose where in the 250 x 250 with a highlighted 10x10 to start with a clearing at
// 10 x 10 area to set up camp with a camp fire. Then you can build around that and clear out more as needed. Provide
// the resources of that area after the process to set up camp is finished. Increase the time to set up camp to 3 hr").
//   1. every base's map is 250 × 250 (sim/basemap.js BASE_GRID), its extent round the base where it stands (gridBox);
//   2. the spot: picked on the tile's map (sim/staging.js askSite / pickSite, sim/basemap.js siteProblem: not too near
//      the edge, not on the river), the game's own when nobody picks (defaultSite), the window (ui/campsite.js);
//   3. the setup: three hours, then the camp stands on its spot, its 10 × 10 cleared and what the land there gave in
//      its stores (clearCampSite); the land all round is the tile's own (the same pieces, moved to the camp's grid);
//   4. the step up is a building placed on the map (camp_up: the Shelter shack): queued and placed, cleared for, built,
//      it stands where it was put and the camp is a shelter; the middle stays the camp fire; it is never pulled down.
// Usage: node tools/campspottest.js [seed]
import { createWorld, tickHour } from "../src/sim/world.js";
import { BUILDINGS, CAMP, isCamp, isShelter, tierUpJob, queueBuild, canDemolish, constructionHour } from "../src/sim/buildings.js";
import { partyMembers, partyTile, giveOrder } from "../src/sim/parties.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { pendingSite, pickSite, campSiteFor, siteSetup, setupWhat, durText, levelWords } from "../src/sim/staging.js";
import * as BM from "../src/sim/basemap.js";
import { mapLv, sightH } from "../src/sim/combat.js";
import { inHollow } from "../src/sim/highground.js";
import { SITE, siteBox, CLEAR, clearOf, siteLevel } from "../src/sim/basescatter.js";
const clearOfFor = (q) => (clearOf(q, true, "clear") || { get: {} }).get;
import { renderRight } from "../src/ui/ui.js";
import { CS_ACTIONS, siteViewDue, sitePanel, siteHoverText, setupWords } from "../src/ui/campsite.js";
import { siteInfo, siteScore, bestSite, bestSiteOn, landFacts, pickWords, pickReasons, SITE_SCORE } from "../src/sim/siteinfo.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok   ${msg}`); } else { fails++; console.log(`  FAIL ${msg}`); } return !!ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
const ui = (extra = {}) => ({ started: true, speed: 0, tab: "bases", selected: -1, survivor: null, baseView: null, expedition: null, diary: null, roster: null, help: false, ...extra });
const run = (st, h, stop = () => false) => { for (let i = 0; i < h && !stop(); i++) { st.hordes.length = 0; tickHour(st); st.cards.length = 0; if (st.engagement) st.engagement = null; } };
const inSite = ([x, y], c = [0, 0]) => { const B = siteBox(c); return x >= B.x0 && y >= B.y0 && x < B.x1 && y < B.y1; }; // the 5 × 5, the fire in its middle
const inSq = ([x, y], h, c = [0, 0]) => x >= c[0] - h && y >= c[1] - h && x < c[0] + h && y < c[1] + h;

const st = createWorld({ seed: SEED, factionCount: 7, mode: "hardcore" });
st.noWanderers = true;
const p = roadTeam(st);
const tile = partyTile(p);

// ---------- 1. the spot ----------
section("The spot: picked on the tile's 250 × 250 map");
{
  check(BM.BASE_GRID === 250 && BM.SITE_RANGE === 125 - BM.NO_BUILD - 2 - BM.GRID.camp.yard, `the map is ${BM.BASE_GRID} × ${BM.BASE_GRID}; the fire within ${BM.SITE_RANGE} of its middle`);
  check(/edge/.test(BM.siteProblem(st, tile, [BM.SITE_RANGE + 1, 0])) && /edge/.test(BM.siteProblem(st, tile, [0, -BM.SITE_RANGE - 1])) && BM.siteProblem(st, tile, [BM.SITE_RANGE, -BM.SITE_RANGE]) === "" || BM.siteLand(st, tile).list.some((q) => q.k === "water"), "too near the edge is refused; the farthest corner in reach is taken (off the river)");
  check(!!BM.siteProblem(st, tile, null) && !!BM.siteProblem(st, tile, [1.5, 0]), "no spot, or not a cell: refused");
  const d = BM.defaultSite(st, tile);
  check(BM.siteProblem(st, tile, d) === "", `the game's own spot takes the camp (${d})`);
  const land = BM.siteLand(st, tile), y = BM.siteYield(st, tile, [0, 0]);
  const inMid = new Set(land.list.filter((q) => q.k !== "water" && q.cells.some((c) => inSite(c))));
  check(SITE.SIZE === 5 && String(Object.values(siteBox([0, 0]))) === "-2,-2,3,3", "the site is 5 × 5 with the fire in its middle cell");
  check(y.n === inMid.size, `what clearing the middle's 5 × 5 takes: ${y.n} things, ${y.hours} work-hours (${Object.entries(y.get).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing"})`);
  const noTool = BM.siteYield(st, tile, [0, 0], false);
  check(noTool.hours >= y.hours && (!inMid.size || [...inMid].every((q) => !["tree", "log", "stump"].includes(q.k)) || noTool.hours > y.hours), `without a cutting tool the trees take longer (${noTool.hours} work-hours against ${y.hours}; × ${CLEAR.NO_TOOL})`);
  // The axe's balance (SITE.NO_TOOL_WOOD): a forest spot cleared with and without one.
  const woody = (at) => BM.siteLand(st, tile).list.filter((q) => ["tree", "log", "stump"].includes(q.k) && q.cells.some((c) => inSite(c, at))).length;
  let fs = null;
  for (let d = 0; d < 100 && !fs; d += 3) for (const at of [[d, 0], [0, d], [-d, 0], [0, -d]]) if (!fs && !BM.siteProblem(st, tile, at) && woody(at) >= 2) fs = at;
  if (fs) {
    const w = BM.siteYield(st, tile, fs, true), wo = BM.siteYield(st, tile, fs, false);
    const exp = BM.siteLand(st, tile).list.filter((q) => q.k !== "water" && q.cells.some((c) => inSite(c, fs))).reduce((a, q) => { const c = clearOfFor(q); return a + (["tree", "log", "stump"].includes(q.k) ? Math.floor((c.wood || 0) * SITE.NO_TOOL_WOOD) : c.wood || 0); }, 0);
    check(SITE.NO_TOOL_WOOD === 0.25 && (wo.get.wood || 0) === exp && (wo.get.wood || 0) < (w.get.wood || 0) && wo.hours > w.hours, `with no axe, saw or machete on the team the trees give a quarter of their wood, and take longer (at ${fs}: ${w.get.wood} wood in ${w.hours} work-hours with one, ${wo.get.wood || 0} in ${wo.hours} without)`);
    const s1 = siteSetup(st, p, tile, fs, true), s2 = siteSetup(st, p, tile, fs, false);
    check(s1.tool && !s2.tool && s1.hours < s2.hours && (s1.get.wood || 0) > (s2.get.wood || 0), `the team's setup there: ${s1.hours} h for ${s1.get.wood} wood with a cutting tool, ${s2.hours} h for ${s2.get.wood || 0} without`);
  } else check(true, "(no wooded spot on this tile)");
  // An open spot on a hill (the user's report and request 2026-10-23: "it said 30 minutes and it did not finish for 9 in
  // game hours there was no trees or rocks just and open 5x5 on a hill", "Allow building on a hill setting up a camp on
  // a hill burrowed down into the hill"): level at its own height, nothing to dig; one over a hill's edge digs the least.
  const hl = BM.siteLand(st, tile);
  const hAt = (x, y) => hl.heights.get(`${x},${y}`) || 0;
  let hill = null, edge = null;
  for (let r = 0; r < 120 && !(hill && edge); r++) for (let x = -r; x <= r; x++) for (const yy of [-r, r]) {
    const at = [x, yy], B = siteBox(at), pr = BM.siteProblem(st, tile, at);
    if (pr && !/hill's edge/.test(pr)) continue;
    const hs = [];
    let bare = true;
    for (let cy = B.y0; cy < B.y1; cy++) for (let cx = B.x0; cx < B.x1; cx++) { const q = hl.pieces.get(`${cx},${cy}`); if (q && q.k !== "rise" && q.k !== "dip") bare = false; hs.push(hAt(cx, cy)); }
    if (!bare) continue;
    if (!hill && hs.every((h) => h === hs[0] && h > 0)) hill = at;
    if (!edge && new Set(hs).size > 1) edge = at;
  }
  if (hill) {
    const s = siteSetup(st, p, tile, hill), w = setupWords(st, p, tile, hill), f = landFacts(hl, hill);
    check(siteLevel(hl, hill) === hAt(...hill) && s.dig.hours === 0 && !s.n && s.work === CAMP.fireHours, `an open hilltop at ${hill}, ${hAt(...hill)} up: nothing to dig, the camp fire's ${s.work} work-hour alone (${s.hours} h)`);
    check(/nothing to clear/.test(w.text) && f.ground.level && f.ground.at === hAt(...hill) && !f.ground.dig, `the picker: ${w.text}; the ground level, on the hill`);
  } else check(true, "(no open hilltop on this tile)");
  if (edge) {
    // The user's request 2026-10-23: "only allow building the camp if the 5x5 fits on the hill in whole otherwise set it to red".
    check(/hill's edge/.test(BM.siteProblem(st, tile, edge)), `a spot over a hill's edge at ${edge} is refused (red): ${BM.siteProblem(st, tile, edge)}`);
  } else check(true, "(no hill's edge on this tile)");
}

// ---------- 2. the setup ----------
section("Setting up camp: the camp fire and the 5 × 5's clearing, the spot asked for, its yield in the stores");
let camp;
const spot = [-20, 14];
{
  const before = { ...p.cargo.supplies };
  giveOrder(st, p, "camp");
  const s0 = siteSetup(st, p, tile);
  check(p.task && p.task.type === "pitch" && p.task.hours === s0.hours && s0.work === Math.round((CAMP.fireHours + s0.clear) * 10) / 10 && s0.hours === Math.max(0.25, Math.ceil((s0.work / s0.workers) * 4 - 1e-9) / 4), `the setup takes the camp fire (${CAMP.fireHours}) and the default spot's clearing (${s0.clear}) work-hours shared by ${s0.workers}: ${p.task && p.task.hours} hours`);
  check(pendingSite(st) === p, "the team asks where the camp goes");
  // The isometric view of the tile's whole map (sim/basemap.js openSiteView; main.js tidyUi opens it).
  globalThis.window = {};
  try { siteViewDue(st, ui()); } finally { delete globalThis.window; }
  const b = st.combat, F = b && b.deployPlan && b.deployPlan.fort;
  check(!!b && !!b.site && b.site.partyId === p.id && b.w === 250 && b.h === 250 && !b.units.length && F, `the tile's whole map opens in the isometric view, nobody on it, the clock held (${b && b.w} × ${b && b.h})`);
  check(!st.bases.some((x) => x.name === "The camp's spot") && b.cells.some((c) => ["tree", "bush", "rock", "fence", "boulder", "stump", "log"].includes(c.k)), "its land on it; the stand-in camp gone from the books");
  check(String(b.site.sel) === String(BM.defaultSite(st, tile)), `the game's own spot picked to start (${b.site.sel})`);
  const g0 = BM.siteGhostAt(st, b);
  check(g0.picked.length === 25 && !g0.cells.length && String(g0.pickedAt) === String([b.site.sel[0] + F.ox, b.site.sel[1] + F.oy]), "the picked 5 × 5 drawn on the ground (gold), its fire's cell tagged");
  const hx = spot[0] + F.ox, hy = spot[1] + F.oy, g1 = BM.siteGhostAt(st, b, hx, hy);
  check(g1.cells.length === 25 && g1.ok && g1.cells.some(([x, y]) => x === hx && y === hy) && g1.cells.every(([x, y]) => Math.abs(x - hx) <= 2 && Math.abs(y - hy) <= 2), "the 5 × 5 under the mouse, its fire in the middle, green where it can go");
  const edge = BM.siteGhostAt(st, b, F.ox + BM.SITE_RANGE + 3, F.oy);
  check(!edge.ok && /edge/.test(edge.why), `red too near the edge (${edge.why})`);
  const hover = siteHoverText(st, b, { x: hx, y: hy });
  check(/Here:.*to set up \(the camp fire.*shared by \d+ (person|people)\); gives/.test(hover), `the hover line: how long and what it gives (${hover.replace(/<[^>]+>/g, "").slice(0, 110)}…)`);
  check(/edge/.test(BM.siteClickAt(st, b, F.ox + BM.SITE_RANGE + 3, F.oy)) && String(b.site.sel) !== String(spot), "a click too near the edge picks nothing");
  check(BM.siteClickAt(st, b, hx, hy) === "" && String(b.site.sel) === String(spot), `a click picks the 5 × 5 there (${spot})`);
  const panel = sitePanel(st, b, {});
  check(/Where does/.test(panel) && /250 × 250/.test(panel) && /to set up/.test(panel) && /Gives/.test(panel) && /data-action="cs-ok"/.test(panel) && /data-action="cs-auto"/.test(panel), "the panel: the spot picked, its time and yield, Set up camp here, Let the game pick");
  CS_ACTIONS["cs-ok"](st);
  check(!st.combat && !pendingSite(st) && p.campAt.join() === spot.join(), `Set up camp here: the spot taken, the view closed (${spot})`);
  check(campSiteFor(st, p, tile).join() === spot.join(), "and that is where it goes");
  const s1 = siteSetup(st, p, tile, spot);
  check(p.task.hours === s1.hours, `the work set for that spot: ${s1.hours} hours (${s1.n} things to clear, ${s1.clear} work-hours)`);
  check(st.log.some((l) => l.text.includes(`sets up camp on its spot`) && l.text.includes(durText(s1.hours))), `the log gives the picked spot's own time (${durText(s1.hours)}), not the game's pick's`);
  const land0 = BM.siteLand(st, tile), y = BM.siteYield(st, tile, spot, s1.tool);
  if (s1.hours >= 2) { run(st, Math.floor(s1.hours) - 1); check(!st.bases.length, `not up before its hours (${Math.floor(s1.hours) - 1}h in)`); }
  run(st, Math.ceil(s1.hours) + 2, () => st.bases.length > 0);
  camp = st.bases[0];
  check(!!camp && isCamp(camp) && camp.plan.fresh && camp.plan.origin.join() === spot.join(), `the camp stands on its spot (${camp && camp.plan.origin})`);
  const B = BM.gridBox(camp);
  check(B.x1 - B.x0 === 250 && B.y1 - B.y0 === 250 && B.x0 === -125 - spot[0] && B.y1 === 125 - spot[1], `its map round it: ${B.x0}..${B.x1}, ${B.y0}..${B.y1}`);
  const land = BM.landFor(st, camp);
  check(!land.list.some((q) => q.k !== "water" && q.cells.some((c) => inSite(c))), "nothing of the land left in its 5 × 5");
  check([[-2, -2], [2, 2], [0, 0], [-2, 2]].every(([x, yy]) => camp.land.cleared[`${x},${yy}`]) && !camp.land.cleared["3,3"] && !camp.land.cleared["-3,0"], "its 5 × 5 is cleared ground, the fire in the middle (no more)");
  check(Object.entries(y.get).every(([k, v]) => (camp.stock[k] || 0) + 6 >= v + (before[k] || 0)), `what the land there gave is in its stores (${Object.entries(y.get).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing"}; wood ${Math.round(camp.stock.wood || 0)})`);
  check(st.log.some((l) => /Clearing its 5 × 5 round the camp fire gave/.test(l.text)), "the log says what the clearing gave");
  // The rest of the land is the tile's, where it lies on the map: every piece of it outside the clearing, moved into the camp's grid.
  const sample = land0.list.filter((q) => q.k !== "water" && q.k !== "wreck" && !q.cells.some((c) => inSite(c, spot))).slice(0, 400);
  const moved = sample.filter((q) => { const [x, yy] = q.cells[0], r = land.pieces.get(`${x - spot[0]},${yy - spot[1]}`); return r && r.k === q.k; });
  check(sample.length > 50 && moved.length === sample.length, `the land round it is the tile's own (${moved.length} of ${sample.length} pieces where they lie on the map)`);
  const yardLand = land.list.filter((q) => q.k !== "water" && q.cells.every((c) => inSq(c, BM.yardHalf(camp)) && !inSite(c)));
  check(yardLand.length === land0.list.filter((q) => q.k !== "water" && q.cells.every((c) => inSq(c, BM.yardHalf(camp), spot) && !inSite(c, spot))).length, `no yard swept for it: the land in its yard beyond the clearing stands (${yardLand.length} things to clear as needed)`);
  check(String(BM.fireSpot(camp)) === "0,0,0" && BM.layoutOf(st, camp).some((e) => e.it.key === BM.FIRE.KEY && String(e.at) === "0,0,0" && !e.auto), "the camp fire in the middle of the clearing, an item on the map");
}

// ---------- 2b. the camp fire moved by hand ----------
section("The camp fire moves in build mode");
{
  check(!BM.coreParts(camp).some((q) => q.k === "firepit"), "it is not part of the fixed middle (the cache is)");
  const to = [-1, 1, 0]; // in the cleared 5 × 5
  check(BM.placeItem(st, camp, BM.FIRE.KEY, to[0], to[1], to[2]) === "" && String(BM.fireSpot(camp)) === String(to), `moved to ${to}`);
  const occ = BM.occupancy(st, camp, null, null);
  check(BM.floorHostAt(occ, 0, 0) === null && BM.itemByKey(st, camp, BM.FIRE.KEY).at.join() === to.join() && BM.placeProblemAt(camp, { ...BM.FIRE.FOOT, key: "x" }, 0, 0, 0, occ) === "" && /Camp fire/.test(BM.placeProblemAt(camp, { ...BM.FIRE.FOOT, key: "x" }, to[0], to[1], 0, occ)), "it stands there now; its old cell is free ground");
  check(/by hand/.test(BM.unplaceItem(st, camp, BM.FIRE.KEY)) && String(BM.fireSpot(camp)) === String(to), "never put back by the game (no Auto)");
  // Through the view: Move it, put it down again where it started.
  globalThis.window = {};
  try {
    check(!BM.openBaseMap(st, camp.id) && !!st.combat, "the build map opens");
    const b = st.combat, F = b.deployPlan.fort;
    check(!BM.layoutAct(st, b, { type: "lift", key: BM.FIRE.KEY }) && b.layout.pick === BM.FIRE.KEY, "Move picks the fire up");
    check(!BM.layoutAct(st, b, { type: "put", x: F.ox, y: F.oy }) && String(BM.fireSpot(camp)) === "0,0,0", "and puts it down where it is clicked");
    check(b.cells.some((c) => c.k === "firepit") || st.combat.cells.some((c) => c.k === "firepit"), "drawn as a fire pit on the map");
  } finally { delete globalThis.window; st.combat = null; }
  const html = renderRight(st, ui({ selected: camp.tile }));
  check(/data-action="buildmap" data-base-id="\d+" data-tab="none"/.test(html) && /Base map/.test(html), "the side panel of the selected base has a Base map button");
}

// ---------- 3. the step up: a building to place ----------
section("The step up is a building placed on the map");
{
  const def = BUILDINGS.camp_up;
  check(def.name === "Shelter shack" && !!BM.FOOT.camp_up && !!BM.FOOT.outpost_up && !!BM.FOOT.hub_up, "the Shelter shack, the Outpost house and the Main house have footprints");
  const menu = BM.buildMenu(st, camp).find((m) => m.type === "camp_up");
  check(!!menu && menu.w === 5 && menu.h === 4, "the Shelter shack is on the build map's Build list (5 × 4)");
  check(!tierUpJob(camp), "nothing building yet");
  Object.assign(camp.stock, { scrap: (camp.stock.scrap || 0) + 40, buildmat: 4, wood: (camp.stock.wood || 0) + 400 });
  check(/queued/.test(queueBuild(st, camp, "camp_up")), "queued");
  const job = tierUpJob(camp);
  // Its site: cleared ground east of the clearing (the land there cleared by hand, as Fell / Clear would).
  const at = [12, -2, 0];
  for (let yy = at[1] - 1; yy < at[1] + 6; yy++) for (let x = at[0] - 1; x < at[0] + 7; x++) camp.land.cleared[`${x},${yy}`] = 1;
  camp.land.n++;
  const err = BM.placeItem(st, camp, `c:${job.id}`, at[0], at[1], at[2]);
  check(err === "" && String(job.at) === String(at), `placed by hand where it goes (${err || job.at})`);
  for (const s of st.survivors) if (s.alive && s.location.kind === "base" && s.location.baseId === camp.id) s.role = "build";
  for (let i = 0; i < 400 && isCamp(camp); i++) constructionHour(st);
  check(isShelter(camp) && !isCamp(camp), "built: the camp is a shelter");
  const shack = camp.buildings.find((b) => b.type === "camp_up");
  check(!!shack && String(shack.at) === String(at), `the shelter shack stands where it was put (${shack && shack.at})`);
  check(!!BM.fireSpot(camp) && BM.coreParts(camp).some((q) => q.name === "Camp cache") && !BM.coreParts(camp).some((q) => q.kind === "house"), "the middle is still the camp's: its fire (movable) and cache, no shack drawn there");
  check(!canDemolish(st, camp, shack.id).ok, `never pulled down (${canDemolish(st, camp, shack.id).reason})`);
  check(BM.layoutOf(st, camp).some((e) => e.it.key === `b:${shack.id}` && String(e.at) === String(at)), "on the map as a building of its own");
  check(BM.buildMenu(st, camp).some((m) => m.type === "hub_up"), "the shelter's next step, the Main house, is on its Build list");
}

// ---------- 4. the governor ----------
section("Nobody to ask: the game's spot");
{
  const s2 = createWorld({ seed: SEED + 1, factionCount: 7, mode: "hardcore" });
  s2.noWanderers = true;
  s2.autopilot = { on: true };
  const q = roadTeam(s2), t2 = partyTile(q);
  giveOrder(s2, q, "camp");
  check(!pendingSite(s2), "on autopilot no window asks");
  run(s2, 48, () => s2.bases.length > 0);
  const c2 = s2.bases[0];
  check(!!c2 && String(c2.plan.origin) === String(BM.defaultSite(s2, t2)), `the camp goes on the game's spot (${c2 && c2.plan.origin})`);
}

// ---------- 5. what a spot is like, and the game's pick ----------
// The user's words 2026-10-23: "add valuable information to setting up camp. Update let the game pick".
section("What a spot is like (siteInfo) and the game's pick weighed on it (bestSite)");
{
  const s3 = createWorld({ seed: SEED + 2, factionCount: 7, mode: "hardcore" });
  s3.noWanderers = true;
  const q = roadTeam(s3), t3 = partyTile(q);
  const d = BM.defaultSite(s3, t3), info = siteInfo(s3, q, t3, d), s = siteSetup(s3, q, t3, d);
  check(info.ok && info.picked && String(info.at) === String(d) && info.setup.hours === s.hours && info.setup.workers === s.workers && String(Object.entries(info.setup.get)) === String(Object.entries(s.get)), `the game's spot (${d}): the team's setup as siteSetup has it (${info.setup.hours} h), and it says it is the game's pick`);
  const keys = ["ground", "lie", "sight", "room", "roomClear", "yard", "wood", "trees", "places", "dead", "score"];
  check(keys.every((k) => k in info) && typeof info.ground.level === "boolean" && ["high", "low", "flat", "uneven"].includes(info.lie.kind) && info.sight >= 0 && info.sight <= 1 && info.room >= 0 && info.room <= 1 && (info.water === null || info.water >= 0) && (info.road === null || info.road >= 0) && typeof info.dead.count === "number", `its facts: ${info.ground.level ? "level" : "uneven"}, ${info.lie.kind} round it, sight ${info.sight}, room ${info.room}, wood ${info.wood}, river ${info.water}, road ${info.road}, ${info.places.length} places known, ${info.dead.count} dead`);
  check(info.score.total === siteScore(info).total && Object.keys(info.score.parts).length >= 8 && info.score.parts.time === -SITE_SCORE.TIME * info.work, `its score ${info.score.total} from its parts (${Object.entries(info.score.parts).map(([k, v]) => `${k} ${Math.round(v * 10) / 10}`).join(", ")})`);
  const bad = siteInfo(s3, q, t3, [BM.SITE_RANGE + 4, 0]);
  check(!bad.ok && /edge/.test(bad.why), "a spot that cannot take the camp: only why");
  check(/^The game picked this spot because .+\.$/.test(pickWords(info)) && pickReasons(info).length >= 1, `why: "${pickWords(info)}"`);
  // Deterministic: the same twice, in another world from the same seed, and on the land alone.
  const again = createWorld({ seed: SEED + 2, factionCount: 7, mode: "hardcore" });
  check(String(BM.defaultSite(s3, t3)) === String(d) && String(bestSite(again, t3)) === String(d) && String(bestSiteOn(BM.siteLand(s3, t3))) === String(d), "deterministic: the same spot every time, in a world made again, and from the land alone");
  // Never a spot that cannot take the camp; off buildings and high ground; no worse than the plain search's spot.
  const BIG = new Set(["house", "store", "block", "rise", "slope", "dip", "crag"]);
  const kinds = new Map();
  for (const t of s3.tiles) { if (t.terrain === "water") continue; const k = `${BM.terrainOf(s3, { tile: t.id })}${t.road ? "+road" : ""}${s3.grid.neighbors(t.id).some((n) => s3.tiles[n].river) ? "+river" : ""}`; if (!kinds.has(k)) kinds.set(k, t.id); }
  let okAll = true, cleanAll = true, worse = 0;
  const ms = [];
  for (const [k, id] of [...kinds].slice(0, 12)) {
    BM.siteLand(s3, id);
    const at0 = Date.now(), at = BM.defaultSite(s3, id), at1 = Date.now();
    BM.defaultSite(s3, id);
    ms.push([at1 - at0, Date.now() - at1]);
    if (BM.siteProblem(s3, id, at)) { okAll = false; console.log(`    ${k}: ${at} ${BM.siteProblem(s3, id, at)}`); }
    const land = BM.siteLand(s3, id), B = siteBox(at);
    for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) { const p = land.pieces.get(`${x},${y}`); if (p && BIG.has(p.k)) cleanAll = false; }
    // The old search's spot (the nearest to the middle that takes the camp off buildings and high ground) scores no better.
    let old = null;
    for (let r = 0; r <= BM.SITE_RANGE && !old; r++) for (let y = -r; y <= r && !old; y++) for (let x = -r; x <= r && !old; x++) {
      if (Math.max(Math.abs(x), Math.abs(y)) !== r || BM.siteProblem(s3, id, [x, y])) continue;
      const B2 = siteBox([x, y]);
      let big = false;
      for (let yy = B2.y0; yy < B2.y1; yy++) for (let xx = B2.x0; xx < B2.x1; xx++) { const p = land.pieces.get(`${xx},${yy}`); if (p && BIG.has(p.k)) big = true; }
      if (!big) old = [x, y];
    }
    if (old && siteScore(landFacts(land, old)).total > siteScore(landFacts(land, at)).total + 1e-9) worse++;
  }
  check(okAll && cleanAll, `on every kind of tile (${kinds.size} kinds, ${Math.min(12, kinds.size)} tried) the game's spot takes the camp, off buildings and high ground`);
  check(!worse, "and never scores below the nearest open spot to the middle (the old pick)");
  check(ms.every(([, c]) => c < 50), `weighed once a land (${Math.min(...ms.map((m) => m[0]))}–${Math.max(...ms.map((m) => m[0]))} ms on this machine), then kept: asked again ${Math.max(...ms.map((m) => m[1]))} ms at most`);
  // Built by hand: an obviously better spot is the one picked.
  const synth = (fill) => {
    const pieces = new Map(), list = [], heights = new Map();
    for (let y = -125; y < 125; y++) for (let x = -125; x < 125; x++) { const r = fill(x, y); if (r === "tree") { const p = { k: "tree", g: `t${x},${y}`, cells: [[x, y]] }; list.push(p); pieces.set(`${x},${y}`, p); } else if (typeof r === "number") heights.set(`${x},${y}`, r); }
    return { pieces, list, floors: new Map(), heights };
  };
  const cheb = (x, y, c) => Math.max(Math.abs(x - c[0]), Math.abs(y - c[1]));
  const glade = [50, -30], woods = synth((x, y) => (cheb(x, y, glade) <= 15 ? null : "tree"));
  const gp = bestSiteOn(woods), gf = landFacts(woods, gp);
  check(cheb(gp[0], gp[1], glade) <= 13 && gf.work === CAMP.fireHours && gf.room > 0.9, `woods all round, one glade at ${glade}: the camp goes in the glade (${gp}: nothing to clear, room ${gf.room})`);
  const rise = [20, 20], hollow = synth((x, y) => { const c = cheb(x, y, rise); return c >= 4 && c <= 10 ? -1 : null; });
  const hp = bestSiteOn(hollow), hf = landFacts(hollow, hp);
  check(String(hp) === String(rise) && hf.lie.kind === "high" && hf.lie.lower === 1, `open land with one knoll (lower ground all round ${rise}): the knoll is picked (${hp}, ${hf.lie.kind}: looks down on it)`);
  const pit = synth((x, y) => { const c = cheb(x, y, [0, 0]); return c >= 4 && c <= 10 ? 1 : null; });
  const pp = bestSiteOn(pit), pf = landFacts(pit, pp);
  check(String(pp) !== "0,0" && pf.lie.higher === 0 && pf.sight === 1, `high ground ringing the map's middle: the camp keeps out from under it (${pp}, nothing higher round it)`);
  check(String(bestSiteOn(woods)) === String(gp) && String(bestSiteOn(hollow)) === String(hp), "the same land, the same spot");
  // The picker shows it: the panel's facts, the hover line, why the game's spot; Let the game pick says why in the log.
  giveOrder(s3, q, "camp");
  globalThis.window = {};
  try {
    siteViewDue(s3, ui());
    const b = s3.combat, F = b && b.deployPlan && b.deployPlan.fort;
    const panel = sitePanel(s3, b, {});
    check(["Ground", "Round it", "Sight", "Room", "Wood", "Water", "Road", "Places"].every((w) => panel.includes(`>${w}</div>`)) && /The game picked this spot because/.test(panel) && /data-action="cs-auto"/.test(panel), "the panel: the spot's facts in rows, and why the game picked the spot shown");
    const other = [d[0] + 9, d[1]];
    const hover = siteHoverText(s3, b, { x: other[0] + F.ox, y: other[1] + F.oy }), plain = hover.replace(/<[^>]+>/g, "");
    check(/to set up/.test(plain) && /sight \d+%/.test(plain) && /room \d+%/.test(plain) && /class="(good|danger|warn)"/.test(hover), `the hover line: time, yield and the facts, coloured (${plain.slice(plain.indexOf("Click") - 70, plain.indexOf("Click")).trim()})`);
    BM.siteClickAt(s3, b, other[0] + F.ox, other[1] + F.oy);
    const g = BM.siteGhostAt(s3, b);
    check(!BM.siteProblem(s3, t3, other) ? !/The game picked/.test(sitePanel(s3, b, {})) && String(g.gameAt) === String([d[0] + F.ox, d[1] + F.oy]) : true, "another spot picked: no reason line, and the game's own spot tagged on the map");
    CS_ACTIONS["cs-auto"](s3);
    check(!s3.combat && s3.log.some((l) => /The game picked this spot because/.test(l.text)), `Let the game pick: the log says why (${(s3.log.find((l) => /The game picked/.test(l.text)) || { text: "" }).text.slice(0, 90)}…)`);
  } finally { delete globalThis.window; }
}

// ---------- 6. a camp on a hilltop ----------
// The user's request 2026-10-23: "Allow building on a hill setting up a camp on a hill burrowed down into the hill": the
// camp stands up on the hill (its level: base.plan.level), its map laid from that level (the plain round it below), and
// level ground of the hill builds as level ground does.
section("A camp on a hilltop stands on it, and builds on it");
{
  const s6 = createWorld({ seed: SEED, factionCount: 7, mode: "hardcore" });
  s6.noWanderers = true;
  const q6 = roadTeam(s6), t6 = partyTile(q6), l6 = BM.siteLand(s6, t6), hh = (x, y) => l6.heights.get(`${x},${y}`) || 0;
  let top = null;
  for (let r = 0; r < 120 && !top; r++) for (let x = -r; x <= r && !top; x++) for (const yy of [-r, r]) {
    const at = [x, yy], B = siteBox(at);
    if (top || BM.siteProblem(s6, t6, at) || !(hh(...at) > 0)) continue;
    let ok = true;
    for (let cy = B.y0 - 3; cy < B.y1 + 3; cy++) for (let cx = B.x0 - 3; cx < B.x1 + 3; cx++) if (hh(cx, cy) !== hh(...at)) ok = false; // room on the hill round it
    for (let cy = B.y0; cy < B.y1; cy++) for (let cx = B.x0; cx < B.x1; cx++) { const pc = l6.pieces.get(`${cx},${cy}`); if (pc && pc.k !== "rise") ok = false; } // open: nothing standing on it
    if (ok) top = at;
  }
  if (!top) check(true, "(no hilltop on this tile)");
  else {
    const L = hh(...top);
    giveOrder(s6, q6, "camp");
    check(pickSite(s6, q6, top) === "" && q6.task.hours === 0.5, `a hilltop ${L} up at ${top}: 30 minutes to set up (the camp fire)`);
    run(s6, 4, () => s6.bases.length > 0);
    const c6 = s6.bases[0];
    check(!!c6 && c6.plan.level === L && BM.levelOf(c6) === L, `the camp stands at the hill's level (${c6 && c6.plan.level})`);
    const land = BM.landFor(s6, c6);
    // Built on: the hill's own ground takes a building as level ground does, and so does the plain below; never one over
    // the hill's edge (the user's request 2026-10-23: "It should not be trying to burrow just build on the hill as if it
    // was the ground floor").
    const occ = BM.occupancy(s6, c6, null, null), foot = { ...BM.FIRE.FOOT, key: "x" }, plot = { ...BM.FOOT.farm_plot, key: "y" };
    const free = [[4, 4], [-4, 4], [4, -4], [-4, -4], [5, 0], [0, 5]].find(([x, y]) => { const q = land.pieces.get(`${x},${y}`); return !q || q.k === "rise"; });
    check(land.level === L && land.heights.get("0,0") === L && !!free && !BM.landUnder(land, plot, [free[0], free[1], 0]).length && BM.placeProblemAt(c6, plot, free[0], free[1], 0, occ) === "", `a crop plot on the hilltop beside the camp goes down there, nothing to dig (${free})`);
    let pl = null, edge = null;
    for (let r = 3; r < 60 && !(pl && edge); r++) for (let x = -r; x <= r; x++) for (const y of [-r, r]) {
      const g = (a, b) => land.heights.get(`${a},${b}`) || 0, q = land.pieces.get(`${x},${y}`);
      if (!pl && !g(x, y) && !g(x + 1, y) && !g(x, y + 1) && !g(x + 1, y + 1) && !q && !BM.placeProblemAt(c6, foot, x, y, 0, occ)) pl = [x, y];
      if (!edge && g(x, y) === L && !g(x + 1, y) && !BM.landUnder(land, plot, [x, y, 0]).length) edge = [x, y];
    }
    check(!!pl && BM.placeProblemAt(c6, plot, pl[0], pl[1], 0, occ) === "", `and on the plain below, as it is (${pl}): nothing filled in`);
    check(!!edge && BM.placeProblemAt(c6, plot, edge[0], edge[1], 0, occ) === BM.UNEVEN_WHY, `over the hill's edge (${edge}): ${edge && BM.placeProblemAt(c6, plot, edge[0], edge[1], 0, occ)}`);
    check(BM.placeProblemAt(c6, { ...BM.FOOT.wall2, key: "w" }, edge[0], edge[1], 0, occ) !== BM.UNEVEN_WHY, "a wall piece follows the ground over it");
    // Its map: laid from its level (the camp on level ground, the plain below it), what stands on the plain on the plain.
    check(BM.placeItem(s6, c6, BM.FIRE.KEY, pl[0], pl[1], 0) === "", `the camp fire moved down onto the plain (${pl})`);
    globalThis.window = {};
    try {
      check(!BM.openBaseMap(s6, c6.id) && !!s6.combat, "its base map opens");
      const b = s6.combat, F = b.deployPlan.fort, cell = (x, y) => b.cells[(y + F.oy) * b.w + x + F.ox];
      const yard = cell(free[0], free[1]), fire = cell(pl[0], pl[1]), by = cell(pl[0] + 1, pl[1]);
      check(mapLv(b) === L && (yard.h || 0) === 0 && by.ter && by.h === -L, `laid from the camp's level (datum ${mapLv(b)}): the camp's ground 0, the plain ${-L}`);
      check(fire.k === "firepit" && fire.ter && fire.bld && fire.h === -L, `the fire stands on the plain's ground, not dug in nor on a pillar (${fire.k}: ${fire.h})`);
      const ys = (free[1] + F.oy), xs = (free[0] + F.ox);
      check(!inHollow(b, xs, ys) && !inHollow(b, pl[0] + 1 + F.ox, pl[1] + F.oy), "neither the camp's ground nor the plain is a hollow");
      check(sightH(b, xs, ys) === L, `the camp's people see from the hill's height (${sightH(b, xs, ys)} levels up)`);
    } finally { delete globalThis.window; s6.combat = null; }
  }
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
