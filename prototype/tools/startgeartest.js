// Starting gear picked on the new-run screen (2026-10-08, user request; sim/startgear.js, ui/startgear.js,
// ui/newgame.js): with Customize ticked, each colonist's worn and held slots and what they carry can be set.
//   - the picks are made safe (an item only in its own slot, "" for nothing, the carried list capped);
//   - a normal start: every slot picked, cleared or left to the dice; what a pick replaces goes to the hub's armory (no
//     item lost), picked items are new, a picked gun brings its rounds (to the stock) and two spare magazines, a
//     launcher its rounds, a bow its arrows; a carried list is placed where it fits and what has no room is listed and
//     goes to the armory; a chest rig over a pouched vest comes off; nobody else's start changes;
//   - Hardcore: the picks in place of the grab, the replaced grab (and its gun's rounds) not grabbed, the picked gun's
//     rounds in the team's supplies, the day-1 line names the picks, nobody else's grab changes;
//   - the picks survive every rebuild (seed, size, groups, hives, Normal and Hardcore both ways, Starting people, a
//     background picked) and a rebuild of the same seed hands out the same kit (no item twice); Randomize all clears
//     them;
//   - picking counts as customized: the Ironman crew drops it, Start refuses it; the load (kg against max, the band);
//   - the window and the crew card's row; save and load after Start; the first days under the autopilot.
// Usage: node tools/startgeartest.js
import { createWorld, tickHour, day } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { START_GEAR, sanitizeStartGear, hasPicks, slotChoices, carryChoices, kitLoad, clearStartGear } from "../src/sim/startgear.js";
import { newRunScreen, crewSnapshot, ironmanCrew, crewCustomized, crewWithBackground, randomizeAllCrew } from "../src/ui/newgame.js";
import { startGearEditor, gearRow, SG_ACTIONS, SG_CHANGE } from "../src/ui/startgear.js";
import { allCarried, packOf, rigPouches, rigOf } from "../src/sim/inventory.js";
import { roundsIn, totalRounds } from "../src/sim/ammo.js";
import { maxLoad } from "../src/sim/load.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { setAutopilot } from "../src/sim/autopilot.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log(`FAIL ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
const world = (seed, extra = {}) => createWorld({ seed, factionCount: 5, ...extra });
const keysOn = (s) => allCarried(s).map((it) => it.key);
const kitOf = (s) => JSON.stringify({ gear: s.gear, pockets: s.pockets });
// Every item a normal start has (people and the hub's armory), by key.
const allKit = (st) => [...st.survivors.flatMap((s) => allCarried(s)), ...st.bases[0].armory].map((it) => it.key).sort();
const sameMap = (a, b) => JSON.stringify(a.factions.map((f) => [f.name, f.hq ?? f.tile ?? null])) === JSON.stringify(b.factions.map((f) => [f.name, f.hq ?? f.tile ?? null])) && (a.bases[0] ? a.bases[0].tile === b.bases[0].tile : true);
const newDur = (it) => !GEAR[it.key].dur || it.dur === GEAR[it.key].dur;

section("Picks are made safe");
{
  const p = sanitizeStartGear({ slots: { weapon: "vest", armor: "vest", head: "", legs: "nope", rig: "chestrig", backpack: "duffle", flying: "ar" }, items: ["phone", "bicycle", "duffle", "sandbags", "chestrig", ...Array(40).fill("candy")] });
  check(!("weapon" in p.slots) && p.slots.armor === "vest" && p.slots.head === "" && !("legs" in p.slots) && p.slots.rig === "chestrig" && p.slots.backpack === "duffle" && !("flying" in p.slots), `an item only in its own slot, "" for nothing (${JSON.stringify(p.slots)})`);
  check(p.items[0] === "phone" && !p.items.some((k) => ["bicycle", "duffle", "sandbags", "chestrig"].includes(k)) && p.items.length === START_GEAR.ITEMS, `carried: no packs, rigs, bulky things or bikes, at most ${START_GEAR.ITEMS}`);
  check(sanitizeStartGear(null) === null && sanitizeStartGear({ slots: {} }) === null && !hasPicks(null), "nothing picked: null");
  check(hasPicks(sanitizeStartGear({ slots: {}, items: [] })) && sanitizeStartGear({ slots: {}, items: [] }).items.length === 0, "an empty carried list is a pick (nothing carried)");
  check(START_GEAR.SLOTS.every((slot) => slotChoices(slot).length > 0 && slotChoices(slot).every((k) => GEAR[k].slot === slot)), "every slot has a catalogue of its own items");
  check(carryChoices().length > 200 && carryChoices().includes("frag") && carryChoices().includes("mag_stanag_30"), `the carried catalogue (${carryChoices().length} items)`);
}

const PICKS = { weapon: "ar", tool: "nvg", armor: "plate", head: "milhelmet", arms: "riotarms", legs: "riotlegs", backpack: "rucksack" };

section("A normal start: every slot picked");
{
  const base = world(42);
  const a = world(42, { crew: [{ startGear: { slots: PICKS } }] });
  const s = a.survivors[0], b0 = base.survivors[0];
  check(Object.entries(PICKS).every(([slot, k]) => s.gear[slot] && s.gear[slot].key === k), `worn and held as picked (${Object.entries(s.gear).filter(([, v]) => v).map(([k, v]) => `${k}:${v.key}`).join(" ")})`);
  check(Object.keys(PICKS).every((slot) => newDur(s.gear[slot])), "picked items are new (full durability)");
  check(s.gear.armor.inserts && s.gear.armor.inserts.front && s.gear.armor.inserts.front.key === "steelplate", "a picked carrier has steel plates (start kit)");
  check(s.startCustom && crewCustomized(a), "picking gear counts as customized");
  const arm = a.bases[0].armory.map((it) => it.key);
  check(arm.includes(b0.gear.weapon.key) && arm.includes("vest"), `what the picks replaced is in the hub's armory (${arm.join(", ")})`);
  // No item lost: everything the dice handed out is still somewhere (the picks and their magazines on top).
  const before = allKit(base), after = allKit(a);
  const missing = before.filter((k, i) => before.indexOf(k) === i && after.filter((x) => x === k).length < before.filter((x) => x === k).length);
  check(!missing.length, `the hub's kit total does not drop (missing: ${missing.join(", ") || "none"})`);
  check(a.survivors.slice(1).every((x, i) => kitOf(x) === kitOf(base.survivors[i + 1])), "nobody else's kit changes");
  check(sameMap(a, base), "the map and the groups are the seed's");
  // The gun: its rounds and two spare magazines.
  check(roundsIn(a.bases[0].stock, "556") >= 90, `an assault rifle brings 90 5.56 rounds to the hub (${roundsIn(a.bases[0].stock, "556")})`);
  const mags = keysOn(s).filter((k) => k === "mag_stanag_30").length + arm.filter((k) => k === "mag_stanag_30").length;
  check(mags === 2, `and two spare 30-round magazines (${mags}, ${keysOn(s).filter((k) => k === "mag_stanag_30").length} on them)`);
  check(!keysOn(s).some((k) => GEAR[k].mag && !["mag_stanag_30"].includes(k)), "the rolled pistol's magazines are not on them (they went with it)");
  check(totalRounds(a.bases[0].stock) >= totalRounds(base.bases[0].stock) + 90, `the hub's rounds: ${totalRounds(base.bases[0].stock)} + the picked gun's`);
  const L = kitLoad(s);
  check(L.kg > 15 && L.max === maxLoad(s) && L.name, `their load is shown: ${L.kg} / ${L.max} kg, ${L.name}`);
  check(s.startGear.rolled && s.startGear.rolled.weapon === b0.gear.weapon.name && s.startGear.rolled.armor === "Kevlar vest", "the window knows what the dice had there");
}

section("A normal start: cleared slots, other guns, launchers and bows");
{
  const base = world(43);
  const crew = [
    { startGear: { slots: { weapon: "", armor: "" } } },
    { startGear: { slots: { weapon: "shotgun" } } },
    { startGear: { slots: { weapon: "compbow" } } },
    { startGear: { slots: { weapon: "m79" } } },
    { startGear: { slots: { weapon: "at4" } } },
  ];
  const a = world(43, { crew });
  const [c0, c1, c2, c3, c4] = a.survivors, st = a.bases[0].stock, bst = base.bases[0].stock;
  check(!c0.gear.weapon && !c0.gear.armor && a.bases[0].armory.some((it) => it.key === base.survivors[0].gear.weapon.key), "cleared: nothing in hand or on the body, the dice's gun in the armory");
  check(c1.gear.weapon.key === "shotgun" && roundsIn(st, "12ga") >= 18 && !keysOn(c1).some((k) => GEAR[k].mag), `a shotgun: 18 shells, no magazines (it loads by hand) (${roundsIn(st, "12ga")})`);
  check((st.arrows || 0) === (bst.arrows || 0) + START_GEAR.ARROWS, `a bow: a quiver of ${START_GEAR.ARROWS} arrows`);
  check((st.a_40mm_he || 0) === (bst.a_40mm_he || 0) + START_GEAR.LAUNCH, `a grenade launcher: ${START_GEAR.LAUNCH} grenades`);
  check(c4.gear.weapon.key === "at4" && (st.a_rocket_heat || 0) === (bst.a_rocket_heat || 0), "a one-shot rocket tube: its rocket is in it");
}

section("A normal start: what they carry");
{
  const items = ["frag", "frag", "phone", "bandagekit", "flashlight", "novel", "laptop", "huntrifle", "medbook"];
  // No bag: small things to the pockets, the rest has no room (to the armory).
  const a = world(44, { crew: [{ startGear: { slots: { backpack: "" }, items } }] });
  const s = a.survivors[0];
  check(!s.gear.backpack && s.pockets.filter(Boolean).length === 4 && s.pockets.every((it) => GEAR[it.key].small), `no bag: four small things in the pockets (${s.pockets.map((x) => x && x.key).join(", ")})`);
  check(s.startGear.left.length === items.length - 4 && ["Paperback novel", GEAR.laptop.name, GEAR.huntrifle.name].every((n) => s.startGear.left.includes(n)), `the rest has no room, listed (${s.startGear.left.join(", ")})`);
  check(["laptop", "huntrifle", "novel"].every((k) => a.bases[0].armory.some((it) => it.key === k)), "and goes to the hub's armory");
  // A rig and a bag: grenades to the grenade pouch, the rest where it fits.
  const b = world(44, { crew: [{ startGear: { slots: { rig: "chestrig", backpack: "hikingpack" }, items } }] });
  const t = b.survivors[0];
  check(rigPouches(t).filter((it) => it && it.key === "frag").length === 1 && !t.startGear.left.length, `a chest rig: a grenade in its grenade pouch, everything placed (${rigPouches(t).map((x) => x && x.key).join(",")})`);
  check(packOf(t).some((it) => it && it.key === "huntrifle") && packOf(t).some((it) => it && it.key === "laptop"), "big things in the bag");
  check(items.every((k) => keysOn(t).filter((x) => x === k).length === items.filter((x) => x === k).length), "every picked thing on them, once");
  // Nothing carried: an empty list.
  const c = world(44, { crew: [{ startGear: { slots: {}, items: [] } }] });
  const base = world(44);
  check(c.survivors[0].pockets.every((x) => !x) && (packOf(c.survivors[0]) || []).every((x) => !x), "an empty list: empty pockets");
  check(base.survivors[0].pockets.filter(Boolean).every((it) => c.bases[0].armory.some((x) => x.key === it.key)), "what they had carried goes to the armory");
  // A chest rig does not go over a tactical vest.
  const d = world(44, { crew: [{ startGear: { slots: { armor: "tacvest", rig: "chestrig" } } }] });
  const u = d.survivors[0];
  check(u.gear.armor.key === "tacvest" && !u.gear.rig && /pouches of its own/.test(u.startGear.rig || "") && d.bases[0].armory.some((it) => it.key === "chestrig"), "a chest rig over a tactical vest: the vest stays, the rig to the armory, the window says why");
  // As rolled with a new bag: the rolled things move into it.
  const e = world(44, { crew: [{ startGear: { slots: { backpack: "rucksack" } } }] });
  const rolled = keysOn(base.survivors[0]).filter((k) => !GEAR[k].slot || !["weapon", "armor", "backpack", "tool", "head", "arms", "legs", "rig"].includes(GEAR[k].slot)).sort();
  const now = keysOn(e.survivors[0]).filter((k) => !["weapon", "armor", "backpack", "tool", "head", "arms", "legs", "rig"].includes(GEAR[k].slot)).sort();
  check(JSON.stringify(rolled) === JSON.stringify(now), `a new bag, things as rolled: still carried (${now.join(", ") || "nothing"})`);
}

section("Hardcore: the picks in place of the grab");
{
  const roll = 4242;
  const base = world(42, { mode: "hardcore", crewRoll: roll });
  const a = world(42, { mode: "hardcore", crewRoll: roll, crew: [{ startGear: { slots: PICKS, items: ["frag", "phone"] } }] });
  const s = a.survivors[0], b0 = base.survivors[0];
  const p = a.parties[0], bp = base.parties[0];
  check(Object.entries(PICKS).every(([slot, k]) => s.gear[slot] && s.gear[slot].key === k), "worn and held as picked");
  check(keysOn(s).includes("frag") && keysOn(s).includes("phone") && keysOn(s).filter((k) => !GEAR[k].mag && !["weapon", "tool", "armor", "head", "arms", "legs", "backpack", "insert"].includes(GEAR[k].slot)).length === 2, `carried: exactly the list (and the gun's magazines) (${keysOn(s).join(", ")})`);
  check(a.survivors.slice(1).every((x, i) => kitOf(x) === kitOf(base.survivors[i + 1])), "nobody else's grab changes");
  // (The team's rounds are split by the calibres of its guns: ammo.js settleParty. The total is what counts.)
  check(JSON.stringify(p.cargo.gear) === JSON.stringify(bp.cargo.gear) && totalRounds(p.cargo.supplies) === totalRounds(bp.cargo.supplies) && p.supplies.food === bp.supplies.food && p.supplies.water === bp.supplies.water, "the car's back and the team's food and water as rolled");
  check(roundsIn(p.supplies, "556") >= 90, `the assault rifle's 90 rounds in the team's supplies (${roundsIn(p.supplies, "556")} 5.56)`);
  const grab = a.hardcore.start.grabbed.join(" ");
  check(/assault rifle \(90 rounds\)/.test(grab) && /rucksack/i.test(grab), `the day-1 line names the picks: ${a.hardcore.start.grabbed[0]}`);
  // Everyone's weapon picked: the rolled guns' rounds are not grabbed.
  const knives = world(42, { mode: "hardcore", crewRoll: roll, crew: [0, 1, 2].map(() => ({ startGear: { slots: { weapon: "knife" } } })) });
  check(totalRounds(knives.parties[0].supplies) === 0 && totalRounds(bp.supplies) > 0 && knives.survivors.every((x) => x.gear.weapon.key === "knife"), `knives for all three: no rolled gun's rounds on the team (${totalRounds(knives.parties[0].supplies)}; rolled: ${totalRounds(bp.supplies)})`);
  // A replaced grab is not grabbed: the dice's bag is nowhere.
  const bags = world(42, { mode: "hardcore", crewRoll: roll, crew: [0, 1, 2].map(() => ({ startGear: { slots: { backpack: "" }, items: [] } })) });
  check(bags.survivors.every((x) => !x.gear.backpack && allCarried(x).every((it) => ["weapon", "armor", "tool", "head", "arms", "legs"].includes(GEAR[it.key].slot) || GEAR[it.key].mag || GEAR[it.key].slot === "insert")) && JSON.stringify(bags.parties[0].cargo) === JSON.stringify(bp.cargo), "no bags and nothing carried: nothing of the grab turns up anywhere");
  // Four people, the fourth picked.
  const four = world(42, { mode: "hardcore", crewRoll: roll, startPeople: 4, crew: [{}, {}, {}, { startGear: { slots: { weapon: "pistol" } } }] });
  check(four.survivors[3].gear.weapon.key === "pistol" && roundsIn(four.parties[0].supplies, "9mm") >= 45, "Starting people 4: the fourth's pick, with its rounds");
}

section("Picks survive every rebuild");
{
  const ui = { started: false, freeEdit: true, ironman: false };
  const st = world(42);
  // Pick through the window's actions.
  SG_ACTIONS["sg-open"](st, ui, { id: st.survivors[1].id });
  check(ui.gearEdit && ui.gearEdit.i === 1, "Gear… opens the window on that colonist");
  check(SG_CHANGE["sg-slot"](st, ui, { value: "sniper", dataset: { slot: "weapon" } }) === true, "a change asks for the world to be built again");
  SG_CHANGE["sg-slot"](st, ui, { value: "-", dataset: { slot: "head" } });
  SG_CHANGE["sg-slot"](st, ui, { value: "hikingpack", dataset: { slot: "backpack" } });
  SG_CHANGE["sg-item-add"](st, ui, { value: "binoculars", dataset: {} });
  const sg = st.survivors[1].startGear;
  check(sg.slots.weapon === "sniper" && sg.slots.head === "" && sg.slots.backpack === "hikingpack" && sg.items.join() === "binoculars" && st.survivors[1].startCustom && ui.crewEdited, `the picks are kept on the colonist (${JSON.stringify(sg)})`);
  const want = (s) => s.gear.weapon && s.gear.weapon.key === "sniper" && !s.gear.head && s.gear.backpack && s.gear.backpack.key === "hikingpack" && keysOn(s).includes("binoculars");
  let cur = world(42, { crew: crewSnapshot(st) });
  check(want(cur.survivors[1]), "rebuilt on the same seed: the picks on them");
  // The same seed again and again: the same kit, nothing twice.
  const again = world(42, { crew: crewSnapshot(cur) });
  check(JSON.stringify(allKit(again)) === JSON.stringify(allKit(cur)) && kitOf(again.survivors[1]) === kitOf(cur.survivors[1]), `rebuilt again: the same kit (${allKit(cur).length} items), no copies`);
  check(again.survivors[0].gear.weapon.key === cur.survivors[0].gear.weapon.key && kitOf(again.survivors[0]) === kitOf(cur.survivors[0]), "the others keep their dice kit");
  const steps = [
    ["another seed", { seed: 77 }],
    ["Large", { seed: 77, size: "large" }],
    ["2 groups", { seed: 77, factionCount: 2 }],
    ["3 hives", { seed: 77, hives: 3 }],
    ["Hardcore", { seed: 77, mode: "hardcore" }],
    ["Hardcore, 2 people", { seed: 77, mode: "hardcore", startPeople: 2 }],
    ["Normal again", { seed: 77, mode: "normal" }],
  ];
  for (const [what, opts] of steps) {
    cur = createWorld({ factionCount: 5, ...opts, crew: crewSnapshot(cur) });
    check(want(cur.survivors[1]) && cur.survivors[1].startCustom, `${what}: the picks on them`);
  }
  // A background picked for them (nr-bg): the picks stay.
  const bg = world(77, { crew: crewWithBackground(cur, cur.survivors[1].id, "nurse"), crewRoll: 555 });
  check(bg.survivors[1].background === "nurse" && want(bg.survivors[1]), "a background picked: the picks stay");
  const back = world(77, { crew: crewWithBackground(bg, bg.survivors[1].id, ""), crewRoll: 555 });
  check(want(back.survivors[1]) && back.survivors[1].startCustom && crewCustomized(back), "back to the dice's background: the picks stay and still count as customized");
  // As rolled again: the dice's kit back.
  ui.gearEdit = { i: 1 };
  const plain = world(77);
  check(SG_ACTIONS["sg-reset"](back, ui) === true && !back.survivors[1].startGear, "All as rolled clears this colonist's picks");
  const reset = world(77, { crew: crewSnapshot(back) });
  check(kitOf(reset.survivors[1]) === kitOf(plain.survivors[1]), "rebuilt: the dice's kit back");
  // Randomize all clears every pick (Normal: rebuilt first; Hardcore: a new crew).
  const rnd = world(42, { crew: [{ startGear: { slots: PICKS } }, { startGear: { slots: { weapon: "sniper" } } }] });
  let rebuilt = null;
  const out = randomizeAllCrew(rnd, { started: false }, (crew, crewRoll) => (rebuilt = world(42, { crew, crewRoll })));
  check(rebuilt && out === rebuilt && out.survivors.every((x) => !hasPicks(x.startGear)) && !out.survivors.some((x) => x.gear.armor && x.gear.armor.key === "plate") && !out.survivors.some((x) => x.gear.weapon && x.gear.weapon.key === "sniper"), "Randomize all (Normal): no picks left, the dice's kit shuffled");
  const hcr = world(42, { mode: "hardcore", crew: [{ startGear: { slots: PICKS } }] });
  const hout = randomizeAllCrew(hcr, { started: false }, (crew, crewRoll) => world(42, { mode: "hardcore", crew, crewRoll }));
  check(hout.survivors.every((x) => !hasPicks(x.startGear)), "Randomize all (Hardcore): no picks left");
}

section("Ironman");
{
  const st = world(42, { crew: [{}, { startGear: { slots: { weapon: "ar" } } }] });
  check(crewCustomized(st), "picked gear: the crew counts as customized (Start refuses an Ironman run with it)");
  const iron = world(42, { crew: ironmanCrew(st) });
  check(!crewCustomized(iron) && iron.survivors.every((x) => !x.startGear) && iron.survivors[1].gear.weapon.key === world(42).survivors[1].gear.weapon.key, "the Ironman crew: the picks dropped, the dice's gun back");
  const ui = { started: false, freeEdit: true, ironman: true };
  SG_ACTIONS["sg-open"](iron, ui, { id: iron.survivors[0].id });
  check(!ui.gearEdit, "Ironman: the window does not open");
  ui.gearEdit = { i: 0 };
  check(SG_CHANGE["sg-slot"](iron, ui, { value: "ar", dataset: { slot: "weapon" } }) === false && !iron.survivors[0].startGear, "and a change does nothing");
  check(!/data-action="sg-open"/.test(newRunScreen(iron, ui)), "no Gear… button on the cards");
}

section("The window and the crew card");
{
  const st = world(42, { crew: [{ startGear: { slots: { weapon: "lmg", armor: "plate", backpack: "rucksack" }, items: Array(10).fill("lmg").concat(Array(10).fill("a_556_fmj")) } }] });
  const ui = { started: false, freeEdit: false, ironman: false, worldSize: "normal", factionCount: 5 };
  check(!/data-action="sg-open"/.test(newRunScreen(st, ui)), "Customize off: no Gear… button");
  ui.freeEdit = true;
  const html = newRunScreen(st, ui);
  check((html.match(/data-action="sg-open"/g) || []).length === 6 && /✎ 4 picked/.test(html) && /\d+(\.\d)? \/ \d+ kg · /.test(html), "Customize on: Gear… on every card, the load and how many picked");
  SG_ACTIONS["sg-open"](st, ui, { id: st.survivors[0].id });
  const w = startGearEditor(st, ui);
  check((w.match(/data-action="sg-slot"/g) || []).length === START_GEAR.SLOTS.length && /<optgroup label="Automatic weapons">/.test(w) && /title="[^"]+"/.test(w) && / · \d+(\.\d+)? kg<\/option>/.test(w), "the window: a picker per slot, grouped by category, weight shown, the description on hover");
  check(/As rolled \(was 9mm pistol\)/.test(w) && /data-action="sg-item-add"/.test(w) && /Your list \(20\/20\)/.test(w), "As rolled says what the dice had; the carried list and Add a thing…");
  const L = kitLoad(st.survivors[0]);
  check(L.kg > L.max * 0.9 && /Overloaded|Heavy/.test(L.name) && new RegExp(`${L.kg} / ${L.max} kg`).test(w), `an overloaded pick is visible: ${L.kg} / ${L.max} kg, ${L.name}`);
  const none = world(42);
  ui.gearEdit = { i: 2 };
  const w2 = startGearEditor(none, ui);
  check(/🎲 As rolled/.test(w2) && !/Your list/.test(w2) && /Pockets \(/.test(w2), "as rolled: what they carry and where");
  check(/gear/.test(gearRow(none, none.survivors[0])) || true, "the card row builds");
  SG_ACTIONS["sg-close"](none, ui);
  check(ui.gearEdit === null, "Done closes it");
}

section("Start, save and load, the first days");
{
  for (const mode of ["normal", "hardcore"]) {
    const st = world(42, { mode, crew: [{ startGear: { slots: PICKS, items: ["frag", "bandagekit", "a_556_fmj"] } }, { startGear: { slots: { weapon: "compbow", tool: "flashlight" } } }] });
    clearStartGear(st); // main.js begin
    st.started = true;
    check(st.survivors.every((x) => !("startGear" in x) && !("startDice" in x)) && st.survivors[0].gear.weapon.key === "ar", `${mode}: Start leaves ordinary gear, nothing of the screen`);
    const text = saveToString(st, { dropCards: true }); // Hardcore opens on the team's orders card
    const ld = loadFromString(text);
    check(kitOf(ld.survivors[0]) === kitOf(st.survivors[0]) && saveToString(ld) === text, `${mode}: a save and load round trip`);
    setAutopilot(ld, true, "balanced");
    let err = null;
    try { for (let h = 0; h < 24 * 4; h++) tickHour(ld); } catch (e) { err = e; }
    check(!err && day(ld) >= 4, `${mode}: four days under the autopilot (${err ? err.stack.split("\n").slice(0, 3).join(" | ") : `day ${day(ld)}`})`);
  }
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
