// The abandoned Army convoy against a National Guard base (sim/miltrucks.js CONVOY, CONVOY_GUARD): what a team of four
// brings back and what it costs, a few seeds each.
//   raid    the raid map played by the bot (combat.js autoPlayerTurn): the value that made it into the cargo
//           (supplies at data.js values, gear at valuation.js itemValue: condition counts), deaths, hit points lost,
//           the share of raids anyone got out of, the dead soldiers met (placed at the start and risen from the cabs),
//           the raid's Heat at the end
//   search  the hour-by-hour search (scavenge.js, "normal", out at Heat 50 or after 8 hours)
//   ai      an AI group's salvage party reaching the convoy (miltrucks.js convoysHour → stripConvoy): the share of its
//           people lost to the guards
// Usage: node tools/convoyvalue.js [seeds = 8] [first seed = 21]
import { createWorld, hub, atBase, supplyValue } from "../src/sim/world.js";
import { launchExpedition, spawnAiParty, partyMembers } from "../src/sim/parties.js";
import { createBattle, autoPlayerTurn, runEnemyPhase, registerCombatHandler, combatAct, CELL } from "../src/sim/combat.js";
import { raidEnemies, startScavenge, searchHour, extract } from "../src/sim/scavenge.js";
import { spawnConvoy, convoysHour, convoyById, trucksAt } from "../src/sim/miltrucks.js";
import { itemValue } from "../src/sim/valuation.js";

const N = Number(process.argv[2] || 8);
const S0 = Number(process.argv[3] || 21);
registerCombatHandler("cv", () => {});
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };
const cargoValue = (p) => supplyValue(p.cargo.supplies) + p.cargo.gear.reduce((a, g) => a + itemValue(g), 0);
const road = (st) => st.tiles.filter((t) => t.road && !t.loc && !t.bridge && !t.hive && t.terrain !== "water" && !trucksAt(st, t.id).length && !st.bases.some((b) => b.tile === t.id) && !st.factions.some((f) => f.bases.includes(t.id)));

function world(seed, kind) {
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true;
  st.cards.length = 0;
  const h = hub(st);
  let tile;
  if (kind === "base") tile = st.militaryIds.find((id) => id !== h.tile);
  else {
    const cands = road(st).sort((a, b) => st.grid.distance(a.id, h.tile) - st.grid.distance(b.id, h.tile)).filter((t) => st.grid.distance(t.id, h.tile) >= 3);
    if (!cands.length) return null;
    const c = spawnConvoy(st, { tile: cands[0].id, witness: { tile: h.tile, label: "test", from: "base" }, noCard: true });
    tile = c && c.tile;
  }
  return tile == null ? null : { st, tile };
}
function team(st, tile, n = 4) {
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, n);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4, ammo: 40, meds: 2 } });
  if (res.error) return null;
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.phase = "engaged";
  return { p, crew };
}

function raid(seed, kind) {
  const w = world(seed, kind);
  if (!w) return null;
  const { st, tile } = w;
  const t = team(st, tile);
  if (!t) return null;
  const { p, crew } = t;
  const hp0 = crew.reduce((a, s) => a + s.health, 0);
  const v0 = cargoValue(p);
  const b = inBrowser(() => createBattle(st, { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "cv", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(st, tile) }, raid: { heat0: 5, building: "street" }, context: {} }));
  st.combat = b;
  const soldiers0 = b.units.filter((u) => u.ztype === "soldier").length;
  let g = 0;
  while (!b.over && g++ < 250) { autoPlayerTurn(st); runEnemyPhase(st); }
  if (!b.over) return null;
  const out = b.result.outcome === "extracted";
  const soldiers = b.units.filter((u) => u.ztype === "soldier").length;
  return { value: out ? cargoValue(p) - v0 : 0, dead: b.result.survivorsDead.length, hpLost: Math.max(0, hp0 - crew.reduce((a, s) => a + Math.max(0, s.alive ? s.health : 0), 0)), out: out ? 1 : 0, soldiers, risen: soldiers - soldiers0, heat: b.raid.heat, turns: b.turn };
}

function search(seed, kind) {
  const w = world(seed, kind);
  if (!w) return null;
  const { st, tile } = w;
  const t = team(st, tile);
  if (!t) return null;
  const { p, crew } = t;
  const hp0 = crew.reduce((a, s) => a + s.health, 0);
  const v0 = cargoValue(p);
  if (!startScavenge(st, p)) return null;
  const e = st.engagement;
  e.approach = "normal";
  let heat = 0;
  for (let h = 0; h < 8 && st.engagement && !e.done; h++) { searchHour(st); heat = e.heat; if (e.heat >= 50) break; }
  if (st.engagement && !e.done) extract(st);
  const alive = crew.filter((x) => x.alive).length;
  return { value: st.parties.includes(p) ? cargoValue(p) - v0 : 0, dead: crew.length - alive, hpLost: Math.max(0, hp0 - crew.reduce((a, s) => a + Math.max(0, s.alive ? s.health : 0), 0)), out: alive ? 1 : 0, heat };
}

// An AI group's salvage party at the convoy (the race): the people it loses there.
function ai(seed) {
  const w = world(seed, "convoy");
  if (!w) return null;
  const { st, tile } = w;
  const c = st.convoys[st.convoys.length - 1];
  const f = st.factions.find((x) => x.alive && x.bases.length && !x.bases.includes(tile));
  if (!f) return null;
  const q = spawnAiParty(st, f, "salvage", f.bases[0], tile, { strength: Math.max(3, Math.round(f.pop * 0.25)) });
  if (!q) return null;
  q.convoy = c.id;
  q.path = [tile]; q.idx = 0;
  const pop0 = f.pop, str0 = q.strength;
  convoysHour(st);
  const cc = convoyById(st, c.id);
  return { lost: Math.max(0, pop0 - f.pop), share: str0 ? Math.max(0, (str0 - (q.strength ?? str0)) / str0) : 0, stripped: cc ? cc.stripped : 0, trucks: c.trucks };
}

// Everything on the street map (every container opened, the trucks too; the miltrucktest.js base check): what the site
// holds, and the dead soldiers met once every cab has emptied; the raid's Heat after it all (no turns passed).
function haul(seed, kind) {
  const w = world(seed, kind);
  if (!w) return null;
  const { st, tile } = w;
  const t = team(st, tile);
  if (!t) return null;
  const b = inBrowser(() => createBattle(st, { mode: "raid", tile, partyId: t.p.id, canRetreat: true, ambush: null, handler: "cv", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(st, tile) }, raid: { heat0: 5, building: "street" }, context: {} }));
  st.combat = b;
  b.raid.choose = null;
  const enemies0 = b.units.filter((u) => u.side === "enemy").length, heat0 = b.raid.heat;
  const u = b.units.find((x) => x.side === "player");
  let value = 0, trucks = 0;
  for (const c of b.raid.containers) {
    if (c.kind === "body") continue;
    if (c.lock) c.lock.open = true;
    let at = null;
    for (let y = c.y - 1; y <= c.y + (c.h || 1) && !at; y++) for (let x = c.x - 1; x <= c.x + (c.w || 1) && !at; x++) if (x >= 0 && y >= 0 && x < b.w && y < b.h && CELL[b.cells[y * b.w + x].k].walk && !b.units.some((o) => o !== u && !o.dead && o.x === x && o.y === y)) at = [x, y];
    if (!at) continue;
    [u.x, u.y] = at; u.ap = 2; b.phase = "player";
    if (combatAct(st, { type: "search", unit: u.id, box: c.id, open: true }) || !c.contents) continue;
    if (c.truck) trucks++;
    value += supplyValue(c.contents.sup || {}) + (c.contents.gear || []).reduce((a, g) => a + itemValue(g), 0);
  }
  const soldiers = b.units.filter((x) => x.ztype === "soldier").length;
  st.combat = null;
  return { value, trucks, enemies0, enemies: b.units.filter((x) => x.side === "enemy").length, soldiers, heat0, heat: b.raid.heat };
}

const sum = (list, k) => list.reduce((a, r) => a + (r[k] || 0), 0);
const avg = (list, k) => (list.length ? sum(list, k) / list.length : 0);
const t0 = performance.now();
const res = {};
for (const kind of ["convoy", "base"]) {
  res[kind] = { raid: [], search: [], haul: [] };
  for (let i = 0; i < N; i++) {
    const hl = haul(S0 + i, kind); if (hl) res[kind].haul.push(hl);
    const r = raid(S0 + i, kind); if (r) res[kind].raid.push(r);
    const s = search(S0 + i, kind); if (s) res[kind].search.push(s);
  }
}
for (const kind of ["convoy", "base"]) {
  const R = res[kind].raid, S = res[kind].search, H = res[kind].haul;
  console.log(`${kind === "convoy" ? "Army convoy" : "National Guard base"}`);
  console.log(`  holds   n ${H.length}  value ${Math.round(avg(H, "value"))} (${avg(H, "trucks").toFixed(1)} trucks)  the dead at the start ${avg(H, "enemies0").toFixed(1)}, after every truck opened ${avg(H, "enemies").toFixed(1)} (${avg(H, "soldiers").toFixed(1)} soldiers)  Heat at the start ${Math.round(avg(H, "heat0"))}, after ${Math.round(avg(H, "heat"))}`);
  console.log(`  raid    n ${R.length}  value ${Math.round(avg(R, "value"))}  deaths ${avg(R, "dead").toFixed(2)}  hp lost ${Math.round(avg(R, "hpLost"))}  got out ${Math.round(100 * avg(R, "out"))}%  dead soldiers ${avg(R, "soldiers").toFixed(1)} (${avg(R, "risen").toFixed(1)} from the cabs)  Heat ${Math.round(avg(R, "heat"))}  turns ${Math.round(avg(R, "turns"))}`);
  console.log(`  search  n ${S.length}  value ${Math.round(avg(S, "value"))}  deaths ${avg(S, "dead").toFixed(2)}  hp lost ${Math.round(avg(S, "hpLost"))}  Heat ${Math.round(avg(S, "heat"))}`);
}
const ratio = (m, k) => (avg(res.base[m], k) ? avg(res.convoy[m], k) / avg(res.base[m], k) : 0);
console.log(`Convoy / base: holds ${Math.round(100 * ratio("haul", "value"))}% of the value with ${Math.round(100 * ratio("haul", "enemies"))}% of the dead; raid value ${Math.round(100 * ratio("raid", "value"))}%, raid deaths ${Math.round(100 * ratio("raid", "dead"))}%, raid hp lost ${Math.round(100 * ratio("raid", "hpLost"))}%; search value ${Math.round(100 * ratio("search", "value"))}%, search hp lost ${Math.round(100 * ratio("search", "hpLost"))}%`);
const A = [];
for (let i = 0; i < N; i++) { const a = ai(S0 + i); if (a) A.push(a); }
console.log(`AI salvage parties: n ${A.length}, ${avg(A, "trucks").toFixed(1)} trucks, people lost ${avg(A, "lost").toFixed(2)}, party strength lost ${Math.round(100 * avg(A, "share"))}%, stripped ${avg(A, "stripped").toFixed(2)}`);
console.log(`(${Math.round(performance.now() - t0)} ms)`);
