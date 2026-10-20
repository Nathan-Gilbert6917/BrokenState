// Occupy (src/sim/occupy.js): moving into an abandoned base (groupworld.js state.abandoned). Your lost outpost kept
// with its own buildings (wear and damage) and stores, reoccupied end to end with the mission and the card; a group's
// base taken over with its works as buildings within the plots; what is inside (the dead, squatters, those killed in a
// failed attempt); who it angers (the former owner, claims taken: goodwill, and between groups relations); the rot of
// an empty base; the AI side (a group moving in pays in people); the planner's problems and the team's orders; the
// governor choosing to occupy instead of founding an outpost; save/load of an abandoned base and of one moved into.
// Usage: node tools/occupytest.js [seed=42]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, atBase, day, makeSurvivor, newId, removeBase, snapshot } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { addBuilding, addRing, piecesOf, isPiece, wallTier, plotsUsed, plotCap, count, underAttack } from "../src/sim/buildings.js";
import { launchExpedition, partyMembers, outpostName, orderOptions, planPath, giveOrder, missionProblem, MISSIONS } from "../src/sim/parties.js";
import { recomputeOwnership, attitude } from "../src/sim/factions.js";
import { setAutopilot, occupyCandidate, doomedOutpost, autopilotDaily } from "../src/sim/autopilot.js";
import { season } from "../src/sim/weather.js";
import { supplyLine } from "../src/sim/economy.js";
import { claimsTaken } from "../src/sim/claims.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { relation } from "../src/sim/diplomacy.js";
import { overwriteClaims, CLAIM } from "../src/sim/claims.js";
import * as G from "../src/sim/groupworld.js";
import * as O from "../src/sim/occupy.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.noNewGangs = true; st.erasOff = true; st.noWanderers = true; return st; };
const pick = (card, re) => card.choices.find((c) => re.test(c.label));
const free = (st, t) => st.tiles[t].terrain !== "water" && st.tiles[t].terrain !== "mountain" && st.tiles[t].owner == null && !st.factions.some((f) => f.bases.includes(t)) && !st.bases.some((b) => b.tile === t) && !st.hordes.some((h) => h.tile === t);
function nearFree(st, from, lo, hi) {
  const g = st.grid;
  return g.within(from, hi).find((t) => g.distance(t, from) >= lo && free(st, t) && planPath(st, from, t, false));
}
function outpost(st, tile) {
  const b = { id: newId(), tile, type: "outpost", name: outpostName(st, tile), stock: { water: 40, fuel: 4, meds: 6, ammo: 0, parts: 4, scrap: 30, jars: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  setFood(b, 60); // 60 days of ration bars (tools/foodkit.js)
  st.bases.push(b);
  recomputeOwnership(st);
  return b;
}
function fighters(st, n, at) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = makeSurvivor(st, 1);
    s.traits = []; s.skills.shooting = 10; s.health = 100;
    s.gear.weapon = { key: GEAR.assault ? "assault" : "shotgun", name: (GEAR.assault || GEAR.shotgun).name, quality: 1 };
    s.gear.armor = { key: "vest", name: GEAR.vest.name, quality: 1 };
    s.location = { kind: "base", baseId: at.id };
    st.survivors.push(s);
    out.push(s);
  }
  return out;
}
const daysOn = (st, n) => { st.hour += 24 * n; };
const roundTrip = (st) => deserializeState(JSON.parse(JSON.stringify(serializeState(st, { dropCards: true }))));

// ======================================================================================
section("Your lost outpost stands empty with its buildings and stores");
let lost, ring, nB; // { st, tile, name } for the next section; the wall's pieces and the buildings in all
{
  const st = world();
  const h = hub(st);
  const tile = nearFree(st, h.tile, 3, 6);
  st.tiles[tile].infection = 0;
  const b = outpost(st, tile);
  ring = addRing(b, 1, 20); // the wall: a ring of wooden pieces (buildings.js), worn
  nB = ring.length + 3;
  addBuilding(b, "well");
  const bunk = addBuilding(b, "bunkhouse"); bunk.broken = { day: 1, cause: "raid" }; bunk.wear = 100;
  addBuilding(b, "craftbench");
  const name = b.name;
  removeBase(st, b, "was abandoned");
  const rec = G.abandonedAt(st, tile);
  check(rec && rec.from === "player" && rec.buildings.length === nB, `the record keeps its ${nB} buildings: the wall's pieces and 3 more (${rec && rec.buildings.length})`);
  check(rec && rec.works.walls === 1 && rec.works.water === 1 && rec.works.bench === 1 && !rec.works.beds, `its works for the groups: ${JSON.stringify(rec && rec.works)} (the broken bunkhouse counts for nothing)`);
  check(rec && Math.abs(food(rec) - 30) < 1e-6 && rec.stock.scrap === 15 && !rec.stock.water, `half its stores stay, no water (${JSON.stringify(rec && rec.stock)})`);
  check(st.log.some((l) => /Occupy it/.test(l.text || l)), "the log says it can be occupied");
  const th = G.abandonedThreat(st, tile);
  check(th && JSON.stringify(th) === JSON.stringify(G.abandonedThreat(st, tile)), "what is inside is the same each time it is asked on a day");
  check(th.dead >= G.ABANDON.DEAD_BASE || th.squat > 0, `inside: ${O.threatText(th)}`);
  check(missionProblem(st, tile, "occupy") === null, `the planner can send Occupy there (${missionProblem(st, tile, "occupy")})`);
  check(!!MISSIONS.occupy && !MISSIONS.occupy.hidden, "Occupy is on the planner's mission list");
  const at = { path: [tile], idx: 0, supplies: {}, cargo: { supplies: {}, gear: [] } };
  const opts = orderOptions(st, at);
  check(opts.some((o) => o.mission === "occupy" && !o.disabled) && !opts.some((o) => o.mission === "outpost"), "a team on the tile is offered Occupy, not Build outpost");
  // The snapshot (your map) knows of it.
  check(st.knowledge[tile] && st.knowledge[tile].abandoned && st.knowledge[tile].abandoned.fromName === name, "the map's last look shows the empty base");
  // The screens: the right-click actions, the tile panel and the planner with the threat preview.
  const UI = await import("../src/ui/ui.js");
  const acts = UI.tileActions(st, tile);
  check(acts.some(([m]) => m === "occupy") && !acts.some(([m]) => m === "outpost"), `right-click: ${acts.map(([, l]) => l).join(", ")}`);
  const panel = UI.renderRight(st, { started: true, selected: tile, tab: "bases" });
  check(/your old outpost/.test(panel) && /Standing/.test(panel) && /Inside/.test(panel), "the tile panel shows the empty base, what stands and who is inside");
  const crew = atBase(st, hub(st).id).slice(0, 2).map((s) => s.id);
  const modal = UI.renderModal(st, { started: true, planner: { dest: tile, mission: "occupy", crew: new Set(crew), vehicleId: null, stance: "normal", supplies: { food: 6, water: 6 } }, plannerError: "" }) || "";
  check(/Occupy abandoned base/.test(modal) && /Inside: /.test(modal) && /to clear it/.test(modal) && /no plan after it/.test(modal), "the planner: the mission, who is inside, the crew's odds, no plan after it");
  lost = { st, tile, name };
}

// ======================================================================================
section("Reoccupying it: the mission, the card, the fight, the buildings and stores");
{
  const { st, tile, name } = lost;
  const h = hub(st);
  const squad = fighters(st, 4, h);
  Object.assign(h.stock, { water: 200, meds: 20 }); setFood(h, 200);
  const res = launchExpedition(st, { memberIds: squad.map((s) => s.id), dest: tile, mission: "occupy", stance: "normal", supplies: { food: 12, water: 12, meds: 2 } });
  check(!res.error, `the team leaves (${res.error || "ok"})`);
  const p = res.party;
  // The road there is other tools' business: the team is put at the gate and given the order there.
  p.path = [tile]; p.idx = 0;
  const rec = G.abandonedAt(st, tile);
  const th = G.abandonedThreat(st, tile);
  console.log(`  inside: ${O.threatText(th)}`);
  giveOrder(st, p, "occupy");
  if (th.count) {
    const card = st.cards.find((c) => c.occupy);
    check(!!card, "at the gate: the Occupy card");
    const go = card && pick(card, /^Clear it out/);
    check(go && /\d+%/.test(go.hint) && go.fight && go.fight.odds >= 0.8, `it shows the odds (${go && go.hint.slice(0, 50)}…)`);
    check(go && go.ai(st) > 0, "the governor would clear it at these odds");
    if (card) { st.cards.splice(st.cards.indexOf(card), 1); go.resolve(st); }
  } else check(true, "nobody inside: the team moved straight in");
  const b = st.bases.find((x) => x.tile === tile);
  check(!!b, "the base is yours again");
  if (b) {
    check(b.name === name && b.type === "outpost", `under its old name, an outpost (${b.name})`);
    check(b.buildings.length === nB, `its buildings stand (${b.buildings.length}: the wall's ${ring.length} pieces, ${b.buildings.filter((x) => !isPiece(x.type)).map((x) => x.type).join(", ")})`);
    const bk = b.buildings.find((x) => x.type === "bunkhouse");
    check(bk && bk.broken, "the broken bunkhouse is still broken (repair it)");
    const wl = piecesOf(b);
    check(wl.length === ring.length && wl.every((x) => x.wear === 20) && wallTier(b) === 1, `the wall kept its pieces and their wear (${wl.length}, ${wl[0] && wl[0].wear})`);
    check(food(b) >= food(rec) && b.stock.scrap >= rec.stock.scrap, `the stores left there are its stock (food ${food(b)}, scrap ${b.stock.scrap})`);
    check(atBase(st, b.id).length === squad.filter((s) => s.alive).length, `the team lives there (${atBase(st, b.id).length})`);
    check(!G.abandonedAt(st, tile) && !st.parties.includes(p), "the record and the team are gone");
    check(b.occupiedFrom && b.occupiedFrom.from === "player", "the base remembers it was moved into");
    check(missionProblem(st, tile, "occupy") === "You already have a base there.", "no second Occupy on it");
    // Save and load the base moved into.
    const l = roundTrip(st);
    const lb = l.bases.find((x) => x.tile === tile);
    check(lb && lb.buildings.length === nB && lb.occupiedFrom && lb.buildings.find((x) => x.type === "bunkhouse").broken, "save/load: the base, its buildings and damage");
  }
}

// ======================================================================================
section("A group's base: its works as buildings, within the plots");
{
  const st = world(seed + 1);
  const h = hub(st);
  const tile = nearFree(st, h.tile, 4, 8);
  const f = st.factions.find((x) => x.alive);
  st.abandoned = [{ tile, from: f.id, fromName: f.name, works: { walls: 7, farms: 2, water: 1, beds: 8, bench: 1, store: 1 }, stock: { food: 40, scrap: 12, meds: 3 }, day: day(st) - 35 }];
  f.alive = false; // it died out
  const before = st.bases.length;
  const text = O.takeAbandoned(st, tile, null);
  const b = st.bases.find((x) => x.tile === tile);
  check(b && st.bases.length === before + 1 && b.type === "outpost", "the empty base is your outpost");
  if (b) {
    check(!count(b, "walls") && wallTier(b) === 4 && piecesOf(b, ["gate"]).length === 4, `7 wall points: 3 sections, a ring of tier-4 pieces (buildings.js WALL_TIERS, addRing; tier ${wallTier(b)})`);
    check(b.buildings.filter((x) => x.type === "farm_plot").length === 2 && count(b, "well") === 1 && count(b, "workbench") === 1, "fields as farm plots, a well, the workshop as a workbench");
    check(plotsUsed(b, "building") <= plotCap(b, "building"), `building plots ${plotsUsed(b, "building")}/${plotCap(b, "building")}: what does not fit is rubble`);
    check(/beyond saving/.test(text), `the log says what was lost (${text.slice(0, 120)}…)`);
    const wear = O.OCCUPY.WEAR + O.OCCUPY.WEAR_AGE;
    check(b.buildings.every((x) => x.wear === wear), `battered: wear ${wear} after a month empty`);
    check(Math.abs(food(b) - 40) < 1e-6 && b.stock.scrap === 12 && b.stock.meds === 3, "their stores are yours");
    check(st.tiles[tile].owner === "player", "the land round it is yours");
  }
}

// ======================================================================================
section("Who it angers: the group whose base it was, the claims round it");
{
  const st = world(seed + 2);
  const h = hub(st);
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const o = st.factions.find((x) => x.alive && x !== f);
  f.known = o.known = true;
  const tile = st.grid.within(h.tile, 9).find((t) => st.grid.distance(t, h.tile) >= 4 && free(st, t) && f.bases.every((x) => st.grid.distance(x, t) > 3) && o.bases.every((x) => st.grid.distance(x, t) > 3));
  st.abandoned = [{ tile, from: f.id, fromName: f.name, works: { walls: 2 }, stock: {}, day: day(st) }];
  const near = st.grid.neighbors(tile).find((t) => st.tiles[t].terrain !== "water");
  st.claims = { [near]: { owner: o.id, since: 0 } };
  const griev = O.occupyGrievance(st, tile);
  check(griev.length === 2, `two groups to anger (${griev.map((g) => `${g.f.name}: ${g.why}`).join("; ")})`);
  const gf = f.goodwill, go = o.goodwill;
  O.takeAbandoned(st, tile, null);
  check(Math.abs(f.goodwill - (gf + O.OCCUPY.FORMER_GW)) < 1e-6, `their old base: ${f.name} goodwill ${gf} → ${f.goodwill}`);
  check(Math.abs(o.goodwill - (go + CLAIM.TAKEN)) < 1e-6, `their claim taken: ${o.name} goodwill ${go} → ${o.goodwill}`);
  check(st.claims[near].owner === "player", "the claim round it is yours");
  if (st.diplo) check(((f.griev && f.griev.growth) || 0) > 0, "filed as a grievance (growth: your expansion near their land)");
  // AI parity: a group's base taking another's claims costs their relations the same.
  const a = st.factions.find((x) => x.alive && x !== f && x !== o) || f;
  const t2 = st.grid.within(o.bases[0], 6).find((t) => free(st, t));
  st.claims[t2] = { owner: o.id, since: 0 };
  const r0 = relation(st, a, o);
  overwriteClaims(st, t2, 0, a.id, "test");
  check(relation(st, a, o) === Math.max(-100, r0 + CLAIM.TAKEN), `a group taking another's claim: relations ${r0} → ${relation(st, a, o)}`);
}

// ======================================================================================
section("What is inside: the dead drift in, squatters, a failed attempt thins them");
{
  const st = world(seed + 3);
  const h = hub(st);
  const tile = nearFree(st, h.tile, 4, 8);
  st.tiles[tile].infection = 0;
  st.abandoned = [{ tile, from: "player", fromName: "Old Mill", works: {}, buildings: [], stock: {}, day: day(st) }];
  const t0 = G.abandonedThreat(st, tile);
  check(t0.dead === G.ABANDON.DEAD_BASE && t0.squat === 0 && t0.kind === "zombies", `day 0: ${O.threatText(t0)}`);
  // Weeks on: more of the dead, and some 10-day window brings squatters (hashed dice; the stores draw them).
  st.abandoned[0].stock = { food: 400, meds: 40 };
  let squat = null, grew = false;
  for (let w = 1; w <= 30; w++) {
    const th = G.abandonedThreat(st, tile, day(st) + w * 7);
    if (th.dead > t0.dead || th.squat) grew = true;
    if (th.squat && !squat) squat = th;
  }
  check(grew, "the dead drift in as the weeks pass");
  check(!!squat && squat.squat >= G.ABANDON.SQUAT_N[0] && squat.squat <= G.ABANDON.SQUAT_N[1] && (squat.kind === "raiders" || squat.kind === "mixed"), `squatters some weeks: ${squat ? O.threatText(squat) : "none in 30 weeks"}`);
  const d = day(st) + 21;
  const th = G.abandonedThreat(st, tile, d);
  st.abandoned[0].thinned = { day: d, n: 2 };
  const thin = G.abandonedThreat(st, tile, d);
  check(thin.count === Math.max(0, th.count - 2), `killed in a failed attempt stay dead (${th.count} → ${thin.count})`);
  check(G.abandonedThreat(st, tile, d + G.ABANDON.THIN_DAYS).count >= G.abandonedThreat(st, tile, d + G.ABANDON.THIN_DAYS).count, "a week on the others drift in");
  // A losing fight: a lone, unarmed, hurt team. The card's odds and the governor's answer.
  const weak = makeSurvivor(st, 0.3); weak.gear.weapon = null; weak.health = 40; weak.location = { kind: "base", baseId: h.id }; st.survivors.push(weak);
  check(O.occupyOdds([weak], { kind: "mixed", count: 8, power: 3.5 }) < O.OCCUPY.AI_ODDS, "a lone, unarmed one has poor odds against 8");
  // The problems.
  st.hordes.push({ id: newId(), tile, size: 20, bosses: 0 });
  check(/horde/.test(O.occupyProblem(st, tile)), "a horde camped on it: cull it first");
  st.hordes.pop();
  const f = st.factions.find((x) => x.alive);
  f.bases.push(tile);
  check(/moved in/.test(O.occupyProblem(st, tile)), "a group moved in: it is theirs (assault)");
  f.bases.pop();
  recomputeOwnership(st);
  check(O.occupyProblem(st, tile) === "", "otherwise it can be occupied");
}

// ======================================================================================
section("The groups' side: moving in costs people; the former owner minds; an empty base rots");
{
  const st = world(seed + 4);
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const old = st.factions.find((x) => x.alive && x !== f);
  const tile = st.grid.within(f.bases[0], 6).find((t) => free(st, t));
  st.tiles[tile].infection = 0.5;
  st.abandoned = [{ tile, from: old.id, fromName: old.name, works: { walls: 3 }, stock: { food: 10 }, day: day(st) - 40 }];
  const th = G.abandonedThreat(st, tile);
  const pop0 = f.pop, r0 = relation(st, f, old), food0 = food(f);
  f.bases.push(tile);
  G.occupyAbandoned(st, f, tile);
  const lost = pop0 - f.pop;
  check(lost >= Math.floor(th.count * G.ABANDON.AI_LOSS) && lost <= Math.ceil(th.count * G.ABANDON.AI_LOSS), `clearing ${th.count} inside cost ${f.name} ${lost} people`);
  check(relation(st, f, old) === Math.max(-100, r0 + G.ABANDON.FORMER_REL), `${old.name} minds: relations ${r0} → ${relation(st, f, old)}`);
  check(f.works[tile].walls === 3 && Math.abs(food(f) - food0 - 10) < 1e-6, "they have the walls and the stores");
  // Your lost outpost rots: one building a period.
  const st2 = world(seed + 5);
  const tile2 = nearFree(st2, hub(st2).tile, 3, 6);
  const b = outpost(st2, tile2);
  addBuilding(b, "walls"); addBuilding(b, "well");
  removeBase(st2, b, "was abandoned");
  const rec = G.abandonedAt(st2, tile2);
  const wear0 = rec.buildings.reduce((a, x) => a + (x.wear || 0), 0);
  for (let i = 0; i < G.ABANDON.DECAY; i++) { daysOn(st2, 1); G.groupWorldWorld(st2); }
  const wear1 = rec.buildings.reduce((a, x) => a + (x.wear || 0), 0);
  const well = rec.buildings.find((x) => x.type === "well"), wall = rec.buildings.filter((x) => isPiece(x.type));
  check(wear1 > wear0 && ((well.wear || 0) === G.ABANDON.ROT ? wall.every((x) => !x.wear) : wall.every((x) => x.wear === G.ABANDON.ROT)), `a month on, one building (or the whole wall, its pieces together) took ${G.ABANDON.ROT} wear (${wear0} → ${wear1})`);
  for (let i = 0; i < G.ABANDON.DECAY * 6; i++) { daysOn(st2, 1); G.groupWorldWorld(st2); }
  check(!G.abandonedAt(st2, tile2) || !rec.buildings.some((x) => x.type === "well") || !rec.buildings.some((x) => isPiece(x.type)), `seven months on it has fallen in (${G.abandonedAt(st2, tile2) ? rec.buildings.length + " left" : "gone"})`);
}

// ======================================================================================
section("Save and load an empty base");
{
  const st = world(seed + 6);
  const tile = nearFree(st, hub(st).tile, 3, 6);
  const b = outpost(st, tile);
  const ring6 = addRing(b, 1, 33);
  removeBase(st, b, "was abandoned");
  G.abandonedAt(st, tile).thinned = { day: day(st), n: 1 };
  const l = roundTrip(st);
  const r = G.abandonedAt(l, tile);
  check(r && r.buildings.length === ring6.length && r.buildings.every((x) => x.wear === 33) && Math.abs(food(r) - 30) < 1e-6 && r.thinned.n === 1, "save/load: its buildings, wear, stores and the thinned count");
  check(JSON.stringify(G.abandonedThreat(l, tile)) === JSON.stringify(G.abandonedThreat(st, tile)), "save/load: the same inside");
  check(l.knowledge[tile] && l.knowledge[tile].abandoned, "save/load: the map remembers it");
}

// ======================================================================================
section("The governor moves in instead of founding an outpost");
{
  const st = world(seed + 7);
  setAutopilot(st, true, "balanced");
  const h = hub(st);
  const tile = nearFree(st, h.tile, 2, 4);
  st.tiles[tile].infection = 0;
  st.abandoned = [{ tile, from: "player", fromName: "Old Farm", works: { walls: 1 }, buildings: [{ id: newId(), type: "walls", wear: 30 }, { id: newId(), type: "well", wear: 10 }], stock: { food: 20 }, day: day(st) }];
  st.live.add(tile);
  const pool = atBase(st, h.id).concat(fighters(st, 4, h));
  const c = occupyCandidate(st, h, pool, 4);
  check(c && c.mission === "occupy" && c.tile === tile, `a candidate: ${c ? c.why : "none"}`);
  check(c && c.score > 3.5, "scored above founding an outpost (2.2 to 3.5)");
  // Unknown to the map: not a candidate.
  st.live.delete(tile);
  st.knowledge[tile] = null;
  check(!occupyCandidate(st, h, pool, 4), "one the map does not show is not a candidate");
  // A pact partner's old base: left alone.
  st.live.add(tile);
  const f = st.factions.find((x) => x.alive);
  st.abandoned[0].from = f.id; f.pact = "trade";
  check(!occupyCandidate(st, h, pool, 4), "not the old base of a pact partner");
  const keep = st.abandoned[0].buildings; st.abandoned[0].buildings = [];
  check(!occupyCandidate(st, h, pool, 4), "not a bare one (nothing standing: no better than new ground)");
  st.abandoned[0].buildings = keep;
  f.pact = null; st.abandoned[0].from = "player";
  st.knowledge[tile] = snapshot(st, tile); // a team saw it (the live view is redrawn every hour)
  // End to end: the governor runs its days and moves in (it wants an outpost: enough people, food, a while since the last).
  for (let i = 0; i < 8; i++) { const s = makeSurvivor(st, 0.8); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); }
  Object.assign(h.stock, { water: 300, meds: 30, scrap: 10 }); setFood(h, 600);
  st.governor.lastOutpost = -99;
  for (let i = 0; i < 24 * 12 && !st.bases.some((b) => b.tile === tile); i++) { tickHour(st); if (!st.autopilot) break; }
  const got = st.bases.find((b) => b.tile === tile);
  for (const l of st.log.filter((x) => /Old Farm|occupy|🤖 Sent/i.test(x.text)).slice(0, process.env.OCCLOG ? 30 : 4).reverse()) console.log(`  log: ${l.text.slice(0, 160)}`);
  check(!!got, `the governor moved into it (${got ? `${got.name}, ${got.buildings.length} buildings` : "not in 12 days"})`);
}

// ======================================================================================
section("Build outpost takes the groups' claims round it, as a group's new base takes yours");
{
  const st = world(seed + 8);
  const h = hub(st);
  const tile = nearFree(st, h.tile, 4, 8);
  const o = st.factions.find((x) => x.alive);
  o.known = true;
  const near = st.grid.neighbors(tile).filter((t) => st.tiles[t].terrain !== "water").slice(0, 2);
  st.claims = Object.fromEntries(near.map((t) => [t, { owner: o.id, since: 0 }]));
  const at = { path: [tile], idx: 0, supplies: { scrap: 15 }, cargo: { supplies: {}, gear: [] } };
  const opt = orderOptions(st, at).find((x) => x.mission === "outpost");
  check(opt && new RegExp(`angers ${o.name}`).test(opt.desc), `the orders card says so before you build (${opt && opt.desc.slice(-80)})`);
  check(claimsTaken(st, tile).length === 1 && claimsTaken(st, tile)[0].n === 2, "it would take their 2 claims");
  const UI = await import("../src/ui/ui.js");
  const crew = atBase(st, h.id).slice(0, 2).map((s) => s.id);
  const modal = UI.renderModal(st, { started: true, planner: { dest: tile, mission: "outpost", crew: new Set(crew), vehicleId: null, stance: "normal", supplies: { scrap: 15, food: 6, water: 6 } }, plannerError: "" }) || "";
  check(/Building here takes claims round it and angers/.test(modal), "the planner says so too");
  Object.assign(h.stock, { scrap: 60, water: 100 }); setFood(h, 100);
  const res = launchExpedition(st, { memberIds: crew, dest: tile, mission: "outpost", stance: "normal", supplies: { scrap: 15, food: 6, water: 6 } });
  check(!res.error, `the team leaves (${res.error || "ok"})`);
  res.party.path = [tile]; res.party.idx = 0;
  const g0 = o.goodwill;
  giveOrder(st, res.party, "outpost");
  for (let i = 0; i < 8 && !st.bases.some((b) => b.tile === tile); i++) tickHour(st); // pitching the camp takes 6 hours (parties.js PITCH_HOURS)
  check(st.bases.some((b) => b.tile === tile), "the outpost stands");
  check(near.every((t) => st.claims[t].owner === "player"), "their claims round it are yours");
  check(Math.abs(o.goodwill - (g0 + 2 * CLAIM.TAKEN)) < 1e-6, `${o.name} goodwill ${g0} → ${o.goodwill} (${CLAIM.TAKEN} a claim)`);
  if (st.diplo) check(((o.griev && o.griev.growth) || 0) > 0, "a growth grievance, as for Occupy");
  // The groups' side reaches as far: a group's new base takes the claims within the same radius (factions.js: CLAIM.BASE_RADIUS).
  const src = (await import("node:fs")).readFileSync(new URL("../src/sim/factions.js", import.meta.url), "utf8");
  check(/overwriteClaims\(state, t\.id, CLAIM\.BASE_RADIUS, f\.id/.test(src), "a group's new base takes claims within the same CLAIM.BASE_RADIUS");
}

// ======================================================================================
section("Abandon outpost: the card, the walk home, the empty base, Reoccupy");
{
  const st = world(seed + 9);
  const h = hub(st);
  check(/hub/.test((await import("../src/sim/occupy.js")).abandonProblem(st, h)), "the hub cannot be abandoned");
  const tile = nearFree(st, h.tile, 3, 6);
  const b = outpost(st, tile);
  addBuilding(b, "walls"); addBuilding(b, "well");
  for (let i = 0; i < 2; i++) { const s = makeSurvivor(st, 0.9); s.location = { kind: "base", baseId: b.id }; st.survivors.push(s); }
  check(O.abandonProblem(st, b) === "", `an outpost can be (${O.abandonProblem(st, b)})`);
  b.alert = true;
  check(/attack/.test(O.abandonProblem(st, b)), "not while it is under attack");
  b.alert = false;
  const card = O.abandonCard(st, b);
  check(/Abandon/.test(card.title) && pick(card, /^Abandon it/) && pick(card, /^Keep it/) && /Reoccupy/.test(card.text), "a confirm card: Abandon it or Keep it");
  pick(card, /^Keep it/).resolve(st);
  check(st.bases.includes(b), "Keep it: nothing changes");
  const food0 = food(b);
  const text = pick(card, /^Abandon it/).resolve(st);
  check(!st.bases.includes(b), `abandoned (${text})`);
  const team = st.parties.find((p) => p.owner === "player" && partyMembers(st, p).length === 2);
  check(team && team.homeBaseId === h.id && (food(team) || 0) > 0, `its people walk home with ${team ? Math.floor(food(team) || 0) : 0} food of the ${food0}`);
  const rec = G.abandonedAt(st, tile);
  check(rec && rec.from === "player" && rec.left && rec.buildings.filter((x) => !isPiece(x.type)).length === 1 && rec.buildings.some((x) => isPiece(x.type)), "it stands empty with its buildings (the well and the wall's pieces): your old ownership record");
  check(!(st.losses || []).some((l) => l.id === b.id), "no 'why was it lost' for a base you gave up");
  check(st.knowledge[tile] && st.knowledge[tile].abandoned, "your map shows it empty");
  const UI = await import("../src/ui/ui.js");
  check(UI.tileActions(st, tile).some(([m, l]) => m === "occupy" && /Reoccupy your old outpost/.test(l)), "right-click: Reoccupy your old outpost");
  for (let i = 0; i < G.ABANDON.DECAY; i++) { daysOn(st, 1); G.groupWorldWorld(st); }
  check(rec.buildings.reduce((a, x) => a + (x.wear || 0), 0) >= G.ABANDON.ROT, "it rots like any empty base");
  // Your only base cannot be given up.
  const st2 = world(seed + 10);
  const b2 = outpost(st2, nearFree(st2, hub(st2).tile, 3, 6));
  st2.bases.splice(st2.bases.indexOf(hub(st2)), 1);
  check(/only base|hub/.test(O.abandonProblem(st2, b2)), `not your only base (${O.abandonProblem(st2, b2)})`);
}

// ======================================================================================
section("The governor gives up a doomed outpost in winter; a group spread too thin gives up a base");
{
  const st = world(seed + 11);
  const h = hub(st);
  setAutopilot(st, false, "balanced"); // the governor's memory, off: winterPlan keeps its daily memo on it (st.governor.winter; with no governor a private WeakMap the resets below cannot reach)
  for (let d = 0; d < 112 && season(st).key !== "winter"; d++) st.hour += 24;
  check(season(st).key === "winter", `winter (day ${day(st)})`);
  const far = st.tiles.map((t) => t.id).filter((t) => free(st, t) && planPath(st, t, h.tile, false) && supplyLine(st, { tile: t }).strength < 0.5).sort((a, b) => st.grid.distance(a, h.tile) - st.grid.distance(b, h.tile))[0];
  check(far != null, "a far outpost with a weak supply line");
  const b = outpost(st, far);
  setFood(b, 0);
  setFood(h, 0);
  for (let i = 0; i < 3; i++) { const s = makeSurvivor(st, 0.9); s.location = { kind: "base", baseId: b.id }; st.survivors.push(s); }
  const d = doomedOutpost(st, b);
  check(!!d, `doomed: food runs out in ${d ? d.runsIn : "?"} days, line ${d ? Math.round(d.line * 100) : "?"}%`);
  setFood(h, 5000); st.governor.winter = {}; // the winter plan is worked out once a day
  check(!doomedOutpost(st, b), "not while the hub's winter stores could carry it");
  setFood(h, 0); st.governor.winter = {};
  setFood(b, 2000);
  check(!doomedOutpost(st, b), "not while its own stores last");
  setFood(b, 0);
  setAutopilot(st, true, "balanced");
  st.cards.length = 0;
  autopilotDaily(st);
  check(!st.bases.includes(b) && G.abandonedAt(st, far) && G.abandonedAt(st, far).from === "player", "the governor gave it up: its people walk home, it stands empty");
  check(st.governor.lastAbandon === day(st), "one every 30 days at most");
  // A group spread too thin: its farthest base stands empty, the same record.
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const extra = st.grid.within(f.bases[0], 8).filter((t) => free(st, t) && st.grid.distance(t, f.bases[0]) >= 3).slice(0, 2);
  f.bases.push(...extra);
  f.pop = 6; f.wounded = 0;
  const left = G.groupAbandonDaily(st, f);
  check(left && left.from === f.id && !f.bases.includes(left.tile) && f.bases.length === 2, `${f.name} (6 people, 3 bases) gave up one: an empty base`);
  check(!G.groupAbandonDaily(st, f), "not again the next day");
}

// ======================================================================================
section("The map: empty bases you know of, drawn with a tooltip");
{
  const st = world(seed + 12);
  st.autoCombat = true;
  const h = hub(st);
  const near = st.grid.within(h.tile, 3).find((t) => t !== h.tile && free(st, t) && st.live.has(t));
  const farT = st.tiles.find((t) => !st.live.has(t.id) && !st.knowledge[t.id] && free(st, t.id)).id;
  st.abandoned = [
    { tile: near, from: "player", fromName: "Old Mill Outpost", works: { walls: 1 }, buildings: [{ id: newId(), type: "walls", wear: 30 }], stock: {}, day: day(st) },
    { tile: farT, from: 3, fromName: "Long Haul Co.", works: { walls: 2 }, stock: {}, day: day(st) },
  ];
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  const R = await import("../src/ui/render.js");
  const ctxStub = new Proxy({ measureText: (t) => ({ width: String(t).length * 5 }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) }, {
    get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => ((o[k] = v), true),
  });
  R.initRenderer({ getContext: () => ctxStub, getBoundingClientRect: () => ({ width: 1600, height: 900 }), width: 0, height: 0 });
  R.view.layers = new Set(["pois", "territory", "teams", "hordes"]);
  const draw = () => { R.camera.zoom = 1; R.centerOn(st, h.tile); R.redrawMap(true); R.render(st); };
  draw();
  const ov = R.mapOverlay();
  check(ov.empty.includes(near) && !ov.ruins.includes(near), "an empty base in view is drawn (not as ruins)");
  check(!ov.empty.includes(farT), "one you have never seen or heard of is not on your map");
  const tipTxt = R.tileTooltip(st, near);
  check(/Empty: Old Mill Outpost/.test(tipTxt) && /inside/.test(tipTxt) && /Reoccupy/.test(tipTxt), `the tooltip (${tipTxt.replace(/<[^>]+>/g, "").slice(0, 120)}…)`);
  // Heard of it (a team's report): drawn as last seen, the tooltip says so.
  st.knowledge[farT] = snapshot(st, farT);
  draw();
  check(R.mapOverlay().empty.includes(farT), "one in your last report is drawn");
  check(/standing when last seen/.test(R.tileTooltip(st, farT)), "its tooltip goes by the report");
  // Taken over since your report: still drawn as you saw it until you look again; moved into by you: gone.
  st.abandoned.shift();
  st.bases.push({ id: newId(), tile: near, type: "outpost", name: "Old Mill Outpost", stock: {}, buildings: [], construction: [], armory: [], radio: false, watchtower: false });
  draw();
  check(!R.mapOverlay().empty.includes(near), "your base there now: no empty base drawn");
  delete globalThis.window;
}

console.log(`\n${passes} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
