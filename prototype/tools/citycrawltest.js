// City crawl test (src/sim/citycrawl.js): entering on a city tile, block cards with places and events, the same city
// and block giving the same places, a place's interior and back out to the block, going back in to the building as it
// was left, danger and loot rising with depth, the four ways from every block, picking the start on the rim, walking out
// (only on the rim; a breakout at a high Alert), time passing, saving and loading mid-crawl (an old save on its way
// out too), the autopilot's crawl to the rim and out, and the normal flow everywhere else unchanged.
// Usage: node tools/citycrawltest.js [seeds=6] [stats]   (stats: also play map raids with the bot block by block)
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, partyMembers, giveOrder } from "../src/sim/parties.js";
import { startScavenge } from "../src/sim/scavenge.js";
import { autoPlayerTurn, runEnemyPhase, finishCombat, combatAct } from "../src/sim/combat.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import * as CC from "../src/sim/citycrawl.js";
import { isEdge, headingToward, rimOf, cellsOf, xyOf, keyOf } from "../src/sim/citygrid.js";
import { newItem, stow, ensureInv } from "../src/sim/inventory.js";
import { BUILDINGS, buildingMap } from "../src/sim/buildingmaps.js";
import { setFloor, boxFinds, boxLoot, FLOOR_RICH } from "../src/sim/combat.js";
import { raidLootShare } from "../src/sim/battlesize.js";
import { liftDef, setTargets } from "../src/sim/furnicarry.js";
import { sceneBias, SCENES } from "../src/sim/interiorscenes.js";
import { boardCell } from "../src/sim/barricade.js";
import { createVehicle } from "../src/sim/vehicles.js";
import { readFileSync } from "node:fs";

const SEEDS = Number(process.argv[2] || 6);
const STATS = process.argv.includes("stats");
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) { passed++; console.log(`  ok: ${msg}`); } else { failed++; console.log(`  FAIL: ${msg}`); } };
const ok = (msg) => console.log(`  ok: ${msg}`);
const t0 = performance.now();

function world(seed) {
  const state = createWorld({ seed, factionCount: 7 });
  const h = hub(state);
  const city = state.tiles.find((t) => t.loc && t.loc.type === "city");
  return { state, h, city };
}
function team(state, h, tile, n = 3, supplies = { food: 6, water: 6, ammo: 60, meds: 3 }) {
  const crew = atBase(state, h.id).slice(0, n).map((x) => x.id);
  for (const k of ["food", "water", "ammo", "meds"]) h.stock[k] = Math.max(h.stock[k] || 0, 200);
  let res = launchExpedition(state, { memberIds: crew, dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies });
  if (res.error) res = launchExpedition(state, { memberIds: crew, dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2, ammo: 10 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  const p = res.party;
  p.path = [tile.id]; p.idx = 0; p.dest = tile.id; p.phase = "engaged";
  return p;
}
function crawlIn(seed, reuse = null) {
  const { state, h, city } = reuse ? { state: reuse, h: hub(reuse), city: reuse.tiles.find((t) => t.loc && t.loc.type === "city") } : world(seed);
  const p = team(state, h, city);
  CC.startCrawl(state, p);
  return { state, h, city, p, c: p.crawl };
}
// A crawl in a city big enough to reach `level` (the grid's size is the city's own).
function deepCrawl(seed0, level) {
  for (let s = seed0; s < seed0 + 200; s++) { const w = crawlIn(s); if (CC.jumpToLevel(w.state, w.c, level)) { CC.jumpToLevel(w.state, w.c, 1); w.c.cell = w.c.entry; w.c.path = [w.c.entry]; w.c.block = 1; return w; } }
  throw new Error(`no city reaching level ${level}`);
}
// Everyone in an extraction zone walks out (the team starts in the front zone).
function walkOut(state) {
  const b = state.combat;
  for (const u of b.units.filter((x) => x.side === "player" && !x.dead && !x.left)) {
    if (u.ap <= 0) u.ap = 2;
    combatAct(state, { type: "extract", unit: u.id });
  }
  return b;
}
function playOut(state, guard = 250) {
  const b = state.combat;
  let g = 0;
  while (!b.over && g++ < guard) { autoPlayerTurn(state); runEnemyPhase(state); }
  return b;
}

// ---------- 1. entering ----------
console.log("Entering a city");
{
  const { state, h, city } = world(3);
  // The browser and a team you drive: the crawl (scavenge.js startScavenge).
  globalThis.window = {};
  try {
    const p = team(state, h, city);
    p.dest = city.id;
    startScavenge(state, p);
    check(!!p.crawl && !state.combat && !state.engagement, "a team you drive that reaches a city to scavenge starts a crawl (no raid, no hour-by-hour search)");
    check(p.crawl && p.crawl.choosing && p.crawl.cell == null && p.phase === "engaged", "the crawl opens choosing where to go in (no block yet) and holds the team");
    check(CC.activeCrawl(state) === p, "the crawl window shows it");
    const rim0 = rimOf(p.crawl.grid)[0];
    check(CC.pickStart(state, p, keyOf(rim0[0], rim0[1])) === "" && p.crawl.block === 1 && !p.crawl.choosing, "picking a rim block starts it there, at level 1");
    // A town keeps the normal raid.
    const town = state.tiles.find((t) => t.loc && t.loc.type === "town");
    const q = team(state, h, town, 1);
    startScavenge(state, q);
    check(!!q.crawl && q.crawl.grid.size <= 12, `a town is crawled too, on a smaller grid (${q.crawl && q.crawl.grid.size} blocks across)`);
    state.combat = null;
    // The autopilot (autoCombat): the hour-by-hour search, no crawl.
    const r = team(state, h, city, 1);
    state.autoCombat = true;
    state.engagement = null;
    startScavenge(state, r);
    check(!r.crawl && !!state.engagement, "with battles by the numbers (autoCombat) a city is searched hour by hour as before");
    // The autopilot itself crawls (2026-10-13): block by block, stepped every hour by its governor.
    {
      const w2 = world(31);
      const r2 = team(w2.state, w2.h, w2.city, 1);
      w2.state.autopilot = true;
      startScavenge(w2.state, r2);
      check(!!r2.crawl && r2.crawl.block === 1 && !r2.crawl.choosing && CC.onEdge(r2.crawl), "on autopilot a team that scavenges a city crawls it, from a rim block of its own");
      const town2 = w2.state.tiles.find((t) => t.loc && t.loc.type === "town");
      const r3 = team(w2.state, w2.h, town2, 1);
      w2.state.autoCombat = true; // as autopilot.js sets it
      w2.state.engagement = null;
      startScavenge(w2.state, r3);
      check(!r3.crawl, "on autopilot a town is searched hour by hour (crawling towns thinned the bases)");
    }
    state.autoCombat = false;
    state.engagement = null;
  } finally { delete globalThis.window; }
  // Headless: the hour-by-hour search as before.
  const p2 = team(state, h, city, 1);
  startScavenge(state, p2);
  check(!p2.crawl && !!state.engagement, "headless (tools) a city is searched hour by hour as before");
  check(CC.crawlTile(state.tiles.find((t) => t.loc && t.loc.type === "town")) && CC.crawlTile(city) && !CC.crawlTile(state.tiles.find((t) => t.loc && t.loc.type === "farm")), "cities and towns are crawled, other sites not");
}

// ---------- 1b. moved onto a city: the City crawl card ----------
console.log("Moved onto a city: the City crawl card");
{
  const { state, h, city } = world(3);
  const town = state.tiles.find((t) => t.loc && t.loc.type === "town");
  // A team standing on the tile that is given a Move order there arrives as a move does (parties.js arrive).
  const moveOnto = (tile, n = 1) => { const p = team(state, h, tile, n); p.phase = "waiting"; state.cards.length = 0; giveOrder(state, p, "move"); return p; };
  const cardOf = (p) => state.cards.find((c) => c.partyId === p.id);
  const pick = (card, label) => { state.cards.splice(state.cards.indexOf(card), 1); return card.choices.find((c) => c.label === label).resolve(state); };
  globalThis.window = {};
  try {
    const p = moveOnto(city, 2);
    const card = cardOf(p);
    check(card && card.title.startsWith("City crawl: ") && card.isOrders, `a team you move onto a city asks to go in ("${card && card.title}")`);
    check(state.cards.filter((c) => c.partyId === p.id).length === 1, "the City crawl card takes the place of the orders card (one card for the team)");
    check(card && /block by block/.test(card.text) && /Alert now: \w+ \(\d+\)/.test(card.text), "the card says what a crawl is and the city's Alert");
    check(card && card.choices.map((c) => c.label).join(" | ") === "Go in block by block | Not now", "two choices: Go in block by block, Not now");
    const res = pick(card, "Go in block by block");
    check(!!p.crawl && p.crawl.choosing && p.phase === "engaged" && res === "", "Go in block by block opens the crawl on the city's map to pick where to go in (no result box over the crawl window)");
    check(CC.activeCrawl(state) === p, "the crawl window shows it");
    // Not now: the team's usual orders card comes back, Scavenge on it still crawls.
    const q = moveOnto(city, 1);
    pick(cardOf(q), "Not now");
    const oc = cardOf(q);
    check(oc && oc.isOrders && !oc.title.startsWith("City crawl") && state.cards[0] === oc, `Not now brings back the orders card, first in line ("${oc && oc.title}")`);
    check(!q.crawl && q.phase === "waiting", "Not now leaves the team waiting on the tile");
    // Not a city, a queued order, the autopilot: no City crawl card. A plain move that got there pops no card at all
    // since orders reach a team anywhere (TEAM-01, parties.js quietArrival): a log line, the team waiting for orders.
    const waitsQuietly = (st, q) => !st.cards.some((c) => c.partyId === q.id) && q.phase === "waiting" && / reached .* and waits for orders\.$/.test(st.log[0].text); // the newest line
    const r = moveOnto(town, 1);
    const rc = state.cards.find((x) => x.partyId === r.id);
    check(rc && rc.title.startsWith("City crawl"), "a town offers the crawl too");
    const s1 = team(state, h, city, 1); s1.phase = "waiting"; state.cards.length = 0;
    s1.orders = [{ type: "camp", hours: 8 }];
    giveOrder(state, s1, "move");
    check(!cardOf(s1) && s1.phase === "task", "queued orders carry on at the city: no card");
    state.autoCombat = true;
    const u = moveOnto(city, 1);
    check(waitsQuietly(state, u), "with battles resolved by the numbers (the autopilot) no crawl card: waits as after any move");
    state.autoCombat = false;
  } finally { delete globalThis.window; }
  const w2 = world(4);
  const v = team(w2.state, w2.h, w2.city, 1); v.phase = "waiting"; w2.state.cards.length = 0;
  giveOrder(w2.state, v, "move");
  const vc = w2.state.cards.find((c) => c.partyId === v.id);
  check(!vc && v.phase === "waiting" && / reached .* and waits for orders\.$/.test(w2.state.log[0].text), "headless (tools) no crawl card: waits as after any move");
}

// ---------- 2. block cards ----------
console.log("Block cards");
{
  let places = 0, events = 0, blocks = 0, bad = 0, eventKeys = new Set(), sameOk = 0, sameN = 0, visitDiff = 0;
  for (let s = 0; s < SEEDS; s++) {
    const { state, c } = crawlIn(100 + s);
    for (let n = 1; n <= 6; n++) {
      const blk = CC.genBlock(state, c, n);
      blocks++;
      places += blk.places.length;
      events += blk.events.length;
      if (blk.places.length < 2 || blk.places.length > 4 || blk.events.length > 2) bad++;
      for (const e of blk.events) eventKeys.add(e.key);
      if (blk.places.some((pl) => !pl.name || !pl.key)) bad++;
      // The same city and block: the same places (a fresh crawl of the same visit number).
      const c2 = { ...c, blocks: {}, visit: c.visit };
      const b2 = CC.genBlock(state, c2, n);
      sameN++;
      if (JSON.stringify(b2.places.map((x) => [x.key, x.name])) === JSON.stringify(blk.places.map((x) => [x.key, x.name])) && JSON.stringify(b2.events.map((x) => x.key)) === JSON.stringify(blk.events.map((x) => x.key))) sameOk++;
      // Another visit: the same buildings, other events (sometimes).
      const c3 = { ...c, blocks: {}, visit: c.visit + 1 };
      const b3 = CC.genBlock(state, c3, n);
      if (JSON.stringify(b3.places.map((x) => x.key)) !== JSON.stringify(blk.places.map((x) => x.key))) bad++;
      if (JSON.stringify(b3.events.map((x) => x.key)) !== JSON.stringify(blk.events.map((x) => x.key))) visitDiff++;
    }
  }
  check(!bad, `every block has 2–4 named places and at most 2 events (${bad} bad)`);
  check(sameOk === sameN, `the same city and block give the same places and events (${sameOk}/${sameN})`);
  check(visitDiff > 0, `a later visit has the same buildings but other street events (${visitDiff} of ${blocks} blocks differ)`);
  check(eventKeys.size >= 6, `street events vary (${[...eventKeys].join(", ")})`);
  ok(`${blocks} blocks: ${(places / blocks).toFixed(1)} places and ${(events / blocks).toFixed(1)} events a block`);
  const { state, p, c } = crawlIn(5);
  const blk = CC.blockOf(c);
  const looks = blk.places.map((pl) => CC.placeLooks(state, p, c, pl));
  check(looks.every((l) => l.level >= 1 && l.level <= 5 && l.text), "each place shows how dangerous it looks");
}

// ---------- 3. a place's interior and back ----------
console.log("Into a place and back out");
{
  let tried = 0, back = 0, restored = 0;
  for (let s = 0; s < SEEDS; s++) {
    const { state, p, c } = crawlIn(200 + s);
    const pl = CC.blockOf(c).places.find((x) => !x.blocked);
    const err = CC.enterPlace(state, p, pl.id, { map: true });
    const b = state.combat;
    if (err || !b) { check(false, `entering ${pl.name}: ${err}`); continue; }
    tried++;
    check(b.raid.interior && b.raid.interior.key === pl.key && c.inside === pl.id, `entering ${pl.kind} opens its interior map`);
    check(b.setup.handler === "crawl" && !CC.activeCrawl(state), "the crawl window waits while the building is raided");
    // Change the building: a container searched, a door opened, one of the dead killed, one moved.
    const box = b.raid.containers.find((x) => !x.searched);
    if (box) box.searched = true;
    const di = b.cells.findIndex((x) => x.k === "idoor");
    if (di >= 0) b.cells[di].k = "odoor";
    const foes = b.units.filter((u) => u.side === "enemy" && !u.dead);
    const killed = foes[0], moved = foes[1];
    if (killed) killed.dead = true;
    let movedTo = null;
    if (moved) {
      for (let i = 0; i < b.w * b.h && !movedTo; i++) {
        const x = i % b.w, y = (i / b.w) | 0;
        if (b.reach[i] && b.cells[i].k === "open" && !b.units.some((u) => u.x === x && u.y === y) && Math.abs(x - moved.x) + Math.abs(y - moved.y) > 4) movedTo = [x, y];
      }
      if (movedTo) { moved.x = movedTo[0]; moved.y = movedTo[1]; }
    }
    const hour = state.hour;
    walkOut(state);
    check(b.over && b.result.outcome === "extracted", "the team walks out of the front");
    finishCombat(state, b.setup, b.result);
    check(p.crawl && !c.inside && c.block === 1 && CC.activeCrawl(state) === p, "extracting returns to the same block card");
    check(state.hour > hour, "the raid took time on the shared clock");
    if (c.buildings[pl.id]) back++;
    // Go back in.
    CC.enterPlace(state, p, pl.id, { map: true });
    const b2 = state.combat;
    const ok1 = !box || b2.raid.containers.some((x) => x.x === box.x && x.y === box.y && x.searched);
    const ok2 = di < 0 || b2.cells[di].k === "odoor";
    const ok3 = !killed || b2.units.some((u) => u.dead && u.x === killed.x && u.y === killed.y);
    const ok4 = !movedTo || b2.units.some((u) => u.side === "enemy" && !u.dead && u.x === movedTo[0] && u.y === movedTo[1]);
    const ok5 = b2.units.filter((u) => u.side === "enemy" && !u.dead).length === foes.length - (killed ? 1 : 0);
    if (ok1 && ok2 && ok3 && ok4 && ok5) restored++;
    else console.log(`    seed ${200 + s}: searched ${ok1} door ${ok2} body ${ok3} moved ${ok4} count ${ok5}`);
    walkOut(state);
    finishCombat(state, b2.setup, b2.result);
  }
  check(tried > 0 && back === tried, `the building is kept for the crawl (${back}/${tried})`);
  check(restored === tried, `going back in restores it: searched stays searched, doors open, the dead dead, the lured where they went (${restored}/${tried})`);
}

// ---------- 4. danger and loot with depth ----------
console.log("Depth: danger and rewards");
{
  const { state, p, c } = crawlIn(7);
  const pl = { ...CC.blockOf(c).places[0], raiders: false, looted: 0 };
  const dead = [], rich = [], sp = [];
  for (let n = 1; n <= 7; n++) { dead.push(CC.placeDanger(state, c, pl, n).dead); rich.push(CC.placeRichness(state, c, pl, n)); sp.push(CC.specialChance(state, n)); }
  check(dead.every((v, i) => !i || v > dead[i - 1]), `more of the dead deeper (${dead.map((v) => v.toFixed(1)).join(" → ")})`);
  check(rich.every((v, i) => !i || v >= rich[i - 1]) && rich[4] > rich[0], `richer containers deeper (${rich.map((v) => v.toFixed(2)).join(" → ")})`);
  check(sp[0] === 0 && sp[1] === 0 && sp[2] > 0 && sp[5] > sp[2], `the special dead from block ${CC.CRAWL.SPECIAL.from}, more deeper (${sp.map((v) => v.toFixed(2)).join(" → ")})`);
  check(CC.moveRisk(state, c, 5) > CC.moveRisk(state, c, 2), "trouble between blocks is likelier deeper");
  // Rare places (gun store, police, hospital) more often deeper; raiders holed up only deeper.
  let rare1 = 0, rare5 = 0, raid1 = 0, raid5 = 0, n1 = 0, n5 = 0;
  for (let s = 0; s < 40; s++) {
    const { state: st, c: cc } = crawlIn(300 + s);
    for (const pl2 of CC.blockOf(cc).places) { n1++; if (pl2.rare) rare1++; if (pl2.raiders) raid1++; }
    if (!CC.jumpToLevel(st, cc, 5)) continue; // a city too small to have a level-5 heart
    for (const pl2 of CC.blockOf(cc).places) { n5++; if (pl2.rare) rare5++; if (pl2.raiders) raid5++; }
  }
  check(rare5 / n5 > rare1 / n1 + 0.05, `rare places deeper (block 1 ${(rare1 / n1 * 100).toFixed(0)}%, block 5 ${(rare5 / n5 * 100).toFixed(0)}%)`);
  check(raid1 === 0 && raid5 > 0, `raiders holed up only deeper (block 1 ${raid1}, block 5 ${raid5} of ${n5})`);
  // The same building at block 1 and at block 5: more enemies on its map.
  let e1 = 0, e5 = 0, k = 0;
  for (let s = 0; s < SEEDS; s++) {
    const w = crawlIn(400 + s);
    const place = CC.blockOf(w.c).places[0];
    place.blocked = null;
    if (!CC.jumpToLevel(w.state, w.c, 5)) continue;
    const deep = w.c.cell, edge = w.c.entry;
    for (const n of [1, 5]) {
      w.c.cell = n === 1 ? edge : deep; w.c.block = n;
      w.c.blocks[w.c.cell] = { ...CC.genBlock(w.state, w.c, w.c.cell), places: [place] };
      CC.enterPlace(w.state, w.p, place.id, { map: true });
      const b = w.state.combat;
      const en = b.units.filter((u) => u.side === "enemy").length;
      if (n === 1) e1 += en; else e5 += en;
      w.state.combat = null;
      w.c.inside = null;
    }
    k++;
  }
  check(k > 0 && e5 > e1, `the same building holds more enemies at level 5 than at level 1 (${(e1 / k).toFixed(1)} → ${(e5 / k).toFixed(1)})`);
}

// ---------- 5. moving, time, leaving ----------
console.log("Moving and leaving");
{
  const { state, p, c } = crawlIn(9);
  const h0 = state.hour;
  let guard = 0;
  while (c.block < 2 && guard++ < 10) {
    const r = CC.nextBlock(state, p);
    if (c.enc) CC.resolveEncounter(state, p, "run", {});
    if (!p.crawl) break;
    void r;
  }
  check(state.hour > h0, `moving between blocks takes time (${state.hour - h0} h)`);
  check(!p.crawl || c.block >= 1, "the team is on a block");
  // No way out is walked for you (2026-10-13): no back / straight-line way out, no list of blocks to walk.
  check(CC.leaveCity === undefined && CC.exitRisk === undefined && CC.continueLeaving === undefined && CC.CRAWL.EXIT === undefined && CC.CRAWL.SIDE === undefined, "no one-click way out: leaveCity, exitRisk, continueLeaving, CRAWL.EXIT and the shut side streets are gone");
  const w = crawlIn(10);
  check(CC.onEdge(w.c) && !("leaving" in w.c), "a crawl starts on the rim, with no way out under way");
  // The trouble of a block walked: deeper, the heat you left there, the load, the night.
  const big = deepCrawl(1000, 6);
  CC.jumpToLevel(big.state, big.c, 4);
  const at4 = big.c.path[big.c.path.length - 2];
  const r4 = CC.moveRisk(big.state, big.c, big.c.cell, 1);
  CC.jumpToLevel(big.state, big.c, 6);
  const r6 = CC.moveRisk(big.state, big.c, big.c.cell, 1);
  check(r6 > r4, `a block deeper is riskier to walk (level 4 ${(r4 * 100).toFixed(1)}%, level 6 ${(r6 * 100).toFixed(1)}%)`);
  const cool = CC.moveRisk(big.state, big.c, at4, 1);
  big.c.trail[at4] = 60;
  const hot = CC.moveRisk(big.state, big.c, at4, 1);
  check(hot > cool, `walking back through the heat you left there is riskier (${(cool * 100).toFixed(1)}% → ${(hot * 100).toFixed(1)}%)`);
  big.p.cargo.supplies.water = (big.p.cargo.supplies.water || 0) + 400; // overloaded
  const heavy = CC.moveRisk(big.state, big.c, at4, 1);
  check(CC.crawlLoad(big.state, big.p).over > 0 && heavy > hot, `and loaded over what you can carry (${(heavy * 100).toFixed(1)}%)`);
  big.p.cargo.supplies.water -= 400;
  // Played by the numbers: from level 4 the autopilot walks block by block to the rim and out, meeting trouble on the way.
  let trouble = 0, out4 = 0, tried = 0, rimFirst = 0;
  for (let s = 0; s < 30; s++) {
    const z = crawlIn(600 + s);
    if (!CC.jumpToLevel(z.state, z.c, 4)) continue;
    tried++;
    z.c.goingOut = true;
    let g = 0, steps = 0, onRim = false;
    while (z.p.crawl && g++ < 60) {
      if (z.c.enc) trouble += z.c.enc.move ? 1 : 0;
      const cell0 = z.c.cell;
      if (CC.onEdge(z.c)) onRim = true;
      CC.crawlAutoStep(z.state, z.p);
      if (z.p.crawl && z.c.cell !== cell0) steps++;
    }
    if (onRim) rimFirst++;
    if (z.state.parties.includes(z.p) && partyMembers(z.state, z.p).length && !z.p.crawl) out4++;
  }
  check(tried > 10 && rimFirst === tried, `the autopilot heading out walks to the rim before it is out (${rimFirst}/${tried})`);
  check(trouble >= 3, `walking out from level 4 meets trouble on the way (${trouble} encounters in ${tried} crawls); ${out4}/${tried} got out`);
  check(out4 >= tried * 0.7, `the autopilot gets out on its own from level 4 (${out4}/${tried})`);
}

// ---------- 6. encounters and events ----------
console.log("Encounters and street events");
{
  let errs = 0, n = 0;
  for (const choice of ["numbers", "hide", "lure", "run", "fight"]) {
    for (let s = 0; s < 4; s++) {
      const w = crawlIn(700 + s);
      if (choice === "lure") for (const m of partyMembers(w.state, w.p)) stow(m, newItem("noisemaker"));
      CC.jumpToLevel(w.state, w.c, 3);
      CC.nextBlock(w.state, w.p);
      let g = 0;
      while (w.p.crawl && !w.c.enc && g++ < 8) CC.nextBlock(w.state, w.p);
      if (!w.p.crawl || !w.c.enc) continue;
      n++;
      try {
        const opts = CC.encounterOptions(w.state, w.p);
        if (!opts.some((o) => o.id === choice)) continue;
        CC.resolveEncounter(w.state, w.p, choice, {});
        if (w.p.crawl && w.c.enc && !w.c.enc.spotted && !w.c.enc.fighting) errs++;
      } catch (e) { errs++; console.log(`    ${choice}: ${e.stack}`); }
    }
  }
  check(n > 0 && !errs, `every answer to an encounter resolves it (${n} encounters)`);
  // Every street event, every choice, by the numbers.
  let evN = 0, evErr = 0;
  for (const [key, E] of Object.entries(CC.EVENTS)) {
    for (const ch of E.choices) {
      const w = crawlIn(800 + evN);
      CC.jumpToLevel(w.state, w.c, Math.max(E.min, 1));
      const blk = CC.blockOf(w.c);
      blk.events = [{ id: "t1", key, done: false, result: "" }];
      evN++;
      try {
        const res = CC.resolveEvent(w.state, w.p, "t1", ch.id, {});
        if (w.p.crawl && !blk.events[0].done) { evErr++; console.log(`    ${key}/${ch.id}: not done (${res})`); }
      } catch (e) { evErr++; console.log(`    ${key}/${ch.id}: ${e.stack}`); }
    }
  }
  check(!evErr, `every street event's every choice resolves (${evN})`);
  // A blocking event stops the way deeper until it is dealt with.
  const w = crawlIn(900);
  CC.jumpToLevel(w.state, w.c, 3);
  const blk = CC.blockOf(w.c);
  const [rx, ry] = xyOf(w.c.cell), inward = headingToward(w.c.grid, rx, ry);
  blk.events = [{ id: "r1", key: "rubble", done: false, result: "", dir: inward }];
  const at0 = w.c.cell;
  const msg = CC.nextBlock(w.state, w.p, inward);
  check(w.c.cell === at0 && /blocked/.test(msg), `a collapsed street blocks one way, ${["north", "east", "south", "west"][inward]} (deeper in)`);
  check(CC.waysOn(w.c).filter((x) => x.wall).length === 1, "only that one: the other three ways stay open");
  CC.resolveEvent(w.state, w.p, "r1", "detour", {});
  check(blk.events[0].done && !CC.waysOn(w.c).some((x) => x.wall), "finding a way around clears it");
  // A rubble event rolled on a block blocks the way in toward the centre.
  let rolled = null;
  for (let s = 0; s < 60 && !rolled; s++) { const z = crawlIn(950 + s); for (const n of [3, 4]) { if (rolled || !CC.jumpToLevel(z.state, z.c, n)) continue; for (const b of Object.values(z.c.blocks)) { const e = b.events.find((x) => x.key === "rubble"); if (e) { rolled = { e, b, g: z.c.grid }; break; } } } }
  if (rolled) { const [bx, by] = xyOf(rolled.b.key); check(rolled.e.dir === headingToward(rolled.g, bx, by), `a collapsed street rolled on a block blocks the way in toward the centre (${["north", "east", "south", "west"][rolled.e.dir]})`); } else passed++;
  // A street event's map (the ambulance).
  const a = crawlIn(901);
  const ba = CC.blockOf(a.c);
  ba.events = [{ id: "a1", key: "ambulance", done: false, result: "" }];
  CC.resolveEvent(a.state, a.p, "a1", "map", { map: true });
  const sb = a.state.combat;
  check(sb && sb.raid && !sb.raid.interior && sb.raid.areas.some((x) => x.type === "medwreck"), "the crashed ambulance opens a street map with the wreck");
  if (sb) { walkOut(a.state); finishCombat(a.state, sb.setup, sb.result); }
  check(a.p.crawl && ba.events[0].done && !a.c.inside, "and comes back to the block, the event done");
}

// ---------- 7. save and load ----------
console.log("Saving mid-crawl");
{
  const { state, p, c } = crawlIn(21);
  CC.nextBlock(state, p);
  if (c.enc) CC.resolveEncounter(state, p, "run", {});
  const s1 = saveToString(state);
  const st2 = loadFromString(s1);
  const p2 = st2.parties.find((x) => x.id === p.id);
  check(p2 && p2.crawl && p2.crawl.block === c.block && JSON.stringify(p2.crawl.blocks) === JSON.stringify(c.blocks), "a save on a block card keeps the crawl");
  check(CC.activeCrawl(st2) === p2, "the loaded crawl shows its card");
  const pl = CC.blockOf(p2.crawl).places.find((x) => !x.blocked);
  CC.enterPlace(st2, p2, pl.id, { map: true });
  const b = st2.combat;
  const s2 = saveToString(st2);
  const st3 = loadFromString(s2);
  const p3 = st3.parties.find((x) => x.id === p.id);
  check(st3.combat && st3.combat.setup.handler === "crawl" && p3.crawl.inside === pl.id, "a save inside a building keeps the raid and the crawl");
  walkOut(st3);
  finishCombat(st3, st3.combat.setup, st3.combat.result);
  check(p3.crawl && !p3.crawl.inside && p3.crawl.buildings[pl.id], "after loading, coming out of the building returns to the block");
  void b;
  // A save while still choosing where to go in: it loads choosing, and the pick works.
  {
    const w = world(23);
    const q = team(w.state, w.h, w.city);
    CC.startCrawl(w.state, q, { choose: true });
    const stc = loadFromString(saveToString(w.state));
    const qc = stc.parties.find((x) => x.id === q.id);
    const r0 = rimOf(qc.crawl.grid)[3];
    check(qc.crawl.choosing && CC.activeCrawl(stc) === qc && CC.pickStart(stc, qc, keyOf(r0[0], r0[1])) === "" && CC.onEdge(qc.crawl), "a save made while choosing where to go in loads, and the pick works");
  }
  // An old save made on the way out (c.leaving: the blocks of the old one-click way out still to walk): it loads with
  // the team standing where it was, no way out under way, and walks on and out by hand (or the autopilot does).
  {
    const w = deepCrawl(1100, 3);
    CC.jumpToLevel(w.state, w.c, 3);
    w.c.leaving = { way: "back", dir: null, cells: w.c.path.slice(0, -1).reverse(), at: w.c.block, started: true };
    const at = w.c.cell;
    const sto = loadFromString(saveToString(w.state));
    const po = sto.parties.find((x) => x.id === w.p.id);
    const co = CC.crawlOf(sto, po);
    check(co && !("leaving" in co) && co.cell === at && CC.activeCrawl(sto) === po, "an old save on its way out loads: the way out dropped, the team standing where it was");
    const chance0 = sto.rng.chance;
    sto.rng.chance = () => false;
    const back = CC.waysOn(co).find((x) => x.back);
    check(back && CC.nextBlock(sto, po, back.way) === "" && co.cell === back.cell, "and it walks on by hand (back the way it came)");
    sto.rng.chance = chance0;
    let g = 0;
    while (po.crawl && g++ < 60) CC.crawlAutoStep(sto, po);
    check(!po.crawl && sto.parties.includes(po), "or the autopilot walks it to the rim and out");
    // An old save with trouble on the next block of the old way: getting past it puts the team on that block.
    const w2 = deepCrawl(1100, 3);
    CC.jumpToLevel(w2.state, w2.c, 3);
    const next = w2.c.path[w2.c.path.length - 2];
    w2.c.leaving = { way: "back", cells: [next], started: true };
    w2.c.enc = { kind: "horde", block: 2, cell: next, heading: null, enemy: { kind: "zombies", count: 3, power: 2, name: "a horde" }, text: "x", move: null, exit: true, event: null, spotted: false };
    const st5 = loadFromString(saveToString(w2.state));
    const p5 = st5.parties.find((x) => x.id === w2.p.id);
    st5.rng.chance = () => true;
    CC.resolveEncounter(st5, p5, "hide", {});
    check(p5.crawl && !p5.crawl.enc && p5.crawl.cell === next, "an old save's trouble on the way out, got past, puts the team on that block");
  }
  // An old save (no crawl anywhere) still loads and plays.
  const plain = createWorld({ seed: 22, factionCount: 7 });
  const st4 = loadFromString(saveToString(plain));
  check(!st4.parties.some((x) => x.crawl) && !CC.activeCrawl(st4), "a world without a crawl loads as before");
}

// ---------- 8. the autopilot's crawl ----------
console.log("The autopilot's crawl (a crawl left open when the autopilot comes on)");
{
  let out = 0, dead = 0, loot = 0, runs = 0;
  for (let s = 0; s < Math.max(10, SEEDS * 3); s++) {
    const { state, p } = crawlIn(1000 + s);
    let g = 0;
    while (p.crawl && g++ < 60) CC.crawlAutoStep(state, p);
    runs++;
    if (!p.crawl && state.parties.includes(p) && partyMembers(state, p).length) {
      out++;
      loot += Object.values(p.cargo.supplies).reduce((a, v) => a + v, 0);
    } else if (!state.parties.includes(p)) dead++;
  }
  check(out + dead === runs, `every autopilot crawl ends (${out} out, ${dead} lost of ${runs})`);
  check(out / runs >= 0.6, `the autopilot (blocks 1–${CC.CRAWL.AUTO.depth}) usually gets out (${out}/${runs}), ${(loot / Math.max(1, out)).toFixed(0)} supplies a run`);
}

// ---------- 8b. leaving: back the way you came, or another way out; the Alert creeps with time ----------
console.log("The round grid (2026-10-13): moving, slipping away, the ways out, the trail, the creep, memory");
{
  // The grid: a city 15-30 across, a town 9-12; you come in on the rim.
  const sizes = [];
  for (let sd = 0; sd < 12; sd++) { const w = crawlIn(4400 + sd); sizes.push(w.c.grid.size); check(CC.onEdge(w.c) && w.c.path.length === 1, `seed ${4400 + sd}: in on the rim of a ${w.c.grid.size}-block city`); }
  check(sizes.every((n) => n >= 15 && n <= 30), `cities are 15-30 blocks across (${sizes.join(", ")})`);
}
{
  // Picking the start: any rim block, heading in toward the centre; not a block off the rim; nothing to do before it.
  const w = world(4450);
  const q = team(w.state, w.h, w.city);
  CC.startCrawl(w.state, q, { choose: true });
  const c = q.crawl;
  check(/Pick a block/.test(CC.nextBlock(w.state, q, "north")) && /Pick a block/.test(CC.lieLow(w.state, q)) && /Pick a block/.test(CC.lookAround(w.state, q)), "choosing: no moving, lying low or looking around until a start is picked");
  const inner = cellsOf(c.grid).find(([x, y]) => !isEdge(c.grid, x, y));
  check(/edge/.test(CC.pickStart(w.state, q, keyOf(inner[0], inner[1]))) && c.choosing, "a block off the rim is refused");
  check(/edge/.test(CC.pickStart(w.state, q, "c999_999")) && c.choosing, "a block off the grid is refused");
  const rim = rimOf(c.grid);
  let good = 0;
  for (const [x, y] of rim) {
    Object.assign(c, { choosing: true, cell: null, path: [], entry: null, blocks: {} });
    if (CC.pickStart(w.state, q, keyOf(x, y)) === "" && c.cell === keyOf(x, y) && c.heading === headingToward(c.grid, x, y) && c.path.length === 1 && CC.blockOf(c)) good++;
  }
  check(good === rim.length, `every rim block can be picked, heading in toward the centre (${good}/${rim.length})`);
  check(/already/.test(CC.pickStart(w.state, q, keyOf(rim[0][0], rim[0][1]))), "once in, no second pick");
  // Turning back before going in.
  const q2 = team(w.state, w.h, w.city, 1);
  CC.startCrawl(w.state, q2, { choose: true });
  CC.walkOut(w.state, q2);
  check(!q2.crawl && w.state.parties.includes(q2), "turning back before going in ends the crawl, the team outside");
  // The autopilot's (and the tools') start: a rim block by the visit's dice, the same for the same visit.
  const picks = new Set();
  let same = true;
  for (let v = 1; v <= 12; v++) { const cc = { ...c, visit: v }; const k = CC.rimStart(w.state, cc); same = same && k === CC.rimStart(w.state, { ...cc }); picks.add(k); const [x, y] = xyOf(k); same = same && isEdge(c.grid, x, y); }
  check(same && picks.size >= 6, `the autopilot starts on a rim block by the visit's dice: the same for the same visit, ${picks.size} blocks over 12 visits`);
  const q3 = team(w.state, w.h, w.city, 1);
  CC.startCrawl(w.state, q3, { choose: true });
  CC.crawlAutoStep(w.state, q3);
  check(!q3.crawl.choosing && q3.crawl.cell === CC.rimStart(w.state, q3.crawl), "a crawl still choosing when the autopilot comes on starts at the visit's rim block");
}
{
  // The four ways (2026-10-13): from any block north, east, south and west, all open, the way you came included.
  const { state, p, c } = crawlIn(4500);
  let inner = 0, allOpen = 0;
  for (const [x, y] of cellsOf(c.grid)) {
    if (isEdge(c.grid, x, y)) continue;
    inner++;
    const ws = CC.waysOn({ ...c, cell: keyOf(x, y) });
    if (ws.length === 4 && ws.map((w) => w.way).join() === "north,east,south,west" && ws.every((w) => w.cell && !w.wall)) allOpen++;
  }
  check(inner > 0 && allOpen === inner, `all four ways open from every block off the rim (${allOpen}/${inner})`);
  const edgeWays = CC.waysOn(c);
  check(edgeWays.some((w) => !w.cell), "on the rim a way leads off the grid: the edge");
  // Walk in a block, then back the way you came.
  state.rng.chance = () => false; // no trouble on the way
  const from = c.cell;
  const go = edgeWays.find((w) => w.cell);
  CC.nextBlock(state, p, go.way);
  check(c.cell === go.cell && c.heading === go.heading && c.path.length === 2 && c.path[0] === from, `moving ${go.way} lands next door (${from} → ${c.cell}); the path remembers the way back`);
  const back = CC.waysOn(c).find((w) => w.back);
  check(back && back.cell === from && back.heading === (go.heading + 2) % 4, `the way back is marked (${back && back.way})`);
  CC.nextBlock(state, p, back.way);
  check(c.cell === from && c.path.length === 1, "going back the way you came works: back where you were, the path shorter");
  // A turn named from the way you face still works ("straight", "left", "right", "back").
  c.heading = go.heading;
  CC.nextBlock(state, p, "straight");
  check(c.cell === go.cell, "\"straight\" goes the way you face");
  // Slip away from a block you have just come into, back where you were, facing as before.
  check(c.fresh, "just come in, nothing done: you can still slip away");
  state.rng.chance = () => true; // the stealth roll made
  CC.slipAway(state, p);
  check(c.cell === from && c.path.length === 1, "slipping away takes you back to the block before");
}
{
  // Noise ends the chance to slip away.
  const { state, p, c } = crawlIn(4501);
  const w = CC.waysOn(c).find((x) => x.cell);
  state.rng.chance = () => false; // no trouble on the way
  CC.nextBlock(state, p, w.way);
  const pl = CC.blockOf(c).places.find((x) => !x.blocked);
  if (pl) CC.quickSearch(state, p, pl);
  check(!c.fresh && /no slipping away/.test(CC.slipAway(state, p)), "after a search (noise) there is no slipping away");
}
{
  // Walking out: only on the rim; the autopilot's way there (autoWayOut) ends on the rim, the safer way round the heat.
  const w = deepCrawl(4600, 4);
  CC.jumpToLevel(w.state, w.c, 4);
  check(/not the edge/.test(CC.walkOut(w.state, w.p)) && !!w.p.crawl, "off the rim: no walking out");
  const near = CC.autoWayOut(w.state, w.p, w.c, "nearest"), safe = CC.autoWayOut(w.state, w.p, w.c, "safer");
  const endsOnRim = (r) => { const [x, y] = xyOf(r.path[r.path.length - 1]); return isEdge(w.c.grid, x, y); };
  check(near && safe && near.path.length >= 1 && endsOnRim(near) && endsOnRim(safe) && near.path.length <= safe.path.length, `the way out ends on the rim: nearest ${near.path.length} blocks, safer ${safe.path.length} (about ${(safe.risk * 100).toFixed(0)}% trouble)`);
  // Noise on the nearest way out: the safer way goes round it.
  for (const k of near.path) w.c.trail[k] = 100;
  const round = CC.autoWayOut(w.state, w.p, w.c, "safer");
  check(round.path.filter((k) => near.path.includes(k)).length < near.path.length, `the safer way goes round the heat you left (${round.path.filter((k) => near.path.includes(k)).length} of ${round.path.length} blocks on the hot way)`);
  // Walk it by hand, a block at a time, and out from the rim.
  w.state.rng.chance = () => false;
  let g = 0;
  for (const k of round.path) { const d = CC.waysOn(w.c).find((x) => x.cell === k); if (!d) break; CC.nextBlock(w.state, w.p, d.way); g++; }
  check(CC.onEdge(w.c) && g === round.path.length, `walked block by block to the rim (${g} blocks)`);
  w.c.alert = 30;
  CC.walkOut(w.state, w.p);
  check(!w.p.crawl, "and walked out from there");
}
{
  // A breakout on the rim: at a high Alert walking out is a fight first (the dead between you and safety); win it,
  // sneak or run through and you are out; lose and you are pinned down on the block.
  const bw = crawlIn(4710);
  bw.c.alert = CC.CRAWL.BREAKOUT.alert + 5;
  CC.walkOut(bw.state, bw.p);
  const e = bw.c.enc;
  check(!!bw.p.crawl && e && e.kind === "breakout" && e.exit && e.enemy.count >= 2, `at Alert ${bw.c.alert} walking out is a breakout (${e && e.enemy.count} of the dead)`);
  CC.resolveEncounter(bw.state, bw.p, "run", {});
  check(!bw.p.crawl && bw.state.parties.includes(bw.p) && partyMembers(bw.state, bw.p).length > 0, "running through it: out of the city");
  const lw = crawlIn(4712);
  lw.c.alert = 90;
  CC.walkOut(lw.state, lw.p);
  lw.state.rng.chance = () => true;
  CC.resolveEncounter(lw.state, lw.p, "hide", {});
  check(!lw.p.crawl, "slipping past it unseen: out of the city");
  // Below the line: no breakout.
  const plain = crawlIn(4711);
  plain.c.alert = 40;
  CC.walkOut(plain.state, plain.p);
  check(!plain.p.crawl, "at Alert 40 you just walk out");
}
{
  // The Alert creeps up with time instead of fading.
  const { state, p, c } = crawlIn(4101);
  c.alert = 20;
  const a0 = c.alert;
  CC.lookAround(state, p);
  check(c.alert > a0, `an hour in the city raises the Alert (${a0} → ${c.alert})`);
  // A bigger team leaves more heat; a stealthy one less.
  p.stance = "stealthy";
  const m3 = CC.trailMultOf(state, p);
  p.stance = "normal";
  check(m3 < CC.trailMultOf(state, p), "a stealthy team leaves less heat");
}
{
  // The city remembers: the blocks you went to (the map) and the buildings as you left them; other groups loot near the rim.
  const { state, p, c } = crawlIn(4800);
  const t = state.tiles[c.tile];
  const pl = CC.blockOf(c).places.find((x) => !x.blocked);
  c.buildings[pl.id] = { searched: 2, total: 5, units: [] };
  c.alert = 10;
  CC.walkOut(state, p);
  const mem = CC.crawlMemOf(t);
  check(!p.crawl && mem.snaps[pl.id] && mem.cells[c.cell], "out: the city keeps the building as you left it and the block on its map");
  const homeAgain = (st, q) => { for (const id of q.members) { const m = st.survivors.find((x) => x.id === id); if (m) m.location = { kind: "base", baseId: hub(st).id }; } st.parties.splice(st.parties.indexOf(q), 1); };
  homeAgain(state, p);
  const again = crawlIn(4800, state);
  check(again.c.buildings[pl.id] && again.c.buildings[pl.id].searched === 2, "the next visit finds the building as you left it");
  again.c.alert = 10;
  CC.walkOut(again.state, again.p);
  homeAgain(state, again.p);
  mem.aiLoot = 0.2;
  const third = crawlIn(4800, state);
  const ai = Object.values(mem.cells).filter((e) => e.ai).length;
  check(ai >= 3 && mem.aiLoot < 0.04, `another group's scavenging since: ${ai} blocks near the rim picked over`);
}

{
  // Zombie activity: each block's own level (the city's dice), scaling its danger and multiplying its heat.
  const { state, p, c } = crawlIn(4300);
  const lv = new Map();
  for (let n = 1; n <= 8; n++) { const a = CC.threatOf(state, c, n), b = CC.threatOf(state, c, n); check(a.level === b.level && a.level >= 1 && a.level <= 5, `block ${n}: ${a.name} (×${a.mult}), the same every time`); lv.set(n, a); }
  const counts = [0, 0, 0, 0, 0, 0];
  for (let t = 0; t < 400; t++) counts[CC.threatOf(state, { tile: t }, 3).level]++;
  check(counts.slice(1).every((k) => k > 0), `every level occurs across cities (${counts.slice(1).join(" / ")})`);
  // The same heat costs more on a busier block.
  const quiet = { ...c, alert: 10, trail: {} }, hot = { ...c, alert: 60, trail: {} };
  const r = (cc, m) => CC.moveRisk(state, cc, 4, m);
  check(r(hot, 1.8) - r(quiet, 1.8) > r(hot, 0.6) - r(quiet, 0.6), "the same heat raises the risk more on a crawling block than on a quiet one");
  check(CC.blockHeat(state, { ...c, alert: 20, trail: { 4: 10 } }, 4, 1.35) === 30 * 1.35, "a block's heat: (Alert + its trail) × its activity");
  check(CC.genBlock(state, c, 2).threat === CC.threatOf(state, c, 2).level, "the block card carries its level");
}

// ---------- 10. parity with the raid tickets (issue #21) ----------
console.log("Parity (issue #21): snapshots keep everything, scenes by the place, pieces carried block to block, hints, the quick search");
const QN = process.env.BS_QUICK ? 30 : 200; // buildings a kind for the quick search's parity (the ticket: 200 seeds)
// A place of this kind on the team's block (its slot: a building of its own), what it holds forced.
function testPlace(state, c, key, slot, o = {}) {
  const pl = { id: `t21-${key}-${slot}`, slot, key, name: `${BUILDINGS[key].name} on Test Street`, kind: BUILDINGS[key].name, dead: 1, rich: 1, raiders: false, looted: 0, blocked: null, quick: false, known: false, folk: { survivors: false, raidersUp: false, nest: false }, ...o };
  CC.blockOf(c).places = [pl];
  return pl;
}
const cellsOfF = (b, f) => (b.floors ? b.floors[f].cells : b.cells);
const allCells = (b) => JSON.stringify((b.floors ? b.floors.map((F) => F.cells) : [b.cells]));
const outAndBack = (state, p, c, pl) => { const b = state.combat; walkOut(state); finishCombat(state, b.setup, b.result); CC.enterPlace(state, p, pl.id, { map: true }); return state.combat; };
{
  // 10a. Every field the raid tickets add, round-tripped through the snapshot (walk out, back in).
  const { state, p, c } = crawlIn(2101);
  let pl = null, b = null;
  for (let slot = 20; slot < 120 && !b; slot++) {
    pl = testPlace(state, c, "apartments", slot);
    if (CC.placeStoreys(state, c, pl) < 2) continue;
    CC.enterPlace(state, p, pl.id, { map: true });
    if (state.combat && state.combat.raid.scenes) b = state.combat; else { state.combat = null; c.inside = null; }
  }
  check(!!b, "test setup: a block of flats of 2+ storeys with scenes");
  const R = b.raid;
  const u = b.units.find((x) => x.side === "player" && !x.dead);
  const home = [u.x, u.y, u.f || 0];
  // A piece lifted (#12) off the ground floor and set down elsewhere.
  let lifted = null, setAt = null;
  const C0 = cellsOfF(b, 0);
  for (let i = 0; i < C0.length && !lifted; i++) {
    const d = liftDef(C0[i].k);
    if (!d || d.carry !== "one" || !d.item || C0[i].pc != null) continue; // a piece one carries; the cell beside it in reach (spot): a piece's own cell is never walked (it was in b.reach only when a scene put it down after the flood)
    const x = i % b.w, y = (i / b.w) | 0;
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [x + dx, y + dy]).find(([sx, sy]) => C0[sy * b.w + sx] && C0[sy * b.w + sx].k === "open" && b.reach[sy * b.w + sx] && !b.units.some((o) => !o.dead && (o.f || 0) === 0 && o.x === sx && o.y === sy));
    if (!spot) continue;
    u.x = spot[0]; u.y = spot[1]; u.f = 0; u.ap = 2;
    if (combatAct(state, { type: "liftPiece", unit: u.id, x, y }) !== "") continue;
    lifted = { x, y, kind: d.kind };
    u.ap = 2;
    const t = setTargets(b, u).find((o) => o.x !== x || o.y !== y);
    if (t && combatAct(state, { type: "setPiece", unit: u.id, x: t.x, y: t.y }) === "") setAt = { x: t.x, y: t.y, kind: d.kind };
  }
  check(!!lifted && !!setAt, `test setup: a piece lifted and set down (${lifted && lifted.kind})`);
  u.x = home[0]; u.y = home[1]; u.f = home[2];
  // Blood, decor, wall art, boards, brass on the floors; a body by floor; a ground pile.
  const top = b.floors ? b.floors.length - 1 : 0, CT = cellsOfF(b, top);
  const openAt = (cells) => cells.findIndex((x, i) => x.k === "open" && !x.blood && !x.deco && i !== (setAt ? setAt.y * b.w + setAt.x : -1));
  const ib = openAt(CT); CT[ib].blood = { kind: "human", amount: 3 };
  const id = openAt(C0); C0[id].deco = { k: "trash", r: 1 }; C0[id].brass = 5;
  const iw = C0.findIndex((x) => x.k === "window");
  if (iw >= 0) { setFloor(b, 0); boardCell(b, C0[iw], iw % b.w, (iw / b.w) | 0); }
  const wart = C0.findIndex((x) => x.wart);
  b.corpses = b.corpses || []; b.corpses.push({ id: 991, x: ib % b.w, y: (ib / b.w) | 0, f: top, seed: 7 });
  R.containers.push({ id: 9991, x: id % b.w, y: (id / b.w) | 0, f: 0, kind: "ground", searched: true, label: "test pile", contents: { sup: { food: 3 }, gear: [newItem("pistol")] } });
  const sceneText = JSON.stringify(R.scenes.list);
  const before = allCells(b), stairs = JSON.stringify(R.stairs);
  const b2 = outAndBack(state, p, c, pl);
  const C02 = cellsOfF(b2, 0), CT2 = cellsOfF(b2, top);
  check(allCells(b2) === before, "every floor's cells come back exactly as they were left");
  check(CT2[ib].blood && CT2[ib].blood.amount === 3, "blood (c.blood) on an upper floor stays");
  check(C02[id].deco && C02[id].deco.k === "trash" && C02[id].brass === 5, "decor (c.deco) and spent brass (c.brass) stay");
  check(iw < 0 || (C02[iw].k === "boarded" && C02[iw].boards === 1 && C02[iw].under && C02[iw].under.k === "window"), "boards (c.boards, c.under) stay");
  check(wart < 0 || JSON.stringify(C02[wart].wart) === JSON.stringify(C0[wart].wart), "wall art (c.wart) stays");
  check(lifted && C02[lifted.y * b2.w + lifted.x].k !== lifted.kind, "a cell a piece was lifted off stays empty");
  check(setAt && C02[setAt.y * b2.w + setAt.x].k === setAt.kind && C02[setAt.y * b2.w + setAt.x].moved, "a piece set down is there on the second visit, where it was set");
  check(b2.corpses.some((x) => x.id === 991 && x.f === top), "a body (b.corpses) stays on its floor");
  check(b2.raid.containers.some((x) => x.kind === "ground" && x.label === "test pile" && x.contents.sup.food === 3 && x.contents.gear.length === 1), "a ground pile stays with what lies on it");
  check(JSON.stringify(b2.raid.stairs) === stairs, "the stair cells (R.stairs) stay");
  check(JSON.stringify(b2.raid.scenes.list) === sceneText, "the same scenes (rolled once, kept)");
  C02[id].deco.k = "papers";
  check(c.buildings[pl.id].cells[id].deco.k === "trash", "the snapshot shares nothing with the battle (a change in play leaves it as left)");
  walkOut(state); finishCombat(state, b2.setup, b2.result);
}
{
  // 10b. Scenes by the place (interiorscenes.js sceneBias), a place picked over, the raiders' and the survivors' barricades.
  check(sceneBias("apartments", null) === null, "elsewhere (no place) the scene roll is as it was");
  const lo = sceneBias("apartments", { dead: 0.8 }), hi = sceneBias("apartments", { dead: 1.6 });
  check(hi.odds > lo.odds && hi.w.overrun > lo.w.overrun && hi.w.stand > lo.w.stand, `more of the dead: likelier scenes, more overrun rooms and last stands (${lo.odds.toFixed(2)} → ${hi.odds.toFixed(2)})`);
  check(sceneBias("apartments", { survivors: true }).w.barricade > 1 && sceneBias("apartments", { survivors: true }).odds >= SCENES.PLACE.survivorsOdds, "people upstairs: a scene, a barricaded room likelier");
  check(sceneBias("offices", { raiders: true }).w.barricade > 1 && sceneBias("offices", { looted: 1 }).w.quiet < 1, "raiders: barricades; picked over: fewer quiet rooms");
  // Scenes counted over buildings with few and many of the dead: the place's say shows.
  const { state, p, c } = crawlIn(2102);
  let few = 0, many = 0;
  for (let slot = 0; slot < (process.env.BS_QUICK ? 30 : 80); slot++) {
    for (const [dead, add] of [[0.6, (n) => (few += n)], [1.6, (n) => (many += n)]]) {
      const pl = testPlace(state, c, "offices", slot, { dead });
      const m = buildingMap(state, c.tile, CC.placeOption(c, pl), false);
      add(m.scenes ? m.scenes.list.length : 0);
    }
  }
  check(many > few, `offices with many of the dead show more signs of survival (${few} → ${many} scenes)`);
  // A place picked over: containers stripped, a barricade broken through.
  let stripped = 0, boxes = 0, broke = 0, tried = 0;
  for (let slot = 0; slot < 12; slot++) {
    const pl = testPlace(state, c, "apartments", 200 + slot, { looted: 0.9 });
    CC.enterPlace(state, p, pl.id, { map: true });
    const b = state.combat;
    const list = b.raid.containers.filter((x) => x.kind !== "body" && x.kind !== "ground");
    boxes += list.length; stripped += list.filter((x) => x.stripped && x.contents && !x.contents.gear.length && !Object.keys(x.contents.sup).length).length;
    const P = b.raid.scenes && b.raid.scenes.pieces || [];
    if (P.some((q) => q.k === "boarded" || q.frame)) { tried++; if (P.some((q) => { const cl = cellsOfF(b, q.f)[q.y * b.w + q.x]; return cl.k !== "boarded" && q.k === "boarded" || (q.frame && !cl.moved); })) broke++; }
    state.combat = null; c.inside = null;
  }
  check(boxes > 0 && stripped / boxes > 0.3 && stripped / boxes < 0.75, `a place picked over (90%): ${Math.round(stripped / boxes * 100)}% of its containers found stripped`);
  check(tried === 0 || broke > 0, `... and a barricade of its scenes already broken through (${broke}/${tried} buildings with one)`);
  // Raiders upstairs: their room's windows boarded, half cover dragged up; survivors: furniture beside the barred door.
  let fortOk = 0, fortTried = 0, piledOk = 0, piledTried = 0;
  const deep = deepCrawl(2103, 4);
  CC.jumpToLevel(deep.state, deep.c, 4);
  for (let slot = 0; slot < 40 && (fortTried < 4 || piledTried < 4); slot++) {
    const pl = testPlace(deep.state, deep.c, "offices", 300 + slot, { raiders: true, folk: { survivors: true, raidersUp: true, nest: false } });
    if (CC.placeStoreys(deep.state, deep.c, pl) < 2) continue;
    CC.enterPlace(deep.state, deep.p, pl.id, { map: true });
    const F = deep.state.combat.raid.folk;
    if (F && F.raiders && F.raiders.fort) { fortTried++; if (F.raiders.fort.boards + F.raiders.fort.pieces > 0) fortOk++; }
    if (F && F.survivors) { piledTried++; if (F.survivors.pieces > 0) piledOk++; }
    deep.state.combat = null; deep.c.inside = null;
  }
  check(fortTried > 0 && fortOk > 0, `raiders holed up put their barricades up (windows boarded, half cover dragged up: ${fortOk}/${fortTried})`);
  check(piledTried > 0 && piledOk > 0, `survivors upstairs have furniture piled beside their barred door (${piledOk}/${piledTried})`);
}
{
  // 10c. A piece carried block to block (#12): the card, the pace, into a place, out at the rim.
  const { state, p, c, h } = crawlIn(2104);
  const [a, m] = partyMembers(state, p);
  ensureInv(a); ensureInv(m);
  const ways = CC.waysOn(c).filter((w) => w.cell && !w.wall);
  const t0h = state.hour;
  CC.nextBlock(state, p, ways[0].dir);
  const plain = state.hour - t0h;
  if (c.enc) c.enc = null;
  const crawlFridge = () => Object.assign(newItem("fridge"), { crawl: true }); // furnihome.js (#18): carried out of a crawl's building
  a.gear.carry = crawlFridge();
  c.mates = { [a.id]: m.id };
  check(CC.carryLine(state, p) === `Carrying: a refrigerator (${a.name.split(" ")[0]}, ${m.name.split(" ")[0]})`, `the card: "${CC.carryLine(state, p)}"`);
  const pace = CC.carryPace(state, p);
  const back = CC.waysOn(c).find((w) => w.back) || CC.waysOn(c).find((w) => w.cell && !w.wall);
  const t1 = state.hour;
  CC.nextBlock(state, p, back.dir);
  check(pace.hours > CRAWL_MOVE() && state.hour - t1 === pace.hours && state.hour - t1 > plain, `carrying a fridge between two the walk takes longer (${plain} h → ${state.hour - t1} h; mob ${pace.mob})`);
  if (c.enc) c.enc = null;
  c.mates = {};
  check(CC.carryPace(state, p).hours > pace.hours, `alone the fridge is slower still (${CC.carryPace(state, p).hours} h a block)`);
  c.mates = { [a.id]: m.id };
  // Into a place: in the arms at the door, the tether between the two.
  const pl = testPlace(state, c, "grocery", 401);
  CC.enterPlace(state, p, pl.id, { map: true });
  let b = state.combat;
  const ua = b.units.find((x) => x.sid === a.id), um = b.units.find((x) => x.sid === m.id);
  const foe = b.units.some((e) => e.side === "enemy" && !e.dead && (e.f || 0) === 0 && Math.max(Math.abs(e.x - ua.x), Math.abs(e.y - ua.y)) <= CC.CRAWL.CARRY.fightRange);
  check(foe ? !ua.piece && b.log.some((l) => /down at the door to fight/.test(l.text || l)) : ua.piece === "fridge" && ua.bag === a.gear.carry && ua.tether === um.id && um.tether === ua.id && um.shareKg > 0, foe ? "the dead right inside: the fridge is set down at the door (a log line)" : "the fridge is in the arms at the entry, the two tethered at half the weight each");
  walkOut(state); finishCombat(state, b.setup, b.result);
  if (foe) { a.gear.carry = crawlFridge(); c.mates = { [a.id]: m.id }; }
  else check(a.gear.carry && a.gear.carry.key === "fridge" && c.mates[a.id] === m.id, "carried back out: still in the arms, the pair kept for the next block");
  // Forced: the dead within reach of the door (fightRange stretched).
  const fr = CC.CRAWL.CARRY.fightRange;
  CC.CRAWL.CARRY.fightRange = 999;
  const pl2 = testPlace(state, c, "grocery", 402, { dead: 1.5 });
  CC.enterPlace(state, p, pl2.id, { map: true });
  b = state.combat;
  CC.CRAWL.CARRY.fightRange = fr;
  const hasFoe = b.units.some((e) => e.side === "enemy" && !e.dead);
  check(!hasFoe || (b.units.every((x) => !x.piece) && c.log.some((l) => /down at the door to fight/.test(l.text))), "a fight on entry: the piece is set down at the door, a line in the log");
  state.combat = null; c.inside = null;
  if (!a.gear.carry) { a.gear.carry = crawlFridge(); c.mates = { [a.id]: m.id }; }
  // The pair must both be on the team: the other end gone, a "two" piece is left on the block.
  const party0 = p.members.slice();
  {
    p.members = p.members.filter((x) => x !== m.id);
    const cell = c.cell;
    CC.nextBlock(state, p, CC.waysOn(c).find((w) => w.cell && !w.wall).dir);
    if (c.enc) c.enc = null;
    const mem = CC.crawlMemOf(state.tiles[c.tile]);
    check(!a.gear.carry && mem.left && mem.left[cell] && mem.left[cell].some((o) => o.kind === "fridge"), "the other end gone: the fridge (two to carry) is left on the block, remembered");
    p.members = party0;
    // Back on that block: it is on the card, and taken up again.
    c.cell = cell; c.block = CC.levelAt(c, cell);
    CC.genBlock(state, c, cell);
    check((CC.blockOf(c).left || []).length > 0 && CC.takeLeft(state, p, 0) === "" && partyMembers(state, p).some((s) => s.gear.carry && s.gear.carry.key === "fridge"), "the block card lists it and it is taken up again (two with free arms)");
  }
}
{
  // 10d. Out at the rim with a piece: loaded at the block the vehicles wait at; dropped from exhaustion at another.
  const run = (sameBlock) => {
    const { state, p, c, h } = crawlIn(2105);
    const car = createVehicle(state, "van", { kind: "party", partyId: p.id }, { condition: 90 });
    p.vehicleId = car.id; p.vehicleIds = [car.id]; p.vehicle = true;
    const [a, m] = partyMembers(state, p);
    ensureInv(a);
    a.gear.carry = Object.assign(newItem("fridge"), { crawl: true }); c.mates = { [a.id]: m.id };
    if (!sameBlock) { const rim = rimOf(c.grid).map(([x, y]) => keyOf(x, y)).find((k) => k !== c.entry); c.cell = rim; c.block = CC.levelAt(c, rim); CC.genBlock(state, c, rim); }
    const cell = c.cell;
    c.alert = 0;
    CC.walkOut(state, p);
    const mem = CC.crawlMemOf(state.tiles[c.tile]);
    return { p, a, cell, mem, log: c.log.map((l) => l.text).join(" ") };
  };
  const one = run(true);
  check(!one.a.gear.carry && one.p.cargo.gear.some((g) => g.key === "fridge"), "out at the block the vehicles wait at: the fridge goes into the vehicle (furnihome.js piecesOut, #18)");
  const two = run(false);
  check(!two.a.gear.carry && !(two.p.cargo && two.p.cargo.gear.some((g) => g.key === "fridge")) && /Exhausted, the team dropped what it was carrying: a refrigerator/.test(two.log) && (two.mem.left[two.cell] || []).some((o) => o.kind === "fridge"), "out at another rim block: dropped from exhaustion there (#18's message), the block remembers it");
  const roadOne = (() => { const { state, p } = crawlIn(2107); const [a] = partyMembers(state, p); ensureInv(a); a.gear.carry = newItem("fridge"); return CC.carryLine(state, p) === "" && CC.carryPace(state, p).mob == null; })();
  check(roadOne, "a fridge carried in from the road is not the crawl's (#18: the road's rules)");
}
{
  // 10e. The hint line from the archetype; the quick search's parity with the laid-out building; its pieces.
  const { state, p, c } = crawlIn(2106);
  const hosp = testPlace(state, c, "hospital", 5);
  const hint = CC.placeHint(state, c, hosp);
  check(/^Hospital: \d+ floors( open of \d+)?, wards/.test(hint) && hint.includes(String(CC.placeStoreys(state, c, hosp))), `the hint names the kind's signature rooms: "${hint}"`);
  check(CC.placeHint(state, c, testPlace(state, c, "offices", 5)).includes("offices") && !/Corridor/i.test(CC.placeHint(state, c, testPlace(state, c, "offices", 5))), "an office tower's: offices (not its corridors)");
  // Per kind over QN buildings: every container opened both ways, the supplies found within ±10%.
  for (const s of partyMembers(state, p)) s.skills.scavenging = 3;
  const kinds = Object.keys(CC.PLACE_POOL);
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
      const reward = (R.reward ?? 1) * (R.big ? raidLootShare(b.w, b.h) : 1);
      for (let k = 0; k < REPS; k++) for (const box of R.containers.filter((x) => x.kind !== "body" && x.kind !== "ground" && !x.stash)) {
        const type = R.areas[box.area].type;
        const got = boxFinds(state, state.rng, { def: boxLoot(type, box.kind), type, rich: R.richness * Math.min(FLOOR_RICH.cap, Math.pow(FLOOR_RICH.perFloor, box.f || 0)) * (box.rich || 1), scav: 3, reward, site, gunSite: b.setup.raid.gunSite, deep: R.deep, tileId: b.tileId, bid: box.id });
        mapSup += Object.values(got.sup).reduce((x, v) => x + v, 0); mapBoxes++;
      }
      state.combat = null; c.inside = null;
    }
    const a = mapSup / Math.max(1, mapBoxes), q = quickSup / Math.max(1, quickBoxes);
    const off = Math.abs(q - a) / Math.max(1e-9, a);
    worst = Math.max(worst, off);
    if (off > 0.1) bad.push(`${key} ${a.toFixed(2)}/${q.toFixed(2)}`);
  }
  check(!bad.length, `a container searched quickly holds what the laid-out building's holds by its table, every kind within ±10% (${QN} buildings a kind; worst ${Math.round(worst * 100)}%)${bad.length ? `: off ${bad.join(", ")}` : ""}`);
  // No pieces on foot; with the vehicle at the rim, the worthiest "one" piece once a place.
  const pl = testPlace(state, c, "deptstore", 77);
  const prof = CC.placeProfile(state, c, pl);
  c.enc = null;
  CC.quickSearch(state, p, pl);
  check(!(c.atVehicle || []).length && !partyMembers(state, p).some((s) => s.gear.carry), "no vehicle: the quick search takes no furniture");
  const car = createVehicle(state, "van", { kind: "party", partyId: p.id }, { condition: 90 });
  p.vehicleId = car.id; p.vehicleIds = [car.id];
  const pl2 = testPlace(state, c, "deptstore", 78);
  const best = CC.placeProfile(state, c, pl2).best;
  CC.quickSearch(state, p, pl2);
  check(!best || ((c.atVehicle || []).length === 1 && liftDef(best).carry === "one" && pl2.pieceTaken === best), `a vehicle at the rim: one "one" piece by worth goes out to it (${best})`);
  void prof;
  // The hive crawl takes nothing new.
  const hive = readFileSync(new URL("../src/sim/hivecrawl.js", import.meta.url), "utf8");
  check(!/furnicarry|interiorscenes|floorfolk/.test(hive), "hivecrawl.js imports nothing new");
}
function CRAWL_MOVE() { return CC.CRAWL.MOVE_HOURS; }

// ---------- 9. stats: map raids with the bot ----------
if (STATS) {
  console.log("Stats: the raid bot in one building per block (it plays carelessly; people do better)");
  for (const n of [1, 2, 3, 4, 5, 6]) {
    let raids = 0, out = 0, deaths = 0, enemies = 0, searched = 0, total = 0, supplies = 0, gear = 0, heat = 0;
    for (let s = 0; s < SEEDS * 2; s++) {
      const w = crawlIn(2000 + s);
      w.c.block = n;
      const blk = CC.genBlock(w.state, w.c, n);
      const pl = blk.places.find((x) => !x.blocked);
      CC.enterPlace(w.state, w.p, pl.id, { map: true });
      const b = w.state.combat;
      enemies += b.units.filter((u) => u.side === "enemy").length;
      playOut(w.state);
      if (!b.over) continue;
      raids++;
      const r = b.result;
      if (r.outcome === "extracted") out++;
      deaths += r.survivorsDead.length;
      searched += r.raid.searched; total += r.raid.total; heat += r.raid.heat;
      supplies += Object.values(r.loot.supplies).reduce((a, v) => a + v, 0);
      gear += r.loot.gear.length;
    }
    const a = (v) => (v / Math.max(1, raids)).toFixed(1);
    console.log(`  block ${n}: raids ${raids}, got out ${Math.round(out / Math.max(1, raids) * 100)}%, deaths ${a(deaths)}, enemies ${a(enemies)}, searched ${a(searched)}/${a(total)}, supplies ${a(supplies)}, gear ${a(gear)}, heat ${a(heat)}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(failed ? 1 : 0);
