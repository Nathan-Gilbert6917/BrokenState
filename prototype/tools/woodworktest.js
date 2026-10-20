// Woodwork (the user's picks 2026-10-20, branch woodwork; src/sim/woodwork.js, buildings.js, crafting.js,
// fieldworks.js, groupworks.js, jobtrips.js, activity.js, work.js, autopilot.js govWoodwork, basemap.js F.clearing,
// ui/basemap.js, ui/isoview.js):
// - the raised wood costs (walls, palisades, gates, stands, barricades, sheds, huts to barns, pens, plots...) and wood
//   added where a build is plausibly wooden (benches, racks, the ladder, the ram...), taken from the stores; no metal or
//   electrical build gained wood; a wooden craft never burns into more wood than it took; the AI groups pay their
//   share from their woodpile and cut the rest as part of the job;
// - the woodcutters fell the trees marked on the base map before their trips (and the builders still can), shown
//   on the map with who is on it and how far;
// - the governor fells the nearest trees beyond the walls when wood is short of the fires' reserve and its next
//   builds, a few at a time, and clears a planned site ahead (only where the land is in the way);
// - a hub opening runs 60 days with the governor without the woodpile running out or anyone cold; the hardcore start
//   still founds its camp.
// Usage: node tools/woodworktest.js [seed] [opening seeds, comma separated] (default 42; 1,2)
import { createWorld, tickHour, hub, atBase, makeSurvivor, day, alive } from "../src/sim/world.js";
import { BUILDINGS, WALL_TIERS, STAND, BARRACKS_UP, WATER_BARREL, queueBuild, canBuild, constructionHour, pieceCost } from "../src/sim/buildings.js";
import { CRAFTS, queueCraft } from "../src/sim/crafting.js";
import { FIELD } from "../src/sim/fieldworks.js";
import { GROUP_WORKS, groupWorksDaily } from "../src/sim/groupworks.js";
import { burnOfKey, woodNeed } from "../src/sim/woodcutting.js";
import { setAutopilot, autopilotHour, autopilotStats } from "../src/sim/autopilot.js";
import { jobTripsHour } from "../src/sim/jobtrips.js";
import { describeActivity } from "../src/sim/activity.js";
import { econStats } from "../src/sim/farming.js";
import { newItem } from "../src/sim/inventory.js";
import * as WW from "../src/sim/woodwork.js";
import * as BM from "../src/sim/basemap.js";
import * as SC from "../src/sim/basescatter.js";
import { layoutPanel } from "../src/ui/basemap.js";

const SEED = Number(process.argv[2] || 42);
const OPEN = (process.argv[3] || "1,2").split(",").map(Number);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
const world = (s = SEED, extra = {}) => { const st = createWorld({ seed: s, factionCount: 6, ...extra }); st.started = true; return st; };
const freeTile = (st, test) => Object.keys(st.tiles).map(Number).filter((t) => st.tiles[t].terrain !== "water" && !st.tiles[t].bridge && !st.bases.some((b) => b.tile === t) && test(st.tiles[t])).sort((a, b) => a - b)[0];
function makeCamp(st, tile) {
  const camp = { id: 9000 + st.bases.length, tile, type: "outpost", name: "Test Camp", stock: { water: 50, fuel: 0, meds: 0, ammo: 0, arrows: 0, parts: 0, scrap: 0, jars: 0, wood: 0, buildmat: 0, rawwater: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [], tier: 0, camp: true, fire: false };
  st.bases.push(camp);
  return camp;
}
const people = (st, base, n, role = null) => { const out = []; for (let i = 0; i < n; i++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: base.id }; s.health = 100; s.gear.weapon = newItem("pistol"); if (role) s.role = role; st.survivors.push(s); out.push(s); } return out; };
const atHour = (st, h) => { st.hour = Math.floor(st.hour / 24) * 24 + 24 * 3 + h; }; // a day of the spring, at hour h

// ---------- 1. The costs: before and after ----------
// baseview (f1762545) costs, for the table and the raises.
const BEFORE = {
  farm_plot: { scrap: 7, wood: 75 }, craftbench: { scrap: 12, parts: 1 }, workbench: { scrap: 16, parts: 1 }, ammo_bench: { scrap: 15, parts: 1 },
  bunkhouse: { scrap: 17, wood: 150 }, barracks: { scrap: 40, parts: 2 }, barricades: { scrap: 7, wood: 75 }, spike_pits: { scrap: 5, wood: 75 },
  barbed_wire: { scrap: 5 }, trench: { scrap: 10, wood: 100 }, watchtower: { scrap: 12, wood: 150 }, garage: { scrap: 20, parts: 2 },
  storehouse: { scrap: 18 }, shed: { scrap: 10, wood: 100, buildmat: 1 }, well: { scrap: 15, parts: 1 }, cellar: { scrap: 15 }, coldstore: { scrap: 20 },
  kitchen: { scrap: 18, parts: 1 }, huntcabin: { scrap: 10, wood: 125 }, canteen: { scrap: 20, parts: 1 }, smoker: { scrap: 5, wood: 75 },
  common_room: { scrap: 22 }, animal_pen: { scrap: 12, wood: 125 }, chapel: { scrap: 16 }, infirmary: { scrap: 15, meds: 2 },
  gen_hut: { scrap: 8, wood: 100 }, gen_cabin: { scrap: 13, wood: 150 }, gen_lodge: { scrap: 22, wood: 200, parts: 1 }, gen_hall: { scrap: 34, wood: 300, parts: 2 }, gen_barn: { scrap: 50, wood: 500, parts: 3 },
  wall4: { wood: 8 }, gate4: { wood: 12 }, stand4: { wood: 16, scrap: 1 },
};
// The user's list to raise (pick 1), and the wooden things given wood (pick 2).
const RAISE = ["wall4", "gate4", "stand4", "barricades", "spike_pits", "trench", "watchtower", "shed", "gen_hut", "gen_cabin", "gen_lodge", "gen_hall", "gen_barn", "animal_pen", "farm_plot", "smoker", "huntcabin", "bunkhouse"];
const ADDED = ["craftbench", "workbench", "ammo_bench", "barracks", "barbed_wire", "garage", "storehouse", "well", "cellar", "coldstore", "kitchen", "canteen", "common_room", "chapel", "infirmary"];
// Metal, electrical, masonry, medical-grade: no wood. (The lockers took a plank plinth with the furniture and storage
// fittings, the user's pick 2026-10-20: ptinttest.)
const NO_WOOD = ["toolbench", "reload_bench", "machine_shop", "radio", "relay", "generator", "freezer", "sealer", "grainmill", "meatgrinder", "still", "greenhouse", "warehouse", "armory", "cistern", "rain_catcher", "boiler", "water_barrel", "floodlights", "razor_wire", "minefield", "guard_towers", "gate", "camo", "stove", "canner", "med_station", "field_hosp", "clinic", "hospital", "lockup", "cells", "jailhouse", "sandbag_wall", "cookhouse"];
const costOf = (k) => (BUILDINGS[k].piece ? pieceCost(k, 1) : BUILDINGS[k].cost);
const txt = (c) => Object.entries(c || {}).map(([k, v]) => `${v} ${k}`).join(" + ") || "-";
section("1. The costs: raised for the wooden builds, wood added where it makes sense, none on metal or electrical");
{
  console.log("  build                 before                      after");
  for (const k of [...RAISE, ...ADDED]) console.log(`  ${(BUILDINGS[k].name).padEnd(22)}${txt(BEFORE[k]).padEnd(28)}${txt(costOf(k))}`);
  for (const k of RAISE) check((costOf(k).wood || 0) >= 3 * (BEFORE[k].wood || 1), `${BUILDINGS[k].name}: wood raised at least threefold (${BEFORE[k].wood} → ${costOf(k).wood})`);
  for (const k of ADDED) check((costOf(k).wood || 0) > 0 && !BEFORE[k].wood, `${BUILDINGS[k].name}: wood added (${txt(costOf(k))})`);
  // Wood the main material of the wooden things: its worth (50 wood a scrap) over the scrap's.
  for (const k of [...RAISE.filter((x) => !["wall4"].includes(x)), "craftbench"]) {
    const c = costOf(k);
    check((c.wood || 0) / 50 >= (c.scrap || 0) || k === "craftbench", `${BUILDINGS[k].name}: wood is the main material (${c.wood} wood ≈ ${Math.round((c.wood || 0) / 50)} scrap of worth against ${c.scrap || 0} scrap)`);
  }
  check(WALL_TIERS[1].cost.wood === 40 && WALL_TIERS[2].cost.wood === 64 && WALL_TIERS[1].gate.wood === 60 && WALL_TIERS[1].gate.scrap === 1 && STAND.cost.wood === 50, `the wooden wall 40 a 1×4 (was 8), the palisade 64, the gate 60 + a scrap, a stand 50 + a scrap`);
  check(pieceCost("wall1", 1).wood === 10 && pieceCost("wall2", 2).wood === 32, `a 1×1 pays its share (10), a palisade 1×2 32`);
  check(!WALL_TIERS[3].cost.wood && !WALL_TIERS[3].gate.wood && !WALL_TIERS[4].cost.wood && !WALL_TIERS[4].gate.wood, "the scrap-metal and metal-sheet walls take no wood");
  for (const k of NO_WOOD) check(BUILDINGS[k] && !(BUILDINGS[k].cost.wood > 0), `${BUILDINGS[k] ? BUILDINGS[k].name : k}: no wood (${BUILDINGS[k] ? txt(BUILDINGS[k].cost) : "?"})`);
  check(!WATER_BARREL.tiers[3].cost.wood && WATER_BARREL.tiers[2].cost.wood === 100, "a barrel rack (a timber rack) takes wood, the water tank none");
  check(BARRACKS_UP.cost.wood === 400, `a bunkhouse expanded into a barracks: ${txt(BARRACKS_UP.cost)}`);
  // Field works: the wooden ones raised, the metal ones none.
  for (const k of ["roadblock", "tower", "stockpile", "blind", "spikes"]) check((FIELD.KINDS[k].cost.wood || 0) >= 150, `field work ${FIELD.KINDS[k].name}: ${txt(FIELD.KINDS[k].cost)}`);
  for (const k of ["well", "relay", "snares"]) check(!(FIELD.KINDS[k].cost.wood > 0), `field work ${FIELD.KINDS[k].name}: no wood`);
  // Crafting: the wooden things take wood; nothing burns into more wood than it took (the siege ladder made from 4 scrap
  // broke down into 90 wood); the metal recipes none.
  for (const [k, w] of [["ladder", 100], ["ram", 150], ["spikedbat", 15], ["makeshiftrod", 5], ["crossbow", 20], ["handcart", 120], ["arrows", 30], ["boards", 30]]) check((CRAFTS[k].in.wood || 0) === w, `craft ${k}: ${txt(CRAFTS[k].in)}`);
  const burns = Object.entries(CRAFTS).filter(([, r]) => r.gear && burnOfKey(r.gear) > 0 && !r.gearIn && /^(spikedbat|ladder|ram|makeshiftrod|crossbow|handcart)$/.test(r.gear));
  for (const [k, r] of burns) check((r.in.wood || 0) >= burnOfKey(r.gear), `craft ${k}: takes ${r.in.wood || 0} wood, breaks down into ${burnOfKey(r.gear)}`);
  for (const k of ["shiv", "bowie", "pipegun", "fishrod", "beartrap", "steelplate", "suppressor", "bicycle", "wheelbarrow", "pipebomb", "flashlight", "lantern", "spotlight", "headlamp", "repairkit", "scrapvest", "tirevest"]) if (CRAFTS[k]) check(!(CRAFTS[k].in.wood > 0), `craft ${k}: metal, no wood`);
  // The AI groups' works: their share raised with yours; their metal works none.
  const GW = GROUP_WORKS.WORKS;
  check(GW.farms.cost.wood === 75 && GW.beds.cost.wood === 150 && GW.walls.cost.wood === 250 && GW.pens.cost.wood === 125 && GW.bench.cost.wood === 50 && GW.kitchen.cost.wood === 75, `the groups' works: fields ${GW.farms.cost.wood}, quarters ${GW.beds.cost.wood}, a wall ${GW.walls.cost.wood}, pens ${GW.pens.cost.wood}, a workshop ${GW.bench.cost.wood}, a kitchen ${GW.kitchen.cost.wood}`);
  for (const k of ["water", "still", "power", "freezer", "sealer", "shop", "radio", "reload", "gate", "mill", "grinder"]) check(GW[k] && !(GW[k].cost.wood > 0), `their ${GW[k] ? GW[k].name : k}: no wood`);
}

// ---------- 2. Taken from the stores ----------
section("2. The raised costs come out of the stores (yours and the groups')");
{
  const st = world();
  const h = hub(st);
  BM.clearAllLand(st, h);
  Object.assign(h.stock, { wood: 5000, scrap: 200, parts: 10, buildmat: 4, meds: 10 });
  for (const type of ["bunkhouse", "farm_plot", "craftbench", "barricades", "watchtower", "shed", "smoker", "gen_hut"]) {
    const w0 = h.stock.wood, s0 = h.stock.scrap;
    const chk = canBuild(st, h, type);
    if (!chk.ok) { check(false, `${type}: ${chk.reason}`); continue; }
    queueBuild(st, h, type);
    check(w0 - h.stock.wood === BUILDINGS[type].cost.wood && s0 - h.stock.scrap === (BUILDINGS[type].cost.scrap || 0), `${BUILDINGS[type].name}: −${w0 - h.stock.wood} wood, −${s0 - h.stock.scrap} scrap`);
  }
  for (const [type, mat] of [["wall4", 1], ["gate4", 1], ["wall4", 2], ["stand4", 0]]) {
    const w0 = h.stock.wood, s0 = h.stock.scrap;
    const r = queueBuild(st, h, type, { mat });
    const c = pieceCost(type, mat || 1);
    check(/queued/.test(r) && w0 - h.stock.wood === c.wood && s0 - h.stock.scrap === (c.scrap || 0), `${type} (${mat ? WALL_TIERS[mat].mat : "stand"}): −${w0 - h.stock.wood} wood, −${s0 - h.stock.scrap} scrap (${r})`);
  }
  h.stock.wood = 50;
  check(/Needs 600 wood/.test(canBuild(st, h, "bunkhouse").reason || ""), `short of wood a bunkhouse waits: "${canBuild(st, h, "bunkhouse").reason}"`);
  // A crafted ladder (at a crafting bench).
  h.stock.wood = 500;
  h.buildings.push({ id: 99001, type: "craftbench" });
  people(st, h, 1, "craft").forEach((s) => { s.skills.mechanics = 4; });
  const w0 = h.stock.wood;
  const r = queueCraft(st, h, "ladder");
  check(/queued/.test(r) && w0 - h.stock.wood === 100, `a siege ladder: −${w0 - h.stock.wood} wood (${r})`);
  // The groups: a work's wood from the woodpile above their keep, the rest cut by their crew as part of the job.
  let seen = 0;
  for (const f of st.factions.filter((x) => x.alive && x.bases.length)) {
    f.job = null;
    f.stock.scrap = 100; f.stock.parts = 10;
    const keep = f.pop * GROUP_WORKS.WOOD.keepHead;
    f.stock.wood = keep + 30;
    groupWorksDaily(st, f);
    const def = f.job && GROUP_WORKS.WORKS[f.job.type];
    if (!def || !(def.cost.wood > 0) || !f.job.paid) continue;
    seen++;
    check(f.stock.wood === keep && f.job.cut === def.cost.wood - 30 && f.job.paid, `${f.name}'s ${def.name}: 30 wood from its pile (it keeps ${keep}), the other ${f.job.cut} cut by its crew (${Math.round(f.job.left * 10) / 10} crew-days left of ${def.work}), paid, not salvaged`);
    if (seen >= 2) break;
  }
  if (!seen) {
    const f = st.factions.find((x) => x.alive && x.bases.length);
    const w = (f.works || (f.works = {}))[f.bases[0]] || (f.works[f.bases[0]] = {});
    Object.assign(w, { water: 9 });
    f.job = null; f.stock.wood = f.pop * GROUP_WORKS.WOOD.keepHead;
    groupWorksDaily(st, f);
    const def = f.job && GROUP_WORKS.WORKS[f.job.type];
    check(!!def && def.cost.wood > 0 && f.job.cut === def.cost.wood && f.job.left > 0, `a group with no wood to spare: its crew cuts all the wood for ${def ? def.name : "the work"} as part of the job (${f.job ? f.job.cut : "-"} wood)`);
  }
}

// ---------- 3. Woodcutters fell the marked trees first ----------
section("3. Woodcutters take the felling marked on the base map before their trips; builders can too; shown on the map");
{
  const st = world(SEED + 3);
  const camp = makeCamp(st, freeTile(st, (t) => t.terrain === "forest"));
  camp.tier = 1; camp.camp = false; // a plain outpost (no camp fire to tend)
  const [wc] = people(st, camp, 1, "wood");
  wc.skills.farming = 3;
  const land = BM.landFor(st, camp);
  const trees = land.list.filter((p) => p.k === "tree").sort((a, b) => Math.hypot(...a.cells[0]) - Math.hypot(...b.cells[0])).slice(0, 2);
  atHour(st, 8);
  // Nothing marked: the woodcutter goes out on a trip.
  jobTripsHour(st);
  check(!!wc.trip && !wc.chop, `nothing marked: out on a trip (${wc.trip ? `to tile ${wc.trip.tile}` : "none"})`);
  delete wc.trip; delete wc.tripNext;
  const j1 = BM.queueClear(st, camp, [trees[0]]);
  const j2 = BM.queueClear(st, camp, [trees[1]]);
  check(WW.isChopJob(j1) && WW.chopJobs(camp).length === 2 && WW.hasChopWork(camp), `two trees marked (${j1.label}, ${j1.hours} h, +${j1.get.wood} wood)`);
  const wood0 = camp.stock.wood;
  let hours = 0, tripped = false;
  st.hour += 1;
  while (WW.chopJobs(camp).length && hours < 96) {
    jobTripsHour(st);
    if (wc.trip) tripped = true;
    if (hours === 1) {
      const a = describeActivity(st, wc);
      check(a.kind === "work" && /Fell/.test(a.text), `the activity line: "${a.text}"`);
      const who = WW.chopHands(st, camp, WW.chopJobs(camp)[0]);
      check(who.includes(wc.name.split(" ")[0]), `on the map: ${who.join(", ")} felling it`);
    }
    st.hour++; hours++;
  }
  check(!tripped, "no trip while the felling waits");
  check(!WW.chopJobs(camp).length && camp.stock.wood - wood0 === 2 * SC.CLEAR.tree.get.wood, `both felled in ${hours} hours (daylight only): +${camp.stock.wood - wood0} wood into the stores`);
  check(!BM.landFor(st, camp).pieces.has(`${trees[0].cells[0][0]},${trees[0].cells[0][1]}`), "the tree is gone from the map");
  // Then the trips again.
  delete wc.trip; delete wc.tripNext;
  atHour(st, 9);
  jobTripsHour(st);
  check(!!wc.trip, "with nothing left to fell, out on trips again");
  // A woodcutter out on a trip when a tree is marked finishes the trip first.
  const t3 = BM.landFor(st, camp).list.find((p) => p.k === "tree");
  BM.queueClear(st, camp, [t3]);
  const tr = wc.trip;
  st.hour++; jobTripsHour(st);
  check(wc.trip === tr, "one already out finishes the trip");
  // The builders work it too, and show on the map.
  const [b1] = people(st, camp, 1, "build");
  delete wc.trip; delete wc.tripNext; wc.role = "farm";
  const jb = WW.chopJobs(camp)[0];
  const p0 = jb.progress || 0;
  constructionHour(st);
  check(jb.progress > p0 && WW.chopHands(st, camp, jb).includes(b1.name.split(" ")[0]), `the builders fell it from the queue (${Math.round(jb.progress * 10) / 10} of ${jb.hours} h; ${WW.chopHands(st, camp, jb).join(", ")} on it)`);
  // The view's clearing list says who and how far.
  const err = BM.openBaseMap(st, camp.id);
  const F = st.combat && st.combat.deployPlan && st.combat.deployPlan.fort;
  const cl = F && F.clearing && F.clearing.find((c) => c.id === jb.id);
  check(!err && cl && cl.who.includes(b1.name.split(" ")[0]) && cl.pct > 0, `the base map: ${cl ? `${cl.who.join(", ")} ${cl.pct}%` : "no clearing shown"}`);
  const html = st.combat ? layoutPanel(st, st.combat, { msg: "" }) : "";
  check(html.includes("on it") && html.includes(b1.name.split(" ")[0]), "the Clearing list names who is on it");
  st.combat = null;
}

// ---------- 4. The governor ----------
section("4. The governor fells for wood when short, a few trees at a time beyond the walls, and clears a planned site ahead");
{
  const st = world(SEED + 5);
  const h = hub(st);
  setAutopilot(st, true);
  h.stock.wood = 0;
  h.stock.scrap = 200;
  st.hour = Math.ceil(st.hour / WW.WOODWORK.govEvery) * WW.WOODWORK.govEvery + 24 * 2;
  autopilotHour(st);
  const mine = h.construction.filter((c) => c.gov === "wood");
  const R = BM.ringHalf(h);
  check(mine.length > 0 && mine.length <= WW.WOODWORK.govMax, `short of wood: ${mine.length} trees queued for felling (at most ${WW.WOODWORK.govMax})`);
  check(mine.every((c) => c.pieces.every((p) => Math.max(...p.cells[0].map(Math.abs)) > R + WW.WOODWORK.beyond - 1)), `all beyond the walls (ring ${R} + ${WW.WOODWORK.beyond}): ${mine.map((c) => c.pieces[0].cells[0].join(",")).join(" ")}`);
  const d = mine.map((c) => Math.hypot(...c.pieces[0].cells[0]));
  const far = BM.landFor(st, h).list.filter((p) => p.k === "tree" && Math.max(...p.cells[0].map(Math.abs)) > R + WW.WOODWORK.beyond && !mine.some((c) => c.pieces[0].g === p.g));
  check(far.every((p) => Math.hypot(...p.cells[0]) >= Math.max(...d) - 1e-9), "the nearest ones");
  st.hour += WW.WOODWORK.govEvery;
  autopilotHour(st);
  check(h.construction.filter((c) => c.gov === "wood").length <= WW.WOODWORK.govMax, "no more than that waiting, however short");
  // Plenty of wood: nothing more felled.
  const st2 = world(SEED + 5);
  const h2 = hub(st2);
  setAutopilot(st2, true);
  h2.stock.wood = 50000;
  st2.hour = Math.ceil(st2.hour / WW.WOODWORK.govEvery) * WW.WOODWORK.govEvery + 24 * 2;
  autopilotHour(st2);
  check(!h2.construction.some((c) => c.gov === "wood"), "with the woodpile full nothing is felled");
  // Under the fires' days (wood 0): its felling first; above them, behind its builds (the builders fell when idle).
  const order = (hb) => hb.construction.map((c) => c.type + (c.gov ? `:${c.gov}` : "")).join(", ");
  check(h.construction[0] && h.construction[0].gov === "wood", `no wood at all: the felling at the front of the queue (${order(h)})`);
  const st5 = world(SEED + 5);
  const h5 = hub(st5);
  setAutopilot(st5, true);
  st5.hour = Math.ceil(st5.hour / WW.WOODWORK.govEvery) * WW.WOODWORK.govEvery + 24 * 2;
  h5.stock.wood = 900; h5.stock.scrap = 200;
  for (let i = 0; i < 3; i++) { autopilotHour(st5); st5.hour += WW.WOODWORK.govEvery; }
  const wn5 = woodNeed(st5, h5);
  const i5 = h5.construction.findIndex((c) => c.gov === "wood");
  const urgent = (h5.stock.wood || 0) < wn5.dailyKeep + 3 * (wn5.daily || 0);
  check(i5 < 0 || urgent || h5.construction.slice(i5).every((c) => c.type === "clear"), `with the fires' days in store its builds go ahead of its felling (${order(h5)}; ${Math.round(h5.stock.wood)} wood)`);

  // Clear ahead: a forest camp with more queued than open ground.
  const st3 = world(SEED + 9);
  const c3 = makeCamp(st3, freeTile(st3, (t) => t.terrain === "forest"));
  people(st3, c3, 2, "build");
  BM.landFor(st3, c3);
  for (let i = 0; i < 14; i++) c3.construction.push({ id: 81000 + i, type: "tent", progress: 0, hours: 3 });
  for (let i = 0; i < 10; i++) c3.construction.push({ id: 81020 + i, type: "gen_hut", progress: 0, hours: 14 });
  const sites = WW.clearAhead(st3, c3, "gen_hut");
  const clears = c3.construction.filter((c) => c.type === "clear");
  const lay = BM.layoutOf(st3, c3);
  const onLand = c3.construction.filter((c) => c.type !== "clear" && lay.find((e) => e.it.key === `c:${c.id}`) && BM.landUnder(BM.landFor(st3, c3), lay.find((e) => e.it.key === `c:${c.id}`).it, lay.find((e) => e.it.key === `c:${c.id}`).at).length);
  check(sites.length > 0 && clears.length > 0, `the queued builds' sites on the land cleared ahead: ${clears.map((c) => c.label).join("; ")}`);
  check(onLand.every((j) => { const i = c3.construction.indexOf(j); return c3.construction.slice(0, i).some((c) => c.type === "clear" && c.label.includes("site")); }), "each site's clearing queued before its build (it is ready when the build comes up)");
  const ahead = clears.filter((c) => c.gov === "ahead");
  check(ahead.length === 1 && ahead[0].pieces.length > 0, `the next build's site (one more hut) cleared ahead too: ${ahead.length ? `${ahead[0].label}, ${ahead[0].pieces.length} pieces` : "none"}`);
  const n0 = c3.construction.length;
  WW.clearAhead(st3, c3, "gen_hut");
  check(c3.construction.length === n0, "asked again, nothing more (no mass clearing)");
  // Open ground: nothing cleared.
  const st4 = world(SEED + 9);
  const c4 = makeCamp(st4, freeTile(st4, (t) => t.terrain === "forest"));
  BM.landFor(st4, c4);
  c4.construction.push({ id: 82000, type: "tent", progress: 0, hours: 3 });
  WW.clearAhead(st4, c4, "craftbench");
  check(!c4.construction.some((c) => c.type === "clear"), "builds on open ground: nothing cleared");
}

// ---------- 5. A hub opening, 60 days ----------
section(`5. A hub opening with the governor, 60 days (seeds ${OPEN.join(", ")}): no wood starvation, nobody cold`);
for (const s of OPEN.filter((x) => x > 0)) {
  const st = world(s, { factionCount: 8 });
  setAutopilot(st, true);
  const h = hub(st);
  let min = Infinity, out = 0;
  const line = [];
  while (day(st) <= 60 && !st.gameOver) {
    tickHour(st);
    if (st.hour % 24 === 0) { const w = h.stock.wood || 0; min = Math.min(min, w); if (w < 1) out++; if (day(st) % 10 === 0) line.push(`d${day(st)} ${Math.round(w)}`); }
  }
  const es = econStats(st);
  const ap = autopilotStats(st);
  console.log(`    seed ${s}: wood ${line.join(", ")}; least ${Math.round(min)}; ${ap.chops || 0} trees felled for wood, ${ap.clearAhead || 0} sites cleared ahead, ${ap.builds} builds; ${h.buildings.length} buildings, ${atBase(st, h.id).length} people`);
  check(!st.gameOver && out === 0, `seed ${s}: the woodpile never ran out (least ${Math.round(min)} at midnight)`);
  check(!(es.coldDays > 0), `seed ${s}: nobody cold (${es.coldDays || 0} base-days)`);
  check(!st.log.some((l) => /fire went out/.test(l.text) && /Hub|Base/i.test(l.text)), `seed ${s}: no fire out for want of wood`);
  check(ap.builds >= 8, `seed ${s}: the opening built (${ap.builds} builds)`);
}

// ---------- 6. The hardcore start ----------
section("6. The hardcore start still founds its camp with the governor");
{
  const st = createWorld({ seed: 9000, factionCount: 7, mode: "hardcore" });
  st.started = true;
  setAutopilot(st, true, "balanced");
  let pitched = null;
  while (day(st) <= 30 && !st.gameOver) { tickHour(st); if (pitched == null && st.bases.length) pitched = day(st); }
  check(pitched != null && alive(st).length > 0, `a camp set up on day ${pitched}; ${alive(st).length} alive at day 30`);
  const c = st.bases[0];
  console.log(`    ${c ? `${c.name}: ${Math.round(c.stock.wood || 0)} wood, ${c.buildings.map((b) => b.type).join(", ")}` : "no camp"}`);
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fail ? 1 : 0);
