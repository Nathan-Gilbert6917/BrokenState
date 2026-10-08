// Headless checks for the bare start (barestart): no base starts with buildings, the player's hub (normal and
// Hardcore) and every AI group's base alike, and every construction plot is free; the crafting bench is the first
// bench and costs what buildings.js says it does (12 scrap and a part, 12 work-hours, no skill); a new run on an empty
// hub works (the starting roles, a first build queued and finished, nobody hungry or thirsty in the first days, the
// Overcrowded card not on the first hour); a save made on day 0 loads with the base still bare; the governor
// (autopilot.js) builds a first set (beds, water, then a bench or fields) by day 7 and keeps building; the AI groups
// (groupworks.js) put up water and fields first, then quarters and walls, and their walls grow toward the old fixed
// walls; an old save's groups count as built up.
// Usage: node tools/barestarttest.js [seeds...]
import { createWorld, tickHour, day, hub, alive, atBase, assignStartingRoles, HUB_START } from "../src/sim/world.js";
import { BUILDINGS, PLOTS, plotsUsed, plotsFree, plotCap, canBuild, queueBuild, baseBeds, count, countAll, benchTier } from "../src/sim/buildings.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { nativeWalls, CONQUEST } from "../src/sim/conquest.js";
import { GROUP_WORKS, groupsBuild, groupWorksDaily, worksAt, nextWork, groupWalls, groupBaseDefence, wallGoal, provisioned, worksText } from "../src/sim/groupworks.js";

const seeds = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1, 2, 3];
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const built = (f) => Object.values(f.works || {}).reduce((a, w) => a + Object.values(w).reduce((x, v) => x + (v || 0), 0), 0);
const answerCards = (st) => { while (st.cards.length) { const c = st.cards.shift(); const ch = c.choices.find((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled)); if (ch) ch.resolve(st); } };

// 1. Fresh worlds: no buildings at any base, every plot free, the groups' works empty.
{
  console.log("Fresh worlds");
  for (const seed of seeds) {
    const st = createWorld({ seed, factionCount: 8 });
    const h = hub(st);
    check(st.bases.length === 1 && h, `seed ${seed}: one base, the hub`);
    check(st.bases.every((b) => b.buildings.length === 0 && b.construction.length === 0), `seed ${seed}: no buildings and nothing queued (${h.buildings.map((b) => b.type).join(", ")})`);
    check(["building", "utility"].every((k) => plotsUsed(h, k) === 0 && plotsFree(h, k) === PLOTS.hub[k] && plotCap(h, k) === PLOTS.hub[k]), `seed ${seed}: every plot free (${plotsFree(h, "building")}/${plotsFree(h, "utility")})`);
    check(h.stock.scrap === HUB_START.scrap && h.stock.parts === HUB_START.parts, `seed ${seed}: the starting scrap and parts (${h.stock.scrap}, ${h.stock.parts})`);
    check(baseBeds(h) === 4 && !benchTier(h), `seed ${seed}: the town hall's 4 beds, no bench`);
    check(st.groupWorks === 1 && st.factions.length > 0 && st.factions.every((f) => groupsBuild(st, f) && built(f) === 0 && !f.job), `seed ${seed}: every group builds and has built nothing`);
    check(st.factions.every((f) => f.bases.every((t) => nativeWalls(f, t, st) === 0)), `seed ${seed}: no group has walls yet`);
    check(st.factions.every((f) => nextWork(st, f) && nextWork(st, f).type === "water"), `seed ${seed}: water is every group's first job`);
  }
  // Hardcore: no hub yet, and the groups (bands on the road, the military) have nothing built either.
  const hc = createWorld({ seed: seeds[0], factionCount: 6, mode: "hardcore" });
  check(hc.bases.every((b) => b.buildings.length === 0), `hardcore: no base buildings (${hc.bases.length} bases)`);
  check(hc.factions.every((f) => !groupsBuild(hc, f) ? !!f.hcMilitary : built(f) === 0), "hardcore: the groups have built nothing (the Guard's army base counts as built up)");
}

// 2. The crafting bench: the first bench, a real but early decision.
{
  console.log("The crafting bench");
  const b = BUILDINGS.craftbench, wb = BUILDINGS.workbench, tb = BUILDINGS.toolbench;
  check(b.cost.scrap === 12 && b.cost.parts === 1 && Object.keys(b.cost).length === 2, `12 scrap and a part (${JSON.stringify(b.cost)})`);
  check(b.hours === 12 && !b.req, `12 work-hours, no skill (${b.hours})`);
  check(b.cost.scrap >= 10 && b.cost.scrap <= 12 && b.hours >= 8 && b.hours <= 12, "within the asked range (10–12 scrap, 8–12 hours)");
  check(b.cost.scrap / HUB_START.scrap <= 0.3 && b.cost.scrap > BUILDINGS.farm_plot.cost.scrap, `a modest share of the starting scrap, more than a farm plot (${Math.round((b.cost.scrap / HUB_START.scrap) * 100)}%)`);
  check(wb.cost.scrap > b.cost.scrap && tb.cost.scrap > wb.cost.scrap && wb.hours > b.hours && tb.hours > wb.hours, "each tier still costs more than the one below");
  const st = createWorld({ seed: seeds[0], factionCount: 4 });
  const h = hub(st);
  check(canBuild(st, h, "craftbench").ok, "a new hub can afford it on day 1");
  h.stock.parts = 0;
  check(!canBuild(st, h, "craftbench").ok && /parts/.test(canBuild(st, h, "craftbench").reason), "not without a part");
}

// 3. A new run on an empty hub: roles, the first build, the first days without help.
{
  console.log("New run");
  const st = createWorld({ seed: seeds[0], factionCount: 8 });
  assignStartingRoles(st); // main.js begin
  st.started = true;
  const h = hub(st);
  const here = atBase(st, h.id);
  check(here.filter((s) => s.role === "build").length === 2, `two builders (${here.map((s) => s.role).join(", ")})`);
  const q1 = queueBuild(st, h, "bunkhouse");
  const q2 = queueBuild(st, h, "craftbench");
  check(/queued/.test(q1) && /queued/.test(q2), `a bunkhouse and a crafting bench queued (${q1} ${q2})`);
  check(h.stock.scrap === HUB_START.scrap - 32 && h.stock.parts === HUB_START.parts - 1, "paid from the starting stores");
  tickHour(st);
  check(!st.cards.some((c) => c.crowdFor === h.id), "no Overcrowded card on the first hour");
  let bunkDay = null, benchDay = null;
  while (day(st) <= 5 && !st.gameOver) {
    tickHour(st);
    answerCards(st);
    if (bunkDay == null && count(h, "bunkhouse")) bunkDay = day(st);
    if (benchDay == null && count(h, "craftbench")) benchDay = day(st);
  }
  check(bunkDay != null && bunkDay <= 3, `the bunkhouse is up within 3 days (day ${bunkDay})`);
  check(benchDay != null && benchDay <= 4, `the crafting bench after it (day ${benchDay})`);
  check(baseBeds(h) === 10, `10 beds now (${baseBeds(h)})`);
  check(alive(st).length === 6 && alive(st).every((s) => (s.hunger ?? 100) > 30 && (s.thirst ?? 100) > 30), `everyone alive, fed and watered on day 5 (${alive(st).map((s) => `${Math.round(s.hunger)}/${Math.round(s.thirst)}`).join(" ")})`);
}

// 4. A save made on day 0 loads, bare.
{
  console.log("Save on day 0");
  const st = createWorld({ seed: seeds[0], factionCount: 8 });
  let back = null, err = null;
  try { back = loadFromString(saveToString(st)); } catch (e) { err = e; }
  check(!err && back && hub(back), `it loads (${err ? err.message : "ok"})`);
  if (back) {
    check(hub(back).buildings.length === 0 && hub(back).stock.scrap === HUB_START.scrap, "the hub is still bare");
    check(back.groupWorks === 1 && back.factions.every((f) => groupsBuild(back, f) && built(f) === 0), "the groups still build");
    for (let i = 0; i < 48; i++) tickHour(back);
    check(!back.gameOver && alive(back).length === 6, "and plays on for two days");
  }
}

// 5. The governor and the AI groups by day 7 and day 30.
{
  console.log("The governor and the groups");
  for (const seed of seeds) {
    const st = createWorld({ seed, factionCount: 8 });
    st.started = true;
    setAutopilot(st, true, "balanced");
    const h = hub(st);
    const snaps = {};
    while (day(st) <= 30 && !st.gameOver) {
      tickHour(st);
      if (st.hour % 24 === 0 && [3, 7, 14, 30].includes(day(st) - 1)) snaps[day(st) - 1] = { n: h.buildings.length, types: h.buildings.map((b) => b.type), q: h.construction.length };
    }
    const s7 = snaps[7] || { n: 0, types: [] }, s30 = snaps[30] || { n: 0, types: [] };
    check(snaps[3] && snaps[3].n >= 1, `seed ${seed}: the first building by day 3 (${snaps[3] && snaps[3].types.join(", ")})`);
    check(s7.n >= 3 && s7.types.includes("bunkhouse"), `seed ${seed}: a first set by day 7, beds among it (${s7.types.join(", ")})`);
    check(s7.types.some((t) => ["well", "rain_catcher", "boiler", "water_barrel", "cistern"].includes(t)), `seed ${seed}: water by day 7`);
    check(s30.n > s7.n && (snaps[14] || s7).n >= s7.n, `seed ${seed}: still building after day 7 (${s7.n} → ${(snaps[14] || {}).n} → ${s30.n})`);
    check(!st.gameOver && alive(st).length >= 5, `seed ${seed}: the hub holds (${alive(st).length} alive)`);
    const groups = st.factions.filter((f) => f.alive && groupsBuild(st, f));
    check(groups.every((f) => built(f) >= 3), `seed ${seed}: every group has put something up by day 30 (${groups.map((f) => worksText(st, f)).join(" | ")})`);
    check(groups.every((f) => (f.works[f.bases[0]] || {}).water >= 1), `seed ${seed}: water at every group's main base`);
    check(groups.filter((f) => groupWalls(st, f, f.bases[0]) > 0).length >= groups.length / 2, `seed ${seed}: most groups have walls by day 30 (${groups.map((f) => `${groupWalls(st, f, f.bases[0])}/${wallGoal(f, f.bases[0])}`).join(" ")})`);
    check(groups.every((f) => provisioned(st, f) >= 0.5), `seed ${seed}: the groups' water and fields are mostly up (${groups.map((f) => provisioned(st, f).toFixed(2)).join(" ")})`);
  }
}

// 6. The groups' rules: walls up to the old fixed walls, defence, an old save built up.
{
  console.log("Group rules");
  const st = createWorld({ seed: seeds[0], factionCount: 8 });
  const f = st.factions[0], t = f.bases[0];
  check(groupBaseDefence(st, f, t) === GROUP_WORKS.WALL_DEF / 2, `a bare base has half the old flat defence (${groupBaseDefence(st, f, t)})`);
  Object.assign(worksAt(f, t), { water: 9, farms: 9, beds: 9, walls: 99, bench: 1, store: 1, sickbay: 4 });
  const goal = CONQUEST.WALLED_TYPES.includes(f.type) ? CONQUEST.WALLS.typed : CONQUEST.WALLS.home;
  check(nativeWalls(f, t, st) === goal && groupBaseDefence(st, f, t) === GROUP_WORKS.WALL_DEF, `built up: the old walls (${nativeWalls(f, t, st)} of ${goal}) and the old defence`);
  check(nextWork(st, f) === null || nextWork(st, f).tile !== t, "nothing more to build there");
  // Salvage: no scrap, the job still starts (twice the work) and finishes.
  const g = st.factions[1];
  g.stock.scrap = 0; g.stock.parts = 0;
  for (let i = 0; i < 20 && !built(g); i++) { g.stock.scrap = 0; groupWorksDaily(st, g); }
  check(built(g) === 1, "a group with no scrap salvages and still builds");
  // An old save: no state.groupWorks, everything as it was.
  delete st.groupWorks;
  const o = st.factions[2];
  check(!groupsBuild(st, o) && nativeWalls(o, o.bases[0], st) === wallGoal(o, o.bases[0]) && groupBaseDefence(st, o, o.bases[0]) === GROUP_WORKS.WALL_DEF && provisioned(st, o) === 1, "an old save's groups are built up");
}

console.log(`\n${passes} passed, ${fails} failed`);
console.log(fails ? "barestarttest failed" : "barestarttest passed");
process.exit(fails ? 1 : 0);
