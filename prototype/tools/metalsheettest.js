// Metal sheets and building materials (the user's requests 2026-10-21: "Add metal sheets as a lootable items that can
// be carried by the carried slot with two hands. stacked up to 4 metal sheets at a time", "make sure building materials
// are also items only carried by the carried slot with two hands and stack up to 4", "make sure all buildings require
// building materials to some degree depending on the building", metal sheets for metal walls, roofed and reinforced
// builds, cars' armour, makeshift metal armour and weapons, repairs, and salvaged from cars). The supply and its item
// form (src/sim/data.js, data-supitems.js), the arms (carry.js, raidloot.js), the costs and their making on site
// (buildmats.js, buildings.js), repairs (breakdowns.js, repair.js), crafting (crafting.js), finds and salvage (loot.js,
// vehicles.js, basescatter.js), a car's plating (vehicles.js VEH_UPGRADES).
// Usage: node tools/metalsheettest.js [seed]
import { createWorld, hub } from "../src/sim/world.js";
import { registerCombatHandler } from "../src/sim/combat.js";
import { SUPPLIES, GEAR } from "../src/sim/data.js";
import { fitReason, isTwoHands, isCarryable, itemLoad } from "../src/sim/inventory.js";
import { HOLD, bothArms, armsCap, handsCount, handsTakeRefusal, HANDS_KG } from "../src/sim/carry.js";
import { BUILDINGS, SHEETS, WALL_TIERS, STAND, pieceCost, canBuild, queueBuild, demolishRefund, BARRACKS_UP, WATER_BARREL, addBuilding } from "../src/sim/buildings.js";
import { withBuildmat, siteCost, siteShort, SITE_MAKE } from "../src/sim/buildmats.js";
import { GEN_TIERS } from "../src/sim/power.js";
import { RELOAD } from "../src/sim/reloading.js";
import { FIXTURES, wallSegCost } from "../src/sim/breakdowns.js";
import { CRAFTS, canCraft } from "../src/sim/crafting.js";
import { ARMOUR, armourSpec } from "../src/sim/armour.js";
import { WEAPONS } from "../src/sim/combat.js";
import { repairKind } from "../src/sim/repair.js";
import { rollSheets, rollAreaSheets, SHEET_FINDS, AREA_SHEETS } from "../src/sim/loot.js";
import { stripYield, VEH_UPGRADES, stripRefund, createVehicle } from "../src/sim/vehicles.js";
import { CLEAR, clearOf } from "../src/sim/basescatter.js";
import { keyWord } from "../src/sim/water.js";

const seed = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
registerCombatHandler("mst", () => {});
const world = () => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.hour = 24 * 3 + 12; st.landOff = true; return st; };

section("The supply and its item form: both arms, a stack of 4");
{
  check(SUPPLIES.metalsheet && SUPPLIES.metalsheet.weight === 6 && SUPPLIES.metalsheet.value > SUPPLIES.buildmat.value, `metal sheets: 6 kg, worth more than building materials (${JSON.stringify(SUPPLIES.metalsheet)})`);
  for (const k of ["metalsheet", "buildmat"]) {
    const d = GEAR[`s_${k}`];
    const it = { key: `s_${k}`, name: d.name, dur: 4 };
    check(d && d.stack === 4 && d.twoHands && d.bulky && isTwoHands(it) && isCarryable(it), `${d.name}: a stack of 4, carried in both arms`);
    check(!fitReason(it, "carry") && /too big/.test(fitReason(it, "pack")) && /too big/.test(fitReason(it, "pocket")) && /one hand/.test(fitReason(it, "tool")), `${d.name}: the Carried slot only (no pack, pocket or one hand)`);
    check(Math.abs(itemLoad(it) - 4 * SUPPLIES[k].weight) < 1e-9, `${d.name}: four weigh ${itemLoad(it)} kg`);
    check(HOLD[k] && bothArms(k) && armsCap(k) === 4 && !HOLD[k].pack && !HOLD[k].pocket, `${d.name}: a team holds them in the arms or a vehicle, up to 4 a person`);
  }
  check(4 * SUPPLIES.metalsheet.weight <= HANDS_KG, `four sheets (${4 * SUPPLIES.metalsheet.weight} kg) are an armful under ${HANDS_KG} kg`);
  const u = { name: "Ana Test", hands: { metalsheet: 2 } };
  check(handsCount(u) === 2 && handsCount({ name: "B", hands: { scrap: 3 } }) === 1, "an armful of sheets fills both hands (scrap only one)");
  check(/Both hands/.test(handsTakeRefusal({ name: "C D", hands: { scrap: 2 } }, "the metal sheets", { key: "s_metalsheet", name: "Metal sheets" })), "with anything else in hand, sheets cannot be taken");
  check(keyWord("metalsheet") === "metal sheets", "named \"metal sheets\" in the lines");
}

section("Building materials in every building, metal sheets in the roofed and reinforced ones");
{
  const exempt = (k, d) => !d.cost || d.fit || d.furniture || d.piece === "wall" || ["sandbag1", "tent", "walls", "clear", "cots"].includes(k);
  const missing = Object.entries(BUILDINGS).filter(([k, d]) => !exempt(k, d) && !(d.cost.buildmat >= 1)).map(([k]) => k);
  check(!missing.length, `every building, defence and step up takes building materials (${missing.join(", ") || "all"})`);
  check(BUILDINGS.hospital.cost.buildmat > BUILDINGS.infirmary.cost.buildmat && BUILDINGS.gen_barn.cost.buildmat > BUILDINGS.gen_hut.cost.buildmat && BUILDINGS.storebox.cost.buildmat === 1, `by the building's size (a hospital ${BUILDINGS.hospital.cost.buildmat}, a barn ${BUILDINGS.gen_barn.cost.buildmat}, a storage box ${BUILDINGS.storebox.cost.buildmat})`);
  const noSheet = Object.keys(SHEETS).filter((k) => !(BUILDINGS[k].cost.metalsheet === SHEETS[k]));
  check(!noSheet.length && Object.keys(SHEETS).length >= 20, `${Object.keys(SHEETS).length} roofed or reinforced builds take metal sheets (${noSheet.join(", ") || "garage, warehouse, reinforced gate…"})`);
  check(BUILDINGS.gate.cost.metalsheet >= 2 && BUILDINGS.garage.cost.metalsheet >= 2 && !BUILDINGS.farm_plot.cost.metalsheet, "the reinforced gate and the garage take sheets, a farm plot none");
  check(!BUILDINGS.sandbag1.cost.buildmat && !BUILDINGS.tent.cost.buildmat && !BUILDINGS.bunks.cost.buildmat, "not the sandbags, a makeshift tent or the fittings inside a building");
  check(WALL_TIERS[4].cost.metalsheet === 1 && WALL_TIERS[4].gate.metalsheet === 2 && !WALL_TIERS[4].cost.buildmat, "the metal-sheet wall: a sheet a 1×4 section, two its gate");
  check([1, 2, 3, 4].every((m) => WALL_TIERS[m].gate.buildmat >= 1) && STAND.cost.buildmat >= 1 && pieceCost("stand1").buildmat === 1, "every gate and stand takes building materials");
  check(BARRACKS_UP.cost.buildmat >= 1 && BARRACKS_UP.cost.metalsheet >= 1 && WATER_BARREL.tiers.slice(2).every((t) => t.cost.buildmat >= 1) && GEN_TIERS.slice(2).every((t) => t.cost.buildmat >= 1) && RELOAD.UP.cost.buildmat >= 1, "the upgrades too (a barracks, a barrel's tiers, a generator's, a reloading bench)");
  check(JSON.stringify(withBuildmat({ scrap: 24 }, 1)) === JSON.stringify({ scrap: 13, buildmat: 2, metalsheet: 1 }), `the rule: one per 12 scrap's worth, 3 scrap off each, 5 off a sheet (${JSON.stringify(withBuildmat({ scrap: 24 }, 1))})`);
}

section("Made on site from scrap when the stores lack them");
{
  const c = siteCost({ scrap: 50, buildmat: 1 }, { scrap: 4, buildmat: 3, metalsheet: 1 });
  check(c.take.scrap === 4 + 2 * SITE_MAKE.buildmat.scrap + SITE_MAKE.metalsheet.scrap && c.take.buildmat === 1 && !c.take.metalsheet && c.hours === 2 * SITE_MAKE.buildmat.hours + SITE_MAKE.metalsheet.hours, `what is lacking is paid in scrap (${JSON.stringify(c)})`);
  check(/^Needs 15 scrap \(/.test(siteShort({ scrap: 5 }, { scrap: 2, buildmat: 1, metalsheet: 2 }, keyWord)), `short of the scrap to make them: "${siteShort({ scrap: 5 }, { scrap: 2, buildmat: 1, metalsheet: 2 }, keyWord)}"`);
  const st = world(), h = hub(st);
  Object.assign(h.stock, { scrap: 200, parts: 20, wood: 5000, buildmat: 0, metalsheet: 0 });
  const s0 = h.stock.scrap, cost = BUILDINGS.storehouse.cost;
  check(canBuild(st, h, "storehouse").ok, "a storehouse with no building materials or sheets in store, but the scrap");
  const msg = queueBuild(st, h, "storehouse");
  const job = h.construction.find((j) => j.type === "storehouse");
  const made = cost.buildmat * SITE_MAKE.buildmat.scrap + cost.metalsheet * SITE_MAKE.metalsheet.scrap;
  check(job && s0 - h.stock.scrap === (cost.scrap || 0) + made && job.hours === BUILDINGS.storehouse.hours + cost.buildmat * SITE_MAKE.buildmat.hours + cost.metalsheet * SITE_MAKE.metalsheet.hours, `the scrap for them taken and their hours added (${s0 - h.stock.scrap} scrap, ${job && job.hours} h: ${msg})`);
  check(job && job.cost && job.cost.scrap === (cost.scrap || 0) + made && !job.cost.metalsheet, "the job keeps what it paid (the refund on a cancel)");
  Object.assign(h.stock, { buildmat: 10, metalsheet: 10 });
  const s1 = h.stock.scrap;
  queueBuild(st, h, "garage");
  check(h.stock.scrap === s1 - (BUILDINGS.garage.cost.scrap || 0) && h.stock.metalsheet === 10 - BUILDINGS.garage.cost.metalsheet && h.stock.buildmat === 10 - BUILDINGS.garage.cost.buildmat, "with them in store: theirs are used, no scrap for them");
  const g = addBuilding(h, "warehouse");
  const back = demolishRefund(g || { type: "warehouse" });
  check(back.metalsheet === Math.floor(BUILDINGS.warehouse.cost.metalsheet / 2), `a warehouse pulled down: half its sheets back (${JSON.stringify(back)})`);
}

section("Repairs take sheets");
{
  check(FIXTURES.storehouse.repair.cost.metalsheet === 1 && FIXTURES.garage.repair.cost.metalsheet === 1 && FIXTURES.warehouse.repair.cost.metalsheet === 2 && FIXTURES.gate.repair.cost.metalsheet === 1, "a leaking roof, the garage, the warehouse's door, the reinforced gate: a sheet");
  check(wallSegCost({ type: "wall4", mat: 4 }).metalsheet === 1 && !wallSegCost({ type: "wall4", mat: 3 }).metalsheet, "a metal-sheet wall section is mended with a sheet");
  check(repairKind({ key: "sheetvest" }).kind === "sheet" && CRAFTS && repairKind({ key: "scrapvest" }).kind === "steel", "sheet-metal armour is patched with a sheet");
}

section("Crafting: sheets from scrap, sheet-metal armour and weapons");
{
  const r = CRAFTS.metalsheet;
  check(r && r.supplies.metalsheet === 1 && r.in.scrap === 4 && r.needs === "workshop", "a metal sheet: 4 scrap at a workshop");
  for (const k of ["sheetvest", "sheetarms", "sheetlegs", "sheetmachete", "sheethatchet"]) {
    const d = GEAR[k], c = CRAFTS[k];
    check(d && d.makeshift && d.value > 0 && d.weight > 0 && d.desc && c && c.gear === k && c.in.metalsheet >= 1, `${d.name}: crafted from ${c.in.metalsheet} metal sheet${c.in.metalsheet > 1 ? "s" : ""}`);
  }
  check(ARMOUR.sheetvest.ac === 3 && ARMOUR.sheetvest.dmax === GEAR.sheetvest.dur && armourSpec("sheetvest") !== null && ARMOUR.sheetvest.dmax > ARMOUR.scrapvest.dmax && GEAR.sheetvest.power < GEAR.vest.power, "the cuirass: AC 3 steel, tougher than a scrap vest, below a Kevlar vest");
  check(ARMOUR.sheetarms.mat === "steel" && ARMOUR.sheetlegs.ac === 2, "vambraces and greaves: AC 2 steel");
  check(WEAPONS.sheetmachete.melee && WEAPONS.sheetmachete.mclass === "blade" && WEAPONS.sheethatchet.mclass === "chop" && GEAR.sheetmachete.skill === "melee", "the machete a blade, the hatchet a chopper, both by Melee");
  check(WEAPONS.sheetmachete.dmg[1] < WEAPONS.machete.dmg[1], "a sheet-metal machete hits less hard than a real one");
  for (const k of ["scrapvest", "steelplate", "wheelbarrow", "rivethelmet"]) check(CRAFTS[k].in.metalsheet === 1, `the ${GEAR[CRAFTS[k].gear].name.toLowerCase()} takes a sheet now`);
  const st = world(), h = hub(st);
  addBuilding(h, "machine_shop");
  Object.assign(h.stock, { scrap: 100, parts: 10, metalsheet: 0, wood: 100 });
  check(!canCraft(st, h, "sheetarms").ok && /metal sheets/.test(canCraft(st, h, "sheetarms").reason || ""), `no sheet, no vambraces (${canCraft(st, h, "sheetarms").reason})`);
}

section("Found and salvaged");
{
  const st = world();
  const tile = st.tiles.findIndex((t) => t && t.loc && t.loc.type === "hardware");
  let found = 0;
  if (tile >= 0) for (let hr = 0; hr < 200; hr++) { st.hour = hr; found += rollSheets(st, tile, 1, `t${hr}`); }
  check(tile < 0 || found > 0, `a hardware store's shelves give sheets over 200 search hours (${tile < 0 ? "no hardware store on this map" : found})`);
  check(SHEET_FINDS.hardware && SHEET_FINDS.autoshop && SHEET_FINDS.barn && SHEET_FINDS.shed && SHEET_FINDS.crashsite, "hardware stores, auto shops, barns, sheds, crash sites");
  let car = 0;
  for (let i = 0; i < 100; i++) car += rollAreaSheets(st, 5, "wreck", "car", `b${i}`);
  check(car > 0 && AREA_SHEETS.wreck && AREA_SHEETS.garage, `a raid map's wrecked cars give sheets (${car} from 100)`);
  const v = createVehicle(st, "van", { kind: "base", baseId: 0 });
  const y = stripYield(v);
  check(y.metalsheet >= 2, `a stripped van: ${y.metalsheet} metal sheets with its car parts and scrap`);
  v.upgrades = { plating: 2 };
  check(stripYield(v).metalsheet === y.metalsheet + VEH_UPGRADES.plating.cost.metalsheet, `and half its plating's sheets (${stripYield(v).metalsheet})`);
  check(CLEAR.strip.get.metalsheet === 2 && clearOf({ k: "wreck" }, true, "clear").get.metalsheet === 2, "a wreck on the base map: two sheets off its roof and doors");
}

section("A car's armour takes sheets");
{
  check(VEH_UPGRADES.plating.cost.metalsheet === 6 && VEH_UPGRADES.scrapPlate.cost.metalsheet === 3, "armour plate six sheets a level, scrap plating three");
  check(stripRefund("plating").metalsheet === 3, "taken off: half back");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
