// Outpost camps (2026-10-09, user request: "When starting a base it should start as a camp with a progress bar with
// needed items to upgrade to a more permanent base established"). sim/buildings.js outpost_up, sim/parties.js Build
// outpost, sim/groupworks.js CAMP.
//   - Build outpost pitches a camp: tier 0 (a shelter's rules), 5 scrap carried (2 on ruins), its step up queued at once,
//     the team its staff on Build; what else they carry goes into the stores and straight into the step up;
//   - the step up gathers its materials from the stores as they come in, never works ahead of them, waits (and lets the
//     next job go on) while they are short, and when done the camp is an outpost (no tier: spring, wall 1, 6 + 6 plots);
//   - cancelling gives back what was taken; hub_up is not offered at a camp, outpost_up not at a shelter or the hub;
//   - the base panel and the map show the bar and the needed items; a save keeps the job's materials;
//   - the governor packs the camp's materials, holds the hub's back for a camp waiting for them and sends them (with its water);
//   - AI parity: a group's new base from nothing is a camp (half defence, establishing it is the first job there).
// Usage: node tools/outpostcamptest.js [seed]
import { createWorld, tickHour, hub, atBase, day } from "../src/sim/world.js";
import { BUILDINGS, isShelter, tierName, canBuild, queueBuild, cancelBuild, plotCap, baseWalls, gatherRows, gatherCap, gatherStalled, tierUpJob, constructionHour, GATHER_AHEAD } from "../src/sim/buildings.js";
import { launchExpedition, giveOrder, planPath, outpostScrap, outpostKit, orderOptions, PITCH_HOURS } from "../src/sim/parties.js";
import { GROUP_WORKS, nextWork, groupWorksDaily, groupBaseDefence, isCamp, pitchCamp, worksText } from "../src/sim/groupworks.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { STAGING } from "../src/sim/staging.js";
import { CRAFTS } from "../src/sim/crafting.js";
import { assignedRole } from "../src/sim/noidle.js"; // noidle: a job with no work, its people helping elsewhere
const plain = (h) => String(h).replace(/<[^>]+>/g, ""); // the text without markup (cost chips split name and count into spans)

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.noNewGangs = true; st.erasOff = true; st.noWanderers = true; return st; };
const free = (st, t) => st.tiles[t].terrain !== "water" && st.tiles[t].terrain !== "mountain" && st.tiles[t].owner == null && !st.factions.some((f) => f.bases.includes(t)) && !st.bases.some((b) => b.tile === t) && !st.hordes.some((h) => h.tile === t);
const nearFree = (st, from, lo, hi) => st.grid.within(from, hi).find((t) => st.grid.distance(t, from) >= lo && free(st, t) && planPath(st, from, t, false));
// A team of n from the hub, standing on tile, ordered to Build outpost there carrying supplies.
function pitch(st, n, supplies) {
  const h = hub(st);
  const tile = nearFree(st, h.tile, 3, 6);
  Object.assign(h.stock, { scrap: 80, parts: 6, buildmat: 20, food: 200, water: 200, wood: 2000 });
  const crew = atBase(st, h.id).slice(0, n).map((s) => s.id);
  const res = launchExpedition(st, { memberIds: crew, dest: tile, mission: "outpost", stance: "normal", supplies: { food: 6, water: 6, ...supplies } });
  if (!check(!res.error, `the team leaves (${res.error || "ok"})`)) return null;
  res.party.path = [tile]; res.party.idx = 0;
  giveOrder(st, res.party, "outpost");
  // Setting up the camp takes PITCH_HOURS (1, buildings.js CAMP.setupHours) of work: no camp until it is done.
  const early = st.bases.find((b) => b.tile === tile);
  check(!early && res.party.task && res.party.task.type === "pitch", "the team pitches the camp first (a task), no camp yet");
  for (let i = 0; i < PITCH_HOURS + 2 && !st.bases.some((b) => b.tile === tile); i++) tickHour(st);
  check(st.bases.some((b) => b.tile === tile), `the camp stands after ${PITCH_HOURS} hours of work`);
  return { tile, crew, base: st.bases.find((b) => b.tile === tile) };
}
const hours = (st, n, stop = () => false) => { for (let i = 0; i < n && !stop(); i++) tickHour(st); };

section("Build outpost pitches a camp");
{
  const st = world();
  // The user's numbers (2026-10-09); since camps are the barest base tier (staging.js), setting one up takes an hour and
  // nothing carried: the materials come with the step up.
  check(outpostScrap(st, 0) === 0, "setting up the camp takes no scrap");
  check(outpostKit(st, 0).scrap === (st.tiles[0].ruin ? 10 : 20) && !outpostKit(st, 0).parts && outpostKit(st, 0).buildmat === 2 && outpostKit(st, 0).wood === 200, `the kit to set up and establish in one trip: 20 scrap, 2 building materials, 200 wood (${JSON.stringify(outpostKit(st, 0))})`);
  check(PITCH_HOURS === 1, "setting up takes an hour of work");
  check(JSON.stringify(BUILDINGS.outpost_up.cost) === JSON.stringify({ scrap: 20, buildmat: 2, wood: 200 }) && BUILDINGS.outpost_up.hours === 20, "establishing: 20 scrap, 2 building materials, 200 wood (the user's pick 2026-10-20), 20 work-hours");
  check(JSON.stringify(BUILDINGS.hub_up.cost) === JSON.stringify({ scrap: 100, buildmat: 5, wood: 800 }) && BUILDINGS.hub_up.hours === 60 && BUILDINGS.hub_up.gather, "shelter to base: 100 scrap, 5 building materials, 800 wood, 60 work-hours, gathered as they come in");
  check(JSON.stringify(STAGING.HARDCORE.needs) === JSON.stringify({ scrap: 20, buildmat: 2, wood: 200 }) && STAGING.HARDCORE.work === 20 && STAGING.PITCH.scrap === 0 && STAGING.PITCH.hours === 1 && BUILDINGS.camp_up.hours === 20, "a camp: an hour and nothing carried to set up; to a shelter (camp_up) 20 scrap, 2 building materials, 200 wood, 20 work-hours");
  check(CRAFTS.buildmat && CRAFTS.buildmat.in.scrap === 3 && CRAFTS.buildmat.supplies.buildmat === 1 && CRAFTS.buildmat.field, "building materials are crafted from scrap (3 for 1, anywhere)");
  const at = { path: [nearFree(st, hub(st).tile, 3, 6)], idx: 0, supplies: { scrap: 11 }, cargo: { supplies: {}, gear: [] } };
  const opt = orderOptions(st, at).find((x) => x.mission === "outpost");
  check(opt && !opt.disabled, `Build outpost is open with no scrap carried (${opt && JSON.stringify(opt).slice(0, 120)})`);
  const P = pitch(st, 2, { scrap: 16 });
  const b = P && P.base;
  if (check(!!b, "a base stands there")) {
    check(b.type === "outpost" && isShelter(b) && b.tier === 0 && b.camp === true, `it is a camp: tier 0 outpost, a camp (${b.type}, tier ${b.tier}, camp ${b.camp})`);
    check(tierName(b) === "Outpost camp", `called an outpost camp (${tierName(b)})`);
    check(baseWalls(b) === 0 && plotCap(b, "building") === 0 && plotCap(b, "utility") === 2, "a camp's rules: no walls, no building plots, 2 utility plots");
    const job = tierUpJob(b);
    b.stock.wood = (b.stock.wood || 0) + 600; // its 200 wood (the user's pick 2026-10-20), the fire's days kept back, its burn meanwhile: here, so only the building materials hold it up below
    check(job && job.type === "outpost_up" && job.paid, "its step up is queued at once, gathering its materials");
    check(atBase(st, b.id).length === 2 && atBase(st, b.id).every((s) => assignedRole(s) === "build"), `the team is its staff, on Build (${atBase(st, b.id).map((s) => s.role).join(", ")} this hour: noidle.js, no materials yet)`); // their own job; with nothing to build they help elsewhere for the hour
    check(st.log.some((l) => /set up camp/.test(l.text)), "the log says so");
    // Carried 16: all into the stores (setting up takes none); the job takes what its next GATHER_AHEAD hours need (12).
    tickHour(st);
    const sc = gatherRows(job).find((r) => r.key === "scrap");
    check(sc.have === 12 && (b.stock.scrap || 0) === 4, `the step up took the 12 scrap its next hours need, 4 left in the stores (${sc.have}, stores ${b.stock.scrap})`);
    check(Math.abs(gatherCap(job) - 0) < 1e-9, "no building materials yet: the work is capped at nothing (the least delivered)");
    hours(st, 30);
    check(job.progress <= 1e-9 && gatherStalled(job), `no work ahead of the materials (${job.progress})`);
    check(!canBuild(st, b, "hub_up").ok, "hub_up is not offered at a camp");
    // A rain catcher queued behind: it goes on while the step up waits.
    b.stock.scrap = 40;
    const before = b.stock.scrap;
    const q = queueBuild(st, b, "rain_catcher");
    check(/queued/.test(q), `a rain catcher queued (${q})`);
    // The step up takes what its next GATHER_AHEAD work-hours need (just in time), the rest stays in the stores.
    tickHour(st);
    const sc2 = gatherRows(job).find((r) => r.key === "scrap");
    check(sc2.have >= Math.ceil(20 * Math.min(1, GATHER_AHEAD / 20)) && !sc2.ok, `the step up took the scrap its next ${GATHER_AHEAD} work-hours need (${sc2.have} of 20), no more`);
    check(b.stock.scrap < before && b.stock.scrap > 0, `out of the stores, the rest left there (${b.stock.scrap})`);
    hours(st, 48, () => !b.construction.some((c) => c.type === "rain_catcher"));
    check(!b.construction.some((c) => c.type === "rain_catcher"), "the rain catcher got built while the step up waited for its building materials");
    // The building materials come in: the work goes on to the end.
    b.stock.buildmat = 3;
    hours(st, 24 * 8, () => !isShelter(b));
    check(!isShelter(b) && b.tier === undefined && b.type === "outpost", "established: an outpost (no tier)");
    check(tierName(b) === "Outpost" && baseWalls(b) === 0 && plotCap(b, "building") === 6, "an outpost's plots, and no wall it did not build (the Defenses tab)");
    // The camp's builders make building materials from the scrap in its stores while the step up waits for them
    // (buildings.js campMaterialsHour), so of the three brought in it took what they had not made already.
    const made = st.log.filter((l) => /made building materials from scrap/.test(l.text)).length;
    check((b.stock.buildmat || 0) === 1 + Math.min(2, made), `it took the building materials it still needed (${b.stock.buildmat} left, ${made} made from scrap)`);
    check(st.log.some((l) => /established outpost/.test(l.text)), "the log says it is established");
  }
}

section("Brought in one trip; cancel; save");
{
  const st = world(seed + 1);
  const P = pitch(st, 3, { scrap: 24, buildmat: 2, wood: 300 }); // its 200 wood and the fire's (the user's pick 2026-10-20)
  const b = P && P.base;
  if (check(!!b, "the camp stands")) {
    const job = tierUpJob(b);
    tickHour(st);
    check(!gatherStalled(job) && gatherCap(job) > 0 && (b.stock.scrap || 0) + gatherRows(job)[0].have >= 20, "everything in at once: nothing to wait for (the rest in the stores until the work needs it)");
    const back = deserializeState(serializeState(st));
    const b2 = back.bases.find((x) => x.id === b.id);
    check(b2 && isShelter(b2) && tierUpJob(b2) && JSON.stringify(tierUpJob(b2).paid) === JSON.stringify(job.paid), "a save keeps the camp and what its job has taken");
    // Cancel: what it took comes back (all of it, nothing done yet).
    const job2 = tierUpJob(b2);
    job2.progress = 0;
    const s0 = b2.stock.scrap || 0, m0 = b2.stock.buildmat || 0, paid = { ...job2.paid };
    cancelBuild(back, b2, job2.id);
    check((b2.stock.scrap || 0) === s0 + (paid.scrap || 0) && (b2.stock.buildmat || 0) === m0 + (paid.buildmat || 0), `cancelled: what it took back (${JSON.stringify(paid)})`);
    check(canBuild(back, b2, "outpost_up").ok, "and it can be queued again (Establish the outpost)");
    check(!canBuild(back, hub(back), "outpost_up").ok, "never at the hub");
    // Three builders: done in about two days of work hours.
    const d0 = day(st);
    hours(st, 24 * 6, () => !isShelter(b));
    check(!isShelter(b), `established in ${day(st) - d0} days with 3 builders`);
  }
}

section("The panels and the map");
{
  const st = world(seed + 2);
  const P = pitch(st, 2, { scrap: 4 });
  const b = P && P.base;
  if (b) {
    tickHour(st);
    st.nameAsk = []; // the naming popup for the new base (basenames.js) would cover the base screen
    const UI = await import("../src/ui/ui.js");
    const html = UI.renderModal(st, { started: true, baseView: { id: b.id, tab: "overview" } }) || "";
    check(/Outpost camp → <b>Outpost<\/b>/.test(html), "the overview shows the stage");
    check(/Scrap 4\/20/.test(plain(html)) && /Building materials 0\/2/.test(plain(html)), "and each material against its need");
    check(/% built/.test(html), "and the bar");
    const con = UI.renderModal(st, { started: true, baseView: { id: b.id, tab: "construction" } }) || "";
    check(/Establish the outpost/.test(con) && /scrap 4\/20/i.test(plain(con)) && /building materials 0\/2/i.test(plain(con)), "the construction queue shows its materials");
    const left = UI.renderLeft ? UI.renderLeft(st, { started: true, tab: "bases" }) : "";
    check(!left || /Outpost camp/.test(left), "the bases list calls it an outpost camp");
  }
}

section("The governor");
{
  const src = (await import("node:fs")).readFileSync(new URL("../src/sim/autopilot.js", import.meta.url), "utf8");
  check(/supplies: \{ scrap: 32, buildmat: 2 \}/.test(src), "the governor packs the camp's materials when it founds one");
  check(/queueCraft\(state, base, "buildmat"\)/.test(src), "and crafts building materials from scrap while a camp waits for them");
  check(/buildmat: matShort\(state, h, "buildmat"\)/.test(src), "and scavenges for building materials while a camp waits for them");
  check(/campShort\(o, h\)/.test(src), "and sends a supply run to a camp waiting for its materials");
  // Live: a camp pitched with only the 12 scrap, the governor on, no building materials anywhere: its hub holds the scrap
  // back (campHold), crafts the building materials and sends them along with the camp's water.
  const { setAutopilot } = await import("../src/sim/autopilot.js");
  const st = world(seed);
  const P = pitch(st, 2, { scrap: 12 });
  const b = P && P.base;
  if (b) {
    Object.assign(hub(st).stock, { scrap: 120, parts: 8, buildmat: 0, food: 400, water: 300 });
    setAutopilot(st, true);
    const d0 = day(st);
    hours(st, 24 * 12, () => !isShelter(b));
    check(!isShelter(b), `the governor's hub supplied the camp: established in ${day(st) - d0} days`);
  }
}

section("AI parity: a group's new base is a camp");
{
  const st = world(seed + 3);
  st.groupWorks = true;
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const tile = nearFree(st, f.bases[0], 2, 6);
  f.bases.push(tile);
  pitchCamp(st, f, tile);
  check(isCamp(f, tile), "pitched as a camp");
  const d0 = groupBaseDefence(st, f, f.bases[0]);
  check(groupBaseDefence(st, f, tile) < GROUP_WORKS.WALL_DEF * 0.5 + 1e-9 && groupBaseDefence(st, f, tile) <= d0, `half the defence while a camp (${groupBaseDefence(st, f, tile)})`);
  // Their main base's needs come first (nextWork goes base by base); at the camp, establishing it before anything else.
  f.stock.scrap = 500; f.stock.parts = 50; f.stock.food = 9999; f.job = null;
  let firstThere = null;
  for (let i = 0; i < 400 && isCamp(f, tile); i++) {
    groupWorksDaily(st, f);
    if (!firstThere && f.job && f.job.tile === tile) firstThere = f.job.type;
    if (!firstThere && !isCamp(f, tile)) firstThere = "camp"; // started and finished the same day (a big group)
  }
  check(firstThere === "camp", `the first job at the camp is establishing it (${firstThere})`);
  check(!isCamp(f, tile), "established after its work");
  const w = (f.works && f.works[tile]) || {};
  check(!["water", "farms", "beds", "walls", "pens"].some((k) => w[k]), `nothing else built there before (${JSON.stringify(w)})`);
  pitchCamp(st, f, tile);
  check(/outpost camp/.test(worksText(st, f)), "the Groups tab says so");
  const fsrc = (await import("node:fs")).readFileSync(new URL("../src/sim/factions.js", import.meta.url), "utf8");
  check(/if \(fromNothing\) pitchCamp\(state, f, t\.id\)/.test(fsrc), "factions.js expansion pitches a camp for a base from nothing");
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
