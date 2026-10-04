// People: newcomers ask first (recruits.js), crowding and the leader (morale.js), hub events (hubevents.js),
// warnings before desertion and what deserters take (morale.js), and long runs without NaN.
// Usage: node tools/peopletest.js [seed] [days]
import { createWorld, tickHour, hub, atBase, alive, residents, day, makeSurvivor, killSurvivor } from "../src/sim/world.js";
import { basesDaily } from "../src/sim/economy.js";
import { baseBeds, addBuilding } from "../src/sim/buildings.js";
import { launchExpedition, partyMembers, carried } from "../src/sim/parties.js";
import { triggerConflict } from "../src/sim/conflicts.js";
import { collapseFaction } from "../src/sim/factions.js";
import { rollTravelEvent } from "../src/sim/events.js";
import { newItem, stow, allItems } from "../src/sim/inventory.js";
import { weatherOnDay } from "../src/sim/weather.js";
import { makeCandidate, recruitCard, recruitsDaily, baseOutlook, teamOutlook, autoRecruitPick, JOIN_FOOD, PART_BASE, PART_TEAM, RETURN } from "../src/sim/recruits.js";
import { crowdInfo, crowding, baseMoraleDaily, desert, CROWD } from "../src/sim/morale.js";
import { HUB_EVENT_IDS, hubEventCard, hubEventWeights, hubEventChance, hubEventsDaily, hubUpkeepDaily, FIRE, WELL_DOWN, DOG } from "../src/sim/hubevents.js";
import { autopilotResolve } from "../src/sim/autopilot.js";

const seed = Number(process.argv[2] || 42);
const longDays = Number(process.argv[3] || 200);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(t);
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.cards.length = 0; return st; };
const addPerson = (st, base, mood = 60) => { const s = makeSurvivor(st, 1); s.traits = []; s.location = { kind: "base", baseId: base.id }; s.role = "farm"; s.mood = mood; st.survivors.push(s); return s; };
const nextDay = (st) => { st.hour += 24; };
const enabled = (st, c) => !(typeof c.disabled === "function" ? c.disabled(st) : c.disabled);
const choice = (card, kind) => card.choices.find((c) => c.kind === kind);
const sendOut = (st, n = 2, supplies = { food: 8, water: 8 }) => {
  const h = hub(st);
  const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, n);
  const dest = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 5).id;
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", supplies });
  if (res.party) res.party.idx = Math.min(2, res.party.path.length - 1);
  return res.party;
};
const finite = (v) => typeof v === "number" && Number.isFinite(v);

// ---------------------------------------------------------------------------------------------------------
section("Recruit cards: every source asks first");
const sources = {};
{
  // A stranger at the gate (economy.js).
  const st = W();
  for (let i = 0; i < 2000 && !sources.stranger; i++) { st.cards.length = 0; basesDaily(st); sources.stranger = st.cards.find((c) => c.recruit && c.recruit.source === "stranger") || null; }
  // Refugees after a group collapses (factions.js): 60% of collapses.
  for (let i = 0; i < 40 && !sources.refugees; i++) {
    const s2 = W(seed + i);
    collapseFaction(s2, s2.factions.find((f) => f.alive));
    sources.refugees = s2.cards.find((c) => c.recruit && c.recruit.source === "refugees") || null;
  }
  // A loner on the road (events.js).
  for (let i = 0; i < 30 && !sources.loner; i++) {
    const s3 = W(seed + i);
    const p = sendOut(s3);
    for (let k = 0; k < 400 && !sources.loner && p; k++) {
      p.lastConflict = s3.hour; // no road fights: travel events only
      s3.cards.length = 0;
      const c = rollTravelEvent(s3, p, p.path[p.idx]);
      if (c && c.recruit) sources.loner = c;
    }
  }
  // Survivors saved or freed after a road fight (conflicts.js): fight until someone asks to join.
  for (let i = 0; i < 60 && !sources.road; i++) {
    const s4 = W(seed + 100 + i);
    s4.autoCombat = true;
    const p = sendOut(s4, 4, { food: 10, water: 10, ammo: 60 });
    if (!p) continue;
    for (const m of partyMembers(s4, p)) { m.gear.weapon = newItem("ar"); m.health = 100; }
    triggerConflict(s4, p, ["hordeattack", "robbery", "prisoners"][i % 3], null);
    for (let n = 0; n < 12 && s4.cards.length && !sources.road; n++) {
      const c = s4.cards.shift();
      if (c.recruit) { sources.road = c; break; }
      const opts = c.choices.filter((x) => !x.uiAction && enabled(s4, x));
      const ch = opts.find((x) => /^(Help|Ambush|Attack|Fight|Hit|Draw|Pay for|Free)/.test(x.label)) || opts.find((x) => /Continue|Return/.test(x.label)) || opts[0];
      if (ch) ch.resolve(s4);
    }
    if (!sources.road) sources.road = s4.cards.find((c) => c.recruit) || null;
  }
  // A lost teenager (hub event), a deserter coming back (recruits.js).
  sources.teen = hubEventCard(W(), "teen");
  const s6 = W();
  desert(s6, hub(s6), atBase(s6, hub(s6).id).find((s) => !s.leader));
  const keep = RETURN.chance;
  RETURN.chance = 1;
  for (let i = 0; i < RETURN.after + 1; i++) { nextDay(s6); recruitsDaily(s6); }
  RETURN.chance = keep;
  sources.returning = s6.cards.find((c) => c.recruit && c.recruit.source === "returning") || null;
  for (const k of ["stranger", "refugees", "loner", "road", "teen", "returning"]) check(!!sources[k], `a recruit card from: ${k}`);
  for (const [k, card] of Object.entries(sources)) {
    if (!card || !card.recruit) continue;
    const s = card.recruit.candidates[0];
    check(card.recruit.candidates.every((c) => c.pending), `${k}: candidates wait (not in the group yet)`);
    check(card.text.includes(s.name) && /health \d+/.test(card.text), `${k}: the card names them with health (${card.text.slice(0, 80)}…)`);
    check(/beds free/.test(card.text) && /food for/.test(card.text) && /water/.test(card.text), `${k}: beds, food and water on the card`);
    check(card.choices.some((c) => c.kind === "take") && card.choices.some((c) => c.kind === "away") && card.choices.some((c) => c.kind === "part") && card.choices.some((c) => c.kind === "send" || card.recruit.partyId == null),
      `${k}: take / send / part ways / turn away (${card.choices.map((c) => c.label).join(" | ")})`);
  }
  if (sources.refugees) check(sources.refugees.recruit.candidates.length >= 1 && sources.refugees.recruit.candidates.length <= 3, "refugees: 1–3 people");
  if (sources.road) check(sources.road.recruit.partyId != null && sources.road.choices.some((c) => /along$/.test(c.label)), "road: take them along offered");
}

section("Recruit card numbers: beds, food and water");
{
  const st = W();
  const h = hub(st);
  const o = baseOutlook(st, h, 2);
  check(o.beds === baseBeds(h) && o.people === residents(st, h.id).length && o.free === o.beds - o.people && o.freeWith === o.free - 2, `beds ${o.beds}, people ${o.people}, free ${o.free} → ${o.freeWith} with 2`);
  check(o.foodDays == null || (finite(o.foodDays) && o.foodDaysWith < o.foodDays), `food days ${o.foodDays && o.foodDays.toFixed(1)} → ${o.foodDaysWith && o.foodDaysWith.toFixed(1)} with 2`);
  check(o.waterNetWith < o.waterNet, `water a day ${o.waterNet} → ${o.waterNetWith}`);
  const c = recruitCard(st, [makeCandidate(st)], { source: "stranger", baseId: h.id });
  check(new RegExp(`${Math.max(0, o.free)} of ${o.beds} beds free`).test(c.text), "the card's bed count matches the base");
}

section("Recruit options: what each one does");
{
  // Base card: take in.
  let st = W(); let h = hub(st);
  let s = makeCandidate(st); let card = recruitCard(st, [s], { source: "stranger", baseId: h.id });
  h.stock.food = 50; let n = st.survivors.length; const saved = st.stats.peopleSaved;
  card.choices[0].resolve(st);
  check(st.survivors.length === n + 1 && s.alive && s.location.baseId === h.id && !s.pending && h.stock.food === 50 - JOIN_FOOD && st.stats.peopleSaved === saved + 1, `take in: joins the hub, ${JOIN_FOOD} food`);
  card.choices[0].resolve(st);
  check(st.survivors.length === n + 1, "answering twice does not add them twice");
  // Take only one.
  st = W(); h = hub(st);
  const three = [makeCandidate(st), makeCandidate(st), makeCandidate(st)];
  card = recruitCard(st, three, { source: "refugees", baseId: h.id });
  n = st.survivors.length;
  card.choices.find((c) => c.kind === "takeOne" && c.who === three[1]).resolve(st);
  check(st.survivors.length === n + 1 && st.survivors.includes(three[1]) && three.every((x) => !x.pending), "take only one: one joins, the others walk on");
  // Send to an outpost: walks there, arrives (or not) after the days on the road.
  st = W(); h = hub(st);
  const tile = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 9).id;
  const op = { id: 99999, tile, type: "outpost", name: "Test Outpost", stock: { food: 10, water: 10 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  st.bases.push(op);
  s = makeCandidate(st); card = recruitCard(st, [s], { source: "stranger", baseId: h.id });
  const send = card.choices.find((c) => c.kind === "send" && c.sendTo === op.id);
  check(!!send && /about 2 days, \d+% chance/.test(send.hint), `send to an outpost offered (${send && send.hint})`);
  send.resolve(st);
  const w = st.walkers[0];
  check(st.walkers.length === 1 && !st.survivors.includes(s) && w.arrive === day(st) + 2, "the walker is on the road, not yet in the group");
  w.chance = 1;
  nextDay(st); recruitsDaily(st);
  check(!st.survivors.includes(s), "not there after one day");
  nextDay(st); recruitsDaily(st);
  check(st.survivors.includes(s) && s.location.baseId === op.id && s.alive, "arrived at the outpost after two days");
  const s2 = makeCandidate(st); recruitCard(st, [s2], { source: "stranger", baseId: h.id }).choices.find((c) => c.sendTo === op.id).resolve(st);
  st.walkers[0].chance = 0;
  nextDay(st); nextDay(st); recruitsDaily(st);
  check(!st.survivors.includes(s2) && st.log.some((l) => l.text.includes(`${s2.name} never arrived`)), "a walker can be lost on the way (logged)");
  // Part ways: supplies, mood, goodwill.
  st = W(); h = hub(st);
  const f = st.factions.find((x) => x.alive && x.bases.length);
  f.known = true; f.goodwill = 10; f.bases = [st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 4).id, ...f.bases];
  h.stock.food = 40; h.stock.water = 40;
  const before = atBase(st, h.id).map((x) => x.mood);
  s = makeCandidate(st); card = recruitCard(st, [s], { source: "stranger", baseId: h.id });
  choice(card, "part").resolve(st);
  check(h.stock.food === 40 - PART_BASE.food && h.stock.water === 40 - PART_BASE.water, `part ways: ${PART_BASE.food} food and ${PART_BASE.water} water`);
  check(atBase(st, h.id).every((x, i) => x.mood >= Math.min(100, before[i] + 2) - 1e-9), "part ways: everyone at the hub mood +2");
  check(f.goodwill === 12 && !st.survivors.includes(s), `part ways: goodwill +2 with a known group nearby (${f.goodwill})`);
  // Turn away.
  s = makeCandidate(st); card = recruitCard(st, [s], { source: "stranger", baseId: h.id });
  const fd = h.stock.food;
  choice(card, "away").resolve(st);
  check(!st.survivors.includes(s) && h.stock.food === fd && !s.pending, "turn away: no cost, not in the group");
  // Road card: take along only if the rations cover the way home.
  st = W(); h = hub(st);
  const p = sendOut(st, 2, { food: 2, water: 2 });
  s = makeCandidate(st);
  card = recruitCard(st, [s], { source: "road", partyId: p.id });
  const t = teamOutlook(st, p, 1);
  check(!enabled(st, choice(card, "take")) === !t.ok, `take along disabled when rations are short (${t.food} food for ${t.members}+1, need ${t.need})`);
  p.supplies.food = 40; p.supplies.water = 40;
  check(enabled(st, choice(card, "take")), "take along allowed with enough rations");
  choice(card, "take").resolve(st);
  check(p.members.includes(s.id) && s.location.kind === "party" && st.survivors.includes(s), "take along: joins the team");
  s = makeCandidate(st); card = recruitCard(st, [s], { source: "road", partyId: p.id });
  const pf = carried(p, "food"), pw = carried(p, "water");
  choice(card, "part").resolve(st);
  check(carried(p, "food") === pf - PART_TEAM.food && carried(p, "water") === pw - PART_TEAM.water, "road part ways: the team pays 2 food and 2 water");
  s = makeCandidate(st); card = recruitCard(st, [s], { source: "road", partyId: p.id });
  check(card.choices.filter((c) => c.kind === "send").some((c) => c.sendTo === h.id), "road: send them to the hub offered");
  choice(card, "send").resolve(st);
  check(st.walkers.some((x) => x.s === s), "road send: walking to a base");
  // The autopilot's pick follows its room rule.
  st = W(); h = hub(st);
  card = recruitCard(st, [makeCandidate(st), makeCandidate(st)], { source: "refugees", baseId: h.id });
  const opts = card.choices.filter((c) => enabled(st, c));
  check(autoRecruitPick(st, card, opts, () => true).kind === "take", "autopilot: room for all → take them all");
  check(autoRecruitPick(st, card, opts, (k) => k === 1).kind === "takeOne", "autopilot: room for one → the best one");
  check(autoRecruitPick(st, card, opts, () => false).kind === "away", "autopilot: no room → turn away");
}

// ---------------------------------------------------------------------------------------------------------
section("Crowding: scales with how far over the beds; the leader softens but never cancels it");
{
  const st = W();
  const h = hub(st);
  const beds = baseBeds(h);
  const leader = atBase(st, h.id).find((s) => s.leader);
  const rows = [];
  for (const L of [0, 8, 14, 20]) {
    leader.skills.leadership = L;
    const r = [beds, beds + 1, Math.round(beds * 1.5), beds * 2, beds * 3].map((n) => crowdInfo(st, h, n));
    rows.push(`Leadership ${L}: ${r.map((x) => `${x.people}/${x.beds} ${x.net >= 0 ? "+" : ""}${x.net}`).join(", ")}`);
    check(r[0].penalty === 0 && r[0].net > 0, `L${L}: a full base (no one over) lifts mood (${r[0].net})`);
    for (let i = 1; i < r.length; i++) check(r[i].net < 0, `L${L}: ${r[i].people} in ${r[i].beds} beds is a net loss even with the leader (${r[i].net})`);
    for (let i = 2; i < r.length; i++) check(r[i].penalty > r[i - 1].penalty || r[i].penalty === CROWD.cap, `L${L}: the penalty grows (${r[i - 1].penalty} → ${r[i].penalty})`);
    for (const x of r) check(x.lift <= x.penalty * CROWD.leaderShare + 1e-9 || x.penalty === 0, `L${L}: leader lift ${x.lift} capped at half of ${x.penalty}`);
    check(r[1].penalty <= 3.5, `one extra person is a small drag (${r[1].penalty})`);
    check(r[3].penalty >= 9, `a doubled base is a crisis (${r[3].penalty})`);
  }
  console.log(`  mood a day from beds and the leader:\n  ${rows.join("\n  ")}`);
  leader.skills.leadership = 20;
  // Applied each day to everyone living there.
  while (residents(st, h.id).length < beds * 2) addPerson(st, h, 60);
  const ppl = atBase(st, h.id), mouths = residents(st, h.id);
  const ci = crowdInfo(st, h);
  ppl.forEach((s) => (s.mood = 60));
  baseMoraleDaily(st, h, ppl, mouths);
  check(mouths.every((s) => Math.abs(s.mood - (60 + ci.net)) < 1e-9), `everyone gets the day's crowding and leader mood (${ci.net})`);
  check(Math.abs(crowding(st, h) - 2) < 1e-9, `crowding(state, base) = ${crowding(st, h)} (people per bed, for health.js)`);
}

// ---------------------------------------------------------------------------------------------------------
section("Hub events: weights, frequency and effects");
{
  const st = W();
  const h = hub(st);
  // Weather and season: a fire is likelier on a hot, dry day than in the rain; storm damage only after storms or rain.
  const findDay = (pred) => { for (let d = 2; d < 400; d++) if (pred(weatherOnDay(st, d), weatherOnDay(st, d - 1))) return d; return null; };
  const at = (d) => { st.hour = (d - 1) * 24 + 12; return hubEventWeights(st, h); };
  const hot = findDay((w) => w.key === "heat" || w.key === "drought"), wet = findDay((w) => w.key === "rain" || w.key === "snow");
  const storm = findDay((w) => w.key === "storm" || w.key === "blizzard"), dry = findDay((w, y) => w.key === "clear" && y.key === "clear");
  check(hot && wet && at(hot).fire > at(wet).fire, `fire: hot day ${hot && at(hot).fire.toFixed(2)} > wet day ${wet && at(wet).fire.toFixed(2)}`);
  check(storm && at(storm).leak > 0 && at(storm).well > 0 && dry && at(dry).leak === 0 && at(dry).well === 0, "storm damage only after storms or rain");
  st.hour = 12;
  const w0 = hubEventWeights(st, h);
  while (residents(st, h.id).length < baseBeds(h) * 1.8) addPerson(st, h, 30);
  const w1 = hubEventWeights(st, h);
  check(w1.quarrel > w0.quarrel && w1.theft >= w0.theft, `crowding and low mood: quarrels ${w0.quarrel.toFixed(2)} → ${w1.quarrel.toFixed(2)}, theft ${w0.theft.toFixed(2)} → ${w1.theft.toFixed(2)}`);
  for (const id of HUB_EVENT_IDS) check(finite(w1[id]) && w1[id] >= 0, `${id}: weight is a number (${w1[id]})`);
  // Frequency by hub size: about one every 3–5 days at 10 people, fewer at a tiny hub.
  const gap = (people) => {
    const s2 = W(seed + 7);
    const hb = hub(s2);
    for (const s of atBase(s2, hb.id).slice(people)) killSurvivor(s2, s, null, "in a test");
    addBuilding(hb, "bunkhouse"); addBuilding(hb, "bunkhouse");
    let events = 0;
    const days = 400;
    for (let d = 0; d < days; d++) {
      nextDay(s2);
      for (const s of alive(s2)) { s.mood = 60; s.health = 100; if (s.location.kind === "errand") s.location = { kind: "base", baseId: hb.id }; }
      while (atBase(s2, hb.id).length < people) addPerson(s2, hb);
      hb.stock.food = 300; hb.stock.water = 80; hb.stock.scrap = 40;
      s2.cards.length = 0;
      hubEventsDaily(s2);
      if (s2.cards.some((c) => c.hubEvent)) events++;
      s2.cards.length = 0;
    }
    return days / Math.max(1, events);
  };
  const g4 = gap(4), g10 = gap(10), g20 = gap(20);
  console.log(`  days between hub events: 4 people ${g4.toFixed(1)}, 10 people ${g10.toFixed(1)}, 20 people ${g20.toFixed(1)}`);
  check(g10 >= 3 && g10 <= 5.5, `a mid-size hub (10) gets one every 3–5 days (${g10.toFixed(1)})`);
  check(g4 > g10 && g10 >= g20, "fewer at a tiny hub, more at a big one");
  check(hubEventChance(st, h) <= 0.45, "the daily chance stays capped");

  // Every event, every choice: it does something (state changes) and returns a text.
  const fresh = () => {
    const s2 = W(seed + 3);
    const hb = hub(s2);
    while (atBase(s2, hb.id).length < 8) addPerson(s2, hb, 50);
    Object.assign(hb.stock, { food: 150, water: 60, scrap: 40, parts: 6, meds: 10, ammo: 80, fuel: 20 });
    s2.hour = 24 * 30 + 12;
    return { s2, hb };
  };
  const snap = (s2, hb) => JSON.stringify({ stock: hb.stock, b: hb.buildings.map((b) => b.type), dog: hb.dog || null, well: hb.wellDown || null, lock: hb.storesLockedUntil || 0, easy: hb.theftEasyUntil || 0,
    ppl: s2.survivors.map((s) => [s.alive, Math.round(s.mood * 100), Math.round(s.health * 100), s.location.kind, s.left || false]), walkers: (s2.walkers || []).length });
  for (const id of HUB_EVENT_IDS) {
    const probe = fresh();
    const card0 = hubEventCard(probe.s2, id, probe.hb);
    check(card0.hubEvent === id && card0.choices.length >= 2, `${id}: a card with choices (${card0.title})`);
    for (let i = 0; i < card0.choices.length; i++) {
      // Each choice on its own fresh world (same seed: the same card).
      const { s2, hb } = fresh();
      const card = hubEventCard(s2, id, hb);
      const c = card.choices[i];
      check(typeof c.hint === "string" && c.hint.length > 0, `${id} → ${c.label}: has a hint`);
      check(typeof c.ai === "function" || !!card.recruit, `${id} → ${c.label}: the autopilot can score it`);
      if (!enabled(s2, c)) continue;
      const before = snap(s2, hb);
      const text = c.resolve(s2);
      check(typeof text === "string" && text.length > 0 && !/undefined|NaN/.test(text), `${id} → ${c.label}: text (${text})`);
      const changed = snap(s2, hb) !== before || /gets it running|holds/.test(text); // a lucky fix costs nothing
      const quiet = /^(Send them|Chase it off|Turn .* away|Leave them to it)/.test(c.label);
      check(changed || quiet, `${id} → ${c.label}: changes something`);
    }
  }
  // Spot checks: numbers on the card are the numbers in the code.
  {
    const { s2, hb } = fresh();
    const card = hubEventCard(s2, "fire", hb);
    const w = hb.stock.water;
    card.choices[0].resolve(s2);
    check(hb.stock.water === w - FIRE.water, `fire: fighting it costs ${FIRE.water} water`);
    const { s2: s3, hb: h3 } = fresh();
    const c3 = hubEventCard(s3, "fire", h3);
    const nb = h3.buildings.length;
    c3.choices[2].resolve(s3);
    check(h3.buildings.length === nb - 1, "fire: letting it burn loses the building");
  }
  {
    const { s2, hb } = fresh();
    const card = hubEventCard(s2, "well", hb);
    card.choices[card.choices.length - 1].resolve(s2);
    const wtr = hb.stock.water;
    s2.hour += 24; hubUpkeepDaily(s2);
    check(hb.wellDown && hb.stock.water === Math.max(0, wtr - WELL_DOWN.water), `broken well: ${WELL_DOWN.water} less water a day`);
  }
  {
    const { s2, hb } = fresh();
    hubEventCard(s2, "dog", hb).choices[0].resolve(s2);
    const fd = hb.stock.food, m = residents(s2, hb.id).map((s) => s.mood);
    hubUpkeepDaily(s2);
    check(hb.dog && Math.abs(hb.stock.food - (fd - DOG.food)) < 1e-9 && residents(s2, hb.id).every((s, i) => s.mood >= Math.min(100, m[i] + DOG.mood) - 1e-9), "dog: eats 0.5 food, +0.5 mood a day");
  }
  {
    const { s2, hb } = fresh();
    const card = hubEventCard(s2, "errand", hb);
    const who = s2.survivors.find((s) => card.title.startsWith(s.name));
    card.choices[0].resolve(s2);
    check(who.location.kind === "errand" && !residents(s2, hb.id).includes(who), "errand: away, not eating at the hub");
    const until = who.location.until;
    for (let d = day(s2); d <= until; d++) { s2.hour += 24; hubUpkeepDaily(s2); }
    check(who.location.kind === "base" || !who.alive, `errand: back by day ${until} (${who.alive ? "back" : "never came back"})`);
  }
  {
    const { s2, hb } = fresh();
    const fd = hb.stock.food;
    const card = hubEventCard(s2, "theft", hb);
    const lost = Number(/(\d+) food is gone/.exec(card.text)[1]);
    check(hb.stock.food === fd - lost, `theft: ${lost} food gone when the card comes up`);
  }
  {
    const { s2, hb } = fresh();
    const card = hubEventCard(s2, "feast", hb);
    const n = atBase(s2, hb.id).length, fd = hb.stock.food;
    const m = atBase(s2, hb.id).map((s) => s.mood);
    card.choices[0].resolve(s2);
    check(hb.stock.food === fd - 2 * n && atBase(s2, hb.id).every((s, i) => Math.abs(s.mood - Math.min(100, m[i] + 10)) < 1e-9), "feast: 2 food each, everyone +10");
  }
}

// ---------------------------------------------------------------------------------------------------------
section("Warnings before desertion");
{
  const st = W();
  const h = hub(st);
  h.stock.food = 9999;
  const s = atBase(st, h.id).find((x) => !x.leader);
  s.mood = 25;
  baseMoraleDaily(st, h, atBase(st, h.id), residents(st, h.id));
  check(s.moodWarn === 1 && st.log.some((l) => l.text.startsWith(`${s.name} talks about leaving`)), "below 30: first warning in the log");
  const card = st.cards.find((c) => c.moraleFor === s.id);
  check(!!card && /talks about leaving/.test(card.title) && card.choices.length === 4, `first warning card (${card && card.choices.map((c) => c.label).join(" | ")})`);
  s.mood = 12; // below 20 after the day's bed and leader lift
  st.cards.length = 0;
  baseMoraleDaily(st, h, atBase(st, h.id), residents(st, h.id));
  check(s.moodWarn === 2 && st.log.some((l) => l.text.startsWith(`${s.name} is close to leaving`)) && st.cards.some((c) => c.moraleFor === s.id && /close to leaving/.test(c.title)), "below 20: second warning (log and card)");
  // Never deserts on the night of the second warning, even at 0 mood.
  let left = 0;
  for (let i = 0; i < 200; i++) {
    const s2 = W(seed + i);
    const h2 = hub(s2);
    const v = atBase(s2, h2.id).find((x) => !x.leader);
    v.mood = 0;
    baseMoraleDaily(s2, h2, atBase(s2, h2.id), residents(s2, h2.id));
    if (!v.alive) left++;
  }
  check(left === 0, `nobody walks out the night they are first warned (${left} of 200)`);
  // Card options.
  const st2 = W();
  const h2 = hub(st2);
  h2.stock.food = 50; h2.stock.meds = 5;
  const v = atBase(st2, h2.id).find((x) => !x.leader);
  v.mood = 22; v.traits = [];
  baseMoraleDaily(st2, h2, atBase(st2, h2.id), residents(st2, h2.id));
  const wc = st2.cards.find((c) => c.moraleFor === v.id);
  const m0 = v.mood;
  wc.choices[2].resolve(st2);
  check(h2.stock.food === 46 && h2.stock.meds === 4 && Math.abs(v.mood - (m0 + 20)) < 1e-9, "gift: 4 food and 1 meds, mood +20");
  const m1 = v.mood;
  wc.choices[1].resolve(st2);
  check(v.role === "rest" && v.restUntil === day(st2) + 3 && Math.abs(v.mood - (m1 + 5)) < 1e-9, "rest: Rest role for 3 days, +5 now");
  const m2 = v.mood;
  wc.choices[0].resolve(st2);
  check(v.mood === Math.min(100, m2 + 25) || v.mood === Math.min(100, m2 + 5), `talk: +25 or +5 (${m2.toFixed(1)} → ${v.mood.toFixed(1)})`);
  // A long crowded run: every deserter had a second warning on an earlier day.
  let deserters = 0, unwarned = 0;
  for (const sd of [seed, seed + 1, seed + 2]) {
    const s3 = W(sd);
    const h3 = hub(s3);
    while (residents(s3, h3.id).length < baseBeds(h3) * 2.5) addPerson(s3, h3, 45);
    // Every line of the run (the log keeps only the last 200, so a warning can drop out of it before the walk-out).
    const lines = [], unshift = s3.log.unshift.bind(s3.log);
    s3.log.unshift = (...x) => { lines.push(...x); return unshift(...x); };
    for (let d = 0; d < 60 && !s3.gameOver; d++) {
      for (let k = 0; k < 24; k++) tickHour(s3);
      h3.stock.food = Math.max(h3.stock.food, 200); h3.stock.water = Math.max(h3.stock.water, 60);
      while (s3.cards.length) { const c = s3.cards.shift(); const ch = c.choices.find((x) => /Let them be|Turn .* away|Leave them|Not now|Return home/.test(x.label)) || c.choices.find((x) => enabled(s3, x)); if (ch) ch.resolve(s3); }
      s3.engagement = null; s3.trade = null;
    }
    for (const s of s3.survivors.filter((x) => x.left)) {
      const out = lines.find((l) => l.text.startsWith(`${s.name} lost hope`));
      if (!out) continue; // followed the preacher (a hub event choice)
      deserters++;
      const warn = lines.find((l) => l.text.startsWith(`${s.name} is close to leaving`) && Math.floor(l.hour / 24) < Math.floor(out.hour / 24));
      if (!warn) unwarned++;
    }
  }
  check(deserters > 0, `test setup: people deserted from a crowded hub (${deserters})`);
  check(unwarned === 0, `every deserter was warned on an earlier day (${unwarned} not)`);
}

// ---------------------------------------------------------------------------------------------------------
section("Deserters take their gear and some supplies");
{
  const st = W();
  const h = hub(st);
  Object.assign(h.stock, { food: 100, water: 100, meds: 20, ammo: 200 });
  const s = atBase(st, h.id).find((x) => !x.leader);
  s.traits = [];
  stow(s, newItem("backpack"));
  stow(s, newItem("bandagekit"));
  const items = allItems(s).map((g) => g.name);
  const before = { ...h.stock };
  const armory = h.armory.length;
  const { took } = desert(st, h, s);
  const line = st.log.find((l) => l.text.startsWith(`${s.name} lost hope`)).text;
  check(!s.alive && s.left && h.armory.length === armory && allItems(s).length === items.length, "they keep what they carry (nothing goes to the armory)");
  check(items.every((n) => line.includes(n)), `the log names every item (${line})`);
  check(Object.entries(took).every(([k, q]) => line.includes(`${q} ${k}`) && h.stock[k] === before[k] - q), `the log says what supplies left with them (${JSON.stringify(took)})`);
  check(took.food >= 2 && took.water >= 2, "a few days' food and water");
  // Greedy takes more; never more than a quarter of a stock.
  const avg = (greedy) => {
    let tot = 0;
    for (let i = 0; i < 150; i++) {
      const s2 = W(seed + i);
      const h2 = hub(s2);
      Object.assign(h2.stock, { food: 100, water: 100, meds: 20, ammo: 200 });
      const v = atBase(s2, h2.id).find((x) => !x.leader);
      v.traits = greedy ? ["greedy"] : [];
      tot += Object.values(desert(s2, h2, v).took).reduce((a, q) => a + q, 0);
    }
    return tot / 150;
  };
  const g = avg(true), n = avg(false);
  check(g > n * 1.6, `Greedy takes more (${g.toFixed(1)} vs ${n.toFixed(1)} units)`);
  const s3 = W(); const h3 = hub(s3);
  Object.assign(h3.stock, { food: 4, water: 2, meds: 0, ammo: 0 });
  const t3 = desert(s3, h3, atBase(s3, h3.id).find((x) => !x.leader)).took;
  check((t3.food || 0) <= 1 && !t3.water && !t3.meds, `never more than a quarter of a stock (${JSON.stringify(t3)})`);
  // The last one deserting ends the run.
  const s4 = W(); const h4 = hub(s4);
  const ppl = atBase(s4, h4.id);
  for (const x of ppl.slice(1)) killSurvivor(s4, x, null, "in a test");
  ppl[0].leader = false;
  desert(s4, h4, ppl[0]);
  check(s4.gameOver, "the last survivor deserting ends the run (checkGameOver)");
  // Some come back later as a stranger at the gate.
  check(!!sources.returning && /walked out of/.test(sources.returning.recruit.intro), "a deserter can come back as a card at the gate");
  const s5 = W(); const h5 = hub(s5);
  const v = atBase(s5, h5.id).find((x) => !x.leader);
  desert(s5, h5, v);
  const keep = RETURN.chance; RETURN.chance = 1;
  for (let i = 0; i <= RETURN.after; i++) { nextDay(s5); recruitsDaily(s5); }
  RETURN.chance = keep;
  const c = s5.cards.find((x) => x.recruit && x.recruit.source === "returning");
  if (check(!!c, "the returning card came up")) c.choices[0].resolve(s5);
  check(v.alive && !v.left && v.location.baseId === h5.id && alive(s5).includes(v), "taken back: alive and at the hub again");
}

// ---------------------------------------------------------------------------------------------------------
section(`Long runs: no NaN over ${longDays} days (hands-off first choice, and the Balanced autopilot)`);
for (const mode of ["first", "autopilot"]) {
  const st = createWorld({ seed, factionCount: 8 });
  if (mode === "autopilot") { st.autopilot = true; st.autoCombat = true; }
  let bad = "", recruitCards = 0, hubCards = 0, warnCards = 0, open = 0;
  for (let hr = 0; hr < longDays * 24 && !st.gameOver; hr++) {
    tickHour(st);
    if (mode === "autopilot") {
      // The governor answers inside the tick (autopilotHour): count its answers in the log.
      for (const l of st.log) {
        if (l.hour !== st.hour) break;
        if (/^\u{1F916} (A stranger at the gate|Refugees at the gate|A survivor alone|Someone asks to join|Survivors ask to join|A lost teenager|A familiar face)/u.test(l.text)) recruitCards++;
        if (/^\u{1F916} .* (talks about|is close to) leaving/u.test(l.text)) warnCards++;
      }
      autopilotResolve(st);
      open = Math.max(open, st.cards.filter((c) => c.recruit || c.hubEvent || c.moraleFor != null).length);
    } else {
      while (st.cards.length) {
        const c = st.cards.shift();
        if (c.recruit) recruitCards++; if (c.hubEvent) hubCards++; if (c.moraleFor != null) warnCards++;
        const ch = c.choices.find((x) => x.label === "Return home") || c.choices.find((x) => enabled(st, x));
        if (ch) ch.resolve(st);
      }
      st.engagement = null; st.trade = null;
    }
    for (const s of st.survivors) if (s.alive && (!finite(s.mood) || !finite(s.health) || s.mood < 0 || s.mood > 100)) bad = `${s.name} mood ${s.mood} health ${s.health}`;
    for (const b of st.bases) for (const [k, v] of Object.entries(b.stock)) if (!finite(v) || v < 0) bad = `${b.name} ${k} = ${v}`;
    if (st.log[0] && /NaN|undefined/.test(st.log[0].text)) bad = `log: ${st.log[0].text}`;
    if (bad) break;
  }
  if (mode === "autopilot") hubCards = Object.values(st.stats.hubEvents || {}).reduce((a, v) => a + v, 0);
  const people = alive(st).filter((s) => s.location.kind !== "captive").length;
  const beds = st.bases.reduce((a, b) => a + baseBeds(b), 0);
  console.log(`  ${mode}: day ${day(st)}${st.gameOver ? " (fell)" : ""}, ${people} people in ${beds} beds, deserted ${st.survivors.filter((s) => s.left).length}, recruit cards ${recruitCards}, hub events ${hubCards}, warnings ${warnCards}${st.stats.hubEvents ? ` (${Object.entries(st.stats.hubEvents).map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}`);
  check(!bad, `${mode}: no NaN or negative values (${bad || "clean"})`);
  check(recruitCards > 0 && hubCards > 0, `${mode}: recruit and hub event cards came up`);
  if (mode === "autopilot") check(open === 0, "autopilot: answers every recruit, hub event and warning card");
}

console.log(`\n${passes} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
