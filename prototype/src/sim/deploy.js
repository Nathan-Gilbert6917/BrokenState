// The deploy step before a break-in (a horde through the walls, defences.js; raiders at the gates, conflicts.js
// raidDefense; a group come to free its people, prisoners.js; outsiders, visitors.js): the base's battle map with what
// was built, the attack from the side the horde or the raiders came from on the State Map, and the defenders placed
// by hand.
//
// A base battle has three tiers on two maps: the WALL map here (tier 1), then the YARD AND BUILDINGS map
// (interior.js: tier 2 the yard with its barricades, wire and sandbags, tier 3 the last stand inside the buildings).
//
// The wall map (laid out with the attackers on the east edge, then turned: transformBattle in combat.js):
//   18 columns deep and 13 rows long (longer for a base with more buildings: as long as its yard map is tall, less 3;
//   defences.js registers the size, interior.js wallMapRows); the ladders' rows scale with it.
//   a base with walls built has a wall line (column 12 of 18). Each wall section has hit points (WALL_HP + WALL_HP_PER
//   × the base's wall strength, buildings.js baseWalls: a hub with one wall section 112, three 184; an outpost with
//   one 88) and blocks sight from the ground; the gate (2 cells in the middle, 100 hit points, 180 with a reinforced
//   gate) is barred to the attackers until it is battered open. Behind the wall runs a walkway (column 11, height 1:
//   combat.js HEIGHT) the defenders shoot down from, reached by ladders (column 10); a watchtower adds 2 towers on it
//   (height 2, full cover from anything not next to them). Breaches already made when the fight starts: for the dead
//   +1 at 120 and at 250 inside and +1 per Wallbreaker (at most 4); people (raiders, outsiders, a rescue) cut 1. A wall
//   section battered to 0 is a new breach and the walkway behind it comes down. Barricades stand behind the wall
//   (columns 8–10), spike pits (13–15) and the trench (14) in front. The attackers start outside (column 15 on).
//   Defenders can stand anywhere inside (columns 0–11), in the gate and in a breach. Whoever stands in the gate or a
//   breach holds it (blocks it), and the battle AI keeps them there, as it keeps a defender on a tower or the walkway.
//   Enough attackers inside (interior.js BREACH) and the fight moves on to the yard and buildings map; the defenders
//   can also fall back there themselves: on the wall map that is what "Sound the retreat" does. The evac strip at the
//   back (the back gate) still lets a single person slip away.
//   A base without walls has no wall map: the battle opens on the yard and buildings map (interior.js).
//   Floodlights (built and lit) light a third of the approach (left, center or right, as the defenders see it): shots
//   at anything in the light get +12 at night, +5 by day, and at night your people see whatever stands in it.
// Default positions (also what headless battles and the autopilot use): with 7+ defenders the toughest close fighter
// holds the gate (two with 9+), the best shots take the towers, the next best the walkway (spread out, not right
// next to a breach), close fighters wait a few tiles behind the openings and any other shooters stand back in
// columns 2–6, about 8 tiles from the openings.
import { MAP_W, MAP_H, CELL, WEAPONS, active, unitAt, unitById, coverAgainst, transformBattle, say } from "./combat.js";
import { count, baseWalls } from "./buildings.js";
import { poweredType } from "./power.js";
import { armoryDefence } from "./defences.js";
import { isNight } from "./world.js";
import { interiorMap, interiorUnits } from "./interior.js";

export const DEPLOY = {
  WALL_X: 12, LINE_X: 11, BARRICADE_X: [8, 10], SPIKE_X: [13, 15], TRENCH_X: 14, ENEMY_X: 15, ZONE_OPEN: 7,
  FLOOD_NIGHT: 12, FLOOD_DAY: 5, FLOOD_FROM_X: 7, MAX_BREACH: 4, INSIDE_FRAC: 0,
  // Default positions (calibrated with hivetest's break-ins): a gate holder with 7+ defenders, two with 9+; shooters
  // on the towers and the walkway; the rest in columns 2–6, about 8 tiles from the openings, a little forward.
  GATE_ONE: 7, GATE_TWO: 9, DEF_X: [2, 6], DEF_FORWARD: 0.2, DEF_OPEN: 8,
  // The wall's hit points: a section 40 + 12 × wall strength, the gate 100 (+80 reinforced). The walkway (column 11)
  // and its ladders (column 10, these rows).
  WALL_HP: 40, WALL_HP_PER: 12, GATE_HP: 100, GATE_HP_REINFORCED: 80, LADDER_ROWS: [2, 4, 8, 10], WORN: 0.002, WORN_MAX: 0.85,
};
// The attack's front on a long wall (a big base: sim/battlesize.js): whatever the wall's length, the attackers come at
// the FRONT rows either side of the gate (the old 13-row wall), the breaches are cut there and the watchtower's two
// towers and the walkway's ladders stand by it; the rest of the wall is there to fall back along.
export const FRONT = { HALF: 6, TOWER: 5, LADDERS: [-4, -2, 2, 4] };
export const inFront = (H, y) => Math.abs(y - Math.floor(H / 2)) <= FRONT.HALF;
export const SIDE_NAMES = { east: "east", west: "west", north: "north", south: "south" };
export const LIT_ZONES = { left: "Left", center: "Center", right: "Right" };
// Rows of each lit zone on the east-facing layout, as fractions of the map's height: the defenders face east, so
// "left" is the north part (on the 13-row wall map: rows 0–5, 3–9, 7–12).
const LIT_ROWS = { left: [0, 5 / 12], center: [3 / 12, 9 / 12], right: [7 / 12, 1] };
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// The side of the base the attackers come from: the direction of fromTile on the State Map (screen directions:
// north is up). Without a tile, east.
export function attackSide(state, baseTile, fromTile) {
  if (fromTile == null || baseTile == null || fromTile === baseTile || !state.grid) return "east";
  const [ax, ay] = state.grid.toPixel(baseTile, 1), [bx, by] = state.grid.toPixel(fromTile, 1);
  const dx = bx - ax, dy = by - ay;
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "east" : "west") : dy >= 0 ? "south" : "north";
}

// Where the attack came from: the setup's tile, the raid party, the horde's last tile, else their group's home.
export function fromTileOf(state, c) {
  if (c.fromTile != null) return c.fromTile;
  if (c.raidId != null) { const p = state.parties.find((x) => x.id === c.raidId); if (p && p.path) return p.path[Math.min(p.idx || 0, p.path.length - 1)]; }
  if (c.hordeId != null) { const h = state.hordes.find((x) => x.id === c.hordeId); if (h && h.from != null) return h.from; }
  if (c.factionId != null) { const f = state.factions.find((x) => x.id === c.factionId); if (f && f.bases.length) return f.bases[0]; }
  return null;
}

// Cell mapping of transformBattle for a side (the map is W0 × H0 before it is turned; the wall map by default).
export function sideTf(side, W0 = MAP_W, H0 = MAP_H) {
  if (side === "west") return (x, y) => [W0 - 1 - x, y];
  if (side === "north") return (x, y) => [y, W0 - 1 - x];
  if (side === "south") return (x, y) => [H0 - 1 - y, x];
  return (x, y) => [x, y];
}
// And back: a cell of the turned map to the east-facing layout.
export function sideUntf(side, W0 = MAP_W, H0 = MAP_H) {
  if (side === "west") return (x, y) => [W0 - 1 - x, y];
  if (side === "north") return (x, y) => [W0 - 1 - y, x];
  if (side === "south") return (x, y) => [y, H0 - 1 - x];
  return (x, y) => [x, y];
}

// The hit points of a base's wall sections and its gate (WALL_HP …).
export const wallHp = (base) => DEPLOY.WALL_HP + DEPLOY.WALL_HP_PER * (base ? baseWalls(base) : 0);
export const gateHp = (base) => DEPLOY.GATE_HP + (base && count(base, "gate") ? DEPLOY.GATE_HP_REINFORCED : 0);

// ---------- the map (layout phase "map", attackers east) ----------
export function deployMap(b, ctx, base, c) {
  const rng = ctx.rng;
  const walled = !!base && count(base, "walls") > 0;
  // No wall: the battle opens on the yard and buildings map (interior.js).
  if (!walled) return interiorMap(b, ctx, base, c);
  b.deployPlan = { walled, gate: [], breaches: [], towers: [], walkway: [], ladders: [] };
  const H = ctx.H, X = DEPLOY.WALL_X, mid = Math.floor(H / 2);
  const gate = [mid - 1, mid];
  const through = c.through || 0;
  const people = b.setup.enemy.kind !== "zombies";
  const want = people || c.raidId != null || c.rescue ? 1 : (c.bosses || 0) + (through >= 120 ? 1 : 0) + (through >= 250 ? 1 : 0);
  const rows = rng.shuffle([...Array(H).keys()].filter((y) => y >= 1 && y <= H - 2 && (y <= mid - 3 || y >= mid + 2) && inFront(H, y)));
  const breaches = [];
  for (const y of rows) {
    if (breaches.length >= Math.min(DEPLOY.MAX_BREACH, want)) break;
    if (breaches.some((o) => Math.abs(o - y) < 3)) continue;
    breaches.push(y);
  }
  const hpWall = wallHp(base), hpGate = gateHp(base);
  // A horde that broke through has already battered the wall: WORN of the hit points gone for each of the dead
  // inside (at most WORN_MAX; the gate takes the full share, each section 50–100% of it). People cut their way in.
  const worn = people ? 0 : Math.min(DEPLOY.WORN_MAX, through * DEPLOY.WORN);
  const walkway = [];
  for (let y = 0; y < H; y++) {
    const k = gate.includes(y) ? "gate" : breaches.includes(y) ? "breach" : "palisade";
    ctx.put(X, y, k);
    const cell = ctx.cellAt(X, y);
    if (k === "palisade") { cell.t = 1; cell.mhp = hpWall; cell.hp = Math.max(1, Math.round(hpWall * (1 - worn * rng.range(0.5, 1)))); }
    if (k === "gate") { cell.bar = true; cell.mhp = hpGate; cell.hp = Math.max(1, Math.round(hpGate * (1 - worn))); }
    if (k !== "palisade") { ctx.put(X - 1, y, k === "breach" ? "rubble" : "open"); ctx.put(X + 1, y, "open"); }
    else { ctx.put(X - 1, y, "walkway"); ctx.cellAt(X - 1, y).h = 1; walkway.push([X - 1, y]); }
  }
  const towers = [];
  if (count(base, "watchtower")) for (const y of [Math.max(1, mid - FRONT.TOWER), Math.min(H - 2, mid + FRONT.TOWER)]) if (!breaches.some((o) => Math.abs(o - y) < 2)) { ctx.put(X - 1, y, "tower"); ctx.cellAt(X - 1, y).h = 2; towers.push([X - 1, y]); }
  // Ladders up to the walkway (and the towers, which have their own).
  const ladders = [];
  // By the front (the rows of the old 13-row wall: DEPLOY.LADDER_ROWS), then every 6 rows along a longer wall.
  const ladderRows = [...FRONT.LADDERS.map((o) => mid + o)];
  for (let o = FRONT.HALF + 4; mid - o >= 1 || mid + o <= H - 2; o += 6) ladderRows.push(mid - o, mid + o);
  for (const y of ladderRows) {
    if (y >= 0 && y < H && ctx.cellAt(X - 1, y).k === "walkway") { ctx.put(X - 2, y, "ladder"); ladders.push([X - 2, y]); }
  }
  // Barricades: a second line behind the wall.
  const k = count(base, "barricades");
  for (let i = 0; i < k * 3 + (count(base, "gate") ? 2 : 0); i++) {
    for (let t = 0; t < 8; t++) { const x = rng.int(DEPLOY.BARRICADE_X[0], DEPLOY.BARRICADE_X[1] - 1), y = rng.int(Math.max(1, mid - FRONT.HALF), Math.min(H - 2, mid + FRONT.HALF)); if (ctx.free(x, y)) { ctx.put(x, y, "barricade"); break; } }
  }
  // The trench, then the spike pits (used this attack), in front of the wall.
  if (count(base, "trench")) for (let y = 0; y < H; y++) if (ctx.free(DEPLOY.TRENCH_X, y) && y % 4 !== 2) ctx.put(DEPLOY.TRENCH_X, y, "trench");
  for (let i = 0; i < (c.pits || 0) * 5; i++) {
    for (let t = 0; t < 8; t++) { const x = rng.int(DEPLOY.SPIKE_X[0], DEPLOY.SPIKE_X[1]), y = rng.int(Math.max(0, mid - FRONT.HALF), Math.min(H - 1, mid + FRONT.HALF)); if (ctx.free(x, y)) { ctx.put(x, y, "spikes"); break; } }
  }
  layKit(ctx, rng, c.kit || armoryDefence(base), { wireX: [X + 1, X + 1], trapX: DEPLOY.SPIKE_X, bagX: [DEPLOY.BARRICADE_X[0], DEPLOY.BARRICADE_X[1] - 1] });
  // A lane through the gate from the back of the yard to the far edge: whatever the barricades, the kit and the
  // ground put in the way, the yard always connects to the gate (and the battle's reach to the outside).
  for (const y of gate) for (let x = 0; x < ctx.W; x++) {
    if (x === X) continue;
    const cell = ctx.cellAt(x, y);
    if (!CELL[cell.k].walk) cell.k = "open";
  }
  Object.assign(b.deployPlan, { gate: gate.map((y) => [X, y]), breaches: breaches.map((y) => [X, y]), towers, walkway: walkway.filter(([x, y]) => ctx.cellAt(x, y).k === "walkway"), ladders });
}

// The armory's defence kit on the map (defences.js armoryDefence): 4 cells of wire a roll, a bear trap a trap,
// 3 sandbag cells a bundle (cover), each on a free cell in its columns.
export function layKit(ctx, rng, kit, at) {
  if (!kit) return;
  const put = (n, [x0, x1], k) => {
    for (let i = 0; i < n; i++) for (let t = 0; t < 8; t++) { const x = rng.int(x0, x1), y = rng.int(0, ctx.H - 1); if (ctx.free(x, y)) { ctx.put(x, y, k); break; } }
  };
  put((kit.wire || 0) * 4, at.wireX, "wire");
  put(kit.traps || 0, at.trapX, "beartrap");
  put((kit.bags || 0) * 3, at.bagX, "sandbag");
}

// ---------- units (layout phase "units") ----------
export function deployUnits(b, ctx, base, c) {
  const state = ctx.state;
  const plan = b.deployPlan || { walled: false, gate: [], breaches: [], towers: [] };
  if (plan.interior) return interiorUnits(b, ctx, base, c); // no wall: the yard and buildings map
  const W0 = ctx.W, H0 = ctx.H;
  const cellK = (x, y) => b.cells[y * W0 + x].k;
  const okCell = (x, y) => x >= 0 && y >= 0 && x < W0 && y < H0 && b.reach[y * W0 + x] && CELL[cellK(x, y)].walk && !unitAt(b, x, y);
  // Floodlights: lit and aimed (the center, unless the openings are elsewhere).
  const floodlit = c.floodlit ?? (!!base && count(base, "floodlights") > 0 && (poweredType(base, "floodlights") || (base.stock.fuel || 0) >= 2));
  const night = c.night ?? isNight(state);
  b.floodAim = floodlit ? (night ? DEPLOY.FLOOD_NIGHT : DEPLOY.FLOOD_DAY) : 0;
  // The attackers: outside the wall, by group (raiders in pods stay together).
  const enemies = b.units.filter((u) => u.side === "enemy" && !u.boss);
  for (const u of enemies) u.x = -100;
  const anchors = new Map();
  const inside = Math.round(enemies.length * DEPLOY.INSIDE_FRAC);
  enemies.forEach((u, i) => {
    const minX = i < inside ? DEPLOY.LINE_X - 1 : DEPLOY.ENEMY_X;
    const cells = [];
    for (let y = 0; y < H0; y++) for (let x = minX; x < W0; x++) if (okCell(x, y) && inFront(H0, y) && (i >= inside || x >= DEPLOY.WALL_X - 1)) cells.push([x, y]);
    if (!cells.length) for (let y = 0; y < H0; y++) for (let x = DEPLOY.WALL_X + 1; x < W0; x++) if (okCell(x, y)) cells.push([x, y]);
    if (!cells.length) return;
    let c0;
    if (u.pod != null) {
      if (!anchors.has(u.pod)) anchors.set(u.pod, ctx.rng.pick(cells));
      const a = anchors.get(u.pod);
      c0 = cells.reduce((m, p) => (dist(p[0], p[1], a[0], a[1]) < dist(m[0], m[1], a[0], a[1]) ? p : m), cells[0]);
    } else c0 = ctx.rng.pick(cells);
    u.x = c0[0]; u.y = c0[1];
  });
  b.units = b.units.filter((u) => u.x >= 0);
  defaultPositions(b, plan, okCell, W0, H0);
  // Turn the map so the attack comes from the side they came from.
  const side = attackSide(state, base ? base.tile : null, fromTileOf(state, c));
  const tf = transformBattle(b, side);
  const mapAll = (list) => list.map(([x, y]) => tf(x, y));
  // A way out (setup.canRetreat): the strip of evacCols columns on the far side from the attack, turned with the map
  // (combat.js inEvac reads b.evacMask, the battle screen draws it). On the wall map it is the back gate: one person
  // can slip away; the whole team falls back to the yard instead (interior.js fallBack).
  if (b.evacCols) {
    const mask = new Uint8Array(b.w * b.h);
    for (let y = 0; y < H0; y++) for (let x = 0; x < b.evacCols; x++) { const [nx, ny] = tf(x, y); mask[ny * b.w + nx] = 1; }
    b.evacMask = mask;
    b.evacSide = { east: "west", west: "east", north: "south", south: "north" }[side] || "west";
  }
  const zone = new Uint8Array(b.w * b.h);
  for (let y = 0; y < H0; y++) for (let x = 0; x <= DEPLOY.LINE_X; x++) { const [nx, ny] = tf(x, y); zone[ny * b.w + nx] = 1; }
  for (const [x, y] of [...plan.gate, ...plan.breaches]) { const [nx, ny] = tf(x, y); zone[ny * b.w + nx] = 1; }
  // The tier record (interior.js): which map, the cells inside the wall, and how to turn east-facing cells.
  const interior = new Uint8Array(b.w * b.h);
  for (let y = 0; y < H0; y++) for (let x = 0; x < DEPLOY.WALL_X; x++) { const [nx, ny] = tf(x, y); interior[ny * b.w + nx] = 1; }
  b.tier = { map: "wall", stage: "wall", side, w0: W0, h0: H0, interior, breachRows: plan.breaches.map(([, y]) => y), broken: 0, baseId: base ? base.id : null };
  b.deploy = {
    side, walled: plan.walled, zone, gate: mapAll(plan.gate), breaches: mapAll(plan.breaches), towers: mapAll(plan.towers),
    walkway: mapAll(plan.walkway || []), ladders: mapAll(plan.ladders || []),
    floodlit: !!floodlit, night, lit: "center", frame: { w0: W0, h0: H0, fromX: DEPLOY.FLOOD_FROM_X },
    defaults: b.units.filter((u) => u.side === "player").map((u) => [u.id, u.x, u.y, u.post || null]),
  };
  if (floodlit) setLit(b, plan.breaches.length && plan.breaches.every(([, y]) => y <= 4) ? "left" : plan.breaches.length && plan.breaches.every(([, y]) => y >= H0 - 5) ? "right" : "center");
  if (b.setup.deploy) {
    b.phase = "deploy";
    say(b, `The attack comes from the ${side}. Place your defenders: click one, then a green cell. Shooters on the walkway and the towers see over the wall; whoever stands in the gate or a breach holds it.`, "info");
  }
}

// Default positions (on the east-facing layout, before the map is turned).
function defaultPositions(b, plan, okCell, W0, H0) {
  const defs = b.units.filter((u) => u.side === "player" && active(u));
  for (const u of defs) u.post = null;
  for (const u of defs) u.x = -100;
  const isClose = (u) => !!WEAPONS[u.weapon].melee || u.weapon === "shotgun" || u.weapon === "pipegun";
  const tough = (u) => (isClose(u) ? 40 : 0) + u.hp / u.armor;
  const left = defs.slice().sort((a, c) => tough(c) - tough(a));
  const put = (u, x, y, post) => { u.x = x; u.y = y; u.post = post; left.splice(left.indexOf(u), 1); };
  const nGate = defs.length >= DEPLOY.GATE_TWO ? 2 : defs.length >= DEPLOY.GATE_ONE ? 1 : 0;
  for (let i = 0; i < nGate && left.length; i++) { const [x, y] = plan.gate[i]; if (okCell(x, y)) put(left[0], x, y, "gate"); }
  const shooters = () => left.filter((u) => !WEAPONS[u.weapon].melee && !isClose(u)).sort((a, c) => c.aim - a.aim);
  for (const [x, y] of plan.towers) {
    const shooter = shooters()[0] || left.filter((u) => !WEAPONS[u.weapon].melee).sort((a, c) => c.aim - a.aim)[0];
    if (shooter && okCell(x, y)) put(shooter, x, y, "tower");
  }
  const openings = [...plan.gate, ...plan.breaches];
  const dOpen = (x, y) => Math.min(99, ...openings.map(([ox, oy]) => dist(x, y, ox, oy)));
  // The walkway: the next best shots, spread out along it, near the openings (where the attackers mass) but not
  // right next to a breach.
  const taken = [];
  const crowd = (x, y) => taken.reduce((a, [tx, ty]) => a + (Math.max(Math.abs(tx - x), Math.abs(ty - y)) <= 1 ? 3 : 0), 0);
  for (const u of shooters()) {
    let best = null;
    for (const [x, y] of plan.walkway || []) {
      if (!okCell(x, y)) continue;
      const nearBreach = plan.breaches.some(([, by]) => Math.abs(by - y) <= 1);
      if (nearBreach) continue;
      const sc = -Math.abs(dOpen(x, y) - 3) * 0.5 - crowd(x, y);
      if (!best || sc > best.sc) best = { x, y, sc };
    }
    if (!best) break;
    put(u, best.x, best.y, "wall");
    taken.push([best.x, best.y]);
  }
  while (left.length) {
    const u = left.shift();
    const close = isClose(u);
    let best = null;
    for (let y = 0; y < H0; y++) for (let x = close ? 5 : DEPLOY.DEF_X[0]; x <= (close ? DEPLOY.LINE_X - 2 : DEPLOY.DEF_X[1]); x++) {
      if (!okCell(x, y)) continue;
      const d = dOpen(x, y);
      if (d < (close ? 2 : 1.5)) continue;
      // Close fighters wait about 3 tiles behind an opening; shooters stand back about 8.
      let sc = coverAgainst(b, x, y, W0 - 1, y).level * (close ? 1 : 3) + x * DEPLOY.DEF_FORWARD - Math.abs(d - (close ? 3 : DEPLOY.DEF_OPEN)) * 0.7;
      sc -= crowd(x, y) * 0.7;
      if (!best || sc > best.sc) best = { x, y, sc };
    }
    if (!best) for (let y = 0; y < H0 && !best; y++) for (let x = 0; x <= DEPLOY.LINE_X && !best; x++) if (okCell(x, y)) best = { x, y };
    if (!best) continue;
    u.x = best.x; u.y = best.y;
    taken.push([best.x, best.y]);
  }
}

// Light a third of the approach (zone: left / center / right as the defenders see it).
export function setLit(b, zone) {
  if (!b.deploy || !LIT_ROWS[zone]) return;
  const fr = b.deploy.frame || { w0: MAP_W, h0: MAP_H, fromX: DEPLOY.FLOOD_FROM_X };
  const tf = sideTf(b.deploy.side, fr.w0, fr.h0);
  const lit = new Uint8Array(b.w * b.h);
  const [f0, f1] = LIT_ROWS[zone];
  const y0 = Math.round(f0 * (fr.h0 - 1)), y1 = Math.round(f1 * (fr.h0 - 1));
  for (let y = y0; y <= y1; y++) for (let x = fr.fromX; x < fr.w0; x++) { const [nx, ny] = tf(x, y); lit[ny * b.w + nx] = 1; }
  b.lit = lit;
  b.deploy.lit = zone;
}

// ---------- the deploy step ----------
export const inZone = (b, x, y) => !!(b.deploy && x >= 0 && y >= 0 && x < b.w && y < b.h && b.deploy.zone[y * b.w + x]);
// The post a defender placed by hand takes (the battle AI keeps them there): the gate or a breach, a tower, the
// walkway; on the yard map an upper floor or a roof ("perch") and inside a building ("inside", interior.js).
const postAt = (b, x, y) => {
  const k = b.cells[y * b.w + x].k;
  if (k === "gate" || k === "breach") return "gate";
  if (k === "tower") return "tower";
  if (k === "walkway") return "wall";
  if (b.tier && b.tier.map === "interior") return k === "loft" || k === "roof" ? "perch" : b.tier.indoor && b.tier.indoor[y * b.w + x] ? "inside" : null;
  return null;
};
export function canPlace(b, x, y) {
  return inZone(b, x, y) && CELL[b.cells[y * b.w + x].k].walk && !!b.reach[y * b.w + x];
}

// Player commands while deploying: place, gate, defaults, flood, start. Returns an error or "".
export function deployAct(state, b, act) {
  if (!b.deploy) { endDeploy(b); return ""; }
  const u = act.unit != null ? unitById(b, act.unit) : null;
  switch (act.type) {
    case "place": {
      if (!u || u.side !== "player" || !active(u)) return "Pick one of your people.";
      const x = Number(act.x), y = Number(act.y);
      if (!canPlace(b, x, y)) return b.tier && b.tier.map === "interior" ? "Defenders go on the green cells: the yard and the buildings, away from the attackers." : "Defenders go on the green cells: inside the walls, on the walkway, in the gate or a breach.";
      const other = unitAt(b, x, y);
      if (other && other !== u) {
        if (other.side !== "player") return "Taken.";
        if (!active(other)) return "Someone is lying there.";
        other.x = u.x; other.y = u.y; other.post = postAt(b, other.x, other.y);
      }
      u.x = x; u.y = y; u.post = postAt(b, x, y);
      break;
    }
    case "gate": {
      if (!u || u.side !== "player" || !active(u)) return "Pick one of your people.";
      const cells = [...b.deploy.gate, ...b.deploy.breaches];
      if (!cells.length) return b.tier && b.tier.map === "interior" ? "The wall is behind you now: hold the yard and the buildings." : "There is no wall here, so no gate to hold.";
      if (cells.some(([x, y]) => u.x === x && u.y === y)) return `${u.name} already holds it.`;
      const free = cells.find(([x, y]) => !unitAt(b, x, y)) || cells[0];
      return deployAct(state, b, { type: "place", unit: u.id, x: free[0], y: free[1] });
    }
    case "defaults": {
      for (const [id] of b.deploy.defaults) { const d = unitById(b, id); if (d && active(d)) d.x = -100; }
      for (const [id, x, y, post] of b.deploy.defaults) { const d = unitById(b, id); if (d && active(d)) { d.x = x; d.y = y; d.post = post; } }
      say(b, "Defenders back at their default posts.", "info");
      break;
    }
    case "flood": {
      if (!b.deploy.floodlit) return "No floodlights lit at this base.";
      if (!LIT_ZONES[act.zone]) return "Aim them left, center or right.";
      setLit(b, act.zone);
      break;
    }
    case "start":
      endDeploy(b);
      break;
    default:
      return "Place your defenders first, then start the fight.";
  }
  b.rev++;
  return "";
}

export function endDeploy(b) {
  if (!b || b.phase !== "deploy") return;
  b.phase = "player";
  b.acted = true; // no auto-resolve once the defenders are placed
  const interior = b.tier && b.tier.map === "interior";
  say(b, interior ? (b.tier.fellBackTurn ? "Hold the yard! If it falls, make your last stand in the buildings." : "Here they come! Hold the yard, and the buildings if it falls.") : b.deploy && b.deploy.walled ? "They are at the walls. Hold them!" : "Here they come!", "danger");
  b.rev++;
}

// What is wrong with the defenders' positions (for tests): [] when every one stands on a free deploy cell.
export function deployProblems(b) {
  const out = [];
  const seen = new Set();
  for (const u of b.units) {
    if (u.side !== "player" || !active(u)) continue;
    const key = `${u.x},${u.y}`;
    if (seen.has(key)) out.push(`${u.name} shares ${key}`);
    seen.add(key);
    if (!canPlace(b, u.x, u.y)) out.push(`${u.name} at ${key} is outside the deploy cells`);
    if (u.post === "gate" && !["gate", "breach"].includes(b.cells[u.y * b.w + u.x].k)) out.push(`${u.name} holds a gate it is not in`);
  }
  return out;
}
