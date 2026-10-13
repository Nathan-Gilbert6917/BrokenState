// The Melee skill (data.js SKILLS; world.js MELEE_SKILL, fillMelee; appearance.js meleeStart; combat.js playerUnit,
// meleeOdds; stealth.js subdueOdds; skills.js melee perks and XP; save.js): it exists everywhere a skill shows, it is
// rolled with dice of its own, higher Melee wins more melee fights (paired seeds: the same battle dice for both), old
// saves get it on load (deterministic, no perk windfall), volunteers and recruits have it, backgrounds bump it on a die
// of their own, and battles and fights by the numbers train it. Knives and swords (data-blades.js, blades.js): all of
// them in GEAR and WEAPONS, quick knives and slow swords, cheap folders, where they turn up, who carries them, the
// picker, crafting, and they scale with Melee (prints their table).
// Usage: node tools/meleeskilltest.js [seed]
import { readFileSync } from "node:fs";
import { createWorld, makeSurvivor, hub, skill, combatPower, MELEE_SKILL, meleeArmed, fillMelee } from "../src/sim/world.js";
import { SKILLS, SKILL_NAMES, ROLLED_SKILLS, GEAR } from "../src/sim/data.js";
import { createBattle, combatAct, registerCombatHandler, meleeOdds, playerUnit, WEAPONS, KITS } from "../src/sim/combat.js";
import { subdueOdds } from "../src/sim/stealth.js";
import { PERK_TREE, PERKS, battleXp, fightXp, ensureSkills, pendingPerks } from "../src/sim/skills.js";
import { meleeStart, meleeOldSave } from "../src/sim/appearance.js";
import { applyArchetype, HC_START } from "../src/sim/hardcore-start.js";
import { makeVolunteer } from "../src/sim/volunteers.js";
import { skillsCost, itemPoints } from "../src/sim/custompoints.js";
import { newItem } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { Rng } from "../src/sim/rng.js";
import { BLADE_GEAR, BLADE_LOOK, BLADES_HELP } from "../src/sim/data-blades.js";
import { rollBladeFind, rollAreaBlade, bladeWares, scavBlade } from "../src/sim/blades.js";
import { ITEM_TAGS } from "../src/sim/loot.js";
import { CRAFTS } from "../src/sim/crafting.js";
import { slotChoices } from "../src/sim/startgear.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
registerCombatHandler("meleeskilltest", () => {});
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

function fighter(state, weapon, melee) {
  const s = makeSurvivor(state);
  s.skills.melee = melee;
  s.traits = [];
  s.perks = [];
  s.health = 100;
  s.gear.weapon = weapon ? newItem(weapon) : null;
  for (const slot of ["head", "armor", "arms", "legs", "tool"]) s.gear[slot] = null;
  s.pockets = [null, null, null, null];
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
function openBattle(state, crew, enemy = { kind: "zombies", count: 1, power: 3 }) {
  const h = hub(state);
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy, ambush: null, canRetreat: true, handler: "meleeskilltest", context: {} }));
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0);
  b.reach.fill(1);
  b.dark = false; b.night = false;
  b.phase = "player";
  for (const u of b.units) if (u.side === "enemy") { u.aware = true; u.x = -10; u.y = -10; u.dead = true; }
  for (const u of b.units) if (u.side === "player") { u.x = -20; u.y = -20; }
  return b;
}
const by = (b, s) => b.units.find((u) => u.sid === s.id);
const foe = (b) => b.units.find((u) => u.side === "enemy");
const place = (u, x, y) => { u.x = x; u.y = y; u.dead = false; u.down = false; };

// ---------- the skill everywhere ----------
console.log("The skill everywhere");
{
  // Cooking (ac1c1c6) came after it and is last now: Melee is next to last, after every older skill (data.js SKILLS).
  check(SKILLS.includes("melee") && SKILLS.slice(-2).join() === "melee,cooking" && SKILL_NAMES.melee === "Melee", "Melee is a skill (after the older ones in SKILLS, only Cooking after it: older dice loops draw as they did), named Melee");
  check(!ROLLED_SKILLS.includes("melee") && ROLLED_SKILLS.length === 9, "not rolled with the world's dice (the nine older skills are)");
  check(PERK_TREE.melee && [5, 10, 15].every((ms) => PERK_TREE.melee[ms] && PERK_TREE.melee[ms].length === 2), "two perks at Melee 5, 10 and 15");
  check(["heavyhands", "parry", "butcher", "knockout", "bonebreaker", "pitfighter"].every((id) => PERKS[id] && PERKS[id].skill === "melee"), "the six melee perks are indexed under Melee");
  const melee = Object.entries(GEAR).filter(([, d]) => d.slot === "weapon" && d.cat === "melee");
  check(melee.length > 10 && melee.every(([, d]) => d.skill === "melee"), `every melee weapon goes by Melee (${melee.length})`);
  check(Object.values(GEAR).filter((d) => d.slot === "weapon" && d.cat !== "melee" && d.skill === "melee").length === 0, "no gun goes by Melee");
  check(/melee: "Melee"/.test(src("ui/roster.js")) && /melee: "Melee"/.test(src("ui/ui.js")) && /melee: "Mel"/.test(src("ui/teamform.js")), "short labels: the roster, crew lists, team forming");
  check(/SKILLS\.map/.test(src("ui/newgame.js")) && /SKILLS\.map/.test(src("ui/backgrounds.js")) && /SKILLS\.map/.test(src("ui/skills.js")), "the crew card, the background editor and the skills panel go over SKILLS");
  check(/The Melee skill/.test(src("sim/data-guns.js")), "the Help topic (Guns and melee weapons) explains it");
  check(skillsCost({ melee: 10 }) === 10, "Customize prices it like any skill");
}

// ---------- rolled with its own dice ----------
console.log("Rolled with its own dice");
{
  const st = createWorld({ seed, factionCount: 4 });
  check(st.survivors.every((s) => Number.isFinite(s.skills.melee)), "the starting six have Melee");
  const n = (st.peopleMade || 0) + 1;
  const s = makeSurvivor(st, 0.9);
  check(s.skills.melee === meleeStart(st.seed, n, 0.9), "a new survivor's Melee is meleeStart's (seed + people made), not the world's dice");
  let sum = 0, sh = 0;
  for (let i = 0; i < 600; i++) { const x = makeSurvivor(st); sum += x.skills.melee; sh += x.skills.shooting; }
  const avg = sum / 600, avgSh = sh / 600;
  check(Math.abs(avg - avgSh) < 1, `rolled about like the others: average Melee ${avg.toFixed(2)}, Shooting ${avgSh.toFixed(2)}`);
  check(Math.abs(avg - MELEE_SKILL.MID) < 1.5, `the average colonist (${avg.toFixed(2)}) is about MID (${MELEE_SKILL.MID}): melee fights as before`);
  // Two worlds of one seed: identical people, Melee included.
  const a = createWorld({ seed: seed + 1, factionCount: 4 }), b = createWorld({ seed: seed + 1, factionCount: 4 });
  check(JSON.stringify(a.survivors.map((x) => x.skills)) === JSON.stringify(b.survivors.map((x) => x.skills)) && a.rng.state === b.rng.state, "the same seed makes the same people and leaves the world's dice in the same place");
}

// ---------- backgrounds ----------
console.log("Backgrounds");
{
  const st = createWorld({ seed, factionCount: 4 });
  const s1 = makeSurvivor(st), s2 = JSON.parse(JSON.stringify(s1));
  const r0 = st.rng.state;
  applyArchetype(st, s1, "bluecollar");
  const used = st.rng.state;
  st.rng.state = r0;
  const A = HC_START.ARCHETYPES.bluecollar, keep = A.skills;
  A.skills = Object.fromEntries(Object.entries(keep).filter(([k]) => k !== "melee"));
  applyArchetype(st, s2, "bluecollar");
  A.skills = keep;
  check(used === st.rng.state, "a background's Melee bump draws none of the world's dice");
  const up = s1.skills.melee - s2.skills.melee;
  check(up >= keep.melee[0] && up <= keep.melee[1] && SKILLS.filter((k) => k !== "melee").every((k) => s1.skills[k] === s2.skills[k]), `the blue-collar worker's Melee +${up} (${keep.melee.join("-")}), the rest as without it`);
  check(["veteran", "cop", "bluecollar"].every((k) => HC_START.ARCHETYPES[k].skills.melee) && !HC_START.ARCHETYPES.nurse.skills.melee, "the veteran, the cop and the blue-collar worker bump Melee; the nurse does not");
}

// ---------- higher Melee wins more melee fights (paired seeds) ----------
console.log("Higher Melee wins more melee fights");
{
  const st = createWorld({ seed, factionCount: 4 });
  const lo = fighter(st, "machete", 1), mid = fighter(st, "machete", 5), hi = fighter(st, "machete", 15);
  const b = openBattle(st, [lo, mid, hi]);
  const z = foe(b);
  const odds = (s) => { const u = by(b, s); place(u, 5, 5); place(z, 6, 5); return meleeOdds(b, u, z); };
  const oL = odds(lo), oM = odds(mid), oH = odds(hi);
  console.log(`  machete vs a zombie: Melee 1 ${oL.chance}% ${oL.dmg.join("-")}, Melee 5 ${oM.chance}% ${oM.dmg.join("-")}, Melee 15 ${oH.chance}% ${oH.dmg.join("-")}`);
  check(oL.chance < oM.chance && oM.chance < oH.chance, "to hit rises with Melee");
  check(oL.dmg[1] < oM.dmg[1] && oM.dmg[1] < oH.dmg[1], "damage rises with Melee");
  check(oM.chance === 75 && by(b, mid).meleeAim === 75, "Melee 5 (MID) strikes at 75%, as everyone did before the skill");
  const tLo = subdueOdds(b, by(b, lo), z), tHi = subdueOdds(b, by(b, hi), z);
  check(tHi.chance > tLo.chance, `blows and takedowns too (${tLo.chance}% → ${tHi.chance}%)`);
  // Paired seeds: each fighter alone against the same zombie with the same battle dice for 6 strikes; who does more
  // damage (a 90-health zombie: who would have put it down first). The zombie never falls here (the battle would end).
  const bout = (s, k) => {
    const u = by(b, s);
    [lo, mid, hi].forEach((o, i) => place(by(b, o), 1, 1 + 2 * i));
    place(u, 5, 5); place(z, 6, 5); z.hp = z.maxHp = 100000; z.staggered = 0; z.bleeding = 0;
    b.rng = new Rng(9000 + k);
    let n = 0, downAt = 0;
    for (let i = 0; i < 6; i++) { b.phase = "player"; u.ap = 2; u.struck = null; combatAct(st, { type: "melee", unit: u.id, target: z.id }); n++; if (!downAt && 100000 - z.hp >= 90) downAt = n; }
    return { dmg: 100000 - z.hp, downAt: downAt || 99 };
  };
  let wins = 0, losses = 0, dLo = 0, dHi = 0, dMid = 0;
  for (let k = 0; k < 60; k++) {
    const a = bout(lo, k), c = bout(hi, k);
    dMid += bout(mid, k).dmg;
    dLo += a.dmg; dHi += c.dmg;
    if (c.downAt < a.downAt || (c.downAt === a.downAt && c.dmg > a.dmg)) wins++; else if (a.downAt < c.downAt || a.dmg > c.dmg) losses++;
  }
  console.log(`  60 paired bouts of 6 strikes: Melee 15 wins ${wins}, Melee 1 wins ${losses}; damage ${(dLo / 60).toFixed(0)} (Melee 1), ${(dMid / 60).toFixed(0)} (Melee 5), ${(dHi / 60).toFixed(0)} (Melee 15)`);
  check(wins > losses * 2 && dLo < dMid && dMid < dHi, "higher Melee wins more melee fights");
}

// ---------- XP ----------
console.log("Training");
{
  const st = createWorld({ seed, factionCount: 4 });
  const s = fighter(st, "machete", 3);
  ensureSkills(st, s);
  const b = openBattle(st, [s]);
  const u = by(b, s), z = foe(b);
  place(u, 5, 5); place(z, 6, 5); z.hp = z.maxHp = 100000;
  const xp0 = (s.xp.melee || 0) + s.skills.melee * 1000, sh0 = (s.xp.shooting || 0) + s.skills.shooting * 1000;
  for (let i = 0; i < 6; i++) { b.phase = "player"; u.ap = 2; combatAct(st, { type: "melee", unit: u.id, target: z.id }); }
  check(u.xpT && u.xpT.swings === 6, "every swing is counted");
  battleXp(st, b);
  check((s.xp.melee || 0) + s.skills.melee * 1000 > xp0 && (s.xp.shooting || 0) + s.skills.shooting * 1000 === sh0, "a melee fight trains Melee, not Shooting");
  const g = fighter(st, "pistol", 3); ensureSkills(st, g);
  const m0 = (s.xp.melee || 0), gs0 = (g.xp.shooting || 0), gm0 = (g.xp.melee || 0);
  st.day = (st.day || 1) + 1;
  fightXp(st, [s, g], true);
  check(meleeArmed(s) && !meleeArmed(g), "a machete is a melee weapon, a pistol is not");
  check(((s.xp.melee || 0) > m0 || s.skills.melee > 3) && (g.xp.shooting || 0) > gs0 && (g.xp.melee || 0) === gm0, "by the numbers: the machete trains Melee, the pistol Shooting");
  // Fighting strength: a melee wielder counts Melee, a gunman Shooting.
  const a = fighter(st, "machete", 2), c = fighter(st, "machete", 14);
  a.skills.shooting = c.skills.shooting = 5;
  check(combatPower(c) > combatPower(a), `a machete's fighting strength by Melee (${combatPower(a).toFixed(2)} → ${combatPower(c).toFixed(2)})`);
  const p1 = fighter(st, "pistol", 2), p2 = fighter(st, "pistol", 14);
  p1.skills.shooting = p2.skills.shooting = 5;
  check(Math.abs(combatPower(p1) - combatPower(p2)) < 1e-9, "a pistol's does not care for Melee");
}

// ---------- old saves ----------
console.log("Old saves");
{
  const st = createWorld({ seed, factionCount: 4 });
  for (const s of st.survivors) ensureSkills(st, s);
  const want = {};
  for (const s of st.survivors) {
    delete s.skills.melee;
    if (s.skillFloor) delete s.skillFloor.melee;
    delete s.perkMs.melee;
    s.perkPending = (s.perkPending || []).filter((p) => p.skill !== "melee");
    s.xpLast && delete s.xpLast.melee;
    want[s.id] = meleeOldSave(s.name, s.skills.shooting);
  }
  const old = st.survivors[0];
  check(skill(old, "melee") === want[old.id], "before the load: skill() already reads the same value");
  const back = loadFromString(saveToString(st));
  check(back.survivors.every((s) => s.skills.melee === want[s.id] && s.skillFloor.melee === want[s.id]), "on load: Melee from Shooting and the name (deterministic), the floor too");
  const again = loadFromString(saveToString(st));
  check(again.survivors.every((s, i) => s.skills.melee === back.survivors[i].skills.melee), "the same on every load");
  check(back.survivors.every((s) => !pendingPerks(s).some((p) => p.skill === "melee")), "no perk points for milestones it starts past");
  const hi = { id: 4242, name: "Old Hand", skills: { shooting: 20 }, perkMs: {}, skillFloor: { shooting: 20 } };
  fillMelee(hi);
  check(hi.skills.melee >= 10 && hi.perkMs.melee >= 10, `someone well past a milestone (${hi.skills.melee}) has it marked passed (${hi.perkMs.melee})`);
  const avg = st.survivors.reduce((a, s) => a + want[s.id], 0) / st.survivors.length;
  check(avg > 2 && avg < 10, `old-save values about a colonist's (${avg.toFixed(1)})`);
}

// ---------- the other side: volunteers and recruits ----------
console.log("Volunteers and the AI side");
{
  const st = createWorld({ seed, factionCount: 6 });
  const f = st.factions.find((x) => x.type === "zealot") || st.factions[0];
  let v = null;
  try { v = makeVolunteer(st, f, { id: 1, mission: "help", label: "help", days: 3, partyId: 0 }, null, 0); } catch (e) { console.log(`  (makeVolunteer: ${e.message})`); }
  check(!!v && Number.isFinite(v.skills.melee), `a volunteer (${f.type}) has Melee ${v ? v.skills.melee : "?"}`);
  if (v) {
    v.location = { kind: "base", baseId: hub(st).id };
    st.survivors.push(v);
    const b = openBattle(st, [v]);
    const u = playerUnit(b, v);
    check(u.meleeAim >= 75 + (skill(v, "melee") - MELEE_SKILL.MID) * MELEE_SKILL.AIM - 20 && Number.isFinite(u.meleeDmg), "and fights by the same melee rule as your people (playerUnit)");
  }
  const r = makeSurvivor(st, 0.8);
  check(Number.isFinite(r.skills.melee), "recruits, prisoners, wanderers (makeSurvivor) have it");
}

// ---------- knives and swords (data-blades.js, blades.js) ----------
console.log("Knives and swords");
{
  const keys = Object.keys(BLADE_GEAR);
  check(keys.length >= 14, `${keys.length} new blades`);
  check(keys.every((k) => GEAR[k] && WEAPONS[k] && WEAPONS[k].melee && GEAR[k].cat === "melee" && GEAR[k].skill === "melee" && GEAR[k].noise === 0 && GEAR[k].dur > 0 && GEAR[k].value > 0 && GEAR[k].slot === "weapon"), "each is a silent melee weapon by Melee, with a value and a durability, in GEAR and WEAPONS");
  const swords = ["cutlass", "sabre", "broadsword"];
  const knives = keys.filter((k) => !swords.includes(k));
  check(knives.filter((k) => k !== "cleaver").every((k) => WEAPONS[k].quick) && swords.every((k) => !WEAPONS[k].quick && GEAR[k].req > 0), "knives are quick (the cleaver chops), swords are not and want some Melee");
  const avg = (k) => (WEAPONS[k].dmg[0] + WEAPONS[k].dmg[1]) / 2;
  const small = ["pocketknife", "flipknife", "lockback", "multitool", "boxcutter", "balisong", "steakknife", "filletknife"], fixed = ["huntknife", "survivalknife", "bowie", "bayonet"];
  check(Math.max(...small.map(avg)) < Math.min(...fixed.map(avg)) && Math.max(...fixed.map(avg)) < Math.min(...swords.map(avg)), "folders and kitchen knives < fixed blades < swords");
  const pts = Object.fromEntries(keys.map((k) => [k, itemPoints(k)]));
  const cheap = ["pocketknife", "flipknife", "steakknife", "boxcutter", "shiv"];
  check(cheap.every((k) => pts[k] <= 2), `everyday knives are cheap under Customize (${cheap.map((k) => `${k} ${pts[k]}`).join(", ")})`);
  check(keys.every((k) => slotChoices("weapon").includes(k)), "all in the new-run gear picker (startgear.js slotChoices)");
  check(keys.every((k) => ITEM_TAGS[k] && BLADE_LOOK[k]), "each has theme tags and a look (sprites)");
  check(CRAFTS.shiv && CRAFTS.shiv.gear === "shiv" && CRAFTS.shiv.field && CRAFTS.bowie && CRAFTS.bowie.needs === "workshop", "a shiv made anywhere, a Bowie knife forged at a workshop");
  check(["raiders", "survivors", "soldiers", "zealots"].every((k) => KITS[k].loot.some((x) => keys.includes(x))), "raiders, survivors, soldiers and zealots carry them (their bodies)");
  check(/Knives and swords/.test(src("ui/help.js")) && /Everyday knives/.test(BLADES_HELP), "the Help topic");
  // Found: a town's search hours, a kitchen's containers, a trader's table; an AI group's scavengers.
  const st = createWorld({ seed, factionCount: 4 });
  const town = st.tiles.findIndex((t) => t && t.loc && t.loc.type === "town");
  const found = new Set();
  let n = 0;
  if (town >= 0) for (let h = 0; h < 4000; h++) { st.hour = h; const it = rollBladeFind(st, town, 1, "t"); if (it) { n++; found.add(it.key); } }
  check(town >= 0 && n > 50 && found.size >= 6, `a town's search hours turn them up (${n} in 4000 hours: ${[...found].join(", ")})`);
  let kit = 0;
  for (let i = 0; i < 500; i++) if (rollAreaBlade(st, town, "kitchen", `k${i}`)) kit++;
  check(kit > 15, `kitchen drawers in a raid (${kit} of 500)`);
  let wares = 0;
  for (let i = 0; i < 300; i++) wares += bladeWares(st, "traders", `T${i}`).length;
  check(wares > 50, `on traders' tables (${wares} of 300)`);
  let scav = 0;
  for (let i = 0; i < 400; i++) if (scavBlade("town", [st.seed, "test", i])) scav++;
  check(scav > 20, `an AI group's scavengers find them too (${scav} of 400 town trips)`);
  // They scale with Melee: a sabre at Melee 1 and 15, a pocket knife at 15.
  const a = fighter(st, "sabre", 1), c = fighter(st, "sabre", 15), d = fighter(st, "pocketknife", 15);
  const b = openBattle(st, [a, c, d]);
  const z = foe(b);
  const at = (s) => { [a, c, d].forEach((o, i) => place(by(b, o), 1, 1 + 2 * i)); place(by(b, s), 5, 5); place(z, 6, 5); return meleeOdds(b, by(b, s), z); };
  const oA = at(a), oC = at(c), oD = at(d);
  console.log(`  sabre at Melee 1: ${oA.chance}% ${oA.dmg.join("-")} (under its Melee 3: the skill-gap rule), at Melee 15: ${oC.chance}% ${oC.dmg.join("-")}; a pocket knife at Melee 15: ${oD.chance}% ${oD.dmg.join("-")}`);
  check(oC.chance > oA.chance && oC.dmg[1] > oA.dmg[1] && oD.dmg[1] < oC.dmg[1], "they scale with Melee, and a sword out-hits a pocket knife");
  // The table for the report.
  console.log("  key            name                      dmg     aim quick traits                         power kg   value pts dur req");
  for (const k of keys) {
    const g = GEAR[k], w = WEAPONS[k];
    const tr = [w.mclass, w.bleed ? `bleed ${w.bleed}` : "", w.stagger ? `stagger ${w.stagger}` : "", w.stab ? "stab" : "", w.takedown ? `TD +${w.takedown}` : ""].filter(Boolean).join(", ");
    console.log(`  ${k.padEnd(14)} ${g.name.padEnd(25)} ${w.dmg.join("-").padEnd(7)} ${String(w.meleeAim || 0).padStart(3)} ${w.quick ? "yes  " : "no   "} ${tr.padEnd(30)} ${String(g.power).padEnd(5)} ${String(g.weight).padEnd(4)} ${String(g.value).padEnd(5)} ${String(pts[k]).padEnd(3)} ${String(g.dur).padEnd(3)} ${g.req}`);
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
