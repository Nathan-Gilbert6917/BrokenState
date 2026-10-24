// Road events (src/sim/events.js) and the newer hub events (src/sim/hubevents.js): every card comes where it should,
// every choice does something and says so, the autopilot answers each one, and the dice bring them up in play. Then
// hardcore's year Calder falls (events.js HC_EVENTS, hubevents.js hc_*): only in hardcore and only before the day a
// normal game would start.
// Usage: node tools/roadeventstest.js [seed] [rolls=4000] (about half a minute).
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { addBuilding } from "../src/sim/buildings.js";
import { launchExpedition, partyMembers, carried, giveOrder, partyTile } from "../src/sim/parties.js";
import { tickHour, day, factionById } from "../src/sim/world.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { hardcoreEraOffset } from "../src/sim/hardcore-outbreak.js";
import { hcMilitary } from "../src/sim/hardcore-groups.js";
import { TRAVEL_EVENT_IDS, travelEventFits, travelEventCard, rollTravelEvent } from "../src/sim/events.js";
import { HUB_EVENT_IDS, hubEventCard, hubEventWeights, RATS, COLD, HC_DESERTER } from "../src/sim/hubevents.js";
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

const NEW_ROAD = ["creek", "animals", "warning", "farmhouse", "orchard", "station", "camp", "convoy", "wormdying"];
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
  convoy: [HOURS.summer, (st) => { const id = tileOf(st, (t) => t.road && t.terrain === "plains"); st.tiles[id].infection = 0.5; return id; }],
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
  check(!travelEventFits(v.st, v.p, "convoy", v.tile), "no overrun convoy on clean land");
  const offroad = tileOf(v.st, (t) => !t.road && t.terrain === "plains");
  v.st.tiles[offroad].infection = 0.5;
  check(!travelEventFits(v.st, v.p, "convoy", offroad), "no overrun convoy off the road");
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
  for (const title of ["A swollen creek", "A lonely farmhouse", "A roadside gas station", "An overrun camp", "An overrun convoy", "A stranger with the worm"]) check(counts[title] > 0, `"${title}" comes up in play`);
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
  check(cold.choices[0].label.includes(`${COLD.wood * atBase(s0, h0.id).length} wood`), "the cold snap's wood is 3 days' heating a head");
}

// ---------------------------------------------------------------------------------------------------------
section("Hardcore: the year Calder falls, on the road");
const NEW_HC_ROAD = ["hc_gridlock", "hc_checkpoint", "hc_broadcast", "hc_holdouts", "hc_looters", "hc_newdead", "hc_drop"];
// A hardcore world on day `d` with its team on the road; the tile it meets the event on set up by `pick`.
function hcWorld(d, pick, seed = SEED) {
  const st = createWorld({ seed, factionCount: 6, mode: "hardcore" });
  st.cards.length = 0;
  st.noWanderers = true;
  st.hour = (d - 1) * 24 + 12;
  const p = roadTeam(st);
  for (const m of partyMembers(st, p)) { m.mood = 50; m.health = 100; }
  return { st, p, tile: pick(st, p) };
}
const roadTile = (st) => tileOf(st, (t) => t.road && t.terrain === "plains");
const HC_SETUPS = {
  hc_gridlock: roadTile, hc_checkpoint: roadTile, hc_broadcast: roadTile,
  hc_holdouts: (st) => tileOf(st, (t) => t.terrain === "suburb"),
  hc_looters: (st) => tileOf(st, (t) => t.terrain === "suburb"),
  hc_newdead: roadTile,
  hc_drop: (st) => tileOf(st, (t) => t.terrain === "plains"),
};
for (const id of NEW_HC_ROAD) {
  check(TRAVEL_EVENT_IDS.includes(id), `${id}: in the road event table`);
  const w0 = hcWorld(5, HC_SETUPS[id]);
  check(travelEventFits(w0.st, w0.p, id, w0.tile), `${id}: fits a hardcore run on day 5`);
  // Never in a normal game, nor once the normal game's start date has passed.
  const n = world(HOURS.summer, HC_SETUPS[id]);
  check(!travelEventFits(n.st, n.p, id, n.tile), `${id}: never in a normal game`);
  const late = hcWorld(hardcoreEraOffset(w0.st) + 2, HC_SETUPS[id]);
  check(!travelEventFits(late.st, late.p, id, late.tile), `${id}: gone once the outbreak year is over`);
  const card0 = travelEventCard(w0.st, w0.p, id, w0.tile);
  check(card0.choices.length >= 2 && !/undefined|NaN/.test(card0.title + card0.text), `${id}: a card (${card0.title}: ${card0.text})`);
  for (let i = 0; i < card0.choices.length; i++) {
    for (let k = 0; k < 6; k++) {
      const { st, p, tile } = hcWorld(5, HC_SETUPS[id], SEED + k);
      const c = travelEventCard(st, p, id, tile).choices[i];
      if (!enabled(st, c)) continue;
      const before = snap(st, p);
      const text = c.resolve(st);
      if (!check(typeof text === "string" && text.length > 0 && !/undefined|NaN|\[object/.test(text), `${id} → ${c.label}: text (${text})`)) break;
      check(snap(st, p) !== before || /^(Move on|Leave it)/.test(c.label) || /Get off our lawn/.test(text), `${id} → ${c.label}: changes something (${text})`);
      if (k === 0) console.log(`  ${c.label}: ${text}`);
    }
  }
  // The autopilot answers it.
  const a = hcWorld(5, HC_SETUPS[id]);
  a.st.autopilot = true;
  const card = travelEventCard(a.st, a.p, id, a.tile);
  a.st.cards.push(card);
  autopilotResolve(a.st);
  check(!a.st.cards.includes(card) && a.st.log.some((l) => l.text.includes(card.title)), `${id}: answered by the autopilot`);
}
{
  // The relief drop only while the Guard stands; the broadcast marks where the outbreak began.
  const w = hcWorld(5, HC_SETUPS.hc_drop);
  const m = hcMilitary(w.st);
  if (m) { m.fell = true; check(!travelEventFits(w.st, w.p, "hc_drop", w.tile), "no relief drops once the Guard has fallen"); }
  const b = hcWorld(5, roadTile);
  const before = b.p.seen.size;
  travelEventCard(b.st, b.p, "hc_broadcast", b.tile).choices[0].resolve(b.st);
  check(b.p.seen.size > before && b.st.hives.some((h) => b.p.seen.has(h.tile)), "the broadcast puts the first hive on the map");
  // In play: a hardcore team's first weeks on the road roll them.
  const titles = new Set(["Gridlock", "An abandoned checkpoint", "The emergency broadcast", "They would not leave", "Still in uniform", "A relief drop"]);
  const firstMonth = (seed) => {
    const counts = {};
    const r = hcWorld(3, roadTile, seed);
    const ground = r.st.tiles.filter((t) => t.terrain !== "water" && !r.st.bases.some((x) => x.tile === t.id)).map((t) => t.id);
    let all = 0;
    for (let i = 0; i < ROLLS; i++) {
      r.st.hour = (2 + (i % 30)) * 24 + (i % 24);
      r.p.lastConflict = r.st.hour; r.p.eventHour = -1;
      const card = rollTravelEvent(r.st, r.p, ground[(i * 7919) % ground.length]);
      if (!card) continue;
      all++;
      if (titles.has(card.title) || / being looted$/.test(card.title)) counts[card.title] = (counts[card.title] || 0) + 1;
      for (const m of partyMembers(r.st, r.p)) { m.health = 100; m.mood = 50; }
    }
    return { counts, all, hcN: Object.values(counts).reduce((a, x) => a + x, 0) };
  };
  const { counts, all, hcN } = firstMonth(SEED);
  console.log(`  first month: ${hcN} of ${all} road cards are the year's own (${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(", ")})`);
  check(Object.keys(counts).length >= 5, "most of them come up in the first month");
  // The share over three worlds (one world's ~400 cards swing it by a few points either way: seed 42's lands near 15%
  // since the rain waves of 2026-10-23 moved the dice, its neighbours near 20%).
  const more = [SEED + 1, SEED + 2].map(firstMonth);
  const hcAll = hcN + more.reduce((a, m) => a + m.hcN, 0), cardsAll = all + more.reduce((a, m) => a + m.all, 0);
  check(hcAll > cardsAll * 0.15 && hcAll < cardsAll * 0.6, `a fair share of the road cards, not all of them (${Math.round((100 * hcAll) / Math.max(1, cardsAll))}% over 3 worlds; this one ${Math.round((100 * hcN) / Math.max(1, all))}%)`);
}

// ---------------------------------------------------------------------------------------------------------
section("Hardcore: the year Calder falls, at the hub");
{
  const NEW_HC_HUB = ["hc_crowd", "hc_deserter", "hc_silence", "hc_cityfolk"];
  // A hardcore run whose team has set up its first camp (the hub), on day `d`.
  const hcHub = (d, seed = SEED) => {
    const st = createWorld({ seed, factionCount: 6, mode: "hardcore" });
    st.noWanderers = true;
    const p = roadTeam(st);
    p.pitched = true; // staging.js: the hour of pitching skipped (tools/hcstarttest.js)
    giveOrder(st, p, "establish");
    for (let k = 0; k < 6 && !st.bases.length; k++) tickHour(st);
    st.cards.length = 0;
    st.hour = (d - 1) * 24 + 12;
    const hb = hub(st);
    setFood(hb, 80); Object.assign(hb.stock, { water: 40 });
    return { st, hb };
  };
  const { st, hb } = hcHub(12);
  check(!!hb, "the camp is the hub");
  const m = hcMilitary(st);
  if (m) m.strike = m.strike || { phase: "fight", city: st.tiles[0].id }; // the strike force out: deserters walk away from it
  const w = hubEventWeights(st, hb);
  for (const id of NEW_HC_HUB) check(HUB_EVENT_IDS.includes(id) && w[id] > 0, `${id}: can come at a hardcore hub on day 12 (${(w[id] || 0).toFixed(2)})`);
  const { st: n, hb: nh } = (() => { const s2 = createWorld({ seed: SEED, factionCount: 6 }); return { st: s2, hb: hub(s2) }; })();
  const wn = hubEventWeights(n, nh);
  check(NEW_HC_HUB.every((id) => wn[id] === 0), "none of them in a normal game");
  const late = hcHub(hardcoreEraOffset(st) + 2);
  const wl = hubEventWeights(late.st, late.hb);
  check(NEW_HC_HUB.every((id) => wl[id] === 0), "none once the outbreak year is over");
  // The broadcast goes quiet once a run.
  hubEventCard(st, "hc_silence", hb);
  check(hubEventWeights(st, hb).hc_silence === 0, "the radio goes quiet only once a run");
  // Taking in a deserter costs the Guard's goodwill.
  if (m) {
    const f = factionById(st, m.id);
    const card = hubEventCard(st, "hc_deserter", hb);
    const take = card.choices.find((c) => c.kind === "take");
    const g0 = f.goodwill;
    const text = take.resolve(st);
    check(f.goodwill < g0 && hb && atBase(st, hb.id).some((s) => s.name && text.includes(s.name.split(" ")[0])), `a deserter taken in: ${f.name} goodwill ${g0} → ${f.goodwill} (${text})`);
    check(take.hint.includes(`goodwill -${HC_DESERTER.goodwill}`), "the card says what it costs");
  }
  // Each choice of the hungry crowd and the radio does something (the recruit cards are recruits.js's own).
  for (const id of ["hc_crowd", "hc_silence"]) {
    const c0 = hubEventCard(hcHub(12).st, id, hub(hcHub(12).st));
    for (let i = 0; i < c0.choices.length; i++) {
      const h2 = hcHub(12);
      const card = hubEventCard(h2.st, id, h2.hb);
      const c = card.choices[i];
      if (!enabled(h2.st, c)) continue;
      const before = JSON.stringify([h2.hb.stock, atBase(h2.st, h2.hb.id).map((s) => Math.round(s.mood * 100))]);
      const text = c.resolve(h2.st);
      check(typeof text === "string" && text.length > 0 && !/undefined|NaN/.test(text) && typeof c.ai === "function" && c.hint, `${id} → ${c.label}: ${text}`);
      check(JSON.stringify([h2.hb.stock, atBase(h2.st, h2.hb.id).map((s) => Math.round(s.mood * 100))]) !== before, `${id} → ${c.label}: changes something`);
    }
  }
}

console.log(`\n${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
