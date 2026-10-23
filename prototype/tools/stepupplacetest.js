// A camp's step up is placed by hand before it is queued (the user's request 2026-10-23: "When you establish a camp do
// not have the shelter pending build show yet. The player needs to select it from the build menu and select where to
// put it and then it can be built"). sim/staging.js makeCamp, ui/basemap.js openToPlace, sim/economy.js shipFromOutposts.
//   - Build outpost (and Establish base) sets up a camp meant to grow (base.grow) with nothing queued; the log says
//     to place its step up from the Build list;
//   - the build map opened with the step up picked queues nothing; a click where it fits queues it there, placed;
//   - the camp meant to grow is on the supply network before its house is placed;
//   - the governor's camp still has its step up queued at once;
//   - the build map is twice the size round the base (VIEW_SCALE), nothing placed within VIEW_EDGE cells of its edge
//     (the user's requests 2026-10-23), tinted; the yard keeps its size.
// Usage: node tools/stepupplacetest.js [seed]
import { createWorld, tickHour, hub, atBase, day } from "../src/sim/world.js";
import { tierUpJob, tierUpType } from "../src/sim/buildings.js";
import { launchExpedition, giveOrder, planPath } from "../src/sim/parties.js";
import { openBaseMap, layoutAct, ghostAt, yardHalf, GRID, VIEW_EDGE, VIEW_EDGE_WHY } from "../src/sim/basemap.js";
import { openToPlace } from "../src/ui/basemap.js";
import { isSettlementTile } from "../src/sim/startpick.js";
import { poiKnowledge } from "../src/sim/pois.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.noNewGangs = true; st.erasOff = true; st.noWanderers = true; return st; };
const free = (st, t) => st.tiles[t].terrain !== "water" && st.tiles[t].terrain !== "mountain" && !isSettlementTile(st.tiles[t]) && st.tiles[t].owner == null && !st.factions.some((f) => f.bases.includes(t)) && !st.bases.some((b) => b.tile === t) && !st.hordes.some((h) => h.tile === t);
// A team of two from the hub sets up a camp by Build outpost on a scouted tile near it; returns the camp.
function outpostCamp(st) {
  const h = hub(st);
  const tile = st.grid.within(h.tile, 6).find((t) => st.grid.distance(t, h.tile) >= 3 && free(st, t) && planPath(st, h.tile, t, false));
  poiKnowledge(st, tile, true).surveyed = day(st);
  Object.assign(h.stock, { scrap: 80, buildmat: 20, food: 200, water: 200, wood: 2000 });
  const res = launchExpedition(st, { memberIds: atBase(st, h.id).slice(0, 2).map((s) => s.id), dest: tile, mission: "outpost", stance: "normal", supplies: { food: 6, water: 6, scrap: 20 } });
  if (!check(!res.error, `the team leaves (${res.error || "ok"})`)) return null;
  res.party.path = [tile]; res.party.idx = 0;
  giveOrder(st, res.party, "outpost");
  for (let i = 0; i < 40 && !st.bases.some((b) => b.tile === tile); i++) tickHour(st);
  return st.bases.find((b) => b.tile === tile) || null;
}

section("Build outpost: the camp stands with nothing queued");
{
  const st = world();
  const b = outpostCamp(st);
  if (check(!!b, "the camp stands")) {
    check(b.grow === true, "a camp meant to grow (base.grow)");
    check(!tierUpJob(b) && !b.construction.some((c) => c.type === "outpost_up" || c.type === "camp_up"), `no step up pending (${b.construction.map((c) => c.type).join(", ") || "nothing queued"})`);
    check(st.log.some((l) => /set up camp/.test(l.text) && /Build list/.test(l.text)), "the log says to place it from the Build list");

    section("The build map with the step up picked: queued only where it is clicked");
    const ui = {};
    const type = tierUpType(b);
    check(type === "outpost_up", `its step up is the outpost house (${type})`);
    check(openToPlace(st, ui, b, type) && st.combat && st.combat.layout.pickType === type, "the map opens with it picked");
    check(!tierUpJob(b), "still nothing queued while it is only picked");
    const B = st.combat;
    let at = null;
    for (let r = 4; r < 60 && !at; r += 2) for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, r], [r, -r], [-r, -r]]) {
      const x = (B.w >> 1) + dx, y = (B.h >> 1) + dy, g = ghostAt(st, B, x, y);
      if (g && g.ok) { at = [x, y]; break; }
    }
    if (check(!!at, "somewhere near the fire it fits")) {
      const err = layoutAct(st, B, { type: "build", x: at[0], y: at[1] });
      const job = tierUpJob(b);
      check(!err && job && job.type === type && !!job.at && !!job.paid, `a click there queues it, placed, gathering its materials (${err || (job && JSON.stringify(job.at))})`);
    }
    delete st.combat;
  }
}

section("A camp meant to grow is on the supply network before its house is placed");
{
  const st = world();
  const b = outpostCamp(st);
  if (check(!!b, "the camp stands")) {
    delete b.supplyLine;
    for (let i = 0; i < 26 && !b.supplyLine; i++) tickHour(st);
    check(!tierUpJob(b) && !!b.supplyLine, "shipped to and from at midnight with no step up queued (its supply line read)");
  }
}

section("The governor's camp has its step up queued at once");
{
  const st = world();
  st.autopilot = true;
  const b = outpostCamp(st);
  if (check(!!b, "the camp stands")) check(!!tierUpJob(b) && tierUpJob(b).type === "outpost_up", "its outpost house is queued (placed by the game)");
}

section("The build map: twice the size round the base, nothing within 3 cells of its edge");
{
  const st = world();
  const b = outpostCamp(st);
  if (check(!!b, "the camp stands")) {
    check(yardHalf(b) === GRID.camp.yard, `the yard keeps its size (${yardHalf(b)} half)`);
    openBaseMap(st, b.id);
    const B = st.combat;
    check(B.w === 112 && B.h === 112, `a camp's build map is 112 × 112, twice the 56 × 56 (${B.w} × ${B.h})`);
    layoutAct(st, B, { type: "pickType", bt: "crates" });
    let near = Infinity, edgeWhy = 0;
    for (let y = 0; y < B.h; y++) for (let x = 0; x < B.w; x++) {
      const g = ghostAt(st, B, x, y);
      if (!g) continue;
      if (g.ok) near = Math.min(near, x, y, B.w - 1 - x, B.h - 1 - y);
      else if (g.why === VIEW_EDGE_WHY) edgeWhy++;
    }
    check(near === VIEW_EDGE, `things go up to ${VIEW_EDGE} cells from the edge, no nearer (${near})`);
    check(edgeWhy > 0 && !!ghostAt(st, B, 1, B.h >> 1) && ghostAt(st, B, 1, B.h >> 1).why === VIEW_EDGE_WHY, "nearer the edge it is refused, and says why");
    check(B.cells[(VIEW_EDGE - 1) * B.w + (B.w >> 1)].nb && !B.cells[VIEW_EDGE * B.w + (B.w >> 1)].nb, "the edge's cells are tinted, the next row in is not");
    check(layoutAct(st, B, { type: "build", x: 1, y: B.h >> 1 }) === VIEW_EDGE_WHY, "a click there builds nothing");
    delete st.combat;
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
