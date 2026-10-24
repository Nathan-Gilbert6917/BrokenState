// Customization points (2026-10-08, user request; sim/custompoints.js, sim/startgear.js, ui/newgame.js,
// ui/startgear.js, main.js): with Customize ticked every colonist starts blank and everything costs points.
//   - the price table: skill levels (1 / 2 / 3 a level by the level), traits by tier (bad ones give back), things by
//     what they are worth and their power, a gun's rounds, supplies; the default max against a few hundred rolled
//     colonists and their start kit (the calibration, printed);
//   - a blank start (nothing worn or carried, nothing of the dice's kit handed out on top), Start from the dice, Clear;
//   - over the max: who and by how much, Start refused; the bad traits' give-back capped at a third of the max;
//   - traits on the card: the clash table, at most five, tiers up and down and their points;
//   - what they carry placed by hand: the window's cells (pick up, move, swap), Add to the spot picked or where it
//     fits, refusals with the reason, a smaller bag moving or taking out what no longer fits;
//   - the vehicle's back (since 2026-10-24 the starting vehicle's own, against its point limit: sim/startfleet.js,
//     tools/startfleettest.js): a normal start's pickup unloaded at the hub, Hardcore's car, its room, the dice's back,
//     on nobody's points;
//   - a custom background picked under points: its skills, traits and kit loaded and priced, its own supplies and car;
//   - every rebuild keeps the picks and the points (seed, size, groups, hives, mode, starting people, a background),
//     Ironman refuses, the seed's map and groups stay put, a save and load after Start, the first days on autopilot;
//   - the screen: the Points each box, the points bars, the dice and Clear buttons, the trait colours everywhere.
// Usage: node tools/custompointstest.js
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { readFileSync } from "node:fs";
import { createWorld, tickHour, day, HUB_TOOLS } from "../src/sim/world.js";
import { GEAR, SKILLS, TRAITS, traitKind } from "../src/sim/data.js";
import { CUSTOM_POINTS, skillCost, nextLevelCost, itemPoints, loosePoints, slotPoints, suppliesPoints, gunExtras, pricePerson, overBudget, overText, clampMax, vehiclePoints, bgCarBack } from "../src/sim/custompoints.js";
import { TRAIT_TIERS, traitPoints, traitTier, tierCount } from "../src/sim/traits.js";
import { START_GEAR, carryList, clearStartGear, sanitizeStartGear, trunkKg } from "../src/sim/startgear.js";
import { allCarried, packOf, rigPouches } from "../src/sim/inventory.js";
import { newRunScreen, crewSnapshot, ironmanCrew, crewCustomized, crewWithBackground, blankCrew, LOOK_ACTIONS, LOOK_CHANGE_ACTIONS } from "../src/ui/newgame.js";
import { maxFor } from "../src/sim/custompoints.js";
import { assignStartingRoles } from "../src/sim/world.js";
import { startGearEditor, SG_ACTIONS, SG_CHANGE, loadDice, startVehicleInfo } from "../src/ui/startgear.js";
import { traitPickerHtml, traitChips } from "../src/ui/traitpick.js";
import { setCustomLibrary, presetToCustom, backgroundEditor, BG_ACTIONS } from "../src/ui/backgrounds.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { setAutopilot, autopilotResolve } from "../src/sim/autopilot.js";
import { totalRounds } from "../src/sim/ammo.js";

let pass = 0, fail = 0;
const VERBOSE = process.argv.includes("-v");
const check = (ok, msg) => { if (ok) { pass++; if (VERBOSE) console.log(`  ok ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } return ok; };
// The car's back as picked: the hardcore start's tent bags (tents.js hardcoreTents, TENTS.HARDCORE a survivor) ride there too.
const backOf = (p) => p.cargo.gear.filter((it) => it.key !== "tent1");
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
const ROLL = 9091; // a crew roll of its own (main.js gives a Customize crew one)
const world = (seed, extra = {}) => { const st = createWorld({ seed, factionCount: 5, crewRoll: ROLL, ...extra }); st.pointsMax = extra.max ?? CUSTOM_POINTS.DEF; return st; };
const blankWorld = (seed, extra = {}) => world(seed, { ...extra, crew: blankCrew(createWorld({ seed, factionCount: 5, crewRoll: ROLL, ...extra })) });
const again = (st, extra = {}) => { const w = createWorld({ seed: st.seed, factionCount: 5, crewRoll: ROLL, mode: st.mode, ...extra, crew: crewSnapshot(st) }); w.pointsMax = st.pointsMax; return w; };
const keysOn = (s) => allCarried(s).map((it) => it.key);
const mainSrc = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const UI = () => ({ started: false, freeEdit: true, ironman: false, worldSize: "normal", factionCount: 5, nrMsg: "" });

section("The price table");
{
  check(skillCost(0) === 0 && skillCost(5) === 5 && skillCost(10) === 10 && skillCost(11) === 12 && skillCost(15) === 20 && skillCost(16) === 23 && skillCost(20) === 35, `skill levels: 5 → ${skillCost(5)}, 10 → ${skillCost(10)}, 15 → ${skillCost(15)}, 20 → ${skillCost(20)} points`);
  check(nextLevelCost(0) === 1 && nextLevelCost(9) === 1 && nextLevelCost(10) === 2 && nextLevelCost(15) === 3, "the next level: 1 up to 10, 2 up to 15, 3 up to 20");
  check(itemPoints("knife") === 1 && itemPoints("backpack") === 1 && Object.keys(GEAR).every((k) => itemPoints(k) >= CUSTOM_POINTS.ITEM_MIN), `everything at least ${CUSTOM_POINTS.ITEM_MIN} (a knife ${itemPoints("knife")}, a school backpack ${itemPoints("backpack")})`);
  check(itemPoints("ar") > itemPoints("pistol") && itemPoints("pistol") > itemPoints("knife") && itemPoints("plate") > itemPoints("vest") && itemPoints("amr") > itemPoints("ar"), `dearer for more worth and power: pistol ${itemPoints("pistol")}, assault rifle ${itemPoints("ar")}, anti-materiel rifle ${itemPoints("amr")}, vest ${itemPoints("vest")}, plate carrier (with its plates) ${itemPoints("plate")}`);
  check(slotPoints("weapon", "ar") === itemPoints("ar") + suppliesPoints(gunExtras("ar")) && suppliesPoints(gunExtras("ar")) > 0 && slotPoints("weapon", "knife") === itemPoints("knife"), `a gun in the hands with its rounds: assault rifle ${slotPoints("weapon", "ar")} (${Object.entries(gunExtras("ar")).map(([k, n]) => `${n} ${k}`).join("")}), a knife ${slotPoints("weapon", "knife")}`);
  check(suppliesPoints(gunExtras("compbow")) === Math.ceil((START_GEAR.ARROWS * 0.4) / CUSTOM_POINTS.SUPPLY_VALUE) && Object.keys(gunExtras("m79")).length === 1 && !Object.keys(gunExtras("at4")).length, "a bow's quiver and a launcher's rounds priced; a one-shot tube none");
  check(suppliesPoints({ food: 30 }) === 10 && suppliesPoints({ meds: 10 }) === 14 && suppliesPoints({}) === 0, `supplies: 30 food ${suppliesPoints({ food: 30 })}, 10 meds ${suppliesPoints({ meds: 10 })}`);
  check(traitPoints("tough", 1) === 4 && traitPoints("tough", 3) === 10 && traitPoints("frail", 2) === -7 && traitPoints("greedy") === 0, "traits by tier: Tough +4 / +10 (III), Frail II −7, Greedy free");
  check(clampMax(-5) === CUSTOM_POINTS.MIN && clampMax(9999) === CUSTOM_POINTS.MAX && clampMax("x") === CUSTOM_POINTS.DEF && clampMax(120) === 120, "the max clamped");
  console.log(`  examples: 9mm pistol ${slotPoints("weapon", "pistol")}, hunting rifle ${slotPoints("weapon", "huntrifle")}, assault rifle ${slotPoints("weapon", "ar")}, Kevlar vest ${itemPoints("vest")}, plate carrier ${itemPoints("plate")}, hiking pack ${itemPoints("hikingpack")}, rucksack ${itemPoints("rucksack")}, night vision ${itemPoints("nvg")}, bandage kit ${itemPoints("bandagekit")}, a 30-round STANAG magazine ${itemPoints("mag_stanag_30")}, frag ${itemPoints("frag")}`);
}

section("The default max: what a rolled colonist and their start kit come to");
{
  const out = { normal: [], hardcore: [] };
  for (const mode of ["normal", "hardcore"]) {
    for (let k = 1; k <= (mode === "normal" ? 50 : 100); k++) {
      const st = createWorld({ seed: k * 7 + 3, factionCount: 3, mode });
      st.survivors.forEach((s) => { loadDice(st, s); }); // the dice as picks (what they wear and carry, skills, traits)
      for (const s of st.survivors) out[mode].push(pricePerson(st, s, 1e6).total);
    }
  }
  const all = [...out.normal, ...out.hardcore];
  console.log(`  rolled colonists priced: normal ${out.normal.length} (median ${med(out.normal)}), Hardcore ${out.hardcore.length} (median ${med(out.hardcore)}), both median ${med(all)}; the default max ${CUSTOM_POINTS.DEF}`);
  check(Math.abs(med(all) - CUSTOM_POINTS.DEF) <= 8, `the default (${CUSTOM_POINTS.DEF}) is about the median rolled colonist (${med(all)})`);
}

section("A blank start, Start from the dice, Clear");
{
  for (const mode of ["normal", "hardcore"]) {
    const base = createWorld({ seed: 42, factionCount: 5, crewRoll: ROLL, mode });
    const st = blankWorld(42, { mode });
    check(st.survivors.every((s) => s.startPoints && pricePerson(st, s).total === 0 && SKILLS.every((k) => s.skills[k] === 0) && !s.traits.length), `${mode}: everyone blank, 0 points spent`);
    check(st.survivors.every((s) => !allCarried(s).length && START_GEAR.SLOTS.every((k) => !s.gear[k])), `${mode}: nothing worn, held or carried`);
    // (the armory's own tool shelf aside: world.js HUB_TOOLS, every new hub's, since the tools of 2026-10-21)
    if (mode === "normal") check(st.bases[0].armory.every((it) => HUB_TOOLS.includes(it.key)) && !st.bases[0].armory.some((it) => GEAR[it.key].slot === "weapon" && !HUB_TOOLS.includes(it.key)), "normal: the dice's weapons and vest are not handed to the armory on top");
    else {
      // The car's back is the starting vehicle's own since 2026-10-24 (sim/startfleet.js): as rolled, the dice's, on nobody's points.
      const dice = (st.survivors.find((s) => s.diceTrunk) || {}).diceTrunk;
      check(totalRounds(st.parties[0].supplies) === 0 && st.fleet[0].load === null && dice && backOf(st.parties[0]).length === dice.items.length, "Hardcore: nothing of the grab on the team (the rolled guns' rounds neither); the car's back as rolled, its own");
    }
    // Start from the dice: what was rolled, priced.
    const ui = UI();
    check(SG_ACTIONS["sg-dice"](st, ui, { i: 0 }) === true, `${mode}: Start from the dice asks for a rebuild`);
    const d = again(st);
    const s0 = d.survivors[0], b0 = base.survivors[0];
    check(JSON.stringify(s0.skills) === JSON.stringify(b0.skills) && s0.traits.join() === b0.traits.join() && JSON.stringify(s0.traitTier || {}) === JSON.stringify(b0.traitTier || {}), `${mode}: the dice's skills, traits and tiers (${s0.traits.join(", ") || "no traits"})`);
    check((s0.gear.weapon && s0.gear.weapon.key) === (b0.gear.weapon && b0.gear.weapon.key) && keysOn(s0).sort().join() === keysOn(b0).sort().join(), `${mode}: what they wear and carry (${keysOn(s0).join(", ")})`);
    const B = pricePerson(d, s0);
    check(B.total > 20 && B.skills > 0 && B.gear > 0, `${mode}: and what it costs: ${B.total} (${B.lines.join(", ")})`);
    check(d.survivors.slice(1).every((x) => pricePerson(d, x).total === 0), `${mode}: the others still blank`);
    check(SG_ACTIONS["sg-blank"](d, ui, { i: 0 }) === true && pricePerson(again(d), again(d).survivors[0]).total === 0, `${mode}: Clear: blank again, 0 points`);
  }
}

section("Over the max; the bad traits' give-back capped");
{
  const st = blankWorld(42);
  const s = st.survivors[1];
  st.pointsMax = 60;
  for (const k of SKILLS) s.skills[k] = 0;
  for (const k of SKILLS.slice(0, 10)) s.skills[k] = 8; // 80 points (ten skills of the eleven)
  const B = pricePerson(st, s);
  check(B.total === 80 && B.over === 20 && overBudget(st).length === 1 && overBudget(st)[0].s === s, `80 points of skills on a max of 60: 20 over`);
  check(new RegExp(`${s.name.split(" ")[0]} by 20`).test(overText(st)), `Start's refusal names them: "${overText(st)}"`);
  check(/overText\(state\)/.test(mainSrc) && /if \(over\) \{ ui\.nrMsg = over; return; \}/.test(mainSrc), "main.js begin refuses while anyone is over");
  s.traits = ["frail", "coward", "unlucky", "slow", "sickly"];
  s.traitTier = { frail: 3, coward: 3, unlucky: 2, slow: 3, sickly: 3 };
  const C = pricePerson(st, s);
  check(C.bad === -48 && C.back === -Math.floor(60 * CUSTOM_POINTS.BAD_BACK) && C.total === 80 - 20, `five bad traits at their worst are worth ${C.bad}, but give back at most ${-C.back} (a third of 60): ${C.total} spent`);
  check(C.lines.some((l) => /at most 20/.test(l)), "the bar's hover text says so");
  s.traits = ["tough", "frail"].slice(0, 1); s.traitTier = { tough: 2 };
  check(pricePerson(st, s).total === 80 + 7, "a good trait costs: Tough II +7");
  st.pointsMax = 200;
  check(!overText(st), "a higher max: nobody over");
}

section("Traits on the card: clashes, at most five, tiers");
{
  const st = blankWorld(42);
  const ui = UI();
  const s = st.survivors[0];
  for (const t of ["tough", "frail", "lucky", "unlucky", "fleet", "slow", "pessimist", "ironwill", "glutton", "loud"]) LOOK_ACTIONS["nr-trait"](st, ui, { id: s.id, k: t });
  check(s.traits.join() === "tough,lucky,fleet,pessimist,glutton", `the clashes refused (Frail, Unlucky, Slow, Iron Will by Pessimist) and at most ${CUSTOM_POINTS.MAX_TRAITS} (${s.traits.join(", ")})`);
  const p0 = pricePerson(st, s).total;
  LOOK_ACTIONS["nr-tier"](st, ui, { id: s.id, k: "tough", d: 1 });
  LOOK_ACTIONS["nr-tier"](st, ui, { id: s.id, k: "tough", d: 1 });
  LOOK_ACTIONS["nr-tier"](st, ui, { id: s.id, k: "tough", d: 1 });
  check(traitTier(s, "tough") === 3 && pricePerson(st, s).total === p0 + 6, `Tough up to III (not past it): ${p0} → ${pricePerson(st, s).total} points`);
  LOOK_ACTIONS["nr-tier"](st, ui, { id: s.id, k: "glutton", d: 1 });
  check(traitTier(s, "glutton") === 2 && pricePerson(st, s).total === p0 + 6 - 2, "a bad trait a tier up gives more back: Glutton II −4");
  LOOK_ACTIONS["nr-tier"](st, ui, { id: s.id, k: "lucky", d: 1 });
  LOOK_ACTIONS["nr-tier"](st, ui, { id: s.id, k: "lucky", d: 1 });
  check(traitTier(s, "lucky") === 2, "Lucky has two tiers");
  LOOK_ACTIONS["nr-trait"](st, ui, { id: s.id, k: "tough" });
  check(!s.traits.includes("tough") && !(s.traitTier && s.traitTier.tough), "taken off: its tier goes too");
  const d = again(st);
  check(d.survivors[0].traits.join() === s.traits.join() && JSON.stringify(d.survivors[0].traitTier) === JSON.stringify(s.traitTier), `the traits and tiers survive the rebuild (${JSON.stringify(s.traitTier)})`);
  const html = traitPickerHtml(Object.keys(TRAITS), ["tough", "loud"], 5, `data-action="nr-trait" data-id="1"`, { tiers: { tough: 2 }, tierAttrs: `data-action="nr-tier" data-id="1"`, points: true });
  check(/Tough II/.test(html) && (html.match(/data-action="nr-tier"/g) || []).length === 4 && /<i class="tp-pts">\+7<\/i>/.test(html) && /<i class="tp-pts">−3<\/i>/.test(html) && /Neutral/.test(html), "the picker: the tier on the chip, − and + beside a picked one, its points, a neutral row");
  check(Object.keys(TRAITS).every((t) => new RegExp(`tp-chip t-${traitKind(t)}[^>]*data-k="${t}"`).test(html)), "every chip coloured by its kind (t-good, t-bad, t-neutral)");
}

section("What they carry, placed by hand");
{
  const st = blankWorld(42);
  const ui = UI();
  SG_ACTIONS["sg-open"](st, ui, { id: st.survivors[0].id });
  const s = st.survivors[0];
  // No bag, no rig: only pockets, small things.
  check(SG_CHANGE["sg-item-add"](st, ui, { value: "laptop", dataset: {} }) === false && /No room for the Laptop|only small things/i.test(ui.gearEdit.msg), `a laptop with no bag: refused ("${ui.gearEdit.msg}")`);
  check(SG_CHANGE["sg-item-add"](st, ui, { value: "phone", dataset: {} }) === true && carryList(s.startGear).map((x) => `${x.key}@${x.where}${x.i}`).join() === "phone@pocket0", "a phone: the first pocket");
  // A bag and a rig (the window rebuilds after each change: here, the world again by hand).
  SG_CHANGE["sg-slot"](st, ui, { value: "hikingpack", dataset: { slot: "backpack" } });
  SG_CHANGE["sg-slot"](st, ui, { value: "chestrig", dataset: { slot: "rig" } });
  let w = again(st);
  let t = w.survivors[0];
  ui.gearEdit = { i: 0, sel: null, msg: "" };
  check(t.gear.backpack.key === "hikingpack" && t.gear.rig.key === "chestrig" && t.pockets[0] && t.pockets[0].key === "phone", "the bag and the rig on, the phone still in its pocket");
  // Pick a spot, then Add: it goes there, or is refused with why.
  SG_ACTIONS["sg-cell"](w, ui, { w: "pack", i: 3 });
  check(ui.gearEdit.sel && ui.gearEdit.sel.where === "pack" && ui.gearEdit.sel.i === 3, "an empty pack slot picked");
  SG_CHANGE["sg-item-add"](w, ui, { value: "laptop", dataset: {} });
  check(t.startGear.carry.pack[3] === "laptop" && !ui.gearEdit.sel, "Add: the laptop in that pack slot");
  SG_ACTIONS["sg-cell"](w, ui, { w: "pouch", i: 0 });
  check(SG_CHANGE["sg-item-add"](w, ui, { value: "novel", dataset: {} }) === false && /pouch does not take/.test(ui.gearEdit.msg), `a novel in a rifle-magazine pouch: refused ("${ui.gearEdit.msg}")`);
  check(SG_CHANGE["sg-item-add"](w, ui, { value: "mag_stanag_30", dataset: {} }) === true && t.startGear.carry.pouch[0] === "mag_stanag_30", "a rifle magazine in it: yes");
  ui.gearEdit.sel = null;
  SG_CHANGE["sg-item-add"](w, ui, { value: "frag", dataset: {} });
  const fragAt = carryList(t.startGear).find((x) => x.key === "frag");
  check(fragAt && fragAt.where === "pouch" && GEAR.chestrig.pouches[fragAt.i] === "grenade", "no spot picked: a grenade to the grenade pouch");
  // Move and swap.
  SG_ACTIONS["sg-cell"](w, ui, { w: "pack", i: 3 }); // pick up the laptop
  check(SG_ACTIONS["sg-cell"](w, ui, { w: "pocket", i: 1 }) === false && /too big for a pocket/.test(ui.gearEdit.msg) && t.startGear.carry.pack[3] === "laptop", `moving the laptop to a pocket: refused ("${ui.gearEdit.msg}")`);
  check(SG_ACTIONS["sg-cell"](w, ui, { w: "pack", i: 0 }) === true && t.startGear.carry.pack[0] === "laptop" && !t.startGear.carry.pack[3], "moved to another pack slot");
  SG_ACTIONS["sg-cell"](w, ui, { w: "pocket", i: 0 }); // the phone
  const swap = SG_ACTIONS["sg-cell"](w, ui, { w: "pack", i: 0 });
  check(swap === false && /too big for a pocket/.test(ui.gearEdit.msg) && t.startGear.carry.pocket[0] === "phone" && t.startGear.carry.pack[0] === "laptop", "the phone onto the laptop: a swap only if both fit (the laptop does not go in a pocket)");
  ui.gearEdit.sel = null;
  SG_ACTIONS["sg-cell"](w, ui, { w: "pocket", i: 0 });
  SG_CHANGE["sg-item-add"](w, ui, { value: "lighters", dataset: {} }); // (a spot with something in it picked: Add puts it where it fits)
  SG_ACTIONS["sg-cell"](w, ui, { w: "pocket", i: 0 });
  const lit = carryList(t.startGear).find((x) => x.key === "lighters");
  ui.gearEdit.sel = { where: "pocket", i: 0 };
  check(SG_ACTIONS["sg-cell"](w, ui, { w: lit.where, i: lit.i }) === true && t.startGear.carry.pocket[0] === "lighters" && t.startGear.carry[lit.where][lit.i] === "phone", "two small things: swapped");
  ui.gearEdit.sel = null;
  SG_ACTIONS["sg-cell"](w, ui, { w: "pack", i: 0 });
  SG_ACTIONS["sg-cell"](w, ui, { w: "pack", i: 5 });
  SG_ACTIONS["sg-cell"](w, ui, { w: "pocket", i: 0 });
  SG_ACTIONS["sg-cell"](w, ui, { w: "pocket", i: 2 });
  check(t.startGear.carry.pack[5] === "laptop" && t.startGear.carry.pocket[2] === "lighters", "pick up, put down: things go exactly where clicked");
  check(SG_ACTIONS["sg-cell-del"](w, ui, { w: "pocket", i: 2 }) === true && !carryList(t.startGear).some((x) => x.key === "lighters"), "× takes a thing out");
  // Their price.
  const B = pricePerson(w, t);
  check(B.carried === itemPoints("laptop") + itemPoints("mag_stanag_30") + itemPoints("frag") + itemPoints("phone") && B.gear === itemPoints("hikingpack") + itemPoints("chestrig"), `priced: carried ${B.carried}, worn ${B.gear}`);
  // A smaller bag: what no longer fits moves, or is taken out with a word.
  for (let k = 0; k < 9; k++) SG_CHANGE["sg-item-add"](w, ui, { value: "novel", dataset: {} });
  SG_CHANGE["sg-slot"](w, ui, { value: "slingbag", dataset: { slot: "backpack" } });
  const left = carryList(t.startGear).filter((x) => x.where === "pack").length;
  check(left <= GEAR.slingbag.slots && /taken out/.test(ui.gearEdit.msg), `a sling bag (${GEAR.slingbag.slots} slots): ${left} left in it, the rest taken out ("${ui.gearEdit.msg}")`);
  // Built: exactly as placed.
  const z = again(w);
  const u = z.survivors[0];
  const place = (list) => (list || []).map((x) => (x ? x.key : "")).join(",");
  check(place(packOf(u)).replace(/,+$/, "") === (t.startGear.carry.pack || []).map((k) => k || "").join(",").replace(/,+$/, "") && place(rigPouches(u)).startsWith((t.startGear.carry.pouch || []).map((k) => k || "").join(",")), `built as placed: pack ${place(packOf(u))}`);
  const spareMags = again(z);
  ui.gearEdit = { i: 0, sel: null, msg: "" };
  SG_CHANGE["sg-slot"](spareMags, ui, { value: "ar", dataset: { slot: "weapon" } });
  const sm = again(spareMags);
  ui.gearEdit = { i: 0, sel: null, msg: "" };
  const n0 = carryList(sm.survivors[0].startGear).filter((x) => x.key === "mag_stanag_30").length;
  check(keysOn(sm.survivors[0]).filter((k) => k === "mag_stanag_30").length === n0, "under points a picked gun brings no free magazines");
  SG_ACTIONS["sg-mags"](sm, ui);
  check(carryList(sm.survivors[0].startGear).filter((x) => x.key === "mag_stanag_30").length === n0 + 2, "+ 2 spare magazines puts two where they fit (paid for)");
}

section("The vehicle's back");
{
  // A normal start: the hub's pickup, unloaded on day 1. Its back is the vehicle's own (sim/startfleet.js): priced against
  // its point limit, on nobody's points.
  const st = blankWorld(42);
  const ui = UI();
  ui.fleetEdit = { i: 0, msg: "" };
  const info = startVehicleInfo(st);
  check(info && info.type === "truck" && !info.hard && info.room === 650, `normal: the hub's ${info && info.name}, ${info && info.room} kg`);
  SG_CHANGE["sg-trunk-add"](st, ui, { value: "ar", dataset: {} });
  SG_CHANGE["sg-trunk-sup"](st, ui, { value: "30", dataset: { k: "food" } });
  SG_CHANGE["sg-trunk-sup"](st, ui, { value: "4", dataset: { k: "meds" } });
  const V = ui.fleet[0].load;
  check(V && V.items.join() === "ar" && V.supplies.food === 30 && JSON.stringify(st.fleet[0].load) === JSON.stringify(V), "the pickup's back: on the screen's fleet and the world's");
  check(vehiclePoints(V) === loosePoints("ar") + suppliesPoints({ food: 30, meds: 4 }) && loosePoints("ar") === itemPoints("ar") + suppliesPoints({ a_556_fmj: 30 }) && st.survivors.every((s) => pricePerson(st, s).total === 0), `priced against its limit, the rifle with its loaded magazine (${vehiclePoints(V)}), nobody's points`);
  const base = createWorld({ seed: 42, factionCount: 5, crewRoll: ROLL });
  const b = again(st, { fleet: ui.fleet });
  check(b.bases[0].armory.some((it) => it.key === "ar") && Math.abs(food(b.bases[0]) - food(base.bases[0]) - 30) < 1.01 && b.bases[0].stock.meds === base.bases[0].stock.meds + 4, "built: the rifle in the hub's armory, the food and meds in its stores");
  SG_CHANGE["sg-trunk-sup"](b, ui, { value: "999", dataset: { k: "fuel" } });
  check((ui.fleet[0].load.supplies.fuel || 0) === 40, "a supply held to its cap");
  check(SG_ACTIONS["sg-trunk-dice"](b, ui) === false && /come empty/.test(ui.fleetEdit.msg), "normal: the dice's back is empty, it says so");
  // Hardcore: the car the team flees in.
  const hc = blankWorld(42, { mode: "hardcore" });
  const hi = startVehicleInfo(hc);
  check(hi && hi.hard && hi.room > 0 && hi.room < 900, `Hardcore: the ${hi.name}, ${hi.room} kg of room with everyone in it`);
  const dice = hc.survivors.find((s) => s.diceTrunk).diceTrunk;
  check(backOf(hc.parties[0]).length === dice.items.length && hc.fleet[0].load === null, `as rolled: the dice's back (${dice.items.join(", ") || "no things"}; ${JSON.stringify(dice.supplies)})`);
  const uh = UI();
  uh.fleetEdit = { i: 0, msg: "" };
  check(SG_ACTIONS["sg-trunk-clear"](hc, uh) === "fleet" && uh.fleet[0].load && !uh.fleet[0].load.items.length, "Empty: an empty back of its own");
  const h2 = again(hc, { fleet: uh.fleet });
  const ownerAt = (w) => w.survivors.findIndex((x) => x.id === w.hardcore.start.carOwner);
  check(backOf(h2.parties[0]).length === 0 && ownerAt(h2) === ownerAt(hc), "the car's back is exactly what was set (nothing), the same owner");
  check(SG_ACTIONS["sg-trunk-dice"](h2, uh) === "fleet" && uh.fleet[0].load === null, "As rolled: the dice's back again");
  // Room.
  uh.fleet[0].limit = h2.fleet[0].limit = 1000;
  for (let k = 0; k < 20; k++) SG_CHANGE["sg-trunk-add"](h2, uh, { value: "sandbags", dataset: {} });
  const kg = trunkKg(uh.fleet[0].load);
  check(kg <= startVehicleInfo(h2).room && uh.fleet[0].load.items.length <= 16 && /No room|At most/.test(uh.fleetEdit.msg), `the back fills up to its room (${kg} / ${startVehicleInfo(h2).room} kg): "${uh.fleetEdit.msg}"`);
}

section("A custom background under points");
{
  const lib = [presetToCustom("veteran", "c_1")];
  setCustomLibrary(lib);
  for (const mode of ["normal", "hardcore"]) {
    const st = world(42, { mode, crew: blankCrew(createWorld({ seed: 42, factionCount: 5, crewRoll: ROLL, mode })), customBackgrounds: lib });
    const crew = crewWithBackground(st, st.survivors[1].id, "c_1");
    check(crew[1].background === "c_1" && crew[1].points && !crew[1].startGear, `${mode}: picking it drops their picks, to load what it gives`);
    const a = createWorld({ seed: 42, factionCount: 5, crewRoll: ROLL, mode, crew, customBackgrounds: lib });
    a.pointsMax = CUSTOM_POINTS.DEF;
    loadDice(a, a.survivors[1]); // main.js pointsLoad
    const b = again(a, { customBackgrounds: lib });
    const s = b.survivors[1], A = b.customBackgrounds.c_1;
    check(s.background === "c_1" && Object.entries(A.skills).every(([k, v]) => s.skills[k] >= v) && A.traits.every((t) => s.traits.includes(t)), `${mode}: its skills and traits on them (${s.traits.join(", ")})`);
    check(Object.values(A.gear).every((k) => START_GEAR.SLOTS.some((slot) => s.gear[slot] && s.gear[slot].key === k)), `${mode}: its kit on them`);
    const B = pricePerson(b, s);
    check(B.extra === suppliesPoints(A.supplies) + (mode === "normal" && A.car.type ? CUSTOM_POINTS.VEHICLE[A.car.type] ?? 20 : 0) + (mode === "normal" ? bgCarBack(A) : 0) && B.total > 30, `${mode}: priced: ${B.total} (${B.lines.join(", ")})`);
    if (mode === "normal") check(!b.bases[0].armory.some((it) => Object.values(A.gear).includes(it.key) && it.key !== "knife"), "normal: the background's kit is not in the armory twice");
  }
  setCustomLibrary([]);
  const st0 = world(5);
  const ui0 = { started: false, ironman: false };
  BG_ACTIONS["bg-open"](st0, ui0);
  setCustomLibrary([{ ...presetToCustom("nurse", "c_2"), traits: ["tough", "loud"], traitTier: { tough: 3, loud: 2 } }]);
  ui0.bgEditor.sel = "c_2";
  const html = backgroundEditor(st0, ui0);
  check(/Tough III/.test(html) && /data-action="bg-tier"/.test(html) && /traits \+5/.test(html) && /Total \d+ points/.test(html), "the backgrounds editor: tiers picked, and what it comes to under Customize");
  BG_ACTIONS["bg-tier"](st0, ui0, { k: "tough", d: -1 });
  check(/Tough II/.test(backgroundEditor(st0, ui0)), "a tier down in the editor");
  setCustomLibrary([]);
}

section("Every rebuild keeps the picks and the points");
{
  const st = blankWorld(42);
  const ui = UI();
  ui.gearEdit = { i: 1, sel: null, msg: "" };
  const s = st.survivors[1];
  s.skills.shooting = 12; s.skills.medicine = 6;
  s.traits = ["brave", "loud"]; s.traitTier = { brave: 2 };
  SG_CHANGE["sg-slot"](st, ui, { value: "huntrifle", dataset: { slot: "weapon" } });
  SG_CHANGE["sg-item-add"](st, ui, { value: "phone", dataset: {} });
  ui.fleetEdit = { i: 0, msg: "" };
  SG_CHANGE["sg-trunk-add"](st, ui, { value: "binoculars", dataset: {} });
  ui.fleetEdit = null;
  const want = pricePerson(st, s).total;
  const ok = (w) => { const x = w.survivors[1]; return x && x.startPoints && x.skills.shooting === 12 && x.traits.join() === "brave,loud" && traitTier(x, "brave") === 2 && x.gear.weapon && x.gear.weapon.key === "huntrifle" && keysOn(x).includes("phone") && pricePerson(w, x).total === want; };
  let cur = again(st);
  check(ok(cur), `rebuilt on the same seed: the picks and ${want} points`);
  const steps = [["another seed", { seed: 77 }], ["Large", { seed: 77, size: "large" }], ["2 groups", { seed: 77, factionCount: 2 }], ["3 hives", { seed: 77, hives: 3 }],
    ["Hardcore", { seed: 77, mode: "hardcore" }], ["Hardcore, 2 people", { seed: 77, mode: "hardcore", startPeople: 2 }], ["Normal again", { seed: 77, mode: "normal" }]];
  for (const [what, opts] of steps) {
    const w = createWorld({ factionCount: 5, crewRoll: ROLL, ...opts, crew: crewSnapshot(cur), fleet: ui.fleet }); // the starting vehicle's back: the screen's (main.js ui.fleet)
    w.pointsMax = CUSTOM_POINTS.DEF;
    const x = w.survivors[1];
    const keep = ok(w) || (opts.mode === "hardcore" && x && x.startPoints && x.skills.shooting === 12 && traitTier(x, "brave") === 2 && x.gear.weapon.key === "huntrifle" && keysOn(x).includes("phone"));
    check(keep, `${what}: the picks on them${x ? ` (${pricePerson(w, x).total} points)` : ""}`);
    check(w.fleet[0].load && w.fleet[0].load.items.join() === "binoculars", `${what}: the vehicle's back too`);
    cur = w;
  }
  // A background picked for someone else: theirs stay.
  const bg = createWorld({ seed: 77, factionCount: 5, crewRoll: ROLL, crew: crewWithBackground(cur, cur.survivors[0].id, "nurse") });
  bg.pointsMax = CUSTOM_POINTS.DEF;
  check(ok(bg) && bg.survivors[0].background === "nurse", "a background picked for another colonist: theirs stay");
}

section("Ironman, the seed's world, the screen");
{
  const st = blankWorld(42);
  check(crewCustomized(st), "a crew on points counts as customized (Start refuses it in an Ironman run)");
  const iron = createWorld({ seed: 42, factionCount: 5, crew: ironmanCrew(st) });
  check(!crewCustomized(iron) && iron.survivors.every((s) => !s.startPoints && pricePerson(iron, s).total > 0), "the Ironman crew: back as rolled");
  const ui = { ...UI(), ironman: true };
  SG_ACTIONS["sg-open"](st, ui, { id: st.survivors[0].id });
  check(!ui.gearEdit && SG_ACTIONS["sg-dice"](st, ui, { i: 0 }) === false, "Ironman: no gear window, no Start from the dice");
  LOOK_ACTIONS["nr-trait"](st, ui, { id: st.survivors[0].id, k: "tough" });
  check(!st.survivors[0].traits.length, "and no traits picked");
  check(/ui\.ironman \|\| ui\.started\) \{ el\.checked = false; return; \}/.test(mainSrc) && /ui\.freeEdit = false;/.test(mainSrc), "main.js: Customize cannot be ticked with Ironman, and ticking Ironman turns it off");
  // The seed's map and groups stay put under Customize (the crew's dice are its own).
  const fp = (w) => JSON.stringify({ rng: w.rng.state, map: w.tiles.map((t) => t.terrain + (t.loc ? t.loc.type : "")).join(""), groups: w.factions.map((f) => [f.name, f.type, f.strength]), hub: w.bases[0] ? w.bases[0].tile : null, hives: (w.hives || []).map((h) => h.tile) });
  for (const mode of ["normal", "hardcore"]) {
    const plain = createWorld({ seed: 42, factionCount: 5, crewRoll: ROLL, mode });
    const pts = blankWorld(42, { mode });
    const d = SG_ACTIONS["sg-dice"](pts, UI(), { i: 0 }) && again(pts);
    check(fp(plain) === fp(pts) && fp(plain) === fp(d), `${mode}: the same map, groups, hives and the world's dice whatever the crew is built of`);
  }
  // The screen.
  const html = newRunScreen(st, UI());
  check(new RegExp(`data-action="nr-points"[^>]*value="${CUSTOM_POINTS.DEF}"`).test(html) && (html.match(/class="ptsbar/g) || []).length === 6 && (html.match(/data-action="sg-dice"/g) || []).length === 6 && (html.match(/data-action="sg-blank"/g) || []).length === 6, "Customize: Points each, a points bar, Start from the dice and Clear on every card");
  const off = newRunScreen(createWorld({ seed: 42, factionCount: 5 }), { ...UI(), freeEdit: false });
  check(!/data-action="nr-points"/.test(off) && !/data-action="nr-ownpoints"/.test(off) && !/data-action="bg-open"/.test(off) && !/class="ptsbar/.test(off) && /data-action="nr-skills"/.test(off), "Customize off: the old screen (Points each, their own points and Backgrounds… hidden, the skill-point pool, Randomize skills)");
  check(/class="chip trait t-(good|bad|neutral)"/.test(off), "the cards' trait chips coloured by kind");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  check(/--t-good:/.test(css) && /--t-bad:/.test(css) && /--t-neutral:/.test(css) && /:root\.cb \{ --t-good:/.test(css) && /\.chip\.trait\.t-bad/.test(css), "the colours are palette tokens, with the colour-blind palette's own");
  const uiDir = new URL("../src/ui/", import.meta.url);
  const files = ["people.js", "roster.js", "ui.js", "expedition.js", "family.js", "prisoners.js", "newgame.js", "teamform.js"];
  const raw = files.filter((f) => /<span class="chip trait"\$\{/.test(readFileSync(new URL(f, uiDir), "utf8")));
  check(!raw.length, `every screen's trait chips come from ui/traitpick.js (old chips left: ${raw.join(", ") || "none"})`);
  const s = st.survivors[0];
  s.traits = ["tough", "loud", "greedy"]; s.traitTier = { tough: 2 };
  const chips = traitChips(s);
  check(/t-good[^>]*>Tough II</.test(chips) && /t-bad[^>]*>Loud I</.test(chips) && /t-neutral[^>]*>Greedy</.test(chips) && /35% less/.test(chips), `chips: ${chips.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`);
}

section("Start, save and load, the first days");
{
  for (const mode of ["normal", "hardcore"]) {
    const st = blankWorld(42, { mode });
    const ui = UI();
    st.survivors.forEach((s, i) => SG_ACTIONS["sg-dice"](st, ui, { i }));
    ui.gearEdit = { i: 0, sel: null, msg: "" };
    SG_CHANGE["sg-trunk-sup"](st, ui, { value: "10", dataset: { k: "water" } });
    const w = again(st);
    w.survivors[0].traits = ["tough", "nearsighted"]; w.survivors[0].traitTier = { tough: 3, nearsighted: 2 };
    clearStartGear(w); // main.js begin
    w.started = true;
    check(w.survivors.every((s) => !s.startPoints && !s.startVehicle && !s.diceKit && !s.diceRoll), `${mode}: Start leaves nothing of the screen on them`);
    const text = saveToString(w, { dropCards: true });
    const ld = loadFromString(text);
    check(saveToString(ld) === text && JSON.stringify(ld.survivors[0].traitTier) === '{"tough":3,"nearsighted":2}', `${mode}: a save and load round trip, the tiers kept`);
    setAutopilot(ld, true, "balanced");
    let err = null;
    try { while (day(ld) <= 4 && !ld.gameOver) { autopilotResolve(ld); tickHour(ld); } } catch (e) { err = e; }
    check(!err, `${mode}: four days under the autopilot${err ? `: ${err.stack.split("\n").slice(0, 3).join(" | ")}` : ""}`);
  }
}

section("One colonist's own points (2026-10-19): theirs alone; Points each again puts everyone back on it");
for (const mode of ["normal", "hardcore"]) {
  const st = world(42, { mode, crew: blankCrew(world(42, { mode })) });
  const ui = { started: false, freeEdit: true, ironman: false, worldSize: "normal", factionCount: 5, nrMsg: "" };
  const [a, b] = st.survivors;
  check(maxFor(st, a) === CUSTOM_POINTS.DEF && maxFor(st, b) === CUSTOM_POINTS.DEF, `${mode}: everyone on Points each to begin with`);
  LOOK_CHANGE_ACTIONS["nr-ownpoints"](st, ui, { value: "140", dataset: { id: String(a.id) } });
  check(a.ownMax === 140 && maxFor(st, a) === 140 && pricePerson(st, a).max === 140 && pricePerson(st, b).max === CUSTOM_POINTS.DEF && b.ownMax === undefined, `${mode}: their own max is theirs; the others keep the crew's`);
  a.skills.shooting = 20; a.skills.medicine = 20; a.skills.scouting = 20; a.skills.stealth = 15; // 125 points of skills
  b.skills = { ...a.skills };
  check(!overBudget(st).some((x) => x.s === a) && overBudget(st).some((x) => x.s === b), `${mode}: priced against each one's own max (${pricePerson(st, a).total}/${pricePerson(st, a).max}, ${pricePerson(st, b).total}/${pricePerson(st, b).max})`);
  const html = newRunScreen(st, ui);
  check(new RegExp(`data-action="nr-ownpoints" data-id="${a.id}" value="140"`).test(html) && new RegExp(`data-action="nr-ownpoints" data-id="${b.id}" value="${CUSTOM_POINTS.DEF}"`).test(html) && /own; crew/.test(html), `${mode}: each card shows its own max`);
  const re = createWorld({ seed: 42, factionCount: 5, crewRoll: ROLL, mode, crew: crewSnapshot(st) });
  re.pointsMax = st.pointsMax;
  check(re.survivors[0].ownMax === 140 && re.survivors[1].ownMax === undefined, `${mode}: kept through a rebuild`);
  LOOK_CHANGE_ACTIONS["nr-ownpoints"](st, { ...ui, freeEdit: false }, { value: "10", dataset: { id: String(b.id) } });
  check(b.ownMax === undefined, `${mode}: not outside Customize`);
  // main.js nr-points: Points each set again, every colonist back on it.
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  check(/"nr-points":[\s\S]{0,240}delete s\.ownMax/.test(main), "main.js: Points each clears everyone's own max");
  for (const s of st.survivors) delete s.ownMax;
  check(st.survivors.every((s) => maxFor(st, s) === st.pointsMax), `${mode}: then everyone is on Points each again`);
  clearStartGear(st);
  check(st.survivors.every((s) => !("ownMax" in s)), `${mode}: Start takes it off`);
}

section("A normal start's crew: 1–8 at the hub (six by default)");
{
  const six = createWorld({ seed: 42, factionCount: 5 }), dflt = createWorld({ seed: 42, factionCount: 5, startPeople: 6 });
  check(six.survivors.length === 6 && JSON.stringify(six.survivors.map((s) => [s.name, s.skills, s.gear.weapon && s.gear.weapon.key])) === JSON.stringify(dflt.survivors.map((s) => [s.name, s.skills, s.gear.weapon && s.gear.weapon.key])), "six when left out, the same world as 6");
  for (const n of [1, 4, 7, 8]) {
    const w = createWorld({ seed: 42, factionCount: 5, startPeople: n });
    check(w.survivors.length === n && w.startPeople === n && w.survivors.every((s) => s.gear.weapon && s.location && s.location.kind === "base") && w.survivors.filter((s) => s.leader).length === 1, `${n} at the hub, each armed, one leader`);
    check(n > 6 ? w.bases[0].crowdNote && w.bases[0].crowdNote.over === n - 6 : !w.bases[0].crowdNote, `${n}: the hub's six beds (${n > 6 ? `${n - 6} over` : "room for all"})`);
    assignStartingRoles(w);
    let err = null;
    try { for (let h = 0; h < 48; h++) tickHour(w); } catch (e) { err = e; }
    check(!err, `${n}: two days run${err ? `: ${err.message}` : ""}`);
  }
  check(createWorld({ seed: 42, factionCount: 5, startPeople: 12 }).survivors.length === 8 && createWorld({ seed: 42, factionCount: 5, startPeople: 0 }).survivors.length === 1, "out of range: clamped to 1–8");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
