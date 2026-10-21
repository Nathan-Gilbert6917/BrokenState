// The walk-in freezer, the vacuum sealer and machine parts (freezer-parts 2026-10-10; buildings.js freezer / sealer,
// power.js base.freezerOn / hasSealer, breakdowns.js machines and spares, crafting.js parts recipes, groupworks.js
// the groups' machines), and machines round 2 (machines-2 2026-10-10): build gates (Mechanics 3, parts, electronics, a
// building plot, the Refrigeration Schematics, for the groups too); power on and off sets base.freezerOn and says why
// in the log; the unattended generator (no operator: the morning's refuelling chore fills its tank, it burns by the
// hour, the fuel reserve, nobody able at the base → it runs a day and a half and goes dry; a late refuelling leaves no gap); a broken freezer is off and a proper
// repair takes parts; the spares upkeep; storage room on and off; the sealer hook; the cold store an ice house again;
// the pressure canner fitted to a preserving room (and old saves: canners and generator operators migrated); the
// crafting recipes with a mechanism take parts; an AI group builds a still, a generator and a freezer, runs it on
// coarse fuel, breaks it and repairs it with parts its workshop made (kept for the machines: the earmark); 10-day governor runs keeping the freezer on with
// nobody operating the generator; and a 120-day governor run with nothing NaN or negative.
// Usage: node tools/freezertest.js [days for the governor run] [seeds...]
import { stockTools } from "./toolset.js"; // every tool a build or recipe can need (toolreqs.js)
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, atBase, day } from "../src/sim/world.js";
import { addBuilding, canBuild, queueBuild, constructionHour, BUILDINGS, recipeOutput, CANNER, count, countAll, demolishRefund, canUpgradeKitchen, queueCannerUpgrade, cancelBuild, buildRate, stations } from "../src/sim/buildings.js";
import { POWER, POWER_USERS, REFUEL, refreshPower, isPowered, hasSealer, freezerLine, powerStatus, setGenReserve, choreShare, refueller } from "../src/sim/power.js";
import { FIXTURES, WEAR, breakFixture, repairPlan, startRepair, breakdownsHour, useSpares, dailyWear, machineRan, isMachine, machineText, fxDef } from "../src/sim/breakdowns.js";
import { storeSpaces, foodStore, STORE, FACTOR } from "../src/sim/storage.js";
import { CRAFTS, queueCraft, canCraft, craftQueue, makeItem } from "../src/sim/crafting.js";
import { TECH, groupKnows, groupTech, groupTechDaily, groupGotBlueprint, groupFindBlueprint, groupSkill, GROUP_WORKS, groupWorksDaily, nextWork, worksAt, groupFreezerOn, groupSealer, groupMachineCount, worksText, groupPartsDaily, partsRate, partsWant, groupMachParts, groupFreeParts, canPayParts, payParts } from "../src/sim/groupworks.js";
import { groupPartsTarget, available } from "../src/sim/trade.js";
import { setAutopilot, autopilotResolve } from "../src/sim/autopilot.js";
import { tech, buildLock, BLUEPRINTS, CRASH_BP, siteBlueprints } from "../src/sim/blueprints.js";
import { READ_HOURS } from "../src/sim/skills.js";
import { relation } from "../src/sim/diplomacy.js";
import { stationIO } from "../src/sim/production.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { ensureMembers, syncMembers, membersOf } from "../src/sim/members.js";
import { skill as skillOf } from "../src/sim/world.js";
// A group's best mechanic is one of its people (groupworks.js groupSkill): every one of them set to n (traits count).
const setMech = (st, f, n) => { ensureMembers(st, f); syncMembers(st, f); for (const x of membersOf(f)) { x.skills.mechanics = n; x.skills.mechanics = Math.max(0, 2 * n - skillOf(x, "mechanics")); } };


const govDays = Number(process.argv[2] || 120);
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [11];
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const W = (seed = 42) => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; stockTools(hub(st)); return st; }; // every tool (toolset.js)
const at8 = (st) => { st.hour = Math.ceil(st.hour / 24) * 24 + 8; }; // 08:00 of the next day
function quietHub(st, { refrig = true } = {}) {
  const h = hub(st);
  for (const s of atBase(st, h.id)) { s.traits = []; s.conditions = []; s.role = "rest"; s.station = null; s.health = 100; s.mood = 80; s.skills.mechanics = 0; }
  Object.assign(h.stock, { water: 200, scrap: 300, parts: 30, electronics: 6, fuel: 40, meds: 20, jars: 40 }); setFood(h, 500);
  delete h.tier; delete h.camp; // a full base (building plots)
  if (refrig) tech(st).known.push("refrig"); // the walk-in freezer's blueprint (machines-2)
  at8(st);
  return h;
}
const lastLog = (st, re) => [...st.log.slice(0, 12), ...st.log.slice(-12)].some((e) => re.test(e.text)); // newest first (either way)
const logCount = (st, re) => st.log.filter((e) => re.test(e.text)).length;
const near = (a, b) => Math.abs(a - b) < 1e-6;

// ---------- 1. build gates (and the Refrigeration Schematics) ----------
{
  console.log("Build gates");
  const st = W();
  const h = quietHub(st, { refrig: false });
  const d = BUILDINGS.freezer;
  check(d.plot === "building" && d.cost.parts >= 4 && d.cost.electronics >= 1 && d.req.mechanics === 3, `a building plot, parts and electronics, Mechanics 3 (${JSON.stringify(d.cost)})`);
  check(d.cost.parts > BUILDINGS.generator.cost.parts - 1 && d.cost.parts < BUILDINGS.radio.cost.parts, "priced between the generator and the radio station in parts");
  let chk = canBuild(st, h, "freezer");
  check(!chk.ok && /Mechanics 3/.test(chk.reason), `no Mechanics 3 here: refused (${chk.reason})`);
  atBase(st, h.id)[0].skills.mechanics = 3;
  h.stock.electronics = 1;
  chk = canBuild(st, h, "freezer");
  check(!chk.ok && /electronics/.test(chk.reason), `short of electronics: refused (${chk.reason})`);
  h.stock.electronics = 6; h.stock.parts = 2;
  chk = canBuild(st, h, "freezer");
  check(!chk.ok && /parts/.test(chk.reason), `short of parts: refused (${chk.reason})`);
  h.stock.parts = 30;
  chk = canBuild(st, h, "freezer");
  check(!chk.ok && chk.locked && /Refrigeration Schematics/.test(chk.reason), `everything but the blueprint: locked (${chk.reason})`);
  check(!!buildLock(st, h, "coldstore"), "the cold store waits for the same blueprint");
  tech(st).known.push("refrig");
  chk = canBuild(st, h, "freezer");
  check(chk.ok && !buildLock(st, h, "freezer"), `the Refrigeration Schematics studied: ok (${chk.reason || ""})`);
  const p0 = h.stock.parts, e0 = h.stock.electronics;
  queueBuild(st, h, "freezer");
  check(h.stock.parts === p0 - d.cost.parts && h.stock.electronics === e0 - d.cost.electronics, "queuing pays the parts and electronics");
  for (const s of atBase(st, h.id)) s.role = "build";
  for (let i = 0; i < 200 && !countAll(h, "freezer"); i++) constructionHour(st);
  check(countAll(h, "freezer") === 1 && count(h, "freezer") === 1, "the builders finish it (count(base, \"freezer\") works)");
  const back = demolishRefund({ type: "freezer" });
  check(back.electronics === 1 && back.parts === Math.floor(d.cost.parts / 2), `demolishing gives half the parts and electronics back (${JSON.stringify(back)})`);
  check(canBuild(st, h, "sealer").ok && BUILDINGS.sealer.plot === "utility" && BUILDINGS.sealer.cost.electronics > 0, "the vacuum sealer: a utility plot, parts and electronics, Mechanics 3");
  // A camp cannot.
  const st2 = W(5);
  const h2 = hub(st2);
  tech(st2).known.push("refrig");
  check(!canBuild(st2, h2, "freezer").ok, "not at a camp or shelter");
  // The groups (machines-2, the user's rule: the same restrictions as yours): manuals found, bought and studied.
  const F = (type, pop = 12) => ({ name: `T ${type}`, type, pop, stock: { scrap: 200 }, bases: [] });
  const tr = F("traders"), co = F("commune"), mi = F("military"), ra = F("raider");
  check(groupKnows(st, tr, "refrig") && groupKnows(st, tr, "genschem") && groupKnows(st, co, "refrig") && !groupKnows(st, co, "genschem"), "traders know every manual they sell, communes theirs (refrigeration, not the generator)");
  check(!groupKnows(st, mi, "genschem") && groupTech(mi).held.includes("genschem") && !groupKnows(st, ra, "refrig") && !groupTech(ra).held.length, "the military holds its manuals unstudied; raiders start with none (as you do)");
  st.hour = 24 * 3;
  let days = 0;
  while (!groupKnows(st, mi, "genschem") && days < 30) { groupTechDaily(st, mi); days++; }
  check(groupKnows(st, mi, "genschem") && groupKnows(st, mi, "armyeng") && days === Math.ceil(BLUEPRINTS.armyeng.hours / READ_HOURS) + Math.ceil(BLUEPRINTS.genschem.hours / READ_HOURS), `studied one at a time: the Army Engineering Manual, then the Generator Schematics, ${days} days (${READ_HOURS} h a day, their mechanic ${groupSkill(mi, "mechanics")})`);
  const weak = F("zealot"); groupGotBlueprint(weak, "machinist"); // Mechanics 3 to study; a zealot's mechanic is 2
  for (let d = 0; d < 20; d++) groupTechDaily(st, weak);
  check(!groupKnows(st, weak, "machinist") && groupTech(weak).held.includes("machinist"), "no one at the manual's skill: it waits unstudied");
  // Found while scavenging, at your odds: a crash site's cargo 25% an hour at full loot.
  const tile = st.tiles.find((t) => t.loc && t.loc.type && CRASH_BP.crash_cargo && siteBlueprints(t.loc.type).length);
  let finds = 0, tries = 0;
  if (tile) {
    const old = tile.loc.type; tile.loc.type = "crash_cargo"; tile.loot = 1;
    for (let hh = 0; hh < 400; hh++) { st.hour = hh; const g = { name: `S${hh}`, type: "raider", pop: 10, bases: [] }; tries++; if (groupFindBlueprint(st, g, tile.id, "t")) finds++; }
    tile.loc.type = old;
  }
  check(tile && finds / tries > 0.17 && finds / tries < 0.33, `a crash site's cargo: a manual in ${finds} of ${tries} search hours (your 25%)`);
  // Bought from a traders group they are not hostile to.
  const stb = W(13);
  const seller = stb.factions.find((f) => f.alive && f.type === "traders");
  const buyer = seller && stb.factions.find((f) => f.alive && f.type !== "traders" && relation(stb, f, seller) > TECH.buyRel);
  const foe = seller && stb.factions.find((f) => f.alive && f.type !== "traders" && relation(stb, f, seller) <= TECH.buyRel);
  if (buyer && seller) {
    buyer.tech = { known: [], held: [], study: {} }; buyer.stock.scrap = 2000;
    let bought = 0;
    for (let d = 0; d < 120; d++) { stb.hour = d * 24; const n0 = groupTech(buyer).held.length + groupTech(buyer).known.length; groupTechDaily(stb, buyer); if (groupTech(buyer).held.length + groupTech(buyer).known.length > n0) bought++; }
    check(bought >= 2 && bought <= 12 && buyer.stock.scrap < 2000, `bought from the traders: ${bought} manuals in 120 days (scrap 2000 → ${buyer.stock.scrap})`);
    if (foe) { foe.tech = { known: [], held: [], study: {} }; for (let d = 0; d < 120; d++) { stb.hour = d * 24; groupTechDaily(stb, foe); } check(!groupTech(foe).held.length && !groupTech(foe).known.length, `${foe.type}: the traders will not sell to them (relation ${relation(stb, foe, seller)})`); }
  } else check(true, "no traders group in this world");
}

// ---------- 2. power on and off: base.freezerOn, the unattended generator ----------
{
  console.log("Power on and off (no operator)");
  const st = W();
  const h = quietHub(st);
  const fz = addBuilding(h, "freezer");
  refreshPower(st, h);
  check(h.freezerOn === false && !isPowered(h, fz), "no generator: off");
  check(!logCount(st, /freezer at .* is off/), "no off line in its first hour (a blip says nothing)");
  st.hour++; refreshPower(st, h);
  check(lastLog(st, /freezer at .* is off: there is no generator/), "the log says why once it lasts (no generator)");
  check(/no generator/.test(freezerLine(st, h)), `the buildings line says why (${freezerLine(st, h)})`);
  const room = storeSpaces(h).filter((s) => /freezer/.test(s.key));
  check(room.length === 1 && room[0].kind === "dry" && room[0].cap === STORE.freezer, "off: its 300 room keeps like a pantry");
  check(!BUILDINGS.generator.station && !stations(h).some((x) => x.type === "generator"), "the generator is no workshop station");
  const gen = addBuilding(h, "generator");
  const fuel0 = h.stock.fuel;
  refreshPower(st, h);
  check(atBase(st, h.id).every((s) => s.role !== "operate"), "nobody on the Operate role");
  check(h.freezerOn === true && h.freezersOn === 1 && isPowered(h, fz), "it runs by itself: the freezer is on");
  check(near(h.stock.fuel, fuel0 - POWER.tank) && h.refuel && h.refuel.day === day(st) && h.refuel.by != null, `the morning's refuelling filled its tank from the stores (${fuel0} → ${h.stock.fuel}, by ${h.refuel && h.refuel.name})`);
  check(near(gen.tank, POWER.tank - POWER.genFuel / 24), `and it burned this hour's fuel from the tank (${gen.tank})`);
  check(lastLog(st, /freezer at .* is cold again/), "the log says it is cold again");
  check(powerStatus(st, h).demand === POWER_USERS.freezer.need, `the freezer draws ${POWER_USERS.freezer.need} power`);
  const t1 = gen.tank;
  refreshPower(st, h);
  check(gen.tank === t1, "called again the same hour: no more fuel burned");
  st.hour++; refreshPower(st, h);
  check(near(t1 - gen.tank, POWER.genFuel / 24) && near(h.stock.fuel, fuel0 - POWER.tank), `the next hour: 1/${24 / POWER.genFuel} fuel from the tank, none from the stores (refuelled once a day)`);
  const on = storeSpaces(h).find((s) => s.key === "freezer");
  check(on && on.kind === "freezer" && on.cap === STORE.freezer, "on: its room is the freezer's");
  setFood(h, 250, "f_venison"); // fresh food by type (sim/foods.js): it needs a cold room
  const fs = foodStore(st, h);
  const sp = fs.spaces.find((s) => s.key === "freezer");
  const cellar = fs.spaces.find((s) => s.key === "cellar");
  check(fs.spaces[0].key === "freezer" && Math.abs(sp.held - 250) < 1e-6, "the fresh food goes into the freezer first (the coldest room)");
  check(cellar && sp.factor === FACTOR.freezer && FACTOR.freezer * 19 < FACTOR.dry && sp.factor * 5 < cellar.factor, `and keeps ~20× longer than at room temperature, several times a cellar (×${sp.factor} of its shelf a day against ×${cellar && cellar.factor.toFixed(2)})`);
  // No fuel in the stores: it runs its tank out (a day and a half's running), then it is off.
  h.stock.fuel = 0;
  let onHours = 0;
  const full = Math.round(POWER.tank * 24 / POWER.genFuel); // hours a full tank runs
  for (let i = 0; i < full + 6; i++) { st.hour++; refreshPower(st, h); if (h.freezerOn) onHours++; }
  check(onHours >= full - 3 && onHours <= full - 1 && h.freezerOn === false && gen.tank === 0, `no fuel to refuel with: the tank lasts its ${full} hours (${onHours} more hours on), then off`);
  check(/tank is dry/.test(freezerLine(st, h)) && /no fuel/.test(freezerLine(st, h)), `the buildings line says why (${freezerLine(st, h)})`);
  check(lastLog(st, /thawing/) && logCount(st, /freezer at .* is off/) === 2, "the log: the food is thawing (one line for this outage)");
  st.hour++; refreshPower(st, h);
  check(logCount(st, /freezer at .* is off/) === 2, "and no more while it stays off");
  h.stock.fuel = 40;
  if (st.hour % 24 < REFUEL.from) st.hour += REFUEL.from - (st.hour % 24);
  refreshPower(st, h);
  check(h.freezerOn === true && near(h.stock.fuel, 40 - POWER.tank), "fuel back: refuelled that hour, on");
  // The reserve (the Power card's Keep N fuel; it was the generator's Keep-at-least order): no fill from it.
  setGenReserve(h, 40, "player");
  gen.tank = 0;
  st.hour += 24; refreshPower(st, h);
  check(h.freezerOn === false && h.stock.fuel === 40 - POWER.tank && /kept back/.test(freezerLine(st, h)), `the stock at the reserve: no refuelling, the tank dry (${freezerLine(st, h)})`);
  setGenReserve(h, 10, "player");
  refreshPower(st, h);
  check(h.freezerOn === true && near(gen.tank, POWER.tank - POWER.genFuel / 24), "fuel above the reserve: refuelled and on");
  // Switched off by hand: the freezer, or the generator.
  h.powerOff = { [fz.id]: true };
  refreshPower(st, h);
  check(h.freezerOn === false && /switched off/.test(freezerLine(st, h)), "the freezer switched off by hand: off");
  h.powerOff = { [gen.id]: true };
  refreshPower(st, h);
  check(h.freezerOn === false && /generator is switched off/.test(freezerLine(st, h)), `the generator switched off: off (${freezerLine(st, h)})`);
  h.powerOff = {};
  refreshPower(st, h);
  // Not enough power: a second freezer, a machine shop and the rest on one generator.
  for (const t of ["freezer", "radio", "floodlights"]) addBuilding(h, t);
  refreshPower(st, h);
  check(h.freezersOn === 2 && h.freezerOn, `two freezers (4) and the rest (2) on one generator's 6 (${h.freezersOn} on)`);
  // The vacuum sealer hook.
  const se = addBuilding(h, "sealer");
  refreshPower(st, h);
  check(!hasSealer(st, h), "no power left for the sealer: hasSealer false");
  h.buildings = h.buildings.filter((x) => x.type !== "floodlights" && x.type !== "radio");
  refreshPower(st, h);
  check(hasSealer(st, h) && isPowered(h, se), "power for it: hasSealer true");
  breakFixture(st, h, se, "worn out", { card: false, quiet: true });
  refreshPower(st, h);
  check(!hasSealer(st, h), "broken: hasSealer false");
  // No freezer any more: the flag goes.
  h.buildings = h.buildings.filter((x) => x.type !== "freezer");
  refreshPower(st, h);
  check(h.freezerOn === undefined, "no freezer: no flag");
}

// ---------- 3. breakdowns and repair ----------
{
  console.log("Breakdowns and repairs");
  const st = W();
  const h = quietHub(st);
  const fz = addBuilding(h, "freezer");
  const gen = addBuilding(h, "generator");
  const [, b] = atBase(st, h.id);
  refreshPower(st, h);
  check(h.freezerOn, "on to start with");
  breakFixture(st, h, fz, "worn out", { card: false });
  refreshPower(st, h);
  check(h.freezerOn === false && /broken/.test(freezerLine(st, h)), `broken: off (${freezerLine(st, h)})`);
  check(powerStatus(st, h).demand === 0, "a broken freezer draws nothing");
  check(storeSpaces(h).some((s) => s.key === "freezeroff" && s.cap === STORE.freezer), "a broken freezer keeps its room (as a pantry)");
  let plan = repairPlan(st, h, fz, "repair");
  check(!plan.ok && /Mechanics 3/.test(plan.why), `a proper repair needs Mechanics 3 (${plan.why})`);
  b.skills.mechanics = 5; b.role = "build";
  plan = repairPlan(st, h, fz, "repair");
  check(plan.ok && plan.cost.parts === FIXTURES.freezer.repair.cost.parts, `and machine parts (${JSON.stringify(plan.cost)})`);
  const p0 = h.stock.parts;
  startRepair(st, h, fz, "repair");
  check(h.stock.parts === p0 - FIXTURES.freezer.repair.cost.parts, "the repair takes the parts");
  st.hour = Math.ceil(st.hour / 24) * 24 + 8;
  for (let i = 0; i < 30 && fz.broken; i++) { breakdownsHour(st); st.hour++; }
  check(!fz.broken && fz.wear === WEAR.repairWear && fz.lastBroke != null, "repaired: wear back down, the last breakdown kept");
  refreshPower(st, h);
  check(h.freezerOn, "and on again");
  // Wear: only on days it has power.
  const wOn = dailyWear(st, h, fz, null);
  h.stock.fuel = 0; gen.tank = 0; st.hour += 24; refreshPower(st, h);
  const wOff = dailyWear(st, h, fz, null);
  check(wOn >= FIXTURES.freezer.use * 0.6 && wOff < wOn / 5, `it wears while on (${wOn.toFixed(2)}), hardly while off (${wOff.toFixed(2)})`);
  // The generator wears by the days it ran (no operator any more), hardly on the days it stood.
  const gOff = dailyWear(st, h, gen, null);
  h.stock.fuel = 40; refreshPower(st, h);
  const gOn = dailyWear(st, h, gen, null);
  check(machineRan(st, h, gen) && gOn >= FIXTURES.generator.use * 0.6 && gOff < gOn / 5, `the generator wears on the days it runs (${gOn.toFixed(2)}), hardly while it stands (${gOff.toFixed(2)})`);
  // A broken generator: the freezer is off; its repair needs Mechanics 3 and parts.
  breakFixture(st, h, gen, "worn out", { card: false, quiet: true });
  refreshPower(st, h);
  check(h.freezerOn === false && /generator is broken/.test(freezerLine(st, h)), `a broken generator: the freezer is off (${freezerLine(st, h)})`);
  const gp = repairPlan(st, h, gen, "repair");
  check(gp.min === 3 && gp.cost.parts === FIXTURES.generator.repair.cost.parts, `a generator's repair: Mechanics ${gp.min}, ${gp.cost.parts} parts`);
}

// ---------- 4. spares upkeep ----------
{
  console.log("Spares");
  const st = W();
  const h = quietHub(st);
  const fz = addBuilding(h, "freezer");
  const gen = addBuilding(h, "generator");
  refreshPower(st, h);
  check(machineRan(st, h, fz), "a freezer with power counts as running");
  const p0 = h.stock.parts;
  for (let i = 0; i < FIXTURES.freezer.spares; i++) useSpares(st, h, fz);
  check(h.stock.parts === p0 - 1 && st.stats.partsUpkeep >= 1, `a spare part every ${FIXTURES.freezer.spares} days it runs (${p0 - h.stock.parts} used)`);
  h.stock.parts = 0;
  for (let i = 0; i < FIXTURES.freezer.spares; i++) useSpares(st, h, fz);
  check(fz.noSpares === true && lastLog(st, /needs a spare machine part/), "no part anywhere: it runs on worn bits (one log line)");
  const w = dailyWear(st, h, fz, null);
  h.stock.parts = 3;
  useSpares(st, h, fz);
  check(!fz.noSpares && h.stock.parts === 2 && dailyWear(st, h, fz, null) < w - 2, "a part in: paid, and the extra wear stops");
  h.stock.fuel = 0; gen.tank = 0; st.hour += 24; refreshPower(st, h);
  const s0 = fz.spares;
  useSpares(st, h, fz);
  check(fz.spares === s0, "no spares used on a day it was off");
  // The machine table: every machine needs parts somewhere, the plain buildings never.
  for (const t of ["generator", "well", "still", "machine_shop", "ammo_bench", "reload_bench", "radio", "relay", "garage", "floodlights", "freezer", "sealer", "canner"]) check(isMachine(t), `${t} is a machine (${machineText(t)})`);
  for (const t of ["walls", "cellar", "bunkhouse", "smoker", "cistern", "boiler", "coldstore"]) check(!isMachine(t) && !(BUILDINGS[t].cost.parts), `${t} takes no parts`);
  check(FIXTURES.garage.age > 0 && !FIXTURES.garage.raidOnly && FIXTURES.floodlights.attack > 0, "the garage wears with age, floodlights in attacks");
}

// ---------- 5. the cold store: an ice house again ----------
{
  console.log("The cold store");
  const st = W();
  const h = quietHub(st);
  const cs = addBuilding(h, "coldstore");
  addBuilding(h, "generator"); addBuilding(h, "freezer");
  refreshPower(st, h);
  check(!POWER_USERS.coldstore && !powerStatus(st, h).users.some((u) => u.b === cs) && !isPowered(h, cs), "it draws no power with a generator running");
  const sp = storeSpaces(h).find((s) => s.key === "coldstore");
  check(sp && sp.kind === "cold" && sp.name === "Cold store" && sp.cap === STORE.coldStore, `an ice house's room, powered or not (${JSON.stringify(sp)})`);
  check(FIXTURES.coldstore.raidOnly && !FIXTURES.coldstore.power && !machineRan(st, h, cs), "it wears only from raid damage, no machine");
  check(!/power/i.test(BUILDINGS.coldstore.desc) && !/cold store/i.test(BUILDINGS.generator.desc), "no power in its text, none in the generator's");
}

// ---------- 6. crafting with parts, the pressure canner fitted to a kitchen ----------
{
  console.log("Crafting with parts, the pressure canner");
  const st = W();
  const h = quietHub(st);
  addBuilding(h, "workbench");
  const [a, b2] = atBase(st, h.id);
  a.skills.mechanics = 5; a.skills.crafting = 5; a.role = "craft";
  for (const k of ["fishrod", "beartrap"]) {
    const r = CRAFTS[k];
    check(r.in.parts >= 1, `${k} takes machine parts (${JSON.stringify(r.in)})`);
    const p0 = h.stock.parts;
    const ok = canCraft(st, h, k);
    check(ok.ok, `${k} can be made here (${ok.reason || ""})`);
    queueCraft(st, h, k);
    check(h.stock.parts === p0 - r.in.parts, `${k}: the parts are paid when it is queued`);
  }
  check(craftQueue(h).length === 2 && !CRAFTS.canner, "two jobs queued; the canner is no recipe any more");
  for (const k of ["crossbow", "pipegun", "flashlight", "spotlight", "suppressor", "bicycle", "repairkit", "pulleybow"]) check(CRAFTS[k].in.parts >= 1, `${k} (a mechanism) takes parts`);
  // The upgrade: a preserving room fitted with a pressure canner where it stands.
  const D = BUILDINGS.canner;
  check(D.upgradeOnly && D.from === "kitchen" && D.cost.parts >= 2 && D.req.mechanics === 3, `an upgrade of the kitchen, machine parts and Mechanics 3 (${JSON.stringify(D.cost)})`);
  check(!canBuild(st, h, "canner").ok && /preserving room/.test(canBuild(st, h, "canner").reason), "never built on its own");
  const k1 = addBuilding(h, "kitchen");
  a.skills.mechanics = 2;
  let chk = canUpgradeKitchen(st, h, k1.id);
  check(!chk.ok && /Mechanics 3/.test(chk.reason), `no Mechanics 3 here: refused (${chk.reason})`);
  a.skills.mechanics = 5;
  const parts0 = h.stock.parts;
  h.stock.parts = 1;
  check(!canUpgradeKitchen(st, h, k1.id).ok, "short of parts: refused");
  h.stock.parts = parts0;
  const p0 = h.stock.parts, s0 = h.stock.scrap;
  check(canUpgradeKitchen(st, h, k1.id).ok, "with all of it: ok");
  queueCannerUpgrade(st, h, k1.id);
  check(h.stock.parts === p0 - D.cost.parts && h.stock.scrap === s0 - D.cost.scrap && h.construction.some((c) => c.type === "canner" && c.target === k1.id), "queued: the parts and scrap paid");
  check(countAll(h, "kitchen") === 1 && canBuild(st, h, "kitchen").ok === canBuild(st, h, "kitchen").ok, "the fitting is no new kitchen");
  check(!canUpgradeKitchen(st, h, k1.id).ok, "not twice");
  for (const s of atBase(st, h.id)) s.role = "build";
  for (let i = 0; i < 100 && !k1.canner; i++) constructionHour(st);
  check(k1.canner === true && count(h, "kitchen") === 1, "the builders fit it: the kitchen is still a kitchen (key kept), marked with its canner");
  b2.role = "operate"; b2.station = k1.id; b2.skills.farming = 3;
  const k2 = addBuilding(h, "kitchen");
  const withC = stationIO(st, h, k1, b2).out.f_jarred, without = stationIO(st, h, k2, b2).out.f_jarred;
  check(withC === without + CANNER.out, `the kitchen with the canner jars +${CANNER.out} a day (${withC} against ${without}), the other kitchen not`);
  check(recipeOutput(b2, "preserve", h, st, k1).f_jarred === recipeOutput(b2, "preserve", h, st, k2).f_jarred + CANNER.out, "recipeOutput by the station");
  check(fxDef(k1) === FIXTURES.canner && fxDef(k2) === FIXTURES.kitchen && FIXTURES.canner.repair.cost.parts >= 1 && FIXTURES.canner.spares > 0, "the fitted kitchen wears like a machine: a part to repair, spares");
  // A canner in the armory pays for a fitting; cancelled, it goes back.
  h.armory.push(makeItem("canner", 0.9));
  const pp = h.stock.parts;
  chk = canUpgradeKitchen(st, h, k2.id);
  check(chk.ok && chk.item, "a canner in the armory: it can be fitted with it");
  const job0 = h.construction.length;
  queueCannerUpgrade(st, h, k2.id);
  check(h.stock.parts === pp && !h.armory.some((it) => it && it.key === "canner") && h.construction.length === job0 + 1, "no materials: the canner from the armory");
  cancelBuild(st, h, h.construction[h.construction.length - 1].id);
  check(h.armory.some((it) => it && it.key === "canner") && h.stock.parts === pp, "cancelled: the canner back in the armory");
}

// ---------- 7. old saves: generators without operators, canners fitted ----------
{
  console.log("Save migration");
  const st = W(3);
  const h = quietHub(st);
  const gen = addBuilding(h, "generator"), fz = addBuilding(h, "freezer"), k = addBuilding(h, "kitchen"), am = addBuilding(h, "ammo_bench");
  const [a, b, c] = atBase(st, h.id);
  // As a save from before machines-2 had it: an operator on the generator, a keeper, the operator-day mark, today's
  // fuel paid, a Keep-at-least order on the generator, a fallback onto it, a canner in the armory and one in the craft queue.
  a.role = "operate"; a.station = gen.id;
  c.role = "operate"; c.station = gen.id + 9999; // a stale station: assignStations takes care of it as before
  gen.opDay = day(st); gen.fueled = day(st); h.genKeeper = a.id;
  h.orders = { [gen.id]: { mode: "keep", key: "fuel", n: 25, by: "player", fallback: "idle" }, [am.id]: { mode: "until", n: 100, fallback: `st:${gen.id}` } };
  h.armory.push(makeItem("canner", 0.9), makeItem("canner", 0.8));
  h.crafting = [{ id: 777, recipe: "canner", progress: 2, hours: 10 }];
  const scrap0 = h.stock.scrap, parts0 = h.stock.parts;
  delete st.machinesV;
  const S = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const H = hub(S), G = H.buildings.find((x) => x.type === "generator"), K = H.buildings.find((x) => x.type === "kitchen"), A = S.survivors.find((x) => x.id === a.id);
  check(S.machinesV === 1, "marked migrated");
  check(A.role !== "operate" || (A.station !== G.id && H.buildings.some((x) => x.id === A.station)), `the generator's operator back to the next job (${A.role}${A.station ? ` at ${H.buildings.find((x) => x.id === A.station).type}` : ""})`);
  check(!S.survivors.some((x) => x.station === G.id), "nobody operates a generator");
  check(H.genKeeper === undefined && G.opDay === undefined && G.fueled === undefined && G.tank === POWER.genFuel, `the keeper and the operator-day gone; today's paid fuel in its tank (${G.tank})`);
  check(!H.orders[G.id] && H.genReserve && H.genReserve.n === 25 && H.genReserve.by === "player", `the Keep 25 fuel order is the fuel reserve now (${JSON.stringify(H.genReserve)})`);
  check(H.orders[am.id].fallback === "idle", "a fallback onto the generator goes to Idle");
  check(K.canner === true && H.armory.filter((it) => it && it.key === "canner").length === 1, "one canner fitted to the kitchen, the other kept in the armory (no second kitchen)");
  check(!H.crafting.some((j) => j.recipe === "canner") && H.stock.scrap === scrap0 + 4 && H.stock.parts === parts0 + 2, "the canner in the craft queue cancelled, its 4 scrap and 2 parts back");
  // It runs: the freezer on with nobody on the generator.
  S.tech = S.tech || { known: [], progress: {}, found: {} };
  for (let i = 0; i < 3; i++) tickHour(S);
  check(H.freezerOn === true, "loaded, the freezer runs on the unattended generator");
  // A second load does nothing more.
  const S2 = deserializeState(JSON.parse(JSON.stringify(serializeState(S))));
  check(hub(S2).armory.filter((it) => it && it.key === "canner").length === 1 && hub(S2).genReserve.n === 25, "loaded again: nothing migrated twice");
  void fz; void b;
}

// ---------- 8. an AI group's machines and their machine parts ----------
{
  console.log("AI groups");
  const st = W(9);
  const f = st.factions.find((x) => x.alive && !x.hcMilitary);
  groupTech(f).known.push("genschem", "refrig", "machinist"); // studied (the manuals' rules: above)
  const tile = f.bases[0];
  f.pop = 20;
  Object.assign(f.stock, { fuel: 30, parts: 20, scrap: 100 }); setFood(f, 600);
  const w = worksAt(f, tile);
  Object.assign(w, { water: 3, farms: 3, beds: 3, walls: 6, bench: 1, store: 1, sickbay: 4, pens: 1 });
  f.jails = { [tile]: 3 };
  const built = [];
  for (let i = 0; i < 60 && !w.freezer; i++) {
    const nw = !f.job ? nextWork(st, f) : null;
    if (nw && !built.includes(nw.type)) built.push(nw.type);
    groupWorksDaily(st, f);
    setFood(f, 600); // keep them fed (the test is the machines)
  }
  check(w.still && w.power && w.freezer, `they build a still, a generator and a freezer (${built.join(", ")})`);
  const fuel0 = f.stock.fuel;
  st.hour += 24;
  groupWorksDaily(st, f);
  check(groupFreezerOn(f), "their freezer runs");
  check(/walk-in freezer \(on\)/.test(worksText(st, f)), `the Groups tab says so (${worksText(st, f)})`);
  check(f.stock.fuel <= fuel0 + GROUP_WORKS.MACH.still.fuel - POWER.genFuel + 1e-9, `the generator burns fuel (${fuel0} → ${f.stock.fuel})`);
  f.stock.fuel = 0.5;
  setFood(f, GROUP_WORKS.MACH.foodDays * f.pop - 1); // no surplus for the still either
  st.hour += 24;
  groupWorksDaily(st, f);
  check(groupFreezerOn(f) && f.stock.fuel === 0, "coarse fuel: the last half a fuel runs the day");
  st.hour += 24;
  groupWorksDaily(st, f);
  check(!groupFreezerOn(f), "no fuel: their freezer is off");
  f.stock.fuel = 30; setFood(f, 600);
  w.mach.freezer.broken = true;
  const p0 = f.stock.parts;
  st.hour += 24;
  groupWorksDaily(st, f);
  check(!w.mach.freezer.broken && f.stock.parts <= p0 - FIXTURES.freezer.repair.cost.parts + 1, `broken: repaired the next day with parts (${p0} → ${f.stock.parts})`);
  // Wear to a breakdown.
  w.mach.freezer.wear = WEAR.breakAt - 0.1;
  st.hour += 24;
  groupWorksDaily(st, f);
  check(w.mach.freezer.broken || w.mach.freezer.wear < WEAR.breakAt, "worn out: it breaks");
  check(groupMachineCount(f) >= 3 && groupPartsTarget(f) >= groupMachineCount(f) + 4, `their machines raise the parts they buy (${groupPartsTarget(f)})`);
  // Spares.
  f.stock.parts = 10;
  w.mach.freezer.broken = false; w.mach.freezer.wear = 10; w.mach.freezer.spares = 0.99;
  st.hour += 24;
  groupWorksDaily(st, f);
  check(f.stock.parts <= 10, "a spare part for the running freezer");
  // The sealer comes next with the parts.
  f.stock.parts = 20;
  for (let i = 0; i < 20 && !w.sealer; i++) { st.hour += 24; groupWorksDaily(st, f); setFood(f, 600); f.stock.fuel = 30; }
  st.hour += 24; groupWorksDaily(st, f);
  check(w.sealer && groupSealer(f), "and a vacuum sealer (the groupSealer hook)");
  // The freezer waits for the blueprint: a group that does not know refrigeration builds the still and stops there.
  const st3 = W(9);
  st3.hour = 24;
  const g = st3.factions.find((x) => x.alive && !x.hcMilitary && !groupKnows(st3, x, "genschem"));
  if (g) {
    g.pop = 20;
    Object.assign(g.stock, { food: 600, fuel: 30, parts: 20, scrap: 100 });
    const w3 = worksAt(g, g.bases[0]);
    Object.assign(w3, { water: 3, farms: 3, beds: 3, walls: 6, bench: 1, store: 1, sickbay: 4, pens: 1 });
    g.jails = { [g.bases[0]]: 3 };
    for (let i = 0; i < 40; i++) { groupWorksDaily(st3, g); setFood(g, 600); g.stock.parts = 20; }
    check(w3.still && !w3.power && !w3.freezer, `${g.type}: no Generator Schematics yet, a still but no generator or freezer`);
  } else check(true, "every group here knows refrigeration from the start");
  // Their machine parts: a workshop makes them from scrap, by the mechanic and the people, up to what they want.
  const st4 = W(9);
  const h4 = st4.factions.find((x) => x.alive && !x.hcMilitary);
  h4.type = "traders"; h4.pop = 16; setMech(st4, h4, 4); // mechanic 4
  Object.assign(h4.stock, { parts: 0, scrap: 200 });
  h4.works = {}; const w4 = worksAt(h4, h4.bases[0]);
  check(partsRate(st4, h4) === 0, "no workshop: no parts");
  w4.bench = 1;
  check(partsRate(st4, h4) === 0, "a workshop but no machine shop: no parts (ai-locks: your machine shop)");
  w4.shop = 1;
  check(near(partsRate(st4, h4), GROUP_WORKS.PARTS.rate), `a machine shop, 16 people, mechanic 4: ${GROUP_WORKS.PARTS.rate} a day`);
  let made = 0;
  for (let i = 0; i < 20; i++) made += groupPartsDaily(st4, h4);
  check(made === 5 && h4.stock.parts === 5 && near(h4.stock.scrap, 200 - 20 * GROUP_WORKS.PARTS.rate * GROUP_WORKS.PARTS.scrap), `20 days: ${made} parts for ${200 - h4.stock.scrap} scrap`);
  h4.type = "military"; h4.pop = 25; setMech(st4, h4, 6);
  check(near(partsRate(st4, h4), GROUP_WORKS.PARTS.rate * GROUP_WORKS.PARTS.popMax), `the military of 25: ${partsRate(st4, h4).toFixed(2)} a day (their Mechanics 6 makes no more than a 4: your station's rule)`);
  h4.type = "commune"; h4.pop = 16; setMech(st4, h4, 3);
  check(near(partsRate(st4, h4), GROUP_WORKS.PARTS.rate * GROUP_WORKS.PARTS.below), `a commune of 16 (mechanic 3, a shop taken over): ${partsRate(st4, h4).toFixed(3)} a day, half (your Mechanics 4 rule)`);
  h4.pop = 6;
  check(partsRate(st4, h4) < GROUP_WORKS.PARTS.rate / 2, `a commune of 6: ${partsRate(st4, h4).toFixed(2)} a day`);
  h4.type = "traders"; h4.pop = 16; setMech(st4, h4, 4);
  h4.stock.parts = partsWant(st4, h4);
  check(groupPartsDaily(st4, h4) === 0 && !(h4.partsWip > 1), `at what they want (${partsWant(st4, h4)}): no more`);
  h4.stock.parts = 0; h4.stock.scrap = 16;
  check(groupPartsDaily(st4, h4) === 0 && h4.stock.scrap === 16, "their scrap at a scrap a head: none taken");
  // The earmark: the workshop's parts are for the machines; guns, kit, trade use only the parts above it; a vehicle
  // repair may take them at two for one.
  Object.assign(h4.stock, { parts: 0, scrap: 200 }); h4.partsMach = 0; h4.partsWip = 0;
  for (let i = 0; i < 8; i++) groupPartsDaily(st4, h4);
  check(h4.stock.parts === 2 && groupMachParts(h4) === 2 && groupFreeParts(h4) === 0, "8 days at the workshop: 2 parts, both kept for the machines");
  check(!canPayParts(h4, 1, "free") && canPayParts(h4, 1, "machine") && canPayParts(h4, 1, "vehicle") && !canPayParts(h4, 2, "vehicle") && available(h4, "parts") === 0, "not for guns, kit or trade; a machine may; a vehicle at two for one");
  payParts(h4, 1, "vehicle");
  check(h4.stock.parts === 0 && groupMachParts(h4) === 0, "a vehicle repair took both kept parts for its one");
  h4.stock.parts = 5; h4.partsMach = 2; // 3 bought, 2 from the workshop
  check(groupFreeParts(h4) === 3 && available(h4, "parts") === 3, "3 bought ones are free (for sale too)");
  payParts(h4, 1, "machine");
  check(h4.stock.parts === 4 && groupMachParts(h4) === 1, "a machine takes the kept ones first");
  payParts(h4, 3, "free");
  check(h4.stock.parts === 1 && groupMachParts(h4) === 1 && !payParts(h4, 1, "free"), "the rest goes where it likes; the kept one stays");
  h4.stock.parts = partsWant(st4, h4) + 5; h4.partsMach = 0;
  check(groupPartsDaily(st4, h4) >= 0 && h4.partsWip > 0, "the workshop runs while the kept parts are short, whatever else is in the stores");
}

// ---------- 9. an unattended generator: the refuelling chore, nobody home ----------
{
  console.log("The refuelling chore");
  const st = W();
  const h = quietHub(st);
  addBuilding(h, "freezer");
  const gen = addBuilding(h, "generator");
  const people = atBase(st, h.id);
  people[0].role = "farm"; people[1].role = "scavenge";
  refreshPower(st, h);
  check(h.freezerOn && h.refuel.by === people[1].id, `the least busy hand refuels it (a scavenger before a farmer: ${h.refuel.name})`);
  const builder = people[0];
  builder.role = "build"; h.construction.push({ id: 991, type: "walls", progress: 0, hours: 50 });
  builder.chore = { what: "refuel", hour: st.hour - 1, base: h.id };
  check(choreShare(st, builder) === 1 - REFUEL.hours, `a builder on a job who refuelled builds the next hour at ${1 - REFUEL.hours}`);
  const r1 = buildRate(st, h);
  delete builder.chore;
  check(buildRate(st, h) > r1, "the build rate shows it");
  h.construction = [];
  // Everyone in a bed (or away, or resting sick): nobody refuels; it runs its tank out (a day and a half), then dry.
  for (const s of people) s.inBed = true;
  check(!refueller(st, h), "nobody able at the base");
  const fuel0 = h.stock.fuel;
  let onH = 0;
  const full = Math.round(POWER.tank * 24 / POWER.genFuel);
  for (let i = 0; i < full + 12; i++) { st.hour++; refreshPower(st, h); if (h.freezerOn) onH++; }
  check(onH >= full - 3 && onH <= full - 1 && !h.freezerOn && h.stock.fuel === fuel0, `nobody home: it runs ${onH} more hours on its tank (${full} full), then dry; the stores untouched`);
  check(/nobody able/.test(freezerLine(st, h)), `the line says why (${freezerLine(st, h)})`);
  people[2].inBed = false;
  if (st.hour % 24 < REFUEL.from) st.hour += REFUEL.from - (st.hour % 24);
  refreshPower(st, h);
  check(h.freezerOn && h.refuel.by === people[2].id && gen.tank > 0, "someone up again: refuelled, on");
  for (const s of people) s.inBed = false;
  // A late refuelling never leaves a gap: filled at 11:00, everyone abed the next morning until 13:00, it runs on.
  gen.tank = 0; st.hour = Math.ceil(st.hour / 24) * 24 + 11; refreshPower(st, h);
  check(h.refuel.hour % 24 === 11 && h.freezerOn, "refuelled late, at 11:00");
  let gap = 0;
  for (let i = 0; i < 26; i++) { st.hour++; const hr = st.hour % 24; for (const s of people) s.inBed = hr >= 0 && hr < 13 && i > 12; refreshPower(st, h); if (!h.freezerOn) gap++; }
  for (const s of people) s.inBed = false;
  check(gap === 0 && h.refuel.hour % 24 === 13, `the next day's refuelling at 13:00 comes before the tank runs dry (${gap} hours off)`);
}

// ---------- 10. governor runs: the freezer kept on with nobody operating the generator ----------
for (const seed of [42, 7]) {
  const st = W(seed);
  const h = hub(st);
  delete h.tier; delete h.camp;
  const gen = addBuilding(h, "generator"); addBuilding(h, "freezer");
  Object.assign(h.stock, { fuel: 80, parts: 20 });
  setAutopilot(st, true, "balanced");
  let hours = 0, onHours = 0, ops = 0;
  const refDays = new Set();
  const days = 10;
  const fuelStart = h.stock.fuel;
  while (day(st) <= days && !st.gameOver) {
    autopilotResolve(st);
    tickHour(st);
    if (day(st) >= 2) { hours++; if (h.freezerOn) onHours++; if (atBase(st, h.id).some((s) => s.station === gen.id)) ops++; if (h.refuel) refDays.add(h.refuel.day); }
  }
  const offs = logCount(st, /freezer at .* is off/), ons = logCount(st, /freezer at .* is cold again/);
  console.log(`  governor seed ${seed}: freezer on ${onHours}/${hours} hours from day 2, ${offs} off / ${ons} back-on lines, refuelled on ${refDays.size} days, fuel ${fuelStart} → ${Math.round(h.stock.fuel)}`);
  check(onHours >= hours * 0.95, `governor (seed ${seed}): the freezer on ${onHours} of ${hours} hours from day 2`);
  check(offs <= 2 && ons <= 2, `governor (seed ${seed}): ${offs} off and ${ons} back-on lines in ${days} days`);
  check(ops === 0 && h.genKeeper === undefined, `governor (seed ${seed}): nobody operates the generator`);
  check(refDays.size >= days - 1, `governor (seed ${seed}): refuelled every day (${refDays.size})`);
  check(h.genReserve && h.genReserve.by === "ai", `governor (seed ${seed}): it keeps a fuel reserve (${h.genReserve && h.genReserve.n})`);
}

// ---------- 11. a governor run ----------
for (const seed of seeds) {
  console.log(`Governor run (seed ${seed}, ${govDays} days)`);
  const st = W(seed);
  setAutopilot(st, true, "balanced");
  let bad = null;
  try {
    while (day(st) <= govDays && !st.gameOver) {
      autopilotResolve(st);
      tickHour(st);
      if (st.hour % 24 === 0) for (const b of st.bases) for (const [k, v] of Object.entries(b.stock)) if (typeof v === "number" && (!Number.isFinite(v) || v < -1e-6) && !(k === "food" && b.type === "outpost")) bad = bad || `day ${day(st)} ${b.name} ${k}=${v}`;
    }
  } catch (e) { bad = `crash day ${day(st)}: ${e.stack.split("\n").slice(0, 3).join(" | ")}`; }
  check(!bad, `no NaN or negative stock, no crash (${bad || "ok"})`);
  check(st.factions.every((f) => !f.works || Object.values(f.works).every((w) => !w.mach || Object.values(w.mach).every((m) => Number.isFinite(m.wear)))), "the groups' machines' wear is finite");
  check(st.factions.every((f) => Number.isFinite(f.stock.parts) && f.stock.parts >= 0), "the groups' parts are finite");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
