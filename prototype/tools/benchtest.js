// Headless checks for the crafting benches (buildings.js BENCH: a crafting bench, a workbench, a master workbench on
// one utility plot): they stand on a utility plot at a shelter, an outpost and the hub, each tier upgrades the one
// below in place, hand crafting needs one for all but the simple field recipes, they make hand crafting faster and
// better (craftRate, the item's condition; field crafting gets nothing), a workbench counts as a workshop and is what
// an ammo bench needs, the new hub starts with no bench at all (barestart: tools/barestarttest.js), an old save without a bench keeps
// working, and the governor (autopilot.js) builds a bench, upgrades it and puts up the ammo bench.
// Usage: node tools/benchtest.js [seed]
import { unlockAll } from "../src/sim/blueprints.js";
import { stockTools } from "./toolset.js";
import { createWorld, hub, newId, makeSurvivor, atBase } from "../src/sim/world.js";
import {
  BUILDINGS, BENCH, addBuilding, canBuild, queueBuild, constructionHour, plotsUsed, plotsFree, count, countAll, benchTier, benchOf, SHELTER,
} from "../src/sim/buildings.js";
import {
  CRAFTS, canCraft, queueCraft, craftQueue, craftRate, craftQuality, craftingHour, craftJobStatus, hasWorkshop, meetsNeeds,
  benchNeeded, benchBonus, benchQuality, fieldCraft, craftMean, craftSkill,
} from "../src/sim/crafting.js";
import { bestQuality } from "../src/sim/production.js";
import { setAutopilot, governBase, housingAI } from "../src/sim/autopilot.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const W = () => { const st = createWorld({ seed, factionCount: 6 }); unlockAll(st); stockTools(hub(st)); return st; }; // every tool (toolset.js): the benches are the subject here
const rich = (b) => Object.assign(b.stock, { scrap: 9999, parts: 999, meds: 999, food: 500, water: 200, wood: 99999 });
const mkOutpost = (st, tile) => {
  const b = { id: newId(), tile, type: "outpost", name: "Test Outpost", stock: { food: 0, water: 0, fuel: 0, meds: 0, ammo: 0, parts: 0, scrap: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  stockTools(b); // every tool a build or recipe can need (toolreqs.js): the tests here are about the benches
  st.bases.push(b);
  return b;
};
const finishAll = (st, b) => { for (let i = 0; i < 50 && b.construction.length; i++) { for (const c of b.construction) c.progress = c.hours; constructionHour(st); } };
const person = (st, b, role = "craft", lvl = 10) => { const s = makeSurvivor(st, 1); s.location = { kind: "base", baseId: b.id }; s.role = role; s.traits = []; s.perks = []; for (const k of Object.keys(s.skills)) s.skills[k] = lvl; st.survivors.push(s); return s; };
const benches = Object.keys(BENCH);

// 0. Data: three tiers, one family, utility plots, cheap first tier, one exported table.
{
  console.log("Data");
  check(benches.length === 3 && benches.every((k, i) => BUILDINGS[k] && BUILDINGS[k].family === "bench" && BUILDINGS[k].tier === i + 1), "three bench tiers in BENCH, one family");
  check(benches.every((k) => BUILDINGS[k].plot === "utility" && BUILDINGS[k].max === 1 && BUILDINGS[k].craft === BENCH[k]), "each on a utility plot, one a base, its numbers from BENCH");
  check(BUILDINGS.workbench.upgrades === "craftbench" && BUILDINGS.toolbench.upgrades === "workbench", "each tier upgrades the one below");
  // barestart: no base starts with one, so the first bench is an early but real choice (buildings.js BENCH).
  check(!BUILDINGS.craftbench.req && BUILDINGS.craftbench.cost.scrap === 10 && BUILDINGS.craftbench.cost.parts === 1 && BUILDINGS.craftbench.cost.wood === 100 && BUILDINGS.craftbench.hours === 12, "the crafting bench: 10 scrap, a part and 100 wood (woodwork), 12 work-hours, no skill");
  check(BENCH.craftbench.rate > 1 && BENCH.workbench.rate > BENCH.craftbench.rate && BENCH.toolbench.rate > BENCH.workbench.rate, "each tier crafts faster");
  check(BENCH.craftbench.quality > 0 && BENCH.workbench.quality > BENCH.craftbench.quality && BENCH.toolbench.quality > BENCH.workbench.quality, "each tier crafts better");
  check(!BENCH.craftbench.workshop && BENCH.workbench.workshop && BENCH.toolbench.workshop, "the workbench and up are workshops, the crafting bench is not");
  check(/25% faster/.test(BUILDINGS.craftbench.desc) && /\+5% condition/.test(BUILDINGS.craftbench.desc), "the crafting bench says what it does");
  check(BUILDINGS.ammo_bench.bench === 2 && /workbench/.test(BUILDINGS.ammo_bench.desc), "the ammo bench needs a workbench (and says so)");
  check(SHELTER.build.craftbench === 1, "a shelter may build a crafting bench");
}

// 1. The new hub: no bench at all (barestart: it starts bare), and it can build one.
{
  console.log("The start");
  const st = W();
  const h = hub(st);
  check(!benchTier(h, true) && !countAll(h, "ammo_bench"), `the hub starts with no bench and no ammo bench (${h.buildings.map((b) => b.type).join(", ")})`);
  check(!benchOf(h) && canBuild(st, h, "craftbench").ok, `no bench bonus; a crafting bench can go up (${canBuild(st, h, "craftbench").reason || "ok"})`);
  check(!hasWorkshop(h), "no workshop at the start");
}

// 2. Plots: a crafting bench takes a utility plot at a shelter, an outpost and the hub; upgrades keep it.
{
  console.log("Plots");
  const st = W();
  const h = hub(st);
  h.buildings = h.buildings.filter((b) => !BUILDINGS[b.type].family || BUILDINGS[b.type].family !== "bench");
  rich(h); person(st, h, "build");
  h.tier = 0; h.buildings = []; // a shelter: three utility plots, one building plot
  check(canBuild(st, h, "craftbench").ok, `a shelter can build a crafting bench (${canBuild(st, h, "craftbench").reason || ""})`);
  queueBuild(st, h, "craftbench");
  check(plotsUsed(h, "utility") === 1 && plotsFree(h, "utility") === 2, "queued, it holds one of the shelter's 3 utility plots");
  finishAll(st, h);
  check(count(h, "craftbench") === 1 && plotsUsed(h, "utility") === 1, "built at the shelter on a utility plot");
  check(!canBuild(st, h, "craftbench").ok, "only one");
  check(!canBuild(st, h, "workbench").ok, "a shelter does not build a workbench");
  addBuilding(h, "crates"); addBuilding(h, "rain_catcher");
  check(plotsFree(h, "utility") === 0, "a bench, crates and a rain catcher fill the shelter's plots");

  const o = mkOutpost(st, h.tile);
  rich(o); person(st, o, "build");
  check(!benchTier(o) && canBuild(st, o, "craftbench").ok, "an outpost has no bench and can build one");
  const u0 = plotsUsed(o, "utility");
  queueBuild(st, o, "craftbench"); finishAll(st, o);
  check(count(o, "craftbench") === 1 && plotsUsed(o, "utility") === u0 + 1, "the outpost's bench takes a utility plot");
  check(!canBuild(st, o, "toolbench").ok && /Upgrade a workbench first/.test(canBuild(st, o, "toolbench").reason), "tiers go one step at a time");
  check(canBuild(st, o, "workbench").ok, `the workbench upgrades it (${canBuild(st, o, "workbench").reason || ""})`);
  queueBuild(st, o, "workbench");
  check(plotsUsed(o, "utility") === u0 + 1, "an upgrade in the queue takes no new plot");
  finishAll(st, o);
  check(!countAll(o, "craftbench") && count(o, "workbench") === 1 && plotsUsed(o, "utility") === u0 + 1, "the workbench replaces the crafting bench on its plot");
  queueBuild(st, o, "toolbench"); finishAll(st, o);
  check(count(o, "toolbench") === 1 && !countAll(o, "workbench") && plotsUsed(o, "utility") === u0 + 1 && benchTier(o) === 3, "the master workbench replaces the workbench on its plot");
  // Every utility plot full: no bench.
  const o2 = mkOutpost(st, h.tile);
  rich(o2); person(st, o2, "build");
  for (let i = 0; i < 4; i++) addBuilding(o2, "crates");
  addBuilding(o2, "well"); addBuilding(o2, "well");
  check(!canBuild(st, o2, "craftbench").ok && canBuild(st, o2, "craftbench").noPlot, "no free utility plot, no bench");
  // The workbench needs Mechanics 2 here.
  const o3 = mkOutpost(st, h.tile);
  rich(o3); addBuilding(o3, "craftbench");
  const s3 = person(st, o3, "build", 1);
  check(/Mechanics 2/.test(canBuild(st, o3, "workbench").reason || ""), "a workbench needs a Mechanics 2+ survivor");
  s3.skills.mechanics = 2;
  check(canBuild(st, o3, "workbench").ok, "with one it can go up");
}

// 3. The recipe gate: no bench, only field recipes (and station / re-pack recipes); a bench opens the rest.
{
  console.log("Recipes and the bench");
  const st = W();
  const o = mkOutpost(st, hub(st).tile);
  rich(o); person(st, o, "craft", 10);
  const field = Object.keys(CRAFTS).filter((k) => CRAFTS[k].field);
  const benchOnly = Object.keys(CRAFTS).filter((k) => benchNeeded(CRAFTS[k]));
  check(benchOnly.includes("sawmachete") && benchOnly.includes("backpack") && !benchOnly.includes("pipespear") && !benchOnly.includes("waterfilter") && !benchOnly.includes("repackfilter") && !benchOnly.includes("dewormer"), "the bench recipes: not the field ones, the station ones or the re-packed filter");
  for (const k of field) check(canCraft(st, o, k).ok || !/bench/.test(canCraft(st, o, k).reason || ""), `${k} (field) needs no bench`);
  for (const k of benchOnly) check(/Needs a crafting bench here/.test(canCraft(st, o, k).reason || ""), `${k} needs a crafting bench (${canCraft(st, o, k).reason})`);
  check(/workshop/.test(canCraft(st, o, "crossbow").reason || ""), "a workshop recipe still asks for a workshop");
  addBuilding(o, "craftbench");
  for (const k of benchOnly) check(canCraft(st, o, k).ok || !/bench/.test(canCraft(st, o, k).reason || ""), `${k} can be made with a crafting bench (${canCraft(st, o, k).reason || "ok"})`);
  check(!hasWorkshop(o) && /workshop/.test(canCraft(st, o, "crossbow").reason || ""), "a crafting bench is not a workshop");
  // A job queued and the bench lost: the job waits and says why.
  queueCraft(st, o, "sawmachete");
  o.buildings = o.buildings.filter((b) => b.type !== "craftbench");
  check(/crafting bench/.test(craftJobStatus(st, o, craftQueue(o)[0])), `a bench job waits without a bench (${craftJobStatus(st, o, craftQueue(o)[0])})`);
  const p0 = craftQueue(o)[0].progress;
  craftingHour(st);
  check(craftQueue(o)[0].progress === p0, "and does not move");
  // A broken bench does nothing until repaired.
  const b = addBuilding(o, "craftbench");
  b.broken = true;
  check(!benchOf(o) && !meetsNeeds(o, CRAFTS.sawmachete), "a broken bench does not count");
  b.broken = false;
  check(meetsNeeds(o, CRAFTS.sawmachete), "repaired, it does");
  // Old saves: a workshop with no bench still crafts (as before), without the bench bonus.
  const o2 = mkOutpost(st, hub(st).tile);
  rich(o2); person(st, o2, "craft", 10);
  addBuilding(o2, "ammo_bench");
  check(canCraft(st, o2, "sawmachete").ok && canCraft(st, o2, "crossbow").ok && benchBonus(o2).rate === 1 && benchBonus(o2).quality === 0, "an old base with an ammo bench and no bench keeps crafting, no bonus");
}

// 4. Workshop and the ammo bench: a workbench opens the workshop recipes and the ammo bench.
{
  console.log("Workbench and ammo bench");
  const st = W();
  const h = hub(st);
  rich(h); person(st, h, "build", 10);
  addBuilding(h, "craftbench"); // the hub starts bare (barestart): its first bench
  check(!canBuild(st, h, "ammo_bench").ok && /workbench/.test(canBuild(st, h, "ammo_bench").reason || ""), `no ammo bench with only a crafting bench (${canBuild(st, h, "ammo_bench").reason})`);
  check(!hasWorkshop(h) && !canCraft(st, h, "crossbow").ok, "no workshop recipes either");
  queueBuild(st, h, "workbench"); finishAll(st, h);
  check(count(h, "workbench") === 1 && hasWorkshop(h), "the workbench is a workshop");
  check(canCraft(st, h, "crossbow").ok && canCraft(st, h, "scrapvest").ok, "the workshop recipes open with it");
  check(canBuild(st, h, "ammo_bench").ok, `the ammo bench can go up now (${canBuild(st, h, "ammo_bench").reason || ""})`);
  queueBuild(st, h, "ammo_bench"); finishAll(st, h);
  check(count(h, "ammo_bench") === 1, "built");
  // A broken workbench still lets an ammo bench be queued (it gets repaired), but is no workshop while broken.
  h.buildings.find((b) => b.type === "workbench").broken = true;
  check(canBuild(st, h, "ammo_bench").ok, "a broken workbench still counts for building an ammo bench");
  check(hasWorkshop(h), "the ammo bench is a workshop of its own");
}

// 5. Speed and quality: the bench at the base, not in the field.
{
  console.log("Speed and quality");
  const st = W();
  const o = mkOutpost(st, hub(st).tile);
  rich(o);
  person(st, o, "craft", 4);
  const r0 = craftRate(st, o, "pipespear");
  const q0 = bestQuality(st, o, "spikedbat");
  check(r0 > 0 && benchBonus(o).rate === 1 && benchQuality(0.8, o) === 0.8, "no bench: no bonus");
  addBuilding(o, "craftbench");
  const r1 = craftRate(st, o, "pipespear"), q1 = bestQuality(st, o, "spikedbat");
  check(Math.abs(r1 / r0 - BENCH.craftbench.rate) < 1e-9, `a crafting bench: ${Math.round((r1 / r0 - 1) * 100)}% faster`);
  check(Math.abs(q1 - q0 - BENCH.craftbench.quality) < 0.011, `a crafting bench: +${Math.round((q1 - q0) * 100)}% condition (${q0} → ${q1})`);
  check(benchQuality(0.99, o) === 1, "never above 100%");
  o.buildings = o.buildings.filter((b) => b.type !== "craftbench");
  addBuilding(o, "workbench");
  const r2 = craftRate(st, o, "pipespear"), q2 = bestQuality(st, o, "spikedbat");
  check(r2 > r1 && q2 > q1, `a workbench more (${Math.round((r2 / r0 - 1) * 100)}% faster, +${Math.round((q2 - q0) * 100)}%)`);
  addBuilding(o, "toolbench");
  check(benchTier(o) === 3 && craftRate(st, o, "pipespear") > r2 && bestQuality(st, o, "spikedbat") >= q2, "a master workbench the most");
  // The crafted item comes out at the bench's quality.
  o.buildings = o.buildings.filter((b) => !benches.includes(b.type));
  addBuilding(o, "craftbench");
  const a0 = o.armory.length;
  const meanBench = craftMean(st, o, "spikedbat");
  o.buildings = o.buildings.filter((b) => !benches.includes(b.type));
  const meanBare = craftMean(st, o, "spikedbat");
  addBuilding(o, "craftbench");
  queueCraft(st, o, "spikedbat");
  for (let i = 0; i < 50 && craftQueue(o).length; i++) craftingHour(st);
  const made = o.armory[a0];
  // Quality is a roll around the expected condition (craft-books: Crafting); the bench raises the expectation.
  check(made && made.key === "spikedbat" && Math.abs(meanBench - Math.min(1, meanBare + BENCH.craftbench.quality)) < 0.011 && Math.abs(made.quality - meanBench) <= 0.25, `the crafted bat comes out around the bench's condition (${made && made.quality}, expected ${meanBench}, ${meanBare} without)`);
  // Field crafting by a team gets no bench, wherever it set out from.
  const h = hub(st);
  addBuilding(h, "craftbench"); // a bench at home (the hub starts bare: barestart)
  check(count(h, "craftbench") === 1, "the hub has a bench");
  const team = atBase(st, h.id).slice(0, 2);
  team.forEach((s) => { s.skills.mechanics = 4; s.traits = []; s.perks = []; s.gear.weapon = null; });
  const p = { id: newId(), members: team.map((s) => s.id), supplies: { scrap: 10, water: 4, food: 4 }, cargo: { supplies: {}, gear: [] }, home: h.id };
  st.parties.push(p);
  team.forEach((s) => (s.location = { kind: "party", partyId: p.id }));
  fieldCraft(st, p, "pipespear");
  const it = team.map((s) => s.gear.weapon).find((g) => g && g.key === "pipespear") || p.cargo.gear.find((g) => g.key === "pipespear");
  // The field roll has no base in it: its expectation is the maker's own (craftQuality field), whatever bench is at home.
  const maker = team.reduce((x, y) => (craftSkill(y) > craftSkill(x) ? y : x), team[0]);
  const fieldMean = craftQuality(craftSkill(maker), CRAFTS.pipespear, true, st);
  check(it && Math.abs(it.quality - fieldMean) <= 0.25 && fieldMean < benchQuality(craftQuality(craftSkill(maker), CRAFTS.pipespear, false, st), h), `a field-made spear gets no bench bonus (${it && it.quality}, expected ${fieldMean})`);
}

// 6. The governor: a bench where someone crafts, the workbench and the ammo bench at the hub.
{
  console.log("Governor");
  const st = W();
  setAutopilot(st, true, "balanced");
  const h = hub(st);
  const o = mkOutpost(st, h.tile);
  rich(o); o.stock.ammo = 500;
  person(st, o, "craft", 3); person(st, o, "build", 3);
  check(housingAI.wishes(st, o).some((w) => w.type === "craftbench"), `an outpost with a crafter wishes for a crafting bench (${housingAI.wishes(st, o).map((w) => w.type).join(", ")})`);
  const done = [];
  // The building and production areas only (a steward's hand-over): the water and food wishes ahead of it (food
  // areas) wait, so the bench is the first build.
  for (let i = 0; i < 10 && !countAll(o, "craftbench"); i++) { governBase(st, o, { building: true, production: true }); done.push(...o.construction.map((c) => c.type)); finishAll(st, o); }
  check(count(o, "craftbench") === 1, `the governor builds it (queued: ${done.join(", ")})`);
  const o2 = mkOutpost(st, h.tile);
  rich(o2); person(st, o2, "farm", 3);
  check(!housingAI.wishes(st, o2).some((w) => w.type === "craftbench"), "nobody crafting and nothing queued: no bench wished for");
  // The hub: it starts bare (barestart), so a crafting bench first, then the workbench, then the ammo bench.
  rich(h); h.stock.ammo = 20;
  atBase(st, h.id).forEach((s) => (s.skills.mechanics = Math.max(2, s.skills.mechanics)));
  const hw0 = housingAI.wishes(st, h);
  check(hw0.some((w) => w.type === "craftbench" && w.save) && !hw0.some((w) => w.type === "workbench"), `the bare hub wishes for a crafting bench first, saved for with the ammo low (${hw0.map((w) => w.type).join(", ")})`);
  queueBuild(st, h, "craftbench"); finishAll(st, h);
  const hw = housingAI.wishes(st, h);
  check(hw.some((w) => w.type === "workbench" && w.save), `the hub wishes for a workbench first, saved for with the ammo low (${hw.map((w) => w.type).join(", ")})`);
  queueBuild(st, h, "workbench"); finishAll(st, h);
  check(housingAI.wishes(st, h).some((w) => w.type === "ammo_bench"), "then the ammo bench");
  // The whole chain under the governor at a hub with the materials and the ammo short: the workbench before the
  // ammo bench, both built.
  const st3 = W();
  setAutopilot(st3, true, "balanced");
  const h3 = hub(st3);
  rich(h3);
  atBase(st3, h3.id).forEach((s) => (s.skills.mechanics = Math.max(2, s.skills.mechanics)));
  const order = [];
  for (let i = 0; i < 80 && !countAll(h3, "ammo_bench"); i++) {
    h3.stock.ammo = 20;
    governBase(st3, h3);
    for (const c of h3.construction) if (!order.includes(c.type)) order.push(c.type);
    finishAll(st3, h3);
  }
  check(count(h3, "workbench") === 1 && count(h3, "ammo_bench") === 1 && order.indexOf("workbench") < order.indexOf("ammo_bench"), `the governor upgrades to a workbench, then builds the ammo bench (queued: ${order.join(", ")})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
console.log(fails ? "benchtest failed" : "benchtest passed");
process.exit(fails ? 1 : 0);
