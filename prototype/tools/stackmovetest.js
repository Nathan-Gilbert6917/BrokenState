// The stack mover (ui/stackmove.js): one panel for moving part of a supply stack, on every screen that moves stacks.
// Checks the panel itself (amount, weight, how many fit, the warning past that, the destinations, the popover, Enter
// and Esc, the live slider), then each screen: the raid's search window (sim/raidloot.js raidMove), Loot the bodies
// (sim/inventory.js takeSupply, sim/stacks.js lootFit) and the inventory window (the stores as stack tiles, its
// destination hook). Moves move the amount chosen, never more than fits.
// Then the three follow-ups: the mouse wheel (one, Shift ten, held to the stack, the first tick over a tile picks it,
// no preventDefault when nothing changes), Split (a stack cut in two where it lies: the window's note, the sim's count
// untouched; a move takes the part picked, nothing lost or doubled on any screen; Join) and the fit bars under the
// slider (one per destination, on the slider's scale; only on a wide panel).
// Usage: node tools/stackmovetest.js [seed] [v]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { SUPPLIES } from "../src/sim/data.js";
import { launchExpedition, cargoRoom, unitsThatFit } from "../src/sim/parties.js";
import { createBattle, CELL, registerCombatHandler, unitAt } from "../src/sim/combat.js";
import { ensureInv, newItem } from "../src/sim/inventory.js";
import * as RL from "../src/sim/raidloot.js";
import { lootFit } from "../src/sim/stacks.js";
import { inventoryModal, INV_ACTIONS, INV_CHANGE, invDrop, INV_STACK_DESTS } from "../src/ui/inventory.js";
import { registerStackScreen, openStack, stackPanel, chosenQty, stackKey, stackInput, stackWheel, splitParts, splitCount, fitBars, STACK_ACTIONS, STACK_CHANGE } from "../src/ui/stackmove.js";
import { readFileSync } from "node:fs";

const seed = Number(process.argv[2] || 7);
const VERBOSE = process.argv.includes("v");
let passes = 0, fails = 0;
const check = (ok, msg) => { if (ok) { passes++; if (VERBOSE) console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const key = (code, target = {}) => ({ code, target });
const render = (st, ui) => { try { return inventoryModal(st, ui) || ""; } catch (e) { return `ERR ${e.stack}`; } };
const kg1 = (x) => `${Math.round(x * 10) / 10}`;
registerCombatHandler("smtest", () => {});

// ======================================================================================
console.log("The panel: amount, weight, what fits, destinations");
{
  const st = { combat: null };
  const moved = [];
  let cancelled = 0;
  const T = { have: 20, dests: [{ id: "a", label: "Cargo", fit: 14 }, { id: "b", label: "Pack", fit: 0, err: "The pack is full." }] };
  registerStackScreen("t", {
    spec: () => ({ key: "f_rationbar", have: T.have, from: "The shelf", dests: T.dests, to: "a" }),
    move: (s, ui, to, qty) => moved.push([to, qty]),
    cancel: () => { cancelled++; },
  });
  const ui = {};
  openStack(ui, "t");
  const w = SUPPLIES.f_rationbar.weight;
  let h = stackPanel(st, ui, "t");
  check(/class="smove dock"/.test(h) && /The shelf/.test(h) && /active smto"[^>]*>(<i class="smsw[^>]*><\/i>)?<span>Cargo</.test(h), "docked, with the stack's place and its destination in words");
  check(chosenQty(st, ui, "t") === 14 && /value="14"/.test(h), `default: what fits (14 of 20): ${chosenQty(st, ui, "t")}`);
  check(h.includes(`<b class="smkg">${kg1(14 * w)}</b> kg`), `the weight of the amount: ${kg1(14 * w)} kg`);
  check(/14 fit in Cargo now/.test(h) && /class="smfit good"/.test(h), "how many fit at the destination");
  check(/Move 14 ration bars → Cargo/.test(h), "one clear button: Move 14 ration bars → Cargo");
  check(/All <small>20<\/small>/.test(h) && /What fits <small>14<\/small>/.test(h) && /½ <small>10<\/small>/.test(h) && /data-v="one"/.test(h), "quick chips: 1, half, All, What fits");
  check(/data-action="sm-to" data-to="b"[^>]*>.*full/.test(h.replace(/\n/g, " ")), "a second destination, marked full");
  check(/type="range"[^>]*max="20"/.test(h) && /type="number"[^>]*max="20"/.test(h), "a slider and a number box, 1 to the stack");
  STACK_ACTIONS["sm-qty"](st, ui, { v: "all" });
  h = stackPanel(st, ui, "t");
  check(chosenQty(st, ui, "t") === 20 && /Only 14 fit in Cargo now: 6 stay/.test(h) && /class="smfit warn"/.test(h), "All 20: a warning that only 14 fit");
  check(/Move 14 ration bars → Cargo/.test(h), "the button says what will move (14)");
  check(/var\(--danger\)/.test(h), "the slider's track shows the part past what fits");
  STACK_ACTIONS["sm-qty"](st, ui, { v: "half" });
  check(chosenQty(st, ui, "t") === 10, "½: 10");
  STACK_ACTIONS["sm-qty"](st, ui, { v: "dec" });
  STACK_ACTIONS["sm-qty"](st, ui, { v: "dec" });
  check(chosenQty(st, ui, "t") === 8, "− −: 8");
  STACK_CHANGE["sm-qtyset"](st, ui, { value: "99" });
  check(chosenQty(st, ui, "t") === 20, "typed 99: held to the stack");
  STACK_CHANGE["sm-qtyset"](st, ui, { value: "0" });
  check(chosenQty(st, ui, "t") === 1, "typed 0: at least one");
  STACK_ACTIONS["sm-qty"](st, ui, { v: "fit" });
  check(chosenQty(st, ui, "t") === 14, "What fits: 14");
  STACK_ACTIONS["sm-to"](st, ui, { to: "b" });
  h = stackPanel(st, ui, "t");
  check(/active smto"[^>]*>(<i class="smsw[^>]*><\/i>)?<span>Pack</.test(h) && /data-action="sm-go" disabled/.test(h) && /Nothing fits there/.test(h) && /The pack is full/.test(h), "picking a full destination: the button is off and says why");
  STACK_ACTIONS["sm-to"](st, ui, { to: "a" });
  STACK_CHANGE["sm-qtyset"](st, ui, { value: "6" });
  check(stackKey(st, ui, key("Enter")) && moved.length === 1 && moved[0][0] === "a" && moved[0][1] === 6 && !ui.stack && cancelled === 1, `Enter moves the amount chosen to the destination (${JSON.stringify(moved[0])}), and the panel closes`);
  openStack(ui, "t");
  check(stackKey(st, ui, key("Enter", { dataset: { action: "sm-qtyset" }, value: "3" })) && moved[1][1] === 3, "Enter in the number box: the number typed counts (3)");
  openStack(ui, "t");
  STACK_ACTIONS["sm-qty"](st, ui, { v: "all" });
  STACK_ACTIONS["sm-go"](st, ui);
  check(moved[2][1] === 14, `All 20 chosen, 14 fit: 14 asked of the sim (${moved[2][1]})`);
  openStack(ui, "t");
  check(stackKey(st, ui, key("Escape")) && !ui.stack && moved.length === 3 && cancelled === 4, "Esc cancels: nothing moves");
  check(!stackKey(st, ui, key("Enter")), "no stack open: Enter is not taken");
  openStack(ui, "t", { to: "a", pop: { x: 120, y: 80 } });
  h = stackPanel(st, ui, "t");
  check(/class="smove pop"/.test(h) && /left:clamp\(0.5rem, 120px/.test(h) && /top:clamp\(0.5rem, 80px/.test(h) && !/data-action="sm-to"/.test(h), "a drop: a popover at the drop, with the one destination");
  check(stackPanel(st, ui, "other") === "", "another screen's panel stays shut");
  T.have = 1;
  h = stackPanel(st, ui, "t");
  check(!/type="range"/.test(h) && /Move 1 ration bars → Cargo/.test(h), "a stack of one: no slider, just the button");
  T.have = 0;
  check(stackPanel(st, ui, "t") === "", "an empty stack: no panel");
  // The slider moving: the panel follows without a redraw (stackInput).
  const node = (props = {}) => ({ textContent: "", className: "", value: "", style: {}, classList: { remove() {} }, ...props });
  const els = { ".smrange": node(), ".smkg": node(), ".smfit": node(), ".smbtn": node() };
  const other = node();
  const root = { dataset: { have: "20", fit: "14", unit: String(w), name: "ration bars", to: "Cargo", verb: "Move" }, querySelector: (q) => els[q] || null, querySelectorAll: (q) => (q.includes("sm-qtyset") ? [other] : []) };
  const range = { dataset: { action: "sm-qtyset" }, value: "17", closest: () => root };
  check(stackInput(range) && other.value === "17" && els[".smkg"].textContent === kg1(14 * w) && /Only 14 fit/.test(els[".smfit"].textContent) && els[".smbtn"].textContent === "Move 14 ration bars → Cargo" && /linear-gradient/.test(els[".smrange"].style.background), "the slider dragged to 17: number box, weight, warning and button follow");
}

// ---------- a raid: crew of 3 on a town site, no enemies ----------
function raid(k = 0) {
  for (let i = 0; i < 60; i++) {
    const st = createWorld({ seed: seed * 100 + i + k * 7, factionCount: 6 });
    st.cards.length = 0;
    st.crashNext = 1e9;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && t.id !== h.tile && ["pharmacy", "store", "gunstore", "police", "warehouse", "house", "gas"].includes(t.loc.type));
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, 3);
    for (const s of crew) s.traits = [];
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 30, meds: 2 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "smtest", enemy: { kind: "zombies", count: 0, power: 2, groups: [] }, raid: { heat0: 0 }, context: {} };
    st.combat = createBattle(st, setup);
    const b = st.combat;
    if (b.raid.choose) b.raid.choose = null;
    b.units = b.units.filter((u) => u.side === "player");
    b.night = false;
    if (b.raid.containers.filter((c) => c.kind !== "body" && !c.lock).length < 3) continue;
    return { st, b, p, crew };
  }
  throw new Error("no raid map");
}
const players = (b) => b.units.filter((u) => u.side === "player");
function standNext(b, u, x, y) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h || !CELL[b.cells[ny * b.w + nx].k].walk || unitAt(b, nx, ny)) continue;
    u.x = nx; u.y = ny;
    return true;
  }
  return false;
}
function boxWith(b, u, sup) {
  const box = b.raid.containers.find((c) => c.kind !== "body" && !c.lock && standNext(b, u, c.x, c.y));
  box.contents = { sup: { ...sup }, gear: [] };
  box.hidden = null; box.quick = false; box.searched = true; box.partial = false;
  return box;
}
const fresh = (b, u) => { u.ap = 2; u.haulTurn = b.turn; u.hauledKg = 0; };

console.log("The search window (a raid)");
{
  const { st, b } = raid(1);
  const [u] = players(b);
  fresh(b, u);
  // Pockets full and no pack: a found stack has nowhere to be held, so it defaults to Carried (sim/raidloot.js
  // quickTarget; with room it goes in the pockets and the pack as items: checked below).
  const sv = st.survivors.find((x) => x.id === u.sid);
  ensureInv(sv);
  const keepPockets = sv.pockets.slice(), keepPack = sv.gear.backpack;
  sv.pockets = sv.pockets.map(() => newItem("phone")); sv.gear.backpack = null;
  const box = boxWith(b, u, { f_rationbar: 10 });
  const ui = { inv: { raid: true, uid: u.id, box: box.id }, invSel: null, invMsg: "" };
  const src = `rbox:${box.id}:sup:f_rationbar`, me = `haul:${u.id}:list`;
  INV_ACTIONS["inv-click"](st, ui, { loc: src });
  let h = render(st, ui);
  check(/class="smove dock"/.test(h) && h.includes(`>${box.label}<`) && /\(carried\)/.test(h), `a stack clicked: the mover docks, from ${box.label} to ${u.name.split(" ")[0]} (carried)`);
  check(!/data-action="rl-qty"/.test(h) && !/class="qty"/.test(h), "the old quantity bar is gone");
  check(/Haul this turn/.test(h), "the haul time left shows under it");
  const fit = RL.supplyFit(st, u.id, src, me).n;
  check(chosenQty(st, ui, "raid") === Math.min(10, fit), `default: what fits (${chosenQty(st, ui, "raid")})`);
  STACK_CHANGE["sm-qtyset"](st, ui, { value: "4" });
  INV_ACTIONS["sm-go"](st, ui);
  check(u.haul.sup.f_rationbar === 4 && box.contents.sup.f_rationbar === 6 && !ui.invSel && !ui.stack, `Move 4: 4 carried, 6 left (${ui.invMsg})`);
  // The fast path: pick, set 1, click the destination.
  INV_ACTIONS["inv-click"](st, ui, { loc: src });
  INV_ACTIONS["sm-qty"](st, ui, { v: "one" });
  INV_ACTIONS["inv-click"](st, ui, { loc: me });
  check(u.haul.sup.f_rationbar === 5 && box.contents.sup.f_rationbar === 5, "pick, 1, then click Carried: 1 moves");
  // A drop: the popover asks; Enter moves what fits.
  invDrop(st, ui, src, me, false, false, { x: 300, y: 200 });
  h = render(st, ui);
  check(box.contents.sup.f_rationbar === 5 && ui.stack && ui.stack.pop && /class="smove pop"/.test(h) && /Move 5 ration bars →/.test(h), "a plain drop moves nothing yet: a popover at the drop, \"Move 5 ration bars → …\"");
  check(stackKey(st, ui, key("Enter")) && u.haul.sup.f_rationbar === 10 && !(box.contents.sup.f_rationbar >= 1) && !ui.stack, "Enter: all 5 move");
  invDrop(st, ui, `haul:${u.id}:sup:f_rationbar`, `rbox:${box.id}:list`, false, false, { x: 1, y: 1 });
  check(stackKey(st, ui, key("Escape")) && u.haul.sup.f_rationbar === 10 && !ui.stack && !ui.invSel, "drop then Esc: nothing moves");
  invDrop(st, ui, `haul:${u.id}:sup:f_rationbar`, `rbox:${box.id}:list`, true);
  check(u.haul.sup.f_rationbar === 5 && box.contents.sup.f_rationbar === 5 && !ui.stack, "Shift-drop: half, straight away");
  invDrop(st, ui, `haul:${u.id}:sup:f_rationbar`, `rbox:${box.id}:list`, false, true);
  check(u.haul.sup.f_rationbar === 4 && box.contents.sup.f_rationbar === 6, "Ctrl-drop: one");
  INV_ACTIONS["inv-click"](st, ui, { loc: src }, { shiftKey: true });
  check(u.haul.sup.f_rationbar === 10 && !(box.contents.sup.f_rationbar >= 1), "Shift+click: all that fit, straight across");
  // With room: the default is the pockets and the pack, as items (sim/supitems.js), not Carried.
  sv.pockets = keepPockets.map(() => null); sv.gear.backpack = keepPack;
  u.haul.sup.f_rationbar = 0;
  box.contents.sup.f_rationbar = 6;
  INV_ACTIONS["inv-click"](st, ui, { loc: src });
  check(/Move 6 ration bars → [^<]*pockets &amp; pack/.test(render(st, ui)), "with free pockets the mover sends it to the pockets & pack");
  INV_ACTIONS["sm-go"](st, ui);
  const pocketed = sv.pockets.reduce((a, it) => a + (it && it.key === "s_f_rationbar" ? it.dur : 0), 0);
  check(pocketed === 6 && !(box.contents.sup.f_rationbar >= 1) && !(u.haul.sup.f_rationbar > 0), `6 ration bars into a pocket as one item, nothing carried (${ui.invMsg})`);
  u.haul.sup.f_rationbar = 10;
  // Dropped on a teammate's paper doll: into their pockets and pack, as items.
  const m = players(b)[1];
  standNext(b, m, u.x, u.y);
  const ms = st.survivors.find((x) => x.id === m.sid);
  ensureInv(ms); ms.pockets = ms.pockets.map(() => null);
  invDrop(st, ui, `haul:${u.id}:sup:f_rationbar`, `s:${m.sid}:pocket:0`, false, false, { x: 5, y: 5 });
  check(ui.stack && ui.stack.to === `stow:${m.id}`, `a stack dropped on a teammate's pocket: the popover sends it to their pockets and pack (${ui.stack && ui.stack.to})`);
  STACK_CHANGE["sm-qtyset"](st, ui, { value: "3" });
  INV_ACTIONS["sm-go"](st, ui);
  check(ms.pockets.reduce((a, it) => a + (it && it.key === "s_f_rationbar" ? it.dur : 0), 0) === 3 && u.haul.sup.f_rationbar === 7, `handed 3 over (${ui.invMsg})`);
  // A bulky stack dropped on them: their arms (Carried is for big, heavy things).
  u.haul.sup.buildmat = 2;
  invDrop(st, ui, `haul:${u.id}:sup:buildmat`, `s:${m.sid}:pocket:1`, false, false, { x: 5, y: 5 });
  check(ui.stack && ui.stack.to === `haul:${m.id}:list`, `building materials dropped on a teammate: into their arms (${ui.stack && ui.stack.to})`);
  INV_ACTIONS["inv-cancel"](st, ui);
  u.haul.sup.buildmat = 0;
  // Several destinations: the searcher, the teammate, the container.
  INV_ACTIONS["inv-click"](st, ui, { loc: `haul:${u.id}:sup:f_rationbar` });
  h = render(st, ui);
  check((h.match(/data-action="sm-to"/g) || []).length >= 2 && h.includes(`data-to="rbox:${box.id}:list"`) && h.includes(`data-to="haul:${m.id}:list"`), "a stack carried: the container and the teammate to pick from");
  INV_ACTIONS["sm-to"](st, ui, { to: `rbox:${box.id}:list` });
  INV_ACTIONS["sm-qty"](st, ui, { v: "all" });
  INV_ACTIONS["sm-go"](st, ui);
  check(!(u.haul.sup.f_rationbar >= 1) && box.contents.sup.f_rationbar === 7, "picked the container, All: 7 put back");
  // Never more than fits.
  RL.HAUL.free = 1e9;
  fresh(b, u);
  const w = SUPPLIES.scrap.weight;
  const fits = Math.floor((RL.personalRoom(st, u) + 1e-6) / w);
  const big = boxWith(b, u, { scrap: fits + 10 });
  ui.inv.box = big.id;
  const bsrc = `rbox:${big.id}:sup:scrap`;
  INV_ACTIONS["inv-click"](st, ui, { loc: bsrc });
  INV_ACTIONS["sm-qty"](st, ui, { v: "all" });
  h = render(st, ui);
  check(new RegExp(`Only ${fits} fit in .* now: 10 stay`).test(h) && new RegExp(`Move ${fits} scrap →`).test(h), `${fits + 10} scrap, room for ${fits}: the warning, and the button moves ${fits}`);
  INV_ACTIONS["sm-go"](st, ui);
  check(u.haul.sup.scrap === fits && big.contents.sup.scrap === 10, `${fits} moved, 10 stay`);
  INV_ACTIONS["inv-click"](st, ui, { loc: bsrc });
  h = render(st, ui);
  check(/data-action="sm-go" disabled/.test(h) && /Nothing fits there/.test(h), "full: the button is off");
  RL.HAUL.free = 8;
}

// ---------- Loot the bodies: a won battle, faked (one body with supplies) ----------
console.log("Loot the bodies");
{
  const st = createWorld({ seed, factionCount: 5 });
  st.cards.length = 0;
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile + 3, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2 } });
  const p = res.party;
  p.phase = "engaged";
  const body = ensureInv({ name: "Raider", kind: "human", uid: 999, kit: null, supplies: { f_rationbar: 9, scrap: 400 } });
  st.combat = { over: true, bodies: [body], setup: { partyId: p.id }, units: [], place: "A road", result: { outcome: "victory", loot: { supplies: {}, gear: [] } } };
  const ui = { inv: { sid: null, loot: true, body: 0 }, invSel: null, invMsg: "" };
  let html = render(st, ui);
  check(html.includes('data-loc="body:0:sup:f_rationbar"') && html.includes('data-drag="body:0:sup:f_rationbar"') && !/data-action="loot-sup"/.test(html), "the body's supplies are stack tiles (click or drag), no 1 / ½ buttons");
  const food0 = (p.cargo.supplies.f_rationbar || 0) || 0;
  INV_ACTIONS["inv-click"](st, ui, { loc: "body:0:sup:f_rationbar" });
  html = render(st, ui);
  check(/class="smove dock"/.test(html) && /Take 9 ration bars → Team cargo/.test(html) && />Raider</.test(html), "a stack clicked: the mover, \"Take 9 ration bars → Team cargo\", from the body");
  INV_ACTIONS["sm-qty"](st, ui, { v: "half" });
  INV_ACTIONS["sm-go"](st, ui);
  check((p.cargo.supplies.f_rationbar || 0) === food0 + 4 && (body.supplies.f_rationbar || 0) === 5 && !ui.stack, `½ then Take: 4 taken, 5 left (${ui.invMsg})`);
  // The fast path: pick, 1, click the cargo box.
  INV_ACTIONS["inv-click"](st, ui, { loc: "body:0:sup:f_rationbar" });
  INV_ACTIONS["sm-qty"](st, ui, { v: "one" });
  INV_ACTIONS["inv-click"](st, ui, { loc: `cargo:${p.id}:list` });
  check((p.cargo.supplies.f_rationbar || 0) === food0 + 5 && (body.supplies.f_rationbar || 0) === 4, "pick, 1, click the cargo: 1 taken");
  // A drop on the cargo: the popover; Enter takes.
  invDrop(st, ui, "body:0:sup:f_rationbar", `cargo:${p.id}:list`, false, false, { x: 40, y: 40 });
  html = render(st, ui);
  check((body.supplies.f_rationbar || 0) === 4 && /class="smove pop"/.test(html) && /Take 4 ration bars → Team cargo/.test(html), "dropped on the cargo: a popover \"Take 4 ration bars\"");
  STACK_CHANGE["sm-qtyset"](st, ui, { value: "2" });
  stackKey(st, ui, key("Enter"));
  check((body.supplies.f_rationbar || 0) === 2 && (p.cargo.supplies.f_rationbar || 0) === food0 + 7, "2 typed, Enter: 2 taken");
  invDrop(st, ui, "body:0:sup:f_rationbar", `cargo:${p.id}:list`, false, true);
  check((body.supplies.f_rationbar || 0) === 1, "Ctrl-drop: one");
  INV_ACTIONS["inv-click"](st, ui, { loc: "body:0:sup:f_rationbar" }, { shiftKey: true });
  check(!(body.supplies.f_rationbar || 0) && (p.cargo.supplies.f_rationbar || 0) === food0 + 9, "Shift+click: the rest");
  // The team's room caps it.
  const fit = lootFit(st, 0, "scrap");
  check(fit.have === 400 && fit.n === Math.min(400, unitsThatFit(cargoRoom(st, p), "scrap")) && fit.n < 400, `400 scrap: ${fit.n} fit in the team's room (sim/stacks.js lootFit)`);
  INV_ACTIONS["inv-click"](st, ui, { loc: "body:0:sup:scrap" });
  INV_ACTIONS["sm-qty"](st, ui, { v: "all" });
  html = render(st, ui);
  check(new RegExp(`Only ${fit.n} fit in Team cargo now`).test(html), "All 400: the warning says how many fit");
  const sc0 = p.cargo.supplies.scrap || 0;
  INV_ACTIONS["sm-go"](st, ui);
  check(p.cargo.supplies.scrap === sc0 + fit.n && body.supplies.scrap === 400 - fit.n, `only ${fit.n} taken (${ui.invMsg})`);
  st.combat = null;
}

// ---------- The inventory window: the stores as stack tiles, movable through INV_STACK_DESTS ----------
console.log("The inventory window");
{
  const st = createWorld({ seed: seed + 1, factionCount: 5 });
  st.cards.length = 0;
  const h = hub(st);
  clearFood(h); h.stock.f_rationbar = 120; // 120 ration bars
  const s = atBase(st, h.id)[0];
  const ui = { inv: { sid: s.id }, invSel: null, invMsg: "" };
  const builtIn = INV_STACK_DESTS.splice(0); // the stores' own destinations (pockets & pack, off hand): checked after the hook mechanism
  let html = render(st, ui);
  const loc = `armory:${h.id}:sup:f_rationbar`;
  check(/In the stores \(/.test(html) && html.includes('<span class="iname">Ration bar</span><span class="icount">×120</span>') && /islot store stack[^"]*still/.test(html) && !html.includes(`data-loc="${loc}"`), "the base's stores are stack tiles (nowhere to move them on their own: shown, not clickable)");
  INV_ACTIONS["inv-click"](st, ui, { loc });
  check(!ui.stack || !render(st, ui).includes("smove"), "clicked anyway: no mover with nowhere to go");
  // A destination hook (as ux-carry's held supplies would add): the tile turns movable and the mover uses it.
  const got = [];
  const hook = (state, u, l) => (l === loc ? [{ id: "pack", label: `${s.name.split(" ")[0]}'s pack`, fit: 8, err: "", move: (state2, ui2, qty) => { got.push(qty); return `Packed ${qty}.`; } }] : []);
  INV_STACK_DESTS.push(hook);
  ui.invSel = null;
  html = render(st, ui);
  check(html.includes(`data-loc="${loc}"`) && html.includes(`data-drag="${loc}"`), "with a destination: the tile is clickable and draggable");
  INV_ACTIONS["inv-click"](st, ui, { loc });
  html = render(st, ui);
  check(/class="smove dock"/.test(html) && /Move 8 ration bars →/.test(html) && /Only|8 fit in/.test(html), "the mover opens on it: what fits there (8)");
  INV_ACTIONS["sm-go"](st, ui);
  check(got[0] === 8 && ui.invMsg === "Packed 8." && !ui.stack && !ui.invSel, "Move: the hook's move gets the amount");
  invDrop(st, ui, loc, `s:${s.id}:pocket:0`, false, false, { x: 9, y: 9 });
  check(ui.stack && ui.stack.pop && /class="smove pop"/.test(render(st, ui)), "dragged and dropped: the popover");
  INV_STACK_DESTS.length = 0;
  INV_STACK_DESTS.push(...builtIn);
  // The stores' own destinations (sim/supitems.js): out of the stock into the pockets and pack as items, or the off hand.
  ensureInv(s);
  s.pockets = s.pockets.map(() => null);
  s.gear.tool = null;
  ui.invSel = null; ui.invMsg = ""; ui.stack = null;
  html = render(st, ui);
  check(html.includes(`data-loc="${loc}"`), "the stores' ration bars are movable: onto the person, as items");
  INV_ACTIONS["inv-click"](st, ui, { loc });
  html = render(st, ui);
  check(/pockets &amp; pack/.test(html) && /off hand/.test(html), "the mover offers the pockets & pack and the off hand");
  STACK_CHANGE["sm-qtyset"](st, ui, { value: "7" });
  INV_ACTIONS["sm-go"](st, ui);
  const inPockets = s.pockets.reduce((a, it) => a + (it && it.key === "s_f_rationbar" ? it.dur : 0), 0);
  check(inPockets === 7 && h.stock.f_rationbar === 113, `7 ration bars out of the stores into the pockets as items (${ui.invMsg}; ${inPockets} held, ${h.stock.f_rationbar} in the stores)`);
  check(s.pockets.filter((it) => it && it.key === "s_f_rationbar").length === 2, "a pocket holds 6 ration bars (3 kg): 6 + 1");
  for (let pi = 0; pi < s.pockets.length; pi++) {
    if (!s.pockets[pi] || s.pockets[pi].key !== "s_f_rationbar") continue;
    INV_ACTIONS["inv-click"](st, ui, { loc: `s:${s.id}:pocket:${pi}` });
    INV_ACTIONS["inv-click"](st, ui, { loc: `armory:${h.id}:list` });
  }
  check(!s.pockets.some((it) => it && it.key === "s_f_rationbar") && Math.round(h.stock.f_rationbar) === 120 && !h.armory.some((it) => it && it.key === "s_f_rationbar"), `put back in the armory: stock again, at once (${ui.invMsg}; ${h.stock.f_rationbar} in the stores)`);
  ui.inv = null; ui.invSel = null;
}

// ======================================================================================
// A fake DOM for the wheel: a target whose closest() finds the slider, the number box or a tile.
const wheelOn = (kind, data = {}) => {
  const root = { dataset: {} };
  const el = { dataset: data, closest: (q) => {
    if (kind === "range" && q.includes(".smrange")) return { closest: (qq) => (qq === "[data-smove]" ? root : null) };
    if (kind === "num" && q.includes(".smnum")) return { closest: (qq) => (qq === "[data-smove]" ? root : null) };
    if (kind === "tile" && q === "[data-stack]") return el;
    return null;
  } };
  return el;
};
// What main.js does with it: preventDefault on 1 and 2 (a redraw on 2).
const wheel = (st, ui, target, deltaY, more = {}) => {
  const e = { target, deltaY, deltaX: 0, deltaMode: 1, shiftKey: false, prevented: false, ...more };
  e.preventDefault = () => { e.prevented = true; };
  const w = stackWheel(st, ui, e);
  if (w) e.preventDefault();
  return { w, prevented: e.prevented };
};

console.log("The mouse wheel");
{
  const st = { combat: null };
  const S = { have: 30, fit: 12, splits: {} };
  const moved = [];
  registerStackScreen("w", {
    spec: (s, ui) => (ui.sel ? { key: "f_rationbar", have: S.have, at: ui.sel, splits: S.splits, from: "The shelf", dests: [{ id: "a", label: "Cargo", fit: S.fit }, { id: "b", label: "Pack", fit: 5 }], to: "a" } : null),
    move: (s, ui, to, qty) => { moved.push([to, qty]); S.have -= qty; },
    cancel: (s, ui) => { ui.sel = null; },
    pick: (s, ui, at) => { ui.sel = at; },
  });
  const ui = { sel: null };
  const tile = wheelOn("tile", { stack: "shelf:f_rationbar", smns: "w" });
  let r = wheel(st, ui, tile, -100);
  check(r.w === 2 && r.prevented && ui.sel === "shelf:f_rationbar" && ui.stack && ui.stack.ns === "w" && chosenQty(st, ui, "w") === 12, `a tile not picked: the first tick picks it and opens the mover, the amount still what fits (${chosenQty(st, ui, "w")})`);
  r = wheel(st, ui, tile, -100);
  check(r.w === 2 && chosenQty(st, ui, "w") === 13, "the tile again, wheel up: one more (13)");
  r = wheel(st, ui, tile, 100);
  check(chosenQty(st, ui, "w") === 12, "wheel down: one fewer (12)");
  const range = wheelOn("range"), num = wheelOn("num");
  r = wheel(st, ui, range, -100, { shiftKey: true });
  check(r.w === 2 && chosenQty(st, ui, "w") === 22, "Shift+wheel up over the slider: ten more (22)");
  r = wheel(st, ui, num, 0, { deltaX: -100, shiftKey: true });
  check(chosenQty(st, ui, "w") === 30 && /Only 12 fit in Cargo now: 18 stay/.test(stackPanel(st, ui, "w")), "Shift+wheel over the number box (sideways, as browsers send it): held to the stack (30), past what fits is warned about");
  r = wheel(st, ui, range, -100);
  check(r.w === 0 && !r.prevented && chosenQty(st, ui, "w") === 30, "at the top: not taken, no preventDefault (the window scrolls)");
  for (let i = 0; i < 4; i++) wheel(st, ui, range, 100, { shiftKey: true });
  check(chosenQty(st, ui, "w") === 1, `Shift+wheel down past the bottom: held to 1 (${chosenQty(st, ui, "w")})`);
  r = wheel(st, ui, num, 100);
  check(r.w === 0 && !r.prevented, "at 1, wheel down: not taken");
  r = wheel(st, ui, { dataset: {}, closest: () => null }, -100);
  check(r.w === 0 && !r.prevented && chosenQty(st, ui, "w") === 1, "anywhere else: not taken (the page scrolls)");
  check(wheel(st, ui, range, 0).w === 0, "no movement: nothing");
  // A trackpad's small steps add up to one tick.
  const a = wheel(st, ui, range, -20, { deltaMode: 0 }), b2 = wheel(st, ui, range, -20, { deltaMode: 0 }), c = wheel(st, ui, range, -20, { deltaMode: 0 });
  check(a.w === 1 && b2.w === 1 && c.w === 2 && chosenQty(st, ui, "w") === 2, `a trackpad: 20 px steps add up to one tick (${[a.w, b2.w, c.w]} → ${chosenQty(st, ui, "w")})`);
  // The slider with no mover open, a tile of a screen with no picker: not taken.
  const ui2 = { sel: null };
  check(wheel(st, ui2, range, -100).w === 0, "the slider with no mover open: not taken");
  check(wheel(st, ui2, wheelOn("tile", { stack: "x", smns: "nope" }), -100).w === 0 && !ui2.stack, "a tile of an unknown screen: not taken");
  // Another tile while one is open: that one is picked, the open one is not moved.
  r = wheel(st, ui, wheelOn("tile", { stack: "shelf:other", smns: "w" }), -100);
  check(r.w === 2 && ui.sel === "shelf:other" && moved.length === 0, "the wheel over another tile: picks it, moves nothing");
  // A split stack: the wheel goes no further than the part picked.
  S.splits["shelf:other"] = { n: 7, total: 30, pick: "b" };
  ui.stack.qty = null;
  for (let i = 0; i < 3; i++) wheel(st, ui, range, -100, { shiftKey: true });
  check(chosenQty(st, ui, "w") === 7, `split 23 + 7, the 7 picked: the wheel stops at 7 (${chosenQty(st, ui, "w")})`);
}

console.log("Split and Join (the mover)");
{
  const st = { combat: null };
  const S = { have: 24, splits: {}, fitA: 30 };
  const moved = [];
  registerStackScreen("sp", {
    spec: () => ({ key: "f_rationbar", have: S.have, at: "box:f_rationbar", splits: S.splits, from: "The box", dests: [{ id: "a", label: "Cargo", fit: Math.min(S.have, S.fitA) }], to: "a" }),
    move: (s, ui, to, qty) => { moved.push(qty); S.have -= qty; },
  });
  registerStackScreen("nosplit", { spec: () => ({ key: "f_rationbar", have: 24, from: "Here", dests: [{ id: "a", label: "Cargo", fit: 24 }] }), move: () => {} });
  const ui = {};
  openStack(ui, "nosplit");
  check(!/sm-split/.test(stackPanel(st, ui, "nosplit")), "a screen that keeps no splits: no Split button");
  openStack(ui, "sp");
  let h = stackPanel(st, ui, "sp");
  check(/data-action="sm-split" disabled/.test(h), "the whole stack chosen: Split is off (pick fewer first)");
  STACK_CHANGE["sm-qtyset"](st, ui, { value: "8" });
  h = stackPanel(st, ui, "sp");
  check(/data-action="sm-split" [^d]/.test(h) && /✂ Split <small>16 \+ 8<\/small>/.test(h), "8 chosen: \"✂ Split 16 + 8\"");
  STACK_ACTIONS["sm-split"](st, ui);
  h = stackPanel(st, ui, "sp");
  check(S.have === 24 && S.splits["box:f_rationbar"] && S.splits["box:f_rationbar"].n === 8 && /24 in the stack \(16 \+ 8\)/.test(h), "Split: 16 + 8, the stack itself still 24");
  check(/data-part="b" role="radio" aria-checked="true"/.test(h) && /type="range"[^>]*max="8"/.test(h) && chosenQty(st, ui, "sp") === 8, "the 8 is picked: the slider goes to 8, the amount all of it");
  check(splitCount(S.splits, "box:f_rationbar", 24).includes("16 + <b>8</b>"), "the tile says 16 + 8, the part that moves in bold");
  STACK_ACTIONS["sm-part"](st, ui, { part: "a" });
  check(chosenQty(st, ui, "sp") === 16 && /type="range"[^>]*max="16"/.test(stackPanel(st, ui, "sp")) && splitCount(S.splits, "box:f_rationbar", 24).includes("<b>16</b> + 8"), "pick the 16: the slider goes to 16");
  STACK_ACTIONS["sm-join"](st, ui);
  check(!S.splits["box:f_rationbar"] && chosenQty(st, ui, "sp") === 24 && splitCount(S.splits, "box:f_rationbar", 24) === "24", "Join: one stack of 24 again");
  // Split, move the part: the rest stays, and the split ends.
  STACK_CHANGE["sm-qtyset"](st, ui, { value: "8" });
  STACK_ACTIONS["sm-split"](st, ui);
  STACK_ACTIONS["sm-go"](st, ui);
  check(moved.at(-1) === 8 && S.have === 16 && splitParts(S.splits, "box:f_rationbar", S.have) === null, "the 8 moved: 16 stay, one stack again");
  // Part of a part (room for 5 of the 8): 16 + 3 stay.
  S.have = 24; S.fitA = 5;
  openStack(ui, "sp");
  STACK_CHANGE["sm-qtyset"](st, ui, { value: "8" });
  STACK_ACTIONS["sm-split"](st, ui);
  STACK_ACTIONS["sm-qty"](st, ui, { v: "all" });
  check(/Only 5 fit in Cargo now: 3 stay/.test(stackPanel(st, ui, "sp")), "room for 5 of the part's 8: the warning");
  STACK_ACTIONS["sm-go"](st, ui);
  const p1 = splitParts(S.splits, "box:f_rationbar", S.have);
  check(moved.at(-1) === 5 && S.have === 19 && p1 && p1.a === 16 && p1.b === 3, `5 moved: 16 + 3 left (${p1 && `${p1.a} + ${p1.b}`})`);
  // The other part picked and moved: the split ends (the 3 are all that is left).
  S.fitA = 99;
  openStack(ui, "sp");
  STACK_ACTIONS["sm-part"](st, ui, { part: "a" });
  STACK_ACTIONS["sm-go"](st, ui);
  check(moved.at(-1) === 16 && S.have === 3 && !splitParts(S.splits, "box:f_rationbar", 3), "the 16 picked and moved: 3 stay, one stack");
  // Squared with the stack: taken from the picked part first, what comes in joins part a.
  const store = { k: { n: 8, total: 24, pick: "a" } };
  let q = splitParts(store, "k", 20);
  check(q && q.a === 12 && q.b === 8, "4 gone, part a picked: 12 + 8");
  q = splitParts(store, "k", 26);
  check(q && q.a === 18 && q.b === 8, "6 came in: they join part a (18 + 8)");
  store.k.pick = "b";
  q = splitParts(store, "k", 23);
  check(q && q.a === 18 && q.b === 5, "3 gone, part b picked: 18 + 5");
  check(splitParts(store, "k", 18) === null && !store.k, "part b emptied: one stack again");
  check(splitParts({ k: { n: 8, total: 24, pick: "a" } }, "k", 6) === null, "less than part b left: one stack");
}

console.log("Fit bars on the slider");
{
  const pc = (f, have) => (f < 1 ? 0 : Math.round(((Math.min(f, have) - 1) / (have - 1)) * 1000) / 10);
  for (const fits of [[12, 30], [4, 50, 0], [10, 20, 30, 40]]) {
    const dests = fits.map((f, i) => ({ id: `d${i}`, label: `Place ${i}`, fit: f }));
    const h = fitBars(dests, 40, 15);
    const rows = [...h.matchAll(/class="smfitrow (k\d)( ok)?" data-fit="(\d+)"><i style="width:([\d.]+)%"><\/i><span[^>]*>Place (\d) <b>(\w+)<\/b>/g)];
    const ok = rows.length === fits.length && rows.every((m, i) => m[1] === `k${i}` && Number(m[3]) === Math.min(40, fits[i]) && Number(m[4]) === pc(fits[i], 40) && !!m[2] === (fits[i] >= 15) && m[6] === (fits[i] >= 40 ? "all" : fits[i] ? String(fits[i]) : "full"));
    check(ok, `${fits.length} destinations (fit ${fits.join(", ")} of 40): a bar each, its length on the slider's scale, its chip's colour, bright where 15 fit (${rows.map((m) => `${m[3]}@${m[4]}%${m[2] ? "*" : ""}`).join(" ")})`);
  }
  check(/class="smqline" style="left:35.9%"/.test(fitBars([{ id: "a", label: "A", fit: 1 }, { id: "b", label: "B", fit: 2 }], 40, 15)), "a line at the amount chosen (15 of 40: 35.9%)");
  check(fitBars([{ id: "a", label: "A", fit: 9 }], 40, 5) === "" && fitBars([{ id: "a", label: "A", fit: 1 }, { id: "b", label: "B", fit: 1 }], 1, 1) === "", "one destination, or a stack of one: no bars");
  // In the panel: docked with several destinations, the bars and the chips' swatches; not in a popover.
  const st = { combat: null };
  registerStackScreen("fb", { spec: () => ({ key: "water", have: 20, from: "Tap", dests: [{ id: "a", label: "Ana", fit: 6 }, { id: "b", label: "Ben", fit: 20 }, { id: "c", label: "Car", fit: 0, err: "Full" }], to: "a" }), move: () => {} });
  const ui = {};
  openStack(ui, "fb");
  let h = stackPanel(st, ui, "fb");
  check(/class="smamt barred"/.test(h) && (h.match(/class="smfitrow/g) || []).length === 3 && (h.match(/class="smsw k\d"/g) || []).length === 3 && /<i class="smsw k1"><\/i><span>Ben/.test(h), "docked, 3 destinations: 3 bars, and each chip a swatch of its bar's colour");
  openStack(ui, "fb", { to: "a", pop: { x: 1, y: 1 } });
  h = stackPanel(st, ui, "fb");
  check(!/smfitrow/.test(h) && !/smsw/.test(h), "the popover (one destination): no bars");
  // The live slider: the line and the bright bars follow.
  const rows = [6, 20, 0].map((f) => { const r = { dataset: { fit: String(f) }, on: false }; r.classList = { toggle: (c, v) => { r.on = v; } }; return r; });
  const ql = { style: {} };
  const root = { dataset: { have: "20", fit: "6", unit: "1", name: "water", to: "Ana", verb: "Move" }, querySelector: (q) => (q === ".smqline" ? ql : null), querySelectorAll: (q) => (q === ".smfitrow" ? rows : []) };
  stackInput({ dataset: { action: "sm-qtyset" }, value: "10", closest: () => root });
  check(ql.style.left === `${pc(10, 20)}%` && rows.map((r) => r.on).join() === "false,true,false", "the slider dragged to 10: the line moves, only Ben's bar (20) stays bright");
  // Narrow panels: hidden; from 34rem (a container query on the docked panel): shown. The colours are tokens.
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8").replace(/\r/g, "");
  const cq = css.match(/@container \(min-width: 34rem\) \{([\s\S]*?)\n\}/);
  check(/\.smove\.dock \{ container-type: inline-size; \}/.test(css) && /\.smfits, \.smsw \{ display: none; \}/.test(css) && !!cq && /\.smfits \{ display: block; \}/.test(cq[1]), "styles.css: the bars and swatches hidden, shown in a docked panel 34rem wide or more");
  const rules = css.split("\n").filter((l) => /^\.sm(fit|qline|sw|parts|split)/.test(l) || /^\.smove \.k\d/.test(l));
  check(rules.length >= 6 && rules.every((l) => !/#[0-9a-f]{3,6}\b|rgba?\(/i.test(l)), `the fit bar and split rules take their colours from tokens (${rules.length} rules)`);
}

console.log("Split on every screen: a move takes the part, nothing lost or doubled");
{
  // The search window.
  const { st, b } = raid(2);
  const [u] = players(b);
  RL.HAUL.free = 1e9;
  fresh(b, u);
  u.haul = { sup: {}, gear: [] };
  const sv = st.survivors.find((x) => x.id === u.sid); // pockets full and no pack: the stack defaults to Carried
  ensureInv(sv); sv.pockets = sv.pockets.map(() => newItem("phone")); sv.gear.backpack = null;
  const box = boxWith(b, u, { f_rationbar: 24 });
  const ui = { inv: { raid: true, uid: u.id, box: box.id }, invSel: null, invMsg: "" };
  const src = `rbox:${box.id}:sup:f_rationbar`, me = `haul:${u.id}:list`;
  const total = () => (box.contents.sup.f_rationbar || 0) + ((u.haul && u.haul.sup.f_rationbar) || 0);
  let h = render(st, ui);
  check(h.includes(`data-stack="${src}" data-smns="raid"`), "a stack tile carries its id and screen (for the wheel)");
  const r0 = wheel(st, ui, wheelOn("tile", { stack: src, smns: "raid" }), -100);
  check(r0.w === 2 && ui.invSel === src && ui.stack && ui.stack.ns === "raid", "the wheel over the container's food: picked, the mover open");
  STACK_CHANGE["sm-qtyset"](st, ui, { value: "8" });
  STACK_ACTIONS["sm-split"](st, ui);
  h = render(st, ui);
  check(/<span class="iname">Ration bar<\/span><span class="icount"><span class="smsplit"[^>]*>16 \+ <b>8<\/b><\/span>/.test(h) && box.contents.sup.f_rationbar === 24, "split: the tile says 16 + 8, the container still holds 24");
  INV_ACTIONS["sm-go"](st, ui);
  check(box.contents.sup.f_rationbar === 16 && u.haul.sup.f_rationbar === 8 && total() === 24 && !(ui.inv.splits || {})[src], `Move: the 8 go, 16 stay, one stack again (${ui.invMsg})`);
  // Split again, the other part picked, the fast path (click Carried).
  INV_ACTIONS["inv-click"](st, ui, { loc: src });
  STACK_CHANGE["sm-qtyset"](st, ui, { value: "6" });
  STACK_ACTIONS["sm-split"](st, ui);
  STACK_ACTIONS["sm-part"](st, ui, { part: "a" });
  check(chosenQty(st, ui, "raid") === 10, "10 + 6, the 10 picked");
  INV_ACTIONS["inv-click"](st, ui, { loc: me });
  render(st, ui);
  check(box.contents.sup.f_rationbar === 6 && u.haul.sup.f_rationbar === 18 && total() === 24 && !(ui.inv.splits || {})[src], "picked the 10, clicked Carried: 10 go, the 6 stay as one stack");
  // Split, then a Shift-drop of half the whole stack: the count stays true, the parts square up.
  INV_ACTIONS["inv-click"](st, ui, { loc: `haul:${u.id}:sup:f_rationbar` });
  STACK_CHANGE["sm-qtyset"](st, ui, { value: "4" });
  STACK_ACTIONS["sm-split"](st, ui);
  STACK_ACTIONS["sm-part"](st, ui, { part: "a" });
  INV_ACTIONS["inv-cancel"](st, ui);
  invDrop(st, ui, `haul:${u.id}:sup:f_rationbar`, `rbox:${box.id}:list`, true);
  h = render(st, ui);
  check(u.haul.sup.f_rationbar === 9 && box.contents.sup.f_rationbar === 15 && total() === 24 && /<span class="iname">Ration bar<\/span><span class="icount"><span class="smsplit"[^>]*><b>5<\/b> \+ 4<\/span>/.test(h), "14 + 4 carried (the 14 picked), a Shift-drop sends half (9) back: 9 carried, taken from the 14: 5 + 4");
  RL.HAUL.free = 8;

  // Loot the bodies.
  const w = createWorld({ seed, factionCount: 5 });
  w.cards.length = 0;
  const hb = hub(w);
  const crew = atBase(w, hb.id).slice(0, 2);
  const p = launchExpedition(w, { memberIds: crew.map((s) => s.id), dest: hb.tile + 3, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2 } }).party;
  p.phase = "engaged";
  const body = ensureInv({ name: "Raider", kind: "human", uid: 998, kit: null, supplies: { f_rationbar: 20 } });
  w.combat = { over: true, bodies: [body], setup: { partyId: p.id }, units: [], place: "A road", result: { outcome: "victory", loot: { supplies: {}, gear: [] } } };
  const lui = { inv: { sid: null, loot: true, body: 0 }, invSel: null, invMsg: "" };
  const f0 = (p.cargo.supplies.f_rationbar || 0) || 0;
  INV_ACTIONS["inv-click"](w, lui, { loc: "body:0:sup:f_rationbar" });
  STACK_CHANGE["sm-qtyset"](w, lui, { value: "8" });
  STACK_ACTIONS["sm-split"](w, lui);
  const lh = render(w, lui);
  check(/<span class="iname">Ration bar<\/span><span class="icount"><span class="smsplit"[^>]*>12 \+ <b>8<\/b><\/span>/.test(lh) && /Take 8 ration bars → Team cargo/.test(lh), "a body's 20 ration bars: split 12 + 8, \"Take 8 ration bars\"");
  INV_ACTIONS["sm-go"](w, lui);
  check((body.supplies.f_rationbar || 0) === 12 && (p.cargo.supplies.f_rationbar || 0) === f0 + 8, `8 taken, 12 left on the body (${lui.invMsg})`);
  w.combat = null;

  // The inventory window (a destination hook that really moves them).
  const v = createWorld({ seed: seed + 1, factionCount: 5 });
  v.cards.length = 0;
  const hv = hub(v);
  clearFood(hv); hv.stock.f_rationbar = 120;
  const s = atBase(v, hv.id)[0];
  const loc = `armory:${hv.id}:sup:f_rationbar`;
  let packed = 0;
  const builtIn2 = INV_STACK_DESTS.splice(0);
  INV_STACK_DESTS.push((state, u2, l) => (l === loc ? [{ id: "pack", label: "Pack", fit: 8, err: "", move: (state2, ui2, qty) => { hv.stock.f_rationbar -= qty; packed += qty; return `Packed ${qty}.`; } }] : []));
  const iui = { inv: { sid: s.id }, invSel: null, invMsg: "" };
  INV_ACTIONS["inv-click"](v, iui, { loc });
  STACK_CHANGE["sm-qtyset"](v, iui, { value: "5" });
  STACK_ACTIONS["sm-split"](v, iui);
  STACK_ACTIONS["sm-part"](v, iui, { part: "a" });
  INV_ACTIONS["sm-go"](v, iui);
  const ih = render(v, iui);
  check(packed === 8 && (hv.stock.f_rationbar || 0) === 112 && /<span class="iname">Ration bar<\/span><span class="icount"><span class="smsplit"[^>]*><b>107<\/b> \+ 5<\/span>/.test(ih), `the stores' 120 split 115 + 5, the 115 picked, room for 8: 8 packed, 107 + 5 stay (${iui.invMsg})`);
  INV_ACTIONS["inv-click"](v, iui, { loc });
  STACK_ACTIONS["sm-join"](v, iui);
  check(/>Ration bar<\/span><span class="icount">×112</.test(render(v, iui)) && (hv.stock.f_rationbar || 0) + packed === 120, "Join: 112 again, none lost");
  INV_ACTIONS["inv-close"](v, iui);
  INV_STACK_DESTS.length = 0;
  INV_STACK_DESTS.push(...builtIn2);
}

console.log(`\n${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
