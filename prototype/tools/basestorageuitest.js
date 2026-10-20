// Base storage limits in the interface (2026-10-19, the user's request: "Add base storage limits, needing to craft
// simple storage boxes up to buildings of different sizes ... Camps start with no storage but using a vehicle you can
// use the storage of the truck as a storage unit until better storage is made. You can steal storage boxes like small
// safes (Carried only slot two hands) weapon cases etc. You can move your vehicle to any unoccupied tiles of the base
// view which it can fit."). The base window (renderModal, as tools/campbasetest.js) and the governor:
//   - the Overview's Storage row: used / cap kg, what lies outside in red with the hint to build storage;
//   - a camp's Camp tab: "No storage yet: park a vehicle here or build a storage box";
//   - the Vehicles tab: a parked car's "Storage: 650 kg while parked here" and its Move button (bm-open with the car's
//     key: the base map opens with it picked);
//   - the Armory tab: the Storage card (containers, kg used, what lies outside), "Outside: weathering" on an item lying
//     outside, "+15 kg storage" on an opened fire safe, "Both hands" on a sealed one (and in its short tip);
//   - the Construction tab: the storage buildings' kg;
//   - the autopilot (autopilot.js storageWish): a storage box at a camp whose goods lie outside, none when they fit;
//     the ladder by size (a box or crates at a shelter, crates or a shed at an outpost, the storehouse or a warehouse
//     at the main base for a big overflow), one at a time, and the hub's governor queuing it.
// Usage: node tools/basestorageuitest.js [seed]
import { createWorld, hub, atBase, newId } from "../src/sim/world.js";
import { BUILDINGS, addBuilding, queueBuild } from "../src/sim/buildings.js";
import { storageOf } from "../src/sim/basestorage.js";
import { carsAtBase } from "../src/sim/vehicles.js";
import { newItem } from "../src/sim/inventory.js";
import { makeBox, openBox } from "../src/sim/boxes.js";
import { hash01 } from "../src/sim/skills.js";
import { setAutopilot, governBase, storageWish, STORE_WISH } from "../src/sim/autopilot.js";
import { renderModal } from "../src/ui/ui.js";
import { BASEMAP_ACTIONS } from "../src/ui/basemap.js";
import { storageTags, storageCard } from "../src/ui/armoryview.js";
import { itemShortTip } from "../src/ui/itemlabels.js";

const SEED = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else { fail++; console.log(`  FAIL: ${what}`); } return !!ok; };
const section = (t) => console.log(t);
const W = () => { const st = createWorld({ seed: SEED, factionCount: 6 }); st.visitorsOff = true; return st; };
const ui = (baseView) => ({ started: true, speed: 0, tab: "bases", selected: -1, survivor: null, baseView, expedition: null, diary: null, roster: null, help: false });
const modal = (st, b, tab) => { st.cards.length = 0; return renderModal(st, ui({ id: b.id, tab })) || ""; };
const plain = (h) => String(h).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const asShelter = (b) => { b.tier = 0; delete b.camp; b.buildings = []; b.construction = []; };
const mkOutpost = (st, tile) => { const o = { id: newId(), tile, type: "outpost", name: "Test Outpost", stock: {}, radio: false, watchtower: false, buildings: [], construction: [], armory: [] }; st.bases.push(o); return o; };
const asCamp = (b) => { b.tier = 0; b.camp = true; b.buildings = []; b.construction = []; };
const parkAway = (st, b) => { for (const v of carsAtBase(st, b.id)) v.loc = { kind: "base", baseId: -1 }; };
const empty = (b) => { b.stock = {}; b.armory = []; };
const rollFn = (...k) => (...x) => hash01(SEED, "bsui", ...k, ...x);
// The HTML of an armory card whose name is `name` (from its opening tag to the next card).
const cardHtml = (html, name) => { const i = html.indexOf(`<span class="aname">${name}</span>`); if (i < 0) return ""; const s = html.lastIndexOf("<div class=\"acard", i); return html.slice(s, html.indexOf("<div class=\"acard", i) > 0 ? html.indexOf("<div class=\"acard", i) : i + 2000); };

// ======================================================================
section("The Overview's Storage row");
{
  const st = W(), h = hub(st);
  let html = modal(st, h, "overview");
  const s0 = storageOf(st, h);
  check(/>Storage<\/div>/.test(html) && plain(html).includes(`${Math.round(s0.used)} / ${Math.round(s0.cap)} kg`), `the row: used / cap kg (${Math.round(s0.used)} / ${s0.cap})`);
  check(!/kg outside/.test(html), "nothing outside at the start: no red line");
  h.stock.scrap = (h.stock.scrap || 0) + 2000; // 4000 kg more than the room
  const s = storageOf(st, h);
  html = modal(st, h, "overview");
  check(s.outsideKg > 0 && html.includes(`<span class="danger"`) && plain(html).includes(`${Math.round(s.outsideKg)} kg outside`), `goods outside: ${Math.round(s.outsideKg)} kg outside, in red`);
  check(/data-action="basetab" data-tab="construction"[^>]*>build storage</.test(html), "with the hint to build storage (to Construction)");
}

// ======================================================================
section("A camp: no storage yet");
{
  const st = W(), h = hub(st);
  asCamp(h); parkAway(st, h); empty(h);
  h.stock.scrap = 10;
  let html = modal(st, h, "camp");
  check(plain(html).includes("No storage yet: park a vehicle here or build a storage box"), "the Camp tab says so");
  check(plain(html).includes("Storage 20 / 0 kg") && plain(html).includes("20 kg outside"), "with what it keeps and what lies outside");
  html = modal(st, h, "overview");
  check(/no storage yet/.test(html), "the Overview row too");
  addBuilding(h, "storebox");
  html = modal(st, h, "camp");
  check(!plain(html).includes("No storage yet") && /Room: storage box 60/.test(plain(html)), `a storage box built: its room named (${(plain(html).match(/Room: [^<]{0,40}/) || [""])[0]})`);
}

// ======================================================================
section("The Vehicles tab: a parked car's storage and Move");
{
  const st = W(), h = hub(st);
  const truck = carsAtBase(st, h.id)[0];
  const html = modal(st, h, "vehicles");
  check(plain(html).includes("Storage: 650 kg while parked here"), "the pickup: Storage: 650 kg while parked here");
  const btn = `<button class="mini" data-action="bm-open" data-base="${h.id}" data-key="v:${truck.id}"`;
  check(html.includes(btn) && new RegExp(`data-key="v:${truck.id}"[^>]*>Move</button>`).test(html), "its Move button (bm-open with the car's key)");
  // The button's action (main.js dispatches BASEMAP_ACTIONS): the base map opens with the car picked.
  const u = ui({ id: h.id, tab: "vehicles" });
  BASEMAP_ACTIONS["bm-open"](st, u, { base: String(h.id), key: `v:${truck.id}`, tab: "vehicles" });
  check(!!st.combat && st.combat.layout && st.combat.layout.pick === `v:${truck.id}` && u.baseView === null, `the base map opens with it lifted (pick ${st.combat && st.combat.layout && st.combat.layout.pick})`);
  check(new RegExp(`data-key="v:${truck.id}" data-tab="vehicles"`).test(html) && (!u.mapFrom || u.mapFrom.tab === "vehicles"), "and closing the map comes back to the Vehicles tab");
  st.combat = null;
}

// ======================================================================
section("The Armory tab: the Storage card and the items' badges");
{
  const st = W(), h = hub(st);
  asCamp(h); parkAway(st, h); empty(h);
  h.stock.scrap = 30; h.stock.wood = 50;
  const bar = newItem("crowbar");
  h.armory.push(bar);
  let html = modal(st, h, "armory");
  const s = storageOf(st, h);
  check(/<h3[^>]*>Storage<\/h3>/.test(html) && html.indexOf(">Storage</h3>") < html.indexOf("Stored here"), "the Storage card at the top");
  check(plain(html).includes("No storage yet: park a vehicle here or build a storage box"), "no room: it says so");
  check(plain(html).includes(`${Math.round(s.outsideKg)} kg outside: weathering`) && /Supplies:.*scrap/i.test(plain(html)) && /Items \(1\): Crowbar/.test(plain(html)), "what lies outside: the kg, the supplies and the items");
  check(cardHtml(html, bar.name).includes("Outside: weathering") && /acard[^"]* outside/.test(cardHtml(html, bar.name)), "the crowbar's card: Outside: weathering");
  check(storageTags(st, h).tagsOf(0).some(([t]) => t === "Outside: weathering"), "storageTags by armory index: outside");
  // An opened fire safe is room; a sealed rifle case is an item, carried in both arms.
  const safe = makeBox("firebox", rollFn("safe"), "town");
  openBox(safe, { kind: "pry", item: newItem("crowbar") });
  safe.contents = []; safe.sup = {};
  const rc = makeBox("riflecase", rollFn("rc"), "town");
  rc.locked = true; delete rc.opened;
  h.armory.push(safe, rc);
  html = modal(st, h, "armory");
  const safeCard = cardHtml(html, safe.name);
  check(safeCard.includes("+15 kg storage"), `the opened fire safe: +15 kg storage`);
  check(safeCard.includes("Both hands") && safeCard.includes("Both hands: carried only"), "and Both hands (its tip: carried only)");
  check(cardHtml(html, rc.name).includes("Both hands"), "the sealed rifle case: Both hands");
  check(/Fireproof lock box/.test(plain(storageCard(st, h))) && /15 kg/.test(plain(storageCard(st, h))), "the card lists the opened box with its room");
  check(itemShortTip(rc, null, null, st).includes("Both hands: carried only"), "the short tip of a two-hands item says so");
  check(storageTags(st, h).tagsOf(1).some(([t]) => t === "+15 kg storage"), "storageTags by armory index: the box's room");
  // A hub's card: the core and the pickup with their room, nothing outside.
  const st2 = W(), h2 = hub(st2);
  const card = plain(storageCard(st2, h2));
  check(/Main house and cellar 1200 kg/.test(card) && /650 kg while parked/.test(card) && !/outside/.test(card), `a hub: its containers (${card.slice(0, 120)})`);
}

// ======================================================================
section("The Construction tab: the storage buildings' kg");
{
  const st = W(), h = hub(st);
  Object.assign(h.stock, { scrap: 999, parts: 99, buildmat: 20, wood: 99999 });
  const html = modal(st, h, "construction");
  for (const [t, kg] of [["shed", 600], ["storehouse", 2000], ["warehouse", 6000], ["crates", 150]]) {
    const i = html.indexOf(`<span class="gcard-title">${BUILDINGS[t].name}`);
    const end = html.indexOf(`<div class="gcard `, i + 10);
    check(i >= 0 && html.slice(i, end > 0 ? end : i + 3000).includes(`${kg} kg storage`), `${BUILDINGS[t].name}: ${kg} kg storage`);
  }
  asCamp(h);
  const camp = modal(st, h, "construction");
  const i = camp.indexOf(`<span class="gcard-title">${BUILDINGS.storebox.name}`);
  check(i >= 0 && camp.slice(i, i + 3000).includes("60 kg storage"), "a camp: the storage box, 60 kg storage");
}

// ======================================================================
section("The autopilot: a storage box at a camp whose goods lie outside");
{
  const st = W(), h = hub(st);
  st.noWanderers = true;
  asCamp(h); parkAway(st, h); h.farm = null;
  empty(h);
  Object.assign(h.stock, { scrap: 120, parts: 4, water: 40, wood: 2500 }); // wood: the storage box's and the hut's (2026-10-20)
  for (const s of atBase(st, h.id)) s.role = "build";
  setAutopilot(st, true, "balanced");
  // The governor queues one building a call; the yard's jobs are finished at once (never the step up).
  let found = false;
  for (let i = 0; i < 12 && !found; i++) {
    governBase(st, h);
    found = h.construction.some((c) => c.type === "storebox") || h.buildings.some((b) => b.type === "storebox");
    for (const c of h.construction.filter((j) => !BUILDINGS[j.type].tierUp)) { addBuilding(h, c.type); h.construction.splice(h.construction.indexOf(c), 1); }
  }
  check(found, `a storage box queued (${h.buildings.map((b) => b.type).join(", ")} | ${h.construction.map((c) => c.type).join(", ")})`);
  const queuedTwice = h.construction.filter((c) => c.type === "storebox").length <= 1;
  check(queuedTwice, "one at a time");
  // The goods all fit (the pickup parked here again): no storage box wanted.
  const st2 = W(), h2 = hub(st2);
  st2.noWanderers = true;
  asCamp(h2); h2.farm = null; empty(h2);
  Object.assign(h2.stock, { scrap: 120, parts: 4, water: 40 });
  setAutopilot(st2, true, "balanced");
  check(storageOf(st2, h2).outsideKg === 0, "the pickup holds the camp's goods");
  for (let i = 0; i < 12; i++) {
    governBase(st2, h2);
    for (const c of h2.construction.filter((j) => !BUILDINGS[j.type].tierUp)) { addBuilding(h2, c.type); h2.construction.splice(h2.construction.indexOf(c), 1); }
  }
  check(!h2.buildings.some((b) => b.type === "storebox"), `nothing outside: no storage box (${h2.buildings.map((b) => b.type).join(", ")})`);
}

// ======================================================================
section("The autopilot's storage ladder by the size of base");
{
  // A camp: a storage box.
  let st = W(), h = hub(st);
  asCamp(h); parkAway(st, h); empty(h); h.stock.scrap = 30; h.stock.wood = 50;
  let w = storageWish(st, h);
  check(w && w.type === "storebox", `a camp: a storage box (${w && w.type})`);
  queueBuild(st, h, "storebox");
  check(storageWish(st, h) === null, "one at a time: none while one is in the queue");
  // Too little outside: nothing.
  st = W(); h = hub(st); asCamp(h); parkAway(st, h); empty(h); h.stock.scrap = 2; // 4 kg
  check(storageOf(st, h).outsideKg < STORE_WISH.minKg && storageWish(st, h) === null, "a few kg outside: nothing wanted");
  // A shelter: a box for a little, storage crates for more.
  st = W(); h = hub(st); asShelter(h); parkAway(st, h); empty(h); h.stock.scrap = 87; h.stock.wood = 100; // 184 kg, room 150 (wood: the storage box's and the crates'
  w = storageWish(st, h);
  check(w && w.type === "storebox", `a shelter, 30 kg outside: a storage box (${w && w.type})`);
  h.stock.scrap = 145; // 300 kg: 150 outside
  w = storageWish(st, h);
  check(w && w.type === "crates", `a shelter, 150 kg outside: storage crates (${w && w.type})`);
  // An outpost: crates or a storage shed.
  st = W(); h = hub(st);
  const o = mkOutpost(st, h.tile + 1);
  Object.assign(o.stock, { scrap: 300, buildmat: 2, wood: 200 }); // 600 kg + 2 buildmat + 20 kg of wood, room 500
  w = storageWish(st, o);
  check(w && ["crates", "shed"].includes(w.type) && BUILDINGS[w.type].storeKg >= storageOf(st, o).outsideKg, `an outpost: ${w && w.type} for ${storageOf(st, o).outsideKg} kg outside`);
  o.stock.scrap = 500;
  w = storageWish(st, o);
  check(w && w.type === "shed", `an outpost, ${storageOf(st, o).outsideKg} kg outside: a storage shed (${w && w.type})`);
  // The main base: a big overflow, the storehouse (a warehouse once a Mechanics 2+ survivor and its part are there).
  st = W(); h = hub(st);
  Object.assign(h.stock, { scrap: (h.stock.scrap || 0) + 1200, parts: 0, buildmat: 10 });
  w = storageWish(st, h);
  check(w && w.type === "storehouse", `the main base, ${Math.round(storageOf(st, h).outsideKg)} kg outside: the storehouse (${w && w.type})`);
  h.stock.scrap += 2000; h.stock.parts = 5;
  for (const s of atBase(st, h.id)) s.skills.mechanics = Math.max(s.skills.mechanics || 0, 3);
  w = storageWish(st, h);
  check(w && w.type === "warehouse", `past the storehouse's 2000 kg: a warehouse (${w && w.type})`);
  // The hub's governor queues it (after its other wishes; the jobs finished at once).
  st = W(); h = hub(st);
  st.noWanderers = true;
  Object.assign(h.stock, { scrap: (h.stock.scrap || 0) + 1200, buildmat: 10, parts: 10 });
  setAutopilot(st, true, "balanced");
  let got = "";
  for (let i = 0; i < 40 && !got; i++) {
    governBase(st, h);
    const j = h.construction.find((c) => BUILDINGS[c.type] && BUILDINGS[c.type].storeKg);
    if (j) got = j.type;
    for (const c of h.construction.filter((x) => !BUILDINGS[x.type].tierUp && !(BUILDINGS[x.type] && BUILDINGS[x.type].storeKg))) { addBuilding(h, c.type); h.construction.splice(h.construction.indexOf(c), 1); }
  }
  check(!!got, `the main base's governor queues storage for the goods outside (${got || "nothing"})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
