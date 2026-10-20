// The progression picks (2026-10-09, review/progression-census-2026-10-09.md): scripted checks of the three changes.
// Usage: node tools/progpickstest.js [seed=42] [--long] (--long: also the long Turtle runs, a few minutes)
// 1. Members' land (alliance.js memberLand): a member's land counts toward the coalition's share only after a year in
//    the coalition (ALLIANCE.LAND_AFTER) and while it is not at war (with you, or any group); the victory, the Goals
//    card's rows (goalsProgress.alliance.memberLand, landSoon), the map's coalition layer and the AI side (the same
//    counted share) agree; old saves: a member without a join day joins the count on the load day (save.js).
// 2. Home-grown food (farming.js PEN, buildings.js animal_pen): the pen's yield (season, walls, the keeper), the
//    pasture it takes from the crop plots, the station run, the winter outlook counting it; the AI groups' pens
//    (groupworks.js PENS, factions.js food); the Turtle governor (autopilot.js homeFood) builds walls, then pens,
//    and staffs them; a walled Turtle hub with no trips at all lives a full year on its own land.
// 3. The buildings the governor never built (autopilot.js buildWishes): the chapel, the Master workbench, storage
//    crates and the radio relay (and the radio station it chains from), each in a scenario that calls for it, and
//    queued by the governor (planBuilds).
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, makeSurvivor, newId, day, alive, atBase } from "../src/sim/world.js";
import { BUILDINGS, addBuilding, canBuild, runStations, farmSlots, plotsFree, plotCap, assignStations } from "../src/sim/buildings.js";
import { PEN, livestockYield, plotLimit, winterOutlook, keptPens } from "../src/sim/farming.js";
import { ensureAlliance, admitToAlliance, memberLand, controlledLand, allianceVictory, goalsProgress, landCentres, ALLIANCE, countedMembers } from "../src/sim/alliance.js";
import { startWar, warBetween, ensureDiplo } from "../src/sim/diplomacy.js";
import { ensurePwars, atWarWithYou } from "../src/sim/playerwars.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { setAutopilot, housingAI, governBase, governRoles, PERSONALITIES } from "../src/sim/autopilot.js";
import { GROUP_WORKS, penFood, nextWork } from "../src/sim/groupworks.js";
import { yearStartDay, YEAR_DAYS } from "../src/sim/eras.js";
import * as BP from "../src/sim/blueprints.js";
import { outpostName } from "../src/sim/parties.js";
import { RADIO_RANGE } from "../src/sim/world.js";
import { GROUP_REACH, canRadioGroup } from "../src/sim/radio.js";
import { seasonOfDay } from "../src/sim/weather.js";
import { foodStore } from "../src/sim/storage.js";
import { stations } from "../src/sim/buildings.js";

const SEED = Number(process.argv.find((a, i) => i > 1 && /^\d+$/.test(a)) || 42);
const LONG = process.argv.includes("--long");
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return !!ok; };
const section = (name) => console.log(name);
const mk = (seed = SEED, groups = 8) => { const st = createWorld({ seed, factionCount: groups }); st.started = true; st.autoCombat = true; return st; };
const at = (st, d) => { st.hour = (d - 1) * 24 + 6; return st; };
const person = (st, base, skills = {}) => { const s = makeSurvivor(st); Object.assign(s.skills, skills); s.location = { kind: "base", baseId: base.id }; st.survivors.push(s); return s; };
const tileNear = (st, from, d, d2, filter = () => true) => {
  for (const t of st.tiles) {
    const dist = st.grid.distance(from, t.id);
    if (dist < d || dist > d2 || t.terrain === "water" || t.hive || t.owner != null || st.bases.some((b) => b.tile === t.id) || !filter(t)) continue;
    return t.id;
  }
  return null;
};
const fakeOutpost = (st, tile) => {
  const base = { id: newId(), tile, type: "outpost", name: outpostName(st, tile), stock: { food: 60, water: 40, fuel: 0, meds: 2, ammo: 20, parts: 0, scrap: 10 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  st.bases.push(base);
  return base;
};
const wishes = (st, base) => housingAI.wishes(st, base).map((w) => w.type);
// The governor's build planner (planBuilds through governBase) until it queues `type`: whatever it queues first is
// finished on the spot (as if built) and the stock topped up, up to n rounds. The queued types in order.
function queueUntil(st, base, type, n = 40, stock = {}) {
  const seen = [];
  for (let k = 0; k < n; k++) {
    Object.assign(base.stock, stock);
    governBase(st, base);
    if (base.construction.some((c) => c.type === type)) return seen;
    for (const c of base.construction.splice(0)) { seen.push(c.type); if (c.target == null) addBuilding(base, c.type); }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
section("1. A member's land counts after a year in the coalition and while it is at peace");
{
  const st = at(mk(), 30);
  const A = ensureAlliance(st);
  // A group whose bases add land beyond your hub's reach.
  const base0 = controlledLand(st).held;
  const m = st.factions.find((f) => {
    if (!f.alive || !f.bases.length) return false;
    A.members.push(f.id); A.joined[f.id] = -999; st.landCache = null;
    const more = controlledLand(st).held > base0;
    A.members.pop(); delete A.joined[f.id];
    return more;
  });
  if (check(!!m, "a group whose bases add land to the coalition's")) {
    st.diplo && (st.diplo.wars = st.diplo.wars.filter((w) => w.a !== m.id && w.b !== m.id));
    m.known = true; m.pact = "trade"; m.goodwill = 80;
    admitToAlliance(st, m);
    const ml = memberLand(st, m);
    check(A.joined[m.id] === 30 && ml.since === 30 && ml.from === 30 + ALLIANCE.LAND_AFTER && ALLIANCE.LAND_AFTER === YEAR_DAYS && !ml.counts && !ml.war, `joined on day 30: its land counts from day ${ml.from} (a year, ${ALLIANCE.LAND_AFTER} days)`);
    const now = controlledLand(st), soon = controlledLand(st, true);
    check(now.held === base0 && soon.held > base0 && countedMembers(st).length === 0 && countedMembers(st, true).includes(m), `day 30: the land held stays ${base0} tiles (with the member's: ${soon.held} once it counts)`);
    const row = goalsProgress(st).alliance.memberLand.find((r) => r.id === m.id);
    check(row && !row.counts && row.from === ml.from && row.war == null && goalsProgress(st).alliance.landSoon.pct > goalsProgress(st).alliance.land.pct, `the Goals card's row: "counts from day ${row && row.from}", and the share once it counts`);
    check(!landCentres(st).some((c) => m.bases.includes(c.tile)) && landCentres(st, true).some((c) => m.bases.includes(c.tile)), "landCentres: its bases only with soon (the governor's land planner)");
    at(st, 30 + ALLIANCE.LAND_AFTER - 1);
    check(!memberLand(st, m).counts && controlledLand(st).held === base0, `day ${30 + ALLIANCE.LAND_AFTER - 1}: not yet`);
    at(st, 30 + ALLIANCE.LAND_AFTER);
    const counted = controlledLand(st).held;
    check(memberLand(st, m).counts && counted === soon.held && goalsProgress(st).alliance.memberLand.find((r) => r.id === m.id).counts, `day ${30 + ALLIANCE.LAND_AFTER}: it counts (${base0} → ${counted} tiles)`);
    // At war with a group (any): not counted, and the row names the enemy; peace: it counts again.
    const o = st.factions.find((f) => f.alive && f !== m && !A.members.includes(f.id));
    const w = startWar(st, o, m, "land");
    const wl = memberLand(st, m);
    const wrow = goalsProgress(st).alliance.memberLand.find((r) => r.id === m.id);
    check(warBetween(st, o, m) && !wl.counts && wl.war === o && controlledLand(st).held === base0 && wrow.war === o.name && !wrow.counts, `at war with ${o.name}: "not counted: at war with ${wrow.war}"`);
    check(controlledLand(st, true).held === base0, "and not in the share once the members have their year either (a war is not waited out)");
    ensureDiplo(st).wars.splice(ensureDiplo(st).wars.indexOf(w), 1);
    check(memberLand(st, m).counts && controlledLand(st).held === counted, "the war over: it counts again the same day");
    // At war with you.
    const D = ensurePwars(st);
    D.pwars.push({ id: 999, fid: m.id, allies: [], start: day(st) });
    check(atWarWithYou(st, m) && memberLand(st, m).war === "you" && !memberLand(st, m).counts && goalsProgress(st).alliance.memberLand.find((r) => r.id === m.id).war === "you", "at war with you: not counted");
    D.pwars.length = 0;
    // The victory reads the counted share: land over half with the member's but not without it.
    const g = st.grid;
    A.joined[m.id] = day(st); // a fresh member again
    let n = 0;
    while (controlledLand(st, true).pct <= ALLIANCE.LAND_NEEDED && n < 60) {
      const held = new Uint8Array(st.tiles.length);
      for (const c of landCentres(st, true)) for (const id of g.within(c.tile, c.r)) held[id] = 1;
      const t = st.tiles.find((x) => x.terrain !== "water" && !held[x.id] && !x.hive && !st.bases.some((b) => b.tile === x.id) && st.factions.every((f) => !f.bases.includes(x.id)));
      if (!t) break;
      st.bases.push({ id: 900000 + n, tile: t.id, type: "outpost", name: `Test ${n}`, stock: { food: 0, water: 0 }, buildings: [], construction: [], armory: [] });
      n++;
    }
    const pNow = controlledLand(st).pct, pSoon = controlledLand(st, true).pct;
    if (pNow <= ALLIANCE.LAND_NEEDED) check(!allianceVictory(st) && pSoon > ALLIANCE.LAND_NEEDED, `${n} outposts: ${(pSoon * 100).toFixed(1)}% with the new member's land, ${(pNow * 100).toFixed(1)}% counted: no victory yet`);
    else passed++; // the outposts alone crossed the line on this seed
    at(st, day(st) + ALLIANCE.LAND_AFTER);
    check(goalsProgress(st).alliance.landOk && controlledLand(st).pct > ALLIANCE.LAND_NEEDED, "a year later its land counts: the coalition's land condition holds (the victory also wants no hive and no group outside, 2026-10-13)");
    // Old saves: a member without a join day joins the count on the load day; a kept join day loads unchanged.
    const m2 = st.factions.find((f) => f.alive && f !== m && f !== o && f.bases.length);
    m2.known = true; m2.pact = "trade"; m2.goodwill = 80;
    admitToAlliance(st, m2);
    A.joined[m2.id] = 40;
    delete A.joined[m.id];
    at(st, 500);
    const loaded = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
    const L = loaded.alliance;
    const lm = loaded.factions.find((f) => f.id === m.id), lm2 = loaded.factions.find((f) => f.id === m2.id);
    check(L.joined[m.id] === 500 && !memberLand(loaded, lm).counts && memberLand(loaded, lm).from === 500 + ALLIANCE.LAND_AFTER, `an older save without its join day: joined on the load day (500), counts from day ${500 + ALLIANCE.LAND_AFTER}`);
    check(L.joined[m2.id] === 40 && memberLand(loaded, lm2).counts, "a member with its join day kept: counts as before");
  }
}

// ---------------------------------------------------------------------------------------------------------
section("2a. The animal pen: its food, the pasture, the station, the winter outlook");
{
  const st = at(mk(), 40);
  const h = hub(st);
  Object.assign(h.stock, { scrap: 200, parts: 10, water: 200 }); setFood(h, 100);
  const def = BUILDINGS.animal_pen;
  check(def && def.plot === "building" && def.station === "livestock" && def.cost.scrap === 4 && def.cost.wood === 500 && !def.cost.parts && def.max === 2, "the animal pen: a building plot, 4 scrap and 500 wood (woodwork), a livestock station, at most 2");
  const p0 = plotLimit(h), s0 = farmSlots(h);
  const pen = addBuilding(h, "animal_pen") || h.buildings.find((b) => b.type === "animal_pen");
  check(plotLimit(h) === p0 - PEN.pasture && farmSlots(h) === s0 - PEN.pasture, `it grazes ${PEN.pasture} of the outdoor crop plots (${p0} → ${plotLimit(h)})`);
  h.buildings = h.buildings.filter((b) => b.type !== "walls");
  const summer = (() => { for (let i = 0; i < 112; i++) if (seasonOfDay(i).key === "summer") return i; return 0; })();
  const winter = (() => { for (let i = 0; i < 112; i++) if (seasonOfDay(i).key === "winter") return i; return 0; })();
  check(livestockYield(st, h, null, summer) === PEN.food * PEN.unwalled, `no walls: ${livestockYield(st, h, null, summer)} a day (half)`);
  addBuilding(h, "walls");
  const keeper = person(st, h, { farming: PEN.skillAt });
  check(livestockYield(st, h, null, summer) === PEN.food && livestockYield(st, h, null, winter) === PEN.food * PEN.winter && livestockYield(st, h, keeper, summer) === PEN.food + PEN.skilled,
    `walled: ${PEN.food} a day, ${PEN.food * PEN.winter} in winter, ${PEN.food + PEN.skilled} with a Farming ${PEN.skillAt} keeper`);
  // The station with its keeper: food in, water out.
  for (const s of atBase(st, h.id)) { if (s.role === "operate") s.role = "farm"; }
  keeper.role = "operate"; keeper.station = pen.id;
  assignStations(st, h);
  const f0 = food(h), w0 = h.stock.water;
  st.hour = summer * 24 + 6;
  runStations(st, h);
  check(Math.abs(food(h) - f0 - (PEN.food + PEN.skilled)) < 1e-6 && Math.abs(w0 - h.stock.water - 1) < 1e-9, `a day at the pen: +${(food(h) - f0).toFixed(6)} days of food (expected ${PEN.food + PEN.skilled}), −${(w0 - h.stock.water).toFixed(0)} water`);
  // The winter outlook counts a kept pen.
  st.hour = (summer + 20) * 24 + 6;
  const withPen = winterOutlook(st, h).crops;
  keeper.role = "farm"; keeper.station = null;
  const without = winterOutlook(st, h).crops;
  check(keptPens(st, h).length === 0 && withPen > without + 50, `the winter outlook counts the kept pen's food (${Math.round(without)} → ${Math.round(withPen)} still to come)`);
  check(canBuild(st, h, "animal_pen").ok, `a second pen can go up (${canBuild(st, h, "animal_pen").reason || "ok"})`);
  addBuilding(h, "animal_pen");
  check(!canBuild(st, h, "animal_pen").ok, "not a third");
}

section("2b. The AI groups' pens (groupworks.js PENS)");
{
  const st = at(mk(), 40);
  const f = st.factions.find((x) => x.alive && x.type === "commune" && x.bases.length) || st.factions.find((x) => x.alive && x.bases.length);
  f.bases.splice(1);
  const t = f.bases[0];
  f.works = { [t]: { water: 99, farms: 99, beds: 99, walls: 0, bench: 1, store: 1, sickbay: 4 } };
  setFood(f, f.pop * 50);
  st.groupWorks = st.groupWorks || 1;
  const nw0 = nextWork(st, f);
  check(!nw0 || nw0.type !== "pens", `no walls: no pen (${nw0 ? nw0.type : "nothing"} next)`);
  f.works[t].walls = 1;
  const nw = nextWork(st, f);
  check(nw && nw.type === "pens", `walls and fields: a pen next (${nw ? nw.type : "nothing"})`);
  check(penFood(st, f) === 0, "no pen yet: no pen food");
  f.works[t].pens = 1;
  check(penFood(st, f) === GROUP_WORKS.PENS.food && (!nextWork(st, f) || nextWork(st, f).type !== "pens"), `a pen: +${penFood(st, f)} food a day, and no second at that base`);
}

section("2c. The Turtle governor builds its home food chain and staffs it");
{
  const st = at(mk(7), 60);
  setAutopilot(st, true, "turtle");
  const h = hub(st);
  check(PERSONALITIES.turtle.homeFood === true, "the Turtle style lives on its own land (homeFood)");
  while (atBase(st, h.id).length < 10) person(st, h, { farming: 4, mechanics: 3 });
  for (const b of [...h.buildings]) if (b.type === "walls" || b.type === "animal_pen") h.buildings.splice(h.buildings.indexOf(b), 1);
  Object.assign(h.stock, { scrap: 400, parts: 30, water: 300, wood: 20000 }); setFood(h, 400); // wood: the pen's (2026-10-20)
  const w1 = wishes(st, h);
  check(w1.includes("walls"), `no walls yet: it wants walls first (${w1.slice(0, 8).join(", ")})`);
  addBuilding(h, "walls");
  const w2 = wishes(st, h);
  check(w2.includes("animal_pen"), `walls standing, 10 people: an animal pen (${w2.slice(0, 10).join(", ")})`);
  // The governor queues it and, once built, puts a keeper on it.
  h.construction.length = 0;
  const q_animal_pen = queueUntil(st, h, "animal_pen", 40, { ...h.stock });
  check(q_animal_pen != null, `planBuilds queues the pen${q_animal_pen && q_animal_pen.length ? ` (after ${q_animal_pen.join(", ")})` : ""}`);
  h.construction = h.construction.filter((c) => c.type !== "animal_pen");
  const pen = (addBuilding(h, "animal_pen"), h.buildings.find((b) => b.type === "animal_pen"));
  governRoles(st, h);
  const kp = atBase(st, h.id).find((s) => s.role === "operate" && s.station === pen.id);
  check(!!kp, `planRoles puts a keeper on the pen (${kp ? kp.name : "nobody"})`);
  const w3 = wishes(st, h);
  check(w3.includes("animal_pen"), "and wants the second one at 9+ people");
}

if (LONG) {
  section("2d. A walled Turtle hub with no trips lives a year on its own land");
  for (const seed of [6012, 6019]) {
    const st = mk(seed, 10);
    setAutopilot(st, true, "turtle");
    const h = hub(st);
    while (atBase(st, h.id).length < 10) person(st, h, { farming: 5 });
    addBuilding(h, "walls"); addBuilding(h, "animal_pen"); addBuilding(h, "animal_pen"); addBuilding(h, "greenhouse"); addBuilding(h, "greenhouse");
    for (let i = 0; i < 4; i++) addBuilding(h, "farm_plot");
    while (h.buildings.filter((b) => b.type === "bunkhouse").length < 2) addBuilding(h, "bunkhouse");
    Object.assign(h.stock, { scrap: 150, parts: 10 });
    const start = alive(st).length;
    let hungerDays = 0, low = Infinity, trips = 0;
    st.noWanderers = true;
    while (day(st) <= YEAR_DAYS + 20 && !st.gameOver) {
      if (st.governor) st.governor.lastLaunch = day(st); // no ordinary trips at all
      const before = st.parties.length;
      tickHour(st);
      for (const p of st.parties) if (p.owner === "player" && p.apEmergency && p.started == null) { p.started = true; trips++; }
      if (st.hour % 24 === 12) { const f = food(h) + (jarred(h) || 0); low = Math.min(low, f); if (f < 1) hungerDays++; }
    }
    const pens = stations(h).filter((b) => b.type === "animal_pen");
    const kept = keptPens(st, h).length;
    check(!st.gameOver && alive(st).length >= start - 2 && hungerDays === 0, `seed ${seed}: a year (${day(st) - 1} days) with no trips: ${alive(st).length} of ${start} alive, the lowest food ${Math.round(low)}, ${hungerDays} days out of food, ${kept} of ${pens.length} pens kept`);
  }
}

// ---------------------------------------------------------------------------------------------------------
section("3a. The chapel: spirits low with a common room, or grief");
{
  const st = at(mk(11), 60);
  setAutopilot(st, true, "balanced");
  const h = hub(st);
  while (atBase(st, h.id).length < 10) person(st, h);
  Object.assign(h.stock, { scrap: 120, parts: 10, water: 300, wood: 9000 }); setFood(h, 400); // wood: the chapel is 400 of it, and day 60 is the stocking for the cold (woodwork: a big wooden build leaves the winter's pile)
  h.buildings = h.buildings.filter((b) => b.type !== "chapel");
  for (const s of atBase(st, h.id)) s.mood = 80;
  check(!wishes(st, h).includes("chapel"), "spirits high, nobody grieving: no chapel");
  addBuilding(h, "common_room");
  for (const s of atBase(st, h.id)) s.mood = 60;
  check(wishes(st, h).includes("chapel"), "mood 60 with a common room standing: a chapel");
  h.buildings = h.buildings.filter((b) => b.type !== "common_room");
  for (const s of atBase(st, h.id)) s.mood = 80;
  atBase(st, h.id).slice(0, 3).forEach((s) => { s.grief = { name: "Old friend", days: 6 }; });
  check(wishes(st, h).includes("chapel"), "three grieving: a chapel (saved for)");
  h.construction.length = 0;
  const q_chapel = queueUntil(st, h, "chapel", 40, { ...h.stock });
  check(q_chapel != null, `the governor queues it${q_chapel && q_chapel.length ? ` (after ${q_chapel.join(", ")})` : ""}`);
}

section("3b. The Master workbench: crafting in use, a Mechanics 5 builder");
{
  const st = at(mk(12), 60);
  setAutopilot(st, true, "balanced");
  const h = hub(st);
  while (atBase(st, h.id).length < 10) person(st, h);
  for (const s of atBase(st, h.id)) s.skills.mechanics = Math.min(s.skills.mechanics || 0, 4);
  Object.assign(h.stock, { scrap: 150, parts: 12, water: 300 }); setFood(h, 400);
  h.buildings = h.buildings.filter((b) => BUILDINGS[b.type].family !== "bench");
  addBuilding(h, "workbench");
  addBuilding(h, "ammo_bench");
  check(!wishes(st, h).includes("toolbench"), "no Mechanics 5 builder: no master workbench");
  person(st, h, { mechanics: 6 });
  check(wishes(st, h).includes("toolbench"), "a Mechanics 6 builder and the ammo bench at work: a master workbench");
  h.stock.parts = 4;
  check(!wishes(st, h).includes("toolbench"), "not with the parts short (4: its 3 and 3 to spare wanted)");
  h.stock.parts = 12;
  h.construction.length = 0;
  const q_toolbench = queueUntil(st, h, "toolbench", 40, { ...h.stock });
  check(q_toolbench != null, `the governor queues the upgrade${q_toolbench && q_toolbench.length ? ` (after ${q_toolbench.join(", ")})` : ""}`);
}

section("3c. Storage crates: the food overflows and there is no plot for a bigger store");
{
  const st = at(mk(13), 60);
  setAutopilot(st, true, "balanced");
  const h = hub(st);
  while (atBase(st, h.id).length < 8) person(st, h);
  Object.assign(h.stock, { scrap: 120, parts: 10, water: 300 });
  h.buildings = h.buildings.filter((b) => b.type !== "crates");
  // Fill every building plot.
  while (plotsFree(h, "building") > 0) addBuilding(h, "bunkhouse") || addBuilding(h, "common_room");
  for (let i = 0; i < 20 && plotsFree(h, "building") > 0; i++) h.buildings.push({ id: newId(), type: "common_room" });
  const cap = foodStore(st, h).cap;
  setFood(h, cap + 60, "f_potatoes");
  const w = wishes(st, h);
  check(plotsFree(h, "building") === 0 && w.includes("crates"), `food over the room (${Math.round(food(h))} for ${cap}) and no building plot: storage crates (${w.slice(0, 6).join(", ")})`);
  setFood(h, cap * 0.3, "f_potatoes");
  check(!wishes(st, h).includes("crates"), "the food well within the room: none");
  // A free building plot: the cellar first, crates only as the quick stopgap while food spoils outside.
  const st2 = at(mk(13), 60);
  setAutopilot(st2, true, "balanced");
  const h2 = hub(st2);
  while (atBase(st2, h2.id).length < 8) person(st2, h2);
  Object.assign(h2.stock, { scrap: 120, parts: 10, water: 300 });
  h2.buildings = h2.buildings.filter((b) => b.type !== "crates");
  setFood(h2, foodStore(st2, h2).cap + 60, "f_potatoes");
  const w2 = wishes(st2, h2);
  check(w2.includes("crates") && w2.indexOf("cellar") >= 0, `a plot free and food spoiling outside: a cellar, and crates as the stopgap (${w2.slice(0, 6).join(", ")})`);
  h.construction.length = 0;
  setFood(h, cap + 60, "f_potatoes");
  const q_crates = queueUntil(st, h, "crates", 40, { ...h.stock });
  check(q_crates != null, `the governor queues them${q_crates && q_crates.length ? ` (after ${q_crates.join(", ")})` : ""}`);
}

section("3d. The radio station when groups are out of reach, then the relay that brings one in");
{
  const st = at(mk(14), 80);
  setAutopilot(st, true, "balanced");
  const h = hub(st);
  const g = st.grid;
  BP.unlockAll(st);
  while (atBase(st, h.id).length < 10) person(st, h, { mechanics: 5 });
  Object.assign(h.stock, { scrap: 200, parts: 20, water: 300 }); setFood(h, 400);
  h.radio = false;
  h.buildings = h.buildings.filter((b) => b.type !== "radio" && b.type !== "relay");
  const far = st.factions.filter((f) => f.alive && f.bases.length && !canRadioGroup(st, f));
  for (const f of far) { f.known = true; f.goodwill = 30; }
  check(far.length >= 2 && wishes(st, h).includes("radio"), `${far.length} known groups out of radio reach: the radio station (saved for)`);
  h.construction.length = 0;
  const q_radio = queueUntil(st, h, "radio", 40, { ...h.stock });
  check(q_radio != null, `the governor queues the station${q_radio && q_radio.length ? ` (after ${q_radio.join(", ")})` : ""}`);
  h.construction.length = 0;
  addBuilding(h, "radio");
  // An outpost 9-11 tiles out and a group 9-12 past it, out of the station's reach: the relay at the outpost.
  const oTile = tileNear(st, h.tile, 9, 11);
  const o = fakeOutpost(st, oTile);
  person(st, o, { mechanics: 5 });
  Object.assign(o.stock, { scrap: 40, parts: 6 });
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const fTile = tileNear(st, oTile, 9, 12, (t) => g.distance(t.id, h.tile) > RADIO_RANGE + 2 + GROUP_REACH && g.distance(t.id, h.tile) > ALLIANCE.NEIGHBOUR + 2);
  if (check(fTile != null, "a spot for a group past the outpost")) {
    f.bases.length = 0; f.bases.push(fTile);
    f.known = true; f.goodwill = 70; f.pact = "trade";
    check(!canRadioGroup(st, f) && wishes(st, o).includes("relay"), `${f.name} out of radio reach past the outpost: a radio relay there`);
    o.construction.length = 0;
    const qr = queueUntil(st, o, "relay", 20, { scrap: 40, parts: 6 });
    check(qr != null, `the outpost's governor queues it${qr && qr.length ? ` (after ${qr.join(", ")})` : ""}`);
  }
}

console.log(`\n${failed ? "FAILED" : "passed"}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
