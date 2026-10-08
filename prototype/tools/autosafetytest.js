// The governor's water and food safety (2026-10-08 balance pass, autopilot.js / upkeep.js / breakdowns.js):
//   1. the pay-out reserve (upkeep.js PAYOUT): food and water are never paid out of a base below PAYOUT.days of its
//      need: the governor's trade spare (caravans, merchants, envoys' gifts), a raid tribute, a ransom's keep, the
//      radio offers it agrees to, a radio deal's caravan at the gates; the AI groups keep the same days a head (what
//      they sell, the tribute they pay);
//   2. a broken well or pump waiting for scrap: a spare gun is taken apart for its scrap the hour before the repairs
//      start, and scrap is wanted hard (needs) while it still waits;
//   3. upkeep hands at a big hub (UPKEEP_CREW): one or two builders kept on upkeep mend the wells whether or not a
//      building is queued, add nothing to the construction, the mark is ignored once the base is not governed, and it
//      survives a save;
//   4. the newcomer rule (roomAt): no newcomers past what a hub without a river can drink from its wells and rain
//      (GROWTH_WATER), fewer while the winter outlook is short;
//   5. the farm crew (FARM_AP): with the food at its target only the plots' "need" crew farms; short of it, more.
// Usage: node tools/autosafetytest.js [seed]
import { createWorld, hub, atBase, residents, makeSurvivor, hourOfDay } from "../src/sim/world.js";
import { setAutopilot, safetyAI, UPKEEP_CREW, GROWTH_WATER } from "../src/sim/autopilot.js";
import { PAYOUT, payoutFloor, payoutSpare, payoutBreaks, groupPayoutSpare, foodUse, mouthsAt } from "../src/sim/upkeep.js";
import { available } from "../src/sim/trade.js";
import { raidAnswer } from "../src/sim/groupcare.js";
import { addBuilding, buildRate, onUpkeep, queueBuild } from "../src/sim/buildings.js";
import { fixtures, breakFixture, breakdownsDaily, breakdownsHour, jobFor, WEAR } from "../src/sim/breakdowns.js";
import { newItem } from "../src/sim/inventory.js";
import { farmersWanted } from "../src/sim/farming.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { waterIn } from "../src/sim/water.js";
import { thirstFactor } from "../src/sim/weather.js";
import { edibleFood } from "../src/sim/storage.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const W = () => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.visitorsOff = true; return st; };
const plain = (s) => { s.traits = []; s.conditions = []; s.perks = []; s.health = 100; s.mood = 80; return s; };
const addPerson = (st, base) => { const s = plain(makeSurvivor(st, 1)); s.location = { kind: "base", baseId: base.id }; s.role = "rest"; st.survivors.push(s); return s; };
const grow = (st, base, n) => { while (residents(st, base.id).length < n) addPerson(st, base); for (const s of atBase(st, base.id)) plain(s); };

// ---------- 1. the pay-out reserve ----------
{
  console.log("The pay-out reserve");
  const st = W();
  setAutopilot(st, true, "balanced");
  const h = hub(st);
  Object.assign(h.stock, { food: 300, preserved: 0, water: 60, rawwater: 0 });
  const heads = mouthsAt(st, h).heads;
  const wFloor = heads * thirstFactor(st) * PAYOUT.days, fFloor = foodUse(st, h).total * PAYOUT.days;
  check(near(payoutFloor(st, h, "water"), wFloor) && near(payoutFloor(st, h, "food"), fFloor), `the floor is ${PAYOUT.days} days of everyone's need (water ${wFloor.toFixed(1)}, food ${fFloor.toFixed(1)} for ${heads})`);
  check(payoutSpare(st, h, "water") === Math.floor(60 - wFloor) && payoutSpare(st, h, "rawwater") === payoutSpare(st, h, "water"), `water spare = stock − floor (${payoutSpare(st, h, "water")}), un-purified counts as water`);
  check(payoutSpare(st, h, "scrap") === Infinity && payoutFloor(st, h, "scrap") === 0, "other supplies are not covered");
  const ts = safetyAI.tradeSpare(st, h);
  check(ts.water === payoutSpare(st, h, "water") && ts.food <= payoutSpare(st, h, "food"), `the governor's trade spare keeps the reserve (water ${ts.water}, food ${ts.food})`);
  h.stock.water = Math.floor(wFloor) - 1;
  check(safetyAI.tradeSpare(st, h).water === 0 && payoutBreaks(st, h, { water: 1 }) && payoutBreaks(st, h, { rawwater: 1 }), "below the floor: no water to trade, any water paid breaks it");
  check(!payoutBreaks(st, h, { scrap: 50, food: 10 }), "food above the floor and scrap: fine");
  // A raid's tribute (30% of the fresh food): paid only while the rest keeps the floor.
  h.stock.food = Math.ceil(fFloor * 3); h.stock.preserved = 0;
  check(safetyAI.tributeSpared(st, h), `a tribute out of ${h.stock.food} food leaves the reserve: it may be paid`);
  h.stock.food = Math.floor(fFloor * 1.2);
  check(!safetyAI.tributeSpared(st, h), `a tribute out of ${h.stock.food} food would go below ${Math.round(fFloor)}: not paid`);
  h.stock.preserved = Math.ceil(fFloor); // preserved food counts in the reserve
  check(safetyAI.tributeSpared(st, h), "preserved food counts in the reserve");
  // AI groups: what they sell keeps PAYOUT.days a head; their tribute never goes below it.
  const f = st.factions.find((x) => x.alive && x.pop >= 6 && !x.atWar && x.type !== "zealot"); // zealots never pay
  if (f) {
    f.stock.food = f.pop * PAYOUT.days + 7;
    check(groupPayoutSpare(f, "food") === 7 && available(f, "food") <= 7, `a group sells food only above ${PAYOUT.days} days a head (spare ${groupPayoutSpare(f, "food")}, sells ${available(f, "food")})`);
    const att = st.factions.find((x) => x !== f && x.alive);
    let paid = null;
    for (let i = 0; i < 200 && !paid; i++) {
      st.hour += 1;
      f.stock.food = f.pop * PAYOUT.days + 4; f.stock.ammo = 100; f.stock.meds = 10; f.stock.scrap = 40;
      paid = raidAnswer(st, att, f, 100, 10);
    }
    check(paid === "tribute" && f.stock.food >= f.pop * PAYOUT.days, `a group's tribute leaves it ${PAYOUT.days} days of food a head (${f.stock.food} for ${f.pop})`);
  }
}

// ---------- 2. a broken well waiting for scrap ----------
{
  console.log("A broken well waiting for scrap");
  const st = W();
  setAutopilot(st, true, "balanced");
  const h = hub(st);
  grow(st, h, 6);
  const pump = fixtures(h).find((fx) => fx.type === "pump");
  Object.assign(h.stock, { scrap: 0, parts: 0 });
  h.armory = [newItem("pistol", 1, 0.8), newItem("pistol", 1, 0.6), newItem("huntrifle", 1, 0.8)];
  for (const s of atBase(st, h.id)) if (s.gear.weapon && s.gear.weapon.key === "pistol") s.gear.weapon = null; // the twins are in the armory
  breakFixture(st, h, pump, "worn out", { card: false });
  check(pump.broken && !jobFor(h, pump), "the pump broke and nothing could start (no scrap, no parts)");
  check(safetyAI.waterWaitsScrap(st, h) === 1, "it waits for scrap");
  check(safetyAI.needs(st, h).scrap >= 2.4, `scrap is wanted hard while it waits (${safetyAI.needs(st, h).scrap})`);
  safetyAI.salvage(st, h);
  check(h.armory.filter((it) => it.key === "pistol").length === 1 && h.armory.some((it) => it.key === "huntrifle"), "a spare pistol was taken apart (its twin and the lone rifle kept)");
  check((h.stock.scrap || 0) >= 1 && safetyAI.waterWaitsScrap(st, h) === 0, `its scrap pays the jury-rig (${h.stock.scrap} scrap)`);
  while (hourOfDay(st) !== WEAR.workFrom) st.hour++;
  breakdownsHour(st);
  check(!!jobFor(h, pump), "the repairs start at 08:00");
  // No spare: nothing is taken apart, scrap stays wanted.
  const st2 = W();
  setAutopilot(st2, true, "balanced");
  const h2 = hub(st2);
  Object.assign(h2.stock, { scrap: 0, parts: 0 });
  h2.armory = [newItem("pistol", 1, 0.8)];
  for (const s of atBase(st2, h2.id)) if (s.gear.weapon && s.gear.weapon.key === "pistol") s.gear.weapon = null;
  const p2 = fixtures(h2).find((fx) => fx.type === "pump");
  breakFixture(st2, h2, p2, "worn out", { card: false });
  safetyAI.salvage(st2, h2);
  check(h2.armory.length === 1 && safetyAI.waterWaitsScrap(st2, h2) === 1 && safetyAI.needs(st2, h2).scrap >= 2.4, "no twin to take apart: it keeps waiting and scrap stays wanted");
}

// ---------- 3. upkeep hands at a big hub ----------
{
  console.log("Upkeep at a big hub");
  const make = () => {
    const st = W();
    setAutopilot(st, true, "balanced");
    const h = hub(st);
    grow(st, h, UPKEEP_CREW.from + 2);
    Object.assign(h.stock, { food: 2000, water: 400, scrap: 200, parts: 20 });
    addBuilding(h, "well");
    for (const fx of fixtures(h)) fx.wear = 50;
    queueBuild(st, h, "bunkhouse");
    return { st, h };
  };
  const { st, h } = make();
  check(safetyAI.upkeepCrew(st, h, residents(st, h.id).length) === 1 && safetyAI.upkeepCrew(st, h, UPKEEP_CREW.two) === 2 && safetyAI.upkeepCrew(st, h, UPKEEP_CREW.from - 1) === 0, `hands: 1 from ${UPKEEP_CREW.from} people, 2 from ${UPKEEP_CREW.two}, none below`);
  safetyAI.planRoles(st, h);
  const menders = atBase(st, h.id).filter((s) => s.upkeep);
  check(menders.length === 1 && menders.every((s) => s.role === "build" && onUpkeep(st, h, s)), `one builder kept on upkeep (${menders.length})`);
  check(h.construction.length > 0, "with a building queued");
  const rate = buildRate(st, h);
  const m = menders[0];
  delete m.upkeep;
  check(buildRate(st, h) > rate, "the upkeep hand adds nothing to the construction");
  m.upkeep = true;
  // The same day with and without the hand: the wells wear less with it.
  const other = make();
  for (const s of atBase(other.st, other.h.id)) { s.role = "rest"; delete s.upkeep; }
  breakdownsDaily(st); breakdownsDaily(other.st);
  const worst = (b) => Math.max(...fixtures(b).map((fx) => fx.wear || 0));
  const sum = (b) => fixtures(b).reduce((a, fx) => a + (fx.wear || 0), 0);
  check(sum(h) < sum(other.h) - 1, `upkeep with a build queued takes wear off (${sum(h).toFixed(1)} against ${sum(other.h).toFixed(1)})`);
  check(worst(h) <= worst(other.h), "the most worn first");
  // Saved and loaded: the mark stays.
  const back = loadFromString(saveToString(st, { dropCards: true }));
  check(back.survivors.find((s) => s.id === m.id).upkeep === true, "the mark survives a save");
  // Not governed any more: the mark is ignored (they build again).
  setAutopilot(st, false);
  check(!onUpkeep(st, h, m) && buildRate(st, h) > rate, "with the autopilot off the mark is ignored");
  // Nothing worn: no upkeep hand.
  setAutopilot(st, true, "balanced");
  for (const fx of fixtures(h)) fx.wear = 5;
  safetyAI.planRoles(st, h);
  check(!atBase(st, h.id).some((s) => s.upkeep), "nothing worn: nobody kept on upkeep");
}

// ---------- 4. the newcomer rule ----------
{
  console.log("Newcomers");
  const st = W();
  setAutopilot(st, true, "balanced");
  const h = hub(st);
  grow(st, h, 8);
  Object.assign(h.stock, { food: 3000, water: 300, scrap: 300, parts: 30 });
  for (let i = 0; i < 6; i++) addBuilding(h, "bunkhouse");
  addBuilding(h, "cistern"); addBuilding(h, "cistern");
  for (let i = 0; i < 18; i++) h.armory.push(newItem("waterfilter", 1, 1)); // filters cover the summer on paper
  const cap = GROWTH_WATER.cap(st, h);
  check(cap.river || cap.heads > 0, `a hub's well-water ceiling (${cap.river ? "by a river" : `${cap.heads} people`})`);
  if (!cap.river) {
    grow(st, h, Math.max(residents(st, h.id).length, cap.heads));
    check(!safetyAI.roomAt(st, h, 1), `at the ceiling (${residents(st, h.id).length} people): no newcomer, filters or not`);
  }
}

// ---------- 5. the farm crew ----------
{
  console.log("The farm crew");
  const st = W();
  setAutopilot(st, true, "balanced");
  const h = hub(st);
  grow(st, h, 20);
  for (let i = 0; i < 4; i++) addBuilding(h, "farm_plot");
  const farmersAt = () => atBase(st, h.id).filter((s) => s.role === "farm").length;
  h.stock.food = 20 * 400; h.stock.preserved = 0;
  safetyAI.planRoles(st, h);
  const fw = farmersWanted(st, h);
  check(fw.need > 0 && farmersAt() <= fw.need, `food far above its target: the plots' need crew only (${farmersAt()} of ${fw.need} need / ${fw.ideal} ideal)`);
  h.stock.food = 20 * 6;
  safetyAI.planRoles(st, h);
  check(farmersAt() >= Math.min(fw.ideal, 20 - 4), `food short: the ideal crew and more (${farmersAt()})`);
  check(edibleFood(h) > 0 && waterIn(h.stock) >= 0, "stocks intact");
}

console.log(`\n${passes} passed, ${fails} failed`);
console.log(fails ? "autosafetytest failed" : "autosafetytest passed");
process.exit(fails ? 1 : 0);
