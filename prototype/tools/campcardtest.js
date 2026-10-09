// The staging camp in the panels and on the map (ui/hardcore.js campStatusCard, buildBar, stageSteps; ui/render.js):
// the team panel says whether there is a camp yet, how far it is built and what it still needs against what the team
// carries; the tile panel puts the camp's card first; a shelter building up into a base shows a bar of the work.
// node tools/campcardtest.js
import { createWorld } from "../src/sim/world.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { establishArrive, stagingPct, tierInfo } from "../src/sim/staging.js";
import { BUILDINGS, queueBuild } from "../src/sim/buildings.js";
import { campStatusCard, buildBar, stageSteps, stageRows } from "../src/ui/hardcore.js";
import { renderExpedition } from "../src/ui/expedition.js";
import { renderRight } from "../src/ui/ui.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

console.log("Before the camp: the team panel says there is no base yet and lists what one takes");
const st = createWorld({ seed: 42, factionCount: 7, mode: "hardcore" });
const p = roadTeam(st);
check(!!p, "a team on the road");
let card = campStatusCard(st, p);
check(/No base yet/.test(card), "no camp: 'No base yet'");
check(/Establish base/.test(card), "no camp: points at the order");
check(/Scrap/.test(card) && /Machine parts/.test(card) && /Team has/.test(card), "no camp: the supplies and what the team has");
check(renderExpedition(st, { xpQueue: false, expedition: p.id }, p).includes("campcard"), "the team panel carries the card");
const was = { mission: p.mission, phase: p.phase, path: p.path };
Object.assign(p, { mission: "establish", phase: "out", path: [p.tile ?? 0, (p.tile ?? 0) + 1] });
check(/On the way to pitch the camp/.test(campStatusCard(st, p)), "heading out to establish: 'On the way to pitch the camp'");
Object.assign(p, was);

console.log("The camp pitched: progress, stages, supplies against the stores");
p.supplies.scrap = 9; p.supplies.parts = 2;
if (p.cargo && p.cargo.supplies) { p.cargo.supplies.scrap = 0; p.cargo.supplies.parts = 0; } // the car's load too: only what is set here
establishArrive(st, p);
check(!!st.staging, "the camp is pitched");
card = campStatusCard(st, p);
check(/Staging camp \(here\)/.test(card), "the card says the camp is here");
check(/class="buildbar/.test(card) && /Camp 0% built/.test(text(card)), "a labelled build bar");
check(/class="now">Camp</.test(card), "the Camp stage is lit");
check(/9 \/ 15/.test(card) && /6 more/.test(card), "scrap 9 of 15, 6 more");
check(/2 \/ 2/.test(card) && /✓ Machine parts/.test(card), "parts in: ticked");
check(/Not a base yet/.test(card), "says plainly it is not a base yet");
st.staging.progress = st.staging.work * 0.4;
check(/Camp 40% built/.test(text(campStatusCard(st, p))), "the bar follows the work (40%)");
check(Math.abs(stagingPct(st.staging) - 0.4) < 1e-9, "stagingPct agrees");

console.log("Away from the camp: where it is and a Locate button");
const away = { ...p, members: p.members, path: [st.staging.tile + 1], pathIndex: 0, tile: st.staging.tile + 1 };
const elsewhere = campStatusCard(st, { ...away, location: undefined });
check(/Staging camp/.test(elsewhere), "a card for a team elsewhere");

console.log("The tile panel: the camp's card comes before the intel card");
const right = renderRight(st, { selected: st.staging.tile, expedition: null, tab: "bases" });
const iCamp = right.indexOf("Staging camp:"), iIntel = right.indexOf(">Intel<");
check(iCamp >= 0 && iIntel >= 0 && iCamp < iIntel, `camp card first (camp ${iCamp}, intel ${iIntel})`);

console.log("Helpers");
check(/width:50%/.test(buildBar(0.5)) && /50% built/.test(buildBar(0.5)), "buildBar 50%");
check(/class="cap" style="width:80%"/.test(buildBar(0.5, { cap: 0.8 })), "buildBar draws the materials cap");
check(!/class="cap"/.test(buildBar(0.9, { cap: 0.8 })), "no cap past the work");
check(/class="past">✓ Camp/.test(stageSteps(1)) && /class="now">Shelter/.test(stageSteps(1)), "stageSteps: camp ticked, shelter lit");

console.log("A shelter building up into a base: a bar in the base panel's rows");
const st2 = createWorld({ seed: 11, factionCount: 7, mode: "hardcore" });
const q = roadTeam(st2);
q.supplies.scrap = 30; q.supplies.parts = 4; q.supplies.food = 30; q.supplies.water = 30;
establishArrive(st2, q);
st2.staging.progress = st2.staging.work;
establishArrive(st2, q); // done and stocked: the shelter stands
const shelter = st2.bases[0];
check(!!shelter && shelter.tier === 0, "the shelter stands");
if (shelter) {
  for (const [k, v] of Object.entries(BUILDINGS.hub_up.cost)) shelter.stock[k] = (shelter.stock[k] || 0) + v;
  const r = queueBuild(st2, shelter, "hub_up");
  const job = shelter.construction.find((c) => c.type === "hub_up");
  check(!!job, `hub_up queued (${r && r.reason ? r.reason : "ok"})`);
  if (job) {
    job.progress = job.hours * 0.25;
    const rows = stageRows(tierInfo(st2, shelter));
    check(/buildbar/.test(rows) && /Base 25% built/.test(text(rows)), "the step up shows a bar: Base 25% built");
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
