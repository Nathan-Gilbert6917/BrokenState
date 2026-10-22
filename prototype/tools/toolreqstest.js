// Tools as prerequisites (src/sim/toolreqs.js, data-tools.js; the user's request 2026-10-21): the data hangs together,
// builds and recipes need their tools at the base (or with the team in the field), a tool kit covers several kinds,
// makeshift tools are made from scrap anywhere and wear out, the governor keeps the basic ones, the hub starts with a
// tool shelf, farms, hardware stores and cars hold the most tools, and an axe cuts far more wood than bare hands.
// Usage: node tools/toolreqstest.js
import { unlockAll } from "../src/sim/blueprints.js";
import { createWorld, hub, atBase, HUB_TOOLS } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { BUILDINGS, WALL_TIERS, canBuild, queueBuild, addBuilding } from "../src/sim/buildings.js";
import { CRAFTS, canCraft, queueCraft, fieldCraftOptions } from "../src/sim/crafting.js";
import { WEAPONS } from "../src/sim/combat.js";
import { ITEM_TAGS } from "../src/sim/loot.js";
import { newItem } from "../src/sim/inventory.js";
import { chopMult, bestChop, isChopTool, baseWoodDay, WOOD } from "../src/sim/woodcutting.js";
import {
  TOOL_KINDS, BUILD_TOOLS, WALL_TOOLS, CRAFT_TOOLS, TOOL_FINDS, CAR_TOOLS, baseToolItems, toolFor, toolsMissing, basicToolWanted,
  rollToolFind, rollAreaTool, toolWares, migrateTools,
} from "../src/sim/toolreqs.js";
import { TOOL_ITEMS, TOOL_MAKESHIFT, TOOL_HELP } from "../src/sim/data-tools.js";
import { rollShopShelves } from "../src/sim/shopshelves.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const world = (seed = 42) => { const st = createWorld({ seed, factionCount: 5 }); unlockAll(st); return st; };
// Every tool off the base: the armory's and what its people carry.
const stripTools = (st, base) => {
  const isTool = (it) => !!it && Object.values(TOOL_KINDS).some((k) => k.items.includes(it.key));
  base.armory = base.armory.filter((it) => !isTool(it));
  for (const s of atBase(st, base.id)) {
    for (const k of Object.keys(s.gear || {})) if (isTool(s.gear[k])) s.gear[k] = null;
    (s.pockets || []).forEach((it, i) => { if (isTool(it)) s.pockets[i] = null; });
    const pk = s.gear.backpack && s.gear.backpack.contents;
    (pk || []).forEach((it, i) => { if (isTool(it)) pk[i] = null; });
  }
};

console.log("Data");
{
  for (const [k, d] of Object.entries(TOOL_ITEMS)) {
    check(GEAR[k] === d || (GEAR[k] && GEAR[k].name === d.name), `${k} is gear`);
    check(!!ITEM_TAGS[k], `${k} has its theme tags`);
    if (d.slot === "weapon") check(!!WEAPONS[k], `${k} has battle numbers`);
  }
  for (const [kind, def] of Object.entries(TOOL_KINDS)) for (const k of def.items) check(!!GEAR[k], `${kind}: ${k} is gear`);
  for (const [b, kinds] of Object.entries(BUILD_TOOLS)) { check(!!BUILDINGS[b], `${b} is a building`); for (const k of kinds) check(!!TOOL_KINDS[k], `${b}: ${k} is a tool kind`); }
  for (const [m, kinds] of Object.entries(WALL_TOOLS)) { check(WALL_TIERS.some((t) => t && t.key === m), `${m} is a wall material`); for (const k of kinds) check(!!TOOL_KINDS[k], `wall ${m}: ${k}`); }
  for (const [r, kinds] of Object.entries(CRAFT_TOOLS)) { check(!!CRAFTS[r], `${r} is a recipe`); for (const k of kinds) check(!!TOOL_KINDS[k], `${r}: ${k} is a tool kind`); }
  for (const [kind, r] of Object.entries(TOOL_MAKESHIFT)) check(CRAFTS[r] && CRAFTS[r].field && !CRAFT_TOOLS[r] && TOOL_KINDS[kind].items.includes(CRAFTS[r].gear), `${kind}: the makeshift ${r} is a field recipe that needs no tools`);
  check(TOOL_KINDS.hammer.items.includes("toolkit") && TOOL_KINDS.saw.items.includes("toolkit") && TOOL_KINDS.wrench.items.includes("toolkit") && TOOL_KINDS.pliers.items.includes("toolkit"), "a tool kit counts as a hammer, a saw, wrenches and pliers");
  check(BUILD_TOOLS.bunkhouse.length >= 2 && BUILD_TOOLS.toolbench.length >= 3, "builds can need several tools at once");
  check(/hammer/.test(TOOL_HELP) && /axe/.test(TOOL_HELP), "the Help topic names them");
}

console.log("The hub's tool shelf");
{
  const st = world();
  const base = hub(st);
  for (const k of HUB_TOOLS) check(base.armory.some((it) => it.key === k), `the hub starts with a ${GEAR[k].name.toLowerCase()}`);
  const items = baseToolItems(st, base);
  check(!toolsMissing(items, ["hammer", "saw", "dig", "axe", "wrench", "pliers"]).length, "it covers a hammer, a saw, a shovel, an axe, wrenches and pliers");
  check(toolsMissing(items, ["welder", "drill", "sewing"]).length === 3, "a welder, a drill and a sewing kit are found or traded for");
  check(!basicToolWanted(st, base), "the governor wants no makeshift tool at the hub");
  // A save from before the tools: the shelf is put in once, nothing twice.
  stripTools(st, base);
  migrateTools(st, HUB_TOOLS);
  check(HUB_TOOLS.every((k) => base.armory.filter((it) => it.key === k).length === 1), "an older save's hub gets the tool shelf");
  migrateTools(st, HUB_TOOLS);
  check(HUB_TOOLS.every((k) => base.armory.filter((it) => it.key === k).length === 1), "and not twice");
}

console.log("Builds");
{
  const st = world();
  const base = hub(st);
  base.stock.scrap = 500; base.stock.parts = 50; base.stock.wood = 5000; base.stock.buildmat = 20;
  check(canBuild(st, base, "bunkhouse").ok, "a bunkhouse with the tool kit here");
  check(canBuild(st, base, "farm_plot").ok, "a farm plot with the shovel here");
  stripTools(st, base);
  const r = canBuild(st, base, "bunkhouse");
  check(!r.ok && r.tools && /hammer and a saw/.test(r.reason), `no tools: the bunkhouse needs a hammer and a saw (${r.reason})`);
  check(/shovel/.test(canBuild(st, base, "farm_plot").reason || ""), "no tools: a farm plot needs a shovel");
  check(canBuild(st, base, "rain_catcher").ok, "a rain catcher needs no tools");
  base.armory.push(newItem("hammer", 1));
  check(/a saw/.test(canBuild(st, base, "bunkhouse").reason || "") && !/hammer/.test(canBuild(st, base, "bunkhouse").reason || ""), "a claw hammer covers the hammer, the saw is still missing");
  const saw = newItem("scrapsaw", 1);
  base.armory.push(saw);
  check(canBuild(st, base, "bunkhouse").ok, "a claw hammer and a makeshift saw: the bunkhouse can go up");
  const d0 = saw.dur ?? GEAR.scrapsaw.dur;
  queueBuild(st, base, "bunkhouse");
  check(base.construction.some((c) => c.type === "bunkhouse"), "queued");
  check((saw.dur ?? GEAR.scrapsaw.dur) === d0 - 1, "the makeshift saw lost a use");
  // Upper tiers: the master workbench and the reinforced gate need a welder.
  addBuilding(base, "craftbench"); addBuilding(base, "workbench");
  base.armory.push(newItem("toolkit", 1), newItem("powerdrill", 1));
  for (const s of atBase(st, base.id)) s.skills.mechanics = 8;
  check(/welding kit/.test(canBuild(st, base, "toolbench").reason || ""), "a master workbench needs a welding kit");
  base.armory.push(newItem("welder", 1));
  check(canBuild(st, base, "toolbench").ok, "with a welding kit it can go up");
  // A person carrying the tool counts: the drill in someone's pack.
  base.armory = base.armory.filter((it) => it.key !== "powerdrill");
  check(/drill/.test(canBuild(st, base, "toolbench").reason || ""), "without the drill the master workbench waits");
  const s = atBase(st, base.id)[0];
  s.pockets = s.pockets || [];
  s.gear.weapon = newItem("handdrill", 1); // held, as anything someone has on them
  check(!toolsMissing(baseToolItems(st, base), ["drill"]).length, "a brace and bit on someone at the base counts as a drill");
}

console.log("Crafting");
{
  const st = world();
  const base = hub(st);
  addBuilding(base, "craftbench");
  base.stock.scrap = 200; base.stock.wood = 500;
  check(/sewing kit/.test(canCraft(st, base, "backpack").reason || ""), "a backpack needs a sewing kit");
  check(canCraft(st, base, "sewingkit").ok, "a sewing kit is made from a scrap");
  queueCraft(st, base, "sewingkit");
  base.armory.push(newItem("sewingkit", 1));
  check(canCraft(st, base, "backpack").ok, "with a sewing kit the backpack can be made");
  stripTools(st, base);
  check(/hammer/.test(canCraft(st, base, "spikedbat").reason || ""), "a spiked bat needs a hammer");
  check(canCraft(st, base, "scraphammer").ok, "a makeshift hammer needs no tools");
  const want = basicToolWanted(st, base);
  check(want && want.kind === "hammer" && want.recipe === "scraphammer", "the governor wants a makeshift hammer first when nothing here is one");
  // In the field: what the team carries.
  const p = { id: 999, owner: "player", members: atBase(st, base.id).slice(0, 2).map((x) => x.id), supplies: { scrap: 10, wood: 30 }, cargo: { supplies: {}, gear: [] } };
  const opts = (party) => fieldCraftOptions(st, party); // parties.js partyMembers: by the members list
  const fieldOpt = (o, k) => o.find((x) => x.key === k);
  let o = opts(p);
  check(fieldOpt(o, "padding") && /sewing kit/.test(fieldOpt(o, "padding").reason), "a team with no sewing kit cannot make padding");
  p.cargo.gear.push(newItem("sewingkit", 1));
  o = opts(p);
  check(fieldOpt(o, "padding") && !/sewing/.test(fieldOpt(o, "padding").reason), "with one in the cargo it can");
}

console.log("Woodcutting");
{
  check(chopMult(null) === WOOD.hands && WOOD.hands < 1, "bare hands cut less than a tool of ×1");
  const axe = newItem("axe", 1), fire = newItem("fireaxe", 1), hatchet = newItem("hatchet", 1), machete = newItem("machete", 1);
  check(chopMult(axe) >= 3 * WOOD.hands && chopMult(fire) >= 2.8 * WOOD.hands, "an axe cuts about three times what bare hands do");
  check(chopMult(axe) > chopMult(fire) && chopMult(fire) > chopMult(hatchet) && chopMult(hatchet) > chopMult(machete), "a felling axe, a fire axe, a hatchet, then a machete");
  check(isChopTool(newItem("bowsaw", 1)) && isChopTool(newItem("scrapaxe", 1)) && !isChopTool(newItem("hammer", 1)), "a bow saw and a makeshift axe cut wood, a hammer does not");
  const st = world();
  const base = hub(st);
  stripTools(st, base);
  const s = atBase(st, base.id)[0];
  s.gear.weapon = null;
  check(bestChop(s).item === null && bestChop(s).mult === WOOD.hands, "no tool: bare hands");
  const bare = baseWoodDay(st, base, s);
  s.gear.weapon = newItem("axe", 1);
  const withAxe = baseWoodDay(st, base, s);
  check(bare > 0 && withAxe >= 3 * bare, `with a felling axe a woodcutter brings in ${withAxe.toFixed(0)} a day, bare-handed ${bare.toFixed(0)}`);
}

console.log("Where tools turn up");
{
  const st = world();
  const tileOf = (type) => Object.values(st.tiles).find((t) => t.loc && t.loc.type === type);
  const rate = (type) => { const t = tileOf(type); if (!t) return null; t.loot = 1; let n = 0; for (let h = 0; h < 4000; h++) { st.hour = h; if (rollToolFind(st, t.id, 1, "t")) n++; } return n / 4000; };
  check(TOOL_FINDS.hardware.p > TOOL_FINDS.town.p * 5 && TOOL_FINDS.farm.p > TOOL_FINDS.town.p * 5, "hardware stores and farms keep far more tools than a town's houses");
  check(CAR_TOOLS.p >= 0.1, "a car's trunk holds a tool one time in ten or more");
  const hw = rate("hardware"), farm = rate("farm");
  if (hw != null) check(hw > 0.08 && hw < 0.25, `a hardware store's search hour finds a tool ${Math.round(hw * 100)}% of the time`);
  if (farm != null) check(farm > 0.07 && farm < 0.25, `a farm's search hour finds a tool ${Math.round(farm * 100)}% of the time`);
  const t = Object.values(st.tiles)[0];
  let cars = 0, houses = 0;
  for (let i = 0; i < 2000; i++) { if (rollAreaTool(st, t.id, "roadcars", "car", `c${i}`)) cars++; if (rollAreaTool(st, t.id, "house", "crate", `h${i}`)) houses++; }
  check(cars > houses * 3, `cars' trunks (${cars}) hold more tools than houses' crates (${houses})`);
  // A hardware store that is a POI (shops.js) rolls its own kind's table on its shelves (shopshelves.js).
  const plain = Object.values(st.tiles).find((x) => !x.loc || x.loc.type !== "hardware");
  let shelf = 0;
  for (let h = 0; h < 2000; h++) { st.hour = h; shelf += rollShopShelves(st, plain.id, "hardware", 1, 1, "t").filter((it) => TOOL_FINDS.hardware.items[it.key]).length; }
  check(shelf > 2000 * TOOL_FINDS.hardware.p * 0.6, `a hardware store POI's shelves hold tools (${shelf} in 2000 hours)`);
  let aisles = 0;
  for (let i = 0; i < 2000; i++) if (rollAreaTool(st, t.id, "hardware", "shelf", `a${i}`)) aisles++;
  check(aisles > houses * 4, `a hardware store's aisles on a raid map hold far more tools (${aisles}) than houses (${houses})`);
  let w = 0;
  for (let i = 0; i < 400; i++) w += toolWares(st, "traders", `T${i}`).length;
  check(w > 40, `traders sell tools now and then (${w} of 400 tables)`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
