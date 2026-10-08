// Repairing gear (src/sim/repair.js; docs/weapons-overhaul-plan.md sections 21 and 25): the kinds and what they take,
// the skill gates, the bench tiers (a crafting bench only mends soft and makeshift things, a master workbench loses
// less), the lost maximum (restored × max(0.08, 0.25 − 0.01 × skill), × 2 with a field kit), a field kit's half
// repair, ceramic plates and worn-out gear refused, the base queue worked by the crafters, the autopilot's repairs,
// a save round trip of the lowered maximum, and the item's worth falling with it.
// Usage: node tools/repairtest.js [seed]
import { createWorld, hub, atBase, tickHour } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { newItem, stow } from "../src/sim/inventory.js";
import { itemDur, itemDurMax } from "../src/sim/crafting.js";
import { addBuilding, benchTier } from "../src/sim/buildings.js";
import {
  REPAIR, REPAIR_KINDS, repairKind, repairInfo, repairItem, repairMath, lossRate, queueRepair, cancelRepair, repairHour,
  fieldRepair, fieldRepairInfo, planRepairs, wornOut, repairPreview,
} from "../src/sim/repair.js";
import { itemValue } from "../src/sim/valuation.js";
import { serializeState, deserializeState } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const t0 = Date.now();
const near = (a, b, e = 0.051) => Math.abs(a - b) < e;
const worn = (key, dur) => { const it = newItem(key); it.dur = dur; return it; };
// A base with a bench of this tier (0: none) and one crafter with these skills.
function setup(tier = 2, skills = { mechanics: 6, crafting: 6 }) {
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true;
  const h = hub(st);
  h.buildings = h.buildings.filter((b) => !GEAR[b.type] && !(b.type in { craftbench: 1, workbench: 1, toolbench: 1 }));
  if (tier >= 1) addBuilding(h, ["craftbench", "workbench", "toolbench"][tier - 1]);
  const people = atBase(st, h.id);
  for (const s of people) { s.role = "rest"; for (const k of Object.keys(s.skills)) s.skills[k] = 0; s.inBed = false; }
  const c = people[0];
  c.role = "craft";
  Object.assign(c.skills, skills);
  Object.assign(h.stock, { scrap: 50, parts: 10, gunparts: 10, fuel: 10, wood: 500, electronics: 5 });
  return { st, h, c, people };
}

// 1. Kinds and inputs.
{
  console.log("Kinds and inputs");
  check(repairKind(newItem("ar")).kind === "gun" && repairKind(newItem("pipegun")).kind === "zipgun" && repairKind(newItem("bat")).kind === "melee", "guns, a zip gun, a bat: their kinds");
  check(repairKind(newItem("vest")).kind === "soft" && repairKind(newItem("padding")).kind === "padding" && repairKind(newItem("milhelmet")).kind === "hard" && repairKind(newItem("scrapvest")).kind === "steel", "a Kevlar vest is soft armour, magazine arm guards padding, a combat helmet hard, a scrap plate vest steel");
  check(!!repairKind(newItem("plate")).refuse, `ceramic plates cannot be repaired ("${repairKind(newItem("plate")).refuse}")`);
  check(!repairKind(newItem("bandagekit")) && !repairKind(newItem("waterfilter")) && !repairKind(newItem("suppressor")) && !repairKind(newItem("repairkit")) && !repairKind(newItem("reddot")), "med kits, water filters, makeshift gun parts, the kits themselves and parts that do not wear: no repair");
  check(REPAIR_KINDS.gun.skill === "mechanics" && REPAIR_KINDS.soft.skill === "crafting" && REPAIR_KINDS.padding.skill === "crafting" && REPAIR_KINDS.hard.skill === "mechanics", "Mechanics for guns and hard armour, Crafting for soft goods");
  const { st, h } = setup();
  const ar = worn("ar", 24); // 60 max: 36 to restore = 60% of full: 3 gun parts
  const ia = repairInfo(st, h, ar);
  check(ia.ok && ia.inputs.supplies.gunparts === 3 && ia.inputs.supplies.scrap === 1 && ia.hours === 2, `a gun restored 36 of 60: 3 gun parts and a scrap, 2 h (${repairPreview(ia)})`);
  const iv = repairInfo(st, h, worn("vest", 10));
  check(!iv.ok && /Kevlar repair kit/i.test(iv.reason), `soft armour needs a Kevlar repair kit in the armory ("${iv.reason}")`);
  h.armory.push(newItem("kevlarkit"));
  const iv2 = repairInfo(st, h, worn("vest", 10));
  check(iv2.ok && iv2.inputs.gear.kevlarkit === 1 && iv2.inputs.supplies.scrap === 2, "with one: the kit and 2 scrap");
  check(repairInfo(st, h, worn("milhelmet", 20)).inputs.supplies.parts === 1 && repairInfo(st, h, worn("scrapvest", 4)).inputs.supplies.fuel === 1, "a helmet: a machine part and 2 scrap; a steel plate: 4 scrap and a fuel (welding)");
  check(repairInfo(st, h, worn("bat", 5)).inputs.supplies.wood === REPAIR.WOOD, "a wooden bat takes firewood for a new handle");
}

// 2. Skill gates and bench tiers.
{
  console.log("Skill gates and benches");
  const lo = setup(2, { mechanics: 2, crafting: 2 });
  check(/Mechanics 3\+/.test(repairInfo(lo.st, lo.h, worn("ar", 10)).reason), "a gun needs Mechanics 3");
  lo.c.skills.mechanics = 3;
  check(repairInfo(lo.st, lo.h, worn("ar", 10)).ok, "Mechanics 3 will do");
  const none = setup(0);
  check(/crafting bench/.test(repairInfo(none.st, none.h, worn("ar", 10)).reason), "no bench, no repairs (but a field kit)");
  const t1 = setup(1);
  check(/workbench/.test(repairInfo(t1.st, t1.h, worn("ar", 10)).reason) && repairInfo(t1.st, t1.h, worn("padding", 2)).ok, "a crafting bench mends padding, not guns");
  const nobody = setup(2);
  nobody.c.role = "rest";
  check(/Craft role/.test(repairInfo(nobody.st, nobody.h, worn("ar", 10)).reason), "nobody on the Craft role: says so");
}

// 3. The lost maximum.
{
  console.log("The lost maximum");
  check(near(lossRate(3), 0.22) && near(lossRate(12), 0.13) && near(lossRate(20), 0.08) && near(lossRate(30), 0.08), "loss per point restored: Mechanics 3 22%, 12 13%, 17+ 8% (the floor)");
  check(near(lossRate(5, { kit: true }), 0.4) && near(lossRate(5, { tier: 3 }), 0.2 * 0.7), "twice with a field kit, 30% less at a master workbench");
  const { st, h, c } = setup(2, { mechanics: 5, crafting: 5 });
  const ar = worn("ar", 20);
  const r = repairItem(st, h, ar, c);
  check(r.restored === 40 && near(itemDurMax(ar), 60 - 40 * 0.2) && itemDur(ar) === itemDurMax(ar), `restored 40 of 60 at Mechanics 5: max 60 → ${itemDurMax(ar)}, condition back to it`);
  check(ar.durBase === 60 && ar.repairs === 1 && ar.quality === 1, "the first maximum is kept (durBase); quality (the gun's make) is untouched");
  ar.dur = 10;
  repairItem(st, h, ar, c);
  check(itemDurMax(ar) < 52 && ar.durBase === 60, `a second repair loses more (${itemDurMax(ar)})`);
  // The worn-out floor.
  const old = worn("ar", 2);
  old.durMax = 11; old.durBase = 60; // under 20% of 60
  check(wornOut(old) && /worn out/.test(repairInfo(st, h, old).reason), "a maximum under 20% of new: worn out, no repair");
  check(/needs no repair/.test(repairInfo(st, h, newItem("ar")).reason), "a gun in full condition needs none");
}

// 4. A field repair kit.
{
  console.log("Field repair kit");
  const { st, h, c } = setup(0, { mechanics: 5, crafting: 5 });
  const ar = worn("ar", 20);
  c.gear.weapon = null;
  h.armory.push(ar);
  const loc = `armory:${h.id}:list:${h.armory.indexOf(ar)}`;
  check(/field repair kit/.test(fieldRepairInfo(st, loc).reason), "without a kit: refused");
  const kit = newItem("repairkit");
  c.pockets = c.pockets.map(() => null); c.gear.backpack = c.gear.backpack || newItem("backpack");
  check(!!stow(c, kit), "a kit in someone's pack");
  const info = fieldRepairInfo(st, loc);
  check(info.ok && info.restore === 20 && near(info.newMax, 60 - 20 * 0.2 * 2), `half the restore (20 of 40), twice the loss: max 60 → ${info.newMax}`);
  const msg = fieldRepair(st, loc);
  check(itemDur(ar) === 40 && kit.dur === GEAR.repairkit.dur - 1, `repaired on the spot, one use of the kit gone (${msg})`);
  kit.dur = 1;
  ar.dur = 5;
  fieldRepair(st, loc);
  check(![...c.pockets, ...(c.gear.backpack.contents || [])].includes(kit), "the last use: the kit is gone");
}

// 5. The base queue.
{
  console.log("The queue");
  const { st, h, c } = setup(2, { mechanics: 6, crafting: 6 });
  const ar = worn("ar", 24);
  c.gear.weapon = ar;
  const gp0 = h.stock.gunparts, sc0 = h.stock.scrap;
  const msg = queueRepair(st, h, `s:${c.id}:weapon`);
  check(h.gearRepairs.length === 1 && !c.gear.weapon && h.stock.gunparts === gp0 - 3 && h.stock.scrap === sc0 - 1, `queued: the gun goes to the bench, its inputs paid (${msg})`);
  check(queueRepair(st, h, `s:${c.id}:weapon`) === "Nothing there." && h.gearRepairs.length === 1, "an empty slot cannot be queued");
  const hour0 = st.hour;
  for (let i = 0; i < 4 && h.gearRepairs.length; i++) { repairHour(st); st.hour++; }
  check(!h.gearRepairs.length && h.armory.includes(ar) && itemDur(ar) === itemDurMax(ar) && itemDurMax(ar) < 60, `done within ${st.hour - hour0} hours: in the armory at ${itemDur(ar)} of ${itemDurMax(ar)}`);
  check(h.gearRepairHour === st.hour - 1, "the crafters' hour went to the repair (no crafting that hour)");
  // Cancel: everything back.
  const bat = worn("bat", 3);
  h.armory.push(bat);
  const s0 = h.stock.scrap, w0 = h.stock.wood;
  queueRepair(st, h, `armory:${h.id}:list:${h.armory.indexOf(bat)}`);
  const job = h.gearRepairs[0];
  cancelRepair(st, h, job.id);
  check(!h.gearRepairs.length && h.armory.includes(bat) && h.stock.scrap === s0 && h.stock.wood === w0, "cancelled before it started: the item and everything paid come back");
  // A ceramic plate refused at the queue.
  h.armory.push(worn("plate", 10));
  check(/Ceramic/.test(queueRepair(st, h, `armory:${h.id}:list:${h.armory.length - 1}`)), "a ceramic plate cannot be queued");
}

// 6. The autopilot.
{
  console.log("The autopilot");
  const { st, h, people } = setup(2, { mechanics: 6, crafting: 6 });
  h.armory.push(worn("ar", 12));
  const msg = planRepairs(st, h);
  check(h.gearRepairs.length === 1 && /queued/.test(msg), `worn gear in the armory goes to the bench (${msg})`);
  check(planRepairs(st, h) === "" && h.gearRepairs.length === 1, "one a day");
  const fighter = people[1];
  fighter.gear.weapon = worn("carbine", 10);
  st.hour += 24;
  planRepairs(st, h);
  check(fighter.gear.weapon && fighter.gear.weapon.key === "carbine", "a fighter's only gun is not taken off them (no spare in the armory)");
}

// 7. Saves and worth.
{
  console.log("Saves and worth");
  const { st, h, c } = setup();
  const ar = worn("ar", 20);
  repairItem(st, h, ar, c);
  h.armory.push(ar);
  const v1 = itemValue(ar);
  const fresh = newItem("ar"); fresh.dur = ar.dur; fresh.durMax = ar.durMax;
  check(v1 < itemValue(fresh), `a lowered maximum sells lower than the same condition never repaired (${v1.toFixed(1)} vs ${itemValue(fresh).toFixed(1)})`);
  const low = { ...ar, durMax: 15, dur: 15 };
  check(itemValue(low) < v1, "the lower the maximum, the lower the worth");
  check(itemValue(newItem("ar")) === itemValue({ key: "ar", name: "x", quality: 1 }), "an item never repaired is worth what it was");
  h.gearRepairs = [{ id: 1, item: worn("vest", 5), hours: 3, progress: 1, paid: { scrap: 2 }, gearPaid: [] }];
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const a2 = hub(back).armory.find((x) => x.key === "ar" && x.durBase);
  check(a2 && a2.durMax === ar.durMax && a2.durBase === 60 && a2.repairs === 1 && hub(back).gearRepairs.length === 1 && hub(back).gearRepairs[0].item.key === "vest", "the lowered maximum, the first one and the queue survive a save and load");
  let ok = true;
  try { for (let i = 0; i < 6; i++) tickHour(back); } catch (e) { ok = false; console.log(e); }
  check(ok, "a loaded world with a repair under way plays on");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
