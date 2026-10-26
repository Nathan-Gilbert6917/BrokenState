// The city crawl tests' shared setup (tools/citycrawltest.js and the parts split from it, issue #74: citycrawlgridtest.js,
// citycrawlquicktest.js, citycrawlquick2test.js): a world with a city, a team launched onto it, a crawl started there
// (deep enough for a level), walking out of a building's battle, a test place on the team's block, and the quick
// search's parity with the laid-out building (10e), kind by kind. Not named *test*, so runtests.js never runs it.
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
import { autoPlayerTurn, runEnemyPhase, finishCombat, combatAct, boxFinds, boxLoot, FLOOR_RICH } from "../src/sim/combat.js";
import * as CC from "../src/sim/citycrawl.js";
import { BUILDINGS } from "../src/sim/buildingmaps.js";
import { raidLootShare } from "../src/sim/battlesize.js";
import { campusLootShare } from "../src/sim/campus.js";

export function world(seed) {
  const state = createWorld({ seed, factionCount: 7 });
  const h = hub(state);
  const city = state.tiles.find((t) => t.loc && t.loc.type === "city");
  return { state, h, city };
}
export function team(state, h, tile, n = 3, supplies = { food: 6, water: 6, ammo: 60, meds: 3 }) {
  const crew = atBase(state, h.id).slice(0, n).map((x) => x.id);
  for (const k of ["food", "water", "ammo", "meds"]) h.stock[k] = Math.max(h.stock[k] || 0, 200);
  let res = launchExpedition(state, { memberIds: crew, dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies });
  if (res.error) res = launchExpedition(state, { memberIds: crew, dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2, ammo: 10 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  const p = res.party;
  p.path = [tile.id]; p.idx = 0; p.dest = tile.id; p.phase = "engaged";
  return p;
}
export function crawlIn(seed, reuse = null) {
  const { state, h, city } = reuse ? { state: reuse, h: hub(reuse), city: reuse.tiles.find((t) => t.loc && t.loc.type === "city") } : world(seed);
  const p = team(state, h, city);
  CC.startCrawl(state, p);
  return { state, h, city, p, c: p.crawl };
}
// A crawl in a city big enough to reach `level` (the grid's size is the city's own).
export function deepCrawl(seed0, level) {
  for (let s = seed0; s < seed0 + 200; s++) { const w = crawlIn(s); if (CC.jumpToLevel(w.state, w.c, level)) { CC.jumpToLevel(w.state, w.c, 1); w.c.cell = w.c.entry; w.c.path = [w.c.entry]; w.c.block = 1; return w; } }
  throw new Error(`no city reaching level ${level}`);
}
// Everyone in an extraction zone walks out (the team starts in the front zone).
export function walkOut(state) {
  const b = state.combat;
  for (const u of b.units.filter((x) => x.side === "player" && !x.dead && !x.left)) {
    if (u.ap <= 0) u.ap = 2;
    combatAct(state, { type: "extract", unit: u.id });
  }
  return b;
}
export function playOut(state, guard = 250) {
  const b = state.combat;
  let g = 0;
  while (!b.over && g++ < guard) { autoPlayerTurn(state); runEnemyPhase(state); }
  return b;
}

// ---------- 10. parity with the raid tickets (issue #21) ----------
export const QN = process.env.BS_QUICK ? 30 : 200; // buildings a kind for the quick search's parity (the ticket: 200 seeds)
// A place of this kind on the team's block (its slot: a building of its own), what it holds forced.
export function testPlace(state, c, key, slot, o = {}) {
  const pl = { id: `t21-${key}-${slot}`, slot, key, name: `${BUILDINGS[key].name} on Test Street`, kind: BUILDINGS[key].name, dead: 1, rich: 1, raiders: false, looted: 0, blocked: null, quick: false, known: false, folk: { survivors: false, raidersUp: false, nest: false }, ...o };
  CC.blockOf(c).places = [pl];
  return pl;
}
export const cellsOfF = (b, f) => (b.floors ? b.floors[f].cells : b.cells);
export const allCells = (b) => JSON.stringify((b.floors ? b.floors.map((F) => F.cells) : [b.cells]));
export const outAndBack = (state, p, c, pl) => { const b = state.combat; walkOut(state); finishCombat(state, b.setup, b.result); CC.enterPlace(state, p, pl.id, { map: true }); return state.combat; };
// The quick search's parity (10e): for each of these kinds, QN buildings, every container opened both ways (the quick
// search's QUICK.rolls lifted, the laid-out building's own containers), the supplies a container finds; { bad: the kinds
// off by more than 10%, worst }. The team's scavenging is set to 3 first.
export function quickParity(state, p, c, kinds) {
  for (const s of partyMembers(state, p)) s.skills.scavenging = 3;
  const rolls = CC.CRAWL.QUICK.rolls, per = CC.CRAWL.QUICK.rollsPerBlock;
  const bad = [], REPS = 5; // each building's containers rolled REPS times both ways (the dice's spread, not the buildings')
  let worst = 0;
  for (const key of kinds) {
    let mapSup = 0, quickSup = 0, mapBoxes = 0, quickBoxes = 0;
    for (let i = 0; i < QN; i++) {
      const pl = testPlace(state, c, key, 1000 + i);
      CC.CRAWL.QUICK.rolls = 9999; CC.CRAWL.QUICK.rollsPerBlock = 0;
      for (let k = 0; k < REPS; k++) { const q = CC.quickLoot(state, p, c, pl); quickSup += Object.values(q.sup).reduce((x, v) => x + v, 0); quickBoxes += q.opened; }
      CC.CRAWL.QUICK.rolls = rolls; CC.CRAWL.QUICK.rollsPerBlock = per;
      if (i % (process.env.BS_QUICK ? 1 : 2)) continue; // the map side on every one (a full run: every other one; a battle each), the same buildings
      // The laid-out building: its battle's own containers, each rolled with the battle's numbers as searchBox does
      // (combat.js boxFinds: the table's loot; the extras searchBox rolls on dice of their own are the map's alone).
      CC.enterPlace(state, p, pl.id, { map: true });
      const b = state.combat, R = b.raid, site = state.tiles[b.tileId].loc.type;
      // As searchBox: a building at real size by its plan's map (R.natMap, issue #24); a civic site's container by its own
      // building's (campusLootShare, issue #49); a civic plan at real scale × its containers' worth (box.lootK, issue #49).
      const rewardOf = (box) => (R.reward ?? 1) * (R.big ? (R.plan && (R.plan.campus || R.plan.civicSite) ? campusLootShare(b, box) : R.natMap ? raidLootShare(R.natMap[0], R.natMap[1]) : raidLootShare(b.w, b.h)) : 1);
      for (let k = 0; k < REPS; k++) for (const box of R.containers.filter((x) => x.kind !== "body" && x.kind !== "ground" && !x.stash)) {
        const type = R.areas[box.area].type;
        const got = boxFinds(state, state.rng, { def: boxLoot(type, box.kind), type, rich: R.richness * Math.min(FLOOR_RICH.cap, Math.pow(FLOOR_RICH.perFloor, box.f || 0)) * (box.rich || 1) * (box.lootK || 1), scav: 3, reward: rewardOf(box), site, gunSite: b.setup.raid.gunSite, deep: R.deep, tileId: b.tileId, bid: box.id });
        mapSup += Object.values(got.sup).reduce((x, v) => x + v, 0); mapBoxes++;
      }
      state.combat = null; c.inside = null;
    }
    const a = mapSup / Math.max(1, mapBoxes), q = quickSup / Math.max(1, quickBoxes);
    const off = Math.abs(q - a) / Math.max(1e-9, a);
    worst = Math.max(worst, off);
    if (off > 0.1) bad.push(`${key} ${a.toFixed(2)}/${q.toFixed(2)}`);
  }
  return { bad, worst };
}
