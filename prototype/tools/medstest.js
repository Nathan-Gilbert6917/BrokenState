// Meds: where they come from and when they go (the user's rules: "meds drain on need", "meds should be semi rare to
// find unless hospital / pharmacy"). Checks and tables:
//   - sources by site type: an hour of searching (scavenge.js searchHour, data.js LOCATIONS loot, medfinds.js), a raid
//     on the site's street map (combat.js AREAS / AREA_SETS through the raid bot), the bodies (inventory.js ZBODY,
//     enemyBody; combat.js searchBox; deadsoldiers.js bodyLoot), locked things (locks.js LOCK_LOOT), foraging herbs;
//     pharmacies, clinics, hospitals and medevac wrecks give many times what ordinary places do, which give 1–2 at once
//     (a raid is measured per container searched, so the bot's appetite for containers does not move the check)
//   - trade: what a group pays and asks for meds (trade.js, data.js SUPPLIES.meds.value)
//   - no flat drain: a base whose people are all well spends no meds; every meds spent is a treatment
//   - a team in the field treats a bad wound or an illness from its own meds; a base from its stock
// Usage: node tools/medstest.js [raids per site = 16] [seed = 7]
//        node tools/medstest.js sample [games = 20] [days = 112]   (the autopilot: meds stock, meds spent, deaths)
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, atBase, alive, day, survivorById } from "../src/sim/world.js";
import { LOCATIONS, SUPPLIES, supValue } from "../src/sim/data.js";
import { AREAS, AREA_SETS, createBattle, registerCombatHandler, autoPlayerTurn, runEnemyPhase, enemyUnit } from "../src/sim/combat.js";
import { raidEnemies, searchHour } from "../src/sim/scavenge.js";
import { launchExpedition } from "../src/sim/parties.js";
import { deadBodyFinds, enemyBody, newItem, ZBODY } from "../src/sim/inventory.js";
import { bodyLoot, MILDEAD } from "../src/sim/deadsoldiers.js";
import { FORAGE } from "../src/sim/foraging.js";
import { sellPrice, buyPrice } from "../src/sim/trade.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { addCondition } from "../src/sim/health.js";
import { Rng } from "../src/sim/rng.js";

const SAMPLE = process.argv[2] === "sample";
const N = SAMPLE ? 0 : Number(process.argv[2] || 16);
const SEED = SAMPLE ? 7 : Number(process.argv[3] || 7);
const MF = await import("../src/sim/medfinds.js").catch(() => null);
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
const section = (s) => console.log(`\n${s}`);
const r2 = (v) => Math.round(v * 100) / 100;
registerCombatHandler("medst", () => {});
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };

// Site types: the medical ones, then ordinary places of every kind.
const MED = ["pharmacy", "clinic", "hospital", "crash_med"];
const ORDINARY = ["town", "city", "suburb", "mall", "supermarket", "grocery", "apartments", "office", "motel", "church", "police", "farm", "cabin", "gas", "factory"];
const SOME = ["univ", "firestation", "school", "ranger", "military", "crash_mil", "airdrop"]; // first aid on hand, a little (a school's nurse, a fire station's first-aid room: combat.js AREAS nurse)
const label = (k) => (LOCATIONS[k] ? LOCATIONS[k].name : k);

// A plain tile far from the hub that nobody holds, made into a site of the given type.
function siteTile(st, type) {
  const h = hub(st);
  const t = st.tiles.find((x) => x.terrain !== "water" && !x.loc && x.owner == null && st.grid.distance(x.id, h.tile) >= 6 && !st.factions.some((f) => f.bases.includes(x.id)));
  if (LOCATIONS[type]) t.loc = { type, name: LOCATIONS[type].name };
  else { t.loc = null; t.terrain = type; }
  t.loot = 0.7; t.infection = 0.2;
  return t;
}

// ---------- the hour-by-hour search ----------
function searchRate(type, hours = 240) {
  const st = createWorld({ seed: SEED, factionCount: 4 });
  const t = siteTile(st, type);
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 10, water: 10, ammo: 40 } });
  if (res.error) return null;
  const p = res.party;
  st.engagement = { partyId: p.id, tile: t.id, heat: 0, hours: 0, approach: "normal", log: [], found: { supplies: {}, gear: [] }, done: false, guarded: null };
  let biggest = 0, withMeds = 0;
  for (let i = 0; i < hours; i++) {
    const e = st.engagement;
    t.loot = 0.7; e.heat = 0;
    for (const s of crew) { s.health = 100; s.conditions = []; s.alive = true; }
    const before = e.found.supplies.meds || 0;
    searchHour(st);
    const got = (e.found.supplies.meds || 0) - before;
    if (got > 0) withMeds++;
    biggest = Math.max(biggest, got);
  }
  return { perHour: (st.engagement.found.supplies.meds || 0) / hours, hoursWith: withMeds / hours, biggest };
}

// ---------- a raid on the site's street map (the raid bot) ----------
function raidRate(type, n) {
  const o = { raids: 0, meds: 0, biggest: 0, searched: 0 };
  for (let i = 0; i < n; i++) {
    const st = createWorld({ seed: SEED * 1000 + i, factionCount: 4 });
    const t = siteTile(st, type);
    const h = hub(st);
    const crew = atBase(st, h.id).slice(0, 3);
    for (const s of crew) { s.health = 100; s.gear.weapon = newItem("huntrifle"); s.skills.shooting = Math.max(s.skills.shooting || 0, 6); }
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 60 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [t.id]; p.idx = 0; p.phase = "engaged";
    const groups = raidEnemies(st, t.id);
    st.combat = inBrowser(() => createBattle(st, { mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "medst", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: 5 }, context: {} }));
    const b = st.combat;
    let g = 0;
    while (!b.over && g++ < 200) { autoPlayerTurn(st); runEnemyPhase(st); }
    st.combat = null;
    if (!b.over) continue;
    const m = b.result.loot.supplies.meds || 0;
    o.raids++; o.meds += m; o.biggest = Math.max(o.biggest, m); o.searched += (b.result.raid && b.result.raid.searched) || 0;
  }
  return o;
}

// What one container of an area holds in meds on average (combat.js searchBox at richness 1, Scavenging 0).
const perBox = (area) => { const l = AREAS[area] && AREAS[area].loot.meds; return l ? Math.min(0.95, l[0]) * ((l[1] + l[2]) / 2) * 1.1 : 0; };
const perSiteBoxes = (type) => { const set = AREA_SETS[type] || []; return set.length ? set.reduce((a, k) => a + perBox(k), 0) / set.length : 0; };

if (!SAMPLE) {
  section(`Where meds come from, by site type (an hour of searching: 240 hours at 70% loot; a raid: ${N} raids by the bot, 3 survivors)`);
  const rows = [];
  for (const type of [...MED, ...SOME, ...ORDINARY]) {
    const s = searchRate(type);
    const r = raidRate(type, N);
    rows.push({ type, s, r, box: perSiteBoxes(type), med: MED.includes(type), some: SOME.includes(type) });
    console.log(`    ${label(type).padEnd(24)} search ${r2(s.perHour).toFixed(2).padStart(5)}/h (${Math.round(s.hoursWith * 100).toString().padStart(2)}% of hours, at most ${s.biggest})   raid ${r2(r.meds / Math.max(1, r.raids)).toFixed(2).padStart(5)} (at most ${r.biggest} in one, ${r2(r.searched / Math.max(1, r.raids)).toFixed(1)} containers searched, ${r2(r.meds / Math.max(1, r.searched)).toFixed(2)} each)   a container ${r2(perSiteBoxes(type)).toFixed(2)}`);
  }
  const avg = (list, f) => list.reduce((a, x) => a + f(x), 0) / Math.max(1, list.length);
  const med = rows.filter((x) => x.med), ord = rows.filter((x) => !x.med && !x.some);
  const mS = avg(med, (x) => x.s.perHour), oS = avg(ord, (x) => x.s.perHour), mR = avg(med, (x) => x.r.meds / Math.max(1, x.r.raids)), oR = avg(ord, (x) => x.r.meds / Math.max(1, x.r.raids));
  console.log(`    average: medical sites ${r2(mS)}/h, ${r2(mR)} a raid; ordinary places ${r2(oS)}/h, ${r2(oR)} a raid`);
  check(mS >= 8 * oS, `an hour at a pharmacy, clinic, hospital or medevac wreck finds many times the meds of an ordinary place (${r2(mS)} vs ${r2(oS)} an hour, ×${r2(mS / Math.max(0.001, oS))})`);
  check(ord.every((x) => x.s.perHour <= 0.25 && x.s.biggest <= 2), `ordinary places: at most 0.25 meds an hour and 1–2 at a time (worst ${label(ord.slice().sort((a, b) => b.s.perHour - a.s.perHour)[0].type)} ${r2(Math.max(...ord.map((x) => x.s.perHour)))}/h, biggest find ${Math.max(...ord.map((x) => x.s.biggest))})`);
  // Per container searched, not per raid: how many containers the bot gets through is its own business (raidloot.js,
  // breakoff.js) and changes with every bot change; what one container holds is the meds design (AREAS, locks.js
  // LOCK_LOOT, the upper storeys' richness).
  const each = (x) => x.r.meds / Math.max(1, x.r.searched);
  const worstOrd = ord.slice().sort((a, b) => each(b) - each(a))[0];
  // 0.4: food by type (sim/foods.js) weighs what it does (a day of a shop's cans about 2 kg): the bot fills its packs in
  // fewer containers at a supermarket, and the few it takes first are the ones it picks for meds.
  // 0.45 since facing and footsteps (vision.js, 2026-10-12): the bot turns to each container and its dashes are heard,
  // so it gets through a few fewer at a supermarket (2.9 → 2.7 a raid) for the same meds a raid (1.13 both ways).
  check(mR >= 4 * oR && ord.every((x) => each(x) <= 0.45) && med.every((x) => each(x) >= 1), `a raid: medical sites ${r2(mR)} a raid vs ordinary ${r2(oR)}; per container searched, every medical site 1+ (least ${r2(Math.min(...med.map(each)))}), no ordinary place above 0.45 (most ${label(worstOrd.type)} ${r2(each(worstOrd))})`);
  check(med.every((x) => x.s.perHour >= 1.5), `every medical site is worth the trip: ${med.map((x) => `${label(x.type)} ${r2(x.s.perHour)}/h`).join(", ")}`);
  check(!["town", "city", "mall"].some((k) => (AREA_SETS[k] || []).includes("pharmacy") || (AREA_SETS[k] || []).includes("clinic")), "the street maps of a town, a city centre and a mall have no pharmacy or clinic area (their pharmacy building can still be raided)");

  section("Bodies, locked things, herbs");
  {
    const rng = new Rng(SEED);
    const n = 4000;
    let z = 0, hu = 0, so = 0, big = 0;
    const b = { nextId: 1 };
    for (let i = 0; i < n; i++) {
      const f = deadBodyFinds(rng, null); z += f.sup.meds || 0; big = Math.max(big, f.sup.meds || 0);
      const u = enemyUnit(b, rng, "raiders", 4, 1);
      const body = enemyBody(rng, u, null); hu += body.supplies.meds || 0; big = Math.max(big, body.supplies.meds || 0);
      so += bodyLoot(rng, "soldier", newItem).sup.meds || 0;
    }
    console.log(`    one of the dead ${r2(z / n)} a body, a person ${r2(hu / n)}, a dead soldier ${r2(so / n)}; foraging herbs ${FORAGE.herbs * 100}% a forager-hour (1 meds)`);
    check(z / n <= 0.06 && hu / n <= 0.12 && so / n <= 0.1 && big <= 1, `bodies: small chances, one at a time (the dead ${r2(z / n)}, people ${r2(hu / n)}, soldiers ${r2(so / n)})`);
    check(ZBODY.meds[2] === 1 && MILDEAD.BODY.soldier.sup.find((x) => x[0] === "meds")[3] === 1, "a body never holds more than 1 meds");
  }

  section("Trade (trade.js; data.js SUPPLIES.meds.value)");
  {
    const st = createWorld({ seed: SEED, factionCount: 6 });
    const f = st.factions.find((x) => x.alive && x.type === "traders") || st.factions.find((x) => x.alive);
    const lines = [];
    for (const k of ["meds", "ammo", "food", "fuel"]) lines.push(`${k} sells ${r2(sellPrice(st, f, k, 0))} / buys ${r2(buyPrice(st, f, k, 0))}`);
    console.log(`    ${f.name} (${f.type}, ${f.pop} people, ${Math.round(f.stock.meds)} meds): ${lines.join("; ")}; meds base value ${SUPPLIES.meds.value}`);
    check(SUPPLIES.meds.value >= 8, `meds are dear: base value ${SUPPLIES.meds.value} (ammo ${SUPPLIES.ammo.value}, a day of food ${supValue("food")})`);
  }

  section("Meds go on need only (medical.js, health.js; teams from their own meds, bases from their stock)");
  {
    // A base whose people are all well: 10 days, no meds spent.
    const st = createWorld({ seed: SEED, factionCount: 4 });
    st.started = true;
    const h = hub(st);
    h.stock.meds = 30; setFood(h, 400); h.stock.water = 400;
    // Everyone is made well at the top of each hour, but the hour's own dice can still give someone a cold (health.js
    // SICK.common, about 0.6% a head a day: a 10-day run of six catches one about a third of the time, by seed) and the
    // night's care then treats it: that is need, not a drain. So the drain is meds spent in an hour that ends with
    // everyone still well; meds spent on someone who fell ill or hurt within the hour are counted apart, a dose a head.
    let spent = 0, spentHours = [], onNeed = 0, needOk = true;
    const unwell = () => alive(st).filter((s) => s.health < 100 || (s.conditions && s.conditions.length) || s.woundInfected);
    for (let i = 0; i < 24 * 10; i++) {
      for (const s of alive(st)) { s.health = 100; s.conditions = []; s.woundInfected = false; }
      st.cards = [];
      const before = h.stock.meds, top = st.log[0];
      tickHour(st);
      // (Morale runs down in a base left to itself: someone who walks away takes meds with them, morale.js
      // desertionHaul. That is a theft, not care.)
      const fresh = []; for (const l of st.log) { if (l === top) break; fresh.push(l); }
      if (fresh.some((l) => /walked away/.test(l.text))) continue;
      if (h.stock.meds < before - 1e-9) {
        const ill = unwell();
        if (ill.length) { onNeed += before - h.stock.meds; if (before - h.stock.meds > ill.length * 2) needOk = false; continue; }
        spent += before - h.stock.meds; spentHours.push(st.log.slice(0, 4).map((l) => l.text).join(" | "));
      }
    }
    check(spent === 0 && needOk, `a base where nobody is hurt or sick spends no meds in 10 days (${spent} spent${spentHours.length ? `: ${spentHours[0]}` : ""}; ${onNeed} on someone taken ill within the hour)`);
    // A hurt one at the base: treated from the stock, about one meds a treatment.
    const st2 = createWorld({ seed: SEED + 1, factionCount: 4 });
    st2.started = true;
    const h2 = hub(st2);
    h2.stock.meds = 10;
    const s2 = atBase(st2, h2.id)[0];
    s2.health = 35; s2.woundInfected = true;
    const m0 = h2.stock.meds;
    for (let i = 0; i < 30 && h2.stock.meds === m0; i++) { tickHour(st2); st2.cards = []; }
    check(h2.stock.meds < m0 && m0 - h2.stock.meds <= 3, `a badly hurt, infected survivor at the base is treated from its stock (${m0} → ${h2.stock.meds} meds)`);
    // A team in the field: a bad wound and an illness are treated from what the team carries.
    const st3 = createWorld({ seed: SEED + 2, factionCount: 4 });
    st3.started = true;
    const h3 = hub(st3);
    const crew = atBase(st3, h3.id).slice(0, 2);
    const far = st3.tiles.find((x) => x.terrain !== "water" && st3.grid.distance(x.id, h3.tile) === 5);
    const res = launchExpedition(st3, { memberIds: crew.map((s) => s.id), dest: far.id, mission: "recon", stance: "normal", vehicleId: null, supplies: { food: 20, water: 20, ammo: 10, meds: 4 } });
    const p = res.party;
    const hurtOne = crew[0], sickOne = crew[1];
    hurtOne.health = 30; hurtOne.woundInfected = true;
    addCondition(st3, sickOne, "pneumonia", "in the rain");
    const t0 = p.supplies.meds + ((p.cargo && p.cargo.supplies.meds) || 0), base0 = h3.stock.meds;
    for (let i = 0; i < 26; i++) { tickHour(st3); st3.cards = []; }
    const t1 = (p.supplies.meds || 0) + ((p.cargo && p.cargo.supplies.meds) || 0);
    const treated = hurtOne.woundTreatedDay != null;
    check(t1 < t0 && treated && h3.stock.meds >= base0, `a team in the field treats a bad wound and pneumonia from its own meds (${t0} → ${t1}; the wound ${treated ? "treated" : "not treated"}; the base's ${base0} → ${h3.stock.meds} untouched)`);
    check(MF && MF.FIELD_CARE && hurtOne.health > 30, `field care: a wound below ${MF ? MF.FIELD_CARE.below : "?"} health or infected, once a day (health 30 → ${Math.round(hurtOne.health)})`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// ---------- the autopilot over a year: meds stock, meds spent, deaths ----------
const GAMES = Number(process.argv[3] || 20), DAYS = Number(process.argv[4] || 112);
const MED_DEATH = /died (of an infected wound|of fever|of flu|of pneumonia|of dysentery|of deep cut|of sprain)/;
const spentOf = (text) => {
  let m = text.match(/\. (\d+(?:\.\d+)?) meds used\.$/);
  if (m) return Number(m[1]);
  m = text.match(/took (\d+) of the team's meds/);
  if (m) return Number(m[1]);
  m = text.match(/\((\d+) meds\)/);
  if (m && /treated|operated|patches/.test(text)) return Number(m[1]);
  return 0;
};
const all = [];
for (let g = 0; g < GAMES; g++) {
  const st = createWorld({ seed: 100 + g, factionCount: 8 });
  st.started = true;
  setAutopilot(st, true, "balanced");
  const o = { seed: 100 + g, stock: [], spent: 0, medDeaths: 0, deaths: 0, fell: false, day: 0, minStock: 999 };
  let top = st.log[0];
  while (day(st) <= DAYS && !st.gameOver) {
    tickHour(st);
    for (const l of st.log) { if (l === top) break; o.spent += spentOf(l.text); if (/ died /.test(l.text) && l.kind === "death") { o.deaths++; if (MED_DEATH.test(l.text)) o.medDeaths++; } }
    top = st.log[0];
    const h = hub(st);
    if (h && st.hour % 24 === 12) o.minStock = Math.min(o.minStock, h.stock.meds || 0);
    if (h && st.hour % (24 * 28) === 12) o.stock.push(Math.floor(h.stock.meds || 0));
  }
  o.fell = !!st.gameOver && !st.victory;
  o.day = day(st);
  o.alive = alive(st).length;
  all.push(o);
  console.log(`  seed ${o.seed}: day ${o.day}${o.fell ? " (fell)" : ""} alive ${o.alive} meds at day 1/29/57/85 ${o.stock.join("/")} (lowest ${Math.floor(o.minStock)}) spent ${Math.round(o.spent)} deaths ${o.deaths} (untreated wounds / illness ${o.medDeaths})`);
}
const avg = (f) => r2(all.reduce((a, o) => a + f(o), 0) / all.length);
console.log(`\n${GAMES} games, ${DAYS} days, balanced: fell ${all.filter((o) => o.fell).length}, alive ${avg((o) => o.alive)}, meds stock by season ${[0, 1, 2, 3].map((i) => avg((o) => o.stock[i] ?? 0)).join(" / ")}, lowest ${avg((o) => o.minStock)}, spent ${avg((o) => o.spent)}, deaths ${avg((o) => o.deaths)} (untreated wounds / illness ${avg((o) => o.medDeaths)})`);
