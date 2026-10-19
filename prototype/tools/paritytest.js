// The swapped-sides parity test (docs/adr/0001-ai-parity.md): the same person, built once on your side and once on
// theirs, is the same fighter; the rules below treat them alike. One section a batch.
//   1. The unit builder: aim, health, movement, sight, the gun, armour, the medic, the throwables.
//   2. Physical rounds: the same reload plan from what they carry, the same refusal when it is gone, rounds that run out.
//   3. The rules that were keyed to a side: caught unaware, a flare's light, footsteps, a gun above their skill, hearing
//      lost for good, going down and pulled through, meds, throwing what they carry, perks.
//   4. Carrying and moving people: a nomad band carries what its people can by your teams' rule; a loan between
//      groups moves the very people away and back, as yours are lent.
// Usage: node tools/paritytest.js [seed]
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { createBattle, combatAct, registerCombatHandler, reload, loadMag, magIn } from "../src/sim/combat.js";
import { fromPerson, THROW_KEYS } from "../src/sim/fighters.js";
import { newItem, stow, carriedSpots } from "../src/sim/inventory.js";
import { newBox, setRounds } from "../src/sim/ammo.js";
import { starterMags } from "../src/sim/carrykit.js";
import { reloadPlan } from "../src/sim/mags.js";
import { shotOdds, medsOf } from "../src/sim/combat.js";
import { stepNoise } from "../src/sim/vision.js";
import { deafen, HEARING } from "../src/sim/hearing.js";
import { settleFoes } from "../src/sim/medics.js";
import { throwablesOf } from "../src/sim/stealth.js";
import { battlePerks } from "../src/sim/skills.js";
import { spawnNomads, bandRoom } from "../src/sim/nomads.js";
import { carryCapacity } from "../src/sim/parties.js";
import { itemLoad } from "../src/sim/inventory.js";
import { syncMembers } from "../src/sim/members.js";
import { lendPeople, loanHome, VOL } from "../src/sim/volunteers.js";
const stackN = (st) => st.reduce((a, x) => a + (x.n || 0), 0);

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
const section = (t) => console.log(`\n${t}`);
registerCombatHandler("paritytest", () => {});

// A person of yours with a kit (a rifle, two spare magazines, a vest, a box of rounds, a bandage kit, a frag).
function person(state, opts = {}) {
  const s = makeSurvivor(state);
  s.skills.shooting = opts.shooting ?? 8; s.skills.melee = 6; s.skills.medicine = 5;
  s.traits = [];
  s.health = opts.health ?? 100;
  for (const slot of ["head", "armor", "arms", "legs", "tool", "rig", "backpack"]) s.gear[slot] = null;
  s.pockets = s.pockets.map(() => null);
  s.gear.weapon = newItem(opts.weapon || "pistol");
  s.gear.armor = newItem("vest");
  starterMags(s);
  if (opts.box !== false) stow(s, newBox(opts.boxKey || "a_9mm_fmj", opts.boxN ?? 20));
  stow(s, newItem("bandagekit"));
  stow(s, newItem("frag"));
  s.location = { kind: "base", baseId: hub(state).id };
  return s;
}
function battle(state, crew) {
  const h = hub(state);
  setRounds(h.stock, 0);
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "raiders", count: 1, power: 3 }, ambush: null, canRetreat: true, handler: "paritytest", context: {} }));
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0);
  b.dark = false; b.night = false; b.jamWx = 1;
  b.phase = "player";
  return b;
}
// The same person twice: one with you, a copy of them (the same skills, traits, kit) as the enemy's.
function pair(opts = {}) {
  const st = createWorld({ seed, factionCount: 4 });
  const s = person(st, opts);
  st.survivors.push(s);
  const copy = structuredClone(s);
  const b = battle(st, [s]);
  const mine = b.units.find((u) => u.sid === s.id);
  const theirs = b.units.find((u) => u.side === "enemy");
  copy.id = 2e9 + 77; copy.transient = true; copy.location = { kind: "battle" };
  (b.people || (b.people = {}))[copy.id] = copy;
  fromPerson(st, b, theirs, copy);
  battlePerks(st, b); // skills.js: as the battle's setup does once every side is placed
  mine.x = 5; mine.y = 5; theirs.x = 15; theirs.y = 5; theirs.dead = false;
  return { st, b, s, copy, mine, theirs };
}
const FIELDS = ["aim", "meleeAim", "dmgMult", "armor", "hp", "maxHp", "mob", "sight", "ap", "weapon", "magMax", "magMode", "medicine", "kitBonus", "tough"];

section("1. The unit builder: the same person is the same fighter on either side");
{
  let mineOf = null;
  for (const opts of [{}, { weapon: "ar223", boxKey: "a_223_fmj", shooting: 12 }, { weapon: "shotgun", boxKey: "a_12ga_buck", health: 70 }]) {
    const { st, mine, theirs } = pair(opts);
    mineOf = (u) => st.survivors.find((x) => x.id === u.sid);
    const diff = FIELDS.filter((k) => JSON.stringify(mine[k]) !== JSON.stringify(theirs[k]));
    check(!diff.length, `${opts.weapon || "pistol"}: ${diff.length ? `differs in ${diff.map((k) => `${k} ${JSON.stringify(mine[k])}/${JSON.stringify(theirs[k])}`).join(", ")}` : FIELDS.join(", ") + " alike"}`);
    check(magIn(mine) === magIn(theirs) && stackN(mine.stack || []) === stackN(theirs.stack || []), `the gun loaded alike (${magIn(mine)}/${magIn(theirs)})`);
    check((mine.mags || []).length === (theirs.mags || []).length, `the same spare magazines (${(mine.mags || []).length}/${(theirs.mags || []).length})`);
    const carriedThrows = (s) => { const o = {}; for (const c of carriedSpots(s)) if (THROW_KEYS.includes(c.item.key)) o[c.item.key] = (o[c.item.key] || 0) + 1; return o; }; // yours throw what they carry (stealth.js throwablesOf)
    check(JSON.stringify(carriedThrows(mine.who || mineOf(mine))) === JSON.stringify(theirs.throwables || {}), `the same throwables (${JSON.stringify(theirs.throwables || {})})`);
    check(!!mine.medKit === !!theirs.medKit, `a medic alike (${!!mine.medKit})`);
  }
}

section("2. Physical rounds: the same reload, the same refusal, rounds that run out");
{
  const { st, b, mine, theirs } = pair({ boxN: 40 });
  const strip = (p) => { const { rounds, ...rest } = p; return { ...rest, runs: (p.runs || []).map(({ k, n, where }) => ({ k, n, where })) }; };
  for (const u of [mine, theirs]) { loadMag(u, 0); u.ap = 2; }
  const pm = strip(reloadPlan(b, mine)), pt = strip(reloadPlan(b, theirs));
  check(JSON.stringify(pm) === JSON.stringify(pt), `the reload plan from empty is the same (${pm.mode} from ${pm.from}, ${pm.cost} action${pm.cost === 1 ? "" : "s"})`);
  // Fire everything: reload until the magazines are gone; both run dry at the same count.
  const shots = (u) => {
    let n = 0;
    for (let i = 0; i < 40; i++) {
      n += magIn(u); loadMag(u, 0); u.ap = 2;
      if (reloadPlan(b, u).why) break;
      reload(b, u);
    }
    return n;
  };
  const sm = shots(mine), stt = shots(theirs);
  check(sm === stt && sm > 0 && sm < 200, `the rounds they carry run out alike (${sm} / ${stt} fired, then nothing)`);
  const wm = reloadPlan(b, mine).why, wt = reloadPlan(b, theirs).why;
  check(!!wm && !!wt, `both are refused a reload when it is gone ("${wt.slice(0, 60)}")`);
  theirs.ap = 2;
  const r = combatAct(st, { type: "reload", unit: theirs.id });
  check(theirs.ap === 2 && magIn(theirs) === 0, `the enemy's reload with nothing left: no action spent, nothing loaded (${r ? "refused" : "?"})`);
}

section("3. The rules once keyed to a side");
{
  const { st, b, mine, theirs } = pair({ weapon: "ar223", boxKey: "a_223_fmj" });
  // Caught unaware: the same bonus whichever side is caught.
  const before = [shotOdds(b, mine, theirs).chance, shotOdds(b, theirs, mine).chance];
  mine.aware = false; theirs.aware = false;
  const after = [shotOdds(b, mine, theirs).chance, shotOdds(b, theirs, mine).chance];
  mine.aware = true; theirs.aware = true;
  check(after[0] - before[0] === after[1] - before[1] && after[0] > before[0], `caught unaware: the same bonus either way (+${after[0] - before[0]} / +${after[1] - before[1]})`);
  // A flare's light: whoever shoots at a lit target.
  b.night = true; b.flares = [{ x: theirs.x, y: theirs.y, r: 6, turns: 3 }, { x: mine.x, y: mine.y, r: 6, turns: 3 }];
  const lit = [shotOdds(b, mine, theirs).chance, shotOdds(b, theirs, mine).chance];
  b.flares = []; const dark = [shotOdds(b, mine, theirs).chance, shotOdds(b, theirs, mine).chance];
  b.night = false;
  check(lit[0] - dark[0] === lit[1] - dark[1], `a flare's light helps either side alike (+${lit[0] - dark[0]} / +${lit[1] - dark[1]})`);
  // Footsteps: a dash is heard whoever runs.
  check(stepNoise(b, mine, 9, 4) === "dash" && stepNoise(b, theirs, 9, 4) === "dash", "a dash is heard on either side");
  mine.sneaking = theirs.sneaking = true;
  check(stepNoise(b, mine, 9, 4) === "" && stepNoise(b, theirs, 9, 4) === "", "sneaking is silent on either side");
  mine.sneaking = theirs.sneaking = false;
  // Hearing lost for good (when the switch is on): theirs as yours.
  const was = HEARING.PERMANENT; HEARING.PERMANENT = true;
  mine.ears = null; theirs.ears = null; mine.hearLost = theirs.hearLost = 0;
  deafen(b, mine.x, mine.y, 200, mine); deafen(b, theirs.x, theirs.y, 200, theirs);
  HEARING.PERMANENT = was;
  check(mine.hearLost > 0 && mine.hearLost === theirs.hearLost, `hearing lost for good by the same blast (${mine.hearLost} / ${theirs.hearLost})`);
  // Throwing: what they carry, counted the same way.
  check(JSON.stringify(throwablesOf(st, b, theirs)) === JSON.stringify({ frag: 1 }), `theirs throw what they carry (${JSON.stringify(throwablesOf(st, b, theirs))})`);
  // Perks and XP tallies on either side.
  check(!!mine.xpT && !!theirs.xpT, "both keep an XP tally for the fight");
  // Meds: theirs come out of what they carry, as yours come out of the team's.
  theirs.medsBag = { meds: 2 };
  check(medsOf(b, theirs) === 2, `their meds are what their bag holds (${medsOf(b, theirs)})`);
}
{
  // Downed: theirs go down and bleed as yours do; the side holding the field pulls its downed through.
  const { b, theirs } = pair();
  theirs.down = true; theirs.wounded = true; theirs.hp = 0; theirs.stab = true;
  settleFoes(b, "defeat"); // you lost: they hold the field
  check(!theirs.dead && theirs.recovered, "their stabilized downed pull through when they hold the field");
  const { b: b2, theirs: t2 } = pair();
  t2.down = true; t2.wounded = true; t2.hp = 0; t2.stab = true;
  settleFoes(b2, "victory"); // you won: a prisoner of yours
  check(!t2.dead && !t2.recovered, "your win: their stabilized downed are your prisoners");
}

section("4. Carrying and moving people: the same loads, the very people");
{
  // A nomad band's shelf is what its people carry, by your teams' rule (parties.js carryCapacity): the same two
  // people carry the same kg on either side.
  const st = createWorld({ seed, factionCount: 4 });
  st.started = true;
  const tile = hub(st).tile;
  const b = spawnNomads(st, { tier: 2, tile, pop: 2 });
  const two = [person(st), person(st)];
  b.people = two.map((s) => { s.alive = true; s.location = { kind: "band" }; return s; });
  b.stock = {}; b.wares = [];
  const yours = carryCapacity(st, two, null);
  check(Math.abs(bandRoom(st, b) - yours) < 1e-6, `two people carry ${yours} kg as your team and ${Math.round(bandRoom(st, b) * 100) / 100} kg as a nomad band`);
  b.wares.push(newItem("sledge"));
  check(Math.abs(bandRoom(st, b) - (yours - itemLoad(b.wares[0]))) < 1e-6, "what is on the shelf is carried: it takes the same room it would in your cargo");
  // A loan between groups moves the lender's very people, as yours are lent (location "lent"), and brings them back.
  const [g, l] = st.factions;
  syncMembers(st, g); syncMembers(st, l);
  const L = lendPeople(st, l, g, 2, 0, "war");
  const lent = L ? [...L.people] : [];
  check(lent.length === 2 && lent.every((s) => s.location.kind === "lent" && !l.people.includes(s)) && l.pop === l.people.length, `lent: ${lent.length} of ${l.name}'s people away from its list, as yours are lent`);
  VOL.LEND.lose = 0; VOL.LEND.stay = 0;
  loanHome(st, L, g, l);
  check(lent.every((s) => l.people.includes(s) && s.location.kind === "member" && s.fid === l.id) && l.pop === l.people.length, "back: the very same people in its list, the head count its list");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
