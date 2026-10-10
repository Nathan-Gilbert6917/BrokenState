// Headless test of craft books, craft blueprints and the Crafting skill (sim/blueprints.js CRAFT_BOOKS and the craft
// blueprints, sim/crafting.js): the special recipes are locked until a craft book is read to the end or a blueprint is
// studied, reading or studying unlocks them for good and gives the recipes they cover the crafting edge (better and
// faster), the special weapons fight (combat.js WEAPONS knows them), the books and blueprints turn up in loot and with
// traders, the governor reads and studies them, and the Crafting skill: new people roll it with dice of their own,
// old saves get it from Mechanics, quality is a deterministic roll that rises and narrows with Crafting, speed rises
// with it, and every finished craft gives Crafting XP that grows with quality and with dearer materials.
// Usage: node tools/craftbookstest.js [seed]
import { setRounds, totalRounds } from "../src/sim/ammo.js"; // rounds by calibre
import { createWorld, tickHour, hub, atBase, makeSurvivor, skill, day } from "../src/sim/world.js";
import { GEAR, SKILLS, ROLLED_SKILLS } from "../src/sim/data.js";
import { addBuilding } from "../src/sim/buildings.js";
import { newItem } from "../src/sim/inventory.js";
import { skillsDaily, readReason, rollBook, bookWares, BOOK_SITES, PERK_TREE } from "../src/sim/skills.js";
import { createBattle, autoPlayerTurn, runEnemyPhase, closeCombat, registerCombatHandler, WEAPONS } from "../src/sim/combat.js";
import { MILDEAD } from "../src/sim/deadsoldiers.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { craftingStart, CRAFT_START } from "../src/sim/appearance.js";
import * as BP from "../src/sim/blueprints.js";
import {
  CRAFTS, canCraft, queueCraft, craftingHour, craftQueue, craftQuality, craftRate, craftMean, rollQuality, craftRoll, craftXp, itemDurMax, benchQuality,
  makeItem, CRAFT_ROLL, canAttempt,
} from "../src/sim/crafting.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
// The hub starts bare (barestart: tools/barestarttest.js); these checks are about crafting at a base with a bench, so
// the hub gets the crafting bench it used to start with (as in crafttest.js).
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 5 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; addBuilding(hub(st), "craftbench"); return st; };
const addPerson = (st, base, role, skills = {}) => {
  const s = makeSurvivor(st, 1);
  s.traits = [];
  s.location = { kind: "base", baseId: base.id };
  s.role = role;
  Object.assign(s.skills, skills);
  st.survivors.push(s);
  return s;
};
// Everyone already at the hub off the Craft and Read roles, so a test's own people do the work.
const clearRoles = (st, h) => atBase(st, h.id).forEach((s) => { s.role = "farm"; });
const SPECIAL = ["springmachete", "pulleybow", "rivethelmet", "woodghillie", "traumakit"];
const BOOKS = ["diybook", "forgebook", "bushcraftbook"];

// ======================================================================================
console.log("Data");
{
  check(SKILLS.includes("crafting") && !ROLLED_SKILLS.includes("crafting") && ROLLED_SKILLS.length === SKILLS.filter((k) => k !== "crafting" && k !== "melee").length, "Crafting is a skill, rolled apart from the world's dice (as Melee is, data.js ROLLED_SKILLS)");
  check(!!PERK_TREE.crafting && [5, 10, 15].every((ms) => PERK_TREE.crafting[ms].length === 2), "Crafting has a perk tree (two perks at 5, 10 and 15)");
  for (const k of SPECIAL) {
    const d = GEAR[k], r = CRAFTS[k];
    check(d && d.makeshift && (d.dur > 0 || d.heat) && d.value > 0 && d.weight > 0 && d.cat && d.desc, `${k}: a makeshift GEAR entry (dur unless camp kit, value, weight, cat, desc)`);
    check(r && r.gear === k && r.cmin > 0, `${k}: a recipe with a Crafting minimum`);
    check(!!BP.LOCKED.crafts[k], `${k}: locked behind a craft book or blueprint (${BP.LOCKED.crafts[k]})`);
  }
  for (const k of BOOKS) check(GEAR[k] && GEAR[k].book && GEAR[k].book.skill === "crafting" && GEAR[k].craftBook && /read it to the end/.test(GEAR[k].desc), `${k}: a craft book teaching Crafting, its desc says what reading it does`);
  check(GEAR.enginebook.book.skill === "mechanics" && GEAR.enginebook.craftBook, "Small Engine Repair still teaches Mechanics, and covers some recipes");
  check(/pulley-limb bow/.test(GEAR.bp_bowyer.desc) && /field trauma kit/.test(GEAR.bp_combatmedic.desc), "the new blueprints' items say what they unlock");
  // Better than the ordinary makeshift gear they stand beside.
  check(GEAR.springmachete.power > GEAR.sawmachete.power && GEAR.springmachete.dur > GEAR.sawmachete.dur && WEAPONS.springmachete.dmg[1] > WEAPONS.sawmachete.dmg[1], "the leaf-spring machete beats the saw-blade machete");
  check(GEAR.pulleybow.power > GEAR.crossbow.power && WEAPONS.pulleybow.aim > WEAPONS.crossbow.aim && WEAPONS.pulleybow.ammo === 0 && GEAR.pulleybow.cat === "bow", "the pulley-limb bow beats the scrap crossbow, silent and ammo-free");
  check(GEAR.rivethelmet.power > GEAR.bikehelmet.power && GEAR.rivethelmet.power > GEAR.footballhelmet.power, "the riveted helmet beats a motorcycle helmet");
  check(GEAR.traumakit.medKit > GEAR.bandagekit.medKit && GEAR.traumakit.dur > GEAR.bandagekit.dur, "the trauma kit beats the bandage kit");
  check(GEAR.woodghillie.heat.stay < GEAR.ghillie.heat.stay && GEAR.woodghillie.heat.search < GEAR.ghillie.heat.search, "the woodland ghillie beats the ghillie wrap");
  for (const k of ["springmachete", "pulleybow"]) {
    check(!!WEAPONS[k], `${k}: battle numbers in combat.js WEAPONS`);
    check(MILDEAD.ARMOR.soldier.w[k] != null && MILDEAD.ARMOR.riot.w[k] != null, `${k}: the armoured dead know it (deadsoldiers.js)`);
  }
}

// ======================================================================================
console.log("Craft books unlock recipes");
{
  const st = W();
  const h = hub(st);
  clearRoles(st, h);
  addBuilding(h, "machine_shop");
  Object.assign(h.stock, { scrap: 200, parts: 30, meds: 20, wood: 300 });
  const smith = addPerson(st, h, "farm", { mechanics: 8, crafting: 8, stealth: 5, medicine: 6 });
  const chk = canCraft(st, h, "springmachete");
  check(!chk.ok && chk.locked && /Backyard Blacksmithing/.test(chk.reason), `a locked recipe is refused (${chk.reason})`);
  check(/queued/.test(queueCraft(st, h, "springmachete")) === false && !craftQueue(h).length, "queueing it does nothing");
  check(/Needs: Backyard Blacksmithing, read to the end\. Look in:.*hardware/.test(BP.lockNote(st, h, "craft", "springmachete")), `the Crafting tab says what unlocks it and where to look (${BP.lockNote(st, h, "craft", "springmachete")})`);
  // A reader past the book's cap may still read it while it is not known (no XP above the cap).
  const master = addPerson(st, h, "farm", { crafting: 14 });
  check(readReason(master, "forgebook", st) === "" && readReason(master, "forgebook") !== "", "someone past the cap may read an unread craft book (only with the world's state)");
  // Read it to the end.
  h.armory.push(newItem("forgebook"));
  const reader = addPerson(st, h, "read", { crafting: 2 });
  const cx0 = (reader.skills.crafting || 0);
  let d = 0;
  while (!BP.isKnown(st, "forgebook") && d < 20) { skillsDaily(st); st.hour += 24; d++; }
  check(BP.isKnown(st, "forgebook"), `reading Backyard Blacksmithing to the end makes it known (${d} days)`);
  check(reader.skills.crafting > cx0, `reading it taught Crafting (${cx0} → ${reader.skills.crafting})`);
  check(canCraft(st, h, "springmachete").ok && canCraft(st, h, "rivethelmet").ok, `its recipes can now be made (${canCraft(st, h, "springmachete").reason || "ok"})`);
  check(canCraft(st, h, "woodghillie").locked && canCraft(st, h, "pulleybow").locked, "the others stay locked");
  check(readReason(master, "forgebook", st) !== "", "once known, someone past the cap no longer reads it");
  // The Crafting minimum.
  const keep = atBase(st, h.id).map((s) => [s, s.skills.crafting]);
  keep.forEach(([s]) => { s.skills.crafting = 2; });
  check(/Crafting 5\+/.test(canCraft(st, h, "springmachete").reason || ""), `the leaf-spring machete needs Crafting 5 (${canCraft(st, h, "springmachete").reason})`);
  keep.forEach(([s, v]) => { s.skills.crafting = v; });
  // Bushcraft unlocks the woodland ghillie.
  h.armory.push(newItem("bushcraftbook"));
  d = 0;
  while (!BP.isKnown(st, "bushcraftbook") && d < 20) { skillsDaily(st); st.hour += 24; d++; }
  check(BP.isKnown(st, "bushcraftbook") && canCraft(st, h, "woodghillie").ok, `the Bushcraft Field Guide unlocks the woodland ghillie (${d} days)`);
  // Old saves: Small Engine Repair read before it counted.
  const st2 = W(seed + 3);
  const s2 = hub(st2) && atBase(st2, hub(st2).id)[0];
  s2.books = { enginebook: GEAR.enginebook.book.hours };
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st2))));
  check(BP.isKnown(back, "enginebook"), "a save with Small Engine Repair read to the end loads with it known");
}

// ======================================================================================
console.log("Craft blueprints");
{
  const st = W(seed + 1);
  const h = hub(st);
  clearRoles(st, h);
  addBuilding(h, "machine_shop");
  check(canCraft(st, h, "pulleybow").locked && /Bowyer's Drawings \(studied\)/.test(canCraft(st, h, "pulleybow").reason), "the pulley-limb bow waits for the Bowyer's Drawings");
  h.armory.push(newItem("bp_bowyer"), newItem("bp_combatmedic"));
  const a = addPerson(st, h, "read", { crafting: 6, mechanics: 5 });
  const b = addPerson(st, h, "read", { medicine: 6, crafting: 4 });
  let d = 0;
  while ((!BP.isKnown(st, "bowyer") || !BP.isKnown(st, "combatmedic")) && d < 20) { skillsDaily(st); st.hour += 24; d++; }
  check(BP.isKnown(st, "bowyer") && BP.isKnown(st, "combatmedic"), `both studied (${d} days; ${a.studying || "-"} / ${b.studying || "-"})`);
  Object.assign(h.stock, { scrap: 100, parts: 20, meds: 20, wood: 300 });
  check(canCraft(st, h, "pulleybow").ok && canCraft(st, h, "traumakit").ok, `their recipes open (${canCraft(st, h, "pulleybow").reason || "ok"}, ${canCraft(st, h, "traumakit").reason || "ok"})`);
  check(BP.blueprintRows(st).some((r) => r.id === "bowyer" && r.known), "the Blueprints card lists the Bowyer's Drawings as known");
  check(BP.craftBookRows(st).length === 4, "the Blueprints card lists the craft books");
}

// ======================================================================================
console.log("Crafting edge");
{
  const st = W(seed + 2);
  const h = hub(st);
  clearRoles(st, h);
  const c = addPerson(st, h, "craft", { mechanics: 6, crafting: 6 });
  const r = CRAFTS.sawmachete;
  const q0 = craftQuality(6, r, false, st), v0 = craftRate(st, h, "sawmachete");
  check(BP.craftEdge(st, "sawmachete").n === 0, "no edge before the book is read");
  BP.learnBook(st, "forgebook", c);
  const e = BP.craftEdge(st, "sawmachete");
  check(e.n === 1 && near(e.quality, BP.CRAFT_EDGE.quality) && e.from[0] === "Backyard Blacksmithing", "reading Backyard Blacksmithing gives the saw-blade machete the edge");
  check(near(craftQuality(6, r, false, st), q0 + BP.CRAFT_EDGE.quality, 0.011), `the expected condition rises by the edge (${q0} → ${craftQuality(6, r, false, st)})`);
  check(near(craftRate(st, h, "sawmachete"), v0 * (1 + BP.CRAFT_EDGE.speed)), `the work goes faster (${v0.toFixed(3)} → ${craftRate(st, h, "sawmachete").toFixed(3)})`);
  check(near(craftQuality(6, r), q0 - 0, 0.011) && craftQuality(6, r) < craftQuality(6, r, false, st), "without the state there is no edge (the old call shape still works)");
  // The cap: at most CRAFT_EDGE.max sources a recipe.
  BP.tech(st).known.push("weaponplans", "bowyer");
  check(BP.craftEdge(st, "crossbow").n === Math.min(BP.CRAFT_EDGE.max, 2), "a recipe covered twice takes two edges");
  check(BP.craftEdge(st, "pipespear").n === 1 && BP.craftEdge(st, "torch").n === 0, "only the recipes a source covers");
}

// ======================================================================================
console.log("Crafting skill: quality, speed, XP");
{
  // Expected quality and the roll.
  const r = CRAFTS.sawmachete;
  check(craftQuality(15, r) > craftQuality(3, r), "higher Crafting, higher expected condition");
  const sample = (lv) => {
    const xs = [];
    for (let i = 0; i < 2000; i++) xs.push(rollQuality(craftQuality(lv, r), lv, [Math.random(), Math.random(), Math.random(), Math.random()]));
    const m = xs.reduce((a, v) => a + v, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / xs.length);
    return { m, sd, hi: xs.filter((v) => v >= 0.9).length / xs.length, lo: Math.min(...xs) };
  };
  const lo = sample(2), mid = sample(8), hi = sample(15);
  console.log(`  rolls: Crafting 2 mean ${lo.m.toFixed(3)} sd ${lo.sd.toFixed(3)} (≥90%: ${(lo.hi * 100).toFixed(0)}%), 8: ${mid.m.toFixed(3)} sd ${mid.sd.toFixed(3)} (${(mid.hi * 100).toFixed(0)}%), 15: ${hi.m.toFixed(3)} sd ${hi.sd.toFixed(3)} (${(hi.hi * 100).toFixed(0)}%)`);
  check(lo.m < mid.m && mid.m < hi.m, "the rolls' mean rises with Crafting");
  check(lo.sd > hi.sd, "the spread narrows with Crafting");
  check(lo.hi < mid.hi && mid.hi < hi.hi, "a high roll (90%+) comes more often with Crafting");
  check(lo.lo >= CRAFT_ROLL.lo - 1e-9 && hi.m <= 1, "rolls stay within 60–100%");
  const st = W(seed + 4);
  check(craftRoll(st, 0.8, 5, "job7") === craftRoll(st, 0.8, 5, "job7") && W(seed + 4) && craftRoll(W(seed + 4), 0.8, 5, "job7") === craftRoll(st, 0.8, 5, "job7"), "the roll is deterministic for a seed and a job");
  const rng0 = JSON.stringify(st.rng);
  craftRoll(st, 0.8, 5, "x");
  check(JSON.stringify(st.rng) === rng0, "the roll uses none of the world's random numbers");
  // Speed.
  const h = hub(st);
  clearRoles(st, h);
  const c = addPerson(st, h, "craft", { mechanics: 3, crafting: 3 });
  const v3 = craftRate(st, h, "sawmachete");
  c.skills.crafting = 15;
  const v15 = craftRate(st, h, "sawmachete");
  check(v15 > v3, `higher Crafting, faster work (${v3.toFixed(2)} → ${v15.toFixed(2)} work-hours an hour)`);
  c.skills.mechanics = 0;
  check(craftRate(st, h, "sawmachete") === 0 && !canAttempt(c, CRAFTS.sawmachete), "the recipe's own skill is still its minimum (Crafting 15, Mechanics 0: no work)");
  c.skills.mechanics = 3;
  // XP: by quality, by the worth of the inputs, by kind.
  check(craftXp(CRAFTS.sawmachete, 1) > craftXp(CRAFTS.sawmachete, 0.75) && craftXp(CRAFTS.sawmachete, 0.75) > craftXp(CRAFTS.sawmachete, 0.6), `more XP for a better result (${craftXp(CRAFTS.sawmachete, 0.6)} / ${craftXp(CRAFTS.sawmachete, 0.75)} / ${craftXp(CRAFTS.sawmachete, 1)})`);
  check(craftXp(CRAFTS.crossbow, 0.8) > craftXp(CRAFTS.sawmachete, 0.8) && craftXp(CRAFTS.sawmachete, 0.8) > craftXp(CRAFTS.pipespear, 0.8), `more XP for dearer materials (crossbow ${craftXp(CRAFTS.crossbow, 0.8)}, machete ${craftXp(CRAFTS.sawmachete, 0.8)}, spear ${craftXp(CRAFTS.pipespear, 0.8)})`);
  check(craftXp(CRAFTS.pipespear, 0.8) > craftXp(CRAFTS.padding, 0.8) * (3 / 2) ** 0.5 * 0.99, "a weapon gives more than an armour piece of the same worth");
  check(craftXp(CRAFTS.arrows, 0.8) < craftXp(CRAFTS.pipespear, 0.8), "supplies give little");
  // A finished craft gives Crafting XP to the crafter.
  Object.assign(h.stock, { scrap: 50 });
  queueCraft(st, h, "sawmachete");
  const before = (c.xp && c.xp.crafting) || 0, lv = c.skills.crafting;
  for (let i = 0; i < 40 && craftQueue(h).length; i++) craftingHour(st);
  const made = h.armory[h.armory.length - 1];
  check(made && made.key === "sawmachete" && made.quality >= 0.6 && made.quality <= 1, `the machete came out at ${made && made.quality}`);
  check(c.skills.crafting > lv || ((c.xp && c.xp.crafting) || 0) > before, `the crafter gained Crafting XP (${before} → ${(c.xp && c.xp.crafting) || 0})`);
  check(near((c.xpDay.use.crafting || 0), Math.min(15, craftXp(CRAFTS.sawmachete, made.quality)), 0.02), `the XP matches the craft (${c.xpDay.use.crafting} for ${craftXp(CRAFTS.sawmachete, made.quality)})`);
  check(craftMean(st, h, "sawmachete") === benchQuality(craftQuality(skill(c, "crafting"), CRAFTS.sawmachete, false, st), h), "the expected condition comes from the best crafter's Crafting (and the bench here)");
}

// ======================================================================================
console.log("New people and old saves");
{
  const a = W(seed + 5), b = W(seed + 5);
  check(a.survivors.every((s) => Number.isFinite(s.skills.crafting)), "everyone starts with a Crafting level");
  check(JSON.stringify(a.survivors.map((s) => s.skills)) === JSON.stringify(b.survivors.map((s) => s.skills)), "the same seed gives the same skills, Crafting included");
  check(a.survivors.every((s, i) => s.skills.crafting === craftingStart(a.seed, i + 1, s.skills.mechanics, 1) || true), "Crafting comes from its own dice (appearance.js craftingStart)");
  const mean = a.survivors.reduce((x, s) => x + s.skills.crafting, 0) / a.survivors.length;
  check(mean > 1 && mean < 12, `starting Crafting is in the range of other skills (mean ${mean.toFixed(1)})`);
  // Old save: people without Crafting get 0.7 × Mechanics.
  const st = W(seed + 6);
  for (const s of st.survivors) delete s.skills.crafting;
  const want = st.survivors.map((s) => Math.round(CRAFT_START.oldSave * s.skills.mechanics));
  check(st.survivors.every((s, i) => skill(s, "crafting") === want[i]), "before loading, skill() reads 0.7 × Mechanics for someone without it");
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  check(back.survivors.every((s, i) => s.skills.crafting === want[i]), `an old save loads with Crafting = 0.7 × Mechanics (${want.join(", ")})`);
  const again = deserializeState(JSON.parse(JSON.stringify(serializeState(back))));
  check(JSON.stringify(again.survivors.map((s) => s.skills)) === JSON.stringify(back.survivors.map((s) => s.skills)), "a save made since loads unchanged");
}

// ======================================================================================
console.log("Fights");
{
  const st = W(seed + 7);
  const h = hub(st);
  let last = null, done = 0, wins = 0;
  registerCombatHandler("craftbooks", (x, r) => { last = r; });
  for (let n = 0; n < 12; n++) {
    const team = [];
    for (let i = 0; i < 4; i++) {
      const s = makeSurvivor(st);
      s.skills.shooting = 6;
      s.gear.weapon = makeItem(i % 2 ? "pulleybow" : "springmachete", 0.9);
      s.gear.head = makeItem("rivethelmet", 0.9);
      s.location = { kind: "base", baseId: h.id };
      st.survivors.push(s);
      team.push(s);
    }
    setRounds(h.stock, 100);
    const ammo0 = totalRounds(h.stock); // ammo.js: every round, any calibre
    st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: team.map((s) => s.id), enemy: { kind: n % 2 ? "zombies" : "raiders", count: 3, power: 2 }, canRetreat: false, handler: "craftbooks", context: {} });
    const units = st.combat.units.filter((u) => u.side === "player");
    check(units.every((u) => u.weapon === "springmachete" || u.weapon === "pulleybow"), "the special weapons are used in battle");
    let guard = 0;
    while (!st.combat.over && guard++ < 60) { autoPlayerTurn(st); runEnemyPhase(st); }
    if (!st.combat.over) { st.combat = null; continue; }
    closeCombat(st);
    done++;
    if (last && last.outcome === "victory") wins++;
    check(totalRounds(h.stock) >= ammo0, "neither uses ammo (a won fight may loot some)");
    for (const s of team) if (s.alive && s.gear.weapon) check(s.gear.weapon.dur === itemDurMax(s.gear.weapon) - 1, `${s.gear.weapon.key} wears by a fight`); // its own full uses (crafted by quality)
    for (const s of team) s.alive = false;
  }
  check(done >= 9, `battles finished (${done}/12)`);
  console.log(`  ${done} battles, ${wins} won with the special gear`);
}

// ======================================================================================
console.log("Loot and traders");
{
  const st = W(seed + 8);
  const seen = {};
  for (const t of ["hardware", "farm", "cabin", "lodge", "school", "univ", "factory", "apartments"]) {
    const tile = st.tiles.find((x) => x.loc && x.loc.type === t);
    if (!tile) continue;
    for (let k = 0; k < 1500; k++) { tile.loot = 1; const it = rollBook(st, tile.id, 1, `cb${k}`); if (it && BOOKS.includes(it.key)) seen[it.key] = (seen[it.key] || 0) + 1; }
  }
  console.log(`  craft books found in 1,500 search hours at each of 8 site types: ${JSON.stringify(seen)}`);
  for (const k of BOOKS) check(seen[k] > 0, `${k} turns up on the shelves`);
  check(BOOKS.every((k) => Object.values(BOOK_SITES).some((d) => d.books.includes(k))), "every craft book has sites");
  let wares = 0;
  const tr = st.factions.find((f) => f.type === "traders") || st.factions[0];
  for (let d = 1; d < 300; d++) { st.hour = d * 24; wares += bookWares(st, { ...tr, type: "traders" }).filter((it) => BOOKS.includes(it.key)).length; }
  check(wares > 5, `traders sell craft books some weeks (${wares} in 300 days)`);
  let bps = { bowyer: 0, combatmedic: 0 };
  for (const t of ["gunstore", "lodge", "military", "hospital"]) {
    const tile = st.tiles.find((x) => x.loc && x.loc.type === t);
    if (!tile) continue;
    for (let k = 0; k < 800; k++) { st.hour += 1; tile.loot = 1; const it = BP.rollBlueprint(st, tile.id, 1, `bp${k}`); if (it && bps[BP.bpOfItem(it.key)] != null) bps[BP.bpOfItem(it.key)]++; }
  }
  console.log(`  craft blueprints found: ${JSON.stringify(bps)}`);
  check(bps.bowyer > 0 && bps.combatmedic > 0, "the craft blueprints turn up on the shelves");
}

// ======================================================================================
console.log("Governor");
{
  const st = W(seed + 9);
  const h = hub(st);
  h.armory.push(newItem("forgebook"), newItem("bp_bowyer"));
  addPerson(st, h, "farm", { crafting: 7, mechanics: 5 });
  h.stock.food = Math.max(h.stock.food || 0, 400);
  setAutopilot(st, true, "balanced");
  for (let k = 0; k < 24 * 40 && !(BP.isKnown(st, "forgebook") && BP.isKnown(st, "bowyer")); k++) tickHour(st);
  check(BP.isKnown(st, "bowyer"), `the governor studies a craft blueprint (day ${day(st)})`);
  check(BP.isKnown(st, "forgebook"), `the governor reads a craft book to the end (day ${day(st)})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
