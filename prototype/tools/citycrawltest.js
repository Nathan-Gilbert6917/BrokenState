// City crawl test (src/sim/citycrawl.js): entering on a city tile, block cards with places and events, the same city
// and block giving the same places, a place's interior and back out to the block, going back in to the building as it
// was left, danger and loot rising with depth, the risk of leaving from deep in, time passing, saving and loading mid-
// crawl, the autopilot's crawl, and the normal flow everywhere else unchanged.
// Usage: node tools/citycrawltest.js [seeds=6] [stats]   (stats: also play map raids with the bot block by block)
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, partyMembers, giveOrder } from "../src/sim/parties.js";
import { startScavenge } from "../src/sim/scavenge.js";
import { autoPlayerTurn, runEnemyPhase, finishCombat, combatAct } from "../src/sim/combat.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import * as CC from "../src/sim/citycrawl.js";
import { newItem, stow } from "../src/sim/inventory.js";

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
function crawlIn(seed) {
  const { state, h, city } = world(seed);
  const p = team(state, h, city);
  CC.startCrawl(state, p);
  return { state, h, city, p, c: p.crawl };
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
    check(p.crawl && p.crawl.block === 1 && p.phase === "engaged", "the crawl opens at block 1 and holds the team");
    check(CC.activeCrawl(state) === p, "the crawl window shows it");
    // A town keeps the normal raid.
    const town = state.tiles.find((t) => t.loc && t.loc.type === "town");
    const q = team(state, h, town, 1);
    startScavenge(state, q);
    check(!q.crawl && state.combat && state.combat.raid, "a town keeps the normal raid");
    state.combat = null;
    // The autopilot (autoCombat): the hour-by-hour search, no crawl.
    const r = team(state, h, city, 1);
    state.autoCombat = true;
    state.engagement = null;
    startScavenge(state, r);
    check(!r.crawl && !!state.engagement, "on autopilot a city is searched hour by hour as before");
    state.autoCombat = false;
    state.engagement = null;
  } finally { delete globalThis.window; }
  // Headless: the hour-by-hour search as before.
  const p2 = team(state, h, city, 1);
  startScavenge(state, p2);
  check(!p2.crawl && !!state.engagement, "headless (tools) a city is searched hour by hour as before");
  check(!CC.crawlTile(state.tiles.find((t) => t.loc && t.loc.type === "town")) && CC.crawlTile(city), "only city tiles are crawled");
}

// ---------- 1b. moved onto a city: the City crawl card ----------
console.log("Moved onto a city: the City crawl card");
{
  const { state, h, city } = world(3);
  const town = state.tiles.find((t) => t.loc && t.loc.type === "town");
  // A team standing on the tile that is given a Move order there arrives as a move does (parties.js arrive).
  const moveOnto = (tile, n = 1) => { const p = team(state, h, tile, n); p.phase = "waiting"; state.cards.length = 0; giveOrder(state, p, "move"); return p; };
  const cardOf = (p) => state.cards.find((c) => c.partyId === p.id);
  // Where there is no crawl to offer, a plain Move that got there pops up no card at all (parties.js quietArrival:
  // a log line, as orders reach a team anywhere since TEAM-01): no crawl card, no orders card, the team waits.
  const quietly = (p) => !cardOf(p) && p.phase === "waiting" && /reached .* and waits for orders/.test((state.log[0] || {}).text || "");
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
    check(!!p.crawl && p.crawl.block === 1 && p.phase === "engaged" && res === "", "Go in block by block starts the crawl at block 1 (no result box over the crawl window)");
    check(CC.activeCrawl(state) === p, "the crawl window shows it");
    // Not now: the team's usual orders card comes back, Scavenge on it still crawls.
    const q = moveOnto(city, 1);
    pick(cardOf(q), "Not now");
    const oc = cardOf(q);
    check(oc && oc.isOrders && !oc.title.startsWith("City crawl") && state.cards[0] === oc, `Not now brings back the orders card, first in line ("${oc && oc.title}")`);
    check(!q.crawl && q.phase === "waiting", "Not now leaves the team waiting on the tile");
    // Not a city, a queued order, the autopilot: no City crawl card.
    const r = moveOnto(town, 1);
    check(quietly(r), "a town: no crawl card (the plain move's quiet arrival)");
    const s1 = team(state, h, city, 1); s1.phase = "waiting"; state.cards.length = 0;
    s1.orders = [{ type: "camp", hours: 8 }];
    giveOrder(state, s1, "move");
    check(!cardOf(s1) && s1.phase === "task", "queued orders carry on at the city: no card");
    state.autoCombat = true;
    const u = moveOnto(city, 1);
    check(quietly(u), "with battles resolved by the numbers (the autopilot) no crawl card: the plain move's quiet arrival as before");
    state.autoCombat = false;
  } finally { delete globalThis.window; }
  const w2 = world(4);
  const v = team(w2.state, w2.h, w2.city, 1); v.phase = "waiting"; w2.state.cards.length = 0;
  giveOrder(w2.state, v, "move");
  const vc = w2.state.cards.find((c) => c.partyId === v.id);
  check(!vc && v.phase === "waiting" && /reached .* and waits for orders/.test((w2.state.log[0] || {}).text || ""), `headless (tools) no crawl card: the plain move's quiet arrival as before (${vc ? vc.title : "no card"})`);
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
    for (const pl2 of CC.genBlock(st, cc, 1).places) { n1++; if (pl2.rare) rare1++; if (pl2.raiders) raid1++; }
    for (const pl2 of CC.genBlock(st, cc, 5).places) { n5++; if (pl2.rare) rare5++; if (pl2.raiders) raid5++; }
  }
  check(rare5 / n5 > rare1 / n1 + 0.05, `rare places deeper (block 1 ${(rare1 / n1 * 100).toFixed(0)}%, block 5 ${(rare5 / n5 * 100).toFixed(0)}%)`);
  check(raid1 === 0 && raid5 > 0, `raiders holed up only deeper (block 1 ${raid1}, block 5 ${raid5} of ${n5})`);
  // The same building at block 1 and at block 5: more enemies on its map.
  let e1 = 0, e5 = 0, k = 0;
  for (let s = 0; s < SEEDS; s++) {
    const w = crawlIn(400 + s);
    const place = CC.blockOf(w.c).places[0];
    place.blocked = null;
    for (const n of [1, 5]) {
      w.c.block = n;
      w.c.blocks[n] = { ...CC.genBlock(w.state, w.c, n), places: [place] };
      CC.enterPlace(w.state, w.p, place.id, { map: true });
      const b = w.state.combat;
      const en = b.units.filter((u) => u.side === "enemy").length;
      if (n === 1) e1 += en; else e5 += en;
      w.state.combat = null;
      w.c.inside = null;
    }
    k++;
  }
  check(e5 > e1, `the same building holds more enemies at block 5 than at block 1 (${(e1 / k).toFixed(1)} → ${(e5 / k).toFixed(1)})`);
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
  // Leaving from the edge is safe; from deep in it is a gamble.
  const w = crawlIn(10);
  check(CC.exitRisk(w.state, w.p).any === 0, "leaving from block 1 has no risk");
  w.c.block = 4; w.c.deepest = 4; CC.genBlock(w.state, w.c, 4);
  const r4 = CC.exitRisk(w.state, w.p).any;
  w.c.block = 6; CC.genBlock(w.state, w.c, 6);
  const r6 = CC.exitRisk(w.state, w.p).any;
  check(r4 > 0.3 && r6 > r4, `leaving from block 4 is risky (${(r4 * 100).toFixed(0)}%), from block 6 more (${(r6 * 100).toFixed(0)}%)`);
  w.c.alert = 80;
  check(CC.exitRisk(w.state, w.p).breakout, "at a high Alert from deep in, the way out is a breakout");
  // Played by the numbers: trouble on the way out from block 5, none from block 1.
  let trouble1 = 0, trouble5 = 0, out5 = 0;
  for (let s = 0; s < 30; s++) {
    const a = crawlIn(500 + s);
    CC.leaveCity(a.state, a.p);
    if (a.p.crawl) trouble1++;
    const z = crawlIn(600 + s);
    z.c.block = 5; z.c.deepest = 5; for (let n = 2; n <= 5; n++) CC.genBlock(z.state, z.c, n);
    CC.leaveCity(z.state, z.p);
    if (z.p.crawl && z.c.enc) trouble5++;
    let g = 0;
    while (z.p.crawl && g++ < 30) CC.crawlAutoStep(z.state, z.p);
    if (z.state.parties.includes(z.p) && partyMembers(z.state, z.p).length && !z.p.crawl) out5++;
  }
  check(trouble1 === 0, "nobody meets trouble leaving from the edge");
  check(trouble5 >= 10, `leaving from block 5 meets trouble often (${trouble5}/30); ${out5}/30 got out`);
}

// ---------- 6. encounters and events ----------
console.log("Encounters and street events");
{
  let errs = 0, n = 0;
  for (const choice of ["numbers", "hide", "lure", "run", "fight"]) {
    for (let s = 0; s < 4; s++) {
      const w = crawlIn(700 + s);
      if (choice === "lure") for (const m of partyMembers(w.state, w.p)) stow(m, newItem("noisemaker"));
      w.c.block = 3; CC.genBlock(w.state, w.c, 3);
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
      w.c.block = Math.max(E.min, 1);
      const blk = CC.genBlock(w.state, w.c, w.c.block);
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
  w.c.block = 3;
  const blk = CC.genBlock(w.state, w.c, 3);
  blk.events = [{ id: "r1", key: "rubble", done: false, result: "" }];
  const msg = CC.nextBlock(w.state, w.p);
  check(w.c.block === 3 && /blocked/.test(msg), "a collapsed street blocks the way deeper");
  CC.resolveEvent(w.state, w.p, "r1", "detour", {});
  check(blk.events[0].done, "finding a way around clears it");
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
