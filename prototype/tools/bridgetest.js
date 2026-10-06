// Headless checks for bridges and roads (sim/combat.js layRoad, sim/locks.js "car", sim/parties.js bridgeClosedTo):
//   - a bridge tile's raid map: the river across it, the deck between railings, the ways in at both ends, cars on the
//     deck as containers, some locked; every container reachable; a locked car cannot be keyed, breaking its glass
//     wakes the dead nearby
//   - a bridge tile's field battle: the river, and a way over it from one side to the other
//   - a road tile's raid map: a road ROAD.WIDTH wide with cars on it to search
//   - barricades: an outpost may be built on a bridge (not on open water); a base on a bridge closes it to other
//     people's ways but not as a destination, not to its owner and not to allies; a team on its way stops at the
//     foot of a bridge barricaded after it set out; AI groups take bridges when they expand
// Usage: node tools/bridgetest.js [seed] [runs]
import { createWorld, hub, atBase, tickHour } from "../src/sim/world.js";
import { launchExpedition, planPath, missionProblem, spawnAiParty, bridgeHolder, bridgeClosedTo, outpostName, partyTile } from "../src/sim/parties.js";
import { createBattle, registerCombatHandler, CELL, AREAS, raidAreasFor, ROAD, bridgeSpan, combatAct } from "../src/sim/combat.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { LOCKS, openOdds, lockedNear } from "../src/sim/locks.js";
import { GEAR } from "../src/sim/data.js";

const seed0 = Number(process.argv[2] || 11);
const runs = Number(process.argv[3] || 6);
registerCombatHandler("bridgetest", () => {});
let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log(`  FAIL ${what}`); } };
const idx = (b, x, y) => y * b.w + x;

const emptyStock = () => ({ food: 0, water: 0, fuel: 0, meds: 0, ammo: 0, parts: 0, scrap: 0, preserved: 0, jars: 0 });
const baseOn = (state, tile) => { const base = { id: 9000 + state.bases.length, tile, type: "outpost", name: outpostName(state, tile), stock: emptyStock(), radio: false, watchtower: false, buildings: [], construction: [], armory: [] }; state.bases.push(base); return base; };
const raidOn = (state, tile, withVehicle = false) => {
  const h = hub(state);
  const crew = atBase(state, h.id).slice(0, 3);
  // Nobody carries a pry tool: the only way into a locked car without picks is through the glass.
  for (const s of crew) { for (const slot of Object.keys(s.gear)) if (s.gear[slot] && GEAR[s.gear[slot].key] && GEAR[s.gear[slot].key].pry) s.gear[slot] = null; if (s.pack) s.pack = s.pack.filter((it) => !(GEAR[it.key] && GEAR[it.key].pry) && it.key !== "crowbar"); }
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", vehicleId: withVehicle ? state.vehicles[0].id : null, supplies: { food: 6, water: 6, ammo: 30, meds: 1 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.phase = "engaged";
  const groups = raidEnemies(state, tile);
  state.combat = createBattle(state, { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "bridgetest", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: 5 }, context: {} });
  return state.combat;
};

let bridgesSeen = 0, lockedCars = 0, carBoxes = 0, glassTries = 0, glassWoke = 0, aiBridges = 0, worldsWithAiBridge = 0;
for (let i = 0; i < runs; i++) {
  const seed = seed0 + i;
  const state = createWorld({ seed, factionCount: 7 });
  const bridges = state.tiles.filter((t) => t.bridge);
  console.log(`seed ${seed}: ${bridges.length} bridge tile${bridges.length === 1 ? "" : "s"}`);
  if (!bridges.length) continue;
  bridgesSeen++;
  const h = hub(state);
  const bt = bridges.reduce((a, t) => (state.grid.distance(t.id, h.tile) < state.grid.distance(a.id, h.tile) ? t : a), bridges[0]);
  check(raidAreasFor(bt) === AREAS.roadcars ? false : raidAreasFor(bt).includes("roadcars"), "a bridge's raid areas are the cars on it");

  // ---- the bridge's raid map ----
  {
    const b = raidOn(state, bt.id);
    const cells = b.cells;
    const water = cells.filter((c) => c.k === "water").length, rails = cells.filter((c) => c.k === "rail").length;
    const deck = cells.filter((c) => c.deck && c.k !== "rail");
    check(water > b.h * 3, `river on the bridge raid map (${water} water cells)`);
    check(rails >= bridgeSpan(b.w), `railings along the deck (${rails})`);
    check(deck.length === ROAD.WIDTH * bridgeSpan(b.w), `deck is ${ROAD.WIDTH} × ${bridgeSpan(b.w)} (${deck.length})`);
    check(deck.every((c) => c.f === "road"), "deck cells are road");
    check(b.raid.zones.length === 2 && b.raid.zones.every((z) => z.side === "west" || z.side === "east"), `ways in at both ends only (${b.raid.zones.map((z) => z.side).join(", ")})`);
    check(bridgeSpan(b.w) >= 12, `the span is 12–24 cells (${bridgeSpan(b.w)} on a ${b.w}-wide map)`);
    // The road runs from edge to edge through its own rows whatever the cars on it (layRoad: cars never close it).
    const deckRows = [...new Set(deck.map((c) => Math.floor(cells.indexOf(c) / b.w)))].sort((a, c) => a - c);
    const roadThrough = () => {
      const seen = new Set(), q = [];
      for (const y of deckRows) if (CELL[cells[idx(b, 0, y)].k].walk) { seen.add(idx(b, 0, y)); q.push([0, y]); }
      while (q.length) { const [x, y] = q.pop(); if (x === b.w - 1) return true; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || nx >= b.w || !deckRows.includes(ny) || seen.has(idx(b, nx, ny)) || !CELL[cells[idx(b, nx, ny)].k].walk) continue; seen.add(idx(b, nx, ny)); q.push([nx, ny]); } }
      return false;
    };
    check(roadThrough(), "the road runs end to end past the cars on it");
    // Cars are 2 × 3–4 cells, every cell a piece of one car, with a free ring round each.
    const carCells = cells.filter((c) => c.k === "car" || c.k === "truck");
    check(carCells.length > 0 && carCells.every((c) => c.car && c.car.L >= 3 && c.car.L <= 4), `every car cell is part of a 2 × 3–4 car (${carCells.length} cells)`);
    const carIds = new Set(carCells.map((c) => c.car.id));
    check([...carIds].every((id) => { const n = carCells.filter((c) => c.car.id === id).length; return n === 6 || n === 8; }), `each car has 6 or 8 cells (${carIds.size} cars)`);
    // Containers: cars on the road, some on the deck, all reachable from the way in.
    const cars = b.raid.containers.filter((c) => c.kind === "car");
    check(cars.every((c) => c.w * c.h === 6 || c.w * c.h === 8), "car containers cover their car's cells");
    carBoxes += cars.length;
    check(cars.length >= 3, `cars to search on the bridge map (${cars.length})`);
    const onRoad = cars.filter((c) => cells[idx(b, c.x, c.y)].f === "road").length;
    check(onRoad >= 3, `cars stand on the road (${onRoad} of ${cars.length})`);
    check(cars.some((c) => cells[idx(b, c.x, c.y)].deck), "some cars stand on the deck itself");
    const near = (c) => [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].some(([dx, dy]) => c.x + dx >= 0 && c.y + dy >= 0 && c.x + dx < b.w && c.y + dy < b.h && b.reach[idx(b, c.x + dx, c.y + dy)]);
    check(b.raid.containers.every(near), "every container can be reached");
    // From the west end to the east end over the deck.
    const east = b.raid.zones.find((z) => z.side === "east");
    check(east && b.reach[idx(b, east.x0 + 1, east.y0 + 1)], "the far end is reachable over the deck");
    const locked = cars.filter((c) => c.lock && c.lock.kind === "car");
    lockedCars += locked.length;
    for (const c of locked) check(c.label.includes("locked car"), `a locked car is labelled so (${c.label})`);
    // Open a locked car without picks or a crowbar: no key fits, the way in is through the glass, and the crash wakes
    // the unaware dead within SMASH.radius.
    const u = b.units.find((x) => x.side === "player" && x.hp > 0);
    if (locked.length && u) {
      const c = locked[0];
      const spot = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => [c.x + dx, c.y + dy]).find(([x, y]) => x >= 0 && y >= 0 && x < b.w && y < b.h && CELL[cells[idx(b, x, y)].k].walk && !b.units.some((o) => o.x === x && o.y === y));
      if (spot) {
        u.x = spot[0]; u.y = spot[1]; u.ap = 2;
        const o = openOdds(state, b, u, c.lock);
        check(!o.key.ok && /keys/.test(o.key.why), "no key opens a car");
        check(o.force.glass && o.force.label === "Break glass" && o.force.ap === 2, `the no-crowbar way is the glass (${o.force.label}, ${o.force.ap} actions)`);
        check(lockedNear(b, u).some((t) => t.ref === `c${c.id}`), "the locked car is offered from next to it");
        // A sleeping zombie 6 tiles off hears the glass.
        const z = b.units.find((x) => x.side === "enemy" && x.kind === "zombie") || b.units.find((x) => x.side === "enemy");
        if (z) {
          z.aware = false; z.hp = Math.max(1, z.hp);
          const zx = Math.max(0, Math.min(b.w - 1, c.x + 6)), zy = c.y;
          z.x = zx; z.y = zy;
          let err = null, tries = 0;
          while (tries++ < 6 && !c.lock.open) { u.ap = 2; err = combatAct(state, { type: "open", unit: u.id, target: `c${c.id}`, method: "force" }); if (err) break; }
          glassTries++;
          check(!err, `breaking the glass is a legal action (${err || "ok"})`);
          if (z.aware) glassWoke++;
          check(z.aware, "breaking glass wakes the dead nearby");
          if (c.lock.open) check(c.lock.how === "smash", `opened through the glass (${c.lock.how})`);
        }
      }
    }
    state.combat = null;
  }

  // ---- the bridge's field battle ----
  {
    const b = createBattle(state, { tile: bt.id, baseId: h.id, fighterIds: atBase(state, h.id).slice(0, 5).map((s) => s.id), enemy: { kind: "zombies", count: 10, power: 3 }, ambush: null, canRetreat: true, handler: "bridgetest", context: {} });
    const water = b.cells.filter((c) => c.k === "water").length, deck = b.cells.filter((c) => c.deck && c.k !== "rail").length;
    check(water > b.h * 2, `river on the field map (${water})`);
    check(deck === ROAD.WIDTH * bridgeSpan(b.w), `field deck ${ROAD.WIDTH} × ${bridgeSpan(b.w)} (${deck})`);
    const mid = Math.floor(b.h / 2);
    check(b.reach[idx(b, b.w - 1, mid)], "the far side is reachable over the field deck");
    const carved = b.cells.filter((c) => c.deck && c.k === "open" && c.f !== "road").length;
    check(carved === 0, "no lane was carved through the river");
    state.combat = null;
  }

  // ---- a bare road tile's raid map ----
  {
    const rt = state.tiles.find((t) => t.road && !t.bridge && !t.loc && t.terrain !== "water" && t.id !== h.tile && state.grid.distance(t.id, h.tile) > 1);
    if (rt) {
      check(raidAreasFor(rt).includes("roadcars"), "a bare road's raid areas are the cars on it");
      const b = raidOn(state, rt.id, true);
      const roadRows = new Set();
      for (let y = 0; y < b.h; y++) if (b.cells.slice(y * b.w, y * b.w + b.w).filter((c) => c.f === "road").length > b.w / 2) roadRows.add(y);
      check(roadRows.size === ROAD.WIDTH, `the road is ${ROAD.WIDTH} rows wide (${roadRows.size})`);
      const cars = b.raid.containers.filter((c) => c.kind === "car" && b.raid.areas[c.area].type === "roadcars");
      carBoxes += cars.length;
      lockedCars += cars.filter((c) => c.lock && c.lock.kind === "car").length;
      check(cars.length >= 3, `cars on the road to search (${cars.length})`);
      check(cars.every((c) => b.cells[idx(b, c.x, c.y)].f === "road"), "road cars stand on the road");
      check(b.cells.every((c) => c.k !== "water"), "no river on a plain road tile");
      state.combat = null;
    } else console.log("  (no bare road tile to test)");
  }

  // ---- barricades ----
  {
    const open = state.tiles.find((t) => t.terrain === "water" && !t.bridge);
    if (open) check(/open water/.test(missionProblem(state, open.id, "outpost") || ""), "no outpost on open water");
    check(missionProblem(state, bt.id, "outpost") === null, `an outpost may be built on a bridge (${missionProblem(state, bt.id, "outpost")})`);
    check(missionProblem(state, bt.id, "scavenge") === null, "a bridge may be searched");
    const [a, c] = bt.roadLinks;
    const f = state.factions.find((x) => x.alive);
    if (a != null && c != null && f) {
      const before = planPath(state, a, c, false, f.id);
      check(before && before.path.includes(bt.id), "before the barricade a group's way runs over the bridge");
      const base = baseOn(state, bt.id);
      check(/Bridge Barricade$/.test(base.name), `named for the bridge (${base.name})`);
      check(bridgeHolder(state, bt.id) === "player", "you hold the bridge");
      check(bridgeClosedTo(state, bt.id, f.id) && !bridgeClosedTo(state, bt.id, "player") && !bridgeClosedTo(state, bt.id, undefined), "closed to a group, open to you and to nobody in particular");
      const after = planPath(state, a, c, false, f.id);
      check(!after || !after.path.includes(bt.id), "a group's way no longer runs over your barricade");
      const yours = planPath(state, a, c, false, "player");
      check(yours && yours.path.includes(bt.id), "your own way still runs over it");
      const dest = planPath(state, a, bt.id, false, f.id);
      check(dest && dest.path[dest.path.length - 1] === bt.id, "the barricade itself can still be a destination (a raid on it)");
      state.alliance = { members: [f.id] };
      check(!bridgeClosedTo(state, bt.id, f.id), "open to an ally");
      state.alliance = null;
      // The other way round: their barricade closes the bridge to you, and to another group.
      state.bases.pop();
      f.bases.push(bt.id);
      check(bridgeHolder(state, bt.id) === f.id && bridgeClosedTo(state, bt.id, "player"), "a group's barricade is closed to you");
      const g2 = state.factions.find((x) => x.alive && x.id !== f.id);
      if (g2) check(bridgeClosedTo(state, bt.id, g2.id), "and to another group");
      const party = spawnAiParty(state, g2 || f, "raid", a, c, { strength: 3 });
      if (party) check(!party.path.includes(bt.id) || (g2 == null), "a group's party routes around the barricade");
      if (party) state.parties.splice(state.parties.indexOf(party), 1);
      f.bases.pop();
    }
  }

  // ---- a team on its way over a bridge that is barricaded after it set out stops at the foot and waits ----
  {
    const st = createWorld({ seed: seed + 900, factionCount: 7 });
    const h3 = hub(st), f3 = st.factions.find((x) => x.alive);
    // A bridge the hub's way to the far bank really uses.
    let pick = null;
    for (const t of st.tiles.filter((x) => x.bridge && x.roadLinks.length === 2).sort((p, q) => st.grid.distance(p.id, h3.tile) - st.grid.distance(q.id, h3.tile))) {
      const [a, c] = t.roadLinks;
      const to = st.grid.distance(a, h3.tile) <= st.grid.distance(c, h3.tile) ? c : a;
      const r = planPath(st, h3.tile, to, false, "player");
      if (r && r.path.includes(t.id) && to !== h3.tile && r.cost <= 40) { pick = { t, to }; break; } // a trip of a day or two: the team gets there alive
    }
    if (pick && f3) {
      const crew = atBase(st, h3.id).slice(0, 2).map((s) => s.id);
      const res = launchExpedition(st, { memberIds: crew, dest: pick.to, mission: "move", stance: "normal", vehicleId: null, supplies: { food: 10, water: 10, ammo: 10, meds: 1 } });
      if (!res.error) {
        const p = res.party;
        st.autoCombat = true;
        f3.bases.push(pick.t.id); // barricaded while the team is on the road
        let guard = 0;
        while (st.parties.includes(p) && (p.phase === "out" || p.phase === "engaged") && guard++ < 24 * 20) tickHour(st); // engaged: a fight on the road, auto-resolved
        if (!st.parties.includes(p)) console.log("  (the team was lost on the road before the bridge; stop-short check skipped)");
        else {
          const here = partyTile(p);
          check(here !== pick.t.id && here !== pick.to && pick.t.roadLinks.includes(here), `the team stopped at the foot of the bridge (tile ${here}, bridge ${pick.t.id}, goal ${pick.to}, phase ${p.phase})`);
          const said = st.cards.map((c) => JSON.stringify(c)).join(" "); // awaitOrders: an orders card for the team
          check(/barricaded the bridge/.test(said), `told why on its orders card (${said.slice(0, 160)})`);
        }
      } else console.log(`  (could not launch the stop-short team: ${res.error})`);
    } else console.log("  (no bridge on the hub's way to a far bank; stop-short check skipped)");
  }

  // ---- AI groups barricade bridges when they expand (a season of play) ----
  {
    const st2 = createWorld({ seed: seed + 500, factionCount: 8 });
    st2.autoCombat = true;
    const nb = st2.tiles.filter((t) => t.bridge).length;
    if (nb) {
      for (let hr = 0; hr < 24 * 150; hr++) tickHour(st2);
      const taken = st2.factions.flatMap((f) => f.bases).filter((id) => st2.tiles[id].bridge).length;
      aiBridges += taken;
      if (taken) worldsWithAiBridge++;
      console.log(`  AI groups hold ${taken} of ${nb} bridges after 150 days`);
    }
  }
}

console.log(`\n${bridgesSeen} worlds with bridges; ${carBoxes} road cars as containers, ${lockedCars} locked (${carBoxes ? Math.round((100 * lockedCars) / carBoxes) : 0}%); glass broken ${glassTries}×, woke the dead ${glassWoke}×; AI bridge barricades ${aiBridges} in ${worldsWithAiBridge} world(s)`);
check(bridgesSeen > 0, "at least one world had a bridge");
check(lockedCars > 0, "some cars were locked");
console.log(fails ? `\n${fails} check(s) FAILED` : "\nbridgetest: all checks passed");
process.exit(fails ? 1 : 0);
