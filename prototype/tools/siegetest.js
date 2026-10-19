// Siege equipment, fire, decoys and the Shepherd (src/sim/siege.js, throwables.js, decoys.js, zombietypes.js; numbers
// in siege.js LADDER / RAM / DROP / RAID_KIT, throwables.js FIRE / FRAG / BLAST / SCATTER, hiveconst.js SHEPHERD).
// Checks: grenades over walls (no line of sight to a cell a teammate sees, refused where nobody does, scatter by aim,
// area damage, light cover blown apart, the gate hit); ladders (set up from the foot of a wall section, the climb onto
// the walkway, the climber exposed, pushed off by a defender with the climber falling, raised again); the ram (its
// crew, damage to the gate a swing, the crew exposed and unable to shoot, the crew keeping up with the lead, dropped
// when too few are left and taken up again, rocks from the walls); fire (a 3 × 3 patch for 2–3 turns, spreading by
// fuel and never onto stone or asphalt, wood burning out to rubble, smoke blocking sight, the dead walking into it and
// burning, people's AI walking round it); decoys by sense (noise, heat, light per kind of the dead; people not fooled,
// a decoy giving the thrower away); the Shepherd (its aura, decoys and fire wasted on its pack, the aura gone when it
// dies, it keeps out of the flames, its growth by game year 10, the horde warning); raiders bringing kit by
// preparedness (by the year, none against an unwalled base, outsiders less often, the raid warning card, the battle
// handing it out); raiders from beyond the border with the ladders and ram they set out with (items in their gear,
// carried by the carry rule, brought to your walls, home with the living or left in your yard or on the ground, made
// by a group's crafting only with the means); siege kit by the numbers (the wall tier, an assault's walls, decoys against the dead); the AI on
// both sides (ladders, the ram, grenades; pushing ladders, rocks, decoys, a Molotov at a chokepoint, who it shoots
// first); the State Map (decoys from the armory against a coming horde, an assault taking the hub's siege kit along);
// determinism; saving and loading mid-battle with fire, ladders and a ram on the map.
// Usage: node tools/siegetest.js [seed]
import { setRounds, totalRounds } from "../src/sim/ammo.js"; // rounds by calibre
import { createWorld, hub, atBase, makeSurvivor, day } from "../src/sim/world.js";
import {
  createBattle, combatAct, autoPlayerTurn, runEnemyPhase, endPlayerTurn, registerCombatHandler, active, unitAt, CELL,
  reachable, shotOdds, coverAgainst, WEAPONS, canSeeAt, canFire, autoResolveCombat, byNumbersOdds, enemyUnit, shotPriority, moveAlong, pathTo, CRIT,
} from "../src/sim/combat.js";
import { addBuilding, count } from "../src/sim/buildings.js";
import { DEPLOY } from "../src/sim/deploy.js";
import { raidTier, hordeWarnings, decoyChance, ledByShepherd, DECOY_FUEL } from "../src/sim/defences.js";
import { baseTiers } from "../src/sim/interior.js";
import { makeHorde } from "../src/sim/hordes.js";
import { newItem, stow, allCarried } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { GEAR } from "../src/sim/data.js";
import { THROWABLES, DECOY_KEYS, throwAt, throwablesOf } from "../src/sim/stealth.js";
import { landEffect, throwLanding, scatterChance, FIRE, FRAG, BLAST, burnRange, fireAt, burnRound, ignite, smokeBlocks, blastSpot, throwBlind } from "../src/sim/throwables.js";
import { sensesOf, pullOf, herded, lureTurn, lureEdge } from "../src/sim/decoys.js";
import {
  siegeAct, raidSiegeKit, bandSetOutKit, kitText, siegeWallCut, assaultCut, teamKit, battleOverlays, pushChance, canPush, ramOf, LADDER, RAM, DROP, CUT, ladderAt,
} from "../src/sim/siege.js";
import { applyZType } from "../src/sim/zombietypes.js";
import { ZTYPES, GROWTHS, TECH, SHEPHERD, SENSES } from "../src/sim/hiveconst.js";
import { hiveMods, startGrowth } from "../src/sim/hivetech.js";
import { yearStartDay, yearOfDay } from "../src/sim/eras.js";
import { raidWarning } from "../src/sim/factions.js";
import { defendInPerson } from "../src/sim/conflicts.js";
import { assaultForce } from "../src/sim/conquest.js";
import { launchExpedition, poolLoad, spawnAiParty, removeParty } from "../src/sim/parties.js";
import { ensureArsenal, addToArsenal, removeFromArsenal, packRaidKit } from "../src/sim/arsenal.js"; // a raid's siege kit out of the group's stores
import { ensureMembers, syncMembers, membersOf, partyPeople, removeMember } from "../src/sim/members.js";
import { spareKit } from "../src/sim/loadouts.js";
import { fitThrowables } from "../src/sim/fighters.js";
import { CRAFTS } from "../src/sim/crafting.js";
import { worksAt } from "../src/sim/groupworks.js"; // barestart: a group's walls are what it has built
import * as V from "../src/sim/visitors.js"; // raiders from beyond the border: their own ladders and ram
import { bandRoom } from "../src/sim/nomads.js";
import { groundAt } from "../src/sim/carry.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
registerCombatHandler("st", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; return st; };
const cellAt = (b, x, y) => b.cells[y * b.w + x];
const WEAPONS_RANGED = (u) => !!WEAPONS[u.weapon] && !WEAPONS[u.weapon].melee;
const pct = (n, d) => `${Math.round((100 * n) / Math.max(1, d))}%`;
function fortHub(st, list = ["walls", "walls", "barricades", "watchtower", "gate", "bunkhouse"], extra = 2) {
  const h = hub(st);
  for (const t of list) addBuilding(h, t);
  for (let i = 0; i < extra; i++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); }
  for (const s of atBase(st, h.id)) { s.health = 100; if (!s.gear.weapon) s.gear.weapon = newItem("pistol"); }
  setRounds(h.stock, 300); h.stock.meds = 10; // ammo.js: rounds by calibre
  return h;
}
// A battle at the hub's walls, the attack from the east (no tile to come from), defenders at their default posts.
function wallBattle(st, enemy, context = {}) {
  const h = hub(st);
  globalThis.window = {};
  try {
    st.combat = createBattle(st, { tile: h.tile, baseId: h.id, enemy, ambush: null, canRetreat: true, handler: "st", layout: "baseDefence", deploy: true, context: { strip: true, night: false, ready: { manned: true }, ...context } }); // ready: everyone at a post (defenceplan.js openStart)
  } finally { delete globalThis.window; }
  const b = st.combat;
  combatAct(st, { type: "start" });
  return b;
}
// An open field: every cell open grass, one of yours and some of theirs placed by hand.
function openBattle(st, enemy = { kind: "zombies", count: 6, power: 3 }, n = 2) {
  const h = hub(st);
  const ids = atBase(st, h.id).slice(0, n).map((s) => s.id);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: ids, enemy, ambush: null, canRetreat: false, handler: "st", context: {} });
  const b = st.combat;
  for (const c of b.cells) { c.k = "open"; c.f = "grass"; delete c.h; delete c.t; delete c.hp; delete c.mhp; }
  b.losCache.fill(0); b.reach.fill(1);
  b.phase = "player";
  b.fires = []; b.smoke = []; b.lures = [];
  let i = 0;
  for (const u of b.units) { u.x = u.side === "player" ? 1 : 10 + (i % 8); u.y = u.side === "player" ? 2 + 2 * (u.id % 4) : (i++ >> 3) * 2 + 1; u.aware = true; }
  return b;
}
const play = (st, n = 240) => { for (let i = 0; i < n && st.combat && !st.combat.over; i++) { const b = st.combat; if (b.phase === "player" || b.phase === "deploy") autoPlayerTurn(st); else runEnemyPhase(st); } };
// A wall row with the walkway behind it and the approach in front clear (rows y and y + 1, 4 columns out: on a long wall
// the ground outside has trees and rocks here and there).
const clearOut = (b, y) => [0, 1].every((dy) => [1, 2, 3, 4].every((dx) => cellAt(b, DEPLOY.WALL_X + dx, y + dy).k === "open"));
const wallRow = (b, ok = () => true) => { for (let y = 1; y < b.h - 2; y++) if (cellAt(b, DEPLOY.WALL_X, y).k === "palisade" && cellAt(b, DEPLOY.WALL_X - 1, y).k === "walkway" && clearOut(b, y) && ok(y)) return y; return -1; };
const park = (b, keep) => { let k = 0; for (const u of b.units) if (!keep.includes(u)) { u.x = 0; u.y = k++ % b.h; if (u.side === "enemy") u.dead = true; } };

// ---------- 1. grenades over walls ----------
section("Grenades over walls: no line of sight needed to a cell a teammate sees, scatter by aim, area damage, cover blown apart");
{
  const st = world();
  fortHub(st);
  const b = wallBattle(st, { kind: "raiders", count: 3, power: 3, name: "raiders" });
  check(b.tier && b.tier.map === "wall" && b.side === "east", `a battle at the walls, the attack from the east (${b.w}×${b.h})`);
  const mine = b.units.filter((u) => u.side === "player" && active(u));
  const y = wallRow(b);
  const g = mine[0], w = mine[1];
  const foes = b.units.filter((u) => u.side === "enemy");
  park(b, [g, w, ...foes]);
  g.x = 8; g.y = y; w.x = DEPLOY.LINE_X; w.y = y;
  const [e1, e2, e3] = foes;
  e1.x = 15; e1.y = y; e2.x = 15; e2.y = y + 1; e3.x = 16; e3.y = y;
  b.losCache.fill(0);
  check(!canSeeAt(b, g, 15, y) && canSeeAt(b, w, 15, y), "behind the wall on the ground one cannot see out; up on the walkway one can");
  const s = st.survivors.find((x) => x.id === g.sid);
  stow(s, newItem("frag")); stow(s, newItem("frag"));
  check(throwBlind(b, g, 15, y) === true, "a cell a teammate on the walkway sees: a blind throw over the wall is allowed");
  w.x = 3; w.y = y; b.losCache.fill(0);
  g.ap = 2;
  const err = combatAct(st, { type: "throw", unit: g.id, item: "frag", x: 15, y });
  check(/Nobody can see/.test(err) && throwablesOf(st, b, g).frag === 2, `with nobody seeing it, the throw is refused and nothing is used (${err})`);
  w.x = DEPLOY.LINE_X; w.y = y; b.losCache.fill(0);
  const hp0 = [e1.hp, e2.hp, e3.hp];
  const err2 = combatAct(st, { type: "throw", unit: g.id, item: "frag", x: 15, y });
  const hurt = [e1, e2, e3].filter((e, i) => e.hp < hp0[i] || e.dead).length;
  const offTile = /lands a tile off/.test(b.log.slice(-1)[0].text); // a blind throw may scatter (throwables.js): a legitimate miss
  check(!err2 && throwablesOf(st, b, g).frag === 1 && (hurt >= 1 || offTile), `a frag grenade over the wall: ${hurt} of the 3 raiders hit (${b.log.slice(-1)[0].text.slice(0, 120)})`);
  // Scatter by aim: Monte Carlo of where it comes down.
  const T = THROWABLES.frag;
  const off = (aim, blind) => { let n = 0; const u = { ...g, aim }; for (let i = 0; i < 3000; i++) if (throwLanding(b, u, T, 15, y, blind)[2]) n++; return n / 3000; };
  const lo = off(40, false), hi = off(75, false), bl = off(75, true);
  check(Math.abs(lo - scatterChance({ aim: 40 }, T, false)) < 0.03 && hi < lo && bl > hi, `a tile off: aim 40 ${pct(lo * 100, 100)}, aim 75 ${pct(hi * 100, 100)}, aim 75 blind ${pct(bl * 100, 100)} (45% less 0.8 a point over 40, +15% blind)`);
  check(scatterChance({ aim: 60 }, THROWABLES.pipebomb, false) > scatterChance({ aim: 60 }, T, false), "a pipe bomb scatters more than a frag grenade");
  // Area damage, cover and structures, where it lands exactly (landEffect).
  const b2 = openBattle(st, { kind: "raiders", count: 3, power: 3 });
  const [r1, r2, r3] = b2.units.filter((u) => u.side === "enemy");
  r1.x = 10; r1.y = 5; r2.x = 11; r2.y = 6; r3.x = 13; r3.y = 5;
  cellAt(b2, 9, 5).k = "crate"; cellAt(b2, 10, 6).k = "barricade"; cellAt(b2, 12, 5).k = "wall";
  const hp = [r1.hp, r2.hp, r3.hp];
  landEffect(b2, b2.units[0], THROWABLES.frag, 10, 5);
  check(r1.hp < hp[0] && r2.hp < hp[1] && r3.hp === hp[2], `${FRAG.dmg[0]}–${FRAG.dmg[1]} to everyone within a tile, nobody further (${Math.round(hp[0] - r1.hp)}, ${Math.round(hp[1] - r2.hp)}, 0)`);
  check(cellAt(b2, 9, 5).k === "rubble" && cellAt(b2, 10, 6).k === "rubble" && cellAt(b2, 12, 5).k === "wall", "the crate and the barricade within a tile are blown apart (rubble); a wall further off stands");
  // The gate takes a blast.
  const gy = b.cells.findIndex((c) => c.k === "gate");
  const gx = gy % b.w, gyy = (gy / b.w) | 0, gate = b.cells[gy], ghp = gate.hp;
  landEffect(b, foes[0], THROWABLES.pipebomb, gx + 1, gyy);
  check(gate.hp < ghp && ghp - gate.hp >= BLAST.struct[0] && ghp - gate.hp <= BLAST.struct[1], `a pipe bomb at the gate: −${ghp - gate.hp} (${BLAST.struct[0]}–${BLAST.struct[1]})`);
}

// ---------- 2. ladders ----------
section("Ladders: set up from the foot of a wall section, climbed onto the walkway, pushed off");
{
  const st = world();
  fortHub(st);
  const b = wallBattle(st, { kind: "raiders", count: 3, power: 3, name: "raiders", siege: { ladders: 1, ram: 0, grenades: 0 } });
  const carrier = b.units.find((u) => u.ladder > 0);
  check(!!carrier && carrier.mob === carrier.mob0 - LADDER.SLOW, `a raider carries the ladder (moves ${carrier && carrier.mob} tiles an action, not ${carrier && carrier.mob0})`);
  const y = wallRow(b, (yy) => !b.units.some((u) => u.side === "player" && u.x === DEPLOY.LINE_X && Math.abs(u.y - yy) <= 1));
  const mine = b.units.filter((u) => u.side === "player" && active(u));
  park(b, [carrier, ...mine]);
  for (const u of mine) { u.x = 2 + (u.id % 3); u.y = (u.id * 3) % b.h; }
  b.units.filter((u) => u !== carrier && u.side === "enemy").forEach((u) => { u.dead = true; });
  carrier.x = DEPLOY.WALL_X + 1; carrier.y = y; carrier.ap = 2;
  b.phase = "player"; // siegeAct needs no phase; checks as in the enemy turn
  const wallCell = cellAt(b, DEPLOY.WALL_X, y);
  check(siegeAct(st, b, carrier, null, { type: "ladder" }) === "" && wallCell.k === "siegeladder" && carrier.ap === 1 && !carrier.ladder, "one action from the foot: the wall section becomes a siege ladder");
  const r = reachable(b, carrier, 10);
  const top = r.dist[y * b.w + DEPLOY.WALL_X], walk = r.dist[y * b.w + DEPLOY.LINE_X];
  check(top === 2 && walk === 3, `up the ladder: 1 tile + a climb of ${CELL.siegeladder.h} (${top}), then a step onto the walkway at the same height (${walk})`);
  carrier.x = DEPLOY.WALL_X; carrier.y = y;
  const shooter = mine[0];
  shooter.x = 6; shooter.y = y; b.losCache.fill(0);
  const cov = coverAgainst(b, carrier.x, carrier.y, shooter.x, shooter.y);
  const o = shotOdds(b, shooter, carrier);
  check(!cov.any && cov.level === 0 && o.crit === CRIT.EXPOSED, `on the ladder: no cover at all (critical chance ${o.crit}%), +${10} to be hit`);
  check(shotPriority(b, carrier) === 1.5, "the AI shoots a climber first (×1.5)");
  // A defender on the walkway next to it pushes it off.
  const d = mine[1];
  d.x = DEPLOY.LINE_X; d.y = y + 1;
  const lad = ladderAt(b, DEPLOY.WALL_X, y);
  const withClimber = pushChance(b, d, lad);
  carrier.x = DEPLOY.WALL_X + 1;
  const empty = pushChance(b, d, lad);
  carrier.x = DEPLOY.WALL_X;
  check(canPush(b, d, lad) && empty - withClimber === -LADDER.CLIMBER && empty >= LADDER.MIN && empty <= LADDER.MAX, `a defender on the walkway next to it can push it off: ${empty}% (${withClimber}% with someone on it)`);
  let tries = 0;
  const hp0 = carrier.hp;
  while (lad.up && tries < 60) { d.ap = 2; siegeAct(st, b, d, null, { type: "push" }); tries++; }
  check(!lad.up && cellAt(b, DEPLOY.WALL_X, y).k === "palisade" && carrier.x > DEPLOY.WALL_X && carrier.hp < hp0 && carrier.ap === 0, `pushed off after ${tries} tries: the wall is a wall again, the climber falls outside (−${Math.round(hp0 - carrier.hp)}) and loses the turn`);
  carrier.ap = 2; carrier.x = lad.fx; carrier.y = lad.fy;
  check(siegeAct(st, b, carrier, null, { type: "ladder" }) === "" && lad.up, "from its foot, one action raises it again");
  check(battleOverlays(b).ladders.some((l) => l.up && l.wx === DEPLOY.WALL_X && l.wy === y), "the ladder is on the map as data for the renderers");
}

// ---------- 3. the ram ----------
section("The battering ram: its crew, the gate, exposure, rocks from the walls");
{
  const st = world();
  fortHub(st);
  const b = wallBattle(st, { kind: "raiders", count: 6, power: 3, name: "raiders", siege: { ladders: 0, ram: 1, grenades: 0 } });
  const r = b.rams[0];
  const crew = r ? r.crew.map((id) => b.units.find((u) => u.id === id)) : [];
  const lead = crew[0];
  check(r && crew.length === RAM.CREW && lead.mob === RAM.MOB && crew.every((u) => !canFire(b, u)), `three carry the ram, the lead at ${RAM.MOB} tiles an action, none of them can shoot`);
  check(crew.every((u) => !coverAgainst(b, u.x, u.y, 0, u.y).any) && shotPriority(b, crew[1]) === 1.8, "the crew has no cover, and the AI shoots it first (×1.8)");
  const gi = b.cells.findIndex((c) => c.k === "gate");
  const gx = gi % b.w, gy = (gi / b.w) | 0, gate = b.cells[gi];
  park(b, [...crew]);
  for (const u of b.units) if (u.side === "player") { u.dead = false; u.down = false; u.x = 2; u.y = u.id % b.h; }
  lead.x = gx + 1; lead.y = gy;
  crew[1].x = gx + 2; crew[1].y = gy; crew[2].x = gx + 1; crew[2].y = gy === 0 ? gy + 1 : gy - 1;
  const swings = [];
  for (let i = 0; i < 10 && gate.hp > 0; i++) {
    for (const u of crew) u.ap = 2;
    const was = gate.hp;
    siegeAct(st, b, lead, null, { type: "ram" });
    swings.push(was - Math.max(0, gate.hp));
    if (i === 0) check(crew.every((u) => u.ap === 0), "a swing spends the whole crew's turn");
  }
  check(swings[0] >= RAM.DMG[0] * 3 && swings[0] <= RAM.DMG[1] * 3, `three carriers: −${swings[0]} a swing (3 × ${RAM.DMG[0]}–${RAM.DMG[1]})`);
  check(!(gate.bar && gate.hp > 0), `the gate (${gate.mhp} hit points) gives way after ${swings.length} swings`);
  // The crew is exposed: the same shot at the same man, carrying and not.
  const p = b.units.find((u) => u.side === "player" && active(u));
  p.x = 6; p.y = gy; b.losCache.fill(0);
  const t = crew[1];
  const carrying = shotOdds(b, p, t).chance;
  siegeAct(st, b, lead, null, { type: "dropRam" });
  const free = shotOdds(b, p, t).chance;
  check(r.dropped && carrying - free === 10 && t.ram == null && (!WEAPONS_RANGED(t) || canFire(b, t)), `set down: the crew is free again (can shoot, takes cover) and no easier to hit (${carrying}% carrying → ${free}%)`);
  // Taken up again by two next to it; the lead walks and the crew keeps up.
  lead.ap = 2; crew[1].x = lead.x; crew[1].y = lead.y + (lead.y < b.h - 1 ? 1 : -1);
  check(siegeAct(st, b, lead, null, { type: "takeRam" }) === "" && !r.dropped && r.crew.length >= 2, `taken up again by ${r.crew.length}`);
  const rr = reachable(b, lead, lead.mob);
  let to = -1;
  for (let i = 0; i < b.w * b.h; i++) if (isFinite(rr.dist[i]) && rr.dist[i] >= 2 && (i % b.w) > lead.x) { to = i; break; }
  if (to >= 0) moveAlong(b, lead, pathTo(rr, to % b.w, (to / b.w) | 0));
  check(to >= 0 && r.crew.every((id) => { const o = b.units.find((u) => u.id === id); return Math.max(Math.abs(o.x - lead.x), Math.abs(o.y - lead.y)) <= 1; }), "the lead walks on and the crew keeps up with it");
  // Too few left: dropped.
  const others = r.crew.filter((id) => id !== lead.id).map((id) => b.units.find((u) => u.id === id));
  for (const o of others) o.dead = true;
  combatAct(st, { type: "end" }); // any action bumps the battle (checkRams)
  check(r.dropped && lead.ram == null, "with only one left to carry it, the ram is dropped");
  // Rocks from the walls.
  const st2 = world(seed + 1);
  fortHub(st2);
  const b2 = wallBattle(st2, { kind: "raiders", count: 6, power: 3, name: "raiders", siege: { ladders: 0, ram: 1, grenades: 0 } });
  const r2 = b2.rams[0];
  const crew2 = r2.crew.map((id) => b2.units.find((u) => u.id === id));
  const y2 = wallRow(b2);
  const dfd = b2.units.find((u) => u.side === "player" && active(u));
  dfd.x = DEPLOY.LINE_X; dfd.y = y2;
  crew2[0].x = DEPLOY.WALL_X + 1; crew2[0].y = y2; crew2[1].x = DEPLOY.WALL_X + 2; crew2[1].y = y2; crew2[2].x = DEPLOY.WALL_X + 1; crew2[2].y = y2 + 1;
  let hits = 0, splash = 0;
  for (let i = 0; i < 200; i++) {
    for (const u of crew2) { u.hp = u.maxHp; u.dead = false; u.down = false; u.ram = r2.id; }
    r2.dropped = false; r2.crew = crew2.map((u) => u.id); r2.lead = crew2[0].id;
    dfd.ap = 2;
    const before = crew2.map((u) => u.hp);
    siegeAct(st2, b2, dfd, crew2[0], { type: "drop" });
    if (crew2[0].hp < before[0]) hits++;
    if (crew2[1].hp < before[1] || crew2[2].hp < before[2]) splash++;
  }
  check(Math.abs(hits / 200 - DROP.CHANCE / 100) < 0.08 && splash === hits, `a rock from the walkway on the ram's crew below: hits ${pct(hits, 200)} (${DROP.CHANCE}%), and every hit glances onto another of the crew`);
  const far = b2.units.find((u) => u.side === "enemy" && !r2.crew.includes(u.id));
  far.x = DEPLOY.WALL_X + 4; far.y = y2; dfd.ap = 2;
  check(siegeAct(st2, b2, dfd, far, { type: "drop" }) !== "", `nothing to drop on ${DROP.RANGE + 2} tiles out`);
}

// ---------- 4. fire ----------
section("Fire: a 3 × 3 patch, spreading by fuel, the dead drawn in and burned, people's AI walking round it, smoke");
{
  const st = world();
  fortHub(st);
  const b = openBattle(st, { kind: "zombies", count: 4, power: 3 });
  const me = b.units.find((u) => u.side === "player");
  landEffect(b, me, THROWABLES.molotov, 9, 6);
  const turns = b.fires.map((f) => f.turns);
  check(b.fires.length === 9 && b.fires.find((f) => f.x === 9 && f.y === 6).turns === FIRE.turns && turns.every((t) => t >= FIRE.edge[0] && t <= FIRE.turns), `a Molotov: 9 cells burn, the middle ${FIRE.turns} turns, the rest ${FIRE.edge[0]}–${FIRE.edge[1]} (${turns.join(",")})`);
  check(b.smoke.filter((s) => s.thick).length === 9, "every burning cell smokes");
  // Spread by fuel (one burning cell, one neighbour of each kind, many rounds).
  const spreads = {};
  for (const [name, set] of [["hay", (c) => { c.k = "hay"; }], ["barricade", (c) => { c.k = "barricade"; }], ["grass", (c) => { c.k = "open"; c.f = "grass"; }], ["field", (c) => { c.k = "open"; c.f = "field"; }], ["road", (c) => { c.k = "open"; c.f = "road"; }], ["dirt", (c) => { c.k = "open"; c.f = "dirt"; }], ["wall", (c) => { c.k = "wall"; }], ["water", (c) => { c.k = "water"; }]]) {
    let n = 0;
    for (let i = 0; i < 1500; i++) {
      b.fires = [{ x: 4, y: 4, r: 0.5, turns: 5 }]; b.smoke = [];
      for (const [x, y] of [[3, 4], [5, 4], [4, 3], [4, 5]]) { const c = cellAt(b, x, y); c.k = "open"; c.f = "dirt"; }
      set(cellAt(b, 5, 4));
      for (const u of b.units) if (u.x === 5 && u.y === 4) u.x = 0;
      burnRound(b);
      if (fireAt(b, 5, 4)) n++;
    }
    spreads[name] = n / 1500;
  }
  const want = { hay: FIRE.fuel.hay, barricade: FIRE.fuel.barricade, grass: FIRE.ground.grass, field: FIRE.ground.field, road: 0, dirt: 0, wall: 0, water: 0 };
  check(Object.keys(want).every((k) => Math.abs(spreads[k] - want[k]) < 0.04), `spreads a round: ${Object.entries(spreads).map(([k, v]) => `${k} ${pct(v * 100, 100)}`).join(", ")} (never stone, asphalt, dirt or water)`);
  // Wood burns out to rubble.
  b.fires = []; b.smoke = [];
  const bc = cellAt(b, 7, 7); bc.k = "barricade";
  ignite(b, 7, 7, 1);
  burnRound(b);
  check(bc.k === "rubble" && !fireAt(b, 7, 7), "a burning barricade burns out to rubble");
  // Smoke blocks sight through it.
  b.fires = []; b.smoke = [{ x: 6, y: 2, r: 0.5, turns: 1, thick: true }];
  for (const c of b.cells) if (c.k !== "open") c.k = "open";
  b.losCache.fill(0);
  me.x = 2; me.y = 2;
  check(!canSeeAt(b, me, 10, 2) && canSeeAt(b, me, 10, 4) && smokeBlocks(b, 2, 2, 10, 2), "a fire's thick smoke blocks a sight line through it");
  // The dead walk into it and burn.
  b.smoke = []; b.fires = [];
  const z = b.units.find((u) => u.side === "enemy");
  for (const u of b.units) if (u.side === "enemy" && u !== z) u.dead = true;
  me.x = 1; me.y = 1; z.x = 14; z.y = 8; z.aware = true; z.ap = 2;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) ignite(b, 10 + dx, 8 + dy, 3);
  const hp0 = z.hp;
  check(lureTurn(b, z) && (fireAt(b, z.x, z.y) || z.dead) && z.hp < hp0, `one of the dead that sees you walks into the flames instead (to ${z.x},${z.y}) and burns (${Math.round(hp0 - z.hp)})`);
  // How long the dead last in fire: entering burns once, every round in it again.
  let in2 = 0;
  for (let i = 0; i < 2000; i++) {
    const p = 2 + (i % 3);
    const hp = Math.round(15 + p * 7);
    const [lo, hi] = burnRange({ kind: "zombie" });
    const dmg = b.rng.int(lo, hi) + b.rng.int(lo, hi);
    if (dmg >= hp) in2++;
  }
  const brute = burnRange({ kind: "zombie", ztype: "brute" });
  check(in2 / 2000 > 0.6 && brute[1] < burnRange({ kind: "zombie" })[1] && burnRange({ kind: "human" })[1] === FIRE.burn[1], `most of the dead (power 2–4) are dead within the turn they walk in and the next (${pct(in2, 2000)}); a brute burns ${brute[0]}–${brute[1]}, people ${FIRE.burn[0]}–${FIRE.burn[1]}`);
  // People's AI walks round it; a player's own order may go through.
  const st2 = world(seed + 2);
  fortHub(st2);
  const b2 = openBattle(st2, { kind: "raiders", count: 1, power: 3 });
  const raider = b2.units.find((u) => u.side === "enemy");
  const pl = b2.units.find((u) => u.side === "player");
  raider.x = 12; raider.y = 6; pl.x = 6; pl.y = 6;
  for (let y = 0; y < b2.h; y++) ignite(b2, 9, y, 3);
  const rr = reachable(b2, raider, 12), rp = reachable(b2, pl, 12, { manual: true }), ra = reachable(b2, pl, 12);
  check(!isFinite(rr.dist[6 * b2.w + 9]) && !isFinite(rr.dist[6 * b2.w + 7]) && isFinite(rp.dist[6 * b2.w + 9]) && !isFinite(ra.dist[6 * b2.w + 9]), "a wall of fire: the raiders' AI (and your people's) will not walk through it; your own order can");
}

// ---------- 5. decoys by sense ----------
section("Decoys by sense: noise, heat and light per kind of the dead; people are not fooled");
{
  const st = world();
  fortHub(st);
  const b = openBattle(st, { kind: "zombies", count: 8, power: 3 });
  const me = b.units.find((u) => u.side === "player");
  const kinds = [null, "runner", "brute", "spitter", "screamer", "crawler", "shepherd"];
  const zs = b.units.filter((u) => u.side === "enemy").slice(0, kinds.length);
  zs.forEach((z, i) => { if (kinds[i]) applyZType(z, kinds[i], false, 3); z.x = 12 + (i % 3); z.y = 2 + i; z.aware = true; });
  // Keep the Shepherd far from the rest (its aura would cover them).
  zs[6].x = b.w - 1; zs[6].y = b.h - 1;
  me.x = 1; me.y = 1;
  const table = zs.map((z, i) => `${kinds[i] || "ordinary"}: ${sensesOf(b, z).join("+") || "nothing"}`);
  console.log(`    ${table.join(" · ")}`);
  const pulledBy = (key) => {
    b.lures = [];
    throwAt(b, me, key, 13, 6);
    return zs.map((z, i) => (pullOf(b, z) ? kinds[i] || "ordinary" : null)).filter(Boolean);
  };
  const noise = pulledBy("alarmclock"), heat = pulledBy("heatpack"), light = pulledBy("flare");
  check(noise.join() === "ordinary,runner,brute,spitter", `an alarm clock (noise) pulls: ${noise.join(", ")}`);
  check(heat.join() === "crawler", `a heat pack (heat) pulls: ${heat.join(", ")}`);
  check(light.join() === "ordinary,spitter,crawler", `a road flare (light and heat) pulls: ${light.join(", ")}`);
  check(sensesOf(b, zs[4]).length === 0 && sensesOf(b, zs[6]).length === 0, "screamers and Shepherds follow nothing");
  // The aware dead go to it; people do not.
  b.lures = [];
  throwAt(b, me, "alarmclock", 13, 6);
  const runner = zs[1]; runner.x = 13; runner.y = 11; runner.ap = 2;
  const d0 = Math.hypot(runner.x - 13, runner.y - 6);
  lureTurn(b, runner);
  check(Math.hypot(runner.x - 13, runner.y - 6) < d0, `a runner that has seen you goes to the ringing (${d0.toFixed(1)} → ${Math.hypot(runner.x - 13, runner.y - 6).toFixed(1)} tiles)`);
  const st2 = world(seed + 3);
  fortHub(st2);
  const b2 = openBattle(st2, { kind: "raiders", count: 3, power: 3 });
  const me2 = b2.units.find((u) => u.side === "player");
  const [g1, g2, g3] = b2.units.filter((u) => u.side === "enemy");
  me2.x = 3; me2.y = 6; g1.x = 12; g1.y = 4; g2.x = 12; g2.y = 8; g3.x = 13; g3.y = 6;
  g1.aware = g2.aware = false; g3.aware = true;
  throwAt(b2, me2, "alarmclock", 11, 6);
  check(g1.investigate && g1.investigate.x === 3 && g1.investigate.y === 6 && !pullOf(b2, g3), "people are not fooled: an unaware guard who hears an alarm clock looks to where it was thrown from; an aware one ignores it");
  delete g2.investigate;
  b2.lures = [];
  throwAt(b2, me2, "heatpack", 11, 8);
  check(!g2.investigate, "a heat pack is silent: people never notice it");
  throwAt(b2, me2, "bottle", 11, 8);
  check(g2.investigate && g2.investigate.x === 11 && g2.investigate.y === 8, "a bottle is still a stealth lure: the guard goes to look where it smashed");
  check(DECOY_KEYS.every((k) => GEAR[k] && THROWABLES[k].decoy && THROWABLES[k].sense.length), `decoys: ${DECOY_KEYS.join(", ")} (each with its senses)`);
}

// ---------- 6. the Shepherd ----------
section("The Shepherd: its aura, decoys and fire wasted on its pack, the aura gone when it dies");
{
  const st = world();
  fortHub(st);
  const b = openBattle(st, { kind: "zombies", count: 6, power: 3, types: { shepherd: 1 } });
  const me = b.units.find((u) => u.side === "player");
  const sh = b.units.find((u) => u.ztype === "shepherd");
  const pack = b.units.filter((u) => u.side === "enemy" && u !== sh);
  check(!!sh && sh.maxHp > pack[0].maxHp && ZTYPES.shepherd.aura === SHEPHERD.AURA, `a Shepherd among the dead (${sh && sh.maxHp} hit points against ${pack[0].maxHp}), aura ${SHEPHERD.AURA} tiles`);
  sh.x = 14; sh.y = 6; me.x = 1; me.y = 6;
  pack.forEach((z, i) => { z.x = 12 + (i % 2); z.y = 4 + i; });
  const out = pack[pack.length - 1]; out.x = 14; out.y = 12;
  check(pack.slice(0, -1).every((z) => herded(b, z)) && !herded(b, out), "the dead within 4 tiles are herded, one further off is not");
  throwAt(b, me, "alarmclock", 12, 9);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) ignite(b, 9 + dx, 6 + dy, 3);
  check(pack.slice(0, -1).every((z) => !pullOf(b, z)) && !!pullOf(b, out), "an alarm clock and a fire pull none of its pack, but pull the one outside the aura");
  const rs = reachable(b, sh, 20);
  check(!isFinite(rs.dist[6 * b.w + 9]), "the Shepherd will not walk through the flames");
  check(shotPriority(b, sh) === ZTYPES.shepherd.priority, `the AI shoots the Shepherd first (×${ZTYPES.shepherd.priority})`);
  sh.dead = true;
  check(pack.slice(0, -1).every((z) => !herded(b, z) && pullOf(b, z)), "killed, the aura ends: its pack turns for the decoy and the flames");
  check(battleOverlays(b).auras.length === 0, "and its aura is gone from the map");
  // Unlocked late.
  check(GROWTHS.fold.unlocks === "shepherd" && yearOfDay(TECH.TIER_DAY[GROWTHS.fold.tier]) >= SHEPHERD.YEAR, `the Shepherd's fold: tier ${GROWTHS.fold.tier}, open from day ${TECH.TIER_DAY[GROWTHS.fold.tier]} (game year ${yearOfDay(TECH.TIER_DAY[GROWTHS.fold.tier])})`);
  const hv = st.hives[0];
  hv.res = 80;
  const g = startGrowth(st, hv, "fold");
  if (g) g.ready = st.hour;
  check(g && hiveMods(st, hv).unlocks.includes("shepherd"), "a grown fold: its hive's hordes bring Shepherds");
  // On the State Map: the horde warning, decoys hardly work.
  const h = hub(st);
  st.live.add(h.tile);
  const near = st.grid.neighbors(h.tile)[0];
  st.live.add(near);
  const hd = makeHorde(st, { tile: near, size: 120, role: "attack", target: h.tile, mix: { shepherd: 0.05 } });
  const plain = makeHorde(st, { tile: near, size: 120, role: "roam", target: null });
  st.cards = [];
  hordeWarnings(st);
  const card = st.cards.find((c) => /^Horde heading/.test(c.title));
  check(card && /led by something that isn't fooled/.test(card.text), `the warning card: "${card ? card.text.match(/It moves together[^.]*\./)[0] : "no card"}"`);
  check(ledByShepherd(hd) && Math.abs(decoyChance(hd) - decoyChance(plain) * SHEPHERD.DECOY_CUT) < 1e-9, `a decoy fire turns it ${pct(decoyChance(hd) * 100, 100)} of the time, not ${pct(decoyChance(plain) * 100, 100)}`);
  // By the numbers: its weight, and decoys lose their value.
  const plainE = { kind: "zombies", count: 20, power: 3 }, ledE = { kind: "zombies", count: 20, power: 3, types: { shepherd: 1 } };
  check(lureEdge(plainE, ["alarmclock", "molotov", "heatpack"]) > 0 && lureEdge(ledE, ["alarmclock", "molotov", "heatpack"]) === 0 && lureEdge({ kind: "raiders", count: 5 }, ["alarmclock"]) === 0, `by the numbers, decoys and Molotovs add ${pct(lureEdge(plainE, ["alarmclock", "molotov", "heatpack"]) * 100, 100)} against the dead, nothing against a Shepherd's pack or people`);
}

// ---------- 7. raiders bring kit by preparedness ----------
section("Raiders' siege kit by preparedness (eras.js), the warning card, the battle");
{
  const st = world();
  const h = fortHub(st);
  const rows = [];
  let prev = -1, rising = true;
  for (const y of [1, 3, 5, 8, 10]) {
    st.hour = (yearStartDay(y) - 1) * 24;
    let any = 0, lad = 0, ram = 0, gren = 0, out = 0;
    for (let k = 0; k < 300; k++) {
      const kit = raidSiegeKit(st, h, { count: 8, key: k });
      const o = raidSiegeKit(st, h, { count: 8, key: k, outsider: true });
      if (kit) { any++; if (kit.ladders) lad++; if (kit.ram) ram++; if (kit.grenades) gren++; }
      if (o) out++;
    }
    rows.push(`year ${y}: ${pct(any, 300)} (ladders ${pct(lad, 300)}, ram ${pct(ram, 300)}, grenades ${pct(gren, 300)}; outsiders ${pct(out, 300)})`);
    if (any < prev) rising = false;
    prev = any;
    if (y === 1) check(any === 0, "year 1: no raid brings siege kit");
    if (y === 10) check(any > 250 && lad > 200 && ram > 150 && out < any, `year 10: nearly every raid on a walled base does; outsiders less often`);
  }
  console.log(`    ${rows.join("\n    ")}`);
  check(rising, "more of them every era");
  const bare = makeSurvivor(st);
  const open = { ...h, buildings: h.buildings.filter((x) => x.type !== "walls") };
  check(raidSiegeKit(st, open, { count: 8, key: 1 }) === null, "none against a base without walls");
  check(raidSiegeKit(st, h, { count: 8, key: 5 }) === raidSiegeKit(st, h, { count: 8, key: 5 }) || JSON.stringify(raidSiegeKit(st, h, { count: 8, key: 5 })) === JSON.stringify(raidSiegeKit(st, h, { count: 8, key: 5 })), "the same raid always brings the same kit (no world dice)");
  check(kitText({ ladders: 2, ram: 1, grenades: 2, kind: "frag" }) === "They carry 2 ladders and a battering ram, and 2 grenades to throw over the walls.", `card text: "${kitText({ ladders: 2, ram: 1, grenades: 2, kind: "frag" })}"`);
  void bare;
  // The warning card and the battle: a real raid of a group's, its kit out of the group's own stores (arsenal.js
  // packRaidKit; docs/adr/0001-ai-parity.md): two ladders and a ram on its books, three pipe bombs spare.
  const f = st.factions.find((x) => x.alive && x.bases.length);
  ensureArsenal(st, f); ensureMembers(st, f); syncMembers(st, f);
  const nG = () => new Set([...f.arsenal.items, ...membersOf(f).flatMap((s) => allCarried(s))].filter((it) => it && (it.key === "frag" || it.key === "pipebomb"))).size; // each grenade once, wherever it is
  const kit0 = [newItem("ladder"), newItem("ladder"), newItem("ram")];
  for (const it of [...kit0, newItem("pipebomb"), newItem("pipebomb"), newItem("pipebomb")]) addToArsenal(st, f, it, "test");
  const books0 = new Set(f.arsenal.items.filter((it) => it.key === "frag" || it.key === "pipebomb")), g0 = nG();
  const raid = spawnAiParty(st, f, "raid", f.bases[0], h.tile, { strength: 40, target: { kind: "player", baseId: h.id, tile: h.tile } });
  raid.siege = packRaidKit(st, f, raid, { ladders: 2, ram: 1, grenades: 2, kind: "pipebomb" });
  const raiders = partyPeople(f, raid);
  const onThem = raiders.flatMap((s) => allCarried(s)).filter((it) => it.key === "frag" || it.key === "pipebomb");
  check(raid.siege && raid.siege.carried && raid.siege.ladders === 2 && raid.siege.ram === 1 && raid.siege.grenades === 2 && kit0.every((it) => raid.siegeGear.includes(it) && it.withParty === raid.id && !spareKit(f).includes(it)),
    `the raid takes the group's own two ladders and ram (out with it, not spare at home) and ${raid.siege && raid.siege.grenades} grenades`);
  check(onThem.length >= 2 && onThem.every((it) => books0.has(it)) && nG() === g0, `the grenades are the group's own, carried by the raiders (${onThem.length} on ${raiders.length} of them; ${g0} in the group before and after: none made, none lost)`);
  st.cards = [];
  raidWarning(st, raid);
  const card = st.cards[st.cards.length - 1];
  check(card && /They carry 2 ladders and a battering ram, and 2 pipe bombs/.test(card.text), `the raid warning card says what they bring ("${card && card.text.match(/They carry[^.]*\./)[0]}")`);
  globalThis.window = {};
  try { defendInPerson(st, raid); } finally { delete globalThis.window; }
  const b = st.combat;
  const theirs = b.units.filter((u) => u.side === "enemy" && u.who);
  const thrown = (u) => Object.entries(u.throwables || {}).filter(([k]) => k === "frag" || k === "pipebomb").reduce((a, [, n]) => a + n, 0);
  const held = (u) => allCarried(u.who).filter((it) => it.key === "frag" || it.key === "pipebomb").length;
  const ladders = b.units.filter((u) => u.ladder > 0).length, gren = theirs.reduce((a, u) => a + thrown(u), 0);
  check(b && b.setup.enemy.siege && b.rams.length === 1 && ladders === 2 && gren >= 2 && theirs.every((u) => thrown(u) === held(u)), `defended in person: the ram with a crew of ${b.rams[0] && b.rams[0].crew.length}, ${ladders} ladder carriers, ${gren} grenades among the raiders, each one an item someone carries (none handed out by the battle)`);
  st.combat = null;
  // Home again with whoever is left: the ladders and the ram are spare at home, on the books.
  removeParty(st, raid);
  check(kit0.every((it) => f.arsenal.items.includes(it) && it.withParty == null && spareKit(f).includes(it)), "the raid home: its ladders and ram back at home, spare on the books");
  // A raid nobody comes back from, ended at your walls: what it carried lies in your yard.
  const raid2 = spawnAiParty(st, f, "raid", f.bases[0], h.tile, { strength: 40, target: { kind: "player", baseId: h.id, tile: h.tile } });
  raid2.siege = packRaidKit(st, f, raid2, { ladders: 1, ram: 0, grenades: 0, kind: "pipebomb" });
  const lad = raid2.siegeGear && raid2.siegeGear[0];
  for (const s of partyPeople(f, raid2)) removeMember(st, f, s, "died");
  raid2.idx = raid2.path.length - 1;
  removeParty(st, raid2);
  check(lad && !f.arsenal.items.includes(lad) && h.armory.includes(lad), "a raid wiped out at your walls: its ladder is in your armory, off their books");
  // A group with no explosives and no means to make a ram brings none.
  const o = st.factions.find((x) => x.alive && x !== f && x.bases.length);
  ensureArsenal(st, o); ensureMembers(st, o); syncMembers(st, o);
  for (const it of o.arsenal.items.filter((x) => ["frag", "pipebomb", "ram", "ladder"].includes(x.key))) removeFromArsenal(o, it, "test");
  for (const s of membersOf(o)) for (const it of allCarried(s)) if (it && (it.key === "frag" || it.key === "pipebomb")) removeFromArsenal(o, it, "test");
  o.stock.scrap = 0;
  const raid3 = spawnAiParty(st, o, "raid", o.bases[0], h.tile, { strength: 40, target: { kind: "player", baseId: h.id, tile: h.tile } });
  const k3 = packRaidKit(st, o, raid3, { ladders: 2, ram: 1, grenades: 3, kind: "frag" });
  check(!k3, `no explosives, no scrap to make a ladder or a ram: no siege kit (${JSON.stringify(k3)})`);
  removeParty(st, raid3);
}

// ---------- 7b. raiders from beyond the border: their own ladders and ram ----------
section("Raiders from beyond the border: the ladders and the ram they set out with, carried, brought, home with the living");
{
  const st = world();
  const h = fortHub(st);
  st.hour = (yearStartDay(8) - 1) * 24;
  // They set out with them (siege.js bandSetOutKit, thrown once at the border): real items in the band's gear.
  const bands = [];
  for (let i = 0; i < 40; i++) { const v = V.spawnVisitor(st, "raiders", { size: 9, power: 4 }); if (v) bands.push(v); }
  const gearOf = (v) => V.siegeGearOf(v);
  const withKit = bands.filter((v) => gearOf(v).ram || gearOf(v).ladders.length);
  check(withKit.length > 5 && withKit.length < bands.length && bands.every((v) => { const k = bandSetOutKit(st, 9, v.serial) || { ladders: 0, ram: 0 }; return gearOf(v).ladders.length === k.ladders && !!gearOf(v).ram === !!k.ram; }),
    `year 8: ${withKit.length} of ${bands.length} bands set out with ladders or a ram (${bands.filter((v) => gearOf(v).ram).length} rams), each as its set-out dice said, as items in their gear`);
  const v = withKit.find((x) => gearOf(x).ram && gearOf(x).ladders.length) || withKit[0];
  const kg = [gearOf(v).ram, ...gearOf(v).ladders].filter(Boolean).reduce((a, it) => a + GEAR[it.key].weight, 0);
  const room = bandRoom(st, v), keep = v.wares.slice();
  v.wares = v.wares.filter((it) => it.key !== "ram" && it.key !== "ladder");
  check(Math.abs(bandRoom(st, v) - room - kg) < 1e-6, `they carry them: ${kg} kg of their people's load (nomads.js bandRoom, your teams' rule)`);
  v.wares = keep;
  for (const x of bands) if (x !== v) V.leaveMap(st, x);
  // Against your walled base they bring all they have hands for; the card says so; against an open base, nothing.
  const kit = V.bandKit(st, v, h);
  const have = gearOf(v);
  check(kit && kit.carried && kit.ladders === have.ladders.length && kit.ram === (have.ram ? 1 : 0), `at your walls: ${kitText(kit)} (their own: ${have.ladders.length} ladders, ${have.ram ? "a ram" : "no ram"})`);
  const open = { ...h, id: -7, buildings: h.buildings.filter((x) => x.type !== "walls") };
  check(V.bandKit(st, v, open) === null, "none against a base without walls");
  // The battle on the map hands out exactly those (siege.js siegeSetup).
  const b = wallBattle(st, { kind: "raiders", count: v.size, power: v.power, name: "Outsiders", siege: kit, band: { kind: "visitor", id: v.id } });
  check(b.rams.length === kit.ram && b.units.filter((u) => u.ladder > 0).length === kit.ladders, `on the map: ${b.rams.length} ram, ${b.units.filter((u) => u.ladder > 0).length} ladder carriers, from their own gear`);
  st.combat = null;
  // Home with the living (siegeGearBack): two left carry the ram; the ladders nobody can carry lie in your yard.
  const items0 = [have.ram, ...have.ladders].filter(Boolean), arm0 = h.armory.length;
  v.size = 2;
  const left = V.siegeGearBack(st, v, h);
  const where = (it) => (v.wares.includes(it) ? 1 : 0) + (h.armory.includes(it) ? 1 : 0);
  check(items0.every((it) => where(it) === 1) && (!have.ram || v.wares.includes(have.ram)) && left.length === items0.length - (have.ram ? 1 : 2) && h.armory.length === arm0 + left.length,
    `two left: ${have.ram ? "the ram goes on with them" : "two ladders go on with them"}, ${left.length} left in your armory, every piece in one place`);
  // Broken at your walls: everything they carried is in your yard, their stores in yours.
  v.stock.scrap = 7;
  const scrap0 = h.stock.scrap || 0, rest = v.wares.slice();
  V.leaveMap(st, v, "broken", { base: h });
  check(rest.every((it) => h.armory.includes(it)) && (h.stock.scrap || 0) === scrap0 + 7 && !v.wares.length, `broken at your walls: ${rest.length} piece${rest.length === 1 ? "" : "s"} and their 7 scrap in your base, nothing lost`);
  // Wiped out on the road: it lies on the ground where they fell.
  const w = V.spawnVisitor(st, "raiders", { size: 6, power: 3 });
  w.wares.push(newItem("ladder"));
  const lad = w.wares[w.wares.length - 1];
  V.leaveMap(st, w, "wiped");
  const ground = groundAt(st, w.tile);
  check(ground && ground.items.some((x) => x.item === lad), "wiped out on the road: their ladder lies on the ground there (carry.js groundAt)");
  // Nothing from nowhere: a band with none brings none. Short of what a raid's dice want, it makes them by a group's
  // crafting (arsenal.js bandMakes) only when it has the means: your recipe needs a bench, and a band on the road has
  // none (as your team in the field has none).
  const n = V.spawnVisitor(st, "raiders", { size: 9, power: 4 });
  n.wares = n.wares.filter((it) => it.key !== "ram" && it.key !== "ladder");
  n.stock.scrap = 20; n.stock.parts = 4;
  const people = bandRoom(st, n) && n.people;
  people[0].skills.mechanics = 6; people[0].health = 100;
  const made0 = V.makeSiegeGear(st, n, { ladders: 2, ram: 1 });
  check(!made0.length && n.stock.scrap === 20 && n.stock.parts === 4, "a band on the road has no bench: it makes no ladder or ram, and pays nothing");
  n.siegeFor = { baseId: h.id, kit: { ladders: 2, ram: 1, grenades: 0 } };
  const kn = V.bandKit(st, n, h);
  check(!kn || (!kn.ladders && !kn.ram), `with none of its own it brings none (${JSON.stringify(kn)})`);
  // With the means (a world whose groups count as built, as old saves did: groupworks.js groupsBuild), the same path a
  // group's raid takes (arsenal.js packRaidKit): your recipe, paid from its stores, into its gear.
  const gw = st.groupWorks;
  st.groupWorks = null;
  const made = V.makeSiegeGear(st, n, { ladders: 2, ram: 1 });
  st.groupWorks = gw;
  const R = CRAFTS.ram.in, L = CRAFTS.ladder.in;
  check(made.length === 3 && made.filter((it) => it.key === "ladder").length === 2 && made.some((it) => it.key === "ram") && made.every((it) => n.wares.includes(it)) &&
    n.stock.scrap === 20 - R.scrap - 2 * L.scrap && n.stock.parts === 4 - R.parts, `with a bench: a ram and two ladders made by your recipes, paid from their stores (scrap 20 → ${n.stock.scrap}, parts 4 → ${n.stock.parts})`);
  // By the numbers at your walls: every piece is with the band or in your yard after it, none made, none lost.
  n.goal = { kind: "base", baseId: h.id, tile: h.tile };
  n.tile = h.tile;
  const all = [...gearOf(n).ladders, gearOf(n).ram].filter(Boolean), armA = h.armory.length;
  V.resolveRaidOnYou(st, n);
  check(all.every((it) => (n.wares.includes(it) && st.visitors.includes(n) ? 1 : 0) + (h.armory.includes(it) ? 1 : 0) === 1), `a raid by the numbers: their ${all.length} pieces after it are with whoever is left (${n.size}) or in your armory (${h.armory.length - armA})`);
  V.leaveMap(st, n);
}

// ---------- 8. by the numbers ----------
section("Siege kit by the numbers: the walls count less, an assault's walls, decoys against the dead");
{
  const st = world();
  const h = fortHub(st);
  const kit = { ladders: 2, ram: 1, grenades: 2 };
  const a = raidTier(st, h, 40, 40, 1.2, 0.8), k = raidTier(st, h, 40, 40, 1.2, 0.8, kit);
  check(k.wall < a.wall && Math.abs(k.mults.wall - Math.max(1, a.mults.wall - siegeWallCut(kit))) < 1e-9 && siegeWallCut(kit) <= CUT.max, `a raid with 2 ladders, a ram and 2 grenades: the wall tier ×${a.mults.wall.toFixed(2)} → ×${k.mults.wall.toFixed(2)} (−${siegeWallCut(kit).toFixed(2)})`);
  const setup = { context: { night: false }, enemy: { kind: "raiders", count: 6, power: 4 } };
  const t1 = baseTiers(st, h, setup, 1), t2 = baseTiers(st, h, { ...setup, enemy: { ...setup.enemy, siege: kit } }, 1);
  check(t2.wall < t1.wall, `a fight at the walls by the numbers (autoResolveCombat): the walls worth ${t1.wall.toFixed(2)} → ${t2.wall.toFixed(2)}`);
  // An assault on a group's base with kit.
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const tile = f.bases[0];
  worksAt(f, tile).walls = 7; // a group's base starts bare (barestart: groupworks.js); these are the walls it builds up to
  const crew = atBase(st, h.id).slice(0, 5);
  for (const k2 of ["ram", "ladder", "ladder", "frag", "frag"]) h.armory.push(newItem(k2));
  const kitLeft = () => h.armory.filter((x) => !x.key.startsWith("mag_")).length; // (spare magazines go along too: carrykit.js packMags)
  const before = kitLeft();
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "assault", stance: "normal", supplies: { food: 10, water: 10, ammo: 40 } });
  const p = res.party;
  const tk = p ? teamKit(st, crew, p.cargo.gear) : null;
  check(p && tk.ram === 1 && tk.ladders === 1 && tk.grenades === 2 && kitLeft() === before - 4, `an assault takes the hub's siege kit along: ${p ? p.cargo.gear.map((x) => x.name).join(", ") : res.error} (a ladder for 5 people, 1 per 3)`);
  check(p && poolLoad(p) >= GEAR.ram.weight + GEAR.ladder.weight, `its weight counts (${p && Math.round(poolLoad(p))} kg in the team's pool, load.js)`);
  const plain = assaultForce(st, f, tile), withKit = assaultForce(st, f, tile, p);
  check(withKit.fortified < plain.fortified && Math.abs(withKit.fortified - Math.round((1 + 0.05 * plain.walls * (1 - assaultCut(tk))) * 100) / 100) < 1e-9, `their walls count less: defence ×${plain.fortified} → ×${withKit.fortified} (−${Math.round(assaultCut(tk) * 100)}% of the walls)`);
  // Decoys against the dead, by the numbers.
  const dead = { kind: "zombies", count: 12, power: 3 };
  const people = atBase(st, h.id).slice(0, 3);
  const o1 = byNumbersOdds(st, { baseId: h.id, enemy: dead }, people);
  stow(people[0], newItem("alarmclock")); stow(people[0], newItem("molotov"));
  const o2 = byNumbersOdds(st, { baseId: h.id, enemy: dead }, people);
  const o3 = byNumbersOdds(st, { baseId: h.id, enemy: { ...dead, types: { shepherd: 1 } } }, people);
  check(o2.mine > o1.mine && o3.mine === o1.mine, `a fight with the dead by the numbers: carrying an alarm clock and a Molotov ×${(o2.mine / o1.mine).toFixed(2)}; against a Shepherd's pack ×${(o3.mine / o1.mine).toFixed(2)}`);
}

// ---------- 9. the AI ----------
section("The AI: raiders use ladders, the ram and grenades; defenders push ladders, drop rocks, throw decoys and Molotovs");
{
  const tally = { ladders: 0, ram: 0, gren: 0, push: 0, rock: 0 };
  const outcomes = [];
  for (const s of [seed, seed + 7, seed + 11]) {
    const st = world(s);
    fortHub(st);
    const b = wallBattle(st, { kind: "raiders", count: 9, power: 4, name: "raiders", siege: { ladders: 2, ram: 1, grenades: 3, kind: "pipebomb", carried: true } });
    // Their three pipe bombs are things three of them carry (arsenal.js packRaidKit stows a group's on its raiders; the
    // battle hands none out), counted on each by fighters.js fitThrowables.
    const shooters = b.units.filter((u) => u.side === "enemy" && u.who && !u.ladder && u.ram == null).sort((a, c) => (c.aim || 0) - (a.aim || 0));
    let packed = 0;
    for (const u of shooters) { if (packed >= 3) break; if (stow(u.who, newItem("pipebomb"))) { fitThrowables(u, u.who); packed++; } }
    const seen = [];
    const keep = b.log.push.bind(b.log);
    b.log.push = (l) => { seen.push(l.text); return keep(l); };
    play(st);
    outcomes.push(b.result ? b.result.outcome : "open");
    if (seen.some((t) => /sets a ladder/.test(t))) tally.ladders++;
    if (seen.some((t) => /swings the ram/.test(t))) tally.ram++;
    if (seen.some((t) => /throws a pipe bomb/.test(t))) tally.gren++;
    if (seen.some((t) => /pushes the ladder off|heaves at the ladder/.test(t))) tally.push++;
    if (seen.some((t) => /rock/.test(t))) tally.rock++;
  }
  check(tally.ladders === 3 && tally.ram >= 2 && tally.gren >= 2, `raiders with siege kit (3 battles): ladders set up in ${tally.ladders}, the ram swung in ${tally.ram}, pipe bombs thrown in ${tally.gren} (${outcomes.join(", ")})`);
  check(tally.push >= 2 && tally.push + tally.rock >= 3, `your AI pushes ladders (${tally.push} battles) and drops rocks (${tally.rock})`);
  // A decoy to pull the dead off your people.
  const st = world(seed + 4);
  fortHub(st);
  const b = openBattle(st, { kind: "zombies", count: 8, power: 3 }, 3);
  const mine = b.units.filter((u) => u.side === "player");
  mine.forEach((u, i) => { u.x = 3; u.y = 4 + i * 2; });
  b.units.filter((u) => u.side === "enemy").forEach((z, i) => { z.x = 6 + (i % 2); z.y = 3 + i; z.aware = true; });
  stow(st.survivors.find((x) => x.id === mine[0].sid), newItem("alarmclock"));
  autoPlayerTurn(st);
  const lure = b.lures.find((l) => l.key === "alarmclock");
  check(!!lure && mine.every((u) => Math.hypot(u.x - lure.x, u.y - lure.y) >= 4.5), `with the dead on them, the AI throws the alarm clock away from your people (${lure ? `${lure.x},${lure.y}` : "none"})`);
  // A Molotov at a chokepoint: two of the dead at a breach are enough.
  const b3 = openBattle(st, { kind: "zombies", count: 2, power: 3 });
  const thrower = b3.units.find((u) => u.side === "player");
  const [z1, z2] = b3.units.filter((u) => u.side === "enemy");
  thrower.x = 3; thrower.y = 6; z1.x = 8; z1.y = 6; z2.x = 8; z2.y = 7;
  cellAt(b3, 8, 6).k = "breach"; b3.losCache.fill(0);
  const spotC = blastSpot(b3, thrower, 6, FIRE.r, { fire: true });
  cellAt(b3, 8, 6).k = "open"; b3.losCache.fill(0);
  const spotO = blastSpot(b3, thrower, 6, FIRE.r, { fire: true });
  check(!!spotC && !spotO, "a Molotov on two of the dead at a breach (a chokepoint), not on two in the open (three needed there)");
}

// ---------- 10. determinism and saving mid-battle ----------
section("The same battle plays out the same; saved mid-battle with fire, ladders and a ram, loaded, the same end");
{
  const run = (save) => {
    const st = world(seed + 5);
    fortHub(st);
    const b = wallBattle(st, { kind: "raiders", count: 8, power: 4, name: "raiders", siege: { ladders: 2, ram: 1, grenades: 2, kind: "frag" } });
    for (let i = 0; i < 4 && !b.over; i++) { if (b.phase === "player") autoPlayerTurn(st); else runEnemyPhase(st); }
    // A fire just inside the gate as well.
    const me = b.units.find((u) => u.side === "player" && active(u));
    landEffect(b, me, THROWABLES.molotov, DEPLOY.WALL_X + 2, Math.floor(b.h / 2));
    let w = st;
    let mid = null;
    if (save) {
      mid = { fires: b.fires.length, ladders: (b.ladders || []).length, rams: (b.rams || []).length };
      w = loadFromString(saveToString(st));
      const B = w.combat;
      mid.ok = B && B.fires.length === mid.fires && (B.ladders || []).length === mid.ladders && (B.rams || []).length === mid.rams && JSON.stringify(battleOverlays(B)) === JSON.stringify(battleOverlays(b));
    }
    play(w);
    const B = w.combat;
    return { log: B.log.map((l) => l.text).join("\n"), outcome: B.result && B.result.outcome, turn: B.turn, mid };
  };
  const a = run(false), a2 = run(false), c = run(true);
  check(a.log === a2.log && a.outcome === a2.outcome, `the same siege battle twice: the same log, ${a.outcome} on turn ${a.turn}`);
  check(c.mid && c.mid.ok && c.mid.fires > 0 && (c.mid.ladders > 0 || c.mid.rams > 0), `saved mid-battle (${c.mid.fires} burning cells, ${c.mid.ladders} ladders, ${c.mid.rams} ram): it loads with the same things on the map`);
  check(c.log === a.log && c.outcome === a.outcome, "played on from the save, it ends the same as without saving");
}

// ---------- 11. the State Map: decoys against a coming horde ----------
section("The State Map: decoys from the armory against a coming horde");
{
  const st = world(seed + 6);
  const h = fortHub(st);
  st.live.add(h.tile);
  const near = st.grid.neighbors(h.tile)[0];
  st.live.add(near);
  for (const k of ["alarmclock", "pocketradio", "noisemaker", "heatpack"]) h.armory.push(newItem(k));
  h.stock.fuel = 0;
  makeHorde(st, { tile: near, size: 200, role: "attack", target: h.tile });
  st.cards = [];
  hordeWarnings(st);
  const card = st.cards.find((c) => /^Horde heading/.test(c.title));
  const fire = card.choices.find((c) => /decoy fire/.test(c.label)), items = card.choices.find((c) => /Set out decoys/.test(c.label));
  check(fire && fire.disabled && items && !items.disabled && /3 from the armory/.test(items.label), `no fuel for a decoy fire (${DECOY_FUEL}); decoys from the armory: "${items && items.label}" (the heat pack only for crawlers)`);
  const n0 = h.armory.length;
  const out = items.resolve(st);
  check(h.armory.length === n0 - 3 && /decoy/.test(out), `used: 3 decoys go (${out})`);
  check(CRAFTS.ladder && CRAFTS.ram && GEAR.ladder.bulky && GEAR.ram.bulky && GEAR.ram.weight > GEAR.ladder.weight, "ladders and rams are crafted (the ram at a workshop) and are bulky cargo");
}

// ---------- bows on the walls ----------
section("Bows on the walls: the base's arrows (never its ammo), a bow with none fights in melee, half picked up after a win");
{
  const bowWall = (s, arrows) => {
    const st = world(s);
    const h = fortHub(st);
    for (const x of atBase(st, h.id)) { x.gear.weapon = newItem("compbow"); x.skills.shooting = 9; }
    h.stock.arrows = arrows;
    return { st, h };
  };
  {
    const { st, h } = bowWall(seed + 71, 40);
    const b = wallBattle(st, { kind: "zombies", count: 8, power: 2 });
    play(st);
    const r = b.result || {};
    check(b.over && b.ammoUsed === 0 && b.arrowsUsed > 0, `a wall of bows shoots the base's arrows, never its ammo (${b.arrowsUsed} arrows, ${b.ammoUsed} ammo, ${r.outcome})`);
    check(h.stock.arrows === 40 - b.arrowsUsed + (r.arrowsBack || 0), `the arrows come from the base's stock and go back to it (40 - ${b.arrowsUsed} + ${r.arrowsBack || 0} = ${h.stock.arrows})`);
    check(r.outcome === "victory" ? r.arrowsBack === Math.round(b.arrowsUsed / 2) : !r.arrowsBack, `about half picked up after a win, none otherwise (${r.arrowsBack} of ${b.arrowsUsed})`);
  }
  {
    const { st } = bowWall(seed + 72, 0);
    const b = wallBattle(st, { kind: "zombies", count: 6, power: 2 });
    play(st);
    const names = b.units.filter((u) => u.side === "player").map((u) => u.name);
    check(b.arrowsUsed === 0 && !b.log.some((l) => names.some((n) => l.text.startsWith(`${n} shoots`))), `bows with no arrows never shoot: they fight hand to hand (${b.result ? b.result.outcome : "open"})`);
  }
  {
    // By the numbers at the base: up to 6 arrows a bow from the stock, no ammo; about half back if it holds.
    const { st, h } = bowWall(seed + 73, 100);
    const n = atBase(st, h.id).length;
    const r = autoResolveCombat(st, { tile: h.tile, baseId: h.id, enemy: { kind: "zombies", count: 4, power: 2 }, layout: "baseDefence", handler: "st", context: {} });
    check(r.ammoUsed === 0 && r.arrowsUsed === Math.min(100, n * 6) && h.stock.arrows === 100 - r.arrowsUsed + r.arrowsBack && totalRounds(h.stock) === 300, `a base's bows by the numbers: ${r.arrowsUsed} arrows from its stock, no ammo, ${r.arrowsBack} picked up (${r.outcome})`);
    check(r.outcome === "victory" ? r.arrowsBack === Math.round(r.arrowsUsed / 2) : r.arrowsBack === 0, "held: about half the arrows back; overrun: none");
  }
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
