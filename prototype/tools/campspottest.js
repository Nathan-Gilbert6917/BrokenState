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
import { pendingSite, pickSite, campSiteFor } from "../src/sim/staging.js";
import * as BM from "../src/sim/basemap.js";
import { SITE } from "../src/sim/basescatter.js";
import { renderModal, renderRight } from "../src/ui/ui.js";
import { CS_ACTIONS, siteModalUp } from "../src/ui/campsite.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok   ${msg}`); } else { fails++; console.log(`  FAIL ${msg}`); } return !!ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
const ui = (extra = {}) => ({ started: true, speed: 0, tab: "bases", selected: -1, survivor: null, baseView: null, expedition: null, diary: null, roster: null, help: false, ...extra });
const run = (st, h, stop = () => false) => { for (let i = 0; i < h && !stop(); i++) { st.hordes.length = 0; tickHour(st); st.cards.length = 0; if (st.engagement) st.engagement = null; } };
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
  const inMid = new Set(land.list.filter((q) => q.k !== "water" && q.cells.some((c) => inSq(c, SITE.HALF))));
  check(y.n === inMid.size, `what clearing the middle's 10 × 10 takes: ${y.n} things (${Object.entries(y.get).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing"})`);
}

// ---------- 2. the setup ----------
section("Setting up camp: three hours, the spot asked for, the 10 × 10 cleared and its yield in the stores");
let camp;
const spot = [-20, 14];
{
  const before = { ...p.cargo.supplies };
  giveOrder(st, p, "camp");
  check(p.task && p.task.type === "pitch" && p.task.hours === CAMP.setupHours && CAMP.setupHours === 3, `the setup takes ${p.task && p.task.hours} hours`);
  check(pendingSite(st) === p && siteModalUp(st, ui()), "the team asks where the camp goes: the window is up (it holds the clock)");
  const html = renderModal(st, ui()) || "";
  check(/Where does/.test(html) && /250 × 250/.test(html) && /campsite-map/.test(html) && /data-action="cs-ok"/.test(html), "the window: the tile's map, the square, Set up camp here");
  const u = ui();
  renderModal(st, u);
  u.siteSel = [BM.SITE_RANGE + 5, 0];
  CS_ACTIONS["cs-ok"](st, u);
  check(pendingSite(st) === p && /edge/.test(u.siteMsg), `a spot off the camp's reach is refused in the window (${u.siteMsg})`);
  check(pickSite(st, p, spot) === "" && !pendingSite(st) && p.campAt.join() === spot.join(), `the spot picked (${spot})`);
  check(campSiteFor(st, p, tile).join() === spot.join(), "and that is where it goes");
  const land0 = BM.siteLand(st, tile), y = BM.siteYield(st, tile, spot);
  run(st, 2);
  check(!st.bases.length, "not up after two hours");
  run(st, 2, () => st.bases.length > 0);
  camp = st.bases[0];
  check(!!camp && isCamp(camp) && camp.plan.fresh && camp.plan.origin.join() === spot.join(), `the camp stands on its spot (${camp && camp.plan.origin})`);
  const B = BM.gridBox(camp);
  check(B.x1 - B.x0 === 250 && B.y1 - B.y0 === 250 && B.x0 === -125 - spot[0] && B.y1 === 125 - spot[1], `its map round it: ${B.x0}..${B.x1}, ${B.y0}..${B.y1}`);
  const land = BM.landFor(st, camp);
  check(!land.list.some((q) => q.k !== "water" && q.cells.some((c) => inSq(c, SITE.HALF))), "nothing of the land left in its 10 × 10");
  check([[-5, -5], [4, 4], [0, 0]].every(([x, yy]) => camp.land.cleared[`${x},${yy}`]), "its 10 × 10 is cleared ground");
  check(Object.entries(y.get).every(([k, v]) => (camp.stock[k] || 0) + 6 >= v + (before[k] || 0)), `what the land there gave is in its stores (${Object.entries(y.get).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing"}; wood ${Math.round(camp.stock.wood || 0)})`);
  check(st.log.some((l) => /Clearing its 10 × 10 round the camp fire gave/.test(l.text)), "the log says what the clearing gave");
  // The rest of the land is the tile's, where it lies on the map: every piece of it outside the clearing, moved into the camp's grid.
  const sample = land0.list.filter((q) => q.k !== "water" && q.k !== "wreck" && !q.cells.some((c) => inSq(c, SITE.HALF, spot))).slice(0, 400);
  const moved = sample.filter((q) => { const [x, yy] = q.cells[0], r = land.pieces.get(`${x - spot[0]},${yy - spot[1]}`); return r && r.k === q.k; });
  check(sample.length > 50 && moved.length === sample.length, `the land round it is the tile's own (${moved.length} of ${sample.length} pieces where they lie on the map)`);
  const yardLand = land.list.filter((q) => q.k !== "water" && q.cells.every((c) => inSq(c, BM.yardHalf(camp)) && !inSq(c, SITE.HALF)));
  check(yardLand.length === land0.list.filter((q) => q.k !== "water" && q.cells.every((c) => inSq(c, BM.yardHalf(camp), spot) && !inSq(c, SITE.HALF, spot))).length, `no yard swept for it: the land in its yard beyond the clearing stands (${yardLand.length} things to clear as needed)`);
  check(String(BM.fireSpot(camp)) === "0,0,0" && BM.layoutOf(st, camp).some((e) => e.it.key === BM.FIRE.KEY && String(e.at) === "0,0,0" && !e.auto), "the camp fire in the middle of the clearing, an item on the map");
}

// ---------- 2b. the camp fire moved by hand ----------
section("The camp fire moves in build mode");
{
  check(!BM.coreParts(camp).some((q) => q.k === "firepit"), "it is not part of the fixed middle (the cache is)");
  const to = [-3, 3, 0];
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
  run(s2, 4, () => s2.bases.length > 0);
  const c2 = s2.bases[0];
  check(!!c2 && String(c2.plan.origin) === String(BM.defaultSite(s2, t2)), `the camp goes on the game's spot (${c2 && c2.plan.origin})`);
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
