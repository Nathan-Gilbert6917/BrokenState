// Recover the convoy (src/sim/convoyrecover.js; the user's request 2026-10-25: "Recover the convoy. You can task a team
// or request an allied group to recover the convoy ..."):
//   1. your team: the mission is offered where your vehicles stand abandoned (and refused where none are known);
//   2. on arrival they join the team and the raid on the tile's map has them parked by the entry edge (combat.js
//      createRaid); out again, every vehicle with a driver comes with what fits of its cargo, the rest on the ground,
//      marked; the team heads for its base of origin;
//   3. too few drivers: the one nobody drives stays, cargo inside, marked;
//   4. already gone: a group took them, the card says who, the team turns for home;
//   5. a group: offered only when standing is good; the fee grows with the distance and the cargo; refused at war near
//      the convoy; the radio's answer at once vs the envoy's on arrival; delivered to a base, to a tile; the half refund
//      when the vehicles were gone; the party lost on the way leaves them where it happened;
//   6. an old save without the new fields loads.
// Usage: node tools/convoyrecoverytest.js [seed=7]
import { setFood } from "./foodkit.js";
import { createWorld, tickHour, hub, makeSurvivor, atBase, hurt } from "../src/sim/world.js";
import { addBuilding } from "../src/sim/buildings.js";
import { recomputeOwnership } from "../src/sim/factions.js";
import { planPath, launchExpedition, wipeIfEmpty, giveOrder, orderOptions, missionProblem, partyTile, removeParty, cargoLoad } from "../src/sim/parties.js";
import { partyVehicles, createVehicle, setPartyVehicles, vehicleCapacity } from "../src/sim/vehicles.js";
import { createBattle } from "../src/sim/combat.js";
import { groupWorldDaily, VEH } from "../src/sim/groupworld.js";
import { worksAt } from "../src/sim/groupworks.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { supWeight } from "../src/sim/data.js";
import * as D from "../src/sim/diplomacy.js";
import * as E from "../src/sim/envoys.js";
import * as R from "../src/sim/convoyrecover.js";

const SEED = Number(process.argv[2] || 7);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
const section = (t) => console.log(`\n${t}`);

const land = (st, t) => st.tiles[t].terrain !== "water" && st.tiles[t].terrain !== "mountain";
const free = (st, t) => land(st, t) && !st.tiles[t].loc && !st.factions.some((f) => f.bases.includes(t)) && !st.bases.some((b) => b.tile === t);
// A quiet world (as tools/envoystest.js): full stores at the hub, one group 6–9 tiles off with goodwill gw, the convoy's
// tile 3–5 tiles from the hub, clear of the dead (infection 0, no hordes), so the raid has nobody to fight.
function setup({ gw = 40, radio = false } = {}) {
  const st = createWorld({ seed: SEED, factionCount: 8 });
  Object.assign(st, { started: true, noNewGangs: true, noPlayerWars: true, noWars: true, noBlocs: true, noWanderers: true, noRoadblocks: true });
  const h = hub(st);
  Object.assign(h.stock, { water: 400, meds: 80, a_9mm: 900, scrap: 200, fuel: 200, parts: 40 }); setFood(h, 600);
  for (let i = 0; i < 8; i++) makeSurvivor(st, h.id);
  const g = st.grid;
  const ft = g.within(h.tile, 9).find((t) => g.distance(t, h.tile) >= 6 && free(st, t) && planPath(st, t, h.tile, false));
  const f = st.factions.find((x) => x.alive && !x.outsider);
  Object.assign(f, { type: "commune", bases: [ft], known: true, pop: 24, pact: "trade", goodwill: gw, works: {} });
  setFood(f, 400);
  Object.assign(f.stock, { fuel: 100, meds: 40, scrap: 100, parts: 20 });
  for (const o of st.factions) if (o !== f) { o.alive = false; o.bases = []; }
  st.hordes.length = 0;
  recomputeOwnership(st);
  D.ensureDiplo(st);
  if (radio) { addBuilding(h, "radio"); h.radio = true; worksAt(f, ft).radio = 1; }
  const tile = g.within(h.tile, 5).find((t) => g.distance(t, h.tile) >= 3 && free(st, t) && planPath(st, h.tile, t, true) && planPath(st, ft, t, true));
  st.tiles[tile].infection = 0;
  st.cards.length = 0;
  return { st, h, f, tile };
}
// Two vehicles of the hub lost with a team on the tile: abandoned there, cargo inside (parties.js wipeParty).
function loseConvoy(st, h, tile, scrapKg = 300) {
  const a = createVehicle(st, "truck", { kind: "base", baseId: h.id }, { fuel: 30, condition: 80 });
  const b = createVehicle(st, "van", { kind: "base", baseId: h.id }, { fuel: 30, condition: 80 });
  const crew = atBase(st, h.id).slice(0, 2);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "move", stance: "normal", vehicleIds: [a.id, b.id], supplies: { food: 0, water: 0, ammo: 0, meds: 0 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  setPartyVehicles(st, p, [a, b]);
  p.path = [tile]; p.idx = 0; p.progress = 0; p.phase = "waiting";
  p.cargo.supplies = { scrap: Math.ceil(scrapKg / supWeight("scrap")), meds: 6 };
  for (const s of crew) hurt(st, s, 9999, tile, "in a fight");
  wipeIfEmpty(st, p);
  st.cards.length = 0; // the leader's death and the like
  return [a, b];
}
function team(st, h, n, opts = {}) {
  const crew = atBase(st, h.id).slice(0, n);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "move", stance: "normal", supplies: { food: 2, water: 4, ammo: 0, meds: 0 }, ...opts });
  if (res.error) throw new Error(res.error);
  return res.party;
}
const at = (p, tile) => { p.path = [tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; };
const markOf = (st, v) => st.markers.find((m) => m.key === `vehicle:${v.id}`);
const groundKg = (st, tile) => ((st.deathSites.find((d) => d.tile === tile) || { items: [] }).items.filter((it) => it.kind === "supply").reduce((a, it) => a + it.qty * supWeight(it.key), 0));

section("1. the mission is offered where your vehicles stand");
{
  const { st, h, tile } = setup();
  const [a, b] = loseConvoy(st, h, tile);
  check(a.loc.kind === "abandoned" && b.loc.kind === "abandoned" && !!a.cargo, "the convoy stands abandoned with cargo inside");
  check(R.convoyAt(st, tile).length === 2 && missionProblem(st, tile, "convoy") === null, "Recover convoy can be sent there");
  check(/No vehicle of yours/.test(missionProblem(st, h.tile, "convoy") || ""), "and not where none is known");
  const p = team(st, h, 3);
  check(orderOptions(st, p, tile).some((o) => o.mission === "convoy" && !o.disabled), "the team's orders menu offers Recover convoy on that tile");
}

section("2. your team recovers it: the raid map holds the vehicles, it brings what fits home to its base of origin");
{
  const { st, h, tile } = setup();
  const [a, b] = loseConvoy(st, h, tile, 1200); // more than the pickup takes: the van holds the rest
  const kg0 = cargoLoad(a.cargo) + cargoLoad(b.cargo);
  const p = team(st, h, 3);
  // The raid map as the browser would open it: the vehicles joined, parked by the entry edge.
  const home0 = p.homeBaseId;
  at(p, tile);
  {
    const st2 = loadFromString(saveToString(st)), p2 = st2.parties.find((x) => x.id === p.id);
    const join = R.convoyAt(st2, tile);
    setPartyVehicles(st2, p2, join);
    const bt = createBattle(st2, { mode: "raid", tile, partyId: p2.id, canRetreat: true, ambush: null, handler: "convoyRecover", enemy: { kind: "zombies", count: 0, power: 3, name: "nobody", groups: [] }, raid: { heat0: 5, poi: null, kind: null, place: null, building: "street" }, context: { recover: join.map((v) => v.id), tile } });
    check(!!bt.vehicle && (bt.convoy || []).length === 1, `the raid map holds both vehicles: one in the entry zone, ${(bt.convoy || []).length} parked by the edge`);
  }
  // Too much in the team's own packs: the vehicles' payloads take the rest; a little stays on the ground.
  p.cargo.supplies = { scrap: Math.ceil(400 / supWeight("scrap")) };
  giveOrder(st, p, "convoy");
  const vs = partyVehicles(st, p);
  check(vs.includes(a) && vs.includes(b), `both vehicles came out with the team (${vs.map((v) => v.name).join(", ")})`);
  check(!a.cargo && !b.cargo, "none of their cargo is left inside the ones that go");
  const inTeam = cargoLoad(p.cargo);
  const ground = groundKg(st, tile);
  check(Math.abs(inTeam + ground - kg0 - 400) < supWeight("scrap") * 2, `what fits came with the team (${Math.round(inTeam)} kg), the rest on the ground there (${Math.round(ground)} kg)`);
  check(ground < 1 || st.markers.some((m) => m.type === "death" && m.tile === tile), "what was left on the ground is marked");
  check(!markOf(st, a) && !markOf(st, b), "the recovered vehicles' markers are gone");
  check(p.phase === "back" && p.homeBaseId === home0 && p.path[p.path.length - 1] === h.tile, "the team heads home to its base of origin");
  check(st.log.some((l) => /Convoy recovered at/.test(l.text)), "the diary says so");
  for (let i = 0; i < 200 && st.parties.includes(p); i++) tickHour(st);
  check(!st.parties.includes(p) && a.loc.kind === "base" && a.loc.baseId === h.id, "home: the vehicles parked at the base");
}

section("3. too few drivers: the vehicle nobody drives stays, cargo inside, marked");
{
  const { st, h, tile } = setup();
  const [a, b] = loseConvoy(st, h, tile, 1200);
  const p = team(st, h, 1);
  at(p, tile);
  giveOrder(st, p, "convoy");
  const vs = partyVehicles(st, p);
  const stayed = [a, b].find((v) => !vs.includes(v));
  check(vs.length === 1 && !!stayed && stayed.loc.kind === "abandoned" && stayed.loc.tile === tile, `one goes, the ${stayed && stayed.name} stays`);
  check(!!stayed && !!stayed.cargo && !!markOf(st, stayed), "it keeps its cargo and its marker for the next recovery");
  check(p.phase === "back", "the team heads home");
}

section("4. already gone: a group took them; the card names it");
{
  const { st, h, f, tile } = setup();
  const [a, b] = loseConvoy(st, h, tile);
  f.bases = [st.grid.within(tile, 2).find((t) => free(st, t) && t !== tile)];
  recomputeOwnership(st);
  const take0 = VEH.TAKE;
  VEH.TAKE = 1e9;
  for (let i = 0; i < 10 && R.convoyAt(st, tile).length; i++) groupWorldDaily(st, f);
  VEH.TAKE = take0;
  check(!R.convoyAt(st, tile).length && (st.vehiclesTaken || []).some((r) => r.fid === f.id && r.tile === tile), `${f.name} took both, remembered (${(st.vehiclesTaken || []).length})`);
  const p = team(st, h, 3);
  at(p, tile);
  giveOrder(st, p, "convoy");
  const card = st.cards.find((c) => c.title === "The convoy is gone");
  check(!!card && card.text.includes(f.name), `the card says who took them ("${card && card.text}")`);
  check(p.phase === "back" && !!p.convoyFailed, "the team turns for home");
}

section("5. a group: offered, priced, refused, by radio or envoy; delivered, refunded, lost");
{
  const { st, h, f, tile } = setup({ gw: 40 });
  loseConvoy(st, h, tile);
  check(R.recoverOffered(st, f), "offered to a group you stand well with");
  const fee = R.recoverFee(st, f, tile, null, h);
  check(fee.value > R.RECOVER.FEE.BASE && Object.keys(fee.goods).length && fee.short === 0, `a fee in goods (${JSON.stringify(fee.goods)}, worth ${fee.value})`);
  const far = st.tiles.filter((t) => free(st, t.id) && st.grid.distance(t.id, tile) > 10).sort((x, y) => st.grid.distance(x.id, tile) - st.grid.distance(y.id, tile))[0];
  check(R.recoverFee(st, f, tile, { kind: "tile", tile: far.id }, h).value > fee.value, "farther costs more");
  const old = f.goodwill;
  f.goodwill = -20;
  check(!R.recoverOffered(st, f) && /not friendly enough/.test(E.messageProblem(st, f, "recover", { tile }, h)), "not offered to a group you stand poorly with");
  f.goodwill = old;
  const foe = st.factions.find((x) => x !== f);
  Object.assign(foe, { alive: true, bases: [st.grid.within(tile, 3).find((t) => free(st, t))], known: true });
  D.ensureDiplo(st).wars.push({ id: 999, a: f.id, b: foe.id, since: 0 });
  check(/at war/.test(R.recoverAnswer(st, f, { tile }, 0).why), "refused while at war near the convoy");
  D.ensureDiplo(st).wars.pop();
  foe.alive = false; foe.bases = [];
  check(R.recoverAnswer(st, f, { tile }, 0).yes && !R.recoverAnswer(st, f, { tile }, 0.999).yes, "else the dice by standing");
}
{
  // Without radio: the envoy carries the fee and the request; the party goes when it arrives; delivered to a base.
  const { st, h, f, tile } = setup({ gw: 60 });
  const [a, b] = loseConvoy(st, h, tile);
  check(E.commsWith(st, f) === "envoy", "no radio link: by envoy");
  const fuel0 = h.stock.fuel;
  const r = E.communicate(st, { fid: f.id, kind: "recover", payload: { tile, dest: null }, memberIds: atBase(st, h.id).slice(0, 2).map((s) => s.id) });
  check(r.ok && !!r.party, `the envoy sets out with the fee (${r.text})`);
  check(!st.parties.some((p) => p.kind === "recovery"), "no party of theirs before the envoy gets there");
  let party = null;
  for (let i = 0; i < 400 && !party; i++) { tickHour(st); party = st.parties.find((p) => p.kind === "recovery") || null; }
  check(!!party && party.recovery && party.recovery.dest.kind === "base" && party.recovery.dest.baseId === h.id, "agreed on arrival (the dice at goodwill 60): their party goes; destination your nearest base");
  check(fuel0 > h.stock.fuel || Object.keys(r.msg.packed || {}).length > 0, "the fee came out of the hub's stores");
  const scrap0 = h.stock.scrap;
  for (let i = 0; i < 600 && st.parties.includes(party) && a.loc.kind !== "base"; i++) tickHour(st);
  check(a.loc.kind === "base" && a.loc.baseId === h.id && b.loc.kind === "base", "the vehicles joined the base");
  check(h.stock.scrap > scrap0 && !a.cargo && !b.cargo, "their cargo went into the stores");
  check(st.log.some((l) => /brought your convoy to/.test(l.text)), "logged");
}
{
  // With radio: the answer at once; delivered to a tile you picked: parked there, marked.
  const { st, h, f, tile } = setup({ gw: 60, radio: true });
  const [a] = loseConvoy(st, h, tile);
  check(E.commsWith(st, f) === "radio", "a radio link: the answer at once");
  const spot = st.grid.within(tile, 3).find((t) => free(st, t) && t !== tile && planPath(st, tile, t, true));
  const r = E.communicate(st, { fid: f.id, kind: "recover", payload: { tile, dest: { kind: "tile", tile: spot } }, memberIds: atBase(st, h.id).slice(0, 1).map((s) => s.id) });
  check(r.ok && /agreed on the radio/.test(r.text), `agreed on the radio (${r.text})`);
  let party = null;
  for (let i = 0; i < 400 && !party; i++) { tickHour(st); party = st.parties.find((p) => p.kind === "recovery") || null; }
  for (let i = 0; i < 600 && party && st.parties.includes(party) && !(a.loc.kind === "abandoned" && a.loc.tile === spot); i++) tickHour(st);
  check(a.loc.kind === "abandoned" && a.loc.tile === spot && !!markOf(st, a), "parked at the tile you picked, marked, as your abandoned vehicle");
  check(!!a.cargo, "with its cargo inside");
}
{
  // Gone before they got there: half the fee back, and word.
  const { st, h, f, tile } = setup({ gw: 60, radio: true });
  loseConvoy(st, h, tile);
  E.communicate(st, { fid: f.id, kind: "recover", payload: { tile, dest: null }, memberIds: atBase(st, h.id).slice(0, 1).map((s) => s.id) });
  let party = null;
  for (let i = 0; i < 400 && !party; i++) { tickHour(st); party = st.parties.find((p) => p.kind === "recovery") || null; }
  for (const v of R.convoyAt(st, tile)) st.vehicles.splice(st.vehicles.indexOf(v), 1); // someone else drove them off
  const caravans0 = st.parties.filter((p) => p.kind === "caravan" && p.owner === f.id).length;
  for (let i = 0; i < 400 && party && !party.recovery.failed; i++) tickHour(st);
  check(!!party && party.recovery.failed === "gone", "their party found the convoy gone");
  check(st.parties.filter((p) => p.kind === "caravan" && p.owner === f.id).length > caravans0 && st.log.some((l) => /Half the fee comes back/.test(l.text)), "half the fee comes back by their caravan");
  check(st.cards.some((c) => /your convoy/.test(c.title)), "and word of it (by radio: a card now)");
}
{
  // Lost on the way: the vehicles stay where it happened, abandoned, marked.
  const { st, h, f, tile } = setup({ gw: 60, radio: true });
  const [a, b] = loseConvoy(st, h, tile);
  E.communicate(st, { fid: f.id, kind: "recover", payload: { tile, dest: null }, memberIds: atBase(st, h.id).slice(0, 1).map((s) => s.id) });
  let party = null;
  for (let i = 0; i < 600 && !(party && party.recovery.phase === "carry"); i++) { tickHour(st); party = st.parties.find((p) => p.kind === "recovery") || null; }
  check(!!party && party.recovery.phase === "carry" && a.loc.kind === "towed", "their party drives the convoy");
  for (let i = 0; i < 2 && party.idx < party.path.length - 1; i++) tickHour(st);
  const where = partyTile(party);
  removeParty(st, party); // an ambush on the road (caravanraids.js gangAmbush) ends the same way
  check(a.loc.kind === "abandoned" && a.loc.tile === where && b.loc.kind === "abandoned" && !!markOf(st, a), "lost on the way: the vehicles stand abandoned where it happened, marked");
}

section("6. an old save loads");
{
  const { st, h, tile } = setup();
  loseConvoy(st, h, tile);
  delete st.vehiclesTaken;
  const st2 = loadFromString(saveToString(st));
  check(R.convoyAt(st2, tile).length === 2 && missionProblem(st2, tile, "convoy") === null, "the convoy is still there to recover");
  R.noteTaken(st2, st2.factions[0], R.convoyAt(st2, tile)[0], "took");
  check(st2.vehiclesTaken.length === 1, "the taken-vehicles list starts empty on an old save");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
