// The starting-gear catalogue (2026-10-27, the user's request: "Improve the UI to select gear to start with for survivors
// and backs of vehicles. Currently it's just a really long dropdown. I want sprite, cost, name, hover for description.
// Make it kinda like the RimWorld mod EdB Prepare Carefully"; ui/gearpicker.js, ui/startgear.js):
//   - the catalogue: a row (a <button>) a choice with its name, a gun's calibre, its kg, its points and its description
//     on hover; the category chips and the find box (name, category, calibre) narrow it; the sort orders it and flips;
//     each catalogue keeps its own view; a dimmed row says why in its hover;
//   - the gear window: no long drop-downs; the loadout's slots (a click: the target, ✕ clears) and Carried; a row
//     clicked equips the slot (sg-slot's rules) or puts it in what they carry (sg-item-add's: the × box, the spot picked);
//   - a vehicle's back window: no drop-downs; Things, Rounds and (Custom) Supplies and materials, a row clicked puts it
//     in the back (sg-trunk-add's, sg-trunk-round's, sg-trunk-supadd's rules); what is in the back shown with pictures;
//   - the wiring: the find box keeps its focus (data-keep) and the list its scroll (data-keepscroll, ui/panelfold.js),
//     main.js registers the typing; the styles.
// Usage: node tools/gearpickertest.js
import { readFileSync } from "node:fs";
import { createWorld } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { START_GEAR, slotChoices, carryChoices, trunkChoices, carryList } from "../src/sim/startgear.js";
import { slotPoints, loosePoints, pricePerson } from "../src/sim/custompoints.js";
import { gearPicker, gearEntry, pickerView, resetPickers, GP_ACTIONS, GP_INPUT, CATS } from "../src/ui/gearpicker.js";
import { startGearEditor, fleetEditor, SG_ACTIONS, SG_CHANGE } from "../src/ui/startgear.js";
import { keepScrollBefore, keepScrollAfter } from "../src/ui/panelfold.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log(`FAIL ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
// The rows of a catalogue's HTML: { k, act, tip, cls, name, pts }.
const rowsOf = (html) => [...html.matchAll(/<button class="gprow([^"]*)" data-action="([^"]+)" data-k="([^"]+)"[^>]*?data-tip="([^"]*)">([\s\S]*?)<\/button>/g)].map((m) => ({ cls: m[1], act: m[2], k: m[3], tip: m[4], name: ((/<span class="gpname">([^<]*)/.exec(m[5]) || [])[1] || "").trim(), pts: Number((/<span class="gppts">(\d+) pts/.exec(m[5]) || [])[1]) }));
const UI = (extra = {}) => ({ started: false, freeEdit: true, ironman: false, worldSize: "normal", factionCount: 5, nrMsg: "", ...extra });
const q = (ns, text) => GP_INPUT["gp-q"](null, null, { value: text, dataset: { ns } });

section("1. The catalogue");
{
  resetPickers();
  const keys = ["pistol", "ar", "shotgun", "knife", "tourniquet", "flashlight"];
  const entries = keys.map((k) => gearEntry(k, loosePoints, k === "ar" ? "Too dear." : "", k === "knife"));
  let html = gearPicker(entries, { ns: "t", act: "x-pick", attrs: 'data-slot="weapon"', verb: "take it" });
  let rows = rowsOf(html);
  check(rows.length === keys.length && rows.every((r) => r.act === "x-pick" && GEAR[r.k] && r.name === GEAR[r.k].name && r.pts === loosePoints(r.k)), `a row a choice, with its name and its points (${rows.map((r) => `${r.name} ${r.pts}`).join(", ")})`);
  check(rows.every((r) => r.tip.includes(GEAR[r.k].name) && r.tip.length > 30 && /Click to take it\.$/.test(r.tip)), "each with its description on hover, and what a click does");
  check(/data-k="pistol" data-slot="weapon"/.test(html) && /<span class="gpbit">9mm · 15 rds<\/span>/.test(html) && /Takes 9mm/.test(rows.find((r) => r.k === "pistol").tip), "a gun's calibre and capacity in its row, its sentence in the hover; the window's attributes on every row");
  check(/<span class="gpkg">[\d.]+ kg<\/span>/.test(html) && rows.find((r) => r.k === "ar").cls.includes("dim") && rows.find((r) => r.k === "ar").tip.includes("Too dear.") && rows.find((r) => r.k === "knife").cls.includes("on"), "its kg; a refused row dimmed with the reason in its hover; the one there now ticked");
  check(!/<img/.test(html) && /<span class="gppic"><\/span>/.test(html), "no canvas here (node): no picture, the row keeps its place for one");
  check(/data-action="gp-q" data-ns="t" data-keep="gp-q-t"/.test(html) && /data-keepscroll="gp-t-/.test(html), "the find box keeps its focus (data-keep) and the list its scroll (data-keepscroll) through a redraw");
  // Chips.
  const cats = [...new Set(keys.map((k) => GEAR[k].cat))];
  check((html.match(/data-action="gp-tab"/g) || []).length === cats.length + 1 && new RegExp(`data-c=""[^>]*>All <span class="muted">${keys.length}</span>`).test(html), `the chips: All and one a category there is (${cats.join(", ")})`);
  GP_ACTIONS["gp-tab"](null, null, { ns: "t", c: GEAR.pistol.cat });
  rows = rowsOf(gearPicker(entries, { ns: "t", act: "x-pick" }));
  check(rows.length && rows.every((r) => GEAR[r.k].cat === GEAR.pistol.cat), `a chip: its category alone (${rows.map((r) => r.k).join()})`);
  GP_ACTIONS["gp-tab"](null, null, { ns: "t", c: GEAR.pistol.cat });
  check(rowsOf(gearPicker(entries, { ns: "t", act: "x-pick" })).length === keys.length, "again: everything");
  // The find box.
  q("t", "9mm");
  rows = rowsOf(gearPicker(entries, { ns: "t", act: "x-pick" }));
  check(rows.length === 1 && rows[0].k === "pistol", `"9mm" finds by calibre (${rows.map((r) => r.k).join()})`);
  q("t", "KNI");
  check(rowsOf(gearPicker(entries, { ns: "t", act: "x-pick" })).map((r) => r.k).join() === "knife", "any case, by name");
  q("t", (CATS.find(([c]) => c === GEAR.shotgun.cat) || ["", "Shotguns"])[1].toLowerCase());
  check(rowsOf(gearPicker(entries, { ns: "t", act: "x-pick" })).some((r) => r.k === "shotgun"), "by its category's name");
  q("t", "zzzz");
  html = gearPicker(entries, { ns: "t", act: "x-pick" });
  check(!rowsOf(html).length && /Nothing matches "zzzz"/.test(html) && /data-action="gp-clear"/.test(html), "nothing found: said so, and a × to clear");
  GP_ACTIONS["gp-clear"](null, null, { ns: "t" });
  check(pickerView("t").q === "" && pickerView("other").q === "", "cleared; another catalogue's view is its own");
  // Sort.
  GP_ACTIONS["gp-sort"](null, null, { ns: "t", s: "pts" });
  let pts = rowsOf(gearPicker(entries, { ns: "t", act: "x-pick" })).map((r) => r.pts);
  check(pts.every((p, i) => !i || p >= pts[i - 1]), `by points (${pts.join(", ")})`);
  GP_ACTIONS["gp-sort"](null, null, { ns: "t", s: "pts" });
  pts = rowsOf(gearPicker(entries, { ns: "t", act: "x-pick" })).map((r) => r.pts);
  check(pts.every((p, i) => !i || p <= pts[i - 1]) && pickerView("t").desc, "again: flipped");
  GP_ACTIONS["gp-sort"](null, null, { ns: "t", s: "kg" });
  const kgs = rowsOf(gearPicker(entries, { ns: "t", act: "x-pick" })).map((r) => GEAR[r.k].weight ?? 1);
  check(kgs.every((w, i) => !i || w >= kgs[i - 1]), `by kg (${kgs.join(", ")})`);
  GP_ACTIONS["gp-sort"](null, null, { ns: "t", s: "name" });
  html = gearPicker(entries, { ns: "t", act: "x-pick" });
  check(/<div class="gpgrp">/.test(html), "A–Z on All: under each category's head");
}

section("2. The gear window");
{
  resetPickers();
  const st = createWorld({ seed: 42, factionCount: 5, crew: [{ points: true }] });
  const ui = UI();
  SG_ACTIONS["sg-open"](st, ui, { id: st.survivors[0].id });
  const s = st.survivors[0];
  let w = startGearEditor(st, ui);
  check(!/<select data-action="sg-slot"/.test(w) && !/<select data-action="sg-item-add"/.test(w) && !/<select data-action="sg-trunk-/.test(w), "no long drop-downs: no sg-slot or sg-item-add select");
  check(START_GEAR.SLOTS.every((slot) => new RegExp(`data-action="sg-target" data-slot="${slot}"`).test(w)) && /data-action="sg-target" data-slot="carry"/.test(w), "the loadout: a row a slot, and Carried, each a click away from its catalogue");
  let rows = rowsOf(w);
  check(rows.length === slotChoices("weapon").length && rows.every((r) => r.act === "sg-pick-slot" && r.pts === slotPoints("weapon", r.k)) && /data-slot="weapon"/.test(w), `the hands first: their catalogue, priced as the slot prices it (${rows.length} rows)`);
  const B = pricePerson(st, s), dear = rows.filter((r) => r.pts - (s.gear.weapon ? slotPoints("weapon", s.gear.weapon.key) : 0) > B.left);
  check(!dear.length || dear.every((r) => r.cls.includes("dim") && /points over/.test(r.tip)), `what puts them over their ${B.left} points left is dimmed, the hover says so (${dear.length})`);
  check(SG_ACTIONS["sg-pick-slot"](st, ui, { k: "ar", slot: "weapon" }) === true && s.startGear.slots.weapon === "ar", "a row clicked: on the slot (sg-slot's rules; true: the world is built again)");
  check(SG_ACTIONS["sg-pick-slot"](st, ui, { k: "milhelmet", slot: "weapon" }) === false && s.startGear.slots.weapon === "ar", "a thing of another slot: refused");
  check(SG_ACTIONS["sg-pick-slot"](st, ui, { k: "rucksack", slot: "backpack" }) === true && s.startGear.slots.backpack === "rucksack", "a bag on the Bag slot");
  s.startGear.mods = { rail: "quadrail" };
  check(SG_ACTIONS["sg-pick-slot"](st, ui, { k: "ar", slot: "weapon" }) === false && s.startGear.slots.weapon === "ar" && s.startGear.mods && s.startGear.mods.rail === "quadrail", "the ticked row clicked again: nothing (the gun keeps its parts, no rebuild)");
  // The world as main.js gearRebuild makes it: the same seed, the crew as it stands.
  const re = () => createWorld({ seed: 42, factionCount: 5, crew: [{ points: true, startGear: s.startGear, startPoints: true, startCustom: true }] });
  let st2 = re();
  const s2 = st2.survivors[0];
  w = startGearEditor(st2, ui);
  check(s2.gear.weapon && s2.gear.weapon.key === "ar" && /data-action="sg-slot-clear" data-slot="weapon"/.test(w) && rowsOf(w).find((r) => r.k === "ar").cls.includes("on"), "rebuilt: the rifle in the hands, a ✕ on its slot, its row ticked in the catalogue");
  check(SG_ACTIONS["sg-target"](st2, ui, { slot: "head" }) === false && ui.gearEdit.target === "head" && rowsOf(startGearEditor(st2, ui)).every((r) => GEAR[r.k].slot === "head" && r.act === "sg-pick-slot"), "a slot clicked: its catalogue");
  check(SG_ACTIONS["sg-slot-clear"](st2, ui, { slot: "weapon" }) === true && s2.startGear.slots.weapon === "", "✕: nothing in the hands");
  // What they carry.
  SG_ACTIONS["sg-target"](st2, ui, { slot: "carry" });
  w = startGearEditor(st2, ui);
  rows = rowsOf(w);
  check(ui.gearEdit.target === "carry" && rows.length === carryChoices().length && rows.every((r) => r.act === "sg-pick-carry" && r.pts === loosePoints(r.k)), `Carried: what they may carry, at its loose price (${rows.length} rows)`);
  SG_CHANGE["sg-qty"](st2, ui, { value: "3", dataset: { k: "qty" } });
  s2.ownMax = 1000; // points to spare: the × box decides how many (as the crew card's own Points would)
  const nOf = (P, k) => carryList(P).reduce((a, e) => a + (e.key === k ? (e.entry && e.entry.n) || 1 : 0), 0);
  const n0 = nOf(s2.startGear, "tourniquet"), want = Math.min(3, Math.max(1, Math.floor(Math.max(0, pricePerson(st2, s2).left) / loosePoints("tourniquet")))); // what their points left pay for, one at least
  check(SG_ACTIONS["sg-pick-carry"](st2, ui, { k: "tourniquet" }) === true && nOf(s2.startGear, "tourniquet") - n0 === want && want === 3, `a row clicked: in what they carry, as many as the × box says (sg-item-add's rules: ${nOf(s2.startGear, "tourniquet") - n0} of 3, ${want} paid for; "${ui.gearEdit.msg}")`);
  // A spot picked first: the thing goes there.
  st2 = createWorld({ seed: 42, factionCount: 5, crew: [{ points: true, startGear: s2.startGear, startPoints: true, startCustom: true }] });
  const s3 = st2.survivors[0];
  SG_ACTIONS["sg-target"](st2, ui, { slot: "weapon" });
  SG_CHANGE["sg-qty"](st2, ui, { value: "1", dataset: { k: "qty" } });
  const packFree = (s3.startGear.carry.pack || []).findIndex((x) => !x);
  const spot = packFree >= 0 ? packFree : (s3.startGear.carry.pack || []).length;
  SG_ACTIONS["sg-cell"](st2, ui, { w: "pack", i: String(spot) });
  check(ui.gearEdit.target === "carry" && ui.gearEdit.sel && ui.gearEdit.sel.where === "pack", "a spot clicked: Carried is the target, the spot picked");
  w = startGearEditor(st2, ui);
  check(/pack slot picked/.test(w), "the catalogue says where it goes");
  check(SG_ACTIONS["sg-pick-carry"](st2, ui, { k: "flashlight" }) === true && s3.startGear.carry.pack[spot] === "flashlight", `and it goes there (pack slot ${spot})`);
  // A thing that fits no spot: dimmed with the reason (a fresh colonist with nothing worn).
  const bare = createWorld({ seed: 42, factionCount: 5, crew: [{ points: true, startGear: { slots: Object.fromEntries(START_GEAR.SLOTS.map((k) => [k, ""])), carry: { pocket: [], pouch: [], pack: [] } }, startPoints: true, startCustom: true }] });
  const bu = UI();
  SG_ACTIONS["sg-open"](bare, bu, { id: bare.survivors[0].id });
  SG_ACTIONS["sg-target"](bare, bu, { slot: "carry" });
  const noFit = rowsOf(startGearEditor(bare, bu)).filter((r) => /No spot it fits/.test(r.tip));
  check(noFit.length > 10 && noFit.every((r) => r.cls.includes("dim")) && noFit.some((r) => /only small things go in pockets/.test(r.tip)), `pockets alone: what does not go in a pocket dimmed, the reason on hover (${noFit.length})`);
  check(/<span class="sgkind">Pack<\/span><span class="sgname">Flashlight/.test(startGearEditor(st2, ui)), "the cell shows what is in it (its picture before the name in a browser)");
  SG_ACTIONS["sg-close"](st2, ui);
}

section("3. A vehicle's back");
{
  resetPickers();
  const SMALL = { people: 2, groups: 3, hives: 3, cities: 1, towns: 6, military: 1 };
  for (const [tag, opts] of [["Normal", { seed: 42, factionCount: 5 }], ["Custom", { seed: 23, factionCount: 5, custom: SMALL, fleet: [{ type: "van", limit: 300, load: null }] }]]) {
    const st = createWorld(opts);
    const ui = UI({ mode: tag.toLowerCase() });
    if (!(st.fleet || []).length) { check(false, `${tag}: a starting vehicle`); continue; }
    SG_ACTIONS["fleet-edit"](st, ui, { i: "0" });
    let w = fleetEditor(st, ui);
    check(!/<select data-action="sg-trunk-(add|supadd|round)"/.test(w), `${tag}: no long drop-downs in the back's window`);
    let rows = rowsOf(w);
    check(rows.length === trunkChoices().length && rows.every((r) => r.act === "sg-pick-trunk" && r.pts === loosePoints(r.k)) && /data-action="sg-qty" data-k="tqty"/.test(w), `${tag}: Things, every thing the back takes at its loose price, with the × box (${rows.length})`);
    const modes = [...w.matchAll(/data-action="gp-mode" data-ns="trunk" data-m="(\w+)"/g)].map((m) => m[1]);
    check(modes.join() === (tag === "Custom" ? "things,sups,rounds" : "things,rounds"), `${tag}: its tabs (${modes.join(", ")})`);
    check(SG_ACTIONS["sg-pick-trunk"](st, ui, { k: "crowbar" }) === "fleet" && ui.fleet[0].load.items.includes("crowbar"), `${tag}: a row clicked: in the back (sg-trunk-add's rules; "fleet": the world again)`);
    w = fleetEditor(st, ui);
    check(/<span class="chip sgthing"[^>]*><span class="gppic">[^]*?Crowbar/.test(w), `${tag}: what is in the back, a chip each with its picture's place`);
    GP_ACTIONS["gp-mode"](st, ui, { ns: "trunk", m: "rounds" });
    w = fleetEditor(st, ui);
    rows = rowsOf(w);
    const nine = rows.find((r) => r.k === "a_9mm_fmj");
    check(rows.length > 20 && rows.every((r) => r.act === "sg-pick-round") && nine && /box of \d+/.test(w) && /9mm/.test(w), `${tag}: Rounds, by calibre (${rows.length})`);
    const before = (ui.fleet[0].load.supplies || {}).a_9mm_fmj || 0;
    check(SG_ACTIONS["sg-pick-round"](st, ui, { k: "a_9mm_fmj" }) === "fleet" && ui.fleet[0].load.supplies.a_9mm_fmj > before, `${tag}: a box of 9mm in (${before} → ${ui.fleet[0].load.supplies.a_9mm_fmj})`);
    if (tag === "Custom") {
      GP_ACTIONS["gp-mode"](st, ui, { ns: "trunk", m: "sups" });
      rows = rowsOf(fleetEditor(st, ui));
      check(rows.length > 10 && rows.every((r) => r.act === "sg-pick-sup") && rows.some((r) => r.k === "propane"), `${tag}: Supplies and materials, any not in the back yet (${rows.length})`);
      check(SG_ACTIONS["sg-pick-sup"](st, ui, { k: "propane" }) === "fleet" && ui.fleet[0].load.supplies.propane === 10, `${tag}: ten of it in`);
      check(!rowsOf(fleetEditor(st, ui)).some((r) => r.k === "propane"), `${tag}: then its number box, not its row`);
    }
    GP_ACTIONS["gp-mode"](st, ui, { ns: "trunk", m: "things" });
    SG_ACTIONS["fleet-close"](st, ui);
  }
  // Customize off: nothing goes in.
  const st = createWorld({ seed: 42, factionCount: 5 });
  const off = UI({ freeEdit: false });
  off.fleetEdit = { i: 0, msg: "", tsel: null };
  check(SG_ACTIONS["sg-pick-trunk"](st, off, { k: "crowbar" }) === false, "Customize off: a row does nothing");
}

section("4. Wiring and styles");
{
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  check(/Object\.entries\(GP_INPUT\)\) PANEL_INPUT\[k\]/.test(main) && /keepScrollBefore\(el\)/.test(main) && /afterPanelWrite\(el, keep, scroll\)/.test(main), "main.js: the find box as you type (PANEL_INPUT), the list's scroll kept through setHTML");
  check(!("gp-q" in SG_CHANGE), "the find box is no change handler (a change fires as the redraw takes the box out: a redraw then would cut into it)");
  check(["gp-tab", "gp-sort", "gp-clear", "gp-mode", "sg-target", "sg-slot-clear", "sg-pick-slot", "sg-pick-carry", "sg-pick-trunk", "sg-pick-sup", "sg-pick-round"].every((k) => typeof SG_ACTIONS[k] === "function"), "every click is in SG_ACTIONS (main.js registers them)");
  const box = (key, top) => ({ dataset: { keepscroll: key }, scrollTop: top });
  const a = box("gp-x", 120), b = box("gp-y", 0);
  const saved = keepScrollBefore({ querySelectorAll: () => [a, b] });
  const a2 = box("gp-x", 0), c2 = box("gp-z", 0);
  keepScrollAfter({ querySelectorAll: () => [a2, c2] }, saved);
  check(saved && saved.length === 1 && a2.scrollTop === 120 && c2.scrollTop === 0, "a list redrawn with the same key keeps its scroll; a new view starts at the top");
  check(/button\.gprow \{/.test(css) && /\.gplist \{[^}]*overflow-y: auto/.test(css) && /\.gpart \{[^}]*image-rendering: pixelated/.test(css) && /@media \(max-width: 759px\)[^{]*\{\s*\.gpchips \{[^}]*overflow-x: auto/.test(css), "the styles: rows, a list that scrolls, crisp pictures, the chips one sideways row on a phone");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
