// The reloading bench (src/sim/reloading.js; docs/weapons-overhaul-plan.md section 12 on section 27's round keys):
// the data (recipes, handload keys, inputs), the upgrade of an ammo bench in place (and that with no order it makes
// exactly what the ammo bench made), the Heat, recipe rates and skill gates, the inputs drawn (brass, primers, powder,
// lead, steel cores, the dies' gun parts), handloads and their make, black powder and match primers, the battle draw
// (factory rounds first) and the handload jam factor in gunfire.js, the aim and noise of handloads, brass picked up
// only after a win (revolvers all of it), the black powder craft, the governor's reserves and trade wants, the other
// groups reloading (and buying powder and primers), merchants' stock, the loot tables, and a save round trip.
// Usage: node tools/reloadbenchtest.js [seed]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { unlockAll } from "../src/sim/blueprints.js";
import { createWorld, hub, newId, makeSurvivor } from "../src/sim/world.js";
import { BUILDINGS, RECIPES, addBuilding, canBuild, constructionHour, runStations, stationStatus, mannedStations, plotsUsed, assignStations, count } from "../src/sim/buildings.js";
import { CRAFTS, canCraft, queueCraft, craftQueue, craftingHour } from "../src/sim/crafting.js";
import { SUPPLIES, GEAR, STOCK_KEYS } from "../src/sim/data.js";
import { HAND_SUPPLIES, HAND_GEAR, RELOAD_GEAR, RELOAD_SUPPLIES, LOADS, LOAD_CLASS, CALIBERS, handKey, loadRecipe, RELOAD_FX } from "../src/sim/data-ammo.js";
import {
  RELOAD, recipeList, inputsPer10, dayRate, handHq, canUpgradeAmmoBench, queueReloadUpgrade, setReloadOrder, reloadOrders, reloadJob, reloadRows,
  autoReloadOrders, autoReloadBench, reloadNeeds, groupReloadDaily, groupBuyReload, groupBrass, merchantReload, handMake, noteHandLoad, reloadWanted,
  setPullOrder, pullOrders, pullJob, pullRows, pullYield, groupPull,
} from "../src/sim/reloading.js";
import { roundsIn, withHand, isHandKey, factoryKey, takeRounds } from "../src/sim/rounds.js";
import { nextHand, takeBattleRounds, roundsOf, packRounds, unbox } from "../src/sim/ammo.js";
import { createBattle, registerCombatHandler, fire, endBattleNow, shotOdds } from "../src/sim/combat.js";
import { jamChance, ammoJam, noteJamWeather, JAM } from "../src/sim/gunfire.js";
import { shotNoise } from "../src/sim/stealth.js";
import { newItem } from "../src/sim/inventory.js";
import { rollSiteReload, rollAreaReload, SITE_RELOAD, ITEM_TAGS } from "../src/sim/loot.js";
import { condRolled } from "../src/sim/itemcond.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { governBase } from "../src/sim/autopilot.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
registerCombatHandler("reloadtest", () => {});
const num = (v) => (Number.isFinite(v) ? v : 0);
const W = () => { const st = createWorld({ seed, factionCount: 6 }); unlockAll(st); return st; };
const person = (st, b, role = "operate", mech = 5) => {
  const s = makeSurvivor(st, 1);
  s.location = { kind: "base", baseId: b.id }; s.role = role; s.traits = []; s.perks = []; s.health = 100;
  for (const k of Object.keys(s.skills)) s.skills[k] = 3;
  s.skills.mechanics = mech;
  st.survivors.push(s);
  return s;
};
// A hub with no one else at work: a workbench, one ammo bench, an operator on it.
function benchBase(st, mech = 5, reload = true) {
  const h = hub(st);
  for (const s of st.survivors) if (s.location && s.location.kind === "base" && s.location.baseId === h.id) { s.location = { kind: "away" }; s.role = "rest"; }
  h.buildings = h.buildings.filter((x) => !BUILDINGS[x.type].station);
  addBuilding(h, "workbench");
  const b = addBuilding(h, "ammo_bench");
  if (reload) b.type = "reload_bench";
  const op = person(st, h, "operate", mech);
  op.station = b.id;
  h.orders = {};
  return { h, b, op };
}
const fill = (h, o) => { const { food: days, ...rest } = o; Object.assign(h.stock, rest); if (days != null) setFood(h, days); }; // food: days of it (tools/foodkit.js)
const finishAll = (st, b) => { for (let i = 0; i < 50 && b.construction.length; i++) { for (const c of b.construction) c.progress = c.hours; constructionHour(st); } };

// 1. The data.
{
  console.log("Data");
  const d = BUILDINGS.reload_bench;
  check(d && d.from === "ammo_bench" && d.upgradeOnly && d.station === "ammo" && d.heat === RELOAD.HEAT && d.req.mechanics === 3, "the reloading bench: an ammo station, upgraded from an ammo bench only, Mechanics 3, quiet");
  check(d.cost.parts === 1 && d.cost.gunparts === 3 && d.cost.scrap === 20 && d.hours === 24 && RELOAD.UP.hours === 24 && RELOAD.UP.cost.gunparts === 3, "it costs a machine part, 3 gun parts, 20 scrap and 24 work-hours");
  const hk = Object.keys(HAND_SUPPLIES);
  check(hk.length === 39 && hk.every((k) => SUPPLIES[k] && GEAR[k] && GEAR[k].count && SUPPLIES[k].round.hand && isHandKey(k)), `every loadable round has a handload supply and box (${hk.length}: 25, 20 gauge buckshot, birdshot and slugs, then .223, .300 BLK and .38 Special (ar-platform), 5.7 and .44 Magnum (calibres-more))`);
  check(!hk.some((k) => /50bmg|22lr|tracer|rubber|beanbag|plusp/.test(k)), "no .50 BMG, no rimfire, no tracers, +P or less-lethal handloads");
  check(SUPPLIES.a_9mm_hp_hand.value < SUPPLIES.a_9mm_hp.value && SUPPLIES.a_9mm_hp_hand.weight === SUPPLIES.a_9mm_hp.weight, "a handload is worth less than a factory round and weighs the same");
  check(withHand("a_9mm_hp").join() === "a_9mm_hp,a_9mm_hp_hand" && withHand("a_50bmg_ball").length === 1 && factoryKey("a_308_ap_hand") === "a_308_ap", "a factory key and its handload key go together");
  check(["brass", "powder", "primers", "blackpowder", "matchprimers"].every((k) => SUPPLIES[k] && SUPPLIES[k].reload && !STOCK_KEYS.includes(k)), "brass, powder, black powder, primers and match primers are supplies (off the stock chips)");
  check(["brass", "powder", "primers"].every((k) => GEAR[k] && GEAR[k].count && GEAR[k].dur === 100 && ITEM_TAGS[k]), "a bag of brass, a can of powder, a box of primers: count stacks of 100 with theme tags");
  check(Math.abs(GEAR.powder.value - SUPPLIES.powder.value * 100) < 1e-9 && Math.abs(GEAR.brass.value - SUPPLIES.brass.value * 100) < 1e-9, "a can or a bag is worth its contents");
  const list = recipeList();
  // Every calibre with a load class has its recipes on the bench, pistols first, then shotguns, then rifles.
  const loadable = Object.keys(LOAD_CLASS).filter((c) => CALIBERS[c]);
  const cls = list.map((g) => ({ pistol: 0, shotgun: 1, rifle: 2 })[LOAD_CLASS[g.cal]]);
  check(list.length === loadable.length && loadable.every((c) => list.some((g) => g.cal === c)) && cls.every((x, i) => i === 0 || x >= cls[i - 1]) && list[0].cal === "9mm" && list.every((g) => g.types.length),
    `recipes for every loadable calibre, pistols, shotguns, rifles (${list.map((g) => g.cal).join(", ")})`);
  check(loadRecipe("9mm", "fmj")[0] === 2 && loadRecipe("9mm", "fmj")[1] === 40 && loadRecipe("308", "sp")[1] === 25 && loadRecipe("12ga", "slug")[1] === 15 && loadRecipe("12ga", "bird")[0] === 1
    && loadRecipe("9mm", "hp")[0] === 5 && loadRecipe("308", "subsonic")[0] === 6 && loadRecipe("556", "match")[0] === 9 && loadRecipe("556", "ap")[0] === 10 && loadRecipe("556", "ap")[1] === 10 && !loadRecipe("50bmg", "ball"), "the section 12 table: rates and Mechanics");
  const i9 = inputsPer10("9mm", "hp"), i3 = inputsPer10("308", "ap"), i12 = inputsPer10("12ga", "slug");
  check(i9.brass === 10 && i9.primers === 10 && i9.powder === 10 && i9.scrap === 0.5 && i3.powder === 25 && i3.parts === 0.5 && Math.abs(i12.powder - 16.7) < 0.05, "per 10 rounds: 10 brass, 10 primers, a can's 100 / 40 / 60 share of powder, half a scrap; AP half a machine part");
  check(dayRate(30, 5) === 36 && dayRate(40, 0) === 40 && dayRate(10, 10) === 14, "rounds a day +4% per Mechanics point");
  check(Math.abs(handHq(5) - 0.75) < 1e-9 && handHq(20) === 1, "hand quality 0.6 + 0.03 × Mechanics, at most 1");
}

// 2. The upgrade, in place.
{
  console.log("The upgrade");
  const st = W();
  const { h, b, op } = benchBase(st, 3, false);
  const plots = plotsUsed(h, "utility");
  check(!canBuild(st, h, "reload_bench").ok && /ammo bench/i.test(canBuild(st, h, "reload_bench").reason), `never built new (${canBuild(st, h, "reload_bench").reason})`);
  check(!canUpgradeAmmoBench(st, h, b.id).ok, `not without the materials (${canUpgradeAmmoBench(st, h, b.id).reason})`);
  fill(h, { parts: 5, gunparts: 5, scrap: 100 });
  op.skills.mechanics = 2;
  check(!canUpgradeAmmoBench(st, h, b.id).ok && /Mechanics 3/.test(canUpgradeAmmoBench(st, h, b.id).reason), "not without a Mechanics 3 survivor here");
  op.skills.mechanics = 3;
  const msg = queueReloadUpgrade(st, h, b.id);
  check(/queued/.test(msg) && h.stock.gunparts === 2 && h.stock.parts === 4 && h.stock.scrap === 80, `queued and paid (${msg})`);
  check(stationStatus(st, h, b).running || /Waiting/.test(stationStatus(st, h, b).reason), "the ammo bench keeps working meanwhile");
  finishAll(st, h);
  check(b.type === "reload_bench" && h.buildings.filter((x) => x.type === "reload_bench").length === 1 && !count(h, "ammo_bench"), "the ammo bench is now a reloading bench, the same building");
  check(plotsUsed(h, "utility") === plots && op.station === b.id, "on the same plot, with the same operator");
}

// 3. No order: exactly the ammo bench's output.
{
  console.log("Common rounds with no order (the old economy)");
  const out = [];
  for (const reload of [false, true]) {
    const st = W();
    const { h } = benchBase(st, 6, reload);
    fill(h, { scrap: 100 });
    const before = JSON.stringify(Object.fromEntries(Object.entries(h.stock).filter(([k]) => SUPPLIES[k] && SUPPLIES[k].round)));
    runStations(st, h);
    out.push({ scrap: h.stock.scrap, rounds: Object.fromEntries(Object.entries(h.stock).filter(([k]) => SUPPLIES[k] && SUPPLIES[k].round && h.stock[k] > 0)), before });
  }
  check(JSON.stringify(out[0]) === JSON.stringify(out[1]), `a reloading bench with no order makes what an ammo bench made (${JSON.stringify(out[1].rounds)}; ${out[1].scrap} scrap left)`);
  check(out[1].scrap === 100 - RECIPES.ammo.in.scrap, "3 scrap a day, as before");
  // With an order it cannot work (no inputs): the common rounds still.
  const st = W();
  const { h } = benchBase(st, 6, true);
  fill(h, { scrap: 100 });
  setReloadOrder(st, h, "a_9mm_hp", 100);
  runStations(st, h);
  check(h.stock.scrap === 97 && !num(h.stock.a_9mm_hp_hand), "an order with no brass, powder or primers: common rounds from scrap");
}

// 4. Heat.
{
  console.log("Heat");
  const st = W();
  const { h, b } = benchBase(st, 6, false);
  fill(h, { scrap: 100 });
  const a = mannedStations(st, h);
  b.type = "reload_bench";
  const r = mannedStations(st, h);
  check(a === 1 && Math.abs(r - RELOAD.HEAT) < 1e-9, `a running reloading bench counts a quarter of a station's Heat (${a} → ${r})`);
}

// 5. Rates and skill gates; 6. inputs drawn.
const rich = { brass: 5000, powder: 9000, primers: 5000, scrap: 500, parts: 50, gunparts: 20 };
{
  console.log("Rates and skill gates");
  const st = W();
  const { h, op } = benchBase(st, 4, true);
  fill(h, rich);
  setReloadOrder(st, h, "a_9mm_hp", 1000);
  check(!reloadJob(st, h, op) && /Mechanics 5/.test(reloadRows(st, h, op)[0].reason), `HP needs Mechanics 5 (${reloadRows(st, h, op)[0].reason})`);
  op.skills.mechanics = 5;
  const j = reloadJob(st, h, op);
  check(j && j.n === dayRate(30, 5) && j.n === 36, `Mechanics 5: ${j && j.n} HP a day (30 × 1.2)`);
  op.skills.mechanics = 10;
  check(reloadJob(st, h, op).n === 42, "Mechanics 10: 42 a day (30 × 1.4)");
  // The order is met: nothing more.
  h.stock.a_9mm_hp = 990;
  check(reloadJob(st, h, op).n === 10, "no more than the order is short");
  h.stock.a_9mm_hp = 1000;
  check(!reloadJob(st, h, op) && /stocked/.test(reloadRows(st, h, op)[0].reason), "nothing once it is met");
  h.stock.a_9mm_hp = 0;
  // AP: Mechanics 10 and a machine shop.
  h.reload.orders = [];
  setReloadOrder(st, h, "a_556_ap", 100);
  check(!reloadJob(st, h, op) && /machine shop/.test(reloadRows(st, h, op)[0].reason), "AP needs a machine shop");
  addBuilding(h, "machine_shop");
  check(reloadJob(st, h, op).n === 14, "with one: 14 AP a day at Mechanics 10");
  op.skills.mechanics = 9;
  check(!reloadJob(st, h, op), "and not below Mechanics 10");
  check(setReloadOrder(st, h, "a_50bmg_ball", 10) === "The bench cannot load that." && setReloadOrder(st, h, "a_22lr_fmj", 10) === "The bench cannot load that.", "no .50 BMG or .22 orders");
  // Shotgun shells: Mechanics 1.
  op.skills.mechanics = 1;
  h.reload.orders = [];
  setReloadOrder(st, h, "a_12ga_slug", 100);
  check(reloadJob(st, h, op).n === dayRate(15, 1), "slugs from Mechanics 1, 15 a day");
  // The furthest short first.
  op.skills.mechanics = 6;
  setReloadOrder(st, h, "a_9mm_hp", 100);
  h.stock.a_12ga_slug = 90;
  check(reloadJob(st, h, op).order.key === "a_9mm_hp", "the order furthest short (by share) first");
}
{
  console.log("Inputs drawn");
  const st = W();
  const { h, b, op } = benchBase(st, 5, true);
  fill(h, { ...rich });
  setReloadOrder(st, h, "a_308_sp", 1000);
  const s0 = { ...h.stock };
  runStations(st, h);
  const n = dayRate(25, 5); // 30
  check(num(h.stock.a_308_sp_hand) === n && !num(h.stock.a_308_sp), `30 .308 soft points made, as handloads (${num(h.stock.a_308_sp_hand)})`);
  check(s0.brass - h.stock.brass === n && s0.primers - h.stock.primers === n && s0.powder - h.stock.powder === Math.ceil(n * 2.5) && s0.scrap - h.stock.scrap === Math.ceil(n / 20), `one case, one primer, 2.5 charges each, a scrap per 20 (${s0.powder - h.stock.powder} powder, ${s0.scrap - h.stock.scrap} scrap)`);
  // The dies: a gun part per 500.
  const g0 = h.stock.gunparts;
  for (let d = 0; d < 20; d++) runStations(st, h);
  const made = h.reload.made;
  check(g0 - h.stock.gunparts === Math.floor((made) / RELOAD.WEAR), `a gun part per ${RELOAD.WEAR} rounds (${made} made, ${g0 - h.stock.gunparts} parts)`);
  h.stock.gunparts = 0; h.reload.wear = RELOAD.WEAR;
  check(!reloadJob(st, h, op) && /gun part/.test(reloadRows(st, h, op)[0].reason), "worn dies with no gun part: no typed rounds");
  // AP steel cores.
  const st2 = W();
  const B2 = benchBase(st2, 10, true);
  fill(B2.h, { ...rich });
  addBuilding(B2.h, "machine_shop");
  setReloadOrder(st2, B2.h, "a_556_ap", 100);
  const p0 = B2.h.stock.parts;
  const ms = B2.h.buildings.find((x) => x.type === "machine_shop");
  ms.broken = false;
  const before = B2.h.stock.parts;
  const ok = reloadJob(st2, B2.h, B2.op);
  const io = stationStatus(st2, B2.h, B2.b);
  check(ok && io.reload && io.in.parts === Math.ceil(14 / 20) && io.out.a_556_ap_hand === 14 && before === p0, `AP takes a machine part per 20 (${JSON.stringify(io.in)})`);
  // Inputs short: no more than they allow.
  const st3 = W();
  const B3 = benchBase(st3, 5, true);
  fill(B3.h, { brass: 12, powder: 500, primers: 500, scrap: 50 });
  setReloadOrder(st3, B3.h, "a_9mm_hp", 1000);
  runStations(st3, B3.h);
  check(num(B3.h.stock.a_9mm_hp_hand) === 12 && B3.h.stock.brass === 0, "no more rounds than the brass allows");
  // Shotgun loads are 1⅔ charges: the powder never goes below zero.
  const st4 = W();
  const B4 = benchBase(st4, 5, true);
  fill(B4.h, { brass: 100, powder: 10, primers: 100, scrap: 50 });
  setReloadOrder(st4, B4.h, "a_12ga_slug", 100);
  runStations(st4, B4.h);
  check(num(B4.h.stock.a_12ga_slug_hand) === 6 && B4.h.stock.powder >= 0 && B4.h.stock.powder < 1e-6, `10 charges load 6 shotgun shells, no powder owed (${B4.h.stock.powder})`);
  // Its station order Off: off altogether.
  B4.h.orders = { [B4.b.id]: { mode: "off", n: 0 } };
  fill(B4.h, { powder: 100 });
  const s4 = num(B4.h.stock.a_12ga_slug_hand);
  runStations(st4, B4.h);
  check(num(B4.h.stock.a_12ga_slug_hand) === s4, "a station order of Off stops the reloading too");
}

// 7. Handloads and their make; black powder and match primers; the station's per-day line.
{
  console.log("Handloads");
  const st = W();
  const { h, b } = benchBase(st, 6, true);
  fill(h, { ...rich });
  setReloadOrder(st, h, "a_9mm_fmj", 1000);
  runStations(st, h);
  check(num(h.stock.a_9mm_fmj) >= dayRate(40, 6) && !num(h.stock.a_9mm_fmj_hand), "FMJ with smokeless powder and factory primers: factory rounds (the economy sees them)");
  h.stock.powder = 0; h.stock.blackpowder = 1000;
  const f0 = num(h.stock.a_9mm_fmj);
  runStations(st, h);
  check(num(h.stock.a_9mm_fmj_hand) === dayRate(40, 6) && num(h.stock.a_9mm_fmj) === f0, "with black powder: handloads");
  const m = handMake(st, "a_9mm_fmj_hand");
  check(m.bp === 1 && m.mp === 0 && Math.abs(m.hq - handHq(6)) < 1e-9 && m.lo === 1, `their make: all black powder, hq ${m.hq}, loaded below Mechanics 8`);
  // A mixed day: the smokeless runs out half way; the factory primers too.
  const st2 = W();
  const B = benchBase(st2, 9, true);
  fill(B.h, { brass: 1000, powder: 10, blackpowder: 500, primers: 5, matchprimers: 500, scrap: 50, gunparts: 5 });
  setReloadOrder(st2, B.h, "a_9mm_hp", 1000);
  const s = stationStatus(st2, B.h, B.b);
  check(s.reload && s.in.powder === 10 && s.in.blackpowder === s.reload.n - 10 && s.in.primers === 5 && s.in.matchprimers === s.reload.n - 5, `smokeless and factory primers first, then black powder and match primers (${JSON.stringify(s.in)})`);
  runStations(st2, B.h);
  const m2 = handMake(st2, "a_9mm_hp_hand");
  const n = dayRate(30, 9);
  check(Math.abs(m2.bp - (n - 10) / n) < 0.002 && Math.abs(m2.mp - (n - 5) / n) < 0.002 && m2.lo === 0 && Math.abs(m2.hq - handHq(9)) < 1e-9, `the make: ${JSON.stringify(m2)}`);
  // The make averages by the rounds there.
  B.h.stock.blackpowder = 0; B.h.stock.matchprimers = 0; B.h.stock.powder = 5000; B.h.stock.primers = 5000;
  runStations(st2, B.h);
  const m3 = handMake(st2, "a_9mm_hp_hand");
  check(m3.bp > 0 && m3.bp < m2.bp && Math.abs(m3.bp - m2.bp * n / (2 * n)) < 0.003, `a clean day halves the black powder share (${m2.bp} → ${m3.bp})`);
  check(reloadWanted(st2, B.h), "the governor would staff a bench with an order to work");
}

// 8. The battle: the draw order, the jam factor, the aim and noise; 9. brass.
function fighter(st, weapon = "pistol") {
  const s = makeSurvivor(st);
  s.skills.shooting = 9; s.traits = []; s.health = 100;
  s.gear.weapon = weapon ? newItem(weapon) : null;
  for (const slot of ["head", "armor", "arms", "legs", "tool"]) s.gear[slot] = null;
  s.pockets = (s.pockets || []).map(() => null);
  if (s.gear.backpack) s.gear.backpack = null;
  s.location = { kind: "base", baseId: hub(st).id };
  st.survivors.push(s);
  return s;
}
function openBattle(st, crew, stock) {
  const h = hub(st);
  for (const k of Object.keys(h.stock)) if (SUPPLIES[k] && SUPPLIES[k].round) delete h.stock[k];
  h.stock.ammo = 0;
  Object.assign(h.stock, stock);
  const b = (st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "raiders", count: 2, power: 3 }, ambush: null, canRetreat: true, handler: "reloadtest", context: {} }));
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0); b.reach.fill(1);
  b.dark = false; b.night = false; b.jamWx = 1;
  b.phase = "player";
  return b;
}
{
  console.log("In a fight");
  const st = W();
  st.handloads = { a_9mm_fmj_hand: { hq: 0.75, bp: 0, mp: 0, lo: 1 } };
  const s = fighter(st, "pistol");
  const b = openBattle(st, [s], { a_9mm_fmj: 3, a_9mm_fmj_hand: 50 });
  const u = b.units.find((x) => x.sid === s.id);
  u.load = "fmj";
  check(roundsOf(b, u) === 53 && nextHand(b, u) === null, "a gun counts its type's handloads too; the factory rounds go first");
  noteJamWeather(st, b);
  check(b.handQ && b.handQ.a_9mm_fmj_hand && b.handQ.a_9mm_fmj_hand.hq === 0.75 && u.loadCond !== "hand", "the battle notes the colony's makes; a factory round next: no marks");
  const fac = jamChance(b, u);
  takeBattleRounds(b, u, 3);
  check(nextHand(b, u) === "a_9mm_fmj_hand", "then the handloads");
  noteHandLoad(b, u);
  const hand = jamChance(b, u);
  check(u.loadCond === "hand" && u.loadHq === 0.75 && Math.abs(hand / fac - (2.5 - 1.5 * 0.75)) < 1e-9, `a handload jams × (2.5 − 1.5 × hq): ${(hand / fac).toFixed(3)}`);
  check(Math.abs(ammoJam({ loadCond: "hand", loadHq: 0.6, loadBp: 1 }) - 1.6 * RELOAD_FX.BLACK_JAM) < 1e-9 && Math.abs(ammoJam({ loadCond: "hand", loadHq: 0.6, loadMp: 1 }) - 1.6 * RELOAD_FX.MATCH_JAM) < 1e-9, "black powder × 1.5, match-head primers × 3");
  check(Math.abs(ammoJam({ loadCond: "hand", loadHq: 0 }) - 2.5) < 1e-9 && ammoJam({ loadCond: "old" }) === JAM.AMMO.old, "the old jam rules stand (hq 0: 2.5; old rounds 3)");
  // Aim: −1 for a load made below Mechanics 8; noise: black powder +1.
  const e = b.units.find((x) => x.side === "enemy");
  e.x = u.x + 4; e.y = u.y; e.dead = false; e.down = false; e.aware = true;
  const a1 = shotOdds(b, u, e).chance;
  const lo = u.loadAim; u.loadAim = 0;
  const a0 = shotOdds(b, u, e).chance;
  u.loadAim = lo;
  check(lo === RELOAD_FX.AIM && a0 - a1 === 1, `aim 1 worse with handloads loaded below Mechanics 8 (${a0} → ${a1})`);
  const n0 = shotNoise(b, u, { noise: 3 });
  u.loadBp = 1;
  check(Math.abs(shotNoise(b, u, { noise: 3 }) - n0 - RELOAD_FX.BLACK_NOISE) < 1e-9, "black powder: a shot 1 louder");
  u.loadBp = 0;
  // Back to factory rounds: the marks go.
  b.pools[0].a_9mm_fmj = 10;
  noteHandLoad(b, u);
  check(u.loadCond === "factory" && u.loadHq == null && !u.loadAim, "a factory round again: the marks are cleared");
  // A test's "old" rounds are left alone.
  const v = { side: "player", weapon: "pistol", load: "fmj", loadCond: "old", boxes: [] };
  noteHandLoad(b, v);
  check(v.loadCond === "old", "other rounds' marks are not touched");
}
{
  console.log("Brass after a fight");
  const run = (outcome, weapon, shots) => {
    const st = W();
    const s = fighter(st, weapon);
    const cal = weapon === "revolver" ? "a_357_fmj" : weapon === "shotgun" ? "a_12ga_buck" : "a_9mm_fmj";
    const b = openBattle(st, [s], { [cal]: 500 });
    const u = b.units.find((x) => x.sid === s.id);
    const e = b.units.find((x) => x.side === "enemy");
    for (const x of b.units) if (x.side === "enemy" && x !== e) { x.dead = true; x.x = -10; x.y = -10; }
    e.x = u.x + 3; e.y = u.y; e.aware = true;
    let fired = 0;
    for (let i = 0; i < shots; i++) { e.hp = e.maxHp = 100000; e.dead = false; e.down = false; u.ap = 2; u.jam = null; u.cd = 0; const before = b.ammoUsed; fire(b, u, e); fired += b.ammoUsed - before; if (u.mag != null && u.mag < 2) u.mag = u.magMax; }
    if (outcome === "victory") for (const x of b.units) if (x.side === "enemy") { x.dead = true; }
    const h = hub(st);
    const b0 = num(h.stock.brass);
    endBattleNow(st, outcome);
    return { fired, brass: num(h.stock.brass) - b0, lines: (b.summary || []).join(" ") };
  };
  const w = run("victory", "pistol", 20);
  check(w.fired >= 15 && w.brass === Math.floor(w.fired * RELOAD.BRASS + 1e-9) && /fired case/.test(w.lines), `won: ${w.brass} of ${w.fired} cases back (60%)`);
  const r = run("victory", "revolver", 12);
  check(r.fired >= 8 && r.brass === r.fired, `a revolver's: all ${r.fired} of them`);
  const sh = run("victory", "shotgun", 6);
  check(sh.fired >= 4 && sh.brass === Math.floor(sh.fired * RELOAD.BRASS + 1e-9), `shotgun hulls too (${sh.brass} of ${sh.fired})`);
  const l = run("retreat", "pistol", 20);
  check(l.fired >= 15 && l.brass === 0, "a retreat: none");
  const d = run("defeat", "pistol", 20);
  check(d.fired >= 15 && d.brass === 0, "a loss: none");
}

// 10. The black powder and match primer crafts.
{
  console.log("Black powder");
  const st = W();
  const { h } = benchBase(st, 3, true);
  const c = person(st, h, "craft", 4);
  fill(h, { wood: 200, scrap: 20, food: 20 });
  check(CRAFTS.blackpowder.in.wood === 90 && CRAFTS.blackpowder.in.scrap === 1 && CRAFTS.blackpowder.in.food === 2 && CRAFTS.blackpowder.min === 4 && CRAFTS.blackpowder.supplies.blackpowder === 100, "firewood 90, scrap 1, food 2, Mechanics 4: a can of black powder");
  check(canCraft(st, h, "blackpowder").ok, `can be made at a reloading bench (${canCraft(st, h, "blackpowder").reason || "ok"})`);
  c.skills.mechanics = 3;
  check(!canCraft(st, h, "blackpowder").ok, "not below Mechanics 4");
  c.skills.mechanics = 4;
  queueCraft(st, h, "blackpowder");
  check(h.stock.wood === 110 && h.stock.scrap === 19 && Math.abs(food(h) - 18) < 1e-6, "the materials are paid");
  for (let i = 0; i < 60 && craftQueue(h).length; i++) craftingHour(st);
  check(h.stock.blackpowder === 100, `a can of black powder in the stock (${h.stock.blackpowder})`);
  const st2 = W();
  const B = benchBase(st2, 3, false);
  person(st2, B.h, "craft", 9);
  fill(B.h, { wood: 200, scrap: 20, food: 20 });
  check(!canCraft(st2, B.h, "blackpowder").ok && /reloading bench/i.test(canCraft(st2, B.h, "blackpowder").reason), "not without a reloading bench");
  check(CRAFTS.matchprimers.min === 8 && CRAFTS.matchprimers.needs === "reload_bench", "match-head primers: Mechanics 8 at the bench");
}

// 11. The governor.
{
  console.log("The governor");
  const st = W();
  const { h, op } = benchBase(st, 10, true);
  const gunner = person(st, h, "guard", 3);
  gunner.gear.weapon = newItem("pistol");
  const g2 = person(st, h, "guard", 3); g2.gear.weapon = newItem("pistol");
  const g3 = person(st, h, "guard", 3); g3.gear.weapon = newItem("shotgun");
  const g4 = person(st, h, "guard", 3); g4.gear.weapon = newItem("ar");
  autoReloadOrders(st, h);
  const keys = () => reloadOrders(h).map((o) => `${o.key}:${o.n}`).sort().join(",");
  check(keys() === "a_12ga_slug:25,a_9mm_hp:100", `100 HP of the main pistol calibre, 25 slugs with a shotgun (${keys()})`);
  st.metArmour = 1;
  autoReloadOrders(st, h);
  check(keys() === "a_12ga_slug:25,a_556_ap:60,a_9mm_hp:100", `60 AP of the main rifle calibre once armoured enemies were met (${keys()})`);
  // The player's own order stands; the governor's go when they no longer apply.
  setReloadOrder(st, h, "a_9mm_hp", 300);
  g3.gear.weapon = null;
  autoReloadOrders(st, h);
  check(keys() === "a_556_ap:60,a_9mm_hp:300", `the player's order stands, the slugs go with the shotgun (${keys()})`);
  // It keeps the reserves: days of work with the inputs.
  g3.gear.weapon = newItem("shotgun");
  h.reload.orders = [];
  autoReloadOrders(st, h);
  addBuilding(h, "machine_shop");
  fill(h, { brass: 2000, powder: 5000, primers: 2000, scrap: 300, parts: 40, gunparts: 10 });
  for (let d = 0; d < 12; d++) runStations(st, h);
  check(roundsIn(h.stock, "9mm", "hp") >= 100 && roundsIn(h.stock, "12ga", "slug") >= 25 && roundsIn(h.stock, "556", "ap") >= 60, `it keeps them: ${roundsIn(h.stock, "9mm", "hp")} HP, ${roundsIn(h.stock, "12ga", "slug")} slugs, ${roundsIn(h.stock, "556", "ap")} AP`);
  const c0 = roundsIn(h.stock, "9mm") + roundsIn(h.stock, "12ga") + roundsIn(h.stock, "556");
  runStations(st, h);
  check(roundsIn(h.stock, "9mm", "hp") <= 100 + dayRate(30, 10) && roundsIn(h.stock, "9mm") + roundsIn(h.stock, "12ga") + roundsIn(h.stock, "556") > c0, "and once they are kept it makes common rounds");
  // Trade wants: powder and primers below the bench's stock, never sold.
  h.stock.powder = 20; h.stock.primers = 250;
  const nd = reloadNeeds(st, h);
  check(nd.powder === 1.9 && nd.primers === 1.4 && nd.brass === 0.9, `wants powder (1.9) and primers (1.4) when low (${JSON.stringify(nd)})`);
  h.stock.powder = 500; h.stock.primers = 500;
  check(reloadNeeds(st, h).powder === 0.9, "none when stocked (kept, not sold)");
  // The governor upgrades an ammo bench once there are inputs.
  const st2 = W();
  const B = benchBase(st2, 4, false);
  fill(B.h, { parts: 5, gunparts: 8, scrap: 100 });
  check(!autoReloadBench(st2, B.h), "no upgrade without inputs to load with");
  fill(B.h, { brass: 200, powder: 200, primers: 200 });
  check(/queued/.test(autoReloadBench(st2, B.h)), "with brass, powder and primers it upgrades an ammo bench");
  finishAll(st2, B.h);
  check(B.b.type === "reload_bench", "done");
  // governBase sets the orders (the hourly per-base work).
  const st3 = W();
  const B3 = benchBase(st3, 6, true);
  const p3 = person(st3, B3.h, "guard", 3); p3.gear.weapon = newItem("pistol");
  governBase(st3, B3.h);
  check(reloadOrders(B3.h).some((o) => o.key === "a_9mm_hp" && o.by === "ai"), "the governor's base work sets them");
}

// 12. The other groups.
{
  console.log("The other groups");
  const st = W();
  const f = st.factions.find((x) => x.alive && !x.outsider && x.type !== "traders" && x.type !== "military");
  f.stock.brass = 0; f.stock.powder = 0; f.stock.primers = 0;
  groupBrass(f, 100);
  check(f.stock.brass === 30, "their fights leave them brass (30% of the rounds spent)");
  Object.assign(f.stock, { brass: 500, powder: 1000, primers: 500, scrap: 50, ammo: 10 });
  const a0 = f.stock.ammo;
  check(groupReloadDaily(st, f, false) === 0 && f.stock.ammo === a0, "no workshop: no reloading");
  const n = groupReloadDaily(st, f, true);
  check(n === Math.floor(Math.min(RELOAD.GROUP.max, f.pop * RELOAD.GROUP.perHead)) && f.stock.ammo === a0 + n && f.stock.brass === 500 - n && f.stock.primers === 500 - n, `with a workshop: ${n} rounds into their ammo count, brass and primers used`);
  Object.assign(f.stock, { brass: 500, powder: 0, primers: 0 });
  check(groupReloadDaily(st, f, true) === 0 || f.reloadDeal != null, "no powder or primers: none (unless bought)");
  // Buying from a trading or military group.
  const sellers = st.factions.filter((o) => o.alive && !o.outsider && ["traders", "military"].includes(o.type));
  if (sellers.length) {
    const o = sellers[0];
    o.stock.powder = 500; o.stock.primers = 500;
    Object.assign(f.stock, { powder: 0, primers: 0, scrap: 300 });
    delete f.reloadDeal;
    const deal = groupBuyReload(st, f);
    check(deal && f.stock.powder > 0 && f.stock.primers > 0 && o.stock.powder < 500 && deal.paid.scrap > 0, `they buy powder and primers (${deal ? JSON.stringify(deal.got) + " for " + JSON.stringify(deal.paid) : "none"})`);
  } else check(true, "no seller group in this world");
  // Sellers keep stock.
  const tr = st.factions.find((o) => o.alive && !o.outsider && o.type === "traders") || st.factions.find((o) => o.alive && !o.outsider && o.type === "military");
  if (tr) { tr.stock.powder = 0; tr.stock.primers = 0; groupReloadDaily(st, tr, false); check(tr.stock.powder > 0 && tr.stock.primers > 0, `a ${tr.type} group restocks powder and primers to sell`); }
  // Merchants: an arms dealer brings powder and primers.
  const v = { serial: 7, stock: {}, spec: "arms" };
  merchantReload(st, v);
  check(v.stock.powder >= 100 && v.stock.primers >= 100, `an arms dealer's powder (${v.stock.powder}) and primers (${v.stock.primers})`);
}

// 13. Loot.
{
  console.log("Loot");
  const st = W();
  const tile = st.tiles.findIndex((t) => t && t.loc && t.loc.type === "gunstore");
  if (tile >= 0) {
    let n = 0, primers = 0, rolled = true, part = 0;
    for (let i = 0; i < 2000; i++) { st.hour = 1000 + i; const it = rollSiteReload(st, tile, 1, `t${i}`); if (it) { n++; if (it.key === "primers") primers++; if (!condRolled(it)) rolled = false; if (it.dur < GEAR[it.key].dur) part++; } }
    const pPrimers = primers / 2000;
    check(n > 0 && rolled, `a gun store yields bags, cans and boxes (${n} in 2000 search hours), through lootItem`);
    check(pPrimers > 0.04 && pPrimers < 0.13, `primers about 0.08 a search hour at a gun store (${pPrimers.toFixed(3)})`);
    check(part > 0, "found part-used");
  } else check(true, "no gun store on this map");
  check(Object.keys(SITE_RELOAD).every((t) => Object.keys(SITE_RELOAD[t].items).every((k) => RELOAD_GEAR[k])), "the tables name only the bench's inputs");
  // Opened into the stock at a base.
  const h = hub(st);
  h.armory.push(newItem("powder"));
  const p0 = num(h.stock.powder);
  unbox(h.armory, h.stock);
  check(h.stock.powder === p0 + 100 && !h.armory.some((it) => it && it.key === "powder"), "a can in the armory is opened into the stock");
}

// 14. Packing and spending take handloads like any round of their type.
{
  console.log("Handloads in the economy");
  const rec = { a_9mm_hp: 5, a_9mm_hp_hand: 20 };
  check(roundsIn(rec, "9mm", "hp") === 25 && roundsIn(rec, "9mm") === 25, "counted with their type and calibre");
  check(takeRounds(rec, "9mm", "hp", 10) === 10 && rec.a_9mm_hp === 0 && rec.a_9mm_hp_hand === 15, "a draw by type: factory first, then handloads");
  const st = W();
  const s = fighter(st, "pistol");
  s.gear.weapon.load = "hp";
  const from = { a_9mm_hp_hand: 40 };
  const packed = packRounds(from, [s], 30);
  check(packed.a_9mm_hp_hand === 30, `a team packs them for its guns (${JSON.stringify(packed)})`);
}

// 14b. Pulling rounds (user, 2026-10-08): rounds of calibres nobody uses taken apart for the bench.
{
  console.log("Pulling rounds");
  const st = W();
  const { h, b, op } = benchBase(st, 5, true);
  fill(h, { a_762x39_fmj: 120, scrap: 10 });
  setPullOrder(st, h, "a_762x39_fmj", 20);
  const y = pullYield("a_762x39_fmj");
  check(y.brass === 1 && y.powder === 2.5 && y.primers === RELOAD.PULL.PRIMER && pullYield("a_22lr_fmj").brass === 0 && pullYield("a_22lr_fmj").primers === 0 && pullYield("a_50bmg_ball").powder === 10 && pullYield("a_9mm_hp_hand").powder === 1,
    "a pulled round: its case, its charges (rifle 2.5, pistol 1, .50 10), 80% of a primer; a .22's only powder");
  const n = dayRate(RELOAD.PULL.RATE, 5);
  const s0 = { ...h.stock };
  runStations(st, h);
  check(s0.a_762x39_fmj - h.stock.a_762x39_fmj === n && num(h.stock.brass) === n && num(h.stock.powder) === Math.floor(n * 2.5) && num(h.stock.primers) === Math.floor(n * 0.8) && h.stock.scrap - s0.scrap === Math.floor(n / 20),
    `a day: ${n} rounds into ${num(h.stock.brass)} brass, ${num(h.stock.powder)} powder, ${num(h.stock.primers)} primers, ${h.stock.scrap - s0.scrap} scrap`);
  runStations(st, h);
  check(h.stock.a_762x39_fmj === 20 && !pullJob(st, h, op) && /down to 20/.test(pullRows(st, h, op)[0].reason), "down to the rounds kept, then no more");
  check(Math.abs(h.reload.lead - ((100 / 20) % 1)) < 1e-9 && h.stock.scrap - s0.scrap === 5, "the lead: a scrap per 20 bullets, the rest carried over");
  // Loading comes first; a load blocked for want of inputs gets them from pulling.
  const st2 = W();
  const B = benchBase(st2, 6, true);
  fill(B.h, { a_308_fmj: 300, scrap: 40 });
  setReloadOrder(st2, B.h, "a_9mm_hp", 50);
  setPullOrder(st2, B.h, "a_308_fmj", 0);
  check(!reloadJob(st2, B.h, B.op) && pullJob(st2, B.h, B.op), "nothing to load (no brass, powder, primers): it pulls");
  runStations(st2, B.h);
  check(num(B.h.stock.brass) > 0 && !num(B.h.stock.a_9mm_hp_hand), "day 1: pulled");
  runStations(st2, B.h);
  check(num(B.h.stock.a_9mm_hp_hand) > 0 && /Loading/.test(stationStatus(st2, B.h, B.b).reason) || num(B.h.stock.a_9mm_hp_hand) >= 50, `day 2: the pulled parts loaded into hollow points (${num(B.h.stock.a_9mm_hp_hand)})`);
  // The governor: pulls calibres no gun here shoots, keeping a trade reserve; not the ones it shoots.
  const st3 = W();
  const C = benchBase(st3, 6, true);
  const g = person(st3, C.h, "guard", 3); g.gear.weapon = newItem("pistol");
  for (const k of Object.keys(C.h.stock)) if (SUPPLIES[k] && SUPPLIES[k].round) delete C.h.stock[k]; // the hub's starting rounds
  C.h.armory = [];
  fill(C.h, { a_762x39_fmj: 100, a_9mm_fmj: 100, a_50bmg_ball: 5, a_40mm_he: 40, a_rocket_heat: 30 });
  autoReloadOrders(st3, C.h);
  check(/not pulled/.test(setPullOrder(st3, C.h, "a_40mm_he", 0)) && !pullOrders(C.h).some((o) => /40mm|rocket/.test(o.key)), "40 mm grenades and rockets are never pulled apart (w2-launchers' rounds)");
  const pk = () => pullOrders(C.h).map((o) => `${o.key}:${o.keep}:${o.by}`).sort().join(",");
  check(pk() === `a_762x39_fmj:${RELOAD.PULL.KEEP}:ai`, `the governor pulls 7.62×39 down to ${RELOAD.PULL.KEEP}, not 9mm (it shoots it) nor 5 .50s (${pk()})`);
  const g2 = person(st3, C.h, "guard", 3); g2.gear.weapon = newItem("ak");
  autoReloadOrders(st3, C.h);
  check(!pullOrders(C.h).length, "an AK here: the 7.62×39 is kept");
  setPullOrder(st3, C.h, "a_9mm_fmj", 50);
  autoReloadOrders(st3, C.h);
  check(pullOrders(C.h).some((o) => o.key === "a_9mm_fmj" && o.by === "player"), "the player's pull order stands");
  // The pulled parts feed the governor's own loading.
  const st4 = W();
  const D = benchBase(st4, 7, true);
  const g4 = person(st4, D.h, "guard", 3); g4.gear.weapon = newItem("pistol");
  fill(D.h, { a_308_fmj: 400, scrap: 60, gunparts: 4 });
  for (let d = 0; d < 8; d++) { autoReloadOrders(st4, D.h); runStations(st4, D.h); }
  check(roundsIn(D.h.stock, "9mm", "hp") >= 100 && D.h.stock.a_308_fmj >= RELOAD.PULL.KEEP, `junk .308 pulled into 100 9mm hollow points (${roundsIn(D.h.stock, "9mm", "hp")} HP, ${D.h.stock.a_308_fmj} .308 left)`);
  // The other groups: a group short of brass pulls the rounds its guns do not shoot.
  const f = st.factions.find((x) => x.alive && !x.outsider && x.type === "military") || st.factions.find((x) => x.alive && !x.outsider);
  f.type = "military";
  f.arsenal = { items: [newItem("pistol"), newItem("shotgun")] };
  Object.assign(f.stock, { brass: 0, powder: 0, primers: 0, ammo: 2000 });
  const pn = groupPull(st, f);
  check(pn > 0 && f.stock.ammo === 2000 - pn && f.stock.brass === pn && f.stock.powder > pn && f.stock.primers === Math.floor(pn * RELOAD.PULL.PRIMER), `a military group with only pistols and shotguns pulls ${pn} of its 5.56 and .308 into ${f.stock.brass} brass, ${f.stock.powder} powder, ${f.stock.primers} primers`);
  f.arsenal = { items: [newItem("pistol"), newItem("shotgun"), newItem("ar"), newItem("huntrifle"), newItem("ak"), newItem("pistol45")] };
  Object.assign(f.stock, { brass: 0 });
  const few = groupPull(st, f);
  check(few < pn, `one whose guns shoot most of its calibres pulls less (${few})`);
  f.stock.brass = 500;
  check(groupPull(st, f) === 0, "and none while it has brass");
}

// 15. A save round trip.
{
  console.log("Save");
  const st = W();
  const { h } = benchBase(st, 7, true);
  fill(h, { ...rich });
  setReloadOrder(st, h, "a_9mm_hp", 500);
  setPullOrder(st, h, "a_762x39_fmj", 10);
  runStations(st, h);
  h.stock.brass = 321;
  const back = loadFromString(saveToString(st));
  const h2 = hub(back);
  check(h2.buildings.some((x) => x.type === "reload_bench") && h2.reload.orders[0].key === "a_9mm_hp" && h2.reload.orders[0].n === 500 && h2.reload.made === h.reload.made && h2.reload.pulls[0].key === "a_762x39_fmj", "the bench, its orders, pull orders and its wear come back");
  check(h2.stock.brass === 321 && h2.stock.a_9mm_hp_hand === h.stock.a_9mm_hp_hand && JSON.stringify(back.handloads) === JSON.stringify(st.handloads), "brass, handloads and their make come back");
  runStations(st, h); runStations(back, h2);
  check(h2.stock.a_9mm_hp_hand === h.stock.a_9mm_hp_hand && h2.stock.powder === h.stock.powder, "and the next day goes the same");
  // An old save (no reload fields) loads and works.
  const old = JSON.parse(saveToString(W()));
  const o = loadFromString(JSON.stringify(old));
  check(!o.handloads && hub(o).buildings.every((x) => x.type !== "reload_bench"), "an old save has none of it and loads");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
