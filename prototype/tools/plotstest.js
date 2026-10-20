// Headless checks for construction plots, water barrels, storage crates, demolishing and housing (buildings.js PLOTS,
// WATER_BARREL, BEDS and the barracks; economy.js waterCapacity / rawRoom / waterLayout; storage.js storeSpaces;
// autopilot.js housingAI: barracks when plots are short, expansions, a cramped hub sending people to outposts).
// Usage: node tools/plotstest.js [seed]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, hub, newId, makeSurvivor } from "../src/sim/world.js";
import {
  BUILDINGS, PLOTS, addBuilding, canBuild, queueBuild, cancelBuild, constructionHour, plotCap, plotsUsed, plotsFree,
  barrels, barrelCap, barrelTier, barrelRoom, queueBarrelUpgrade, canUpgradeBarrel, setBarrelHolds, demolish, demolishRefund, SHELTER,
  BEDS, BARRACKS_UP, baseBeds, queuedBeds, count, canExpandBunkhouse, queueBunkhouseExpand, canDemolish, jobName,
} from "../src/sim/buildings.js";
import { housingAI } from "../src/sim/autopilot.js";
import { waterCapacity, tankCapacity, rawRoom, waterLayout, basesDaily } from "../src/sim/economy.js";
import { storeCapacity } from "../src/sim/storage.js";
import { RAW } from "../src/sim/water.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const W = () => createWorld({ seed, factionCount: 6 });
const rich = (b) => { Object.assign(b.stock, { scrap: 9999, parts: 999, meds: 999 }); setFood(b, 500); return b.stock; };
const mkOutpost = (st, tile) => {
  const b = { id: newId(), tile, type: "outpost", name: "Test Outpost", stock: { food: 0, water: 0, fuel: 0, meds: 0, ammo: 0, parts: 0, scrap: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  st.bases.push(b);
  return b;
};
// Finishes the whole queue at once (constructionHour with a huge build rate: a builder at the base, jobs pre-progressed).
const finishAll = (st, b) => { for (let i = 0; i < 50 && b.construction.length; i++) { for (const c of b.construction) c.progress = c.hours; constructionHour(st); } };
const bare = (b) => { b.buildings = []; b.construction = []; };
// Plain survivors with the skills every building asks for, so only the plots stand in the way.
const skilled = (st, b) => { const s = makeSurvivor(st, 1); s.location = { kind: "base", baseId: b.id }; s.role = "build"; for (const k of Object.keys(s.skills)) s.skills[k] = 10; st.survivors.push(s); return s; };

// 1. The plots by base size.
{
  console.log("Plots by base size");
  const st = W();
  const h = hub(st);
  check(plotCap(h, "building") === PLOTS.hub.building && plotCap(h, "utility") === PLOTS.hub.utility, "the hub has the hub's plots");
  const o = mkOutpost(st, h.tile);
  check(plotCap(o, "building") === PLOTS.outpost.building && plotCap(o, "utility") === PLOTS.outpost.utility, "an outpost has the outpost's plots");
  h.tier = 0;
  check(plotCap(h, "building") === 1 && plotCap(h, "utility") === 3, "a shelter has 1 building plot and 3 utility plots");
  check(PLOTS.hub.building > PLOTS.outpost.building && PLOTS.outpost.building > PLOTS.shelter.building && PLOTS.hub.utility > PLOTS.outpost.utility && PLOTS.outpost.utility > PLOTS.shelter.utility, "plots grow with the base");
  for (const [k, d] of Object.entries(BUILDINGS)) {
    if (d.piece || ["walls", "barricades", "spike_pits", "trench", "gate", "floodlights", "farm_plot", "hub_up", "outpost_up", "camp_up", "camo", "cots", "barbed_wire", "sandbag_wall", "razor_wire", "guard_towers", "minefield", "storebox"].includes(k) || d.general || d.fit) check(!d.plot, `${k} needs no plot`); // base building (2026-10-19): the general buildings stand on the map, no plot; the fittings inside them; the wall pieces anywhere; the storage box (base storage limits) anywhere
    else check(d.plot === "building" || d.plot === "utility", `${k} has a plot kind`);
  }
  for (const k of ["storehouse", "cellar", "bunkhouse", "infirmary", "cistern"]) check(BUILDINGS[k].plot === "building", `${k} is on a building plot`);
  for (const k of ["boiler", "water_barrel", "crates", "watchtower", "cookhouse"]) check(BUILDINGS[k].plot === "utility", `${k} is on a utility plot`);
}

// 2. Filling the plots: the next building is refused, walls still go up, a hospital upgrade keeps its plot.
{
  console.log("Filling the building plots");
  const st = W();
  const h = hub(st);
  bare(h); rich(h); skilled(st, h);
  const fill = ["bunkhouse", "bunkhouse", "bunkhouse", "bunkhouse", "bunkhouse", "bunkhouse", "cellar", "cellar", "storehouse", "common_room", "common_room", "chapel", "garage", "cells", "kitchen", "infirmary"]; // jailhouse: one jail a base (buildings.js family "jail"), so a kitchen takes the second plot;
  check(fill.length === PLOTS.hub.building, "the fill list is the hub's building plots");
  for (const t of fill) addBuilding(h, t);
  check(plotsUsed(h, "building") === PLOTS.hub.building && plotsFree(h, "building") === 0, "every building plot is in use");
  const chk = canBuild(st, h, "coldstore");
  check(!chk.ok && chk.noPlot && /building plot/.test(chk.reason), `a cold store is refused for want of a plot (${chk.reason})`);
  check(!canBuild(st, h, "walls").noPlot && !canBuild(st, h, "wall4", { mat: 1 }).noPlot, "walls need no plot (the Ring wall and its pieces)");
  check(canBuild(st, h, "boiler").ok, "the utility plots are separate");
  const up = canBuild(st, h, "field_hosp");
  check(up.ok, `the infirmary upgrades on its own plot (${up.reason || "ok"})`);
  queueBuild(st, h, "field_hosp");
  check(plotsUsed(h, "building") === PLOTS.hub.building, "a queued hospital upgrade takes no new plot");
  finishAll(st, h);
  check(h.buildings.some((b) => b.type === "field_hosp") && plotsUsed(h, "building") === PLOTS.hub.building, "the field hospital stands on the infirmary's plot");
  // Queued buildings take their plot at once.
  const st2 = W();
  const h2 = hub(st2);
  bare(h2); rich(h2);
  for (let i = 0; i < PLOTS.hub.utility; i++) queueBuild(st2, h2, i < 4 ? "rain_catcher" : i < 8 ? "water_barrel" : i < 12 ? "crates" : i < 13 ? "boiler" : "cookhouse");
  check(plotsUsed(h2, "utility") === PLOTS.hub.utility, `queued builds hold their plots (${plotsUsed(h2, "utility")})`);
  check(canBuild(st2, h2, "watchtower").noPlot, "the next utility waits for a plot");
}

// 3. Demolishing frees the plot and salvages half.
{
  console.log("Demolishing");
  const st = W();
  const h = hub(st);
  bare(h);
  const b = addBuilding(h, "storehouse");
  h.stock.scrap = 0;
  check(plotsUsed(h, "building") === 1, "one plot in use");
  const msg = demolish(st, h, b.id);
  check(!h.buildings.length && plotsUsed(h, "building") === 0, `the storehouse is gone and its plot free (${msg})`);
  check(h.stock.scrap === Math.floor(BUILDINGS.storehouse.cost.scrap / 2), `half the scrap comes back (${h.stock.scrap})`);
  const t = addBuilding(h, "watchtower");
  check(h.watchtower, "a watchtower flags the base");
  demolish(st, h, t.id);
  check(!h.watchtower, "pulled down, the flag goes with it");
  const r = addBuilding(h, "radio");
  demolish(st, h, r.id);
  check(!h.radio, "and the radio's");
  h.alert = true;
  const c = addBuilding(h, "cellar");
  check(/attack/.test(demolish(st, h, c.id)) && h.buildings.includes(c), "nothing is pulled down under attack");
}

// 4. The shelter: two utility plots, no buildings with roofs.
{
  console.log("The shelter");
  const st = W();
  const h = hub(st);
  bare(h); rich(h); skilled(st, h);
  h.tier = 0;
  check(canBuild(st, h, "bunkhouse").ok && plotCap(h, "building") === 1, "a bunkhouse on the shelter's one building plot");
  check(!canBuild(st, h, "storehouse").ok, "no storehouse at a shelter");
  for (const k of ["boiler", "water_barrel", "crates", "watchtower", "cookhouse", "rain_catcher"]) check(SHELTER.build[k] >= 1 && canBuild(st, h, k).ok, `a shelter can build a ${k}`);
  queueBuild(st, h, "water_barrel");
  queueBuild(st, h, "boiler");
  queueBuild(st, h, "cookhouse");
  const fourth = canBuild(st, h, "crates");
  check(!fourth.ok && fourth.noPlot, `a fourth utility waits (${fourth.reason})`);
  check(canBuild(st, h, "barricades").ok && canBuild(st, h, "farm_plot").ok, "a barricade and a garden patch need no plot");
}

// 5. Water barrels: tiers, upgrades, what they hold.
{
  console.log("Water barrels");
  const st = W();
  const h = hub(st);
  bare(h); rich(h); skilled(st, h);
  h.stock.water = 0; h.stock[RAW] = 0;
  const tanks = tankCapacity(h);
  for (let i = 0; i < 4; i++) queueBuild(st, h, "water_barrel");
  check(!canBuild(st, h, "water_barrel").ok, "at most 4 barrels");
  finishAll(st, h);
  check(barrels(h).length === 4 && barrels(h).every((b) => barrelTier(b) === 1 && b.holds === RAW), "4 tier-1 barrels holding un-purified water");
  check(waterCapacity(h) === tanks + 4 * 25, `4 barrels add 100 room (${waterCapacity(h)})`);
  const [b1, b2] = barrels(h);
  const scrap = h.stock.scrap;
  check(/queued/.test(queueBarrelUpgrade(st, h, b1.id)), "a barrel's upgrade is queued");
  check(h.stock.scrap === scrap - 8, "paid for");
  check(!canUpgradeBarrel(st, h, b1.id).ok, "one upgrade at a time per barrel");
  check(plotsUsed(h, "utility") === 4, "the upgrade takes no plot");
  check(!canBuild(st, h, "water_barrel").ok && /Limit/.test(canBuild(st, h, "water_barrel").reason), "and does not count as a fifth barrel");
  finishAll(st, h);
  check(barrelTier(b1) === 2 && barrelCap(b1) === 50, "tier 2: a barrel rack, 50");
  queueBarrelUpgrade(st, h, b1.id);
  finishAll(st, h);
  check(barrelTier(b1) === 3 && barrelCap(b1) === 100, "tier 3: a water tank, 100");
  check(!canUpgradeBarrel(st, h, b1.id).ok, "no tier 4");
  // Cancelling an upgrade gives its own cost back.
  queueBarrelUpgrade(st, h, b2.id);
  const job = h.construction[0];
  const s0 = h.stock.scrap;
  cancelBuild(st, h, job.id);
  check(h.stock.scrap === s0 + 8 && barrelTier(b2) === 1, "a cancelled upgrade refunds its cost");
  // Purified or un-purified.
  setBarrelHolds(h, b1.id, "water");
  check(barrelRoom(h, "water") === 100 && barrelRoom(h, RAW) === 75, "one tank set to purified");
  h.stock.water = 0; h.stock[RAW] = 0;
  check(rawRoom(h) === tanks + 75, `well water may use the tanks and the un-purified barrels only (${rawRoom(h)})`);
  h.stock[RAW] = tanks + 75;
  check(rawRoom(h) === 0, "full of un-purified water: no more room for it");
  h.stock.water = 100;
  check(waterLayout(h).outside === 0, "the purified tank still takes 100 safe water");
  h.stock.water = 120;
  check(waterLayout(h).outside === 20, `the rest stands outside (${waterLayout(h).outside})`);
  // The daily fill respects it: un-purified water never fills the purified tank.
  h.stock.water = 0; h.stock[RAW] = tanks + 75 - 1;
  basesDaily(st);
  check((h.stock[RAW] || 0) <= tanks + 75 + 1e-6, `the well stops at the un-purified room (${h.stock[RAW]})`);
  // Demolishing a tank gives half of everything it cost back.
  const back = demolishRefund(b1);
  check(back.scrap === Math.floor((4 + 8 + 12) / 2) && back.parts === 0, `a water tank salvages half its scrap (${JSON.stringify(back)})`);
}

// 6. Storage crates.
{
  console.log("Storage crates");
  const st = W();
  const h = hub(st);
  bare(h);
  const before = storeCapacity(h);
  addBuilding(h, "crates");
  addBuilding(h, "crates");
  check(storeCapacity(h) === before + 60, `two stacks of crates add 60 food room (${before} → ${storeCapacity(h)})`);
}

// 7. Old saves with more buildings than plots keep them; only new ones wait.
{
  console.log("Over the plots (old saves)");
  const st = W();
  const o = mkOutpost(st, hub(st).tile);
  rich(o); skilled(st, o);
  for (let i = 0; i < PLOTS.outpost.building + 2; i++) addBuilding(o, "bunkhouse");
  check(o.buildings.length === PLOTS.outpost.building + 2, "the buildings stay");
  check(canBuild(st, o, "cellar").noPlot, "nothing new on the building plots until some come down");
  check(JSON.parse(JSON.stringify(o)).buildings.length === o.buildings.length, "barrels and plots are plain data (save)");
}

// 8. The barracks (buildings.js BEDS, BARRACKS_UP): 12 beds on one building plot, built new or expanded from a
// standing bunkhouse where it stands.
{
  console.log("Barracks");
  const st = W();
  const h = hub(st);
  bare(h); rich(h); skilled(st, h);
  check(BUILDINGS.barracks.plot === "building" && BEDS.barracks === 2 * BEDS.bunkhouse && BEDS.bunkhouse === 6, `a barracks sleeps ${BEDS.barracks} on a building plot (a bunkhouse ${BEDS.bunkhouse})`);
  check(baseBeds(h) === 4, `a bare hub has 4 beds (${baseBeds(h)})`);
  const bx = addBuilding(h, "barracks");
  check(baseBeds(h) === 16, `a barracks adds 12 beds (${baseBeds(h)})`);
  bx.broken = true;
  check(baseBeds(h) === 4, "a broken barracks sleeps nobody");
  bare(h);
  check(!!queueBuild(st, h, "barracks") && queuedBeds(h) === 12 && plotsUsed(h, "building") === 1, `a queued barracks holds a plot and 12 beds to come (${queuedBeds(h)})`);
  finishAll(st, h);
  check(count(h, "barracks") === 1 && baseBeds(h) === 16 && queuedBeds(h) === 0, "built, it has its 12 beds");
  // A shelter has no building plots.
  const st2 = W();
  const h2 = hub(st2); h2.tier = 0; bare(h2); rich(h2);
  check(!canBuild(st2, h2, "barracks").ok, "no barracks at a shelter");

  console.log("Expanding a bunkhouse into a barracks");
  bare(h);
  const fill = ["bunkhouse", "bunkhouse", "bunkhouse", "bunkhouse", "bunkhouse", "bunkhouse", "cellar", "cellar", "storehouse", "common_room", "common_room", "chapel", "garage", "cells", "kitchen", "infirmary"]; // jailhouse: one jail a base (buildings.js family "jail"), so a kitchen takes the second plot;
  for (const t of fill) addBuilding(h, t);
  const bunks = h.buildings.filter((x) => x.type === "bunkhouse");
  const beds0 = baseBeds(h);
  check(canBuild(st, h, "barracks").noPlot, "no plot for a new barracks");
  check(canExpandBunkhouse(st, h, bunks[0].id).ok, "a standing bunkhouse can be expanded with every plot taken");
  const sc = h.stock.scrap, pa = h.stock.parts;
  queueBunkhouseExpand(st, h, bunks[0].id);
  check(h.stock.scrap === sc - BARRACKS_UP.cost.scrap && h.stock.parts === pa - BARRACKS_UP.cost.parts, `it costs ${BARRACKS_UP.cost.scrap} scrap and ${BARRACKS_UP.cost.parts} parts`);
  check(plotsUsed(h, "building") === PLOTS.hub.building && queuedBeds(h) === 6 && baseBeds(h) === beds0, `no new plot, 6 beds to come, the 6 in use meanwhile (${queuedBeds(h)}, ${baseBeds(h)})`);
  check(jobName(h.construction[0]) === "Expand a bunkhouse into a barracks", `the queue names it (${jobName(h.construction[0])})`);
  check(!canExpandBunkhouse(st, h, bunks[0].id).ok && !canDemolish(st, h, bunks[0].id).ok, "not expanded twice, not pulled down while it is");
  const sc1 = h.stock.scrap;
  cancelBuild(st, h, h.construction[0].id);
  check(h.stock.scrap === sc1 + BARRACKS_UP.cost.scrap && !h.construction.length, "cancelled untouched: everything back");
  queueBunkhouseExpand(st, h, bunks[0].id);
  finishAll(st, h);
  check(bunks[0].type === "barracks" && baseBeds(h) === beds0 + 6 && plotsUsed(h, "building") === PLOTS.hub.building, `done: the bunkhouse is a barracks on its own plot (${baseBeds(h)} beds)`);
  // The max counts expansions in the queue too.
  for (const b of bunks.slice(1, 4)) queueBunkhouseExpand(st, h, b.id);
  check(h.construction.length === 3 && !canExpandBunkhouse(st, h, bunks[4].id).ok && /Limit/.test(canExpandBunkhouse(st, h, bunks[4].id).reason), `at most ${BUILDINGS.barracks.max} barracks, queued expansions counted`);
  check(/Limit/.test(canBuild(st, h, "barracks").reason), "a new barracks is refused at the limit too");
  bunks[5].broken = true;
  h.construction = [];
  check(/Repair/.test(canExpandBunkhouse(st, h, bunks[5].id).reason), "a broken bunkhouse is repaired first");

  console.log("The autopilot's housing plan");
  const st3 = W();
  const h3 = hub(st3);
  bare(h3); rich(h3); skilled(st3, h3);
  check(housingAI.next(st3, h3).type === "bunkhouse", "plenty of building plots: a bunkhouse");
  for (const t of fill.slice(6, 6 + 12)) addBuilding(h3, t); // 10 plots taken, 6 free
  addBuilding(h3, "bunkhouse"); addBuilding(h3, "bunkhouse"); addBuilding(h3, "bunkhouse"); // 13 taken, 3 free: scarce
  const nx = housingAI.next(st3, h3);
  check(nx.type === "barracks" && nx.upgrade == null && nx.beds === 12, `building plots scarce: a barracks (${nx.type}, ${nx.beds})`);
  h3.stock.parts = 0;
  check(housingAI.next(st3, h3).type === "bunkhouse", "no parts for a barracks: a bunkhouse on a free plot");
  h3.stock.parts = 50;
  addBuilding(h3, "garage"); addBuilding(h3, "chapel"); addBuilding(h3, "greenhouse"); // every plot taken (the cells are in the fill already: one jail a base)
  const ex = housingAI.next(st3, h3);
  check(ex && ex.upgrade != null && h3.buildings.find((x) => x.id === ex.upgrade).type === "bunkhouse" && ex.beds === 6, "no plot free: expand a bunkhouse (+6)");
  const ws = housingAI.wishes(st3, h3);
  const hw = (() => { while (st3.survivors.filter((s) => s.alive && s.location.kind === "base" && s.location.baseId === h3.id).length < baseBeds(h3) + 2) skilled(st3, h3); return housingAI.wishes(st3, h3).find((w) => w.type === "barracks"); })();
  check(!ws.some((w) => w.type === "bunkhouse") && hw && hw.upgrade != null, `crowded with every plot taken, the governor wishes for an expansion (${hw && hw.why})`);
  check(!housingAI.cramped(st3), "not cramped while bunkhouses can still be expanded");
  for (const b of h3.buildings.filter((x) => x.type === "bunkhouse")) b.type = "barracks";
  addBuilding(h3, "barracks"); // the max reached, every plot taken
  while (st3.survivors.filter((s) => s.alive && s.location.kind === "base" && s.location.baseId === h3.id).length < baseBeds(h3)) skilled(st3, h3);
  check(housingAI.next(st3, h3) === null && housingAI.cramped(st3), `nothing more fits and the beds are full: the hub is cramped (${baseBeds(h3)} beds)`);
  const o3 = mkOutpost(st3, h3.tile);
  rich(o3); Object.assign(o3.stock, { water: 300 }); setFood(h3, 2000); // the hub feeds 10 days a head and more
  addBuilding(o3, "bunkhouse"); addBuilding(o3, "well"); addBuilding(o3, "well"); addBuilding(o3, "cistern");
  check(housingAI.bedsFree(st3, o3) === 8, `an empty outpost with a bunkhouse has 8 beds free (${housingAI.bedsFree(st3, o3)})`);
  const mv = housingAI.movers(st3, o3);
  check(mv >= 1 && mv <= 3, `a cramped hub sends people to an outpost with beds, food and water (${mv})`);
  while (st3.survivors.filter((s) => s.alive && s.location.kind === "base" && s.location.baseId === o3.id).length < baseBeds(o3)) skilled(st3, o3);
  check(housingAI.movers(st3, o3) === 0, "nobody to a full outpost");
  const ow = housingAI.wishes(st3, o3);
  check(ow.some((w) => BEDS[w.type]), `the outpost of a cramped hub builds beds ahead (${ow.map((w) => w.type).join(", ")})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
