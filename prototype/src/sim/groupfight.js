// One resolver for the fights nobody watches between groups, their parties and the dead (docs/adr/0001-ai-parity.md:
// the same code for every side): the power of each side is its people's as yours is counted (world.js combatPower,
// with their rounds: arsenal.js ammoFactor), the dead's by their numbers; walls count as your defence tiers count them
// (defences.js tierMults, read off the group's own buildings); the odds are your fights' curve (combat.js winOdds);
// the wounds land round by round on the very people (breakoff.js rollFight, one roll of the outcome for both sides,
// each side's break-off policy by its type); the fallen are dead (or saved by a medic, or carried out, or left behind
// and taken), the holder of the field takes the dead's kit (inventory.js stripAll, arsenal.js keepItem). Your own
// people in such a fight (a convoy of yours robbed on the road) take its rounds by your team's rules (applyYours).
import { combatPower, isNight, day, spendShots, arrowsBack } from "./world.js";
import { winOdds, powerEquiv } from "./combat.js";
import { fightModel, rollFight, landFight, BREAKOFF } from "./breakoff.js";
import { ammoFactor, keepItem, removeFromArsenal } from "./arsenal.js";
import { digTunnels } from "./tunnels.js"; // the Diggers' tunnels under their walls
import { tierMults, atTheWalls, holdLimit, spikeKill, minesTake, trapKill, breakInForce, breakInCount, heldKill, crawlerSlip, retreat, BOSS_STRENGTH, armoryDecoys, decoyChance, lureOff } from "./defences.js"; // your base's defence, step for step; its decoys
import { mixWeight } from "./zombietypes.js";
import { reduceHorde, hordeWallPower } from "./hordes.js";
import { climberSlip } from "./middead.js";
import { scaleFood } from "./foods.js";
import { groupTurretPower } from "./vehicles.js";
import { GEAR } from "./data.js";
import { removeMember, membersAt, partyPeople, syncMembers, isWounded } from "./members.js";
import { stripAll, allCarried } from "./inventory.js";
import { lureEdge } from "./decoys.js"; // decoys and Molotovs against the dead, by the numbers
import { homeAt } from "./groupbases.js";
import { spareKit } from "./loadouts.js";
import { capturePeople } from "./groupjails.js";
import { isAggressiveType, resolveRaidOnFaction } from "./factions.js";

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

// ---------- the dead at a group's base (docs/adr/0001-ai-parity.md: your base's way, defences.js) ----------
// A horde at a base of theirs goes through your base's code, step for step (defences.js atTheWalls, as hordeAttackBase
// uses it): their spike pits take their share and are used up, their minefield its share, their bear traps theirs (the
// wire and the traps worn), lit floodlights burn their fuel, a Wallbreaker and the brutes smash a defence; then the
// walls hold the dead back up to the hold limit (defences.js holdLimit: the walls, the people there manning them, the
// defence buildings: barricades, the trench, the gate, wire, sandbag positions, guard towers; the defence kit). A horde
// held at the walls loses what yours loses there (defences.js heldKill) and falls back (retreat); crawlers and Climbers
// that slip in anyway are fought inside (crawlersAt). Above the limit the dead break in (breakInCount, breakInForce,
// a Wallbreaker among them) and are fought by the numbers on the very people there (factions.js resolveRaidOnFaction,
// fightSides behind the base's wall tier), and the horde loses what it loses at yours (the hordeBreakIn handler): all
// that broke in when they are beaten, else the share the defenders killed and a little more as it tears through.
const KIND_OF = { raider: "raiders", expansionist: "fighters", zealot: "zealots", military: "soldiers", fortress: "soldiers", traders: "guards", commune: "militia" };
// A group's defence kit (bear traps, rolls of wire, sandbags, a tripwire: data.js GEAR defence) is on its books or its
// shelf, kept at its main base (groupbases.js: what nobody carries is there). For a horde at that base it lies in the
// base's armory as yours does while fn runs, and what the dead used up there (a trap broken, wire torn up) leaves the
// group after it. At its other bases: what that base's own armory holds.
function withKit(state, f, base, fn) {
  const own = Array.isArray(base.armory) ? base.armory : (base.armory = []);
  const lent = f.bases[0] === base.tile ? [...spareKit(f), ...(f.wares || [])].filter((it) => it && GEAR[it.key] && GEAR[it.key].defence && !own.includes(it)) : [];
  if (!lent.length) return fn();
  const list = [...own, ...lent];
  base.armory = list;
  try { return fn(); } finally {
    const left = new Set(list);
    for (const it of lent) if (!left.has(it) && !removeFromArsenal(f, it, "used up") && f.wares && f.wares.includes(it)) f.wares.splice(f.wares.indexOf(it), 1);
    base.armory = own;
  }
}
// The people at a base and their power as the fight inside counts them (resolveOrdinaryRaid: fightSides with the
// defenders in your place, their rounds, the wall tier; a military group's Humvee at its main base).
function insidePower(state, f, tile, people) {
  return peoplePower(people, ammoFactor(f)) * wallMult(state, f, tile) + (tile === f.bases[0] ? groupTurretPower(f) : 0);
}
// "Can they hold this base against a horde of `size`?" Your base's check (defences.js holdCheck) on theirs: the pits,
// traps and mines first, the walls up to the hold limit, and above it the dead that break in against the people there
// as the fight counts them. tier: "wall" (held there), "inside" (the break-in should be beaten), "overrun". Returns
// { size, after, limit, lim, holds, through, mine, theirs, tier } or null (not a base of theirs).
export function groupHoldCheck(state, f, tile, size, bosses = 0, mix = null) {
  const base = homeAt(state, f, tile);
  if (!f || !base) return null;
  return withKit(state, f, base, () => {
    const after = Math.max(0, size - spikeKill(base, size, mix) - trapKill(base, size) - minesTake(base, size, mix));
    const limit = holdLimit(state, base, bosses, false, mix); // the counter-dead among them, the tunnels under their walls (counterdead.js, tunnels.js)
    const lim = limit / mixWeight(mix, "wall");
    if (after <= lim) return { size, after, limit, lim, holds: true, through: 0, mine: 0, theirs: 0, tier: "wall" };
    const through = breakInCount(after, lim);
    const force = breakInForce(state, base, through, bosses, { mix });
    const theirs = force.count * force.power + bosses * BOSS_STRENGTH;
    const mine = insidePower(state, f, tile, fightersOf(state, f, { tile }));
    return { size, after, limit, lim, holds: false, through, mine, theirs, tier: mine >= theirs ? "inside" : "overrun" };
  });
}
// The horde h walks into their base at tile (hordes.js onHordeEnter). Returns { held, check } (check: groupHoldCheck
// before the fight, for the flight's judgement: groupflight.js hordeOverrun).
export function hordeAtGroup(state, h, f, tile) {
  const base = homeAt(state, f, tile);
  if (!base) return null;
  const bosses = Math.min(2, h.bosses || 0);
  const check = groupHoldCheck(state, f, tile, h.size, bosses, h.mix);
  f.hitDay = f.hordeHitDay = day(state); // valuation.js: a horde at their walls
  // Walls that will not hold it: they set out the decoys kept at home first, as you would from your armory on the
  // warning card (defences.js armoryDecoys: noise ones, heat ones for crawlers, up to DECOY_ITEMS; decoyChance; used up
  // either way). Drawn off, the horde falls back for a few days (lureOff). Walls that hold: the decoys are kept.
  if (check && !check.holds) {
    const items = armoryDecoys(baseLike(state, f, tile) || { armory: [] }, h);
    if (items.length) {
      for (const it of items) if (!removeFromArsenal(f, it, "used up") && f.wares && f.wares.includes(it)) f.wares.splice(f.wares.indexOf(it), 1);
      if (state.rng.chance(decoyChance(h, items.length))) { lureOff(state, h, { tile }); return { held: true, check, lured: items.length }; }
    }
  }
  const w = withKit(state, f, base, () => atTheWalls(state, h, base));
  if (!w) return { held: true, check }; // the pits, the mines or the traps finished it
  if (w.dig) digTunnels(state, base, w.dig, h); // tunnels.js: its Diggers tunnel under their walls (no battle map here, held or not); their crew fills them (groupworks.js)
  const people = fightersOf(state, f, { tile });
  const shot = spendShots(base.stock, people, 3); // 3 a head from the base's stores, as at yours
  if (h.size <= w.lim) {
    if (shot.arrows) base.stock.arrows = (base.stock.arrows || 0) + arrowsBack(shot.arrows); // held: about half the arrows picked up
    const killed = heldKill(state, base, h);
    if (people.length && h.size > w.lim * 0.7 && state.rng.chance(0.4)) { const s = state.rng.pick(people); s.health = Math.max(1, s.health - state.rng.int(10, 30)); } // one of them hurt on the walls, as at yours
    const slip = crawlerSlip(state, base, h, w.floodlit), climb = climberSlip(h, !!base.watchtower, true);
    if (!reduceHorde(state, h, killed)) retreat(state, h, base);
    if (slip + climb >= 4 && people.length) crawlersAt(state, f, base, h, slip, climb, people);
    return { held: true, check };
  }
  const through = breakInCount(h.size, w.lim);
  const force = breakInForce(state, base, through, bosses, h);
  const party = { strength: hordeWallPower(h), owner: null, horde: { count: force.count, power: force.count * force.power + bosses * BOSS_STRENGTH }, target: { factionId: f.id, tile } };
  const held = !!resolveRaidOnFaction(state, party, []);
  if (!state.hordes.includes(h)) return { held, check };
  if (held) { h.bosses = 0; if (!reduceHorde(state, h, through)) retreat(state, h, base); } // all that broke in cut down, the Wallbreaker with them
  else if (!reduceHorde(state, h, Math.round(through * (party.horde.killShare || 0))) && !reduceHorde(state, h, Math.round(through * 0.15))) retreat(state, h, base); // the share they killed, and more as it tears through (defences.js overrun)
  return { held, check };
}
// Crawlers and Climbers that slipped in while the walls held (defences.js crawlersInside, by the numbers): a small
// fight inside with the people there; lost, they tear through the stores there (food and meds × 0.85) and slink off.
function crawlersAt(state, f, base, h, slip, climb, people) {
  const all = slip + climb;
  const n = Math.max(2, Math.min(8, Math.round(all / 3)));
  const power = breakInForce(state, base, all).power;
  const fight = fightSides(state, { f: null, people: [], kind: "zombies", count: n, power: n * power }, { f, people, kind: KIND_OF[f.type] || "raiders" }, { mine: "def" });
  applySide(state, f, fight.rD, people, { holder: fight.attWon ? null : f });
  if (state.hordes.includes(h)) reduceHorde(state, h, Math.round(all * (fight.rD ? fight.rD.killShare : 0)));
  if (!fight.attWon) return;
  base.stock.meds = Math.floor((base.stock.meds || 0) * 0.85);
  scaleFood(base, 0.85); // foods.js: every kind of food
}
