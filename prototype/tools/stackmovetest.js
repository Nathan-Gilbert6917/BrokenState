// The stack mover (ui/stackmove.js): one panel for moving part of a supply stack, on every screen that moves stacks.
// Checks the panel itself (amount, weight, how many fit, the warning past that, the destinations, the popover, Enter
// and Esc, the live slider), then each screen: the raid's search window (sim/raidloot.js raidMove), Loot the bodies
// (sim/inventory.js takeSupply, sim/stacks.js lootFit) and the inventory window (the stores as stack tiles, its
// destination hook). Moves move the amount chosen, never more than fits.
// Usage: node tools/stackmovetest.js [seed] [v]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { SUPPLIES } from "../src/sim/data.js";
import { launchExpedition, cargoRoom, unitsThatFit } from "../src/sim/parties.js";
import { createBattle, CELL, registerCombatHandler, unitAt } from "../src/sim/combat.js";
import { ensureInv } from "../src/sim/inventory.js";
import * as RL from "../src/sim/raidloot.js";
import { lootFit } from "../src/sim/stacks.js";
import { inventoryModal, INV_ACTIONS, INV_CHANGE, invDrop, INV_STACK_DESTS } from "../src/ui/inventory.js";
import { registerStackScreen, openStack, stackPanel, chosenQty, stackKey, stackInput, STACK_ACTIONS, STACK_CHANGE } from "../src/ui/stackmove.js";

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
    spec: () => ({ key: "food", have: T.have, from: "The shelf", dests: T.dests, to: "a" }),
    move: (s, ui, to, qty) => moved.push([to, qty]),
    cancel: () => { cancelled++; },
  });
  const ui = {};
  openStack(ui, "t");
  const w = SUPPLIES.food.weight;
  let h = stackPanel(st, ui, "t");
  check(/class="smove dock"/.test(h) && /The shelf/.test(h) && /active smto"[^>]*><span>Cargo</.test(h), "docked, with the stack's place and its destination in words");
  check(chosenQty(st, ui, "t") === 14 && /value="14"/.test(h), `default: what fits (14 of 20): ${chosenQty(st, ui, "t")}`);
  check(h.includes(`<b class="smkg">${kg1(14 * w)}</b> kg`), `the weight of the amount: ${kg1(14 * w)} kg`);
  check(/14 fit in Cargo now/.test(h) && /class="smfit good"/.test(h), "how many fit at the destination");
  check(/Move 14 food → Cargo/.test(h), "one clear button: Move 14 food → Cargo");
  check(/All <small>20<\/small>/.test(h) && /What fits <small>14<\/small>/.test(h) && /½ <small>10<\/small>/.test(h) && /data-v="one"/.test(h), "quick chips: 1, half, All, What fits");
  check(/data-action="sm-to" data-to="b"[^>]*>.*full/.test(h.replace(/\n/g, " ")), "a second destination, marked full");
  check(/type="range"[^>]*max="20"/.test(h) && /type="number"[^>]*max="20"/.test(h), "a slider and a number box, 1 to the stack");
  STACK_ACTIONS["sm-qty"](st, ui, { v: "all" });
  h = stackPanel(st, ui, "t");
  check(chosenQty(st, ui, "t") === 20 && /Only 14 fit in Cargo now: 6 stay/.test(h) && /class="smfit warn"/.test(h), "All 20: a warning that only 14 fit");
  check(/Move 14 food → Cargo/.test(h), "the button says what will move (14)");
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
  check(/active smto"[^>]*><span>Pack</.test(h) && /data-action="sm-go" disabled/.test(h) && /Nothing fits there/.test(h) && /The pack is full/.test(h), "picking a full destination: the button is off and says why");
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
  check(!/type="range"/.test(h) && /Move 1 food → Cargo/.test(h), "a stack of one: no slider, just the button");
  T.have = 0;
  check(stackPanel(st, ui, "t") === "", "an empty stack: no panel");
  // The slider moving: the panel follows without a redraw (stackInput).
  const node = (props = {}) => ({ textContent: "", className: "", value: "", style: {}, classList: { remove() {} }, ...props });
  const els = { ".smrange": node(), ".smkg": node(), ".smfit": node(), ".smbtn": node() };
  const other = node();
  const root = { dataset: { have: "20", fit: "14", unit: String(w), name: "food", to: "Cargo", verb: "Move" }, querySelector: (q) => els[q] || null, querySelectorAll: (q) => (q.includes("sm-qtyset") ? [other] : []) };
  const range = { dataset: { action: "sm-qtyset" }, value: "17", closest: () => root };
  check(stackInput(range) && other.value === "17" && els[".smkg"].textContent === kg1(14 * w) && /Only 14 fit/.test(els[".smfit"].textContent) && els[".smbtn"].textContent === "Move 14 food → Cargo" && /linear-gradient/.test(els[".smrange"].style.background), "the slider dragged to 17: number box, weight, warning and button follow");
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
  const box = boxWith(b, u, { food: 10 });
  const ui = { inv: { raid: true, uid: u.id, box: box.id }, invSel: null, invMsg: "" };
  const src = `rbox:${box.id}:sup:food`, me = `haul:${u.id}:list`;
  INV_ACTIONS["inv-click"](st, ui, { loc: src });
  let h = render(st, ui);
  check(/class="smove dock"/.test(h) && h.includes(`>${box.label}<`) && /\(carried\)/.test(h), `a stack clicked: the mover docks, from ${box.label} to ${u.name.split(" ")[0]} (carried)`);
  check(!/data-action="rl-qty"/.test(h) && !/class="qty"/.test(h), "the old quantity bar is gone");
  check(/Haul this turn/.test(h), "the haul time left shows under it");
  const fit = RL.supplyFit(st, u.id, src, me).n;
  check(chosenQty(st, ui, "raid") === Math.min(10, fit), `default: what fits (${chosenQty(st, ui, "raid")})`);
  STACK_CHANGE["sm-qtyset"](st, ui, { value: "4" });
  INV_ACTIONS["sm-go"](st, ui);
  check(u.haul.sup.food === 4 && box.contents.sup.food === 6 && !ui.invSel && !ui.stack, `Move 4: 4 carried, 6 left (${ui.invMsg})`);
  // The fast path: pick, set 1, click the destination.
  INV_ACTIONS["inv-click"](st, ui, { loc: src });
  INV_ACTIONS["sm-qty"](st, ui, { v: "one" });
  INV_ACTIONS["inv-click"](st, ui, { loc: me });
  check(u.haul.sup.food === 5 && box.contents.sup.food === 5, "pick, 1, then click Carried: 1 moves");
  // A drop: the popover asks; Enter moves what fits.
  invDrop(st, ui, src, me, false, false, { x: 300, y: 200 });
  h = render(st, ui);
  check(box.contents.sup.food === 5 && ui.stack && ui.stack.pop && /class="smove pop"/.test(h) && /Move 5 food →/.test(h), "a plain drop moves nothing yet: a popover at the drop, \"Move 5 food → …\"");
  check(stackKey(st, ui, key("Enter")) && u.haul.sup.food === 10 && !(box.contents.sup.food >= 1) && !ui.stack, "Enter: all 5 move");
  invDrop(st, ui, `haul:${u.id}:sup:food`, `rbox:${box.id}:list`, false, false, { x: 1, y: 1 });
  check(stackKey(st, ui, key("Escape")) && u.haul.sup.food === 10 && !ui.stack && !ui.invSel, "drop then Esc: nothing moves");
  invDrop(st, ui, `haul:${u.id}:sup:food`, `rbox:${box.id}:list`, true);
  check(u.haul.sup.food === 5 && box.contents.sup.food === 5 && !ui.stack, "Shift-drop: half, straight away");
  invDrop(st, ui, `haul:${u.id}:sup:food`, `rbox:${box.id}:list`, false, true);
  check(u.haul.sup.food === 4 && box.contents.sup.food === 6, "Ctrl-drop: one");
  INV_ACTIONS["inv-click"](st, ui, { loc: src }, { shiftKey: true });
  check(u.haul.sup.food === 10 && !(box.contents.sup.food >= 1), "Shift+click: all that fit, straight across");
  // Dropped on a teammate's paper doll: into their arms.
  const m = players(b)[1];
  standNext(b, m, u.x, u.y);
  invDrop(st, ui, `haul:${u.id}:sup:food`, `s:${m.sid}:pocket:0`, false, false, { x: 5, y: 5 });
  check(ui.stack && ui.stack.to === `haul:${m.id}:list`, `a stack dropped on a teammate's pocket: the popover sends it to their arms (${ui.stack && ui.stack.to})`);
  STACK_CHANGE["sm-qtyset"](st, ui, { value: "3" });
  INV_ACTIONS["sm-go"](st, ui);
  check(m.haul && m.haul.sup.food === 3 && u.haul.sup.food === 7, `handed 3 over (${ui.invMsg})`);
  // Several destinations: the searcher, the teammate, the container.
  INV_ACTIONS["inv-click"](st, ui, { loc: `haul:${u.id}:sup:food` });
  h = render(st, ui);
  check((h.match(/data-action="sm-to"/g) || []).length >= 2 && h.includes(`data-to="rbox:${box.id}:list"`) && h.includes(`data-to="haul:${m.id}:list"`), "a stack carried: the container and the teammate to pick from");
  INV_ACTIONS["sm-to"](st, ui, { to: `rbox:${box.id}:list` });
  INV_ACTIONS["sm-qty"](st, ui, { v: "all" });
  INV_ACTIONS["sm-go"](st, ui);
  check(!(u.haul.sup.food >= 1) && box.contents.sup.food === 7, "picked the container, All: 7 put back");
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
  const body = ensureInv({ name: "Raider", kind: "human", uid: 999, kit: null, supplies: { food: 9, scrap: 400 } });
  st.combat = { over: true, bodies: [body], setup: { partyId: p.id }, units: [], place: "A road", result: { outcome: "victory", loot: { supplies: {}, gear: [] } } };
  const ui = { inv: { sid: null, loot: true, body: 0 }, invSel: null, invMsg: "" };
  let html = render(st, ui);
  check(html.includes('data-loc="body:0:sup:food"') && html.includes('data-drag="body:0:sup:food"') && !/data-action="loot-sup"/.test(html), "the body's supplies are stack tiles (click or drag), no 1 / ½ buttons");
  const food0 = p.cargo.supplies.food || 0;
  INV_ACTIONS["inv-click"](st, ui, { loc: "body:0:sup:food" });
  html = render(st, ui);
  check(/class="smove dock"/.test(html) && /Take 9 food → Team cargo/.test(html) && />Raider</.test(html), "a stack clicked: the mover, \"Take 9 food → Team cargo\", from the body");
  INV_ACTIONS["sm-qty"](st, ui, { v: "half" });
  INV_ACTIONS["sm-go"](st, ui);
  check(p.cargo.supplies.food === food0 + 4 && body.supplies.food === 5 && !ui.stack, `½ then Take: 4 taken, 5 left (${ui.invMsg})`);
  // The fast path: pick, 1, click the cargo box.
  INV_ACTIONS["inv-click"](st, ui, { loc: "body:0:sup:food" });
  INV_ACTIONS["sm-qty"](st, ui, { v: "one" });
  INV_ACTIONS["inv-click"](st, ui, { loc: `cargo:${p.id}:list` });
  check(p.cargo.supplies.food === food0 + 5 && body.supplies.food === 4, "pick, 1, click the cargo: 1 taken");
  // A drop on the cargo: the popover; Enter takes.
  invDrop(st, ui, "body:0:sup:food", `cargo:${p.id}:list`, false, false, { x: 40, y: 40 });
  html = render(st, ui);
  check(body.supplies.food === 4 && /class="smove pop"/.test(html) && /Take 4 food → Team cargo/.test(html), "dropped on the cargo: a popover \"Take 4 food\"");
  STACK_CHANGE["sm-qtyset"](st, ui, { value: "2" });
  stackKey(st, ui, key("Enter"));
  check(body.supplies.food === 2 && p.cargo.supplies.food === food0 + 7, "2 typed, Enter: 2 taken");
  invDrop(st, ui, "body:0:sup:food", `cargo:${p.id}:list`, false, true);
  check(body.supplies.food === 1, "Ctrl-drop: one");
  INV_ACTIONS["inv-click"](st, ui, { loc: "body:0:sup:food" }, { shiftKey: true });
  check(!body.supplies.food && p.cargo.supplies.food === food0 + 9, "Shift+click: the rest");
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
  h.stock.food = 120;
  const s = atBase(st, h.id)[0];
  const ui = { inv: { sid: s.id }, invSel: null, invMsg: "" };
  let html = render(st, ui);
  const loc = `armory:${h.id}:sup:food`;
  check(/In the stores \(/.test(html) && html.includes('<span class="iname">120 Food</span>') && /islot store stack[^"]*still/.test(html) && !html.includes(`data-loc="${loc}"`), "the base's stores are stack tiles (nowhere to move them on their own: shown, not clickable)");
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
  check(/class="smove dock"/.test(html) && /Move 8 food →/.test(html) && /Only|8 fit in/.test(html), "the mover opens on it: what fits there (8)");
  INV_ACTIONS["sm-go"](st, ui);
  check(got[0] === 8 && ui.invMsg === "Packed 8." && !ui.stack && !ui.invSel, "Move: the hook's move gets the amount");
  invDrop(st, ui, loc, `s:${s.id}:pocket:0`, false, false, { x: 9, y: 9 });
  check(ui.stack && ui.stack.pop && /class="smove pop"/.test(render(st, ui)), "dragged and dropped: the popover");
  INV_STACK_DESTS.length = 0;
  ui.inv = null; ui.invSel = null;
}

console.log(`\n${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
