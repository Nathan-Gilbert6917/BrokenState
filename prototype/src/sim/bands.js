// Nomad bands and visitors from beyond the border as people (docs/adr/0001-ai-parity.md): band.people, persons made
// from their kit's own dice the way a transient person is (fighters.js personFromLegacy: they carry what their body
// would yield), kept from fight to fight: their wounds, their kit, their dead. The band's head count (a nomad band's
// pop, a visitor's size) stays the number its own code works with; the list follows it (syncBand: newcomers, the
// lost taken from the wounded first, by a hash). A fight with a band draws its people (bandize), and what the map did
// to them is written back (settleBand: the dead and the taken leave the list, the rest keep their health). Someone who
// joins a band from outside it (nomads.js recruit: a refugee, someone off the road) is made as one who joins you is
// (bandNewcomer) and put in its list with the head count, never as a number.
import { personKey } from "./members.js"; // dice the same in every world on the seed
import { Rng } from "./rng.js";
import { hash01 } from "./skills.js";
import { enemyUnit } from "./combat.js";
import { MEMBER, touchMembers, withGroupDice } from "./members.js";
import { makeCandidate } from "./recruits.js"; // a newcomer, made as one who joins you is
import { PEOPLE, fromPerson, stowGun } from "./fighters.js";
import { nomadsOf } from "./nomads.js";
import { visitorsOf } from "./visitors.js";
import { note } from "./ledger.js"; // the conservation test's ledger (off in play)
import { carriedRounds } from "./loadouts.js";

export const bandCount = (band) => Math.max(0, Math.round(band.nomad ? band.pop || 0 : band.size ?? band.pop ?? 0));
const keyOf = (band) => `${band.nomad ? "n" : "v"}${band.serial ?? 0}`;
export function bandById(state, ref) {
  if (!ref) return null;
  const list = ref.kind === "nomad" ? nomadsOf(state) : visitorsOf(state);
  return list.find((x) => x.id === ref.id) || null;
}
export const bandRef = (band) => ({ kind: band.nomad ? "nomad" : "visitor", id: band.id });
// One new person of the band, by its kit (the dice: the seed, the band, how many it has made).
function makeBandPerson(state, band, power, kind) {
  const k = (band.madePeople = (band.madePeople || 0) + 1);
  const rng = new Rng(Math.floor(hash01(state.seed, "bandperson", keyOf(band), k) * 4294967296));
  const scratch = { nextId: 1, units: [], turn: 0, tileId: band.tile ?? 0, floor: 0, people: {}, setup: {}, scratch: true }; // (fighters.js: nothing is loaded in a scratch battle)
  const u = enemyUnit(scratch, rng, kind, power, k);
  const s = u && u.who;
  if (!s) return null;
  s.id = state.memberSeq = Math.max(state.memberSeq || MEMBER.ID0, MEMBER.ID0) + 1;
  s.transient = false;
  s.band = keyOf(band);
  s.name = u.name;
  s.location = { kind: "band", ref: bandRef(band) };
  s.kitKind = kind;
  note(state, "arrived", carriedRounds(s)); // ledger.js: a band's person made with their holdings (a creation seed)
  return s;
}
// A newcomer who joins a band (nomads.js recruit: a refugee from beyond the border, someone off the road), made as one
// who joins you is (recruits.js makeCandidate: the same constructor, the same quality and health, and only what they
// carry of their own: maybe a weapon, a piece of armour, a bit of kit, a keepsake, by its odds), under the band's own
// dice (members.js withGroupDice: the world's dice and counters as they were). opts: makeCandidate's (quality,
// minHealth). Not yet in the band's list (the caller puts them there with the head count). null with the people off
// (fighters.js PEOPLE: the old units, a head count only).
export function bandNewcomer(state, band, opts = {}) {
  if (!PEOPLE.on) return null;
  const s = withGroupDice(state, band, `join:${keyOf(band)}`, () => makeCandidate(state, opts));
  delete s.pending;
  s.id = state.memberSeq = Math.max(state.memberSeq || MEMBER.ID0, MEMBER.ID0) + 1;
  s.transient = false;
  s.band = keyOf(band);
  s.location = { kind: "band", ref: bandRef(band) };
  note(state, "recruit", carriedRounds(s)); // ledger.js: a newcomer with what they carry (a creation seed, as a group's)
  return s;
}
export function syncBand(state, band, power, kind) {
  if (!band || !PEOPLE.on) return [];
  if (!Array.isArray(band.people)) band.people = [];
  band.people = band.people.filter((s) => s.alive);
  const want = bandCount(band);
  while (band.people.length < want) { const s = makeBandPerson(state, band, power, kind); if (!s) break; band.people.push(s); }
  if (band.people.length > want) {
    const order = band.people.slice().sort((a, b) => (a.health - b.health) || hash01(state.seed, "bandloss", keyOf(band), personKey(state, a.id)) - hash01(state.seed, "bandloss", keyOf(band), personKey(state, b.id)));
    const drop = new Set(order.slice(0, band.people.length - want));
    band.people = band.people.filter((s) => !drop.has(s));
  }
  touchMembers();
  return band.people;
}
// Unit u (made by combat.js enemyUnit for this fight) becomes the next of the band's people, in place.
export function bandize(state, b, u, ref) {
  const band = bandById(state, ref);
  if (!band || !u || u.kind !== "human") return false;
  const people = syncBand(state, band, (b.setup && b.setup.enemy && b.setup.enemy.power) || 3, u.kit || "raiders");
  const used = new Set(b.drawn || (b.drawn = []));
  const s = people.filter((p) => p.alive && !used.has(p.id)).sort((a, c) => c.health - a.health || a.id - c.id)[0];
  if (!s) return false;
  b.drawn.push(s.id);
  fromPerson(state, b, u, s);
  u.bandRef = ref;
  return true;
}
// After the fight (combat.js finishCombat): the band's dead and taken leave it; the rest keep the health they have.
export function settleBand(state, setup, result, battle) {
  const ref = setup && setup.enemy && setup.enemy.band;
  if (!ref || !battle || !battle.units) return;
  const band = bandById(state, ref);
  if (!band || !Array.isArray(band.people)) return;
  const won = result && result.outcome === "victory";
  for (const u of battle.units) {
    if (!u.who || !u.bandRef || u.who.band == null) continue;
    const s = u.who;
    const taken = !u.dead && (u.nlTaken || u.captured || (won && (u.ko || (u.surr && u.tied) || (u.wounded && u.down && (u.stab || u.tied)))));
    if (u.dead || taken) { s.alive = !u.dead && s.alive; band.people = band.people.filter((x) => x !== s); continue; }
    s.health = Math.max(1, Math.min(100, Math.round(u.down && !u.surr ? 5 + Math.floor(hash01(state.seed, "bandhp", personKey(state, s.id), state.hour) * 11) : u.hp)));
    stowGun(u); // fighters.js: the rounds left in the gun stay in it
  }
  touchMembers();
}
