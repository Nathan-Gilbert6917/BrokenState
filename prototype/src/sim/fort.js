// The fort map: a walled base's whole battle on one map. Your own base under attack (defences.js "baseDefence") and a
// group's base you storm (conquest.js "baseAssault") both use it when the base has walls and does not stand on a
// bridge (a bridge barricade keeps the deck map: deploy.js).
//
// The map: a margin of open ground all round (FORT.MARGIN cells, a little cover scattered on it), the wall ring with a
// gate (GATE cells) in the middle of each side, watchtowers at the corners when the base has one, the walkway ring
// inside the wall (height 1) with ladders up to it from the yard, and inside that the yard with the base's buildings
// (interior.js layInterior: houses with doors and windows, upper floors, flat roofs, barricades, the garage's car).
// Attackers can come from any side: the AI comes from the side they came from on the State Map (deploy.js attackSide)
// and spreads a little onto the sides next to it; on an assault you stage your people in the margin on any side (the
// deploy step, zone = the margin). Defenders deploy anywhere inside the ring (the walkway, the towers, the gates, the
// yard, the buildings). The fight runs through its tiers on this one map (interior.js tierPlayerTurn): the wall until
// enough attackers are inside, then the yard, then the last stand in the buildings. No fall back: it is all here.
import { CELL, unitAt, say, resizeBattle, WEAPONS, coverAgainst, active, isRanged } from "./combat.js";
import { buildInterior } from "./interior.js";
import { DEPLOY, attackSide, fromTileOf, wallHp, gateHp } from "./deploy.js";
import { count } from "./buildings.js";
import { densify, COVER } from "./battlesize.js"; // cover over the margin
import { poweredType } from "./power.js";
import { isNight } from "./world.js";
import { armoryDefence, bossUnit } from "./defences.js";
import { buildBaseMap, baseMapSize, makeStores, markThieves, FLOOD } from "./basemap.js"; // the base map: every real base's own layout, walled or not

// Which map a base fights on: its own base map (basemap.js: the player's layout, walled or not, the attack from any
// side) for every real base; the generated yard (interior.js) for a group's base you storm (assaultBase, id −1) and
// for the tests' old strip maps (c.strip).
export const usesGrid = (base, c = null) => !!base && base.id >= 0 && !(c && c.strip);

export const FORT = {
  MARGIN: 8,          // open ground round the wall (where the attackers stage)
  GATE: 2,            // cells a gate is wide
  LADDER_EVERY: 7,    // a ladder up to the walkway about every this many cells of wall
  COVER: 0.035,       // share of the margin's cells with a rock or a tree on them (not right by the wall)
  SPREAD: 0.25,       // share of the AI's attackers that come round onto the sides next to the one they came from
  HORDE_SIDES: [1, 6, 12, 18], // a horde of at least this many of the dead can come from 1, 2, 3, 4 sides (how many: its dice)
  GATE_HOLD: 7, GATE_HOLD_TWO: 9, // defenders needed before one, two hold the gate facing the attack (DEPLOY.GATE_ONE / TWO)
  TRAP_HP: 25,
};
const SIDES = ["north", "east", "south", "west"];
const OPPOSITE = { north: "south", south: "north", east: "west", west: "east" };
const NEXT_TO = { north: ["west", "east"], south: ["west", "east"], east: ["north", "south"], west: ["north", "south"] };

// ---------- the map ----------
// Builds the fort for a base (a real one, or the stand-in a group's base gets: assaultBase). Deterministic for the
// same base (interior.js layoutSeed) except the margin's cover and the breaches (rng).
export function buildFort(base, c, rng, opts = {}) {
  if (usesGrid(base, c) && opts.state) return buildBaseMap(opts.state, base, rng, { view: !!(c && c.view), pitsAt: c && c.pitsAt }); // basemap.js
  const lay = buildInterior(base, { walled: false, c: c || {} });
  const yw = lay.W, yh = lay.H, M = FORT.MARGIN;
  const x0 = M + 2, y0 = M + 2; // the yard's origin: wall at x0 - 2, walkway at x0 - 1
  const W = yw + 4 + 2 * M, H = yh + 4 + 2 * M;
  const cells = Array.from({ length: W * H }, () => ({ k: "open", f: "grass" }));
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? cells[y * W + x] : null);
  const put = (x, y, k, f) => { const q = at(x, y); if (q) { q.k = k; if (f) q.f = f; } return q; };
  // The yard, copied in (its cells keep their heights, hit points and furniture).
  for (let y = 0; y < yh; y++) for (let x = 0; x < yw; x++) cells[(y0 + y) * W + x0 + x] = lay.cells[y * yw + x];
  const off = ([x, y]) => [x + x0, y + y0];
  // The wall ring and the walkway ring.
  const wx0 = x0 - 2, wx1 = x0 + yw + 1, wy0 = y0 - 2, wy1 = y0 + yh + 1;
  const hpWall = wallHp(base), hpGate = gateHp(base);
  const walkway = [], ring = [];
  for (let y = wy0; y <= wy1; y++) for (let x = wx0; x <= wx1; x++) {
    const onRing = x === wx0 || x === wx1 || y === wy0 || y === wy1;
    const onWalk = !onRing && (x === wx0 + 1 || x === wx1 - 1 || y === wy0 + 1 || y === wy1 - 1);
    if (onRing) { const q = put(x, y, "palisade", "dirt"); q.t = 1; q.hp = q.mhp = hpWall; ring.push([x, y]); }
    else if (onWalk) { const q = put(x, y, "walkway", "dirt"); q.h = 1; walkway.push([x, y]); }
  }
  // A gate in the middle of each side (GATE cells), the walkway behind it open ground (the way in), the cell outside too.
  const gates = {};
  const cx = Math.floor((wx0 + wx1) / 2), cy = Math.floor((wy0 + wy1) / 2);
  const gateCells = (side) => {
    const out = [];
    for (let i = 0; i < FORT.GATE; i++) {
      const o = i - Math.floor(FORT.GATE / 2) + (FORT.GATE % 2 ? 0 : 0);
      if (side === "north") out.push([cx + o, wy0]); else if (side === "south") out.push([cx + o, wy1]);
      else if (side === "west") out.push([wx0, cy + o]); else out.push([wx1, cy + o]);
    }
    return out;
  };
  for (const side of SIDES) {
    gates[side] = gateCells(side);
    for (const [x, y] of gates[side]) {
      const q = put(x, y, "gate", "dirt"); delete q.t; q.bar = true; q.hp = q.mhp = hpGate;
      const [dx, dy] = side === "north" ? [0, 1] : side === "south" ? [0, -1] : side === "west" ? [1, 0] : [-1, 0];
      const inn = put(x + dx, y + dy, "open", "dirt"); delete inn.h; // the walkway cell behind the gate is the way in
      const outC = put(x - dx, y - dy, "open", "grass");
      void outC;
    }
  }
  // Watchtowers at the corners of the walkway (height 2) when the base has one.
  const towers = [];
  if (base && count(base, "watchtower")) for (const [x, y] of [[wx0 + 1, wy0 + 1], [wx1 - 1, wy0 + 1], [wx0 + 1, wy1 - 1], [wx1 - 1, wy1 - 1]]) { const q = put(x, y, "tower", "dirt"); q.h = 2; towers.push([x, y]); }
  // Ladders up from the yard, every LADDER_EVERY cells along each side where the yard cell is free.
  const ladders = [];
  const ladderAt = (x, y) => { const q = at(x, y); if (q && q.k === "open" && q.f !== "floor") { put(x, y, "ladder"); ladders.push([x, y]); } };
  for (let x = x0 + 2; x < x0 + yw - 2; x += FORT.LADDER_EVERY) { ladderAt(x, y0); ladderAt(x, y0 + yh - 1); }
  for (let y = y0 + 2; y < y0 + yh - 2; y += FORT.LADDER_EVERY) { ladderAt(x0, y); ladderAt(x0 + yw - 1, y); }
  // The margin: open ground with a little cover, not right by the wall (the attackers' side of it is theirs).
  const nCover = Math.round(FORT.COVER * (W * H - (yw + 4) * (yh + 4)));
  for (let i = 0; i < nCover; i++) {
    const x = rng.int(0, W - 1), y = rng.int(0, H - 1);
    if (x >= wx0 - 2 && x <= wx1 + 2 && y >= wy0 - 2 && y <= wy1 + 2) continue;
    const q = at(x, y);
    if (q && q.k === "open") q.k = rng.chance(0.6) ? "rock" : rng.chance(0.5) ? "tree" : "boulder";
  }
  // Masks: inside the ring (the walkway and the yard), indoors.
  const inside = new Uint8Array(W * H), indoor = new Uint8Array(W * H);
  for (let y = wy0 + 1; y <= wy1 - 1; y++) for (let x = wx0 + 1; x <= wx1 - 1; x++) inside[y * W + x] = 1;
  // Cover over the margin's open ground as on any field (battlesize.js densify), never within 2 cells of the wall.
  densify(cells, W, H, rng, { target: COVER.OPEN, keep: (x, y) => !!inside[y * W + x] || (x >= wx0 - 2 && x <= wx1 + 2 && y >= wy0 - 2 && y <= wy1 + 2) });
  for (let y = 0; y < yh; y++) for (let x = 0; x < yw; x++) if (lay.indoor[y * yw + x]) indoor[(y0 + y) * W + x0 + x] = 1;
  const buildings = lay.buildings.map((s) => ({ name: s.name, key: s.key, roof: !!s.roof, storeys: s.storeys || 0, x0: s.x0 + x0, y0: s.y0 + y0, w: s.w, h: s.h, doors: (s.doors || []).map(off) }));
  return {
    W, H, cells, M, x0, y0, yw, yh, wall: { x0: wx0, x1: wx1, y0: wy0, y1: wy1 }, ring, walkway, gates, towers: [...towers, ...lay.towers.map(off)], ladders,
    inside, indoor, buildings, lofts: lay.lofts.map(off), roofs: lay.roofs.map(off), doors: lay.doors.map(off), lay, walled: true, lights: [], stores: [], vehicles: [],
  };
}
export const fortDims = (F) => [F.W, F.H];
// The map's size before it is built (combat.js battleSize): the yard's plus the walkway, the wall and the margin.
export function fortSize(base, c, state = null) {
  if (usesGrid(base, c) && state) return baseMapSize(state, base, { view: !!(c && c.view), pitsAt: c && c.pitsAt }); // basemap.js
  const lay = buildInterior(base, { walled: false, c: c || {} });
  return [lay.W + 4 + 2 * FORT.MARGIN, lay.H + 4 + 2 * FORT.MARGIN];
}
// A walled base on land fights on the fort map. c.strip (a battle's context) keeps the old wall-line map and the yard map
// after it (deploy.js, interior.js), which a bridge barricade still uses and the tests exercise.
// Every real base on land fights on its base map (walled or not: usesGrid); the old strip maps keep the wall and yard
// maps (deploy.js, interior.js), and so does a base on a bridge.
export const fortable = (state, base, c = null) => !!base && (usesGrid(base, c) || count(base, "walls") > 0) && !(state.tiles[base.tile] && state.tiles[base.tile].bridge) && !(c && c.strip);

// The side of the fort a cell lies on (which margin band), or null inside the ring.
export function sideOf(F, x, y) {
  const w = F.wall;
  if (x > w.x0 && x < w.x1 && y > w.y0 && y < w.y1) return null;
  const d = { north: y - w.y0, south: w.y1 - y, west: x - w.x0, east: w.x1 - x };
  return SIDES.reduce((a, s) => (d[s] < d[a] ? s : a), "north");
}
// Breaches on the attack side's wall (a horde that broke through: `want` of them, on no corner, apart from each other).
function breach(F, rng, side, want) {
  if (want <= 0 || F.walled === false) return [];
  const w = F.wall, line = F.ring.filter(([x, y]) => sideOf(F, x, y) === side && !((x === w.x0 || x === w.x1) && (y === w.y0 || y === w.y1)) && F.cells[y * F.W + x].k === "palisade");
  const out = [];
  for (const [x, y] of rng.shuffle(line.slice())) {
    if (out.length >= want) break;
    if (out.some(([ox, oy]) => Math.abs(ox - x) + Math.abs(oy - y) < 3) || F.gates[side].some(([gx, gy]) => Math.abs(gx - x) + Math.abs(gy - y) < 3)) continue;
    const q = F.cells[y * F.W + x]; q.k = "breach"; delete q.t; q.h = 0; q.hp = 0;
    // The walkway behind it comes down (as combat.js breakCell).
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = F.cells[(y + dy) * F.W + x + dx]; if (n && n.k === "walkway") { n.k = "rubble"; n.h = 0; } }
    out.push([x, y]);
  }
  return out;
}
const margin = (F, side) => {
  const out = [], w = F.wall;
  for (let y = 0; y < F.H; y++) for (let x = 0; x < F.W; x++) {
    if (F.inside[y * F.W + x] || (x >= w.x0 && x <= w.x1 && y >= w.y0 && y <= w.y1)) continue;
    if (!side || sideOf(F, x, y) === side) out.push([x, y]);
  }
  return out;
};
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// ---------- your base under attack (defences.js "baseDefence") ----------
export function fortDefence(b, ctx, base, c) {
  const state = ctx.state, rng = ctx.rng;
  if (ctx.phase === "map") {
    const F = buildFort(base, c, rng, { state });
    const side = attackSide(state, base.tile, fromTileOf(state, c));
    const people = b.setup.enemy.kind !== "zombies", through = c.through || 0;
    const want = people || c.raidId != null || c.rescue ? 1 : (c.bosses || 0) + (through >= 120 ? 1 : 0) + (through >= 250 ? 1 : 0);
    F.breaches = breach(F, rng, side, Math.min(DEPLOY.MAX_BREACH, want));
    // The wall already battered by a horde inside (deploy.js WORN).
    const worn = people ? 0 : Math.min(DEPLOY.WORN_MAX, through * DEPLOY.WORN);
    if (worn) for (const [x, y] of F.ring) { const q = F.cells[y * F.W + x]; if (q.k === "palisade") q.hp = Math.max(1, Math.round(q.mhp * (1 - worn * rng.range(0.5, 1)))); if (q.k === "gate") q.hp = Math.max(1, Math.round(q.mhp * (1 - worn))); }
    // The armory's kit: wire and bear traps just outside the attack side's wall, sandbags in the yard behind it.
    const w = F.wall;
    const band = side === "east" ? [w.x1 + 1, w.x1 + 2] : side === "west" ? [w.x0 - 2, w.x0 - 1] : null;
    const kit = c.kit || armoryDefence(base);
    if (kit) {
      const spots = margin(F, side).filter(([x, y]) => dist(x, y, Math.floor((w.x0 + w.x1) / 2), Math.floor((w.y0 + w.y1) / 2)) < Math.max(F.W, F.H) && (band ? x >= band[0] && x <= band[1] : (side === "north" ? y >= w.y0 - 2 && y <= w.y0 - 1 : y >= w.y1 + 1 && y <= w.y1 + 2)));
      const lay = (n, k) => { for (let i = 0; i < n && spots.length; i++) { const j = rng.int(0, spots.length - 1); const [x, y] = spots.splice(j, 1)[0]; if (F.cells[y * F.W + x].k === "open") F.cells[y * F.W + x].k = k; } };
      lay((kit.wire || 0) * 4, "wire"); lay(kit.traps || 0, "beartrap");
      // The base map lays the spike pits where they were placed (c.pitsAt, basemap.js); the old map scatters them here.
      for (let i = 0; i < (usesGrid(base, c) ? 0 : (c.pits || 0) * 5); i++) { const s = spots.length ? spots.splice(rng.int(0, spots.length - 1), 1)[0] : null; if (s && F.cells[s[1] * F.W + s[0]].k === "open") F.cells[s[1] * F.W + s[0]].k = "spikes"; }
    }
    F.side = side;
    resizeBattle(b, F.W, F.H, F.cells, Math.floor(F.W / 2), 0);
    b.deployPlan = { walled: true, fort: F, gate: F.gates[side], breaches: F.breaches, towers: F.towers };
    return;
  }
  // Units.
  const F = b.deployPlan.fort, side = F.side;
  for (let i = 0; i < (b.setup.enemy.bosses || 0); i++) b.units.push(bossUnit(b, "wallbreaker"));
  if (usesGrid(base, c)) {
    b.stores = makeStores(state, base, F, rng); // basemap.js: the base's goods on the map, in its containers
    if (b.setup.enemy.kind !== "zombies" && !c.drill) markThieves(b, rng); // some of the raiders go for them
  }
  const okCell = (x, y) => x >= 0 && y >= 0 && x < F.W && y < F.H && b.reach[y * F.W + x] && CELL[b.cells[y * F.W + x].k].walk && !unitAt(b, x, y);
  // The attackers: in the margin on their side (a share of them round onto the sides next to it), pods together.
  const enemies = b.units.filter((u) => u.side === "enemy");
  for (const u of enemies) u.x = -100;
  const anchors = new Map();
  // A horde comes at the walls from 1 to 4 sides (more the bigger it is: HORDE_SIDES), the side it came from first, then
  // the sides next to it, then the far one; half of it on its own side. People come from one side, a few round the next.
  const horde = b.setup.enemy.kind === "zombies";
  const most = horde ? FORT.HORDE_SIDES.filter((n) => enemies.length >= n).length : 1;
  const nSides = horde ? rng.int(1, Math.max(1, most)) : 1;
  const sides = [side, ...rng.shuffle(NEXT_TO[side].slice()), OPPOSITE[side]].slice(0, nSides);
  F.sides = sides;
  const bands = {};
  for (const s of new Set([...sides, ...NEXT_TO[side]])) bands[s] = margin(F, s).filter(([x, y]) => okCell(x, y));
  enemies.forEach((u, i) => {
    let s;
    if (horde) s = sides.length > 1 && i % 2 === 1 ? sides[1 + (Math.floor(i / 2) % (sides.length - 1))] : side; // the dead: only the sides they came from
    else s = i < Math.round(enemies.length * (1 - FORT.SPREAD)) || !bands[NEXT_TO[side][i % 2]].length ? side : NEXT_TO[side][i % 2];
    if (!bands[s] || !bands[s].length) s = side;
    const cells = bands[s].filter(([x, y]) => !unitAt(b, x, y));
    if (!cells.length) return;
    let c0;
    if (u.pod != null) {
      const key = `${u.pod}|${s}`;
      if (!anchors.has(key)) anchors.set(key, rng.pick(cells));
      const a = anchors.get(key);
      c0 = cells.reduce((m, p) => (dist(p[0], p[1], a[0], a[1]) < dist(m[0], m[1], a[0], a[1]) ? p : m), cells[0]);
    } else c0 = rng.pick(cells);
    u.x = c0[0]; u.y = c0[1];
  });
  b.units = b.units.filter((u) => u.x >= 0);
  fortDefaults(b, F, side, okCell);
  const floodlit = c.floodlit ?? (count(base, "floodlights") > 0 && (poweredType(base, "floodlights") || (base.stock.fuel || 0) >= 2));
  const night = c.night ?? isNight(state);
  b.floodAim = floodlit ? (night ? DEPLOY.FLOOD_NIGHT : DEPLOY.FLOOD_DAY) : 0;
  finishFort(b, F, side, { attackers: "enemy", base, floodlit, night, deploy: !!b.setup.deploy });
  if (b.setup.deploy) {
    b.phase = "deploy";
    const from = (F.sides || [side]).length > 1 ? `The dead come from ${(F.sides).length} sides: ${F.sides.join(", ").replace(/, ([^,]*)$/, " and $1")}` : `The attack comes from the ${side}`;
    say(b, F.walled === false ? `${from}, straight over the open ground: no walls here. Place your defenders anywhere in the yard: behind the barricades, in the buildings at the windows, on the roofs and the towers.`
      : `${from}. Place your defenders anywhere inside the walls: on the walkway (▲, shoot down over the wall) and the towers (▲▲), in the gates and the breaches to hold them, in the yard behind cover, in the buildings at the windows and on the roofs.`, "info");
    b.deploy.sides = F.sides || [side];
  }
}

// Default posts for the defenders: the toughest in the attack side's gate (with enough people), the best shots on the
// towers nearest that side and spread along its walkway, the rest in the yard behind cover facing it.
function fortDefaults(b, F, side, okCell) {
  const defs = b.units.filter((u) => u.side === "player" && active(u));
  for (const u of defs) { u.post = null; u.x = -100; }
  const isClose = (u) => !!WEAPONS[u.weapon].melee || u.weapon === "shotgun" || u.weapon === "pipegun";
  const tough = (u) => (isClose(u) ? 40 : 0) + u.hp / u.armor;
  const left = defs.slice().sort((a, c) => tough(c) - tough(a));
  const put = (u, x, y, post) => { u.x = x; u.y = y; u.post = post; left.splice(left.indexOf(u), 1); };
  const w = F.wall, mid = [Math.floor((w.x0 + w.x1) / 2), Math.floor((w.y0 + w.y1) / 2)];
  const toward = side === "north" ? [mid[0], 0] : side === "south" ? [mid[0], F.H - 1] : side === "west" ? [0, mid[1]] : [F.W - 1, mid[1]];
  const nGate = F.walled === false ? 0 : defs.length >= FORT.GATE_HOLD_TWO ? 2 : defs.length >= FORT.GATE_HOLD ? 1 : 0;
  for (let i = 0; i < nGate && left.length && F.gates[side][i]; i++) { const [x, y] = F.gates[side][i]; if (okCell(x, y)) put(left[0], x, y, "gate"); }
  const shooters = () => left.filter((u) => !WEAPONS[u.weapon].melee && !isClose(u)).sort((a, c) => c.aim - a.aim);
  const towers = F.towers.filter(([x, y]) => b.cells[y * F.W + x].k === "tower").sort((p, q) => dist(p[0], p[1], toward[0], toward[1]) - dist(q[0], q[1], toward[0], toward[1])).slice(0, 2);
  for (const [x, y] of towers) { const s = shooters()[0]; if (s && okCell(x, y)) put(s, x, y, "tower"); }
  const openings = [...F.gates[side], ...(F.breaches || [])];
  const dOpen = (x, y) => Math.min(99, ...openings.map(([ox, oy]) => dist(x, y, ox, oy)));
  const taken = [];
  const crowd = (x, y) => taken.reduce((a, [tx, ty]) => a + (Math.max(Math.abs(tx - x), Math.abs(ty - y)) <= 1 ? 3 : 0), 0);
  const wallCells = F.walkway.filter(([x, y]) => sideOf(F, x, y) === null && b.cells[y * F.W + x].k === "walkway" && (side === "north" ? y === w.y0 + 1 : side === "south" ? y === w.y1 - 1 : side === "west" ? x === w.x0 + 1 : x === w.x1 - 1));
  for (const u of shooters()) {
    let best = null;
    for (const [x, y] of wallCells) {
      if (!okCell(x, y) || (F.breaches || []).some(([bx, by]) => Math.abs(bx - x) <= 1 && Math.abs(by - y) <= 1)) continue;
      const sc = -Math.abs(dOpen(x, y) - 3) * 0.5 - crowd(x, y);
      if (!best || sc > best.sc) best = { x, y, sc };
    }
    if (!best) break;
    put(u, best.x, best.y, "wall");
    taken.push([best.x, best.y]);
  }
  // The rest: the yard, behind cover facing the attack, a little back from the openings.
  while (left.length) {
    const u = left.shift();
    const close = isClose(u);
    let best = null;
    for (let y = F.y0; y < F.y0 + F.yh; y++) for (let x = F.x0; x < F.x0 + F.yw; x++) {
      if (!okCell(x, y) || F.indoor[y * F.W + x]) continue;
      const d = dOpen(x, y);
      if (d < (close ? 2 : 1.5)) continue;
      let sc = coverAgainst(b, x, y, toward[0], toward[1]).level * (close ? 1 : 3) - Math.abs(d - (close ? 3 : DEPLOY.DEF_OPEN)) * 0.7 - crowd(x, y) * 0.7;
      if (!best || sc > best.sc) best = { x, y, sc };
    }
    if (!best) for (let y = 0; y < F.H && !best; y++) for (let x = 0; x < F.W && !best; x++) if (F.inside[y * F.W + x] && okCell(x, y)) best = { x, y };
    if (!best) continue;
    u.x = best.x; u.y = best.y;
    taken.push([best.x, best.y]);
  }
}

// The tier record, the deploy step and the ways out, once the units stand where they start.
function finishFort(b, F, side, o) {
  const W = F.W, H = F.H;
  const zone = new Uint8Array(W * H);
  if (o.attackers === "enemy") for (let i = 0; i < W * H; i++) zone[i] = F.inside[i]; // the defenders deploy inside
  else for (const [x, y] of margin(F, null)) zone[y * W + x] = 1;                        // the attackers stage in the margin
  for (const [x, y] of [...F.gates.north, ...F.gates.south, ...F.gates.east, ...F.gates.west, ...(F.breaches || [])]) if (o.attackers === "enemy") zone[y * W + x] = 1;
  if (b.evacCols) {
    // The way out: the margin on the far side from the attack (defenders), or any edge of the margin (attackers).
    const mask = new Uint8Array(W * H);
    if (o.attackers === "enemy") for (const [x, y] of margin(F, OPPOSITE[side])) { if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) mask[y * W + x] = 1; }
    else for (const [x, y] of margin(F, null)) if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) mask[y * W + x] = 1;
    b.evacMask = mask;
    b.evacSide = o.attackers === "enemy" ? OPPOSITE[side] : side;
  }
  const openings = [...F.gates.north, ...F.gates.south, ...F.gates.east, ...F.gates.west, ...(F.breaches || [])];
  const walled = F.walled !== false;
  b.tier = {
    map: "fort", stage: walled ? "wall" : "yard", side, w0: W, h0: H, walled, interior: F.inside, indoor: F.indoor, entry: [], attackers: o.attackers,
    breachRows: [], broken: 0, baseId: o.base ? o.base.id : null, openings,
    buildings: F.buildings.map((s) => { const cells = []; for (let y = s.y0; y < s.y0 + s.h; y++) for (let x = s.x0; x < s.x0 + s.w; x++) cells.push([x, y]); return { name: s.name, key: s.key, roof: s.roof, storeys: s.storeys, cells, doors: s.doors }; }),
    fort: { wall: F.wall, gates: F.gates, M: F.M },
  };
  b.deploy = {
    side, walled, fort: true, attackers: o.attackers === "player", zone, gate: F.gates[side] || [], breaches: F.breaches || [], towers: F.towers, walkway: F.walkway, ladders: F.ladders,
    floodlit: !!o.floodlit, night: !!o.night, lit: "center", fixedLit: !!(o.floodlit && F.lights && F.lights.length), frame: { fort: true, w0: W, h0: H, fromX: 0 },
    defaults: b.units.filter((u) => u.side === "player" && active(u)).map((u) => [u.id, u.x, u.y, u.post || null]),
  };
  b.holders = o.attackers === "player" ? "enemy" : "player";
  if (o.floodlit && b.deploy.fixedLit) fixedLit(b, F);
  else if (o.floodlit) setFortLit(b, "center"); else b.lit = null;
}
// Floodlights on the fort: a third of the attack side's margin (left / center / right as the defenders face it).
export function setFortLit(b, zone) {
  const T = b.tier, F = T && T.fort;
  if (!F || !b.deploy || b.deploy.fixedLit) return; // placed floodlights (basemap.js) light the ground round them: nothing to aim
  const W = b.w, H = b.h, w = F.wall, side = T.side;
  const lit = new Uint8Array(W * H);
  const along = side === "north" || side === "south" ? [w.x0, w.x1] : [w.y0, w.y1];
  const span = along[1] - along[0], f0 = { left: 0, center: 1 / 3, right: 2 / 3 }[zone] ?? 1 / 3, f1 = f0 + 1 / 3 + (zone === "center" ? 0.08 : 0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (sideOf(F, x, y) !== side) continue;
    const t = ((side === "north" || side === "south" ? x : y) - along[0]) / span;
    const tt = side === "south" || side === "west" ? 1 - t : t; // "left" as the defenders face out
    if (tt >= f0 && tt <= f1) lit[y * W + x] = 1;
  }
  b.lit = lit;
  b.deploy.lit = zone;
}

// Floodlights placed on the base map (basemap.js F.lights): each lights the cells within FLOOD.R of it, wherever it
// stands, so where the lights go is part of the layout.
function fixedLit(b, F) {
  const W = b.w, H = b.h;
  const lit = new Uint8Array(W * H);
  for (const [lx, ly] of F.lights) for (let y = Math.max(0, ly - FLOOD.R); y <= Math.min(H - 1, ly + FLOOD.R); y++) for (let x = Math.max(0, lx - FLOOD.R); x <= Math.min(W - 1, lx + FLOOD.R); x++) if (Math.hypot(x - lx, y - ly) <= FLOOD.R) lit[y * W + x] = 1;
  b.lit = lit;
  b.deploy.lit = "fixed";
}

// ---------- a group's base you storm (conquest.js "baseAssault") ----------
// A stand-in base for the group's: an outpost or a hub by the strength of their walls, with buildings for their
// numbers, laid out by the same generator (deterministic for the tile).
export function assaultBase(state, setup) {
  if (setup.fortBase) return setup.fortBase;
  const e = setup.enemy || {}, walls = e.walls || 0, people = (setup.context && setup.context.people) || e.count * 3 || 8;
  const tile = typeof setup.tile === "object" ? setup.tile.id : setup.tile;
  const kinds = ["bunkhouse", "storehouse", "common_room", "infirmary", "garage", "bunkhouse", "cellar", "radio", "storehouse", "bunkhouse", "ammo_bench", "common_room"];
  const n = Math.max(2, Math.min(kinds.length, Math.round(people / 3)));
  const buildings = [{ type: "walls" }, ...Array.from({ length: Math.max(0, Math.min(4, Math.round(walls / 3))) }, () => ({ type: "walls" })), ...kinds.slice(0, n).map((type) => ({ type }))];
  if (walls >= 4) buildings.push({ type: "watchtower" });
  if (e.gate ?? walls >= 6) buildings.push({ type: "gate" }); // conquest.js nativeGate: the reinforced gate they built (ai-locks: your manual), else walls of 6+
  setup.fortBase = { id: -1, tile, type: walls >= 5 ? "hub" : "outpost", name: e.name || "their base", buildings, construction: [], armory: [], stock: { fuel: 0 }, radio: false, watchtower: walls >= 4 };
  return setup.fortBase;
}
export function fortAssault(b, ctx, c) {
  const state = ctx.state, rng = ctx.rng;
  const base = assaultBase(state, b.setup);
  if (ctx.phase === "map") {
    const F = buildFort(base, {}, rng);
    // Weak spots in their wall (as the old assault map: more the weaker their walls), spread round the sides, so an
    // assault from any side has a way in besides the gate.
    const nBreach = (b.setup.enemy || {}).walls <= 2 ? 3 : (b.setup.enemy || {}).walls <= 5 ? 2 : 1;
    F.breaches = [];
    const order = rng.shuffle(SIDES.slice());
    for (let i = 0; i < nBreach; i++) F.breaches.push(...breach(F, rng, order[i % order.length], 1));
    // Barricades and sandbags in the yard, more the stronger their walls (as the old assault map).
    const walls = (b.setup.enemy || {}).walls || 0;
    for (let i = 0; i < 2 + Math.min(6, walls); i++) {
      for (let t = 0; t < 10; t++) { const x = rng.int(F.x0, F.x0 + F.yw - 1), y = rng.int(F.y0, F.y0 + F.yh - 1); const q = F.cells[y * F.W + x]; if (q.k === "open" && q.f !== "floor" && !F.indoor[y * F.W + x]) { q.k = i % 2 ? "sandbag" : "barricade"; break; } }
    }
    F.side = "west";
    resizeBattle(b, F.W, F.H, F.cells, 0, Math.floor(F.H / 2));
    b.deployPlan = { walled: true, fort: F, gate: [], breaches: [], towers: F.towers };
    return;
  }
  const F = b.deployPlan.fort;
  const okCell = (x, y) => x >= 0 && y >= 0 && x < F.W && y < F.H && b.reach[y * F.W + x] && CELL[b.cells[y * F.W + x].k].walk && !unitAt(b, x, y);
  // Their defenders: one in each gate, their best shots on the towers and spread round the walkway, the rest in the yard.
  const foes = b.units.filter((u) => u.side === "enemy");
  for (const u of foes) u.x = -100;
  const left = foes.slice().sort((a, c) => c.hp / c.armor - a.hp / a.armor);
  const put = (u, x, y, post) => { u.x = x; u.y = y; u.post = post; left.splice(left.indexOf(u), 1); };
  // A holder just inside each gate (out of sight of the margin until it opens), with enough people.
  for (const s of SIDES) {
    const [gx, gy] = F.gates[s][0];
    const [dx, dy] = s === "north" ? [0, 1] : s === "south" ? [0, -1] : s === "west" ? [1, 0] : [-1, 0];
    if (left.length > 4 && okCell(gx + dx, gy + dy)) put(left[0], gx + dx, gy + dy, "gate");
  }
  const shots = () => left.filter((u) => isRanged(u)).sort((a, c) => c.aim - a.aim);
  for (const [x, y] of F.towers) { const s = shots()[0]; if (s && okCell(x, y) && b.cells[y * F.W + x].k === "tower") put(s, x, y, "tower"); }
  const walk = F.walkway.filter(([x, y]) => b.cells[y * F.W + x].k === "walkway");
  const step = Math.max(1, Math.floor(walk.length / Math.max(1, shots().length)));
  for (let i = 0; i < walk.length && shots().length; i += step) { const [x, y] = walk[i]; const s = shots()[0]; if (okCell(x, y)) put(s, x, y, "wall"); }
  for (const u of left.slice()) {
    let best = null;
    for (let t = 0; t < 40 && !best; t++) { const x = rng.int(F.x0, F.x0 + F.yw - 1), y = rng.int(F.y0, F.y0 + F.yh - 1); if (okCell(x, y) && !F.indoor[y * F.W + x]) best = [x, y]; }
    if (best) put(u, best[0], best[1], null);
  }
  b.units = b.units.filter((u) => u.x >= 0);
  // Your people: staged in the margin on the west side to start; the deploy step lets you move them to any side.
  const mine = b.units.filter((u) => u.side === "player" && active(u));
  const west = margin(F, "west").filter(([x, y]) => okCell(x, y) && x < 3).sort((p, q) => Math.abs(p[1] - F.H / 2) - Math.abs(q[1] - F.H / 2));
  for (const u of mine) { u.post = null; const s = west.find(([x, y]) => !unitAt(b, x, y)); if (s) { u.x = s[0]; u.y = s[1]; } }
  // Their vehicle? none. Your vehicle stands in the west margin (combat.js placed it by the edge): fine where it is.
  finishFort(b, F, "west", { attackers: "player", base: null, floodlit: false, night: isNight(state), deploy: true });
  b.phase = "deploy";
  b.acted = false;
  say(b, "Their walls. Stage your people: click one, then a green cell anywhere in the open ground round the base (any side). The gates are in the middle of each wall; the ram, ladders and grenades are for the wall (siege.js). Then start the assault.", "info");
}
