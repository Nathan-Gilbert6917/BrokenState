// Hauling (src/sim/hauling.js; jobtrips.js, activity.js, noidle.js, economy.js shipFromOutposts, autopilot.js
// planRoles 5c / govHauling, groupbases.js / factions.js / parties.js / groupworks.js for the AI):
// - a standing order moves the right goods between two bases, at the hauler's weight and in the route's time;
// - the receiving base's storage room is kept to, the woodpile exempt;
// - a cart in the arms raises the load;
// - road events (tripevents.js) can hit a hauler;
// - local hauling brings scrap, stone (building materials) and the like in;
// - noidle's help uses hauling;
// - the governor sets an order and puts a hauler on a shortage;
// - an AI group with two bases hauls its outpost's goods on a convoy;
// - an outpost keeps its step-up materials.
// Usage: node tools/haultest.js [seed] (default 42)
import { createWorld, hub, atBase, makeSurvivor, newId } from "../src/sim/world.js";
import { newItem } from "../src/sim/inventory.js";
import { setAutopilot, governRoles } from "../src/sim/autopilot.js";
import { describeActivity } from "../src/sim/activity.js";
import { jobTripsHour } from "../src/sim/jobtrips.js";
import { storageOf } from "../src/sim/basestorage.js";
import { foodIn } from "../src/sim/foods.js";
import { addDays } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { gatherJob } from "../src/sim/buildings.js";
import * as HL from "../src/sim/hauling.js";
import * as NI from "../src/sim/noidle.js";
import * as TE from "../src/sim/tripevents.js";
import { homesOf, gatherStores, spreadStores } from "../src/sim/groupbases.js";
import { placeMembers } from "../src/sim/members.js";

const SEED = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const world = (s = SEED) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.landOff = true; return st; };
const atHour = (st, h) => { st.hour = Math.floor(st.hour / 24) * 24 + 24 * 3 + h; };
const person = (st, base, role = "haul") => { const s = makeSurvivor(st); s.location = { kind: "base", baseId: base.id }; s.health = 100; s.mood = 70; s.role = role; s.conditions = []; st.survivors.push(s); return s; };
// An outpost two or three tiles from the hub on dry land.
function outpost(st, extra = {}) {
  const h = hub(st);
  const tile = Object.keys(st.tiles).map(Number).find((t) => { const d = st.grid.distance(h.tile, t); const T = st.tiles[t]; return d >= 2 && d <= 3 && T.terrain !== "water" && !T.bridge && !st.bases.some((b) => b.tile === t) && (T.owner == null || T.owner === "player"); });
  const o = { id: newId(), tile, type: "outpost", name: "Riverbend", stock: { water: 20 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [], ...extra };
  st.bases.push(o);
  return o;
}
const homeAll = (st) => { for (const s of st.survivors) { delete s.trip; delete s.tripNext; delete s.haulNext; } };
// Runs the job trips hour by hour from hour h0 for n hours.
const run = (st, n) => { for (let i = 0; i < n; i++) { jobTripsHour(st); st.hour++; } };

section("1. A standing order moves the right goods at the hauler's weight, in the route's time");
{
  const st = world();
  const h = hub(st), o = outpost(st);
  for (const s of atBase(st, h.id)) s.role = "guard";
  const s = person(st, h);
  h.stock.scrap = 400; h.stock.meds = 30;
  o.stock.scrap = 0;
  HL.addHaulOrder(st, { from: h.id, to: o.id, what: "scrap", mode: "send", qty: 100 });
  atHour(st, 7); // after breakfast (06:00: eating.js)
  const cap = HL.haulCap(st, h, s);
  const p = HL.planHaul(st, h, s, st.hour);
  check(!!p && p.dest === o, `a trip planned to ${o.name} (${p ? `${Math.round(p.outKg)} kg, ${p.outH.toFixed(1)} h out, ${p.backH.toFixed(1)} h back` : "none"})`);
  check(cap.kg >= 20 && cap.kg <= 45 && !cap.cart, `on foot, no cart: ${cap.kg} kg (the Heavy band)`);
  const before = h.stock.scrap;
  run(st, 1);
  const t = s.trip;
  check(!!t && t.job === "haul" && t.to === o.id, "out on a haul trip");
  check(t && Math.abs((t.out.sup.scrap || 0) * 2 - Math.min(cap.kg, 300 * 2)) <= 2, `it took ${t ? t.out.sup.scrap : 0} scrap (${t ? Math.round(HL.goodsKg(t.out)) : 0} kg) of the 300 over the keep`);
  check(h.stock.scrap === before - (t ? t.out.sup.scrap : 0) && (h.stock.meds === 30), "out of the hub's stock; the meds left alone");
  check(t && Math.abs(t.workEnd - t.leave - HL.HAUL.loadH - p.outH - HL.HAUL.unloadH) < 0.05, "the trip's time is the route's (travelHours at the load's pace)");
  check(/Hauling \d+ kg scrap to Riverbend|Loading/.test(describeActivity(st, s).text), `activity: "${describeActivity(st, s).text}"`);
  st.hour = Math.ceil(t.workEnd) - 1;
  run(st, 2);
  check((o.stock.scrap || 0) === t.out.sup.scrap - ((t.ret && t.ret.sup.scrap) || 0), `delivered: ${o.name} has ${o.stock.scrap} scrap`);
  st.hour = Math.ceil(t.home) - 1;
  run(st, 2);
  check(!s.trip || s.trip !== t, "home again");
}

section("2. Storage room at the far end is kept to; the woodpile is exempt");
{
  const st = world(SEED + 1);
  const h = hub(st), o = outpost(st);
  for (const s of atBase(st, h.id)) s.role = "guard";
  const s = person(st, h);
  s.gear.carry = newItem("handcart");
  o.stock.scrap = 245; // 490 of the outpost's 500 kg
  h.stock.scrap = 500; h.stock.wood = 3000;
  HL.addHaulOrder(st, { from: h.id, to: o.id, what: "scrap", mode: "send", qty: 0 });
  HL.addHaulOrder(st, { from: h.id, to: o.id, what: "wood", mode: "send", qty: 1000 });
  atHour(st, 7);
  run(st, 1);
  const t = s.trip;
  const free = 500 - 490;
  check(t && (t.out.sup.scrap || 0) * 2 <= free + 0.01, `scrap within the outpost's free room (${t ? t.out.sup.scrap : 0} scrap for ${free} kg)`);
  check(t && (t.out.sup.wood || 0) > 100, `wood past the room: the woodpile is exempt (${t ? t.out.sup.wood : 0} wood)`);
  st.hour = Math.ceil(t.workEnd);
  run(st, 1);
  check(storageOf(st, o).outsideKg < 1, `nothing left outside at ${o.name} (${storageOf(st, o).outsideKg} kg)`);
}

section("3. A cart raises the load");
{
  const st = world(SEED + 2);
  const h = hub(st);
  const s = person(st, h);
  const bare = HL.haulCap(st, h, s).kg;
  h.armory.push(newItem("handcart"));
  const cart = HL.haulCap(st, h, s);
  check(!!cart.cart && cart.kg > bare * 2.5, `a hand cart from the armory: ${cart.kg} kg against ${bare} kg`);
}

section("4. Road events can hit a hauler");
{
  const st = world(SEED + 3);
  const h = hub(st), o = outpost(st);
  for (const s of atBase(st, h.id)) s.role = "guard";
  const s = person(st, h);
  st.autopilot = true; // events resolve at once
  h.stock.scrap = 400;
  HL.addHaulOrder(st, { from: h.id, to: o.id, what: "scrap", mode: "send", qty: 0 });
  atHour(st, 7);
  run(st, 1);
  const t = s.trip;
  t.evr = 1;
  t.ev = { at: t.arrive + 0.1, seed: 12345, force: { kind: "find", find: 0 } };
  const n0 = TE.evStats(st).n;
  run(st, 2);
  check(TE.evStats(st).n === n0 + 1, "a find on the road (tripevents.js) fired on the haul trip");
  const s2 = person(st, h);
  st.hour = Math.floor(st.hour / 24) * 24 + 24 + 7;
  run(st, 1);
  const t2 = s2.trip;
  if (t2) {
    t2.evr = 1;
    t2.ev = { at: t2.arrive + 0.1, seed: 777, force: { kind: "lost", hours: 1.5 } };
    const home0 = t2.home;
    run(st, 2);
    check(t2.home >= home0 - 0.01 && TE.evStats(st).kinds.lost >= 1, "lost on the way: hours gone");
  } else check(false, "a second hauler set out");
}

section("5. Local hauling brings scrap, stone and the like in");
{
  const st = world(SEED + 4);
  st.landOff = false;
  const h = hub(st);
  for (const s of atBase(st, h.id)) s.role = "guard";
  const s = person(st, h);
  h.stock.scrap = 0; h.stock.buildmat = 0; h.stock.carparts = 0;
  atHour(st, 7);
  const lw = HL.localWork(st, h);
  check(!!lw, `local work with nothing to move: ${lw ? lw.text : "none"}`);
  for (let d = 0; d < 6; d++) { atHour(st, 7); st.hour += d * 24; run(st, 12); }
  const got = (h.stock.scrap || 0) + (h.stock.buildmat || 0) + (h.stock.carparts || 0);
  check(got > 0, `six days: +${h.stock.scrap || 0} scrap, +${h.stock.buildmat || 0} building materials, +${h.stock.carparts || 0} car parts`);
  check(describeActivity(st, s).kind !== "idle", `the hauler is not idle ("${describeActivity(st, s).text}")`);
}

section("6. noidle's help uses hauling");
{
  const st = world(SEED + 5);
  st.landOff = false;
  const h = hub(st);
  for (const s of atBase(st, h.id)) s.role = "guard";
  const m = person(st, h, "medic"); // nobody hurt: no work
  h.construction = [];
  h.stock.wood = 20000;
  atHour(st, 10);
  check(NI.HELP_ORDER.includes("haul"), "haul is in the help order");
  NI.helpHour(st);
  check(NI.helpingAs(m) != null, `the medic helps (${NI.helpingAs(m)})`);
  const base = h;
  check(HL.helpHaulOpen(st, base, 10, 0), "local hauling is open to helpers");
}

section("7. The governor: an order and a hauler for a shortage");
{
  const st = world(SEED + 6);
  const h = hub(st), o = outpost(st);
  for (let i = 0; i < 3; i++) person(st, o, "farm");
  for (let i = 0; i < 4; i++) person(st, h, "farm");
  for (const k of Object.keys(o.stock)) if (k !== "water") o.stock[k] = 0;
  addDays(h, 300); // plenty at the hub: HAUL.foodPlenty days for its ten (foodIn counts person-days)
  setAutopilot(st, true);
  atHour(st, 7);
  HL.govHauling(st);
  const ord = HL.haulOrders(st).find((x) => x.from === h.id && x.to === o.id && x.what === "food");
  check(!!ord && ord.gov, `a food order hub → ${o.name} (${ord ? HL.orderText(st, ord) : "none"}; the hub has ${Math.round(foodIn(h.stock))} person-days)`);
  check(HL.haulOrders(st).some((x) => x.from === o.id && x.to === h.id && x.what === "surplus"), "and the outpost's surplus order (the shipping's rule)");
  governRoles(st, h);
  check(atBase(st, h.id).some((s) => s.role === "haul"), `a hauler at the hub (${atBase(st, h.id).map((s) => s.role).join(", ")})`);
}

section("8. An AI group with two bases moves goods on a haul convoy");
{
  const st = world(SEED + 7);
  const f = st.factions.find((x) => x.alive && x.bases && x.bases.length);
  if (!f) check(false, "a group");
  else {
    const t2 = Object.keys(st.tiles).map(Number).find((t) => { const d = st.grid.distance(f.bases[0], t); const T = st.tiles[t]; return d >= 2 && d <= 3 && T.terrain !== "water" && !T.bridge && T.owner == null; });
    f.bases.push(t2);
    placeMembers(st, f); // some of its people move in (the stores go out by who lives where: groupbases.js spreadPlan)
    const H = homesOf(st, f);
    f.stock.scrap = (f.stock.scrap || 0) + 600;
    gatherStores(st, f);
    spreadStores(st, f);
    HL.groupHaulDaily(st, f);
    const p = st.parties.find((q) => q.owner === f.id && q.haulTo === t2);
    check(!!p && Object.keys(p.goods.supplies).length > 0, `a haul convoy to their outpost (${p ? Object.entries(p.goods.supplies).map(([k, q]) => `${q} ${k}`).join(", ") : "none"}; ${f.haulDay ? f.haulDay.crewDays : 0} crew-days)`);
    if (p) {
      const before = H[t2].stock.scrap || 0;
      const carried = p.goods.supplies.scrap || 0;
      HL.haulConvoyArrive(st, p);
      check((H[t2].stock.scrap || 0) === before + carried, "unloaded into the outpost's stores on arrival");
    }
  }
}

section("9. An outpost keeps its step-up materials");
{
  const st = world(SEED + 8);
  const h = hub(st), o = outpost(st, { tier: 0, camp: false });
  person(st, o, "haul");
  const job = gatherJob("outpost_up");
  job.paid = { scrap: 5, buildmat: 0, wood: 50 };
  o.construction.push(job);
  o.stock.scrap = 40; o.stock.wood = 300; o.stock.buildmat = 2;
  HL.addHaulOrder(st, { from: o.id, to: h.id, what: "all", mode: "send", qty: 0 });
  const w = Object.fromEntries(HL.pairWants(st, o.id, h.id));
  check((w.scrap || 0) <= 40 - 15 + 0.01 && (w.wood || 0) <= 300 - 150 + 0.01 && !(w.buildmat > 0), `the step up's 15 scrap, 150 wood and 2 building materials stay (sending ${w.scrap || 0} scrap, ${w.wood || 0} wood, ${w.buildmat || 0} building materials)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
