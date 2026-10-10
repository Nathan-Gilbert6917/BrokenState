// Trouble on job trips and the follow-ups (trips-plus: src/sim/tripevents.js, tripgear.js; tripland.js PACES and the
// water next to a camp; hunting.js cabinGain; grouptrips.js groupTripLosses; ui/workermap.js routes).
// Usage: node tools/tripeventstest.js [seed] [trials=600] (a minute or so).
// - The rates: TRIP_EV.rate an hour out (× the pace, × the weather); the trip's own dice (the same trip rolls the same,
//   the world's rng is not touched).
// - One person against each kind of trouble by their kit (bare hands, a machete, a machete + vest + tourniquet, a rifle
//   + vest + tourniquet): deaths, wounds, wins. The ungeared are rarely killed; gear cuts the wounds and deaths.
// - Outcomes in the world: a find comes home with the load, a fall into cold water, a bleed stopped by a tourniquet (used
//   up), shots spend rounds and make noise (base.tripNoise, the base's Heat), a death on the land.
// - The big moments: a card at a base you run (the worker holds where they are, "Facing a bear"), answered or left
//   TRIP_EV.hold hours (the default), none under the governor or a base leader.
// - Gear: gearOutdoorWorkers (a weapon for the job, a light for the dusk jobs, light armour, a tourniquet), the warning
//   chip "No weapon", the governor's pass.
// - The pace: Relaxed / Normal / Brisk (walking, output, trouble); saved with the game.
// - A camp fishes and fetches water from the water next to it (not another group's).
// - The governor values a hunting cabin by its wider grounds (cabinGain).
// - The groups: their losses on the land by their kit, a year of days.
// - A day at the hub with six outdoor workers: the events by kind, the log lines, the "!" on the map.
import { createWorld, tickHour, hub, atBase, hourOfDay, combatPower } from "../src/sim/world.js";
import { TRIP, PACES, paceOf, walkHours, distFactor, ownedWater, workLand, NO_WATER } from "../src/sim/tripland.js";
import { planTrip, tripState, jobTripsHour } from "../src/sim/jobtrips.js";
import { TRIP_EV, TRIP_ANIMALS, armTripEvent, fireTripEvent, evStats, tripPower, tripEventsDaily } from "../src/sim/tripevents.js";
import { tripKit, kitWarnings, gearOutdoorWorkers } from "../src/sim/tripgear.js";
import { groupTripLosses, groupGear, GROUP_TRIPS } from "../src/sim/grouptrips.js";
import { describeActivity } from "../src/sim/activity.js";
import { baseHeat } from "../src/sim/hordes.js";
import * as H from "../src/sim/hunting.js";
import { fetchWaterWhy, fetchWaterTile } from "../src/sim/economy.js";
import { recomputeOwnership } from "../src/sim/factions.js";
import { governBase } from "../src/sim/autopilot.js";
import { setSteward } from "../src/sim/steward.js";
import { newItem, ensureInv, allCarried } from "../src/sim/inventory.js";
import { addBuilding } from "../src/sim/buildings.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { FACTION_TYPES } from "../src/sim/data.js";

const SEED = Number(process.argv[2] || 42);
const N = Number(process.argv[3] || 600);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const note = (s) => console.log(`  ${s}`);
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const r2 = (v) => Math.round(v * 100) / 100;

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 6 });
  state.started = true;
  state.autoCombat = true;
  state.visitorsOff = true;
  Object.assign(hub(state).stock, { food: 400, water: 400, fuel: 100, meds: 20, scrap: 100, wood: 0, ammo: 100000, arrows: 200 });
  return state;
}
const tickTo = (state, h) => { let n = 0; while (hourOfDay(state) !== h && n++ < 48) tickHour(state); };
function onJob(state, base, s, job) {
  s.role = job; s.station = null; s.pinned = true; s.health = 100; s.inBed = false; s.conditions = []; s.mood = 70;
  return s;
}
// A worker on their own at the hub (the rest away on an errand: nobody else in the way).
function lone(state, job = "wood") {
  const b = hub(state);
  const people = atBase(state, b.id);
  for (const o of people.slice(1)) o.location = { kind: "errand", baseId: b.id, until: 99999 };
  const s = onJob(state, b, people[0], job);
  return { b, s };
}
const KITS = {
  bare: () => ({}),
  melee: () => ({ weapon: newItem("machete") }),
  geared: () => ({ weapon: newItem("machete"), armor: newItem("vest"), aid: newItem("tourniquet") }),
  rifle: () => ({ weapon: newItem("huntrifle"), armor: newItem("vest"), aid: newItem("tourniquet") }),
};
function dress(s, kit, skills) {
  s.alive = true; s.health = 100; s.conditions = []; s.mood = 70;
  if (skills) s.skills = { ...skills };
  s.gear = {}; s.pockets = []; ensureInv(s);
  const k = kit();
  if (k.weapon) s.gear.weapon = k.weapon;
  if (k.armor) s.gear.armor = k.armor;
  if (k.aid) s.pockets[0] = k.aid;
}
// A trip for s from 08:00 on day 3 (+i days), the event forced at its arrival + 0.5 h.
function forcedTrip(state, b, s, ev, i, at = "work") {
  state.hour = 24 * (3 + (i % 40)) + 8;
  const t = planTrip(state, b, s, s.role, state.hour);
  t.n = i; t.evr = 1; s.trip = t;
  const when = at === "out" ? (t.leave + t.arrive) / 2 : at === "back" ? (t.workEnd + t.home) / 2 : t.arrive + 0.5;
  t.ev = { at: r2(when), seed: i * 7919 + 13, force: { ...ev } };
  return t;
}

// ======================================================================
section("The rates: trouble an hour out, the trip's own dice");
{
  const state = mk();
  const { b, s } = lone(state, "wood");
  let n = 0, hrs = 0;
  const rng0 = state.rng.state;
  for (let i = 0; i < 4000; i++) {
    state.hour = 24 * (3 + (i % 50)) + 7;
    const t = planTrip(state, b, s, "wood", state.hour);
    t.n = i;
    hrs += t.home - t.leave;
    if (armTripEvent(state, b, s, t)) n++;
  }
  const want = TRIP_EV.rate * hrs / 4000;
  note(`wood trips: ${pct(n / 4000)} meet something (TRIP_EV.rate ${TRIP_EV.rate} an hour × ${r2(hrs / 4000)} h out ≈ ${pct(want)}); a woodcutter's day (2 trips) ${pct(2 * n / 4000)}`);
  check(Math.abs(n / 4000 - want) < want * 0.35 + 0.004, "the share of trips with trouble follows the rate × the hours out (weather aside)");
  check(state.rng.state === rng0, "the world's rng is untouched by the trips' dice");
  state.hour = 24 * 5 + 7;
  const a = planTrip(state, b, s, "wood", state.hour), c = { ...planTrip(state, b, s, "wood", state.hour) };
  a.n = c.n = 3;
  armTripEvent(state, b, s, a); armTripEvent(state, b, s, c);
  check(JSON.stringify(a.ev || null) === JSON.stringify(c.ev || null), "the same person, day and trip roll the same trouble");
  // The pace: Relaxed meets less, Brisk more.
  const share = (pace) => { state.tripPace = pace; let k = 0; for (let i = 0; i < 3000; i++) { state.hour = 24 * (3 + (i % 50)) + 7; const t = planTrip(state, b, s, "wood", state.hour); t.n = i; if (armTripEvent(state, b, s, t)) k++; } return k / 3000; };
  const rel = share("relaxed"), nor = share("normal"), bri = share("brisk");
  state.tripPace = undefined;
  note(`a wood trip's trouble by pace: Relaxed ${pct(rel)}, Normal ${pct(nor)}, Brisk ${pct(bri)}`);
  check(rel < nor && nor < bri, "Relaxed meets less trouble than Normal, Brisk more");
}

// ======================================================================
section("One person against each kind of trouble, by kit");
const table = {};
{
  const state = mk();
  state.autopilot = true; // their own good sense: no cards
  const { b, s } = lone(state, "wood");
  const skills = { ...s.skills };
  const EVS = {
    dead1: { kind: "dead", n: 1 }, dead2: { kind: "dead", n: 2 }, dead3: { kind: "dead", n: 3 },
    wolf: { kind: "animal", animal: "wolf", n: 1 }, boar: { kind: "animal", animal: "boar", n: 1 }, dogs: { kind: "animal", animal: "dogs", n: 3 }, bear: { kind: "animal", animal: "bear", n: 1 },
    robber: { kind: "stranger", threat: true, power: 5, gun: true },
  };
  for (const [kk, kit] of Object.entries(KITS)) {
    const row = table[kk] = {};
    for (const [ek, ev] of Object.entries(EVS)) {
      let dead = 0, hurt = 0, dmg = 0, won = 0, pw = 0;
      for (let i = 0; i < N; i++) {
        dress(s, kit, skills);
        s.location = { kind: "base", baseId: b.id };
        b.stock.ammo = 100000;
        const t = forcedTrip(state, b, s, ev, i);
        if (i === 0) pw = tripPower(state, b, s).p;
        const w0 = evStats(state).won;
        fireTripEvent(state, b, s, t, Math.floor(t.ev.at));
        if (!s.alive) dead++; else if (s.health < 100) { hurt++; dmg += 100 - s.health; }
        won += evStats(state).won - w0;
        delete s.trip;
      }
      row[ek] = { dead: dead / N, hurt: hurt / N, dmg: hurt ? dmg / hurt : 0, won: won / N, pw };
    }
    note(`${kk.padEnd(6)} (worth ${r2(row.dead1.pw)}): ${Object.entries(row).map(([k, v]) => `${k} ${pct(v.dead)} dead / ${pct(v.hurt)} hurt / ${pct(v.won)} won`).join(" · ")}`);
  }
  // Deaths are rare: counted over more meetings of the two deadliest kinds.
  const deaths = (kit, ev, M = 4000) => {
    let d = 0;
    for (let i = 0; i < M; i++) {
      dress(s, kit, skills);
      s.location = { kind: "base", baseId: b.id };
      b.stock.ammo = 100000;
      const t = forcedTrip(state, b, s, ev, 50000 + i);
      fireTripEvent(state, b, s, t, Math.floor(t.ev.at));
      if (!s.alive) d++;
      delete s.trip;
    }
    return d / M;
  };
  const D = {};
  for (const kk of ["bare", "geared", "rifle"]) D[kk] = { dead3: deaths(KITS[kk], EVS.dead3), bear: deaths(KITS[kk], EVS.bear) };
  note(`deaths over 4000 meetings each: ${Object.entries(D).map(([k, v]) => `${k}: 3 of the dead ${pct(v.dead3)}, a bear ${pct(v.bear)}`).join(" · ")}`);
  check(D.bare.dead3 > 0 && D.bare.dead3 < 0.03 && D.bare.bear < 0.03, "the ungeared are killed, rarely (unlucky against three of the dead or a bear)");
  check(D.geared.dead3 + D.geared.bear < D.bare.dead3 + D.bare.bear && D.rifle.dead3 + D.rifle.bear < D.bare.dead3 + D.bare.bear, "gear cuts the deaths");
  check(table.rifle.dead2.won > table.bare.dead2.won + 0.5 && table.melee.dead2.won > 0.4, `armed, they stand and put down two of the dead (won: bare ${pct(table.bare.dead2.won)}, machete ${pct(table.melee.dead2.won)}, rifle ${pct(table.rifle.dead2.won)})`);
  check(table.geared.wolf.hurt <= table.bare.wolf.hurt && table.rifle.boar.hurt < table.melee.boar.hurt, "armour and a rifle mean fewer wounds from a wolf or a boar");
}

// ======================================================================
section("Outcomes in the world: finds, cold water, a bleed stopped, shots and noise, a death");
{
  const state = mk();
  state.autopilot = true;
  const { b, s } = lone(state, "scavenge");
  const skills = { ...s.skills };
  // A find comes home with the load.
  dress(s, KITS.melee, skills);
  let t = forcedTrip(state, b, s, { kind: "find", find: 0 }, 1);
  const scrap0 = b.stock.scrap;
  state.hour = Math.floor(t.ev.at);
  for (let i = 0; i < 12 && s.trip === t; i++) { jobTripsHour(state, state.hour); state.hour++; }
  check(b.stock.scrap > scrap0 && b.tripPops.some((p) => /\+\d+ scrap/.test(p.text)), `a find (scrap) comes in with the load: ${scrap0} → ${b.stock.scrap} (${b.tripPops.map((p) => p.text).slice(-1)[0]})`);
  check(state.log.some((l) => /found \d+ scrap near/.test(l.text)), `the log: "${(state.log.find((l) => /found/.test(l.text)) || {}).text}"`);
  check((b.tripAlerts || []).some((a) => a.sid === s.id && a.mark === "+"), "the map's mark over them (+)");
  // A fall into cold water: a chest cold below 8 °C, the buckets lost (the water carrier's slip, on any trip).
  s.role = "wood";
  let cold = null;
  for (let i = 0; i < 200 && !cold; i++) {
    dress(s, KITS.bare, skills);
    const tt = forcedTrip(state, b, s, { kind: "injury", pool: "water", inj: 0 }, 300 + i);
    tt.carry = { water: 2 };
    fireTripEvent(state, b, s, tt, Math.floor(tt.ev.at));
    if (s.conditions.some((c) => c.key === "chestcold")) cold = tt;
    delete s.trip;
  }
  check(cold && cold.noLoad && cold.cut === "soaked", `a slip into cold water: a chest cold, the buckets gone, home to dry (${cold ? cold.ev.text : "none found"})`);
  // A bad wound: a tourniquet stops the bleed and is used up; without one they bleed.
  s.role = "wood";
  let tq = null, bled = null;
  for (let i = 0; i < 400 && !(tq && bled); i++) {
    dress(s, i % 2 ? KITS.geared : KITS.bare, skills);
    const tt = forcedTrip(state, b, s, { kind: "animal", animal: "bear", n: 1 }, 600 + i);
    fireTripEvent(state, b, s, tt, Math.floor(tt.ev.at));
    const txt = tt.ev.text || "";
    if (!tq && /stopped the bleeding with a tourniquet/.test(txt)) tq = { txt, left: allCarried(s).some((x) => x.key === "tourniquet") };
    if (!bled && /bleeding\)/.test(txt)) bled = txt;
    delete s.trip;
  }
  check(tq && !tq.left, `a tourniquet stops a bleed and is used up: "${tq && tq.txt}"`);
  check(!!bled, `no tourniquet: they bleed on the way home: "${bled}"`);
  // Shots: rounds spent, the noise for the base's Heat at midnight, the shots' tile.
  dress(s, KITS.rifle, skills);
  b.stock.ammo = 1000;
  delete b.tripTally;
  const sumNum = (o) => Object.values(o).reduce((x, v) => x + (typeof v === "number" ? v : 0), 0);
  const stock0 = sumNum(b.stock);
  t = forcedTrip(state, b, s, { kind: "dead", n: 3 }, 900);
  const day = Math.floor(t.ev.at / 24);
  fireTripEvent(state, b, s, t, Math.floor(t.ev.at));
  const T = b.tripTally && b.tripTally.ev;
  check(T && T.shots > 0 && sumNum(b.stock) < stock0 && T.gunfire[t.at] > 0, `a rifle against three of the dead: ${T && T.shots} rounds from the stores, noise ${T && T.noise}, the shots' tile marked`);
  const heat0 = baseHeat(state, b);
  state.hour = (day + 1) * 24;
  tripEventsDaily(state, b);
  check(b.tripNoise > 0 && baseHeat(state, b) > heat0 - 0.001 + b.tripNoise - 0.01, `the day's shots add to the base's Heat (tripNoise ${b.tripNoise})`);
  // A death out there: the walker gone, a mark on the map.
  let deathTxt = "";
  for (let i = 0; i < 2000 && !deathTxt; i++) {
    dress(s, KITS.bare, skills);
    s.location = { kind: "base", baseId: b.id };
    const tt = forcedTrip(state, b, s, { kind: "dead", n: 3 }, 2000 + i);
    fireTripEvent(state, b, s, tt, Math.floor(tt.ev.at));
    if (!s.alive) deathTxt = (state.log.find((l) => l.text.startsWith(s.name) && /died/.test(l.text)) || {}).text || "?";
  }
  check(!!deathTxt && !s.trip && (b.tripAlerts || []).some((a) => a.mark === "✝"), `an unlucky one, ungeared against three of the dead: "${deathTxt}"`);
}

// ======================================================================
section("The big moments: a card at a base you run, none under the governor or a base leader");
{
  const state = mk();
  const { b, s } = lone(state, "wood");
  dress(s, KITS.melee);
  const t = forcedTrip(state, b, s, { kind: "animal", animal: "bear", n: 1 }, 5);
  state.cards = [];
  state.hour = Math.floor(t.ev.at);
  const home0 = t.home;
  jobTripsHour(state, state.hour);
  const card = state.cards.find((c) => c.tripEv === s.id);
  check(card && /bear/.test(card.title) && card.choices.length === 3 && card.choices.some((c) => c.default), `the card: "${card && card.title}" (${card && card.choices.map((c) => c.label).join(" / ")})`);
  check(t.ev.pending && t.home > home0, "the worker holds where they are (the trip waits)");
  const st = tripState(state, s, state.hour + 0.5);
  check(st && st.held && /^Facing a bear/.test(st.text), `the activity: "${st && st.text}"`);
  const a = describeActivity(state, s);
  note(`the People line: "${a.text}"`);
  state.hour++;
  const h1 = t.home;
  jobTripsHour(state, state.hour);
  check(t.home === h1 + 1 && t.ev.pending, "another hour unanswered: still holding (the trip an hour later)");
  // Answer it: back away.
  const back = card.choices.find((c) => /Back away/.test(c.label));
  const text = back.resolve(state);
  state.cards = state.cards.filter((c) => c !== card);
  check(!t.ev.pending && /backed away from a bear/.test(text), `answered: "${text}"`);
  // Left unanswered: after TRIP_EV.hold hours they take the default.
  dress(s, KITS.melee);
  const t2 = forcedTrip(state, b, s, { kind: "stranger", threat: false, offer: 0 }, 6);
  state.hour = Math.floor(t2.ev.at);
  jobTripsHour(state, state.hour);
  check(state.cards.some((c) => c.tripEv === s.id && /stranger/i.test(c.title)), "a stranger: a card too");
  for (let i = 0; i < TRIP_EV.hold; i++) { state.hour++; jobTripsHour(state, state.hour); }
  check(!t2.ev.pending && !state.cards.some((c) => c.tripEv === s.id) && /no trade|traded/.test(t2.ev.text || ""), `left ${TRIP_EV.hold} hours: the default ("${t2.ev.text}")`);
  // The governor and a base leader: no card, decided at once.
  for (const mode of ["autopilot", "steward"]) {
    dress(s, KITS.melee);
    state.cards = [];
    if (mode === "autopilot") state.autopilot = true; else { state.autopilot = false; setSteward(state, b, true); }
    const t3 = forcedTrip(state, b, s, { kind: "animal", animal: "bear", n: 1 }, 7);
    state.hour = Math.floor(t3.ev.at);
    jobTripsHour(state, state.hour);
    check(!state.cards.length && !t3.ev.pending && !!t3.ev.text, `${mode === "autopilot" ? "the governor" : "a base leader"}: no card, "${t3.ev.text}"`);
    if (mode === "steward") setSteward(state, b, false);
  }
  state.autopilot = false;
}

// ======================================================================
section("Gear for the outdoor workers: the governor's pass, the button, the warning chips");
{
  const state = mk();
  const b = hub(state);
  const people = atBase(state, b.id);
  const [cutter, hunter, fisher] = people;
  for (const [p, j] of [[cutter, "wood"], [hunter, "hunt"], [fisher, "fish"]]) { onJob(state, b, p, j); p.gear = {}; p.pockets = []; ensureInv(p); }
  check(kitWarnings(state, b, cutter).some((w) => w.text === "No weapon"), `an ungeared woodcutter's chip: ${kitWarnings(state, b, cutter).map((w) => w.text).join(", ")}`);
  check(kitWarnings(state, b, fisher).some((w) => w.text === "No light"), "a fisher (home after dusk) with no light: \"No light\"");
  b.armory = [newItem("fireaxe"), newItem("huntrifle"), newItem("knife"), newItem("headlamp"), newItem("flashlight"), newItem("vest"), newItem("tourniquet"), newItem("tourniquet"), newItem("tourniquet"), newItem("bandagekit")];
  b.stock.ammo = 200;
  const pinned = gearOutdoorWorkers(state, b);
  check(pinned.length === 0, "the governor's pass leaves pinned people alone");
  const got = gearOutdoorWorkers(state, b, { pinned: true });
  note(`the button: ${got.map((x) => `${x.s.name.split(" ")[0]} ${x.item.name}`).join(", ")}`);
  check(tripKit(state, b, hunter).gun && tripKit(state, b, cutter).melee && /axe/i.test(cutter.gear.weapon.name), `a hunter gets the rifle (${hunter.gear.weapon && hunter.gear.weapon.name}), the woodcutter the axe (${cutter.gear.weapon && cutter.gear.weapon.name})`);
  check(!!tripKit(state, b, hunter).light && !!tripKit(state, b, fisher).light, "lights for the dusk jobs (hunting, fishing)");
  check(got.some((x) => x.what === "armour") && got.filter((x) => x.what === "aid").length >= 2 && b.armory.some((it) => it.key === "tourniquet"), "light armour, a tourniquet each while there are spare (one kept for a team)");
  check(!kitWarnings(state, b, cutter).length && !kitWarnings(state, b, hunter).length, "geared: no warning chips");
  // The governor gears the unpinned at its hourly pass.
  const s2 = people[3];
  onJob(state, b, s2, "forage"); s2.pinned = false; s2.gear = {}; s2.pockets = []; ensureInv(s2);
  b.armory.push(newItem("machete"));
  governBase(state, b, { production: true });
  check(tripKit(state, b, s2).weapon, `the governor's hourly gear pass arms a forager (${s2.gear.weapon && s2.gear.weapon.name})`);
}

// ======================================================================
section("The pace: Relaxed / Normal / Brisk");
{
  const state = mk();
  check(paceOf(state).key === "normal" && walkHours("wood", 1, PACES.relaxed.walk) > walkHours("wood", 1) && walkHours("wood", 1, PACES.brisk.walk) < walkHours("wood", 1), `walking a tile: Relaxed ${walkHours("wood", 1, PACES.relaxed.walk)} h, Normal ${walkHours("wood", 1)} h, Brisk ${walkHours("wood", 1, PACES.brisk.walk)} h`);
  check(distFactor("wood", 1, PACES.brisk.walk) > 1 && distFactor("wood", 1, PACES.relaxed.walk) < 1, `a day's wood one tile out: Relaxed ×${r2(distFactor("wood", 1, PACES.relaxed.walk))}, Brisk ×${r2(distFactor("wood", 1, PACES.brisk.walk))}`);
  const { b, s } = lone(state, "wood");
  state.tripPace = "brisk";
  state.hour = 24 * 4 + 7;
  const tb = planTrip(state, b, s, "wood", state.hour);
  state.tripPace = undefined;
  const tn = planTrip(state, b, s, "wood", state.hour);
  check(tb.arrive - tb.leave < tn.arrive - tn.leave, "a Brisk trip walks out quicker");
  state.tripPace = "relaxed";
  const back = loadFromString(saveToString(state));
  check(back.tripPace === "relaxed", "saved with the game");
}

// ======================================================================
section("A camp fishes and fetches water from the water next to it");
{
  let found = null;
  for (let seed = SEED; seed < SEED + 40 && !found; seed++) {
    const state = mk(seed);
    const h = hub(state);
    for (const t of state.tiles) {
      if (t.terrain === "water" || t.owner != null || t.loc || state.grid.distance(t.id, h.tile) < 4) continue;
      const wet = state.grid.neighbors(t.id).filter((id) => state.tiles[id].terrain === "water" && !state.tiles[id].bridge && state.tiles[id].owner == null);
      if (wet.length) { found = { state, tile: t.id }; break; }
    }
  }
  const { state, tile } = found;
  const camp = { id: 9001, tile, type: "outpost", name: "Test Camp", stock: { food: 10, water: 10, scrap: 0, meds: 0, rawwater: 0 }, buildings: [], construction: [], armory: [newItem("fishrod")], tier: 0, camp: true, fire: true, radio: false, watchtower: false };
  state.bases.push(camp);
  recomputeOwnership(state);
  const w = ownedWater(state, tile);
  check(w.length && w[0].d === 1 && state.tiles[w[0].id].owner == null, "the camp holds only its own tile, yet the water next to it counts");
  check(H.fishWorkWhy(state, camp) === "" && !!fetchWaterTile(state, camp), `the camp can fish and fetch water ("${H.fishWorkWhy(state, camp)}", "${fetchWaterWhy(state, camp)}")`);
  // Another group's water does not.
  const f = state.factions[0];
  state.tiles[w[0].id].owner = f.id;
  for (const x of w.slice(1)) state.tiles[x.id].owner = f.id;
  check(H.fishWorkWhy(state, camp) === NO_WATER, `another group's water: "${H.fishWorkWhy(state, camp)}"`);
}

// ======================================================================
section("The governor values a hunting cabin by the wider grounds it gives");
{
  const rows = [];
  for (let seed = SEED; seed < SEED + 30; seed++) {
    const state = mk(seed);
    const b = hub(state);
    const g = H.cabinGain(state, b);
    rows.push({ seed, g, land: H.gameLand(state, b) });
  }
  const yes = rows.filter((r) => r.g >= H.CABIN_GAIN), old = rows.filter((r) => r.land >= 5);
  note(`30 hubs: the old test (game land within 2 ≥ 5) passes ${old.length}, the new (cabinGain ≥ ${H.CABIN_GAIN}) ${yes.length}; gains ${rows.map((r) => (Number.isFinite(r.g) ? r2(r.g) : "∞")).join(" ")}`);
  check(rows.every((r) => r.g >= 1), "a cabin never makes the hunting worse (gain ≥ 1)");
  const state = mk();
  const b = hub(state);
  const g0 = H.cabinGain(state, b);
  addBuilding(b, "huntcabin");
  const tile = H.huntTripTile(state, b);
  check(tile && state.grid.distance(b.tile, tile.id) <= 2, `with the cabin the hunters reach 2 tiles out (gain was ${Number.isFinite(g0) ? r2(g0) : "∞"})`);
}

// ======================================================================
section("The groups: their losses on the land by their kit");
{
  const state = mk();
  const rows = [];
  for (const f of state.factions) {
    if (!f.alive) continue;
    const pop0 = f.pop;
    let dead = 0, wounded = 0, out = 0;
    for (let d = 0; d < 365; d++) { f.pop = pop0; f.wounded = 0; const r = groupTripLosses(state, f, d); dead += r.dead; wounded += r.wounded; out += r.out; }
    f.pop = pop0;
    rows.push({ type: f.type, pop: pop0, g: groupGear(f), dead, wounded, out: out / 365 });
  }
  for (const r of rows) note(`${r.type.padEnd(12)} ${r.pop} people, kit ${r2(r.g)}: ${r2(r.out)} out a day, a year: ${r.dead} killed, ${r.wounded} wounded`);
  const ex = (g, pop) => pop * GROUP_TRIPS.outShare * 365 * GROUP_TRIPS.lossDay / (g * g);
  note(`expected deaths a year for 30 people: kit 0.6 ${r2(ex(0.6, 30))}, 1 ${r2(ex(1, 30))}, 2 ${r2(ex(2, 30))}`);
  check(ex(2, 30) < ex(1, 30) && ex(1, 30) < ex(0.6, 30), "the better armed lose fewer");
  check(rows.reduce((a, r) => a + r.dead, 0) <= rows.length, "losses stay small (about one a group-year at most)");
}

// ======================================================================
section("Days at the hub: six outdoor workers, the events as they come");
{
  const state = mk();
  const b = hub(state);
  const people = atBase(state, b.id).slice(0, 6);
  const jobs = ["wood", "forage", "hunt", "scavenge", "wood", "forage"];
  people.forEach((s, i) => onJob(state, b, s, jobs[i]));
  const before = { ...evStats(state), kinds: { ...evStats(state).kinds } };
  const D = 40;
  for (let h = 0; h < 24 * D; h++) {
    tickHour(state);
    for (const s of people) if (s.alive) { s.mood = Math.max(s.mood, 60); s.health = Math.max(s.health, 70); }
    for (const c of [...state.cards]) if (c.tripEv != null) { const d = c.choices.find((x) => x.default); state.cards.splice(state.cards.indexOf(c), 1); d.resolve(state); }
  }
  const st = evStats(state);
  const n = st.n - before.n;
  note(`${D} days, ${st.trips - before.trips} trips: ${n} events (${Object.entries(st.kinds).map(([k, v]) => `${k} ${v - (before.kinds[k] || 0)}`).join(", ")}), ${st.hurt - before.hurt} hurt, ${st.killed - before.killed} killed, ${st.cards - before.cards} cards`);
  check(n > 0 && n / (st.trips - before.trips) < 0.06, `trouble on ${pct(n / Math.max(1, st.trips - before.trips))} of the trips`);
  check(state.log.some((l) => /near /.test(l.text) && /(met|found|lost the way|slipped|turned|fell|cut|traveller|stranger|killed|put down)/.test(l.text)), "log lines for them");
}

console.log(`\n${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
