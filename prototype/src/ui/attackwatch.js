// What counts as "under attack" for the screen-edge warnings (ui/edgefx.js draws them, ui/edgepulse.js is the pulse).
// Read from what the game already keeps: no state of its own in the world, no dice. Pure: the tools call it.
//
// The State Map (mapAttackSources): one source per place, worst first (pri 0, 1, 2):
//   a base of yours under attack (0)   besieged by a group's raid or by raiders from outside (parties.js and
//                                      visitors.js phase "siege"), or a battle at it open or waiting (combat.js
//                                      state.combat / state.combatQueue with a baseId)
//   a team of yours in a fight (1)     its battle open or waiting its turn (combatQueue with its partyId), or a
//                                      confrontation card over it (conflicts.js: an ambush, a roadblock, a patrol)
//   about to hit a base of yours (2)   a raid the lookouts have seen coming (parties.js p.warned), a horde coming for
//                                      it that the lookouts or the watchtower saw (defences.js hordeWarnings /
//                                      towerWatch) or that you can see within HORDE_CLOSE tiles, raiders from outside
//                                      in sight within HORDE_CLOSE tiles of the base they are heading for
// The battle (battleHitSources): one source per unit of yours that an enemy shot at, struck or hit (combat.js b.fx
// "shot" and "melee" at its cell), for HOLD_MS after the last one.
import { partyMembers } from "../sim/parties.js";

export const HORDE_CLOSE = 3; // a horde or raiders you can see this many tiles from the base they are heading for
export const HOLD_MS = 3500;  // a unit's warning lasts this long after the last shot at it

const first = (n) => String(n || "").split(/\s+/)[0];
const teamName = (state, p) => {
  const m = partyMembers(state, p);
  return m.length ? `${first(m[0].name)}'s team` : "Your team";
};

export function mapAttackSources(state) {
  const out = [], seen = new Set();
  if (!state || !state.bases) return out;
  const base = (id) => state.bases.find((b) => b.id === id);
  const push = (s) => { if (!seen.has(s.key)) { seen.add(s.key); out.push(s); } };
  const attacked = (b, why) => push({ key: `base:${b.id}`, kind: "base", pri: 0, tile: b.tile, baseId: b.id, icon: "⚔", label: `${b.name} under attack`, tip: `${b.name}: ${why}. Click to look there.` });
  const incoming = (b, what, icon) => push({ key: `near:${b.id}`, kind: "near", pri: 2, tile: b.tile, baseId: b.id, icon, label: `${what} closing on ${b.name}`, tip: `${what} heading for ${b.name}. Click to look there.` });
  const fight = (p, how, tile) => push({ key: `team:${p.id}`, kind: "team", pri: 1, tile, partyId: p.id, icon: "⚔", label: `${teamName(state, p)} ${how}`, tip: `${teamName(state, p)} (${partyMembers(state, p).map((s) => first(s.name)).join(", ")}): ${how}. Click to look there.` });
  const playerTeam = (id) => state.parties.find((p) => p.id === id && p.owner === "player");
  const tileOf = (p) => (p.path ? p.path[p.idx] : null);
  // Bases under siege and battles at a base.
  for (const p of state.parties) {
    if (p.owner === "player" || p.phase !== "siege" || !p.target || p.target.kind !== "player") continue;
    const b = base(p.target.baseId);
    if (b) attacked(b, "raiders at the walls");
  }
  for (const v of state.visitors || []) {
    if (v.kind !== "raiders" || !v.goal || v.goal.kind !== "base") continue;
    const b = base(v.goal.baseId);
    if (!b) continue;
    if (v.phase === "siege") attacked(b, "raiders from outside at the walls");
    else if (state.live && state.live.has(v.tile) && state.grid.distance(v.tile, b.tile) <= HORDE_CLOSE) incoming(b, "Raiders", "🚨");
  }
  const setups = [...(state.combat && state.combat.setup ? [state.combat.setup] : []), ...(state.combatQueue || [])];
  for (const s of setups) {
    if (s.baseId != null && !s.partyId) { const b = base(s.baseId); if (b) attacked(b, "a fight at the base"); continue; }
    const p = s.partyId != null ? playerTeam(s.partyId) : null;
    if (p) fight(p, "in a fight", tileOf(p));
  }
  // Teams facing a fight: a confrontation card (conflicts.js) over the team.
  for (const c of state.cards || []) {
    if (c.kind !== "conflict" || c.partyId == null) continue;
    const p = playerTeam(c.partyId);
    if (!p) continue;
    const t = c.conflict && c.conflict.type;
    fight(p, t === "ambush" ? "ambushed" : "in a fight", tileOf(p));
  }
  // About to hit a base: a raid the lookouts saw coming, hordes coming for it.
  for (const p of state.parties) {
    if (p.owner === "player" || p.kind !== "raid" || p.phase === "siege" || !p.warned || !p.target || p.target.kind !== "player") continue;
    const b = base(p.target.baseId);
    if (b) incoming(b, "A raid", "🚨");
  }
  for (const h of state.hordes || []) {
    const b = state.bases.find((x) => (h.goal && h.goal.baseId === x.id) || h.target === x.tile);
    if (!b || h.tile === b.tile) continue;
    const watched = !!(b.towerWatch && b.towerWatch.ids && b.towerWatch.ids.includes(h.id));
    const seenClose = state.live && state.live.has(h.tile) && state.grid.distance(h.tile, b.tile) <= HORDE_CLOSE;
    if (h.warned || watched || seenClose) incoming(b, `A horde of ${h.size}`, "🧟");
  }
  // A base already under attack: no second pulse for what is still coming at it.
  const hit = new Set(out.filter((s) => s.kind === "base").map((s) => s.baseId));
  const list = out.filter((s) => !(s.kind === "near" && hit.has(s.baseId)));
  list.sort((a, b) => a.pri - b.pri);
  return list;
}

// Is a base of yours under attack (for the heartbeat)?
export const baseUnderAttack = (sources) => sources.some((s) => s.kind === "base");

// mem: { b, seq, hits: Map(unit id -> { t, hit }) }, kept by the caller across frames. now: ms.
export function battleHitSources(b, mem, now, holdMs = HOLD_MS) {
  if (!b || !b.units) return [];
  if (mem.b !== b) { mem.b = b; mem.seq = b.fxSeq || 0; mem.hits = new Map(); }
  for (const e of b.fx || []) {
    if (!(e.seq > mem.seq)) continue;
    if ((e.type !== "shot" && e.type !== "melee") || e.side === "player" || !e.to) continue;
    const [x, y] = e.to;
    const u = b.units.find((v) => v.side === "player" && !v.dead && !v.left && !v.fled && v.x === x && v.y === y && (e.f == null || (v.f || 0) === e.f));
    if (!u) continue;
    const was = mem.hits.get(u.id);
    mem.hits.set(u.id, { t: now, hit: !!e.hit || !!(was && was.hit && now - was.t < holdMs) });
  }
  mem.seq = Math.max(mem.seq, b.fxSeq || 0);
  const out = [];
  for (const [id, h] of mem.hits) {
    const u = b.units.find((v) => v.id === id);
    if (!u || u.dead || u.left || u.fled || now - h.t >= holdMs) { mem.hits.delete(id); continue; }
    out.push({ key: `unit:${id}`, kind: "unit", pri: h.hit ? 0 : 1, unit: u, icon: h.hit ? "🩸" : "🎯", label: `${first(u.name)} ${h.hit ? "hit" : "under fire"}`, tip: `${u.name} is ${h.hit ? "being hit" : "under fire"} out of view. Click to look there.` });
  }
  out.sort((a, b2) => a.pri - b2.pri);
  return out;
}
