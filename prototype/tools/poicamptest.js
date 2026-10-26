// A camp set up inside a POI mid-raid (src/sim/poicamp.js, issue #70, the heat epic #64 §4 and its build-mode addendum).
// Usage: node tools/poicamptest.js [seed]
// - the 5 × 5: every cell seen (a square under the fog refused), walkable and off the furniture, no hostile in it
// - the supplies: only what the survivors standing inside it carry counts (outside: short); taken when the work starts
// - the work by actions: one worker, two workers (faster), a turn with nobody working leaves it; a hostile inside stops
//   it; the half-built camp kept in the POI's ledger when the raid ends and picked up on the next raid
// - the base official when the work finishes (base.poi, base.poiCamp, the card, the raid goes on)
// - Settle in only after 5 turns with no hostile in sight; a sighting resets the countdown; Settle in moves the team in
// - the POI's map is the base map (its size, its cells, the raid's fog kept); nothing on fog; builds that do not fit
//   refused ("No room on this map"); fittings only in the rooms; the map never grows; a survey opens the whole map
// - bases on a tile: one per POI (a second camp in the same POI refused), plus one normal base (the tile's own Set up
//   camp still offered beside a POI camp, refused beside a normal base)
// - another group raiding the POI finds your base: no loot by the numbers, a hostile group's raid on the base
// - the governor's rule (the POI's dead low or below, fighters to answer Defend); the raid bot settles in at 0
// - build mode: open only on your turn with no hostile in sight, closed by a sighting; placement only on seen, cleared
//   cells under the map's limits; progress by actions with one and with two workers; a hostile in the footprint stops
//   it; materials from the stores and the people on the map; an unfinished site carried to the construction queue
// - save / load keeps the camp; an older save (no camp fields) loads
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, combatAct, endPlayerTurn, runEnemyPhase, finishCombat, enemyUnit, autoPlayerTurn } from "../src/sim/combat.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
import { poisOf, isSitePoi, poiAt } from "../src/sim/pois.js";
import { poiRaidSetup } from "../src/sim/poiraid.js";
import { openBaseMap, placeProblemAt, occupancy, FOOT } from "../src/sim/basemap.js";
import { placeProblem } from "../src/sim/buildings.js";
import { campProblem } from "../src/sim/staging.js";
import { raidPoiAsGroup } from "../src/sim/grouppois.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { killDead, poiDead } from "../src/sim/deadpop.js";
import * as PC from "../src/sim/poicamp.js";
import { siteThreat, clearSiteFirst, leaveGrounds } from "../src/sim/siteclear.js";
import { partyTile as partyTileOf } from "../src/sim/parties.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);

const W = () => { const st = createWorld({ seed, factionCount: 8 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
// A house POI with rooms, off any base tile and hive.
function findHouse(st, skip = []) {
  for (const t of st.tiles) {
    if (t.hive || st.bases.some((x) => x.tile === t.id) || st.factions.some((f) => f.bases.includes(t.id)) || skip.includes(t.id)) continue;
    const L = poisOf(t);
    for (let i = 0; i < L.length; i++) if (L[i].kind === "house" && !isSitePoi(t, i)) return [t, i];
  }
  return null;
}
// A team of n from the hub, on foot, carrying nothing for the camp fire.
function team(st, n = 3, from = hub(st)) {
  const crew = atBase(st, from.id).slice(0, n);
  for (const s of crew) { s.traits = []; s.traitTier = {}; s.perks = []; }
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: from.tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 1 }, fromBaseId: from.id });
  if (res.error) throw new Error(`launch: ${res.error}`);
  st.cards.length = 0;
  return res.party;
}
// A raid on POI i of tile t, no enemies (they are added by hand).
function raid(st, p, t, i, extra = {}) {
  p.path = [t.id]; p.idx = 0; p.dest = t.id; p.phase = "engaged";
  const rs = poiRaidSetup(st, t, i);
  const setup = { mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: 0, power: 3, name: "nobody", groups: [] }, raid: { heat0: 5, choose: rs.choose, poi: i, kind: rs.kind || null, place: rs.place || null, ...extra }, context: {} };
  st.combat = createBattle(st, setup);
  return st.combat;
}
const mine = (b) => b.units.filter((u) => u.side === "player" && !u.dead && !u.left);
const turn = (st) => { endPlayerTurn(st); runEnemyPhase(st); };
// A zombie of the battle's at (x, y), on the camp's floor, standing still.
function zombie(b, x, y) {
  const z = enemyUnit(b, { chance: () => false, pick: (a) => a[0], range: (a) => a, int: (a) => a }, "zombies", 3, 1);
  z.x = x; z.y = y; z.f = b.floor || 0; z.ap = 0; z.mob = 0; z.aware = false;
  b.units.push(z);
  return z;
}
// A free cell n steps from (x, y) that a zombie can stand on.
function freeNear(b, x, y, n) {
  for (let r = n; r < n + 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const cx = x + dx, cy = y + dy;
    if (cx < 0 || cy < 0 || cx >= b.w || cy >= b.h) continue;
    const c = b.cells[cy * b.w + cx];
    if (c.k === "open" && !b.units.some((u) => !u.dead && u.x === cx && u.y === cy)) return [cx, cy];
  }
  return null;
}
const give = (u, k, n) => { u.haul.sup[k] = (u.haul.sup[k] || 0) + n; };

let st, p, t, i, b, at, base;
section("The 5 × 5: seen ground, the supplies inside, the work by actions");
{
  st = W();
  [t, i] = findHouse(st);
  p = team(st, 3);
  b = raid(st, p, t, i);
  check(PC.poiRaid(b), `a raid on POI ${i} (a house) of tile ${t.id}: a camp can be set up here (${b.w} × ${b.h})`);
  at = PC.bestSquare(st, b);
  check(!!at, `the game finds a seen, open 5 × 5 round the team (${at})`);
  const [u1, u2, u3] = mine(b);
  // A square under the fog.
  let fog = null;
  const seen = PC.seenOf(b);
  for (let y = 2; y < b.h - 2 && !fog; y++) for (let x = 2; x < b.w - 2 && !fog; x++) if (!seen[y * b.w + x]) fog = [x, y];
  check(!!fog && /seen/.test(PC.setupProblem(st, b, null, fog[0], fog[1])), `a square with a fogged cell is refused: "${fog && PC.setupProblem(st, b, null, fog[0], fog[1])}"`);
  check(/Short/.test(PC.setupProblem(st, b, u1, at[0], at[1])), `nothing carried: short of the camp fire's wood and stone ("${PC.setupProblem(st, b, u1, at[0], at[1])}")`);
  // Only the people inside count: the supplies on someone moved outside the square.
  const out = freeNear(b, at[0], at[1], 4);
  u3.x = out[0]; u3.y = out[1];
  give(u3, "wood", 5); give(u3, "stone", 8);
  check(/Short/.test(PC.setupProblem(st, b, u1, at[0], at[1])), "what someone outside the 5 × 5 carries does not count");
  const sup = PC.squareSupplies(st, b, at);
  check(sup.have.wood === 0 && sup.short.wood === 5 && sup.short.stone === 8, `the list says what is there and what is short (${JSON.stringify(sup.have)} / short ${JSON.stringify(sup.short)})`);
  give(u1, "wood", 3); give(u2, "wood", 2); give(u2, "stone", 8);
  check(PC.setupProblem(st, b, u1, at[0], at[1]) === "", "carried by the two inside (3 + 2 wood, 8 stone): it can go up");
  // A hostile inside stops it from starting.
  const zin = zombie(b, ...freeNear(b, at[0], at[1], 2));
  check(/hostile/.test(PC.setupProblem(st, b, u1, at[0], at[1])), "a hostile inside the 5 × 5: refused");
  zin.dead = true;
  const err = combatAct(st, { type: "campSetup", unit: u1.id, x: at[0], y: at[1] });
  check(err === "" && b.poiCamp.at && b.poiCamp.total === PC.setupTotal(), `Set up camp starts it (${err || "ok"}): ${b.poiCamp.total} actions of work (the camp fire's work-hour)`);
  check(!(u1.haul.sup.wood > 0) && !(u2.haul.sup.wood > 0) && !(u2.haul.sup.stone > 0) && u3.haul.sup.wood === 5, "the supplies are taken off the people inside when the work starts; the one outside keeps theirs");
  check(b.poiCamp.work === 2 && u1.ap === 0, `the one who set it up spent their actions on it (${b.poiCamp.work})`);
  const c = poiAt(t, i).cont;
  check(!!(c && c.camp && c.camp.work === 2), "the half-built camp is in the POI's ledger");
  // A turn with nobody working: no progress.
  turn(st);
  turn(st);
  check(b.poiCamp.work === 2, `two turns with nobody working leave it where it is (${b.poiCamp.work})`);
  // One worker a turn: 2 actions.
  combatAct(st, { type: "campWork", unit: u2.id });
  check(b.poiCamp.work === 4, `one worker: +2 a turn (${b.poiCamp.work})`);
  turn(st);
  // Two workers: +4.
  check(combatAct(st, { type: "campWork", unit: u1.id }) === "" && combatAct(st, { type: "campWork", unit: u2.id }) === "", "two work the same turn");
  check(b.poiCamp.work === 8 && b.poiCamp.workers.length === 2, `two workers: +4 a turn, faster (${b.poiCamp.work})`);
  check(/inside/.test(combatAct(st, { type: "campWork", unit: u3.id })), "the one outside the 5 × 5 cannot work on it");
  // A hostile inside stops the work; nothing lost.
  turn(st);
  const z2 = zombie(b, ...freeNear(b, at[0], at[1], 1));
  check(/hostile/.test(combatAct(st, { type: "campWork", unit: u1.id })) && b.poiCamp.work === 8, "a hostile inside the 5 × 5 stops the work, nothing lost");
  z2.dead = true;
  // Abandoned: everyone leaves; the ledger keeps it; the next raid picks it up.
  for (const u of mine(b)) u.left = true;
  turn(st);
  check(b.over, "the raid ends with everyone out");
  finishCombat(st, b.setup, b.result);
  check(st.bases.every((x) => x.poi == null) && c.camp && c.camp.work === 8 && c.camp.paid.wood === 5, `abandoned: no base, the half-built camp and its supplies in the ledger (${JSON.stringify(c.camp && { work: c.camp.work, paid: c.camp.paid })})`);
}

section("The base is official when the work finishes; the safe countdown; Settle in");
{
  p = team(st, 3);
  b = raid(st, p, t, i);
  check(b.poiCamp && b.poiCamp.work === 8 && b.poiCamp.at && b.poiCamp.at[0] === at[0], `the next raid picks the half-built camp up where it was left (${b.poiCamp && b.poiCamp.work}/${b.poiCamp && b.poiCamp.total})`);
  // Walk the team into the square.
  const cells = PC.squareCells(at[0], at[1]).filter(([x, y]) => b.cells[y * b.w + x].k === "open");
  mine(b).forEach((u, k) => { u.x = cells[k][0]; u.y = cells[k][1]; });
  const n0 = st.bases.length;
  for (const u of mine(b)) combatAct(st, { type: "campWork", unit: u.id });
  base = st.bases.find((x) => x.poi === i && x.tile === t.id);
  check(b.poiCamp.done && !!base && st.bases.length === n0 + 1, `the work done: ${base ? base.name : "no base"} stands at once`);
  check(!!base && base.poi === i && base.poiCamp && base.poiCamp.w === b.w && base.poiCamp.h === b.h && base.camp === true, "base.poi is the POI; base.poiCamp is its map (its size)");
  check(!b.over && st.cards.some((x) => x.title === "A new home" && x.mapBase === base.id), "the raid map does not close; the founding card (A new home) is up");
  st.cards.length = 0;
  check(/Not safe yet/.test(PC.settleProblem(st, b)) && b.poiCamp.safe === 5 && PC.safeText(b) === "Safe in 5", `Settle in waits for the countdown (${PC.safeText(b)})`);
  turn(st); turn(st);
  check(b.poiCamp.safe === 3, `two quiet turns: safe in ${b.poiCamp.safe}`);
  const z = zombie(b, ...freeNear(b, mine(b)[0].x, mine(b)[0].y, 1));
  turn(st);
  check(b.poiCamp.safe === 5 && /Not safe/.test(PC.safeText(b)), `a hostile in sight resets it to 5 ("${PC.safeText(b)}")`);
  z.dead = true;
  for (let k = 0; k < 5; k++) turn(st);
  check(b.poiCamp.safe === 0 && PC.settleProblem(st, b) === "", `five quiet turns: ${PC.safeText(b)}`);
  const people = partyMembers(st, p).map((s) => s.id);
  check(combatAct(st, { type: "settleIn" }) === "" && b.over, "Settle in ends the raid");
  finishCombat(st, b.setup, b.result);
  check(people.every((id) => atBase(st, base.id).some((s) => s.id === id)) && !st.parties.includes(p), `everyone settled in as the camp's people (${atBase(st, base.id).length})`);
  check(st.campOpen === base.id && !!base.layoutAsk, "the camp's build map is asked for (Open the build map)");
  check(!poiAt(t, i).cont.camp, "the half-built camp is gone from the ledger");
  const nd = poiDead(st, t.id, i);
  check(nd > 0 ? !!base.grounds && base.grounds.dead === nd && base.grounds.poi === i && base.grounds.known : !base.grounds, `the POI's dead left are the camp's grounds (${nd}: base.grounds ${base.grounds ? JSON.stringify({ dead: base.grounds.dead, poi: base.grounds.poi }) : "none"})`);
}

section("The POI's map is the base map: its fog, no builds on fog, what fits");
{
  st.combat = null;
  check(openBaseMap(st, base.id) === "" && st.combat.w === base.poiCamp.w && st.combat.h === base.poiCamp.h, `the base map is the POI's map (${st.combat.w} × ${st.combat.h}), not a 500 × 500 grid`);
  const v = st.combat, F = v.deployPlan.fort, P = base.poiCamp;
  let same = 0, n = 0;
  for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) { const c = PC.poiCellAt(P, x, y); if (c.k === "wall") { n++; if (v.cells[(y + F.oy - P.at[1]) * v.w + x + F.ox - P.at[0]].k === "wall") same++; } }
  check(n > 0 && same === n, `the building's walls stand on the base map where they stood in the raid (${same}/${n})`);
  const seen = PC.poiSeenMask(P);
  const nSeen = seen.reduce((a, x) => a + x, 0);
  check(!!v.knownMask && nSeen > 0 && nSeen < P.w * P.h && v.knownMask.reduce((a, x) => a + x, 0) === nSeen, `the raid's fog is kept: ${nSeen} of ${P.w * P.h} cells known`);
  st.combat = null;
  const occ = occupancy(st, base);
  let fogAt = null, yardAt = null, roomAt = null;
  for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) {
    const c = PC.poiCellAt(P, x, y), g = [x - P.at[0], y - P.at[1]];
    if (!seen[y * P.w + x] && c.k === "open" && !fogAt) fogAt = g;
    if (seen[y * P.w + x] && c.k === "open" && !PC.poiIndoor(P, x, y) && Math.max(Math.abs(g[0]), Math.abs(g[1])) > 3 && !yardAt) yardAt = g;
    if (seen[y * P.w + x] && c.k === "open" && PC.poiIndoor(P, x, y) && !roomAt) roomAt = g;
  }
  const crate = { ...FOOT.storebox, type: "storebox", key: null };
  check(!!fogAt && placeProblemAt(base, crate, fogAt[0], fogAt[1], 0, occ) === PC.POICAMP.UNKNOWN, `nothing goes on fog ("${fogAt && placeProblemAt(base, crate, fogAt[0], fogAt[1], 0, occ)}")`);
  check(!!yardAt && placeProblemAt(base, crate, yardAt[0], yardAt[1], 0, occ) === "", "a crate on seen yard: fine");
  check(/edge/.test(placeProblemAt(base, crate, P.w - P.at[0], 0, 0, occ)) || /Off the map/.test(placeProblemAt(base, crate, P.w - P.at[0], 0, 0, occ)), `the map never grows: past its edge refused ("${placeProblemAt(base, crate, P.w - P.at[0], 0, 0, occ)}")`);
  const bunks = { ...FOOT.bunks, type: "bunks", key: null };
  check(!!yardAt && /rooms/.test(placeProblemAt(base, bunks, yardAt[0], yardAt[1], 0, occ)), `a fitting (bunks) in the yard refused ("${yardAt && placeProblemAt(base, bunks, yardAt[0], yardAt[1], 0, occ)}")`);
  check(PC.poiFits(base, "bunks") && placeProblem(base, "bunks") === "", "bunks fit in the building's rooms (seen)");
  check(!PC.poiFits(base, "gen_lodge") || !FOOT.gen_lodge, "a lodge does not fit (too big for the yard)");
  check(placeProblem(base, "outpost_up") === "" || placeProblem(base, "outpost_up") === PC.POICAMP.NO_ROOM || /main base|camp/i.test(placeProblem(base, "outpost_up")), `the step up offered only if it fits ("${placeProblem(base, "outpost_up")}")`);
  // A huge thing never fits.
  const big = Object.keys(FOOT).find((k) => FOOT[k].kind === "house" && FOOT[k].w * FOOT[k].h > PC.POICAMP.YARD_AREA);
  check(!!big && !PC.poiFits(base, big), `a big building (${big}, ${FOOT[big] && FOOT[big].w} × ${FOOT[big] && FOOT[big].h}) is "No room on this map"`);
  const room = PC.poiRoomLeft(st, base);
  check(room.yard > 0 && room.unknown > 0, `the site facts show the room left (${PC.roomWords(room)})`);
  PC.poiCampSurveyed(st, t.id);
  check(PC.poiSeenMask(base.poiCamp).every((x) => x === 1), "a survey of the POI opens the whole map");
}

section("Bases on a tile: one per POI plus one normal base");
{
  check(/one base a place/.test(PC.poiCampProblem(st, t.id, i)), `a second camp in the same POI: "${PC.poiCampProblem(st, t.id, i)}"`);
  check(campProblem(st, t.id) === null, "the tile's own Set up camp is still offered beside a POI camp (one normal base)");
  check(PC.normalBaseAt(st, t.id) === null && PC.poiBaseAt(st, t.id, i) === base, "normalBaseAt / poiBaseAt tell them apart");
  const hubTile = hub(st).tile;
  check(/already have a base/.test(campProblem(st, hubTile) || ""), "a tile with your normal base: its own Set up camp refused");
}

section("Another group raiding the POI finds your base");
{
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const before = st.parties.length;
  const was = f.goodwill;
  f.goodwill = -100; // Hostile
  const r = raidPoiAsGroup(st, f, t.id, i, 1);
  check(r === null, "no loot by the numbers: the place is your base");
  check(base.poiCamp.knownBy.includes(f.id), "the POI is marked as your base in their knowledge");
  const raidP = st.parties.slice(before).find((q) => q.target && q.target.baseId === base.id);
  check(!!raidP, `a hostile group that finds it sets out to raid the base (${raidP ? `${raidP.id}, at ${raidP.target.tile}` : "none"})`);
  const n1 = st.parties.length;
  raidPoiAsGroup(st, f, t.id, i, 1);
  check(st.parties.length === n1, "at most one such raid a day");
  f.goodwill = was;
  // Another POI on the tile can still be raided as normal.
  const j = poisOf(t).findIndex((x, k) => k !== i);
  if (j >= 0) check(raidPoiAsGroup(st, f, t.id, j, 0.1) !== null, "the tile's other POIs are raided as normal");
}

section("The team's packs on foot count by each one's share");
{
  const st3 = W();
  const [t3, i3] = findHouse(st3);
  const p3 = team(st3, 3);
  p3.supplies.stone = 8; // (wood is bulky: a team on foot sets its loads down at the edge as it goes in, carry.js stageAtStart; carried loose below)
  const b3 = raid(st3, p3, t3, i3);
  give(mine(b3)[1], "wood", 5);
  const at3 = PC.bestSquare(st3, b3);
  const inside = mine(b3).filter((u) => Math.abs(u.x - at3[0]) <= 2 && Math.abs(u.y - at3[1]) <= 2);
  const shared = mine(b3).every((u) => u.share > 0);
  check(shared && inside.length === 3 && PC.setupProblem(st3, b3, inside[0], at3[0], at3[1]) === "", `on foot, the team's packed stone is on its people (raidloot u.share), the wood carried loose: all three inside, enough (${JSON.stringify(PC.squareSupplies(st3, b3, at3).have)})`);
  check(combatAct(st3, { type: "campSetup", unit: inside[0].id, x: at3[0], y: at3[1] }) === "" && p3.supplies.stone < 1e-6, "the stone taken from the packs when the work starts");
  st3.combat = null;
}

section("The governor's rule and the raid bot");
{
  const st2 = W();
  const [t2, i2] = findHouse(st2);
  killDead(st2, t2.id, i2, 999, {});
  check(poiDead(st2, t2.id, i2) === 0 && PC.govPoiCampOk(st2, t2.id, i2, 2), "a cleared POI with two fighters: the governor may camp there");
  check(!PC.govPoiCampOk(st2, t2.id, i2, 1), "one fighter cannot answer Defend: no camp");
  const p2 = team(st2, 3);
  const b2 = raid(st2, p2, t2, i2, { camp: true });
  for (const u of mine(b2)) { give(u, "wood", 2); give(u, "stone", 3); }
  let k = 0;
  while (!b2.over && k++ < 30) autoPlayerTurn(st2), b2.over || runEnemyPhase(st2);
  const base2 = st2.bases.find((x) => x.poi === i2);
  check(!!base2 && b2.over && b2.poiCamp.settled, `the bot set up camp, counted down and settled in (${k} turns)`);
  if (b2.over) finishCombat(st2, b2.setup, b2.result);
  check(!!base2 && atBase(st2, base2.id).length === 3, "its people live there");
}

section("Build mode on the raid map");
{
  st.combat = null; st.cards.length = 0;
  const p3 = team(st, 2, base); // two of the camp's own people go back in
  const b3 = raid(st, p3, t, i);
  check(b3.poiCamp && b3.poiCamp.done && b3.poiCamp.baseId === base.id, "a later raid on the camp's POI knows the camp");
  const [a1, a2] = mine(b3);
  const z = zombie(b3, ...freeNear(b3, a1.x, a1.y, 1));
  check(/dead in sight/.test(combatAct(st, { type: "buildMode", on: true })), "build mode refused with a hostile in sight");
  z.dead = true;
  check(combatAct(st, { type: "buildMode", on: true }) === "" && b3.poiCamp.build, "build mode opens on your turn with none in sight");
  base.stock.wood = 30; base.stock.buildmat = 1;
  give(a2, "wood", 60);
  // A cell under the fog (a fresh battle's own fog on a cell the base knows: the survey) and a cell with the dead seen there.
  const R = b3.poiCamp;
  const seen = PC.seenOf(b3, R.f);
  let fogCell = null;
  for (let y = 0; y < b3.h && !fogCell; y++) for (let x = 0; x < b3.w && !fogCell; x++) if (!seen[y * b3.w + x] && b3.cells[y * b3.w + x].k === "open") fogCell = [x, y];
  // The survey above opened the base's map: the raid's own fog is the record's; reset it for this check.
  if (!fogCell) { R.seen[R.f] = ""; }
  const near = [];
  for (let r = 1; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) near.push([a1.x + dx, a1.y + dy]);
  const spot = near.find(([x, y]) => x >= 0 && y >= 0 && PC.buildPlaceProblem(st, b3, "storebox", x, y, 0) === "");
  check(!!spot, `a storebox can go on seen, cleared ground next to them (${spot})`);
  if (fogCell) check(PC.buildPlaceProblem(st, b3, "storebox", fogCell[0], fogCell[1], 0) === PC.POICAMP.UNKNOWN, "not on fog");
  const zc = zombie(b3, spot[0], spot[1]);
  check(/dead were seen|Someone stands/.test(PC.buildPlaceProblem(st, b3, "storebox", spot[0], spot[1], 0)), `not where the dead are seen ("${PC.buildPlaceProblem(st, b3, "storebox", spot[0], spot[1], 0)}")`);
  zc.dead = true; delete b3.ghosts[zc.id];
  check(combatAct(st, { type: "campBuild", build: "storebox", x: spot[0], y: spot[1], r: 0 }) === "" && R.sites.length === 1, "placing it stakes out a site (not built at once)");
  const s = R.sites[0];
  check(base.buildings.every((x) => x.type !== "storebox"), "nothing stands yet");
  a1.x = spot[0] + 1 < b3.w && b3.cells[spot[1] * b3.w + spot[0] + 1].k === "open" ? spot[0] + 1 : a1.x;
  const nearOk = PC.sitesNear(b3, a1).length > 0;
  check(nearOk, "a survivor next to it can work it");
  // One worker: 2 a turn.
  check(combatAct(st, { type: "buildWork", unit: a1.id }) === "" && s.work === 2, `one worker: ${s.work}/${s.total}`);
  check(s.paid && base.stock.wood === 0 && a2.haul.sup.wood === 10, `the materials were taken when the work started: the stores' 30 wood first, then 50 off the people on the map (stores ${base.stock.wood}, carried ${a2.haul.sup.wood})`);
  turn(st);
  // A hostile in the footprint stops it.
  const zf = zombie(b3, spot[0], spot[1]);
  check(/hostile is in the site/.test(combatAct(st, { type: "buildWork", unit: a1.id })) && s.work === 2, "a hostile in the footprint stops the work, nothing lost");
  turn(st);
  check(!R.build && b3.log.some((l) => /Build mode closed: the dead in sight/.test(l.text || l)), "build mode is closed at the start of a turn with the dead in sight (Build mode closed: the dead in sight)");
  zf.dead = true;
  turn(st);
  // Two workers: 4 a turn.
  const adj = freeNear(b3, spot[0], spot[1], 1);
  a2.x = adj[0]; a2.y = adj[1];
  combatAct(st, { type: "buildWork", unit: a1.id }); combatAct(st, { type: "buildWork", unit: a2.id });
  check(s.work === 6, `two workers: +4 a turn, faster (${s.work}/${s.total})`);
  // The raid ends unfinished: the site goes into the construction queue at its spot.
  for (const u of mine(b3)) u.left = true;
  turn(st);
  finishCombat(st, b3.setup, b3.result);
  const job = base.construction.find((c) => c.type === "storebox");
  check(!!job && job.at && job.at[0] === s.at[0] && job.progress > 0 && job.progress < job.hours, `the unfinished site is in the camp's construction queue at its spot (${job && `${job.progress}/${job.hours} h`})`);
}

section("Clearing the spot first is optional on the tile's own map");
{
  const st4 = W();
  const t4 = st4.tiles.find((x) => siteThreat(st4, x.id).count > 0 && !x.hive && !st4.bases.some((q) => q.tile === x.id));
  const p4 = team(st4, 2);
  p4.path = [t4.id]; p4.idx = 0; p4.dest = t4.id; p4.phase = "task"; p4.task = { type: "pitch", hours: 2, done: 0 };
  p4.noClear = t4.id;
  const n = siteThreat(st4, t4.id).count;
  const fought = clearSiteFirst(st4, p4, [0, 0]);
  check(!fought && !st4.combat && p4.campGrounds === n && p4.siteClear === t4.id, `Set up without clearing: no fight, the ${n} of the dead noted for the grounds`);
  const fake = { tile: t4.id };
  leaveGrounds(st4, fake, n);
  check(fake.grounds && fake.grounds.dead > 0 && fake.grounds.known && !fake.grounds.blind, `they stay out on the camp's grounds (${fake.grounds && fake.grounds.dead}, known)`);
  delete p4.noClear; delete p4.siteClear;
  check(partyTileOf(p4) === t4.id && clearSiteFirst(st4, p4, [0, 0]) === true, "without it the dead are fought first, as before");
  st4.combat = null;
}

section("Save and load");
{
  st.combat = null; st.cards.length = 0;
  const st2 = deserializeState(JSON.parse(JSON.stringify(serializeState(st, { dropCards: true }))));
  const b2 = st2.bases.find((x) => x.poi === i && x.tile === t.id);
  check(!!b2 && b2.poiCamp && b2.poiCamp.cells === base.poiCamp.cells && b2.poiCamp.seen === base.poiCamp.seen, "a save keeps the camp, its map and its fog");
  const old = createWorld({ seed, factionCount: 8 });
  const re = deserializeState(JSON.parse(JSON.stringify(serializeState(old, { dropCards: true }))));
  check(re.bases.every((x) => x.poi == null && !x.poiCamp), "an older save (no camp fields) loads, no POI camps");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
