// The deploy step before a break-in (a horde through the walls, defences.js; raiders at the gates, conflicts.js
// raidDefense; a group come to free its people, prisoners.js): the base's battle map with what was built, the
// attack from the side the horde or the raiders came from on the State Map, and the defenders placed by hand.
//
// The map (laid out with the attackers on the east edge, then turned: transformBattle in combat.js):
//   a base with walls built has a wall line (column 12 of 18) the defenders shoot over: the gate (2 cells in the
//   middle) and the breaches the dead made (1, +1 per Wallbreaker, +1 at 120 and at 250 of the dead inside, at most
//   4; raiders cut 1) are the only ways in. Barricades stand behind it (columns 8–10), spike pits (13–15) and the
//   trench (14) in front, a watchtower gives 2 tower cells behind the wall (full cover from anything not next to
//   it, +5 aim). The attackers start outside (column 15 on). A base without walls keeps the open layout
//   (barricades 4–6, pits 8–12, trench 10, attackers from column 13).
//   Defenders can stand anywhere inside (columns 0–11; 0–7 without walls), in the gate and in a breach. Whoever
//   stands in the gate or a breach blocks it ("holds the gate"), and the battle AI keeps them there, as it keeps
//   a defender on a tower; the others move freely.
//   Floodlights (built and lit) light a third of the approach (left, center or right, as the defenders see it):
//   shots at anything in the light get +12 at night, +5 by day.
// Default positions (also what headless battles and the autopilot use): with 7+ defenders the toughest close
// fighter holds the gate (two with 9+), the best shots take the towers, the rest stand back in columns 2–6, about
// 8 tiles from the openings, so the dead that come through cross open ground under fire.
import { MAP_W, MAP_H, CELL, WEAPONS, active, unitAt, unitById, coverAgainst, transformBattle, say } from "./combat.js";
import { count } from "./buildings.js";
import { poweredType } from "./power.js";
import { isNight } from "./world.js";

export const DEPLOY = {
  WALL_X: 12, LINE_X: 11, BARRICADE_X: [8, 10], SPIKE_X: [13, 15], TRENCH_X: 14, ENEMY_X: 15, ZONE_OPEN: 7,
  FLOOD_NIGHT: 12, FLOOD_DAY: 5, FLOOD_FROM_X: 7, MAX_BREACH: 4, INSIDE_FRAC: 0,
  // Default positions (calibrated with hivetest's break-ins): a gate holder with 7+ defenders, two with 9+; the
  // rest in columns 2–6, about 8 tiles from the openings (a killing ground), a little forward.
  GATE_ONE: 7, GATE_TWO: 9, DEF_X: [2, 6], DEF_FORWARD: 0.2, DEF_OPEN: 8,
};
export const SIDE_NAMES = { east: "east", west: "west", north: "north", south: "south" };
export const LIT_ZONES = { left: "Left", center: "Center", right: "Right" };
// Rows of each lit zone on the east-facing layout: the defenders face east, so "left" is the north part.
const LIT_ROWS = { left: [0, 5], center: [3, 9], right: [7, 12] };
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
function fromTileOf(state, c) {
  if (c.fromTile != null) return c.fromTile;
  if (c.raidId != null) { const p = state.parties.find((x) => x.id === c.raidId); if (p && p.path) return p.path[Math.min(p.idx || 0, p.path.length - 1)]; }
  if (c.hordeId != null) { const h = state.hordes.find((x) => x.id === c.hordeId); if (h && h.from != null) return h.from; }
  if (c.factionId != null) { const f = state.factions.find((x) => x.id === c.factionId); if (f && f.bases.length) return f.bases[0]; }
  return null;
}

// Cell mapping of transformBattle for a side (the base map is MAP_W × MAP_H before it is turned).
export function sideTf(side) {
  const W0 = MAP_W, H0 = MAP_H;
  if (side === "west") return (x, y) => [W0 - 1 - x, y];
  if (side === "north") return (x, y) => [y, W0 - 1 - x];
  if (side === "south") return (x, y) => [H0 - 1 - y, x];
  return (x, y) => [x, y];
}

// ---------- the map (layout phase "map", attackers east) ----------
export function deployMap(b, ctx, base, c) {
  const rng = ctx.rng;
  const walled = !!base && count(base, "walls") > 0;
  b.deployPlan = { walled, gate: [], breaches: [], towers: [] };
  if (!walled) {
    // No wall: barricades in front of the defenders, spike pits and the trench on the approach.
    const k = base ? count(base, "barricades") : 0;
    for (let i = 0; i < k * 3 + (base && count(base, "gate") ? 2 : 0); i++) {
      for (let t = 0; t < 8; t++) { const x = rng.int(4, 6), y = rng.int(1, ctx.H - 2); if (ctx.free(x, y)) { ctx.put(x, y, "barricade"); break; } }
    }
    for (let i = 0; i < (c.pits || 0) * 5; i++) {
      for (let t = 0; t < 8; t++) { const x = rng.int(8, 12), y = rng.int(0, ctx.H - 1); if (ctx.free(x, y)) { ctx.put(x, y, "spikes"); break; } }
    }
    if (base && count(base, "trench")) for (let y = 0; y < ctx.H; y++) if (ctx.free(10, y) && y % 4 !== 2) ctx.put(10, y, "trench");
    return;
  }
  const H = ctx.H, X = DEPLOY.WALL_X, mid = Math.floor(H / 2);
  const gate = [mid - 1, mid];
  const through = c.through || 0;
  const want = c.raidId != null || c.rescue ? 1 : 1 + (c.bosses || 0) + (through >= 120 ? 1 : 0) + (through >= 250 ? 1 : 0);
  const rows = rng.shuffle([...Array(H).keys()].filter((y) => y >= 1 && y <= H - 2 && (y <= mid - 3 || y >= mid + 2)));
  const breaches = [];
  for (const y of rows) {
    if (breaches.length >= Math.min(DEPLOY.MAX_BREACH, want)) break;
    if (breaches.some((o) => Math.abs(o - y) < 3)) continue;
    breaches.push(y);
  }
  for (let y = 0; y < H; y++) {
    const k = gate.includes(y) ? "gate" : breaches.includes(y) ? "breach" : "palisade";
    ctx.put(X, y, k);
    if (k !== "palisade") { ctx.put(X - 1, y, "open"); ctx.put(X + 1, y, "open"); }
  }
  const towers = [];
  if (count(base, "watchtower")) for (const y of [1, H - 2]) if (!breaches.some((o) => Math.abs(o - y) < 2)) { ctx.put(X - 1, y, "tower"); towers.push([X - 1, y]); }
  // Barricades: a second line behind the wall.
  const k = count(base, "barricades");
  for (let i = 0; i < k * 3 + (count(base, "gate") ? 2 : 0); i++) {
    for (let t = 0; t < 8; t++) { const x = rng.int(DEPLOY.BARRICADE_X[0], DEPLOY.BARRICADE_X[1]), y = rng.int(1, H - 2); if (ctx.free(x, y)) { ctx.put(x, y, "barricade"); break; } }
  }
  // The trench, then the spike pits (used this attack), in front of the wall.
  if (count(base, "trench")) for (let y = 0; y < H; y++) if (ctx.free(DEPLOY.TRENCH_X, y) && y % 4 !== 2) ctx.put(DEPLOY.TRENCH_X, y, "trench");
  for (let i = 0; i < (c.pits || 0) * 5; i++) {
    for (let t = 0; t < 8; t++) { const x = rng.int(DEPLOY.SPIKE_X[0], DEPLOY.SPIKE_X[1]), y = rng.int(0, H - 1); if (ctx.free(x, y)) { ctx.put(x, y, "spikes"); break; } }
  }
  Object.assign(b.deployPlan, { gate: gate.map((y) => [X, y]), breaches: breaches.map((y) => [X, y]), towers });
}

// ---------- units (layout phase "units") ----------
export function deployUnits(b, ctx, base, c) {
  const state = ctx.state;
  const plan = b.deployPlan || { walled: false, gate: [], breaches: [], towers: [] };
  const W0 = ctx.W, H0 = ctx.H;
  const cellK = (x, y) => b.cells[y * W0 + x].k;
  const okCell = (x, y) => x >= 0 && y >= 0 && x < W0 && y < H0 && b.reach[y * W0 + x] && CELL[cellK(x, y)].walk && !unitAt(b, x, y);
  // Floodlights: lit and aimed (the center, unless the openings are elsewhere).
  const floodlit = c.floodlit ?? (!!base && count(base, "floodlights") > 0 && (poweredType(base, "floodlights") || (base.stock.fuel || 0) >= 2));
  const night = c.night ?? isNight(state);
  b.floodAim = floodlit ? (night ? DEPLOY.FLOOD_NIGHT : DEPLOY.FLOOD_DAY) : 0;
  // The attackers: outside the wall, by group (raiders in pods stay together).
  if (plan.walled) {
    const enemies = b.units.filter((u) => u.side === "enemy" && !u.boss);
    for (const u of enemies) u.x = -100;
    const anchors = new Map();
    const inside = Math.round(enemies.length * DEPLOY.INSIDE_FRAC);
    enemies.forEach((u, i) => {
      const minX = i < inside ? DEPLOY.LINE_X - 1 : DEPLOY.ENEMY_X;
      const cells = [];
      for (let y = 0; y < H0; y++) for (let x = minX; x < W0; x++) if (okCell(x, y) && (i >= inside || x >= DEPLOY.WALL_X - 1)) cells.push([x, y]);
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
  }
  defaultPositions(b, plan, okCell, W0, H0);
  // Turn the map so the attack comes from the side they came from.
  const side = attackSide(state, base ? base.tile : null, fromTileOf(state, c));
  const tf = transformBattle(b, side);
  const mapAll = (list) => list.map(([x, y]) => tf(x, y));
  const zone = new Uint8Array(b.w * b.h);
  const zoneX = plan.walled ? DEPLOY.LINE_X : DEPLOY.ZONE_OPEN;
  for (let y = 0; y < H0; y++) for (let x = 0; x <= zoneX; x++) { const [nx, ny] = tf(x, y); zone[ny * b.w + nx] = 1; }
  for (const [x, y] of [...plan.gate, ...plan.breaches]) { const [nx, ny] = tf(x, y); zone[ny * b.w + nx] = 1; }
  b.deploy = {
    side, walled: plan.walled, zone, gate: mapAll(plan.gate), breaches: mapAll(plan.breaches), towers: mapAll(plan.towers),
    floodlit: !!floodlit, night, lit: "center",
    defaults: b.units.filter((u) => u.side === "player").map((u) => [u.id, u.x, u.y, u.post || null]),
  };
  if (floodlit) setLit(b, plan.breaches.length && plan.breaches.every(([, y]) => y <= 4) ? "left" : plan.breaches.length && plan.breaches.every(([, y]) => y >= H0 - 5) ? "right" : "center");
  if (b.setup.deploy) {
    b.phase = "deploy";
    say(b, `The attack comes from the ${side}. Place your defenders: click one, then a green cell. Whoever stands in the gate or a breach holds it.`, "info");
  }
}

// Default positions (on the east-facing layout, before the map is turned). A base without walls keeps where the
// battle put them (columns 0–3, the best cover first).
function defaultPositions(b, plan, okCell, W0, H0) {
  const defs = b.units.filter((u) => u.side === "player" && active(u));
  for (const u of defs) u.post = null;
  if (!plan.walled) return;
  for (const u of defs) u.x = -100;
  const isClose = (u) => !!WEAPONS[u.weapon].melee || u.weapon === "shotgun" || u.weapon === "pipegun";
  const tough = (u) => (isClose(u) ? 40 : 0) + u.hp / u.armor;
  const left = defs.slice().sort((a, c) => tough(c) - tough(a));
  const put = (u, x, y, post) => { u.x = x; u.y = y; u.post = post; left.splice(left.indexOf(u), 1); };
  const nGate = defs.length >= DEPLOY.GATE_TWO ? 2 : defs.length >= DEPLOY.GATE_ONE ? 1 : 0;
  for (let i = 0; i < nGate && left.length; i++) { const [x, y] = plan.gate[i]; if (okCell(x, y)) put(left[0], x, y, "gate"); }
  for (const [x, y] of plan.towers) {
    const shooter = left.filter((u) => !WEAPONS[u.weapon].melee).sort((a, c) => c.aim - a.aim)[0];
    if (shooter && okCell(x, y)) put(shooter, x, y, "tower");
  }
  const openings = [...plan.gate, ...plan.breaches];
  const taken = [];
  while (left.length) {
    const u = left.shift();
    let best = null;
    for (let y = 0; y < H0; y++) for (let x = DEPLOY.DEF_X[0]; x <= DEPLOY.DEF_X[1]; x++) {
      if (!okCell(x, y)) continue;
      const dOpen = Math.min(...openings.map(([ox, oy]) => dist(x, y, ox, oy)));
      if (dOpen < 1.5) continue;
      let sc = coverAgainst(b, x, y, W0 - 1, y).level * 3 + x * DEPLOY.DEF_FORWARD - Math.abs(dOpen - DEPLOY.DEF_OPEN) * 0.7;
      for (const [tx, ty] of taken) if (Math.max(Math.abs(tx - x), Math.abs(ty - y)) <= 1) sc -= 2;
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
  const tf = sideTf(b.deploy.side);
  const lit = new Uint8Array(b.w * b.h);
  const [y0, y1] = LIT_ROWS[zone];
  for (let y = y0; y <= y1; y++) for (let x = DEPLOY.FLOOD_FROM_X; x < MAP_W; x++) { const [nx, ny] = tf(x, y); lit[ny * b.w + nx] = 1; }
  b.lit = lit;
  b.deploy.lit = zone;
}

// ---------- the deploy step ----------
export const inZone = (b, x, y) => !!(b.deploy && x >= 0 && y >= 0 && x < b.w && y < b.h && b.deploy.zone[y * b.w + x]);
const postAt = (b, x, y) => {
  const k = b.cells[y * b.w + x].k;
  return k === "gate" || k === "breach" ? "gate" : k === "tower" ? "tower" : null;
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
      if (!canPlace(b, x, y)) return "Defenders go on the green cells: inside the walls, in the gate or a breach.";
      const other = unitAt(b, x, y);
      if (other && other !== u) {
        if (other.side !== "player") return "Taken.";
        other.x = u.x; other.y = u.y; other.post = postAt(b, other.x, other.y);
      }
      u.x = x; u.y = y; u.post = postAt(b, x, y);
      break;
    }
    case "gate": {
      if (!u || u.side !== "player" || !active(u)) return "Pick one of your people.";
      const cells = [...b.deploy.gate, ...b.deploy.breaches];
      if (!cells.length) return "There is no wall here, so no gate to hold.";
      if (cells.some(([x, y]) => u.x === x && u.y === y)) return `${u.name} already holds it.`;
      const free = cells.find(([x, y]) => !unitAt(b, x, y)) || cells[0];
      return deployAct(state, b, { type: "place", unit: u.id, x: free[0], y: free[1] });
    }
    case "defaults": {
      for (const [id] of b.deploy.defaults) { const d = unitById(b, id); if (d) d.x = -100; }
      for (const [id, x, y, post] of b.deploy.defaults) { const d = unitById(b, id); if (d) { d.x = x; d.y = y; d.post = post; } }
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
  say(b, b.deploy && b.deploy.walled ? "They are at the walls. Hold them!" : "Here they come!", "danger");
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
