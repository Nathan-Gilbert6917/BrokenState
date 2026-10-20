// Base building: the autopilot (src/sim/autopilot.js tidyStores, bedWishes, storageWish, stoveWish, generalWish;
// docs/base-building/plan.md Part D and "Merged with dev's base storage limits"). Checks: a hub whose building plots
// are all taken and whose people outnumber its beds wishes for the biggest general building it can put up (a barn)
// with bunks inside and, with one standing, for bunk beds (queued, laid out on the barn's floor, counted as beds once
// built; a camp wishes for a hut); the one storage wish (storageWish, basestorage.js: goods lying outside) asks for
// storage shelves while a general building has floor for them, lockers once the shelves are at their limit, a storage
// building from the ladder with no floor (the smallest that holds what lies outside), a general building for shelves
// and lockers when nothing on the ladder can go up, nothing with room to spare, one at a time and never saved for; the
// morning's tidy (governBase at the plan hour) puts the unassigned goods away; a hub with no cook fire and no utility
// plot left wishes for a wood stove right behind the cook fire; and a 60-day autopilot run (seed 42, 8 groups) that
// ends with under a tenth of the hub's goods outside, the general buildings and fittings within their limits, and the
// holdout standing.
// Usage: node tools/basebuildautotest.js [seed] [days]
import { createWorld, hub, atBase, makeSurvivor, tickHour, day, hourOfDay, alive } from "../src/sim/world.js";
import { registerCombatHandler } from "../src/sim/combat.js";
import { BUILDINGS, addBuilding, queueBuild, constructionHour, count, countAll, baseBeds, queuedBeds, plotsFree, CAMP } from "../src/sim/buildings.js";
import { setAutopilot, autopilotStats, housingAI, governBase } from "../src/sim/autopilot.js";
import { storageKg, containerByKey, LOOSE } from "../src/sim/containers.js";
import { storageOf } from "../src/sim/basestorage.js";
import { carsAtBase } from "../src/sim/vehicles.js";
import { fittingsIn, layoutOf } from "../src/sim/basemap.js";

const seed = Number(process.argv[2] || 42);
const DAYS = Number(process.argv[3] || 60);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
registerCombatHandler("bbat", () => {});
const GENERAL = ["gen_barn", "gen_hall", "gen_lodge", "gen_cabin", "gen_hut"];
const world = (s = seed, factions = 6) => { const st = createWorld({ seed: s, factionCount: factions }); st.started = true; st.hour = 24 * 3 + 12; return st; };
const rich = (base) => Object.assign(base.stock, { scrap: 400, parts: 30 });
const addPeople = (st, base, n) => { for (let i = 0; i < n; i++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: base.id }; st.survivors.push(s); } };
const wishes = (st, base) => housingAI.wishes(st, base); // autopilot.js buildWishes
const types = (list) => list.map((w) => w.type).join(", ");
// Every plot of a kind taken by standing buildings of these types (none with beds, none a family).
const fillPlots = (base, kind, list) => { let i = 0; while (plotsFree(base, kind) > 0) addBuilding(base, list[i++ % list.length]); };
// Finishes every job in the queue (as the builders would).
const finishAll = (st, base) => { for (let i = 0; i < 40 && base.construction.length; i++) { for (const j of base.construction) j.progress = j.hours; constructionHour(st); } };
const r1 = (v) => Math.round(v * 10) / 10;
const parkAway = (st, base) => { for (const v of carsAtBase(st, base.id)) v.loc = { kind: "base", baseId: -1 }; }; // no car's room (basestorage.js counts a parked car's payload)

section("Beds when the building plots are used up");
{
  const st = world(), h = hub(st);
  rich(h);
  fillPlots(h, "building", ["cistern", "cellar", "greenhouse", "common_room"]);
  check(plotsFree(h, "building") === 0, `every building plot of the hub taken (${h.buildings.length} buildings)`);
  const beds = baseBeds(h) + queuedBeds(h);
  addPeople(st, h, Math.max(0, beds - atBase(st, h.id).length + 3));
  const people = atBase(st, h.id).length;
  const w = wishes(st, h);
  const gw = w.find((x) => GENERAL.includes(x.type));
  check(gw && gw.type === "gen_barn", `${people} people for ${beds} beds: the hub wishes for a barn (${gw ? gw.type : types(w)})`);
  check(gw && /beds/.test(gw.why) && /barn with bunks inside/.test(gw.why) && gw.save, `why "${gw ? gw.why : ""}", saved for`);
  check(!w.some((x) => x.type === "bunkhouse" || x.type === "barracks"), "no bunkhouse or barracks wished for (no plot for them)");
  check(!w.some((x) => x.type === "bunks"), "no bunk beds wished for with no building to put them in");
  // Short of the barn's parts: the next size down the base can pay for.
  h.stock.parts = 2;
  const w1 = wishes(st, h);
  check(w1.some((x) => x.type === "gen_hall"), `short of the barn's 3 parts: a hall (${types(w1.filter((x) => GENERAL.includes(x.type)))})`);
  h.stock.parts = 30;
  // Short of scrap for any of them: the barn is saved for.
  h.stock.scrap = 5;
  const w2 = wishes(st, h);
  check(w2.some((x) => x.type === "gen_barn" && x.save), `short of scrap: the barn saved for (${types(w2.filter((x) => GENERAL.includes(x.type)))})`);
  h.stock.scrap = 400;
  // With a barn standing: bunk beds inside it.
  const barn = addBuilding(h, "gen_barn");
  const w3 = wishes(st, h);
  const bw = w3.find((x) => x.type === "bunks");
  check(bw && /beds/.test(bw.why) && bw.save, `with the barn standing: bunk beds wished for (${bw ? bw.why : types(w3)})`);
  check(!w3.some((x) => GENERAL.includes(x.type)), "no second general building while the barn has floor");
  const msg = queueBuild(st, h, "bunks");
  const job = h.construction.find((c) => c.type === "bunks");
  check(/queued/.test(msg) && job, `the bunks queued as a wish is (${msg})`);
  const laid = job && layoutOf(st, h).find((x) => x.it.key === `c:${job.id}`);
  check(laid && laid.at, "the queued bunks are laid out on the map by the game");
  check(baseBeds(h) + queuedBeds(h) === beds + 2, `the queued bunks count as 2 beds (${baseBeds(h) + queuedBeds(h)} for ${beds} before)`);
  finishAll(st, h);
  check(count(h, "bunks") === 1 && baseBeds(h) === beds + 2, `built: ${baseBeds(h)} beds`);
  check(fittingsIn(st, h, barn.id).some((o) => o.rec.type === "bunks"), "the bunks stand inside the barn");
  // The governor queues them itself (planBuilds): the first wish it can queue an hour, until the queue is full; the
  // water and the worm's wishes (a boiler, a cook fire) come before the beds, so the builders finish what it queued.
  setAutopilot(st, true, "balanced");
  const seen = [];
  for (let i = 0; i < 12 && !seen.includes("bunks"); i++) { governBase(st, h); seen.push(...h.construction.map((c) => c.type).filter((t) => !seen.includes(t))); if (!seen.includes("bunks")) finishAll(st, h); }
  check(seen.includes("bunks"), `planBuilds queued bunk beds (queued in turn: ${seen.join(", ") || "nothing"})`);
}
{
  const st = world(), h = hub(st);
  h.tier = 0; h.camp = true; h.buildings = []; h.construction = []; delete h.plan; // a camp: no building plot at all
  h.stock.scrap = 60; h.stock.buildmat = 20;
  addPeople(st, h, Math.max(0, CAMP.beds + 2 - atBase(st, h.id).length));
  const w = wishes(st, h);
  const gw = w.find((x) => GENERAL.includes(x.type));
  check(gw && gw.type === "gen_hut" && /bunks inside/.test(gw.why), `a crowded camp wishes for a hut (${gw ? gw.type : types(w)})`);
  addBuilding(h, "gen_hut");
  check(wishes(st, h).some((x) => x.type === "bunks"), "and with the hut standing, for bunk beds");
}

section("Storage when goods lie outside (storageWish)");
{
  const st = world(), h = hub(st);
  parkAway(st, h);
  const hall = addBuilding(h, "gen_hall");
  h.stock.scrap = 700; // 1400 kg of scrap alone, against the main house's 1200
  const so = storageOf(st, h);
  check(so.outsideKg > 0 && so.cap === 1200, `goods lie outside (${Math.round(so.outsideKg)} kg; room ${so.cap} kg)`);
  const w = wishes(st, h);
  const sw = w.find((x) => x.type === "shelves");
  check(sw && /lie outside/.test(sw.why) && /inside a general building/.test(sw.why) && !sw.save, `shelves wished for on the hall's floor, not saved for (dev's rule) (${sw ? sw.why : types(w)})`);
  check(w.filter((x) => BUILDINGS[x.type] && (BUILDINGS[x.type].storeKg || GENERAL.includes(x.type))).length === 1, "one storage wish, not two");
  const iw = w.findIndex((x) => x.type === "shelves"), ic = w.findIndex((x) => x.type === "common_room" || x.type === "chapel");
  check(ic < 0 || iw < ic, "ahead of the comfort buildings");
  // Room to spare: no wish.
  h.stock.scrap = 100;
  check(!wishes(st, h).some((x) => ["shelves", "lockers", "storehouse", "shed", "crates", "warehouse"].includes(x.type) || GENERAL.includes(x.type)), "room to spare: no storage wish");
  // The shelves at their limit (and floor left for lockers: two barns): lockers.
  const barns = [addBuilding(h, "gen_barn"), addBuilding(h, "gen_barn")];
  for (let i = 0; i < BUILDINGS.shelves.max; i++) addBuilding(h, "shelves");
  h.stock.scrap = 3200; // 6400 kg against 1200 + 24 × 150
  const w2 = wishes(st, h);
  check(w2.some((x) => x.type === "lockers") && !w2.some((x) => x.type === "shelves"), `the shelves at their limit (${BUILDINGS.shelves.max}): lockers (${types(w2.filter((x) => ["shelves", "lockers"].includes(x.type)))})`);
  h.buildings = h.buildings.filter((b) => b.type !== "shelves" && !barns.includes(b));
  h.stock.scrap = 700;
  // One wish at a time: shelves queued, nothing more.
  queueBuild(st, h, "shelves");
  check(!wishes(st, h).some((x) => ["shelves", "lockers", "storehouse", "shed", "crates", "warehouse"].includes(x.type)), "shelves queued: no second storage wish");
  h.construction = [];
  // No general building: a storage building off the ladder, the smallest that holds what lies outside.
  h.buildings = h.buildings.filter((b) => b.id !== hall.id);
  const out3 = storageOf(st, h).outsideKg;
  const w3 = wishes(st, h), s3 = w3.find((x) => ["crates", "shed", "storehouse", "warehouse"].includes(x.type));
  check(s3 && BUILDINGS[s3.type].storeKg >= out3 && !w3.some((x) => GENERAL.includes(x.type)), `no general building: ${s3 ? BUILDINGS[s3.type].name : "nothing"} for ${Math.round(out3)} kg outside`);
  // Nothing on the ladder can go up (every plot taken): a general building for shelves and lockers, not saved for.
  rich(h); h.stock.scrap = 1500;
  fillPlots(h, "building", ["cistern", "greenhouse", "common_room"]);
  fillPlots(h, "utility", ["rain_catcher", "water_barrel", "smoker"]);
  const w4 = wishes(st, h), g4 = w4.find((x) => GENERAL.includes(x.type) && /shelves and lockers/.test(x.why));
  check(g4 && g4.type === "gen_barn" && !g4.save, `no plot for storage: a barn for shelves and lockers, not saved for (${g4 ? g4.why : types(w4)})`);
}

section("The morning's tidy (tidyStores)");
{
  // Put away: nothing left in no container but a part of a unit (a bin holds whole units: 0.9 of a bag of rice stays).
  const tidyNow = (c) => !c.gear.length && Object.values(c.sup).every((q) => q < 1);
  const st = world(), h = hub(st);
  h.stock.scrap = 100;
  const before = containerByKey(st, h, LOOSE), sb = storageOf(st, h);
  check(before.kg > 0 && sb.outsideKg === 0, `untidied goods are put away nowhere (${r1(before.kg)} kg), all inside the room (${sb.cap} kg)`);
  setAutopilot(st, true, "balanced");
  let tidied = -1;
  for (let i = 0; i < 48 && tidied < 0; i++) { tickHour(st); if (autopilotStats(st).stored > 0) tidied = hourOfDay(st); }
  const after = containerByKey(st, h, LOOSE), ka = storageKg(st, h);
  check(tidied >= 0 && tidyNow(after), `the governor's morning tidy put them away (at ${tidied}:00: ${r1(after.kg)} kg left put away nowhere, parts of a unit, ${autopilotStats(st).stored} kg stored, ${r1(ka.held)} of ${ka.cap} kg inside)`);
  // A day on, the goods that came in since are put away again.
  const s0 = autopilotStats(st).stored;
  for (let i = 0; i < 24; i++) tickHour(st);
  const again = containerByKey(st, h, LOOSE);
  check(autopilotStats(st).stored >= s0 && tidyNow(again), `and the next morning's too (${r1(again.kg)} kg put away nowhere, ${autopilotStats(st).stored} kg stored all told)`);
}

section("A wood stove where no cook fire can go up");
{
  const st = world(), h = hub(st);
  rich(h);
  fillPlots(h, "utility", ["rain_catcher", "water_barrel", "crates", "smoker"]);
  addBuilding(h, "gen_cabin");
  check(count(h, "cookhouse") === 0 && plotsFree(h, "utility") === 0, "no cook fire, no utility plot left, a cabin standing");
  const w = wishes(st, h);
  const ic = w.findIndex((x) => x.type === "cookhouse"), is = w.findIndex((x) => x.type === "stove");
  check(ic >= 0 && is === ic + 1 && /wood stove indoors/.test(w[is].why), `the stove wished for right behind the cook fire (${ic >= 0 && is >= 0 ? w[is].why : types(w)})`);
  const msg = queueBuild(st, h, "stove");
  check(/queued/.test(msg), `queued (${msg})`);
  finishAll(st, h);
  check(count(h, "cookhouse") === 1 && countAll(h, "stove") === 1, "built: the stove counts as the cook fire");
  check(!wishes(st, h).some((x) => x.type === "stove" || x.type === "cookhouse"), "no cook fire or stove wished for with the stove standing");
  // A utility plot free again and no cook fire: the cook fire itself, no stove.
  h.buildings = h.buildings.filter((b) => b.type !== "stove" && b.type !== "smoker");
  const w2 = wishes(st, h);
  check(w2.some((x) => x.type === "cookhouse") && !w2.some((x) => x.type === "stove"), "a utility plot free: the cook fire, no stove");
}

section(`A ${DAYS}-day autopilot run (seed ${seed})`);
{
  const st = createWorld({ seed, factionCount: 8 });
  st.started = true;
  setAutopilot(st, true, "balanced");
  let crash = null;
  try {
    while (day(st) <= DAYS && !st.gameOver) tickHour(st);
    // On to the morning's tidy (the goods that came in since are put away nowhere until it).
    const s0 = autopilotStats(st).stored;
    for (let i = 0; i < 30 && !st.gameOver && autopilotStats(st).stored === s0; i++) tickHour(st);
  } catch (e) { crash = e; }
  check(!crash, `no crash (${crash ? crash.stack.split("\n").slice(0, 3).join(" | ") : "ok"})`);
  const h = hub(st);
  check(h && !st.gameOver, `the holdout stands on day ${day(st)} (${alive(st).length} alive)`);
  if (h) {
    const so = storageOf(st, h), sum = storageKg(st, h);
    const gen = GENERAL.map((t) => [t, countAll(h, t)]).filter(([, n]) => n);
    const fits = ["bunks", "shelves", "lockers", "stove"].map((t) => [t, countAll(h, t)]).filter(([, n]) => n);
    check(so.used === 0 || so.outsideKg <= so.used * 0.1, `under a tenth of the hub's goods lie outside (${r1(so.outsideKg)} of ${r1(so.used)} kg; room ${so.cap} kg: ${Object.entries(sum.byKey).map(([k, v]) => `${k} ${Math.round(v.kg)}/${v.cap}`).join(", ")})`);
    check(GENERAL.every((t) => countAll(h, t) <= BUILDINGS[t].max), `general buildings within their limits (${gen.map(([t, n]) => `${BUILDINGS[t].name} ${n}`).join(", ") || "none"})`);
    check(["bunks", "shelves", "lockers", "stove"].every((t) => countAll(h, t) <= BUILDINGS[t].max), `fittings within their limits (${fits.map(([t, n]) => `${BUILDINGS[t].name} ${n}`).join(", ") || "none"})`);
    const g = autopilotStats(st);
    console.log(`  hub: ${h.buildings.length} buildings (${[...new Set(h.buildings.map((b) => b.type))].join(", ")}), ${baseBeds(h)} beds for ${atBase(st, h.id).length} here, ${plotsFree(h, "building")} building and ${plotsFree(h, "utility")} utility plots free; governor built ${g.builds}, stored ${g.stored} kg; stock scrap ${Math.floor(h.stock.scrap || 0)}, parts ${Math.floor(h.stock.parts || 0)}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
