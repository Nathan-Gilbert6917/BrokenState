// Mental breaks (src/sim/mentalbreaks.js; every number in SNAP). Checks:
//   - the counter: mornings under SNAP.at at a base count up, one at or over it resets; the log warns once on the
//     SNAP.days-th; the People tab's risk says "May break down"; no break before the counter is full
//   - the odds: at mood 3 for 60 days about SNAP.base + SNAP.per × 7 a day once the counter is full, never two within
//     the cooldown; every kind turns up over many runs
//   - each kind: running off (a deserter who can come back, the haul), the car (gone with them), suicide and walking
//     into the dead (dead, the memorial, everyone grim), the fire (a building gone), the stores (food and water
//     spoiled), shutting down (in bed for days, no work), the attack (the victim hurt or killed, the aftermath card
//     with its four answers), leaders never run off
//   - the aftermath card: confine, cast out, put down and forgive each do what they say
//   - 300 days of autopilot on three seeds with everyone's mood pinned at 2: no NaN, cards all answered
// Usage: node tools/snaptest.js [seed]
import { createWorld, hub, atBase, alive, day, makeSurvivor, survivorById } from "../src/sim/world.js";
import { basesDaily } from "../src/sim/economy.js";
import { relationsDaily } from "../src/sim/relations.js";
import { mentalBreaksDaily, snap, SNAP, nearSnap } from "../src/sim/mentalbreaks.js";
import { moodRisk } from "../src/sim/morale.js";
import { createVehicle, carsAtBase } from "../src/sim/vehicles.js";
import { addBuilding } from "../src/sim/buildings.js";
import { newItem } from "../src/sim/inventory.js";
import { autopilotResolve } from "../src/sim/autopilot.js";
import { tickHour } from "../src/sim/world.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
const sendOut = (st, n = 3, supplies = { food: 12, water: 12 }) => {
  const h = hub(st);
  const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, n);
  const dest = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 5).id;
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", supplies });
  res.party.idx = Math.min(2, res.party.path.length - 1);
  return res.party;
};

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
const section = (s) => console.log(`\n${s}`);
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 4 }); st.cards.length = 0; st.hour = 24 * 10; return st; };
const nextDay = (st) => { st.hour += 24; };
const addPerson = (st, base, mood = 60) => { const s = makeSurvivor(st, 1); s.traits = []; s.location = { kind: "base", baseId: base.id }; s.role = "farm"; s.mood = mood; st.survivors.push(s); return s; };
const lastLog = (st) => st.log[0].text;

section("The counter and the warning");
{
  const st = W();
  const h = hub(st);
  const s = atBase(st, h.id).find((x) => !x.leader);
  s.mood = 5;
  for (let i = 1; i < SNAP.days; i++) { nextDay(st); mentalBreaksDaily(st); s.mood = 5; }
  check(s.lowDays === SNAP.days - 1 && !s.snaps && !nearSnap(s), `${SNAP.days - 1} mornings under ${SNAP.at}: counting (${s.lowDays}), no break yet, no chip yet`);
  const logs = st.log.length;
  st.rng.chance = () => false; // no break this morning
  nextDay(st); mentalBreaksDaily(st);
  delete st.rng.chance;
  check(s.lowDays === SNAP.days && st.log.length === logs + 1 && /rock bottom/.test(lastLog(st)), `the ${SNAP.days}rd morning: the log warns (“${lastLog(st)}”)`);
  check(nearSnap(s) && moodRisk(s).text === "May break down", `the People tab: “${moodRisk(s).text}”`);
  s.mood = 12;
  nextDay(st); mentalBreaksDaily(st);
  check(s.lowDays === 0 && !nearSnap(s), "a morning at 12: the counter resets");
}

section("The odds and the kinds");
{
  const kinds = {};
  let snaps = 0, days = 0, tooSoon = 0, early = 0;
  for (let i = 0; i < 30; i++) {
    const st = W(seed + i);
    const h = hub(st);
    h.stock.food = 200; h.stock.water = 200;
    for (let k = 0; k < 3; k++) addPerson(st, h, 60);
    const s = atBase(st, h.id).find((x) => !x.leader);
    let last = -99;
    for (let d = 0; d < 60 && s.alive && s.location.kind === "base"; d++) {
      nextDay(st);
      s.mood = 3;
      mentalBreaksDaily(st);
      days++;
      const sn = s.snaps && s.snaps[s.snaps.length - 1];
      if (sn && sn.d === day(st)) {
        snaps++;
        if (d < SNAP.days - 1) early++;
        if (day(st) - last < SNAP.cooldown) tooSoon++;
        last = day(st);
      }
      st.cards.length = 0;
    }
    for (const [k, v] of Object.entries((st.relStats || {}).snaps || {})) kinds[k] = (kinds[k] || 0) + v;
  }
  const p = SNAP.base + SNAP.per * (SNAP.at - 3);
  console.log(`  ${snaps} breaks in ${days} days at mood 3: ${JSON.stringify(kinds)}`);
  check(snaps > 0 && early === 0 && tooSoon === 0, `breaks only once the counter is full (${Math.round(p * 100)}% a day), never two within ${SNAP.cooldown} days`);
  check(["runoff", "attack", "suicide", "fire", "stores", "shutdown"].every((k) => kinds[k] > 0), "every kind a plain base allows turns up: run off, attack, suicide, fire, stores, shut down");
}

section("Each kind");
{
  // Running off: a deserter with the haul, who may come back.
  let st = W(), h = hub(st);
  h.stock.food = 50; h.stock.water = 50;
  let s = atBase(st, h.id).find((x) => !x.leader);
  s.mood = 2;
  snap(st, h, s, st.rng, "runoff");
  check(!s.alive && s.left && (st.deserters || []).some((e) => e.id === s.id) && /snapped: they walked out/.test(lastLog(st)), `run off: a deserter (“${lastLog(st).slice(0, 90)}…”)`);
  // The car.
  st = W(); h = hub(st);
  createVehicle(st, "sedan", { kind: "base", baseId: h.id });
  const nCars = carsAtBase(st, h.id).length;
  s = atBase(st, h.id).find((x) => !x.leader);
  snap(st, h, s, st.rng, "car");
  check(!s.alive && carsAtBase(st, h.id).length === nCars - 1 && /drove off/.test(lastLog(st)), "the car: gone with them");
  // Suicide: dead, on the memorial, everyone grim.
  st = W(); h = hub(st);
  s = atBase(st, h.id).find((x) => !x.leader);
  const o = atBase(st, h.id).find((x) => x !== s);
  const m0 = o.mood;
  snap(st, h, s, st.rng, "suicide");
  check(!s.alive && !s.left && (st.memorial || []).some((m) => m.id === s.id && /own hand/.test(m.cause)) && o.mood === Math.max(0, m0 - SNAP.GRIM), `suicide: on the memorial (“${st.memorial[0].cause}”), everyone −${SNAP.GRIM}`);
  // Into the dead: needs Infection.
  st = W(); h = hub(st);
  st.tiles[h.tile].infection = 0.5;
  s = atBase(st, h.id).find((x) => !x.leader);
  snap(st, h, s, st.rng, "dead");
  check(!s.alive && /into the dead/.test(st.memorial[0].cause), `into the dead: “${st.memorial[0].cause}”`);
  st.tiles[h.tile].infection = 0;
  const s2 = atBase(st, h.id).find((x) => !x.leader);
  check(snap(st, h, s2, st.rng, "dead") !== "dead", "on clean ground nobody walks into the dead (another kind instead)");
  // Fire: a building gone.
  st = W(); h = hub(st);
  addBuilding(h, "bunkhouse");
  const nb = h.buildings.length;
  s = atBase(st, h.id).find((x) => !x.leader);
  snap(st, h, s, st.rng, "fire");
  check(h.buildings.length === nb - 1 && /set fire to/.test(st.log.find((l) => /set fire/.test(l.text)).text) && st.cards.some((c) => c.snapFor === s.id), "fire: a building burned down, the aftermath card");
  // The stores.
  st = W(); h = hub(st);
  h.stock.food = 100; h.stock.water = 100;
  s = atBase(st, h.id).find((x) => !x.leader);
  snap(st, h, s, st.rng, "stores");
  check(h.stock.food === 100 - Math.min(SNAP.STORES.max, 100 * SNAP.STORES.share) && h.stock.water === h.stock.food, `the stores: food and water ${h.stock.food} of 100`);
  // Shutting down.
  st = W(); h = hub(st);
  s = atBase(st, h.id).find((x) => !x.leader);
  s.role = "farm";
  snap(st, h, s, st.rng, "shutdown");
  check(s.role === "rest" && s.restPrev === "farm" && s.restUntil >= day(st) + SNAP.SHUTDOWN[0] && s.onBreak, `shut down: in bed until day ${s.restUntil} (today ${day(st)})`);
  // Leaders never run off.
  st = W(); h = hub(st);
  const L = atBase(st, h.id).find((x) => x.leader);
  let ran = 0;
  for (let i = 0; i < 40; i++) { const k = snap(st, h, L, st.rng, "runoff"); if (k === "runoff" || k === "car" || k === "dead") ran++; if (!L.alive) break; L.snapCd = 0; }
  check(ran === 0, "a leader never runs off, drives off or walks into the dead");
}

section("The attack and the aftermath");
{
  let hurtN = 0, killed = 0, cards = 0;
  const outcomes = { confine: 0, cast: 0, down: 0, forgive: 0 };
  for (let i = 0; i < 40; i++) {
    const st = W(seed + 100 + i);
    const h = hub(st);
    for (let k = 0; k < 2; k++) addPerson(st, h, 60);
    const s = atBase(st, h.id).find((x) => !x.leader);
    if (i % 2) s.gear.weapon = newItem("machete", 1);
    const others = atBase(st, h.id).filter((x) => x !== s);
    const hp = Object.fromEntries(others.map((o) => [o.id, o.health]));
    s.mood = 2;
    const kind = snap(st, h, s, st.rng, "attack");
    if (kind !== "attack") continue;
    const v = others.find((o) => !o.alive || o.health < hp[o.id]);
    if (!v) continue;
    if (v.alive) hurtN++; else killed++;
    const card = st.cards.find((c) => c.snapFor === s.id);
    if (!card) continue;
    cards++;
    const pick = ["confine", "cast", "down", "forgive"][i % 4];
    const c = card.choices[["confine", "cast", "down", "forgive"].indexOf(pick)];
    const n0 = atBase(st, h.id).length;
    c.resolve(st);
    if (pick === "confine" && s.role === "rest" && s.confined === day(st) + SNAP.CONFINE) outcomes.confine++;
    if (pick === "cast" && !s.alive && s.left && (st.deserters || []).some((e) => e.id === s.id)) outcomes.cast++;
    if (pick === "down" && !s.alive && !s.left && /their own people/.test(st.memorial[0].cause) && atBase(st, h.id).length === n0 - 1) outcomes.down++;
    if (pick === "forgive" && s.alive && s.location.kind === "base") outcomes.forgive++;
  }
  console.log(`  ${hurtN} hurt, ${killed} killed, ${cards} cards: ${JSON.stringify(outcomes)}`);
  check(hurtN > 0 && killed > 0, "the victim is hurt most times, killed some");
  check(cards === hurtN + killed, "every attack raises the aftermath card");
  check(Object.values(outcomes).every((v) => v > 0), "confine, cast out, put down and forgive each do what they say");
}

section("On the road");
{
  // The counter counts on a team too, and a team in a fight is left alone.
  let st = W(), p = sendOut(st);
  let s = partyMembers(st, p)[0];
  s.mood = 2;
  nextDay(st); mentalBreaksDaily(st);
  check(s.lowDays === 1, "a morning under 10 on the road counts");
  p.phase = "engaged";
  nextDay(st); mentalBreaksDaily(st);
  check(s.lowDays === 1, "a team in a fight is left alone that morning");
  p.phase = "travel";
  // Slipping away: gone from the team, a deserter who may come back, a little food and water with them.
  st = W(); p = sendOut(st);
  s = partyMembers(st, p)[0];
  const n0 = partyMembers(st, p).length, f0 = p.supplies.food;
  s.mood = 2;
  const k1 = snap(st, { party: p }, s, st.rng, "runoff");
  check(k1 === "runoff" && !s.alive && s.left && partyMembers(st, p).length === n0 - 1 && (st.deserters || []).some((e) => e.id === s.id && e.road) && p.supplies.food < f0 && /slipped away/.test(lastLog(st)), `slipped away from the team: ${n0 - 1} left, a deserter, ${f0 - p.supplies.food} food gone with them`);
  // The packs.
  st = W(); p = sendOut(st, 3, { food: 20, water: 20 });
  s = partyMembers(st, p)[0];
  snap(st, { party: p }, s, st.rng, "stores");
  check(p.supplies.food === 17 && p.supplies.water === 17 && st.cards.some((c) => c.snapFor === s.id && c.partyId === p.id), "the packs: 15% of the team's food and water gone, the card on the team");
  st.cards.length = 0;
  // Shutting down: the team loses half a day.
  st = W(); p = sendOut(st);
  s = partyMembers(st, p)[0];
  const pr0 = p.progress || 0;
  snap(st, { party: p }, s, st.rng, "shutdown");
  check(p.progress < pr0 && s.onBreak, `shut down on the road: the team's progress ${pr0} -> ${Math.round(p.progress * 10) / 10}`);
  // Into the dead on an infected tile; a death site, not the armory.
  st = W(); p = sendOut(st);
  st.tiles[p.path[p.idx]].infection = 0.5;
  s = partyMembers(st, p)[0];
  snap(st, { party: p }, s, st.rng, "dead");
  check(!s.alive && st.deathSites.some((d) => d.tile === p.path[p.idx] && d.names.includes(s.name)), "walked into the dead from the camp: a death site where the team stands");
  // No fire and no car on the road.
  st = W(); p = sendOut(st);
  s = partyMembers(st, p)[0];
  let odd = 0;
  for (let i = 0; i < 30; i++) { const k = snap(st, { party: p }, s, st.rng, "fire"); if (k === "fire" || k === "car") odd++; if (!s.alive) break; s.snapCd = 0; }
  check(odd === 0, "no fires and no cars taken on the road");
  // An attack on a teammate and the road's answers.
  let hurtN = 0, left = 0, guarded = 0;
  for (let i = 0; i < 20; i++) {
    st = W(seed + 300 + i); p = sendOut(st);
    const m = partyMembers(st, p);
    s = m[0];
    const hp = Object.fromEntries(m.map((o) => [o.id, o.health]));
    s.mood = 2;
    if (snap(st, { party: p }, s, st.rng, "attack") !== "attack") continue;
    const v = m.find((o) => o !== s && (!o.alive || o.health < hp[o.id]));
    if (!v) continue;
    hurtN++;
    const card = st.cards.find((c) => c.snapFor === s.id);
    if (!card || !s.alive) continue;
    if (i % 2) { card.choices[1].resolve(st); if (!s.alive && s.left && !partyMembers(st, p).includes(s)) left++; }
    else { card.choices[0].resolve(st); if (s.alive && s.confined && partyMembers(st, p).includes(s)) guarded++; }
  }
  check(hurtN > 0 && left > 0 && guarded > 0, `a teammate attacked ${hurtN} times: left behind ${left}, kept under guard ${guarded}`);
}

section("Autopilot at rock bottom");
{
  let bad = 0, snaps = 0, open = 0;
  for (const sd of [1, 2, 3]) {
    const st = createWorld({ seed: sd, factionCount: 4 });
    st.autopilot = true;
    for (let hr = 0; hr < 24 * 300 && !st.gameOver; hr++) {
      if (hr % 24 === 0) for (const s of alive(st)) if (s.location.kind === "base" || s.location.kind === "party") s.mood = 2;
      tickHour(st);
      autopilotResolve(st);
      for (const s of st.survivors) if (!Number.isFinite(s.mood) || !Number.isFinite(s.health)) bad++;
    }
    snaps += Object.values((st.relStats || {}).snaps || {}).reduce((a, v) => a + v, 0);
    open += st.cards.filter((c) => c.snapFor != null).length;
  }
  check(bad === 0 && open === 0, `300 days on three seeds with everyone at home and on the road pinned at mood 2: ${snaps} breaks, no NaN, every aftermath card answered`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
