// Camps as the barest base tier (2026-10-09, user requests: a base menu when you set up camp; "Make camps a pseudo temp
// base that can be upgraded to bases with time and supplies but is the most barebones"; "anyone at any time makes a
// camp ... if you don't want it, strike the camp and leave"). sim/staging.js (Set up camp, Strike camp, neglect, the
// hub among camps, the old staging camp's migration), sim/buildings.js (CAMP, isCamp, camp_up), ui/ui.js (the Camp
// tab of the base window).
//   - Set up camp: any team, anywhere it may stand, an hour, no materials; the team moves in (residents, vehicles
//     parked, cargo into the stores and armory) and the base window opens (state.campOpen) on its Camp tab;
//   - the camp is a base: supplies and items set down (drop off) and taken back (load) by a team at the camp, by weight;
//     people moved between teams (form a team, add / send back people, split, Enter to merge back), vehicles taken
//     and left, cargo loaded and unloaded through a vehicle (the team inventory, sim/teaminv.js), nobody moved in a
//     fight, a team on the move is not at the camp;
//   - Construction: the step up (camp_up / outpost_up) with its materials and work, the rest greyed with when it opens;
//     the barricade and a utility plot are actionable at a camp;
//   - save / load with camp items; the step up into the shelter keeps the people, stock, armory and vehicles;
//   - Strike camp: everyone a team with what they can carry, the rest a cache, the camp gone (and with nobody there);
//   - a camp beside a hub is an outpost camp; a real base retaken takes the hub's place; a camp holds only its tile.
// Usage: node tools/campmenutest.js [seed]
import { stockTools } from "./toolset.js"; // every tool a build or recipe can need (toolreqs.js)
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, atBase, day } from "../src/sim/world.js";
import { BUILDINGS, CAMP, SHELTER, isCamp, isShelter, tierName, tierUpJob, canBuild, queueBuild, plotCap, baseBeds, farmSlots, gatherRows } from "../src/sim/buildings.js";
import { partyMembers, partyTile, giveOrder, orderOptions, launchExpedition, planPath, carried } from "../src/sim/parties.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { strikeCamp, strikeProblem, campOption, settleHub, STAGING, pendingSite, pickSite, siteSetup } from "../src/sim/staging.js";
import { gridSize, landFor } from "../src/sim/basemap.js";
import { formTeam, addMember, removeMember, setVehicles, editProblem } from "../src/sim/teamform.js";
import { dropOff, loadFromBase, transferProblem } from "../src/sim/teaminv.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { GEAR } from "../src/sim/data.js";
import { renderModal, renderRight } from "../src/ui/ui.js";
import { TENTS, tentBeds } from "../src/sim/tents.js"; // the hardcore start's tent bags: a quicker camp, beds under cover
const plain = (h) => String(h).replace(/<[^>]+>/g, ""); // the text without markup (cost chips split name and count into spans)

const SEED = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (t) => console.log(t);
const t0 = Date.now();
const ui = (extra = {}) => ({ started: true, speed: 0, tab: "bases", selected: -1, survivor: null, baseView: null, expedition: null, diary: null, roster: null, help: false, ...extra });
const modal = (st, baseView) => { st.cards.length = 0; st.nameAsk = []; delete st.unpack; return renderModal(st, ui({ baseView })) || ""; };
const run = (st, h, stop = () => false) => { for (let i = 0; i < h && !stop(); i++) { st.hordes.length = 0; tickHour(st); st.cards.length = 0; if (st.engagement) st.engagement = null; } };
const item = (key) => ({ key, name: GEAR[key].name, quality: 1 });

// ---------- Set up camp: anyone, anywhere; the window opens ----------
section("Set up camp: a team anywhere sets up a camp (a base) on the spot it picks (its fire and a 5 × 5 cleared); the base window opens");
const st = createWorld({ seed: SEED, factionCount: 7, mode: "hardcore" });
st.noWanderers = true;
const p = roadTeam(st);
const tile = partyTile(p);
const people = partyMembers(st, p).map((s) => s.id);
const partyCount = people.length; // one one-person tent each (tents.js TENTS.HARDCORE), pitched at the camp
const car = st.vehicles.find((v) => v.loc.kind === "party" && v.loc.partyId === p.id);
p.cargo.gear.push(item("crowbar"));
Object.assign(p.cargo.supplies, { scrap: 9, water: 30 }); setFood(p.cargo, 30);
const opt = campOption(st, p);
check(opt && opt.label === "Set up camp" && !opt.disabled && orderOptions(st, p).some((o) => o.mission === "camp"), "Set up camp is on the team's orders (and the right-click menu, the team panel)");
st.cards.length = 0;
giveOrder(st, p, "camp");
check(p.phase === "task" && p.task.type === "pitch" && p.task.hours === siteSetup(st, p, tile).hours && p.task.hours >= 0.25, `the work first, nothing carried needed: the camp fire and the clearing of its 5 × 5, tent bags or none (${p.task && p.task.hours}h)`);
check(Array.isArray(st.siteAsk) && st.siteAsk.includes(p.id) && pendingSite(st) === p, "the team asks where on the tile's map the camp goes (state.siteAsk: the window, ui/campsite.js)");
const spot = [12, -20];
check(pickSite(st, p, [999, 0]) !== "" && pickSite(st, p, spot) === "" && !pendingSite(st) && p.campAt.join() === spot.join(), `a spot too near the edge is refused; one in reach is taken (${spot})`);
const siteGet = siteSetup(st, p, tile, spot).get; // with or without a cutting tool on the team (a quarter of the trees' wood without)
const stockBefore = { wood: p.cargo.supplies.wood || 0, scrap: p.cargo.supplies.scrap || 0 };
check(p.task.hours === siteSetup(st, p, tile, spot).hours, `its hours set for the spot picked (${p.task.hours}h)`);
run(st, Math.ceil(p.task.hours) + 2, () => st.bases.length > 0);
const camp = st.bases[0];
check(!!camp && isCamp(camp) && camp.tile === tile && tierName(camp) === "Camp" && camp.type === "hub", `the camp stands: a base, your hub while it is your only one (${camp && tierName(camp)})`);
check(st.campOpen === camp.id || st.log.some((l) => /set up camp/.test(l.text)), "the base window is asked to open (state.campOpen; main.js opens it on the Camp tab)");
check(!st.parties.includes(p) && people.every((id) => atBase(st, camp.id).some((s) => s.id === id)), "the team moved in: its people are the camp's");
check(car && car.loc.kind === "base" && car.loc.baseId === camp.id, "its vehicle is parked at the camp");
check(camp.armory.some((it) => it.key === "crowbar") && camp.stock.scrap >= 9 && food(camp) >= 20, "what it carried is in the camp's stores and armory (less the meals of the setup)");
check(!tierUpJob(camp), "a plain camp: nothing building until you queue the step up");
check(camp.plan && camp.plan.fresh && camp.plan.origin.join() === spot.join() && gridSize(camp) === 250, `the camp stands where it was put on its 250 × 250 map (${camp.plan && camp.plan.origin})`);
const cl = camp.land && camp.land.cleared;
check(!!cl && [[-2, -2], [2, 2], [0, 0], [-2, 2]].every(([x, y]) => cl[`${x},${y}`]) && !landFor(st, camp).list.some((q) => q.k !== "water" && q.cells.some(([x, y]) => x >= -2 && y >= -2 && x < 3 && y < 3)), "its 5 × 5 round the fire is cleared: nothing of the land left in it");
check(Object.entries(siteGet).every(([k, v]) => (camp.stock[k] || 0) >= v + (stockBefore[k] || 0) - (k === "wood" ? 5 : 1e-9)), `what the land there gave is in its stores (${Object.entries(siteGet).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing"})`);
check(baseBeds(camp) === CAMP.beds + tentBeds(camp) && tentBeds(camp) === partyCount && farmSlots(camp) === 0 && plotCap(camp, "building") === 0 && plotCap(camp, "utility") === 2, "barebones: its tents for beds, no crop plot until one is dug, no building plot, two utility plots");
let html = modal(st, { id: camp.id, tab: "camp" });
check(/class="tabs"/.test(html) && /data-tab="camp"/.test(html) && /data-tab="construction"/.test(html) && !/data-tab="farming"/.test(html) && !/data-tab="defence"/.test(html), "the base window: a Camp tab and only the tabs a camp uses");
check(/Strike camp/.test(html) && /Form a team/.test(html) && /People here/.test(html) && /Stores/.test(html) && /Vehicles \(1\)/.test(html), "the Camp tab: people, form a team, stores, vehicles, Strike camp");
check(/At the shelter/.test(html) && /At the base/.test(html) && /Camp → <b>Shelter<\/b>/.test(html), "and what it can become (the ladder)");
check(/Open camp/.test(renderRight(st, ui({ selected: camp.tile }))), "the tile panel's camp card opens it (Open camp)");

// ---------- the stores: set down and take back ----------
section("Stores: a team at the camp sets down supplies and items and takes them back, by weight");
let f = formTeam(st, { baseId: camp.id, memberIds: people.slice(0, 2), supplies: { food: 6, water: 6 } });
check(!f.error && f.party && partyTile(f.party) === camp.tile && f.party.phase === "waiting", `a team formed at the camp waits on its tile (${f.error || "ok"})`);
const q = f.party;
check(atBase(st, camp.id).length === people.length - 2, "the others stay at the camp");
const foodBefore = food(camp), packed = carried(q, "food"); // whole items: a little over 6 days
const give = Math.min(4, Math.floor(packed)); // what the packs took depends on the hour (the day's meals)
let r = dropOff(st, q, { supplies: { food: give } });
check(r.moved.length && Math.abs(food(camp) - foodBefore - give) < 1e-6 && Math.abs(carried(q, "food") - (packed - give)) < 1e-6, `supplies set down in the stores (${r.text})`);
r = loadFromBase(st, q, { supplies: { food: 10 } });
check(r.moved.length && carried(q, "food") >= packed - give + 9, `and taken back (${r.text})`);
const bar = camp.armory.find((it) => it.key === "crowbar");
r = loadFromBase(st, q, { items: [bar] }, "cargo");
check(!camp.armory.includes(bar) && q.cargo.gear.includes(bar), "an item taken from the camp's armory into the team's cargo");
r = dropOff(st, q, { items: [bar] });
check(camp.armory.includes(bar) && !q.cargo.gear.includes(bar), "and set down again");
camp.stock.scrap += 2000;
r = loadFromBase(st, q, { supplies: { scrap: 2000 } });
check(carried(q, "scrap") < 2000 && camp.stock.scrap > 0, `never more than the team can carry (${Math.floor(carried(q, "scrap"))} of 2000 scrap)`);
dropOff(st, q, { supplies: { scrap: Infinity } });
camp.stock.scrap -= 2000;

// ---------- teams: move people, split, merge ----------
section("Teams: move people between teams, split off a new one, merge back, vehicles taken and left");
const third = atBase(st, camp.id)[0];
check(/joins/.test(addMember(st, q, third.id)) && partyMembers(st, q).length === 3 && !atBase(st, camp.id).length, "a person from the camp joins the team");
check(/goes back/.test(removeMember(st, q, third.id)) && partyMembers(st, q).length === 2 && atBase(st, camp.id).includes(third), "and goes back into the camp");
const f2 = formTeam(st, { baseId: camp.id, memberIds: [third.id], supplies: {} });
check(!f2.error && f2.party, "a second team split off at the camp");
const q2 = f2.party;
setVehicles(st, q2, [car.id]);
check(car.loc.kind === "party" && car.loc.partyId === q2.id, "it takes the parked car");
const cargoBefore = food(q2.cargo) || 0;
loadFromBase(st, q2, { supplies: { food: 5 } }, "cargo");
check(carried(q2, "food") >= cargoBefore + 5, "cargo loaded into the vehicle's team from the stores");
r = dropOff(st, q2, { supplies: { food: Infinity } });
check(carried(q2, "food") < 1, `and unloaded back into the stores (${r.text})`);
setVehicles(st, q2, []);
check(car.loc.kind === "base" && car.loc.baseId === camp.id, "the car is left parked at the camp again");
giveOrder(st, q2, "enter");
check(!st.parties.includes(q2) && atBase(st, camp.id).includes(third), "Enter: the second team merges back into the camp");
// A team on the move is not at the camp; nobody moved in a fight.
const away = st.grid.within(camp.tile, 3).find((t) => st.grid.distance(t, camp.tile) === 3 && st.tiles[t].terrain !== "water" && planPath(st, camp.tile, t, false));
giveOrder(st, q, "enter");
const lp = launchExpedition(st, { memberIds: atBase(st, camp.id).slice(0, 1).map((s) => s.id), dest: away, mission: "move", stance: "normal", fromBaseId: camp.id, supplies: { food: 3, water: 3 } });
check(!lp.error, `a team leaves the camp like any base (${lp.error || "ok"})`);
check(!!editProblem(st, lp.party), "a team on the move cannot be changed at the camp");
st.combat = { setup: {}, over: false };
check(!!formTeam(st, { baseId: camp.id, memberIds: atBase(st, camp.id).slice(0, 1).map((s) => s.id), supplies: {} }).error && !!strikeProblem(st, camp), "nobody formed or struck while a battle is on");
st.combat = null;
run(st, 48, () => lp.party.phase === "waiting");
check(!!transferProblem(st, lp.party), "a team away from the camp loads and sets down nothing there");

// ---------- construction ----------
section("Construction: the step up's materials and work; the rest greyed with when it opens; a barricade now");
html = modal(st, { id: camp.id, tab: "construction" });
check(/shelter shack/i.test(html) && /20 scrap|Scrap (\d+\/)?20\b/.test(plain(html)) && /2 building materials|2 buildmat|Building materials (\d+\/)?2\b/.test(plain(html)) && /20 work-hours/.test(html), "the next stage: the Shelter shack, 20 scrap, 2 building materials, 20 work-hours");
check(/Available once the shelter stands/.test(html) && /Available once it is a base/.test(html), "the later buildings, greyed with when they open (the shelter, the base)");
check(canBuild(st, camp, "camp_up").ok && !canBuild(st, camp, "hub_up").ok && !canBuild(st, camp, "outpost_up").ok, "the camp's step up is buildable; the shelter's and an outpost's are not");
camp.stock.scrap = (camp.stock.scrap || 0) + 30; camp.stock.wood = (camp.stock.wood || 0) + 600; // wood: the wooden builds (2026-10-20)
check(canBuild(st, camp, "barricades").ok && /queued/.test(queueBuild(st, camp, "barricades")), "a barricade can be built at a camp");
// BASE-03 (2026-10-12): the crafting bench, water boiler, cook fire and drying rack are camp buildings too; they share
// the camp's two utility plots with the rain catcher, crates and barrel.
stockTools(camp); // the bench and the boiler need tools (toolreqs.js); the plots are the subject here
check(["rain_catcher", "smoker", "craftbench", "boiler", "cookhouse"].every((k) => canBuild(st, camp, k).ok), "two utility plots: a rain catcher, drying rack, crafting bench, water boiler or cook fire fits");
{
  const scrap0 = camp.stock.scrap;
  queueBuild(st, camp, "smoker"); queueBuild(st, camp, "boiler");
  const full = canBuild(st, camp, "cookhouse");
  check(!full.ok && full.noPlot && !canBuild(st, camp, "rain_catcher").ok, `both plots taken (a drying rack and a boiler): the cook fire waits for a free plot (${full.reason})`);
  camp.construction.pop(); camp.construction.pop(); camp.stock.scrap = scrap0;
}
check(/queued/.test(queueBuild(st, camp, "camp_up")) && tierUpJob(camp) && tierUpJob(camp).type === "camp_up", "the step up queued from Construction");

// ---------- save / load, the step up ----------
section("Save and load with camp items; built up into the shelter, everything kept");
camp.armory.push(item("knife"));
camp.fire = false;
const back = loadFromString(saveToString(st));
const bc = back.bases.find((b) => b.id === camp.id);
check(bc && isCamp(bc) && bc.armory.length === camp.armory.length && bc.armory.some((it) => it.key === "knife") && JSON.stringify(bc.stock) === JSON.stringify(camp.stock) && bc.fire === false, "a save keeps the camp, its stores and armory items, its fire");
check(bc && JSON.stringify(tierUpJob(bc)) === JSON.stringify(tierUpJob(camp)) && atBase(back, bc.id).length === atBase(st, camp.id).length, "and its step up and its people");
const armN = camp.armory.length, ppl = atBase(st, camp.id).length;
for (const s of atBase(st, camp.id)) s.role = "build";
camp.stock.buildmat = (camp.stock.buildmat || 0) + 2;
camp.stock.wood = (camp.stock.wood || 0) + 600; // the step up's 200 wood (the user's pick 2026-10-20), the fire's days kept back
run(st, 24 * 8, () => !isCamp(camp));
check(!isCamp(camp) && isShelter(camp) && tierName(camp) === "Shelter" && st.bases.includes(camp), `the camp is built up into the shelter (day ${day(st)})`);
// (a tent bag pitched out of the armory counts as kept: a shelter has no beds of its own, 2026-10-22, so a rough sleeper's bag goes up)
const pitched = camp.buildings.filter((b) => b.type === "tent" && b.item).length;
check(camp.armory.length + pitched >= armN && atBase(st, camp.id).length >= ppl && car.loc.kind === "base" && car.loc.baseId === camp.id, "the same base: its people, armory and vehicles kept");
check(st.hardcore.start.foundedDay != null, "hardcore: the first home founded with the shelter");

// ---------- strike ----------
section("Strike camp: everyone a team with what they can carry, the rest a cache; an empty camp just goes");
{
  // A tile 3–4 out from the hub; the first one the team reaches (the run clears the cards, so a team met on the way by a
  // card is left waiting there: the next tile, on a fresh world).
  let s2, h, tileC, res, crew;
  for (let k = 0; k < 8; k++) {
    s2 = createWorld({ seed: SEED + 1, factionCount: 7 });
    s2.noWanderers = true;
    h = hub(s2);
    tileC = s2.grid.within(h.tile, 4).filter((t) => s2.grid.distance(t, h.tile) >= 3 && !campProblemAt(s2, t) && planPath(s2, h.tile, t, false))[k];
    if (tileC == null) break;
    crew = atBase(s2, h.id).slice(0, 2).map((s) => s.id);
    res = launchExpedition(s2, { memberIds: crew, dest: tileC, mission: "camp", stance: "normal", supplies: { food: 8, water: 8, scrap: 10 } });
    run(s2, 72, () => s2.bases.some((b) => b.tile === tileC));
    if (s2.bases.some((b) => b.tile === tileC)) break;
  }
  check(res && !res.error, `a team from the hub sets out to set up camp (${(res && res.error) || "ok"})`);
  const c2 = s2.bases.find((b) => b.tile === tileC);
  check(c2 && isCamp(c2) && c2.type === "outpost" && tierName(c2) === "Outpost camp", "beside a hub a camp is an outpost camp");
  check(c2 && s2.tiles[tileC].owner === "player" && s2.grid.neighbors(tileC).every((n) => s2.tiles[n].owner !== "player" || s2.bases.some((b) => s2.grid.distance(b.tile, n) <= 2 && b !== c2)), "a camp holds only its own tile");
  c2.stock.scrap += 600; c2.armory.push(item("crowbar"));
  const rs = strikeCamp(s2, c2);
  check(!rs.error && rs.party && !s2.bases.includes(c2) && partyMembers(s2, rs.party).length === crew.length, `struck: its people a team on the tile (${rs.error || rs.text})`);
  check(rs.party && carried(rs.party, "food") > 0 && carried(rs.party, "scrap") > 0, "packing water and food first, then what fits");
  check(s2.deathSites.some((d) => d.tile === tileC && d.items.some((i) => i.key === "scrap")), "what could not be carried is a cache on the tile");
  check(!s2.bases.some((b) => b.tile === tileC), "the camp is gone: no base left behind");
  // An empty camp struck: everything a cache.
  giveOrder(s2, rs.party, "camp"); rs.party.pitched = true; giveOrder(s2, rs.party, "camp");
  const c3 = s2.bases.find((b) => b.tile === tileC);
  const left = launchExpedition(s2, { memberIds: atBase(s2, c3.id).map((s) => s.id), dest: h.tile, mission: "move", stance: "normal", fromBaseId: c3.id, supplies: { food: 4, water: 4 } });
  check(!left.error && !atBase(s2, c3.id).length, "everyone leaves the camp");
  addDays(c3, 5);
  const re = strikeCamp(s2, c3);
  check(!re.error && !re.party && !s2.bases.includes(c3), "an empty camp struck: gone, its stores a cache");
}

// ---------- the hub among camps ----------
section("The hub among camps: a real base takes the hub's place; the camp becomes an outpost camp");
{
  const s3 = createWorld({ seed: SEED + 2, factionCount: 7, mode: "hardcore" });
  const p3 = roadTeam(s3);
  giveOrder(s3, p3, "establish"); p3.pitched = true; giveOrder(s3, p3, "establish");
  const c = s3.bases[0];
  check(isCamp(c) && c.type === "hub" && tierUpJob(c).type === "camp_up", "the only base: the camp is the hub, building up into a shelter");
  const t2 = s3.grid.within(c.tile, 5).find((t) => s3.grid.distance(t, c.tile) >= 4 && s3.tiles[t].terrain !== "water");
  const real = { id: 990001, tile: t2, type: "outpost", name: "Retaken", stock: { food: 0, water: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  s3.bases.push(real);
  settleHub(s3);
  check(hub(s3) === real && c.type === "outpost" && tierUpJob(c).type === "outpost_up", "a real base takes the hub's place; the camp is an outpost camp establishing itself");
  s3.bases.splice(s3.bases.indexOf(real), 1);
  settleHub(s3);
  check(hub(s3) === c && tierUpJob(c).type === "camp_up", "with the real base gone the camp is the hub again");
}

function campProblemAt(state, t) {
  const tt = state.tiles[t];
  return !tt || tt.terrain === "water" || tt.terrain === "mountain" || tt.hive || tt.owner != null || state.bases.some((b) => b.tile === t) || state.factions.some((f) => f.bases.includes(t));
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
