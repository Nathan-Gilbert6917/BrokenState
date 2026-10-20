// Base building's interface (src/ui/basemap.js, src/ui/storage.js, src/ui/inventory.js, src/ui/combat.js's layout
// mode; docs/base-building/plan.md Part C, the user's request 2026-10-19): the base map's layout panel with its Build
// list, the selected thing's card and the doorways, the no-build margin's hover line, the Storage tab and its mover,
// and the inventory window's container picker.
// Checks: the layout panel renders the five Build groups, a type that cannot be built is greyed out with the reason
// in its tooltip; pickType puts the type's name in the header card and a build at a free cell queues the job placed
// there (the panel lists it placed, the message says so); a cabin selected next to another shows Open a doorway,
// the link opens it and the card says so, Close the doorway comes back; the hover line over the margin; the Base map
// tab's text and the Construction tab's buttons; the Storage tab for a hub with a storehouse, crates and a parked
// car (every container, the mover moving 10 of a supply and an item, Move all food, Tidy up filling the containers,
// the warning that goods lie outside when the stock is more than the base's storage holds); the inventory window's picker putting a
// dropped item in the picked container (and the kept-in chip); and every data-action these screens render having a
// handler (the modules' tables, main.js's, and the layout mode's cb-deploy values in ui/combat.js).
// Usage: node tools/basebuilduitest.js [seed]
import { readFileSync } from "node:fs";
import { createWorld, hub, atBase, makeSurvivor } from "../src/sim/world.js";
import { registerCombatHandler, combatAct } from "../src/sim/combat.js";
import { BUILDINGS, addBuilding, count } from "../src/sim/buildings.js";
import { newItem, itemKg } from "../src/sim/inventory.js";
import { createVehicle } from "../src/sim/vehicles.js";
import * as BM from "../src/sim/basemap.js";
import * as CT from "../src/sim/containers.js";
import { baseMapTab, layoutPanel, layoutHover, BASEMAP_ACTIONS } from "../src/ui/basemap.js";
import { storageTab, STORAGE_ACTIONS, STORAGE_CHANGE } from "../src/ui/storage.js";
import { inventoryModal, invDrop, INV_ACTIONS, INV_CHANGE } from "../src/ui/inventory.js";
import { renderModal } from "../src/ui/ui.js";
import { BN_ACTIONS } from "../src/ui/basename.js"; // the base window's Rename (every tab carries it)
import { GB_ACTIONS } from "../src/ui/gunbuilder.js"; // the ⚙ on a gun in the inventory window
import { ARMV_ACTIONS, ARMV_INPUT } from "../src/ui/armoryview.js"; // the armory list's groups, view and find box

const seed = Number(process.argv[2] || 11);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
registerCombatHandler("bbu", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.hour = 24 * 3 + 12; return st; };
const rich = (base) => Object.assign(base.stock, { scrap: 999, parts: 99, buildmat: 99, electronics: 9, meds: 20 });
const asCamp = (base) => { base.tier = 0; base.camp = true; base.buildings = []; base.construction = []; delete base.plan; return base; }; // (tools/basebuildtest.js): a camp's view is its whole grid, margin and all
const keyOf = (b) => `b:${b.id}`;
const openView = (st, base, pick = null) => { globalThis.window = {}; try { return BM.openBaseMap(st, base.id, pick); } finally { delete globalThis.window; } };
const act = (st, a) => { globalThis.window = {}; try { return combatAct(st, a); } finally { delete globalThis.window; } };
const cui = () => ({ msg: "", storeView: null });
const freshUi = () => ({ started: true, baseView: null, baseMsg: "", inv: null, invSel: null, invMsg: "" });
// A cell of the view where the ghost fits, searched from the middle of the yard outwards.
function freeCell(st, b) {
  const F = b.deployPlan.fort;
  for (let r = 0; r < 60; r++) for (let gy = -r; gy <= r; gy += 2) for (let gx = -r; gx <= r; gx += 2) {
    if (Math.abs(gx) !== r && Math.abs(gy) !== r) continue;
    const x = gx + F.ox, y = gy + F.oy;
    if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
    const g = BM.ghostAt(st, b, x, y);
    if (g && g.ok) return [x, y];
  }
  return null;
}

// ---------- HTML checks (as tools/uitest.js) ----------
const BAD = /\b(undefined|NaN)\b|\[object [A-Za-z]+\]|\bnull\b/;
const VOID = new Set(["input", "br", "img", "hr", "meta", "link"]);
function scan(html, where) {
  const out = [];
  const text = html.replace(/<[^>]*>/g, " ");
  const m = BAD.exec(text);
  if (m) out.push(`${where}: "${m[0]}" in text near "${text.slice(Math.max(0, m.index - 50), m.index + 30).replace(/\s+/g, " ")}"`);
  for (const a of html.matchAll(/(data-[\w-]+|title|value)="([^"]*)"/g)) if (BAD.test(a[2])) out.push(`${where}: bad attribute ${a[1]}="${a[2].slice(0, 80)}"`);
  const stack = [];
  for (const t of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
    const tag = t[2].toLowerCase();
    if (VOID.has(tag) || t[3]) continue;
    if (!t[1]) stack.push(tag);
    else if (stack.pop() !== tag) { out.push(`${where}: unbalanced </${tag}>`); break; }
  }
  if (stack.length) out.push(`${where}: unclosed <${stack.join("> <")}>`);
  return out;
}
const actionsIn = (html) => [...html.matchAll(/<(\w+)([^>]*?)data-action="([^"]+)"([^>]*)>/g)].map((m) => ({ tag: m[1].toLowerCase(), action: m[3], attrs: m[2] + m[4] }));
const mainSrc = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const combatSrc = readFileSync(new URL("../src/ui/combat.js", import.meta.url), "utf8");
const inMain = (name) => new RegExp(`(^|[\\s{,])("${name}"|${/^[a-z]\w*$/i.test(name) ? name : "\\u0000"})\\s*:`, "m").test(mainSrc);
const CLICK = { ...BASEMAP_ACTIONS, ...STORAGE_ACTIONS, ...INV_ACTIONS, ...BN_ACTIONS, ...GB_ACTIONS, ...ARMV_ACTIONS };
const CHANGE = { ...STORAGE_CHANGE, ...INV_CHANGE, ...ARMV_INPUT };
// The layout mode's cb-deploy values ui/combat.js handles (d.v === "…" inside the b.layout block), and cb-store.
const layoutBlock = combatSrc.slice(combatSrc.indexOf('if (b.layout) { // the base map\'s layout mode'), combatSrc.indexOf('if (d.v === "start")'));
const CB_V = new Set([...layoutBlock.matchAll(/d\.v === "([\w-]+)"/g)].map((m) => m[1]));
const registered = (table) => mainSrc.includes(`Object.entries(${table})`);
function handlersOk(html, where) {
  const missing = [];
  for (const a of actionsIn(html)) {
    const isChange = a.tag === "select" || (a.tag === "input" && !/type="checkbox"/.test(a.attrs));
    if (a.action === "cb-deploy") { const v = (/data-v="([\w-]*)"/.exec(a.attrs) || [])[1]; if (!CB_V.has(v)) missing.push(`cb-deploy v=${v}`); continue; }
    if (a.action === "cb-store") { if (!mainSrc.includes('"cb-store"')) missing.push("cb-store"); continue; }
    if (isChange ? !(CHANGE[a.action] || inMain(a.action)) : !(CLICK[a.action] || inMain(a.action))) missing.push(`${a.action} (${isChange ? "change" : "click"})`);
  }
  check(!missing.length, `${where}: every data-action has a handler${missing.length ? ` (missing: ${[...new Set(missing)].join(", ")})` : ""}`);
}
const htmlOk = (html, where) => { const p = scan(html, where); check(!p.length, `${where}: clean HTML${p.length ? ` (${p.slice(0, 3).join(" | ")})` : ""}`); handlersOk(html, where); };

section("The layout panel: the Build list");
{
  const st = world();
  const h = hub(st);
  rich(h);
  addBuilding(h, "bunkhouse");
  check(!openView(st, h), "the base map opens");
  let b = st.combat;
  let html = layoutPanel(st, b, cui());
  htmlOk(html, "layout panel");
  for (const g of ["General buildings", "Fittings", "Buildings", "Yard things", "Defences"]) check(html.includes(`data-fold="bm:${g}"`), `the Build group "${g}" (a fold)`);
  check(/data-v="pickType" data-bt="gen_hut" (?!disabled)/.test(html) && /data-v="pickType" data-bt="gen_cabin" (?!disabled)/.test(html), "a hut and a cabin can be built (Build buttons live)");
  const bunks = /data-v="pickType" data-bt="bunks" disabled data-tip="([^"]*)"/.exec(html);
  check(!!bunks && /Needs a building to stand in/.test(bunks[1]), `bunk beds greyed out with why in the tooltip ("${bunks ? bunks[1] : "?"}")`);
  check(html.includes("Placed") && html.includes("Bunkhouse") && /data-v="select" data-k="b:\d+"/.test(html), "the Placed list: the bunkhouse, a click selects it");
  check(html.includes("Stores on the map") && html.includes('data-v="endLayout"'), "the stores and the Close button");
  // Pick a hut and build it.
  check(!act(st, { type: "pickType", bt: "gen_hut" }) && st.combat.layout.pickType === "gen_hut", "pickType gen_hut");
  b = st.combat;
  html = layoutPanel(st, b, cui());
  check(html.includes("Building: Hut") && html.includes("click where it goes") && /data-bt="" data-tip="Put it down/.test(html), "the header card: Building: Hut, click where it goes, Cancel puts it down");
  check(/bmrow on/.test(html) && html.includes(">Picked<"), "the picked type is lit in the list");
  const at = freeCell(st, b);
  check(!!at, `a free cell for it (${at})`);
  const n0 = h.construction.length;
  const err = act(st, { type: "build", x: at[0], y: at[1] });
  const job = h.construction.find((c) => c.type === "gen_hut");
  check(!err && h.construction.length === n0 + 1 && job && job.at, `a click builds: the hut queued and placed at ${job && job.at} (${err || "no error"})`);
  b = st.combat;
  html = layoutPanel(st, b, cui());
  check(st.combat.layout.msg.includes("Hut queued and placed") && html.includes("Hut queued and placed"), `the panel shows the result: "${st.combat.layout.msg}"`);
  check(html.includes("Hut (building)") && new RegExp(`data-k="c:${job.id}"[^>]*>[\\s\\S]*?placed`).test(html), "the Placed list has the hut's outline, placed");
  check(st.combat.layout.sel === `c:${job.id}` && html.includes("bmsel") && html.includes("Cancel the job"), "the new job is selected: its card with Cancel the job");
  check(h.stock.scrap === 999 - BUILDINGS.gen_hut.cost.scrap, "the cost was paid");
  act(st, { type: "endLayout" });
}

section("The no-build margin on a camp's map (its view is the whole grid)");
{
  const st = world(seed + 1);
  const h = asCamp(hub(st));
  rich(h);
  check(!openView(st, h), "the camp's map opens");
  check(!act(st, { type: "pickType", bt: "gen_hut" }) && st.combat.layout.pickType === "gen_hut", "a hut picked (a camp may build one)");
  const b = st.combat, F = b.deployPlan.fort;
  const mx = 3 + F.ox - BM.gridHalf(h), my = F.oy; // (the ghost is centred on the mouse: a hut over this cell stays on the map, in the margin)
  check(b.cells[my * b.w + mx].nb === 1 && !b.cells[F.oy * b.w + F.ox].nb, "a margin cell is marked in the view (c.nb), the middle is not");
  const g = BM.ghostAt(st, b, mx, my);
  check(g && !g.ok && g.why === BM.NO_BUILD_WHY, `the ghost over the margin is red: ${g && g.why}`);
  const refused = act(st, { type: "build", x: mx, y: my });
  check(refused === BM.NO_BUILD_WHY && !h.construction.length, "a click there builds nothing, with the reason");
  check(layoutPanel(st, st.combat, { msg: refused, storeView: null }).includes(BM.NO_BUILD_WHY), "the refusal shows in the panel");
  check(layoutHover(st, st.combat, { x: mx, y: my }, g).includes(BM.NO_BUILD_WHY), "and in the hover line under the ghost");
  check(!act(st, { type: "pickType", bt: null }), "Esc puts the type down");
  const hov = layoutHover(st, st.combat, { x: mx, y: my }, null);
  check(hov.includes("The no-build margin: nothing is built within 5 cells of the map's edge"), `with nothing picked the hover line says: "${hov.replace(/<[^>]*>/g, "")}"`);
  act(st, { type: "endLayout" });
}

section("The selected thing's card and the doorways");
{
  const st = world();
  const h = hub(st);
  rich(h);
  const A = addBuilding(h, "gen_cabin"), B = addBuilding(h, "gen_cabin");
  addBuilding(h, "bunks");
  check(!BM.placeItem(st, h, keyOf(A), 12, -12, 0) && !BM.placeItem(st, h, keyOf(B), 17, -12, 0), "two cabins side by side");
  check(!openView(st, h), "the map opens");
  check(!act(st, { type: "select", key: keyOf(A) }) && st.combat.layout.sel === keyOf(A), "the first cabin selected");
  let html = layoutPanel(st, st.combat, cui());
  htmlOk(html, "layout panel with a selection");
  check(html.includes("bmsel") && html.includes("Cabin 1") && html.includes("5 × 4") && html.includes("Placed by hand at 12, -12"), "its card: name, size, where it stands");
  check(html.includes("Inside:") && html.includes("Bunk beds") && /\d+ of 6 floor cells free/.test(html), `the fittings inside and the floor left (${(/(\d+ of 6 floor cells free)/.exec(html) || [])[1]})`);
  check(html.includes("Cabin 2") && new RegExp(`data-v="link" data-a="${keyOf(A)}" data-b="${keyOf(B)}" (?!disabled)`).test(html), "its neighbour with Open a doorway");
  check(html.includes('data-v="lift"') && html.includes('data-v="unplace"') && html.includes('data-v="demolish"') && html.includes(">Move<") && html.includes(">Auto<") && html.includes(">Demolish<"), "Move, Auto (placed by hand) and Demolish");
  check(new RegExp(`cbunit on" data-action="cb-deploy" data-v="select" data-k="${keyOf(A)}"`).test(html), "its row in the Placed list is lit");
  check(!act(st, { type: "link", a: keyOf(A), b: keyOf(B) }) && h.plan.links.length === 1, "Open a doorway links them");
  html = layoutPanel(st, st.combat, cui());
  check(html.includes("A doorway opened between them") && html.includes("Close the doorway") && html.includes("Doorway") && new RegExp(`data-v="unlink" data-a="${keyOf(A)}" data-b="${keyOf(B)}"`).test(html), "the card says the doorway is open, with Close the doorway");
  check(!act(st, { type: "unlink", a: keyOf(A), b: keyOf(B) }) && !h.plan.links.length && layoutPanel(st, st.combat, cui()).includes("Open a doorway"), "closed again");
  // A selection from the map, a second click lifts.
  const b = st.combat, F = b.deployPlan.fort;
  const e = BM.itemAtCell(st, b, 13 + F.ox, -11 + F.oy);
  check(e && e.it.key === keyOf(A), "a click on the cabin's cells finds it (itemAtCell)");
  check(layoutHover(st, b, { x: 13 + F.ox, y: -11 + F.oy }, null).includes("Selected: click again to lift"), "the hover line over the selected thing says a second click lifts it");
  check(!act(st, { type: "lift", key: keyOf(A) }) && st.combat.layout.pick === keyOf(A) && !A.at, "lifted (the second click)");
  check(layoutPanel(st, st.combat, cui()).includes("what stands inside moves with it"), "the pick card of a general building says what is inside moves with it");
  check(!act(st, { type: "pick", key: null }), "Esc puts it down");
  // Demolish from the map: a queued job is cancelled, a standing building pulled down (the question is ui/combat.js's).
  check(!act(st, { type: "select", key: keyOf(B) }) && !act(st, { type: "demolish", key: keyOf(B) }) && !h.buildings.includes(B) && st.combat.layout.sel == null, "Demolish pulls the second cabin down and clears the selection");
  act(st, { type: "endLayout" });
  // The Base map tab and the Construction tab.
  const ui = { ...freshUi(), baseView: { id: h.id, tab: "basemap" } };
  const tab = baseMapTab(st, h, ui);
  htmlOk(tab, "Base map tab");
  check(tab.includes("Build on the map") && tab.includes("General buildings") && tab.includes("doorway") && tab.includes(`${BM.NO_BUILD} cells`) && tab.includes("containers") && tab.includes("Storage tab"), "the tab says what the map is now: build on it, general buildings, doorways, the margin, the containers");
  for (const cx of ["buildings", "defenses"]) {
    const html2 = renderModal(st, { ...freshUi(), baseView: { id: h.id, tab: "construction", cx } });
    htmlOk(html2, `Construction (${cx})`);
    check(html2.includes(`data-action="bm-open" data-base="${h.id}" data-tab="construction"`) && html2.includes("Open the base map to build"), `the Construction tab's ${cx} pane has Open the base map to build`);
  }
  const ui2 = freshUi();
  BASEMAP_ACTIONS["bm-open"](st, ui2, { base: String(h.id), tab: "construction" });
  check(st.combat && st.combat.layout && ui2.mapFrom && ui2.mapFrom.tab === "construction", "the button opens the map, to come back to the Construction tab");
  act(st, { type: "endLayout" });
  check(renderModal(st, { ...freshUi(), baseView: { id: h.id, tab: "overview" } }).includes('data-tab="storage"'), "the base window has a Storage tab");
}

section("The Storage tab");
{
  const st = world();
  const h = hub(st);
  for (const t of ["storehouse", "crates", "crates"]) addBuilding(h, t);
  const car = createVehicle(st, "sedan", { kind: "base", baseId: h.id });
  h.stock.scrap = 300; h.stock.meds = 12; h.stock.ammo = 120;
  h.stock.f_beans = 40;
  h.armory.push(newItem("huntrifle"), newItem("bikehelmet"), newItem("vest"));
  const ui = { ...freshUi(), baseView: { id: h.id, tab: "storage" } };
  let html = storageTab(st, h, ui);
  htmlOk(html, "Storage tab");
  const L = CT.containersOf(st, h);
  const store = L.find((c) => c.type === "storehouse"), crate = L.find((c) => c.type === "crates"), carC = L.find((c) => c.key === `v:${car.id}`);
  check(!!store && !!crate && !!carC, `the containers: ${L.map((c) => c.label).join(", ")}`);
  for (const c of L) check(html.includes(`<b>${c.label}</b>`), `a card for ${c.label}`);
  check(html.includes("kg put away nowhere, inside wherever there is room") && html.includes("Put the rest away") && html.includes("Nothing lies outside"), "nothing assigned yet: the goods put away nowhere, inside the room (nothing outside)");
  check(html.includes("Move goods") && html.includes('data-action="st-from"') && html.includes('data-action="st-to"') && html.includes('data-action="st-tidy"'), "the mover and Tidy up");
  check(ui.storage.from === CT.LOOSE && ui.storage.to === store.key, `the mover starts from what is put away nowhere to the ${store.label}`);
  // Move 10 scrap and a rifle.
  STORAGE_CHANGE["st-qty"](st, ui, { value: "10", dataset: { k: "scrap" } });
  STORAGE_ACTIONS["st-move"](st, ui, { base: String(h.id), k: "scrap" });
  check(h.bins[store.key] && h.bins[store.key].scrap === 10 && /10 Scrap moved to Storehouse/i.test(ui.baseMsg), `10 scrap moved (${ui.baseMsg})`);
  const rifle = h.armory.find((it) => it.key === "huntrifle");
  STORAGE_ACTIONS["st-moveitem"](st, ui, { base: String(h.id), ai: String(h.armory.indexOf(rifle)) });
  check(rifle.store === store.key && /moved to Storehouse/.test(ui.baseMsg), `the rifle moved (${ui.baseMsg})`);
  html = storageTab(st, h, ui);
  check(html.includes("10 Scrap") && html.includes(rifle.name) && /Storehouse<\/b>[\s\S]*?\d+ \/ 2000 kg/.test(html), "the storehouse's card lists them with its bar");
  // Move all food to the crates; no food to a locker-kind.
  STORAGE_ACTIONS["st-pick"](st, ui, { base: String(h.id), w: "to", k: crate.key });
  STORAGE_ACTIONS["st-allfood"](st, ui, { base: String(h.id) });
  const inCrate = (h.bins[crate.key] || {}).f_beans || 0;
  check(inCrate > 0 && inCrate <= 40 && /of food/.test(ui.baseMsg), `Move all food: ${inCrate} cans of beans into the crates (${ui.baseMsg})`);
  // The car as a destination.
  STORAGE_ACTIONS["st-pick"](st, ui, { base: String(h.id), w: "to", k: carC.key });
  STORAGE_ACTIONS["st-move"](st, ui, { base: String(h.id), k: "meds" });
  check(h.bins[carC.key] && h.bins[carC.key].meds === 12, "all the meds into the car by hand");
  html = storageTab(st, h, ui);
  check(html.includes("Goods in a car stay on the base's books") && html.includes("a raid can loot the car"), "with goods in a car, the note about cars");
  // Tidy up fills the containers.
  STORAGE_ACTIONS["st-tidy"](st, ui, { base: String(h.id) });
  const loose = CT.containerByKey(st, h, CT.LOOSE), sum = CT.storageKg(st, h);
  check(loose.kg < 1 && sum.outside === 0 && sum.held > 0 && /Tidied up/.test(ui.baseMsg), `Tidy up: nothing left put away nowhere (${Math.round(loose.kg)} kg), ${Math.round(sum.held)} kg in the containers (${ui.baseMsg})`);
  check(h.bins[carC.key] && h.bins[carC.key].meds === 12, "what was put in the car stays there");
  html = storageTab(st, h, ui);
  check(html.includes("Nothing lies outside") && !html.includes("raiders take them first") && !html.includes("put away nowhere, inside"), "nothing outside, nothing put away nowhere");
  htmlOk(html, "Storage tab after tidying");
  // More stock than the containers hold: the warning says to build.
  h.stock.scrap = 20000;
  html = storageTab(st, h, ui);
  const sum2 = CT.storageKg(st, h);
  check(sum2.outside > 0 && html.includes("lie outside: they weather, and raiders take them first") && html.includes("The base's storage is too small for its goods"), `with ${Math.round(sum2.outside)} kg outside: the warning and the advice to build`);
  htmlOk(html, "Storage tab over capacity");
  // A camp has the tab too.
  check(renderModal(st, { ...freshUi(), baseView: { id: h.id, tab: "storage" } }).includes("Move goods"), "the base window renders the Storage tab");
}

section("The inventory window's container picker");
{
  const st = world();
  const h = hub(st);
  addBuilding(h, "storehouse");
  const s = atBase(st, h.id)[0] || (() => { const x = makeSurvivor(st); x.location = { kind: "base", baseId: h.id }; st.survivors.push(x); return x; })();
  s.gear.weapon = newItem("huntrifle");
  const store = CT.containersOf(st, h).find((c) => c.type === "storehouse");
  const ui = { ...freshUi(), inv: { sid: s.id, loot: false } };
  let html = inventoryModal(st, ui);
  htmlOk(html, "inventory window");
  check(html.includes('data-action="inv-storepick"') && html.includes("Anywhere (the game places it)") && html.includes(`value="${store.key}"`), "the storage box has the picker: Anywhere, the storehouse");
  INV_CHANGE["inv-storepick"](st, ui, { value: store.key, dataset: { base: String(h.id) } });
  check(ui.invStore[h.id] === store.key, "the pick is kept per base (ui.invStore)");
  const rifle = s.gear.weapon;
  invDrop(st, ui, `s:${s.id}:weapon`, `armory:${h.id}:list`);
  check(h.armory.includes(rifle) && rifle.store === store.key && !/kept anywhere/.test(ui.invMsg), `the rifle dropped into the armory is kept in the storehouse (${ui.invMsg || "no message"})`);
  html = inventoryModal(st, ui);
  check(html.includes('class="chip ikept"') && html.includes(`>${store.label}</span>`), "its tile carries a kept-in chip");
  htmlOk(html, "inventory window with the picker set");
  // Unequip to armory (inv-store) and a click on the box do the same.
  s.gear.armor = newItem("vest");
  ui.invSel = `s:${s.id}:armor`;
  INV_ACTIONS["inv-store"](st, ui, {});
  const vest = h.armory.find((it) => it.key === "vest");
  check(vest && vest.store === store.key, "Unequip to armory keeps the pick too");
  // No room: the move stays, the message says so.
  const small = CT.containersOf(st, h).find((c) => c.type === "storehouse");
  h.bins[store.key] = { scrap: Math.floor((small.cap - 1) / Math.max(0.001, CT.kgOf("scrap"))) };
  h.stock.scrap = Math.max(h.stock.scrap, h.bins[store.key].scrap);
  s.gear.weapon = newItem("shotgun");
  invDrop(st, ui, `s:${s.id}:weapon`, `armory:${h.id}:list`);
  const sg = h.armory.find((it) => it.key === "shotgun");
  check(sg && !sg.store && /No room in the storehouse/.test(ui.invMsg) && /kept anywhere/.test(ui.invMsg) && itemKg(sg) > 1, `a full container: the move is kept, the item anywhere, and the message says so ("${ui.invMsg}")`);
  INV_CHANGE["inv-storepick"](st, ui, { value: "", dataset: { base: String(h.id) } });
  check(!ui.invStore[h.id] && !inventoryModal(st, ui).includes("ikept"), "Anywhere again: no chips");
  check(count(h, "storehouse") === 1, "(the storehouse still stands)");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
