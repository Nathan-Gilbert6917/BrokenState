// Some of a team on jobs of their own (sim/detach.js, ui/teamctx.js; the user's request 2026-10-24: "When in a team of
// more than 1 you can select different survivors to do different jobs basically acting like a mobile base when it
// comes to jobs when sitting on a tile. When one or more survivors is out doing a job you cannot move the team as a
// whole to another tile. Any order a team can do can be assigned to one or more survivors"): the menu's Who picker
// (none for one person, only the people free), a pick of some splitting them off to do it while the rest work on, the
// team kept on its tile meanwhile (moves refused, a queued move waiting), the job's people back in the team when done
// (with what they gathered; walking back from another tile first), a plain move leaving a team of their own, Call back.
// Usage: node tools/detachtest.js [seed]
import { setFood } from "./foodkit.js";
import { createWorld, hub, atBase, tickHour } from "../src/sim/world.js";
import { launchExpedition, planPath, partyMembers, partyTile, orderMove, startReturn } from "../src/sim/parties.js";
import { stripAll, newItem } from "../src/sim/inventory.js";
import { woodAbundance } from "../src/sim/woodcutting.js";
import { forageAbundance } from "../src/sim/foraging.js";
import { startOrder, queueOrder } from "../src/sim/orders.js";
import { teamCheck } from "../src/sim/teammeet.js";
import { detachments, detachProblem, detach, callBack } from "../src/sim/detach.js";
import { teamTileMenu, teamCtxHtml, runTeamAction, landPick } from "../src/ui/teamctx.js";
import { askLand, landModel } from "../src/ui/landorder.js";

const SEED = Number(process.argv[2] || 42);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 5 });
  state.started = true; state.noWanderers = true; state.cards = []; state.hordes.length = 0; state.visitorsOff = true;
  state.hour = Math.floor(state.hour / 24) * 24 + 7;
  Object.assign(hub(state).stock, { water: 300, fuel: 100, meds: 20, parts: 10, scrap: 100 }); setFood(hub(state), 300);
  return state;
}
function find(state, from, ok, d = 1, d2 = 14) {
  const list = state.tiles.filter((t) => t.terrain !== "water" && !state.bases.some((b) => b.tile === t.id)).map((t) => [t, state.grid.distance(from, t.id)])
    .filter(([, dist]) => dist >= d && dist <= d2).sort((a, b) => a[1] - b[1]);
  for (const [t] of list) if (ok(t) && planPath(state, from, t.id, false)) return t.id;
  return null;
}
function team(state, n, tile) {
  const h = hub(state);
  const crew = atBase(state, h.id).slice(0, n);
  for (const s of crew) { s.traits = []; stripAll(s); s.health = 100; }
  const dest = find(state, h.tile, () => true, 2, 3);
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", vehicleId: null, supplies: { food: 9, water: 9 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; p.orders = []; p.dest = tile; p.radioLive = true;
  state.cards = [];
  return p;
}
const item = (m, key) => m.items.find((it) => it.key === key) || null;
const ids = (state, p) => partyMembers(state, p).map((s) => s.id);
const faults = (state) => teamCheck(state);
const hours = (state, n, stop = () => false) => { for (let i = 0; i < n && !stop(); i++) { tickHour(state); state.cards = []; } };

section("The Who picker");
{
  const state = mk();
  const tile = find(state, hub(state).tile, (t) => forageAbundance(state, t.id) >= 0.3 && woodAbundance(state, t.id) >= 0.3, 2, 12);
  const lone = team(state, 1, tile);
  check(!teamTileMenu(state, {}, lone, tile).pick && !/tc-who/.test(teamCtxHtml(state, {}, teamTileMenu(state, {}, lone, tile))), "one person: no picker, the order is theirs");
  const p = team(state, 3, tile);
  const m = teamTileMenu(state, {}, p, tile);
  check(m.pick && m.pick.people.length === 3 && !m.who, "a team of 3: the picker, all three, the team does it");
  const [a] = partyMembers(state, p);
  const ms = teamTileMenu(state, {}, p, tile, { who: [a.id] });
  const html = teamCtxHtml(state, {}, ms);
  check(ms.who && ms.who[0] === a.id && /data-action="tc-who"/.test(html) && new RegExp(`data-who="${a.id}"`).test(html) && /go off on their own/.test(html) && !/undefined|NaN/.test(html), "one picked: chips, the items carry who, the line says so");
  check(item(ms, "forage") && !item(ms, "forage").disabled, "the picked one can forage");
  check(!teamTileMenu(state, {}, p, tile, { who: ids(state, p) }).who, "all picked: the team itself");
}

section("Some off on a job, the rest work on, the team stays");
{
  const state = mk();
  const tile = find(state, hub(state).tile, (t) => forageAbundance(state, t.id) >= 0.3 && woodAbundance(state, t.id) >= 0.3, 2, 12);
  const far = find(state, tile, () => true, 2, 4);
  const p = team(state, 3, tile);
  const [a] = partyMembers(state, p);
  const msg = runTeamAction(state, {}, { id: p.id, tile, key: "forage", mode: "replace", who: String(a.id), hours: "4", asked: "1" });
  const q = detachments(state, p)[0];
  check(q && ids(state, q).join() === String(a.id) && q.detachOf === p.id && q.phase === "task" && q.task.type === "forage" && q.task.hours === 4, `${a.name.split(" ")[0]} forages 4h on their own (${msg})`);
  check(ids(state, p).length === 2 && !ids(state, p).includes(a.id), "the team keeps the other two");
  check(!faults(state).length, `teams in order (${faults(state).join("; ")})`);
  // Not free any more: not in the picker; listed as out.
  const m = teamTileMenu(state, {}, p, tile);
  check(m.pick && !m.pick.people.some((s) => s.id === a.id) && m.pick.out.length === 1, "the picker: only the two free, the one out listed");
  // The team cannot move.
  check(!!detachProblem(state, p) && orderMove(state, p, far) === detachProblem(state, p) && p.phase === "waiting", `a move refused: ${detachProblem(state, p)}`);
  check(startReturn(state, p) === detachProblem(state, p) && state.parties.includes(p) && p.phase === "waiting", "going home refused");
  const mf = teamTileMenu(state, {}, p, far);
  check(item(mf, "move") && /cannot move/.test(item(mf, "move").disabled || ""), "the menu greys its moves out with why");
  // The rest work on: the other two cut wood (8h), then a queued move waits for the forager.
  runTeamAction(state, {}, { id: p.id, tile, key: "wood", mode: "replace", hours: "8", asked: "1" });
  check(p.phase === "task" && p.task.type === "wood" && ids(state, p).length === 2, "meanwhile the two cut wood");
  queueOrder(state, p, { type: "move", tile: far });
  check(p.orders.length === 1 && p.orders[0].type === "move", "a move queued behind the wood");
  // Hours on: the forager comes back and rejoins with the food; the queued move waits for the wood, then goes.
  hours(state, 6, () => !state.parties.includes(q));
  check(!state.parties.includes(q) && ids(state, p).length === 3 && ids(state, p).includes(a.id), `done: back in the team (${ids(state, p).length})`);
  check(!detachProblem(state, p) && !faults(state).length, "nobody out; teams in order");
  hours(state, 4, () => p.phase === "out");
  check(p.phase === "out" && p.dest === far, `the wood done, the queued move goes (${p.phase})`);
}

section("A queued move waits for them");
{
  const state = mk();
  const tile = find(state, hub(state).tile, (t) => forageAbundance(state, t.id) >= 0.3, 2, 12);
  const far = find(state, tile, () => true, 2, 4);
  const p = team(state, 2, tile);
  const [a] = partyMembers(state, p);
  runTeamAction(state, {}, { id: p.id, tile, key: "forage", mode: "replace", who: String(a.id), hours: "3", asked: "1" });
  const r = startOrder(state, p, { type: "move", tile: far });
  check(/waits/.test(r) && p.phase === "waiting" && p.orders[0] && p.orders[0].type === "move" && p.waitDetached, `the move waits at the front of the queue (${r})`);
  hours(state, 5, () => p.phase === "out");
  check(p.phase === "out" && p.dest === far && ids(state, p).length === 2, "back together, the team sets off");
}

section("A job on another tile: there and back; a plain move stays; Call back");
{
  const state = mk();
  const tile = find(state, hub(state).tile, () => true, 2, 12);
  const wood = find(state, tile, (t) => woodAbundance(state, t.id) >= 0.3, 1, 3);
  const p = team(state, 3, tile);
  const [a, b] = partyMembers(state, p);
  const msg = runTeamAction(state, {}, { id: p.id, tile: wood, key: "wood", mode: "replace", who: `${a.id},${b.id}`, hours: "2", asked: "1" });
  const q = detachments(state, p)[0];
  check(q && q.phase === "out" && q.dest === wood && q.orders[0] && q.orders[0].type === "wood", `two go to cut wood a tile away (${msg})`);
  hours(state, 30, () => !state.parties.includes(q));
  check(!state.parties.includes(q) && ids(state, p).length === 3 && partyTile(p) === tile, "they cut it, walked back and rejoined");
  check(((p.cargo.supplies.wood || 0) + (p.supplies.wood || 0)) > 0, `the wood came with them (${Math.round((p.cargo.supplies.wood || 0) + (p.supplies.wood || 0))})`);
  // A plain move by one: a team of their own there; the team free to move.
  const mv = runTeamAction(state, {}, { id: p.id, tile: wood, key: "move", mode: "replace", who: String(a.id) });
  const q2 = detachments(state, p)[0];
  check(q2 && q2.phase === "out", `one moves off (${mv})`);
  hours(state, 20, () => q2.phase === "waiting");
  hours(state, 1);
  check(state.parties.includes(q2) && partyTile(q2) === wood && q2.detachOf == null && !detachProblem(state, p), "arrived: a team of their own, the team free to move");
  // Call back: a long forage stopped, back at once.
  const tile2 = partyTile(p);
  runTeamAction(state, {}, { id: p.id, tile: tile2, key: "camp", mode: "replace" });
  const left = partyMembers(state, p)[0];
  const r = detach(state, p, [left.id], (x) => startOrder(state, x, { type: "wait", hours: 20 }), { type: "wait" });
  check(r.party && detachments(state, p).length === 1, `one waits 20h on their own (${r.text})`);
  const cb = callBack(state, r.party);
  check(!state.parties.includes(r.party) && ids(state, p).includes(left.id) && !faults(state).length, `Call back: back in the team (${cb})`);
}

section("What they take, what fails, the land box");
{
  const state = mk();
  const tile = find(state, hub(state).tile, (t) => woodAbundance(state, t.id) >= 0.3, 2, 12);
  const p = team(state, 3, tile);
  const [a, b] = partyMembers(state, p);
  p.supplies.scrap = 9;
  p.cargo.gear.push(newItem("fireaxe"));
  // Nothing can start (nobody armed to hunt): no split.
  const r = detach(state, p, [a.id], (x) => startOrder(state, x, { type: "hunt", hours: 4 }), { type: "hunt" });
  check(r.error && ids(state, p).length === 3 && !detachments(state, p).length && !faults(state).length, `a hunt with no weapon: nobody goes (${r.error})`);
  check(/nobody|weapon/i.test(item(teamTileMenu(state, {}, p, tile, { who: [a.id] }), "hunt")?.disabled || "nobody"), "the menu says so for the one picked");
  // The land box for one: their estimate; the axe goes with them.
  const lp = landPick(state, {}, { id: p.id, tile, key: "wood", mode: "replace", who: String(b.id) });
  const ui = {};
  askLand(state, ui, { id: String(p.id), tile: String(tile), key: "wood", mode: "replace", who: String(b.id) }, { via: "tc", ...lp });
  const lm = landModel(state, ui);
  check(lm.est.crew.length === 1 && lm.est.crew[0].gear === "Fire axe", `the land box: one person's estimate, with the axe (${lm.est.crew.map((c) => `${c.name} ${c.gear}`).join(", ")})`);
  runTeamAction(state, {}, { id: p.id, tile, key: "wood", mode: "replace", who: String(b.id), hours: "4", asked: "1" });
  const q = detachments(state, p)[0];
  check(q && q.cargo.gear.some((it) => it.key === "fireaxe") && !p.cargo.gear.some((it) => it.key === "fireaxe"), "the axe from the cargo went with the woodcutter");
  check(q && (q.supplies.scrap || 0) === 3 && p.supplies.scrap === 6, `their share of the scrap (${q && q.supplies.scrap} of 9)`);
  hours(state, 8, () => !state.parties.includes(q));
  check(p.cargo.gear.some((it) => it.key === "fireaxe") && (p.supplies.scrap || 0) === 9 && !faults(state).length, "back: the axe and the scrap with the team again");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
