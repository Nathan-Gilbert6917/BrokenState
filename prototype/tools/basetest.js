// Headless regression checks for the base and survivor systems (world.js, economy.js, buildings.js, medical.js,
// crafting.js, inventory.js, vehicles.js): game over, the leader card, deaths at a base, lost outposts, cut-off
// outposts, hunger, starting roles and names, refunds, kits, armor condition and the stock floor.
// Usage: node tools/basetest.js [seed]
import { LIGHTS } from "../src/sim/lights.js";
import {
  createWorld, tickHour, hub, atBase, alive, skill, hurt, killSurvivor, makeSurvivor, newId, applyCrew, residents,
  checkGameOver, removeBase, renameSurvivor, assignStartingRoles, combatPower,
} from "../src/sim/world.js";
import { GEAR, TRAITS, FIRST_NAMES } from "../src/sim/data.js";
import { basesDaily, farmOutput, scavengeOutput, supplyLine, hungerDamage, foodForecast, GREEDY_SCAV, eatPerDay, spoilRate } from "../src/sim/economy.js";
import { careToday } from "../src/sim/farming.js";
import { addBuilding, queueBuild, cancelBuild, canBuild, stations, stationStatus, assignStations, constructionHour, BUILDINGS } from "../src/sim/buildings.js";
import { treatAtBase, treatAtBaseInfo, fieldTreatInfo, treatAnywhere, medicalHour, healRatePerHour } from "../src/sim/medical.js";
import { craftOutputText, CRAFTS, medKitBonus, makeItem, queueCraft, cancelCraft } from "../src/sim/crafting.js";
import { armorPower, armorMult, newItem, leaveBodies } from "../src/sim/inventory.js";
import { createVehicle, refuel, tank } from "../src/sim/vehicles.js";
import { planPath } from "../src/sim/parties.js";
import { captivesDaily } from "../src/sim/conflicts.js";
import { baseHeat } from "../src/sim/hordes.js";
import { randomName, skillTotal } from "../src/sim/appearance.js";
import { Rng } from "../src/sim/rng.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const W = (s = seed, extra = {}) => createWorld({ seed: s, factionCount: 6, ...extra });
const firstOf = (n) => n.split(" ")[0];
const plain = (s) => { s.traits = []; return s; };
const addPerson = (st, base, role = "farm") => { const s = plain(makeSurvivor(st, 1)); s.location = { kind: "base", baseId: base.id }; s.role = role; st.survivors.push(s); return s; };
const mkOutpost = (st, tile, stock = {}) => {
  const b = { id: newId(), tile, type: "outpost", name: "Test Outpost", stock: { food: 0, water: 0, fuel: 0, meds: 0, ammo: 0, parts: 0, scrap: 0, ...stock }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  st.bases.push(b);
  return b;
};
const logHas = (st, re) => st.log.some((l) => re.test(l.text));
const leaders = (st) => st.survivors.filter((s) => s.alive && s.leader);

// 1. Game over when the last person leaves (B-1).
{
  console.log("Game over: desertion and captives changing sides");
  const st = W();
  const h = hub(st);
  h.stock.food = 9999;
  const ppl = atBase(st, h.id);
  for (const s of ppl.slice(1)) killSurvivor(st, s, null, "in a test");
  ppl[0].leader = false; // a leader never deserts
  st.cards.length = 0;
  check(!st.gameOver, "one person alive: the run goes on");
  let days = 0;
  while (ppl[0].alive && days < 400) { ppl[0].mood = 0; basesDaily(st); st.cards.length = 0; days++; }
  check(ppl[0].left && !ppl[0].alive, `the last survivor deserted (after ${days} nights)`);
  check(st.gameOver, "desertion of the last survivor ends the run");
  check(logHas(st, /^Every survivor is dead/), "the game-over log line is there (the timelapse looks for these words)");

  const st2 = W();
  const p2 = atBase(st2, hub(st2).id);
  for (const s of p2.slice(1)) killSurvivor(st2, s, null, "in a test");
  const last = p2[0];
  last.leader = false;
  const f = st2.factions.find((x) => x.alive && x.bases.length);
  let guard = 0;
  while (last.alive && guard++ < 5000) {
    if (last.location.kind !== "captive") last.location = { kind: "captive", factionId: f.id, tile: f.bases[0], since: st2.hour - 24 * 30 };
    f.alive = true; f.goodwill = -80;
    last.health = 100;
    captivesDaily(st2);
    st2.cards.length = 0;
  }
  check(!last.alive, "the captive was eventually lost (recruited or killed)");
  check(st2.gameOver, `losing the last captive ends the run (${last.left ? "changed sides" : "died"})`);

  const st3 = W();
  for (const s of st3.survivors) { s.alive = false; s.left = true; }
  check(!st3.gameOver && checkGameOver(st3) && st3.gameOver, "checkGameOver flags a world with nobody alive");
  const st4 = W();
  for (const s of st4.survivors) { s.alive = false; s.left = true; }
  tickHour(st4);
  check(st4.gameOver, "tickHour ends the run when nobody is alive, however they went");
}

// 2. The leader card (B-2, C-13).
{
  console.log("Leader card");
  const st = W();
  const h = hub(st);
  const ppl = atBase(st, h.id);
  for (let i = 0; i < 6; i++) addPerson(st, h);
  const all = atBase(st, h.id);
  all.forEach((s, i) => { plain(s); s.skills.leadership = i === 0 ? 5 : Math.min(12, i); });
  const star = all[all.length - 1];
  star.skills.leadership = 20; // the best candidate is the newest arrival
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const cap1 = all[10], cap2 = all[9];
  for (const c of [cap1, cap2]) { c.skills.leadership = 19; c.location = { kind: "captive", factionId: f.id, tile: f.bases[0], since: st.hour }; }
  const leader = ppl.find((s) => s.leader);
  hurt(st, leader, 999, h.tile, "in a test");
  const card = st.cards.find((c) => c.title === "The leader is dead");
  check(!!card, "the leader's death raises the card");
  if (card) {
    check(card.choices.length === 6, `six candidates (${card.choices.length})`);
    check(card.choices[0].label.startsWith(star.name), `the best leader is offered first (${card.choices[0].label})`);
    const vals = card.choices.map((c) => Number(/Leadership (\d+)/.exec(c.label)[1]));
    check(vals.every((v, i) => i === 0 || vals[i - 1] >= v), `candidates are sorted by Leadership (${vals.join(", ")})`);
    check(!card.choices.some((c) => c.label.startsWith(cap1.name) || c.label.startsWith(cap2.name)), "captives are not offered");
    // The first pick dies while the card waits.
    hurt(st, star, 999, h.tile, "in a test");
    check(card.choices[0].disabled(st) === true, "a dead candidate's choice is disabled");
    st.cards.splice(st.cards.indexOf(card), 1);
    const msg = card.choices[0].resolve(st);
    const ls = leaders(st);
    check(ls.length === 1 && ls[0].alive && ls[0].location.kind !== "captive", `picking the dead candidate falls back to a living, free one (${msg})`);
    check(!st.survivors.some((s) => !s.alive && s.leader), "no dead leader");
  }
  // No leader and no card: the daily check asks again.
  const st2 = W();
  st2.survivors.forEach((s) => (s.leader = false));
  st2.cards.length = 0;
  let n = 0;
  while (!st2.cards.some((c) => c.title === "The leader is dead") && n++ < 30) tickHour(st2);
  check(st2.cards.some((c) => c.title === "The leader is dead"), "a leaderless group is asked to pick a leader at the next daily tick");
}

// 3. Deaths at a base go to the armory (B-5).
{
  console.log("Death at a base");
  const st = W();
  const h = hub(st);
  const s = atBase(st, h.id).find((x) => !x.leader);
  s.gear.weapon = newItem("machete");
  s.gear.backpack = newItem("backpack");
  s.gear.backpack.contents[0] = newItem("pistol");
  s.pockets[0] = newItem("knife");
  const before = h.armory.length;
  hurt(st, s, 999, h.tile, "of hunger in a test");
  check(!s.alive, "the survivor died");
  check(!st.deathSites.some((d) => d.tile === h.tile), "no death site on the base's own tile");
  check(h.armory.length === before + 3, `their things are in the armory (+${h.armory.length - before})`);
  check(h.armory.some((g) => g.key === "backpack" && g.contents[0] && g.contents[0].key === "pistol"), "the pack kept its contents");
  check(!s.gear.weapon && !s.gear.backpack && !s.pockets[0], "nothing is left on the body (no duplicates)");
  check(s.station == null && !s.inBed, "the dead hold no station and no bed");
  // A team member dying on a base's tile outside a battle (a convoy starving while it holds there) counts too.
  const s3 = atBase(st, h.id).find((x) => !x.leader);
  s3.gear.weapon = newItem("shotgun");
  st.parties.push({ id: 4242, owner: "player", members: [s3.id], supplies: {}, cargo: { supplies: {}, gear: [] }, path: [h.tile], idx: 0, spotted: new Map(), seen: new Map() });
  s3.location = { kind: "party", partyId: 4242 };
  killSurvivor(st, s3, h.tile, "in a test");
  check(!st.deathSites.some((d) => d.tile === h.tile) && h.armory.some((g) => g.key === "shotgun"), "a team member who dies on a base's tile is handled the same way");
  st.parties.length = 0;
  // Away from home it is still a death site.
  const s2 = atBase(st, h.id).find((x) => !x.leader);
  s2.gear.weapon = newItem("machete");
  const far = st.grid.neighbors(h.tile)[0];
  killSurvivor(st, s2, far, "in a test");
  check(st.deathSites.some((d) => d.tile === far && d.items.length >= 1), "a death elsewhere still leaves a death site");
}

// 4. A lost outpost (B-8).
{
  console.log("Lost outpost");
  const st = W();
  const h = hub(st);
  const tile = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 5 && planPath(st, t.id, h.tile, false));
  const base = mkOutpost(st, tile.id, { food: 30, scrap: 12 });
  addBuilding(base, "ammo_bench");
  base.armory.push(newItem("machete"));
  const a = addPerson(st, base, "operate"), b = addPerson(st, base, "guard");
  assignStations(st, base);
  check(a.station != null, "the outpost operator has a station");
  const v = createVehicle(st, "sedan", { kind: "base", baseId: base.id }, { fuel: 10, condition: 70 });
  st.supplyRuns.push({ id: newId(), originId: h.id, destId: base.id, crewIds: [], deliver: [], pickup: [], status: "waiting", repeat: 3, paused: false, partyId: null, nextDay: 99 });
  check(removeBase(st, base, "was overrun in a test"), "removeBase removes an outpost");
  check(!st.bases.includes(base), "the base is gone");
  check(v.loc.kind === "abandoned" && v.loc.tile === tile.id, `the parked vehicle is abandoned on that tile (${JSON.stringify(v.loc)})`);
  check(st.markers.some((m) => m.key === `vehicle:${v.id}` && m.tile === tile.id), "the vehicle has a map marker");
  check([a, b].every((s) => s.location.kind === "base" && s.location.baseId === h.id), "the staff fled to the hub");
  check(!stations(h).some((x) => x.id === a.station) ? a.station == null : true, "no station id of the lost base is kept");
  check(st.supplyRuns[0].paused, "supply runs to the lost base are paused");
  check(logHas(st, /Test Outpost was overrun in a test\..*Lost with it.*30 food.*left behind/), "the log says what was lost");
  check(!removeBase(st, h), "the hub cannot be removed");
  check(!st.vehicles.some((x) => x.loc.kind === "base" && !st.bases.some((bb) => bb.id === x.loc.baseId)), "no vehicle is parked at a missing base");
}

// 5. A cut-off outpost (B-3) and the outpost scrap reserve (B-30).
{
  console.log("Outposts: cut off, reserve");
  let done = false;
  for (let sd = 1; sd <= 12 && !done; sd++) {
    const st = W(sd);
    const h = hub(st);
    const t = st.tiles.find((x) => x.terrain !== "water" && x.terrain !== "mountain" && !planPath(st, x.id, h.tile, false) && !planPath(st, x.id, h.tile, true));
    if (!t) continue;
    done = true;
    const base = mkOutpost(st, t.id, { scrap: 40 });
    const a = addPerson(st, base, "guard"), b = addPerson(st, base, "guard");
    h.stock.food = 300;
    const hubScrap = h.stock.scrap;
    check(supplyLine(st, base).strength === 0, `seed ${sd}: the outpost has no land route`);
    // The same day without the outpost (same seed, everyone at the hub resting: no harvests, no finds): the hub's
    // food must end the day exactly the same (crops ripen in batches now, and stored food spoils a little).
    const twin = W(sd);
    const th = hub(twin);
    th.stock.food = 300;
    for (const s of atBase(twin, th.id)) s.role = "rest";
    for (const s of atBase(st, h.id)) s.role = "rest";
    basesDaily(twin);
    basesDaily(st);
    st.cards.length = 0;
    check(near(h.stock.food, th.stock.food, 0.11), `the hub's food is not drained by the cut-off outpost (${h.stock.food} vs ${th.stock.food} without it)`);
    check(base.stock.scrap >= 40, `the outpost keeps its stock (${base.stock.scrap} scrap)`);
    check(h.stock.scrap < hubScrap + 20, "nothing was shipped into the void");
    check(logHas(st, /Test Outpost is cut off/), "the log says the outpost is cut off");
    check(a.health < 100 && b.health < 100 && base.stock.food === 0, "its people go hungry on their own stock");
    check(Number.isFinite(h.stock.food) && Number.isFinite(base.stock.food), "no NaN or Infinity in the stocks");
  }
  check(done, "found a seed with an unreachable land tile");

  const st = W();
  const h = hub(st);
  const tile = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 4 && planPath(st, t.id, h.tile, false));
  const base = mkOutpost(st, tile.id, { food: 50, scrap: 28 });
  addPerson(st, base, "guard");
  basesDaily(st);
  check(base.stock.scrap >= 27, `an outpost with nothing queued keeps its scrap to save for a building (${base.stock.scrap})`);
  base.stock.scrap = 80;
  basesDaily(st);
  check(base.stock.scrap <= 31, `surplus above the reserve is still shipped (${base.stock.scrap})`);
}

// 6. Hunger kills, and nobody heals while a base starves (P-6); raw damage (B-13).
{
  console.log("Hunger");
  const st = W();
  const h = hub(st);
  const ppl = atBase(st, h.id);
  ppl.forEach((s) => { plain(s); s.role = "rest"; s.skills.medicine = 12; });
  h.stock.food = 0; h.stock.preserved = 0; h.stock.meds = 0;
  const tough = ppl[1];
  tough.traits = ["tough"];
  tough.gear.armor = newItem("plate"); tough.gear.head = newItem("riothelmet");
  basesDaily(st);
  check(near(ppl[2].health, 100 - hungerDamage(1)) && near(tough.health, 100 - hungerDamage(1)), `armor and Tough do not reduce hunger (${ppl[2].health} / ${tough.health})`);
  check(healRatePerHour(st, h, ppl[2]) === 0, "no passive healing while the base is out of food");
  let days = 1;
  while (alive(st).length === 6 && days < 30) {
    for (let i = 0; i < 24; i++) medicalHour(st);
    h.stock.food = 0; h.stock.preserved = 0;
    basesDaily(st);
    st.cards.length = 0;
    ppl.forEach((s) => (s.mood = 60)); // keep them from walking away: this is about health
    days++;
  }
  check(alive(st).length < 6, `starvation kills (first death after ${days} days without food)`);
  check(days >= 5 && days <= 12, `it takes about a week (${days} days)`);
  check(hungerDamage(1) < hungerDamage(2) && hungerDamage(2) < hungerDamage(3), "hunger damage grows with consecutive days");
  const st2 = W();
  const h2 = hub(st2);
  atBase(st2, h2.id).forEach((s) => (s.role = "rest"));
  h2.stock.food = 0; h2.stock.preserved = 0;
  basesDaily(st2);
  check(h2.hungerDays === 1, "a day without food is counted");
  h2.stock.food = 500;
  basesDaily(st2);
  check(h2.hungerDays === 0 && healRatePerHour(st2, h2, atBase(st2, h2.id).find((s) => s.health < 100)) > 0, "healing resumes once there is food again");
  // hurt(): plain damage is reduced by armor and Tough, raw damage is not.
  const st3 = W();
  const s = plain(atBase(st3, hub(st3).id)[0]);
  s.traits = ["tough"]; s.gear.armor = newItem("plate");
  hurt(st3, s, 10, null, "in a test");
  const normal = 100 - s.health;
  s.health = 100;
  hurt(st3, s, 10, null, "in a test", { raw: true });
  check(normal < 7 && near(100 - s.health, 10), `raw damage ignores armor and Tough (${normal.toFixed(2)} vs ${(100 - s.health).toFixed(2)})`);
}

// 7. Stock never goes negative (B-11) and the stranger card.
{
  console.log("Stock floor and the stranger card");
  const st = W();
  const h = hub(st);
  h.stock.food = 9999;
  let card = null, n = 0;
  while (!card && n++ < 2000) { basesDaily(st); card = st.cards.find((c) => c.title === "A stranger at the gate"); if (!card) st.cards.length = 0; }
  check(!!card, "a stranger turned up");
  if (card) {
    h.stock.food = 2;
    const count = st.survivors.length;
    const msg = card.choices[0].resolve(st);
    check(st.survivors.length === count + 1, `the stranger joined (${msg})`);
    check(h.stock.food === 0, `the cost is what the hub has when the choice is made, never below zero (${h.stock.food})`);
    card.choices[0].resolve(st);
    check(st.survivors.length === count + 1, "resolving twice does not add them twice");
  }
  const st2 = W();
  const h2 = hub(st2);
  h2.stock.food = -5; h2.stock.ammo = -20;
  tickHour(st2);
  check(h2.stock.food >= 0 && h2.stock.ammo >= 0, "the hourly safety net lifts negative stock to zero");
  for (const sd of [1, 2, 3]) {
    const s3 = W(sd);
    let neg = 0;
    for (let i = 0; i < 24 * 40; i++) {
      tickHour(s3);
      while (s3.cards.length) { const c = s3.cards.shift(); c.choices[0].resolve(s3); }
      for (const b of s3.bases) for (const v of Object.values(b.stock)) if (!(v >= 0)) neg++;
      if (s3.gameOver) break;
    }
    check(neg === 0, `seed ${sd}: no negative or NaN stock in 40 days of taking every first choice (${neg})`);
  }
}

// 8. Trade-route escorts between trips live at the hub (B-14).
{
  console.log("Waiting escorts");
  const st = W();
  const h = hub(st);
  const ppl = atBase(st, h.id);
  ppl.forEach(plain);
  const e = ppl.find((s) => !s.leader);
  st.routes.push({ id: 777, factionId: st.factions[0].id, escortIds: [e.id], active: true, nextDay: 9999, interval: 5 });
  e.location = { kind: "route", routeId: 777 };
  e.health = 30;
  h.stock.food = 100; h.stock.meds = 20;
  check(residents(st, h.id).includes(e) && !atBase(st, h.id).includes(e), "a waiting escort is a hub resident but not base staff");
  check(near(foodForecast(st, h), farmOutput(st, h) - 6), "the food forecast counts the escort");
  // Nobody farms or scavenges today (no harvest, no finds): the stock drops by six mouths, then spoils a little.
  for (const s of atBase(st, h.id)) s.role = "rest";
  const eat = eatPerDay(st, h);
  check(near(eat / 6, eat / residents(st, h.id).length) && residents(st, h.id).length === 6, `six mouths eat (${eat})`);
  basesDaily(st);
  const left = 100 - eat;
  check(Math.abs(h.stock.food - left * (1 - spoilRate(st, h))) < 0.3, `the hub feeds the escort (${h.stock.food}, expected about ${(left * (1 - spoilRate(st, h))).toFixed(1)})`);
  const hp = e.health;
  for (let i = 0; i < 24; i++) medicalHour(st);
  check(e.health > hp, `the escort heals at the hub (${hp.toFixed(1)} → ${e.health.toFixed(1)})`);
  e.health = 30;
  e.woundTreatedDay = null; // the night's automatic care already treated them today (one wound treatment a day)
  const msg = treatAnywhere(st, e.id);
  check(e.health > 30 && /treated|operated/.test(msg), `the escort can be treated with the hub's meds (${msg})`);
}

// 9. Construction refunds (B-15).
{
  console.log("Construction refunds");
  const st = W();
  const h = hub(st);
  Object.assign(h.stock, { scrap: 100, parts: 10 });
  queueBuild(st, h, "well"); // 15 scrap and 1 part (the ammo bench's cost; that needs a workbench now)
  let job = h.construction[h.construction.length - 1];
  let msg = cancelBuild(st, h, job.id);
  check(h.stock.scrap === 100 && h.stock.parts === 10, `an untouched job refunds everything (${h.stock.scrap} scrap, ${h.stock.parts} parts)`);
  check(/All the materials/.test(msg), `the message says so (${msg})`);
  queueBuild(st, h, "well");
  job = h.construction[h.construction.length - 1];
  job.progress = 3;
  msg = cancelBuild(st, h, job.id);
  check(h.stock.scrap === 100 - 15 + 8 && h.stock.parts === 10 - 1 + 1, `a started job refunds half, rounded up (${h.stock.scrap} scrap, ${h.stock.parts} parts)`);
  check(/Half the materials/.test(msg), `the message says so (${msg})`);
  const s0 = h.stock.scrap;
  msg = cancelBuild(st, h, 123456);
  check(h.stock.scrap === s0 && /gone/.test(msg), `cancelling a missing job changes nothing and says so (${msg})`);
  check(/Mechanics 4\+/.test(canBuild(st, Object.assign(mkOutpost(st, hub(st).tile + 1, { scrap: 100, parts: 10 })), "machine_shop").reason || ""), "a skill gate names the skill properly");
}

// 10. Hospital bonus on meds needs medics (B-12); farm slots go to the best farmers (B-21); Heat (B-24).
{
  console.log("Stations, farm slots, Heat");
  const st = W();
  const h = hub(st);
  const ppl = atBase(st, h.id);
  ppl.forEach((s) => { plain(s); s.role = "farm"; s.skills.medicine = 0; s.skills.farming = 0; s.station = null; });
  const stn = addBuilding(h, "med_station");
  addBuilding(h, "clinic");
  Object.assign(h.stock, { scrap: 100, food: 100 });
  ppl[0].role = "operate"; ppl[0].station = stn.id;
  check(stationStatus(st, h, stn).out.meds === 1, `an unstaffed clinic adds nothing to the med station (${stationStatus(st, h, stn).out.meds})`);
  ppl[1].role = "medic"; ppl[2].role = "medic";
  check(stationStatus(st, h, stn).out.meds === 2, `a staffed clinic adds +1 (${stationStatus(st, h, stn).out.meds})`);

  ppl.forEach((s) => { s.role = "farm"; s.station = null; });
  const base = careToday(st, h);
  ppl[5].skills.farming = 20; // the expert is last in the list: the best farmers tend first (farming.js)
  const after = careToday(st, h);
  check(after.avgSkill > base.avgSkill && after.care > base.care, `the best farmer counts for the crop care (${base.care.toFixed(2)} → ${after.care.toFixed(2)})`);

  ppl.forEach((s) => { s.role = "guard"; s.station = null; });
  const quiet = baseHeat(st, h);
  ppl.forEach((s) => (s.role = "operate"));
  assignStations(st, h);
  const manned = stations(h).filter((x) => ppl.some((s) => s.station === x.id)).length;
  check(baseHeat(st, h) === quiet + manned * 3, `only operators with a station add Heat (${quiet} → ${baseHeat(st, h)}, ${manned} stations manned by 6 on Operate)`);
}

// 11. Kits: one rule at a base, in the field and in battle (B-27).
{
  console.log("Med kits");
  const st = W();
  const h = hub(st);
  const ppl = atBase(st, h.id);
  ppl.forEach((s) => { plain(s); s.skills.medicine = 0; s.gear.tool = null; });
  const m = ppl[0];
  m.skills.medicine = 2;
  m.gear.tool = newItem("surgkit");
  check(medKitBonus(m) === 0, "a surgical kit does nothing below Medicine 3");
  m.skills.medicine = 10;
  check(medKitBonus(m) === GEAR.surgkit.medKit, `full bonus at Medicine 10 (+${medKitBonus(m)})`);
  m.skills.medicine = 5;
  const part = medKitBonus(m);
  check(part > 0 && part < GEAR.surgkit.medKit, `a partial bonus in between (+${part})`);
  m.gear.tool = newItem("bandagekit");
  check(medKitBonus(m) === GEAR.bandagekit.medKit, "the bandage kit gives its bonus to anyone");
  // Base and field read the same number.
  h.stock.meds = 10;
  const patient = ppl[1];
  patient.health = 40;
  const withKit = treatAtBaseInfo(st, h, patient).heal;
  m.gear.tool = null;
  const without = treatAtBaseInfo(st, h, patient).heal;
  check(withKit > without, `a kit helps at a base too (+${without} → +${withKit})`);
  m.gear.tool = newItem("bandagekit");
  const dur = m.gear.tool.dur;
  treatAtBase(st, h, patient.id);
  check(m.gear.tool && m.gear.tool.dur === dur - 1, "a treatment at a base uses the bandage kit a little");
  const party = { id: 999, members: [m.id, patient.id], supplies: { meds: 5 }, cargo: { supplies: {}, gear: [] } };
  m.location = patient.location = { kind: "party", partyId: 999 };
  patient.health = 40;
  const fi = fieldTreatInfo(st, party, patient);
  check(fi.medic === m && fi.heal === Math.round(8 + (skill(m, "medicine") + medKitBonus(m)) * 0.6), `the field uses the same bonus (+${fi.heal})`);
}

// 12. Armor condition (B-16), recipe texts and traits (B-17).
{
  console.log("Armor condition, texts, traits");
  const st = W();
  const s = plain(atBase(st, hub(st).id)[0]);
  for (const k of ["armor", "head", "arms", "legs"]) s.gear[k] = null;
  s.gear.armor = makeItem("scrapvest", 1);
  const full = armorPower(s), fullMult = armorMult(s);
  s.gear.armor = makeItem("scrapvest", 0.6);
  check(armorPower(s) < full && armorPower(s) > full * 0.6, `armor at 60% protects less, but still protects (${full} → ${armorPower(s).toFixed(2)})`);
  check(armorMult(s) > fullMult, "damage taken goes up with worn armor");
  for (const key of Object.keys(CRAFTS)) {
    const r = CRAFTS[key];
    if (!r.gear) continue;
    const d = GEAR[r.gear], text = craftOutputText(key);
    if (d.slot === "weapon") check(/power/.test(text), `${key}: a weapon lists its power (${text})`);
    else if (d.slot === "backpack") check(/pack slots/.test(text) && /carry/.test(text) && !/power/.test(text), `${key}: a pack lists slots and carry space (${text})`);
    else if (d.slot === "tool") check(!/power/.test(text) && /Medicine|Scavenging|water|at night/.test(text), `${key}: a tool lists what it does (${text})`);
    // The stealth kit (stealth.js): thrown things and the suppressor are carried, not worn.
    else if (d.throw) check(!/power|armor/.test(text) && /thrown/.test(text) && /one use/.test(text), `${key}: a throwable says it is thrown, once (${text})`);
    else if (d.suppressor) check(!/power|armor/.test(text) && /halves the noise/.test(text) && /shots/.test(text), `${key}: the suppressor says what it does and how long it lasts (${text})`);
    else if (d.siege) check(!/power|armor/.test(text) && /wall|gate/.test(text), `${key}: siege kit says what it is for (${text})`); // sim/siege.js
    else if (d.cat === "gunmod") check(!/power|armor/.test(text) && /gun attachment/.test(text) && /fits/.test(text), `${key}: a gun attachment says what it does and what it fits (${text})`); // sim/gunmods.js
    else if (d.slot === "cargo") check(!/power|armor/.test(text) && /bike/.test(text), `${key}: a bicycle says it is a bike for the base (${text})`); // sim/vehicles.js
    // Camp kit against Heat (fieldheat.js) and a base's defence kit (defences.js): carried or kept, not worn.
    else if (d.heat) check(!/power|armor/.test(text) && /Heat ×/.test(text), `${key}: camp kit says how much less Heat (${text})`);
    else if (d.defence) check(!/power|armor/.test(text) && /alarm/.test(text), `${key}: an alarm says what it does (${text})`);
    else if (r.gear === "dewormer") check(!/power|armor/.test(text) && /worm/.test(text) && /one use/.test(text), `${key}: the dewormer says what it cures (${text})`); // sim/worm.js
    else if (LIGHTS[r.gear]) check(!/power|armor/.test(text) && /at night sees \d+ tiles/.test(text), `${key}: a light says how far it sees at night (${text})`); // sim/lights.js (a headlamp is carried, not held)
    else if (r.gear === "puritabs") check(!/power|armor/.test(text) && /10 un-purified water safe/.test(text) && /lasts 10 tablets/.test(text), `${key}: the tablets say what one treats and how many there are (${text})`); // sim/worm.js
    else if (d.fish) check(!/power|armor/.test(text) && /food an hour/.test(text) && /days of fishing/.test(text), `${key}: fishing gear says what it catches and how long it lasts (${text})`); // sim/hunting.js
    else check(/armor/.test(text) && !/power/.test(text), `${key}: armor lists its armor value (${text})`);
  }
  const h = hub(st);
  const ppl = atBase(st, h.id);
  ppl.forEach((x) => { plain(x); x.role = "guard"; });
  ppl[0].role = "scavenge";
  const a = scavengeOutput(st, h).scrap;
  ppl[0].traits = ["greedy"];
  check(near(scavengeOutput(st, h).scrap, a * GREEDY_SCAV), "Greedy finds more when scavenging around a base");
  check(!/pockets/.test(TRAITS.greedy.desc) && !/\+2 stealth/.test(TRAITS.nightowl.desc) && !/[+-]2 to combat/.test(TRAITS.brave.desc + TRAITS.coward.desc), "trait texts match what the code does");
  const b0 = combatPower(plain(ppl[1]));
  ppl[1].traits = ["brave"];
  check(near(combatPower(ppl[1]), b0 + 1 * (0.5 + ppl[1].health / 200)), "Brave is +1 fighting strength, as its text says");
  // What enemy leftovers are called.
  const battle = { bodies: [{ name: "Raider 1", kind: "human", supplies: { ammo: 4 }, gear: {}, pockets: [] }], tileId: h.tile + 2, setup: { enemy: { kind: "raiders", name: "Red Hand raiders" } } };
  leaveBodies(st, battle);
  const site = st.deathSites.find((d) => d.tile === h.tile + 2);
  const zb = { bodies: [{ name: "Zombie 1", kind: "zombie", supplies: { ammo: 2 }, gear: {}, pockets: [] }], tileId: h.tile + 3, setup: { enemy: { kind: "zombies", name: "the dead" } } };
  leaveBodies(st, zb);
  check((st.deathSites.find((d) => d.tile === h.tile + 3) || { names: [] }).names[0] === "The dead", "zombie leftovers are just \"The dead\"");
  check(site && site.names[0] === "Red Hand raiders' dead", `enemy leftovers have a readable name (${site && site.names[0]})`);
}

// 13. Crew carried into a rebuilt world keeps traits and skill budget (B-18); starting roles (P-24); names (B-29).
{
  console.log("New run: crew, roles, names");
  const a = W(seed);
  a.survivors[2].skills.shooting = Math.max(0, a.survivors[2].skills.shooting - 3); // three points back in the pool
  const snap = a.survivors.map((s) => ({ name: s.name, skills: { ...s.skills }, traits: [...s.traits], budget: skillTotal(s.skills) + (s === a.survivors[2] ? 3 : 0), appearance: { ...s.appearance }, leader: !!s.leader }));
  const b = W(seed + 1, { crew: snap });
  check(b.survivors.slice(0, 6).every((s, i) => s.traits.join() === a.survivors[i].traits.join()), "traits are kept when the seed changes");
  check(b.survivors[2].skillBudget === snap[2].budget && b.survivors[2].skillBudget - skillTotal(b.survivors[2].skills) === 3, "unspent skill points are kept");
  const c = createWorld({ seed, factionCount: 9, crew: snap });
  check(c.survivors.slice(0, 6).every((s, i) => s.traits.join() === a.survivors[i].traits.join()), "traits are kept when the group count changes");
  check(W(77).rng.state === W(77, { crew: snap }).rng.state, "the crew override leaves the world's rng alone");

  let dupFirst = 0, operators = 0, badFarm = 0, noLeader = 0;
  for (let sd = 1; sd <= 300; sd++) {
    const st = W(sd);
    const firsts = st.survivors.map((s) => firstOf(s.name));
    if (new Set(firsts).size < firsts.length) dupFirst++;
    if (st.survivors.some((s) => s.role === "operate")) operators++;
    const farmers = st.survivors.filter((s) => s.role === "farm");
    const bestFarm = Math.max(...st.survivors.map((s) => skill(s, "farming")));
    if (farmers.length < 2 || !farmers.some((s) => skill(s, "farming") === bestFarm)) badFarm++;
    if (st.survivors.filter((s) => s.leader).length !== 1) noLeader++;
  }
  check(dupFirst === 0, `no two of the starting six share a first name over 300 seeds (${dupFirst})`);
  check(operators === 0, `nobody starts on the ammo bench (${operators})`);
  check(badFarm === 0, `the best farmer always starts on the farm (${badFarm})`);
  check(noLeader === 0, "exactly one leader at the start");
  const st = W();
  const roles = st.survivors.map((s) => s.role).sort().join(",");
  check(roles === "build,build,farm,farm,guard,scavenge", `starting roles: ${roles}`); // two builders: the hub starts bare (barestart)
  const best = (key) => st.survivors.reduce((x, s) => (skill(s, key) > skill(x, key) ? s : x));
  check(best("farming").role === "farm", "the best farmer farms");
  st.survivors.forEach((s) => { s.skills.mechanics = 0; s.skills.farming = 0; });
  st.survivors[5].skills.mechanics = 15;
  assignStartingRoles(st);
  check(st.survivors[5].role === "build", "roles follow skills edited before the run begins");
  // Recruits.
  const names = st.survivors.map((s) => s.name);
  for (let i = 0; i < FIRST_NAMES.length - 6; i++) { const s = makeSurvivor(st, 1); s.location = { kind: "base", baseId: hub(st).id }; st.survivors.push(s); names.push(s.name); }
  check(new Set(names.map(firstOf)).size === names.length, `recruits get first names nobody has while any are free (${names.length} people)`);
  for (let i = 0; i < 40; i++) { const s = makeSurvivor(st, 1); s.location = { kind: "base", baseId: hub(st).id }; st.survivors.push(s); names.push(s.name); }
  check(new Set(names).size === names.length, `no full name twice even past ${FIRST_NAMES.length} people (${names.length})`);
  // Renaming.
  const [p, q] = st.survivors;
  const old = p.name;
  check(renameSurvivor(st, p, q.name) !== "" && p.name === old, "renaming to someone else's full name is refused");
  check(renameSurvivor(st, p, "   ") !== "" && p.name === old, "an empty name is refused");
  check(renameSurvivor(st, p, "  Zed   Zedson ") === "" && p.name === "Zed Zedson", "a new name is trimmed and set");
  const rng = new Rng(5);
  const taken = ["Maria Chen", "James Hale"];
  let clash = 0;
  for (let i = 0; i < 200; i++) if (["Maria", "James"].includes(firstOf(randomName(rng, taken)))) clash++;
  check(clash === 0, "the new-run name randomizer avoids first names already taken");
}

// 14. Small things: fuel message (B-30), scavenger injuries are logged (P-22), craft refund rounding.
{
  console.log("Messages");
  const st = W();
  const h = hub(st);
  const v = st.vehicles[0];
  v.fuel = tank(v) - 12.6;
  h.stock.fuel = 50;
  const msg = refuel(st, h, v);
  check(/Added 12\.6 fuel/.test(msg) && near(v.fuel, tank(v)), `the refuel message is rounded (${msg})`);
  const ppl = atBase(st, h.id);
  ppl.forEach((s) => (s.role = "scavenge"));
  h.stock.food = 9999;
  let n = 0;
  // Scavenging around a base brings cuts and sprains (health.js), logged with where it happened.
  while (!logHas(st, /scavenging around the base at/) && n++ < 300) { ppl.forEach((s) => { if (s.alive) { s.health = 100; s.conditions = []; } }); h.stock.water = 80; basesDaily(st); st.cards.length = 0; }
  check(logHas(st, /got a (deep cut|sprain) scavenging around the base at /), "a scavenging injury is logged");
  Object.assign(h.stock, { scrap: 50, meds: 5 });
  ppl.forEach((s) => (s.skills.medicine = 5));
  queueCraft(st, h, "bandagekit");
  const job = h.crafting[h.crafting.length - 1];
  job.progress = 1;
  cancelCraft(st, h, job.id);
  check(h.stock.meds === 5, `a started craft job gives back half, rounded up (${h.stock.meds} meds)`);
}

// 15. A hands-off month on a few seeds: no crash, one leader or a card, nobody alive ⇒ game over.
{
  console.log(`Hands-off campaign (${[seed, seed + 1, seed + 2].join(", ")})`);
  for (const sd of [seed, seed + 1, seed + 2]) {
    const st = W(sd);
    let bad = "";
    for (let i = 0; i < 24 * 45 && !st.gameOver && !bad; i++) {
      tickHour(st);
      while (st.cards.length) {
        const c = st.cards.shift();
        const ch = c.choices.find((x) => !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled));
        if (ch) ch.resolve(st);
      }
      if (leaders(st).length > 1) bad = "two leaders";
      if (st.survivors.some((s) => !s.alive && s.leader)) bad = "a dead leader";
      if (!alive(st).length && !st.gameOver) bad = "nobody alive but the run goes on";
      if (st.deathSites.some((d) => st.bases.some((b) => b.tile === d.tile) && d.names.some((nm) => st.survivors.some((s) => s.name === nm)))) bad = "a survivor's death site on a base tile";
      for (const b of st.bases) for (const [k, v] of Object.entries(b.stock)) if (!(v >= 0)) bad = `${b.name} ${k} = ${v}`;
    }
    check(!bad, `seed ${sd}: ${bad || "clean"}`);
  }
}

console.log(`\n${passes} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
