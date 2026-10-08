// Per-hit armour (src/sim/armour.js; plan sections 2 and 17 with the section 25 one-condition-field contract). Checks:
// the section 2 penetration table (±1%), the blunt and through multipliers, the expected multipliers (the R2 / R3
// calibration, printed), every piece's GEAR dur is its section 17 dmax, wear per hit by material, ceramic shattering,
// steel spalling, crits to the head, the soft-point bonus only where nothing is worn, the Tough trait, the old-save
// migration (quality → durability), enemy armour wearing and its loot keeping the durability left, the armoured dead's
// plateDur (wear, the multiplier, the body loot), pen against the armoured dead, by-the-numbers wear (absorbOffscreen)
// and its path through a fight by the numbers, a battle wearing the worn items themselves, a save round trip.
// Usage: node tools/armortest.js [seed]
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { createBattle, combatAct, registerCombatHandler, damage, hitMult, startCombat, autoPlayerTurn, runEnemyPhase, WEAPONS } from "../src/sim/combat.js";
import { ARMOUR, AR, armourSpec, penChance, pieceMult, armourHit, armourExpect, wearPiece, roundOf, curDur, ensureDur, armourCond, absorbOffscreen, lootArmour, enemyPieces, battleDice } from "../src/sim/armour.js";
import { armorVs, wearPlate, bodyLoot, MILDEAD } from "../src/sim/deadsoldiers.js";
import { ammoPen } from "../src/sim/data-ammo.js";
import { newItem, enemyBody, itemArmor } from "../src/sim/inventory.js";
import { GEAR } from "../src/sim/data.js";
import { Rng } from "../src/sim/rng.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
registerCombatHandler("armortest", () => {});
const r2 = (v) => Math.round(v * 100) / 100;
const fakeB = (s = 1) => ({ dseed: s, diceN: 0 });

function fighter(state, weapon = "pistol") {
  const s = makeSurvivor(state);
  s.skills.shooting = 9;
  s.traits = [];
  s.health = 100;
  s.gear.weapon = weapon ? newItem(weapon) : null;
  for (const slot of ["head", "armor", "arms", "legs", "tool"]) s.gear[slot] = null;
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}

// 1. The section 2 table.
{
  console.log("Penetration (section 2 table)");
  const rows = [
    ["9mm HP", ammoPen("9mm", "hp"), 8, [3, 3, 3]], ["9mm FMJ", ammoPen("9mm", "fmj"), 15, [25, 3, 3]], ["9mm AP", ammoPen("9mm", "ap"), 30, [97, 3, 3]],
    ["00 buck", ammoPen("12ga", "buck"), 8, [3, 3, 3]], ["slug", ammoPen("12ga", "slug"), 22, [60, 3, 3]], ["5.56 FMJ", ammoPen("556", "fmj"), 30, [97, 3, 3]],
    ["5.56 AP", ammoPen("556", "ap"), 45, [97, 75, 25]], [".308 SP", ammoPen("308", "sp"), 30, [97, 3, 3]], [".308 FMJ", ammoPen("308", "fmj"), 38, [97, 40, 3]],
    [".308 AP", ammoPen("308", "ap"), 55, [97, 97, 75]], [".50 BMG", ammoPen("50bmg", "ball"), 70, [97, 97, 97]],
  ];
  for (const [name, pen, want, [vest, steel, ceramic]] of rows) {
    const got = [penChance(pen, 2), penChance(pen, 4), penChance(pen, 5)].map((p) => Math.round(p * 100));
    check(pen === want && Math.abs(got[0] - vest) <= 1 && Math.abs(got[1] - steel) <= 1 && Math.abs(got[2] - ceramic) <= 1, `${name} (pen ${pen}): vest ${got[0]}%, steel plate ${got[1]}%, ceramic ${got[2]}% (table ${vest} / ${steel} / ${ceramic})`);
  }
  // The table's "ceramic at 40%" column (34% for pen 30, 74% for .308 FMJ) is the formula at 44% durability; at 40% the
  // formula (T = 50 × (0.4 + 0.6 × 0.4) = 32) gives 40% and 80%. The formula is what runs.
  check(Math.round(penChance(30, 5, 0.4) * 100) === 40 && Math.round(penChance(38, 5, 0.4) * 100) === 80 && Math.round(penChance(45, 5, 0.4) * 100) === 97 && Math.round(penChance(15, 5, 0.4) * 100) === 3,
    "ceramic at 40% durability: pen 30 40%, .308 FMJ 80%, 5.56 AP 97%, 9mm FMJ 3% (the table's 34 / 74 is the formula at 44%)");
  check(Math.round(penChance(30, 5, 0.44) * 100) === 34 && Math.round(penChance(38, 5, 0.44) * 100) === 74, "(at 44%: 34% and 74%, the table's figures)");
  check(AR.BLUNT[1] === 0.6 && AR.BLUNT[2] === 0.45 && AR.BLUNT[3] === 0.35 && AR.BLUNT[4] === 0.3 && AR.BLUNT[5] === 0.25 && AR.BLUNT[6] === 0.2 && AR.THRU === 0.9 && AR.THRU_HEAVY === 0.85, "stopped: blunt 0.6 / 0.45 / 0.35 / 0.3 / 0.25 / 0.2 by AC; through × 0.9 (× 0.85 at AC 4+)");
  // R2 / R3: the expected × on the torso, and over a person wearing only that (shots: torso 55%).
  const t9 = pieceMult(15, 2), t556v = pieceMult(30, 2), t556p = pieceMult(30, 5), t556s = pieceMult(30, 4);
  console.log(`    torso ×: vest vs 9mm FMJ ${r2(t9)}, vs 5.56 FMJ ${r2(t556v)}; ceramic plate vs 5.56 FMJ ${r2(t556p)}; steel plate ${r2(t556s)} (flat model: vest 0.88, plate 0.76)`);
  const body = (m) => 0.55 * m + 0.45;
  console.log(`    whole body (shots): vest vs 9mm ${r2(body(t9))}, vs 5.56 ${r2(body(t556v))}; plate vs 5.56 ${r2(body(t556p))}`);
  check(t9 < 0.6 && t556v > 0.85, "R2 / R3: a soft vest stops pistols well (×0.56 on the torso) and rifles beat it (×0.89)");
}

// 2. The pieces: AC, durability (GEAR dur = dmax), material.
{
  console.log("Pieces");
  const keys = Object.keys(ARMOUR).filter((k) => GEAR[k]);
  check(keys.every((k) => GEAR[k].dur === ARMOUR[k].dmax), `every piece's GEAR dur is its section 17 dmax (${keys.map((k) => `${k} ${GEAR[k].dur}`).join(", ")})`);
  check(armourSpec("vest").ac === 2 && armourSpec("plate").ac === 2 && armourSpec("ceramicplate").ac === 5 && armourSpec("ceramicplate").mat === "ceramic" && armourSpec("steelplate").ac === 4 && armourSpec("milhelmet").ac === 3 && armourSpec("riotarms").ac === 2, "vest AC 2, plate carrier a soft AC 2 backer with a ceramic AC 5 (steel AC 4) plate, combat helmet AC 3, riot arm guards AC 2");
  check(["head", "armor", "arms", "legs"].every((slot) => Object.keys(GEAR).filter((k) => GEAR[k].slot === slot && GEAR[k].cat === "armor").every((k) => armourSpec(k))), "every armour piece in GEAR has an AC");
  // Old saves: an armour item with no dur counts dmax × quality, written once.
  const old = { key: "vest", name: "Kevlar vest", quality: 0.5 };
  check(curDur(old) === 20 && armourCond(old) === 0.5 && ensureDur(old).dur === 20, "migration: an old vest at quality 0.5 is 20 of 40 points");
  check(Math.abs(itemArmor(old) - GEAR.vest.power * 0.75) < 1e-9 && itemArmor(Object.assign(newItem("vest"), { dur: 0 })) === 0, "the flat model reads the same condition (a broken piece: nothing)");
}

// 3. One hit: wear, shatter, spall, location, crits, soft points, Tough.
{
  console.log("Hits");
  const vest = newItem("vest");
  const r = roundOf({ weapon: "ar" }, { how: "shot" });
  check(r.cal === "556" && r.type === "fmj" && r.pen === 30 && r.ad === 0.8, "an assault rifle's common round: 5.56 FMJ, pen 30, armour wear 0.8");
  wearPiece(vest, 30, r, false);
  check(vest.dur === 40 - 2 && Math.abs(vest.chip - 0.4) < 1e-9, `stopped: 30 raw × 0.8 × soft 1 / 10 = 2.4 points (dur ${vest.dur}, chip ${vest.chip})`);
  wearPiece(vest, 30, r, true);
  check(Math.abs(curDur(vest) - 36.4) < 1e-9, `through: half (1.2): 40 − 3.6 = 36.4 points (dur ${vest.dur}, chip ${vest.chip})`);
  const bite = roundOf({ weapon: "claws", kind: "zombie" }, { how: "melee" });
  const helm = newItem("milhelmet");
  wearPiece(helm, 20, bite, false);
  check(bite.ad === "bite" && Math.abs(curDur(helm) - (30 - 20 * 0.2 * 0.8 / 10)) < 1e-9, "teeth on a hard helmet wear it at 0.2 × hard 0.8");
  // Ceramic: 6 hits of pen 30+ shatter it; pistol rounds never do.
  const plate = newItem("ceramicplate"); // the carrier's insert (wave 2: the carrier holds the plates, section 16)
  let n = 0;
  while (!plate.shattered && n < 20) { wearPiece(plate, 10, r, false); n++; }
  check(plate.shattered && n === 6 && plate.dur === 0, `a ceramic plate shatters after ${n} hits of pen 30+`);
  const plate2 = newItem("ceramicplate");
  plate2.dur = 13;
  wearPiece(plate2, 5, r, false);
  check(plate2.shattered, "or at once under 30% of its points (a pen 30 hit)");
  const plate3 = newItem("ceramicplate");
  const p9 = roundOf({ weapon: "pistol" }, { how: "shot" });
  for (let i = 0; i < 12; i++) wearPiece(plate3, 18, p9, false);
  check(!plate3.shattered && plate3.dur > 0, `pistol rounds wear it but never shatter it (${plate3.dur} of 45 after 12)`);
  // The battle unit: location rolls, crits on the head, soft points, steel spall, Tough.
  const b = fakeB(seed);
  const t = { name: "T", kind: "human", side: "enemy", tough: 1, pieces: { torso: newItem("scrapvest"), head: newItem("milhelmet"), arms: null, legs: null } };
  const hr = { weapon: "huntrifle" };
  const locs = { torso: 0, head: 0, arms: 0, legs: 0 };
  let spall = 0, stopped = 0;
  for (let i = 0; i < 6000; i++) {
    t.pieces.torso = newItem("scrapvest"); t.pieces.head = newItem("milhelmet");
    const A = armourHit(b, t, 30, hr, { how: "shot", crit: false });
    locs[A.loc]++;
    if (A.loc === "torso" && !A.through) { stopped++; if (A.extra) spall++; }
  }
  check(Math.abs(locs.torso / 6000 - 0.55) < 0.03 && Math.abs(locs.head / 6000 - 0.15) < 0.02 && Math.abs(locs.arms / 6000 - 0.15) < 0.02, `shots land torso ${locs.torso} / head ${locs.head} / arms ${locs.arms} / legs ${locs.legs} of 6000 (55 / 15 / 15 / 15)`);
  check(stopped > 300 && Math.abs(spall / stopped - 0.3) < 0.05, `a stopped .308 on steel spalls ${Math.round((spall / stopped) * 100)}% of the time (30%)`);
  const crit = armourHit(b, t, 30, hr, { how: "shot", crit: true });
  check(crit.loc === "head", "a critical hit lands on the head");
  const naked = { name: "N", kind: "human", side: "enemy", tough: 1, pieces: { torso: null, head: null, arms: null, legs: null } };
  const hpRound = armourHit(b, naked, 20, { weapon: "pistol", load: "hp" }, { how: "shot", crit: false });
  const fmjRound = armourHit(b, naked, 20, { weapon: "pistol" }, { how: "shot", crit: false });
  check(Math.abs(hpRound.mult - 1.2) < 1e-9 && fmjRound.mult === 1, "hollow points: × 1.2 where nothing is worn; common rounds × 1");
  const vested = { name: "V", kind: "human", side: "enemy", tough: 1, pieces: { torso: newItem("vest"), head: null, arms: null, legs: null } };
  let hpOnVest = 0;
  for (let i = 0; i < 400; i++) { vested.pieces.torso = newItem("vest"); const A = armourHit(b, vested, 20, { weapon: "pistol", load: "hp" }, { how: "shot", crit: false }); if (A.loc === "torso" && A.mult > 1) hpOnVest++; }
  check(hpOnVest === 0, "and no bonus on a location that is covered");
  const tough = { name: "Tg", kind: "human", side: "player", tough: AR.TOUGH, pieces: { torso: null, head: null, arms: null, legs: null } };
  check(armourHit(b, tough, 20, { weapon: "pistol" }, { how: "shot" }).mult === 0.75, "the Tough trait stays × 0.75");
  vested.pieces.torso = newItem("vest");
  check(Math.abs(armourExpect(vested, { weapon: "pistol" }, { how: "shot" }) - (0.55 * pieceMult(15, 2, 1) + 0.45)) < 1e-9, "the AI's expected × is the location-weighted mean");
}

// 4. In a battle: your worn items wear, a broken piece is gone after the fight; enemies' armour wears and the loot keeps it.
{
  console.log("Battles");
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st, "pistol");
  a.gear.armor = newItem("vest"); a.gear.head = newItem("bikehelmet");
  const h = hub(st);
  h.stock.ammo = 100;
  const b = (st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: [a.id], enemy: { kind: "soldiers", count: 2, power: 5 }, ambush: null, canRetreat: true, handler: "armortest", context: {} }));
  const p = b.units.find((u) => u.sid === a.id);
  check(p.pieces.torso === a.gear.armor && p.pieces.head === a.gear.head && p.tough === 1, "your unit's pieces are the worn items themselves");
  const e = b.units.find((u) => u.side === "enemy" && u.kind === "human" && u.armorKey);
  const shooter = b.units.find((u) => u.side === "enemy" && u !== e) || e;
  p.hp = p.maxHp = 100000;
  const vd = curDur(a.gear.armor);
  for (let i = 0; i < 30; i++) damage(b, p, 25, shooter, false, { how: "shot", crit: false });
  check(curDur(a.gear.armor) < vd, `30 hits wear the vest (${vd} → ${r2(curDur(a.gear.armor))})`);
  a.gear.head.dur = 1;
  for (let i = 0; i < 40 && a.gear.head.dur > 0; i++) damage(b, p, 30, shooter, false, { how: "shot", crit: true });
  check(a.gear.head.dur === 0 && b.log.some((l) => /helmet is broken/.test(l.text)), "a helmet worn through breaks (logged)");
  // An enemy's armour wears; their body keeps the durability left.
  if (e) {
    e.hp = e.maxHp = 100000;
    const worn = (t) => curDur(t) + (t.inserts ? Object.values(t.inserts).reduce((a, x) => a + (x ? curDur(x) : 0), 0) : 0); // a carrier: its plates take the hits first
    const d0 = worn(e.pieces.torso);
    for (let i = 0; i < 10; i++) damage(b, e, 25, p, false, { how: "shot", crit: false });
    const d1 = e.pieces.torso.dur;
    check(e.pieces.torso.key === e.armorKey && worn(e.pieces.torso) < d0, `an enemy's ${e.armorKey} wears (${d0} → ${r2(worn(e.pieces.torso))})`);
    if (e.pieces.torso.shattered) { const body = enemyBody(new Rng(seed), e, null); check(!body.gear.armor, "a shattered plate is not looted"); }
    else { const body = enemyBody(new Rng(seed), e, null); check(body.gear.armor && body.gear.armor.dur === Math.min(d1, GEAR[e.armorKey].dur), `their body's ${e.armorKey} has the ${d1} points left`); }
  } else check(false, "a soldier with armour to test");
  // The battle ends: the broken helmet is gone, the vest kept with its wear.
  for (const u of b.units) if (u.side === "enemy") { u.dead = true; u.hp = 0; }
  p.ap = 2;
  combatAct(st, { type: "hunker", unit: p.id });
  check(b.over && !a.gear.head && a.gear.armor && a.gear.armor.dur < 40, `after the fight the broken helmet is gone, the vest kept at ${a.gear.armor && a.gear.armor.dur}`);
  // Save round trip of the wear fields.
  const st2 = createWorld({ seed: seed + 1, factionCount: 4 });
  const s2 = fighter(st2);
  s2.gear.armor = Object.assign(newItem("plate"), { dur: 31, chip: 0.4, hits30: 2 });
  const back = loadFromString(saveToString(st2)).survivors.find((x) => x.id === s2.id);
  check(back.gear.armor.dur === 31 && back.gear.armor.chip === 0.4 && back.gear.armor.hits30 === 2, "a save keeps a piece's durability, chip and hit count");
}

// 5. The armoured dead: pen against their plates, plateDur wear, body loot.
{
  console.log("The armoured dead");
  const sol = { ztype: "soldier", kind: "zombie", armor: 1 };
  const me = { weapon: "pistol", kind: "human" };
  const vs = (load, dur = 1) => { sol.plateDur = dur; return armorVs(sol, { ...me, load }, { how: "shot", crit: false }); };
  check(vs(null) === 0.5 && Math.abs(vs("hp") - 0.413) < 0.001 && vs("ap") > 0.6, `a dead soldier vs the 9mm: FMJ ${vs(null)}, HP ${vs("hp")}, AP ${vs("ap")} (section 2: 0.5 / 0.41 / AP better)`);
  check(vs(null, 0.25) > vs(null, 1) && Math.abs(vs(null, 0.25) - (1 - 0.5 * 0.5)) < 1e-9, `worn plates let more through: plateDur 0.25 → × ${vs(null, 0.25)}`);
  check(armorVs(sol, me, { how: "shot", crit: true }) === 1, "crits still ignore their armour");
  sol.plateDur = 1;
  wearPlate(sol, { weapon: "ar" }, { how: "shot", crit: false }, 30);
  check(sol.plateDur < 1 && Math.abs(sol.plateDur - (1 - (30 * 0.8 * 1.3) / 10 / MILDEAD.PLATE.soldier.dmax)) < 0.002, `a rifle hit wears a dead soldier's plates (plateDur ${sol.plateDur})`);
  check(armorVs({ ztype: "soldier", armor: 1 }, { weapon: "amr" }, { how: "shot" }) === 1 || !WEAPONS.amr, "the .50 goes through (by calibre: 1)");
  // Body loot: the plate's durability × plateDur, the rest of the loot unchanged (the same dice).
  const lootAt = (dur) => bodyLoot(new Rng(seed + 3), "soldier", newItem, dur);
  let found = null;
  for (let s = 0; s < 200 && !found; s++) { const L = bodyLoot(new Rng(s), "soldier", newItem, null); const arm = L.gear.find((it) => it.key === "plate" || it.key === "vest"); if (arm) found = s; }
  const full = bodyLoot(new Rng(found), "soldier", newItem, null), half = bodyLoot(new Rng(found), "soldier", newItem, 0.5);
  const fa = full.gear.find((it) => it.key === "plate" || it.key === "vest"), ha = half.gear.find((it) => it.key === "plate" || it.key === "vest");
  check(fa && ha && ha.dur === Math.max(1, Math.round(fa.dur * 0.5)) && full.gear.length === half.gear.length && lootAt(1).gear.length === lootAt(0.2).gear.length, `a dead soldier's body armour comes off as worn as its plates (${fa && fa.dur} → ${ha && ha.dur} at plateDur 0.5)`);
}

// 6. By the numbers: absorbOffscreen, and a fight by the numbers wearing the armour.
{
  console.log("By the numbers");
  const st = createWorld({ seed: seed + 2, factionCount: 4 });
  const s = fighter(st);
  s.gear.armor = newItem("vest"); s.gear.head = newItem("milhelmet");
  const lost = absorbOffscreen(s, 40, "raiders", st);
  const want = 40 * AR.OFFSCREEN * AR.KIND_AD.raiders;
  check(Math.abs(lost - want * (0.55 + 0.15)) < 1e-6 && Math.abs(curDur(s.gear.armor) - (40 - want * 0.55)) < 1e-6, `a 40-point wound from raiders wears the vest ${r2(want * 0.55)} and the helmet ${r2(want * 0.15)} (dmg × 0.6 × 0.55 by location)`);
  s.gear.head.dur = 1;
  absorbOffscreen(s, 80, "soldiers", st);
  check(!s.gear.head, "a piece worn through by the numbers is gone");
  const zs = fighter(st);
  zs.gear.armor = newItem("vest");
  absorbOffscreen(zs, 40, "zombies", st);
  check(Math.abs(curDur(zs.gear.armor) - (40 - 40 * 0.6 * 0.8 * 0.4)) < 1e-6, "bites wear soft armour at 0.8 (torso 40% of bites)");
  // The path: finishCombat of a fight by the numbers (autoResolveCombat → breakoff.js fightByNumbers).
  let worn = false, tries = 0;
  for (let i = 0; i < 20 && !worn; i++) {
    const w = createWorld({ seed: seed + 100 + i, factionCount: 4 });
    const h = hub(w);
    const crew = [fighter(w, "pistol"), fighter(w, "pistol")];
    for (const c of crew) c.gear.armor = newItem("vest");
    h.stock.ammo = 50;
    startCombat(w, { tile: h.tile, baseId: h.id, fighterIds: crew.map((c) => c.id), enemy: { kind: "raiders", count: 5, power: 6 }, ambush: null, canRetreat: true, handler: "armortest", context: {} });
    tries++;
    worn = crew.some((c) => !c.alive || !c.gear.armor || c.gear.armor.dur < 40);
  }
  check(worn, `a fight by the numbers wears the armour of the hurt (within ${tries} fights)`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
