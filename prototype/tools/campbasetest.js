// Batch 6 (2026-10-12, user requests BASE-01..05): the base and camp window, construction and crops.
//   - BASE-03 where a building may stand (buildings.js placeProblem, the one rule canBuild and the Construction tab
//     share): a camp builds the crafting bench, water boiler, cook fire and drying rack on its one utility plot; the
//     trauma hospital at a base (the main base and an outpost) once the clinic, the skills and the manual are there;
//     every building a kind of base never takes is refused by canBuild too; the governor keeps a camp's plot for what
//     it built there before;
//   - BASE-02 the Construction tab: Buildings, Utilities and the rest as folds with their own scroll box, what can be
//     built now first, what this kind of base never takes folded at the bottom with no Build button;
//   - BASE-01 the Overview's upgrades: a shelter's step up at the top, a base's next tiers (Upgrade buttons);
//   - BASE-04 the Crops section (farming.js cropProgress): what grows and how far, read from the plots at the hour,
//     moving with the days; empty and untended plots said plainly; on a camp's Camp tab too;
//   - BASE-05 firewood at a camp or a shelter (woodcutting.js woodNeed, worm.js boilerUse): its fire on bare ground
//     and its heating with the fire out are wanted (the Cut wood job opens), the woodpile is burned for them, and a
//     boiler beside a lit fire burns nothing (the wood once, not twice).
// Usage: node tools/campbasetest.js [seed]
import { createWorld, hub, atBase, newId, tickHour } from "../src/sim/world.js";
import { BUILDINGS, CAMP, SHELTER, CROP_PLOTS, addBuilding, canBuild, placeProblem, queueBuild, isCamp, isShelter, plotCap, farmSlots, baseBeds, queuedBeds, plotsUsed } from "../src/sim/buildings.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { cropProgress, farmOf, CROPS, plotLimit } from "../src/sim/farming.js";
import { huntLoans, cabinPlan, huntWeaponInfo, CABIN } from "../src/sim/hunting.js";
import { newItem } from "../src/sim/inventory.js";
import { GEAR } from "../src/sim/data.js";
import { woodNeed, shelterFire, fireLandOk, fireDayBurn, WOOD } from "../src/sim/woodcutting.js";
import { heatUse, HEAT, woodFor } from "../src/sim/upkeep.js";
import { heatDaily } from "../src/sim/needs.js";
import { boilerUse, purifyDaily } from "../src/sim/worm.js";
import { WORK_TYPES } from "../src/sim/work.js";
import { RAW } from "../src/sim/water.js";
import * as Weather from "../src/sim/weather.js";
import { renderModal } from "../src/ui/ui.js";

const SEED = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else { fail++; console.log(`  FAIL: ${what}`); } return !!ok; };
const section = (t) => console.log(t);
const W = () => { const st = createWorld({ seed: SEED, factionCount: 6 }); st.visitorsOff = true; return st; };
const rich = (b) => Object.assign(b.stock, { scrap: 999, parts: 99, meds: 99, electronics: 9, gunparts: 9, wood: 99999 });
const skilled = (st, b) => { for (const s of atBase(st, b.id)) Object.assign(s.skills, { medicine: 10, mechanics: 10, farming: 5 }); };
const ui = (baseView) => ({ started: true, speed: 0, tab: "bases", selected: -1, survivor: null, baseView, expedition: null, diary: null, roster: null, help: false });
const modal = (st, b, tab) => { st.cards.length = 0; return renderModal(st, ui({ id: b.id, tab })) || ""; };
const plain = (h) => String(h).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const mkOutpost = (st, tile) => { const o = { id: newId(), tile, type: "outpost", name: "Test Outpost", stock: { water: 0, fuel: 0, meds: 0, ammo: 0, parts: 0, scrap: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] }; st.bases.push(o); return o; };
const first = (s) => s.name.split(" ")[0];
const asCamp = (b) => { b.tier = 0; b.camp = true; b.buildings = []; b.construction = []; };
const asShelter = (b) => { b.tier = 0; delete b.camp; b.buildings = []; b.construction = []; };
// A card in the Construction tab: the HTML of the gcard whose title is the building's name.
const cardOf = (html, name) => { const i = html.indexOf(`<span class="gcard-title">${name}`); if (i < 0) return ""; const s = html.lastIndexOf("<div class=\"gcard ", i); return html.slice(s, html.indexOf("</div>\n    </div>", i) + 6); };

// ======================================================================
section("BASE-03: what each kind of base may build");
{
  const st = W(), h = hub(st);
  rich(h); skilled(st, h);
  // The main base: the trauma hospital once the clinic stands, with Medicine 10 and Mechanics 4 here and the manual.
  check(placeProblem(h, "hospital") === "", "the main base takes a trauma hospital");
  addBuilding(h, "clinic");
  const locked = canBuild(st, h, "hospital");
  check(!locked.ok && locked.locked && !locked.where, `without the Hospital Operations Manual: locked, not "not here" (${locked.reason})`);
  st.tech = st.tech || { known: [], progress: {} };
  (st.tech.known || (st.tech.known = [])).push("hospitalops");
  check(canBuild(st, h, "hospital").ok && /queued/.test(queueBuild(st, h, "hospital")), "with the manual: the trauma hospital is built at the main base");
  const o = mkOutpost(st, h.tile);
  rich(o);
  for (const s of atBase(st, h.id)) s.location = { kind: "base", baseId: o.id };
  addBuilding(o, "clinic");
  check(placeProblem(o, "hospital") === "" && canBuild(st, o, "hospital").ok, "an outpost (a base) builds the trauma hospital too");

  // A camp: the crafting bench, water boiler, cook fire and drying rack on its one utility plot.
  const st2 = W(), c = hub(st2);
  asCamp(c); rich(c);
  check(isCamp(c) && plotCap(c, "utility") === 2, "a camp: two utility plots");
  for (const k of ["craftbench", "boiler", "cookhouse", "smoker"]) {
    check(CAMP.build[k] >= 1 && placeProblem(c, k) === "" && canBuild(st2, c, k).ok, `a camp builds a ${BUILDINGS[k].name.toLowerCase()}`);
  }
  check(placeProblem(c, "hospital") !== "" && canBuild(st2, c, "hospital").where, "no hospital at a camp (not here)");
  check(placeProblem(c, "infirmary") !== "" && /Available once the shelter stands/.test(canBuild(st2, c, "infirmary").reason), `an infirmary at a camp says when it opens (${canBuild(st2, c, "infirmary").reason})`);
  queueBuild(st2, c, "boiler"); queueBuild(st2, c, "smoker");
  const third = canBuild(st2, c, "cookhouse");
  check(!third.ok && third.noPlot && !third.where, "both plots taken (a boiler and a drying rack): the cook fire is buildable here but waits for a plot");

  // One rule: whatever placeProblem refuses, canBuild refuses (for every kind of base and every building).
  const st3 = W(), b3 = hub(st3);
  rich(b3); skilled(st3, b3);
  const o3 = mkOutpost(st3, b3.tile); rich(o3);
  const kinds = [["main base", () => { delete b3.tier; delete b3.camp; return b3; }], ["shelter", () => { asShelter(b3); return b3; }], ["camp", () => { asCamp(b3); return b3; }], ["outpost", () => { delete o3.tier; delete o3.camp; return o3; }], ["outpost camp", () => { o3.tier = 0; o3.camp = true; return o3; }]];
  let bad = [];
  for (const [name, make] of kinds) {
    const b = make();
    for (const k of Object.keys(BUILDINGS)) {
      const where = placeProblem(b, k), chk = canBuild(st3, b, k);
      if (where && chk.ok) bad.push(`${k} at a ${name}`);
      if (!where && chk.where) bad.push(`${k} at a ${name} (canBuild says not here)`);
    }
  }
  check(!bad.length, `placeProblem and canBuild agree for every building at every kind of base${bad.length ? `: ${bad.join(", ")}` : ""}`);
  asShelter(b3);
  check(Object.keys(SHELTER.build).filter((k) => k !== "outpost_up" && !BUILDINGS[k].fit).every((k) => placeProblem(b3, k) === ""), "everything on the shelter's list stands at a shelter (the hub's: an outpost's step up aside; the fittings need a hut or cabin to stand in first)");

}

// ======================================================================
section("Plots and crop plots by stage (user numbers 2026-10-12)");
{
  const st = W(), h = hub(st);
  const o = mkOutpost(st, h.tile);
  const row = (b) => [plotCap(b, "building"), plotCap(b, "utility"), farmSlots(b), plotLimit(b), farmOf(st, b).plots.length];
  const want = { "main base": [16, 14, 8], outpost: [6, 6, 4], shelter: [1, 3, 2], camp: [0, 2, 1] };
  const got = { "main base": row(h), outpost: row(o) };
  asShelter(h); got.shelter = row(h);
  asCamp(h); got.camp = row(h);
  for (const [k, [b, u, c]] of Object.entries(want)) {
    const g = got[k];
    check(g[0] === b && g[1] === u && g[2] === c && g[3] === c && g[4] === c, `${k}: ${b} building, ${u} utility, ${c} crop plots (the Construction tab, farmSlots and the farm agree: ${g.join(" / ")})`);
  }
  check(CROP_PLOTS.camp === 1 && CROP_PLOTS.shelter === 2 && CROP_PLOTS.outpost === 4 && CROP_PLOTS.hub === 8 && CAMP.plots === 1 && SHELTER.plots === 2, "one table: CROP_PLOTS (CAMP.plots, SHELTER.plots the same)");
  asShelter(h); rich(h);
  // The cabin also needs game land within 2 tiles (hunting.js cabinProblem); seed 42's hub lies in a town's suburb ring
  // (mapgen.js, POI foundation), so the suburbs around it are made woods again for this check, then put back.
  const ring = st.grid.within(h.tile, CABIN.radius).map((id) => [st.tiles[id], st.tiles[id].terrain]);
  for (const [t, k] of ring) if (k === "suburb") t.terrain = "forest";
  check(["bunkhouse", "cellar", "infirmary", "huntcabin"].every((k) => canBuild(st, h, k).ok), "the shelter's building plot takes a bunkhouse, root cellar, infirmary or hunting cabin");
  for (const [t, k] of ring) t.terrain = k;
  // Makeshift cots (user request 2026-10-12): +2 beds each at a shelter, no plot, up to 2.
  const beds0 = baseBeds(h), u0 = plotsUsed(h, "utility"), b0 = plotsUsed(h, "building");
  check(canBuild(st, h, "cots").ok && !BUILDINGS.cots.plot, "a shelter builds makeshift cots (no plot)");
  queueBuild(st, h, "cots");
  check(queuedBeds(h) === 2 && plotsUsed(h, "utility") === u0 && plotsUsed(h, "building") === b0, "queued: 2 beds to come, no plot taken");
  addBuilding(h, "cots"); h.construction = [];
  check(baseBeds(h) === beds0 + 2, `built: +2 beds (${beds0} → ${baseBeds(h)})`);
  addBuilding(h, "cots");
  check(baseBeds(h) === beds0 + 4 && !canBuild(st, h, "cots").ok, "two at most: +4 beds");
  delete h.tier; delete h.camp;
  check(placeProblem(h, "cots") !== "" && baseBeds(h) >= 4 + 4, "not at a base (Shelters only), and those built still sleep 2 each there");
  asCamp(h);
  check(placeProblem(h, "cots") !== "", "not at a camp either (the shelter's)");
}

// ======================================================================
section("The governor builds at a camp and a shelter");
{
  const run = (st, b, days) => { for (let i = 0; i < days * 24; i++) { st.hordes.length = 0; tickHour(st); st.cards.length = 0; } };
  const st = W(), c = hub(st);
  st.noWanderers = true;
  asCamp(c); c.farm = null;
  Object.assign(c.stock, { scrap: 80, parts: 4 });
  setAutopilot(st, true, "balanced");
  run(st, c, 1);
  const yard = c.buildings.map((x) => x.type);
  check(yard.length >= 2 && yard.every((k) => CAMP.build[k]), `a camp's yard goes up on its two plots (${yard.join(", ")})`);
  check(c.construction.some((j) => BUILDINGS[j.type].tierUp) || !isCamp(c), "and the step up is under way");
  const st2 = W(), s = hub(st2);
  st2.noWanderers = true;
  asShelter(s); s.farm = null;
  Object.assign(s.stock, { scrap: 60, parts: 4 });
  setAutopilot(st2, true, "balanced");
  run(st2, s, 3);
  const sy = s.buildings.map((x) => x.type);
  check(sy.length >= 3 && sy.some((k) => ["cookhouse", "smoker", "craftbench"].includes(k)), `a shelter builds its yard before the 100-scrap step up drains its scrap (${sy.join(", ")})`);
  check(s.construction.some((j) => j.type === "hub_up") || sy.length >= 4, "then the step up into a base");
}

// ======================================================================
section("Hunting at a base");
{
  const st = W(), h = hub(st);
  const ppl = atBase(st, h.id);
  const rifleOwner = ppl.find((x) => x.gear.weapon && x.gear.weapon.key === "huntrifle");
  const pistol = ppl.find((x) => x.gear.weapon && /pistol/.test(x.gear.weapon.name));
  if (rifleOwner && pistol) {
    const sk = (x, v) => Object.assign(x.skills, { shooting: v, scouting: v, stealth: v });
    sk(rifleOwner, 5); sk(pistol, 5);
    check(WORK_TYPES.hunt.rank(rifleOwner) > WORK_TYPES.hunt.rank(pistol), "the Hunt job ranks a hunting rifle above a pistol (same skills)");
    const shooter = ppl.find((x) => x !== rifleOwner && x !== pistol && !(x.gear.weapon && huntWeaponInfo(x.gear.weapon)));
    rifleOwner.role = "build"; shooter.role = "hunt";
    const lent = huntLoans(st, h);
    check(lent.get(shooter.id) === rifleOwner.gear.weapon, `a hunter with no hunting weapon takes ${first(rifleOwner)}'s rifle for the day (not hunting, not on guard)`);
    rifleOwner.role = "guard";
    check(!huntLoans(st, h).has(shooter.id) || huntLoans(st, h).get(shooter.id) !== rifleOwner.gear.weapon, "not from someone on guard");
    rifleOwner.role = "build";
    const plan = cabinPlan(st, h, [shooter], h.stock, 0);
    check(plan[0].hours === CABIN.huntHours && plan[0].guns === CABIN.huntHours && plan[0].any && plan[0].any.item === rifleOwner.gear.weapon, `its day: ${CABIN.huntHours} hours with the lent rifle`);
    const bow = newItem(Object.keys(GEAR).find((k) => GEAR[k].cat === "bow"));
    h.armory.push(bow);
    pistol.role = "hunt";
    const two = huntLoans(st, h);
    check([...two.values()].includes(bow) || [...two.values()].includes(rifleOwner.gear.weapon), "the armory's bow is lent too");
  } else console.log("  (no rifle and pistol at this hub: the loan checks skipped)");
}

// ======================================================================
section("BASE-02: the Construction tab");
{
  const st = W(), c = hub(st);
  asCamp(c); rich(c);
  const html = modal(st, c, "construction");
  check(/data-fold="cx:buildings"/.test(html) && /data-fold="cx:utilities"/.test(html) && /data-fold="cx:fields"/.test(html), "Buildings, Utilities and Walls are folds of their own");
  check(/data-fold="cx:utilities"[^>]*open/.test(html) && !/data-fold="cx:buildings"[^>]*open/.test(html), "at a camp: Utilities open, Buildings (nothing a camp takes) closed");
  check(/ready to build/.test(plain(html)), "the tab says how many can be built now");
  for (const name of ["Crafting bench", "Water boiler", "Cook fire", "Drying rack"]) {
    const card = cardOf(html, name);
    check(card && /data-action="queuebuild"/.test(card) && !/disabled/.test(card.match(/<button[^>]*queuebuild[^>]*>/)[0]), `${name}: a live Build button at the camp`);
  }
  const hosp = cardOf(html, "Trauma hospital");
  check(hosp && !/queuebuild/.test(hosp) && /Not here/.test(hosp) && /cx-na/.test(hosp), "the trauma hospital at a camp: no Build button, marked Not here");
  check(html.indexOf("Not at a camp") > html.indexOf('data-fold="cx:buildings"'), "what a camp never takes is folded in its own list at the bottom");
  // At the main base the ready ones come first in a list.
  const st2 = W(), h = hub(st2); rich(h); skilled(st2, h);
  const html2 = modal(st2, h, "construction");
  const util = html2.slice(html2.indexOf('data-fold="cx:utilities"'), html2.indexOf('data-fold="cx:fields"'));
  const firstCard = util.slice(util.indexOf('<div class="gcard'), util.indexOf('<div class="gcard') + 40);
  check(/gcard ok/.test(firstCard), "the main base's Utilities: buildable first");
  check(!/Not at a main hub/.test(util) || /cx-na/.test(util), "the main base: anything it never takes is folded apart");
}

// ======================================================================
section("BASE-01: the upgrades on the Overview");
{
  const st = W(), h = hub(st);
  asShelter(h); rich(h);
  const t = plain(modal(st, h, "overview"));
  check(t.indexOf("⬆ Build up") >= 0 && t.indexOf("⬆ Build up") < t.indexOf("Stock"), "a shelter: Build up at the top of the Overview, before the stock");
  check(/Build up into a base/.test(t) && /Opens up/.test(t), "the step up's button and what the base opens up");
  const st2 = W(), b = hub(st2);
  rich(b); skilled(st2, b);
  addBuilding(b, "infirmary"); addBuilding(b, "bunkhouse");
  const html = modal(st2, b, "overview");
  check(/⬆ Upgrades/.test(plain(html)) && /data-type="field_hosp"/.test(html) && /data-action="bunk-expand"/.test(html), "a base: its next tiers (the field hospital, a barracks) with Upgrade buttons");
  const st3 = W(), b3 = hub(st3);
  check(!/⬆ Upgrades/.test(plain(modal(st3, b3, "overview"))), "nothing to upgrade: no card");
}

// ======================================================================
section("BASE-04: the Crops section");
{
  const st = W(), h = hub(st);
  const v = cropProgress(st, h);
  const f = farmOf(st, h);
  check(v.plots === f.plots.length && v.growing.length === f.plots.filter((p) => p.stage === "growing").length, `the plots as they stand (${v.growing.length} growing of ${v.plots})`);
  check(v.growing.every((x) => Math.abs(x.frac - Math.min(1, f.plots.find((p) => p.id === x.id).grown / CROPS[x.crop].days)) < 1e-9 && x.ripeIn >= 1), "each crop's progress is its grown days over its growing days");
  const html = plain(modal(st, h, "overview"));
  const g0 = v.growing[0];
  check(/🌱 Crops/.test(html) && html.includes(`${g0.name}`) && html.includes(`${Math.round(g0.frac * 100)}%`), `the Overview shows it (${g0.name} ${Math.round(g0.frac * 100)}%)`);
  const before = Object.fromEntries(v.growing.map((x) => [x.id, x.frac]));
  for (let i = 0; i < 48; i++) { tickHour(st); st.cards.length = 0; }
  const v2 = cropProgress(st, h);
  const moved = v2.growing.filter((x) => before[x.id] != null && x.frac > before[x.id]).length + v2.ripe.length;
  check(moved > 0 && v2.day === v.day + 2, `two days on, the bars moved with the days (${moved} plots grew or ripened)`);
  check(v2.nextIn >= 1 && v2.nextIn <= 24, `the next count in ${v2.nextIn}h`);
  // Nothing sown yet, nobody farming.
  const st2 = W(), b = hub(st2);
  for (const p of farmOf(st2, b).plots) Object.assign(p, { stage: "empty", crop: null, grown: 0 });
  for (const s of atBase(st2, b.id)) if (s.role === "farm") s.role = "build";
  const e = cropProgress(st2, b);
  check(!e.growing.length && !e.ripe.length && e.empty === e.plots && !e.tended, "a fresh farm with no farmers: all empty, untended");
  check(/Nothing growing/.test(plain(modal(st2, b, "overview"))) && /Farm role/.test(plain(modal(st2, b, "overview"))), "said plainly: nothing growing, and put someone on Farm");
  asCamp(b);
  check(/🌱 Crops/.test(plain(modal(st2, b, "camp"))), "a camp's Camp tab has the Crops section");
}

// ======================================================================
section("BASE-05: firewood at a camp or a shelter, before any boiler");
{
  const st = W(), h = hub(st);
  let cold = null;
  for (let d = 30; d < 112 * 2 && cold == null; d++) { const t = Weather.dayMeanTemp(st, d); if (t < 0 && t >= -8) cold = d; }
  st.hour = cold * 24 + 1;
  asShelter(h);
  const n = heatUse(st, h).n;
  // A shelter with its fire put out: heated from the woodpile, and the wood is wanted (the Cut wood job opens).
  h.fire = false; h.stock.wood = 3000; h.stock.fuel = 0;
  const w = woodNeed(st, h);
  check(w.heat > 0 && w.need > 0, `the fire out: the cold's heating is wanted (${w.need} firewood)`);
  heatDaily(st, h);
  check(h.stock.wood < 3000 && !h.cold && h.heat.wood > 0, `and burned from the woodpile (${h.heat.wood} firewood for ${n} people)`);
  if (fireLandOk(st, h.tile)) {
    h.stock.wood = 0;
    const job = WORK_TYPES.wood.open({ state: st, base: h, people: atBase(st, h.id) });
    check(job.cap > 0, `the Cut wood job opens at the shelter (${job.cap} wanted)`);
  }
  // Its fire lit (woodcutting.js shelterFire, hourly in needs.js): it burns the woodpile every day (fire-nights,
  // fireDayBurn: the fire itself, its people's warmth on a freezing day, boiling the drinking and the pot), half as
  // much where deadfall lies about, and keeps the place warm; the heating is wanted all the same (the fire burns it).
  const fireDay = (b) => { for (let i = 0; i < 24; i++) shelterFire(st, b); };
  h.fire = true; h.stock.wood = 1500;
  if (fireLandOk(st, h.tile)) {
    const fdb = fireDayBurn(st, h);
    fireDay(h); heatDaily(st, h);
    const w = woodNeed(st, h);
    check(Math.abs(h.stock.wood - (1500 - fdb.total)) < 0.01 && !h.cold && fdb.land === WOOD.fire.deadfall && fdb.heat === n * woodFor(HEAT.fuel) && w.fire === (WOOD.fire.shelter + fdb.boil + fdb.cook) * WOOD.fire.deadfall && w.heat > 0, `the fire lit among trees: ${fdb.total} firewood a day (deadfall; ${fdb.fire} the fire, ${fdb.heat} warmth for ${n} on a freezing day, ${fdb.boil} boiling, ${fdb.cook} the pot), warm, the heating still wanted (${w.heat}: the fire burns it)`);
  }
  // On bare ground the lit fire burns its full day, and its days in store are wanted.
  const bare = st.tiles.find((t) => t.terrain === "city" && !fireLandOk(st, t.id));
  if (bare) {
    const keep = h.tile;
    h.tile = bare.id;
    h.stock.wood = 0;
    const wb = woodNeed(st, h);
    const fb = fireDayBurn(st, h);
    check(fb.land === 1 && wb.fire === WOOD.fire.shelter + fb.boil + fb.cook && wb.daily >= wb.fire && wb.need >= wb.fire * WOOD.fire.keepDays && wb.pressing, `on bare ground the fire's full ${wb.fire} a day is wanted (${wb.need} in store)`);
    h.stock.wood = 1000; h.fire = true;
    fireDay(h); heatDaily(st, h);
    check(Math.abs(h.stock.wood - (1000 - fb.total)) < 0.01 && h.fireFed === true && !h.cold, `the fire burns ${fb.total} firewood a day (${n} people's warmth in it) and keeps everyone warm`);
    // A boiler beside the lit fire: the fire boils the water, the boiler burns nothing (the wood once, not twice).
    addBuilding(h, "boiler");
    h.stock[RAW] = 60; h.stock.water = 0; h.stock.wood = 1000;
    check(!boilerUse(st, h).active, "a boiler beside the lit fire stands ready");
    purifyDaily(st, h);
    fireDay(h); heatDaily(st, h);
    check(Math.abs(h.stock.wood - (1000 - fireDayBurn(st, h).total)) < 0.01 && h.boilerBurn.wood === 0 && h.stock.water > 0, `one day: only the fire's ${fireDayBurn(st, h).total} firewood burned, and the water boiled`);
    // Put out, the boiler does the boiling and burns its own.
    h.fire = false; delete h.fireFed;
    check(boilerUse(st, h).active, "the fire out: the boiler burns");
    h.stock[RAW] = 60; h.stock.water = 0; h.stock.wood = 1000;
    purifyDaily(st, h);
    check(h.boilerBurn.wood > 0 && h.stock.wood < 1000, `the boiler burned ${h.boilerBurn.wood} firewood`);
    h.tile = keep;
  } else console.log("  (no bare city ground on this map: the bare-ground checks skipped)");
  // A base (tier 1) with no boiler: the winter's heating burns the woodpile first, as before.
  const st2 = W(), b = hub(st2);
  st2.hour = st.hour;
  b.stock.wood = 3000; b.stock.fuel = 10;
  heatDaily(st2, b);
  check(b.stock.wood < 3000 && b.stock.fuel === 10 && !b.cold, `a base with no boiler: heated from the woodpile (${b.heat.wood} firewood), no fuel`);
  check(woodNeed(st2, b).need > 0 && woodNeed(st2, b).fire === 0, "and its winter's wood wanted (no fire part at a base)");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
