// The swapped-sides parity test (docs/adr/0001-ai-parity.md): the same person, built once on your side and once on
// theirs, is the same fighter; the rules below treat them alike. One section a batch.
//   1. The unit builder: aim, health, movement, sight, the gun, armour, the medic, the throwables.
//   2. Physical rounds: the same reload plan from what they carry, the same refusal when it is gone, rounds that run out.
//   3. The rules that were keyed to a side: caught unaware, a flare's light, footsteps, a gun above their skill, hearing
//      lost for good, going down and pulled through, meds, throwing what they carry, perks.
//   4. Carrying and moving people: a nomad band carries what its people can by your teams' rule; a loan between
//      groups moves the very people away and back, as yours are lent.
//   5. Your bots' repertoire on their side too: a decoy they carry thrown on the dead pressing them (and off them after),
//      a body in danger next to them crushed, neither with a foe next to them or nothing to throw.
//   6. A horde at a group's base: your base's defence step for step (spike pits, mines, bear traps, defence buildings,
//      the hold limit), the horde's losses by your rule (groupfight.js hordeAtGroup).
//   7. Packing for the job: a party through the dead takes your hive squad's flares and decoys off its own books and
//      throws them as yours do; the decoys kept at home are set out at the walls by your warning card's odds.
// Usage: node tools/paritytest.js [seed]
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { createBattle, combatAct, registerCombatHandler, reload, loadMag, magIn, enemyUnit, enemyStep } from "../src/sim/combat.js";
import { fromPerson, THROW_KEYS, spentThrows } from "../src/sim/fighters.js";
import { botDecoy } from "../src/sim/decoys.js";
import { botCrush } from "../src/sim/carriers.js";
import { DECOY_KEYS } from "../src/sim/stealth.js";
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
import { lendPeople, loanHome, VOL } from "../src/sim/volunteers.js";
import { GEAR } from "../src/sim/data.js";
import { ensureArsenal } from "../src/sim/arsenal.js";
import { ensureMembers, syncMembers } from "../src/sim/members.js";
import { homeAt } from "../src/sim/groupbases.js";
import { addBuilding, count } from "../src/sim/buildings.js";
import { defenceMult, holdLimit, spikeKill, guardHold } from "../src/sim/defences.js";
import { minesKill, minesLeft } from "../src/sim/mines.js";
import { makeHorde } from "../src/sim/hordes.js";
import { hordeAtGroup, groupHoldCheck } from "../src/sim/groupfight.js";
import { keepItem } from "../src/sim/arsenal.js";
import { kitOut, JOB } from "../src/sim/loadouts.js";
import { HIVE_KIT } from "../src/sim/kit.js";
import { spawnAiParty, planPath } from "../src/sim/parties.js";
import { allCarried } from "../src/sim/inventory.js";
import { fitThrowables } from "../src/sim/fighters.js";
import { armoryDecoys, decoyChance } from "../src/sim/defences.js";
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
  if (opts.decoy) { s.gear.backpack = newItem("slingbag"); stow(s, newItem("noisemaker")); } // the pockets are full: a bag for it
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
section("5. Your bots' repertoire, for everyone: a decoy on the dead, the crush (decoys.js botDecoy, carriers.js botCrush)");
{
  check(DECOY_KEYS.concat("flare").every((k) => THROW_KEYS.includes(k)), `a person not yours counts the decoys they carry among their throwables (${DECOY_KEYS.join(", ")}, flare)`);
  // The same person on either side with a noise maker in a pocket, four of the dead closing on each (wild: after
  // anyone living). Yours: the battle AI's call (autoPlayerTurn asks botDecoy); theirs: their own turn (aiUnit).
  const { st, b, s, copy, mine, theirs } = pair({ decoy: true });
  const deadNear = (u, n0) => { for (let i = 0; i < 4; i++) { const z = enemyUnit(b, b.rng, "zombies", 2, 60 + n0 + i); z.side = "enemy"; z.wild = true; z.aware = true; z.x = u.x + 2 + (i % 2); z.y = u.y - 1 + 2 * Math.floor(i / 2); z.ap = 0; b.units.push(z); } };
  mine.y = theirs.y = 8; mine.x = 4; theirs.x = 20;
  deadNear(mine, 0); deadNear(theirs, 10);
  const held = (p) => carriedSpots(p).filter((c) => c.item.key === "noisemaker").length;
  check(held(s) === 1 && held(copy) === 1 && (theirs.throwables || {}).noisemaker === 1, `both carry one noise maker (theirs counted: ${JSON.stringify(theirs.throwables)})`);
  mine.ap = 2;
  const threwMine = botDecoy(st, b, mine);
  const lm = (b.lures || []).find((l) => l.side === "player"), apMine = mine.ap; // (their turn ends with yours starting: full actions again)
  b.phase = "enemy"; theirs.ap = 2; theirs.aware = true; b.queue = [theirs.id];
  enemyStep(st); // combat.js aiUnit: their turn
  const lt = (b.lures || []).find((l) => l.side === "enemy");
  check(threwMine && !!lm && lm.key === "noisemaker" && apMine === 1 && held(s) === 0, `yours throws the noise maker at the dead (1 action, off their person: ${held(s)} left)`);
  check(!!lt && lt.key === "noisemaker" && (theirs.throwables || {}).noisemaker === 0 && theirs.ap <= 1, `theirs throws theirs the same way on their own turn (1 action; ${(theirs.throwables || {}).noisemaker} left)`);
  const gone = spentThrows(theirs, copy); // fighters.js: what they threw leaves them when the fight ends
  check(gone.length === 1 && gone[0].key === "noisemaker" && held(copy) === 0, "the thrown noise maker is off them after the fight, nothing more and nothing less");
  check(Math.hypot(lm.x - mine.x, lm.y - mine.y) >= 5 && Math.hypot(lt.x - theirs.x, lt.y - theirs.y) >= 5, `each lands 5+ tiles from its side's people (${Math.round(Math.hypot(lm.x - mine.x, lm.y - mine.y))} / ${Math.round(Math.hypot(lt.x - theirs.x, lt.y - theirs.y))})`);
  // Without a decoy to hand: nothing thrown, either side.
  const p2 = pair();
  p2.mine.y = p2.theirs.y = 8; p2.mine.x = 4; p2.theirs.x = 20;
  for (const u of [p2.mine, p2.theirs]) for (let i = 0; i < 4; i++) { const z = enemyUnit(p2.b, p2.b.rng, "zombies", 2, 90 + i + u.x); z.side = "enemy"; z.wild = true; z.aware = true; z.x = u.x + 2 + (i % 2); z.y = u.y - 1 + 2 * Math.floor(i / 2); p2.b.units.push(z); }
  p2.mine.ap = 2; p2.theirs.ap = 2; p2.theirs.aware = true;
  check(!botDecoy(p2.st, p2.b, p2.mine) && !botDecoy(null, p2.b, p2.theirs) && !(p2.b.lures || []).some((l) => THROW_KEYS.includes(l.key)), "no decoy carried, none thrown, on either side");
}
{
  // The crush: a body with the worm in it next to each, none of the other side next to them: each crushes its skull for
  // 1 action. Then the two stand next to each other: neither does.
  const { st, b, mine, theirs } = pair();
  mine.y = theirs.y = 8; mine.x = 4; theirs.x = 20;
  const body = (u, n) => { const c = enemyUnit(b, b.rng, "raiders", 3, 80 + n); c.x = u.x; c.y = u.y + 1; c.dead = true; c.hp = 0; c.wormed = true; b.units.push(c); return c; };
  const bm = body(mine, 0), bt = body(theirs, 1);
  mine.ap = 2;
  const act = botCrush(b, mine);
  if (act) combatAct(st, act);
  const apMine = mine.ap;
  b.phase = "enemy"; theirs.ap = 2; theirs.aware = true; b.queue = [theirs.id];
  enemyStep(st);
  check(bm.crushed && apMine === 1, `yours crushes the skull of the body next to them (1 action: ${apMine} left)`);
  check(bt.crushed && theirs.ap <= 1, `theirs crushes the one next to them on their own turn (${theirs.ap} left)`);
  const q = pair();
  q.mine.y = q.theirs.y = 8; q.mine.x = 10; q.theirs.x = 11;
  for (const [u, n] of [[q.mine, 0], [q.theirs, 1]]) { const c = enemyUnit(q.b, q.b.rng, "raiders", 3, 85 + n); c.x = u.x; c.y = u.y + 1; c.dead = true; c.hp = 0; c.wormed = true; q.b.units.push(c); }
  q.mine.ap = 2; q.theirs.ap = 2; q.theirs.aware = true;
  check(!botCrush(q.b, q.mine) && !botCrush(q.b, q.theirs), "with a foe right next to them, neither stops to crush a skull");
}
section("6. A horde at a group's base meets your base's defence: its traps and defences work, its losses are yours");
{
  // A base of yours they took and hold (groupbases.js gainBase: real, its buildings yours): two spike pits, two
  // barricades, a minefield, and two bear traps on the group's shelf (kept at its main base), against a horde.
  const st = createWorld({ seed, factionCount: 4 });
  const f = st.factions.find((x) => x.alive && x.bases.length);
  ensureArsenal(st, f); ensureMembers(st, f); syncMembers(st, f);
  const tile = f.bases[0];
  const g = homeAt(st, f, tile);
  g.real = true;
  const yours = hub(st);
  const m0 = { g: defenceMult(st, g), y: defenceMult(st, yours) };
  for (const t of ["spike_pits", "spike_pits", "barricades", "barricades", "minefield"]) { addBuilding(g, t); addBuilding(yours, t); }
  check(Math.abs((defenceMult(st, g) - m0.g) - (defenceMult(st, yours) - m0.y)) < 1e-9 && defenceMult(st, g) > m0.g, `the barricades raise their hold as they raise yours (×${m0.g.toFixed(2)} → ×${defenceMult(st, g).toFixed(2)}; yours ×${m0.y.toFixed(2)} → ×${defenceMult(st, yours).toFixed(2)})`);
  f.wares = [...(f.wares || []), newItem("beartrap"), newItem("beartrap")];
  const traps0 = f.wares.filter((it) => it.key === "beartrap").length;
  // What your base's code takes off a horde of N before the walls, and what it cuts down below walls that hold.
  const lim = holdLimit(st, g, 0);
  const N = Math.floor(lim);
  const s1 = N - spikeKill(g, N), s2 = s1 - minesKill(g, s1), s3 = s2 - Math.min(s2, traps0 * GEAR.beartrap.defence.kill);
  const want = s3 - Math.min(s3, Math.round(8 + guardHold(st, g) * 0.8 + s3 * 0.12));
  const mines0 = minesLeft(g);
  const h = makeHorde(st, { tile, size: N, role: "roam", split: true });
  const r = hordeAtGroup(st, h, f, tile);
  const left = st.hordes.includes(h) ? h.size : 0;
  check(r && r.held && r.check.tier === "wall", `a horde of ${N} against walls that stop ${Math.round(lim)}: held at the walls, as the check said (${r && r.check.tier})`);
  check(!count(g, "spike_pits") && minesLeft(g) < mines0, `their spike pits took their share and are used up, their minefield went off (${mines0} → ${minesLeft(g)} mines)`);
  check(left === (want >= 5 ? want : 0), `the horde's losses are your base's: pits ${N - s1}, mines ${s1 - s2}, traps ${s2 - s3}, then cut down below the walls: ${N} → ${left} (your rule: ${want})`);
  check(f.wares.filter((it) => it.key === "beartrap").length <= traps0, `their bear traps worn as yours are (${traps0} → ${f.wares.filter((it) => it.key === "beartrap").length})`);
  // A horde too big for the walls: the dead break in and are fought by the numbers; the horde loses no more than broke in.
  const st2 = createWorld({ seed: seed + 1, factionCount: 4 });
  const f2 = st2.factions.find((x) => x.alive && x.bases.length);
  ensureArsenal(st2, f2); ensureMembers(st2, f2); syncMembers(st2, f2);
  const t2 = f2.bases[0];
  const big = Math.round(holdLimit(st2, homeAt(st2, f2, t2), 0) * 3);
  const h2 = makeHorde(st2, { tile: t2, size: big, role: "roam", split: true });
  const c2 = groupHoldCheck(st2, f2, t2, big);
  const r2 = hordeAtGroup(st2, h2, f2, t2);
  const left2 = st2.hordes.includes(h2) ? h2.size : 0;
  check(r2 && !c2.holds && c2.through > 0 && left2 >= big - c2.through - 1 && left2 < big && (r2.held ? left2 === Math.max(0, big - c2.through) || left2 === 0 : true), `a horde of ${big}: about ${c2.through} broke in (the check said ${c2.tier}); ${r2 && r2.held ? "held inside" : "overrun"}, the horde ${big} → ${left2}`);
}

section("7. Packing for the job and the decoys at the walls: as yours are packed and set out (loadouts.js packForJob, groupfight.js hordeAtGroup)");
{
  // A party of theirs going through the dead packs the decoys and flares your hive squad packs (kit.js HIVE_KIT: two
  // flares), out of its own books; on the battle map a person of it counts the decoy among what they throw.
  check(JOB.FLARES === HIVE_KIT.flare, `the road flares a party through the dead takes are your hive squad's (${JOB.FLARES})`);
  const st = createWorld({ seed, factionCount: 4 });
  st.started = true;
  const f = st.factions.find((x) => x.alive && x.bases.length && x.pop >= 10);
  ensureArsenal(st, f); ensureMembers(st, f); syncMembers(st, f);
  for (const k of ["noisemaker", "noisemaker", "noisemaker", "alarmclock", "flare", "flare", "hikingpack", "hikingpack", "hikingpack", "hikingpack"]) keepItem(st, f, newItem(k), "test");
  for (const t of st.tiles) t.infection = 0;
  st.hordes.length = 0;
  kitOut(st, f);
  const g = st.grid, from = f.bases[0];
  const to = g.within(from, 4).find((t) => g.distance(t, from) >= 2 && st.tiles[t].terrain !== "water" && !st.factions.some((o) => o.bases.includes(t)) && planPath(st, from, t, false, f.id));
  st.tiles[to].infection = 0.9;
  const books = new Set(f.arsenal.items);
  const p = spawnAiParty(st, f, "scav", from, to, { strength: 4 });
  const go = f.people.filter((s) => s.location && s.location.partyId === p.id);
  const one = go.find((s) => allCarried(s).some((it) => DECOY_KEYS.includes(it.key)));
  const u = {};
  if (one) fitThrowables(u, one);
  check(!!one && Object.keys(u.throwables || {}).some((k) => DECOY_KEYS.includes(k)) && allCarried(one).filter((it) => DECOY_KEYS.includes(it.key) || it.key === "flare").every((it) => books.has(it)), `${one ? one.name : "nobody"} goes out with a decoy off the group's own books and throws it as yours would (${JSON.stringify(u.throwables || {})})`);
  // The decoys kept at home: the same three in your armory and on their books, a horde neither's walls can hold: the
  // same decoys set out (defences.js armoryDecoys) by the same odds (decoyChance), used up on either side.
  const st2 = createWorld({ seed, factionCount: 4 });
  const f2 = st2.factions.find((x) => x.alive && x.bases.length);
  ensureArsenal(st2, f2); ensureMembers(st2, f2); syncMembers(st2, f2);
  const yours = hub(st2);
  for (const k of ["noisemaker", "alarmclock", "pocketradio"]) { keepItem(st2, f2, newItem(k), "test"); yours.armory.push(newItem(k)); }
  const t2 = f2.bases[0];
  const big = Math.round(holdLimit(st2, homeAt(st2, f2, t2), 0) * 3);
  const h = makeHorde(st2, { tile: t2, size: big, role: "roam", split: true });
  const mineN = armoryDecoys(yours, h).length, want = decoyChance(h, mineN); // (before the fight: the odds go by the horde as it comes)
  let theirOdds = null;
  const roll = st2.rng.chance.bind(st2.rng);
  st2.rng.chance = (q) => { if (theirOdds == null) theirOdds = q; return roll(q); };
  hordeAtGroup(st2, h, f2, t2);
  st2.rng.chance = roll;
  const left = f2.arsenal.items.filter((it) => DECOY_KEYS.includes(it.key)).length;
  check(mineN === 3 && left === 0 && theirOdds != null && Math.abs(theirOdds - want) < 1e-12, `three decoys set out at their walls as on your warning card: the same odds (${Math.round(want * 100)}%; theirs ${theirOdds == null ? "none" : Math.round(theirOdds * 100) + "%"}), used up (${left} left)`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
