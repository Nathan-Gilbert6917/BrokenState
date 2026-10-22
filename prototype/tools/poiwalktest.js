// The walk to a point of interest inside a tile before its raid (src/sim/poiwalk.js; the dialogue in poiraid.js).
// Usage: node tools/poiwalktest.js [seed]
// - where: every place has a spot inside the hex (the top one near the middle), the same every time
// - the weighted map: the minutes on foot are 5 to 20, from the middle of the tile on arrival; rough ground (hills,
//   mountains, forest) takes longer than suburbs on the whole
// - the walk: a place picked on the card starts a task "poiwalk" of its minutes (no search yet); it ends at its minute
//   (orders.js tasksDue) and the raid starts there; the team then stands at the place (p.atPoi)
// - raid again: the minutes are from the place it stands at (that place "here": straight in, no walk)
// - stepping off the tile forgets the place; the map's position glides from spot to spot; the headless paths never walk
// - a save keeps the walk and the place the team stands at; the dialogue's screen shows the minutes
import { createWorld, hub, atBase, tickHour } from "../src/sim/world.js";
import { launchExpedition, planPath, partyTile, orderMove } from "../src/sim/parties.js";
import { startOrder, tasksDue, describeOrder, taskHour } from "../src/sim/orders.js";
import { poisOf, knownPois } from "../src/sim/pois.js";
import { poiPickCard, poiRows } from "../src/sim/poiraid.js";
import { WALK, poiSpot, poiWalkMins, walkFrom, walkPos, walkText } from "../src/sim/poiwalk.js";
import { serializeState, deserializeState } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
function teamAt(st, tile, n = 2) {
  const crew = atBase(st, hub(st).id).slice(0, n);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "move", stance: "normal", supplies: { food: 10, water: 10 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.progress = 0; p.dest = tile; p.phase = "waiting"; p.plan = null; p.orders = [];
  st.cards.length = 0;
  return p;
}
const reachable = (st, id) => st.tiles[id].terrain !== "water" && !!planPath(st, hub(st).tile, id, false) && !st.bases.some((b) => b.tile === id) && !st.factions.some((f) => f.bases.includes(id));
// The nearest bare tile with min places, all known, a team can walk to (nearest first: a path is only looked for until one is found).
const bareAllKnown = (st, min = 3) => [st.tiles.filter((t) => !t.loc && poisOf(t).length >= min && knownPois(st, t).length === poisOf(t).length).sort((a, b) => st.grid.distance(a.id, hub(st).tile) - st.grid.distance(b.id, hub(st).tile)).find((t) => reachable(st, t.id))];
const SQ3 = Math.sqrt(3);
const inHex = ([x, y]) => { const ax = Math.abs(x), ay = Math.abs(y); return ax <= SQ3 / 2 && ay <= 1 && ax * 0.5 + ay * (SQ3 / 2) <= SQ3 / 2; };
// The card's pick for place i, resolved; the team is left walking (or searching, if it stood there).
function pick(st, p, i) {
  st.poiPickAlways = true;
  startOrder(st, p, { type: "mission", mission: "scavenge" });
  const card = st.cards.find((c) => c.poiPick && c.partyId === p.id);
  st.cards.length = 0;
  const c = card && card.choices.find((x) => x.poi === i && x.building == null);
  return c ? c.resolve(st) : null;
}
// The raid over (the headless search stands in for it): the team waits on the tile again.
function raidOver(st, p) { st.engagement = null; p.phase = "waiting"; p.task = null; p.mission = null; st.cards.length = 0; }

section("Where the places stand, and the minutes to each");
{
  const st = W();
  const tiles = st.tiles.filter((t) => poisOf(t).length);
  const spots = tiles.flatMap((t) => poisOf(t).map((_, i) => ({ t, i, s: poiSpot(st, t, i) })));
  check(spots.every((x) => inHex(x.s)), `every place stands inside its hex (${spots.length})`);
  check(spots.filter((x) => x.i === 0).every((x) => Math.hypot(...x.s) <= 0.25), "the top place stands near the middle (its sprite is drawn there)");
  check(spots.filter((x) => x.i > 0).every((x) => Math.hypot(...x.s) >= 0.44), "the others round it");
  const st2 = W();
  check(spots.every((x) => { const b = poiSpot(st2, st2.tiles[x.t.id], x.i); return b[0] === x.s[0] && b[1] === x.s[1]; }), "the same in a world made again from the seed");
  const t = bareAllKnown(st)[0];
  check(!!t, "a tile with three or more known places near the hub");
  const p = teamAt(st, t.id);
  check(walkFrom(st, p).poi === null && walkFrom(st, p).spot.every((v) => v === 0), "on arrival the team stands in the middle of the tile");
  const all = tiles.slice(0, 400).flatMap((tt) => poisOf(tt).map((_, i) => poiWalkMins(st, { ...p, path: [tt.id], idx: 0 }, i, tt.id)));
  check(all.every((m) => Number.isInteger(m) && m >= WALK.MIN && m <= WALK.MAX), `every place is ${WALK.MIN}–${WALK.MAX} minutes away (${Math.min(...all)}–${Math.max(...all)})`);
  check(new Set(all).size >= 6, `and they vary (${new Set(all).size} different)`);
  const avg = (terr) => { const xs = tiles.filter((tt) => terr.includes(tt.terrain)).flatMap((tt) => poisOf(tt).map((_, i) => i).filter((i) => i > 0).map((i) => poiWalkMins(st, { ...p, path: [tt.id], idx: 0, atPoi: undefined }, i, tt.id))); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; };
  const rough = avg(["hills", "mountain", "forest"]), easy = avg(["suburb"]);
  check(rough > easy, `rough ground takes longer than suburbs (${rough.toFixed(1)} vs ${easy.toFixed(1)} min on average)`);
  check(walkText(12) === "12 min on foot" && walkText(0) === "you are here", "the words");
  const rows = poiRows(st, p, t.id);
  check(rows.every((r) => r.mins >= WALK.MIN && r.mins <= WALK.MAX), "the dialogue's rows carry the minutes");
  const card = poiPickCard(st, p);
  check(card.choices.filter((c) => c.poi != null).every((c) => /min on foot/.test(c.hint)), "and the card's choices say them");
}

section("The walk, then the raid; raid again from there");
{
  const st = W();
  const t = bareAllKnown(st)[0];
  const p = teamAt(st, t.id);
  st.hour = Math.floor(st.hour / 24) * 24 + 32;
  const first = knownPois(st, t, p)[1];
  const mins = poiWalkMins(st, p, first);
  const text = pick(st, p, first);
  const w = p.task;
  check(p.phase === "task" && w && w.type === "poiwalk" && w.mins === mins && Math.abs(w.hours - mins / 60) < 1e-9 && !st.engagement, `picking a place starts the walk (${mins} min), no search yet`);
  check(/on foot/.test(text || "") && /minutes away/.test(text || ""), `the log line: "${text}"`);
  check(/Walk to .* \(\d+ min\), then raid it/.test(describeOrder(st, w)), `the panels call it "${describeOrder(st, w)}"`);
  // The map: from the middle to the place, by the minutes gone.
  const a = walkPos(st, p, 0), b = walkPos(st, p, w.hours * 0.5), c = walkPos(st, p, w.hours);
  const to = poiSpot(st, t, first);
  check(a.walking && Math.hypot(a.x, a.y) < 1e-9 && Math.abs(c.x - to[0]) < 1e-9 && Math.abs(c.y - to[1]) < 1e-9 && Math.abs(b.x - to[0] / 2) < 1e-9, "the map draws it gliding from its spot to the place's");
  check(a.mins === mins && c.mins >= 1 && b.mins <= Math.ceil(mins / 2) + 1, `the pill counts the minutes down (${a.mins} → ${b.mins} → ${c.mins})`);
  tasksDue(st, w.hours * 0.5);
  check(p.task === w && !st.engagement, "half way there: still walking");
  tasksDue(st, w.hours);
  const e = st.engagement;
  check(!!e && e.partyId === p.id && e.poi === first, "at its minute the team is there and the raid starts in that place");
  check(p.atPoi && p.atPoi.tile === t.id && p.atPoi.i === first, "the team stands at the place");
  check(walkPos(st, p, 0) && !walkPos(st, p, 0).walking, "and the map draws it there");
  raidOver(st, p);
  // Raid again: the minutes are from where it stands now.
  check(poiWalkMins(st, p, first) === 0, "the place it stands at is \"here\"");
  const others = knownPois(st, t, p).filter((i) => i !== first);
  const fromHere = others.map((i) => poiWalkMins(st, p, i));
  const fromMid = others.map((i) => poiWalkMins(st, { ...p, atPoi: undefined }, i));
  check(fromHere.every((m) => m >= WALK.MIN && m <= WALK.MAX), `the others from here: ${fromHere.join(", ")} min (from the middle: ${fromMid.join(", ")})`);
  check(fromHere.some((m, k) => m !== fromMid[k]), "the distances changed with where the team stands");
  check(poiRows(st, p, t.id).find((r) => r.i === first).mins === 0, "the dialogue says \"here\" for it");
  // The same place again: straight in.
  pick(st, p, first);
  check(!!st.engagement && st.engagement.poi === first && !(p.task && p.task.type === "poiwalk"), "picking the place it stands at goes straight in");
  raidOver(st, p);
  // Another place: the walk starts from this one.
  const second = others[0];
  pick(st, p, second);
  check(p.task && p.task.type === "poiwalk" && p.task.mins === fromHere[0] && p.task.from[0] === poiSpot(st, t, first)[0], "the next walk starts from the place it stands at");
  // The tick finishes a walk too (a clock with no minutes: the hour).
  taskHour(st, p);
  check(!!st.engagement && st.engagement.poi === second && p.atPoi.i === second, "an hour's tick ends the walk as well");
  raidOver(st, p);
  // Off the tile: the place is forgotten.
  const nb = st.grid.neighbors(t.id).find((id) => st.tiles[id].terrain !== "water");
  orderMove(st, p, nb);
  for (let k = 0; k < 6 && partyTile(p) === t.id; k++) { tickHour(st); st.cards.length = 0; }
  check(partyTile(p) !== t.id && !p.atPoi, "stepping off the tile forgets the place it stood at");
}

section("Not for the headless paths; a save keeps it");
{
  const st = W();
  const t = bareAllKnown(st)[0];
  const p = teamAt(st, t.id);
  st.poiPickAlways = false;
  startOrder(st, p, { type: "mission", mission: "scavenge" });
  check(!!st.engagement && !(p.task && p.task.type === "poiwalk"), "a pick made for the team (headless) goes straight in");
  st.engagement = null;
  const q = teamAt(st, t.id);
  const i = knownPois(st, t, q)[2] ?? knownPois(st, t, q)[1];
  pick(st, q, i);
  q.atPoi = { tile: t.id, i: 0 };
  const back = deserializeState(serializeState(st));
  const q2 = back.parties.find((x) => x.id === q.id);
  check(q2 && q2.task && q2.task.type === "poiwalk" && q2.task.poi === i && q2.atPoi && q2.atPoi.i === 0, "a save keeps the walk and the place the team stands at");
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  const PICK = await import("../src/ui/poipick.js");
  q.task = null; q.phase = "waiting";
  const html = PICK.poiPickModal(st, poiPickCard(st, q));
  check(/🚶 \d+ min/.test(html) && /📍 here/.test(html) && !/undefined|NaN/.test(html), "the dialogue's screen shows the minutes, and \"here\"");
}

console.log(`\n${passes} passed, ${fails} failed.`);
if (fails) process.exit(1);
