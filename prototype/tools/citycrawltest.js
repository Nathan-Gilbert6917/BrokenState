// City crawl test (src/sim/citycrawl.js): entering on a city tile, block cards with places and events, the same city
// and block giving the same places, a place's interior and back out to the block, going back in to the building as it
// was left, danger and loot rising with depth, the four ways from every block, picking the start on the rim, walking out
// (only on the rim; a breakout at a high Alert), time passing, saving and loading mid-crawl (an old save on its way
// out too), the autopilot's crawl to the rim and out, and the normal flow everywhere else unchanged.
// The crawl's other checks are in the parts split from it (issue #74; the gate runs the four side by side):
// citycrawlgridtest.js (encounters and street events, saving, the autopilot, the round grid, the raid tickets' parity
// 10a–10d), citycrawlquicktest.js and citycrawlquick2test.js (the quick search's parity, kind by kind: 10e).
// Usage: node tools/citycrawltest.js [seeds=6] [stats]   (stats: also play map raids with the bot block by block)
import { partyMembers, giveOrder } from "../src/sim/parties.js";
import { startScavenge } from "../src/sim/scavenge.js";
import { finishCombat } from "../src/sim/combat.js";
import * as CC from "../src/sim/citycrawl.js";
import { rimOf, keyOf } from "../src/sim/citygrid.js";
import { world, team, crawlIn, deepCrawl, walkOut, playOut } from "./citycrawlkit.js"; // the shared setup (issue #74: the test split in four, run side by side by the gate)

const SEEDS = Number(process.argv[2] || 6);
const STATS = process.argv.includes("stats");
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) { passed++; console.log(`  ok: ${msg}`); } else { failed++; console.log(`  FAIL: ${msg}`); } };
const ok = (msg) => console.log(`  ok: ${msg}`);
const t0 = performance.now();


// ---------- 1. entering ----------
console.log("Entering a city");
(() => {
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
})();

// ---------- 1b. moved onto a city: the City crawl card ----------
console.log("Moved onto a city: the City crawl card");
(() => {
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
})();

// ---------- 2. block cards ----------
console.log("Block cards");
(() => {
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
})();

// ---------- 3. a place's interior and back ----------
console.log("Into a place and back out");
(() => {
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
})();

// ---------- 4. danger and loot with depth ----------
console.log("Depth: danger and rewards");
(() => {
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
})();

// ---------- 5. moving, time, leaving ----------
console.log("Moving and leaving");
(() => {
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
})();


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
