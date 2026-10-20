// Wood: the fire does the work (fire-nights, 2026-10-19, user request "Wood still does not seem to be a highly
// needed and consuming item ... Having a camp uses wood. Boiling water uses fire wood, cooking uses wood. Bases
// use wood to heat up the survivors during the night ... make sure wood is a medium priority behind food and
// water, especially early game"). src/sim/upkeep.js HEAT.night / chillAt, heatRateAt; needs.js heatDaily; woodcutting.js
// fireDayBurn, campDayBurn, shelterFire, campFireHour, woodNeed (nights, dailyKeep, pressing), chillDaysAhead;
// autopilot.js woodCritical / planWood; factions.js groupHeatShare; staging.js shelterView; ui/ui.js (the Fire row).
// Usage: node tools/firenightstest.js [seed] (default 42).
import { createWorld, hub, atBase, residents, makeSurvivor, survivorById } from "../src/sim/world.js";
import { setFood } from "./foodkit.js";
import { heatUse, heatRate, heatRateAt, chillNightAt, HEAT, woodFor, mouthsAt } from "../src/sim/upkeep.js";
import { heatDaily, COLD } from "../src/sim/needs.js";
import * as Wd from "../src/sim/woodcutting.js";
import * as Weather from "../src/sim/weather.js";
import { launchExpedition, planPath, partyMembers, carried } from "../src/sim/parties.js";
import { startOrder, taskHour } from "../src/sim/orders.js";
import { setAutopilot, woodCritical } from "../src/sim/autopilot.js";
import { groupHeatShare, GROUP_WOOD } from "../src/sim/factions.js";
import { shelterView } from "../src/sim/staging.js";
import { renderModal } from "../src/ui/ui.js";
import { upkeepLine } from "../src/ui/farming.js";
import { RAW } from "../src/sim/water.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 42);
let passes = 0, fails = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const r1 = (v) => Math.round(v * 10) / 10;
const section = (t) => console.log(t);
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.visitorsOff = true; st.noWanderers = true; return st; };
const plain = (s) => { s.traits = []; s.conditions = []; s.perks = []; s.health = 100; s.mood = 70; s.hunger = 100; s.thirst = 100; return s; };
function quietHub(st) {
  const h = hub(st);
  for (const s of atBase(st, h.id)) { plain(s); s.role = "rest"; s.station = null; }
  Object.assign(h.stock, { water: 70, scrap: 300, parts: 30, fuel: 40, meds: 20, ammo: 50, jars: 40 });
  setFood(h, 500);
  return h;
}
// Days of each kind in the first two years: a warm day and night, a cool night above freezing, a freezing day.
function daysOf(st) {
  let warm = null, chill = null, cold = null;
  for (let d = 3; d < 112 * 2 && (warm == null || chill == null || cold == null); d++) {
    const t = Weather.dayMeanTemp(st, d), lo = Weather.dayLowTemp(st, d);
    if (warm == null && t >= 0 && lo >= HEAT.chillAt) warm = d;
    if (chill == null && t >= 0 && lo < HEAT.chillAt) chill = d;
    if (cold == null && t < 0 && t >= -8) cold = d;
  }
  return { warm, chill, cold };
}
const ui = (baseView) => ({ started: true, speed: 0, tab: "bases", selected: -1, survivor: null, baseView, expedition: null, diary: null, roster: null, help: false });
const text = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// ======================================================================
section("The heating rate: a freezing day, a cool night, a warm night");
{
  check(near(heatRateAt(-10, -15), HEAT.fuel * HEAT.bitter) && near(heatRateAt(-2, -6), HEAT.fuel), "below freezing: the day's heating as before (bitter × 1.5)");
  check(near(heatRateAt(5, 2), HEAT.fuel * HEAT.night) && near(heatRateAt(12, HEAT.chillAt - 0.1), HEAT.fuel * HEAT.night), `above freezing with a night under ${HEAT.chillAt}°C: the night's fire, ${HEAT.night} of a freezing day's`);
  check(heatRateAt(12, HEAT.chillAt) === 0 && heatRateAt(20, 14) === 0 && heatRateAt(10) === 0, "a warm night (or no low given): nothing");
  check(chillNightAt(5, 2) && !chillNightAt(-2, -6) && !chillNightAt(20, 14), "chillNightAt: a cool night above freezing only");
  check(near(woodFor(HEAT.fuel * HEAT.night), 4.5) && near(woodFor(HEAT.fuel), 15), `wood a head: ${woodFor(HEAT.fuel * HEAT.night)} a cool night, ${woodFor(HEAT.fuel)} a freezing day`);
}

// ======================================================================
section("A base above a shelter: the night's fire burns wood at midnight");
{
  const st = W();
  const h = quietHub(st);
  const { warm, chill, cold } = daysOf(st);
  const n = residents(st, h.id).length;
  check(warm != null && chill != null && cold != null, `the seasons give a warm day (${warm}), a cool night (${chill}) and a freezing day (${cold})`);
  st.hour = chill * 24 + 1;
  const u = heatUse(st, h);
  check(u.night && near(u.each, HEAT.fuel * HEAT.night) && near(u.wood, n * 4.5), `a cool night (low ${Weather.dayLowTemp(st)}°C): ${u.wood} wood for ${n} (4.5 a head)`);
  check(/night's fire/.test(u.text) && /wood a day/.test(u.text), `its text says so: "${u.text}"`);
  check(/night's fire/.test(upkeepLine(st, h).heating), `the Upkeep line too: "${upkeepLine(st, h).heating}"`);
  h.stock.wood = 300; h.stock.fuel = 10;
  heatDaily(st, h);
  check(near(h.stock.wood, 300 - n * 4.5) && h.stock.fuel === 10 && !h.cold && near(h.heat.wood, r1(n * 4.5)), `midnight: ${r1(n * 4.5)} wood burned, no fuel, nobody cold (${h.stock.wood} left)`);
  // A warm night: nothing.
  st.hour = warm * 24 + 1;
  heatDaily(st, h);
  check(heatUse(st, h).total === 0 && near(h.stock.wood, 300 - n * 4.5) && !h.cold, "a warm night: nothing burned");
  // No wood or fuel on a cool night: cold, at the night's share of a freezing day's cost.
  st.hour = chill * 24 + 1;
  h.stock.wood = 0; h.stock.fuel = 0;
  const ppl = residents(st, h.id).map(plain);
  const m0 = ppl.map((s) => s.mood), hp0 = ppl.map((s) => s.health);
  heatDaily(st, h);
  check(near(h.cold, HEAT.night, 0.011) && ppl.every((s, i) => near(s.mood, m0[i] - COLD.mood * HEAT.night, 0.05) && near(s.health, hp0[i] - COLD.hp * HEAT.night, 0.05)), `no wood on a cool night: cold ${h.cold} (mood −${r1(COLD.mood * HEAT.night)}, health −${r1(COLD.hp * HEAT.night)} each: ${HEAT.night} of a freezing day's)`);
  check(/cold through the night/.test(st.log[0].text), `and the log says it was the night ("${st.log[0].text.slice(0, 90)}…")`);
  // A freezing day: the whole of it, as before.
  st.hour = cold * 24 + 1;
  const ppl2 = residents(st, h.id).map(plain);
  heatDaily(st, h);
  check(h.cold === 1 && ppl2.every((s) => near(s.mood, 70 - COLD.mood, 0.05)), `a freezing day with nothing to burn: cold ${h.cold} (mood −${COLD.mood})`);
  // The woodpile's plan keeps the nights' fires in store: WOOD.nightDays of them, pressing while the pile is under it.
  h.stock.wood = 0;
  const w = Wd.woodNeed(st, h);
  const chillDays = Wd.chillDaysAhead(st);
  check(w.nights >= 0 && near(w.nights, r1(n * 4.5 * chillDays * Wd.WOOD.spare), 0.11) && w.dailyKeep >= w.nights, `the plan: ${w.nights} wood for the nights' fires (${chillDays} cool nights in the next ${Wd.WOOD.nightDays} days, a fifth to spare), ${w.dailyKeep} of daily draws kept`);
  st.hour = chill * 24 + 1;
  const w2 = Wd.woodNeed(st, h);
  check(w2.night > 0 && near(w2.night, r1(n * 4.5)) && w2.daily >= w2.night && w2.pressing && w2.short, `on a cool night: tonight's ${w2.night} in the day's draw (${w2.daily}), pressing with an empty pile`);
  h.stock.wood = w2.dailyKeep + 1;
  const w3 = Wd.woodNeed(st, h);
  check(!w3.pressing || w3.boiler > 0, `with the daily draws' ${w2.dailyKeep} in store it is not pressing (the winter's pile waits for the stocking season)`);
}

// ======================================================================
section("A camp's or shelter's fire burns for its people: warmth, the water boiled, the pot");
{
  const st = W();
  const h = quietHub(st);
  const { warm, chill, cold } = daysOf(st);
  h.tier = 0; h.fire = true; delete h.camp; h.buildings = []; h.construction = [];
  const n = mouthsAt(st, h).heads;
  const land = Wd.fireLandOk(st, h.tile) ? Wd.WOOD.fire.deadfall : 1;
  // A cool night with un-purified water in store: the fire, warmth, boiling, the pot.
  st.hour = chill * 24 + 1;
  h.stock[RAW] = 50; h.stock.water = 0; delete h.fireBoil;
  const f = Wd.fireDayBurn(st, h);
  check(f.heads === n && f.fire === Wd.WOOD.fire.shelter && near(f.heat, n * 4.5) && f.boil === n * Wd.WOOD.fire.boilHead && f.cook === n * Wd.WOOD.fire.cookHead && f.land === land && near(f.total, (f.fire + f.heat + f.boil + f.cook) * land, 0.01) && f.night,
    `a cool night, water from the ground: ${f.total} a day = (${f.fire} the fire + ${f.heat} warmth + ${f.boil} boiling + ${f.cook} the pot for ${n}) × ${land}`);
  // By the hour, from the store.
  h.stock.wood = 1000;
  for (let i = 0; i < 24; i++) Wd.shelterFire(st, h);
  check(near(h.stock.wood, 1000 - f.total, 0.01) && h.fireFed === true && h.fireBurn && near(h.fireBurn.wood, f.total, 0.01), `24 hours of it: ${r1(1000 - h.stock.wood)} burned from the store (the fire's day ${h.fireBurn && h.fireBurn.wood})`);
  check(heatUse(st, h).fire && heatUse(st, h).total === 0, "the fire warms them (no heating from the store on top)");
  // More people: more wood (the per-head shares), the fire itself the same.
  const extra = []; for (let i = 0; i < 4; i++) { const s = plain(makeSurvivor(st)); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); extra.push(s); }
  const f2 = Wd.fireDayBurn(st, h);
  check(f2.heads === n + 4 && f2.fire === f.fire && near(f2.total - f.total, 4 * (4.5 + Wd.WOOD.fire.boilHead + Wd.WOOD.fire.cookHead) * land, 0.01), `4 more people: +${r1(f2.total - f.total)} a day (${r1(4.5 + Wd.WOOD.fire.boilHead + Wd.WOOD.fire.cookHead)} each × ${land}), the fire itself still ${f2.fire}`);
  for (const s of extra) st.survivors.splice(st.survivors.indexOf(s), 1);
  // A freezing day: the whole heating in it.
  st.hour = cold * 24 + 1; delete h.fireBoil;
  const fc = Wd.fireDayBurn(st, h);
  check(!fc.night && near(fc.heat, n * 15) && fc.total > f.total, `a freezing day: ${fc.heat} warmth (15 a head), ${fc.total} a day`);
  // A warm night with purified water only: no warmth, no boiling; the fire and the pot stay.
  st.hour = warm * 24 + 1; delete h.fireBoil;
  h.stock[RAW] = 0; h.stock.water = 200;
  const fw = Wd.fireDayBurn(st, h);
  const drawn = Wd.fireBoils(st, h);
  check(fw.heat === 0 && (drawn || fw.boil === 0) && fw.cook === n * Wd.WOOD.fire.cookHead && fw.total >= Wd.WOOD.fire.shelter * land, `a warm night${drawn ? " (water still drawn from the ground here, so it boils)" : ", purified water only"}: no warmth${drawn ? "" : ", no boiling"}; the fire and the pot ${fw.total} a day`);
  // The plan at a shelter: the winter's heating is wanted with the fire lit (the fire burns it), and the fire's day.
  st.hour = chill * 24 + 1; delete h.fireBoil; h.stock[RAW] = 50; h.stock.water = 0; h.stock.wood = 0;
  const w = Wd.woodNeed(st, h);
  check(w.heat > 0 && w.fire > 0 && near(w.fire, r1((Wd.WOOD.fire.shelter + f.boil + f.cook) * land), 0.11) && w.need >= w.heat + w.nights && w.pressing, `the shelter's plan: the fire's ${w.fire} a day, the nights' ${w.nights}, the winter's ${w.heat} (the fire burns it): ${w.need} wanted, pressing`);
  check(/wood a day/.test(text(renderModal(st, ui({ id: h.id, tab: "overview" })) || "")) || /wood a day/.test(text(renderModal(st, ui({ id: h.id })) || "")), "the base window's Fire row shows what the fire burns a day");
  const v = shelterView(st, h);
  check(v && v.burn && near(v.burn.total, Wd.fireDayBurn(st, h).total, 0.01), `shelterView carries the fire's burn (${v && v.burn && v.burn.total})`);
  // It goes out with the pile, and cannot be lit without an hour's worth.
  h.stock.wood = 0.1;
  Wd.shelterFire(st, h);
  check(h.fire === false && h.stock.wood === 0, "with next to nothing in store the fire goes out");
  h.stock.wood = Wd.fireDayBurn(st, h).total / 24 - 0.01;
  check(!Wd.canLight(st, h), "under an hour's burn: it cannot be lit");
  h.stock.wood = Wd.fireDayBurn(st, h).total / 24 + 0.01;
  check(Wd.canLight(st, h), "an hour's burn in store: it can");
  // Save / load: the fire's day survives, and a save without it loads.
  h.fire = true; h.stock.wood = 500;
  for (let i = 0; i < 3; i++) Wd.shelterFire(st, h);
  const s2 = loadFromString(saveToString(st));
  const h2 = s2.bases.find((b) => b.id === h.id);
  check(h2 && h2.fireBurn && near(h2.fireBurn.wood, h.fireBurn.wood, 0.01) && near(Wd.fireDayBurn(s2, h2).total, Wd.fireDayBurn(st, h).total, 0.01), "save and load: the fire's day and its burn come back the same");
  delete h2.fireBurn; delete h2.fireBoil;
  Wd.shelterFire(s2, h2);
  check(h2.fireFed === true && h2.fireBurn && h2.fireBurn.wood > 0, "an old save without them: the fire burns on");
}

// ======================================================================
section("A team's camp fire burns for its people too");
{
  const st = W();
  const h = quietHub(st);
  const { chill, cold } = daysOf(st);
  st.hour = chill * 24 + 8;
  const ids = [];
  for (let i = 0; i < 4; i++) { const s = plain(makeSurvivor(st)); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); ids.push(s.id); }
  const tile = st.tiles.find((t) => t.terrain !== "water" && !t.loc && st.grid.distance(t.id, h.tile) === 2 && planPath(st, h.tile, t.id, false));
  const res = launchExpedition(st, { memberIds: ids, dest: tile.id, mission: "move", stance: "normal", supplies: { food: 8, water: 8 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  p.cargo = { supplies: { wood: 300 }, gear: [] };
  p.path = [tile.id]; p.idx = 0; p.dest = tile.id; p.progress = 0; p.orders = []; p.phase = "waiting"; p.task = null; p.campFire = true;
  const land = Wd.fireLandOk(st, tile.id) ? Wd.WOOD.fire.deadfall : 1;
  const c = Wd.campDayBurn(st, p);
  check(c.heads === 4 && c.fire === Wd.WOOD.fire.camp && near(c.heat, 4 * 4.5) && c.pot === 4 * Wd.WOOD.fire.campHead && near(c.total, (c.fire + c.heat + c.pot) * land, 0.01), `a cool night: ${c.total} a day = (${c.fire} the fire + ${c.heat} warmth + ${c.pot} the pot for 4) × ${land}`);
  check(near(Wd.campDayBurn(st, p, tile.id, 8).total - c.total, 4 * (4.5 + Wd.WOOD.fire.campHead) * land, 0.01), "twice the people: the per-head shares twice");
  startOrder(st, p, { type: "camp", hours: 30 });
  let burnt = 0;
  for (let i = 0; i < 12; i++) { st.hour++; burnt += Wd.campDayBurn(st, p).total / 24; taskHour(st, p); }
  check(p.campFire !== false && near(300 - carried(p, "wood"), burnt, 0.05) && burnt > 12 * Wd.WOOD.fire.camp * land / 24, `12 hours in camp: ${r1(300 - carried(p, "wood"))} wood burned (more than the bare fire's ${r1(12 * Wd.WOOD.fire.camp * land / 24)})`);
  st.hour = cold * 24 + 8;
  check(Wd.campDayBurn(st, p).heat > c.heat && near(Wd.campDayBurn(st, p).heat, 4 * 15), "a freezing day in camp: 15 a head for warmth");
  p.cargo.supplies.wood = 0;
  st.hour++; taskHour(st, p);
  check(p.campFire === false, "no wood carried: the fire goes out");
}

// ======================================================================
section("The governor: a medium priority, behind the food and the water");
{
  const st = W();
  const h = quietHub(st);
  const { chill } = daysOf(st);
  st.hour = chill * 24 + 12;
  setAutopilot(st, true, "balanced");
  // A big hub out of the stocking season with the nights' fires to feed: at most half the stocking crew.
  while (residents(st, h.id).length < 20) { const s = plain(makeSurvivor(st)); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); }
  h.stock.wood = 0;
  const w = Wd.woodNeed(st, h);
  const n = residents(st, h.id).length;
  const crit = woodCritical(st, h, w, n);
  if (!w.season && !(w.boiler > 0)) check(crit >= 1 && crit <= Math.max(1, Math.ceil(Math.ceil(n / 3) / 2) + 1), `out of season (${w.night} a night for ${n}, the pile empty): ${crit} woodcutter${crit === 1 ? "" : "s"} critical, at most half the stocking crew`);
  else console.log(`  (the stocking season or a boiler here: the full crew rule, skipped)`);
  // Food short: one woodcutter; the farms and the foragers get the hands.
  setFood(h, 20 * 6);
  for (const s of atBase(st, h.id)) { s.role = "rest"; }
  const { safetyAI } = await import("../src/sim/autopilot.js");
  safetyAI.planRoles(st, h);
  const woodHands = atBase(st, h.id).filter((s) => s.role === "wood").length;
  const foodHands = atBase(st, h.id).filter((s) => ["farm", "forage", "hunt", "fish"].includes(s.role)).length;
  check(woodHands <= 1 && foodHands >= 10, `food short (6 days): ${woodHands} woodcutter, ${foodHands} on food`);
  // Food fine: the nights' woodcutters go on (out of season, at most half the stocking crew; in it, the full crew).
  setFood(h, 20 * 60);
  for (const s of atBase(st, h.id)) { s.role = "rest"; }
  safetyAI.planRoles(st, h);
  const woodHands2 = atBase(st, h.id).filter((s) => s.role === "wood").length;
  check(woodHands2 >= 1 && woodHands2 >= woodHands, `food fine: ${woodHands2} woodcutter${woodHands2 === 1 ? "" : "s"} (the pile empty, ${w.daily} a day burned)`);
  // A camp of 6 out of season: one woodcutter keeps its fire fed while the pile is under its days; builders keep theirs.
  const st2 = W();
  const c = quietHub(st2);
  st2.hour = chill * 24 + 12;
  c.tier = 0; c.camp = true; c.fire = true; c.buildings = []; c.construction = [];
  setAutopilot(st2, true, "balanced");
  c.stock.wood = 0;
  const wc = Wd.woodNeed(st2, c);
  const nc = residents(st2, c.id).length;
  const critC = woodCritical(st2, c, wc, nc);
  if (!wc.season) check(critC === 1 || (nc > 3 && critC <= Math.ceil(Math.ceil(nc / 3) / 2)), `a camp of ${nc} out of season with an empty pile: ${critC} woodcutter${critC === 1 ? "" : "s"} for its fire (${wc.fire} + ${wc.night} a day)`);
  c.stock.wood = wc.dailyKeep + 50;
  const wc2 = Wd.woodNeed(st2, c);
  check(!wc2.pressing, `with ${wc2.dailyKeep} in store (its days of fires) the camp's wood is not pressing`);
}

// ======================================================================
section("AI groups: their woodpiles burn for the cool nights too");
{
  const st = W();
  const { warm, chill, cold } = daysOf(st);
  check(near(groupHeatShare(cold), Wd.freezeShare(cold) + HEAT.night * Wd.chillShare(cold)) && groupHeatShare(cold) >= Wd.freezeShare(cold), `a freezing day's share ${groupHeatShare(cold)} (the frost ${Wd.freezeShare(cold)} + the thaws' nights)`);
  const chillDays = []; for (let d = 0; d < 112; d++) if (Wd.chillShare(d) > 0) chillDays.push(d);
  check(chillDays.length > 20 && chillDays.length < 112 && chillDays.every((d) => near(groupHeatShare(d), Wd.freezeShare(d) + HEAT.night * (1 - Wd.freezeShare(d)))), `${chillDays.length} days a year have cool nights: HEAT.night of a freezing day's wood a head (${GROUP_WOOD.burn * HEAT.night})`);
  check([...Array(112).keys()].some((d) => groupHeatShare(d) === 0), "and high summer burns none");
  void warm; void chill; void survivorById;
}

console.log(`\n${passes} passed, ${fails} failed`);
if (fails) { console.log("firenightstest FAILED"); process.exit(1); }
