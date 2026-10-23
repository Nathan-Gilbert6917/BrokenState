// Decoys, fire and the senses of the dead; the Shepherd's aura.
//
// What the dead follow (hiveconst.js SENSES and ZTYPES senses):
//   the ordinary dead: noise and light · runners: noise · brutes: noise · spitters: noise and light · crawlers: heat ·
//   screamers: nothing (they shriek and call others instead) · Shepherds, Wallbreakers, Broodmothers: nothing.
// What makes it (stealth.js THROWABLES sense): a bottle, a noise maker, firecrackers, an alarm clock, a pocket radio:
// noise; hand warmers, a heat pack: heat; a road flare: light and heat; a fire (a Molotov's flames, throwables.js):
// light and heat, within FIRE.lure (7) tiles of a burning cell.
// The unaware dead go to look at any lure they sense (stealth.js pull). A decoy (THROWABLES decoy: a noise maker,
// firecrackers, an alarm clock, a radio, hand warmers, a heat pack, a flare) and a fire also pull the dead that have
// seen you: each of the enemy's turns, one of the dead that senses a decoy or a fire within its radius, and has
// nobody living it is after within PULL_FREE tiles, walks to it instead of coming for them (lureTurn): to the spot,
// or into the flames. Whoever threw it: a decoy pulls the dead off the raiders as it pulls them off you. People are
// never fooled: a guard who hears a decoy looks to where it was thrown from (stealth.js).
// Who throws one (botDecoy): your bots, and every other side's people on their own turn (combat.js aiUnit), by one
// rule: only a decoy they hold, once a turn for the side, when the dead press on its people (docs/adr/0001-ai-parity.md).
//
// The Shepherd (zombietypes.js, hiveconst.js SHEPHERD): every one of the dead within its aura (4 tiles) of a living
// Shepherd senses nothing (herded): no decoy or fire pulls it, it comes for the living and the breaches, it does not
// shuffle about, and it knows what the Shepherd knows (an aware Shepherd wakes its pack). Kill it and the aura ends.
//
// By the numbers (combat.js byNumbersOdds for yours, groupfight.js fightSides for anyone else's): decoys and Molotovs
// a side carries add LURE.PER each (at most LURE.MAX) to its strength against the dead, nothing against a pack with
// a Shepherd among it or against people.
import { ZTYPES, SENSES, SHEPHERD } from "./hiveconst.js";
import { THROWABLES, DECOY_KEYS, throwablesOf, stealthAct } from "./stealth.js";
import { FIRE } from "./throwables.js";
import { active, reachable, pathTo, distField, moveAlong, say, foesOf } from "./combat.js";
import { drowned, drownWhy } from "./seasonfx.js"; // the rain drowns out a noise lure (the user's request 2026-10-23)

export const LURE = { PULL_FREE: 2.5, PER: 0.02, MAX: 0.08, AI_MIN: 3, AI_KEEP: 5 };
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// ---------- senses ----------
// The living Shepherds on the map.
export const shepherdsOf = (b) => b.units.filter((o) => o.ztype === "shepherd" && active(o));
// Is this one of the dead inside a Shepherd's aura (not the Shepherd itself)?
export function herded(b, u) {
  if (u.kind !== "zombie" || u.ztype === "shepherd") return false;
  for (const s of b.units) if (s.ztype === "shepherd" && active(s) && dist(s.x, s.y, u.x, u.y) <= ((ZTYPES.shepherd.aura) || SHEPHERD.AURA) + 1e-6) return true;
  return false;
}
// What this unit follows: [] for people (never fooled), bosses, Shepherds and the herded.
export function sensesOf(b, u) {
  if (!u || u.kind !== "zombie") return [];
  if (u.boss) return SENSES.boss;
  if (u.ztype && ZTYPES[u.ztype]) { if (u.ztype === "shepherd") return []; }
  if (b && herded(b, u)) return [];
  return (u.ztype && ZTYPES[u.ztype] && ZTYPES[u.ztype].senses) || SENSES.ordinary;
}
export const sensesAny = (b, u, sense) => { const s = sensesOf(b, u); return !!sense && sense.some((k) => s.includes(k)); };

// ---------- what pulls the dead that have seen you ----------
// Every decoy and fire on the map: { x, y, radius, sense, fire, key }. A fire is its burning cells (one each).
export function stimuli(b) {
  const out = [];
  for (const l of b.lures || []) {
    const T = THROWABLES[l.key];
    if (!T || !T.decoy || l.turns <= 0) continue;
    if (b.sfx && drowned(b, l, T)) continue; // seasonfx.js: the rain drowns it out
    out.push({ x: l.x, y: l.y, radius: l.radius, sense: l.sense || T.sense, key: l.key, fire: false });
  }
  for (const f of b.fires || []) out.push({ x: f.x, y: f.y, radius: FIRE.lure, sense: ["light", "heat"], key: "fire", fire: true });
  return out;
}
// The stimulus this one of the dead goes for: the nearest it senses within its radius (null: none).
export function pullOf(b, u, list = stimuli(b)) {
  if (!list.length) return null;
  const s = sensesOf(b, u);
  if (!s.length) return null;
  let best = null;
  for (const m of list) {
    if (!m.sense.some((k) => s.includes(k))) continue;
    const d = dist(u.x, u.y, m.x, m.y);
    if (d > m.radius + 1e-6) continue;
    if (!best || d < best.d) best = { ...m, d };
  }
  return best;
}

// The enemy's turn for one of the dead (combat.js aiUnit): a decoy or a fire it senses pulls it there unless someone
// living it is after is within PULL_FREE tiles (then it fights): your people, the third side, and on a raid's map the
// raiders it is in contact with (combat.js foesOf, crossfire.js). Returns true when it went for the lure.
export function lureTurn(b, u) {
  if (u.kind !== "zombie" || !active(u) || u.ap < 1) return false;
  const m = pullOf(b, u);
  if (!m) return false;
  const near = foesOf(b, u).some((o) => o.kind !== "zombie" && Math.max(Math.abs(o.x - u.x), Math.abs(o.y - u.y)) <= LURE.PULL_FREE);
  if (near) return false;
  // Into the flames (the burning cells), or next to a decoy (it stays there, staring).
  const targets = m.fire ? (b.fires || []).filter((f) => dist(f.x, f.y, m.x, m.y) <= 1.5).map((f) => [f.x, f.y]) : [[m.x, m.y]];
  const here = Math.max(...targets.map(([x, y]) => -dist(x, y, u.x, u.y)));
  if (!m.fire && -here <= 1.5) { u.ap = 0; u.lured = m.key; return true; }
  if (m.fire && targets.some(([x, y]) => x === u.x && y === u.y)) { u.ap = 0; u.lured = "fire"; return true; }
  const r = reachable(b, u, u.mob * u.ap);
  const field = distField(b, targets);
  let best = -1;
  for (let i = 0; i < b.w * b.h; i++) {
    if (!isFinite(r.dist[i]) || !isFinite(field[i])) continue;
    if (best < 0 || field[i] < field[best] || (field[i] === field[best] && r.dist[i] < r.dist[best])) best = i;
  }
  if (best < 0 || r.dist[best] === 0) { u.ap = 0; return true; }
  const first = !u.lured;
  u.lured = m.key;
  moveAlong(b, u, pathTo(r, best % b.w, (best / b.w) | 0));
  if (first && m.fire) say(b, `${u.name} shambles toward the flames.`, "good");
  u.ap = 0;
  return true;
}

// ---------- the Shepherd's pack ----------
// At the start of the enemy's turn: an aware Shepherd wakes the dead in its aura.
export function shepherdTurn(b) {
  for (const s of shepherdsOf(b)) {
    if (!s.aware) continue;
    for (const o of b.units) if (o.kind === "zombie" && o.side === s.side && !o.aware && active(o) && herded(b, o)) { o.aware = true; delete o.investigate; }
  }
}

// ---------- the AI: a decoy to pull the dead off its people (every side: docs/adr/0001-ai-parity.md) ----------
// Your bots ask it for each of yours (combat.js autoPlayerTurn), and every other side's people ask it on their own
// turn (combat.js aiUnit: a raider, a guard, a soldier of the third side, a volunteer): the same rule, the same cost.
// One decoy a turn for the side (b.decoyTurn by side): when AI_MIN or more of the dead that are after the side's
// people (and sense it) are within 4 tiles of them (at a breach, the gate, around the team, at a raiders' post the dead
// found: crossfire.js), a spot AI_KEEP+ tiles from all of them, within range, that pulls the most. Only a decoy the
// unit holds (stealth.js throwablesOf: one of yours from what they carry or the team's cargo, anyone else's from what
// they carried into the fight), taken off them as they throw it (1 action).
const decoyTurns = (b) => b.decoyTurn || (b.decoyTurn = {});
export function botDecoy(state, b, u) {
  if (decoyTurns(b)[u.side] === b.turn || !active(u) || u.ap < 1) return false;
  const have = throwablesOf(state, b, u);
  const keys = DECOY_KEYS.filter((k) => have[k]).concat(have.flare ? ["flare"] : []);
  if (!keys.length) return false;
  // The side's living people (on a raid's map the dead share the raiders' side: crossfire.js), and the dead after
  // them: any of another side, and those of their own side in contact with them (combat.js foesOf).
  const mine = b.units.filter((o) => o.side === u.side && o.kind !== "zombie" && active(o));
  const after = (o) => o.side !== u.side || foesOf(b, o).some((m) => m.side === u.side && m.kind !== "zombie");
  const dead = b.units.filter((o) => o.kind === "zombie" && active(o) && !o.off && mine.some((m) => dist(m.x, m.y, o.x, o.y) <= 4) && after(o));
  if (dead.length < LURE.AI_MIN) return false;
  let best = null;
  for (const key of keys) {
    const T = THROWABLES[key];
    const sense = T.sense || ["noise"];
    const pulled = dead.filter((o) => sensesAny(b, o, sense));
    if (pulled.length < LURE.AI_MIN) continue;
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const d = dist(u.x, u.y, x, y);
      if (d > T.range || d < 2) continue;
      if (b.sfx && drownWhy(b, T, x, y)) continue; // seasonfx.js: no noise lure where the rain drowns it out (a flare still works)
      if (mine.some((m) => dist(m.x, m.y, x, y) < LURE.AI_KEEP)) continue;
      const n = pulled.filter((o) => dist(o.x, o.y, x, y) <= T.radius).length;
      const sc = n * 10 + Math.min(...mine.map((m) => dist(m.x, m.y, x, y))) * 0.1 + T.turns * 0.2;
      if (n >= LURE.AI_MIN && (!best || sc > best.sc)) best = { key, x, y, sc, n };
    }
  }
  if (!best) return false;
  decoyTurns(b)[u.side] = b.turn;
  return !stealthAct(state, b, u, null, { type: "throw", item: best.key, x: best.x, y: best.y });
}

// ---------- by the numbers ----------
// The edge a team's decoys and Molotovs give it against the dead in a fight resolved by the numbers: + PER each, at
// most MAX; nothing against people or a pack led by a Shepherd. items: the keys the team carries.
export function lureEdge(enemy, items) {
  if (!enemy || (enemy.kind !== "zombies" && enemy.kind !== "mixed")) return 0;
  if (enemy.types && enemy.types.shepherd) return 0;
  const n = (items || []).filter((k) => DECOY_KEYS.includes(k) || k === "molotov" || k === "flare").length;
  return Math.min(LURE.MAX, n * LURE.PER) * (enemy.kind === "mixed" ? 0.5 : 1);
}
