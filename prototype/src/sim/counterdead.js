// The counter-dead (the user's request 2026-10-21: "new zombies that can be created to counter your defenses"): kinds
// a hive breeds in answer to the defences of the bases its hordes go for. Their numbers in hiveconst.js (ZTYPES digger,
// melter, husk, tripper, darkwalker; GROWTHS tunnels, meltpool, huskbed, blastscar, gloom; COUNTER); the Digger's
// tunnels in tunnels.js.
// - Digger: tunnels under walls, gates and trenches (tunnels.js). Melter: its blows eat through structures COUNTER.MELT
//   times as fast (combat.js UNIT_SIEGE melter). Husk: walks through wire and spike pits unhurt (trapProof, from
//   combat.js moveAlong). Tripper: sniffs out the mines within COUNTER.SNIFF tiles and walks onto them (tripperTurn),
//   COUNTER.BLAST of a blast (combat.js hitMult). Dark-walker: low in the dark, floodlit ground does not show it
//   (zombietypes.js zRevealed), it keeps off lit cells (darkTurn). The Climber (middead.js) answers walls too.
// - What a hive reads (defenceProfile, 0–1 a part: walls, trench, wire, mines, light) of a base, any base: yours and a
//   group's alike (docs/adr/0001-ai-parity.md). Each hive keeps its read (hive.adapt), moved COUNTER.READ of the way a
//   day toward the most any base it may attack has built (adaptDaily: yours within its attack range, a group's within
//   COUNTER.GROUP_RANGE, the closer the more: the rule hives.js attackTarget picks by), and COUNTER.HIT of the way at
//   once toward a base its horde has just met (noteDefences, from defences.js atTheWalls).
// - What it does with the read: a counter growth is wished for once its kind's read (counterNeed: its parts' most)
//   reaches COUNTER.MIN (hivetech.js growthWish); in a new horde a counter kind comes along more often (+ ODDS × the
//   read) and at a bigger share (× 1 + MIX × the read), each at most KIND_MAX and all of them SHARE_MAX (counterMix,
//   from hivetech.js hiveMix). And the hive pays for every one of them (payCounters, from hives.js buy: ZTYPES breed
//   resources each after the horde's own cost; it brings as many as it can pay for). A counter growth grown in reach
//   of a base of yours is in the log ("The hive near X has begun breeding Diggers"), and the tile panel shows a known
//   hive's read (hiveCounterText).
// - By the numbers (counterCut, from defences.js holdLimit, holdCheck, atTheWalls): each kind takes COUNTER.CUT of
//   its share off the parts it answers (the walls' hold, the gate's, the barricades', the trench's, the wire's and the
//   lights' bonus, what the spike pits and the mines take), each part at most COUNTER.MAX; the tunnels under a base's
//   walls take their own share of the hold (tunnels.js tunnelHold).
// No world dice here: the reads are sums, the breeding pays from the hive's resources.
import { COUNTER, ZTYPES } from "./hiveconst.js";
import { count, baseWalls, hasWall } from "./buildings.js";
import { minesLeft, MINES } from "./mines.js";
import { reachable, pathTo, moveAlong, active, adjacent, distField } from "./combat.js";
import { log } from "./world.js";
import { attackRange } from "./hivetech.js";
import { homesOf } from "./groupbases.js";
import { tunnelHold } from "./tunnels.js";

const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const COUNTER_KINDS = Object.keys(ZTYPES).filter((k) => ZTYPES[k].counters);
export const BRED_KINDS = Object.keys(ZTYPES).filter((k) => ZTYPES[k].breed > 0); // the ones a hive pays for
const PART_WORDS = { walls: "walls", trench: "trenches", wire: "wire and spike pits", mines: "mines", light: "floodlights and towers" };

// ---------- what a hive reads of a base ----------
// 0–1 a part, by what stands there (the same for your bases and a group's).
export function defenceProfile(base) {
  const out = { walls: 0, trench: 0, wire: 0, mines: 0, light: 0 };
  if (!base) return out;
  const n = (t) => count(base, t);
  const wire = (base.armory || []).filter((it) => it && it.key === "barbedwire").length;
  out.walls = clamp01((hasWall(base) ? Math.min(1, baseWalls(base) / 8) : 0) + 0.1 * Math.min(1, n("gate")) + 0.05 * n("barricades"));
  out.trench = clamp01(0.6 * n("trench"));
  out.wire = clamp01(0.3 * n("barbed_wire") + 0.4 * n("razor_wire") + 0.25 * n("spike_pits") + 0.1 * wire);
  out.mines = minesLeft(base) > 0 ? clamp01(0.5 + minesLeft(base) / (4 * MINES.PER)) : 0;
  out.light = clamp01((n("floodlights") ? 0.6 : 0) + (base.watchtower || n("watchtower") ? 0.25 : 0) + 0.25 * Math.min(1, n("guard_towers")));
  for (const k in out) out[k] = r3(out[k]);
  return out;
}
const adaptOf = (hive) => hive.adapt || (hive.adapt = { walls: 0, trench: 0, wire: 0, mines: 0, light: 0 });
// The bases a hive's hordes may go for, each with how near (1 at the hive, 0.5 at the edge of its reach).
function basesInReach(state, hive) {
  const g = state.grid, out = [];
  const range = attackRange(state, hive);
  for (const b of state.bases) { const d = g.distance(hive.tile, b.tile); if (d <= range) out.push({ base: b, w: 1 - 0.5 * (d / Math.max(1, range)) }); }
  for (const f of state.factions || []) {
    if (!f.alive || !f.bases) continue;
    const near = f.bases.map((t) => [t, g.distance(hive.tile, t)]).filter(([, d]) => d <= COUNTER.GROUP_RANGE);
    if (!near.length) continue;
    const homes = homesOf(state, f);
    for (const [t, d] of near) if (homes[t]) out.push({ base: homes[t], w: 1 - 0.5 * (d / COUNTER.GROUP_RANGE) });
  }
  return out;
}
// The day's read (hivetech.js growthsDaily): toward the most built within reach.
export function adaptDaily(state) {
  for (const hive of state.hives || []) {
    const want = { walls: 0, trench: 0, wire: 0, mines: 0, light: 0 };
    for (const { base, w } of basesInReach(state, hive)) { const p = defenceProfile(base); for (const k in want) want[k] = Math.max(want[k], p[k] * w); }
    const a = adaptOf(hive);
    for (const k in want) a[k] = r3((a[k] || 0) + (want[k] - (a[k] || 0)) * COUNTER.READ);
  }
}
// A horde of the hive's has met these defences (defences.js atTheWalls).
export function noteDefences(state, h, base) {
  const hive = h && h.hive != null ? (state.hives || []).find((x) => x.id === h.hive) : null;
  if (!hive || !base) return;
  const a = adaptOf(hive), p = defenceProfile(base);
  for (const k in p) a[k] = r3((a[k] || 0) + (p[k] - (a[k] || 0)) * COUNTER.HIT);
}
// How much this hive's read asks for a kind (its parts' most), 0–1.
export function counterNeed(state, hive, kind) {
  const z = ZTYPES[kind];
  if (!z || !z.counters || !hive || !hive.adapt) return 0;
  return Math.max(0, ...z.counters.map((p) => hive.adapt[p] || 0));
}

// ---------- a new horde ----------
// The odds a counter kind comes along (hivetech.js mixOdds): + COUNTER.ODDS × the read.
export const counterOdds = (state, hive, kind) => (ZTYPES[kind] && ZTYPES[kind].breed ? COUNTER.ODDS * counterNeed(state, hive, kind) : 0);
// The shares (hivetech.js hiveMix, before its own cap): a counter kind × (1 + MIX × the read), each at most KIND_MAX,
// all of them SHARE_MAX.
export function counterMix(state, hive, mix) {
  if (!mix) return mix;
  let tot = 0;
  for (const k in mix) {
    if (!(ZTYPES[k] && ZTYPES[k].breed)) continue;
    mix[k] = Math.min(COUNTER.KIND_MAX, mix[k] * (1 + COUNTER.MIX * counterNeed(state, hive, k)));
    tot += mix[k];
  }
  if (tot > COUNTER.SHARE_MAX) for (const k in mix) if (ZTYPES[k] && ZTYPES[k].breed) mix[k] = mix[k] * (COUNTER.SHARE_MAX / tot);
  return mix;
}
// The hive pays for the counter-dead in a new horde of `size` (hives.js buy, after the horde's own cost): ZTYPES breed
// each; short, as many as it can (the shares cut to what is paid). Returns { paid, bred: { kind: n } }; mix is changed.
export function payCounters(state, hive, mix, size) {
  const out = { paid: 0, bred: {} };
  if (!mix || !hive) return out;
  const want = BRED_KINDS.filter((k) => mix[k] > 0).map((k) => ({ k, n: Math.round(size * mix[k]) }));
  const cost = want.reduce((a, w) => a + w.n * ZTYPES[w.k].breed, 0);
  if (!cost) { for (const w of want) if (!w.n) delete mix[w.k]; return out; }
  const f = Math.min(1, Math.max(0, hive.res) / cost);
  for (const w of want) {
    const n = Math.floor(w.n * f + 1e-9);
    if (n > 0) { mix[w.k] = r3(n / size); out.bred[w.k] = n; out.paid += n * ZTYPES[w.k].breed; } else delete mix[w.k];
  }
  out.paid = Math.round(out.paid * 100) / 100;
  hive.res = Math.round((hive.res - out.paid) * 100) / 100;
  const st = state.hiveInfo && state.hiveInfo.stats;
  if (st && out.paid) { st.counterBred = (st.counterBred || 0) + Object.values(out.bred).reduce((a, v) => a + v, 0); st.counterPaid = Math.round(((st.counterPaid || 0) + out.paid) * 100) / 100; }
  return out;
}

// ---------- by the numbers ----------
// What a horde's counter-dead take off each part of a base's defence (0 – COUNTER.MAX), and the walls' hold left
// (hold: × the walls' strength, the tunnels under them too).
export function counterCut(base, mix) {
  const out = { walls: 0, gate: 0, barricades: 0, trench: 0, wire: 0, pits: 0, mines: 0, light: 0 };
  if (mix) for (const k in mix) { const C = COUNTER.CUT[k]; if (!C || !(mix[k] > 0)) continue; for (const p in C) out[p] += mix[k] * C[p]; }
  for (const p in out) out[p] = r3(Math.min(COUNTER.MAX, out[p]));
  out.hold = r3((1 - out.walls) * tunnelHold(base));
  return out;
}

// ---------- the words ----------
// "Diggers (walls and trenches), Husks (wire)" for the counter-dead in a mix ("" when none).
export function counterText(mix) {
  return BRED_KINDS.filter((k) => mix && mix[k] > 0).map((k) => `${ZTYPES[k].name}s (against ${ZTYPES[k].answers})`).join(", ");
}
// A hive's read for the tile panel: "walls 62%, wire 30%: breeding Diggers, Husks" ("" when it reads nothing yet).
export function hiveCounterText(state, hive, unlocks = []) {
  const a = hive && hive.adapt;
  if (!a) return "";
  const parts = COUNTER.PARTS.filter((p) => (a[p] || 0) >= 0.05).sort((x, y) => a[y] - a[x]).map((p) => `${PART_WORDS[p]} ${Math.round(a[p] * 100)}%`);
  if (!parts.length) return "";
  const bred = unlocks.filter((k) => ZTYPES[k] && ZTYPES[k].counters).map((k) => `${ZTYPES[k].name}s`);
  return `It has the measure of ${parts.join(", ")}${bred.length ? `: it breeds ${bred.join(", ")} against them` : ""}.`;
}
// A counter growth grown (hivetech.js completeGrowth): the log names the base of yours whose defences it answers.
export function counterNews(state, hive, kind) {
  const z = ZTYPES[kind];
  if (!z || !z.counters) return "";
  let best = null;
  for (const { base, w } of basesInReach(state, hive)) {
    if (base.group) continue;
    const p = defenceProfile(base), v = Math.max(...z.counters.map((q) => p[q] || 0)) * w;
    if (!best || v > best.v) best = { base, v };
  }
  if (!best) return "";
  const text = `The hive near ${best.base.name} has begun breeding ${z.name.toLowerCase()}s: an answer to the ${z.answers} the dead have found there.`;
  log(state, text, "danger");
  return text;
}

// ---------- on the battle map ----------
// A Husk through wire and spike pits (combat.js moveAlong): the trap does nothing to it.
export const trapProof = (u, trap) => !!u && u.ztype === "husk" && (trap === "wire" || trap === "spikes");
const foesOf = (b) => b.units.filter((o) => o.side === "player" && active(o));
// A Tripper: a mine it smells within COUNTER.SNIFF tiles that it can reach this action, walked onto. true: it went.
export function tripperTurn(b, u) {
  const foes = foesOf(b);
  if (!foes.length || foes.some((f) => adjacent(u, f)) || !b.mines) return false;
  const r = reachable(b, u, u.mob || 3);
  let best = null;
  for (let y = Math.max(0, u.y - COUNTER.SNIFF); y <= Math.min(b.h - 1, u.y + COUNTER.SNIFF); y++) for (let x = Math.max(0, u.x - COUNTER.SNIFF); x <= Math.min(b.w - 1, u.x + COUNTER.SNIFF); x++) {
    const i = y * b.w + x;
    if (!b.cells[i].mine || !isFinite(r.dist[i]) || r.dist[i] <= 0) continue;
    if (!best || r.dist[i] < best.d) best = { x, y, d: r.dist[i] };
  }
  if (!best) return false;
  u.ap = Math.max(0, (u.ap || 0) - 1);
  moveAlong(b, u, pathTo(r, best.x, best.y));
  if (u.ap > 0 && active(u)) return tripperTurn(b, u) || false;
  u.ap = 0;
  return true;
}
// A Dark-walker at night with lit ground about: on toward the living, weighing a lit cell COUNTER.LIT more. true: it
// moved; false: the usual AI (nothing lit, someone next to it, nowhere better: it batters what is in its way).
export function darkTurn(b, u) {
  const foes = foesOf(b);
  if (!b.lit || !foes.length || foes.some((f) => adjacent(u, f))) return false;
  const r = reachable(b, u, (u.mob || 3) * Math.max(1, u.ap || 1));
  const field = distField(b, foes.map((f) => [f.x, f.y]), u);
  let best = null;
  for (let i = 0; i < b.w * b.h; i++) {
    if (!isFinite(r.dist[i])) continue;
    const x = i % b.w, y = (i / b.w) | 0;
    const next = foes.some((f) => Math.max(Math.abs(f.x - x), Math.abs(f.y - y)) === 1);
    const sc = (next ? -100 : field[i]) + (b.lit[i] ? COUNTER.LIT : 0) + r.dist[i] * 0.05;
    if (!best || sc < best.sc) best = { x, y, sc, cost: r.dist[i] };
  }
  if (!best || best.cost === 0) return false;
  moveAlong(b, u, pathTo(r, best.x, best.y));
  if (best.sc < -50 && active(u) && best.cost <= (u.mob || 3)) { u.ap = 1; return false; } // next to one of them with an action left: the usual AI strikes
  u.ap = 0;
  return true;
}
