// Headless crafting test: hand-craft recipes and gates (stock, skill, workshop), the craft queue (inputs paid,
// work-hours, blocked jobs skipped, cancel refunds), equipping makeshift gear, durability (fights, treatments,
// days), water filters and crowbars at a base, field crafting from a team's supplies, tactical battles with
// makeshift weapons, and a short campaign with crafters to check nothing crashes.
// Usage: node tools/crafttest.js [days] [seed]
import { unlockAll } from "../src/sim/blueprints.js";
import { createWorld, tickHour, hub, atBase, combatPower, makeSurvivor, newId } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { addBuilding } from "../src/sim/buildings.js";
import { scavengeOutput } from "../src/sim/economy.js";
import { fieldTreat, fieldTreatInfo } from "../src/sim/medical.js";
import { createBattle, autoPlayerTurn, runEnemyPhase, closeCombat, registerCombatHandler, autoResolveCombat, finishCombat, WEAPONS } from "../src/sim/combat.js";
import {
  CRAFTS, canCraft, queueCraft, cancelCraft, craftingHour, craftingDaily, craftQueue, craftJobStatus, makeItem, itemDur, itemDurMax,
  wearAfterFight, fieldCraftOptions, fieldCraft, hasWorkshop,
} from "../src/sim/crafting.js";

const days = Number(process.argv[2] || 30);
const seed = Number(process.argv[3] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
// Tech locks (blueprints.js) are tested in exploretest.js: here every manual is already studied.
// The hub starts bare (barestart: tools/barestarttest.js); these checks are about crafting at a base with a bench, so
// the hub gets the crafting bench it used to start with.
const world = () => { const st = createWorld({ seed, factionCount: 5 }); unlockAll(st); addBuilding(hub(st), "craftbench"); return st; };
const runHours = (st, base, max = 400) => { let h = 0; while (craftQueue(base).length && h < max) { craftingHour(st); h++; } return h; };
const setSkill = (people, k, v) => people.forEach((s) => (s.skills[k] = v, s.traits = s.traits.filter((t) => t !== "lucky" && t !== "medic")));

// 0. Data: every recipe points at real gear; makeshift gear is weaker than what it imitates.
{
  console.log("Data");
  for (const [k, r] of Object.entries(CRAFTS)) check(r.supplies || GEAR[r.gear], `${k} makes known gear`);
  for (const k of Object.keys(GEAR)) if (GEAR[k].slot === "weapon") check(!!WEAPONS[k], `${k} has battle stats`);
  check(GEAR.sawmachete.power < GEAR.machete.power && GEAR.pipegun.power < GEAR.shotgun.power, "makeshift weapons weaker than manufactured");
  check(GEAR.scrapvest.power < GEAR.vest.power && GEAR.tirevest.power < GEAR.vest.power, "makeshift armor weaker than a Kevlar vest");
  check(GEAR.ragplugs.ears.cut < GEAR.earplugs.ears.cut && GEAR.ragplugs.dur < GEAR.earplugs.dur && CRAFTS.ragplugs.field, "makeshift rag earplugs weaker and shorter-lived than foam earplugs, made in the field");
  check(WEAPONS.spikedbat.dmg[1] < WEAPONS.machete.dmg[1] && WEAPONS.pipegun.dmg[1] < WEAPONS.shotgun.dmg[1], "makeshift battle damage lower");
}

// 1. Gates: stock, skill, workshop.
{
  console.log("Gates");
  const st = world();
  const h = hub(st);
  const ppl = atBase(st, h.id);
  setSkill(ppl, "mechanics", 0);
  h.stock.scrap = 0;
  check(!canCraft(st, h, "spikedbat").ok && /scrap/.test(canCraft(st, h, "spikedbat").reason), "no scrap blocks a craft");
  h.stock.scrap = 200; h.stock.parts = 20; h.stock.meds = 20; h.stock.water = 50;
  check(canCraft(st, h, "spikedbat").ok, "spiked bat needs no skill");
  check(/Mechanics 3/.test(canCraft(st, h, "sawmachete").reason || ""), "saw-blade machete needs Mechanics 3");
  ppl[0].skills.mechanics = 8;
  check(canCraft(st, h, "sawmachete").ok, "Mechanics 8 survivor unlocks the machete");
  addBuilding(h, "ammo_bench"); // the hub has a crafting bench only (world() above; benchtest.js)
  check(hasWorkshop(h) && canCraft(st, h, "crossbow").ok, "an ammo bench counts as a workshop");
  h.buildings = h.buildings.filter((b) => b.type !== "ammo_bench");
  check(!hasWorkshop(h) && /workshop/.test(canCraft(st, h, "crossbow").reason || ""), "crossbow needs a workshop");
  check(canCraft(st, h, "tirevest").ok, "hand recipes work without a workshop");
  addBuilding(h, "machine_shop");
  check(canCraft(st, h, "pipegun").ok && canCraft(st, h, "scrapvest").ok, "machine shop opens workshop recipes");
}

// 2. Queue: inputs paid up front, crafters needed, completes into the armory, supplies recipe, cancel refunds.
{
  console.log("Queue");
  const st = world();
  const h = hub(st);
  const ppl = atBase(st, h.id);
  setSkill(ppl, "mechanics", 0);
  setSkill(ppl, "medicine", 0);
  setSkill(ppl, "crafting", 0); // Crafting sets the speed (craft-books)
  ppl.forEach((s) => (s.role = "farm"));
  Object.assign(h.stock, { scrap: 100, parts: 10, meds: 10, water: 40, wood: 500 });
  const armory0 = h.armory.length;
  queueCraft(st, h, "spikedbat");
  check(h.stock.scrap === 97 && h.stock.wood === 485, `bat costs 3 scrap and 15 wood up front (scrap ${h.stock.scrap}, wood ${h.stock.wood})`);
  check(/No crafters/.test(craftJobStatus(st, h, craftQueue(h)[0])), "no crafter: job waits");
  craftingHour(st);
  check(craftQueue(h)[0].progress === 0, "no progress without crafters");
  ppl[0].role = "craft";
  const hours = runHours(st, h);
  check(!craftQueue(h).length && h.armory.length === armory0 + 1, `bat finished in ${hours}h and is in the armory`);
  const bat = h.armory[h.armory.length - 1];
  check(bat.key === "spikedbat" && bat.dur === itemDurMax(bat) && bat.quality >= 0.6 && bat.quality <= 1, "crafted bat has durability and condition");
  check(hours >= 4 && hours <= 5, `a lone unskilled crafter takes about 5h at the hub's crafting bench (6h without; ${hours})`);
  // Supplies recipe: dressings make meds.
  ppl[1].skills.medicine = 5;
  ppl[1].role = "craft";
  const meds0 = h.stock.meds;
  queueCraft(st, h, "dressings");
  check(h.stock.water === 38 && h.stock.meds === meds0, "dressings take scrap and water");
  runHours(st, h);
  check(h.stock.meds === meds0 + 1, "dressings add 1 meds");
  // Blocked jobs are skipped: a Mechanics 3 recipe with only unskilled crafters waits while the next job runs.
  ppl[2].skills.mechanics = 5; // at the base but not crafting
  ppl[1].skills.mechanics = 0;
  queueCraft(st, h, "sawmachete");
  queueCraft(st, h, "pipespear");
  check(/Mechanics 3/.test(craftJobStatus(st, h, craftQueue(h)[0])), "machete blocked without a skilled crafter");
  for (let i = 0; i < 10; i++) craftingHour(st);
  check(craftQueue(h).length === 1 && craftQueue(h)[0].recipe === "sawmachete" && h.armory.some((g) => g.key === "pipespear"), "spear finished past the blocked machete");
  ppl[2].role = "craft";
  runHours(st, h);
  check(h.armory.some((g) => g.key === "sawmachete"), "machete finished once a skilled crafter joined");
  // Cancel: untouched = full refund, started = half.
  const s0 = h.stock.scrap;
  queueCraft(st, h, "tirevest");
  cancelCraft(st, h, craftQueue(h)[0].id);
  check(h.stock.scrap === s0, "cancel before starting refunds everything");
  queueCraft(st, h, "tirevest");
  craftingHour(st);
  cancelCraft(st, h, craftQueue(h)[0].id);
  check(h.stock.scrap === s0 - 3, `cancel after starting refunds half (scrap ${h.stock.scrap})`);
  // Queue cap.
  for (let i = 0; i < 9; i++) queueCraft(st, h, "padding");
  check(craftQueue(h).length === 8 && /full/.test(canCraft(st, h, "padding").reason), "queue capped at 8");
}

// 3. Equip, durability in fights, breaking.
{
  console.log("Equip and durability");
  const st = world();
  const h = hub(st);
  const s = atBase(st, h.id)[1];
  s.gear.weapon = null; s.gear.armor = null;
  const p0 = combatPower(s);
  h.armory.push(makeItem("spikedbat", 1), makeItem("tirevest", 1));
  // Same steps as the Armory's equip action in main.js.
  for (const key of ["spikedbat", "tirevest"]) {
    const item = h.armory.splice(h.armory.findIndex((g) => g.key === key), 1)[0];
    s.gear[GEAR[item.key].slot] = item;
  }
  check(combatPower(s) > p0, `makeshift gear raises combat power (${p0.toFixed(1)} → ${combatPower(s).toFixed(1)})`);
  wearAfterFight(st, [s]);
  check(s.gear.weapon.dur === itemDurMax(s.gear.weapon) - 1 && s.gear.armor.dur === itemDurMax(s.gear.armor) - 1, "a fight wears weapon and armor by 1");
  s.gear.weapon.dur = 1;
  wearAfterFight(st, [s]);
  check(!s.gear.weapon && s.gear.armor, "a worn-out bat breaks and is gone");
  // Loot-style items without dur start full; gear without a dur (binoculars) never wears; real gear wears too (GEAR_DUR).
  const loose = { key: "pipespear", name: GEAR.pipespear.name, quality: 0.85 };
  check(itemDur(loose) === GEAR.pipespear.dur && itemDur({ key: "binoculars" }) === null && itemDur({ key: "pistol" }) === GEAR.pistol.dur, "durability defaults");
  // Crafted quality sets the uses: the listed dur at 75%, 20% more at 100%.
  check(makeItem("spikedbat", 0.75).dur === GEAR.spikedbat.dur && makeItem("spikedbat", 1).dur === Math.round(GEAR.spikedbat.dur * 1.2) && makeItem("spikedbat", 0.6).dur < GEAR.spikedbat.dur, "crafted quality sets how long it lasts");
  // Auto-resolved fight goes through finishCombat and wears gear.
  registerCombatHandler("crafttest", () => {});
  s.gear.weapon = makeItem("pipespear", 1);
  const setup = { tile: h.tile, baseId: h.id, fighterIds: [s.id], enemy: { kind: "zombies", count: 1, power: 0.5 }, handler: "crafttest", context: {} };
  finishCombat(st, setup, autoResolveCombat(st, setup));
  check(!s.alive || (s.gear.weapon && s.gear.weapon.dur === itemDurMax(s.gear.weapon) - 1), "finishCombat wears makeshift gear");
}

// 4. Tactical battles with makeshift weapons (AI plays both sides).
{
  console.log("Battles");
  const st = world();
  const h = hub(st);
  let last = null, wins = 0, done = 0;
  registerCombatHandler("crafttest", (x, r) => { last = r; });
  const kits = ["spikedbat", "pipespear", "sawmachete", "crossbow", "pipegun"];
  for (let n = 0; n < 25; n++) {
    const team = [];
    for (let i = 0; i < 4; i++) {
      const s = makeSurvivor(st);
      s.skills.shooting = 6;
      s.gear.weapon = makeItem(kits[(n + i) % kits.length], 0.9);
      s.gear.armor = makeItem(["padding", "tirevest", "scrapvest", "sportspads"][i], 0.9);
      s.location = { kind: "base", baseId: h.id };
      st.survivors.push(s);
      team.push(s);
    }
    h.stock.ammo = 100; h.stock.meds = 2; h.stock.arrows = 60; // the crossbow shoots bolts (arrows)
    const ammo0 = h.stock.ammo;
    const setup = { tile: h.tile, baseId: h.id, fighterIds: team.map((s) => s.id), enemy: { kind: n % 2 ? "zombies" : "raiders", count: 3, power: 2 }, canRetreat: false, handler: "crafttest", context: {} };
    st.combat = createBattle(st, setup);
    const units = st.combat.units.filter((u) => u.side === "player");
    check(units.every((u) => u.weapon !== "fists"), "makeshift weapons are used in battle");
    let guard = 0;
    while (!st.combat.over && guard++ < 60) { autoPlayerTurn(st); runEnemyPhase(st); }
    if (!st.combat.over) { st.combat = null; continue; }
    closeCombat(st);
    done++;
    if (last && last.outcome === "victory") wins++;
    const survivors = team.filter((s) => s.alive && s.gear.weapon);
    check(survivors.every((s) => s.gear.weapon.dur === itemDurMax(s.gear.weapon) - 1), "battle wore each weapon by 1");
    if (team.every((s) => s.gear.weapon && s.gear.weapon.key === "crossbow")) check(h.stock.ammo === ammo0 && (last.arrowsUsed || 0) > 0 && h.stock.arrows === 60 - last.arrowsUsed + (last.arrowsBack || 0), `crossbows use bolts (arrows), no ammo (${last.arrowsUsed} shot, ${last.arrowsBack || 0} picked up)`);
    for (const s of team) s.alive = false; // clear the board for the next battle
  }
  check(done >= 20, `battles finished (${done}/25)`);
  console.log(`  ${done} battles, ${wins} won by the makeshift team`);
}

// 5. Tools at a base: water filter, crowbar.
{
  console.log("Base tools");
  const st = world();
  const h = hub(st);
  const w0 = h.stock.water;
  h.armory.push(makeItem("waterfilter", 1));
  craftingDaily(st);
  check(h.stock.water === w0 + GEAR.waterfilter.water, "filter in the armory adds water");
  check(h.armory.find((g) => g.key === "waterfilter").dur === itemDurMax(h.armory.find((g) => g.key === "waterfilter")) - 1, "filter wears a day");
  h.armory.find((g) => g.key === "waterfilter").dur = 1;
  craftingDaily(st);
  check(!h.armory.some((g) => g.key === "waterfilter"), "worn-out filter is removed");
  const scav = atBase(st, h.id).find((s) => s.role === "scavenge") || atBase(st, h.id)[0];
  scav.role = "scavenge";
  scav.gear.tool = null;
  const out0 = scavengeOutput(st, h).scrap;
  scav.gear.tool = makeItem("crowbar", 1);
  check(scavengeOutput(st, h).scrap > out0, "crowbar raises base scavenging");
  craftingDaily(st);
  check(scav.gear.tool.dur === itemDurMax(scav.gear.tool) - 1, "crowbar wears while scavenging");
}

// 6. Field crafting and the bandage kit with field treatment.
{
  console.log("Field");
  const st = world();
  const ppl = atBase(st, hub(st).id).slice(0, 2);
  setSkill(ppl, "medicine", 0);
  ppl.forEach((s) => (s.gear.tool = null, s.gear.weapon = { key: "knife", name: GEAR.knife.name, quality: 1 }));
  const party = { id: newId(), members: ppl.map((s) => s.id), supplies: { scrap: 5, water: 4, meds: 2, food: 10 }, cargo: { supplies: { scrap: 3 }, gear: [] } };
  st.parties.push(party);
  ppl.forEach((s) => (s.location = { kind: "party", partyId: party.id }));
  const opts = fieldCraftOptions(st, party);
  check(opts.length >= 4 && opts.every((o) => CRAFTS[o.key].field), "only field recipes offered");
  check(!opts.find((o) => o.key === "bandagekit").ok && /Medicine 2/.test(opts.find((o) => o.key === "bandagekit").reason), "bandage kit needs Medicine 2 on the team");
  const msg = fieldCraft(st, party, "pipespear");
  check(party.cargo.supplies.scrap === 0 && party.supplies.scrap === 5, `spear uses carried cargo scrap first (${msg})`);
  check(party.cargo.gear.some((g) => g.key === "pipespear"), "spear goes to the cargo when every weapon slot is full");
  ppl[0].skills.medicine = 4;
  const msg2 = fieldCraft(st, party, "bandagekit");
  check(ppl.some((s) => s.gear.tool && s.gear.tool.key === "bandagekit"), `bandage kit handed to someone (${msg2})`);
  check(party.supplies.meds === 1 && party.supplies.scrap === 3, "kit cost 2 scrap and 1 meds");
  const scrapKeep = party.supplies.scrap;
  party.supplies.scrap = 1;
  const cargo0 = party.cargo.gear.length;
  check(/Needs 3 scrap/.test(fieldCraft(st, party, "pipespear")) && party.cargo.gear.length === cargo0 && party.supplies.scrap === 1, "field craft refuses without stock");
  party.supplies.scrap = scrapKeep;
  // The kit helps field treatment and wears per treatment.
  const kitHolder = ppl.find((s) => s.gear.tool && s.gear.tool.key === "bandagekit");
  const medic = ppl[0];
  if (kitHolder !== medic) { kitHolder.gear.tool = null; medic.gear.tool = makeItem("bandagekit", 1); }
  const patient = ppl[1];
  patient.health = 50;
  const withKit = fieldTreatInfo(st, party, patient).heal;
  const kit = medic.gear.tool;
  medic.gear.tool = null;
  const noKit = fieldTreatInfo(st, party, patient).heal;
  medic.gear.tool = kit;
  check(withKit > noKit, `bandage kit adds to field healing (${noKit} → ${withKit})`);
  party.supplies.meds = 5;
  fieldTreat(st, party, patient.id);
  check(medic.gear.tool && medic.gear.tool.dur === itemDurMax(kit) - 1, "a treatment wears the kit");
  check(fieldCraft(st, party, "sawmachete").length > 0 && !party.cargo.gear.some((g) => g.key === "sawmachete"), "non-field recipes cannot be made on the road");
}

// 7. Campaign: crafters keep the queue busy for a while; nothing crashes.
{
  console.log(`Campaign (${days} days)`);
  const st = world();
  const h = hub(st);
  const ppl = atBase(st, h.id);
  ppl[5].role = "craft";
  ppl[5].skills.mechanics = 6;
  h.stock.scrap += 80; h.stock.parts += 4;
  let made = 0, msgs = [];
  for (let d = 0; d < days; d++) {
    for (let i = 0; i < 24; i++) tickHour(st);
    if (craftQueue(h).length < 2) for (const k of ["spikedbat", "tirevest", "crossbow", "waterfilter", "padding"]) msgs.push(queueCraft(st, h, k));
    made = st.log.filter((l) => /crafted at/.test(l.text)).length;
  }
  check(made > 0 || !ppl[5].alive, `items crafted during the campaign (${made} in the recent log)`);
  console.log(`  day ${days}: ${atBase(st, h.id).length} at the hub, armory ${h.armory.length} items, queue ${craftQueue(h).length}`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
