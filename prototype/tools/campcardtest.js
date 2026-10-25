// Camps in the panels and on the map (ui/hardcore.js campStatusCard, stagingTileCard, buildBar, stageSteps, stageRows;
// ui/render.js). Since 2026-10-09 a camp is the barest base (sim/staging.js): before one stands, the team panel says
// there is no base yet and lists what the step up into a shelter takes against what the team carries; once it stands,
// the tile panel puts the camp's card first (its stage, the step up's bar, who is there, Open camp and Strike camp); a
// shelter building up into a base shows a bar of the work.
// node tools/campcardtest.js
import { stockTools } from "./toolset.js"; // every tool a build or recipe can need (toolreqs.js)
import { createWorld, tickHour } from "../src/sim/world.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { establishArrive, tierInfo } from "../src/sim/staging.js";
import { BUILDINGS, CAMP, queueBuild, tierUpJob, tierUpType } from "../src/sim/buildings.js";
import { campStatusCard, buildBar, stageSteps, stageRows, stagingTileCard } from "../src/ui/hardcore.js";
import { renderExpedition } from "../src/ui/expedition.js";
import { renderRight } from "../src/ui/ui.js";

// Setting up a camp takes an hour (staging.js STAGING.PITCH): skipped here, the camp stands at once.
const establishArriveNow = (st, p) => { p.pitched = true; return establishArrive(st, p); };

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
check(/Scrap/.test(card) && /Building materials/.test(card) && /Team has/.test(card), "no camp: the supplies and what the team has (the step up's scrap, building materials and wood)");
check(/1\. Camp/.test(card) && /2\. Shelter/.test(card) && /shelter shack/i.test(card), "two steps: the camp, then its Shelter shack placed from the Build list (the user's request 2026-10-25)");
check(/Wood/.test(text(card)) && /Stone/.test(text(card)) && text(card).includes(`${CAMP.fireCost.wood}`) && text(card).includes(`${CAMP.fireCost.stone}`), "the camp fire's wood and stone listed against what the team has");
check(!/nothing carried/.test(card), "no 'nothing carried': the camp fire takes wood and stone");
for (const k of ["wood", "stone"]) { p.supplies[k] = 0; if (p.cargo && p.cargo.supplies) p.cargo.supplies[k] = 0; }
check(/First the camp fire/.test(campStatusCard(st, p)) && /Cut wood and Gather stone/.test(campStatusCard(st, p)), "short of the fire's wood and stone: says so first, and how to get them");
Object.assign(p.supplies, { ...CAMP.fireCost });
card = campStatusCard(st, p);
check(/set up camp right here/.test(card) && /builds the camp fire from what it carries and clears a 5 × 5 round it/.test(card) && (card.match(/✓ /g) || []).length >= 2, "carrying them: set up camp right here, the fire's rows ticked");
check(renderExpedition(st, { xpQueue: false, expedition: p.id }, p).includes("campcard"), "the team panel carries the card");
check(/data-mission="camp"/.test(renderExpedition(st, { xpQueue: false, expedition: p.id }, p)), "the team panel offers Set up camp");
const was = { mission: p.mission, phase: p.phase, path: p.path };
Object.assign(p, { mission: "establish", phase: "out", path: [p.tile ?? 0, (p.tile ?? 0) + 1] });
check(/On the way to set up camp/.test(campStatusCard(st, p)), "heading out to establish: 'On the way to set up camp'");
Object.assign(p, was);

console.log("The camp set up: a base; the tile panel's card");
p.supplies.scrap = 9; p.supplies.parts = 2;
if (p.cargo && p.cargo.supplies) { p.cargo.supplies.scrap = 0; p.cargo.supplies.parts = 0; } // the car's load too: only what is set here
establishArriveNow(st, p);
const camp = st.bases[0];
check(!!camp && camp.camp === true, "the camp stands (a base)");
check(campStatusCard(st, p) === "", "no road card once there is a base");
check(!tierUpJob(camp), "nothing building yet: the step up is placed by hand (the user's request 2026-10-23)");
queueBuild(st, camp, tierUpType(camp)); // the player picks the shelter shack from the Build list (ui/basemap.js openToPlace)
card = stagingTileCard(st, camp.tile);
check(/class="buildbar/.test(card) && /Shelter shack: 0%/.test(text(card)), "a labelled build bar for the step up");
check(/class="now">Camp</.test(card), "the Camp stage is lit");
check(/Open camp/.test(card) && /Strike camp/.test(card), "Open camp and Strike camp");
check(/3 there/.test(text(card)), "who is there");
tierUpJob(camp).progress = tierUpJob(camp).hours * 0.4;
check(/Shelter shack: 40%/.test(text(stagingTileCard(st, camp.tile))), "the bar follows the work (40%)");
check(stagingTileCard(st, camp.tile + 1) === "" || st.bases.some((b) => b.tile === camp.tile + 1), "no card on another tile");
const right = renderRight(st, { selected: camp.tile, expedition: null, tab: "bases" });
check(right.indexOf("Open camp") >= 0, "the tile panel carries the camp's card");

console.log("Helpers");
check(/width:50%/.test(buildBar(0.5)) && /50% built/.test(buildBar(0.5)), "buildBar 50%");
check(/class="cap" style="width:80%"/.test(buildBar(0.5, { cap: 0.8 })), "buildBar draws the materials cap");
check(!/class="cap"/.test(buildBar(0.9, { cap: 0.8 })), "no cap past the work");
check(/class="past">✓ Camp/.test(stageSteps(1)) && /class="now">Shelter/.test(stageSteps(1)), "stageSteps: camp ticked, shelter lit");
check(tierInfo(st, camp).stage === 0 && tierInfo(st, camp).next === "Shelter", "tierInfo: a camp is stage 0, next the shelter");

console.log("A shelter building up into a base: a bar in the base panel's rows");
const st2 = createWorld({ seed: 11, factionCount: 7, mode: "hardcore" });
const q = roadTeam(st2);
q.supplies.scrap = 30; q.supplies.parts = 4; q.supplies.food = 30; q.supplies.water = 30; q.supplies.buildmat = 2; q.supplies.wood = 600; // the step up's 200 wood, the fire's (the user's pick 2026-10-20)
establishArriveNow(st2, q);
const base = st2.bases[0];
queueBuild(st2, base, tierUpType(base)); // the player places the shelter shack (the user's request 2026-10-23)
for (let i = 0; i < 24 * 6 && base.camp; i++) { tickHour(st2); st2.cards.length = 0; }
check(!base.camp && base.tier === 0, `the camp's builders build it up into the shelter (${base.camp ? "still a camp" : "a shelter"})`);
if (!base.camp) {
  for (const [k, v] of Object.entries(BUILDINGS.hub_up.cost)) base.stock[k] = (base.stock[k] || 0) + v;
  stockTools(base); // a hammer and a saw (toolreqs.js)
  const r = queueBuild(st2, base, "hub_up");
  const job = base.construction.find((c) => c.type === "hub_up");
  check(!!job, `hub_up queued (${r && r.reason ? r.reason : "ok"})`);
  if (job) {
    job.progress = job.hours * 0.25;
    const rows = stageRows(tierInfo(st2, base));
    check(/buildbar/.test(rows) && /Base 25% built/.test(text(rows)), "the step up shows a bar: Base 25% built");
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
