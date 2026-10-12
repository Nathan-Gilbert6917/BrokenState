// Night on the road (src/sim/nightmarch.js): a team still on its way at 22:00 gets a "Night falls" card, once a night;
// Make camp until dawn rests it on the spot until 06:00 and it moves on by itself to where it was going (its mission
// there kept); Push through the night keeps it moving, with more road events and run-ins (events.js, conflicts.js) and
// a night's sleep missed (sleep.js: Tired by dawn); "every night this trip" answers it by itself; not asked under the
// governor, for a team about to arrive, or near dawn; the tray's default is to make camp.
// Usage: node tools/nightmarchtest.js [seed]
import { createWorld, tickHour, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, partyTile, planPath, onTheMove, hoursLeft } from "../src/sim/parties.js";
import { conflictChance } from "../src/sim/conflicts.js";
import { NIGHT_MARCH, marchingNow, nightKey, hoursToDawn } from "../src/sim/nightmarch.js";
import { tiredLevel, TIRED } from "../src/sim/sleep.js";
import { defaultChoice, cardKind } from "../src/sim/cardrules.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else { fail++; console.log(`  FAIL ${what}`); } return ok; };
const world = () => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.noWanderers = true; st.noRoadblocks = true; st.hordes.length = 0; return st; };
const atHour = (st, h) => { st.hour = Math.floor(st.hour / 24) * 24 + 24 + h; };
// A team of two on foot, sent dist tiles out on a plain move (or a mission).
function team(st, dist = 9, mission = "move") {
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2);
  const dest = st.tiles.find((t) => t.terrain === "plains" && !t.loc && st.grid.distance(t.id, h.tile) === dist && planPath(st, h.tile, t.id, false)).id;
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest, mission, stance: "normal", supplies: { food: 12, water: 12 }, vehicleId: null });
  if (res.error) throw new Error(res.error);
  for (const s of crew) s.tired = 0;
  return { p: res.party, crew, dest };
}
const nightCards = (st, p) => st.cards.filter((c) => c.nightCard && c.partyId === p.id);
// Answers every other card for the team with its default (a road event must not stop the test), drops the rest.
const clearOthers = (st) => { for (const c of [...st.cards]) if (!c.nightCard) { st.cards.splice(st.cards.indexOf(c), 1); } };
const answer = (st, card, re) => { st.cards.splice(st.cards.indexOf(card), 1); return card.choices.find((c) => re.test(c.label)).resolve(st); };

console.log("The card");
{
  const st = world();
  atHour(st, 20);
  const { p } = team(st);
  tickHour(st); clearOthers(st); // the hour to 21:00: nothing asked
  check(!nightCards(st, p).length, "no card before 22:00");
  const tile = partyTile(p);
  tickHour(st); clearOthers(st); // 22:00: the night's first hour
  const cards = nightCards(st, p);
  check(cards.length === 1, `one "Night falls" card at 22:00 (${cards.length})`);
  check(partyTile(p) === tile, "the team does not move on while it is asked");
  const card = cards[0];
  check(card && defaultChoice(st, card).label === "Make camp until dawn", "its default (left in the tray) is to make camp");
  check(card && cardKind(st, card) === "other", `it is a road card (${card && cardKind(st, card)})`);
  check(card && card.choices.length === 4, "four answers: camp, push on, and each for every night of the trip");
  tickHour(st); clearOthers(st);
  check(nightCards(st, p).length === 1, "not asked twice the same night");
}

console.log("Make camp until dawn");
{
  const st = world();
  atHour(st, 22);
  const { p, dest } = team(st, 10, "scavenge");
  tickHour(st); clearOthers(st);
  const card = nightCards(st, p)[0];
  if (check(!!card, "asked")) {
    const text = answer(st, card, /^Make camp/);
    check(p.phase === "task" && p.task.type === "camp", `it rests on the spot: ${text}`);
    check(p.task.hours === hoursToDawn(st), `until dawn (${p.task.hours} hours)`);
    check(p.orders[0] && p.orders[0].type === "move" && p.orders[0].tile === dest && p.orders[1] && p.orders[1].mission === "scavenge", "its trip and mission wait on the queue");
    const camped = partyTile(p);
    while (st.hour % 24 !== NIGHT_MARCH.TO) { tickHour(st); clearOthers(st); }
    check(partyTile(p) === camped, "it stays put through the night");
    tickHour(st); clearOthers(st);
    check(p.phase === "out" && p.dest === dest && p.orders[0] && p.orders[0].mission === "scavenge", `at first light it moves on, its scavenge queued for when it gets there (${p.phase})`);
    let n = 0;
    while (p.phase === "out" && n++ < 40) { tickHour(st); clearOthers(st); }
    check(partyTile(p) === dest, "and gets there");
  }
}

console.log("Push through the night");
{
  const st = world();
  atHour(st, 22);
  const { p, crew } = team(st, 12);
  const before = conflictChance(st, p, partyTile(p)).chance;
  tickHour(st); clearOthers(st);
  const card = nightCards(st, p)[0];
  if (check(!!card, "asked")) {
    answer(st, card, /^Push through the night$/);
    check(marchingNow(st, p), "marching");
    const after = conflictChance(st, p, partyTile(p)).chance;
    check(after > before || after >= NIGHT_MARCH.CONFLICT_CAP, `run-ins more likely (${before.toFixed(3)} → ${after.toFixed(3)})`);
    const tile = partyTile(p);
    let hours = 0;
    while (st.hour % 24 !== NIGHT_MARCH.TO && onTheMove(p)) { tickHour(st); clearOthers(st); if (st.hour % 24 !== NIGHT_MARCH.TO) hours++; }
    check(partyTile(p) !== tile, "it kept moving in the dark");
    check(crew.every((s) => s.tired >= hours * NIGHT_MARCH.TIRED - 1e-9), `a night's sleep missed (owes ${crew.map((s) => s.tired).join(", ")} after ${hours} h)`);
    check(hours < 6 || crew.every((s) => tiredLevel(s) >= 1), "a whole night on the road: Tired by dawn");
    check(!marchingNow(st, p), "by day it is no longer a night march");
  }
}

console.log("Every night this trip, the governor, close to the end");
{
  const st = world();
  atHour(st, 22);
  const { p } = team(st, 12);
  p.nightPlan = "camp";
  tickHour(st); clearOthers(st);
  check(!nightCards(st, p).length && p.phase === "task" && p.task.type === "camp", "Camp every night: no card, it makes camp");
}
{
  const st = world();
  atHour(st, 22);
  const { p } = team(st, 12);
  p.nightPlan = "push";
  tickHour(st); clearOthers(st);
  check(!nightCards(st, p).length && p.nightMarch === nightKey(st) && onTheMove(p), "Push through every night: no card, it marches");
}
{
  const st = world();
  st.autopilot = true;
  atHour(st, 22);
  const { p } = team(st, 12);
  tickHour(st);
  check(!nightCards(st, p).length, "not asked under the governor");
}
{
  const st = world();
  atHour(st, 22);
  const { p } = team(st, 1);
  check(hoursLeft(st, p) <= NIGHT_MARCH.NEAR, `a tile out (${hoursLeft(st, p).toFixed(1)} h)`);
  tickHour(st); clearOthers(st);
  check(!nightCards(st, p).length, "a team about to arrive is not asked");
}
{
  const st = world();
  atHour(st, 5);
  const { p } = team(st, 12);
  tickHour(st); clearOthers(st);
  check(!nightCards(st, p).length, "not asked an hour before dawn");
}

console.log("Resting in camp sleeps off a night's march");
{
  const st = world();
  atHour(st, 10);
  const { p, crew } = team(st, 12);
  for (const s of crew) s.tired = TIRED.TIRED;
  tickHour(st); clearOthers(st);
  const t0 = crew[0].tired;
  check(t0 === TIRED.TIRED, "on the move by day it stays as it was");
  p.orders = [];
  p.phase = "waiting"; p.path = [partyTile(p)]; p.idx = 0;
  // the internal rest task (orders.js "camp")
  const { startOrder } = await import("../src/sim/orders.js");
  startOrder(st, p, { type: "camp", hours: 6 });
  tickHour(st); clearOthers(st);
  check(crew[0].tired < t0, `resting by day sleeps it off (${t0} → ${crew[0].tired})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
