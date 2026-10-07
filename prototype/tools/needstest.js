// Needs test (src/sim/needs.js, upkeep.js heating): hunger and thirst gauges fall and refill from the team's
// inventory out of a base (fresh game first, packed, then found food; found water) and follow the base's stores at a
// base (the base's daily totals stay upkeep.js's); low gauges cut work and aim and an empty one costs health away from
// a base; rations (full / short / none) and who eats first when short; treats used by the simple rule and by hand,
// keepsakes kept; an errand takes about a day's food and water a day and brings back what is left; heating fuel per head
// below 0°C (×1.5 below −8°C), the cold without it, a shelter's camp fire; a team at a lit camp fire stays out of the
// cold; gauges saved, and old saves start full; starving and parched day after day (the morning mood hit grows, resets
// when they eat, reaches rock bottom on the road before hunger kills) and the starving status icon.
// Usage: node tools/needstest.js [seed]
import { createWorld, hub, atBase, residents, makeSurvivor, tickHour } from "../src/sim/world.js";
import { basesDaily } from "../src/sim/economy.js";
import { foodUse, heatUse, heatRate, HEAT } from "../src/sim/upkeep.js";
import { econStats } from "../src/sim/farming.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
import {
  NEEDS, COLD, teamNeedsHour, needsHour, needsWork, needsAim, teamTreats, treatsFor, useTreat, heatDaily, packErrand, teamCold, takeFood,
  STARVE, starveMood, starvingDaily,
} from "../src/sim/needs.js";
import { moodFactors } from "../src/sim/relations.js";
import { SNAP } from "../src/sim/mentalbreaks.js";
import { statusesOf } from "../src/sim/status.js";
import { moodWork } from "../src/sim/morale.js";
import { hubUpkeepDaily } from "../src/sim/hubevents.js";
import { newItem } from "../src/sim/inventory.js";
import { dayMeanTemp, foodNeedFactor, thirstAt } from "../src/sim/weather.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { upkeepLine } from "../src/ui/farming.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const r1 = (v) => Math.round(v * 10) / 10;
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.visitorsOff = true; return st; };
const plain = (s) => { s.traits = []; s.conditions = []; s.perks = []; s.health = 100; s.mood = 70; s.hunger = 100; s.thirst = 100; return s; };
function quietHub(st) {
  const h = hub(st);
  for (const s of atBase(st, h.id)) { plain(s); s.role = "rest"; s.station = null; }
  Object.assign(h.stock, { food: 500, water: 70, scrap: 300, parts: 30, fuel: 40, meds: 20, ammo: 50, jars: 40, preserved: 0 });
  return h;
}
// A spring day at noon, in the mild weather (no cold appetite, no heating).
const mildDay = (st) => { for (let d = 3; d < 60; d++) if (dayMeanTemp(st, d) > 5 && foodNeedFactor(st, d) === 1) return d; return 5; };
// A team of n from the hub, waiting on a tile nearby (not moving: one ration a day each).
function team(st, n, supplies) {
  const h = hub(st);
  const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, n);
  const dest = st.tiles.find((t) => !t.loc && t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 2);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: dest.id, mission: "move", stance: "normal", vehicleId: null, supplies });
  const p = res.party;
  p.phase = "waiting";
  p.path = [p.path[0]]; p.idx = 0;
  for (const s of crew) plain(s);
  return { p, crew };
}

// ---------- 1. out of a base: the gauges fall and are refilled from the team's inventory ----------
{
  console.log("A team eats and drinks from what it carries");
  const st = W();
  quietHub(st);
  st.hour = mildDay(st) * 24 + 12;
  const { p, crew } = team(st, 2, { food: 10, water: 10 });
  const f0 = p.supplies.food, w0 = p.supplies.water;
  for (let i = 0; i < 6; i++) teamNeedsHour(st, p, crew);
  check(near(crew[0].hunger, 100 - NEEDS.food / 4) && near(crew[0].thirst, 100 - (NEEDS.water * thirstAt(st)) / 4, 1e-6), `six hours at rest: hunger 100 → ${r1(crew[0].hunger)}, thirst → ${r1(crew[0].thirst)}`);
  check(p.supplies.food === f0 && p.supplies.water === w0, "nobody eats while the gauges are high (above 70)");
  for (let i = 0; i < 24; i++) teamNeedsHour(st, p, crew);
  check(p.supplies.food < f0 && p.supplies.water < w0, `then they eat and drink from the team's supplies (food ${f0} → ${r1(p.supplies.food)}, water ${w0} → ${r1(p.supplies.water)})`);
  check(crew.every((s) => s.hunger >= 69 && s.thirst >= 69), "and stay fed");
  // A day's food per person in the long run.
  const g0 = crew.reduce((a, s) => a + s.hunger, 0), fA = p.supplies.food;
  for (let i = 0; i < 48; i++) teamNeedsHour(st, p, crew);
  const ate = fA - p.supplies.food + (g0 - crew.reduce((a, s) => a + s.hunger, 0)) / NEEDS.food;
  check(near(ate, 2 * 2, 1e-6), `two days at rest: 1 ration a person a day, the gauges counted (${r1(ate)} for 2 people)`);
  // Fresh game first, then packed food, then found food.
  p.cargo.supplies.food = 3; p.cargo.meat = 2; p.cargo.supplies.preserved = 2;
  const pk = p.supplies.food;
  const got = takeFood(p, 2.5);
  check(near(got, 2.5) && near(p.cargo.meat || 0, 0) && near(p.supplies.food, pk - 0.5) && near(p.cargo.supplies.food, 1), "fresh game is eaten first, then the packed food");
  p.supplies.food = 0; p.supplies.preserved = 0;
  takeFood(p, 1.5);
  check(near(p.cargo.supplies.food, 0) && near(p.cargo.supplies.preserved, 1.5), "then found food (foraged, looted), then found preserved food");
  // Found water once the packed water is gone.
  p.supplies.water = 0; p.cargo.supplies.water = 5;
  for (const s of crew) s.thirst = 30;
  teamNeedsHour(st, p, crew);
  check(p.cargo.supplies.water < 5 && crew.every((s) => s.thirst > 90), "found water is drunk when the packed water is gone");
  // Nothing left: the gauges run down, then cost health; no free water.
  p.supplies.food = 0; p.cargo.supplies.food = 0; p.cargo.supplies.preserved = 0; p.supplies.water = 0; p.cargo.supplies.water = 0;
  for (const s of crew) { s.hunger = 2; s.thirst = 2; s.health = 100; }
  for (let i = 0; i < 3; i++) teamNeedsHour(st, p, crew);
  check(p.noFood && p.noWater, "out of food and water: the team is starving (no camp healing)");
  check(near(crew[0].health, 100 - 2 * (NEEDS.hurtFood + NEEDS.hurtWater), 1e-6) || crew[0].health < 100 - 2 * (NEEDS.hurtFood + NEEDS.hurtWater) + 1e-6, `empty gauges cost health: ${r1(crew[0].health)} after three hours (hunger ${NEEDS.hurtFood}/h, thirst ${NEEDS.hurtWater}/h)`);
}

// ---------- 2. at a base: the gauges follow the stores; the base's totals stay upkeep.js's ----------
{
  console.log("At a base");
  const st = W();
  const h = quietHub(st);
  st.hour = mildDay(st) * 24 + 1;
  const n = residents(st, h.id).length;
  const stock0 = JSON.stringify(h.stock);
  for (let i = 0; i < 23; i++) needsHour(st);
  check(JSON.stringify(h.stock) === stock0, "the gauges never take from a base's stores by themselves");
  check(residents(st, h.id).every((s) => s.hunger >= 99.9 && s.thirst >= 99.9), "fed in full, everyone stays full");
  const e0 = econStats(st).eaten;
  basesDaily(st);
  check(near(econStats(st).eaten - e0, foodUse(st, h).residents), `the day's eating is upkeep.js's per head × heads (${r1(econStats(st).eaten - e0)} for ${n})`);
  // Come home hungry: they recover at the base, at no cost.
  const s = residents(st, h.id)[0];
  s.hunger = 20; s.thirst = 20;
  const st0 = JSON.stringify(h.stock);
  for (let i = 0; i < 10; i++) needsHour(st);
  check(s.hunger > 40 && s.thirst > 40 && JSON.stringify(h.stock) === st0, `back home hungry: meals at home bring them back (hunger 20 → ${r1(s.hunger)})`);
  // Short rations: the gauges sink to the lean level and hold.
  for (const x of residents(st, h.id)) { x.hunger = 100; x.thirst = 100; }
  h.rationing = true;
  for (let i = 0; i < 24 * 8; i++) needsHour(st);
  const hs = residents(st, h.id).map((x) => x.hunger);
  check(hs.every((v) => v < NEEDS.lean + 1 && v > 20), `a week on short rations: hungry but holding (${hs.map(r1).join(", ")})`);
  h.rationing = false;
  // Out of food: everyone's hunger falls (the base's hunger days do the damage, economy.js).
  h.hungerDays = 1;
  const before = residents(st, h.id).map((x) => x.health);
  for (let i = 0; i < 24; i++) needsHour(st);
  check(residents(st, h.id).every((x, i) => x.hunger < hs[i] && x.health === before[i]), "a base out of food: hunger falls, and only economy.js's hunger days cost health");
  h.hungerDays = 0;
}

// ---------- 3. what low gauges do ----------
{
  console.log("Low gauges");
  const s = { hunger: 100, thirst: 100, mood: 60, name: "A B" };
  check(needsWork(s) === 1 && needsAim(s) === 0, "fed and watered: no effect");
  s.hunger = 25;
  check(near(needsWork(s), 0.8, 1e-3) && needsAim(s) < 0, `very hungry: work ×${needsWork(s)}, aim ${needsAim(s)}`);
  s.hunger = 100; s.thirst = 25;
  check(near(needsWork(s), 0.75, 1e-3) && needsAim(s) < -5, `very thirsty is worse: work ×${needsWork(s)}, aim ${needsAim(s)}`);
  s.thirst = 0; s.hunger = 0;
  check(near(needsWork(s), 0.3, 1e-3), `both empty: work ×${needsWork(s)}`);
  check(near(moodWork(s), 0.3 * moodWork({ mood: 60 }), 1e-2), "morale.js moodWork takes hunger and thirst in (base work, building, crafting …)");
}

// ---------- 4. rations and who eats first ----------
{
  console.log("Rations and sharing");
  const st = W();
  quietHub(st);
  st.hour = mildDay(st) * 24 + 12;
  const full = team(st, 2, { food: 30, water: 30 });
  const days = 6;
  for (let i = 0; i < 24 * days; i++) teamNeedsHour(st, full.p, full.crew);
  const usedFull = 30 - full.p.supplies.food;
  const st2 = W();
  quietHub(st2);
  st2.hour = mildDay(st2) * 24 + 12;
  const sh = team(st2, 2, { food: 30, water: 30 });
  sh.p.ration = "short";
  for (let i = 0; i < 24 * days; i++) teamNeedsHour(st2, sh.p, sh.crew);
  const usedShort = 30 - sh.p.supplies.food;
  check(usedShort < usedFull * 0.7 && sh.crew.every((s) => s.hunger < NEEDS.lean && s.hunger > 25), `short rations stretch the food (${r1(usedShort)} vs ${r1(usedFull)} in ${days} days; hunger ${sh.crew.map((s) => r1(s.hunger)).join(", ")})`);
  sh.p.ration = "none";
  const f1 = sh.p.supplies.food;
  for (let i = 0; i < 24; i++) teamNeedsHour(st2, sh.p, sh.crew);
  check(sh.p.supplies.food === f1, "no rations: the food is kept");
  // Scarce food: the hurt eat first (default); evenly when set.
  const st3 = W();
  quietHub(st3);
  st3.hour = mildDay(st3) * 24 + 12;
  const sc = team(st3, 2, { food: 0.5, water: 10 });
  sc.crew[0].hunger = 30; sc.crew[1].hunger = 30; sc.crew[1].health = 40;
  teamNeedsHour(st3, sc.p, sc.crew);
  check(sc.crew[1].hunger > sc.crew[0].hunger + 15, `short of food, the hurt eat first (${r1(sc.crew[1].hunger)} vs ${r1(sc.crew[0].hunger)})`);
  const st4 = W();
  quietHub(st4);
  st4.hour = mildDay(st4) * 24 + 12;
  const ev = team(st4, 2, { food: 0.5, water: 10 });
  ev.p.share = "even";
  ev.crew[0].hunger = 30; ev.crew[1].hunger = 30; ev.crew[1].health = 40;
  teamNeedsHour(st4, ev.p, ev.crew);
  check(near(ev.crew[0].hunger, ev.crew[1].hunger, 1e-6), "evenly: the same share each");
}

// ---------- 5. treats ----------
{
  console.log("Treats");
  const st = W();
  quietHub(st);
  st.hour = mildDay(st) * 24 + 12;
  const { p, crew } = team(st, 2, { food: 10, water: 10 });
  const [a, b] = crew;
  a.mood = 20; b.mood = 80;
  a.pockets[0] = newItem("chocolate");
  a.pockets[1] = newItem("photos");
  p.cargo.gear.push(newItem("whiskey"));
  const lines = teamTreats(st, p);
  check(lines.length === 1 && !a.pockets[0] && a.mood > 20 && a.pockets[1] && a.pockets[1].key === "photos", `the glum one eats the chocolate (mood 20 → ${r1(a.mood)}), the photos are kept`);
  check(p.cargo.gear.some((it) => it.key === "whiskey"), "valuables are not used above mood 20");
  a.mood = 10; a.buzz = null;
  p.phase = "waiting";
  teamTreats(st, p);
  check(!p.cargo.gear.some((it) => it.key === "whiskey") && a.buzz && a.buzz.label === "Hungover", "below 20, at rest: the whiskey from the cargo (a hangover follows)");
  // By hand: someone in good spirits can still be given one.
  b.pockets[0] = newItem("candy");
  const t = treatsFor(st, b).find((x) => x.key === "candy");
  const m0 = b.mood;
  const line = t ? useTreat(st, b, t.loc) : "";
  check(line && b.mood > m0 && !b.pockets[0], `by hand: ${line}`);
  // The hourly rule runs at the treat hour.
  a.mood = 20; a.buzz = null; a.pockets[2] = newItem("instcoffee");
  st.hour = Math.floor(st.hour / 24) * 24 + NEEDS.treatHour;
  needsHour(st);
  check(!a.pockets[2], "at the evening hour the team uses its treats by itself");
}

// ---------- 6. errands ----------
{
  console.log("Errands");
  const st = W();
  const h = quietHub(st);
  st.hour = mildDay(st) * 24 + 1;
  const s = atBase(st, h.id).find((x) => !x.leader);
  const food0 = h.stock.food, water0 = h.stock.water;
  const pack = packErrand(st, h, s, 4);
  check(pack.food === 4 && pack.water >= 4 && near(h.stock.food, food0 - 4) && near(h.stock.water, water0 - pack.water), `a 4-day errand takes ${pack.food} food and ${pack.water} water from the base`);
  s.location = { kind: "errand", baseId: h.id, until: Math.floor(st.hour / 24) + 1 + 4, pack };
  const gh = s.hunger;
  for (let i = 0; i < 24 * 4; i++) needsHour(st);
  check(s.hunger > 50 && s.thirst > 50 && pack.food < 4 && pack.food > 0, `they eat on the way (hunger ${r1(s.hunger)}, ${r1(pack.food)} food left)`);
  const back = Math.floor(pack.food);
  const f1 = h.stock.food;
  st.hour = (s.location.until - 1) * 24 + 1;
  st.rng.chance = () => false; // never lost, no find
  hubUpkeepDaily(st);
  check(s.location.kind === "base" && near(h.stock.food, f1 + back), `back home: the ${back} food left comes back`);
  void gh;
}

// ---------- 7. heating ----------
{
  console.log("Heating fuel per head");
  const st = W();
  const h = quietHub(st);
  let cold = null, bitter = null, warm = null;
  for (let d = 0; d < 112 * 2 && (cold == null || bitter == null || warm == null); d++) {
    const t = dayMeanTemp(st, d);
    if (cold == null && t < 0 && t >= -8) cold = d;
    if (bitter == null && t < -8) bitter = d;
    if (warm == null && t > 2 && d > 3) warm = d;
  }
  const n = residents(st, h.id).length;
  st.hour = warm * 24 + 1;
  check(heatRate(st) === 0 && heatUse(st, h).total === 0, "above 0°C: no heating");
  st.hour = cold * 24 + 1;
  const u = heatUse(st, h);
  check(near(u.each, HEAT.fuel) && near(u.total, n * HEAT.fuel), `below 0°C: ${u.text}`);
  check(upkeepLine(st, h).heating === `Heating: ${n} people × 0.1 = ${r1(n * 0.1).toFixed(1)} → ${Math.round(n * 0.1 / HEAT.wood)} firewood a day (or ${r1(n * 0.1).toFixed(1)} fuel)`, `the base panel: "${upkeepLine(st, h).heating}"`);
  // woodcutting.js: firewood burns first (1 firewood = HEAT.wood fuel of heat); the fuel figures below are without any.
  h.stock.wood = 300; h.stock.fuel = 10; // more than a day's firewood (0.1 kg a unit)
  heatDaily(st, h);
  check(near(h.stock.wood, 300 - n * HEAT.fuel / HEAT.wood) && h.stock.fuel === 10 && !h.cold, `firewood first: ${r1(n * HEAT.fuel / HEAT.wood)} firewood, no fuel`);
  h.stock.wood = 0;
  heatDaily(st, h);
  check(near(h.stock.fuel, 10 - n * HEAT.fuel) && !h.cold, `a day's heating burns ${r1(n * HEAT.fuel)} fuel`);
  if (bitter != null) {
    st.hour = bitter * 24 + 1;
    check(near(heatUse(st, h).each, HEAT.fuel * HEAT.bitter), `below −8°C ×${HEAT.bitter}: ${heatUse(st, h).text}`);
    st.hour = cold * 24 + 1;
  } else console.log("  (no day below −8°C in two years of this seed's weather)");
  // Twice the people, twice the fuel.
  for (let i = 0; i < n; i++) { const x = plain(makeSurvivor(st, 1)); x.location = { kind: "base", baseId: h.id }; x.role = "rest"; st.survivors.push(x); }
  check(near(heatUse(st, h).total, 2 * n * HEAT.fuel), "bigger groups burn more");
  // No fuel: everyone is cold.
  h.stock.fuel = 0;
  const ppl = residents(st, h.id);
  const hp0 = ppl.map((x) => x.health), m0 = ppl.map((x) => x.mood);
  heatDaily(st, h);
  check(h.cold === 1 && ppl.every((x, i) => near(x.health, hp0[i] - COLD.hp) && near(x.mood, m0[i] - COLD.mood)), `no fuel: cold (health −${COLD.hp}, mood −${COLD.mood} each)`);
  // Half the fuel: half as cold.
  h.stock.fuel = heatUse(st, h).total / 2;
  heatDaily(st, h);
  check(near(h.cold, 0.5, 0.02) && h.stock.fuel === 0, `half the fuel: ${Math.round(h.cold * 100)}% short`);
  // A shelter's lit camp fire keeps it warm without fuel.
  h.tier = 0; h.fire = true;
  check(heatUse(st, h).total === 0 && heatUse(st, h).fire, `a shelter with its fire lit: ${heatUse(st, h).text}`);
  h.fire = false;
  check(heatUse(st, h).total > 0, "with the fire out it needs fuel");
  delete h.tier; delete h.fire;
  // A team at a lit camp fire stays out of the cold's appetite.
  const tm = team(st, 2, { food: 10, water: 10 });
  if (foodNeedFactor(st) > 1) {
    check(teamCold(st, tm.p) === foodNeedFactor(st), `a team in the cold eats more (×${teamCold(st, tm.p)})`);
    tm.p.phase = "task"; tm.p.task = { type: "camp" }; tm.p.fire = true;
    check(teamCold(st, tm.p) === 1, "camped at a lit fire: no extra");
  } else console.log("  (the cold day is not below 0°C mean for the appetite: skipped)");
}

// ---------- 8. save and load ----------
{
  console.log("Save and load");
  const st = W();
  quietHub(st);
  for (let i = 0; i < 30; i++) tickHour(st);
  st.cards.length = 0; // a card's choices cannot be saved (a stranger at the gate on some rolls)
  const s = atBase(st, hub(st).id)[0];
  s.hunger = 33.5; s.thirst = 44.25;
  const st2 = loadFromString(saveToString(st));
  const s2 = st2.survivors.find((x) => x.id === s.id);
  check(s2.hunger === 33.5 && s2.thirst === 44.25, "gauges are saved");
  const raw = JSON.parse(saveToString(st));
  const strip = (o) => { if (o && typeof o === "object") { if ("hunger" in o && "thirst" in o && "skills" in o) { delete o.hunger; delete o.thirst; } for (const v of Object.values(o)) strip(v); } };
  strip(raw.state);
  const st3 = loadFromString(JSON.stringify(raw));
  check(st3.survivors.every((x) => x.hunger === 100 && x.thirst === 100), "an old save (no gauges) starts everyone full");
}

// ---------- 9. starving day after day: the mood hit grows each morning, resets when they eat ----------
{
  console.log("Starving and parched day after day");
  const st = W();
  quietHub(st);
  const s = atBase(st, hub(st).id).find((x) => !x.leader);
  s.mood = 90; s.hunger = 5;
  const hits = [];
  for (let d = 1; d <= 5; d++) { const m0 = s.mood; s.hunger = 5; starvingDaily(st); hits.push(r1(m0 - s.mood)); }
  check(hits.join(",") === [1, 2, 3, 4, 5].map((d) => STARVE.food.step * d).join(","), `the hit grows each morning starving: ${hits.join(", ")}`);
  check(s.starveDays === 5, `five mornings counted (${s.starveDays})`);
  check((s.moodNotes || []).some((n) => /Starving \(day 5\)/.test(n.label)), "it shows in the mood notes");
  check(st.log.some((l) => /has been starving for 3 days/.test(l.text)), "one log line on day 3");
  s.mood = 60; s.starveDays = 40; s.hunger = 5;
  starvingDaily(st);
  check(r1(60 - s.mood) === STARVE.food.max, `capped at −${STARVE.food.max} (${r1(60 - s.mood)})`);
  s.hunger = 30; s.mood = 60;
  starvingDaily(st);
  check(s.starveDays == null && s.mood === 60, "a morning fed again resets it, no mood lost");
  s.hunger = 100; s.thirst = 5; s.mood = 60;
  starvingDaily(st); s.thirst = 5; starvingDaily(st);
  check(s.parchDays === 2 && r1(60 - s.mood) === STARVE.water.step * 3, `parched: −${STARVE.water.step}, then −${STARVE.water.step * 2} (${r1(60 - s.mood)} in all)`);
  check(starveMood(0) === 0 && starveMood(2, "water") === STARVE.water.step * 2, "starveMood");
  const mf = moodFactors(st, s).list.find((f) => /^Parched: day 2/.test(f.label));
  check(mf && mf.v === -STARVE.water.step * 2 && !mf.own, "the mood breakdown lists it (applied in needs.js)");
  // A captive is not counted.
  const c = atBase(st, hub(st).id).find((x) => x !== s && !x.leader);
  c.hunger = 0; c.mood = 50; const loc = c.location; c.location = { kind: "captive", factionId: 1 };
  starvingDaily(st);
  check(c.mood === 50 && !c.starveDays, "captives are not counted");
  c.location = loc;
  // Saved.
  const s2 = loadFromString(saveToString((st.cards.length = 0, st))).survivors.find((x) => x.id === s.id);
  check(s2.parchDays === s.parchDays && s.parchDays > 0, "the count is saved");

  // A team with water but no food, left alone: hunger runs out and the hit grows until rock bottom while they live.
  const st2 = W();
  quietHub(st2);
  st2.hour = mildDay(st2) * 24;
  const { p, crew } = team(st2, 2, { food: 0, water: 40 });
  for (const m of crew) { m.mood = 60; m.hunger = 60; }
  const who = crew[0];
  let lowAt = null, perDay = [];
  for (let h = 1; h <= 24 * 14 && who.alive; h++) {
    st2.hour++;
    teamNeedsHour(st2, p, crew);
    if (st2.hour % 24 === 0) { const m0 = who.mood; starvingDaily(st2); if (who.mood > 0) perDay.push(r1(m0 - who.mood)); } // at 0 mood the floor cuts it
    if (lowAt == null && who.mood < SNAP.at) lowAt = Math.ceil(h / 24);
  }
  const steps = perDay.filter((v) => v > 0);
  check(steps.length >= 3 && steps.every((v, i) => i === 0 || v > steps[i - 1] || v === STARVE.food.max), `on the road the morning hit grows: ${steps.join(", ")}`);
  check(lowAt != null && lowAt <= 9, `rock bottom (mood under ${SNAP.at}, where breaks start) by day ${lowAt} from mood 60, still alive then`);
  // The status icons: starving with its day and mood.
  const st3 = W();
  const q = atBase(st3, hub(st3).id)[0];
  plain(q); q.hunger = 4; q.starveDays = 3;
  const icon = statusesOf(st3, q).find((x) => x.key === "hunger");
  check(icon && icon.tone === "danger" && icon.tip.includes(`Starving: day 3, mood −${starveMood(3)} a day`), `the starving icon says the day and the mood (${icon && icon.tip})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
