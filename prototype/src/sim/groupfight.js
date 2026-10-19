// One resolver for the fights nobody watches between groups, their parties and the dead (docs/adr/0001-ai-parity.md:
// the same code for every side): the power of each side is its people's as yours is counted (world.js combatPower,
// with their rounds: arsenal.js ammoFactor), the dead's by their numbers; walls count as your defence tiers count them
// (defences.js tierMults, read off the group's own buildings); the odds are your fights' curve (combat.js winOdds);
// the wounds land round by round on the very people (breakoff.js rollFight, one roll of the outcome for both sides,
// each side's break-off policy by its type); the fallen are dead (or saved by a medic, or carried out, or left behind
// and taken), the holder of the field takes the dead's kit (inventory.js stripAll, arsenal.js keepItem). Your own
// people in such a fight (a convoy of yours robbed on the road) take its rounds by your team's rules (applyYours).
import { combatPower, isNight } from "./world.js";
import { winOdds, powerEquiv } from "./combat.js";
import { fightModel, rollFight, landFight, BREAKOFF } from "./breakoff.js";
import { ammoFactor, keepItem } from "./arsenal.js";
import { tierMults } from "./defences.js";
import { removeMember, membersAt, partyPeople, syncMembers, isWounded } from "./members.js";
import { stripAll, allCarried } from "./inventory.js";
import { lureEdge } from "./decoys.js"; // decoys and Molotovs against the dead, by the numbers
import { homeAt } from "./groupbases.js";
import { spareKit } from "./loadouts.js";
import { capturePeople } from "./groupjails.js";
import { isAggressiveType } from "./factions.js";

// A side's break-off policy (breakoff.js wantsOut) by its type: the aggressive fight on until most are down, the rest
// pull out when it turns against them (as your autopilot's styles: breakoff.js STYLE_POLICY), zealots never.
export const policyOf = (f) => (!f ? "never" : f.type === "zealot" ? "never" : isAggressiveType(f) ? "most" : "losing");
export const peoplePower = (people, ammo = 1) => (people || []).reduce((a, s) => a + combatPower(s), 0) * ammo;
// A base of theirs as your defence code reads one: its buildings, its defence kit (spare on its books, on its shelf), its stores.
export function baseLike(state, f, tile) {
  const h = homeAt(state, f, tile);
  if (!h) return null;
  return { id: null, tile, buildings: h.buildings || [], armory: [...spareKit(f), ...(f.wares || [])], stock: h.stock || f.stock };
}
// The wall tier's multiplier on its defenders (defences.js tierMults: walls, a tower, a gate, the trench, floodlights).
export function wallMult(state, f, tile) {
  const b = baseLike(state, f, tile);
  if (!b) return 1;
  try { return tierMults(state, b, isNight(state)).wall; } catch { return 1; }
}
// The fighters of a group for a fight: a party's people, else those living at the base (the fit first, up to n).
export function fightersOf(state, f, { party = null, tile = null, n = null } = {}) {
  if (!f) return [];
  syncMembers(state, f);
  let out = party ? partyPeople(f, party) : tile != null ? membersAt(f, tile) : [];
  out = out.filter((s) => s.alive !== false).sort((a, b) => (+isWounded(a) - +isWounded(b)) || combatPower(b) - combatPower(a) || a.id - b.id);
  return n != null ? out.slice(0, Math.max(0, Math.round(n))) : out;
}
// side: { f (a group, or null for the dead or a band counted by numbers), people: [persons], kind (for the odds:
// "raiders", "soldiers", "zombies", "mixed"), count (the dead: how many), power (a strength added: a turret, the dead's
// count × power, helpers), mult (walls), ammo }. Returns { attWon, pA, rA, rD } (rA / rD: breakoff.js rollFight of each
// side with people).
// The odds as yours are reckoned (combat.js byNumbersOdds): the side in your place by its people's combat power, the
// other by its people's power on the enemy scale (combat.js powerEquiv: what the odds were fitted on), each with its
// rounds. opts.mine: "att" (default) or "def" (the defenders in your place: a horde at their walls).
export function fightSides(state, att, def, opts = {}) {
  const rng = state.rng;
  const mineIs = opts.mine === "def" ? def : att;
  const ammo = (x) => x.ammo ?? (x.f ? ammoFactor(x.f) : 1);
  // decoys.js lureEdge: the decoys and Molotovs a side's people carry count against the dead as yours do (combat.js
  // byNumbersOdds), nothing against people or a Shepherd's pack.
  const lure = (x) => { const o = x === att ? def : att; return x.people && x.people.length ? 1 + lureEdge({ kind: o.kind, types: o.types }, x.people.flatMap((s) => allCarried(s).map((it) => it.key))) : 1; };
  const pw = (x) => (x === mineIs ? peoplePower(x.people, ammo(x)) : (x.people || []).reduce((a, s) => a + powerEquiv(x.kind || "raiders", combatPower(s)), 0) * ammo(x)) * lure(x) * (x.mult || 1) + (x.power || 0);
  const aP = pw(att), dP = pw(def);
  const aN = (att.people && att.people.length) || att.count || 1, dN = (def.people && def.people.length) || def.count || 1;
  const pA = mineIs === att ? winOdds(aP / Math.max(0.1, dP), { kind: def.kind || "raiders", count: dN, people: aN, ambush: opts.ambush || null })
    : 1 - winOdds(dP / Math.max(0.1, aP), { kind: att.kind || "raiders", count: aN, people: dN });
  const attWins = rng.chance(pA);
  // A group takes the left-behind of a side of people (a group's, or yours: side.yours) as it takes yours in your
  // team's fight (breakoff.js fightByNumbers). side.party: your team, for its vehicle on the way out (fightModel).
  const cap = (taker, side) => (taker && taker.alive !== false && (side.f || side.yours) && taker.bases && taker.bases.length ? BREAKOFF.CAPTURE : 0);
  const rA = att.people && att.people.length ? rollFight(rng, fightModel(state, att.people, { win: pA, enemy: { kind: def.kind || "raiders", count: dN }, capture: cap(def.f, att), party: att.party || null }), att.policy ?? policyOf(att.f), attWins) : null;
  const rD = def.people && def.people.length ? rollFight(rng, fightModel(state, def.people, { win: 1 - pA, enemy: { kind: att.kind || "raiders", count: aN }, capture: cap(att.f, def), party: def.party || null }), def.policy ?? policyOf(def.f), !attWins) : null;
  let won = attWins;
  if (rA && rA.round != null && !(rD && rD.round != null)) won = false; // the attackers broke off: the field is the defenders'
  if (rD && rD.round != null && !(rA && rA.round != null)) won = true; // the defenders broke off and ran
  return { attWon: won, pA, rA, rD };
}
// The rounds' wounds and falls onto a side's very people. holder: the group that holds the field (it takes the
// dead's kit; its own dead's stays on its books); captor: the other side's group, who takes the left-behind it caught.
// Returns { dead: [persons], hurt: [persons], taken: n }.
export function applySide(state, f, r, people, { holder = null, captor = null } = {}) {
  const out = { dead: [], hurt: [], taken: 0 };
  if (!r || !f) return out;
  const byId = new Map(people.map((s) => [s.id, s]));
  const rng = state.rng;
  const carried = new Map(((r.run && r.run.carried) || []).map((c) => [c.id, c]));
  const left = new Map(((r.run && r.run.left) || []).map((l) => [l.id, l]));
  const caught = [];
  for (const m of r.members) {
    const s = byId.get(m.id);
    if (!s || s.alive === false) continue;
    if (!m.down || m.saved) { // standing (or kept alive by a medic: barely)
      const hp = m.saved ? Math.min(s.health, rng.int(5, 15)) : Math.round(m.hp);
      if (hp < s.health) { s.health = Math.max(1, Math.min(100, hp)); out.hurt.push(s); }
      continue;
    }
    const c = carried.get(m.id);
    if (c && c.lives) { s.health = Math.min(s.health, rng.int(5, 15)); out.hurt.push(s); continue; } // carried out alive
    const l = left.get(m.id);
    if (l && l.captured && captor) { s.health = Math.min(s.health, rng.int(5, 15)); caught.push(s); continue; }
    out.dead.push(s);
  }
  if (caught.length) out.taken = capturePeople(state, captor, f, caught); // groupjails.js: the very people
  for (const s of out.dead) {
    const own = holder === f;
    removeMember(state, f, s, "died", { keepKit: own }); // members.js: their own kit back on their books when they hold the field
    if (!own && holder) for (const it of stripAll(s)) keepItem(state, holder, it, "battlefield"); // the field's holder takes the rest off the dead
  }
  return out;
}
// Your people in a fight nobody watched (a side { yours: true, people, party, policy } in fightSides, opts.mine on
// their side: your rules for yours): the rounds land on them as on your team's fight by the numbers (breakoff.js
// landFight: the wounds through armour and traits, a medic's save, the carried out and the left behind, taken by the
// captor group or dead). Returns { hurtIds, deadIds, captured, carriedIds }.
export function applyYours(state, r, people, { tile, cause, kind, captor = null, party = null }) {
  if (!r) return { hurtIds: new Set(), deadIds: [], captured: [], carriedIds: [] };
  return landFight(state, r, people, { tile, cause, kind, captor, party });
}
