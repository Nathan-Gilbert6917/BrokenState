// Upkeep per head (src/sim/upkeep.js, economy.js): what a base uses up a day is a rate per person × the people fed
// there. Checks: food and water scale with the people living at a base; people sent out on a team stop eating the
// base's food and eat the team's (one ration a person a day); prisoners in the cells, guests you shelter and a supply
// convoy holding at the base are counted in the base's food and water (and eat fresh, then preserved food); short
// rations count everyone fed from the stores; an outpost feeds its own people from its own stock and keeps a reserve
// by its heads; the governor's days of food count everyone fed; per-building drains (a generator's fuel, spoilage)
// do not change with the people; the UI lines show per head × heads (base panel, Farming tab, alerts, top bar).
// Usage: node tools/upkeeptest.js [seed]
import { createWorld, hub, atBase, residents, makeSurvivor, newId } from "../src/sim/world.js";
import { basesDaily, foodOutlook, waterOutlook, waterNeed, eatPerDay, foodForecast, farmOutput, drinkRate, RATION_DAYS } from "../src/sim/economy.js";
import { UPKEEP, foodUse, mouthsAt, useText, coldFactor, perHeadText } from "../src/sim/upkeep.js";
import { econStats } from "../src/sim/farming.js";
import { launchExpedition, partyMembers, rationsPerHour } from "../src/sim/parties.js";
import { prisonersDaily, takePrisonersAt, PRISON } from "../src/sim/prisoners.js";
import { visitorsDaily } from "../src/sim/visitors.js";
import { supplyDaily } from "../src/sim/supply.js";
import { addBuilding } from "../src/sim/buildings.js";
import { POWER, powerStatus, refreshPower } from "../src/sim/power.js";
import { foodStore, edibleFood } from "../src/sim/storage.js";
import { reserveStatus, foodTarget } from "../src/sim/autopilot.js";
import { DOG } from "../src/sim/hubevents.js";
import { foodLine, waterLine, upkeepLine, waterUseText } from "../src/ui/farming.js";
import { renderLeft, renderTopbar } from "../src/ui/ui.js";
import { computeAlerts } from "../src/ui/alerts.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.visitorsOff = true; return st; };
const plain = (s) => { s.traits = []; s.conditions = []; s.perks = []; return s; };
// A quiet hub: everyone resting (no farming, scavenging or hunting), healthy, plenty of everything.
function quietHub(st) {
  const h = hub(st);
  for (const s of atBase(st, h.id)) { plain(s); s.role = "rest"; s.station = null; s.health = 100; s.mood = 80; }
  Object.assign(h.stock, { food: 500, water: 70, scrap: 300, parts: 30, fuel: 40, meds: 20, ammo: 50, jars: 40, preserved: 0 });
  return h;
}
const addPerson = (st, base) => { const s = plain(makeSurvivor(st, 1)); s.location = { kind: "base", baseId: base.id }; s.role = "rest"; s.health = 100; st.survivors.push(s); return s; };
const eatenToday = (st) => { const e = econStats(st).eaten; basesDaily(st); return econStats(st).eaten - e; };

// ---------- 1. food and water scale with the people at the base ----------
{
  console.log("Per head × heads");
  const st = W();
  const h = quietHub(st);
  const n = residents(st, h.id).length;
  const use = foodUse(st, h);
  check(use.heads === n && use.groups.length === 1 && use.groups[0].n === n, `everyone living at the hub is counted (${n})`);
  check(near(use.rate, Math.round(UPKEEP.food * coldFactor(st) * 100) / 100) && near(use.total, n * UPKEEP.food * coldFactor(st)), `food: ${n} × ${use.rate} = ${use.total}`);
  check(near(eatPerDay(st, h), use.residents) && near(foodOutlook(st, h).eat, use.total), "eatPerDay and the outlook use the same per-head numbers");
  check(near(foodForecast(st, h), farmOutput(st, h) - use.total), "the food forecast is the farms less per head × heads");
  const wn = waterNeed(st, h);
  check(wn.n === n && near(wn.people, Math.round(n * drinkRate(st) * 10) / 10), `water: ${n} × ${wn.rate} = ${wn.people}`);
  // Twice the people: twice the food and water (nothing else changes).
  const extra = [];
  for (let i = 0; i < n; i++) extra.push(addPerson(st, h));
  const use2 = foodUse(st, h);
  check(near(use2.total, 2 * use.total), `twice the people eat twice as much (${use.total} → ${use2.total})`);
  check(near(waterNeed(st, h).people, Math.round(2 * n * drinkRate(st) * 10) / 10), "and drink twice as much");
  // The daily tick eats exactly that.
  const ate = eatenToday(st);
  check(near(ate, use2.residents, 1e-6), `the daily tick eats per head × heads (${Math.round(ate * 100) / 100} for ${2 * n})`);
  const ate1 = (() => { for (const s of extra) s.location = { kind: "errand", baseId: h.id, until: 99999 }; return eatenToday(st); })();
  check(near(ate1, foodUse(st, h).residents, 1e-6) && ate1 < ate * 0.6, `people away on an errand do not eat here (${Math.round(ate1 * 100) / 100})`);
}

// ---------- 2. people on a team eat the team's supplies ----------
{
  console.log("Teams");
  const st = W();
  const h = quietHub(st);
  const ppl = atBase(st, h.id);
  const n = residents(st, h.id).length;
  const crew = ppl.filter((s) => !s.leader).slice(0, 2);
  const dest = st.tiles.find((t) => t.loc && st.grid.distance(t.id, h.tile) >= 3 && st.grid.distance(t.id, h.tile) <= 6);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: dest.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 10 } });
  check(!res.error, `a team of two leaves (${res.error || "ok"})`);
  const p = st.parties.find((x) => partyMembers(st, x).some((m) => m.id === crew[0].id));
  check(residents(st, h.id).length === n - 2 && foodUse(st, h).heads === n - 2, `the hub feeds ${n - 2} now`);
  const food0 = h.stock.food, team0 = p.supplies.food;
  const hourly = rationsPerHour(st, p);
  check(hourly >= 2 / 24 - 1e-9 && hourly <= (2 / 24) * 2, `the team eats about one ration a person a day (${(hourly * 24).toFixed(2)} a day for 2)`);
  const ate = eatenToday(st);
  check(near(ate, foodUse(st, h).residents, 1e-6) && h.stock.food < food0 && p.supplies.food === team0, `the hub's daily meal is for those at home (${Math.round(ate * 100) / 100}); the team's packs are not touched by it`);
}

// ---------- 3. prisoners, guests, a holding convoy and the dog ----------
{
  console.log("Prisoners, guests, convoy crew, the dog");
  const st = W();
  const h = quietHub(st);
  const n = residents(st, h.id).length;
  const f = st.factions[0];
  takePrisonersAt(st, f, h, 2);
  const m = mouthsAt(st, h);
  check(m.prisoners === 2 && m.heads === n + 2, `two prisoners counted (${m.heads} fed)`);
  const use = foodUse(st, h);
  const pg = use.groups.find((g) => g.key === "prisoners");
  const pr = PRISON.FOOD * PRISON.RATIONS[PRISON.RATION_DEFAULT].share; // their rations: Short by default (prisoners.js)
  check(pg && pg.n === 2 && near(pg.total, 2 * pr * coldFactor(st)), `prisoners eat ${pr} each on Short rations × the cold (${pg && pg.total})`);
  check(near(waterNeed(st, h).prisoners, Math.round(2 * drinkRate(st) * 10) / 10) && waterNeed(st, h).nPrisoners === 2, "and drink as anyone");
  // prisonersDaily takes their food from the base (fresh, then preserved).
  h.stock.food = 0; h.stock.preserved = 10;
  const esc0 = { ...PRISON.ESCAPE };
  for (const k of ["guarded", "unguarded", "shed"]) PRISON.ESCAPE[k] = 0; // the meal under test, not the dice of an escape
  prisonersDaily(st);
  Object.assign(PRISON.ESCAPE, esc0);
  check(near(h.stock.preserved, 10 - 2 * pr * coldFactor(st), 1e-6), `prisoners eat preserved food when the fresh is gone (${h.stock.preserved} left)`);
  // Guests sheltering: three travellers.
  h.stock.food = 0; h.stock.preserved = 20;
  st.visitors = [{ id: 9001, kind: "explorers", phase: "sheltered", shelterBase: h.id, size: 3, shelterUntil: st.hour + 72, done: {} }];
  const use2 = foodUse(st, h);
  const gg = use2.groups.find((g) => g.key === "guests");
  check(gg && gg.n === 3 && near(gg.total, 3 * UPKEEP.guest * coldFactor(st)), `three guests counted (${gg && gg.total})`);
  check(waterNeed(st, h).nGuests === 3 && waterNeed(st, h).guests > 0, "guests in the water need");
  check(near(foodOutlook(st, h).eat, use2.total) && foodOutlook(st, h).heads === n + 5, "the food outlook counts residents, prisoners and guests");
  visitorsDaily(st);
  check(near(h.stock.preserved, 20 - 3 * UPKEEP.guest * coldFactor(st), 1e-6), `guests eat preserved food when the fresh is gone (was free before) (${h.stock.preserved} left)`);
  st.visitors = [];
  // A supply convoy holding here eats from the base first, fresh then preserved.
  h.stock.food = 0; h.stock.preserved = 10;
  const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, 2);
  const job = { id: 7001, originId: h.id, destId: h.id, crewIds: crew.map((s) => s.id), deliver: [], pickup: [], status: "out", repeat: 0 };
  const party = { id: 7002, owner: "player", kind: "convoy", routeKind: "supply", phase: "holding", destBaseId: h.id, members: crew.map((s) => s.id), supplies: { food: 0, water: 0 }, cargo: { supplies: {}, gear: [] }, path: [h.tile], idx: 0 };
  for (const s of crew) s.location = { kind: "party", partyId: party.id };
  job.partyId = party.id;
  st.parties.push(party);
  (st.supplyRuns || (st.supplyRuns = [])).push(job);
  check(mouthsAt(st, h).crew === 2 && foodUse(st, h).groups.some((g) => g.key === "crew" && g.n === 2), "a holding convoy's crew is counted");
  check(waterNeed(st, h).nCrew === 2, "and drinks here");
  supplyDaily(st);
  check(near(h.stock.preserved, 10 - 2 * UPKEEP.crew * coldFactor(st), 1e-6), `the crew eats the base's preserved food (${h.stock.preserved} left)`);
  st.parties.splice(st.parties.indexOf(party), 1);
  st.supplyRuns.splice(st.supplyRuns.indexOf(job), 1);
  for (const s of crew) s.location = { kind: "base", baseId: h.id };
  // The dog.
  h.dog = { name: "Rex", since: 1 };
  const dg = foodUse(st, h).groups.find((g) => g.key === "dog");
  check(dg && near(dg.total, DOG.food) && foodUse(st, h).heads === n + 2, `the dog eats ${DOG.food} (not a head)`);
  // Short rations: the week counts everyone fed here.
  delete h.dog;
  st.prisoners = [];
  takePrisonersAt(st, f, h, 4);
  const resWeek = foodUse(st, h).residents * RATION_DAYS, allWeek = foodUse(st, h).total * RATION_DAYS;
  h.stock.food = Math.round((resWeek + allWeek) / 2); h.stock.preserved = 0;
  basesDaily(st);
  check(h.rationing, `short rations when the stock covers the residents' week but not everyone's (${Math.round(resWeek)} < ${Math.round((resWeek + allWeek) / 2)} < ${Math.round(allWeek)})`);
}

// ---------- 4. outposts feed their own people from their own stock ----------
{
  console.log("Outposts");
  const st = W();
  const h = quietHub(st);
  const tile = st.tiles.find((t) => t.terrain === "plains" && !t.loc && st.grid.distance(t.id, h.tile) === 3) || st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 3);
  const o = { id: newId(), tile: tile.id, type: "outpost", name: "Test Outpost", stock: { food: 200, water: 40, fuel: 0, meds: 0, ammo: 0, parts: 0, scrap: 0, preserved: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  st.bases.push(o);
  const staff = atBase(st, h.id).filter((s) => !s.leader).slice(0, 3);
  for (const s of staff) s.location = { kind: "base", baseId: o.id };
  const hubUse = foodUse(st, h), oUse = foodUse(st, o);
  check(oUse.heads === 3 && hubUse.heads === residents(st, h.id).length, `the outpost feeds 3, the hub ${hubUse.heads}`);
  const ate = eatenToday(st);
  check(near(ate, hubUse.residents + oUse.residents, 1e-6), `each base eats for its own people (${Math.round(ate * 100) / 100})`);
  // The outpost keeps a reserve by its heads and ships the rest: a day past the short-rations line (economy.js
  // RATION_DAYS + 1, so it is not rationing while the hub is full) + 6.
  const keepDays = RATION_DAYS + 1;
  check(o.stock.food <= Math.ceil(foodUse(st, o).total * keepDays) + 6 + 1 && o.stock.food >= Math.ceil(foodUse(st, o).total * keepDays) + 6 - 1, `the outpost keeps ${keepDays} days for its 3 + 6 (${o.stock.food})`);
  check(!o.rationing, "the outpost is not on short rations");
  takePrisonersAt(st, st.factions[0], o, 2);
  o.stock.food = 200;
  basesDaily(st);
  check(o.stock.food >= Math.ceil(foodUse(st, o).total * 3) + 6 - 1 && foodUse(st, o).heads === 5, `with two prisoners it keeps more (${o.stock.food} for 5)`);
}

// ---------- 5. the governor's days of food count everyone fed ----------
{
  console.log("Governor targets");
  const st = W();
  const h = quietHub(st);
  const r0 = reserveStatus(st, h);
  takePrisonersAt(st, st.factions[0], h, 3);
  st.hour += 1; // a fresh memo
  const r1 = reserveStatus(st, h);
  check(r1.food.target > r0.food.target && near(r1.food.target, Math.round(foodTarget(st, h) * mouthsAt(st, h).heads), 1), `three prisoners raise the food target (${r0.food.target} → ${r1.food.target})`);
  check(r1.water.target >= r0.water.target, `and the water target (${r0.water.target} → ${r1.water.target})`);
}

// ---------- 6. per-building drains do not follow the people ----------
{
  console.log("Per-building drains");
  const st = W();
  const h = quietHub(st);
  const ppl = atBase(st, h.id);
  addBuilding(h, "generator"); // no operator (machines-2): the morning's refuelling fills its tank
  const shop = addBuilding(h, "machine_shop");
  ppl[1].role = "operate"; ppl[1].station = shop.id; ppl[1].skills.mechanics = 6;
  st.hour = Math.ceil(st.hour / 24) * 24 + 8;
  const fuel0 = h.stock.fuel;
  refreshPower(st, h);
  const ps = powerStatus(st, h);
  check(ps.fuelPerDay === POWER.genFuel, `a running generator burns ${POWER.genFuel} fuel a day`);
  for (let i = 0; i < 6; i++) addPerson(st, h);
  check(powerStatus(st, h).fuelPerDay === POWER.genFuel, "six more people: the generator still burns the same");
  refreshPower(st, h);
  check(h.stock.fuel === fuel0 - POWER.tank, "and its tank is filled once for the day");
  const sp0 = foodStore(st, h).spoil;
  for (let i = 0; i < 6; i++) addPerson(st, h);
  check(near(foodStore(st, h).spoil, sp0), "spoilage goes by the food stored, not the people");
}

// ---------- 7. UI lines ----------
{
  console.log("UI lines");
  const st = W();
  const h = quietHub(st);
  const n = residents(st, h.id).length;
  takePrisonersAt(st, st.factions[0], h, 1);
  const o = foodOutlook(st, h);
  const t = useText(o.use);
  check(t.includes(perHeadText(n, "people", o.perHead)) && /1 prisoner × /.test(t), `food text: ${t}`);
  check(foodLine(st, h).text.includes(`eaten ${t} a day`) && foodLine(st, h).tip.includes(t), "the food line and its tooltip show per head × heads");
  const wt = waterUseText(waterOutlook(st, h).need);
  check(wt.includes(`${n} people × `) && /1 prisoner × /.test(wt) && waterLine(st, h).tip.includes(wt), `water text: ${wt}`);
  const u = upkeepLine(st, h);
  check(u.short.startsWith(`${n + 1} fed here`) && u.tip.includes(t), `upkeep line: ${u.short}`);
  const left = renderLeft(st, { tab: "bases" });
  check(left.includes(">Upkeep<") && left.includes(`${n} people × `), "the Bases list has the Upkeep row");
  check(renderTopbar(st, { speed: 1, scale: 1 }).includes(`${n} people × `), "the top bar's food tooltip shows per head × heads");
  h.stock.food = 5; h.stock.preserved = 0;
  const al = computeAlerts(st).find((a) => a.key === `food:${h.id}`);
  check(al && al.tip.includes(useText(foodOutlook(st, h).use)), `the food alert shows it (${al ? al.tip.slice(0, 80) : "no alert"})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
