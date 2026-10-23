// The land runs on past a base map's edge (the user's request 2026-10-23: "The outer margin of the base should not just
// terminate a terrain it should continue the terrain so it does not just terminate at the border"): sim/basescatter.js
// layLand lays the heights on the map's outer row too (pieces still never there), landBeyond lists the land past the
// edge, and sim/basemap.js buildBaseMap keeps it on the base map (F.beyond) for ui/isoview.js to draw.
// Usage: node tools/landbeyondtest.js [seed]
import { createWorld, tickHour, hub, atBase, day } from "../src/sim/world.js";
import { launchExpedition, giveOrder, planPath } from "../src/sim/parties.js";
import { openBaseMap, landFor, gridBox } from "../src/sim/basemap.js";
import { layLand, landBeyond, BEYOND_R } from "../src/sim/basescatter.js";
import { isSettlementTile } from "../src/sim/startpick.js";
import { poiKnowledge } from "../src/sim/pois.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);

section("layLand: the heights go on the outer row, the pieces do not");
{
  const W = 10, H = 10, cells = Array.from({ length: W * H }, () => ({ k: "open" }));
  const tree = { k: "tree", g: "t", cells: [[0, 3]] };
  const land = { heights: new Map([["0,5", 2], ["9,9", -1], ["4,4", 1]]), floors: new Map(), pieces: new Map([["0,3", tree]]), list: [tree] };
  layLand({ cells, W, H, ox: 0, oy: 0, land, ok: () => true, floor: () => true });
  check(cells[5 * W].h === 2 && cells[5 * W].ter === 1, "a hill on the west edge keeps its height there");
  check(cells[9 * W + 9].h === -1, "a hollow in the corner too");
  check(cells[4 * W + 4].h === 1, "and inside, as before");
  check(cells[3 * W].k === "open", "no tree on the outer row (the attackers' open ring)");
}

section("landBeyond: what lies past the edge, within R, on the tile's map");
{
  const tree = { k: "tree", g: "t", cells: [[12, 3]] }, wreck = { k: "wreck", g: "w", cells: [[-2, 2]] }, crag = { k: "crag", g: "c", h: 4, cells: [[3, -3]] };
  const land = { heights: new Map([["-1,5", 2], ["-9,5", 1], ["5,5", 3]]), floors: new Map([["4,12", "road"]]), pieces: new Map([["12,3", tree], ["-2,2", wreck], ["3,-3", crag]]), list: [tree, wreck, crag] };
  const out = landBeyond(land, 10, 10, 0, 0, 6, (gx, gy) => gx >= -8 && gy >= -8 && gx < 18 && gy < 18);
  const at = (x, y) => out.find((e) => e[0] === x && e[1] === y);
  check(at(-1, 5) && at(-1, 5)[4] === 2, "a hill just past the west edge, with its height");
  check(!at(-9, 5), "nothing further out than R");
  check(!at(5, 5), "nothing on the map itself");
  check(at(12, 3) && at(12, 3)[2] === "tree", "a tree past the east edge");
  check(!at(-2, 2), "a wreck is not carried past the edge (several cells, a car)");
  check(at(3, -3) && at(3, -3)[2] === "crag" && at(3, -3)[5] === 4, "the crag, with its height");
  check(at(4, 12) && at(4, 12)[3] === "road", "a road's floor");
  check(out.every(([x, y]) => x < 0 || y < 0 || x >= 10 || y >= 10), "every cell is off the map");
}

section("A camp's map keeps the land past its edge (F.beyond)");
{
  const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.noNewGangs = true; st.erasOff = true; st.noWanderers = true;
  const free = (t) => st.tiles[t].terrain !== "water" && st.tiles[t].terrain !== "mountain" && !isSettlementTile(st.tiles[t]) && st.tiles[t].owner == null && !st.factions.some((f) => f.bases.includes(t)) && !st.bases.some((b) => b.tile === t) && !st.hordes.some((h) => h.tile === t);
  const h = hub(st);
  const tile = st.grid.within(h.tile, 6).find((t) => st.grid.distance(t, h.tile) >= 3 && free(t) && planPath(st, h.tile, t, false));
  poiKnowledge(st, tile, true).surveyed = day(st);
  const res = launchExpedition(st, { memberIds: atBase(st, h.id).slice(0, 2).map((s) => s.id), dest: tile, mission: "camp", stance: "normal", supplies: { food: 6, water: 6 } });
  res.party.path = [tile]; res.party.idx = 0; giveOrder(st, res.party, "camp");
  for (let i = 0; i < 40 && !st.bases.some((b) => b.tile === tile); i++) tickHour(st);
  const b = st.bases.find((x) => x.tile === tile);
  if (check(!!b, "the camp stands")) {
    openBaseMap(st, b.id);
    const B = st.combat, F = B.deployPlan.fort, BY = F.beyond;
    check(!!BY && BY.R === BEYOND_R && BY.cells.length > 0, `the land past the edge is kept (${BY && BY.cells.length} cells)`);
    const land = landFor(st, b), GB = gridBox(b);
    const bad = (BY ? BY.cells : []).filter(([x, y, k, , hh]) => {
      const gx = x - F.ox, gy = y - F.oy, key = `${gx},${gy}`;
      const inside = x >= 0 && y >= 0 && x < B.w && y < B.h, far = x < -BEYOND_R || y < -BEYOND_R || x >= B.w + BEYOND_R || y >= B.h + BEYOND_R;
      const offGrid = gx < GB.x0 || gy < GB.y0 || gx >= GB.x1 || gy >= GB.y1;
      return inside || far || offGrid || (hh || 0) !== (land.heights.get(key) || 0) || (k !== "open" && (!land.pieces.get(key) || land.pieces.get(key).k !== k));
    });
    check(!bad.length, `each is off the map, within ${BEYOND_R}, on the tile's map, the land's own height and piece (${bad.length} not)`);
    let rim = 0, rimOk = 0;
    for (let x = 0; x < B.w; x++) for (const y of [0, B.h - 1]) { const hh = land.heights.get(`${x - F.ox},${y - F.oy}`) || 0, c = B.cells[y * B.w + x]; if (hh && c.k === "open") { rim++; if (c.ter && c.h) rimOk++; } }
    check(rimOk === rim, `the land's heights on the top and bottom rows are laid (${rimOk} of ${rim}; the steps a level apart may lower some)`);
    delete st.combat;
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
