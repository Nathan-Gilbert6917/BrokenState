// Headless checks for team orders, movement and interaction (batch 3):
// - TEAM-02 a site can be scavenged / raided again after it is picked over (depletion lowers what it yields).
// - TEAM-03 right-click with a team selected: that team's actions for the tile (also a team on the move, out of
//   radio range), fitting the tile (a site: scavenge; your base: drop off / load; water: no move).
// - TEAM-04 a team on the move (out of radio range too) is picked on the map, its panel shows where it is and takes
//   orders, and the selection follows it as it travels.
// - TEAM-05 any number of your teams on one tile: hand goods over, move people across or split them off, merge; every
//   step conserves people, items and supplies, keeps capacity, drivers and seats, and leaves no stray ids.
// Usage: node tools/team3test.js [seed]
import { createWorld, hub, atBase, makeSurvivor } from "../src/sim/world.js";
import { launchExpedition, planPath, partyTile, glideAt, orderOptions, scavengeable, PICKED_OVER } from "../src/sim/parties.js";
import { afterRaid } from "../src/sim/scavenge.js";
import { poisOf } from "../src/sim/pois.js";
import { tileActions } from "../src/ui/ui.js";
import { picksAt, clickPick, syncPick, teamTileOf } from "../src/ui/mapselect.js";
import { selectedTeam } from "../src/ui/teamsel.js";
import { renderExpedition } from "../src/ui/expedition.js";
import { tickHour } from "../src/sim/world.js";
import { teamTileMenu, runTeamAction } from "../src/ui/teamctx.js";
import { giveGoods, moveMembers, mergeTeams, teamsTogether, teamsOnTile, meetProblem, teamCheck } from "../src/sim/teammeet.js";
import { partyMembers, partyCapacity, poolLoad } from "../src/sim/parties.js";
import { setPartyVehicles, createVehicle, partyVehicles } from "../src/sim/vehicles.js";
import { newItem, stripAll } from "../src/sim/inventory.js";
import { foodIn } from "../src/sim/foods.js";
import { SUPPLIES } from "../src/sim/data.js";
import { teamMeetModal, meetButton, meetLine, TEAMMEET_ACTIONS } from "../src/ui/teammeet.js";

const SEED = Number(process.argv[2] || 42);
let passed = 0, failed = 0;
const VERBOSE = !!process.env.VERBOSE;
const check = (ok, msg) => { if (ok) { passed++; if (VERBOSE) console.log(`  ok: ${msg}`); } else { failed++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 5 });
  state.started = true;
  state.noWanderers = true;
  state.cards = [];
  return state;
}
// The nearest land tile (not a base) within d..d2 of `from`, reachable on foot, that passes `ok`.
function find(state, from, ok, d = 1, d2 = 14) {
  const list = state.tiles.filter((t) => t.terrain !== "water" && !state.bases.some((b) => b.tile === t.id)).map((t) => [t, state.grid.distance(from, t.id)])
    .filter(([, dist]) => dist >= d && dist <= d2).sort((a, b) => a[1] - b[1]);
  for (const [t] of list) if (ok(t) && planPath(state, from, t.id, false)) return t.id;
  return null;
}
// A team of `n` from the hub, stood on `tile`, waiting.
function team(state, n, tile, { radio = false } = {}) {
  const h = hub(state);
  const crew = atBase(state, h.id).filter((s) => !state.parties.some((p) => p.members.includes(s.id))).slice(0, n);
  const dest = find(state, h.tile, () => true, 2, 3);
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; p.orders = []; p.radioLive = radio;
  state.cards = [];
  return p;
}

// ---------------------------------------------------------------------------------------------------------
section("TEAM-02: a site can be scavenged / raided again");
{
  const state = mk();
  const h = hub(state);
  // A site that is its only place: since the POI foundation (mapgen.js) the hub's suburb ring holds sites with other
  // points of interest beside them, and a raid with no POI pick strips only the site's own pool (scavenge.js
  // afterRaid), so the tile is "picked over" only once every place known there is (poiraid.js pickedOverAt).
  const site = find(state, h.tile, (t) => !!t.loc && t.loot > 0.2 && poisOf(t).length <= 1, 1, 14);
  if (check(site != null, "a site near the hub")) {
    const t = state.tiles[site];
    const p = team(state, 2, site);
    check(orderOptions(state, p).some((o) => o.mission === "scavenge"), "a fresh site offers Scavenge");
    const before = t.loot;
    // A full raid that searched everything: the site drops to its floor (scavenge.js afterRaid).
    afterRaid(state, { outcome: "extracted", loot: { supplies: {}, gear: [] }, raid: { hours: 0, searched: 40, total: 40 } }, { partyId: -1, tile: site, context: {} });
    check(t.loot < before && t.loot <= PICKED_OVER, `the raid picked it over (${before.toFixed(2)} → ${t.loot.toFixed(2)})`);
    const opt = orderOptions(state, p).find((o) => o.mission === "scavenge");
    check(opt && !opt.disabled, "a picked-over site still offers Scavenge (raid it again)");
    check(opt && /Picked over/.test(opt.desc), "…and says it is picked over");
    check(scavengeable(t), "scavengeable: a site is never closed");
    check(tileActions(state, site).some(([m]) => m === "scavenge"), "the hub's menu offers Scavenge / raid on it again");
    // A second raid on it: it stays at the floor (depletion kept), still open.
    afterRaid(state, { outcome: "extracted", loot: { supplies: {}, gear: [] }, raid: { hours: 0, searched: 5, total: 5 } }, { partyId: -1, tile: site, context: {} });
    check(t.loot >= 0.03 && orderOptions(state, p).some((o) => o.mission === "scavenge"), "a third raid is offered too; loot stays at its floor");
  }
  // Open ground with nothing left stays closed (nothing there to search).
  const open = find(state, h.tile, (t) => !t.loc && t.terrain !== "water", 2, 10);
  if (open != null) {
    const t = state.tiles[open];
    t.loot = 0.03;
    check(!scavengeable(t), "open ground with nothing left: no search");
    t.loot = 0.3;
    check(scavengeable(t), "open ground with something left: search");
  }
}

// ---------------------------------------------------------------------------------------------------------
section("TEAM-04: select a team while it moves");
{
  const state = mk();
  const h = hub(state);
  const far = find(state, h.tile, (t) => !t.loc, 9, 14);
  const p = team(state, 2, h.tile);
  p.path = planPath(state, h.tile, far, false).path; p.idx = 0; p.phase = "out"; p.dest = far; p.mission = "move";
  for (let i = 0; i < 40 && (p.radioLive || p.idx < 2); i++) { p.lastConflict = state.hour + 1; tickHour(state); state.cards = []; if (p.phase !== "out") break; }
  if (check(p.phase === "out" && p.idx < p.path.length - 1, `the team is on the move (${p.phase}, step ${p.idx}/${p.path.length - 1}, radio ${p.radioLive})`)) {
    const tile = teamTileOf(state, p);
    check(tile === partyTile(p) || p.path.indexOf(tile) === p.idx + 1, "the map shows it where it is (its tile or the next it is nearer to, not an estimate)");
    const picks = picksAt(state, tile, new Set());
    check(picks.some((x) => x.kind === "team" && x.id === p.id), "its tile offers it as a pick");
    const ui = { selected: null, mapSel: null, expedition: null, selParty: null, xpMsg: "" };
    const got = clickPick(state, ui, tile);
    check(got && got.kind === "team" && ui.expedition === p.id, "a click on its tile selects it (its team panel)");
    syncPick(state, ui);
    check(selectedTeam(state, ui) === p, "it is the selected team (right-click orders go to it)");
    const html = renderExpedition(state, ui, p);
    check(/At /.test(html) && !/No radio contact/.test(html) && /Redirect…/.test(html), "the right panel shows where it is and its orders while it travels");
    // It walks on: the selection follows.
    const from = partyTile(p);
    for (let i = 0; i < 12 && partyTile(p) === from && p.phase === "out"; i++) { p.lastConflict = state.hour + 1; tickHour(state); state.cards = []; }
    syncPick(state, ui);
    check(partyTile(p) === from || ui.selected === teamTileOf(state, p), `the selection follows it (${ui.selected} / ${partyTile(p)})`);
    check(ui.expedition === p.id, "its panel stays open as it moves");
    // TEAM-03: right-click a site with this moving team selected: its own actions for the site.
    const site = find(state, partyTile(p), (t) => !!t.loc && t.loot > 0.1, 1, 8);
    if (check(site != null, "a site near the moving team")) {
      const sel = selectedTeam(state, ui);
      const m = teamTileMenu(state, ui, sel, site);
      const it = (k) => m.items.find((x) => x.key === k);
      check(m.p === p && it("move") && !it("move").disabled, "TEAM-03: the menu is the selected team's: Move here, enabled");
      check(it("mission:scavenge") && !it("mission:scavenge").disabled, "TEAM-03: Scavenge / raid the site, enabled");
      check(!m.items.some((x) => x.key === "drop" || x.key === "load"), "TEAM-03: no base actions on a site");
      check(m.items.some((x) => x.key === "home"), "TEAM-03: Go home offered");
      const msg = runTeamAction(state, ui, { id: p.id, tile: site, key: "mission:scavenge", mode: "replace" });
      check(p.phase === "out" && p.path[p.path.length - 1] === site, `TEAM-03: the order is given to the moving team (${msg})`);
      const hm = teamTileMenu(state, ui, sel, hub(state).tile);
      // Its other places can be raided from your base too (the user's word 2026-10-23), but no other site action.
      check(hm.items.some((x) => x.key === "drop") && hm.items.filter((x) => x.key.startsWith("mission:")).every((x) => x.key === "mission:scavenge" || x.key === "mission:enter"), "TEAM-03: on your base, the base actions (and a raid of its tile's places)");
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
section("TEAM-05: teams together on a tile");
{
  const state = mk();
  const h = hub(state);
  const tile = find(state, h.tile, (t) => !t.loc, 3, 6);
  const A = team(state, 2, tile), B = team(state, 2, tile), C = team(state, 1, tile);
  for (const p of [A, B, C]) for (const s of partyMembers(state, p)) stripAll(s);
  A.supplies.water = 10; A.supplies.scrap = 6; A.cargo.supplies.parts = 3;
  const knife = newItem("knife", 1); A.cargo.gear.push(knife);
  // Totals over the three: what must never change.
  const all = () => [A, B, C].filter((p) => state.parties.includes(p));
  const total = (k) => all().reduce((a, p) => a + (p.supplies[k] || 0) + (p.cargo.supplies[k] || 0), 0);
  const food = () => all().reduce((a, p) => a + foodIn(p.supplies) + foodIn(p.cargo.supplies), 0);
  const people = () => all().flatMap((p) => p.members).sort((x, y) => x - y).join(",");
  const items = () => all().reduce((a, p) => a + p.cargo.gear.length + partyMembers(state, p).reduce((b, m) => b + Object.values(m.gear).filter(Boolean).length + (m.pockets || []).filter(Boolean).length, 0), 0);
  const keys = Object.keys(SUPPLIES).filter((k) => k !== "food");
  const snap = () => ({ people: people(), items: items(), food: Math.round(food() * 100), sup: keys.map((k) => Math.round(total(k) * 1000)).join(",") });
  const same = (a, b) => a.people === b.people && a.items === b.items && a.food === b.food && a.sup === b.sup;
  const ok = (what) => { const f = teamCheck(state); check(!f.length, `${what}: no stray ids (${f.join("; ")})`); };
  check(teamsTogether(state, A).length === 2 && teamsOnTile(state, tile).length === 3, "three teams on one tile: each sees the other two");
  const s0 = snap();

  // Goods: supplies by key, found cargo staying found, an item into the cargo and onto a member.
  const bw = B.supplies.water || 0, bp = B.cargo.supplies.parts || 0, ap = A.cargo.supplies.parts;
  let r = giveGoods(state, A, B, { supplies: { water: 4, parts: 2 } });
  check(B.supplies.water === bw + 4 && B.cargo.supplies.parts === bp + 2 && A.supplies.water === 6 && A.cargo.supplies.parts === ap - 2, `supplies move: packed to packed, found to found (${r.text})`);
  r = giveGoods(state, A, B, { items: [`cargo:${A.id}:list:${A.cargo.gear.indexOf(knife)}`] });
  check(B.cargo.gear.includes(knife) && !A.cargo.gear.includes(knife), `an item into the other team's cargo (${r.text})`);
  const bm = partyMembers(state, B)[0];
  r = giveGoods(state, B, C, { items: [knife] }, partyMembers(state, C)[0].id);
  const cm = partyMembers(state, C)[0];
  check(Object.values(cm.gear).includes(knife) || (cm.pockets || []).includes(knife), `onto a member of the third team (${r.text})`);
  check(same(snap(), s0), "goods moved: nothing made or lost");
  ok("after goods");
  // More than the other team can carry: refused or capped, nothing lost.
  A.supplies.scrap = 400;
  const before = snap();
  r = giveGoods(state, A, C, { supplies: { scrap: 400 } });
  check(poolLoad(C) <= partyCapacity(state, C) + 1e-6 && r.refused.length, `over the other team's capacity: only what fits (${r.text})`);
  check(same(snap(), before), "…and the rest stays (conserved)");
  A.supplies.scrap = 6; // (setup: A within its carry limit again)
  // Not on the same tile, or on the move: refused, nothing changes.
  const D = team(state, 1, find(state, h.tile, (t) => !t.loc && t.id !== tile, 2, 6));
  check(/same tile/.test(meetProblem(state, A, D)), "a team elsewhere cannot meet");
  B.phase = "out"; B.path = [tile, D.path[0]]; B.idx = 0;
  const bs = snap();
  check(/on the move/.test(giveGoods(state, A, B, { supplies: { water: 1 } }).text) && same(snap(), bs), "a team on the move: refused, nothing moved");
  B.phase = "waiting"; B.path = [tile]; B.idx = 0;

  // People across: one of A's to B.
  const s1 = snap();
  const am = partyMembers(state, A)[0];
  r = moveMembers(state, A, B, [am.id]);
  check(!r.error && B.members.includes(am.id) && !A.members.includes(am.id) && am.location.partyId === B.id, `a member goes over to the other team (${r.text})`);
  check(same(snap(), s1), "people moved: everyone still on exactly one team, goods unchanged");
  ok("after moving a member");
  check(moveMembers(state, A, B, [am.id]).error, "someone not on that team cannot be moved (no duplicates)");

  // Split: B splits one off as a new team on the tile, with a share of the packed water.
  const nb = partyMembers(state, B).length;
  const s2 = snap();
  const before2 = state.parties.length;
  const pick = partyMembers(state, B)[0];
  r = moveMembers(state, B, null, [pick.id]);
  const N = r.party;
  check(!r.error && N && N !== B && state.parties.length === before2 + 1 && N.members.length === 1 && partyMembers(state, B).length === nb - 1 && partyTile(N) === tile, `split off as a new team on the tile (${r.text})`);
  check(N && N.phase === "waiting" && N.id !== B.id && !state.parties.some((q) => q !== N && q.id === N.id), "the new team has its own id and waits for orders");
  const withN = () => [A, B, C, N].filter((p) => state.parties.includes(p));
  const totalN = (k) => withN().reduce((a, p) => a + (p.supplies[k] || 0) + (p.cargo.supplies[k] || 0), 0);
  check(Math.abs(totalN("water") - total("water") - (N.supplies.water || 0)) < 1e-6 && Math.round((totalN("water")) * 1000) === Number(s2.sup.split(",")[keys.indexOf("water")]), "the split's water came out of the team's own (conserved)");
  check(moveMembers(state, B, null, partyMembers(state, B).map((s) => s.id)).error, "splitting everyone off is refused (that is not a split)");
  ok("after a split");

  // Merge: N back into B (any number of teams: then C into A).
  const s3 = withN().flatMap((p) => p.members).sort((x, y) => x - y).join(",");
  r = mergeTeams(state, B, N);
  check(!r.error && !state.parties.includes(N) && B.members.includes(pick.id) && pick.location.partyId === B.id, `merge: the team is gone, its people on the other (${r.text})`);
  check([A, B, C].filter((p) => state.parties.includes(p)).flatMap((p) => p.members).sort((x, y) => x - y).join(",") === s3, "merge: nobody lost or doubled");
  check(same(snap(), s2), `split then merged back: people, items, food and every supply as before (food ${snap().food} / ${s2.food})`);
  ok("after a merge");
  const cGear = C.cargo.gear.length + B.cargo.gear.length;
  const cWater = total("water");
  r = moveMembers(state, C, A, partyMembers(state, C).map((s) => s.id)); // everyone across: a merge
  check(!r.error && !state.parties.includes(C) && r.party === A, `moving everyone across merges the teams (${r.text})`);
  check(Math.abs(total("water") - cWater) < 1e-6 && A.cargo.gear.length + B.cargo.gear.length === cGear, "the merged team's goods came along");
  ok("after the second merge");

  // Vehicles: a team keeps a driver for each; a merge with more than seats allows is refused.
  const car = createVehicle(state, "sedan", { kind: "base", baseId: h.id });
  setPartyVehicles(state, B, [car]);
  const bn = partyMembers(state, B);
  if (bn.length >= 1) {
    const r2 = moveMembers(state, B, A, bn.map((s) => s.id).slice(0, bn.length)); // everyone: a merge, the car comes along
    check(!r2.error && partyVehicles(state, A).includes(car) && car.loc.partyId === A.id, `merging brings the vehicle along (${r2.text})`);
  }
  ok("after a merge with a vehicle");
  // A team with two cars and two people: splitting one off would leave a car without a driver.
  const car2 = createVehicle(state, "sedan", { kind: "base", baseId: h.id });
  const an = partyMembers(state, A);
  setPartyVehicles(state, A, [...partyVehicles(state, A), car2]);
  const keep = an.length - 2; // split off all but two: two drivers left for two cars (allowed); all but one: refused
  if (an.length >= 3) {
    const sv = snap();
    const r3 = moveMembers(state, A, null, an.slice(0, an.length - 1).map((s) => s.id));
    check(/driver|person/i.test(r3.error || "") && same(snap(), sv), `a split leaving a car without a driver is refused, nothing moved (${r3.text})`);
    void keep;
  }
  // Two vehicles (a sedan and a bike: 5 seats) for more than 5 people: the merge is refused.
  for (let i = 0; i < 4; i++) { const ns = makeSurvivor(state, 1); ns.location = { kind: "base", baseId: h.id }; state.survivors.push(ns); }
  const D2 = team(state, 3, tile);
  const bike = createVehicle(state, "bike", { kind: "base", baseId: h.id }, { count: 1 });
  setPartyVehicles(state, A, [car]);
  car2.loc = { kind: "base", baseId: h.id }; // (setup: the second car parked again)
  setPartyVehicles(state, D2, [bike]);
  const sm = snap();
  const big = mergeTeams(state, A, D2);
  const n = partyMembers(state, A).length + partyMembers(state, D2).length;
  check(n > 5 ? /seat/i.test(big.error) && same(snap(), sm) : !big.error, `two vehicles need a seat for everyone (${n} people, 5 seats: ${big.text || "merged"})`);
  ok("at the end");
}

// ---------------------------------------------------------------------------------------------------------
section("TEAM-05: vehicles go with their drivers; every vehicle keeps someone on its team to drive it");
{
  const state = mk();
  const h = hub(state);
  for (let i = 0; i < 6; i++) { const ns = makeSurvivor(state, 1); ns.location = { kind: "base", baseId: h.id }; state.survivors.push(ns); }
  const tile = find(state, h.tile, (t) => !t.loc, 3, 6);
  const X = team(state, 2, tile), Y = team(state, 2, tile), Z = team(state, 1, tile);
  const car = (n) => createVehicle(state, "sedan", { kind: "base", baseId: h.id }, { name: n });
  const c1 = car("Car one"), c2 = car("Car two"), c3 = car("Car three");
  setPartyVehicles(state, X, [c1, c2]); // two cars, two people: each has its driver
  setPartyVehicles(state, Z, [c3]);     // one car, one person
  const ok = (what) => { const f = teamCheck(state); check(!f.length, `${what}: no stray ids (${f.join("; ")})`); };
  const vs = (p) => partyVehicles(state, p).map((v) => v.id).sort().join(",");
  const [x0, x1] = partyMembers(state, X);
  // The driver alone: the car he would leave has nobody to drive it.
  let r = moveMembers(state, X, Y, [x0.id]);
  check(/driv|person/i.test(r.error) && X.members.includes(x0.id) && vs(X) === [c1.id, c2.id].sort().join(","), `a driver alone, leaving a car with nobody to drive it: refused, nothing moved (${r.text})`);
  // The driver with the car: allowed.
  r = moveMembers(state, X, Y, [x0.id], [c2.id]);
  check(!r.error && Y.members.includes(x0.id) && partyVehicles(state, Y).includes(c2) && c2.loc.partyId === Y.id && !partyVehicles(state, X).includes(c2), `the driver with the car: both go (${r.text})`);
  ok("after driver and car");
  // Y has 3 people and one car: one of them can go alone (someone else drives it).
  const y0 = partyMembers(state, Y).find((s) => s.id !== x0.id);
  r = moveMembers(state, Y, X, [y0.id]);
  check(!r.error && X.members.includes(y0.id), `a driver alone when someone left can drive the car: allowed (${r.text})`);
  ok("after a lone driver");
  // A car alone to a team with nobody free to drive it (Z: one person, one car): refused.
  r = moveMembers(state, X, Z, [], [c1.id]);
  check(/driv|person/i.test(r.error) && partyVehicles(state, X).includes(c1), `a car alone to a team with no spare driver: refused (${r.text})`);
  // A car alone to a team with someone free to drive it (Y now: 2 people, 1 car → 2 cars, 2 people): allowed.
  check(partyMembers(state, Y).length >= partyVehicles(state, Y).length + 1, "(setup: Y has a spare driver)");
  r = moveMembers(state, X, Y, [], [c1.id]);
  check(!r.error && partyVehicles(state, Y).includes(c1) && c1.loc.partyId === Y.id && !partyVehicles(state, X).includes(c1), `a car alone to a team with a spare driver: allowed (${r.text})`);
  ok("after a car alone");
  // Split with a vehicle: the new team drives it.
  const z0 = partyMembers(state, Y)[0];
  const yv = partyVehicles(state, Y)[0];
  const ny = partyMembers(state, Y).length, nv = partyVehicles(state, Y).length;
  r = moveMembers(state, Y, null, [z0.id], [yv.id]);
  if (ny - 1 >= nv - 1) check(!r.error && r.party && partyVehicles(state, r.party).includes(yv) && yv.loc.partyId === r.party.id, `split off with a car: the new team has it (${r.text})`);
  check(moveMembers(state, X, null, [], partyVehicles(state, X).map((v) => v.id)).error, "a car cannot split off with nobody in it");
  ok("at the end");
}

// ---------------------------------------------------------------------------------------------------------
section("TEAM-05: the Teams together window, its ways in and its buttons");
{
  const state = mk();
  const h = hub(state);
  const tile = find(state, h.tile, (t) => !t.loc, 3, 6);
  const A = team(state, 2, tile), B = team(state, 2, tile), C = team(state, 1, tile);
  const ok = (what) => { const f = teamCheck(state); check(!f.length, `${what}: no stray ids (${f.join("; ")})`); };
  const ui = { selected: tile, expedition: A.id, selParty: A.id };
  const act = (k, d) => TEAMMEET_ACTIONS[k](state, ui, d);
  check(/Teams together \(3\)/.test(meetButton(state, tile)), "the tile panel offers Teams together (3)");
  check(/tm-open/.test(meetLine(state, A)) && /Here too/.test(meetLine(state, A)), "the team panel names the teams here and opens the window");
  const m = teamTileMenu(state, ui, A, tile);
  const it = m.items.find((x) => x.key === "meet");
  check(it && !it.disabled, "the right-click menu on its own tile: Teams together…");
  let opened = null;
  runTeamAction(state, ui, { id: A.id, tile, key: "meet", mode: "replace" }, { "tm-open": (d) => { opened = d; act("tm-open", d); } });
  check(opened && ui.meet && ui.meet.a === A.id && ui.meet.b !== A.id, "…which opens the window with this team on the left");
  let html = teamMeetModal(state, ui);
  check(typeof html === "string" && /Teams together/.test(html) && /Move picked/.test(html) && /Right into left/.test(html), "the window renders: people, move, split, merge");
  // Any number: the right side can be any of the others.
  act("tm-side", { side: "b", id: C.id });
  check(ui.meet.b === C.id, "the right side switches to the third team");
  act("tm-side", { side: "b", id: B.id });
  // Move a person across with the buttons.
  const a0 = partyMembers(state, A)[0];
  act("tm-person", { id: a0.id });
  act("tm-move", { from: A.id, to: B.id });
  check(B.members.includes(a0.id) && !A.members.includes(a0.id), `Move picked → (${ui.meet.msg})`);
  ok("after Move picked");
  // Split one off from B: the new team takes the right side.
  const b0 = partyMembers(state, B)[0];
  act("tm-swap");
  act("tm-person", { id: b0.id });
  act("tm-split", { from: B.id });
  const N = state.parties.find((q) => q.members.includes(b0.id));
  check(N && N !== B && N !== A && N !== C && (ui.meet.a === N.id || ui.meet.b === N.id), `Split picked off: a new team, shown in the window (${ui.meet.msg})`);
  ok("after Split");
  // Goods: hand water from A to B.
  ui.meet.a = A.id; ui.meet.b = B.id;
  act("tm-tab", { tab: "goods" });
  html = teamMeetModal(state, ui);
  check(/Give picked/.test(html), "the goods tab renders");
  const aw = A.supplies.water, bw = B.supplies.water;
  act("tm-sup", { key: "water" });
  ui.meet.sup.water = 2;
  act("tm-give");
  check(A.supplies.water === aw - 2 && B.supplies.water === bw + 2, `Give picked → (${ui.meet.msg})`);
  ok("after Give");
  // Merge everything into A, one by one: the window closes itself when only one team is left.
  act("tm-tab", { tab: "people" });
  act("tm-merge", { into: A.id, from: B.id });
  act("tm-merge", { into: A.id, from: C.id });
  ui.meet.a = A.id; ui.meet.b = N.id;
  act("tm-merge", { into: A.id, from: N.id });
  check(state.parties.filter((q) => q.owner === "player" && partyTile(q) === tile).length === 1 && partyMembers(state, A).length === 5, `merged into one team of 5 (${ui.meet.msg})`);
  check(teamMeetModal(state, ui) === null && ui.meet === null, "one team left: the window closes");
  ok("after the merges");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
