// The furniture and appliance catalogue (sim/data-furniture.js, issue #8 of the interiors epic, the user's request
// 2026-10-25): every row has a cell def in combat.js CELL, hit points, a weight, a carry class, a size, a use and a
// name; every "two" piece weighs more than every "one" piece; nothing lootable is fixed; CELL, barricade.js FURNITURE
// and ui/isoview.js's furniture set are driven from the table, with the twelve old kinds as they were; every kind has
// a sprite (primsOf) and a height (blockTop0) in the iso view, outlined; the showroom layout (tools/isobattles.js)
// lays one of every kind and the battle view draws it in every turn of the view without a throw or a NaN; the tooltips
// (structureName) and the codex's Barricades entry name the new pieces.
// Usage: node tools/furnituretest.js
import { FURNITURE_KINDS, CARRY, CARRY_KG, furnitureCells, furnitureHp, furnitureFor, useOf, isFurniture, pieceDef, itemKey, FURNITURE_GEAR } from "../src/sim/data-furniture.js";
import { POWER_GEAR } from "../src/sim/data-power.js";
import { BED_GEAR } from "../src/sim/data-beds.js"; // the cot's item form (issue #15)
import { CELL, structureName, vaultable } from "../src/sim/combat.js";
import { FURNITURE, shoveable, tallPiece } from "../src/sim/barricade.js";
import { battles } from "./isobattles.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const kinds = Object.keys(FURNITURE_KINDS);

console.log("The catalogue's rows");
{
  const bad = [];
  for (const [k, d] of Object.entries(FURNITURE_KINDS)) {
    if (!d.name || typeof d.name !== "string") bad.push(`${k}: name`);
    if (!d.cell || typeof d.cell.walk !== "boolean" || ![0, 1, 2].includes(d.cell.cover) || typeof d.cell.los !== "boolean") bad.push(`${k}: cell`);
    if (!(d.hp > 0)) bad.push(`${k}: hp`);
    if (!(d.kg > 0)) bad.push(`${k}: kg`);
    if (!CARRY.includes(d.carry)) bad.push(`${k}: carry`);
    if (!Array.isArray(d.size) || d.size.length !== 2 || !d.size.every((n) => n === 1 || n === 2)) bad.push(`${k}: size`);
    if (typeof d.loot !== "boolean") bad.push(`${k}: loot`);
    if (!Array.isArray(d.tags) || !d.tags.length) bad.push(`${k}: tags`);
    if (!/^(fridge|freezer|stove|oven|microwave|none|storage:\d+|comfort:-?[\d.]+|work:\w+|bed:\w+)$/.test(d.use)) bad.push(`${k}: use ${d.use}`);
    if (d.cell.walk) bad.push(`${k}: nobody stands on furniture`);
  }
  check(!bad.length, `every row has a name, a cell def, hp, kg, a carry class, a size, loot, tags and a use (${bad.slice(0, 4).join("; ") || "all " + kinds.length}) `);
  const want = ["fridge", "freezer", "stove", "oven", "microwave", "dishwasher", "washer", "dryer", "waterheater", "boiler", "sink", "toilet", "bathtub", "shower", "sofa", "armchair", "chair", "desk", "filing", "bookshelf", "wardrobe", "dresser", "nightstand", "tvstand", "piano", "pew", "altar", "pulpit", "hospbed", "gurney", "ivstand", "medcab", "optable", "vending", "checkout", "displaycase", "coldcase", "workbench", "toolchest", "barrel", "booth", "barcounter", "barstool", "bunk", "schooldesk", "teacherdesk", "bleachers", "serverrack", "copier", "safe"];
  const missing = want.filter((k) => !FURNITURE_KINDS[k]);
  check(!missing.length, `every kind the issue asks for is in it (${missing.join(", ") || want.length + " kinds"})`);
  const one = kinds.filter((k) => FURNITURE_KINDS[k].carry === "one").map((k) => FURNITURE_KINDS[k].kg);
  const two = kinds.filter((k) => FURNITURE_KINDS[k].carry === "two").map((k) => FURNITURE_KINDS[k].kg);
  check(Math.min(...two) > Math.max(...one), `"two" pieces weigh more than "one" pieces (lightest two ${Math.min(...two)} kg, heaviest one ${Math.max(...one)} kg)`);
  check(Math.max(...one) <= CARRY_KG.ONE && Math.min(...two) >= CARRY_KG.TWO, `the line between them (${CARRY_KG.ONE} / ${CARRY_KG.TWO} kg) holds`);
  const lootFixed = kinds.filter((k) => FURNITURE_KINDS[k].loot && FURNITURE_KINDS[k].carry === "fixed");
  check(!lootFixed.length, `nothing lootable is fixed (${lootFixed.join(", ") || "none"})`);
  check(kinds.some((k) => FURNITURE_KINDS[k].carry === "fixed") && kinds.some((k) => FURNITURE_KINDS[k].carry === "one") && kinds.some((k) => FURNITURE_KINDS[k].carry === "two"), "all three carry classes are used");
  check(FURNITURE_KINDS.fridge.kg === 60 && FURNITURE_KINDS.fridge.use === "fridge", "the fridge weighs as data-power.js's Refrigerator (60 kg) and is a fridge at the base");
  check(useOf("shelf").key === "storage" && useOf("shelf").arg === "40" && useOf("sink").key === "none" && useOf("nope").key === "none", "useOf splits a use into its key and argument");
  check(furnitureFor("kitchen").includes("fridge") && furnitureFor("bath").includes("toilet") && furnitureFor("kitchen", true).every((k) => FURNITURE_KINDS[k].loot), "furnitureFor picks a room role's pieces (the containers only, with loot)");
  check(isFurniture("sofa") && !isFurniture("wall"), "isFurniture");
  check(pieceDef("sofa") === FURNITURE_KINDS.sofa && pieceDef("wall") === null, "pieceDef: the row, or null");
  const liftable = kinds.filter((k) => FURNITURE_KINDS[k].carry !== "fixed");
  check(liftable.every((k) => { const g = k === "fridge" ? POWER_GEAR.fridge : k === "cot" ? BED_GEAR.cot : k === "genset" ? POWER_GEAR.genset_military : k === "standbyset" ? POWER_GEAR.genset_standby : FURNITURE_GEAR[`f_${k}`]; return g && g.bulky && g.twoHands && g.weight === FURNITURE_KINDS[k].kg && (k === "fridge" || k === "genset" || k === "standbyset" || g.furniture === k); }) && !FURNITURE_GEAR.f_cot && itemKey("cot") === "cot", "every liftable piece has its item form (f_<kind>, the fridge its own Refrigerator, the cot data-beds.js's Cot): both arms, its weight");
  check(!FURNITURE_GEAR.f_fridge && itemKey("fridge") === "fridge" && itemKey("bathtub") === null && !FURNITURE_GEAR.f_genset && itemKey("genset") === "genset_military" && !FURNITURE_GEAR.f_standbyset && itemKey("standbyset") === "genset_standby" && Object.keys(FURNITURE_GEAR).length === liftable.length - 4, "no f_fridge (nor f_cot, nor f_genset: a bunker's generator is the Military tactical generator; nor f_standbyset: a data centre's standby set is the Home standby generator, issue #51), no item for a fixed piece");
}

console.log("Driven from the table: CELL, barricade FURNITURE, the old twelve kinds as before");
{
  const cells = furnitureCells(), hp = furnitureHp();
  check(kinds.every((k) => CELL[k] && CELL[k].name === FURNITURE_KINDS[k].name && CELL[k].walk === cells[k].walk && CELL[k].cover === cells[k].cover && CELL[k].los === cells[k].los), "every kind is a combat.js CELL with the table's rules and name");
  // The old kinds' rules (combat.js CELL, barricade.js FURNITURE before 2026-10-25).
  const OLD = { shelf: [1, false, "Shelves", 25], locker: [2, true, "Lockers", 40], cabinet: [1, false, "Cabinet", 25], counter: [1, false, "Counter", 30], crate: [1, false, "Crates", 20], rack: [2, true, "Shelving", 35], table: [1, false, "Table", 15], bed: [1, false, "Bed", 20], bars: [1, false, "Cell bars", null], hay: [1, false, "Hay bales", 15], barrel: [1, false, "Rain barrels", 15], gunsafe: [2, false, "Gun safe", null] };
  const off = Object.entries(OLD).filter(([k, [cover, los, name, h]]) => !CELL[k] || CELL[k].walk || CELL[k].cover !== cover || CELL[k].los !== los || CELL[k].name !== name || (h == null ? !!FURNITURE[k] : !FURNITURE[k] || FURNITURE[k].hp !== h));
  check(!off.length, `the twelve old kinds keep their cover, sight, names and shove hit points (${off.map(([k]) => k).join(", ") || "all twelve"})`);
  check(FURNITURE.sandbag && FURNITURE.sandbag.hp === 20, "sandbags still shove (20 hp)");
  check(kinds.every((k) => (FURNITURE_KINDS[k].carry === "fixed") === !FURNITURE[k]) && kinds.every((k) => !hp[k] || FURNITURE[k].hp === FURNITURE_KINDS[k].hp), "every piece that is not fixed shoves with the table's hit points; nothing fixed shoves");
  check(!shoveable({ k: "bathtub" }) && shoveable({ k: "sofa" }) && tallPiece({ k: "fridge" }) && !tallPiece({ k: "chair" }), "a bathtub is never shoved; a sofa is; a fridge takes two people, a chair one");
  check(vaultable(null, { k: "sofa" }) && !vaultable(null, { k: "fridge" }), "a sofa is vaulted (half cover), a fridge is not");
  check(structureName({ k: "fridge" }) === "Refrigerator" && structureName({ k: "teacherdesk" }) === "Teacher's desk", "the tooltips name the new pieces (structureName)");
}

// The iso view on stub canvases (as tools/shoveviewtest.js).
let nan = 0;
const recorder = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }), getLineDash: () => [] }, {
  get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; }),
  set: (o, k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nan++; o[k] = v; return true; },
});
const silentCvs = (w, h) => ({ width: w, height: h, getContext: () => recorder(), toDataURL: () => "data:," });
globalThis.document = { createElement: () => silentCvs(0, 0), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
const CODEX = await import("../src/ui/codex.js");
ISO.setIsoCanvas(silentCvs);

console.log("Sprites in the iso view");
{
  const P = ISO.furnProbe, bad = [];
  for (const k of kinds) for (const o of [{ v: 0, j: 0, n: null }, { v: 3, j: 3, n: "u" }, { v: 2, j: 12, n: "v" }]) {
    let p;
    try { p = P.primsOf(k, o); } catch (e) { bad.push(`${k}: ${e.message}`); continue; }
    if (!Array.isArray(p) || !p.length) { bad.push(`${k}: no prims`); continue; }
    const top = P.blockTop0(k, o), hi = Math.max(...p.map((q) => q.z1 || 0));
    if (!(top > 0)) bad.push(`${k}: no height`);
    if (p.some((q) => (q.cyl ? !q.cyl.every(Number.isFinite) : ![q.u0, q.u1, q.v0, q.v1].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) || !(q.z1 > q.z0) || typeof q.m !== "function")) bad.push(`${k}: a bad prim`);
    if (hi > top + 1) bad.push(`${k}: drawn above its height (${hi} > ${top})`);
    for (const q of p) { const c = q.m("top", 2, 2, 3, 3, 8, 8) || q.m("south", 2, 2, 3, 3, 8, 8); if (c && !c.every(Number.isFinite)) bad.push(`${k}: a NaN colour`); }
  }
  check(!bad.length, `every kind has prims and a height, inside its cell, with colours (${bad.slice(0, 4).join("; ") || kinds.length + " kinds"})`);
  check(kinds.every((k) => P.OUTLINED().has(k)), "every piece is outlined");
  check(kinds.filter((k) => k !== "barrel").every((k) => P.FURNITURE.has(k)) && !P.FURNITURE.has("barrel") && kinds.filter((k) => k !== "hay" && k !== "barrel").every((k) => P.FLOORED.has(k)), "the iso view's furniture and floored sets come from the table (rain barrels and hay as before)");
  check(P.JOINS().sofa && P.JOINS().sofa.has("sofa") && P.JOINS().fridge && P.JOINS().fridge.has("wall"), "a 2 × 1 piece joins its own kind; a wall-standing one the walls");
}

console.log("The showroom: one of every kind, drawn");
{
  const { st, b } = battles(81, ["furniture"])[0];
  const laid = new Set(b.cells.map((c) => c.k));
  const missing = kinds.filter((k) => !laid.has(k));
  check(!missing.length && b.showroom.length === kinds.length, `the furniture layout shows one of every kind (${missing.join(", ") || b.showroom.length + " pieces"})`);
  const big = b.showroom.find((p) => p.k === "bleachers");
  check(big && b.cells[(big.y + 1) * b.w + big.x + 1].k === "bleachers", "a piece is laid at its size (bleachers 2 × 2)");
  check(!b.units.some((u) => FURNITURE_KINDS[b.cells[u.y * b.w + u.x].k]), "nobody stands on a piece");
  const mainCtx = recorder();
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => mainCtx });
  b.phase = "player";
  const errs = [];
  let clock = 1e6;
  const draw = () => { try { clock += 50; UI.drawCombat(st, clock); } catch (e) { errs.push(e.stack.split("\n").slice(0, 3).join(" ")); } };
  draw();
  for (let r = 0; r < 8; r++) { ISO.isoRotate(b, 1); draw(); }
  ISO.setRoofs(false); draw(); ISO.setRoofs(true);
  check(!errs.length, `the showroom draws in all eight turns of the view, roofs on and off (${errs[0] || "no error"})`);
  check(nan === 0, `no NaN drawn (${nan})`);
}

console.log("The codex");
{
  const e = CODEX.codexEntry("k:barricades");
  const stat = (n) => (e.stats.find((s) => s[0] === n) || [])[1] || "";
  check(/refrigerator/.test(stat("What shoves")) && /sofa/.test(stat("What shoves")) && /sandbags/.test(stat("What shoves")), "the Barricades entry lists what shoves from the table (a refrigerator, a sofa, sandbags)");
  check(/bathtub/.test(stat("Never shoved")) && !/sofa/.test(stat("Never shoved")) && /lockers/.test(stat("Two people")), "and what is fixed, and what takes two people");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
