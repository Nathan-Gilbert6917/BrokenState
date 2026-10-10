// Custom backgrounds and Customize on the new-run screen (2026-10-07; sim/custombg.js, sim/hardcore-start.js,
// ui/backgrounds.js, ui/newgame.js): not for Ironman.
//   - a custom background is made safe (clamps, slots, Brave or Coward, unknown keys dropped);
//   - picked for a hardcore colonist it gives exactly what it says: the skill bumps on their rolled skills, its traits,
//     what they wear, hold and carry, the supplies on top of the team's clamped days, the car (odds, kind, its back);
//   - a preset can be picked too (no two alike among the drawn ones), and no pick is the same start as before;
//   - every preset converts to a custom one that builds; a save keeps the world's copy;
//   - a normal start (2026-10-07): the six have backgrounds with dice of their own (the map, the groups and every
//     skill total as before), a preset or a custom one can be picked, a custom one's kit, supplies and car go to them
//     and the hub;
//   - the new-run screen: Customize shows the background select and the trait picker, sets skills past the budget;
//     Ironman locks all of it (the box, Backgrounds…, the skill buttons) and the crew counts as customized after.
// Usage: node tools/custombgtest.js
import { setRounds, totalRounds } from "../src/sim/ammo.js"; // rounds by calibre
import { createWorld } from "../src/sim/world.js";
import { GEAR, SKILLS, TRAITS, TRAIT_CLASH } from "../src/sim/data.js";
import { CUSTOM_BG, sanitizeBackground, sanitizeLibrary, isCustomBg, blankBackground } from "../src/sim/custombg.js";
import { HC_START, archetypeOf, backgroundInfo, pickArchetypes, NORMAL_BG, keepSkillTotal } from "../src/sim/hardcore-start.js";
import { Rng } from "../src/sim/rng.js";
import { vehiclesAtBase } from "../src/sim/vehicles.js";
import { partyMembers, partyTile } from "../src/sim/parties.js";
import { partyVehicle } from "../src/sim/vehicles.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { newRunScreen, LOOK_ACTIONS, crewSnapshot, ironmanCrew, crewCustomized, crewWithBackground } from "../src/ui/newgame.js";
import { backgroundEditor, presetToCustom, fitCheck, setCustomLibrary, customLibrary, BG_ACTIONS, BG_CHANGE } from "../src/ui/backgrounds.js";
import { packOf } from "../src/sim/inventory.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log(`FAIL ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
const hc = (seed, extra = {}) => createWorld({ seed, factionCount: 5, mode: "hardcore", ...extra });

section("A custom background is made safe");
{
  const d = sanitizeBackground({
    id: "c_7", name: "  A   very long name that goes on and on past thirty  ", blurb: "x".repeat(200),
    skills: { medicine: 99, shooting: -4, flying: 5, scouting: 3.6 },
    traits: ["brave", "coward", "tough", "lucky", "medic", "nope", "prepper"],
    gear: { weapon: "vest", armor: "vest", backpack: "duffle", tool: "flashlight", head: "nothing" },
    items: ["phone", "bicycle", "sandbags", "duffle", "lighters", ...Array(20).fill("candy")],
    supplies: { food: 1000, water: -3, ammo: 50.4, fuel: 9 },
    car: { odds: 99, type: "tank", trunk: { scrap: 999, food: 5, gold: 3 }, items: ["bicycle", "sandbags", "nope"] },
  });
  check(d.id === "c_7" && d.name.length <= CUSTOM_BG.NAME && d.blurb.length <= CUSTOM_BG.BLURB && !/\s{2}/.test(d.name), `name and blurb trimmed (${d.name})`);
  check(d.skills.medicine === CUSTOM_BG.SKILL && !("shooting" in d.skills) && !("flying" in d.skills) && d.skills.scouting === 4, `skills clamped 0–${CUSTOM_BG.SKILL}, unknown dropped (${JSON.stringify(d.skills)})`);
  check(d.traits.join() === "brave,tough,lucky", `traits: at most ${CUSTOM_BG.TRAITS}, Brave not with Coward, no unknown or background-only trait (${d.traits.join()})`);
  check(!d.gear.weapon && d.gear.armor === "vest" && d.gear.backpack === "duffle" && d.gear.tool === "flashlight" && !d.gear.head, `gear only in its own slot (${JSON.stringify(d.gear)})`);
  check(!d.items.includes("bicycle") && !d.items.includes("sandbags") && !d.items.includes("duffle") && d.items.length === CUSTOM_BG.ITEMS, `carried: no bikes, nothing bulky, no packs, at most ${CUSTOM_BG.ITEMS}`);
  check(d.supplies.food === CUSTOM_BG.SUPPLY.food && !("water" in d.supplies) && !("ammo" in d.supplies) && totalRounds(d.supplies) === 50 && !("fuel" in d.supplies), `supplies clamped, the old generic ammo as rounds by calibre (${JSON.stringify(d.supplies)})`);
  check(d.car.odds === CUSTOM_BG.CAR_ODDS && d.car.type === null && d.car.trunk.scrap === CUSTOM_BG.TRUNK.scrap && d.car.trunk.food === 5 && !("gold" in d.car.trunk) && d.car.items.join() === "bicycle,sandbags", `the car clamped (${JSON.stringify(d.car)})`);
  const lib = sanitizeLibrary([{ id: "c_1", name: "A" }, { id: "nurse", name: "B" }, { id: "c_1", name: "dupe" }, null, ...Array.from({ length: 40 }, (_, i) => ({ id: `c_${i + 2}` }))]);
  check(Object.keys(lib).length === CUSTOM_BG.MAX && lib.c_1.name === "A" && !lib.nurse && Object.keys(lib).every(isCustomBg), `the list: prefixed ids, no repeats, at most ${CUSTOM_BG.MAX}`);
}

section("Picked for a hardcore colonist, a custom background gives exactly what it says");
const MEDIC = {
  id: "c_1", name: "Field medic", blurb: "patched up a platoon",
  skills: { medicine: 6, scouting: 2 }, traits: ["tough", "keeneye"],
  gear: { weapon: "pistol", armor: "vest", backpack: "hikingpack", tool: "bandagekit", head: "milhelmet" },
  items: ["surgkit", "flashlight", "lighters", "medbook", "phone", "candy", "binoculars", "stove"],
  supplies: { food: 7, water: 6, ammo: 24, meds: 4 },
  car: { odds: 10, type: "hummer", trunk: { fuel: 12, meds: 3, scrap: 5 }, items: ["sandbags", "fishrod"] },
};
const lib = { c_1: MEDIC, c_2: { ...blankBackground("c_2"), name: "Walker", car: { odds: 0, trunk: {}, items: [] } } };
{
  const roll = 777;
  const base = hc(42, { crewRoll: roll });
  const crew = [{ background: "c_1", custom: true }, {}, {}];
  const a = hc(42, { crewRoll: roll, crew, customBackgrounds: lib });
  const s = a.survivors[0], b0 = base.survivors[0];
  check(s.background === "c_1" && s.bgPicked && s.startCustom && isCustomBg(s.background), "the first colonist has it, picked and marked custom");
  check(!!a.customBackgrounds && a.customBackgrounds.c_1.name === "Field medic" && archetypeOf(a, "c_1").custom, "the world keeps its own copy");
  check(backgroundInfo(a, "c_1").name === "Field medic" && backgroundInfo(a, "c_1").custom && backgroundInfo(a, "nurse").name === "Nurse" && !backgroundInfo(a, "c_99"), "backgroundInfo: custom, preset, missing");
  // The base skills are the crew roll's (the same people before the background): background bumps on top.
  const baseSkills = { ...b0.skills };
  for (const [k, [lo, hi]] of Object.entries((HC_START.ARCHETYPES[b0.background] || {}).skills || {})) baseSkills[k] = null; // unknown rolled bump
  check(SKILLS.every((k) => baseSkills[k] == null || s.skills[k] === Math.min(20, baseSkills[k] + (MEDIC.skills[k] || 0))), `skills: their own + the bumps (${JSON.stringify(s.skills)})`);
  check(s.traits[0] === "tough" && s.traits[1] === "keeneye" && s.traits.length <= 3 && new Set(s.traits).size === s.traits.length, `its traits first (${s.traits.join()})`);
  check(s.gear.weapon.key === "pistol" && s.gear.armor.key === "vest" && s.gear.backpack.key === "hikingpack" && s.gear.tool.key === "bandagekit" && s.gear.head.key === "milhelmet", "what they wear and hold");
  const carried = [...s.pockets, ...(packOf(s) || [])].filter(Boolean).map((it) => it.key).sort();
  check(carried.join() === [...MEDIC.items].sort().join(), `what they carry, pockets and bag (${carried.join()})`);
  check(s.pockets.every((it) => !it || GEAR[it.key].small), "only small things in the pockets");
  const fit = fitCheck(sanitizeBackground(MEDIC));
  check(fit.left.length === 0 && fit.kg > 5, `the editor says it all fits (${fit.kg} kg)`);
  const p = roadTeam(a), pb = roadTeam(base);
  const v = partyVehicle(a, p);
  // Odds 10 against the others' ~1: almost always theirs; when it is, the kind and the back they set.
  let mine = 0, exact = true;
  for (const seed of [42, 3, 9, 27, 81, 243, 729, 11, 13, 17]) {
    const w = hc(seed, { crewRoll: seed * 7, crew, customBackgrounds: lib });
    if (w.hardcore.start.carOwner !== w.survivors[0].id) continue;
    mine++;
    const q = roadTeam(w), car = partyVehicle(w, q);
    if (!(car.type === "hummer" && q.cargo.supplies.fuel === 12 && q.cargo.supplies.meds === 3 && q.cargo.supplies.scrap === 5 && q.cargo.gear.map((g) => g.key).sort().join() === "fishrod,sandbags")) exact = false;
  }
  check(mine >= 6, `odds ${MEDIC.car.odds}: the car is theirs most of the time (${mine} of 10)`);
  check(mine > 0 && exact, "and then the kind and the back they set (a Hummer, 12 fuel, 3 meds, 5 scrap, sandbags and a rod)");
  check(p.supplies.food >= MEDIC.supplies.food + HC_START.TEAM_MIN * 2 && p.supplies.food <= MEDIC.supplies.food + HC_START.TEAM_MAX * 2 + 2 + 15, `food: theirs on top of the others' clamped days (${p.supplies.food})`);
  check(totalRounds(p.supplies) >= MEDIC.supplies.ammo && p.supplies.meds >= MEDIC.supplies.meds, `ammo and meds on top (${totalRounds(p.supplies)}, ${p.supplies.meds})`); // ammo.js: their rounds by calibre
  check(a.hardcore.start.grabbed.some((l) => /field medic, patched up a platoon/.test(l)) && a.cards[0].text.includes("field medic"), "the orders card names the background");
  check(partyTile(p) === partyTile(pb), "same seed, same spawn");
  // Odds 0: never theirs.
  let never = true;
  for (const seed of [3, 9, 27, 81, 243]) {
    const w = hc(seed, { crewRoll: seed, crew: [{ background: "c_2", custom: true }, {}, {}], customBackgrounds: lib });
    if (w.hardcore.start.carOwner === w.survivors[0].id) never = false;
  }
  check(never, "odds 0: the car is never theirs");
  // A save keeps the world's copy and the picks.
  a.cards.length = 0;
  const ld = loadFromString(saveToString(a));
  check(ld.customBackgrounds && ld.customBackgrounds.c_1.name === "Field medic" && ld.survivors[0].background === "c_1" && ld.survivors[0].bgPicked && backgroundInfo(ld, "c_1").custom, "a save keeps the world's copy and the pick");
  // A world made without the list, or a pick it does not know: the dice.
  const lost = hc(42, { crewRoll: roll, crew: [{ background: "c_9" }, {}, {}], customBackgrounds: lib });
  check(lost.survivors[0].background === base.survivors[0].background && !lost.survivors[0].bgPicked, "an unknown pick falls back to the dice");
}

section("A preset can be picked; no picks is the same start as before");
{
  const roll = 4321;
  const plain = hc(77, { crewRoll: roll }), withLib = hc(77, { crewRoll: roll, customBackgrounds: lib });
  const sig = (st) => JSON.stringify([st.survivors.map((s) => [s.name, s.background, s.skills, s.traits, s.gear, s.pockets]), roadTeam(st).supplies, roadTeam(st).cargo, partyTile(roadTeam(st))]);
  check(sig(plain) === sig(withLib), "the list alone changes nothing");
  const noLib = hc(77, {});
  check(!noLib.customBackgrounds, "a world without a list keeps none");
  for (const key of Object.keys(HC_START.ARCHETYPES)) {
    const w = hc(77, { crewRoll: roll, crew: [{}, { background: key }, {}] });
    const kinds = w.survivors.map((s) => s.background);
    check(kinds[1] === key && w.survivors[1].bgPicked && new Set(kinds).size === 3, `${key} picked for the second: ${kinds.join(", ")}`);
  }
  // Two picks may match; the drawn one does not repeat them.
  const st = { rng: plain.rng };
  let ok = true;
  for (let i = 0; i < 200; i++) {
    const k = pickArchetypes(st, 4, ["nurse", "nurse", null, null]);
    if (k[0] !== "nurse" || k[1] !== "nurse" || k.slice(2).includes("nurse") || k[2] === k[3]) ok = false;
  }
  check(ok, "two picks may match; the drawn ones never repeat a pick or each other");
  // The prepper picked keeps the packed bag.
  const pr = hc(77, { crewRoll: roll, crew: [{ background: "prepper" }, {}, {}] });
  check(pr.survivors[0].gear.backpack.key === HC_START.PREPPER.BAG && pr.hardcore.start.prepper === pr.survivors[0].id, "a picked prepper has the duffle bag");
}

section("Every preset converts to a custom background that builds");
{
  const conv = {};
  for (const key of Object.keys(HC_START.ARCHETYPES)) conv[`c_${key}`] = presetToCustom(key, `c_${key}`);
  setCustomLibrary(Object.values(conv));
  check(Object.keys(customLibrary()).length === Object.keys(HC_START.ARCHETYPES).length, "all twelve in the list");
  for (const [id, d] of Object.entries(conv)) {
    const again = sanitizeBackground(d, id);
    check(JSON.stringify(again) === JSON.stringify(d) && fitCheck(d).left.length === 0, `${id}: already safe, everything fits (${Object.keys(d.skills).length} skills, ${d.items.length} things)`);
    const w = hc(5, { crewRoll: 5, crew: [{ background: id }, {}, {}], customBackgrounds: customLibrary() });
    check(w.survivors[0].background === id && Object.entries(d.gear).every(([slot, k]) => w.survivors[0].gear[slot] && w.survivors[0].gear[slot].key === k), `${id}: a start with it`);
  }
  check(conv.c_nurse.skills.medicine === 6 && conv.c_nurse.traits[0] === "medic" && conv.c_veteran.gear.weapon === "pistol", "the middle of each roll, the likeliest pick");
  check(conv.c_prepper.gear.backpack === "duffle" && conv.c_prepper.supplies.food === HC_START.PREPPER.FOOD && conv.c_prepper.items.includes("waterfilter"), "the prepper's packed bag");
}

section("The new-run screen: Customize, and Ironman locks it");
{
  setCustomLibrary([MEDIC]);
  const st = hc(42, { crewRoll: 777, customBackgrounds: customLibrary() });
  const ui = { started: false, worldSize: "normal", factionCount: 5, startPeople: 3, ironman: false, freeEdit: false };
  let html = newRunScreen(st, ui);
  check(/data-action="nr-free"/.test(html) && !/data-action="nr-bg"/.test(html) && !/data-action="nr-trait"/.test(html) && /data-action="bg-open"(?![^>]*disabled)/.test(html), "Customize off: the box and Backgrounds…, no pickers");
  ui.freeEdit = true;
  html = newRunScreen(st, ui);
  check((html.match(/data-action="nr-bg"/g) || []).length === 3 && /<optgroup label="Custom"><option value="c_1"/.test(html) && /Dice \(/.test(html), "Customize on: a background select each (the dice, the presets, the custom ones)");
  check((html.match(/data-action="nr-trait"/g) || []).length === 3 * Object.keys(TRAITS).length, "and a trait picker each");
  // Skills past the budget.
  const s = st.survivors[0];
  const k = SKILLS.find((x) => s.skills[x] < 15);
  const before = s.skills[k], total = SKILLS.reduce((a, x) => a + s.skills[x], 0);
  s.skillBudget = total; // no points left
  for (let i = 0; i < 3; i++) LOOK_ACTIONS["nr-skill"](st, ui, { id: s.id, k, d: 1 });
  check(s.skills[k] === before + 3 && s.startCustom && crewCustomized(st), `Customize: ${k} ${before} → ${s.skills[k]} with no points left; the crew counts as customized`);
  const add = ["lucky", "tough", "brave", "medic"].find((t) => !s.traits.includes(t) && !s.traits.some((x) => TRAIT_CLASH.some(([p, q]) => (p === x && q === t) || (p === t && q === x)))); // one that does not clash with theirs
  LOOK_ACTIONS["nr-trait"](st, ui, { id: s.id, k: add });
  check(s.traits.includes(add) || s.traits.length >= 5, `a trait added (${s.traits.join()})`);
  const t0n = s.traits.length;
  LOOK_ACTIONS["nr-trait"](st, ui, { id: s.id, k: s.traits[0] });
  check(s.traits.length === t0n - 1, "and taken off");
  const snap = crewSnapshot(st);
  check(snap[0].custom && snap[0].skills[k] === s.skills[k], "the snapshot carries it into a rebuilt world");
  const re = createWorld({ seed: 42, factionCount: 5, mode: "hardcore", crew: snap, crewRoll: 777, customBackgrounds: customLibrary() });
  check(re.survivors[0].skills[k] === s.skills[k] && re.survivors[0].startCustom, "rebuilt: the skills kept, still customized");
  const cb = crewWithBackground(re, re.survivors[1].id, "c_1");
  const re2 = createWorld({ seed: 42, factionCount: 5, mode: "hardcore", crew: cb, crewRoll: 777, customBackgrounds: customLibrary() });
  check(re2.survivors[1].background === "c_1" && re2.survivors[1].bgPicked && re2.survivors[0].skills[k] === s.skills[k], "a background picked for the second: theirs, the first keeps their skills");
  // The first pick gives the crew dice of their own (main.js fixedCrewRoll): the others keep who they were anyway.
  const re3 = createWorld({ seed: 42, factionCount: 5, mode: "hardcore", crew: crewWithBackground(re, re.survivors[1].id, "nurse"), crewRoll: 999, customBackgrounds: customLibrary() });
  check(re3.survivors[1].background === "nurse" && [0, 2].every((i) => re3.survivors[i].background === re.survivors[i].background && !re3.survivors[i].bgPicked), `the others keep who they were, not as picks (${re3.survivors.map((x) => x.background).join(", ")})`);
  const back = createWorld({ seed: 42, factionCount: 5, mode: "hardcore", crew: crewWithBackground(re3, re3.survivors[1].id, ""), crewRoll: 999 });
  check(!back.survivors[1].bgPicked && !back.survivors[1].startCustom, "back to the dice: not a pick, not customized");
  // Ironman: everything locked.
  ui.ironman = true;
  html = newRunScreen(re2, ui);
  check(/data-action="nr-free" disabled/.test(html) && /data-action="bg-open" disabled/.test(html) && !/data-action="nr-bg"/.test(html) && !/data-action="nr-trait"/.test(html), "Ironman: Customize and Backgrounds… greyed out, no pickers");
  check(!/data-action="nr-skill"[^>]*data-d="1" (?!disabled)/.test(html) && /Ironman: as rolled/.test(html), "Ironman: every skill button greyed out");
  const r0 = re2.survivors[2], sk0 = JSON.stringify(r0.skills);
  LOOK_ACTIONS["nr-skill"](re2, ui, { id: r0.id, k: "shooting", d: 1 });
  LOOK_ACTIONS["nr-skill"](re2, ui, { id: r0.id, k: SKILLS.find((x) => r0.skills[x] > 0), d: -1 });
  LOOK_ACTIONS["nr-trait"](re2, ui, { id: r0.id, k: "lucky" });
  check(JSON.stringify(r0.skills) === sk0 && !r0.startCustom, "Ironman: the skill and trait actions do nothing");
  check(crewCustomized(re2), "a crew customized before Ironman still counts (main.js puts it back, Start refuses it)");
  const iron = createWorld({ seed: 42, factionCount: 5, mode: "hardcore", crew: ironmanCrew(re2), crewRoll: 777 });
  check(!crewCustomized(iron) && iron.survivors.map((x) => x.name).join() === re2.survivors.map((x) => x.name).join() && !iron.customBackgrounds, "the Ironman crew: names kept, nothing customized, no custom backgrounds");
  check(iron.survivors.every((x, i) => x.background === hc(42, { crewRoll: 777 }).survivors[i].background), "and the dice's backgrounds");
}

section("The backgrounds window");
{
  setCustomLibrary([]);
  const st = hc(8, {});
  const ui = { started: false, ironman: true };
  BG_ACTIONS["bg-open"](st, ui);
  check(!ui.bgEditor, "not with Ironman");
  ui.ironman = false;
  BG_ACTIONS["bg-open"](st, ui);
  check(!!ui.bgEditor && /None yet/.test(backgroundEditor(st, ui)), "opens, empty");
  BG_ACTIONS["bg-new"](st, ui);
  const id = ui.bgEditor.sel;
  check(isCustomBg(id) && customLibrary()[id], `+ New makes one (${id})`);
  BG_CHANGE["bg-name"](st, ui, { value: "Trucker's kid", dataset: {} });
  BG_CHANGE["bg-skill"](st, ui, { value: "50", dataset: { k: "stealth" } });
  BG_ACTIONS["bg-trait"](st, ui, { k: "nightowl" });
  BG_CHANGE["bg-gear"](st, ui, { value: "slingbag", dataset: { slot: "backpack" } });
  for (const k of ["phone", "candy", "lighters", "cards", "novel", "stove", "laptop", "binoculars"]) BG_CHANGE["bg-item-add"](st, ui, { value: k, dataset: {} });
  BG_CHANGE["bg-sup"](st, ui, { value: "9", dataset: { k: "food" } });
  BG_CHANGE["bg-cartype"](st, ui, { value: "van", dataset: {} });
  BG_CHANGE["bg-trunk"](st, ui, { value: "500", dataset: { k: "fuel" } });
  const d = customLibrary()[id];
  check(d.name === "Trucker's kid" && d.skills.stealth === CUSTOM_BG.SKILL && d.traits.join() === "nightowl" && d.gear.backpack === "slingbag" && d.supplies.food === 9 && d.car.type === "van" && d.car.trunk.fuel === CUSTOM_BG.TRUNK.fuel, "edits land, clamped");
  check(ui.bgEditor.changed.includes(id), "and are marked changed (Done builds the world again)");
  const html = backgroundEditor(st, ui);
  const fit = fitCheck(d);
  check(fit.left.length > 0 && /No room for/.test(html), `too much for a sling bag: the window says what is left behind (${fit.left.join(", ")})`);
  check(/Trucker&#39;s kid|Trucker's kid/.test(html) && (html.match(/data-action="bg-skill"/g) || []).length === SKILLS.length && /data-action="bg-cartype"/.test(html), "the window: list, skills, the car");
  BG_CHANGE["bg-copy"](st, ui, { value: "hunter" });
  check(Object.keys(customLibrary()).length === 2 && customLibrary()[ui.bgEditor.sel].name === "Hunter (custom)", "from a preset");
  BG_ACTIONS["bg-dup"](st, ui);
  check(Object.keys(customLibrary()).length === 3, "duplicate");
  const del = ui.bgEditor.sel;
  BG_ACTIONS["bg-del"](st, ui);
  check(customLibrary()[del] && ui.bgEditor.confirmDel, "delete asks first");
  BG_ACTIONS["bg-del"](st, ui);
  check(!customLibrary()[del] && Object.keys(customLibrary()).length === 2, "then deletes");
}

section("A normal start: six backgrounds, the same world and the same skill totals");
{
  const tot = (x) => Object.values(x.skills).reduce((a, v) => a + v, 0);
  const sig = (w) => JSON.stringify([w.bases[0].tile, w.factions.map((f) => [f.name, f.bases]), w.hives && w.hives.length, w.vehicles.length, w.survivors.map((x) => [x.name, tot(x), x.gear.weapon && x.gear.weapon.key])]);
  let sameWorld = true, sameTotals = true, distinct = true, shaped = 0, n = 0;
  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
    NORMAL_BG.ON = false;
    const off = createWorld({ seed, factionCount: 7 });
    NORMAL_BG.ON = true;
    const on = createWorld({ seed, factionCount: 7 });
    if (sig(on) !== sig(off)) sameWorld = false;
    if (on.survivors.some((x, i) => tot(x) !== tot(off.survivors[i]))) sameTotals = false;
    const kinds = on.survivors.map((x) => x.background);
    if (!kinds.every((k) => HC_START.ARCHETYPES[k]) || new Set(kinds).size !== 6 || off.survivors.some((x) => x.background)) distinct = false;
    on.survivors.forEach((x, i) => {
      const ks = Object.keys(HC_START.ARCHETYPES[x.background].skills);
      n++;
      if (ks.reduce((a, k) => a + x.skills[k], 0) > ks.reduce((a, k) => a + off.survivors[i].skills[k], 0)) shaped++;
    });
  }
  check(sameWorld, "the same hub, groups, hives, vehicles, names and weapons as without backgrounds (dice of their own)");
  check(sameTotals, "every colonist's skill total as it was");
  check(distinct, "six backgrounds each, no two alike");
  check(shaped >= n * 0.85, `the background's skills higher than they were (${shaped} of ${n})`);
  const rng = new Rng(9);
  const x = { skills: { shooting: 2, stealth: 0, medicine: 18, farming: 5 } };
  x.skills.medicine += 4;
  keepSkillTotal(rng, x, 25, ["medicine"]);
  check(Object.values(x.skills).reduce((a, v) => a + v, 0) === 25 && x.skills.medicine === 22, `keepSkillTotal takes from the others first (${JSON.stringify(x.skills)})`);
  // Picked: a preset (the same total), a custom one (exactly, with its kit, supplies and car).
  NORMAL_BG.ON = false;
  const base = createWorld({ seed: 42, factionCount: 7 });
  NORMAL_BG.ON = true;
  const pre = createWorld({ seed: 42, factionCount: 7, crew: [{}, { background: "nurse" }] });
  check(pre.survivors[1].background === "nurse" && pre.survivors[1].bgPicked && tot(pre.survivors[1]) === tot(base.survivors[1]) && pre.survivors.filter((y) => y.background === "nurse").length === 1, "a preset picked: theirs, the same total, nobody else drawn it");
  const cus = createWorld({ seed: 42, factionCount: 7, crew: [{ background: "c_1", custom: true }], customBackgrounds: lib });
  const c0 = cus.survivors[0], b0 = base.survivors[0], hubC = cus.bases[0], hubB = base.bases[0];
  check(c0.background === "c_1" && c0.bgPicked && SKILLS.every((k) => c0.skills[k] === Math.min(20, b0.skills[k] + (MEDIC.skills[k] || 0))), "a custom one: exactly its bumps on their own skills");
  check(c0.traits[0] === "tough" && c0.traits[1] === "keeneye", "its traits first");
  check(c0.gear.weapon.key === "pistol" && c0.gear.armor.key === "vest" && c0.gear.backpack.key === "hikingpack" && c0.gear.head.key === "milhelmet", "its kit worn and held");
  check(hubC.armory.some((it) => it.key === b0.gear.weapon.key) && hubC.armory.some((it) => it.key === "vest"), `what the hub had handed them is in the armory (${hubC.armory.map((it) => it.key).join(", ")})`);
  check(hubC.stock.food === hubB.stock.food + MEDIC.supplies.food && totalRounds(hubC.stock) === totalRounds(hubB.stock) + MEDIC.supplies.ammo && hubC.stock.meds === hubB.stock.meds + MEDIC.supplies.meds + MEDIC.car.trunk.meds && hubC.stock.fuel === hubB.stock.fuel + MEDIC.car.trunk.fuel, "its supplies and the car's back in the hub's stores");
  check(vehiclesAtBase(cus, hubC.id).some((v) => v.type === "hummer") && vehiclesAtBase(cus, hubC.id).length === vehiclesAtBase(base, hubB.id).length + 1 && ["sandbags", "fishrod"].every((k) => hubC.armory.some((it) => it.key === k)), "the car parks at the hub, its things in the armory");
  // A rebuilt world (the snapshot) brings the custom kit once, not twice.
  const again = createWorld({ seed: 42, factionCount: 7, crew: crewSnapshot(cus), customBackgrounds: lib });
  check(again.bases[0].armory.length === hubC.armory.length && again.survivors[0].gear.weapon.key === "pistol" && again.survivors[0].bgPicked, `rebuilt: the same armory (${again.bases[0].armory.length}), the kit once`);
  const noCar = createWorld({ seed: 42, factionCount: 7, crew: [{ background: "c_2", custom: true }], customBackgrounds: lib });
  check(vehiclesAtBase(noCar, noCar.bases[0].id).length === vehiclesAtBase(base, hubB.id).length, "no car kind or odds 0: no car");
  // The new-run screen, normal: a background select each with Customize; Ironman's crew is the dice's again.
  const ui = { started: false, worldSize: "normal", factionCount: 7, freeEdit: true };
  const html = newRunScreen(cus, ui);
  check((html.match(/data-action="nr-bg"/g) || []).length === 6 && /same total/.test(html), "normal, Customize: a background select on each of the six");
  const iron = createWorld({ seed: 42, factionCount: 7, crew: ironmanCrew(cus) });
  check(!crewCustomized(iron) && iron.survivors.every((y, i) => y.background === createWorld({ seed: 42, factionCount: 7 }).survivors[i].background), "Ironman's crew: the dice's backgrounds");
  // A save keeps them.
  const ld = loadFromString(saveToString(cus));
  check(ld.survivors.every((y, i) => y.background === cus.survivors[i].background) && backgroundInfo(ld, "c_1").custom, "a save keeps the backgrounds");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
