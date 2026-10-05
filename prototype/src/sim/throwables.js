// Throwables that do more than make a noise (stealth.js THROWABLES lists them all; its throw action calls landEffect
// for the ones with fx). What is on the map lives on the battle as data any renderer can draw (siege.js
// battleOverlays): b.fires = [{ x, y, r: 0.5, turns }] one burning cell each, b.smoke and b.flares = [{ x, y, r,
// turns }] (smoke from a fire: thick, one cell), counted down at the start of each player turn (a full round, burnRound).
//   Thrown over walls: a grenade, a pipe bomb, a Molotov, smoke or a flare needs no line of sight to where it lands,
//     only someone on its side who sees the cell (or, for your people, an enemy last seen within a tile of it):
//     throwBlind. It lands off by a tile now and then (throwLanding): 45% less 0.8 a point of aim over 40 (8–45%),
//     +15% thrown blind (then 2 tiles off past 5 tiles), + the throwable's own scatter (a pipe bomb +10%).
//   frag (frag grenade): 20–30 damage to everyone within a tile of where it lands, either side; blows apart light
//     cover there (crates, fences, hay, sandbags, barricades, shelves: rubble) and hits a door or the gate for 30–45
//     (a wall section half). Wakes everything within 12 tiles; gunfire noise.
//   blast (pipe bomb): the same with 22–34 damage, 40–60 to structures and a 14-tile wake.
//   fire (Molotov): a 3 × 3 patch burns (the cells that can: open ground of any kind, wood and hay; not walls, rock,
//     water or wrecks), the middle 3 rounds and the rest 2–3; 12–18 to everyone in it when it lands. Whoever walks
//     into the flames or stands in them when a round ends burns: people 8–14, the dead 16–24 (most die in one or two
//     turns; a brute takes 60%). Each round a burning cell sets each flammable neighbour alight by its fuel (hay 45%,
//     crates, fences, barricades 25%, shelves and counters 20%, a wooden door 15%, a field 20%, grass 12%, a wooden
//     floor 8%; never stone, asphalt, dirt, gravel, the walls), at most 40 cells burning; wood and hay that burn out
//     are rubble. Every burning cell gives off thick smoke for the round: a sight line through it is blocked
//     (smokeBlocks). The dead that follow light or heat walk into it (decoys.js); people's AI walks around it
//     (combat.js reachable).
//   smoke (smoke grenade): a cloud 2 tiles around for 3 rounds; a shot into or out of it is −30 to hit, and sounding
//     the retreat is +20 for anyone in it or within 2 tiles of it (combat.js escapeOdds).
//   flare (road flare): burns 4 rounds; your people see anything within 5 tiles of it whatever the dark, and aim
//     +10 at it in a night battle. Its glare and heat are a lure too (stealth.js, decoys.js).
// The AI (combat.js autoPlayerTurn): a frag grenade, a pipe bomb or a Molotov on three or more enemies bunched up
// (two at a breach, the gate or a doorway for a Molotov) and none of yours near, a smoke grenade when the retreat is
// about to be sounded.
import { say, fx, damage, active, alertNear, alertPod, CELL, canSeeAt, breakCell, structureName } from "./combat.js";
import { ZTYPES } from "./hiveconst.js";

export const BLAST = { r: 1.5, dmg: [22, 34], wake: 14, noise: 4, struct: [40, 60] };
export const FRAG = { r: 1.5, dmg: [20, 30], wake: 12, noise: 4, struct: [30, 45] };
export const FIRE = {
  r: 1.5, turns: 3, edge: [2, 3], hit: [12, 18], burn: [8, 14], zburn: [16, 24], bossBurn: 0.5, lure: 7, max: 40, spreadTurns: 2,
  fuel: { hay: 0.45, crate: 0.25, fence: 0.25, barricade: 0.25, shelf: 0.2, cabinet: 0.2, counter: 0.2, bdoor: 0.15, doorway: 0.1 },
  ground: { field: 0.2, grass: 0.12, floor: 0.08 },
};
export const SMOKE = { r: 2, turns: 3, aim: 30, retreat: 20, near: 2 };
export const FLARE = { r: 5, turns: 4, aim: 10 };
export const SCATTER = { base: 0.45, perAim: 0.008, min: 0.08, max: 0.45, blind: 0.15, far: 5 };
// Light cover a blast tears apart (what is left: rubble).
const LIGHT = new Set(["crate", "fence", "hay", "sandbag", "barricade", "shelf", "cabinet", "counter", "barrel"]);
// What can burn where a Molotov lands even without fuel of its own: any open ground.
const BURN_GROUND = new Set(["open", "rubble", "doorway", "smashed", "spikes", "trench", "wire", "beartrap", "breach", "stairs", "loft", "roof"]);

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const inAny = (list, x, y, extra = 0) => !!list && list.some((c) => dist(c.x, c.y, x, y) <= c.r + extra + 1e-6);
const inside = (b, x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h;
const cellOf = (b, x, y) => b.cells[y * b.w + x];

// Smoke grenades' clouds (not a fire's thick smoke, which blocks sight instead: smokeBlocks).
export const smokeAt = (b, x, y, extra = 0) => !!b.smoke && b.smoke.some((c) => !c.thick && dist(c.x, c.y, x, y) <= c.r + extra + 1e-6);
export const flareLit = (b, x, y) => inAny(b.flares, x, y);
export const fireAt = (b, x, y) => !!b.fires && b.fires.some((c) => c.x === x && c.y === y);
// A sight line through a fire's thick smoke (a cell between the two ends) is blocked (combat.js canSeeAt).
export function smokeBlocks(b, x0, y0, x1, y1) {
  if (!b.smoke || !b.smoke.some((c) => c.thick)) return false;
  const thick = new Set(b.smoke.filter((c) => c.thick).map((c) => c.y * b.w + c.x));
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 3);
  for (let i = 1; i < n; i++) {
    const cx = Math.floor(x0 + 0.5 + ((x1 - x0) * i) / n), cy = Math.floor(y0 + 0.5 + ((y1 - y0) * i) / n);
    if ((cx === x0 && cy === y0) || (cx === x1 && cy === y1)) continue;
    if (thick.has(cy * b.w + cx)) return true;
  }
  return false;
}

// Everyone standing (or down) within r of (x, y) who can still be hurt.
const caught = (b, x, y, r) => b.units.filter((t) => active(t) && dist(t.x, t.y, x, y) <= r + 1e-6);

function hurtAll(b, by, list, [lo, hi], what) {
  const parts = [];
  for (const t of list) {
    const eff = Math.round(damage(b, t, b.rng.int(lo, hi), by));
    if (by && by.xpT && t.side === "enemy") { by.xpT.hits++; if (t.dead) by.xpT.kills++; }
    parts.push(`${t.name} ${eff}${t.dead ? " (dead)" : t.down ? " (down)" : ""}`);
    fx(b, { type: "melee", from: [t.x, t.y], to: [t.x, t.y], hit: true, crit: false, dmg: eff, side: by ? by.side : "enemy", text: what });
    if (t.side === "enemy" && !t.dead && !t.aware) alertPod(b, t.pod, `${t.name} cries out!`);
  }
  return parts;
}

// ---------- throwing over walls ----------
// Is the throw blind (no sight of the cell from where the thrower stands)? false: they see it; true: a teammate
// sees it (or an enemy was last seen within a tile of it: your people only); null: nobody on their side knows it.
export function throwBlind(b, u, x, y) {
  if (canSeeAt(b, u, x, y)) return false;
  for (const o of b.units) if (o !== u && o.side === u.side && active(o) && canSeeAt(b, o, x, y)) return true;
  if (u.side === "player" && b.ghosts) for (const g of Object.values(b.ghosts)) if (dist(g[0], g[1], x, y) <= 1.5) return true;
  return null;
}
// The chance a throw lands off target (SCATTER), by the thrower's aim.
export function scatterChance(u, T, blind) {
  const aim = u.aim ?? 40;
  return Math.max(SCATTER.min, Math.min(SCATTER.max, SCATTER.base - (aim - 40) * SCATTER.perAim)) + (blind ? SCATTER.blind : 0) + ((T && T.scatter) || 0) / 100;
}
// Where a throw comes down: on target, or a tile off (two when thrown blind past SCATTER.far tiles). [x, y, off].
export function throwLanding(b, u, T, x, y, blind) {
  if (!b.rng.chance(scatterChance(u, T, blind))) return [x, y, false];
  const k = blind && dist(u.x, u.y, x, y) > SCATTER.far ? 2 : 1;
  const opts = [];
  for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === k && inside(b, x + dx, y + dy)) opts.push([x + dx, y + dy]);
  if (!opts.length) return [x, y, false];
  const [lx, ly] = b.rng.pick(opts);
  return [lx, ly, true];
}

// A blast tears apart light cover and hits doors, the gate and wall sections (half) within its radius.
function wreck(b, x, y, r, [lo, hi], by) {
  let torn = 0;
  const hit = [];
  for (let cy = Math.floor(y - r); cy <= Math.ceil(y + r); cy++) for (let cx = Math.floor(x - r); cx <= Math.ceil(x + r); cx++) {
    if (!inside(b, cx, cy) || dist(cx, cy, x, y) > r + 1e-6) continue;
    const c = cellOf(b, cx, cy);
    if (LIGHT.has(c.k)) { c.k = "rubble"; delete c.t; torn++; continue; }
    if (c.hp > 0 && (c.k === "palisade" || c.k === "gate" || c.k === "bdoor" || c.k === "window" || c.k === "siegeladder")) {
      const dmg = Math.round(b.rng.int(lo, hi) * (c.k === "palisade" || c.k === "siegeladder" ? 0.5 : 1));
      const name = structureName(c).toLowerCase();
      c.hp = Math.max(0, c.hp - dmg);
      if (c.hp <= 0 && c.k !== "siegeladder") breakCell(b, cx, cy, by);
      else hit.push(`the ${name} −${dmg}`);
    }
  }
  if (torn) b.losCache.fill(0);
  return (torn ? ` ${torn} cell${torn > 1 ? "s" : ""} of cover blown apart.` : "") + (hit.length ? ` It hits ${hit.join(", ")}.` : "");
}

// A throwable with fx lands at (x, y). Returns extra text for the log line.
export function landEffect(b, u, T, x, y) {
  if (T.fx === "blast" || T.fx === "frag") {
    const B = T.fx === "frag" ? FRAG : BLAST;
    const parts = hurtAll(b, u, caught(b, x, y, B.r), B.dmg, "BOOM");
    b.noise = (b.noise || 0) + B.noise;
    alertNear(b, x, y, B.wake, "The blast wakes everything nearby.");
    const torn = wreck(b, x, y, B.r, B.struct, u);
    return (parts.length ? `The blast catches ${parts.join(", ")}.` : "The blast hits nobody.") + torn;
  }
  if (T.fx === "fire") {
    const parts = hurtAll(b, u, caught(b, x, y, FIRE.r), FIRE.hit, "FIRE");
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = x + dx, cy = y + dy;
      if (!inside(b, cx, cy) || !canBurn(b, cx, cy)) continue;
      ignite(b, cx, cy, dx || dy ? b.rng.int(FIRE.edge[0], FIRE.edge[1]) : FIRE.turns);
      n++;
    }
    return `${n} tiles burn for ${FIRE.edge[0]}–${FIRE.turns} turns${parts.length ? `; caught in it: ${parts.join(", ")}` : ""}.`;
  }
  if (T.fx === "smoke") {
    (b.smoke || (b.smoke = [])).push({ x, y, r: SMOKE.r, turns: SMOKE.turns });
    return `Thick smoke for ${SMOKE.turns} turns: shots through it are −${SMOKE.aim}.`;
  }
  if (T.fx === "flare") {
    (b.flares || (b.flares = [])).push({ x, y, r: FLARE.r, turns: FLARE.turns });
    return "It lights up everything around it.";
  }
  return "";
}

// ---------- fire ----------
// Can this cell burn: open ground where a Molotov lands, or something with fuel (FIRE.fuel)?
export function canBurn(b, x, y) {
  const c = cellOf(b, x, y);
  return BURN_GROUND.has(c.k) || FIRE.fuel[c.k] != null || CELL[c.k].walk && !CELL[c.k].bar && c.k !== "walkway" && c.k !== "tower" && c.k !== "gate" && c.k !== "siegeladder" && c.k !== "water";
}
// How readily fire spreads into this cell (0: never): its fuel, else the ground's.
export function fuelOf(b, x, y) {
  const c = cellOf(b, x, y);
  if (FIRE.fuel[c.k] != null) return FIRE.fuel[c.k];
  if (!CELL[c.k].walk || c.k === "walkway" || c.k === "tower" || c.k === "gate" || c.k === "siegeladder") return 0;
  return FIRE.ground[c.f] || 0;
}
export function ignite(b, x, y, turns) {
  const list = b.fires || (b.fires = []);
  const was = list.find((c) => c.x === x && c.y === y);
  if (was) { was.turns = Math.max(was.turns, turns); return was; }
  const f = { x, y, r: 0.5, turns };
  list.push(f);
  (b.smoke || (b.smoke = [])).push({ x, y, r: 0.5, turns: 1, thick: true });
  return f;
}

// Walking into the flames (combat.js moveAlong). Returns true when the unit was burned.
export function fireStep(b, u, x, y) {
  if (!b.fires || !b.fires.length || !active(u) || !fireAt(b, x, y)) return false;
  burn(b, u, "walks into the flames");
  return true;
}
// How hot the flames are for this unit: the dead burn fast (a brute less, a boss half), people as before.
export function burnRange(u) {
  if (u.kind !== "zombie") return FIRE.burn;
  const m = u.boss ? FIRE.bossBurn : (u.ztype && ZTYPES[u.ztype] && ZTYPES[u.ztype].burn) || 1;
  return [Math.round(FIRE.zburn[0] * m), Math.round(FIRE.zburn[1] * m)];
}
// The burn line first, then the damage (so a death reads after it).
function burn(b, u, what) {
  const [lo, hi] = burnRange(u);
  const raw = b.rng.int(lo, hi);
  say(b, `${u.name} ${what} (${Math.round(raw * u.armor)}).`, u.side === "player" ? "danger" : "good");
  fx(b, { type: "melee", from: [u.x, u.y], to: [u.x, u.y], hit: true, crit: false, dmg: Math.round(raw * u.armor), side: "fire", text: "BURN" });
  damage(b, u, raw, null);
  if (u.kind === "zombie" && u.dead) b.burned = (b.burned || 0) + 1;
}

// The start of each player turn: whoever stands in the flames burns, the fire spreads, then fires, smoke and flares
// burn down (wood and hay that burned out are rubble).
export function burnRound(b) {
  if (b.fires && b.fires.length) {
    for (const t of b.units) {
      if (!active(t) || !fireAt(b, t.x, t.y)) continue;
      burn(b, t, "burns");
    }
    spread(b);
  }
  for (const k of ["fires", "smoke", "flares"]) {
    if (!b[k] || !b[k].length) continue;
    for (const c of b[k]) c.turns -= 1;
    if (k === "fires") for (const c of b[k]) if (c.turns <= 0) burnOut(b, c.x, c.y);
    b[k] = b[k].filter((c) => c.turns > 0);
  }
  // The flames still burning smoke for the coming round.
  for (const f of b.fires || []) if (!b.smoke.some((c) => c.thick && c.x === f.x && c.y === f.y)) b.smoke.push({ x: f.x, y: f.y, r: 0.5, turns: 1, thick: true });
}
function spread(b) {
  const now = b.fires.slice();
  for (const f of now) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (b.fires.length >= FIRE.max) return;
      const x = f.x + dx, y = f.y + dy;
      if (!inside(b, x, y) || fireAt(b, x, y)) continue;
      const fuel = fuelOf(b, x, y);
      if (fuel > 0 && b.rng.chance(fuel)) ignite(b, x, y, FIRE.spreadTurns);
    }
  }
}
function burnOut(b, x, y) {
  const c = cellOf(b, x, y);
  if (FIRE.fuel[c.k] == null || c.k === "doorway") return;
  const los = CELL[c.k].los;
  c.k = c.k === "bdoor" ? "doorway" : "rubble";
  c.hp = 0; delete c.t;
  if (los) b.losCache.fill(0);
}

// ---------- the AI's throws (combat.js autoPlayerTurn and siege.js for the enemy) ----------
const CHOKE = new Set(["gate", "breach", "doorway", "smashed", "siegeladder"]);
// The best spot for a grenade, a pipe bomb or a Molotov: at least 3 foes caught (2 at a chokepoint for a Molotov),
// none of the thrower's side within the radius + 1, a cell its side knows (throwBlind). side: whose foes.
export function blastSpot(b, u, range, r, opts = {}) {
  const foes = b.units.filter((t) => t.side !== u.side && active(t) && !t.off);
  const mine = b.units.filter((t) => t.side === u.side && active(t));
  const need = opts.need || 3;
  let best = null;
  for (const f of foes) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = f.x + dx, y = f.y + dy;
      if (!inside(b, x, y)) continue;
      const d = dist(u.x, u.y, x, y);
      if (d > range || d < 2) continue;
      if (mine.some((m) => dist(m.x, m.y, x, y) <= r + 1)) continue;
      const n = foes.filter((t) => dist(t.x, t.y, x, y) <= r + 1e-6).length;
      const choke = opts.fire && [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, ay]) => inside(b, x + ax, y + ay) && CHOKE.has(cellOf(b, x + ax, y + ay).k));
      if (n < (choke ? Math.min(need, 2) : need)) continue;
      if (opts.fire && fireAt(b, x, y)) continue;
      const sc = n + (choke ? 1 : 0);
      if (best && sc <= best.sc) continue;
      if (throwBlind(b, u, x, y) === null) continue;
      best = { x, y, n, sc };
    }
  }
  return best;
}
