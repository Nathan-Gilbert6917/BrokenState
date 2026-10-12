// Field works (src/sim/fieldworks.js; the base window's Field works tab in src/ui/fieldworks.js): scripted cases on one
// seed. Usage: node tools/fieldworkstest.js [seed]  (a few seconds)
// - placing: the rules (the base's land within 3 tiles, not the base, water, a hive or a group's base; roadblocks on
//   roads; wells not on rock; the base's cap; the materials and the skill), the materials taken, the site and its job
// - building: the builders walk out (the hours include the walk), sharing their hours with the base's own queue;
//   a tower stands
// - the tower: unmanned it shows nothing; one lookout posted (out of the base: not atBase, still a resident) shows
//   3 tiles round it by day, 1 at night, dark 22:00–06:00 alone, round the clock with two; recall brings them home
// - lookouts warn the base (watch.js lookoutsSpot) of a raid in the tower's sight
// - a stockpile: deposits up to its room, Leave finds / Load orders, a haul team brings it home
// - a roadblock holds a raiding party (progress back, the roadblock takes the damage) and a horde (h.move back)
// - a horde batters and destroys a structure; the lookouts flee a falling tower
// - a group's raid on a structure: drives it off with lookouts, or takes it over; your team takes it back (fwork)
// - repairs: materials by kind and damage, the walk, refused when short, Repair all; the needs-repair band
// - a field well's water in waterProduction (field) and drawn down; a relay mast links into radioNodes
// - the groups build their own (groupFieldDaily); their towers add to their defence; the governor plans a well
//   when water runs short and repairs; save/load round-trips everything (posted people included); an older save
//   with no state.fieldworks loads and runs
// - shifts (2026-10-10 fieldworks-plus): lookouts and guards on a tower's or roadblock's shifts walk out (early by the
//   walk), stand it and come home; coverage gaps; a night shift keeps them up; presets; an old save's posting moves on
// - roadblock guards hold longer and shoot back (winOdds), run when beaten; spike traps; a hunting blind (the hunters'
//   game hook); a snare line (catch, check, rot, robbery, a team's check); a fuel cache (restock, draw, hidden);
//   the standing haul order; the groups' stockpiles and caches, their raids on each other's structures; the
//   governor's roadblock on a raid road and stockpile by far crews; Help and the codex
// - hc-food (2026-10-11): the snare line as field craft: 2 scrap and an hour, no builders needed, at a camp on a tile
//   next to it nobody holds, its own cap outside the field works', paid with a coil of snare wire from the armory or
//   the scrap gathered for a step up, checked by anyone fit with no hunter home; the governor's lines (hardcore from
//   the start, more while food is short; one field job at a time) and the groups' (wanted first, ready the next day)
// - WORLD-02 (2026-10-12): your snare line is set by a team sent to the tile and only a team checking it finds out what
//   it holds (no morning check from home, no news of a robbery); one of the dead caught in it (under 10% a day) keeps
//   the game away until the team puts it down; a standing check sends a team on its day; across a river with no bridge
//   near, the team crosses by boat (the scrap for both boats from the base, refused without it)
import { createWorld, tickHour, hub, atBase, residents, newId, liveTiles, baseVision, day, outOnTrip, homeAt } from "../src/sim/world.js";
import { launchExpedition, partyTile, carried, outpostName, spawnAiParty } from "../src/sim/parties.js";
import { queueOrder, startOrder } from "../src/sim/orders.js";
import { makeHorde } from "../src/sim/hordes.js";
import { recomputeOwnership } from "../src/sim/factions.js";
import { radioNodes } from "../src/sim/radio.js";
import { waterProduction, fetchWaterTile } from "../src/sim/economy.js";
import { TRIP_HOOKS, waterSources } from "../src/sim/tripland.js"; // the job trips' hooks (installed at load by fieldworks.js)
import { lookoutsSpot } from "../src/sim/watch.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import * as FW from "../src/sim/fieldworks.js";
import { wellYield } from "../src/sim/claims.js";
import { createVehicle } from "../src/sim/vehicles.js";
import { startWar } from "../src/sim/diplomacy.js";
import { huntTripTile, gameAbundance, expectHunt, SNARE, snareZombieChance } from "../src/sim/hunting.js";
import { crossingsFrom } from "../src/sim/crossing.js";
import { fieldworkAlerts } from "../src/ui/fieldworks.js";
import { food, setFood, clearFood, addDays } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { LAYERS } from "../src/sim/markers.js";
import { distFactor, tileGameMult } from "../src/sim/tripland.js";
import { codexEntry } from "../src/ui/codex.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) { passed++; if (process.env.V) console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 7 });
  state.started = true;
  state.autoCombat = true;
  state.noWanderers = true;
  Object.assign(hub(state).stock, { food: 300, water: 300, fuel: 100, meds: 20, ammo: 300, parts: 10, scrap: 200, wood: 2000 });
  for (const f of state.factions) f.goodwill = Math.max(f.goodwill, 0); // nobody raids the tests by chance
  return state;
}
const dropEvents = (state) => { for (let i = state.cards.length - 1; i >= 0; i--) if (!state.cards[i].isOrders) state.cards.splice(i, 1); };
function tick(state, n, until, keepHordes = false) {
  for (let i = 0; i < n; i++) {
    if (!keepHordes) state.hordes.length = 0;
    tickHour(state);
    if (state.combat) state.combat = null;
    dropEvents(state);
    if (until && until()) return true;
  }
  return !until;
}
const toHour = (state, h) => { while (state.hour % 24 !== h) tick(state, 1); };
// The hub's builders: two people on the Build job.
function builders(state, n = 2) {
  const ppl = atBase(state, hub(state).id);
  for (const s of ppl.slice(0, n)) s.role = "build";
  return ppl.slice(0, n);
}
// A tile of the hub's land at distance d that can take this kind.
const spot = (state, kind, d = 2, extra = () => true) => FW.placeTiles(state, hub(state), kind).find((x) => !x.why && state.grid.distance(hub(state).tile, x.tile) === d && extra(x.tile));
// A structure finished at once (its job done): for the cases that do not test building.
function standing(state, kind, d = 2, extra) {
  const at = spot(state, kind, d, extra) || spot(state, kind, 1, extra) || spot(state, kind, 3, extra);
  if (!at) return null;
  const r = FW.planFieldWork(state, hub(state), kind, at.tile);
  if (kind === "snares") { tick(state, 48, () => r.fw.built); return r.fw; } // a team walks out and sets it (WORLD-02)
  const job = FW.jobFor(state, r.fw);
  job.progress = job.hours;
  builders(state, 1);
  FW.fieldBuildHour(state, hub(state)); // finishes it (the base queue is empty)
  return r.fw;
}

// ---------------------------------------------------------------------------------------------------------
section("Placing: the rules, the materials, the site");
{
  const state = mk();
  const h = hub(state);
  check(/outside the base/.test(FW.placeProblem(state, h, "tower", h.tile)), "not on the base's own tile");
  const water = state.grid.within(h.tile, 3).find((id) => state.tiles[id].terrain === "water");
  if (water != null) check(/water/i.test(FW.placeProblem(state, h, "tower", water)), "not on open water");
  const far = state.tiles.find((t) => state.grid.distance(t.id, h.tile) === 6 && t.terrain !== "water");
  check(/Too far|land you hold/.test(FW.placeProblem(state, h, "tower", far.id)), `far away: "${FW.placeProblem(state, h, "tower", far.id)}"`);
  const notMine = state.grid.within(h.tile, 3).find((id) => state.grid.distance(id, h.tile) === 3 && state.tiles[id].terrain !== "water" && state.tiles[id].owner !== "player");
  if (notMine != null) check(/land you hold/.test(FW.placeProblem(state, h, "tower", notMine)), "beyond the base's ground (3 tiles from the hub, no claim): refused");
  const offRoad = FW.placeTiles(state, h, "roadblock").find((x) => !state.tiles[x.tile].road);
  if (offRoad) check(/road tile/.test(offRoad.why), "a roadblock off the road: refused");
  const tiles = FW.placeTiles(state, h, "tower");
  check(tiles.length >= 6 && tiles.every((x) => state.grid.distance(x.tile, h.tile) <= 2), `the hub's ground: ${tiles.length} tiles within 2 (recomputeOwnership)`);
  const at = spot(state, "tower");
  const scrap0 = h.stock.scrap, wood0 = h.stock.wood;
  const r = FW.planFieldWork(state, h, "tower", at.tile);
  check(!r.error && h.stock.scrap === scrap0 - 15 && h.stock.wood === wood0 - 120, `tower planned: 15 scrap and 120 firewood taken (${r.text || r.error})`);
  check(r.fw && !r.fw.built && FW.fwAt(state, at.tile) === r.fw && /already/.test(FW.placeProblem(state, h, "well", at.tile)), "the site stands on the tile; the tile is taken");
  const job = FW.jobFor(state, r.fw);
  check(job && job.hours === 18 + FW.walkHours(state, h, at.tile, 18), `the job: 18 work-hours + the walk (${job && job.hours} h)`);
  // Cancel untouched: everything back, the site gone.
  const msg = FW.cancelFieldJob(state, job.id);
  check(h.stock.scrap === scrap0 && !FW.fwAt(state, at.tile) && /All the materials/.test(msg), `cancelled untouched: all back (${msg})`);
  // Short of materials: refused.
  h.stock.parts = 0;
  const rt = spot(state, "relay");
  if (rt) check(/Needs 3 parts|Mechanics/.test(FW.placeProblem(state, h, "relay", rt.tile)), `relay with no parts: "${FW.placeProblem(state, h, "relay", rt.tile)}"`);
  h.stock.parts = 10;
  // The cap.
  const cap = FW.maxWorks(h);
  for (const x of FW.placeTiles(state, h, "stockpile").filter((y) => !y.why).slice(0, cap)) FW.planFieldWork(state, h, "stockpile", x.tile);
  const more = FW.placeTiles(state, h, "stockpile").find((y) => !FW.fwAt(state, y.tile));
  check(FW.playerWorks(state, h).length === cap && more && /all the field works/.test(FW.placeProblem(state, h, "stockpile", more.tile)), `the cap: ${cap} at the hub`);
}

// ---------------------------------------------------------------------------------------------------------
section("Building: the builders go out, the walk counts, the base queue shares their hours");
{
  const state = mk();
  const h = hub(state);
  builders(state, 2);
  const at = spot(state, "tower", 2);
  const r = FW.planFieldWork(state, h, "tower", at.tile);
  const job = FW.jobFor(state, r.fw);
  tick(state, 1);
  const bs = atBase(state, h.id).filter((s) => s.role === "build");
  check(job.progress > 0 && bs.length >= 2 && bs.every((s) => outOnTrip(state, s)) && !homeAt(state, h.id).some((s) => s.role === "build"), "the builders out at the site are away from the walls (world.js outOnTrip: not in a battle at the base)");
  const ok = tick(state, 60, () => r.fw.built);
  check(ok && r.fw.built && r.fw.hp === r.fw.max, `the tower stands after ${state.hour} hours (${job.hours} work-hours with two builders)`);
  check(state.log.some((l) => /Watch tower finished/.test(l.text)), "a log line says so");
  // With a base job queued too: every other hour each.
  const at2 = spot(state, "stockpile", 1);
  const r2 = FW.planFieldWork(state, h, "stockpile", at2.tile);
  h.construction.push({ id: newId(), type: "farm_plot", progress: 0, hours: 100 });
  const j2 = FW.jobFor(state, r2.fw);
  tick(state, 10);
  check(j2.progress > 0 && h.construction[0].progress > 0, `shared: field job ${j2.progress.toFixed(1)} h, base job ${h.construction[0].progress.toFixed(1)} h after 10 hours`);
}

// ---------------------------------------------------------------------------------------------------------
section("The tower: unmanned it sees nothing; lookouts on shifts walk out, watch and come home");
{
  const state = mk();
  const h = hub(state);
  // A tower 2 tiles out, with a tile 3 beyond it that the hub does not see.
  const fw = standing(state, "tower", 2, (id) => state.grid.within(id, 3).some((x) => state.grid.distance(x, h.tile) > baseVision(h)));
  check(!!fw && fw.built, "a tower stands");
  toHour(state, 12);
  const beyond = state.grid.within(fw.tile, 3).find((x) => state.grid.distance(x, h.tile) > baseVision(h) && !state.bases.some((b) => state.grid.distance(b.tile, x) <= baseVision(b)));
  check(beyond != null && !liveTiles(state).has(beyond), "unmanned: a tile 3 from it beyond the hub's view is not live");
  const s = atBase(state, h.id).find((x) => !x.leader);
  s.health = 100; s.conditions = []; s.inBed = false;
  const res = FW.postPerson(state, fw.id, s.id);
  const w = FW.shiftWalk(state, fw);
  check(!res.error && FW.shiftOf(fw, s.id) && FW.shiftOf(fw, s.id).name === "Day" && /day shift \(06–18\)/.test(res.text), `on the roster: the day shift (${res.text || res.error})`);
  check(s.location.kind === "post" && !atBase(state, h.id).includes(s) && residents(state, h.id).includes(s) && FW.outOfBase(s), "the day shift is on: walking out now (out of the base, still fed there)");
  check(!FW.manned(state, fw), `still walking (${w} h): not watching yet`);
  tick(state, w);
  check(FW.manned(state, fw) && liveTiles(state).has(beyond), "there: manned by day, the far tile is live");
  // Off duty at the end of the day shift (18:00): home by 18 + the walk.
  toHour(state, 18 + w);
  check(s.location.kind === "base" && atBase(state, h.id).includes(s) && !FW.manned(state, fw) && !liveTiles(state).has(beyond), "the shift over: home, the tower dark (nobody on the night shift)");
  const cov = FW.shiftCoverage(state, fw);
  check(cov[12].n === 1 && cov[22].n === 0 && FW.shiftLine(state, fw).gaps.length === 1, `coverage: day covered, the night a gap (${FW.shiftLine(state, fw).text})`);
  // A second person on the night shift: round the clock.
  const s2 = atBase(state, h.id).find((x) => !x.leader && x !== s);
  s2.health = 100; s2.conditions = []; s2.inBed = false;
  const r2 = FW.postPerson(state, fw.id, s2.id);
  check(FW.shiftOf(fw, s2.id) && FW.shiftOf(fw, s2.id).name === "Night" && !FW.shiftLine(state, fw).gaps.length, `the second goes on the night shift: covered round the clock (${r2.text || r2.error})`);
  toHour(state, 23);
  const night = state.grid.within(fw.tile, 1).find((x) => state.grid.distance(x, h.tile) > 1);
  check(FW.manned(state, fw) && FW.onDuty(state, fw).includes(s2) && liveTiles(state).has(night) && !liveTiles(state).has(beyond) && s.location.kind === "base", "night: the night lookout watches, 1 tile round it; the day one sleeps at home");
  // The relief: at 06:00 the day lookout is there (left at 06 − walk) and the night one walks home after.
  toHour(state, 6);
  check(FW.onDuty(state, fw).includes(s) && FW.manned(state, fw), "06:00: the day lookout arrived on time (left early by the walk)");
  toHour(state, 6 + w);
  check(s2.location.kind === "base", "the night lookout is home after the walk");
  check((s2.tired || 0) > 0 && (s2.sleepIn || atBase(state, h.id).includes(s2)), `the night shift kept them up (owes ${Math.round(s2.tired || 0)} h; sleeping it off: ${!!s2.sleepIn})`);
  // A full shift refuses a third (2 a shift); the preset changes keep people by name.
  const s3 = atBase(state, h.id).find((x) => !x.leader && x !== s && x !== s2);
  FW.postPerson(state, fw.id, s3.id, 0);
  const s4 = atBase(state, h.id).find((x) => !x.leader && x !== s && x !== s2 && x !== s3);
  check(/holds 2 at most/.test(FW.postProblem(state, fw, s4, 0) || ""), `a third on the day shift: "${FW.postProblem(state, fw, s4, 0)}"`);
  FW.recallPerson(state, s3.id);
  FW.setRosterPreset(state, fw, "three");
  check(fw.roster.shifts.length === 3 && FW.shiftOf(fw, s2.id) && FW.shiftOf(fw, s2.id).name === "Night" && !FW.shiftOf(fw, s.id), "three shifts: the night lookout keeps Night; Day is gone (off the roster)");
  FW.setRosterPreset(state, fw, "two");
  FW.postPerson(state, fw.id, s.id, 0);
  // The lookouts warn the base of a raid in their sight (watch.js lookoutsSpot), even beyond the usual range.
  toHour(state, 12);
  const warnAt = state.grid.within(fw.tile, 3).find((x) => state.grid.distance(x, h.tile) >= 4);
  if (warnAt != null) check(lookoutsSpot(state, h, warnAt, 2) === true, "lookoutsSpot: the tower sees a raid 4+ tiles out");
  // Hurt: they come home and the hour is a gap.
  s.health = 20;
  tick(state, 1);
  check(s.location.kind === "base" && !FW.manned(state, fw) && FW.shiftCoverage(state, fw)[13].n === 0, "badly hurt: home, the day shift a gap");
  s.health = 100; s.conditions = [];
  const line = FW.recallPerson(state, s.id);
  check(!FW.shiftOf(fw, s.id) && s.location.kind === "base", `recalled: off the shifts (${line})`);
  // An older save's permanent posting moves onto the shifts.
  const t2 = standing(state, "tower", 1);
  const old = atBase(state, h.id).find((x) => !x.leader && !FW.rosterOf(state, x.id));
  old.location = { kind: "post", baseId: h.id, fw: t2.id, tile: t2.tile };
  t2.garrison = [old.id];
  delete t2.roster;
  FW.rosterHour(state);
  check(t2.roster && FW.shiftOf(t2, old.id) && FW.shiftOf(t2, old.id).name === "Day", "an older save's posted lookout: on the day shift");
}

// ---------------------------------------------------------------------------------------------------------
section("Stockpile: deposits, a team's Leave finds and Load, the haul team");
{
  const state = mk();
  const h = hub(state);
  const fw = standing(state, "stockpile", 2);
  check(!!fw && fw.built, "a stockpile stands");
  const got = FW.depositAt(state, fw, "scrap", 40);
  check(got === 40 && fw.contents.scrap === 40 && FW.stockKg(fw) === 80, `40 scrap left there (80 kg): ${got}`);
  const big = FW.depositAt(state, fw, "scrap", 200);
  check(big === 60 && FW.stockRoom(fw) < 1, `only its room: 60 more (200 kg cap): ${big}`);
  const drops = FW.dropPointsFor(state, h);
  check(drops.length === 1 && drops[0].fw === fw && drops[0].room < 1, "dropPointsFor lists it with its room");
  fw.contents = { scrap: 30, wood: 300 };
  const scrap0 = h.stock.scrap, wood0 = h.stock.wood;
  const r = FW.sendHaul(state, fw.id);
  check(!r.error && r.party, `a haul team goes out (${r.text || r.error})`);
  const p = r.party;
  const home = tick(state, 72, () => !state.parties.includes(p));
  check(home && !Object.keys(fw.contents).length, `back home, the stockpile empty (${JSON.stringify(fw.contents)})`);
  check(h.stock.scrap >= scrap0 + 30 && h.stock.wood >= wood0 + 300 - 60, `the goods are in the hub's stores (scrap ${scrap0} → ${h.stock.scrap}, wood ${wood0} → ${Math.round(h.stock.wood)})`);
  // A team leaves its finds there, keeping its food, water, meds and ammo.
  const ids = atBase(state, h.id).slice(0, 1).map((s) => s.id);
  const lr = launchExpedition(state, { memberIds: ids, dest: fw.tile, mission: "move", stance: "normal", supplies: { food: 5, water: 5, scrap: 6, parts: 1 } });
  if (lr.error) console.log("  launch:", lr.error);
  const t = lr.party;
  tick(state, 48, () => t.phase === "waiting" && partyTile(t) === fw.tile);
  const msg = startOrder(state, t, { type: "fwork", act: "unload" });
  tick(state, 3, () => t.phase === "waiting");
  check(fw.contents.scrap === 6 && fw.contents.parts === 1 && carried(t, "food") > 0 && carried(t, "scrap") === 0, `Leave finds: scrap and parts left, food kept (${msg}; ${FW.contentsText(fw)})`);
  startOrder(state, t, { type: "fwork", act: "load" });
  tick(state, 3, () => t.phase === "waiting");
  check(!Object.keys(fw.contents).length && carried(t, "scrap") === 6, "Load: all of it back into the team's cargo");
}

// ---------------------------------------------------------------------------------------------------------
section("The job trips' plug-in points (installTripHooks)");
{
  const state = mk();
  const h = hub(state);
  const pile = standing(state, "stockpile", 2);
  const well = standing(state, "well", 2, (id) => FW.placeProblem(state, h, "well", id) === "" && id !== pile.tile);
  const passive0 = FW.FIELD.PASSIVE_WELLS;
  check(passive0 === false && typeof TRIP_HOOKS.water === "function" && typeof TRIP_HOOKS.deposit === "function" && typeof TRIP_HOOKS.draw === "function", "installed at load (fieldworks.js): the job trips' hooks are on, the wells not passive");
  const hooks = { water: null, deposit: null, draw: null };
  FW.installTripHooks(hooks);
  check(FW.FIELD.PASSIVE_WELLS === false, "installed: the wells no longer count by themselves (the carriers bring their water)");
  const list = hooks.water(state, h, "water", [{ id: -1, d: 9 }]);
  check(list.some((x) => x.well && x.id === well.tile) && list[list.length - 1].id === -1, "Fetch water: the well joins the sources, nearest first");
  check(!hooks.water(state, h, "fish", []).length, "fishers get no wells");
  const far = state.grid.within(pile.tile, 1).find((id) => state.grid.distance(id, h.tile) > state.grid.distance(pile.tile, h.tile) - 0 && id !== pile.tile && state.grid.distance(id, pile.tile) < state.grid.distance(id, h.tile));
  const dp = hooks.deposit(state, h, { trip: { at: far } }, "wood");
  check(dp && dp.tile === pile.tile && dp.stock === pile.contents, "a worker out past the stockpile drops the load there");
  check(hooks.deposit(state, h, { trip: { at: h.tile } }, "wood") == null, "one at the base's own tile goes home");
  // No overfill: the stockpile takes up to its room (dp.put), the rest comes home (jobtrips.js credit).
  const roomKg = FW.stockRoom(pile);
  const tookWood = dp.put("wood", 1e6);
  check(tookWood > 0 && FW.stockKg(pile) <= FW.FIELD.KINDS.stockpile.capKg + 0.01 && dp.put("wood", 50) === 0, `a full stockpile takes no more (${Math.round(roomKg)} kg of room took ${Math.round(tookWood)} firewood; ${FW.stockKg(pile)} of ${FW.FIELD.KINDS.stockpile.capKg} kg)`);
  check(hooks.deposit(state, h, { trip: { at: far } }, "wood") == null, "full: the next worker out past it walks home with the load");
  FW.FIELD.PASSIVE_WELLS = passive0;
}

section("Roadblocks hold raiders and hordes");
{
  const state = mk();
  const h = hub(state);
  const fw = standing(state, "roadblock", 2) || standing(state, "roadblock", 1);
  if (!check(!!fw, "a road tile in the hub's land for a roadblock")) { /* map without one */ } else {
    const f = state.factions.find((x) => x.alive && x.bases.length);
    f.goodwill = -60;
    const p = spawnAiParty(state, f, "raid", f.bases[0], h.tile, { strength: 12, target: { kind: "player", baseId: h.id } });
    // Put it just before the roadblock on a path through it.
    const nb = state.grid.neighbors(fw.tile).find((id) => state.tiles[id].terrain !== "water" && id !== h.tile);
    p.path = [nb, fw.tile, h.tile]; p.idx = 0; p.progress = 0;
    const hp0 = fw.hp;
    FW.partyEnter(state, p, fw.tile);
    check(p.progress < -1 && fw.hp < hp0 && FW.fwById(state, fw.id), `a raid held ${(-p.progress).toFixed(1)} hours; roadblock ${hp0} → ${fw.hp}`);
    state.parties.splice(state.parties.indexOf(p), 1);
    fw.hp = fw.max;
    const ho = makeHorde(state, { tile: fw.tile, size: 40, role: "roam" });
    ho.move = 0;
    FW.hordeEnter(state, ho);
    check(ho.move < 0 && fw.hp < fw.max, `a horde of 40 held ${(-ho.move).toFixed(1)} hours; roadblock at ${fw.hp}`);
    // A friendly party passes.
    f.goodwill = 50;
    const q = spawnAiParty(state, f, "caravan", f.bases[0], h.tile, { strength: 5 });
    q.progress = 0;
    const hp1 = fw.hp;
    FW.partyEnter(state, q, fw.tile);
    check(q.progress === 0 && fw.hp === hp1, "a friendly caravan passes untouched");
  }
}

// ---------------------------------------------------------------------------------------------------------
section("Hordes batter and destroy; the lookouts flee a falling tower");
{
  const state = mk();
  const h = hub(state);
  const fw = standing(state, "tower", 2);
  const s = atBase(state, h.id).find((x) => !x.leader);
  FW.postPerson(state, fw.id, s.id);
  const small = makeHorde(state, { tile: fw.tile, size: 12, role: "roam" });
  FW.hordeEnter(state, small);
  check(FW.fwById(state, fw.id) && fw.hp < fw.max && FW.damageBand(fw) !== undefined, `a small horde damages it (${fw.hp}/${fw.max}), the lookout shoots (${12 - small.size} down)`);
  // A big horde through hordesHour: it walks onto the tile and the tower falls.
  state.hordes.length = 0;
  const nb = state.grid.neighbors(fw.tile).find((id) => state.tiles[id].terrain !== "water" && !state.bases.some((b) => b.tile === id));
  const big = makeHorde(state, { tile: nb, size: 220, role: "roam" });
  big.target = fw.tile; big.move = 11.5;
  tick(state, 2, () => !FW.fwById(state, fw.id), true);
  check(!FW.fwById(state, fw.id), "a horde of 220 destroys the tower");
  check(s.location.kind !== "post" && (s.alive ? s.location.kind === "base" : true), `the lookout fled (${s.alive ? `home, health ${Math.round(s.health)}` : "killed"})`);
  check(state.fieldworks.news.some((n) => /destroyed/.test(n.text)) && state.fieldworks.news.some((n) => /fled/.test(n.text)), "news lines: fled, destroyed (the alerts read them)");
  // A site going up is set back, not destroyed.
  const at = spot(state, "stockpile", 1);
  const r = FW.planFieldWork(state, h, "stockpile", at.tile);
  FW.jobFor(state, r.fw).progress = 6;
  FW.hordeEnter(state, makeHorde(state, { tile: at.tile, size: 80 }));
  check(FW.fwById(state, r.fw.id) && FW.jobFor(state, r.fw).progress === 3, "a site going up loses half its work");
}

// ---------------------------------------------------------------------------------------------------------
section("A group's raid on a field work: driven off, or taken over; your team takes it back");
{
  const state = mk();
  const h = hub(state);
  const f = state.factions.find((x) => x.alive && x.bases.length);
  f.goodwill = -60;
  f.known = true;
  // Driven off: two good lookouts against a weak raid.
  const tower = standing(state, "tower", 2);
  toHour(state, 10);
  for (const s of atBase(state, h.id).filter((x) => !x.leader).slice(0, 2)) { s.health = 100; s.conditions = []; s.inBed = false; FW.postPerson(state, tower.id, s.id, 0); }
  tick(state, FW.shiftWalk(state, tower));
  check(FW.onDuty(state, tower).length === 2, "two lookouts on the day shift, on duty");
  const weak = FW.sendFieldRaid(state, f, tower, 0.6);
  weak.idx = weak.path.length - 1;
  const rolls = [];
  FW.fieldRaidArrive(state, weak);
  check(!state.parties.includes(weak), "the raid party is gone after it arrives");
  check(tower.owner === "player" && FW.fwById(state, tower.id), `a weak raid is driven off (owner ${tower.owner})`);
  // Taken over: nobody there, near their land (the rule's numbers opened up for the test).
  const keep = { ...FW.FIELD.RAID };
  FW.FIELD.RAID.near = 999; FW.FIELD.RAID.capture = 1;
  const pile = standing(state, "stockpile", 2);
  pile.contents = { scrap: 20 };
  const fs0 = f.stock.scrap || 0;
  const p = FW.sendFieldRaid(state, f, pile, 10);
  check(!!p && p.kind === "fwraid", "a raid party sets out for the stockpile");
  const done = tick(state, 24 * 6, () => !state.parties.includes(p) || pile.owner !== "player");
  Object.assign(FW.FIELD.RAID, keep);
  check(done && pile.owner === f.id && !Object.keys(pile.contents).length && state.fieldworks.news.some((n) => /emptied the stockpile .*20 scrap/.test(n.text)), `they took it over and its goods (owner ${pile.owner}, their scrap ${fs0} → ${f.stock.scrap})`);
  check(state.fieldworks.news.some((n) => /took/.test(n.text)), "news: they took it");
  // Your team takes it back (Capture order).
  pile.gar = 0;
  const ids = atBase(state, h.id).filter((x) => x.location.kind === "base").slice(0, 2).map((s) => s.id);
  const t = launchExpedition(state, { memberIds: ids, dest: pile.tile, mission: "move", stance: "normal", supplies: { food: 5, water: 5 } }).party;
  tick(state, 48, () => t.phase === "waiting" && partyTile(t) === pile.tile);
  const acts = FW.teamActs(state, t, pile.tile).map((a) => a.act);
  check(acts.includes("capture") && acts.includes("destroy"), `the team's menu there: ${acts.join(", ")}`);
  startOrder(state, t, { type: "fwork", act: "capture" });
  tick(state, 6, () => pile.owner === "player");
  check(pile.owner === "player" && pile.baseId === h.id, "taken back: yours again, held from the hub");
  // A group's tower with guards: wrecked by a strong team (the fight by the numbers).
  const gt = state.grid.within(f.bases[0], 2).find((id) => id !== f.bases[0] && state.tiles[id].terrain !== "water" && !FW.fwAt(state, id));
  const theirs = FW.buildGroupWork(state, f, "tower", gt, true);
  check(theirs.gar === FW.FIELD.AI.gar && FW.teamActs(state, t, gt).some((a) => /on guard/.test(a.label)), "their tower has guards (the menu says a fight)");
}

// ---------------------------------------------------------------------------------------------------------
section("Repairs: materials by kind and damage, the walk, refused when short, Repair all");
{
  const state = mk();
  const h = hub(state);
  builders(state, 2);
  const fw = standing(state, "tower", 2);
  check(/Not damaged/.test(FW.repairProblem(state, fw)), "an undamaged tower: nothing to repair");
  fw.hp = fw.max * 0.5;
  check(FW.damageBand(fw) === "worn", "half its condition: the needs-repair band (worn)");
  fw.hp = fw.max * 0.2;
  check(FW.damageBand(fw) === "bad", "a fifth: badly damaged");
  const rc = FW.repairCost(state, fw);
  check(rc.cost.scrap === Math.ceil(9 * 0.8) && rc.cost.wood === Math.ceil(72 * 0.8) && rc.hours > rc.work, `cost by the damage: ${JSON.stringify(rc.cost)}, ${rc.work} work-hours + walk = ${rc.hours}`);
  const scrap = h.stock.scrap;
  h.stock.scrap = 2;
  check(/Needs \d+ scrap/.test(FW.repairProblem(state, fw)), `short of scrap: "${FW.repairProblem(state, fw)}"`);
  h.stock.scrap = scrap;
  const q = FW.queueRepair(state, fw.id);
  check(!q.error && h.stock.scrap === scrap - rc.cost.scrap, `queued: ${q.text || q.error}`);
  tick(state, 48, () => fw.hp >= fw.max);
  check(fw.hp === fw.max && !FW.jobFor(state, fw), "repaired by the builders");
  // Repair all.
  const w = standing(state, "stockpile", 1);
  fw.hp = 30; w.hp = 10;
  const all = FW.repairAll(state, h);
  check(all.done === 2 && FW.jobFor(state, fw) && FW.jobFor(state, w), `Repair all: ${all.text}`);
  // Demolish: half back.
  const d0 = h.stock.wood;
  FW.cancelFieldJob(state, FW.jobFor(state, w).id);
  w.hp = w.max;
  FW.queueDemolish(state, w.id);
  tick(state, 48, () => !FW.fwById(state, w.id));
  check(!FW.fwById(state, w.id) && h.stock.wood > d0, `demolished: some firewood back (${Math.round(d0)} → ${Math.round(h.stock.wood)})`);
}

// ---------------------------------------------------------------------------------------------------------
section("A field well's water; a relay mast in the radio network");
{
  const state = mk();
  const h = hub(state);
  const fw = standing(state, "well", 2, (id) => FW.placeProblem(state, h, "well", id) === "");
  check(fw && fw.well && fw.well.yield > 0, `a well: ${fw && fw.well ? fw.well.yield : 0} a day`);
  check(FW.waterSourcesFor(state, h).length === 1 && FW.waterSourcesFor(state, h)[0].tile === fw.tile, "waterSourcesFor lists its tile");
  // With the job trips' hooks (installed at load) the well's water comes in by the Fetch water carriers, not by itself.
  const wp = waterProduction(state, h);
  check(!wp.field, `not passive: waterProduction.field ${wp.field || 0} (the carriers bring it)`);
  check(waterSources(state, h, "water").some((x) => x.well && x.id === fw.tile) && !waterSources(state, h, "fish").some((x) => x.well), "the well is a Fetch water source (not the fishers')");
  // Passive (the hooks off), as before the trips: hauled by the base's people and drawn down by the day.
  FW.FIELD.PASSIVE_WELLS = true;
  const wpp = waterProduction(state, h);
  check(wpp.field > 0 && wpp.fieldWells.length === 1, `passive: waterProduction.field ${wpp.field} (hub people ${atBase(state, h.id).length})`);
  const left0 = fw.well.left;
  tick(state, 24);
  FW.FIELD.PASSIVE_WELLS = false;
  check(fw.well.left < left0, `passive: drawn down: ${left0} → ${fw.well.left}`);
  // A carrier draws the day's yield at most, and the well is drawn down by it.
  const rate = FW.waterSourcesFor(state, h)[0].rate, left1 = fw.well.left;
  const got1 = TRIP_HOOKS.draw(state, h, fw.tile, 2), got2 = TRIP_HOOKS.draw(state, h, fw.tile, 1000);
  check(got1 === Math.min(2, rate) && Math.abs(got1 + got2 - rate) < 0.02 && Math.abs(fw.well.left - (left1 - got1 - got2)) < 0.02, `drawn by the carriers: ${got1} + ${got2} of ${rate} today, ${left1} → ${fw.well.left} left`);
  check(TRIP_HOOKS.draw(state, h, fw.tile, 2) === 0 && !waterSources(state, h, "water").some((x) => x.well), "drawn out for today: none left, the carriers go elsewhere");
  // A water carrier's day with only the well (no river or lake held): they fetch from it, the water comes in un-purified.
  const st2 = mk(), h2 = hub(st2);
  const fw2 = standing(st2, "well", 1, (id) => FW.placeProblem(st2, h2, "well", id) === "");
  const only = fw2 && waterSources(st2, h2, "water").filter((x) => !x.well).length === 0;
  if (fw2) {
    const carrier = atBase(st2, h2.id)[0];
    Object.assign(carrier, { role: "water", station: null, pinned: true, health: 100, inBed: false, conditions: [], mood: 70 });
    for (const x of atBase(st2, h2.id)) if (x !== carrier && x.role === "water") x.role = "rest";
    h2.stock.water = 0; h2.stock.rawwater = 0; // the water short: the Fetch water job is open
    const tgt = fetchWaterTile(st2, h2);
    const leftA = fw2.well.left;
    toHour(st2, 0); h2.stock.water = 0; h2.stock.rawwater = 0; toHour(st2, 20);
    const W = h2.tripTally && h2.tripTally.water;
    check(tgt && (only ? tgt.well : true) && W && W.water > 0 && (only ? W.well === W.water : true) && fw2.well.left < leftA, `a carrier's day ${only ? "(the well the only water)" : "(a river or lake too)"}: ${W ? W.water : 0} water${W && W.well ? `, ${W.well} from the well` : ""}; well ${leftA} → ${fw2.well.left}`);
  } else check(false, "no well site for the carrier");
  // Relay: none at the hub, no station: unlinked; a station at the hub links it.
  const relay = standing(state, "relay", 2);
  check(radioNodes(state).some((n) => n.field === relay.id && !n.linked), "a relay mast is a node, unlinked with no station");
  h.radio = true;
  check(radioNodes(state).some((n) => n.field === relay.id && n.linked), "with a station at the hub it links");
}

// ---------------------------------------------------------------------------------------------------------
section("The groups build their own; the governor's share");
{
  const state = mk();
  const f = state.factions.find((x) => x.alive && x.bases.length);
  f.stock.scrap = 200; f.stock.parts = 10; f.pop = Math.max(f.pop, 14);
  let built = null;
  for (let i = 0; i < 20 && !built; i++) { state.hour += 24; FW.groupFieldDaily(state); built = FW.groupWorks(state, f)[0]; }
  check(!!built, `${f.name} put up a ${built ? FW.kindName(built).toLowerCase() : "nothing"}`);
  if (built) {
    for (let i = 0; i < 4; i++) { state.hour += 24; FW.groupFieldDaily(state); }
    check(built.built && state.tiles[built.tile].owner === f.id, "it stands on their land");
  }
  const t2 = state.grid.within(f.bases[0], 2).find((id) => id !== f.bases[0] && state.tiles[id].terrain !== "water" && !FW.fwAt(state, id));
  FW.buildGroupWork(state, f, "tower", t2, true);
  check(FW.groupFieldDefence(state, f, f.bases[0]) > 1, `a manned tower of theirs adds to their defence (×${FW.groupFieldDefence(state, f, f.bases[0])})`);
  // The governor: a well when water runs short, nothing when it does not.
  const h = hub(state);
  const none = FW.govFieldWorks(state, h, { waterShort: false, threatened: false });
  check(!none.length, "nothing to do: the governor builds nothing");
  const can = FW.placeTiles(state, h, "well").some((x) => !FW.placeProblem(state, h, "well", x.tile) && wellYield(state, x.tile) >= 4);
  const lines = FW.govFieldWorks(state, h, { waterShort: true, threatened: false });
  check(can && FW.playerWorks(state, h).some((x) => x.kind === "well"), `water short: a well planned (${lines.join(" | ") || "none"})`);
  // Threatened: a tower, and once it stands, a lookout from a big enough base.
  const more = FW.govFieldWorks(state, h, { waterShort: false, threatened: true });
  check(!more.some((l) => /Watch tower/.test(l)), "one field job at a time: the tower waits for the well");
  for (const j of [...state.fieldworks.jobs]) { j.progress = j.hours; FW.fieldBuildHour(state, h) || builders(state, 1); FW.fieldBuildHour(state, h); }
  const t = FW.govFieldWorks(state, h, { waterShort: false, threatened: true });
  check(t.some((l) => /Watch tower planned/.test(l)), `threatened: a watch tower planned (${t.join(" | ")})`);
  for (const j of [...state.fieldworks.jobs]) { j.progress = j.hours; FW.fieldBuildHour(state, h); }
  for (let i = 0; i < 12; i++) state.survivors.push({ ...atBase(state, h.id)[0], id: newId(), leader: false, pinned: false });
  const post = FW.govFieldWorks(state, h, { waterShort: false, threatened: true });
  check(post.some((l) => /shift .* at the watch tower/.test(l)), `lookouts put on the shifts (${post.join(" | ")})`);
  // Repairs below 70%.
  const w = FW.playerWorks(state, h).find((x) => x.kind === "well");
  w.hp = 10;
  const rep = FW.govFieldWorks(state, h, { waterShort: false, threatened: false });
  check(rep.some((l) => /Repairs queued/.test(l)) && FW.jobFor(state, w), `a damaged well is repaired (${rep.join(" | ")})`);
}

// ---------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------
section("Roadblock guards: on shifts, they hold it longer, shoot back, and run when beaten");
{
  const state = mk();
  const h = hub(state);
  const fw = standing(state, "roadblock", 2) || standing(state, "roadblock", 1);
  if (check(!!fw, "a road tile for a roadblock")) {
    const f = state.factions.find((x) => x.alive && x.bases.length);
    f.goodwill = -60;
    const nb = state.grid.neighbors(fw.tile).find((id) => state.tiles[id].terrain !== "water" && id !== h.tile);
    const raid = (str) => { const p = spawnAiParty(state, f, "raid", f.bases[0], h.tile, { strength: str, target: { kind: "player", baseId: h.id } }); p.path = [nb, fw.tile, h.tile]; p.idx = 0; p.progress = 0; return p; };
    // Unguarded first.
    const p0 = raid(10);
    FW.partyEnter(state, p0, fw.tile);
    const held0 = -p0.progress, dmg0 = fw.max - fw.hp;
    state.parties.splice(state.parties.indexOf(p0), 1);
    fw.hp = fw.max;
    // Two good guards on the day shift.
    toHour(state, 10);
    const gs = atBase(state, h.id).filter((x) => !x.leader).slice(0, 2);
    for (const s of gs) { s.health = 100; s.conditions = []; s.inBed = false; const r = FW.postPerson(state, fw.id, s.id, 0); check(!r.error, `guard: ${r.text || r.error}`); }
    tick(state, FW.shiftWalk(state, fw));
    check(FW.guards(state, fw) === 2, "two guards on duty");
    const keep = Math.random;
    const odds = { ...FW.FIELD.ROADBLOCK };
    const p1 = raid(10);
    state.rng.chance = () => true; // the guards win the exchange (the dice set for the test)
    FW.partyEnter(state, p1, fw.tile);
    delete state.rng.chance;
    check(-p1.progress > held0 && p1.strength < 10, `guarded: held ${(-p1.progress).toFixed(1)} h (unguarded ${held0.toFixed(1)}), the raid cut to ${p1.strength}`);
    check(fw.max - fw.hp <= dmg0 + 0.01, `the same lane cut: ${fw.max - fw.hp} damage (unguarded ${dmg0})`);
    state.parties.splice(state.parties.indexOf(p1), 1);
    // A big raid beats them: they run for home.
    fw.hp = fw.max;
    const p2 = raid(400);
    FW.partyEnter(state, p2, fw.tile);
    check(gs.every((s) => !s.alive || s.location.kind === "base") && state.fieldworks.news.some((n) => /guards were overrun/.test(n.text)), "a big raid overruns the guards: they run home (maybe hurt)");
    state.parties.splice(state.parties.indexOf(p2), 1);
    // A horde: the guards shoot some down first.
    fw.hp = fw.max;
    tick(state, 2);
    const back = FW.guards(state, fw);
    const ho = makeHorde(state, { tile: fw.tile, size: 60, role: "roam" });
    ho.move = 0;
    FW.hordeEnter(state, ho);
    check(ho.move < 0 && (back ? ho.size < 60 : true), `a horde held ${(-ho.move).toFixed(1)} h${back ? `, ${60 - ho.size} shot down by ${back} guards` : ""}`);
    Object.assign(FW.FIELD.ROADBLOCK, odds);
    void keep;
  }
}

// ---------------------------------------------------------------------------------------------------------
section("Spike traps: cut down hordes and hostile parties, wear out, reset by a repair");
{
  const state = mk();
  const h = hub(state);
  const fw = standing(state, "spikes", 2);
  check(!!fw && fw.built && FW.spikesLive(fw), "spike traps set");
  const ho = makeHorde(state, { tile: fw.tile, size: 50, role: "roam" });
  FW.hordeEnter(state, ho);
  check(ho.size < 50 && fw.hp < fw.max, `a horde of 50 crosses: ${50 - ho.size} down, the traps at ${fw.hp}/${fw.max}`);
  const f = state.factions.find((x) => x.alive && x.bases.length);
  f.goodwill = -60;
  const p = spawnAiParty(state, f, "raid", f.bases[0], h.tile, { strength: 10, target: { kind: "player", baseId: h.id } });
  p.progress = 0;
  FW.partyEnter(state, p, fw.tile);
  check(p.strength < 10 && p.progress < 0, `a raid crosses: strength 10 → ${p.strength}, held ${(-p.progress).toFixed(1)} h`);
  state.parties.splice(state.parties.indexOf(p), 1);
  fw.hp = fw.max * 0.2;
  const ho2 = makeHorde(state, { tile: fw.tile, size: 50, role: "roam" });
  FW.hordeEnter(state, ho2);
  check(!FW.spikesLive(fw) && ho2.size === 50 && FW.fwById(state, fw.id), "sprung (20%): the next horde walks over them, they stay to be reset");
  builders(state, 2);
  const q = FW.queueRepair(state, fw.id);
  check(!q.error && /reset/.test(FW.jobText(state, FW.jobFor(state, fw))), `reset queued: ${q.text || q.error}`);
  tick(state, 48, () => fw.hp >= fw.max);
  check(FW.spikesLive(fw) && fw.hp === fw.max, "reset by the builders");
}

// ---------------------------------------------------------------------------------------------------------
section("Hunting blind: more game for the base's hunters on its tile, reached past the bare grounds");
{
  const state = mk();
  const h = hub(state);
  const fw = standing(state, "blind", 2, (id) => ["forest", "hills", "plains"].includes(state.tiles[id].terrain));
  if (check(!!fw, "a blind 2 tiles out on game land")) {
    check(TRIP_HOOKS.game(state, h, fw.tile) === FW.FIELD.BLIND.mult && TRIP_HOOKS.game(state, h, h.tile) === 1, `the hunters' game hook: ×${TRIP_HOOKS.game(state, h, fw.tile)} on its tile, ×1 elsewhere`);
    const t = huntTripTile(state, h);
    check(t && (t.id === fw.tile || t.v * t.f >= FW.FIELD.BLIND.mult * gameAbundance(state, fw.tile) * distFactor("hunt", 2) * 0.99), `the hunters' tile: ${t ? `${t.id} (${t.id === fw.tile ? "the blind" : "better ground"})` : "none"}`);
    const fw2 = FW.placeTiles(state, h, "blind").find((x) => /game/.test(x.why || ""));
    if (fw2) check(true, `refused on poor ground: "${fw2.why}"`);
  }
}

// ---------------------------------------------------------------------------------------------------------
section("Snare line (WORLD-02): a team sets it; it catches day by day; only a team checking it finds out what it holds");
{
  const state = mk();
  const h = hub(state);
  const at = spot(state, "snares", 2, (id) => ["forest", "hills"].includes(state.tiles[id].terrain)) || spot(state, "snares", 2) || spot(state, "snares", 1);
  if (check(!!at, "a tile for a snare line on forest, hills or farmland")) {
    const city = FW.placeTiles(state, h, "snares").find((x) => !["forest", "hills", "plains"].includes(state.tiles[x.tile].terrain));
    if (city) check(/forest, hills or farmland/.test(city.why), `refused off game land: "${city.why}"`);
    for (const s of atBase(state, h.id)) Object.assign(s, { health: 100, conditions: [], inBed: false });
    const r = FW.planFieldWork(state, h, "snares", at.tile);
    const fw = r.fw;
    const team = fw && FW.snareTeam(state, fw);
    check(!r.error && !fw.built && !!team && FW.snareRoute(state, h, at.tile).land, `placing it sends a team out over land; nothing is set yet (${r.error || r.text})`);
    check(!FW.fieldJobs(state, h).length, "it is no job for the builders");
    tick(state, 48, () => fw.built);
    check(fw.built && fw.checked && fw.checked.set, `the team set it at the tile (${FW.fwStatusText(state, fw)})`);
    tick(state, 48, () => !state.parties.includes(team));
    check(!state.parties.includes(team), "and walked home");
    // Day by day (no thieves, none of the dead): the catch waits in the snares.
    const keep = { theft: FW.FIELD.SNARES.theft, near: FW.FIELD.SNARES.near, z: SNARE.zombie, zn: SNARE.zombieNear };
    FW.FIELD.SNARES.theft = 0; FW.FIELD.SNARES.near = 0; SNARE.zombie = 0; SNARE.zombieNear = 0;
    for (let i = 0; i < 4; i++) { state.hour += 24; FW.fieldworksDaily(state); }
    check(fw.caught > 0, `4 days: ${fw.caught} caught (about ${FW.snareExpect(state, fw)} a day expected), ${FW.snareHeld(fw)} still in the snares, ${fw.rotted || 0} rotted`);
    if (!FW.snareHeld(fw)) fw.held = [{ day: day(state), n: 3 }];
    // Nobody at home checks it, hunter or not, and the base does not know what it holds.
    const hunter = atBase(state, h.id).find((x) => !x.leader);
    Object.assign(hunter, { role: "hunt", health: 100, conditions: [], inBed: false });
    const n = FW.snareHeld(fw);
    const game = () => (h.stock.f_smallgame || 0) + (h.stock.f_fowl || 0);
    toHour(state, FW.FIELD.HAUL.hour);
    check(FW.snareHeld(fw) === n && !state.parties.some((q) => q.snareFor === fw.id), `the morning comes and goes: nobody checks it from home (${n} still in it)`);
    const st0 = FW.fwStatusText(state, fw);
    check(/unknown until a team checks it/.test(st0) && !new RegExp(`${n} small game`).test(st0), `the tab does not know what it holds ("${st0}")`);
    // Robbed: nobody at home hears of it; the team that checks it does.
    FW.FIELD.SNARES.theft = 1;
    const hp0 = fw.hp;
    state.hour += 24; FW.fieldworksDaily(state);
    FW.FIELD.SNARES.theft = 0;
    check(fw.robbed >= n && fw.hp < hp0 && !state.fieldworks.news.some((x) => /robbed the snare line/.test(x.text)), `robbed out of sight: ${fw.robbed} taken, condition ${hp0} → ${fw.hp}, no news at home`);
    fw.held = [{ day: day(state), n: 2 }];
    // Send a team to check it: the catch comes home with it, and the robbery is found out.
    const sent = FW.sendSnareTeam(state, fw.id);
    check(!sent.error && /to check the snare line/.test(sent.text), `Send a team to check (${sent.error || sent.text})`);
    check(!!FW.sendSnareTeam(state, fw.id).error, "one team at a time");
    const ct = sent.party;
    const game0 = game();
    tick(state, 72, () => !state.parties.includes(ct));
    check(!FW.snareHeld(fw) && fw.checked && fw.checked.n === 2 && fw.checked.robbed >= n && game() > game0, `the team checked it and brought the catch home (${FW.snareKnownText(state, fw)}; small game at home ${game0} → ${game()})`);
    // One of the dead caught in the wires: no game while it hangs there; the team puts it down.
    const zmax = SNARE.zombieMax;
    SNARE.zombie = 1; SNARE.zombieMax = 1;
    fw.hp = fw.max; // mended (a torn line catches nothing, the dead included)
    const c0 = fw.caught;
    state.hour += 24; FW.fieldworksDaily(state);
    check(!!fw.zombie && fw.caught === c0, `one of the dead in the wires: it catches nothing more (caught ${c0} → ${fw.caught})`);
    SNARE.zombie = keep.z; SNARE.zombieNear = keep.zn; SNARE.zombieMax = zmax;
    const ids = atBase(state, h.id).filter((x) => x.location.kind === "base" && !x.leader).slice(0, 2).map((x) => x.id);
    const t = launchExpedition(state, { memberIds: ids, dest: fw.tile, mission: "move", stance: "normal", supplies: { food: 3, water: 3 } }).party;
    tick(state, 24, () => t.phase === "waiting" && partyTile(t) === fw.tile);
    check(FW.teamActs(state, t, fw.tile).some((a) => a.act === "check" && !/\d+ small game/.test(a.hint)), "a team at the line: Check the snare line (its menu does not say what is in it)");
    startOrder(state, t, { type: "fwork", act: "check" });
    tick(state, 3, () => t.phase === "waiting");
    check(!fw.zombie && fw.checked.zombie, "the team put it down");
    FW.FIELD.SNARES.theft = keep.theft; FW.FIELD.SNARES.near = keep.near;
    // Under 10% a day, even with a horde beside it.
    const zc0 = snareZombieChance(state, fw.tile);
    state.hordes.push(makeHorde(state, { tile: fw.tile, size: 40, role: "roam" }));
    const zc1 = snareZombieChance(state, fw.tile);
    state.hordes.length = 0;
    check(zc0 > 0 && zc0 < 0.1 && zc1 > zc0 && zc1 < 0.1, `one of the dead in a line: ${Math.round(zc0 * 100)}% a day, ${Math.round(zc1 * 100)}% with the dead about`);
    // A standing check: a team goes out on its day.
    tick(state, 48, () => !state.parties.includes(t));
    check(/every 2 days/.test(FW.setSnareCheck(state, fw, 2)), "a standing check every 2 days");
    fw.check.next = day(state) + 1;
    state.hour += 24;
    toHour(state, FW.CHECK_HOUR + 1);
    check(!!FW.snareTeam(state, fw) && fw.check.last && fw.check.last.ok && fw.check.next === fw.check.last.day + 2, `on its day a team went out (${FW.snareCheckText(state, fw)})`);
  }
}

// ---------------------------------------------------------------------------------------------------------
section("Snare line across a river (WORLD-02): by land or not at all, unless the team can take a boat");
{
  const state = mk();
  const h = hub(state);
  // A shore tile with land straight across one stretch of river, and no way round by land within the team's walk.
  let found = null;
  for (const tl of state.tiles) {
    if (tl.terrain === "water" || state.bases.some((b) => b.tile === tl.id) || state.factions.some((f) => f.bases.includes(tl.id))) continue;
    for (const c of crossingsFrom(state, tl.id)) {
      const ft = state.tiles[c.tile];
      if (!["forest", "hills", "plains"].includes(ft.terrain) || ft.hive || state.factions.some((f) => f.bases.includes(c.tile))) continue;
      const r = FW.snareRoute(state, { tile: tl.id }, c.tile);
      if (r && r.boat) { found = { shore: tl.id, far: c.tile }; break; }
    }
    if (found) break;
  }
  if (check(!!found, "a riverbank with a tile across and no bridge near")) {
    // The hub stands on that bank (for the test) and holds the land across.
    h.tile = found.shore;
    state.tiles[found.far].owner = "player";
    for (const id of state.grid.neighbors(found.far)) if (state.tiles[id].terrain !== "water") state.tiles[id].owner = state.tiles[id].owner ?? null;
    const route = FW.snareRoute(state, h, found.far);
    check(route && route.boat && !route.land && route.scrap === FW.boatScrap(), `the way there is by boat (from ${route.boat.from} to ${route.boat.to}, ${route.scrap} scrap)`);
    h.stock.scrap = 2;
    const why = FW.placeProblem(state, h, "snares", found.far);
    check(/boat/.test(why), `with only the line's scrap: refused ("${why}")`);
    check(!FW.placeProblem(state, h, "snares", found.far, false), "but the tile is still offered once there is scrap (connectivity alone)");
    h.stock.scrap = 2 + route.scrap + 4;
    check(!FW.placeProblem(state, h, "snares", found.far), "with scrap for the boats there and back: allowed");
    for (const s of atBase(state, h.id)) Object.assign(s, { health: 100, conditions: [], inBed: false });
    const r = FW.planFieldWork(state, h, "snares", found.far);
    const p = r.fw && FW.snareTeam(state, r.fw);
    check(!!p && carried(p, "scrap") >= route.scrap && p.orders.filter((o) => o.type === "cross").length === 2, `the team takes the scrap and crosses there and back (${r.error || r.text})`);
    tick(state, 72, () => r.fw.built);
    check(r.fw.built, `it reached the far bank by boat and set the line (${FW.fwStatusText(state, r.fw)})`);
    // Open water itself: no route (and nowhere to set a line).
    check(!FW.snareRoute(state, h, state.grid.neighbors(found.shore).find((id) => state.tiles[id].terrain === "water")), "open water: no route");
  }
}

// ---------------------------------------------------------------------------------------------------------
section("hc-food: the snare line is field craft (2 scrap, an hour, anyone sets it, a camp too); the governor and the groups set theirs");
{
  const S = FW.FIELD.KINDS.snares;
  check(S.craft && S.cost.scrap === 2 && Object.keys(S.cost).length === 1 && S.hours === 1, `cheap: ${FW.costText(S.cost)}, ${S.hours} work-hour (was 4 scrap, 15 firewood, 3 hours)`);
  const state = mk();
  const h = hub(state);
  // A camp: it holds only its own tile and keeps no field works, but snare lines next to it.
  Object.assign(h, { tier: 0, camp: true });
  recomputeOwnership(state);
  check(FW.maxWorks(h) === 0 && FW.maxSnares(h) === FW.FIELD.SNARES.max.camp, `a camp: ${FW.maxWorks(h)} field works, ${FW.maxSnares(h)} snare lines`);
  check(!FW.placeTiles(state, h, "tower").some((x) => !x.why), "a camp: no watch tower anywhere");
  const ok = FW.placeTiles(state, h, "snares").filter((x) => !x.why);
  const far = state.grid.within(h.tile, 2).find((id) => state.grid.distance(h.tile, id) === 2 && ["forest", "hills", "plains"].includes(state.tiles[id].terrain));
  check(ok.length > 0 && ok.every((x) => state.grid.distance(h.tile, x.tile) <= FW.FIELD.SNARES.reach), `a camp: snare lines on ${ok.length} tiles next to it`);
  if (far != null) check(!!FW.placeProblem(state, h, "snares", far), `a camp: not 2 tiles out on land it does not hold ("${FW.placeProblem(state, h, "snares", far)}")`);
  // Nobody on Build: a team walks out and sets it (an hour there, plus the walk).
  for (const s of atBase(state, h.id)) Object.assign(s, { role: "rest", health: 100, conditions: [], inBed: false });
  h.construction.length = 0;
  h.stock.scrap = 2; h.stock.wood = 0;
  const r = ok.length ? FW.planFieldWork(state, h, "snares", ok[0].tile) : { error: "no tile" };
  if (check(!r.error && h.stock.scrap === 0, `planned with 2 scrap and no firewood (${r.error || r.text})`)) {
    const job = FW.jobFor(state, r.fw);
    check(job.type === "team" && job.hours <= 2, `an hour's work there: ${job.hours} hours`);
    let hrs = 0;
    while (!r.fw.built && hrs < 24) { tick(state, 1); hrs++; }
    check(r.fw.built && hrs <= 12, `set by a team from the camp with nobody on Build (${hrs} hours with the walk)`);
    // The cap: SNARES.max lines, and they do not count against the field works.
    h.stock.scrap = 20;
    const ok2 = FW.placeTiles(state, h, "snares").filter((x) => !x.why);
    if (ok2.length) FW.planFieldWork(state, h, "snares", ok2[0].tile);
    const third = FW.placeTiles(state, h, "snares").find((x) => !FW.fwAt(state, x.tile) && state.grid.distance(h.tile, x.tile) === 1);
    if (third) check(/at most/.test(FW.placeProblem(state, h, "snares", third.tile)), `a camp keeps ${FW.maxSnares(h)} lines: "${FW.placeProblem(state, h, "snares", third.tile)}"`);
    // With no hunter at the camp, a team of whoever is fit goes to check it and brings the small game in.
    tick(state, 48, () => !state.parties.some((q) => q.snareFor != null));
    tick(state, 1); // the old generic stores typed first (foods.js), so the food count below is the catch's
    r.fw.held = [{ day: day(state), n: 2 }];
    const game0 = (h.stock.f_smallgame || 0) + (h.stock.f_fowl || 0);
    const sent = FW.sendSnareTeam(state, r.fw.id);
    const crew = sent.party ? sent.party.members.map((id) => state.survivors.find((x) => x.id === id)) : [];
    if (sent.party) tick(state, 48, () => !state.parties.includes(sent.party));
    check(!FW.snareHeld(r.fw) && crew.length && crew.every((x) => x.role !== "hunt") && (h.stock.f_smallgame || 0) + (h.stock.f_fowl || 0) > game0, `no hunter: ${crew.map((x) => `${x.name} (${x.role})`).join(", ") || sent.error} checked it and brought the small game in`);
  }
  // No scrap in the stores: a coil of snare wire from the armory (it comes back on a cancel), or the scrap gathered
  // for the camp's step up (not yet worked in).
  {
    const w = mk();
    const wh = hub(w);
    Object.assign(wh, { tier: 0, camp: true });
    recomputeOwnership(w);
    wh.stock.scrap = 0; wh.construction.length = 0;
    const at = FW.placeTiles(w, wh, "snares").find((x) => !x.why);
    check(/snare wire/.test(FW.placeProblem(w, wh, "snares", at.tile)), `no scrap, no wire: "${FW.placeProblem(w, wh, "snares", at.tile)}"`);
    wh.armory.push({ key: "snarewire", id: newId() });
    const rw = FW.planFieldWork(w, wh, "snares", at.tile);
    check(!rw.error && rw.fw.wire && !wh.armory.some((it) => it && it.key === "snarewire") && /snare wire/.test(rw.text), `set with the armory's coil of snare wire (${rw.error || rw.text})`);
    FW.cancelFieldJob(w, FW.jobFor(w, rw.fw).id);
    check(wh.armory.some((it) => it && it.key === "snarewire"), "cancelled: the coil is back in the armory");
    wh.armory = wh.armory.filter((it) => !(it && it.key === "snarewire"));
    wh.construction.push({ id: newId(), type: "camp_up", progress: 0, hours: 20, paid: { scrap: 10 } });
    check(FW.gatheredScrap(wh) === 10 && !FW.placeProblem(w, wh, "snares", at.tile), `the step up's gathered scrap pays (${FW.gatheredScrap(wh)} there)`);
    const rg = FW.planFieldWork(w, wh, "snares", at.tile);
    check(!rg.error && wh.construction[0].paid.scrap === 8, `2 scrap off the step up's pile (${wh.construction[0].paid.scrap} left)`);
  }
  // The governor: a line at the camp from the start in hardcore; none in a normal game while fed, one when food is short.
  const g = mk();
  const gh = hub(g);
  Object.assign(gh, { tier: 0, camp: true });
  recomputeOwnership(g);
  check(FW.govFieldWorks(g, gh, { foodShort: 0 }).length === 0 && !FW.playerWorks(g, gh).length, "normal, fed: no snare line");
  check(FW.snareLinesWanted(g, gh, 1) === 1 && FW.snareLinesWanted(g, gh, 2) === 2, "normal: one line under the food target, two under half of it");
  g.mode = "hardcore";
  check(FW.snareLinesWanted(g, gh, 0) === 1 && FW.snareLinesWanted(g, gh, 2) === FW.maxSnares(gh), `hardcore: one line from the start, up to ${FW.maxSnares(gh)} while short`);
  const said = FW.govFieldWorks(g, gh, { foodShort: 0 });
  const line = FW.playerWorks(g, gh).find((x) => x.kind === "snares");
  check(!!line && said.some((x) => /Snare line planned/.test(x)) && line.check && line.check.every === FW.FIELD.SNARES.govCheck, `hardcore: the governor sets a line at the camp, a team checking it every ${FW.FIELD.SNARES.govCheck} days (${said.join(" ") || "nothing"})`);
  FW.govFieldWorks(g, gh, { foodShort: 2 });
  check(FW.playerWorks(g, gh).filter((x) => x.kind === "snares").length <= FW.snareLinesWanted(g, gh, 2), "no more lines than it wants while food is short");
  // The steward and the governor at a full base (maxWorks > 0): the line comes before the rest, then nothing else that day.
  const n = mk();
  const nh = hub(n);
  n.mode = "hardcore";
  const nl = FW.govFieldWorks(n, nh, { foodShort: 0, waterShort: true });
  check(FW.playerWorks(n, nh).filter((x) => x.kind === "snares").length === 1 && FW.playerWorks(n, nh).length === 1, `hub: the snare line first, the well waits (${nl.join(" ")})`);
  // The groups: the same cheap line, wanted first, outside their field works' count.
  const f = state.factions.find((x) => x.alive && x.bases.length && state.grid.within(x.bases[0], 2).some((id) => id !== x.bases[0] && state.tiles[id].owner === x.id && ["forest", "hills", "plains"].includes(state.tiles[id].terrain) && FW.snareRateOk(state, id)));
  if (check(!!f, "a group with game land")) {
    clearFood(f.stock); setFood(f.stock, f.pop * 2);
    check(FW.groupSnaresWanted(state, f) === 2, `a group short of food wants ${FW.groupSnaresWanted(state, f)} lines`);
    const w = FW.groupWants(state, f, [], true);
    check(w && w.kind === "snares", `wanted first, even with their field works full (${w && w.kind})`);
    check(FW.groupFieldCost("snares").scrap === 2 && !FW.groupFieldCost("snares").wood, `their cost: ${FW.groupFieldCost("snares").scrap} scrap`);
    const gl = FW.buildGroupWork(state, f, "snares", w.tile, false);
    check(gl.readyDay === day(state) + 1, "theirs is ready the next day");
    setFood(f.stock, f.pop * 50);
    state.mode = "normal";
    check(FW.groupSnaresWanted(state, f) === 0, "a fed group in a normal game wants none");
    state.mode = "hardcore";
    check(FW.groupSnaresWanted(state, f) === 1, "a fed group in hardcore keeps one");
  }
}

// ---------------------------------------------------------------------------------------------------------
section("Fuel cache: restocked by the builders, drawn by a team, hidden from passing raiders and the dead");
{
  const state = mk();
  const h = hub(state);
  createVehicle(state, "truck", { kind: "base", baseId: h.id }, { fuel: 20 });
  h.stock.fuel = 100;
  const fw = standing(state, "cache", 2);
  check(!!fw && fw.built && !Object.keys(fw.contents).length, "a cache stands, empty");
  builders(state, 2);
  const plan = FW.cachePlan(state, fw);
  const fuel0 = h.stock.fuel;
  const q = FW.queueRestock(state, fw.id);
  check(!q.error && h.stock.fuel < fuel0 && plan.fuel > 0, `restock queued: ${q.text || q.error}`);
  tick(state, 24, () => !FW.jobFor(state, fw));
  check(fw.contents.fuel === plan.fuel && FW.stockKg(fw) <= FW.FIELD.KINDS.cache.capKg, `stocked: ${FW.contentsText(fw)} (${FW.stockKg(fw)} kg)`);
  // A horde walks over it.
  const hp0 = fw.hp;
  FW.hordeEnter(state, makeHorde(state, { tile: fw.tile, size: 100 }));
  check(fw.hp === hp0, "a horde of 100 walks over it: untouched (buried)");
  // A hostile raid passing does not see it; one sent for it finds nothing (find 0) or empties it (find 1).
  const f = state.factions.find((x) => x.alive && x.bases.length);
  f.goodwill = -60; f.known = true;
  const pass = spawnAiParty(state, f, "raid", f.bases[0], h.tile, { strength: 10, target: { kind: "player", baseId: h.id } });
  const c0 = FW.stockKg(fw);
  FW.partyEnter(state, pass, fw.tile);
  check(FW.stockKg(fw) === c0, "a raid passing over it does not find it");
  state.parties.splice(state.parties.indexOf(pass), 1);
  const keep = FW.FIELD.RAID.find;
  FW.FIELD.RAID.find = 0;
  FW.fieldRaidArrive(state, FW.sendFieldRaid(state, f, fw, 8));
  check(FW.stockKg(fw) === c0 && FW.fwById(state, fw.id), "a raid sent for it searched and went home with nothing");
  FW.FIELD.RAID.find = keep;
  check(FW.raidChance(state, fw) < FW.raidChance(state, { kind: "tower", contents: {} }) + 1e-9, `raided less often than a tower (×${FW.FIELD.RAID.cacheW})`);
  // A team draws on it.
  const ids = atBase(state, h.id).filter((x) => x.location.kind === "base" && !x.leader).slice(0, 2).map((x) => x.id);
  const t = launchExpedition(state, { memberIds: ids, dest: fw.tile, mission: "move", stance: "normal", supplies: { food: 2, water: 2 } }).party;
  tick(state, 24, () => t.phase === "waiting" && partyTile(t) === fw.tile);
  const acts = FW.teamActs(state, t, fw.tile).map((a) => a.act);
  check(acts.includes("draw") && acts.includes("stash"), `the team's menu: ${acts.join(", ")}`);
  const fuelT = carried(t, "fuel");
  startOrder(state, t, { type: "fwork", act: "draw" });
  tick(state, 3, () => t.phase === "waiting");
  check(carried(t, "fuel") > fuelT && !(fw.contents.fuel > 0), `drawn: the team's fuel ${fuelT} → ${carried(t, "fuel")}`);
  // A group's cache is hidden until a team finds it.
  const gt = state.grid.within(f.bases[0], 2).find((id) => id !== f.bases[0] && state.tiles[id].terrain !== "water" && !FW.fwAt(state, id));
  const theirs = FW.buildGroupWork(state, f, "cache", gt, true);
  check(!FW.teamActs(state, t, gt).length, "a group's cache: nothing to do there until it is found");
  theirs.found = true;
  check(FW.teamActs(state, t, gt).some((a) => a.act === "loot") || !Object.keys(theirs.contents).length, "found: their goods can be taken");
}

// ---------------------------------------------------------------------------------------------------------
section("Standing haul order: every N days or at X kg, with a vehicle; skipped without one or under attack");
{
  const state = mk();
  const h = hub(state);
  state.vehicles = state.vehicles.filter((v) => !(v.loc.kind === "base" && v.loc.baseId === h.id)); // no vehicle at the hub to start with
  const fw = standing(state, "stockpile", 2);
  fw.contents = { scrap: 30 };
  const r = FW.setHaul(state, fw, 3, 0);
  check(/every 3 days/.test(r) && fw.haul.next === day(state) + 3 && /next haul: day/.test(FW.haulText(state, fw)), `set: ${r} (${FW.haulText(state, fw)})`);
  // No vehicle: skipped on its day, said why.
  fw.haul.next = day(state);
  toHour(state, FW.FIELD.HAUL.hour);
  check(!state.parties.some((p) => p.haulFor === fw.id) && fw.haul.last && /vehicle/.test(fw.haul.last.why || ""), `no vehicle: skipped (${FW.haulText(state, fw)})`);
  // With a truck: it goes out and brings it in.
  createVehicle(state, "truck", { kind: "base", baseId: h.id }, { fuel: 25, condition: 90 });
  // The base under attack (on alert) at the haul hour: skipped (the hour run by hand: the alert clears itself as time runs).
  fw.haul.next = day(state);
  h.alert = true;
  FW.fieldworksHour(state);
  check(!state.parties.some((p) => p.haulFor === fw.id) && /under attack/.test(fw.haul.last.why || ""), `the base on alert: skipped (${fw.haul.last.why})`);
  h.alert = false;
  const scrap0 = h.stock.scrap;
  FW.fieldworksHour(state);
  const hauler = state.parties.find((p) => p.haulFor === fw.id);
  check(!!hauler && !!hauler.vehicle && fw.haul.last.ok && fw.haul.next === day(state) + 3, `on its day: a haul team with the truck (next day ${fw.haul.next})`);
  tick(state, 48, () => !state.parties.includes(hauler));
  check(!Object.keys(fw.contents).length && h.stock.scrap >= scrap0 + 30, "hauled home");
  // By weight.
  FW.setHaul(state, fw, 0, 50);
  fw.contents = { scrap: 20 }; // 40 kg
  tick(state, 24);
  toHour(state, FW.FIELD.HAUL.hour);
  check(!state.parties.some((p) => p.haulFor === fw.id), "40 kg under the 50: not yet");
  fw.contents = { scrap: 30 };
  tick(state, 23);
  toHour(state, FW.FIELD.HAUL.hour);
  check(state.parties.some((p) => p.haulFor === fw.id), "60 kg: hauled");
}

// ---------------------------------------------------------------------------------------------------------
section("AI parity: the groups' stockpiles and caches feed them; they raid each other's structures");
{
  const state = mk();
  const f = state.factions.find((x) => x.alive && x.bases.length && x.pop >= 6);
  const land = state.grid.within(f.bases[0], 2).filter((id) => id !== f.bases[0] && state.tiles[id].terrain !== "water" && !FW.fwAt(state, id));
  setFood(f.stock, 1000); f.stock.scrap = 500;
  const pile = FW.buildGroupWork(state, f, "stockpile", land[0], true);
  check(Object.keys(pile.contents).length > 0, `their stockpile stocked from their stores (${FW.contentsText(pile)})`);
  // Short of food: they draw on it.
  clearFood(pile.contents); addDays(pile.contents, 40);
  clearFood(f.stock);
  for (let i = 0; i < 1; i++) { state.hour += 24; FW.groupFieldDaily(state); }
  check(food(f.stock) >= 40 - 1e-6 && !(food(pile.contents) > 1e-6), `short of food: drawn into their stores (${food(f.stock)})`);
  // Hauled home every AI.haulEvery days.
  pile.contents = { scrap: 20 };
  setFood(f.stock, 1000);
  let hauled = false;
  for (let i = 0; i < FW.FIELD.AI.haulEvery + 1 && !hauled; i++) { state.hour += 24; FW.groupFieldDaily(state); hauled = pile.hauled === day(state); }
  check(hauled, `hauled home within ${FW.FIELD.AI.haulEvery} days (day ${pile.hauled})`);
  // Their snare line feeds them.
  const sn = land.find((id) => ["forest", "hills", "plains"].includes(state.tiles[id].terrain) && !FW.fwAt(state, id));
  if (sn != null) {
    const line = FW.buildGroupWork(state, f, "snares", sn, true);
    for (let i = 0; i < 5; i++) { state.hour += 24; FW.fieldworksDaily(state); }
    check((line.caught || 0) > 0 && !FW.snareHeld(line), `their snare line: ${line.caught} caught, taken in by their people`);
  }
  // Groups at war raid each other's structures.
  const o = state.factions.find((x) => x !== f && x.alive && x.bases.length && x.pop >= 6);
  if (check(!!o, "a second group")) {
    const theirs = FW.buildGroupWork(state, o, "tower", state.grid.within(o.bases[0], 2).find((id) => id !== o.bases[0] && state.tiles[id].terrain !== "water" && !FW.fwAt(state, id)), true);
    const keepRange = FW.FIELD.RAID.range;
    FW.FIELD.RAID.range = 999;
    check(!FW.raidersNear(state, theirs).some((x) => x.f === f) || FW.raidersNear(state, theirs).find((x) => x.f === f).w > 0, "raiders near: a group only when it would raid them");
    startWar(state, f, o, "test");
    const near = FW.raidersNear(state, theirs).find((x) => x.f === f);
    check(near && near.w === FW.FIELD.RAID.ai, `at war: ${f.name} would raid ${o.name}'s tower (weight ${near ? near.w : 0})`);
    FW.FIELD.RAID.range = keepRange;
    theirs.gar = 0;
    const keepCap = FW.FIELD.RAID.capture, keepNear = FW.FIELD.RAID.near;
    FW.FIELD.RAID.capture = 1; FW.FIELD.RAID.near = 999;
    const p = FW.sendFieldRaid(state, f, theirs, 12);
    check(p && p.kind === "fwraid" && p.target.owner === o.id, "a group's raid party sets out for the other's tower");
    FW.fieldRaidArrive(state, p);
    FW.FIELD.RAID.capture = keepCap; FW.FIELD.RAID.near = keepNear;
    check(theirs.owner === f.id && (state.fieldworks.stats.aiCaptured || 0) >= 1, `taken over: now ${f.name}'s (stats ${JSON.stringify(state.fieldworks.stats)})`);
  }
}

// ---------------------------------------------------------------------------------------------------------
section("The governor: a roadblock on the road raids keep using; a stockpile by the far crews, hauled");
{
  const state = mk();
  const h = hub(state);
  builders(state, 1);
  const road = FW.placeTiles(state, h, "roadblock").find((x) => !x.why);
  if (check(!!road, "a road tile on the hub's land")) {
    const f = state.factions.find((x) => x.alive && x.bases.length);
    f.goodwill = -60;
    for (let i = 0; i < 2; i++) {
      const p = spawnAiParty(state, f, "raid", f.bases[0], h.tile, { strength: 8, target: { kind: "player", baseId: h.id } });
      FW.partyEnter(state, p, road.tile);
      FW.partyEnter(state, p, road.tile); // the same raid twice on a tile counts once
      state.parties.splice(state.parties.indexOf(p), 1);
    }
    check(h.raidRoads && h.raidRoads[road.tile].n === 2 && FW.raidRoad(state, h) === road.tile, `two raids came down the road at ${road.tile}: noted (${JSON.stringify(h.raidRoads)})`);
    const lines = FW.govFieldWorks(state, h, {});
    check(lines.some((l) => /Roadblock planned/.test(l)) && FW.playerWorks(state, h).some((x) => x.kind === "roadblock"), `the governor plans a roadblock there (${lines.join(" | ")})`);
  }
  // Far crews: foragers whose ground near the walls is picked bare, so they go 2 out.
  const st2 = mk(), h2 = hub(st2);
  builders(st2, 1);
  st2.forage = st2.forage || {};
  for (const id of st2.grid.within(h2.tile, 1)) st2.forage[id] = [0, st2.hour];
  const people = atBase(st2, h2.id).filter((x) => !x.leader && x.role !== "build").slice(0, 3);
  for (const s of people) { s.role = "forage"; s.pinned = true; }
  const far = FW.farCrewTile(st2, h2);
  if (far != null) {
    const lines = FW.govFieldWorks(st2, h2, {});
    const pile = FW.playerWorks(st2, h2).find((x) => x.kind === "stockpile");
    check(pile && st2.grid.distance(pile.tile, far) < st2.grid.distance(h2.tile, far), `foragers 2 out at ${far}: a stockpile planned nearer them (${lines.join(" | ")})`);
    for (const j of [...st2.fieldworks.jobs]) { j.progress = j.hours; FW.fieldBuildHour(st2, h2); }
    createVehicle(st2, "truck", { kind: "base", baseId: h2.id }, { fuel: 25 });
    const more = FW.govFieldWorks(st2, h2, {});
    check(pile.haul && pile.haul.every === FW.FIELD.GOV.pileEvery, `with a truck: a standing haul order (${more.join(" | ")})`);
  } else check(true, "no far scavenging ground on this seed (skipped)");
}

// ---------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------
section("fw-picks: a blind helps a team's hunt on its tile; the uncovered-shift alert; the Tower sight layer");
{
  const state = mk();
  const h = hub(state);
  const fw = standing(state, "blind", 2, (id) => ["forest", "hills", "plains"].includes(state.tiles[id].terrain)) || standing(state, "blind", 1);
  if (check(!!fw, "a blind for the team hunt")) {
    check(tileGameMult(state, null, fw.tile, "player") === FW.FIELD.BLIND.mult && tileGameMult(state, null, fw.tile, 999) === 1, "the blind counts for your teams, not a group's");
    const team = { big: 1, small: 0.8 }; // a rifleman's power
    const keep = FW.FIELD.BLIND.mult;
    const withB = expectHunt(state, team, fw.tile, 6, state.hour, 0, Infinity, "player");
    FW.FIELD.BLIND.mult = 1;
    const without = expectHunt(state, team, fw.tile, 6, state.hour, 0, Infinity, "player");
    FW.FIELD.BLIND.mult = keep;
    check(withB.rations > without.rations, `a team's expected hunt there: ${withB.rations} food with the blind, ${without.rations} without`);
    // A team actually hunting there: the summary says so.
    const ids = atBase(state, h.id).filter((x) => !x.leader).slice(0, 2).map((x) => x.id);
    const t = launchExpedition(state, { memberIds: ids, dest: fw.tile, mission: "move", stance: "normal", supplies: { food: 5, water: 5, ...Object.fromEntries(Object.entries(h.stock).filter(([k]) => /^a_/.test(k)).slice(0, 2).map(([k, v]) => [k, Math.min(30, Math.floor(v))])) } }).party;
    tick(state, 24, () => t.phase === "waiting" && partyTile(t) === fw.tile);
    const r = startOrder(state, t, { type: "hunt", hours: 3 });
    tick(state, 5, () => t.phase === "waiting");
    check(t.lastHaul || /hunt/i.test(r || ""), `a team hunt at the blind ran (${(r || "").slice(0, 80)})`);
  }
  // The uncovered-shift alert.
  const st = mk(), hb = hub(st);
  const tower = standing(st, "tower", 2);
  toHour(st, 10);
  const a = atBase(st, hb.id).find((x) => !x.leader), b = atBase(st, hb.id).find((x) => !x.leader && x !== a);
  for (const s of [a, b]) Object.assign(s, { health: 100, conditions: [], inBed: false });
  FW.setRosterPreset(st, tower, "day"); // daylight only: the night is a gap left on purpose
  FW.postPerson(st, tower.id, a.id, 0);
  tick(st, 2);
  const alerts = () => { const out = []; fieldworkAlerts(st, out); return out.filter((x) => x.kind === "fwgap"); };
  check(!alerts().length && !FW.uncovered(st, tower), "covered: no alert");
  check(!FW.uncovered(st, tower, 23), "a daylight-only roster at 23:00: a gap on purpose, no alert");
  a.health = 20; // badly hurt: home, and the day shift has nobody else
  tick(st, 1);
  const al = alerts();
  check(al.length === 1 && /uncovered/.test(al[0].text) && al[0].key === `fwgap:${tower.id}` && /hurt|rest|ill/i.test(al[0].tip), `hurt: one alert (${al[0] ? al[0].text : "none"})`);
  FW.postPerson(st, tower.id, b.id, 0);
  tick(st, 2);
  check(!alerts().length, "someone else on the shift: the alert clears");
  // Away on a team: uncovered too.
  a.health = 100; a.conditions = [];
  FW.recallPerson(st, b.id);
  const tm = launchExpedition(st, { memberIds: [a.id], dest: st.grid.neighbors(hb.tile).find((id) => st.tiles[id].terrain !== "water"), mission: "move", stance: "normal", supplies: { food: 2, water: 2 } }).party;
  check(!!tm && FW.uncovered(st, tower) && /away/.test(FW.uncovered(st, tower).who[0].why), `away on a team: uncovered (${FW.uncovered(st, tower) ? FW.uncovered(st, tower).who.map((x) => x.why).join(", ") : "covered"})`);
  // The Tower sight layer.
  check(LAYERS.towersight && /Tower sight/.test(LAYERS.towersight.name), "a Tower sight map layer");
}

section("Help and Codex");
{
  const html = FW.fieldWorksHelp();
  check(/shifts/.test(html) && /Spike traps/.test(html) && /standing order/.test(html) && /groups raid each other|raid each other/.test(html), "Help: Field works covers the kinds, shifts, threats, repairs and hauling");
  const st = mk();
  standing(st, "snares", 2, (id) => ["forest", "hills", "plains"].includes(st.tiles[id].terrain));
  check(codexEntry("fw:snares") && codexEntry("fw:roadblock").stats.some(([k]) => k === "People"), "the codex has a field works entry per kind");
}

section("Determinism: the groups' field works replay the same on the same seed");
{
  const sig = (st) => FW.fwList(st).map((f) => `${f.kind}@${f.tile}:${f.built}:${Math.round(f.hp)}`).join(",");
  const run = () => { const st = createWorld({ seed: SEED, factionCount: 7 }); st.started = true; for (let i = 0; i < 24 * 25; i++) { tickHour(st); st.cards.length = 0; st.combat = null; } return sig(st); };
  const a = run(), b = run();
  check(a === b && a.length > 0, `two runs of 25 days: the same field works (${a.split(",").length})`);
}

section("Save and load");
{
  const state = mk();
  const h = hub(state);
  const tower = standing(state, "tower", 2);
  toHour(state, 12);
  const s = atBase(state, h.id).find((x) => !x.leader);
  s.health = 100; s.conditions = []; s.inBed = false;
  FW.postPerson(state, tower.id, s.id, 0);
  const pile = standing(state, "stockpile", 1);
  FW.depositAt(state, pile, "scrap", 7);
  FW.setHaul(state, pile, 5, 100);
  const loaded = deserializeState(serializeState(state));
  const lt = FW.fwAt(loaded, tower.tile), lp = FW.fwAt(loaded, pile.tile);
  const ls = loaded.survivors.find((x) => x.id === s.id);
  check(lt && lt.built && lt.garrison.includes(s.id) && FW.shiftOf(lt, s.id) && ls.location.kind === "post" && ls.location.fw === lt.id, "the tower, its shifts and its lookout out there round-trip");
  check(lp && lp.contents.scrap === 7 && lp.haul && lp.haul.every === 5 && lp.haul.atKg === 100, "the stockpile's goods and haul order round-trip");
  tick(loaded, 30);
  check(FW.fwAt(loaded, tower.tile) && FW.shiftOf(lt, s.id) && (ls.location.kind === "post" || ls.location.kind === "base"), "the loaded world runs on (the lookout on the day shift)");
  // An older save with no field works.
  delete state.fieldworks;
  for (const x of state.survivors) if (x.location.kind === "post") x.location = { kind: "base", baseId: h.id };
  const old = deserializeState(serializeState(state));
  tick(old, 48);
  check(Array.isArray(old.fieldworks.list), "an older save loads and runs (an empty table made on demand)");
}

console.log(`\n${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
