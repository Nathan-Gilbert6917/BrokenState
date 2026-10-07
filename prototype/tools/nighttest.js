// Headless checks for night on the State Map and same-tile attacks: at night a team sees only its own tile (night
// vision goggles or a thermal in the off hand: a tile round; parties.js sightRadius), and a team on the same tile as a
// horde or an enemy group's party is attacked (conflicts.js contactAttack): on the tile it enters (it stops there),
// and every hour when the enemy comes to it; not by a friendly group, not at a base, not twice in 12 hours by the same.
// Usage: node tools/nighttest.js [seed]
import { createWorld, tickHour, hub, atBase, newId, baseVision, NIGHT_BASE_VISION } from "../src/sim/world.js";
import { launchExpedition, sightRadius, partyTile, planPath, NIGHT_SIGHT } from "../src/sim/parties.js";
import { contactAttack, contactOn, enemyParty, CONTACT } from "../src/sim/conflicts.js";
import { makeHorde } from "../src/sim/hordes.js";
import { newItem } from "../src/sim/inventory.js";
import { vehiclesAtBase, isCar } from "../src/sim/vehicles.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else { fail++; console.log(`  FAIL ${what}`); } return ok; };
const world = () => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.noWanderers = true; st.noRoadblocks = true; return st; };
const atHour = (st, h) => { st.hour = Math.floor(st.hour / 24) * 24 + 24 + h; };
// A team of two sent on foot a few tiles out, then put on a tile of our choosing.
function team(st, dist = 5, opts = {}) {
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2);
  for (const s of crew) s.gear.tool = null;
  const dest = st.tiles.find((t) => t.terrain === "plains" && !t.loc && st.grid.distance(t.id, h.tile) === dist && planPath(st, h.tile, t.id, opts.car ? true : false)).id;
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", supplies: { food: 6, water: 6 }, vehicleId: opts.car ? opts.car.id : null });
  if (res.error) throw new Error(res.error);
  return { p: res.party, crew, dest };
}
const park = (p, tile) => { p.path = [tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; };
const clearHordes = (st) => { st.hordes.length = 0; };
const contactCards = (st, p) => st.cards.filter((c) => c.partyId === p.id && c.conflict && c.conflict.contact);

console.log("Seeing at night");
{
  const st = world();
  const { p, crew } = team(st);
  atHour(st, 12);
  const day = sightRadius(st, p);
  atHour(st, 23);
  const night = sightRadius(st, p);
  check(day >= 1 && night === NIGHT_SIGHT.dark, `by day ${day} tile(s) round, at night ${night} (only its own tile)`);
  crew[0].pockets[0] = newItem("nvg");
  check(sightRadius(st, p) === 0, "goggles in a pocket do not help");
  crew[0].pockets[0] = null;
  crew[0].gear.tool = newItem("nvg");
  check(sightRadius(st, p) === NIGHT_SIGHT.goggles, `night vision goggles in the off hand: ${sightRadius(st, p)} tile round`);
  crew[0].gear.tool = newItem("thermal");
  check(sightRadius(st, p) === NIGHT_SIGHT.goggles, "a thermal monocular too");
  crew[0].gear.tool = newItem("binoculars");
  check(sightRadius(st, p) === 0, "binoculars do nothing in the dark");
  atHour(st, 6);
  check(sightRadius(st, p) >= 1, "at dawn the team sees again");
  // What the team sees live (in radio contact) at night: its own tile only.
  atHour(st, 22);
  crew[0].gear.tool = null;
  p.radioLive = true;
  clearHordes(st);
  tickHour(st);
  check(!p.radioLive || p.sightNow.length <= 1, `in contact at night it shows ${p.sightNow.length} tile(s) on the map`);
}

console.log("Same tile as a horde");
{
  const st = world();
  const { p } = team(st);
  clearHordes(st);
  const tile = st.tiles.find((t) => t.terrain === "plains" && !t.loc && st.grid.distance(t.id, hub(st).tile) === 6).id;
  park(p, tile);
  atHour(st, 23);
  const hz = makeHorde(st, { tile, size: 60, job: "roam" });
  hz.target = null;
  check(!!contactOn(st, p, tile), "the horde on the team's tile is a contact");
  const card = contactAttack(st, p);
  check(!!card && card.conflict.type === "surge" && card.conflict.horde === 60 && p.phase === "engaged", `the team is attacked (${card && card.title}): ${card && card.text}`);
  check(/In the dark/.test(card.text), "at night the card says they walked into it in the dark");
  check(card.choices.some((c) => /Run|run/.test(c.label)) && card.choices.some((c) => /Fight|fight/.test(c.label)), `choices: ${card.choices.map((c) => c.label).join(" / ")}`);
  st.cards.length = 0;
  p.phase = "waiting";
  check(!contactAttack(st, p), `the same horde does not come again within ${CONTACT.AGAIN} hours`);
  st.hour += CONTACT.AGAIN;
  check(!!contactAttack(st, p), "after that it does");
  // A team sent to cull this horde gets the cull card on arrival instead (parties.js arrive).
  st.cards.length = 0; p.phase = "waiting"; p.contacts = {};
  p.mission = "cull"; p.dest = tile;
  check(!contactAttack(st, p), "a team sent to cull it is not ambushed by it");
  p.mission = "move";
  // A small knot of the dead is not a horde.
  st.cards.length = 0; p.phase = "waiting"; clearHordes(st); p.contacts = {};
  makeHorde(st, { tile, size: 3, job: "roam" });
  check(!contactAttack(st, p) || st.hordes[0].size >= CONTACT.HORDE_MIN, "fewer than 5 of the dead: no horde attack");
  // At a base: nothing.
  st.cards.length = 0; clearHordes(st); p.contacts = {};
  park(p, hub(st).tile);
  makeHorde(st, { tile: hub(st).tile, size: 60, job: "roam" });
  check(!contactAttack(st, p), "a team at a base is not caught in the open");
}

console.log("Driving into one");
{
  const st = world();
  const h = hub(st);
  const car = vehiclesAtBase(st, h.id).find(isCar);
  car.fuel = 30; car.condition = 100;
  const { p } = team(st, 9, { car });
  clearHordes(st);
  atHour(st, 22);
  p.departed = st.hour;
  const at = Math.min(3, p.path.length - 2);
  const hz = makeHorde(st, { tile: p.path[at], size: 80, job: "roam" });
  hz.target = null;
  for (let i = 0; i < 6 && !contactCards(st, p).length; i++) { p.lastConflict = st.hour; tickHour(st); }
  check(contactCards(st, p).length === 1 && partyTile(p) === p.path[at] && p.phase === "engaged", `the car stops on the horde's tile (tile ${p.idx} of the way, the horde on ${at})`);
}

console.log("Same tile as an enemy party");
{
  const st = world();
  const { p } = team(st);
  clearHordes(st);
  const tile = st.tiles.find((t) => t.terrain === "plains" && !t.loc && st.grid.distance(t.id, hub(st).tile) === 6).id;
  park(p, tile);
  atHour(st, 13);
  const f = st.factions.find((x) => x.alive);
  const q = { id: newId(), owner: f.id, kind: "war", path: [tile], idx: 0, progress: 0, phase: "out", strength: 10 };
  st.parties.push(q);
  f.goodwill = 0; f.pact = false; f.type = "traders";
  check(!enemyParty(st, q) && !contactAttack(st, p), "a friendly trading group's party on the tile: nothing");
  f.goodwill = -90;
  const card = contactAttack(st, p);
  check(!!card && card.conflict.type === "ambush" && card.conflict.aiPartyId === q.id && card.conflict.factionId === f.id, `a group at war with you attacks (${card && card.title})`);
  check(card && !/In the dark/.test(card.text), "by day the card does not speak of the dark");
  st.cards.length = 0; p.phase = "waiting"; p.contacts = {};
  q.phase = "siege";
  check(!contactAttack(st, p), "a party laying siege is fought at the walls, not here");
  q.phase = "out"; f.goodwill = 0; f.type = "raider";
  check(!!contactAttack(st, p), "raiders with no pact attack even when not at war");
}

console.log("Bases at night");
{
  const st = world();
  const h = hub(st);
  h.watchtower = true;
  atHour(st, 12);
  const day = baseVision(h, st);
  atHour(st, 23);
  check(day > NIGHT_BASE_VISION && baseVision(h, st) === NIGHT_BASE_VISION, `the hub sees ${day} tiles by day (watchtower), ${baseVision(h, st)} at night`);
  st.hordes.length = 0;
  const far = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 3).id;
  const near = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 1).id;
  tickHour(st);
  check(st.live.has(near) && !st.live.has(far), "at night the map shows the hub's own ring, not 3 tiles out");
}

console.log("Outsiders on the same tile");
{
  const st = world();
  const { p } = team(st);
  clearHordes(st);
  const tile = st.tiles.find((t) => t.terrain === "plains" && !t.loc && st.grid.distance(t.id, hub(st).tile) === 6).id;
  park(p, tile);
  atHour(st, 2);
  st.visitors = st.visitors || [];
  const v = { id: newId(), kind: "raiders", name: "the Kessler gang", home: "the north", size: 6, power: 3, tile, phase: "travel", stock: {}, met: {}, goal: null };
  st.visitors.push(v);
  const card = contactAttack(st, p);
  check(!!card && card.visitorId === v.id && p.phase === "engaged", `raiders from outside on the tile stop the team (${card && card.title})`);
  st.cards.length = 0; p.phase = "waiting";
  check(!contactAttack(st, p), `not again within ${CONTACT.AGAIN} hours`);
  st.hour += CONTACT.AGAIN;
  check(!!contactAttack(st, p), `again after ${CONTACT.AGAIN} hours`);
  st.cards.length = 0; p.phase = "waiting"; p.contacts = {};
  v.kind = "merchants";
  check(!contactAttack(st, p), "merchants on the tile do not attack");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
