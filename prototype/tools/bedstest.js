// Beds as furniture (src/sim/beds.js, src/sim/data-beds.js; the user's request 2026-10-20: "Cots 1x2 mood debuff,
// Beds 1x2, bunkbeds 1x2 mood debuff and large beds 2x2 mood buff can be created and set in buildings to add beds for
// a base").
// Checks: the four pieces' numbers (size, sleepers, mood, cheapest to dearest); each crafted at the bench at its cost
// into an item in the armory (bulky, both arms); set inside a general building (the Construction road, placed by the
// game, and the base map's Build list where it is clicked, turned), adding its sleepers to the base's beds, refused
// outside a building, with none in the stores, a large bed refused in a hut; on the battle map as bed cells the
// barricade rules can shove; picked up again whole, carried out of a building pulled down; mood by the bed slept in
// (a large bed +1, a bed nothing, a bunk −0.5, a cot −1, applied by the day's mood), the best beds first, people
// without a bed sleeping rough; an old save's makeshift cots set as Cots (save / load) and never built again; the
// governor setting furniture from the stores and crafting a bed when beds are short; an AI group's hall, its furniture
// crafted at your costs, its beds counted, on its base's map inside the hall, and its people's mood; loose beds found
// where people slept.
// Usage: node tools/bedstest.js [seed]
import { createWorld, hub, residents, atBase, makeSurvivor } from "../src/sim/world.js";
import { registerCombatHandler } from "../src/sim/combat.js";
import { BUILDINGS, addBuilding, queueBuild, canBuild, baseBeds, plainBeds, demolish, countAll, SHELTER } from "../src/sim/buildings.js";
import { CRAFTS, canCraft, queueCraft, craftingHour, craftQueue } from "../src/sim/crafting.js";
import { GEAR } from "../src/sim/data.js";
import { ITEM_TAGS, SITE_TAGS, fitsTags } from "../src/sim/loot.js";
import { FURNITURE, shoveable } from "../src/sim/barricade.js";
import { moodFactors, relationsDaily } from "../src/sim/relations.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { GROUP_WORKS, groupWorksDaily, nextWork, worksAt } from "../src/sim/groupworks.js";
import { homesOf, syncBuildings, worksBuildings } from "../src/sim/groupbases.js";
import { desertPressure } from "../src/sim/groupcare.js";
import { governBase } from "../src/sim/autopilot.js";
import { makeItem } from "../src/sim/crafting.js";
import * as BM from "../src/sim/basemap.js";
import * as BD from "../src/sim/beds.js";
import { BED_SPEC, BED_KINDS, BED_CRAFTS, BED_GEAR, BED_MOOD, BED_FINDS, BEDS_AI } from "../src/sim/data-beds.js";

const seed = Number(process.argv[2] || 21);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
registerCombatHandler("bedst", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.hour = 24 * 3 + 7; return st; };
const rich = (base) => Object.assign(base.stock, { scrap: 999, parts: 99, wood: 5000, buildmat: 99 });
const keyOf = (b) => `b:${b.id}`;
const openView = (st, base, pick = null) => { globalThis.window = {}; try { return BM.openBaseMap(st, base.id, pick); } finally { delete globalThis.window; } };
const inArmory = (base, k) => base.armory.filter((it) => it && it.key === k).length;
// A hub with a standing lodge placed by hand at (x, y): its floor cells.
function withLodge(st, base, x = -14, y = 6) {
  const lodge = addBuilding(base, "gen_lodge");
  check(BM.placeItem(st, base, keyOf(lodge), x, y, 0) === "", `a lodge placed at ${x}, ${y}`);
  return lodge;
}

section("The pieces");
{
  check(BED_KINDS.join(",") === "cot,bed,bunkbed,bigbed", "four pieces: a cot, a bed, a bunk bed, a large bed");
  const sz = (k) => `${BED_SPEC[k].w}x${BED_SPEC[k].h}`;
  check(sz("cot") === "1x2" && sz("bed") === "1x2" && sz("bunkbed") === "1x2" && sz("bigbed") === "2x2", "a cot, a bed and a bunk bed 1 × 2; a large bed 2 × 2");
  check(BED_SPEC.cot.sleepers === 1 && BED_SPEC.bed.sleepers === 1 && BED_SPEC.bunkbed.sleepers === 2 && BED_SPEC.bigbed.sleepers === 2, "sleepers: 1, 1, 2, 2");
  check(BED_SPEC.cot.mood < 0 && BED_SPEC.bed.mood === 0 && BED_SPEC.bunkbed.mood < 0 && BED_SPEC.bigbed.mood > 0, "mood: a cot and a bunk bed a penalty, a bed none, a large bed a bonus");
  const worth = (k) => Object.entries(BED_CRAFTS[k].in).reduce((a, [s, n]) => a + n * ({ scrap: 1, wood: 0.02, parts: 6 }[s] || 0), 0);
  check(BED_KINDS.every((k, i) => i === 0 || (worth(k) > worth(BED_KINDS[i - 1]) && BED_CRAFTS[k].hours > BED_CRAFTS[BED_KINDS[i - 1]].hours)), `cheapest to dearest in materials and hours (${BED_KINDS.map((k) => `${k} ${worth(k).toFixed(1)}/${BED_CRAFTS[k].hours}h`).join(", ")})`);
  check(BED_KINDS.every((k) => GEAR[k] && GEAR[k].bulky && GEAR[k].twoHands && GEAR[k].slot === "pack" && GEAR[k].weight > 0 && GEAR[k].desc), "each an item: bulky, carried in both arms (or a cart), with a weight and a description");
  check(BED_KINDS.every((k, i) => i === 0 || GEAR[k].weight > GEAR[BED_KINDS[i - 1]].weight), `weights rise with the piece (${BED_KINDS.map((k) => GEAR[k].weight).join(", ")} kg)`);
  check(BED_KINDS.every((k) => CRAFTS[k] && CRAFTS[k].gear === k && BUILDINGS[k] && BUILDINGS[k].fit && BUILDINGS[k].furniture && BM.FOOT[k] && BM.FOOT[k].fit && BM.FOOT[k].k === "bed"), "a recipe, a placed fitting and a bed footprint for each");
  check(FURNITURE.bed && BED_KINDS.every((k) => ITEM_TAGS[k]), "bed cells are furniture to the barricade rules; each piece has loot tags");
}

section("Crafted at its cost");
{
  const st = world();
  const h = hub(st);
  rich(h);
  addBuilding(h, "craftbench");
  const crafter = atBase(st, h.id)[0];
  crafter.role = "craft";
  crafter.skills.mechanics = 6;
  for (const k of BED_KINDS) {
    const before = { ...h.stock };
    check(canCraft(st, h, k).ok, `${BED_SPEC[k].name}: can be crafted with a bench and a Mechanics 6 crafter`);
    queueCraft(st, h, k);
    const paid = Object.entries(BED_CRAFTS[k].in).every(([s, n]) => Math.abs((before[s] || 0) - (h.stock[s] || 0) - n) < 1e-9);
    check(paid, `${BED_SPEC[k].name}: paid ${Object.entries(BED_CRAFTS[k].in).map(([s, n]) => `${n} ${s}`).join(", ")}`);
    const had = inArmory(h, k);
    for (let i = 0; i < 200 && craftQueue(h).length; i++) { st.hour++; craftingHour(st); }
    check(inArmory(h, k) === had + 1, `${BED_SPEC[k].name}: finished into the armory`);
  }
  // No bench: the recipes want one.
  const st2 = world(seed + 1), h2 = hub(st2);
  rich(h2);
  check(BED_KINDS.every((k) => /bench/.test(canCraft(st2, h2, k).reason || "")), "no bench: every bed recipe wants a crafting bench");
}

section("Set inside a building");
{
  const st = world();
  const h = hub(st);
  rich(h);
  const b0 = baseBeds(h);
  check(/No cot in the stores/.test(canBuild(st, h, "cot").reason || ""), `none in the stores: ${canBuild(st, h, "cot").reason}`);
  h.armory.push(makeItem("cot"));
  check(/Needs a building to stand in/.test(canBuild(st, h, "cot").reason || ""), `no general building: ${canBuild(st, h, "cot").reason}`);
  const lodge = withLodge(st, h);
  check(canBuild(st, h, "cot").ok, "with a lodge standing: a cot can be set");
  // The Construction road: set with no spot, the game places it on the lodge's floor.
  const msg = queueBuild(st, h, "cot");
  check(/Cot set/.test(msg) && !h.construction.length && inArmory(h, "cot") === 0, `set from the stores, no job queued (${msg})`);
  check(baseBeds(h) === b0 + 1, `+1 bed (${b0} → ${baseBeds(h)})`);
  const cot = h.buildings.find((b) => b.type === "cot");
  const e = BM.layoutOf(st, h).find((q) => q.it.key === keyOf(cot));
  const floor = new Set(BM.floorCellsOf(BM.itemByKey(st, h, keyOf(lodge)), lodge.at).map(([x, y]) => `${x},${y}`));
  check(e && e.at && e.auto && floor.has(`${e.at[0]},${e.at[1]}`), `the game put it on the lodge's floor (at ${e && e.at})`);
  check(BM.fittingsIn(st, h, lodge.id).some((o) => o.rec === cot), "it stands inside the lodge (fittingsIn)");
  // The base map's Build list: Furniture, set where it is clicked, turned.
  for (const k of ["bunkbed", "bigbed"]) h.armory.push(makeItem(k));
  openView(st, h);
  const menu = BM.buildMenu(st, h);
  const fm = menu.filter((m) => m.group === "Furniture");
  check(fm.length === 4 && fm.every((m) => m.furniture) && fm.find((m) => m.type === "bigbed").have === 1 && fm.find((m) => m.type === "bigbed").ok && !fm.find((m) => m.type === "bed").ok, `the Build list's Furniture group (${fm.map((m) => `${m.type} ${m.have}${m.ok ? " ok" : ""}`).join(", ")})`);
  const b = st.combat;
  const F = b.deployPlan.fort;
  const [lx, ly] = lodge.at;
  check(BM.layoutAct(st, b, { type: "pickType", bt: "bigbed" }) === "", "a large bed picked");
  // The lodge (6 × 5) floor is x+1..x+4, y+1..y+3; the ghost is centred on the cell (a 2 × 2: the cell is its bottom right).
  let err = BM.layoutAct(st, st.combat, { type: "build", x: lx + 4 + F.ox, y: ly + 2 + F.oy });
  const big = h.buildings.find((x) => x.type === "bigbed");
  check(err === "" && big && big.at && big.at[0] === lx + 3 && big.at[1] === ly + 1 && inArmory(h, "bigbed") === 0, `set where clicked (${err || `at ${big && big.at}`})`);
  check(baseBeds(h) === b0 + 3 && st.combat.layout.pickType === null, `+2 beds (${baseBeds(h)}); none left in the stores, the pick put down`);
  check(BM.layoutAct(st, st.combat, { type: "pickType", bt: "bunkbed" }) === "" && BM.layoutAct(st, st.combat, { type: "rotate" }) === "", "a bunk bed picked and turned");
  err = BM.layoutAct(st, st.combat, { type: "build", x: lx - 3 + F.ox, y: ly - 3 + F.oy });
  check(/Only inside a building/.test(err) && inArmory(h, "bunkbed") === 1, `out in the yard: refused, still in the stores (${err})`);
  // The first free spot on the lodge's floor the turned ghost fits (the hover's green).
  const spot = BM.floorCellsOf(BM.itemByKey(st, h, keyOf(lodge)), lodge.at).map(([x, y]) => [x + F.ox, y + F.oy]).find(([x, y]) => { const g = BM.ghostAt(st, st.combat, x, y); return g && g.ok; });
  err = spot ? BM.layoutAct(st, st.combat, { type: "build", x: spot[0], y: spot[1] }) : "no spot";
  const bunk = h.buildings.find((x) => x.type === "bunkbed");
  check(err === "" && bunk && bunk.at && bunk.at[2] === 1 && bunk.host === lodge.id, `inside the lodge, turned (${err || `at ${bunk && bunk.at}`})`);
  check(baseBeds(h) === b0 + 5 && BD.furnitureBeds(h) === 5, `a cot 1 + a large bed 2 + a bunk bed 2: ${BD.furnitureBeds(h)} furniture beds, ${baseBeds(h)} in all`);
  // The battle map: bed cells, shoveable.
  const cellAt = (gx, gy) => st.combat.cells[(gy + F.oy) * st.combat.w + gx + F.ox];
  const bigCells = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => cellAt(big.at[0] + dx, big.at[1] + dy));
  check(bigCells.every((c) => c && c.k === "bed" && shoveable(c)), `on the map: the large bed is four bed cells the barricade rules can shove (${bigCells.map((c) => c && c.k).join(", ")})`);
  st.combat = null;
  // A hut's floor has no room for a large bed.
  const st2 = world(seed + 2), h2 = hub(st2);
  rich(h2);
  const hut = addBuilding(h2, "gen_hut");
  BM.placeItem(st2, h2, keyOf(hut), -12, 6, 0);
  h2.armory.push(makeItem("bigbed"), makeItem("bed"));
  check(/Needs a building/.test(canBuild(st2, h2, "bigbed").reason || "") && canBuild(st2, h2, "bed").ok, "a hut takes a bed but has no floor for a large bed");
  // Picked up: back in the stores, whole.
  const cond = cot.item && cot.item.quality;
  const text = demolish(st, h, cot.id);
  check(/picked up/.test(text) && inArmory(h, "cot") === 1 && h.armory.find((it) => it.key === "cot").quality === cond && baseBeds(h) === b0 + 4, `Demolish picks it up (${text})`);
  const t1 = h.armory.find((it) => it.key === "cot");
  check(t1 === cot.item, "the very item it was set from");
  // Its building pulled down: the furniture carried out into the stores.
  const t2 = demolish(st, h, lodge.id);
  check(!h.buildings.some((x) => BD.isFurniture(x.type)) && inArmory(h, "bigbed") === 1 && inArmory(h, "bunkbed") === 1 && baseBeds(h) === b0, `the lodge pulled down: its furniture back in the stores (${t2})`);
  check(!/salvaged.*bed/.test(t2) && /carried out/.test(t2), "named as carried out, not salvaged");
}

section("Mood by the bed");
{
  const st = world();
  const h = hub(st);
  rich(h);
  h.buildings = h.buildings.filter((b) => b.type !== "bunkhouse" && b.type !== "barracks" && b.type !== "bunks");
  for (let i = 0; i < 6; i++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); } // more people than the large bed and the plain beds
  const people = residents(st, h.id).filter((s) => !s.inBed).sort((a, b) => (b.leader ? 1 : 0) - (a.leader ? 1 : 0) || a.id - b.id);
  check(people.length >= 6, `${people.length} people at the hub`);
  const line = (s) => moodFactors(st, s).list.find((f) => /^Sleeps/.test(f.label)) || null;
  const own = (s) => moodFactors(st, s).own;
  // With the plain beds only: the first plainBeds sleep in a bed (no line), the rest sleep rough.
  const plain = plainBeds(h) - (h.kidBeds || 0);
  const roughs = people.slice(plain);
  check(people.slice(0, plain).every((s) => !line(s)), `the first ${plain} in the base's own beds: no bed line`);
  check(roughs.length > 0 && roughs.every((s) => line(s) && line(s).v === BED_MOOD.rough && /rough/.test(line(s).label)), `the other ${roughs.length} sleep rough (${roughs.length ? line(roughs[0]).label : ""}, ${BED_MOOD.rough})`);
  const before = new Map(people.map((s) => [s.id, own(s)]));
  // Furniture: one large bed (2), one bunk bed (2), cots for the rest; the best beds go first.
  const lodge = withLodge(st, h);
  const hall = addBuilding(h, "gen_hall");
  BM.placeItem(st, h, keyOf(hall), 6, 6, 0);
  addBuilding(h, "bigbed"); addBuilding(h, "bunkbed");
  for (let i = 0; i < Math.max(0, people.length - plain - 4); i++) addBuilding(h, "cot");
  const lay = BM.layoutOf(st, h).filter((e) => BD.isFurniture(e.it.type));
  check(lay.every((e) => e.at), `all ${lay.length} pieces placed by the game inside the lodge and the hall`);
  const slots = BD.bedSlots(h);
  check(slots.length === baseBeds(h) && slots[0].kind === "bigbed" && slots[slots.length - 1].kind === "cot", `the beds best first: ${slots.map((x) => x.kind).join(", ")}`);
  const a = BD.bedAssignments(st, h);
  const expect = (s) => a.get(s.id);
  const big = people.filter((s) => expect(s) && expect(s).kind === "bigbed"), cots = people.filter((s) => expect(s) && expect(s).kind === "cot"), bunks = people.filter((s) => expect(s) && expect(s).kind === "bunkbed");
  check(big.length === 2 && big[0] === people[0], `the large bed's two: the leader first (${big.map((s) => s.name).join(", ")})`);
  check(big.every((s) => line(s) && line(s).v === BED_SPEC.bigbed.mood && /large bed/.test(line(s).label)), `a large bed: +${BED_SPEC.bigbed.mood} a day`);
  check(bunks.length === 2 && bunks.every((s) => line(s) && line(s).v === BED_SPEC.bunkbed.mood), `a bunk bed: ${BED_SPEC.bunkbed.mood} a day each`);
  check(cots.length >= 1 && cots.every((s) => line(s) && line(s).v === BED_SPEC.cot.mood && /cot/.test(line(s).label)), `a cot: ${BED_SPEC.cot.mood} a day`);
  check(people.every((s) => expect(s)), "nobody sleeps rough with a bed for everyone");
  // The day's own mood moves by the bed: the one who went from a plain bed to the large bed gains 1, a rough sleeper set on a cot gains the difference.
  const d = (s) => Math.round((own(s) - before.get(s.id)) * 10) / 10;
  const fromPlain = big.find((s) => people.indexOf(s) < plain);
  void lodge;
  check(fromPlain && d(fromPlain) === BED_SPEC.bigbed.mood, `a plain bed to the large bed: own mood ${d(fromPlain)} a day`);
  const roughToCot = cots.find((s) => people.indexOf(s) >= plain);
  check(roughToCot && d(roughToCot) === Math.round((BED_SPEC.cot.mood - BED_MOOD.rough) * 10) / 10, `sleeping rough to a cot: ${d(roughToCot)} a day (${BED_SPEC.cot.mood} instead of ${BED_MOOD.rough})`);
  // Applied by the day's mood (relations.js relationsDaily: the own factors).
  const s0 = big[0], s1 = cots[cots.length - 1];
  const m0 = s0.mood = 50, m1 = s1.mood = 50;
  const own0 = own(s0), own1 = own(s1);
  st.relDay = -1; relationsDaily(st);
  check(Math.abs(s0.mood - Math.min(100, Math.max(0, m0 + own0)) ) < 1e-6 && Math.abs(s1.mood - Math.min(100, Math.max(0, m1 + own1))) < 1e-6 && own0 - own1 >= BED_SPEC.bigbed.mood - BED_SPEC.cot.mood - 3, `the day's mood: the large bed's ${s0.name} ${m0} → ${s0.mood.toFixed(1)}, the cot's ${s1.name} ${m1} → ${s1.mood.toFixed(1)}`);
}

section("Old saves: the makeshift cots");
{
  const st = world();
  const h = hub(st);
  h.tier = 0; // a shelter
  h.buildings = [];
  const g = addBuilding(h, "gen_cabin");
  BM.placeItem(st, h, keyOf(g), -10, 6, 0);
  h.buildings.push({ id: 900001, type: "cots" }, { id: 900002, type: "cots" });
  const was = SHELTER.beds + 4;
  const st2 = loadFromString(saveToString(st));
  const h2 = hub(st2);
  check(!h2.buildings.some((b) => b.type === "cots") && countAll(h2, "cot") === 4, `two built makeshift cots → four Cots set (${countAll(h2, "cot")})`);
  check(baseBeds(h2) === was, `the shelter's beds unchanged (${was} → ${baseBeds(h2)})`);
  check(h2.buildings.filter((b) => b.type === "cot").every((b) => b.item && b.item.key === "cot"), "each keeps an item to pick up");
  check(BM.layoutOf(st2, h2).filter((e) => e.it.type === "cot").filter((e) => e.at).length >= 2, "placed by the game inside the cabin (as many as its floor takes)");
  const c = canBuild(st2, h2, "cots");
  check(!c.ok && c.locked && /Superseded/.test(c.reason), `never built again (${c.reason})`);
  check(BD.migrateCots(st2) === 0, "idempotent: nothing left to migrate");
}

section("The governor");
{
  const st = world();
  const h = hub(st);
  rich(h);
  h.buildings = [];
  addBuilding(h, "craftbench");
  withLodge(st, h);
  h.armory.push(makeItem("bed"));
  const crafter = atBase(st, h.id)[0];
  crafter.role = "craft"; crafter.skills.mechanics = 5;
  const lines = BD.governBeds(st, h);
  check(countAll(h, "bed") === 1 && inArmory(h, "bed") === 0, `the bed in the stores set (${lines[0] || ""})`);
  const crowded = residents(st, h.id).length > baseBeds(h);
  check(!crowded || craftQueue(h).some((j) => j.recipe === "bunkbed"), `beds short (${residents(st, h.id).length} for ${baseBeds(h)}): a bunk bed queued at the bench (${lines.slice(1).join(" ")})`);
  st.hour = 24 * 4 + 7; // the morning's plan hour (autopilot.js PLAN_HOUR) through governBase
  h.armory.push(makeItem("cot"));
  governBase(st, h);
  check(countAll(h, "cot") === 1, "governBase sets furniture at the morning's plan");
}

section("AI groups");
{
  const st = world();
  const f = st.factions.find((x) => x.alive && x.bases.length);
  check(!!f && st.groupWorks, `a group that builds (${f && f.name})`);
  const tile = f.bases[0];
  f.pop = 16;
  Object.assign(f.stock, { scrap: 400, parts: 20, wood: 4000 });
  f.partsMach = 0;
  const w = worksAt(f, tile);
  Object.assign(w, { water: 5, farms: 5, beds: 1, walls: 7, bench: 1, store: 1, kitchen: 1, shop: 1, radio: 1, garage: 1, reload: 1, gate: 1, sickbay: 4 });
  const hw = BD.hallWork(st, f, tile);
  check(hw && hw.type === "hall" && hw.def.cost.scrap === BUILDINGS.gen_lodge.cost.scrap && hw.def.cost.parts === BUILDINGS.gen_lodge.cost.parts, `a hall (your Lodge: ${JSON.stringify(hw && hw.def.cost)}, ${hw && hw.def.work} crew-days)`);
  check(GROUP_WORKS.WORKS.hall && GROUP_WORKS.WORKS.hall.name === "a lodge for beds", "a work of theirs (WORKS.hall)");
  w.hall = 1;
  const roughBefore = w.beds * GROUP_WORKS.SERVES.beds;
  const s0 = { ...f.stock };
  const got = BD.groupBedsDaily(st, f);
  check(got && got.type === "bunkbed" && w.bunkbed === 1, `people sleep rough (${roughBefore} quarters' beds): a bunk bed crafted (${got && got.type})`);
  check(Object.entries(BED_CRAFTS.bunkbed.in).every(([k, v]) => Math.abs((s0[k] || 0) - (f.stock[k] || 0) - v) < 1e-9), `paid at your cost (${Object.entries(BED_CRAFTS.bunkbed.in).map(([k, v]) => `${v} ${k}`).join(", ")})`);
  const nw = nextWork(st, f);
  check(BD.furnSleepers(w) === 2, `its sleepers count as their beds (${BD.furnSleepers(w)})`);
  for (let i = 0; i < 10; i++) BD.groupBedsDaily(st, f);
  const cells = BED_KINDS.reduce((a, k) => a + (w[k] || 0) * BED_SPEC[k].w * BED_SPEC[k].h, 0);
  check(cells <= BEDS_AI.room && BED_KINDS.some((k) => w[k] > 0), `the hall filled no further than its floor (${cells} of ${BEDS_AI.room} cells: ${BED_KINDS.filter((k) => w[k]).map((k) => `${w[k]} ${k}`).join(", ")})`);
  // With everyone in a bed: large beds while they can spare them; their mood.
  const f2w = { hall: 1, beds: 4 };
  f.works[tile] = { ...w, ...f2w, cot: 0, bed: 0, bunkbed: 0, bigbed: 0 };
  const p0 = desertPressure(st, f), m0 = BD.groupBedMorale(st, f);
  const g2 = BD.groupBedsDaily(st, f);
  check(g2 && g2.type === "bigbed", `everyone in a bed: a large bed (${g2 && g2.type})`);
  const m1 = BD.groupBedMorale(st, f);
  check(m1 > m0, `their beds' mood up with the large bed (${m0.toFixed(3)} → ${m1.toFixed(3)})`);
  f.works[tile].bigbed = 0; f.works[tile].cot = 4; f.works[tile].beds = 0;
  check(BD.groupBedMorale(st, f) < 0, `cots weigh on them (${BD.groupBedMorale(st, f).toFixed(3)})`);
  f.works[tile] = { ...f.works[tile], cot: 0, bigbed: 2, beds: 4 };
  check(desertPressure(st, f) <= p0, `desertion pressure with large beds no higher (${p0.toFixed(2)} → ${desertPressure(st, f).toFixed(2)})`);
  // Their base's map: the hall a Lodge, the furniture on its floor.
  f.works[tile] = { ...f.works[tile], bunkbed: 1, cot: 1, bigbed: 1 };
  const wb = worksBuildings(st, f, tile);
  check(wb.gen_lodge === 1 && wb.bunkbed === 1 && wb.cot === 1 && wb.bigbed === 1, `their buildings: ${Object.entries(wb).filter(([k]) => k === "gen_lodge" || BD.isFurniture(k)).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  syncBuildings(st, f);
  const home = homesOf(st, f)[tile];
  const lay = BM.layoutOf(st, home).filter((e) => BD.isFurniture(e.it.type));
  const lodgeE = BM.layoutOf(st, home).find((e) => e.it.type === "gen_lodge");
  const fl = lodgeE && lodgeE.at ? new Set(BM.floorCellsOf(lodgeE.it, lodgeE.at).map(([x, y]) => `${x},${y}`)) : new Set();
  check(lay.length === 3 && lay.every((e) => e.at && fl.has(`${e.at[0]},${e.at[1]}`)), `the auto layout set all ${lay.length} inside their lodge`);
  check(baseBeds(home) >= BD.furnSleepers(f.works[tile]), `their base's beds count the furniture (${baseBeds(home)})`);
  // The day's works run it.
  const st3 = world(seed + 3), f3 = st3.factions.find((x) => x.alive && x.bases.length);
  const w3 = worksAt(f3, f3.bases[0]);
  f3.pop = 30; w3.hall = 1; w3.beds = 0;
  Object.assign(f3.stock, { scrap: 300, wood: 3000 });
  groupWorksDaily(st3, f3);
  check(BD.furnSleepers(w3) > 0, `groupWorksDaily crafts their furniture (${BED_KINDS.filter((k) => w3[k]).map((k) => `${w3[k]} ${k}`).join(", ")})`);
  void nw;
}

section("Loot");
{
  const bad = [];
  for (const [t, def] of Object.entries(BED_FINDS)) for (const k of Object.keys(def.items)) if (!SITE_TAGS[t] || !fitsTags(k, SITE_TAGS[t])) bad.push(`${k} at ${t}`);
  check(!bad.length, `every find fits its place's theme (${bad.join(", ") || "all"})`);
  check(Object.values(BED_FINDS).every((d) => d.p > 0 && d.p <= 0.02), "rare: at most 2% a search hour");
  const st = world();
  const tile = st.tiles.find((t) => t.loc);
  tile.loot = 1;
  let n = 0;
  const found = new Set();
  for (let hr = 0; hr < 4000; hr++) { st.hour = hr; const it = BD.rollBedFind(st, tile.id, "motel", 1, "t"); if (it) { n++; found.add(it.key); } }
  check(n > 20 && n < 120 && [...found].every((k) => BED_FINDS.motel.items[k]), `a motel searched 4000 hours: ${n} finds (${[...found].join(", ")})`);
  check(!BD.rollBedFind(st, tile.id, "gunstore", 1, "t"), "none where nobody slept");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
