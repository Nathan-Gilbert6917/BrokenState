// The determinism digest (tools/dettest.js, tools/savetest.js): a world's stocks, buildings, wear and repairs,
// survivors' health / skills / XP / perks / mood / place, parties, hordes, hives, factions, site loot (aiscav.js), diplomacy, jobs, the
// coalition, prisoners, crashes, tech, relationships, stats and every log line, rounded to 3 decimals, with ids
// written as their offset from the world's first id (id0) so worlds whose ids start elsewhere compare equal.
import { day } from "../src/sim/world.js";
import { partyTile } from "../src/sim/parties.js";

export const r3 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v);
export const roundAll = (o) => JSON.parse(JSON.stringify(o, (k, v) => r3(v)));

// Ids (values, numeric strings, and numbers inside object keys such as "388|389") → their offset from the world's
// first id, so the same ids handed out in the same order compare equal.
export function normalizeIds(obj, id0, id1) {
  const isId = (v) => Number.isInteger(v) && v > id0 && v < id1;
  const map = (v) => (isId(v) ? `#${v - id0}` : v);
  const fix = (o) => {
    if (Array.isArray(o)) return o.map(fix);
    if (o && typeof o === "object") {
      const out = {};
      for (const [k, v] of Object.entries(o)) out[k.replace(/\d{7,}/g, (x) => map(Number(x)))] = fix(v);
      return out;
    }
    if (typeof o === "string" && /^\d{7,}$/.test(o)) return map(Number(o));
    return map(o);
  };
  return JSON.stringify(fix(obj));
}

export function digest({ st, lines, id0, id1 }) {
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  const d = {
    day: day(st), hour: st.hour, over: !!st.gameOver, rng: st.rng ? st.rng.state : null,
    bases: st.bases.map((b) => ({
      id: b.id, name: b.name, type: b.type, tile: b.tile, stock: b.stock, buildings: b.buildings.map((x) => pick(x, ["id", "type", "wear", "broken", "rigged", "built"])),
      construction: b.construction.map((c) => pick(c, ["type", "progress", "hours"])), repairs: b.repairs || [], pump: b.pump || null,
      armory: (b.armory || []).map((g) => [g.key, g.q, g.uses]), radio: !!b.radio, dog: b.dog ? b.dog.name : null, scavLeft: b.scavLeft ?? null,
    })),
    survivors: st.survivors.map((s) => ({
      id: s.id, name: s.name, alive: s.alive, health: s.health, mood: s.mood, role: s.role, skills: s.skills, xp: s.xp, perks: s.perks,
      traits: s.traits, location: s.location, wounds: (s.conditions || []).map((c) => [c.key, c.sev]), rec: s.rec,
    })),
    parties: st.parties.map((p) => ({ id: p.id, owner: p.owner, kind: p.kind, mission: p.mission, tile: partyTile(p), phase: p.phase || null, cargo: p.cargo ? Object.fromEntries(Object.entries(p.cargo).filter(([, v]) => typeof v === "number")) : null, scav: p.scav || null })),
    hordes: st.hordes.map((h) => pick(h, ["id", "tile", "size", "target", "boss", "mode"])),
    hives: (st.hives || []).map((h) => pick(h, ["id", "tile", "res", "alive", "stage"])),
    factions: st.factions.map((f) => pick(f, ["id", "name", "type", "alive", "pop", "bases", "goodwill", "known", "stock", "atWar", "scavNext"])),
    // Site loot (aiscav.js: what everyone has taken) and the loot you know of (stale until seen).
    loot: st.tiles.filter((t) => t.loc).map((t) => [t.id, t.loot]), aiScav: st.aiScav || null,
    knownLoot: st.knowledge.map((k, i) => (k && st.tiles[i].loc ? [i, k.loot, k.hour, k.lootHour ?? null] : null)).filter(Boolean),
    diplo: st.diplo || null, jobs: st.jobs || null, alliance: st.alliance || null, tech: st.tech || null,
    prisoners: (st.prisoners || []).map((p) => pick(p, ["id", "name", "factionId", "at", "mode", "opinion", "unfed"])),
    crashes: st.crashes || null, rel: st.rel || null, stats: st.stats, lines,
    // Outsiders (visitors.js): who is on the map, where, what they carry; their dice and the merchants' reputation.
    visitors: (st.visitors || []).map((v) => pick(v, ["id", "kind", "tile", "phase", "size", "stock", "goal", "stopIdx", "known", "paid", "goodwill"])),
    visitorInfo: st.visitorInfo ? { rng: st.visitorInfo.rng.state, next: st.visitorInfo.next, rep: st.visitorInfo.rep, stats: st.visitorInfo.stats } : null,
  };
  return normalizeIds(roundAll(d), id0, id1);
}
