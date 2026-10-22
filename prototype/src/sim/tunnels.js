// The Digger's tunnels (the user's request 2026-10-21: "a digger that can dig a hole and move under tiles and bypass
// walls but can only dig on ground dirt tiles ... Zombies can use this tunnel to crawl through to bypass walls. After a
// raid the player needs to do a build process to fill the tunnels"). Every number in hiveconst.js DIG.
//
// On the battle map:
// - Where it digs (diggable): a cell of kind DIG.GROUND (open ground, bushes) with a floor in DIG.FLOORS (dirt,
//   grass, a field), no mine, nothing raised, not barred. It goes down only on one and comes up only on one, at most
//   DIG.RANGE cells away (Chebyshev); everything between is passed under (walls, gates, buildings, wire, trenches,
//   mines: nothing is set off).
// - When (diggerTurn, from zombietypes.js zombieTurn): with nobody next to it, standing on bare ground, when a bare,
//   free cell within range lies so much nearer the living by its siege field (combat.js distField: the way round, or
//   through a wall it would batter) that the tunnel (DIG.CRAWL moves a cell) saves DIG.GAIN moves. The nearest such
//   (the field's best, then the map's order): no dice.
// - Digging (goUnder): the Digger is off the map (u.off, u.under), unseen, for ceil(length / DIG.PER_TURN) turns; at
//   the start of each enemy turn (tunnelRound, from combat.js endPlayerTurn) its count goes down; at 0 it comes up at
//   the exit (surface) with an action to spend, and the tunnel is open (b.tunnels: { id, a, b, len, open, seenA,
//   seenB }). A blocked exit (someone on it, the cell gone): it waits under up to DIG.WAIT turns, coming up on the
//   free bare cell next to it as soon as there is one, then at its own entrance, then the nearest free bare cell
//   anywhere, then any free walkable one: never stuck under, never up on an occupied, mined or unwalkable cell.
// - Crawling through: an open tunnel links its two ends for the dead (usesTunnels: not the bosses, the 2 × 2 ones, the
//   rooted or the dormant). combat.js reachable puts the far end one move past the near one; distField weighs the
//   crawl at DIG.CRAWL a cell. combat.js moveAlong, at a step from one end to the other, sends the unit under
//   (crawlIn): off the map for max(1, ceil(length × DIG.CRAWL / (2 × its moves))) turns, then up at the far end as above.
// - Seen: an end once one of your people has had it in sight, or when the dead come up out of it in their view
//   (seenA / seenB, drawn by ui/isoview.js). Your people cannot go down them; standing on a hole keeps the dead in it.
// On your base (the base map, fort.js usesGrid):
// - settleTunnels (combat.js closeCombat): a horde fight's open tunnels are kept on the base (base.tunnels: { id, a, b,
//   len, w, h, day }) and laid on the next fight's map there (layTunnels, defences.js "baseDefence" layout), open and
//   known, until filled; a record whose ends no longer stand on walkable ground (built over) is left off that map.
// - By the numbers (defences.js atTheWalls, every base alike): every DIG.EVERY Diggers in a horde dig a tunnel
//   (digTunnels: at most DIG.NUM an attack, DIG.LEN cells), where no battle map is fought (your walls that held, a
//   group's base); one with no cells yet is placed on the map the first time a fight there lays it (placeTunnel: a bare
//   cell inside the walls, picked by a hash of the seed and its id, and one outside as near its length as can be).
//   Each open tunnel takes DIG.HOLD of the walls' hold (tunnelHold, at most DIG.HOLD_MAX).
// - Filling (queueFill, finishFill): a job in the construction queue (buildings.js BUILDINGS.filltunnel), DIG.FILL_BASE
//   + DIG.FILL_PER work-hours a cell, put first in the queue; the builders work it as any build (buildings.js
//   constructionHour). Queued from the base map (a hole's card) or by the governor (autoFillTunnels, autopilot.js
//   governBase); a group's crew fills theirs DIG.GROUP_DAY work-hours a day (groupFillDaily, groupworks.js).
import { DIG } from "./hiveconst.js";
import { CELL, say, fx, active, adjacent, distField, playerSeesCell, unitAt } from "./combat.js";
import { log, newId } from "./world.js";
import { hash01 } from "./skills.js";
import { usesGrid } from "./fort.js";

const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const inside = (b, x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h;
const cellOf = (b, x, y) => (inside(b, x, y) ? b.cells[y * b.w + x] : null);
const people = (b) => b.units.filter((o) => o.side === "player" && active(o));
const r1 = (v) => Math.round(v * 10) / 10;

// ---------- the ground ----------
// Bare ground a Digger goes down or comes up on.
export const diggable = (c) => !!c && DIG.GROUND.includes(c.k) && DIG.FLOORS.includes(c.f) && !c.mine && !c.bar && !(c.h > 0) && CELL[c.k] && CELL[c.k].walk;
// An end of an open tunnel still usable: walkable and not barred.
const endOk = (b, p) => { const c = p && cellOf(b, p[0], p[1]); return !!c && !!CELL[c.k] && CELL[c.k].walk && !c.bar; };
// Who crawls through them: the dead on foot (not the bosses, the 2 × 2 ones, the rooted, a Sleeper still lying there).
export const usesTunnels = (u) => !!u && u.kind === "zombie" && !u.boss && !(u.size > 1) && !u.rooted && !u.dormant && !(u.f > 0);

// ---------- the pathing (combat.js reachable, distField) ----------
// The open tunnels' links: cell index → [[the other end's index, length]], or null with none.
export function tunnelLinks(b) {
  if (!b || !b.tunnels || !b.tunnels.length || b.floors) return null; // storeys: none (diggerTurn)
  let m = null;
  for (const t of b.tunnels) {
    if (!t.open || !endOk(b, t.a) || !endOk(b, t.b)) continue;
    const i = t.a[1] * b.w + t.a[0], j = t.b[1] * b.w + t.b[0];
    if (i === j) continue;
    m = m || new Map();
    (m.get(i) || m.set(i, []).get(i)).push([j, t.len]);
    (m.get(j) || m.set(j, []).get(j)).push([i, t.len]);
  }
  return m;
}
// For distField's cache key: which tunnels are open.
export const tunnelSig = (b) => (b && b.tunnels && b.tunnels.length ? b.tunnels.filter((t) => t.open).map((t) => `${t.id}:${t.a}:${t.b}`).join(";") : "");
const tunnelBetween = (b, p, q) => (b.tunnels || []).find((t) => t.open && ((t.a[0] === p[0] && t.a[1] === p[1] && t.b[0] === q[0] && t.b[1] === q[1]) || (t.b[0] === p[0] && t.b[1] === p[1] && t.a[0] === q[0] && t.a[1] === q[1]))) || null;

// ---------- going under, coming up ----------
const crawlTurns = (u, len) => Math.max(1, Math.ceil((len * DIG.CRAWL) / (2 * Math.max(1, u.mob || 3))));
function goUnder(b, u, t, to, turns, dig) {
  u.under = { t: t.id, from: [u.x, u.y], to: to.slice(), left: turns, wait: 0, dig: !!dig };
  u.off = true;
  u.ow = false; u.hunker = false;
  u.ap = 0;
}
// A step from one end of an open tunnel to the other (combat.js moveAlong): the unit goes down it. true: it did.
export function crawlIn(b, u, x, y) {
  if (!usesTunnels(u)) return false;
  const t = tunnelBetween(b, [u.x, u.y], [x, y]);
  if (!t) return false;
  goUnder(b, u, t, [x, y], crawlTurns(u, t.len), false);
  const seen = playerSeesCell(b, u.x, u.y);
  if (seen) { if (t.a[0] === u.x && t.a[1] === u.y) t.seenA = true; else t.seenB = true; say(b, `${u.name} crawls down into a tunnel.`, "danger"); }
  return true;
}
// The free bare cell at or next to p (the map's order), or null.
function freeBare(b, p, r = 1) {
  for (let d = 0; d <= r; d++) for (let y = p[1] - d; y <= p[1] + d; y++) for (let x = p[0] - d; x <= p[0] + d; x++) {
    if (Math.max(Math.abs(x - p[0]), Math.abs(y - p[1])) !== d) continue;
    if (diggable(cellOf(b, x, y)) && !unitAt(b, x, y)) return [x, y];
  }
  return null;
}
// The last resorts: the nearest free bare cell anywhere, else the nearest free walkable one.
function nearestFree(b, p) {
  let best = null, bd = Infinity, any = null, ad = Infinity;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const c = b.cells[y * b.w + x];
    if (!CELL[c.k] || !CELL[c.k].walk || c.bar || c.mine || (c.h > 0) || unitAt(b, x, y)) continue;
    const d = cheb(p, [x, y]);
    if (diggable(c) && d < bd) { bd = d; best = [x, y]; }
    if (d < ad) { ad = d; any = [x, y]; }
  }
  return best || any;
}
function surface(b, u) {
  const U = u.under, t = (b.tunnels || []).find((q) => q.id === U.t) || null;
  let spot = freeBare(b, U.to);
  if (!spot && !t) spot = nearestFree(b, U.to); // the map changed under it (combat.js resizeBattle): up at once
  if (!spot && U.wait >= DIG.WAIT) spot = freeBare(b, U.from) || (U.wait >= DIG.WAIT * 2 ? nearestFree(b, U.to) : null);
  if (!spot) { U.wait++; return false; }
  u.x = spot[0]; u.y = spot[1];
  u.off = false;
  delete u.under;
  u.ap = 1; u.aware = true;
  const home = spot[0] === U.from[0] && spot[1] === U.from[1];
  if (t && U.dig) { t.open = true; if (!home) { t.b = spot.slice(); t.len = Math.max(1, cheb(t.a, t.b)); } }
  const seen = playerSeesCell(b, spot[0], spot[1]);
  if (t && seen) { if (t.a[0] === spot[0] && t.a[1] === spot[1]) t.seenA = true; else t.seenB = true; }
  if (seen) {
    say(b, `${u.name} bursts up out of the ground${U.dig ? ", a tunnel behind it" : " out of a tunnel"}!`, "danger");
    fx(b, { type: "loot", to: spot, text: "UP" });
  }
  return true;
}
// The start of the enemy's turn (combat.js endPlayerTurn): your people see the holes in their view; the dead under
// the ground come nearer the far end and, at it, come up.
export function tunnelRound(b) {
  if (!b.tunnels || !b.tunnels.length) return;
  for (const t of b.tunnels) {
    if (!t.open) continue;
    if (!t.seenA && endOk(b, t.a) && playerSeesCell(b, t.a[0], t.a[1])) t.seenA = true;
    if (!t.seenB && endOk(b, t.b) && playerSeesCell(b, t.b[0], t.b[1])) t.seenB = true;
  }
  for (const u of b.units) {
    if (!u.under || u.dead) continue;
    if (u.under.left > 0) u.under.left--;
    if (u.under.left <= 0) surface(b, u);
  }
}
// Under the ground right now (the UI, the tests).
export const underground = (u) => !!(u && u.under && !u.dead);

// ---------- the Digger ----------
// Its own turn (zombietypes.js zombieTurn). true: it went down.
export function diggerTurn(b, u) {
  const foes = people(b);
  if (!foes.length || foes.some((f) => adjacent(u, f))) return false;
  if (b.floors) return false; // a building of storeys (buildingmaps.js): the cells swap with the floor looked at, so no tunnels
  if (!diggable(cellOf(b, u.x, u.y))) return false;
  const field = distField(b, foes.map((f) => [f.x, f.y]), u);
  const hereF = field[u.y * b.w + u.x];
  const R = DIG.RANGE;
  let best = null;
  for (let y = Math.max(0, u.y - R); y <= Math.min(b.h - 1, u.y + R); y++) for (let x = Math.max(0, u.x - R); x <= Math.min(b.w - 1, u.x + R); x++) {
    if (x === u.x && y === u.y) continue;
    const i = y * b.w + x, f = field[i];
    if (!isFinite(f) || !diggable(b.cells[i]) || unitAt(b, x, y)) continue;
    const len = cheb([u.x, u.y], [x, y]);
    if (len < 2) continue; // next to it: it walks
    const cost = len * DIG.CRAWL + f;
    if (!(hereF - cost >= DIG.GAIN)) continue;
    if (!best || cost < best.cost) best = { x, y, len, cost };
  }
  if (!best) return false;
  b.tunnels = b.tunnels || [];
  const t = { id: (b.tunnelSeq = (b.tunnelSeq || 0) + 1), a: [u.x, u.y], b: [best.x, best.y], len: best.len, open: false, by: u.id, turn: b.turn, seenA: playerSeesCell(b, u.x, u.y), seenB: false };
  b.tunnels.push(t);
  goUnder(b, u, t, t.b, Math.ceil(best.len / DIG.PER_TURN), true);
  if (t.seenA) { say(b, `${u.name} claws its way down into the ground.`, "danger"); fx(b, { type: "loot", to: t.a, text: "DIGS" }); }
  return true;
}

// ---------- on your base ----------
export const baseTunnels = (base) => (base ? base.tunnels || (base.tunnels = []) : []);
export const openTunnels = (base) => (base && base.tunnels ? base.tunnels.length : 0);
// × the walls' hold for the tunnels under them (defences.js holdLimit).
export const tunnelHold = (base) => 1 - Math.min(DIG.HOLD_MAX, DIG.HOLD * openTunnels(base));
export const fillHours = (len) => DIG.FILL_BASE + DIG.FILL_PER * Math.max(1, Math.round(len || 1));
const lenOf = (rec) => rec.len || DIG.LEN[0];

// By the numbers (defences.js atTheWalls): how many tunnels a horde's Diggers dig.
export const digCount = (h) => Math.min(DIG.NUM, Math.floor((h.size * ((h.mix && h.mix.digger) || 0)) / DIG.EVERY));
// n tunnels dug where no battle map is fought: records with no cells yet (placed when a fight there lays them).
export function digTunnels(state, base, n, h = null) {
  if (!base || !(n > 0)) return 0;
  const list = baseTunnels(base);
  for (let i = 0; i < n; i++) {
    const id = (base.tunnelSeq = (base.tunnelSeq || 0) + 1);
    const span = DIG.LEN[1] - DIG.LEN[0] + 1;
    list.push({ id, a: null, b: null, len: DIG.LEN[0] + Math.floor(hash01(state.seed, "dig", base.id ?? base.tile, id, h ? h.id : 0) * span) % span, day: Math.floor(state.hour / 24) });
  }
  return n;
}
// The fight is over (combat.js closeCombat): a horde fight's open tunnels on your base's map stay on the base.
export function settleTunnels(state, b) {
  if (!b || !b.tunnels || !b.tunnels.length || b.drill || !b.setup || b.setup.layout !== "baseDefence" || b.setup.enemy.kind !== "zombies") return 0;
  const base = state.bases.find((x) => x.id === b.setup.baseId);
  if (!base || !usesGrid(base, b.setup.context) || !(b.deployPlan && b.deployPlan.fort)) return 0;
  const list = baseTunnels(base);
  let n = 0;
  for (const t of b.tunnels) {
    if (!t.open || t.rec != null) continue; // one of the base's already
    if (list.some((r) => r.a && ((r.a[0] === t.a[0] && r.a[1] === t.a[1] && r.b[0] === t.b[0] && r.b[1] === t.b[1]) || (r.a[0] === t.b[0] && r.a[1] === t.b[1] && r.b[0] === t.a[0] && r.b[1] === t.a[1])))) continue;
    list.push({ id: (base.tunnelSeq = (base.tunnelSeq || 0) + 1), a: t.a.slice(), b: t.b.slice(), len: t.len, w: b.w, h: b.h, day: Math.floor(state.hour / 24) });
    n++;
  }
  if (n) log(state, `${base.name}: the dead dug ${n === 1 ? "a tunnel" : `${n} tunnels`} under the defences. ${n === 1 ? "It stays" : "They stay"} open (the walls hold less, and the next horde can crawl through) until filled: click the hole on the base map and queue Fill tunnel.`, "danger");
  return n;
}
// A record with no cells yet laid on a fort map: a bare cell inside the walls (by a hash of the seed, the base and its
// id; deep in a big yard, out of a tunnel's reach of the bare ground outside, the next one on in the list that is
// within it), and the bare cell outside nearest its length from it. null: no room.
function placeTunnel(state, b, base, rec, ins) {
  const inner = [], outer = [];
  for (let i = 0; i < b.cells.length; i++) if (diggable(b.cells[i])) (ins[i] ? inner : outer).push(i);
  if (!inner.length || !outer.length) return null;
  const k0 = Math.floor(hash01(state.seed, "tunnelat", base.id, rec.id) * inner.length) % inner.length;
  const step = Math.max(1, Math.floor(inner.length / 97)); // a few dozen tries spread over the yard
  for (let t = 0; t * step < inner.length; t++) {
    const k = (k0 + t * step) % inner.length;
    const e = [inner[k] % b.w, (inner[k] / b.w) | 0];
    let best = null;
    for (const i of outer) {
      const p = [i % b.w, (i / b.w) | 0], d = cheb(p, e);
      if (d < 2 || d > DIG.RANGE) continue;
      const sc = Math.abs(d - lenOf(rec));
      if (!best || sc < best.sc) best = { p, sc, d };
    }
    if (best) return { a: best.p, b: e, len: best.d };
  }
  return null;
}
// A fight on the base's map begins (defences.js "baseDefence" layout, the units): the base's tunnels are on it, open
// and known to your people. The base map's view shows them too (it places, but never saves, a record's cells).
export function layTunnels(state, b, base, c = {}) {
  if (!base || !base.tunnels || !base.tunnels.length) return 0;
  const F = b.deployPlan && b.deployPlan.fort;
  if (!F || !usesGrid(base, c)) return 0;
  b.tunnels = b.tunnels || [];
  let n = 0;
  for (const rec of base.tunnels) {
    let at = rec.a ? { a: rec.a, b: rec.b, len: rec.len } : null;
    if (at && (rec.w !== b.w || rec.h !== b.h)) continue; // the map has grown since (the ring widened): kept off it
    if (!at && F.inside) {
      at = placeTunnel(state, b, base, rec, F.inside);
      if (at && !c.view) Object.assign(rec, { a: at.a.slice(), b: at.b.slice(), len: at.len, w: b.w, h: b.h });
    }
    if (!at || !endOk(b, at.a) || !endOk(b, at.b)) continue;
    b.tunnels.push({ id: (b.tunnelSeq = (b.tunnelSeq || 0) + 1), rec: rec.id, a: at.a.slice(), b: at.b.slice(), len: at.len, open: true, seenA: true, seenB: true });
    n++;
  }
  return n;
}
// The base's tunnel record at a map cell (an end of it), or null.
export const tunnelAt = (base, x, y) => (base && base.tunnels ? base.tunnels.find((r) => r.a && ((r.a[0] === x && r.a[1] === y) || (r.b[0] === x && r.b[1] === y))) || null : null);
export const fillJobOf = (base, id) => (base && base.construction ? base.construction.find((c) => c.type === "filltunnel" && c.tunnel === id) || null : null);
// Queue Fill tunnel (first in the queue: a way under the walls comes before the rest). Returns the job, or null.
export function queueFill(state, base, id) {
  const rec = base && base.tunnels ? base.tunnels.find((r) => r.id === id) : null;
  if (!rec || fillJobOf(base, id)) return null;
  const job = { id: newId(), type: "filltunnel", tunnel: id, label: `Fill a tunnel (${lenOf(rec)} cells)`, hours: fillHours(lenOf(rec)), progress: 0, cost: {} };
  base.construction.unshift(job);
  return job;
}
// The job done (buildings.js constructionHour): the tunnel is gone.
export function finishFill(state, base, job) {
  const i = base.tunnels ? base.tunnels.findIndex((r) => r.id === job.tunnel) : -1;
  if (i >= 0) base.tunnels.splice(i, 1);
  log(state, `${base.name}: a tunnel the dead dug is filled in and tamped down.${openTunnels(base) ? ` ${openTunnels(base)} still open.` : ""}`, "good");
}
// The governor (autopilot.js governBase): every open tunnel at the base queued to be filled. Returns a line or "".
export function autoFillTunnels(state, base) {
  const out = [];
  for (const rec of base.tunnels || []) { const job = queueFill(state, base, rec.id); if (job) out.push(job); }
  return out.length ? `${base.name}: queued ${out.length === 1 ? "a tunnel" : `${out.length} tunnels`} to be filled first (${out.map((j) => `${j.hours}h`).join(", ")}).` : "";
}
// A group's bases (groupworks.js groupWorksDaily): their crew fills DIG.GROUP_DAY work-hours a day, the oldest first.
export function groupFillDaily(state, f, homes) {
  let filled = 0;
  for (const base of Object.values(homes || {})) {
    const rec = base && base.tunnels && base.tunnels[0];
    if (!rec) continue;
    rec.fill = r1((rec.fill || 0) + DIG.GROUP_DAY);
    if (rec.fill >= fillHours(lenOf(rec))) { base.tunnels.shift(); filled++; }
  }
  return filled;
}
