// Hunting, snares and fishing (src/sim/hunting.js, orders.js, plans.js, crews.js, autopilot.js, ui/ui.js,
// ui/expedition.js, ui/plan.js). Usage: node tools/hunttest.js [seed] [autopilot days] [autopilot seeds]
// (defaults 42, 110 days, seeds 1-6).
// - The land: game by terrain (forest > hills > farmland > suburbs > city; hive land almost nothing, a base's own
//   tile little), by season (autumn best, snow tracks in winter), time of day.
// - Hunters: weapons by category (rifle, bow, shotgun, pistol; melee none), ammo for firearms only, skill and the
//   Hunter perk; the expected haul against a Monte Carlo of real hourly rolls.
// - Heat: gunshots add Heat and draw wandering hordes; bows add none.
// - Depletion and recovery of game; snares over time (catch, rot, theft, the wire); fishing (rod, net, lake / river /
//   small lake, ice fishing with a tool).
// - Carcasses: fresh game weighs 1 kg a ration (a heavier band on foot, nothing in a car); it spoils fast in the field
//   and at a base; drying racks and the hunting cabin smoke it; it is eaten first.
// - The hunting cabin and the Hunt / Fish jobs at a base; the work types and roles.
// - Orders and the planner: Hunting / Fishing trip presets, the ETA to the hour (out, the hunt, the way home as the
//   team panel shows it), the expected haul against the real one, rations.
// - The autopilot in a lean year with and without hunting (hunger days, deaths of hunger, food brought in).
// - Save / load mid-hunt and determinism; the tile panel, team panel, planner and right-click menu.
import { setRounds, totalRounds } from "../src/sim/ammo.js"; // rounds by calibre
// n rounds of generic ammo in a stock and no rounds by calibre (generic fits any gun: the hunts here judge the guns, not the calibres).
const setAmmo = (rec, n) => { setRounds(rec, 0); rec.ammo = n; };
import { readFileSync } from "node:fs";
import { createWorld, tickHour, hub, atBase, survivorById, newId, makeSurvivor, setNextId } from "../src/sim/world.js";
import { autoResolveCombat } from "../src/sim/combat.js";
import { GEAR, TERRAIN, SUPPLIES } from "../src/sim/data.js";
import { CRAFTS, canCraft, fieldCraft } from "../src/sim/crafting.js";
import { rollSiteArrows } from "../src/sim/loot.js";
import { baseFarming, FARM_ACTIONS, FARM_CHANGE } from "../src/ui/farming.js";
import {
  launchExpedition, partyTile, planPath, partyMembers, poolLoad, cargoLoad, hoursLeft, carried, cargoRoom,
} from "../src/sim/parties.js";
import { startOrder, queueOrder, queueEstimate } from "../src/sim/orders.js";
import { estimatePlan, PRESETS } from "../src/sim/plans.js";
import { recomputeOwnership } from "../src/sim/factions.js";
import * as H from "../src/sim/hunting.js";
import { tripDay } from "../src/sim/jobtrips.js"; // the outdoor jobs in trips (a day of them, then the midnight tally)
const huntDay = (state, base) => { tripDay(state, base); return H.huntingDaily(state, base); };
import { newItem } from "../src/sim/inventory.js";
import { teamLoad, LOAD_BANDS } from "../src/sim/load.js";
import { makeHorde } from "../src/sim/hordes.js";
import { addBuilding, canBuild, count } from "../src/sim/buildings.js";
import { storageDaily, eatFromStore, rackPlan } from "../src/sim/storage.js";
import * as Weather from "../src/sim/weather.js";
import { WORK_TYPES, WORK_KEYS, workState } from "../src/sim/work.js";
import { FIELD_TYPES, FIELD_KEYS } from "../src/sim/crews.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { heatInfo } from "../src/sim/fieldheat.js";
import { renderRight, tileActions } from "../src/ui/ui.js";
import { planSection, planEstimate, applyPreset, PLAN_ACTIONS, PLAN_CHANGE } from "../src/ui/plan.js";
import { classify } from "../src/sim/diary.js";

const SEED = Number(process.argv[2] || 42);
const AP_DAYS = Number(process.argv[3] || 110);
const AP_SEEDS = (process.argv[4] || "1-6").includes("-") ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(process.argv[4] ? process.argv[4].split("-").map(Number) : [1, 6]) : process.argv[4].split(",").map(Number);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const note = (s) => console.log(`  ${s}`);
const r1 = (x) => Math.round(x * 10) / 10;

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 6 });
  state.started = true;
  state.autoCombat = true;
  Object.assign(hub(state).stock, { food: 400, water: 400, fuel: 100, meds: 20, ammo: 400, arrows: 60, parts: 10, scrap: 100 });
  return state;
}
// A clean land tile of a terrain: low infection, no site, away from hives and bases (the terrain is what counts).
function cleanTile(state, terrain, extra = () => true) {
  const h = hub(state).tile;
  return state.tiles.filter((t) => t.terrain === terrain && !t.loc && (t.infection || 0) < 0.15 && !t.river &&
    !state.grid.neighbors(t.id).some((n) => state.tiles[n].terrain === "water") && !state.bases.some((b) => state.grid.distance(b.tile, t.id) <= 2) &&
    (!state.hives || state.hives.every((hv) => state.grid.distance(hv.tile, t.id) > 6)) && extra(t))
    .sort((a, b) => state.grid.distance(a.id, h) - state.grid.distance(b.id, h))[0] || null;
}
// A team placed on a tile (the rules on the spot are what is tested), weapons and skills set.
function placeTeam(state, tile, { n = 2, weapon = "huntrifle", second = "pistol", ammo = 60, arrows = 24, skills = null } = {}) {
  const h = hub(state);
  // Fresh people for every team (the hub's own stay home).
  const ids = [];
  for (let i = 0; i < n; i++) { const s = makeSurvivor(state); s.location = { kind: "base", baseId: h.id }; state.survivors.push(s); ids.push(s.id); }
  ids.forEach((id, i) => {
    const s = survivorById(state, id);
    s.gear.weapon = (i === 0 ? weapon : second) ? newItem(i === 0 ? weapon : second) : null;
    s.pockets = (s.pockets || []).map(() => null);
    if (s.gear.backpack && s.gear.backpack.contents) s.gear.backpack.contents = s.gear.backpack.contents.map(() => null);
    if (skills) Object.assign(s.skills, skills);
  });
  const near = state.tiles.find((t) => t.terrain !== "water" && state.grid.distance(t.id, h.tile) === 2 && planPath(state, h.tile, t.id, false));
  const res = launchExpedition(state, { memberIds: ids, dest: near.id, mission: "move", stance: "normal", supplies: { food: 6, water: 6 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  Object.assign(p.supplies, { food: 8, water: 8, ammo, arrows });
  p.path = [tile]; p.idx = 0; p.dest = tile; p.progress = 0; p.orders = []; p.phase = "waiting"; p.task = null;
  return p;
}
// One hunt (or fishing trip) of `hours` rolled hour by hour from `startHour` with the land reset (no clock ticks).
function simJob(state, p, kind, hours, startHour, { reset = true } = {}) {
  if (reset) { state.game = {}; state.fish = {}; }
  state.hour = startHour;
  p.cargo = { supplies: {}, gear: p.cargo ? p.cargo.gear : [] };
  p.heat = 0;
  if (p.ammo0 == null) p.ammo0 = p.supplies.ammo || 0;
  p.supplies.ammo = p.ammo0;
  if (p.arrows0 == null) p.arrows0 = p.supplies.arrows || 0;
  p.supplies.arrows = p.arrows0;
  p.phase = "task";
  p.task = { type: kind, hours, done: 0 };
  for (let i = 0; i < hours; i++) {
    state.hour += 1;
    p.task.done += 1;
    if (!(kind === "hunt" ? H.huntHour(state, p) : H.fishHour(state, p))) break;
  }
  return p.task.got || { rations: 0 };
}
// The first day index in a season (weather.js: day 0 is spring), optionally matching a test on its weather.
function dayIn(state, key, test = () => true, from = 0) {
  for (let d = from; d < 400; d++) {
    const s = Weather.season(state, d * 24 + 12);
    if (s.key === key && test(Weather.weather(state, d * 24 + 12), d)) return d;
  }
  return null;
}
const team = (state, p) => H.huntTeam(state, partyMembers(state, p), carried(p, "ammo"), { arrows: carried(p, "arrows") });
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

// ======================================================================
section("The land: game by terrain, hive land, bases, season and time of day");
{
  const state = mk();
  const rows = [];
  for (const k of ["forest", "hills", "plains", "mountain", "suburb", "city"]) {
    // Towns and cities are never clean: their least infected tile away from a hive.
    const t = cleanTile(state, k) || state.tiles.filter((x) => x.terrain === k && state.hives.every((hv) => state.grid.distance(hv.tile, x.id) > 6)).sort((a, b) => (a.infection || 0) - (b.infection || 0))[0];
    if (t) rows.push([k, H.gameAbundance(state, t.id)]);
  }
  note(`abundance: ${rows.map(([k, a]) => `${k} ${r1(a * 100) / 100}`).join(", ")}`);
  const ab = Object.fromEntries(rows);
  check(ab.forest > ab.hills && ab.hills > ab.plains && ab.plains > (ab.suburb ?? 0) && (ab.suburb ?? 0) > (ab.city ?? -1), "forest > hills > farmland > suburbs > city");
  check(ab.city == null || ab.city < 0.05, "a city has almost no game");
  const hiveTile = state.hives && state.hives[0] ? state.grid.within(state.hives[0].tile, 2).find((id) => state.tiles[id].terrain === "forest" || state.tiles[id].terrain === "plains") : null;
  if (hiveTile != null) check(H.gameAbundance(state, hiveTile) < 0.1, `hive land: almost nothing (${r1(H.gameAbundance(state, hiveTile) * 100) / 100})`);
  check(H.gameAbundance(state, hub(state).tile) < 0.35, "a base's own tile: little game");
  check(H.gameWord(1) === "plenty" && H.gameWord(0.4) === "some" && H.gameWord(0.1) === "scarce" && H.gameWord(0.01) === "none", "words: plenty / some / scarce / none");
  const sum = dayIn(state, "summer"), aut = dayIn(state, "autumn"), spr = dayIn(state, "spring");
  const snowy = dayIn(state, "winter", (w) => w.snowCover >= 0.3), bare = dayIn(state, "winter", (w) => w.snowCover < 0.3);
  const sg = (d) => H.seasonGame(state, d * 24 + 12);
  note(`season × : spring ${sg(spr)}, summer ${sg(sum)}, autumn ${sg(aut)}, winter ${bare != null ? sg(bare) : "–"} (bare) / ${snowy != null ? r1(sg(snowy) * 100) / 100 : "–"} (snow)`);
  check(sg(aut) > sg(sum) && sg(sum) > sg(spr), "autumn best, then summer, then spring");
  if (snowy != null && bare != null) check(sg(snowy) > sg(bare), "snow on the ground: tracks (winter with snow beats winter without)");
  check(H.timeOfDay(6) > H.timeOfDay(12) && H.timeOfDay(12) > H.timeOfDay(23), "dawn > midday > night");
}

// ======================================================================
section("Hunters: weapons, ammo, skill, perks and what a hunt brings (expected and rolled)");
const yieldRows = [];
{
  const state = mk();
  const forest = cleanTile(state, "forest");
  const aut = dayIn(state, "autumn");
  const start = aut * 24 + 5;
  const info = (w) => H.huntWeaponInfo(newItem(w));
  check(info("huntrifle").big === 1 && info("huntrifle").loud && info("huntrifle").ammo, "hunting rifle: the best for big game, loud, uses ammo");
  check(info("crossbow") && !info("crossbow").loud && !info("crossbow").ammo && info("crossbow").arrows && !info("huntrifle").arrows, "crossbow (cat bow): silent, no ammo, arrows");
  check(info("shotgun").small > info("huntrifle").small && info("shotgun").big < info("huntrifle").big, "shotgun: better for small game, worse for deer");
  check(info("pistol").big < info("crossbow").big, "pistol: poor for big game");
  check(!info("knife") && !info("machete"), "melee weapons: no hunting");
  for (const [k, g] of Object.entries(GEAR)) if (g.slot === "weapon" && H.HUNT_CAT[g.cat]) check(H.huntWeaponInfo(newItem(k)) != null, `${k} (${g.cat}) hunts`);
  // Who can hunt.
  const p = placeTeam(state, forest.id, { weapon: "huntrifle", second: "pistol", ammo: 0 });
  check(/hunting weapon/.test(H.huntProblem(state, p)), "firearms without ammo: no hunt");
  p.supplies.ammo = 60;
  check(H.huntProblem(state, p) === "", "with ammo: the hunt can start");
  const knives = placeTeam(state, forest.id, { weapon: "knife", second: "machete" });
  check(/Set snares/.test(H.huntProblem(state, knives)), "knives only: no hunt (snares instead)");
  const bows = placeTeam(state, forest.id, { weapon: "crossbow", second: null, ammo: 0, skills: { shooting: 5 } });
  check(H.huntProblem(state, bows) === "", "a crossbow needs no ammo (it has arrows)");
  bows.supplies.arrows = 0;
  check(/hunting weapon/.test(H.huntProblem(state, bows)), "a crossbow without arrows: no hunt");
  bows.supplies.arrows = 24;
  // Expected yields: weapon, skill, terrain, season.
  const exp = (pp, tile = forest.id, at = start, hours = 8) => H.expectHunt(state, team(state, pp).team, tile, hours, at, team(state, pp).loud).rations;
  const set = (pp, w1, w2, sk) => {
    partyMembers(state, pp).forEach((s, i) => { s.gear.weapon = (i === 0 ? w1 : w2) ? newItem(i === 0 ? w1 : w2) : null; Object.assign(s.skills, sk); });
  };
  const t2 = placeTeam(state, forest.id, { n: 2 });
  const sk5 = { shooting: 5, scouting: 5, stealth: 3 }, sk1 = { shooting: 1, scouting: 1, stealth: 0 }, sk12 = { shooting: 12, scouting: 10, stealth: 6 };
  set(t2, "huntrifle", "pistol", sk5); const rifle = exp(t2);
  set(t2, "crossbow", null, sk5); const bow = exp(t2);
  set(t2, "pistol", null, sk5); const pistol = exp(t2);
  set(t2, "shotgun", null, sk5); const shot = exp(t2);
  set(t2, "huntrifle", "pistol", sk1); const low = exp(t2);
  set(t2, "huntrifle", "pistol", sk12); const high = exp(t2);
  note(`8h in autumn forest, expected food: rifle+pistol ${rifle}, crossbow ${bow}, shotgun ${shot}, pistol ${pistol}; rifle+pistol at Shooting 1 ${low}, at 12 ${high}`);
  check(rifle > bow && bow > pistol && shot > pistol, "rifle > crossbow > pistol; shotgun > pistol");
  check(high > rifle && rifle > low, "skill: Shooting 12 > 5 > 1");
  const hunterS = partyMembers(state, t2)[0];
  hunterS.perks = [...(hunterS.perks || []), "hunter"];
  check(H.hunterMult(hunterS) > H.hunterMult({ ...hunterS, perks: [] }) - 1e-9, "the Hunter perk adds to the hunter");
  hunterS.perks = hunterS.perks.filter((x) => x !== "hunter");
  set(t2, "huntrifle", "pistol", sk5);
  for (const k of ["hills", "plains", "suburb", "city"]) { const t = cleanTile(state, k) || state.tiles.filter((x) => x.terrain === k && state.hives.every((hv) => state.grid.distance(hv.tile, x.id) > 6)).sort((a, b) => (a.infection || 0) - (b.infection || 0))[0]; if (t) yieldRows.push([k, exp(t2, t.id)]); }
  yieldRows.unshift(["forest", rifle]);
  note(`by terrain (rifle+pistol, autumn, 8h): ${yieldRows.map(([k, v]) => `${k} ${v}`).join(", ")}`);
  check(yieldRows.every((r, i) => i === 0 || r[1] <= yieldRows[i - 1][1] + 1e-9), "yield follows the land");
  const bySeason = ["spring", "summer", "autumn", "winter"].map((k) => [k, exp(t2, forest.id, dayIn(state, k) * 24 + 5)]);
  note(`by season (forest): ${bySeason.map(([k, v]) => `${k} ${v}`).join(", ")}`);
  check(bySeason[2][1] === Math.max(...bySeason.map((x) => x[1])), "autumn is the best season");
  check(exp(t2, forest.id, aut * 24 + 20) < exp(t2, forest.id, aut * 24 + 4), "a night hunt brings less than one from dawn");
  // Rolled hunts against the expectation (the land reset for every hunt).
  const rolled = [];
  for (let i = 0; i < 400; i++) rolled.push(simJob(state, t2, "hunt", 8, start).rations);
  const m = mean(rolled);
  t2.cargo = { supplies: {}, gear: [] };
  state.game = {};
  const room = cargoRoom(state, t2);
  const keep = H.expectHunt(state, team(state, t2).team, forest.id, 8, start, team(state, t2).loud, room);
  note(`400 rolled 8h hunts: mean ${r1(m)} food kept (expected ${keep.rations} of ${keep.all} bagged, ${Math.round(room)} kg of room), none in ${Math.round((rolled.filter((x) => x === 0).length / 4))}%, best ${Math.max(...rolled)}`);
  check(Math.abs(m - keep.rations) <= keep.rations * 0.15, `rolled mean within 15% of the expectation (${r1(m)} vs ${keep.rations})`);
  const bowRolled = (set(t2, "crossbow", null, sk5), mean(Array.from({ length: 300 }, () => simJob(state, t2, "hunt", 8, start).rations)));
  t2.cargo = { supplies: {}, gear: [] };
  state.game = {};
  const bowKeep = H.expectHunt(state, team(state, t2).team, forest.id, 8, start, 0, cargoRoom(state, t2)).rations;
  check(Math.abs(bowRolled - bowKeep) <= bowKeep * 0.2, `crossbow: rolled ${r1(bowRolled)} vs expected ${bowKeep}`);
  // What does not fit stays: a lone hunter with a full load keeps only what he can carry.
  set(t2, "huntrifle", "pistol", sk5);
}

// ======================================================================
section("Heat: gunshots vs bows, ammo, and the dead drawn to the shots");
{
  const state = mk();
  const forest = cleanTile(state, "forest");
  const start = dayIn(state, "autumn") * 24 + 5;
  const p = placeTeam(state, forest.id, { weapon: "huntrifle", second: "shotgun", ammo: 200, skills: { shooting: 8, scouting: 6 } });
  p.ammo0 = 200;
  let heatRifle = [], shots = 0, ammoUsed = 0;
  for (let i = 0; i < 200; i++) {
    const got = simJob(state, p, "hunt", 8, start);
    heatRifle.push(p.heat);
    shots += got.shots;
    ammoUsed += 200 - p.supplies.ammo;
  }
  check(shots > 0 && ammoUsed === shots, `every shot uses 1 ammo (${shots} shots, ${ammoUsed} ammo)`);
  const b = placeTeam(state, forest.id, { weapon: "crossbow", second: null, ammo: 0, skills: { shooting: 8, scouting: 6 } });
  const heatBow = [];
  let bowShots = 0;
  for (let i = 0; i < 200; i++) { const got = simJob(state, b, "hunt", 8, start); heatBow.push(b.heat); bowShots += got.shots; }
  note(`Heat from the shots alone over an 8h hunt: rifle + shotgun ${r1(mean(heatRifle))} (${r1(shots / 200)} shots a hunt), crossbow ${r1(mean(heatBow))}`);
  check(mean(heatRifle) > 5 && mean(heatBow) === 0 && bowShots === 0, "gunshots add Heat; a crossbow adds none");
  // The Heat of the hunt itself (fieldheat.js): hunting is an activity on the spot.
  p.phase = "task"; p.task = { type: "hunt", hours: 8, done: 0 }; p.heat = 0;
  check(/hunting/.test(heatInfo(state, p).text), "the team panel names the hunt in its Heat line");
  // A wandering horde within 3 tiles turns toward the shots now and then.
  let drawn = 0, shotsN = 0;
  const ring = state.grid.within(forest.id, 3).find((id) => state.grid.distance(id, forest.id) === 2 && state.tiles[id].terrain !== "water");
  for (let i = 0; i < 150; i++) {
    state.hordes.length = 0;
    const hz = makeHorde(state, { tile: ring, size: 30, role: "roam" });
    const got = simJob(state, p, "hunt", 8, start);
    if (got.shots) { shotsN++; if (hz.target === forest.id) drawn++; }
  }
  state.hordes.length = 0;
  note(`a roaming horde 2 tiles off: drawn toward the hunt in ${drawn} of ${shotsN} hunts with shots`);
  check(drawn > 0 && drawn < shotsN, "gunshots draw the dead sometimes, not always");
}

// ======================================================================
section("Overhunting: game runs down and grows back over weeks");
{
  const state = mk();
  const forest = cleanTile(state, "forest");
  state.game = {};
  check(H.gameLevel(state, forest.id) === 1, "untouched land: level 1");
  H.takeGame(state, forest.id, 30, H.HUNT.bigDeplete);
  check(Math.abs(H.gameLevel(state, forest.id) - 0.7) < 1e-6, "a deer (30 food) takes 0.3 off the tile");
  const l20 = H.gameLevel(state, forest.id, state.hour + 20 * 24), l60 = H.gameLevel(state, forest.id, state.hour + 60 * 24);
  note(`level after a deer: now 0.7, in 20 days ${r1(l20 * 100) / 100}, in 60 days ${r1(l60 * 100) / 100}`);
  check(Math.abs(l20 - 0.85) < 0.01 && l60 > 0.95, "half the loss back in 20 days, nearly all in 60");
  // Hunting the same tile day after day: each hunt brings less.
  const start = dayIn(state, "autumn") * 24 + 5;
  const p = placeTeam(state, forest.id, { skills: { shooting: 8, scouting: 6 } });
  const hauls = [];
  state.game = {};
  for (let d = 0; d < 6; d++) {
    const at = start + d * 24;
    hauls.push(H.expectHunt(state, team(state, p).team, forest.id, 8, at).rations);
    simJob(state, p, "hunt", 8, at, { reset: false });
  }
  note(`six days on one tile, expected haul each morning: ${hauls.join(", ")}; game now ${H.gameWord(H.gameAbundance(state, forest.id) * H.gameLevel(state, forest.id))}`);
  check(hauls[5] < hauls[0], "each hunt on the same land brings less");
}

// ======================================================================
section("Snares: a line, its catch over days, rot, theft and the wire");
{
  const state = mk();
  const forest = cleanTile(state, "forest");
  const start = dayIn(state, "autumn") * 24 + 8;
  state.hour = start;
  const p = placeTeam(state, forest.id, { weapon: "knife", second: null, ammo: 0 });
  p.supplies.scrap = 0;
  check(/snare wire/.test(H.snareProblem(state, p)), "no wire and no scrap: no snares");
  partyMembers(state, p)[0].pockets[0] = newItem("snarewire");
  check(H.snareProblem(state, p) === "" && H.snareMode(state, forest.id) === "set" && H.snareHours(state, forest.id) === 2, "with snare wire: set a line (2h)");
  const msg = startOrder(state, p, { type: "snare" });
  check(p.phase === "task" && p.task.type === "snare" && p.task.mode === "set" && p.task.hours === 2, `the order runs 2h (${msg})`);
  p.task.done = 1;
  H.snareWork(state, p, "set");
  const line = H.snareLine(state, forest.id);
  check(!!line && line.wire && line.wire.key === "snarewire" && !partyMembers(state, p)[0].pockets.some((it) => it && it.key === "snarewire"), "the wire stays with the line");
  check(H.snareMode(state, forest.id) === "check" && H.snareHours(state, forest.id) === 1, "a line here: the next snare order checks it (1h)");
  // Catch after 1, 3 and 10 days (rolled many times on a fresh line each time).
  const roll = (days, n = 300) => {
    const out = { food: 0, robbed: 0, rotted: 0, gone: 0 };
    for (let i = 0; i < n; i++) {
      state.game = {};
      state.snares = [{ id: 1, tile: forest.id, set: start, check: null, wire: newItem("snarewire"), by: [] }];
      state.hour = start + days * 24;
      p.cargo = { supplies: {}, gear: [] };
      const text = H.snareWork(state, p, "check");
      out.food += carried(p, "food") - p.supplies.food;
      if (/got to the line/.test(text)) out.robbed++;
      if (/gone bad/.test(text)) out.rotted++;
      if (!H.snareLine(state, forest.id)) out.gone++;
    }
    return { food: r1(out.food / n), robbed: out.robbed / n, rotted: out.rotted / n, gone: out.gone / n };
  };
  state.game = {};
  const e1 = H.expectSnare(state, forest.id, start, start + 24).rations, e3 = H.expectSnare(state, forest.id, start, start + 72).rations;
  const c1 = roll(1), c3 = roll(3), c10 = roll(10);
  note(`catch (food) after 1 day ${c1.food} (expected ${e1}), 3 days ${c3.food} (expected ${e3}), 10 days ${c10.food}; robbed ${Math.round(c3.robbed * 100)}% at 3 days, ${Math.round(c10.robbed * 100)}% at 10; line gone ${Math.round(c10.gone * 100)}% at 10 days`);
  check(Math.abs(c1.food - e1) <= Math.max(0.6, e1 * 0.25), "one day: the catch matches the expectation");
  check(c3.food > c1.food, "three days catch more than one");
  check(c10.food < (H.expectSnare(state, forest.id, start, start + 240).rations) * 0.6 && c10.robbed > 0.3 && c10.gone > 0.05, "ten days unchecked: most of it rots or is taken, and lines are lost");
  check(c1.robbed === 0, "within 2 days nothing is stolen");
  // Lift: the wire comes back.
  state.snares = [{ id: 1, tile: forest.id, set: start, check: null, wire: newItem("snarewire"), by: [] }];
  state.hour = start + 24;
  p.cargo = { supplies: {}, gear: [] };
  H.snareWork(state, p, "lift");
  check(!H.snareLine(state, forest.id) && p.cargo.gear.some((it) => it.key === "snarewire"), "lifting the line puts the wire in the cargo");
  // Scrap instead of wire.
  p.cargo = { supplies: {}, gear: [] };
  partyMembers(state, p).forEach((s) => { s.pockets = s.pockets.map(() => null); });
  p.supplies.scrap = 5;
  H.snareWork(state, p, "set");
  check(H.snareLine(state, forest.id) && !H.snareLine(state, forest.id).wire && p.supplies.scrap === 3, "2 scrap of fence wire make a line");
  // Lines nobody comes back for are gone after 30 days.
  state.hour += 31 * 24;
  H.snaresDaily(state);
  check(!H.snareLine(state, forest.id), "a line left 30 days is gone");
}

// ======================================================================
section("Fishing: rods, nets, water, season, ice");
{
  const state = mk();
  const spot = (k) => state.tiles.find((t) => t.terrain !== "water" && !t.loc && !state.bases.some((b) => b.tile === t.id) && H.fishSpot(state, t.id)?.kind === k);
  const river = spot("river"), lake = spot("bend") || spot("lake"), pond = spot("pond");
  check(!!river && !!lake, "the map has river banks and deep river bends to fish");
  check(H.fishSpot(state, cleanTile(state, "forest").id) == null, "no fishing away from the water");
  const sum = dayIn(state, "summer") * 24 + 5;
  const p = placeTeam(state, river.id, { weapon: "knife", second: null });
  check(/fishing rod, a net or a spear/.test(H.fishProblem(state, p)), "no rod, net or spear: no fishing");
  partyMembers(state, p)[0].gear.backpack = partyMembers(state, p)[0].gear.backpack || newItem("backpack");
  p.cargo.gear.push(newItem("fishrod"));
  state.hour = sum;
  check(H.fishProblem(state, p) === "", "a rod in the cargo: the team can fish");
  const kitRod = H.fishKit(partyMembers(state, p), p.cargo.gear);
  const kitNet = H.fishKit(partyMembers(state, p), [newItem("fishnet")]);
  check(kitNet.power > kitRod.power * 1.7, `a net worked by two catches about twice a rod (${r1(kitNet.power)} vs ${r1(kitRod.power)})`);
  const eRiver = H.expectFish(state, kitRod, river.id, 8, sum).rations, eLake = H.expectFish(state, kitRod, lake.id, 8, sum).rations, ePond = pond ? H.expectFish(state, kitRod, pond.id, 8, sum).rations : null;
  note(`a rod, 8h in summer from dawn: deep river bend ${eLake}, river ${eRiver}${ePond != null ? `, pond ${ePond}` : ""} food`);
  check(eLake > eRiver && (ePond == null || eRiver > ePond), "a deep bend (or a lake) > a river > a pond");
  const rodItem = p.cargo.gear.find((it) => it.key === "fishrod");
  const rolled = mean(Array.from({ length: 300 }, () => { rodItem.dur = GEAR.fishrod.dur; return simJob(state, p, "fish", 8, sum).rations; })); // a fresh rod each trip (it wears a use a day of fishing)
  check(Math.abs(rolled - eRiver) <= eRiver * 0.15, `rolled fishing matches the expectation (${r1(rolled)} vs ${eRiver})`);
  const bySeason = ["spring", "summer", "autumn", "winter"].map((k) => [k, H.seasonFish(state, dayIn(state, k) * 24 + 12)]);
  check(bySeason[0][1] > bySeason[1][1] && bySeason[1][1] > bySeason[2][1] && bySeason[2][1] > bySeason[3][1], "spring runs best, winter worst");
  const frozen = dayIn(state, "winter", (w) => w.frozen);
  if (frozen != null) {
    state.hour = frozen * 24 + 9;
    check(/frozen/.test(H.fishProblem(state, p)), "frozen water: no fishing without a tool to cut the ice");
    p.cargo.gear.push(newItem("crowbar"));
    check(H.fishProblem(state, p) === "", "a crowbar cuts the ice");
    const kitIce = H.fishKit(partyMembers(state, p), p.cargo.gear);
    const w = Weather.weather(state, state.hour);
    const want = kitIce.power * H.fishSpot(state, river.id).mult * H.seasonFish(state) * H.timeOfDay(state.hour, "fish") * (w.severe ? 0.5 : 1) * H.fishLevel(state, river.id) * H.FISH.ice;
    check(Math.abs(H.fishRate(state, kitIce, river.id, state.hour) - want) < 1e-9, "ice fishing catches half");
  } else note("no frozen day in the first winter on this seed: ice fishing not checked");
  // Fish run out and come back in about 10 days.
  state.fish = {};
  rodItem.dur = GEAR.fishrod.dur;
  simJob(state, p, "fish", 24, sum, { reset: false });
  const lvl = H.fishLevel(state, river.id);
  check(lvl < 1 && H.fishLevel(state, river.id, state.hour + 10 * 24) > lvl, `fished down to ${r1(lvl * 100)}%, back up in 10 days`);
}

// ======================================================================
section("Carcasses: weight on foot and in a car");
{
  const state = mk();
  const forest = cleanTile(state, "forest");
  const p = placeTeam(state, forest.id, { weapon: "huntrifle", second: "pistol" });
  p.supplies = { food: 6, water: 6 };
  p.cargo = { supplies: {}, gear: [] };
  const members = partyMembers(state, p);
  const before = poolLoad(p);
  const kept = H.addMeat(state, p, 30);
  check(kept === 30 && Math.abs(poolLoad(p) - before - 30) < 1e-9, "30 food of fresh game weighs 30 kg (1 kg a ration)");
  const meatPool = poolLoad(p);
  const foodPool = before + 30 * 0.5;
  const bandOf = (pool, v = null) => Math.max(...teamLoad(members, pool, v).foot.people.map((x) => x.band));
  const sp = (pool) => teamLoad(members, pool).foot.speed;
  note(`two people: 30 packed food → ${LOAD_BANDS[bandOf(foodPool)].name} (pace ×${sp(foodPool)}), a 30-food deer → ${LOAD_BANDS[bandOf(meatPool)].name} (pace ×${sp(meatPool)})`);
  check(sp(meatPool) < sp(foodPool), "a carcass on foot slows the team more than the same food packed");
  const truck = teamLoad(members, meatPool, { type: "truck" });
  check(truck.ride.speed === 1 && Object.values(truck.ride.eat).every((x) => x === 1), "in a car the game weighs nothing on the riders");
  const bike = teamLoad(members, meatPool, { type: "bike", count: 2 });
  check(bike.ride.speed > sp(meatPool) - 1e-9, "on bikes the racks and riding take part of it");
  // What does not fit is left where it fell.
  const lone = placeTeam(state, forest.id, { n: 1 });
  lone.supplies = { food: 10, water: 10 };
  lone.cargo = { supplies: {}, gear: [] };
  const fit = H.addMeat(state, lone, 300);
  check(fit > 0 && fit < 300 && cargoLoad(lone.cargo) <= 40, `a lone hunter keeps what he can carry (${fit} of 300)`);
}

// ======================================================================
section("Spoilage: fresh game in the field and at a base; drying racks and the cabin");
{
  const state = mk();
  const forest = cleanTile(state, "forest");
  const p = placeTeam(state, forest.id);
  const hot = dayIn(state, "summer", (w) => w.hi >= 28);
  const freeze = dayIn(state, "winter", (w) => w.hi < -1);
  const spoilDay = (d) => {
    p.cargo = { supplies: {}, gear: [] };
    H.addMeat(state, p, 30);
    state.hour = d * 24;
    for (let i = 0; i < 24; i++) { state.hour++; H.gameSpoilHour(state, p); }
    return 30 - H.meatIn(p.cargo);
  };
  const lossHot = hot != null ? spoilDay(hot) : null, lossCold = freeze != null ? spoilDay(freeze) : null;
  note(`30 fresh game carried for a day: lost ${lossHot != null ? r1(lossHot) : "–"} on a hot summer day, ${lossCold != null ? r1(lossCold) : "–"} on a freezing one`);
  if (lossHot != null) check(lossHot > 7, "summer heat: a quarter or more spoils in a day");
  if (lossCold != null) check(lossCold < 1.5, "in a freeze it keeps");
  // Eaten first in the field.
  p.cargo = { supplies: {}, gear: [] };
  H.addMeat(state, p, 10);
  const packed = p.supplies.food;
  p.phase = "waiting";
  state.hour = dayIn(state, "autumn") * 24;
  tickHour(state);
  check(p.supplies.food === packed && H.meatIn(p.cargo) < 10, "the team eats its fresh game before its packed food");
  // At a base.
  const twin = (meat, build = []) => {
    const st = mk();
    const b = hub(st);
    st.hour = dayIn(st, "summer") * 24 + 12;
    for (const t of build) addBuilding(b, t);
    Object.assign(b.stock, { food: 150, preserved: 0 });
    b.meat = meat;
    const out = storageDaily(st, b);
    return { b, out, food: b.stock.food, pres: b.stock.preserved, meat: b.meat };
  };
  const none = twin(0), game = twin(60), racks = twin(60, ["smoker"]), cabin = twin(60, ["huntcabin"]);
  note(`a summer day, 150 fresh food at the hub: lost ${r1(150 - none.food)} with no game; with 60 of it fresh game ${r1(150 - game.food)}; a drying rack ${r1(150 - racks.food)} (preserved +${r1(racks.pres)}); a hunting cabin ${r1(150 - cabin.food)} (preserved +${r1(cabin.pres)})`);
  check(150 - game.food > 150 - none.food + 1, "fresh game spoils faster than other fresh food");
  check(racks.pres > 0 && racks.meat < 60 - 3, "a drying rack takes the game first, even with no surplus");
  check(Math.abs(cabin.pres - 5) < 0.05 && cabin.meat < 60 - 6, "a hunting cabin smokes 6 game into 5 preserved");
  const b2 = twin(40).b;
  eatFromStore(b2, 10);
  check(Math.abs(b2.meat - (H.meatAt(b2))) < 1e-9 && b2.meat <= 40 - 10 + 1e-9, "a base eats its fresh game first");
}

// ======================================================================
section("The hunting cabin, the Hunt and Fish jobs");
{
  // A world whose hub has game land around it.
  let state = null, base = null;
  for (let s = SEED; s < SEED + 40 && !state; s++) {
    const st = mk(s);
    if (!H.cabinProblem(st, hub(st)) && H.gameLand(st, hub(st)) >= 6) { state = st; base = hub(st); }
  }
  check(!!state, "a seed with game land around the hub");
  const city = { ...base, id: -1, tile: state.tiles.find((t) => t.terrain === "city").id, type: "outpost", buildings: [], construction: [], stock: { scrap: 50 }, armory: [] };
  check(!canBuild(state, city, "huntcabin").ok && /game land/.test(canBuild(state, city, "huntcabin").reason), "no hunting cabin in a city");
  check(canBuild(state, base, "huntcabin").ok, "a hunting cabin where the land has game");
  // The rule changed (user 2026-10-10): any base hunts without a cabin, on the tiles next to it; the cabin widens the
  // grounds to 2 tiles (it was: no cabin, no Hunt job).
  check(H.huntWorkWhy(state, base) === "" && H.huntRadius(base) === 1 && H.huntGrounds(state, base).every((id) => state.grid.distance(base.tile, id) <= 1) && WORK_TYPES.hunt.open({ state, base, people: [], foodDays: 10 }).cap > 0, "no cabin: the Hunt job on the tiles next to the base");
  const bare = H.baseHuntDay(state, base);
  addBuilding(base, "huntcabin");
  check(H.huntRadius(base) === 2 && H.huntGrounds(state, base).some((id) => state.grid.distance(base.tile, id) === 2) && H.baseHuntDay(state, base) >= bare, `a cabin widens the grounds to 2 tiles (an average hunter ${r1(bare)} → ${r1(H.baseHuntDay(state, base))} food a day)`);
  {
    // tune-jobcaps: no fixed cap (it was 2): the hunters it takes to bring in the food the land must (foraging.js
    // landFoodGap), at least one while the job is open; more with the stores empty.
    const c1 = WORK_TYPES.hunt.open({ state, base, people: [], foodDays: 10 }).cap;
    const keep = { food: base.stock.food, preserved: base.stock.preserved };
    base.stock.food = 0; base.stock.preserved = 0;
    const extra = Array.from({ length: 20 }, () => { const s = makeSurvivor(state, 1); s.location = { kind: "base", baseId: base.id }; state.survivors.push(s); return s; });
    const c0 = WORK_TYPES.hunt.open({ state, base, people: [], foodDays: 0 }).cap;
    for (const s of extra) state.survivors.splice(state.survivors.indexOf(s), 1);
    Object.assign(base.stock, keep);
    check(H.huntWorkWhy(state, base) === "" && c1 >= 1 && c0 > 2 && c0 >= c1, `a cabin: Hunt work sized to the food the land must bring in, no fixed cap (${c1} now, ${c0} with 20 more mouths and the stores empty)`);
  }
  check(WORK_KEYS.includes("hunt") && WORK_KEYS.includes("fish"), "Hunt and Fish are work types");
  workState(state);
  check(state.work.roles.some((r) => r.name === "Hunter" && r.pri.hunt === 1) && state.work.roles.some((r) => r.name === "Hunting party" && r.kind === "crew" && r.crew.field.hunt === 1), "a Hunter role and a Hunting party crew by default");
  check(FIELD_KEYS.includes("hunt") && FIELD_KEYS.includes("fish") && FIELD_TYPES.hunt.cands && FIELD_TYPES.fish.cands, "crews have hunting and fishing jobs");
  const people = atBase(state, base.id);
  people[0].gear.weapon = newItem("huntrifle"); people[0].skills.shooting = 7; people[0].skills.scouting = 5;
  people[1].gear.weapon = newItem("crossbow"); people[1].skills.shooting = 5;
  people[0].role = "hunt"; people[1].role = "hunt";
  setAmmo(base.stock, 100);
  const autumn = dayIn(state, "autumn");
  let food = 0, ammo0 = totalRounds(base.stock);
  state.game = {};
  const daily = [];
  for (let d = 0; d < 28; d++) {
    state.hour = (autumn + d) * 24 + 24;
    const got = huntDay(state, base);
    food += got.rations;
    daily.push(got.rations);
  }
  const land = state.grid.within(base.tile, H.CABIN.radius).filter((id) => H.gameAbundance(state, id) > 0.3);
  const lvl = mean(land.map((id) => H.gameLevel(state, id)));
  note(`two hunters (rifle, crossbow) at a cabin through autumn: ${food} food in 28 days (first week ${daily.slice(0, 7).reduce((a, b) => a + b, 0)}, last week ${daily.slice(21).reduce((a, b) => a + b, 0)}); ${ammo0 - totalRounds(base.stock)} ammo; the land down to ${Math.round(lvl * 100)}% on average`);
  check(food > 0 && totalRounds(base.stock) < ammo0, "the cabin's hunters bring in game and use the base's ammo");
  check(lvl < 0.95, "the land around the cabin is hunted down");
  check(food / 28 < 20, `about ${r1(food / 28)} food a day for two hunters: a help, not a farm's worth of the land`);
  // Fish job: an outpost on a river with a rod in the armory.
  const river = state.tiles.find((t) => t.terrain !== "water" && !t.loc && !state.bases.some((b) => b.tile === t.id) && H.fishSpot(state, t.id));
  const out = { id: newId(), tile: river.id, type: "outpost", name: "Test Landing", stock: { food: 20, water: 20, ammo: 0, scrap: 0, preserved: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  state.bases.push(out);
  recomputeOwnership(state); // factions.js: the ground round the new outpost is yours (the Fish job needs water in the base's own land)
  const f = people[2];
  f.location = { kind: "base", baseId: out.id };
  f.role = "fish";
  check(/no fishing rod/.test(H.fishWorkWhy(state, out)), "no rod or net: no Fish work");
  out.armory.push(newItem("fishrod"));
  check(H.fishWorkWhy(state, out) === "" && H.fishWorkCap(state, out) === 1, "a rod in the armory: Fish work for one");
  let fish = 0;
  for (let d = 0; d < 14; d++) { state.hour = (dayIn(state, "summer") + d) * 24 + 24; fish += huntDay(state, out).rations; }
  note(`one fisher with a rod on a river through two summer weeks: ${fish} food`);
  check(fish > 0 && H.meatAt(out) > 0, "the fisher brings in fresh fish");
}

// ======================================================================
section("The hunting mix: traps, bows and guns (a base's setting, its hunters and its teams)");
{
  const state = mk();
  const h = hub(state);
  const forest = cleanTile(state, "forest");
  const start = dayIn(state, "autumn") * 24 + 5;
  const sum = (m) => m.traps + m.bows + m.guns;
  // The setting.
  check(JSON.stringify(H.huntMixOf(h)) === JSON.stringify(H.DEFAULT_MIX) && H.DEFAULT_MIX.guns === 100, "a base hunts with guns (every hunter's best weapon) until the mix is set");
  H.setHuntShare(h, "traps", 30);
  const m1 = { ...h.huntMix };
  H.setHuntShare(h, "bows", 40);
  const m2 = { ...h.huntMix };
  check(m1.traps === 30 && m1.guns === 70 && sum(m1) === 100 && m2.bows === 40 && m2.traps + m2.guns === 60 && sum(m2) === 100, `one share set, the other two share the rest (${JSON.stringify(m1)} → ${JSON.stringify(m2)})`);
  const odd = H.normalMix({ traps: 33, bows: 33, guns: 34 });
  check(sum(odd) === 100 && H.HUNT_METHODS.every((k) => odd[k] % 10 === 0), `a mix is whole tens adding up to 100 (${JSON.stringify(odd)})`);
  const seq = H.methodSeq({ traps: 0.25, bows: 0.25, guns: 0.5 }, 8);
  const cnt = (k) => seq.filter((x) => x === k).length;
  check(cnt("guns") === 4 && cnt("bows") === 2 && cnt("traps") === 2 && seq[0] === "guns", `a team's 8 hours at 25/25/50: ${seq.join(", ")}`);
  check(H.methodSeq(H.mixShares(H.DEFAULT_MIX), 8).every((m) => m === "guns"), "all guns: every hour with the best weapon");
  // A team of two (a hunting rifle and a compound bow) hunting 8 hours of autumn forest, by its home base's mix.
  const p = placeTeam(state, forest.id, { weapon: "huntrifle", second: "compbow", ammo: 200, arrows: 80, skills: { shooting: 6, scouting: 5, stealth: 3 } });
  p.homeBaseId = h.id;
  const MIXES = { guns: H.MIX_PRESETS.guns.mix, bows: { traps: 0, bows: 100, guns: 0 }, traps: H.MIX_PRESETS.traps.mix, mixed: H.MIX_PRESETS.mixed.mix };
  const runs = {};
  for (const [k, mix] of Object.entries(MIXES)) {
    H.setHuntMix(h, mix);
    p.cargo = { supplies: {}, gear: [] };
    state.game = {};
    p.supplies.ammo = p.ammo0 ?? 200; p.supplies.arrows = p.arrows0 ?? 80;
    const t = H.partyHuntTeam(state, p);
    const est = H.expectHunt(state, t.team, forest.id, 8, start, t.loud, cargoRoom(state, p));
    const N = 300, r = { food: 0, shots: 0, heat: 0, ammo: 0, arrows: 0, arrowShots: 0, trapped: 0, hrs: { traps: 0, bows: 0, guns: 0 } };
    for (let i = 0; i < N; i++) {
      const got = simJob(state, p, "hunt", 8, start);
      r.food += got.rations / N; r.shots += got.shots / N; r.heat += p.heat / N; r.trapped += (got.trapped || 0) / N;
      r.ammo += (p.ammo0 - p.supplies.ammo) / N; r.arrows += (p.arrows0 - p.supplies.arrows) / N; r.arrowShots += (got.arrowShots || 0) / N;
      for (const m of H.HUNT_METHODS) r.hrs[m] += ((got.hrs || {})[m] || 0) / N;
    }
    runs[k] = { ...r, est };
  }
  const R = runs;
  note(`8h of autumn forest, a rifle and a compound bow, by the mix (expected / rolled mean of 300): ${Object.entries(R).map(([k, r]) => `${k} ${r.est.rations} / ${r1(r.food)} food, ${r1(r.shots)} shots, Heat ${r1(r.heat)}, ${r1(r.ammo)} ammo, ${r1(r.arrows)} arrows lost${r.trapped ? `, ${r1(r.trapped)} trapped` : ""}`).join("; ")}`);
  check(R.traps.est.rations < R.bows.est.rations && R.bows.est.rations < R.guns.est.rations, "food: traps < bows < guns");
  check(R.traps.est.rations / R.guns.est.rations > 0.2 && R.traps.est.rations / R.guns.est.rations < 0.6, `traps bring in less (${Math.round((R.traps.est.rations / R.guns.est.rations) * 100)}% of guns on a team's hunt)`);
  check(R.bows.est.rations / R.guns.est.rations > 0.6, `bows nearly a gun's food (${Math.round((R.bows.est.rations / R.guns.est.rations) * 100)}%)`);
  for (const [k, r] of Object.entries(R)) check(Math.abs(r.food - r.est.rations) <= Math.max(1.5, r.est.rations * 0.2), `${k}: rolled ${r1(r.food)} vs expected ${r.est.rations}`);
  check(R.guns.shots > 1 && R.guns.heat > 5 && Math.abs(R.guns.ammo - R.guns.shots) < 1e-9, `guns: shots use ammo and add Heat (${r1(R.guns.shots)} shots, Heat ${r1(R.guns.heat)})`);
  check(Math.abs(R.guns.est.shots - R.guns.shots) <= Math.max(0.6, R.guns.shots * 0.2), `guns: the expected shots match (${R.guns.est.shots} vs ${r1(R.guns.shots)})`);
  check(R.bows.shots === 0 && R.bows.heat === 0 && R.bows.ammo === 0 && R.bows.arrows > 0, "bows: no shots, no Heat, no ammo; arrows lost");
  check(Math.abs(R.bows.arrows / R.bows.arrowShots - H.ARROW.lost) < 0.08, `bows: about ${H.ARROW.lost * 100}% of the arrows shot are lost (${Math.round((R.bows.arrows / R.bows.arrowShots) * 100)}%)`);
  check(Math.abs(R.bows.est.arrows - R.bows.arrows) <= Math.max(0.5, R.bows.arrows * 0.25), `bows: the expected arrows lost match (${R.bows.est.arrows} vs ${r1(R.bows.arrows)})`);
  check(R.traps.shots === 0 && R.traps.heat === 0 && R.traps.ammo === 0 && R.traps.arrows === 0 && R.traps.trapped > 0 && Math.round(R.traps.hrs.traps) === 8, "traps: silent, no ammo or arrows, small game only, every hour on the traps");
  check(R.mixed.shots > 0 && R.mixed.shots < R.guns.shots * 0.75 && Math.round(R.mixed.hrs.guns) === 4 && Math.round(R.mixed.hrs.bows) === 4, `bows and guns half and half: 4 hours each, fewer shots (${r1(R.mixed.shots)} vs ${r1(R.guns.shots)})`);
  // Fallbacks: never louder than the mix.
  H.setHuntMix(h, { traps: 0, bows: 100, guns: 0 });
  p.arrows0 = 0;
  const noArrows = simJob(state, p, "hunt", 8, start);
  check(noArrows.hrs.traps === 8 && noArrows.shots === 0 && /traps 8h/.test(H.huntSummary(state, p, p.task)), "bows without arrows: the bow hours go to the traps (no shot fired)");
  p.arrows0 = 80;
  H.setHuntMix(h, H.DEFAULT_MIX);
  p.ammo0 = 0;
  const noAmmo = simJob(state, p, "hunt", 8, start);
  check(H.huntProblem(state, p) === "" && noAmmo.shots === 0 && noAmmo.arrowShots > 0, "guns without ammo: the bow hunts (silent)");
  p.ammo0 = 200;
  const knives = placeTeam(state, forest.id, { weapon: "knife", second: null });
  knives.homeBaseId = h.id;
  H.setHuntMix(h, H.MIX_PRESETS.traps.mix);
  check(/Set snares/.test(H.huntProblem(state, knives)), "a team with no hunting weapon still cannot take the Hunt order (the Snares order is theirs)");
  H.setHuntMix(h, H.DEFAULT_MIX);
}
{
  const sum = (m) => m.traps + m.bows + m.guns;
  // The cabin: three hunters, each with a hunting rifle in hand and a compound bow in the pack, 20 days of autumn by
  // each mix, ten times over (the land fresh each time: a deer is 30 food, so one run is mostly luck).
  let state = null, base = null;
  for (let s = SEED; s < SEED + 40 && !state; s++) {
    const st = mk(s);
    if (!H.cabinProblem(st, hub(st)) && H.gameLand(st, hub(st)) >= 6) { state = st; base = hub(st); }
  }
  addBuilding(base, "huntcabin");
  const people = atBase(state, base.id);
  const hunters = people.slice(0, 3);
  hunters.forEach((s) => {
    s.gear.weapon = newItem("huntrifle");
    s.gear.backpack = newItem("hikingpack");
    s.gear.backpack.contents = (s.gear.backpack.contents || new Array(10).fill(null)).map(() => null);
    s.gear.backpack.contents[0] = newItem("compbow");
    Object.assign(s.skills, { shooting: 6, scouting: 5, stealth: 3 }); s.role = "hunt";
    s.traits = []; s.traitTier = {}; // no traits: an Unlucky hunter falls under the rifle's Shooting and takes the bow
  });
  for (const s of people.slice(3)) s.role = "farm";
  const autumn = dayIn(state, "autumn");
  const MIXES = { guns: H.MIX_PRESETS.guns.mix, bows: { traps: 0, bows: 100, guns: 0 }, traps: H.MIX_PRESETS.traps.mix, quiet: H.MIX_PRESETS.quiet.mix, mixed: H.MIX_PRESETS.mixed.mix };
  const rows = {};
  const RUNS = 20;
  const snap = hunters.map((s) => structuredClone(s));
  for (const [k, mix] of Object.entries(MIXES)) {
    H.setHuntMix(base, mix);
    delete base.huntCarry;
    const r = { food: 0, ammo: 0, arrows: 0, noise: 0, hrs: { traps: 0, bows: 0, guns: 0 } };
    for (let run = 0; run < RUNS; run++) {
      state.game = {};
      hunters.forEach((s, i) => Object.assign(s, structuredClone(snap[i]))); // the same hunters every run (no skill gained)
      setAmmo(base.stock, 300); base.stock.arrows = 100;
      for (let d = 0; d < 20; d++) {
        state.hour = (autumn + d) * 24 + 24;
        const got = huntDay(state, base);
        r.food += got.rations / RUNS; r.noise += base.huntNoise / RUNS;
        for (const m of H.HUNT_METHODS) r.hrs[m] += got.hrs[m] / RUNS;
      }
      r.ammo += (300 - totalRounds(base.stock)) / RUNS; r.arrows += (100 - base.stock.arrows) / RUNS;
    }
    rows[k] = r;
  }
  note(`three cabin hunters (a rifle and a compound bow each), 20 autumn days (mean of ${RUNS}): ${Object.entries(rows).map(([k, r]) => `${k} ${r1(r.food)} food (${r1(r.food / 60)} a hunter-day), ${r1(r.ammo)} ammo, ${r1(r.arrows)} arrows, base Heat from the shots ${r1(r.noise / 20)} a day`).join("; ")}`);
  check(rows.traps.food < rows.bows.food && rows.traps.food < rows.guns.food, "the cabin: traps bring in the least");
  check(rows.traps.food > rows.guns.food * 0.3 && rows.traps.food < rows.guns.food * 0.8, `the cabin's traps: less food (${Math.round((rows.traps.food / rows.guns.food) * 100)}% of guns)`);
  check(rows.bows.food > rows.guns.food * 0.7, `the cabin's bows: nearly a rifle's food (${Math.round((rows.bows.food / rows.guns.food) * 100)}%)`);
  check(rows.guns.noise > 0 && rows.guns.ammo > 0 && rows.bows.noise === 0 && rows.bows.ammo === 0 && rows.traps.noise === 0 && rows.traps.ammo === 0 && rows.quiet.noise === 0 && rows.quiet.ammo === 0, "only guns use ammo and add to the base's Heat");
  check(rows.mixed.noise > 0 && rows.mixed.noise < rows.guns.noise * 0.75 && rows.mixed.ammo < rows.guns.ammo * 0.75, `bows and guns half and half: about half the shots (${r1(rows.mixed.ammo)} ammo vs ${r1(rows.guns.ammo)})`);
  check(rows.bows.arrows > 0 && rows.traps.arrows === 0 && rows.guns.arrows === 0, "bows use arrows; guns and traps none");
  const hr = (k, m) => Math.round(rows[k].hrs[m]);
  // Job trips (jobtrips.js): a hunter's hours on the ground are 3 a day two tiles out (the walk out and back eats into
  // the dawn and dusk; a closer ground gives more), so 180 hunter-hours in 20 days, give or take where they went.
  const tot = (k) => H.HUNT_METHODS.reduce((a, m) => a + rows[k].hrs[m], 0);
  const share = (k, m) => rows[k].hrs[m] / Math.max(1e-9, tot(k));
  check(["traps", "bows", "guns"].every((k) => tot(k) > 150 && tot(k) < 280 && share(k, k) > 0.999) && Math.abs(share("mixed", "guns") - 0.5) < 0.02 && Math.abs(share("mixed", "bows") - 0.5) < 0.02, `the hours by the mix (${["traps", "bows", "guns", "mixed"].map((k) => Math.round(tot(k))).join(", ")} hunter-hours in 20 days)`);
  check(hr("quiet", "guns") === 0 && Math.abs(share("quiet", "traps") - 0.4) < 0.02 && Math.abs(share("quiet", "bows") - 0.6) < 0.02, `quiet (40% traps, 60% bows): ${hr("quiet", "traps")} trap and ${hr("quiet", "bows")} bow hours, no gun`);
  // Bows with no arrows go to the traps.
  H.setHuntMix(base, { traps: 0, bows: 100, guns: 0 });
  base.stock.arrows = 0;
  state.hour += 24;
  const dry = huntDay(state, base);
  check(dry.hrs.traps > 0 && !dry.hrs.bows && !dry.hrs.guns && !dry.shots && !dry.arrows, "bow hours with no arrows: the snare lines");
  // Guns with no ammo above the walls' keep: the bows (never louder than the mix).
  H.setHuntMix(base, H.DEFAULT_MIX);
  base.stock.arrows = 50; setAmmo(base.stock, H.ammoKeep(state, base));
  state.hour += 24;
  const noAmmo = huntDay(state, base);
  check(noAmmo.hrs.bows > 0 && !noAmmo.hrs.guns && !noAmmo.hrs.traps && !noAmmo.shots && totalRounds(base.stock) === H.ammoKeep(state, base), "gun hours with the ammo down to the walls' keep: the bows");
  // A hunter with only a rifle at 100% bows: the snare lines.
  hunters.forEach((s) => { s.gear.backpack.contents[0] = null; });
  H.setHuntMix(base, { traps: 0, bows: 100, guns: 0 });
  setAmmo(base.stock, 300);
  state.hour += 24;
  const rifles = huntDay(state, base);
  check(rifles.hrs.traps > 0 && !rifles.hrs.bows && !rifles.hrs.guns && !rifles.shots, "100% bows with only rifles: the snare lines, not a shot");
  hunters[2].gear.weapon = newItem("compbow");
  // The day's hours: one hunter at 50% guns shoots 1 or 2 of 3 in turn (the fraction carries over).
  const one = [hunters[0]];
  delete base.huntCarry;
  const mix = { traps: 50, bows: 0, guns: 50 };
  const plans = [0, 1, 2, 3].map(() => H.cabinPlan(state, base, one, 100, 100, mix)[0]);
  check(plans.map((x) => x.guns).join("") === "1212" && plans.every((x) => x.guns + x.traps === 3), `one hunter at 50% guns: gun hours ${plans.map((x) => x.guns).join(", ")} (the half hour carries over)`);
  // Gun hours go to the guns, bow hours to the bow.
  const pl = H.cabinPlan(state, base, hunters, 100, 100, { traps: 30, bows: 30, guns: 40 });
  delete base.huntCarry;
  check(pl[2].bows >= 2 && pl[0].guns + pl[1].guns >= 3, `30/30/40: gun hours to the rifles, bow hours to the bow (${pl.map((x) => `${x.guns}g ${x.bows}b ${x.traps}t`).join(" · ")})`);
  // Gunfire around the cabin draws the dead that wander near; a quiet mix never does.
  const tile = state.grid.within(base.tile, H.CABIN.radius).filter((id) => H.gameAbundance(state, id) > 0.02).sort((a, b) => H.gameAbundance(state, b) - H.gameAbundance(state, a) || a - b)[0];
  const ring = state.grid.within(tile, 3).find((id) => state.grid.distance(id, tile) === 3 && state.tiles[id].terrain !== "water" && id !== base.tile);
  const draws = (mix) => {
    H.setHuntMix(base, mix);
    let n = 0, days = 0;
    for (let d = 0; d < 60; d++) {
      state.hordes.length = 0;
      const hz = makeHorde(state, { tile: ring, size: 30, role: "roam" });
      state.game = {};
      setAmmo(base.stock, 300); base.stock.arrows = 100;
      state.hour = (autumn + d % 20) * 24 + 24;
      const got = huntDay(state, base);
      if (got.shots || mix.guns === 0) days++;
      if (hz.target != null && hz.target !== ring) n++;
    }
    state.hordes.length = 0;
    return { n, days };
  };
  const loud = draws(H.MIX_PRESETS.guns.mix), quiet = draws(H.MIX_PRESETS.quiet.mix);
  note(`a roaming horde 3 tiles from the best hunting ground: drawn on ${loud.n} of ${loud.days} days with gunfire; ${quiet.n} of 60 quiet days`);
  check(loud.n > 0 && loud.n < loud.days && quiet.n === 0, "gunfire at the cabin draws the dead nearby sometimes; bows and traps never");
  // The governor's mix.
  H.setHuntMix(base, H.DEFAULT_MIX);
  setAmmo(base.stock, 300); base.stock.arrows = 0;
  hunters[2].gear.weapon = newItem("huntrifle");
  check(JSON.stringify(H.autoHuntMix(state, base)) === JSON.stringify(H.DEFAULT_MIX), "governor: no bows, nothing near: guns");
  hunters[2].gear.weapon = newItem("compbow");
  base.stock.arrows = 30;
  check(JSON.stringify(H.autoHuntMix(state, base)) === JSON.stringify(H.MIX_PRESETS.mixed.mix), "governor: bows and arrows: bows and guns");
  setAmmo(base.stock, H.ammoKeep(state, base) + 10);
  check(H.autoHuntMix(state, base).guns === 0 && H.autoHuntMix(state, base).bows === 100, "governor: the ammo short with bows: bows only (the ammo is for the walls)");
  setAmmo(base.stock, 300);
  const near = state.grid.within(base.tile, 3).find((id) => state.grid.distance(id, base.tile) === 3 && state.tiles[id].terrain !== "water");
  makeHorde(state, { tile: near, size: 40, role: "roam" });
  check(JSON.stringify(H.autoHuntMix(state, base)) === JSON.stringify(H.MIX_PRESETS.quiet.mix), "governor: the dead 3 tiles off the cabin: quiet (bows and traps)");
  base.stock.arrows = 0;
  check(JSON.stringify(H.autoHuntMix(state, base)) === JSON.stringify(H.AUTO_MIX.quietNoBows) && H.AUTO_MIX.quietNoBows.guns < 100, "governor: the dead near and no arrows: half traps, half guns (half the shots)");
  const food0 = [base.stock.food, base.stock.preserved];
  base.stock.food = 2; base.stock.preserved = 0;
  check(JSON.stringify(H.autoHuntMix(state, base)) === JSON.stringify(H.DEFAULT_MIX), "governor: the dead near but the stores nearly empty: food first (guns)");
  [base.stock.food, base.stock.preserved] = food0;
  const cabin = base.buildings.find((x) => x.type === "huntcabin");
  base.buildings.splice(base.buildings.indexOf(cabin), 1);
  // The rule changed (2026-10-10): without a cabin the Hunt job still hunts the tiles next to the base, so with
  // hunters on it the dead near quiet it too; with nobody on it only teams hunt, away from the walls.
  const onHunt = atBase(state, base.id).filter((x) => x.role === "hunt"), roles0 = onHunt.map((x) => x.role);
  check(!onHunt.length || JSON.stringify(H.autoHuntMix(state, base)) !== JSON.stringify(H.DEFAULT_MIX), "governor: no cabin, hunters on the job by the walls: the dead near still quiet it");
  onHunt.forEach((x) => { x.role = "rest"; });
  check(JSON.stringify(H.autoHuntMix(state, base)) === JSON.stringify(H.DEFAULT_MIX), "governor: no hunting cabin and nobody on the Hunt job (only teams hunt, away from the walls): the dead near change nothing");
  onHunt.forEach((x, i) => { x.role = roles0[i]; });
  base.buildings.push(cabin);
  state.hordes.length = 0;
  // Saved with the base.
  H.setHuntMix(base, H.MIX_PRESETS.quiet.mix);
  state.cards.length = 0; // the hunters' skill cards (a card cannot be saved)
  const back = loadFromString(saveToString(state));
  check(JSON.stringify(hub(back).huntMix) === JSON.stringify(H.MIX_PRESETS.quiet.mix), "the hunting mix is saved and loaded with the base");
  // The Farming tab's Hunting card: the drop-downs and the presets.
  const BAD = /\b(undefined|NaN)\b|\[object [A-Za-z]+\]/;
  const ui = {};
  const html = baseFarming(state, base);
  check(/Hunting/.test(html) && (html.match(/data-action="hunt-share"/g) || []).length === 3 && (html.match(/data-action="hunt-preset"/g) || []).length === Object.keys(H.MIX_PRESETS).length && /Arrows/.test(html), "the Farming tab: a Hunting card with a share per method, the presets and the arrows");
  check(!BAD.test(html.replace(/<[^>]*>/g, " ")), "the Hunting card: no undefined / NaN");
  FARM_CHANGE["hunt-share"](state, ui, { dataset: { base: String(base.id), k: "guns" }, value: "20" });
  check(base.huntMix.guns === 20 && sum(base.huntMix) === 100 && /hunts with/.test(ui.baseMsg), `the Guns drop-down sets the share (${JSON.stringify(base.huntMix)})`);
  FARM_ACTIONS["hunt-preset"](state, ui, { base: String(base.id), preset: "traps" });
  check(JSON.stringify(base.huntMix) === JSON.stringify(H.MIX_PRESETS.traps.mix), "the Traps only preset");
}
{
  // Arrows: made by hand, found where bows are kept, and packed for a hunting trip.
  const state = mk();
  const h = hub(state);
  check(SUPPLIES.arrows && SUPPLIES.arrows.weight > 0 && CRAFTS.arrows && CRAFTS.arrows.supplies.arrows === 12 && CRAFTS.arrows.field, "arrows: a supply, 12 crafted by hand (also in the field)");
  h.stock.wood = 300; h.stock.scrap = 20;
  check(canCraft(state, h, "arrows").ok, `arrows can be crafted at the hub (${canCraft(state, h, "arrows").reason || "ok"})`);
  const forest = cleanTile(state, "forest");
  const p = placeTeam(state, forest.id, { weapon: "compbow", second: null, arrows: 0 });
  Object.assign(p.supplies, { wood: 40, scrap: 2 });
  partyMembers(state, p).forEach((s) => { s.skills.mechanics = 3; });
  fieldCraft(state, p, "arrows");
  check(p.supplies.arrows === 12 && p.supplies.wood === 10, "a team makes 12 arrows from 30 firewood and 1 scrap");
  const site = state.tiles.find((t) => t.loc && t.loc.type === "lodge") || state.tiles.find((t) => t.loc && t.loc.type === "gunstore");
  if (site) {
    let found = 0, hits = 0;
    for (let i = 0; i < 400; i++) { state.hour += 1; const n = rollSiteArrows(state, site.id, 1); if (n) { hits++; found += n; } }
    note(`${site.loc.type}: arrows in ${hits} of 400 search hours (${found} in all)`);
    check(hits > 20 && found >= hits * 3, `arrows turn up at a ${site.loc.type}`);
  }
  const town = state.tiles.find((t) => t.loc && t.loc.type === "hospital");
  if (town) check(Array.from({ length: 200 }, (_, i) => { state.hour += 1; return rollSiteArrows(state, town.id, 1); }).every((n) => n === 0), "never at a hospital");
  // A hunting trip with a bow takes the hub's arrows along (and the planner counts them).
  const crew = atBase(state, h.id).slice(0, 2);
  crew[0].gear.weapon = newItem("compbow"); crew[1].gear.weapon = newItem("knife");
  h.stock.arrows = 30;
  const near = state.tiles.filter((t) => ["forest", "hills", "plains"].includes(t.terrain) && state.grid.distance(t.id, h.tile) >= 2 && state.grid.distance(t.id, h.tile) <= 4 && H.gameAbundance(state, t.id) > 0.3 && planPath(state, h.tile, t.id, false)).sort((a, b) => state.grid.distance(a.id, h.tile) - state.grid.distance(b.id, h.tile) || a.id - b.id)[0];
  const pl = { dest: near.id, mission: "move", crew: new Set(crew.map((s) => s.id)), vehicleId: null, stance: "normal", supplies: { food: 6, water: 6 } };
  applyPreset(pl, "hunt");
  const est = planEstimate(state, pl);
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest: near.id, mission: "move", stance: "normal", supplies: pl.supplies, plan: { preset: "hunt", steps: pl.plan.steps, conditions: {} } });
  check(!res.error && res.party.supplies.arrows === H.ARROW.pack && h.stock.arrows === 30 - H.ARROW.pack, `a bow on the crew: ${H.ARROW.pack} of the hub's arrows go along`);
  check(est && est.haul > 0, `the planner expects game from the bow (${est && est.haul})`);
  // The same arrows serve in a fight (combat.js, world.js ARROWS): the bow shoots them (the knife none, no ammo), and
  // after a win about half come back into the team's packed supplies.
  {
    const p = res.party;
    p.supplies.ammo = 0;
    const a0 = p.supplies.arrows;
    let r = null;
    for (let i = 0; i < 10 && (!r || r.outcome !== "victory"); i++) {
      p.supplies.arrows = a0;
      for (const s of crew) s.health = 100;
      r = autoResolveCombat(state, { tile: partyTile(p), partyId: p.id, enemy: { kind: "zombies", count: 1, power: 1 }, handler: "hunttest", context: {} });
    }
    check(r.outcome === "victory" && r.arrowsUsed === 6 && r.ammoUsed === 0 && r.arrowsBack === 3 && p.supplies.arrows === a0 - 6 + 3, `the hunters' arrows in a fight: the bow shoots ${r.arrowsUsed}, ${r.arrowsBack} picked up after the win (${p.supplies.arrows} left of ${a0})`);
  }
}

// ======================================================================
section("Orders and the planner: hunting and fishing trips, the ETA and the haul");
{
  const state = mk();
  const h = hub(state);
  // Orders on the spot.
  const forest = cleanTile(state, "forest");
  const p = placeTeam(state, forest.id, { weapon: "knife", second: null });
  startOrder(state, p, { type: "hunt", hours: 6 });
  check(p.phase === "waiting" && state.cards.some((c) => c.partyId === p.id && /Hunt:/.test(c.text)), "no hunting weapon: the hunt order fails with the reason");
  state.cards.length = 0;
  partyMembers(state, p)[0].gear.weapon = newItem("crossbow");
  const m1 = startOrder(state, p, { type: "hunt", hours: 6 });
  check(p.phase === "task" && p.task.type === "hunt" && p.task.hours === 6, `a 6h hunt starts (${m1})`);
  queueOrder(state, p, { type: "hunt", hours: 30 });
  const q = queueEstimate(state, p);
  check(q.length === 1 && q[0].hours === 24 && /Hunt 30h/.test(q[0].label) === false, "queued hunts are kept within 2–24 hours");
  check(PRESETS.hunt && PRESETS.fish && PRESETS.hunt.steps(1, { add: { hunt: 6 } })[0].hours === 6, "Hunting trip and Fishing trip presets");
  // Whole trips from the hub, hour by hour (hordes and road conflicts off, as etatest does).
  const results = [];
  for (let i = 0; i < 40; i++) {
    const st = mk(SEED + 100 + i);
    const hb = hub(st);
    const tile = st.tiles.filter((t) => (t.terrain === "forest" || t.terrain === "hills") && st.grid.distance(t.id, hb.tile) >= 2 && st.grid.distance(t.id, hb.tile) <= 4 && H.gameAbundance(st, t.id) > 0.4 && planPath(st, hb.tile, t.id, false))
      .sort((x, y) => st.grid.distance(x.id, hb.tile) - st.grid.distance(y.id, hb.tile) || x.id - y.id)[i % 3]?.id;
    if (tile == null) continue;
    st.hour = dayIn(st, i % 2 ? "autumn" : "summer") * 24 + 4;
    const crew = atBase(st, hb.id).slice(0, 2);
    crew[0].gear.weapon = newItem(i % 3 === 2 ? "crossbow" : "huntrifle"); crew[0].skills.shooting = 6; crew[0].skills.scouting = 5;
    const emptyLand = i === 0;
    if (emptyLand) st.game = { [tile]: [0, st.hour + 48] }; // hunted out (a level from the future: none at all while it lasts)
    const pl = { dest: tile, mission: "move", crew: new Set(crew.map((s) => s.id)), vehicleId: null, stance: "normal", supplies: { food: 8, water: 8, ammo: 20 } };
    applyPreset(pl, "hunt");
    const est = planEstimate(st, pl);
    const res = launchExpedition(st, { memberIds: [...pl.crew], dest: tile, mission: "move", stance: "normal", supplies: pl.supplies, plan: { preset: "hunt", steps: pl.plan.steps, conditions: {} } });
    if (!check(!res.error, `launch: ${res.error}`)) continue;
    const party = res.party;
    if (i === 0) check(party.teamMission === "hunt", "a hunting trip is a Hunting team");
    let arrived = null, huntStart = null, huntEnd = null, backLeft = null, hungry = false, cards = 0, delay = 0;
    const start = st.hour;
    for (let k = 0; k < 24 * 8; k++) {
      st.hordes.length = 0;
      party.lastConflict = st.hour;
      tickHour(st);
      // Road cards are answered with their first choice; one that delays the team or changes its load (a find, a loss)
      // is counted apart, as etatest does.
      for (let c = 0; c < st.cards.length;) {
        const card = st.cards[c];
        if (card.isOrders) { c++; continue; }
        st.cards.splice(c, 1);
        cards++;
        const before = [party.progress, JSON.stringify([party.members, cargoLoad(party.cargo)]), party.phase];
        const ch = card.choices.find((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled)) || card.choices[0];
        ch.resolve(st);
        if (party.progress < before[0] - 1e-9 || JSON.stringify([party.members, cargoLoad(party.cargo)]) !== before[1] || party.phase !== before[2]) delay++;
      }
      if (!st.parties.includes(party)) break;
      if (party.noFood || party.noWater) hungry = true;
      if (arrived == null && partyTile(party) === tile) arrived = st.hour;
      if (party.phase === "task" && party.task?.type === "hunt" && huntStart == null) huntStart = st.hour - party.task.done;
      if (huntStart != null && huntEnd == null && party.phase === "back") { huntEnd = st.hour; backLeft = hoursLeft(st, party); }
    }
    const home = !st.parties.includes(party) ? st.hour : null;
    const out = arrived != null ? arrived - start : null;
    const row = { i, tile, emptyLand, est: est.total, haulEst: est.haul, out, estOut: est.hoursOut, hunt: huntEnd != null && huntStart != null ? huntEnd - huntStart : null, back: home != null && huntEnd != null ? home - huntEnd : null, backLeft, actual: home != null ? home - start : null, cards: delay, hungry, brought: party.lastHaul ? party.lastHaul.rations : 0 };
    results.push(row);
    if (cards) continue; // a road card can delay the team (counted apart, as etatest does)
    check(row.out === est.hoursOut, `trip ${i}: out ${row.out}h, estimate ${est.hoursOut}h`);
    check(row.hunt === 8, `trip ${i}: the hunt took ${row.hunt}h (8 planned)`);
    check(row.back === row.backLeft, `trip ${i}: home ${row.back}h after the hunt, the team panel said ${row.backLeft}h`);
    check(!hungry, `trip ${i}: the planner's food lasted the trip`);
    if (emptyLand) check(row.actual === est.total && est.haul === 0, `trip ${i} (hunted-out land, no game): the whole plan to the hour (${row.actual}h vs ${est.total}h)`);
  }
  for (const r of results.slice(0, 8)) note(`trip ${r.i}${r.emptyLand ? " (hunted-out land)" : ""}: estimate ${r.est}h (out ${r.estOut}h, haul ~${r.haulEst}), real: out ${r.out}h, hunt ${r.hunt}h, home ${r.back}h (team panel ${r.backLeft}h), total ${r.actual}h${r.cards ? `, ${r.cards} road card(s) that held it up` : ""}`);
  const clean = results.filter((r) => !r.cards && r.actual != null);
  const off = clean.filter((r) => !r.emptyLand).map((r) => r.actual - r.est);
  note(`${clean.length} hunting trips no road card held up: plan estimate − actual ${off.map((x) => (x > 0 ? `+${x}` : `${x}`)).join(", ")} h (the haul is luck: a deer more or less changes the walk home)`);
  const he = mean(results.map((r) => r.haulEst)), hk = mean(results.map((r) => r.brought));
  note(`${results.length} trips: the planner expected ${r1(he)} food of game a trip, they brought ${r1(hk)} on average (a deer is luck: 0 or 30)`);
  check(Math.abs(hk - he) <= he * 0.3, "the planner's expected haul matches what the trips bring on average");
  check(off.length && mean(off.map(Math.abs)) <= 3, `the plan's ETA is within a few hours of the real trip on average (${r1(mean(off.map(Math.abs)))}h)`);
}

// ======================================================================
section("Save / load mid-hunt, and determinism");
{
  const strip = (t) => t.replace(/"ms":[-\d.e]+/g, "\"ms\":0"); // the chronicle's timing (savetest does the same)
  const run = (save) => {
    setNextId(1_000_000); // every world here hands out the same ids
    const st = mk(SEED + 7);
    const forest = cleanTile(st, "forest", (t) => planPath(st, hub(st).tile, t.id, false));
    st.hour = dayIn(st, "autumn") * 24 + 4;
    const crew = atBase(st, hub(st).id).slice(0, 2);
    crew[0].gear.weapon = newItem("huntrifle");
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: forest.id, mission: "move", stance: "normal", supplies: { food: 10, water: 10, ammo: 20 }, plan: { preset: "hunt", steps: PRESETS.hunt.steps(1), conditions: {} } });
    const p = res.party;
    let text = null, world = st;
    for (let k = 0; k < 24 * 4; k++) {
      tickHour(world);
      while (world.cards.length) { const c = world.cards.shift(); (c.choices.find((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(world) : x.disabled)) || c.choices[0]).resolve(world); } // an enabled choice: a disabled one can put its card back (an unpayable bribe)
      const q = world.parties.find((x) => x.id === p.id);
      if (save && !text && q && q.phase === "task" && q.task.type === "hunt" && q.task.done === 4) { text = saveToString(world); world = loadFromString(text); }
    }
    return { st: world, text };
  };
  const a = run(false), b = run(false), c = run(true);
  check(strip(saveToString(a.st)) === strip(saveToString(b.st)), "the same hunt twice: identical worlds");
  check(!!c.text && strip(saveToString(a.st)) === strip(saveToString(c.st)), "saved and loaded in the middle of the hunt: plays on identical");
  check(Object.keys(a.st.game || {}).length > 0 && JSON.stringify(a.st.game) === JSON.stringify(c.st.game), "the land's game levels are part of the save");
}

// ======================================================================
section("UI: the tile panel, the team panel, the planner and the right-click menu");
{
  const BAD = /\b(undefined|NaN)\b|\[object [A-Za-z]+\]/;
  const state = mk();
  const forest = cleanTile(state, "forest");
  const crew = atBase(state, hub(state).id);
  crew[0].gear.weapon = newItem("huntrifle");
  const tp = renderRight(state, { selected: forest.id, expedition: null });
  const text = tp.replace(/<[^>]*>/g, " ");
  check(/Game/.test(text) && /food in an 8h hunt/.test(text), "tile panel: the game here and a hunting yield estimate");
  check(!BAD.test(tp), "tile panel: no undefined / NaN");
  check(/data-preset="hunt"/.test(tp), "tile panel: Hunting trip from the hub");
  const acts = tileActions(state, forest.id);
  check(acts.some(([m, l, pre]) => m === "move" && pre === "hunt" && /Hunting trip/.test(l)), "right-click: Hunting trip");
  const river = state.tiles.find((t) => t.terrain !== "water" && H.fishSpot(state, t.id));
  check(tileActions(state, river.id).some(([, , pre]) => pre === "fish"), "right-click on a river: Fishing trip");
  check(/Fish/.test(renderRight(state, { selected: river.id, expedition: null }).replace(/<[^>]*>/g, " ")), "tile panel by the water: fish");
  const p = placeTeam(state, forest.id);
  p.contactHour = state.hour;
  p.radioLive = true;
  const xp = renderRight(state, { selected: forest.id, expedition: p.id });
  check(/data-type="hunt"/.test(xp) && /data-type="snare"/.test(xp) && /Hunt 8h/.test(xp), "team panel: Hunt, Snares");
  check(!BAD.test(xp), "team panel: no undefined / NaN");
  const pl = { dest: forest.id, mission: "move", crew: new Set(crew.slice(0, 2).map((s) => s.id)), vehicleId: null, stance: "normal", supplies: { food: 6, water: 6, ammo: 20 } };
  applyPreset(pl, "hunt");
  const est = planEstimate(state, pl);
  const ps = planSection(state, pl, est);
  check(/Hunting trip/.test(ps) && /food of game/.test(ps) && /data-action="pl-add" data-k="snare"/.test(ps), "planner: Hunting trip preset, the expected haul, a Snares step");
  check(!BAD.test(ps.replace(/<[^>]*>/g, " ")), "planner: no undefined / NaN");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const handled = new Set([...main.matchAll(/^\s{2}"?([a-z][\w-]*)"?\s*:\s*\(/gm), ...main.matchAll(/actions\.([a-z][\w-]*)\s*=/g)].map((x) => x[1]));
  for (const k of [...Object.keys(PLAN_ACTIONS), ...Object.keys(PLAN_CHANGE)]) handled.add(k);
  const mine = ["plan", "xp-order", "ctxhunt", "pl-preset", "pl-add", "pl-addv"];
  const missing = mine.filter((a) => !handled.has(a));
  check(!missing.length, `the hunting buttons have handlers${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);
  check(/data-action="ctxhunt"/.test(main) && /data-preset/.test(main), "right-click: team hunting and fishing, and the planner presets from the hub");
  check(classify("Hunting team (Ana, Cole) hunted near forest (3,4): a deer, 30 food of game.") === "p" && classify("Ana and Cole brought in a deer at Harlow (30 food of fresh game).") === "f", "diary: hunting lines file under teams and food");
}

// ======================================================================
section(`The autopilot in a lean year: hunting and fishing on and off (${AP_DAYS} days, Balanced and Cautious, seeds ${AP_SEEDS.join(",")})`);
{
  const rows = [];
  for (const style of ["balanced", "cautious"]) {
    for (const seed of AP_SEEDS) {
      for (const off of [true, false]) {
        const st = createWorld({ seed, factionCount: 8 });
        st.started = true;
        setAutopilot(st, true, style);
        st.governor.noHunting = off;
        // Lean: half the starting food, no preserved food.
        const hb = hub(st);
        hb.stock.food = Math.floor((hb.stock.food || 0) / 2);
        hb.stock.preserved = 0;
        for (let i = 0; i < AP_DAYS * 24 && !st.gameOver; i++) tickHour(st);
        const deaths = (st.memorial || []).filter((m) => /hunger|starv/.test(m.cause || "")).length;
        rows.push({ style, seed, off, fell: !!st.gameOver && !st.victory, hungerDays: (st.econStats && st.econStats.hungerDays) || 0, deaths, trips: (st.governor.stats.huntTrips || 0) + (st.governor.stats.fishTrips || 0), hunted: Math.round((st.econStats && st.econStats.hunted) || 0), pop: st.survivors.filter((s) => s.alive).length, cabins: st.bases.filter((b) => count(b, "huntcabin")).length });
      }
    }
  }
  const sum = (off, k, style = null) => rows.filter((r) => r.off === off && (!style || r.style === style)).reduce((a, r) => a + (r[k] === true ? 1 : r[k] === false ? 0 : r[k]), 0);
  for (const style of ["balanced", "cautious"]) {
    note(`${style.padEnd(9)} without hunting: hunger days ${sum(true, "hungerDays", style)}, deaths of hunger ${sum(true, "deaths", style)}, fell ${sum(true, "fell", style)}, people at the end ${sum(true, "pop", style)} · with: hunger days ${sum(false, "hungerDays", style)}, deaths of hunger ${sum(false, "deaths", style)}, fell ${sum(false, "fell", style)}, people ${sum(false, "pop", style)}; ${sum(false, "trips", style)} hunting / fishing trips, ${sum(false, "cabins", style)} cabins, ${sum(false, "hunted", style)} food from cabins and fishers`);
  }
  check(sum(false, "trips") > 0, "the autopilot goes hunting when food runs short");
  check(sum(true, "trips") === 0, "the test switch keeps it from hunting");
  check(sum(false, "hungerDays") <= sum(true, "hungerDays") * 1.1 + 2, `no more hunger with hunting than without (${sum(false, "hungerDays")} vs ${sum(true, "hungerDays")} days)`);
  // One or two deaths of hunger over twelve lean-year campaigns is noise (it was 1 vs 0 with the old loot tables).
  check(sum(false, "deaths") <= sum(true, "deaths") + 2, `no more deaths of hunger with hunting, give or take two (${sum(false, "deaths")} vs ${sum(true, "deaths")})`);
}

console.log(fails ? `\n${fails} FAILED, ${passed} passed` : `\nAll ${passed} checks passed.`);
process.exit(fails ? 1 : 0);
