// Road events (src/sim/events.js) and the newer hub events (src/sim/hubevents.js): every card comes where it should,
// every choice does something and says so, the autopilot answers each one, and the dice bring them up in play.
// Usage: node tools/roadeventstest.js [seed] [rolls=4000] (about half a minute).
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { addBuilding } from "../src/sim/buildings.js";
import { launchExpedition, partyMembers, carried } from "../src/sim/parties.js";
import { TRAVEL_EVENT_IDS, travelEventFits, travelEventCard, rollTravelEvent } from "../src/sim/events.js";
import { HUB_EVENT_IDS, hubEventCard, hubEventWeights, RATS, COLD } from "../src/sim/hubevents.js";
import { makeHorde } from "../src/sim/hordes.js";
import { season } from "../src/sim/weather.js";
import { foodIn } from "../src/sim/foods.js";
import { setFood } from "./foodkit.js";
import { autopilotResolve } from "../src/sim/autopilot.js";

const SEED = Number(process.argv[2] || 42);
const ROLLS = Number(process.argv[3] || 4000);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (t) => console.log(t);
const enabled = (st, c) => !(typeof c.disabled === "function" ? c.disabled(st) : c.disabled);

const NEW_ROAD = ["creek", "animals", "warning", "farmhouse", "orchard", "station", "camp", "wormdying"];
const NEW_HUB = ["rats", "fence", "sick", "cold", "music", "salvage"];

// A world with a team of three on foot a few tiles out, at hour `hour`, the tile it meets the event on set up to fit.
function world(hour, setup, seed = SEED) {
  const st = createWorld({ seed, factionCount: 6 });
  st.cards.length = 0;
  st.hour = hour;
  const h = hub(st);
  const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, 3);
  const dest = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 5).id;
  const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", supplies: { food: 8, water: 8, ammo: 60 } }).party;
  for (const m of partyMembers(st, p)) { m.mood = 50; m.health = 100; }
  const tile = setup(st, p);
  return { st, p, tile };
}
// Days into the run of each season (weather.js season), found by walking the calendar.
const seasonHour = (key) => { const st = createWorld({ seed: SEED, factionCount: 2 }); for (let d = 1; d < 500; d++) if (season(st, d * 24 + 12).key === key) return (d + 3) * 24 + 12; return 12; };
const HOURS = { spring: seasonHour("spring"), summer: seasonHour("summer"), autumn: seasonHour("autumn"), winter: seasonHour("winter") };
const tileOf = (st, pred) => st.tiles.find((t) => !t.loc && !st.bases.some((b) => b.tile === t.id) && pred(t)).id;
// Each new road event: the hour and the tile it fits (infection set where it asks for the dead nearby).
const SETUPS = {
  creek: [HOURS.spring, (st) => tileOf(st, (t) => t.terrain === "plains")],
  animals: [HOURS.winter, (st) => tileOf(st, (t) => t.terrain === "forest")],
  warning: [HOURS.summer, (st) => { const id = tileOf(st, (t) => t.terrain === "plains"); const near = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, id) === 3).id; makeHorde(st, { tile: near, size: 40 }); return id; }],
  farmhouse: [HOURS.summer, (st) => { const id = tileOf(st, (t) => t.terrain === "plains"); st.tiles[id].infection = 0.5; return id; }],
  orchard: [HOURS.autumn, (st) => tileOf(st, (t) => t.terrain === "plains")],
  station: [HOURS.summer, (st) => { const id = tileOf(st, (t) => t.road && t.terrain === "plains"); st.tiles[id].infection = 0.4; return id; }],
  camp: [HOURS.summer, (st) => { const id = tileOf(st, (t) => t.terrain === "plains"); st.tiles[id].infection = 0.5; return id; }],
  wormdying: [HOURS.summer, (st) => { const id = tileOf(st, (t) => t.terrain === "plains"); st.tiles[id].infection = 0.5; return id; }],
};
const snap = (st, p) => JSON.stringify({ sup: p.supplies, cargo: p.cargo, prog: Math.round((p.progress || 0) * 1000), seen: p.seen.size,
  ppl: partyMembers(st, p).map((m) => [Math.round(m.mood * 100), Math.round(m.health * 100)]), alive: st.parties.includes(p) });

// ---------------------------------------------------------------------------------------------------------
section("Road events: where they come, every choice");
for (const id of NEW_ROAD) {
  check(TRAVEL_EVENT_IDS.includes(id), `${id}: in the road event table`);
  const [hour, setup] = SETUPS[id];
  const w0 = world(hour, setup);
  check(travelEventFits(w0.st, w0.p, id, w0.tile), `${id}: fits its setting`);
  const card0 = travelEventCard(w0.st, w0.p, id, w0.tile);
  check(card0.choices.length >= 2 && card0.partyId === w0.p.id && card0.where, `${id}: a card with choices (${card0.title})`);
  check(!/undefined|NaN/.test(card0.title + card0.text), `${id}: text (${card0.text})`);
  for (let i = 0; i < card0.choices.length; i++) {
    // Each choice several times on fresh worlds (the dice: success, failure, someone hurt).
    for (let k = 0; k < 6; k++) {
      const { st, p, tile } = world(hour, setup, SEED + k); // other seeds: other dice
      const card = travelEventCard(st, p, id, tile);
      const c = card.choices[i];
      if (!enabled(st, c)) { check(k > 0 || /food/.test(c.label), `${id} → ${c.label}: enabled with food packed`); continue; }
      const before = snap(st, p);
      const text = c.resolve(st);
      if (!check(typeof text === "string" && text.length > 0 && !/undefined|NaN|\[object/.test(text), `${id} → ${c.label}: text (${text})`)) break;
      const quiet = /^(Move on|Leave it|Mark it)/.test(c.label) || /gravel bar/.test(text); // a clean crossing costs nothing
      check(snap(st, p) !== before || quiet, `${id} → ${c.label}: changes something (${text})`);
      if (k === 0) console.log(`  ${card.title} → ${c.label}: ${text}`);
    }
  }
}
// The settings they need: not on the wrong ground or in the wrong season.
{
  const w = world(HOURS.winter, (st) => tileOf(st, (t) => t.terrain === "plains"));
  check(!travelEventFits(w.st, w.p, "orchard", w.tile), "no orchard in winter");
  const v = world(HOURS.summer, (st) => tileOf(st, (t) => t.terrain === "plains"));
  check(!travelEventFits(v.st, v.p, "warning", v.tile) || v.st.hordes.some((h) => v.st.grid.distance(h.tile, v.tile) <= 4), "a warning only with a horde within 4 tiles");
  v.st.tiles[v.tile].infection = 0;
  check(!travelEventFits(v.st, v.p, "wormdying", v.tile) && !travelEventFits(v.st, v.p, "camp", v.tile), "no worm-sick stranger or overrun camp on clean land");
  const city = tileOf(v.st, (t) => t.terrain === "city");
  check(!travelEventFits(v.st, v.p, "farmhouse", city), "no lonely farmhouse in a city");
}

// ---------------------------------------------------------------------------------------------------------
section("Road events: the autopilot answers each");
for (const id of NEW_ROAD) {
  const [hour, setup] = SETUPS[id];
  const { st, p, tile } = world(hour, setup);
  st.autopilot = true;
  const card = travelEventCard(st, p, id, tile);
  st.cards.push(card);
  autopilotResolve(st);
  check(!st.cards.includes(card), `${id}: answered by the autopilot`);
  const line = st.log.find((l) => l.text.includes(card.title));
  check(!!line, `${id}: the autopilot says what it chose (${line ? line.text.slice(0, 120) : "no line"})`);
}

// ---------------------------------------------------------------------------------------------------------
section(`Road events: ${ROLLS} rolls on the road`);
{
  const counts = {};
  const { st, p } = world(HOURS.summer, (s) => s.tiles[0].id);
  const ground = st.tiles.filter((t) => t.terrain !== "water" && !st.bases.some((b) => b.tile === t.id)).map((t) => t.id);
  const hours = [HOURS.spring, HOURS.summer, HOURS.autumn, HOURS.winter];
  for (let i = 0; i < ROLLS; i++) {
    st.hour = hours[i % 4] + (i % 24);
    p.lastConflict = st.hour; // no road fights: the travel events only
    p.eventHour = -1;
    const card = rollTravelEvent(st, p, ground[(i * 7919) % ground.length]);
    if (!card) continue;
    counts[card.title] = (counts[card.title] || 0) + 1;
    for (const m of partyMembers(st, p)) { m.health = 100; m.mood = 50; }
  }
  const show = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  console.log(`  ${show.map(([t, n]) => `${t} ${n}`).join(", ")}`);
  for (const title of ["A swollen creek", "A lonely farmhouse", "A roadside gas station", "An overrun camp", "A stranger with the worm"]) check(counts[title] > 0, `"${title}" comes up in play`);
  check((counts.Wolves || 0) + (counts["Feral dogs"] || 0) > 0, "wolves or feral dogs come up in play");
  check((counts["A gone-wild orchard"] || 0) + (counts["Brambles in fruit"] || 0) > 0, "an orchard or brambles come up in play");
}

// ---------------------------------------------------------------------------------------------------------
section("Hub events: the new ones");
{
  const fresh = (hour = HOURS.winter) => {
    const st = createWorld({ seed: SEED + 3, factionCount: 6 });
    st.cards.length = 0;
    const hb = hub(st);
    for (const t of ["farm_plot", "bunkhouse", "walls"]) addBuilding(hb, t);
    Object.assign(hb.stock, { water: 60, scrap: 40, parts: 6, meds: 10, fuel: 20, wood: 600 });
    setFood(hb, 150);
    hb.dog = { name: "Rusty", since: 1 };
    st.tiles[hb.tile].infection = Math.max(0.3, st.tiles[hb.tile].infection || 0);
    st.hour = hour;
    return { st, hb };
  };
  for (const id of NEW_HUB) check(HUB_EVENT_IDS.includes(id), `${id}: a hub event`);
  const { st: s0, hb: h0 } = fresh();
  const w = hubEventWeights(s0, h0);
  for (const id of NEW_HUB) check(Number.isFinite(w[id]) && w[id] > 0, `${id}: can come at a winter hub on infected land (${w[id].toFixed(2)})`);
  const { st: s1, hb: h1 } = fresh(HOURS.summer);
  check(hubEventWeights(s1, h1).cold === 0, "no cold snap in summer");
  delete h1.dog;
  check(hubEventWeights(s1, h1).rats > hubEventWeights(...(() => { const f = fresh(HOURS.summer); return [f.st, f.hb]; })()).rats, "a dog keeps the rats down");
  const rats = hubEventCard(s0, "rats", h0);
  check(rats.choices.some((c) => /Rusty/.test(c.label)), "the dog is offered against the rats");
  const lose = Math.round(foodIn(h0.stock) * RATS.share);
  check(rats.text.includes(`${Math.min(RATS.max, Math.max(RATS.min, lose))} food`), "the rats' loss on the card is the code's");
  const cold = hubEventCard(s0, "cold", h0);
  check(cold.choices[0].label.includes(`${COLD.wood * atBase(s0, h0.id).length} firewood`), "the cold snap's firewood is 3 days' heating a head");
}

console.log(`\n${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
