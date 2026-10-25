// Furniture at the base (#20; src/sim/furniture.js, src/sim/data-basefurniture.js; the user's request 2026-10-25: "I
// want all reasonable appliances, furniture and some decor to be lootable and taken to your base for use, like [...]
// shelves, crates etc for storage"). The base part of the ticket's furnituretest (the raid part is #8's
// tools/furnituretest.js).
// Checks: a stocked shelving unit set in a hut adds 150 kg and is a container that takes gear first; a wardrobe takes
// clothing first; a gun rack holds up to 6 guns and nothing else; a tool chest's tools count for toolreqs; a sofa
// gives +0.5 to the building's sleepers once per 6 of them, and the comfort line is capped by COMFORT.MAX; a found
// workbench counts as a crafting bench; pick up returns the item; demolishing the building returns every piece; the
// Build list lists a stored piece only; the governor sets a stored shelving unit before queueing crates; a group with
// a shelving unit in its armory sets it and its storage counts it; a saved game from before loads (beds unchanged).
// Usage: node tools/basefurnituretest.js [seed]
import { createWorld, hub, residents } from "../src/sim/world.js";
import { registerCombatHandler } from "../src/sim/combat.js";
import { BUILDINGS, addBuilding, queueBuild, canBuild, baseBeds, demolish } from "../src/sim/buildings.js";
import { canCraft, makeItem, hasBench } from "../src/sim/crafting.js";
import { GEAR, supWeight } from "../src/sim/data.js";
import { storageOf, storageSummary } from "../src/sim/basestorage.js";
import { containersOf, putItem, putSupply, autoStore } from "../src/sim/containers.js";
import { baseToolItems, toolsMissing } from "../src/sim/toolreqs.js";
import { moodFactors } from "../src/sim/relations.js";
import { governBase, storageWish } from "../src/sim/autopilot.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { worksAt, groupStorage } from "../src/sim/groupworks.js";
import { homesOf } from "../src/sim/groupbases.js";
import * as BM from "../src/sim/basemap.js";
import * as FU from "../src/sim/furniture.js";
import { FURNITURE_KINDS, COMFORT } from "../src/sim/data-basefurniture.js";

const seed = Number(process.argv[2] || 21);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
registerCombatHandler("basefurn", () => {});
// The hub without its start's Lodge, beds and tent (world.js HUB_LAYOUT), its stores and armory empty: the furniture
// and the goods here are the test's own.
const world = (s = seed) => {
  const st = createWorld({ seed: s, factionCount: 6 });
  st.started = true; st.hour = 24 * 3 + 7;
  const h = st.bases[0];
  h.buildings = h.buildings.filter((b) => b.type === "farm_plot");
  h.armory = [];
  for (const k of Object.keys(h.stock)) if (typeof h.stock[k] === "number" && k !== "water") h.stock[k] = 0;
  return st;
};
const keyOf = (b) => `b:${b.id}`;
const inArmory = (base, k) => base.armory.filter((it) => it && it.key === k).length;
function withHouse(st, base, type = "gen_hut", x = -14, y = 6) {
  const g = addBuilding(base, type);
  BM.clearAllLand(st, base);
  const why = BM.placeItem(st, base, keyOf(g), x, y, 0);
  check(why === "", `a ${BUILDINGS[type].name.toLowerCase()} placed at ${x}, ${y}${why ? `: ${why}` : ""}`);
  return g;
}
const firstKey = (cls) => Object.keys(GEAR).find((k) => !GEAR[k].furniture && cls(GEAR[k], k));
const GUN = (d) => d.slot === "weapon" && ["rifle", "shotgun", "pistol", "automatic"].includes(d.cat);
const set = (st, base, type) => { base.armory.push(makeItem(type, 0.9)); const r = FU.setFurniture(st, base, type); check(!r.err, `${GEAR[type].name} set${r.err ? `: ${r.err}` : ` (${r.msg})`}`); return r.rec; };

section("The pieces");
{
  const kinds = Object.keys(FURNITURE_KINDS);
  check(kinds.every((k) => GEAR[`f_${k}`] && GEAR[`f_${k}`].bulky && GEAR[`f_${k}`].twoHands && GEAR[`f_${k}`].furniture === k && GEAR[`f_${k}`].weight === FURNITURE_KINDS[k].kg), `${kinds.length} item forms f_<kind>: bulky, both hands, furniture: <kind>, weight = kg`);
  check(kinds.every((k) => BUILDINGS[`f_${k}`] && BUILDINGS[`f_${k}`].fit && BUILDINGS[`f_${k}`].furniture && BM.FOOT[`f_${k}`] && BM.FOOT[`f_${k}`].fit), "each a placed fitting with a footprint");
  const st = (k) => FU.useOf(`f_${k}`).storage;
  check(st("shelf") === 150 && st("bookshelf") === 60 && st("crate") === 40 && st("cabinet") === 60 && st("filecab") === 50 && st("wardrobe") === 80 && st("dresser") === 50 && st("locker") === 100 && st("toolchest") === 30 && st("display") === 40 && st("palletrack") === 300, "storage kg as the ticket's list");
  check(FU.useOf("f_sofa").comfort === 0.5 && FU.useOf("f_armchair").comfort === 0.25 && FU.useOf("f_workbench").work === "craftbench", "a sofa +0.5, an armchair +0.25, a workbench a crafting bench");
  const two = kinds.filter((k) => FURNITURE_KINDS[k].carry === "two"), one = kinds.filter((k) => FURNITURE_KINDS[k].carry === "one");
  check(Math.min(...two.map((k) => FURNITURE_KINDS[k].kg)) > Math.max(...one.map((k) => FURNITURE_KINDS[k].kg)), "a load for two weighs more than a load for one");
  check(FU.isFurniture("bed") && FU.isFurniture("f_shelf") && !FU.isFurniture("shelves") && !FU.isFurniture("f_nothing"), "isFurniture: the beds and the pieces, not the crafted shelves");
}

section("Storage: a shelving unit in a hut");
{
  const st = world();
  const h = hub(st);
  const hut = withHouse(st, h);
  const cap0 = storageOf(st, h).cap;
  h.armory.push(makeItem("f_shelf", 0.9));
  check(canBuild(st, h, "f_shelf").ok, "a shelving unit in the stores and a hut: it can be set");
  const menu = BM.buildMenu(st, h).filter((m) => m.group === "Furniture");
  check(menu.some((m) => m.type === "f_shelf" && m.have === 1 && m.ok) && !menu.some((m) => m.type === "f_wardrobe"), `the Build list lists the stored piece, not the ones not in the stores (${menu.filter((m) => m.type.startsWith("f_")).map((m) => m.type).join(", ")})`);
  const msg = queueBuild(st, h, "f_shelf");
  const shelf = h.buildings.find((b) => b.type === "f_shelf");
  check(!!shelf && inArmory(h, "f_shelf") === 0 && !h.construction.length && /150 kg/.test(msg), `set from the stores, no job (${msg})`);
  check(BM.fittingsIn(st, h, hut.id).some((o) => o.rec === shelf), "it stands inside the hut");
  const s1 = storageOf(st, h);
  check(s1.cap === cap0 + 150 && s1.containers.some((c) => c.key === keyOf(shelf) && c.cap === 150 && c.kind === "building"), `+150 kg of room (${cap0} → ${s1.cap}), a container of its own`);
  check(storageSummary(st, h).some((r) => /shelving unit 150/i.test(r)), `the Overview's Storage row counts it (${storageSummary(st, h)[1]})`);
  const L = containersOf(st, h);
  const c = L.find((x) => x.key === keyOf(shelf));
  check(c && c.assignable, "an assignable container in the Storage tab");
  const gearKey = firstKey((d) => d.cat === "tools" && d.slot === "pack" && !d.bulky) || firstKey((d) => d.cat === "camp" && !d.bulky);
  h.armory.push(makeItem(gearKey, 0.9));
  const it = h.armory[h.armory.length - 1];
  autoStore(st, h);
  check(it.store === keyOf(shelf), `Tidy up: gear goes to the shelving unit first (${it.name} → ${it.store})`);
  // On the battle map: its cells a store raiders search.
  BM.refreshBaseMap(st);
  globalThis.window = {}; try { BM.openBaseMap(st, h.id); } finally { delete globalThis.window; }
  const F = st.combat && st.combat.deployPlan && st.combat.deployPlan.fort;
  check(!!F && F.stores.some((x) => x.key === keyOf(shelf) && x.room === 150), "on the base's battle map: a store of 150 kg");
  st.combat = null;
  // Picked up: back in the stores, whole.
  const pm = demolish(st, h, shelf.id);
  check(inArmory(h, "f_shelf") === 1 && !h.buildings.includes(shelf) && storageOf(st, h).cap === cap0, `picked up: back in the stores (${pm})`);
}

section("A wardrobe, a gun rack, a tool chest");
{
  const st = world();
  const h = hub(st);
  withHouse(st, h, "gen_hall", -14, 6);
  const ward = set(st, h, "f_wardrobe"), rack = set(st, h, "f_gunrack"), chest = set(st, h, "f_toolchest");
  const wearKey = firstKey((d) => d.slot === "head") || firstKey((d) => d.slot === "backpack");
  h.armory.push(makeItem(wearKey, 0.9));
  const coat = h.armory[h.armory.length - 1];
  autoStore(st, h);
  check(coat.store === keyOf(ward), `clothing to the wardrobe first (${coat.name} → ${coat.store})`);
  // Guns: up to six in the rack, the seventh elsewhere; nothing else goes in.
  const guns = Object.keys(GEAR).filter((k) => GUN(GEAR[k]) && GEAR[k].weight <= 5).slice(0, 7);
  for (const k of guns) h.armory.push(makeItem(k, 0.9));
  autoStore(st, h);
  const inRack = h.armory.filter((x) => x.store === keyOf(rack));
  check(inRack.length === 6 && inRack.every((x) => GUN(GEAR[x.key])), `the gun rack takes six guns (${inRack.length}: ${inRack.map((x) => x.key).join(", ")})`);
  const seventh = h.armory.find((x) => GUN(GEAR[x.key]) && x.store !== keyOf(rack));
  check(!!seventh && /6 at most/.test(putItem(st, h, seventh, keyOf(rack))), `a seventh refused: ${seventh && putItem(st, h, seventh, keyOf(rack))}`);
  check(/guns only/.test(putItem(st, h, coat, keyOf(rack))), `clothing refused: ${putItem(st, h, coat, keyOf(rack))}`);
  h.stock.scrap = 20;
  check(/guns only/.test(putSupply(st, h, "scrap", 5, keyOf(rack))), "no supplies in it");
  const s = storageOf(st, h);
  const rc = s.containers.find((x) => x.key === keyOf(rack));
  check(rc.gear.length === 6 && Object.keys(rc.sup).length === 0, "storageOf: the rack holds its six guns and nothing else");
  // The rack's spare room is no room for the rest: a heavy pile of scrap does not fill it.
  h.stock.scrap = 5000;
  const s2 = storageOf(st, h);
  const rackSpare = 40 - s2.containers.find((x) => x.key === keyOf(rack)).kg;
  check(s2.free <= 1e-6 && rackSpare > 0, `a pile of scrap leaves the rack's spare ${rackSpare.toFixed(1)} kg empty (free ${s2.free})`);
  h.stock.scrap = 0;
  // A tool chest: tools first, and the tools in it count for the jobs that need them.
  const toolKey = Object.keys(GEAR).find((k) => GEAR[k].cat === "tools" && /hammer/i.test(GEAR[k].name) && !GEAR[k].furniture);
  h.armory.push(makeItem(toolKey, 0.9));
  const ham = h.armory[h.armory.length - 1];
  autoStore(st, h);
  check(ham.store === keyOf(chest), `a tool to the tool chest (${ham.name} → ${ham.store})`);
  check(baseToolItems(st, h).includes(ham) && toolsMissing(baseToolItems(st, h), ["hammer"]).length === 0, "the tools in the tool chest count for toolreqs (a hammer at hand)");
  check(/tools only/.test(putItem(st, h, coat, keyOf(chest))), "the tool chest takes tools only");
}

section("Comfort: a sofa");
{
  const st = world();
  const h = hub(st);
  const hall = withHouse(st, h, "gen_barn", -14, 4);
  const people = residents(st, h.id);
  // Six beds in the barn for six sleepers.
  for (let i = 0; i < 6; i++) set(st, h, "bed");
  const sofa = set(st, h, "f_sofa");
  check(BM.fittingsIn(st, h, hall.id).filter((o) => o.rec && (o.rec.type === "bed" || o.rec === sofa)).length === 7, "the beds and the sofa stand in the barn");
  const sleepers = people.slice(0, 6), extra = people.slice(6);
  for (const p of extra) p.alive = false; // six living there
  const line = (s) => FU.comfortLine(st, s, h);
  const l0 = line(sleepers[0]);
  check(l0 && Math.abs(l0.v - 0.5) < 1e-9 && /sofa/.test(l0.label), `+0.5 to each of six sleepers (${l0 && `${l0.label} ${l0.v}`})`);
  check(moodFactors(st, sleepers[0]).list.some((f) => /^Comforts: sofa/.test(f.label) && f.v === 0.5), "one line in the day's mood");
  // Twelve sleepers, one sofa: a share each; two sofas: +0.5 again.
  const c1 = FU.comfortOf(h, [sofa], 12);
  check(Math.abs(c1.v - 0.25) < 1e-9, `one sofa for 12 sleepers: +${c1.v} each`);
  const c2 = FU.comfortOf(h, [sofa, { ...sofa, id: -1 }, { ...sofa, id: -2 }], 12);
  check(Math.abs(c2.v - 0.5) < 1e-9, `three sofas for 12: still +${c2.v} (one for every ${COMFORT.SEATS} counts)`);
  // Capped: everything at once.
  for (const k of ["f_piano", "f_armchair", "f_diningtable", "f_rug", "f_painting", "f_plant", "f_lamp", "f_rug", "f_rug", "f_rug", "f_rug"]) { h.armory.push(makeItem(k, 0.9)); FU.setFurniture(st, h, k); }
  const raw = FU.comfortOf(h, h.buildings.filter((b) => b.type.startsWith("f_")), 6);
  const lc = line(sleepers[0]);
  check(raw.v > COMFORT.MAX && lc && lc.v === COMFORT.MAX, `capped: ${raw.v} → ${lc && lc.v} (COMFORT.MAX ${COMFORT.MAX})`);
  const decorOnly = FU.comfortOf(h, h.buildings.filter((b) => FU.isDecor(b.type)), 6);
  check(decorOnly.v === COMFORT.DECOR_MAX, `decor at most +${COMFORT.DECOR_MAX} a building (${decorOnly.v})`);
}

section("Work: a found workbench");
{
  const st = world();
  const h = hub(st);
  withHouse(st, h, "gen_hall", -14, 6);
  Object.assign(h.stock, { scrap: 99, wood: 999, parts: 9 });
  check(!hasBench(h) && /bench/.test(canCraft(st, h, "bed").reason || ""), "no bench: a bed cannot be crafted");
  set(st, h, "f_workbench");
  check(hasBench(h), "a found workbench set in a hall: a crafting bench");
}

section("Demolish the building: every piece comes back");
{
  const st = world();
  const h = hub(st);
  const hall = withHouse(st, h, "gen_hall", -14, 6);
  for (const k of ["f_shelf", "f_crate", "f_sofa", "bed"]) set(st, h, k);
  const before = h.buildings.filter((b) => FU.isFurniture(b.type)).length;
  const msg = demolish(st, h, hall.id);
  check(before === 4 && ["f_shelf", "f_crate", "f_sofa", "bed"].every((k) => inArmory(h, k) === 1) && !h.buildings.some((b) => FU.isFurniture(b.type)), `the hall pulled down: all ${before} pieces back in the stores (${msg})`);
}

section("The governor");
{
  const st = world();
  const h = hub(st);
  withHouse(st, h, "gen_hall", -14, 6);
  Object.assign(h.stock, { wood: 5000, buildmat: 20 });
  h.armory.push(makeItem("f_shelf", 0.9));
  // About 100 kg of scrap lying outside: a storage wish the shelving unit (150 kg) answers.
  const free = storageOf(st, h).free;
  h.stock.scrap = Math.ceil((free + 100) / supWeight("scrap"));
  const w0 = storageWish(st, h);
  check(!!w0 && w0.type === "f_shelf" && storageOf(st, h).outsideKg > 50, `goods outside (${storageOf(st, h).outsideKg} kg): the storage wish is the stored shelving unit, not crates (${w0 && w0.type})`);
  st.hour = 24 * 4 + 7; // the morning's plan
  governBase(st, h);
  check(h.buildings.some((b) => b.type === "f_shelf") && inArmory(h, "f_shelf") === 0, "the governor set the stored shelving unit");
  check(!h.construction.some((c) => BUILDINGS[c.type] && BUILDINGS[c.type].storeKg > 0) && storageOf(st, h).outsideKg === 0, `and queued no storage for what it holds (queued: ${h.construction.map((c) => c.type).join(", ") || "none"}; outside ${storageOf(st, h).outsideKg} kg)`);
  // Comfort: a sofa set while it counts.
  h.armory.push(makeItem("f_sofa", 0.9), makeItem("f_sofa", 0.9), makeItem("f_sofa", 0.9), makeItem("f_sofa", 0.9), makeItem("f_sofa", 0.9));
  FU.governComfort(st, h);
  const n = h.buildings.filter((b) => b.type === "f_sofa").length;
  check(n === Math.min(5, Math.ceil(residents(st, h.id).length / COMFORT.SEATS)), `sofas set: one for every ${COMFORT.SEATS} people (${n} for ${residents(st, h.id).length})`);
}

section("AI groups");
{
  const st = world();
  const f = st.factions.find((x) => x.alive && x.bases.length && x.homes !== undefined) || st.factions.find((x) => x.alive && x.bases.length);
  check(!!f && st.groupWorks, `a group that builds (${f && f.name})`);
  const tile = f.bases[0];
  f.pop = 12;
  const w = worksAt(f, tile);
  Object.assign(w, { water: 3, farms: 3, beds: 2, walls: 6, hall: 1 });
  const home = homesOf(st, f)[tile];
  const cap0 = groupStorage(st, f, tile).cap;
  home.armory.push(makeItem("f_shelf", 0.9));
  const got = FU.groupFurnitureDaily(st, f);
  check(got.includes("f_shelf") && w.f_shelf === 1 && !home.armory.some((it) => it.key === "f_shelf"), `their shelving unit set in their hall (${got.join(", ")})`);
  const cap1 = groupStorage(st, f, tile).cap;
  check(cap1 === cap0 + 150 && home.buildings.some((b) => b.type === "f_shelf"), `their storage counts it (${cap0} → ${cap1} kg)`);
  const w2 = worksAt(f, tile);
  delete w2.hall;
  home.armory.push(makeItem("f_crate", 0.9));
  check(FU.groupFurnitureDaily(st, f).length === 0, "no hall: nothing set (your rule: a building to stand in)");
}

section("A saved game from before");
{
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true;
  const h = hub(st);
  const beds0 = baseBeds(h), set0 = JSON.stringify(FU.furnitureSet(h));
  const st2 = loadFromString(saveToString(st));
  const h2 = hub(st2);
  check(baseBeds(h2) === beds0 && JSON.stringify(FU.furnitureSet(h2)) === set0 && !h2.buildings.some((b) => b.type.startsWith("f_")), `loads with its beds unchanged (${beds0} beds: ${set0})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
