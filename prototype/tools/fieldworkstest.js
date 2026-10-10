// Field works (src/sim/fieldworks.js; the base window's Field works tab in src/ui/fieldworks.js): scripted cases on one
// seed. Usage: node tools/fieldworkstest.js [seed]  (a few seconds)
// - placing: the rules (the base's land within 3 tiles, not the base, water, a hive or a group's base; roadblocks on
//   roads; wells not on rock; the base's cap; the materials and the skill), the materials taken, the site and its job
// - building: the builders walk out (the hours include the walk), sharing their hours with the base's own queue;
//   a tower stands
// - the tower: unmanned it shows nothing; one lookout posted (out of the base: not atBase, still a resident) shows
//   3 tiles round it by day, 1 at night, dark 22:00–06:00 alone, round the clock with two; recall brings them home
// - lookouts warn the base (watch.js lookoutsSpot) of a raid in the tower's sight
// - a stockpile: deposits up to its room, Leave finds / Load orders, a haul team brings it home
// - a roadblock holds a raiding party (progress back, the roadblock takes the damage) and a horde (h.move back)
// - a horde batters and destroys a structure; the lookouts flee a falling tower
// - a group's raid on a structure: drives it off with lookouts, or takes it over; your team takes it back (fwork)
// - repairs: materials by kind and damage, the walk, refused when short, Repair all; the needs-repair band
// - a field well's water in waterProduction (field) and drawn down; a relay mast links into radioNodes
// - the groups build their own (groupFieldDaily); their towers add to their defence; the governor plans a well
//   when water runs short and repairs; save/load round-trips everything (posted people included); an older save
//   with no state.fieldworks loads and runs
import { createWorld, tickHour, hub, atBase, residents, newId, liveTiles, baseVision, day } from "../src/sim/world.js";
import { launchExpedition, partyTile, carried, outpostName, spawnAiParty } from "../src/sim/parties.js";
import { queueOrder, startOrder } from "../src/sim/orders.js";
import { makeHorde } from "../src/sim/hordes.js";
import { recomputeOwnership } from "../src/sim/factions.js";
import { radioNodes } from "../src/sim/radio.js";
import { waterProduction } from "../src/sim/economy.js";
import { lookoutsSpot } from "../src/sim/watch.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import * as FW from "../src/sim/fieldworks.js";
import { wellYield } from "../src/sim/claims.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 7 });
  state.started = true;
  state.autoCombat = true;
  state.noWanderers = true;
  Object.assign(hub(state).stock, { food: 300, water: 300, fuel: 100, meds: 20, ammo: 300, parts: 10, scrap: 200, wood: 2000 });
  for (const f of state.factions) f.goodwill = Math.max(f.goodwill, 0); // nobody raids the tests by chance
  return state;
}
const dropEvents = (state) => { for (let i = state.cards.length - 1; i >= 0; i--) if (!state.cards[i].isOrders) state.cards.splice(i, 1); };
function tick(state, n, until, keepHordes = false) {
  for (let i = 0; i < n; i++) {
    if (!keepHordes) state.hordes.length = 0;
    tickHour(state);
    if (state.combat) state.combat = null;
    dropEvents(state);
    if (until && until()) return true;
  }
  return !until;
}
const toHour = (state, h) => { while (state.hour % 24 !== h) tick(state, 1); };
// The hub's builders: two people on the Build job.
function builders(state, n = 2) {
  const ppl = atBase(state, hub(state).id);
  for (const s of ppl.slice(0, n)) s.role = "build";
  return ppl.slice(0, n);
}
// A tile of the hub's land at distance d that can take this kind.
const spot = (state, kind, d = 2, extra = () => true) => FW.placeTiles(state, hub(state), kind).find((x) => !x.why && state.grid.distance(hub(state).tile, x.tile) === d && extra(x.tile));
// A structure finished at once (its job done): for the cases that do not test building.
function standing(state, kind, d = 2, extra) {
  const at = spot(state, kind, d, extra) || spot(state, kind, 1, extra) || spot(state, kind, 3, extra);
  if (!at) return null;
  const r = FW.planFieldWork(state, hub(state), kind, at.tile);
  const job = FW.jobFor(state, r.fw);
  job.progress = job.hours;
  builders(state, 1);
  FW.fieldBuildHour(state, hub(state)); // finishes it (the base queue is empty)
  return r.fw;
}

// ---------------------------------------------------------------------------------------------------------
section("Placing: the rules, the materials, the site");
{
  const state = mk();
  const h = hub(state);
  check(/outside the base/.test(FW.placeProblem(state, h, "tower", h.tile)), "not on the base's own tile");
  const water = state.grid.within(h.tile, 3).find((id) => state.tiles[id].terrain === "water");
  if (water != null) check(/water/i.test(FW.placeProblem(state, h, "tower", water)), "not on open water");
  const far = state.tiles.find((t) => state.grid.distance(t.id, h.tile) === 6 && t.terrain !== "water");
  check(/Too far|land you hold/.test(FW.placeProblem(state, h, "tower", far.id)), `far away: "${FW.placeProblem(state, h, "tower", far.id)}"`);
  const notMine = state.grid.within(h.tile, 3).find((id) => state.grid.distance(id, h.tile) === 3 && state.tiles[id].terrain !== "water" && state.tiles[id].owner !== "player");
  if (notMine != null) check(/land you hold/.test(FW.placeProblem(state, h, "tower", notMine)), "beyond the base's ground (3 tiles from the hub, no claim): refused");
  const offRoad = FW.placeTiles(state, h, "roadblock").find((x) => !state.tiles[x.tile].road);
  if (offRoad) check(/road tile/.test(offRoad.why), "a roadblock off the road: refused");
  const tiles = FW.placeTiles(state, h, "tower");
  check(tiles.length >= 6 && tiles.every((x) => state.grid.distance(x.tile, h.tile) <= 2), `the hub's ground: ${tiles.length} tiles within 2 (recomputeOwnership)`);
  const at = spot(state, "tower");
  const scrap0 = h.stock.scrap, wood0 = h.stock.wood;
  const r = FW.planFieldWork(state, h, "tower", at.tile);
  check(!r.error && h.stock.scrap === scrap0 - 15 && h.stock.wood === wood0 - 120, `tower planned: 15 scrap and 120 firewood taken (${r.text || r.error})`);
  check(r.fw && !r.fw.built && FW.fwAt(state, at.tile) === r.fw && /already/.test(FW.placeProblem(state, h, "well", at.tile)), "the site stands on the tile; the tile is taken");
  const job = FW.jobFor(state, r.fw);
  check(job && job.hours === 18 + FW.walkHours(state, h, at.tile, 18), `the job: 18 work-hours + the walk (${job && job.hours} h)`);
  // Cancel untouched: everything back, the site gone.
  const msg = FW.cancelFieldJob(state, job.id);
  check(h.stock.scrap === scrap0 && !FW.fwAt(state, at.tile) && /All the materials/.test(msg), `cancelled untouched: all back (${msg})`);
  // Short of materials: refused.
  h.stock.parts = 0;
  const rt = spot(state, "relay");
  if (rt) check(/Needs 3 parts|Mechanics/.test(FW.placeProblem(state, h, "relay", rt.tile)), `relay with no parts: "${FW.placeProblem(state, h, "relay", rt.tile)}"`);
  h.stock.parts = 10;
  // The cap.
  const cap = FW.maxWorks(h);
  for (const x of FW.placeTiles(state, h, "stockpile").filter((y) => !y.why).slice(0, cap)) FW.planFieldWork(state, h, "stockpile", x.tile);
  const more = FW.placeTiles(state, h, "stockpile").find((y) => !FW.fwAt(state, y.tile));
  check(FW.playerWorks(state, h).length === cap && more && /all the field works/.test(FW.placeProblem(state, h, "stockpile", more.tile)), `the cap: ${cap} at the hub`);
}

// ---------------------------------------------------------------------------------------------------------
section("Building: the builders go out, the walk counts, the base queue shares their hours");
{
  const state = mk();
  const h = hub(state);
  builders(state, 2);
  const at = spot(state, "tower", 2);
  const r = FW.planFieldWork(state, h, "tower", at.tile);
  const job = FW.jobFor(state, r.fw);
  const ok = tick(state, 60, () => r.fw.built);
  check(ok && r.fw.built && r.fw.hp === r.fw.max, `the tower stands after ${state.hour} hours (${job.hours} work-hours with two builders)`);
  check(state.log.some((l) => /Watch tower finished/.test(l.text)), "a log line says so");
  // With a base job queued too: every other hour each.
  const at2 = spot(state, "stockpile", 1);
  const r2 = FW.planFieldWork(state, h, "stockpile", at2.tile);
  h.construction.push({ id: newId(), type: "farm_plot", progress: 0, hours: 100 });
  const j2 = FW.jobFor(state, r2.fw);
  tick(state, 10);
  check(j2.progress > 0 && h.construction[0].progress > 0, `shared: field job ${j2.progress.toFixed(1)} h, base job ${h.construction[0].progress.toFixed(1)} h after 10 hours`);
}

// ---------------------------------------------------------------------------------------------------------
section("The tower: unmanned it sees nothing; lookouts are out of the base and show the map round it");
{
  const state = mk();
  const h = hub(state);
  // A tower 2 tiles out, with a tile 3 beyond it that the hub does not see.
  const fw = standing(state, "tower", 2, (id) => state.grid.within(id, 3).some((x) => state.grid.distance(x, h.tile) > baseVision(h)));
  check(!!fw && fw.built, "a tower stands");
  toHour(state, 12);
  const beyond = state.grid.within(fw.tile, 3).find((x) => state.grid.distance(x, h.tile) > baseVision(h) && !state.bases.some((b) => state.grid.distance(b.tile, x) <= baseVision(b)));
  check(beyond != null && !liveTiles(state).has(beyond), "unmanned: a tile 3 from it beyond the hub's view is not live");
  const s = atBase(state, h.id).find((x) => !x.leader);
  const res = FW.postPerson(state, fw.id, s.id);
  check(!res.error && s.location.kind === "post" && !atBase(state, h.id).includes(s) && residents(state, h.id).includes(s) && FW.outOfBase(s), `posted: out of the base, still fed there (${res.text || res.error})`);
  check(liveTiles(state).has(beyond) && FW.manned(state, fw), "manned by day: that tile is live");
  toHour(state, 23);
  check(!FW.manned(state, fw) && !liveTiles(state).has(beyond), "one lookout alone sleeps at 23:00: the tower is dark");
  const s2 = atBase(state, h.id).find((x) => !x.leader && x !== s);
  FW.postPerson(state, fw.id, s2.id);
  const night = state.grid.within(fw.tile, 1).find((x) => state.grid.distance(x, h.tile) > 1);
  check(FW.manned(state, fw) && liveTiles(state).has(night) && !liveTiles(state).has(beyond), "two take turns: manned at night, 1 tile round it");
  check(/2 at most|holds 2/.test(FW.postProblem(state, fw, atBase(state, h.id)[0]) || ""), `a third: "${FW.postProblem(state, fw, atBase(state, h.id)[0])}"`);
  // The lookouts warn the base of a raid in their sight (watch.js lookoutsSpot), even beyond the usual range.
  toHour(state, 12);
  const warnAt = state.grid.within(fw.tile, 3).find((x) => state.grid.distance(x, h.tile) >= 4);
  if (warnAt != null) check(lookoutsSpot(state, h, warnAt, 2) === true, "lookoutsSpot: the tower sees a raid 4+ tiles out");
  tick(state, 3);
  check(s.location.kind === "post" && fw.garrison.length === 2, "they stay posted hour after hour");
  const line = FW.recallPerson(state, s.id);
  check(s.location.kind === "base" && atBase(state, h.id).includes(s) && /back at/.test(line), `recalled: ${line}`);
}

// ---------------------------------------------------------------------------------------------------------
section("Stockpile: deposits, a team's Leave finds and Load, the haul team");
{
  const state = mk();
  const h = hub(state);
  const fw = standing(state, "stockpile", 2);
  check(!!fw && fw.built, "a stockpile stands");
  const got = FW.depositAt(state, fw, "scrap", 40);
  check(got === 40 && fw.contents.scrap === 40 && FW.stockKg(fw) === 80, `40 scrap left there (80 kg): ${got}`);
  const big = FW.depositAt(state, fw, "scrap", 200);
  check(big === 60 && FW.stockRoom(fw) < 1, `only its room: 60 more (200 kg cap): ${big}`);
  const drops = FW.dropPointsFor(state, h);
  check(drops.length === 1 && drops[0].fw === fw && drops[0].room < 1, "dropPointsFor lists it with its room");
  fw.contents = { scrap: 30, wood: 300 };
  const scrap0 = h.stock.scrap, wood0 = h.stock.wood;
  const r = FW.sendHaul(state, fw.id);
  check(!r.error && r.party, `a haul team goes out (${r.text || r.error})`);
  const p = r.party;
  const home = tick(state, 72, () => !state.parties.includes(p));
  check(home && !Object.keys(fw.contents).length, `back home, the stockpile empty (${JSON.stringify(fw.contents)})`);
  check(h.stock.scrap >= scrap0 + 30 && h.stock.wood >= wood0 + 300 - 60, `the goods are in the hub's stores (scrap ${scrap0} → ${h.stock.scrap}, wood ${wood0} → ${Math.round(h.stock.wood)})`);
  // A team leaves its finds there, keeping its food, water, meds and ammo.
  const ids = atBase(state, h.id).slice(0, 1).map((s) => s.id);
  const lr = launchExpedition(state, { memberIds: ids, dest: fw.tile, mission: "move", stance: "normal", supplies: { food: 5, water: 5, scrap: 6, parts: 1 } });
  if (lr.error) console.log("  launch:", lr.error);
  const t = lr.party;
  tick(state, 48, () => t.phase === "waiting" && partyTile(t) === fw.tile);
  const msg = startOrder(state, t, { type: "fwork", act: "unload" });
  tick(state, 3, () => t.phase === "waiting");
  check(fw.contents.scrap === 6 && fw.contents.parts === 1 && carried(t, "food") > 0 && carried(t, "scrap") === 0, `Leave finds: scrap and parts left, food kept (${msg}; ${FW.contentsText(fw)})`);
  startOrder(state, t, { type: "fwork", act: "load" });
  tick(state, 3, () => t.phase === "waiting");
  check(!Object.keys(fw.contents).length && carried(t, "scrap") === 6, "Load: all of it back into the team's cargo");
}

// ---------------------------------------------------------------------------------------------------------
section("The job trips' plug-in points (installTripHooks)");
{
  const state = mk();
  const h = hub(state);
  const pile = standing(state, "stockpile", 2);
  const well = standing(state, "well", 2, (id) => FW.placeProblem(state, h, "well", id) === "" && id !== pile.tile);
  const hooks = { water: null, deposit: null };
  FW.installTripHooks(hooks);
  check(FW.FIELD.PASSIVE_WELLS === false, "installed: the wells no longer count by themselves (the carriers bring their water)");
  const list = hooks.water(state, h, "water", [{ id: -1, d: 9 }]);
  check(list.some((x) => x.well && x.id === well.tile) && list[list.length - 1].id === -1, "Fetch water: the well joins the sources, nearest first");
  check(!hooks.water(state, h, "fish", []).length, "fishers get no wells");
  const far = state.grid.within(pile.tile, 1).find((id) => state.grid.distance(id, h.tile) > state.grid.distance(pile.tile, h.tile) - 0 && id !== pile.tile && state.grid.distance(id, pile.tile) < state.grid.distance(id, h.tile));
  const dp = hooks.deposit(state, h, { trip: { at: far } }, "wood");
  check(dp && dp.tile === pile.tile && dp.stock === pile.contents, "a worker out past the stockpile drops the load there");
  check(hooks.deposit(state, h, { trip: { at: h.tile } }, "wood") == null, "one at the base's own tile goes home");
  FW.FIELD.PASSIVE_WELLS = true;
}

section("Roadblocks hold raiders and hordes");
{
  const state = mk();
  const h = hub(state);
  const fw = standing(state, "roadblock", 2) || standing(state, "roadblock", 1);
  if (!check(!!fw, "a road tile in the hub's land for a roadblock")) { /* map without one */ } else {
    const f = state.factions.find((x) => x.alive && x.bases.length);
    f.goodwill = -60;
    const p = spawnAiParty(state, f, "raid", f.bases[0], h.tile, { strength: 12, target: { kind: "player", baseId: h.id } });
    // Put it just before the roadblock on a path through it.
    const nb = state.grid.neighbors(fw.tile).find((id) => state.tiles[id].terrain !== "water" && id !== h.tile);
    p.path = [nb, fw.tile, h.tile]; p.idx = 0; p.progress = 0;
    const hp0 = fw.hp;
    FW.partyEnter(state, p, fw.tile);
    check(p.progress < -1 && fw.hp < hp0 && FW.fwById(state, fw.id), `a raid held ${(-p.progress).toFixed(1)} hours; roadblock ${hp0} → ${fw.hp}`);
    state.parties.splice(state.parties.indexOf(p), 1);
    fw.hp = fw.max;
    const ho = makeHorde(state, { tile: fw.tile, size: 40, role: "roam" });
    ho.move = 0;
    FW.hordeEnter(state, ho);
    check(ho.move < 0 && fw.hp < fw.max, `a horde of 40 held ${(-ho.move).toFixed(1)} hours; roadblock at ${fw.hp}`);
    // A friendly party passes.
    f.goodwill = 50;
    const q = spawnAiParty(state, f, "caravan", f.bases[0], h.tile, { strength: 5 });
    q.progress = 0;
    const hp1 = fw.hp;
    FW.partyEnter(state, q, fw.tile);
    check(q.progress === 0 && fw.hp === hp1, "a friendly caravan passes untouched");
  }
}

// ---------------------------------------------------------------------------------------------------------
section("Hordes batter and destroy; the lookouts flee a falling tower");
{
  const state = mk();
  const h = hub(state);
  const fw = standing(state, "tower", 2);
  const s = atBase(state, h.id).find((x) => !x.leader);
  FW.postPerson(state, fw.id, s.id);
  const small = makeHorde(state, { tile: fw.tile, size: 12, role: "roam" });
  FW.hordeEnter(state, small);
  check(FW.fwById(state, fw.id) && fw.hp < fw.max && FW.damageBand(fw) !== undefined, `a small horde damages it (${fw.hp}/${fw.max}), the lookout shoots (${12 - small.size} down)`);
  // A big horde through hordesHour: it walks onto the tile and the tower falls.
  state.hordes.length = 0;
  const nb = state.grid.neighbors(fw.tile).find((id) => state.tiles[id].terrain !== "water" && !state.bases.some((b) => b.tile === id));
  const big = makeHorde(state, { tile: nb, size: 220, role: "roam" });
  big.target = fw.tile; big.move = 11.5;
  tick(state, 2, () => !FW.fwById(state, fw.id), true);
  check(!FW.fwById(state, fw.id), "a horde of 220 destroys the tower");
  check(s.location.kind !== "post" && (s.alive ? s.location.kind === "base" : true), `the lookout fled (${s.alive ? `home, health ${Math.round(s.health)}` : "killed"})`);
  check(state.fieldworks.news.some((n) => /destroyed/.test(n.text)) && state.fieldworks.news.some((n) => /fled/.test(n.text)), "news lines: fled, destroyed (the alerts read them)");
  // A site going up is set back, not destroyed.
  const at = spot(state, "stockpile", 1);
  const r = FW.planFieldWork(state, h, "stockpile", at.tile);
  FW.jobFor(state, r.fw).progress = 6;
  FW.hordeEnter(state, makeHorde(state, { tile: at.tile, size: 80 }));
  check(FW.fwById(state, r.fw.id) && FW.jobFor(state, r.fw).progress === 3, "a site going up loses half its work");
}

// ---------------------------------------------------------------------------------------------------------
section("A group's raid on a field work: driven off, or taken over; your team takes it back");
{
  const state = mk();
  const h = hub(state);
  const f = state.factions.find((x) => x.alive && x.bases.length);
  f.goodwill = -60;
  f.known = true;
  // Driven off: two good lookouts against a weak raid.
  const tower = standing(state, "tower", 2);
  for (const s of atBase(state, h.id).filter((x) => !x.leader).slice(0, 2)) { s.health = 100; FW.postPerson(state, tower.id, s.id); }
  const weak = FW.sendFieldRaid(state, f, tower, 0.6);
  weak.idx = weak.path.length - 1;
  const rolls = [];
  FW.fieldRaidArrive(state, weak);
  check(!state.parties.includes(weak), "the raid party is gone after it arrives");
  check(tower.owner === "player" && FW.fwById(state, tower.id), `a weak raid is driven off (owner ${tower.owner})`);
  // Taken over: nobody there, near their land (the rule's numbers opened up for the test).
  const keep = { ...FW.FIELD.RAID };
  FW.FIELD.RAID.near = 999; FW.FIELD.RAID.capture = 1;
  const pile = standing(state, "stockpile", 2);
  pile.contents = { scrap: 20 };
  const fs0 = f.stock.scrap || 0;
  const p = FW.sendFieldRaid(state, f, pile, 10);
  check(!!p && p.kind === "fwraid", "a raid party sets out for the stockpile");
  const done = tick(state, 24 * 6, () => !state.parties.includes(p) || pile.owner !== "player");
  Object.assign(FW.FIELD.RAID, keep);
  check(done && pile.owner === f.id && !Object.keys(pile.contents).length && state.fieldworks.news.some((n) => /emptied the stockpile .*20 scrap/.test(n.text)), `they took it over and its goods (owner ${pile.owner}, their scrap ${fs0} → ${f.stock.scrap})`);
  check(state.fieldworks.news.some((n) => /took/.test(n.text)), "news: they took it");
  // Your team takes it back (Capture order).
  pile.gar = 0;
  const ids = atBase(state, h.id).filter((x) => x.location.kind === "base").slice(0, 2).map((s) => s.id);
  const t = launchExpedition(state, { memberIds: ids, dest: pile.tile, mission: "move", stance: "normal", supplies: { food: 5, water: 5 } }).party;
  tick(state, 48, () => t.phase === "waiting" && partyTile(t) === pile.tile);
  const acts = FW.teamActs(state, t, pile.tile).map((a) => a.act);
  check(acts.includes("capture") && acts.includes("destroy"), `the team's menu there: ${acts.join(", ")}`);
  startOrder(state, t, { type: "fwork", act: "capture" });
  tick(state, 6, () => pile.owner === "player");
  check(pile.owner === "player" && pile.baseId === h.id, "taken back: yours again, held from the hub");
  // A group's tower with guards: wrecked by a strong team (the fight by the numbers).
  const gt = state.grid.within(f.bases[0], 2).find((id) => id !== f.bases[0] && state.tiles[id].terrain !== "water" && !FW.fwAt(state, id));
  const theirs = FW.buildGroupWork(state, f, "tower", gt, true);
  check(theirs.gar === FW.FIELD.AI.gar && FW.teamActs(state, t, gt).some((a) => /on guard/.test(a.label)), "their tower has guards (the menu says a fight)");
}

// ---------------------------------------------------------------------------------------------------------
section("Repairs: materials by kind and damage, the walk, refused when short, Repair all");
{
  const state = mk();
  const h = hub(state);
  builders(state, 2);
  const fw = standing(state, "tower", 2);
  check(/Not damaged/.test(FW.repairProblem(state, fw)), "an undamaged tower: nothing to repair");
  fw.hp = fw.max * 0.5;
  check(FW.damageBand(fw) === "worn", "half its condition: the needs-repair band (worn)");
  fw.hp = fw.max * 0.2;
  check(FW.damageBand(fw) === "bad", "a fifth: badly damaged");
  const rc = FW.repairCost(state, fw);
  check(rc.cost.scrap === Math.ceil(9 * 0.8) && rc.cost.wood === Math.ceil(72 * 0.8) && rc.hours > rc.work, `cost by the damage: ${JSON.stringify(rc.cost)}, ${rc.work} work-hours + walk = ${rc.hours}`);
  const scrap = h.stock.scrap;
  h.stock.scrap = 2;
  check(/Needs \d+ scrap/.test(FW.repairProblem(state, fw)), `short of scrap: "${FW.repairProblem(state, fw)}"`);
  h.stock.scrap = scrap;
  const q = FW.queueRepair(state, fw.id);
  check(!q.error && h.stock.scrap === scrap - rc.cost.scrap, `queued: ${q.text || q.error}`);
  tick(state, 48, () => fw.hp >= fw.max);
  check(fw.hp === fw.max && !FW.jobFor(state, fw), "repaired by the builders");
  // Repair all.
  const w = standing(state, "stockpile", 1);
  fw.hp = 30; w.hp = 10;
  const all = FW.repairAll(state, h);
  check(all.done === 2 && FW.jobFor(state, fw) && FW.jobFor(state, w), `Repair all: ${all.text}`);
  // Demolish: half back.
  const d0 = h.stock.wood;
  FW.cancelFieldJob(state, FW.jobFor(state, w).id);
  w.hp = w.max;
  FW.queueDemolish(state, w.id);
  tick(state, 48, () => !FW.fwById(state, w.id));
  check(!FW.fwById(state, w.id) && h.stock.wood > d0, `demolished: some firewood back (${Math.round(d0)} → ${Math.round(h.stock.wood)})`);
}

// ---------------------------------------------------------------------------------------------------------
section("A field well's water; a relay mast in the radio network");
{
  const state = mk();
  const h = hub(state);
  const fw = standing(state, "well", 2, (id) => FW.placeProblem(state, h, "well", id) === "");
  check(fw && fw.well && fw.well.yield > 0, `a well: ${fw && fw.well ? fw.well.yield : 0} a day`);
  const wp = waterProduction(state, h);
  check(wp.field > 0 && wp.fieldWells.length === 1, `waterProduction.field ${wp.field} (hub people ${atBase(state, h.id).length})`);
  check(FW.waterSourcesFor(state, h).length === 1 && FW.waterSourcesFor(state, h)[0].tile === fw.tile, "waterSourcesFor lists its tile");
  const left0 = fw.well.left;
  tick(state, 24);
  check(fw.well.left < left0, `drawn down: ${left0} → ${fw.well.left}`);
  // Relay: none at the hub, no station: unlinked; a station at the hub links it.
  const relay = standing(state, "relay", 2);
  check(radioNodes(state).some((n) => n.field === relay.id && !n.linked), "a relay mast is a node, unlinked with no station");
  h.radio = true;
  check(radioNodes(state).some((n) => n.field === relay.id && n.linked), "with a station at the hub it links");
}

// ---------------------------------------------------------------------------------------------------------
section("The groups build their own; the governor's share");
{
  const state = mk();
  const f = state.factions.find((x) => x.alive && x.bases.length);
  f.stock.scrap = 200; f.stock.parts = 10; f.pop = Math.max(f.pop, 14);
  let built = null;
  for (let i = 0; i < 20 && !built; i++) { state.hour += 24; FW.groupFieldDaily(state); built = FW.groupWorks(state, f)[0]; }
  check(!!built, `${f.name} put up a ${built ? FW.kindName(built).toLowerCase() : "nothing"}`);
  if (built) {
    for (let i = 0; i < 4; i++) { state.hour += 24; FW.groupFieldDaily(state); }
    check(built.built && state.tiles[built.tile].owner === f.id, "it stands on their land");
  }
  const t2 = state.grid.within(f.bases[0], 2).find((id) => id !== f.bases[0] && state.tiles[id].terrain !== "water" && !FW.fwAt(state, id));
  FW.buildGroupWork(state, f, "tower", t2, true);
  check(FW.groupFieldDefence(state, f, f.bases[0]) > 1, `a manned tower of theirs adds to their defence (×${FW.groupFieldDefence(state, f, f.bases[0])})`);
  // The governor: a well when water runs short, nothing when it does not.
  const h = hub(state);
  const none = FW.govFieldWorks(state, h, { waterShort: false, threatened: false });
  check(!none.length, "nothing to do: the governor builds nothing");
  const can = FW.placeTiles(state, h, "well").some((x) => !FW.placeProblem(state, h, "well", x.tile) && wellYield(state, x.tile) >= 4);
  const lines = FW.govFieldWorks(state, h, { waterShort: true, threatened: false });
  check(can && FW.playerWorks(state, h).some((x) => x.kind === "well"), `water short: a well planned (${lines.join(" | ") || "none"})`);
  // Threatened: a tower, and once it stands, a lookout from a big enough base.
  const more = FW.govFieldWorks(state, h, { waterShort: false, threatened: true });
  check(!more.some((l) => /Watch tower/.test(l)), "one field job at a time: the tower waits for the well");
  for (const j of [...state.fieldworks.jobs]) { j.progress = j.hours; FW.fieldBuildHour(state, h) || builders(state, 1); FW.fieldBuildHour(state, h); }
  const t = FW.govFieldWorks(state, h, { waterShort: false, threatened: true });
  check(t.some((l) => /Watch tower planned/.test(l)), `threatened: a watch tower planned (${t.join(" | ")})`);
  for (const j of [...state.fieldworks.jobs]) { j.progress = j.hours; FW.fieldBuildHour(state, h); }
  for (let i = 0; i < 12; i++) state.survivors.push({ ...atBase(state, h.id)[0], id: newId(), leader: false, pinned: false });
  const post = FW.govFieldWorks(state, h, { waterShort: false, threatened: true });
  check(post.some((l) => /goes out to the watch tower/.test(l)), `lookouts posted (${post.join(" | ")})`);
  // Repairs below 70%.
  const w = FW.playerWorks(state, h).find((x) => x.kind === "well");
  w.hp = 10;
  const rep = FW.govFieldWorks(state, h, { waterShort: false, threatened: false });
  check(rep.some((l) => /Repairs queued/.test(l)) && FW.jobFor(state, w), `a damaged well is repaired (${rep.join(" | ")})`);
}

// ---------------------------------------------------------------------------------------------------------
section("Determinism: the groups' field works replay the same on the same seed");
{
  const sig = (st) => FW.fwList(st).map((f) => `${f.kind}@${f.tile}:${f.built}:${Math.round(f.hp)}`).join(",");
  const run = () => { const st = createWorld({ seed: SEED, factionCount: 7 }); st.started = true; for (let i = 0; i < 24 * 25; i++) { tickHour(st); st.cards.length = 0; st.combat = null; } return sig(st); };
  const a = run(), b = run();
  check(a === b && a.length > 0, `two runs of 25 days: the same field works (${a.split(",").length})`);
}

section("Save and load");
{
  const state = mk();
  const h = hub(state);
  const tower = standing(state, "tower", 2);
  const s = atBase(state, h.id).find((x) => !x.leader);
  FW.postPerson(state, tower.id, s.id);
  const pile = standing(state, "stockpile", 1);
  FW.depositAt(state, pile, "scrap", 7);
  const loaded = deserializeState(serializeState(state));
  const lt = FW.fwAt(loaded, tower.tile), lp = FW.fwAt(loaded, pile.tile);
  const ls = loaded.survivors.find((x) => x.id === s.id);
  check(lt && lt.built && lt.garrison.includes(s.id) && ls.location.kind === "post" && ls.location.fw === lt.id, "the tower and its lookout round-trip");
  check(lp && lp.contents.scrap === 7, "the stockpile's goods round-trip");
  tick(loaded, 30);
  check(FW.fwAt(loaded, tower.tile) && ls.location.kind === "post", "the loaded world runs on");
  // An older save with no field works.
  delete state.fieldworks;
  for (const x of state.survivors) if (x.location.kind === "post") x.location = { kind: "base", baseId: h.id };
  const old = deserializeState(serializeState(state));
  tick(old, 48);
  check(Array.isArray(old.fieldworks.list), "an older save loads and runs (an empty table made on demand)");
}

console.log(`\n${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
