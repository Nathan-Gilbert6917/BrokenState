// Every human on the battle map is a person (docs/adr/0001-ai-parity.md, the user's decision 2026-10-19): a survivor
// record with skills, traits, health and an inventory, made into a unit by the one builder (combat.js playerUnit),
// whatever their side. Yours are your survivors (u.sid). Anyone else's is u.who (the person) and u.mid (their id):
//   - a member of an AI group (members.js): memberize draws one for the fight (the people at that base for a fight
//     there, else the fit ones at home, best first, a home guard kept back as arsenal.js issueKit kept kit back) and
//     builds the unit from them: their own gun, armour, rig, magazines, med kit, throwables, as carried;
//   - anyone with no lasting record (the holders of a site, rival scavengers, a hostile band, nomads and visitors for
//     now): a transient person (personFromLegacy), made as the fight is set up from the same dice the old builder
//     rolled (combat.js enemyUnit), carrying exactly what their body would have yielded (inventory.js enemyBody: the
//     gun, armour, rig, magazines, a medic's kit, a tourniquet, the food, meds, scrap and rounds in their pockets).
//     Their skills come from the fight's power (aim, melee) the way the old units' numbers did.
// The AI's own fields (its kit's label and habits, an RPG by kit dice, boards to nail up) stay on the unit.
// When the fight ends a person's body is what they carried (personBody); their health, wounds and death are written
// back onto them (arsenal.js settleArsenal: settlePeople).
import { playerUnit, KITS } from "./combat.js";
import { GEAR } from "./data.js";
import { ensureInv, enemyBody, allCarried, carriedSpots, EQUIP_SLOTS } from "./inventory.js";
import { makeSurvivor, peekNextId, setNextId, factionById, survivorById } from "./world.js";
import { Rng } from "./rng.js";
import { hash01 } from "./skills.js";
import { memberById, membersOf, isWounded, fighterScore, atHome, syncMembers } from "./members.js";
import { enemyGunLoaded } from "./gunload.js";
import { fillBattleUnit } from "./combat.js";
import { isStacked } from "./mags.js";
import { roundItems } from "./itemstack.js";
import { stow } from "./inventory.js";
import { MAGAZINES } from "./data-kit.js";
import { isLauncherKey } from "./arsenal.js";
import { armLauncher } from "./launchers.js";
import { keyFor } from "./rounds.js";
import { CARRY, weighPlayer } from "./carrykit.js";
import { spendSelfAid } from "./medics.js"; // an AI person's field load by kit
import { typeFor } from "./rounds.js";
import { stockAt } from "./groupbases.js";
import { enemyPieces } from "./armour.js";
import { isHelmet, earGearOf } from "./helmets.js";
import { refitSenses } from "./stealth.js";

export const PEOPLE = { on: true }; // test switch: off, the old units (power numbers and kit dice)
export const THROW_KEYS = ["frag", "pipebomb", "molotov", "flashbang", "smokegren"];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// The person behind a unit, of any side.
export function personOf(state, u) {
  if (!u) return null;
  if (u.who) return u.who;
  if (u.sid != null) return survivorById(state, u.sid) || null;
  if (u.mid != null) return memberById(state, u.mid) || null;
  return null;
}
export const isPerson = (u) => !!(u && u.who);

// ---------- the AI's fields on a unit built from a person ----------
// What they carry to throw (siege.js enemyThrow, coverSmoke read u.throwables): counted from the items; arsThrows: the
// items themselves (what is thrown leaves them when the fight ends: spentThrows).
export function fitThrowables(u, s) {
  const items = allCarried(s).filter((it) => it && THROW_KEYS.includes(it.key));
  const n = {};
  for (const it of items) n[it.key] = (n[it.key] || 0) + 1;
  u.throwables = Object.keys(n).length ? n : undefined;
  u.throwStart = { ...n };
}
// The unit made from person s (combat.js playerUnit) with the place and the AI's fields of `was` kept.
const KEEP = ["id", "x", "y", "f", "aware", "pod", "home", "occupant", "team", "tgroup", "reinforcement", "post", "guard", "face", "asleep", "wild", "surprised"];
function build(b, s, side, was) {
  if (was && was.who === s) stowGun(was); // the same person built again: what was loaded in the gun stays in it
  const id0 = b.nextId;
  const u = playerUnit(b, s, side);
  b.nextId = id0;
  delete u.sid;
  u.mid = s.id;
  u.who = s;
  if (was) for (const k of KEEP) if (was[k] !== undefined) u[k] = was[k];
  // Their field load by kit (carrykit.js CARRY.BASE_KG: the user's decision 2026-10-08, soldiers in full kit move 4),
  // weighed by your rule (weighPlayer: the felt load sets the band).
  const kit = (was && was.kit) || s.kit || null;
  if (side !== "player" && kit && CARRY.BASE_KG[kit]) { u.fieldKg = CARRY.BASE_KG[kit]; weighPlayer(u, s); }
  u.armorKey = s.gear.armor ? s.gear.armor.key : null; // what the old builder named (bodies, sprites, the risen read it)
  u.rigKey = s.gear.rig ? s.gear.rig.key : null;
  u.helmKey = s.gear.head && isHelmet(s.gear.head.key) ? s.gear.head.key : null; // the old builder's names for their headgear (bodies, carry weight)
  { const e = earGearOf(s); u.earKey = e && e.item ? e.item.key : e && e.key ? e.key : null; }
  fitThrowables(u, s);
  if (side !== "player") u.medsBag = s.carried || (s.carried = {}); // combat.js aiMeds: the meds they carry (a group's people: their stores, memberize)
  if (b.units && !b.scratch) refitSenses(b, u, s); // stealth.js: their light, night vision and suppressor from what they carry (stealthSetup again at the start)
  if (b.units && !b.scratch) fillBattleUnit(b, u, s); // mags.js fillUnit: the gun and the spares loaded physically, from what they carry (never your team's bags)
  return u;
}
// The rounds in a unit's gun back onto the gun (gunload.js: it.loaded, the stack in its order), as the fight ends or
// the unit is built again.
export function stowGun(u) {
  if (!u || !isStacked(u) || !u.item) return;
  enemyGunLoaded(u, u.item);
  u.stack = [];
}

// ---------- transient people (no lasting record) ----------
// A person for a unit the old builder made (combat.js enemyUnit: L, its dice already rolled), carrying what its body
// would hold. power: the fight's (Shooting from the old aim, 39 + 4 × power + the kit's; Melee from 65 + 2 × power).
export function personFromLegacy(b, rng, L, kind, power) {
  if (!PEOPLE.on || !L || L.kind !== "human") return L;
  const p = Math.max(1, power || 1);
  const kit = KITS[kind] || KITS.raiders;
  const salt = rng && Number.isFinite(rng.state) ? rng.state : b.turn || 0;
  const seed = Math.floor(hash01("person", salt, L.id, b.tileId ?? 0) * 4294967296);
  const dice = new Rng(seed);
  if (L.pieces === undefined) enemyPieces(b, L); // armour.js: their armour and kit helmet as rolled (worn as the body would drop them)
  const body = enemyBody(dice, L, kit); // what they carry: the same dice a body of theirs rolls
  const keepId = peekNextId();
  let s;
  try { s = makeSurvivor({ rng: dice, seed, survivors: [], namesGiven: [], peopleMade: 9e6 + (L.id % 100000) }, 1); } finally { setNextId(keepId); }
  s.id = b.personSeq = Math.max(b.personSeq || 2e9, 2e9) + 1;
  s.name = L.name;
  s.skills.shooting = clamp(Math.round((4 * p + (kit.aim || 0) - 1) / 2.5), 0, 20);
  s.skills.melee = clamp(Math.round(p), 0, 20);
  if (L.isMedicKit) s.skills.medicine = Math.max(s.skills.medicine || 0, Math.round((L.medicine || 0) - (L.kitBonus || 0)));
  s.gear = body.gear;
  s.pockets = body.pockets;
  // Someone the kit dealt a gun (or a blade) can use it, by your rule (world.js gearEffect: within 3 of its skill, at
  // 85%): their skill is raised that far when the fight's power left it lower.
  const w = s.gear.weapon, d = w && GEAR[w.key];
  if (d && d.skill && d.req) s.skills[d.skill] = Math.max(s.skills[d.skill] || 0, Math.min(20, d.req - 3));
  s.carried = body.supplies || {}; // loose supplies on them (food, meds, scrap): their body's
  // Their rounds as things they carry (inventory.js: loose rounds in a pocket, then the rig, the pack), so they reload
  // from them as you do; what does not fit stays loose on them (their body has it).
  for (const [k, q] of Object.entries(s.carried)) {
    if (!/^a_/.test(k) || !(q > 0)) continue;
    let left = Math.floor(q);
    for (const it of roundItems(k, left, true)) { const n = Math.floor(Number(it.dur) || 0); if (!stow(s, it)) break; left -= n; }
    if (left > 0) s.carried[k] = left; else delete s.carried[k];
  }
  // The kit's spare magazines come full of its load (as the old units' counted them): what they start the fight with.
  for (const it of allCarried(s)) {
    const m = it && MAGAZINES[it.key];
    if (!m || Array.isArray(it.stack) || it.unloaded) continue;
    it.stack = [{ k: keyFor(m.cal, typeFor(m.cal, it.load || null)), n: m.cap }];
  }
  s.transient = true;
  s.kit = kind;
  s.location = { kind: "battle" };
  s.role = "transient";
  ensureInv(s);
  if (s.gear.weapon && s.gear.weapon.key === L.weapon && L.load) s.gear.weapon.load = L.load; // the round their kit loads (ammo.js enemyLoad)
  (b.people || (b.people = {}))[s.id] = s;
  const u = build(b, s, L.side || "enemy", L);
  for (const k of ["name", "short", "kit", "fearless", "kitPick", "boards"]) if (L[k] !== undefined) u[k] = L[k];
  if (L.load && u.weapon === L.weapon) u.load = L.load;
  if (L.gl) { u.gl = L.gl; u.kitGl = true; } // an RPG or an M203's rounds by kit dice (launchers.js kitLauncher): not an item they carry
  return u;
}

// ---------- AI groups' members ----------
const HOME_HANDLERS = ["rescue", "assault", "baseAssault", "rescueRaid"];
export const HOME_SHARE = 0.35; // arsenal.js ARSENAL.HOME: the share of a group kept at home for a fight away
// The next of the group's people for this fight (null: none left to send).
export function drawMember(state, b, f) {
  syncMembers(state, f);
  const used = new Set(b.drawn || (b.drawn = []));
  const tile = b.tileId;
  const atTile = f.bases && f.bases.includes(tile);
  const home = atTile || HOME_HANDLERS.includes(b.setup && b.setup.handler);
  const e = (b.setup && b.setup.enemy) || {};
  const free = membersOf(f).filter((s) => s.alive && !used.has(s.id) && (!e.partyId || s.location.partyId === e.partyId || atHome(s)));
  const rank = (list) => list.slice().sort((a, c) => fighterScore(c) - fighterScore(a) || a.id - c.id);
  let pick = null;
  if (e.partyId != null) pick = rank(free.filter((s) => s.location.partyId === e.partyId && !isWounded(s)))[0] || null;
  if (!pick && home) {
    pick = rank(free.filter((s) => atHome(s) && s.location.tile === tile && !isWounded(s)))[0]
      || rank(free.filter((s) => atHome(s) && !isWounded(s)))[0]
      || rank(free.filter((s) => atHome(s)))[0] || null; // at their own walls the wounded fight too
  }
  if (!pick) {
    // A fight away: the home guard (HOME_SHARE of the people, every third from the second best) stays behind.
    const fit = rank(membersOf(f).filter((s) => atHome(s) && !isWounded(s)));
    const guard = Math.ceil(membersOf(f).length * HOME_SHARE);
    let kept = 0;
    const out = [];
    fit.forEach((s, i) => { if (i % 3 === 1 && kept < guard) kept++; else out.push(s); });
    pick = out.find((s) => !used.has(s.id)) || null;
  }
  if (pick) b.drawn.push(pick.id);
  return pick;
}
// Turns unit u into one of group fid's people (drawn for this fight), in place: the same id, cell and alertness.
// false (u unchanged) when the group has nobody left to send or is not a group with people.
export function memberize(state, b, u, fid) {
  if (!PEOPLE.on || !u || u.kind !== "human") return false;
  const f = factionById(state, fid);
  if (!f || f.alive === false || f.outsider) return false;
  const s = drawMember(state, b, f);
  if (!s) return false;
  const was = { ...u };
  const nu = build(b, s, u.side || "enemy", was);
  nu.factionId = f.id;
  nu.arsFid = f.id;
  nu.kit = was.kit || null;
  nu.fearless = !!was.fearless;
  nu.kitPick = nu.weapon;
  // Their meds (combat.js aiMeds): at one of their bases the stores there, on the road what their party packed.
  const e = (b.setup && b.setup.enemy) || {};
  const party = e.partyId != null ? (state.parties || []).find((p) => p.id === e.partyId && p.owner === f.id) : null;
  nu.medsBag = (f.bases || []).includes(b.tileId) ? stockAt(state, f, b.tileId) : party || nu.medsBag;
  if (was.who && was.who.transient && b.people) delete b.people[was.who.id];
  for (const k of Object.keys(u)) delete u[k];
  Object.assign(u, nu);
  // A launcher they carry (or the M203 under their rifle) with its rounds from the group's stores (launchers.js: the
  // arsenal's rounds by key; what is not fired goes back after the fight, settleArsenal).
  u.arsItem = s.gear.weapon || null;
  const tube = allCarried(s).find((it) => it && isLauncherKey(it.key));
  if (tube || u.arsItem) armLauncher(state, b, u, f, { launcher: tube || null });
  f.arsenalSeen = state.hour != null ? Math.floor(state.hour / 24) : f.arsenalSeen;
  return true;
}
// Unit u, in place, built from person s (a band's person: bands.js), keeping its place and the AI's fields.
export function fromPerson(state, b, u, s) {
  const was = { ...u };
  const nu = build(b, s, u.side || "enemy", was);
  for (const k of ["name", "short", "kit", "fearless", "boards", "factionId", "team", "tgroup", "occupant"]) if (was[k] !== undefined) nu[k] = was[k];
  nu.name = s.name || was.name;
  nu.kitPick = nu.weapon;
  if (was.who && was.who.transient && b.people) delete b.people[was.who.id];
  for (const k of Object.keys(u)) delete u[k];
  Object.assign(u, nu);
  return u;
}
// A unit rebuilt from the person it already has (a weapon or health changed on them before the fight: thirdside.js).
export function refitPerson(b, u) {
  if (!u || !u.who) return u;
  const was = { ...u };
  const nu = build(b, u.who, u.side, was);
  for (const k of ["name", "short", "kit", "fearless", "kitPick", "boards", "factionId", "arsFid", "team", "tgroup", "occupant", "medsBag"]) if (was[k] !== undefined) nu[k] = was[k];
  if (was.kitGl && !nu.gl) { nu.gl = was.gl; nu.kitGl = true; }
  for (const k of Object.keys(u)) delete u[k];
  Object.assign(u, nu);
  return u;
}
// A person given another weapon before the fight starts (a wanderer's own, thirdside.js): the item in their hands,
// the one they had back in their pack (or dropped).
export function armPerson(b, u, item) {
  const s = u && u.who;
  if (!s || !item) return;
  s.gear.weapon = item;
  refitPerson(b, u);
}

// ---------- when the fight ends ----------
// What they threw (u.throwables counted down by the AI) leaves them: the items, by kind. Returns them.
export function spentThrows(u, s) {
  const out = [];
  if (!s || !u.throwStart) return out;
  for (const [k, n0] of Object.entries(u.throwStart)) {
    const left = (u.throwables && u.throwables[k]) || 0;
    let gone = Math.max(0, n0 - left);
    for (const c of carriedSpots(s)) { if (gone <= 0) break; if (c.item && c.item.key === k) { c.take(); out.push(c.item); gone--; } }
  }
  u.throwStart = u.throwables ? { ...u.throwables } : {};
  return out;
}
// The body of a person who fell (or was taken): everything they carried, the person left with nothing.
export function personBody(u) {
  const s = u.who;
  spentThrows(u, s);
  spendSelfAid(u, s); // medics.js: a tourniquet used on themselves is spent
  const body = ensureInv({ name: u.name, kind: "human", uid: u.id, kit: u.kit || null, supplies: { ...(s.carried || {}) } });
  for (const k of EQUIP_SLOTS) { body.gear[k] = s.gear[k] || null; s.gear[k] = null; }
  body.pockets = (s.pockets || []).slice();
  s.pockets = s.pockets.map(() => null);
  s.carried = {};
  ensureInv(body);
  if (body.gear.weapon) enemyGunLoaded(u, body.gear.weapon); // gunload.js: the rounds left in it
  u.bodyItems = allCarried(body);
  u.bodied = true;
  return body;
}
