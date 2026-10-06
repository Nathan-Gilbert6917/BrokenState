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
import { createBattle, registerCombatHandler, CELL, AREAS, raidAreasFor, ROAD, bridgeSpan, combatAct, bash } from "../src/sim/combat.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { LOCKS, openOdds, lockedNear } from "../src/sim/locks.js";
import { GEAR } from "../src/sim/data.js";
import { atVehicle } from "../src/sim/raidloot.js";
import { newItem } from "../src/sim/inventory.js";
import { addBuilding } from "../src/sim/buildings.js";
import { DEPLOY } from "../src/sim/deploy.js";
import { makeHorde, hordesHour } from "../src/sim/hordes.js";

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

// ---- the team's vehicle on the map: 2 × 3–4 cells, driven about, the loot and the ram in it; extraction follows it ----
{
  const state = createWorld({ seed: seed0 + 77, factionCount: 7 });
  const h = hub(state);
  const rt = state.tiles.find((t) => t.road && !t.bridge && !t.loc && t.terrain !== "water" && t.id !== h.tile && state.grid.distance(t.id, h.tile) > 1);
  if (rt && state.vehicles[0]) {
    const b = raidOn(state, rt.id, true);
    const v = b.vehicle;
    check(!!v && v.w * v.h >= 6 && (v.kind === "car" || v.kind === "truck"), `the team's ${v ? v.kind : "vehicle"} covers ${v ? v.w + "×" + v.h : "?"} cells in the entry zone`);
    if (v) {
      const vcells = b.cells.filter((c) => c.k === "vehicle");
      check(vcells.length === v.w * v.h && vcells.every((c) => c.car && c.car.kind === "vehicle"), `its cells are one vehicle (${vcells.length})`);
      check(b.raid.hasVehicle && b.raid.vehicleZone === 0 && b.raid.zones[0].vehicle, "it stands at the entry zone");
      const u = b.units.find((x) => x.side === "player" && atVehicle(b, x));
      check(!!u, "someone starts next to it");
      if (u) {
        // The rest of the team steps out of the way first (they start in the zone beside it), then drive it east along
        // the road a few cells, and back to the zone.
        const park = [];
        for (let y = 0; y < b.h && park.length < 6; y++) for (let x = v.x + 10; x < Math.min(b.w, v.x + 16) && park.length < 6; x++) if (CELL[b.cells[y * b.w + x].k].walk && !b.units.some((o) => o.x === x && o.y === y)) park.push([x, y]);
        for (const o of b.units.filter((o) => o.side === "player" && o !== u)) { const s = park.shift(); if (s) { o.x = s[0]; o.y = s[1]; } }
        let drove = "";
        const x0 = v.x, y0 = v.y;
        for (const dx of [4, 3, 5, 2, 6]) { u.ap = 2; drove = combatAct(state, { type: "drive", unit: u.id, x: x0 + dx + Math.floor((v.w - 1) / 2), y: y0 + Math.floor((v.h - 1) / 2) }); if (!drove) break; }
        check(!drove, `it can be driven (${drove || "ok"})`);
        if (!drove) {
          check(v.x !== x0 && b.cells.filter((c) => c.k === "vehicle").length === v.w * v.h && b.cells[y0 * b.w + x0].k !== "vehicle", `it moved (${x0},${y0} → ${v.x},${v.y}) and its old cells are open`);
          check(atVehicle(b, u) && u.ap === 0, "the driver rides along and steps off next to it, both actions spent");
          check(b.raid.vehicleZone === -1 || b.raid.zones[b.raid.vehicleZone].vehicle, `the vehicle zone follows it (${b.raid.vehicleZone})`);
          check(b.raid.heat > 5, `the engine is loud (Heat ${b.raid.heat})`);
          let back = "";
          for (let i = 0; i < 4 && v.x !== x0; i++) { u.ap = 2; back = combatAct(state, { type: "drive", unit: u.id, x: x0 + Math.floor((v.w - 1) / 2), y: y0 + Math.floor((v.h - 1) / 2) }); if (back) break; }
          check(!back && v.x === x0 && v.y === y0 && b.raid.vehicleZone === 0, `driven back to the zone (${back || "ok"}, zone ${b.raid.vehicleZone})`);
          // Extracting from the zone it stands at keeps it.
          const z = b.raid.zones[0];
          const spot = [];
          for (let y = z.y0; y < z.y0 + z.h; y++) for (let x = z.x0; x < z.x0 + z.w; x++) if (CELL[b.cells[y * b.w + x].k].walk && !b.units.some((o) => o.x === x && o.y === y)) spot.push([x, y]);
          if (spot.length) { u.x = spot[0][0]; u.y = spot[0][1]; u.ap = 2; const e = combatAct(state, { type: "extract", unit: u.id }); check(!e && u.left && u.exitVehicle, `extracting there is extracting with the vehicle (${e || "ok"})`); }
        }
      }
    }
    state.combat = null;
  } else console.log("  (no road tile or vehicle for the drive check)");
}

// ---- the ram rides in the vehicle on an assault, unloaded next to it ----
{
  const state = createWorld({ seed: seed0 + 78, factionCount: 7 });
  const h = hub(state);
  const tile = state.tiles.find((t) => t.road && !t.loc && t.terrain !== "water" && t.id !== h.tile && state.grid.distance(t.id, h.tile) > 1) || state.tiles.find((t) => t.id !== h.tile && t.terrain !== "water");
  const crew = atBase(state, h.id).slice(0, 4).map((s) => s.id);
  const res = launchExpedition(state, { memberIds: crew, dest: tile.id, mission: "move", stance: "normal", vehicleId: state.vehicles[0] ? state.vehicles[0].id : null, supplies: { food: 6, water: 6, ammo: 30, meds: 1 } });
  if (!res.error && state.vehicles[0]) {
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    p.cargo = p.cargo || { supplies: {}, gear: [] };
    p.cargo.gear.push(newItem("ram", 1));
    const b = state.combat = createBattle(state, { tile: tile.id, partyId: p.id, enemy: { kind: "raiders", count: 4, power: 3, walls: 2 }, ambush: null, canRetreat: true, handler: "bridgetest", layout: "baseAssault", context: {} });
    check(!!b.vehicle, "the team's vehicle stands on the assault map");
    const r = (b.rams || []).find((x) => x.side === "player");
    check(!!r && r.inVehicle && !r.crew.length, `the ram rides in the vehicle (${r ? (r.inVehicle ? "in it" : "carried by " + r.crew.length) : "no ram"})`);
    const u = b.units.find((x) => x.side === "player" && b.vehicle && atVehicle(b, x)) || b.units.find((x) => x.side === "player");
    if (u && b.vehicle && r) {
      if (!atVehicle(b, u)) { u.x = b.vehicle.x - 1; u.y = b.vehicle.y; }
      u.ap = 2;
      const e1 = combatAct(state, { type: "unloadRam", unit: u.id });
      check(!e1 && r.dropped && !r.inVehicle && r.x === u.x && r.y === u.y, `unloaded next to the vehicle (${e1 || "ok"})`);
      u.ap = 2;
      const e2 = combatAct(state, { type: "loadRam", unit: u.id });
      check(!e2 && r.inVehicle && !r.dropped, `loaded back in (${e2 || "ok"})`);
      check(!b.units.some((x) => x.side === "player" && x.ram != null), "nobody is slowed by carrying it");
    }
    state.combat = null;
  } else console.log(`  (ram check skipped: ${res.error || "no vehicle"})`);
}

// ---- a bridge barricade's battle map: the wall across the deck only, tank traps in front that can be battered down ----
{
  const state = createWorld({ seed: seed0 + 79, factionCount: 6 });
  const h = hub(state);
  const bt = state.tiles.filter((t) => t.bridge).sort((a, c) => state.grid.distance(a.id, h.tile) - state.grid.distance(c.id, h.tile))[0];
  if (bt) {
    const base = baseOn(state, bt.id);
    for (const t of ["walls", "walls", "gate"]) addBuilding(base, t);
    for (const s of atBase(state, h.id).slice(0, 5)) s.location = { kind: "base", baseId: base.id };
    globalThis.window = {};
    let b;
    try { b = state.combat = createBattle(state, { tile: bt.id, baseId: base.id, enemy: { kind: "zombies", count: 12, power: 3 }, ambush: null, canRetreat: true, handler: "bridgetest", layout: "baseDefence", deploy: true, context: { through: 50 } }); } finally { delete globalThis.window; }
    const X = DEPLOY.WALL_X;
    const col = (x) => { const out = []; for (let y = 0; y < b.h; y++) out.push(b.cells[y * b.w + x]); return out; };
    const wallCol = col(X);
    const walls = wallCol.filter((c) => c.k === "palisade" || c.k === "gate" || c.k === "breach");
    const water = wallCol.filter((c) => c.k === "water").length;
    check(walls.length > 0 && walls.every((c) => c.deck), `the wall stands on the deck only (${walls.length} sections, ${water} river cells in the line)`);
    check(water >= b.h / 3, "the river is the rest of the line");
    check(wallCol.some((c) => c.k === "gate" && c.deck), "the gate is on the deck");
    const traps = b.cells.filter((c) => c.k === "tanktrap");
    check(traps.length >= 4 && traps.every((c) => c.deck && c.hp > 0), `tank traps on the deck in front (${traps.length})`);
    const inFront = traps.every((c) => (b.cells.indexOf(c) % b.w) > X);
    check(inFront, "the traps are in front of the wall");
    check(traps.every((c) => CELL[c.k].walk), "people walk between them");
    // Battered down from next to it: open ground again.
    const t0 = traps[0];
    if (t0) {
      const i = b.cells.indexOf(t0), tx = i % b.w, ty = Math.floor(i / b.w);
      const fake = { id: 9999, side: "player", kind: "human", name: "Tester", x: tx + 1, y: ty, hp: 100, armor: 1, ap: 2, weapon: null, mob: 5 };
      let n = 0;
      while (t0.hp > 0 && n++ < 20) bash(b, fake, tx, ty);
      check(t0.hp <= 0 && t0.k === "rubble" && n < 20, `a tank trap is battered down in ${n} blows (now ${t0.k})`);
    }
    state.combat = null;
  } else console.log("  (no bridge for the barricade map check)");
}

// ---- hordes: a barricaded bridge stops them and they attack the barricade instead ----
{
  const state = createWorld({ seed: seed0 + 80, factionCount: 6 });
  const h = hub(state);
  let done = false;
  for (const bt of state.tiles.filter((t) => t.bridge && t.roadLinks.length === 2)) {
    const [a, c] = bt.roadLinks;
    const before = planPath(state, a, c, false, undefined);
    if (!before || !before.path.includes(bt.id)) continue;
    baseOn(state, bt.id);
    const other = planPath(state, a, c, false, "nobody"); // any way round that avoids the barricade?
    const hd = makeHorde(state, { tile: a, size: 60, target: c, role: "roam" });
    state.hordes.push(hd);
    hd.move = 1000;
    state.autoCombat = true;
    hordesHour(state);
    const h2 = state.hordes.find((x) => x.id === hd.id);
    if (h2 && h2.tile !== a) { // it stepped: the way must not run through the barricade unless the barricade is its goal
      check(h2.tile !== bt.id || h2.role === "attack", `a horde never steps onto a barricade on its way (role ${h2.role}, target ${h2.target})`);
    }
    const otherWay = other && other.path.every((id) => id === bt.id ? false : true) && other.path.length > 1;
    if (!otherWay) check(h2 && h2.role === "attack" && h2.target === bt.id && h2.goal && h2.goal.tile === bt.id, `with no way round, the horde turns on the barricade (role ${h2 && h2.role}, target ${h2 && h2.target})`);
    else check(h2 && (h2.role !== "attack" || h2.target === bt.id), `with a way round the horde takes it or attacks (role ${h2 && h2.role})`);
    state.hordes.splice(state.hordes.indexOf(h2), 1);
    state.bases.pop();
    done = true;
    break;
  }
  if (!done) console.log("  (no bridge on a road between two banks for the horde check)");
}

// ---- every car on every kind of map is 2 × 3–4 cells (street maps of buildings too) ----
{
  const state = createWorld({ seed: seed0 + 81, factionCount: 7 });
  const h = hub(state);
  let single = 0, multi = 0, maps = 0;
  for (const type of ["town", "autoshop", "gas", "police", "apartments", "truckstop", "airport"]) {
    const t = state.tiles.find((x) => x.loc && x.loc.type === type && x.id !== h.tile);
    if (!t) continue;
    for (const s of atBase(state, h.id)) if (s.location.kind !== "base") s.location = { kind: "base", baseId: h.id };
    const crew = atBase(state, h.id).slice(0, 3).map((s) => s.id);
    if (crew.length < 1) break;
    const res = launchExpedition(state, { memberIds: crew, dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 30, meds: 1 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [t.id]; p.idx = 0; p.phase = "engaged";
    const b = state.combat = createBattle(state, { mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "bridgetest", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(state, t.id) }, raid: { heat0: 5 }, context: {} });
    maps++;
    const all = b.floors ? b.floors.flatMap((F) => F.cells) : b.cells;
    for (const c of all) if (c.k === "car" || c.k === "truck") { if (c.car) multi++; else single++; }
    state.combat = null;
    state.parties.splice(state.parties.indexOf(p), 1);
    for (const id of crew) { const s = state.survivors.find((x) => x.id === id); if (s) s.location = { kind: "base", baseId: h.id }; }
  }
  check(maps > 0 && single === 0 && multi > 0, `cars on ${maps} site maps: ${multi} cells of 2 × 3–4 cars, ${single} single-cell cars`);
}

console.log(`\n${bridgesSeen} worlds with bridges; ${carBoxes} road cars as containers, ${lockedCars} locked (${carBoxes ? Math.round((100 * lockedCars) / carBoxes) : 0}%); glass broken ${glassTries}×, woke the dead ${glassWoke}×; AI bridge barricades ${aiBridges} in ${worldsWithAiBridge} world(s)`);
check(bridgesSeen > 0, "at least one world had a bridge");
check(lockedCars > 0, "some cars were locked");
console.log(fails ? `\n${fails} check(s) FAILED` : "\nbridgetest: all checks passed");
process.exit(fails ? 1 : 0);
