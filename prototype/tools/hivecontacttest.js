// A team on a hive's tile after the hive's card (sim/hives.js hiveArrive, conflicts.js contactOn), and the governor's
// hive squads going home (autopilot.js chainNext). Usage: node tools/hivecontacttest.js
// - after the card (Back off, or fires set) and new orders, the team still on the mound's tile (at night it does not
//   walk on) is not ambushed by the hive's own guard every few hours; a team that came on a plain move is
// - off the tile the mark is dropped: walking back onto the mound on a plain move, the guard attacks again
// - the mark is plain data and survives save/load (sim/save.js)
// - the governor's fire-trip squad goes home after the fires instead of searching the hive's land on the way: seed 1
//   (Aggressive) lost its whole squad of five that way on day 37 (two contacts with the guard three hours apart)
import { createWorld, tickHour, day, hub, makeSurvivor } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { hiveArrive } from "../src/sim/hives.js";
import { makeHorde } from "../src/sim/hordes.js";
import { contactOn } from "../src/sim/conflicts.js";
import { serializeState, deserializeState } from "../src/sim/save.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); ok ? pass++ : fail++; };
const t0 = Date.now();

function teamAt(st, tile, mission, id) {
  const people = [0, 1, 2].map(() => { const s = makeSurvivor(st, 1); s.health = 100; st.survivors.push(s); return s; });
  const p = { id, owner: "player", kind: "expedition", mission, members: people.map((s) => s.id), supplies: { ammo: 60, meds: 2, food: 10, water: 10 }, cargo: { supplies: {}, gear: [] },
    path: [tile], idx: 0, dest: tile, phase: "waiting", seen: new Map(), spotted: new Map(), homeBaseId: hub(st).id, orders: [], stance: "normal" };
  for (const s of people) s.location = { kind: "party", partyId: p.id };
  st.parties.push(p);
  return p;
}

console.log("The hive's guard and a team on the mound after the card");
{
  const st = createWorld({ seed: 42, factionCount: 8 });
  st.started = true;
  const hv = st.hives[0];
  const guard = makeHorde(st, { tile: hv.tile, size: 80, role: "guard", hive: hv.id, target: hv.tile });
  const p = teamAt(st, hv.tile, "hive", 91001);
  hiveArrive(st, p);
  const card = st.cards.find((c) => c.partyId === p.id);
  check(!!card && /^The hive/.test(card.title), "the hive's card comes up on arrival");
  card.choices.find((c) => /^Back off/.test(c.label)).resolve(st);
  st.cards = st.cards.filter((c) => c !== card);
  // New orders (a search nearby, home): the destination is no longer the hive, the team has not moved yet.
  const away = st.grid.neighbors(hv.tile).find((id) => st.tiles[id].terrain !== "water");
  p.dest = away; p.mission = "scavenge"; p.phase = "waiting";
  check(contactOn(st, p, hv.tile) === null, "backed off and given new orders, still on the mound: the guard does not ambush it");
  const q = teamAt(st, hv.tile, "scavenge", 91002);
  const hitQ = contactOn(st, q, hv.tile);
  check(!!hitQ && hitQ.horde === guard, "a team that walked onto the mound on a plain move is attacked by the guard");

  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st, { dropCards: true }))));
  const p2 = back.parties.find((x) => x.id === p.id);
  check(p2 && p2.hiveVisit === hv.tile && contactOn(back, p2, hv.tile) === null, "the mark survives save/load");

  check(contactOn(st, p, away) === null && p.hiveVisit == null, "off the tile the mark is dropped");
  const hitP = contactOn(st, p, hv.tile);
  check(!!hitP && hitP.horde === guard, "back on the mound on a plain move: the guard attacks");
}

// The governor's first hive trip on the Aggressive autopilot (a crawl or a storm: the fire trips are gone, 2026-10):
// the first of these seeds where one reaches the mound within DAYS. The trip: from the squad leaving to it coming home
// (or the hive dying).
const SQUAD = { SEEDS: [1, 4, 8, 2, 3], DAYS: 90 };
console.log("The governor's hive squad comes home from its trip (Aggressive autopilot, the first hive trip)");
{
  let found = null;
  for (const seed of SQUAD.SEEDS) {
    const st = createWorld({ seed, factionCount: 8 });
    st.started = true;
    setAutopilot(st, true, "aggressive");
    let top = st.log[0];
    const lines = [];
    let fire = -1, until = Infinity;
    while (day(st) <= (fire < 0 ? SQUAD.DAYS : until)) { // a trip found near the end is followed home
      tickHour(st);
      for (let i = 0; i < st.log.length && st.log[i] !== top; i++) lines.push({ d: day(st), t: st.log[i].text });
      top = st.log[0];
      if (fire < 0) { fire = lines.findIndex((l) => /The hive: .*→ (Enter the hive|Back off)/.test(l.t)); if (fire >= 0) until = lines[fire].d + 12; }
      if (fire >= 0 && lines.slice(fire).some((l) => /^Destroy hive team .* is home|was destroyed by your team/.test(l.t))) break;
    }
    if (fire < 0) continue;
    let from = fire;
    while (from > 0 && !/^Destroy hive team .* left for/.test(lines[from].t)) from--;
    found = { seed, day: lines[fire].d, trip: lines.slice(from).map((l) => l.t) };
    break;
  }
  check(!!found, `the squad reached the hive${found ? ` (seed ${found.seed}, day ${found.day})` : ` (none on seeds ${SQUAD.SEEDS.join(", ")} within ${SQUAD.DAYS} days)`}`);
  const trip = found ? found.trip : [];
  check(!trip.some((t) => /^🤖 Destroy hive team .* moves on to .* to search it too/.test(t)), "and did not move on to search a site on the hive's land");
  check(!trip.some((t) => /whole team was lost fighting the hive's dead/.test(t)), "and was not wiped out by the hive's guard on the mound");
  check(trip.some((t) => /^Destroy hive team .* is home|was destroyed by your team/.test(t)), "it came home (or the hive died)");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
