// Exploration and upkeep checks (suggestions-2 #8, #9, #10, #20): locks and keys in raids (sim/locks.js),
// manuals and blueprints (sim/blueprints.js), crash events with a search circle (sim/crashes.js), and buildings that
// wear and break with their repair jobs (sim/breakdowns.js); then long runs with no NaN.
// Usage: node tools/exploretest.js [seed] [days for the long runs]
//   BS_QUICK=1 (npm run test:quick): the same checks with the long runs 45 days each (not 200) and the crash clock
//   watched for 80 days (not 120: still room for the first crash and three gaps at their longest, 14 + 3 × 20).
import { createWorld, hub, atBase, makeSurvivor, day, tickHour, skill } from "../src/sim/world.js";
import { GEAR, LOCATIONS, SUPPLY_KEYS } from "../src/sim/data.js";
import { addBuilding, canBuild, stations, stationStatus, baseWalls, count, BUILDINGS } from "../src/sim/buildings.js";
import { canCraft } from "../src/sim/crafting.js";
import { launchExpedition, partyTile, partyMembers } from "../src/sim/parties.js";
import { createBattle, combatAct, reachable, CELL, registerCombatHandler, autoPlayerTurn, runEnemyPhase, unitAt, searchableNear } from "../src/sim/combat.js";
import { raidEnemies, startScavenge, searchHour, extract } from "../src/sim/scavenge.js";
import { newItem } from "../src/sim/inventory.js";
import { skillsDaily, READ_HOURS, gainXp } from "../src/sim/skills.js";
import { waterProduction } from "../src/sim/economy.js";
import { radioNodes } from "../src/sim/radio.js";
import { hubEventCard, hubUpkeepDaily, WELL_DOWN } from "../src/sim/hubevents.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { setSteward } from "../src/sim/steward.js";
import { vehiclesAtBase } from "../src/sim/vehicles.js";
import { refreshPower, powerStatus } from "../src/sim/power.js";
import * as BP from "../src/sim/blueprints.js";
import * as L from "../src/sim/locks.js";
import * as C from "../src/sim/crashes.js";
import * as BD from "../src/sim/breakdowns.js";

const seed = Number(process.argv[2] || 42);
const QUICK = !!process.env.BS_QUICK;
const longDays = Number(process.argv[3] || (QUICK ? 45 : 200));
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
const addPerson = (st, base, role, skills = {}) => {
  const s = makeSurvivor(st, 1);
  s.traits = [];
  s.location = { kind: "base", baseId: base.id };
  s.role = role;
  Object.assign(s.skills, skills);
  st.survivors.push(s);
  return s;
};
registerCombatHandler("xtest", () => {});
const pct = (v) => `${Math.round(v * 100)}%`;
const dis = (st, c) => (typeof c.disabled === "function" ? c.disabled(st) : !!c.disabled);

// A raid on a site of one of these types (a crew of 3 from the hub), started on its map. opts.picks: lockpicks
// for the first member; opts.want(b): keep trying seeds until the map has it.
function raidAt(types, opts = {}) {
  for (let i = opts.from || 0; i < (opts.from || 0) + 60; i++) { // opts.from: start further on, for another world
    const st = createWorld({ seed: seed * 100 + i, factionCount: 6 });
    st.cards.length = 0;
    st.crashNext = 1e9;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && types.includes(t.loc.type) && t.id !== h.tile);
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, 3);
    for (const s of crew) s.traits = [];
    if (opts.picks) crew[0].gear.tool = newItem("crowbar");
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", supplies: { food: 4, water: 4, ammo: 30, meds: 1 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "xtest", enemy: { kind: "zombies", count: 0, power: 2, groups: [] }, raid: { heat0: 5 }, context: {} };
    st.combat = createBattle(st, setup);
    const b = st.combat;
    if (opts.want && !opts.want(b)) continue;
    return { st, b, p, tile, crew, setup };
  }
  return null;
}
const player = (b) => b.units.find((u) => u.side === "player" && !u.dead && !u.left);
// Moves a unit onto a free walkable cell next to (x, y), preferring one reachable from the entry.
function standNext(b, u, x, y, opts = {}) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue;
    if (!CELL[b.cells[ny * b.w + nx].k].walk || unitAt(b, nx, ny)) continue;
    if (opts.outside && b.raid.areas.some((a) => a.locked && nx > a.x0 && nx < a.x0 + a.w - 1 && ny > a.y0 && ny < a.y0 + a.h - 1)) continue;
    u.x = nx; u.y = ny;
    return true;
  }
  return false;
}

// ======================================================================================
console.log("Locks: odds, Heat and noise");
{
  const r = raidAt(["police", "gunstore", "pharmacy"], { picks: true });
  check(!!r, "test setup: a raid map");
  const { st, b, crew } = r;
  const u = player(b);
  const s = crew[0];
  const box = b.raid.containers.find((c) => c.kind !== "body");
  for (const [kind, def] of Object.entries(L.LOCKS)) {
    const lock = { kind, open: false, tries: 0 };
    for (const stealth of [0, 5, 10, 20]) {
      s.skills.stealth = stealth;
      const o = L.openOdds(st, b, u, lock);
      if (def.nopick) { check(!o.pick.ok && o.pick.why, `${kind}: a dial or keypad, nothing to pick (gunsafetest.js has its odds)`); continue; } // locks.js gun safes
      const want = Math.max(0.05, Math.min(0.95, L.PICK.base + L.PICK.perStealth * skill(s, "stealth") - L.PICK.perDiff * (def.diff - 1) + (u.quiet ? L.PICK.quiet : 0)));
      check(near(o.pick.chance, want) && o.pick.ok, `${kind} (difficulty ${def.diff}), Stealth ${stealth}: pick ${pct(o.pick.chance)} (want ${pct(want)})`);
    }
    s.skills.mechanics = 6;
    const o = L.openOdds(st, b, u, lock);
    if (def.force) check(o.force.ok && o.force.crowbar && near(o.force.chance, Math.max(0.05, Math.min(0.95, L.FORCE.base + L.FORCE.perMech * skill(s, "mechanics") - L.FORCE.perDiff * (def.diff - 1)))), `${kind}: a crowbar forces it ${pct(o.force.chance)}`);
    else check(!o.force.ok, `${kind}: cannot be forced (${o.force.why})`);
    check(!o.key.ok, `${kind}: no key yet`);
  }
  // No picks: no picking; smashing only light locks, with both actions.
  const tool = s.gear.tool;
  s.gear.tool = null;
  const o1 = L.openOdds(st, b, u, { kind: "locker", open: false });
  const o3 = L.openOdds(st, b, u, { kind: "cage", open: false });
  check(!o1.pick.ok && o1.force.label === "Smash" && o1.force.ap === 2 && near(o1.force.chance, L.SMASH.base), `no lockpicks: no picking; smash a locker ${pct(o1.force.chance)} with both actions`);
  check(!o3.force.ok, "no lockpicks: a gun cage cannot be smashed open");
  s.gear.tool = tool;
  // The key: sure, silent.
  L.addKey(st, b.tileId, "test");
  check(L.openOdds(st, b, u, { kind: "safe", open: false }).key.ok && L.hasKey(st, b.tileId), "a key for this site opens even a safe");
  // Heat and noise per method, through the real combat action.
  const tryOpen = (method, kind) => {
    box.lock = { kind, open: false, tries: 0 };
    box.searched = false; box.contents = null;
    standNext(b, u, box.x, box.y);
    u.ap = 2; b.phase = "player"; b.over = false;
    const h0 = b.raid.heat, n0 = b.noise || 0;
    const err = combatAct(st, { type: "open", unit: u.id, target: `c${box.id}`, method });
    return { err, heat: b.raid.heat - h0, noise: (b.noise || 0) - n0, open: box.lock.open };
  };
  const k = tryOpen("key", "safe");
  check(!k.err && k.open && k.heat === 0 && k.noise === 0, `key: opens at once, no Heat, no noise (${k.err || "ok"})`);
  const pk = tryOpen("pick", "locker");
  check(!pk.err && near(pk.heat, L.PICK.heat) && pk.noise === 0, `pick: Heat +${L.PICK.heat} a try, no noise (${pk.heat})`);
  const fo = tryOpen("force", "locker");
  check(!fo.err && near(fo.heat, L.FORCE.heat) && fo.noise === L.FORCE.noise, `force (crowbar): Heat +${L.FORCE.heat} and noise ${L.FORCE.noise} (${fo.heat}, ${fo.noise})`);
  s.gear.tool = null;
  const sm = tryOpen("force", "locker");
  check(!sm.err && near(sm.heat, L.SMASH.heat) && sm.noise === L.SMASH.noise && u.ap === 0, `smash: both actions, Heat +${L.SMASH.heat}, noise ${L.SMASH.noise}`);
  s.gear.tool = tool;
  // Searching a locked box is refused; S skips it.
  box.lock = { kind: "cage", open: false, tries: 0 };
  box.searched = false; box.contents = null;
  u.ap = 2;
  const err = combatAct(st, { type: "search", unit: u.id, box: box.id });
  check(/locked/i.test(err) && !searchableNear(b, u).includes(box), `a locked container cannot be searched until it is open ("${err}")`);
  // Picking: Stealth XP, the picks wear and snap.
  s.skills.stealth = 0;
  const xp0 = (s.xpDay && s.xpDay.use && s.xpDay.use.stealth) || 0;
  const it = s.gear.tool;
  it.dur = 2;
  box.lock = { kind: "safe", open: false, tries: 0 };
  u.ap = 2; combatAct(st, { type: "open", unit: u.id, target: `c${box.id}`, method: "pick" });
  const xp1 = (s.xpDay && s.xpDay.use && s.xpDay.use.stealth) || 0;
  check(xp1 > xp0, `picking gives Stealth XP (${xp0} → ${xp1})`);
  check(it.dur === 1, `the lockpicks lose a use per try (${it.dur} left)`);
  u.ap = 2; if (!box.lock.open) combatAct(st, { type: "open", unit: u.id, target: `c${box.id}`, method: "pick" });
  check(box.lock.open || !L.picksOf(s), "worn-out lockpicks snap and are gone");
}

console.log("Locks: locked rooms, doors and loot");
{
  // A locked room (a building's map can also have locked ways out: their doors belong to no room).
  const r = raidAt(["police", "military", "gunstore", "pharmacy", "hospital", "prison"], { want: (b) => (b.raid.doors || []).some((d) => d.area != null) });
  check(!!r, "test setup: a raid with a locked room");
  if (r) {
    const { st, b } = r;
    const u = player(b);
    const d = b.raid.doors.find((x) => x.area != null);
    const area = b.raid.areas[d.area];
    const inside = b.raid.containers.filter((c) => c.area === d.area);
    check(inside.length > 0 && inside.every((c) => c.room), `the locked room (${area.name}) holds ${inside.length} container(s), marked as in a locked room`);
    check(b.raid.doors.filter((x) => x.area === d.area).every((x) => b.cells[x.y * b.w + x.x].k === "door" && !CELL.door.walk && CELL.door.los), "its doors are locked door cells: no walking through, no seeing through");
    // From outside the doors, nothing inside can be reached.
    standNext(b, u, d.x, d.y, { outside: true });
    const reachIn = (c) => {
      const rr = reachable(b, u, 999);
      return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isFinite(rr.dist[(c.y + dy) * b.w + c.x + dx]));
    };
    check(inside.every((c) => !reachIn(c)), "a door cell blocks movement: no container in the room can be reached");
    L.addKey(st, b.tileId, "test");
    u.ap = 2; b.phase = "player";
    const err = combatAct(st, { type: "open", unit: u.id, target: `d${d.id}`, method: "key" });
    // Open floor on the street map, an open door on a building's map (buildingmaps.js).
    check(!err && b.raid.doors.filter((x) => x.area === d.area).every((x) => x.lock.open && ["open", "odoor"].includes(b.cells[x.y * b.w + x.x].k)), `the key opens every door of the room (${err || "ok"})`);
    check(inside.some((c) => reachIn(c)), "once open the room can be walked into");
  }
  // Locked loot against plain loot (the same container rolled both ways, many times).
  const r2 = raidAt(["police"]);
  const { st, b } = r2;
  const u = player(b);
  const box = b.raid.containers.find((c) => c.kind !== "body");
  let plain = 0, locked = 0, lockedGear = 0, bps = 0, keys = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    st.hour += 1;
    const sup1 = { ammo: 10, food: 4 }, g1 = [];
    box.lock = null; box.room = false;
    L.lockedLoot(st, b, u, box, sup1, g1);
    plain += Object.values(sup1).reduce((a, v) => a + v, 0);
    const sup2 = { ammo: 10, food: 4 }, g2 = [];
    box.lock = { kind: "cage", open: true };
    L.lockedLoot(st, b, u, box, sup2, g2);
    locked += Object.values(sup2).reduce((a, v) => a + v, 0);
    lockedGear += g2.filter((g) => !BP.bpOfItem(g.key)).length;
    bps += g2.filter((g) => BP.bpOfItem(g.key)).length;
    for (const x of [...g1, ...g2]) if (BP.bpOfItem(x.key)) delete st.tech.found[BP.bpOfItem(x.key)];
  }
  keys = (b.raid.foundKeys || []).length;
  check(locked > plain * 1.5, `a gun cage holds more than a plain box (supplies ${(locked / N).toFixed(1)} vs ${(plain / N).toFixed(1)} a box)`);
  check(lockedGear / N > 0.5, `a gun cage holds guns (${(lockedGear / N).toFixed(2)} items a cage)`);
  check(bps > 0, `blueprints turn up in locked containers (${bps} in ${N} cages at a police station)`);
  check(keys > 0 && b.raid.foundKeys.every((t) => st.tiles[t].loc && L.KEY_SITES.includes(st.tiles[t].loc.type)), `keys turn up, each for a lockable site (${keys})`);
  // Keys join the ring only when someone gets out.
  b.result = { outcome: "defeat", raid: {} }; b.summary = [];
  const before = L.keyRing(st).length;
  L.raidLocksEnd(st, b);
  check(L.keyRing(st).length === before && /lost/.test(b.summary.join(" ")), "keys found by a team that never got out are lost");
  b.result = { outcome: "extracted", raid: {} }; b.summary = [];
  L.raidLocksEnd(st, b);
  check(L.keyRing(st).length > before && b.summary.some((x) => /Key ring/.test(x)), `keys found by a team that got out go on the key ring (${L.keyRing(st).length})`);
}

console.log("Locks: the raid bot");
{
  let opened = 0, tries = 0, raids = 0, timeouts = 0, crashes = 0, doorsOpen = 0;
  const how = {};
  for (let i = 0; i < 24; i++) {
    const r = raidAt([["police", "gunstore", "pharmacy", "military", "warehouse", "office"][i % 6]], { picks: true, from: i * 7 }); // 24 different raids, not the same 6 four times
    if (!r) continue;
    const { st, b, setup } = r;
    b.units.filter((x) => x.side === "enemy").forEach((x) => { x.dead = true; });
    for (const s of r.crew) s.skills.stealth = 8;
    try {
      let g = 0;
      while (!b.over && g++ < 200) { autoPlayerTurn(st); runEnemyPhase(st); }
      if (!b.over) { timeouts++; continue; }
    } catch (e) { crashes++; console.log(e.stack); continue; }
    raids++;
    for (const c of b.raid.containers) if (c.lock) { tries++; if (c.lock.open) { opened++; how[c.lock.how] = (how[c.lock.how] || 0) + 1; } }
    for (const d of b.raid.doors || []) if (d.lock.open) doorsOpen++;
  }
  check(!crashes && !timeouts, `the bot plays raids with locks to the end (${raids} raids, ${crashes} crashes, ${timeouts} timeouts)`);
  check(opened > 0 && (how.pick || 0) > 0, `the bot opens locks, mostly by picking (${opened} of ${tries} containers: ${Object.entries(how).map(([k, v]) => `${k} ${v}`).join(", ")}; ${doorsOpen} doors)`);
}

console.log("Locks: the hour-by-hour search");
{
  const st = W();
  const h = hub(st);
  const tile = st.tiles.find((t) => t.loc && t.loc.type === "police");
  const crew = atBase(st, h.id).slice(0, 2);
  crew[0].gear.tool = newItem("crowbar");
  crew[0].skills.stealth = 10;
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", supplies: { food: 6, water: 6, ammo: 60 } });
  const p = res.party;
  p.path = [tile.id]; p.idx = 0; p.dest = tile.id;
  let lines = 0, opened = 0;
  for (let k = 0; k < 40; k++) {
    tile.loot = 1;
    st.engagement = null;
    startScavenge(st, p);
    st.engagement.approach = "sneak";
    const h0 = st.engagement.heat;
    const line = searchHour(st) || "";
    if (/\ban? (evidence locker|gun cage|drug cabinet|safe|lockbox|locked locker|sealed crate)/i.test(line)) lines++;
    if (/(Picked|Unlocked|Forced|Smashed) an? /.test(line)) opened++;
    st.hour += 1;
    if (!partyMembers(st, p).length) break;
    void h0;
  }
  check(lines > 0 && opened > 0, `a search hour at a police station turns up locked things and the picker opens some (${opened} of ${lines})`);
}

// ======================================================================================
console.log("Blueprints: locks, finding, studying");
{
  const st = W();
  const h = hub(st);
  Object.assign(h.stock, { scrap: 500, parts: 60, meds: 40, electronics: 10, carparts: 4 }); // electronics: the walk-in freezer's (locked with the cold store, machines-2); car parts: the battery bank's batteries (2026-10-24)
  addPerson(st, h, "build", { mechanics: 12, medicine: 12 });
  // Early buildings are open; the top tiers are locked.
  for (const t of ["farm_plot", "bunkhouse", "walls", "well", "barricades", "infirmary", "ammo_bench", "med_station", "storehouse", "still", "greenhouse", "cellar", "kitchen"]) {
    const chk = canBuild(st, h, t);
    check(!chk.locked, `${BUILDINGS[t].name}: never locked (${chk.ok ? "ok" : chk.reason})`);
  }
  for (const [t, L2] of Object.entries(BP.LOCKED.buildings)) {
    if (BUILDINGS[t].upgrades || BUILDINGS[t].outpostOnly || L2.from) continue;
    const chk = canBuild(st, h, t);
    check(chk.locked && chk.reason.includes(BP.BLUEPRINTS[L2.bp].name), `${BUILDINGS[t].name}: locked until the ${BP.BLUEPRINTS[L2.bp].name} is studied`);
  }
  // A second preserving kitchen needs the canning guide; the first does not.
  addBuilding(h, "kitchen");
  // Radios are mid game (blueprints.js ERA_OPEN): the station waits for its handbook, or year 5.
  check(canBuild(st, h, "radio").locked, `the radio station waits for the Radio Engineering Handbook or the mid game (${canBuild(st, h, "radio").reason})`);
  check(canBuild(st, h, "kitchen").locked, "a second preserving kitchen needs the Commercial Canning Guide");
  addBuilding(h, "infirmary"); addBuilding(h, "field_hosp");
  check(canBuild(st, h, "clinic").locked, "the Clinic (tier 3) is locked; the field hospital was not");
  addBuilding(h, "ammo_bench");
  h.stock.metalsheet = 5; // the scrap vest's sheet (2026-10-21): only the lock in the way
  for (const k of ["crossbow", "pipegun", "scrapvest"]) check(canCraft(st, h, k).locked, `${k}: locked until its blueprint is studied`);
  check(canCraft(st, h, "spikedbat").ok, "plain recipes are never locked");
  check(/Needs: Field Surgery Manual.*Look in:.*hospital/.test(BP.lockNote(st, h, "building", "clinic")), "the Construction line says what is needed and where it may be found");
  // Study: a qualified reader at the base with the copy.
  h.armory.push(newItem("bp_fieldsurgery"));
  const noob = addPerson(st, h, "read", { medicine: 1 });
  const doc = addPerson(st, h, "read", { medicine: 6 });
  const xp0 = doc.xp ? doc.xp.medicine || 0 : 0;
  skillsDaily(st);
  check(near(BP.studyHours(st, "fieldsurgery"), READ_HOURS) && doc.studying === "fieldsurgery" && !noob.studying, `a reader with Medicine 4+ studies it ${READ_HOURS}h a day; one with Medicine 1 does not (${BP.studyHours(st, "fieldsurgery")}h)`);
  check((doc.xpDay.study.medicine || 0) > 0 || (doc.xp.medicine || 0) > xp0, "studying gives study XP in the blueprint's skill");
  let days = 1;
  while (!BP.isKnown(st, "fieldsurgery") && days < 20) { st.hour += 24; skillsDaily(st); days++; }
  check(BP.isKnown(st, "fieldsurgery") && days === Math.ceil(BP.BLUEPRINTS.fieldsurgery.hours / READ_HOURS), `studied in ${days} days (${BP.BLUEPRINTS.fieldsurgery.hours}h at ${READ_HOURS}h a day), and known for good`);
  h.armory.push(newItem("handdrill")); // the Clinic's bolted fittings want a drill (toolreqs.js BUILD_TOOLS clinic)
  check(canBuild(st, h, "clinic").ok, `once studied the Clinic can be built (${canBuild(st, h, "clinic").reason || "ok"})`);
  check(h.armory.some((i) => i.key === "bp_fieldsurgery") && !doc.studying, "the copy stays in the armory; the reader moves on");
  // Finds: only at fitting sites, never one already known or held, deterministic.
  let found = 0, wrong = 0;
  const uni = st.tiles.find((t) => t.loc && t.loc.type === "univ");
  const farm = st.tiles.find((t) => t.loc && t.loc.type === "farm");
  for (let k = 0; k < 400; k++) {
    st.hour += 1;
    uni.loot = 1;
    const it = BP.rollBlueprint(st, uni.id, 1, `t${k}`);
    if (it) { found++; const id = BP.bpOfItem(it.key); if (!BP.BLUEPRINTS[id].sites.includes("univ") || BP.isKnown(st, id)) wrong++; }
    const it2 = BP.rollBlueprint(st, farm.id, 1, `f${k}`);
    if (it2 && !BP.BLUEPRINTS[BP.bpOfItem(it2.key)].sites.includes("farm")) wrong++;
  }
  check(found > 0 && !wrong, `blueprints come from fitting sites only and never one you know (${found} at a university in 400 hours, ${wrong} wrong)`);
  const a1 = BP.rollBlueprint(st, uni.id, 50, "same"), a2 = BP.rollBlueprint(st, uni.id, 50, "same");
  check(JSON.stringify(a1) === JSON.stringify(a2), "rolls are deterministic (no world random numbers used)");
  // Traders sell them now and then.
  let wares = 0;
  const trader = st.factions.find((f) => f.type === "traders") || st.factions[0];
  for (let d = 1; d < 200; d++) wares += BP.blueprintWares(st, { ...trader, type: "traders" }, d).length;
  check(wares > 20, `traders offer a blueprint some weeks (${wares} of 199 days)`);
  // The autopilot puts a qualified person on it.
  const st2 = W(seed + 1);
  const h2 = hub(st2);
  h2.armory.push(newItem("bp_machinist"));
  addPerson(st2, h2, "farm", { mechanics: 7 });
  setAutopilot(st2, true, "balanced");
  for (let k = 0; k < 24 * 12 && !BP.isKnown(st2, "machinist"); k++) tickHour(st2);
  check(BP.isKnown(st2, "machinist"), `the autopilot studies a blueprint in the armory (day ${day(st2)})`);
}

// ======================================================================================
console.log("Crash events");
{
  // Timing over a long quiet run. The hub starts bare (barestart) and a hub left to itself with nothing built falls
  // to crowding within weeks, so it gets what the old start had standing and lasts the 120 days. Its cards go
  // unanswered, so its people are kept from losing hope (morale.js): a colony that walks away stops the crashes too.
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true;
  for (const t of ["farm_plot", "farm_plot", "craftbench", "bunkhouse", "walls"]) addBuilding(hub(st), t);
  const seen = [];
  for (let k = 0; k < 24 * (QUICK ? 80 : 120); k++) {
    if (k % 24 === 0) for (const s of st.survivors) if (s.alive) s.mood = Math.max(s.mood, 50);
    tickHour(st);
    st.cards.length = 0;
    // The crash clock is what is measured: a hub nobody runs loses hope and walks away within weeks (by day 38 to 89
    // on seed 42, by its dice), so its people's mood is held up and it lasts the 120 days.
    if (k % 24 === 0) for (const s of st.survivors) if (s.alive) s.mood = Math.max(s.mood ?? 0, 60);
    if ((st.crashSeq || 0) > seen.length) seen.push(day(st));
  }
  const gaps = seen.slice(1).map((d, i) => d - seen[i]);
  check(seen.length >= 1 && seen[0] >= C.CRASH.firstMin && seen[0] <= C.CRASH.firstMax + 1, `the first crash between days ${C.CRASH.firstMin} and ${C.CRASH.firstMax} (day ${seen[0]})`);
  check(gaps.length >= 3 && gaps.every((g) => g >= C.CRASH.gapMin - 1 && g <= C.CRASH.gapMax + 1), `then every ${C.CRASH.gapMin}–${C.CRASH.gapMax} days (${gaps.join(", ")})`);
  check(st.crashes.filter((c) => c.gone).every((c) => c.expires - c.seenHour >= C.CRASH.lifeMin * 24 && c.expires - c.seenHour <= C.CRASH.lifeMax * 24), `each burns out ${C.CRASH.lifeMin}–${C.CRASH.lifeMax} days after it came down`);
  check(st.crashes.filter((c) => c.gone).every((c) => !(st.tiles[c.tile].loc && st.tiles[c.tile].loc.crash === c.id)), "a burned-out wreck is gone from the map");
  // The circle, finding, narrowing.
  let contains = 0, total = 0, narrowed = 0, hidden = 0;
  for (let i = 0; i < 30; i++) {
    const s2 = W(seed + 10 + i);
    s2.hordes.length = 0;
    const c = C.spawnCrash(s2, { noCard: true });
    if (!c) continue;
    total++;
    if (C.inCircle(s2, c, c.tile) && s2.grid.distance(c.center, c.tile) <= c.radius - 1) contains++;
    if (!s2.tiles[c.tile].loc) hidden++;
    // A team looks around inside the circle but out of reach of the wreck: the circle shrinks and still holds it.
    const h = hub(s2);
    const crew = atBase(s2, h.id).slice(0, 2);
    const res = launchExpedition(s2, { memberIds: crew.map((s) => s.id), dest: c.center, mission: "move", stance: "normal", supplies: { food: 4, water: 4 } });
    if (res.error) continue;
    const p = res.party;
    let ok = true;
    for (let k = 0; k < 6 && !c.found; k++) {
      const spots = s2.grid.within(c.center, c.radius).filter((id) => s2.grid.distance(id, c.tile) > 3 && s2.tiles[id].terrain !== "water");
      if (!spots.length) break;
      p.path = [spots[0]]; p.idx = 0;
      const r0 = c.radius;
      C.crashSurvey(s2, p);
      if (c.radius < r0 || r0 === 1) narrowed++;
      if (!C.inCircle(s2, c, c.tile)) ok = false;
    }
    if (!ok) contains--;
    p.path = [c.tile]; p.idx = 0;
    C.crashSurvey(s2, p);
    if (!c.found || !s2.tiles[c.tile].loc || s2.tiles[c.tile].loc.type !== C.CRASH_KINDS[c.kind].site) contains--;
  }
  check(total >= 20 && contains === total, `the circle always holds the wreck, at spawn (at most radius − 1 from the centre) and after every narrowing; a look in reach finds it (${contains}/${total})`);
  check(hidden === total, "the wreck is not on the map until someone finds it");
  check(narrowed > total, `a look that misses narrows the circle (${narrowed} narrowings in ${total} crashes)`);
  // The race, the hordes, expiry.
  const s3 = W(seed + 3);
  s3.factions.forEach((f) => { f.alive = true; });
  const h3 = hub(s3);
  const fb = s3.factions[0].bases[0];
  const c3 = C.spawnCrash(s3, { noCard: true, witness: { tile: h3.tile, label: "Test", radius: 4, from: "base" }, tile: s3.grid.within(fb, 8).find((id) => s3.grid.distance(id, fb) >= 4 && s3.tiles[id].terrain !== "water" && !s3.tiles[id].loc && !s3.tiles[id].hive) });
  check(!!c3 && c3.race.length > 0, `groups near the crash race for it (${c3 ? c3.race.length : 0} send parties)`);
  C.foundCrash(s3, c3, null);
  const loot0 = s3.tiles[c3.tile].loot;
  let arrived = false;
  for (let k = 0; k < 24 * 6 && !arrived; k++) { tickHour(s3); s3.cards.length = 0; arrived = c3.stripped > 0; }
  check(arrived && s3.tiles[c3.tile].loot <= loot0 * C.CRASH.stripKeep + 1e-9, `a salvage party that gets there first strips the wreck (loot ${loot0.toFixed(2)} → ${s3.tiles[c3.tile].loot.toFixed(2)})`);
  for (let k = 0; k < 24 * 12 && !c3.gone; k++) { tickHour(s3); s3.cards.length = 0; }
  check(c3.gone && !s3.tiles[c3.tile].loc, `it burns out on day ${Math.floor(c3.expires / 24) + 1}`);
  const s4 = W(seed + 4);
  const h4 = hub(s4);
  const spot = s4.grid.within(h4.tile, 10).find((id) => s4.grid.distance(id, h4.tile) >= 7 && s4.tiles[id].terrain !== "water" && !s4.tiles[id].loc);
  const hd = { id: 9999, tile: s4.grid.within(spot, 5).find((id) => s4.grid.distance(id, spot) === 5 && s4.tiles[id].terrain !== "water"), size: 40, target: null, move: 0, role: "roam" };
  s4.hordes.push(hd);
  C.spawnCrash(s4, { noCard: true, tile: spot });
  check(hd.target === spot && hd.lureUntil > s4.hour, "the noise draws a nearby horde toward the wreck for 3 days");
  // The one-click search team: recon the circle, look around, find it, search it, come home.
  let foundBy = 0, searched = 0, runs = 0;
  for (let i = 0; i < 8; i++) {
    const s5 = W(seed + 20 + i);
    s5.hordes.length = 0;
    const c5 = C.spawnCrash(s5);
    if (!c5) continue;
    runs++;
    const card = s5.cards.find((x) => x.crashId === c5.id);
    const send = card.choices.find((x) => /Send a search team/.test(x.label));
    if (dis(s5, send)) continue;
    const msg = send.resolve(s5);
    s5.cards.length = 0;
    const p = s5.parties.find((x) => x.crashSearch === c5.id);
    if (!p) { console.log("   ", msg); continue; }
    for (let k = 0; k < 24 * 8 && s5.parties.includes(p); k++) {
      tickHour(s5);
      if (s5.engagement && !s5.engagement.done) { s5.engagement.approach = "sneak"; for (let j = 0; j < 4 && s5.engagement; j++) { searchHour(s5); tickHour(s5); } if (s5.engagement) extract(s5); }
      while (s5.cards.length) { const cc = s5.cards.shift(); if (cc.isOrders && p.orders && p.orders.length) continue; const ch = (cc.choices || []).find((x) => !x.uiAction && !dis(s5, x)); if (ch) ch.resolve(s5); }
      if (p.phase === "waiting" && !(p.orders || []).length && !c5.found) break;
    }
    if (c5.found && c5.foundBy === p.id) foundBy++;
    if (c5.found && s5.tiles[c5.tile].loot < (LOCATIONS[C.CRASH_KINDS[c5.kind].site].richness * C.CRASH.stripKeep ** c5.stripped) - 1e-6) searched++;
  }
  check(runs >= 5 && foundBy >= Math.ceil(runs * 0.6), `a search team sent from the card finds the wreck (${foundBy} of ${runs})`);
  check(searched >= 1, `and searches it (${searched} of ${foundBy})`);
}

// ======================================================================================
console.log("Breakdowns and repairs");
{
  const st = W();
  const h = hub(st);
  Object.assign(h.stock, { scrap: 200, parts: 30, fuel: 60, food: 300 });
  const mech = addPerson(st, h, "build", { mechanics: 8 });
  const gen = addBuilding(h, "generator"); // no operator (machines-2): it runs while something draws power
  const fz = addBuilding(h, "freezer"); // something that draws power (the cold store draws none since machines-2)
  // Wear: a running generator wears faster than one standing by; age adds to it.
  BD.fixtures(h).forEach((f) => { f.built = 1; f.wear = 0; });
  st.hour = 24 * 5 + 8;
  refreshPower(st, h);
  const wx = null;
  const run = BD.dailyWear(st, h, gen, wx);
  h.powerOff = { [fz.id]: true };
  st.hour += 24;
  refreshPower(st, h);
  const idle = BD.dailyWear(st, h, gen, wx);
  h.powerOff = {};
  refreshPower(st, h);
  check(run > idle && idle >= 0, `a running generator wears ${run.toFixed(2)} a day, standing by ${idle.toFixed(2)}`);
  st.hour = 24 * 245;
  gen.lastRan = st.hour; // it ran today
  const old = BD.dailyWear(st, h, gen, wx);
  check(old > run * 1.8, `an old one wears more (${old.toFixed(2)} at 8 months)`);
  check(BD.dailyWear(st, h, BD.fixtures(h)[0], { key: "fair", lo: -6 }) > BD.dailyWear(st, h, BD.fixtures(h)[0], { key: "fair", lo: 5 }) + 2, "frost wears the pump");
  addPerson(st, h, "farm").perks = ["greasemonkey"];
  check(near(BD.wearMult(st, h, gen), BD.WEAR.greaseMonkey), "a Grease Monkey at the base slows wear 20%");
  st.hour = 24 * 5;
  // Breaking: at 100 for sure, never below 60.
  gen.wear = 59.9;
  let broke = false;
  for (let d = 0; d < 30; d++) { st.hour += 24; gen.wear = 59.9; BD.breakdownsDaily(st); if (gen.broken) broke = true; gen.broken = null; }
  check(!broke, "never breaks below 60 wear");
  gen.wear = 100; st.cards.length = 0;
  BD.breakdownsDaily(st);
  check(!!gen.broken && st.cards.some((c) => c.breakdown), "breaks at 100, with a card");
  const ss = powerStatus(st, h).gens.find((g) => g.b === gen);
  check(!ss.running && gen.broken, `a broken generator does not run (${ss.reason})`);
  // Repair: costs paid, worked only 08:00–20:00, then fixed.
  const card = st.cards.find((c) => c.breakdown);
  const s0 = { ...h.stock };
  const msg = card.choices[0].resolve(st);
  const job = h.repairs[0];
  check(job && h.stock.scrap === s0.scrap - BD.FIXTURES.generator.repair.cost.scrap && h.stock.parts === s0.parts - BD.FIXTURES.generator.repair.cost.parts, `repair: ${msg}`);
  st.hour = Math.floor(st.hour / 24) * 24 + 21;
  BD.breakdownsHour(st);
  check(job.done === 0, "no repair work at night");
  let hours = 0;
  while (gen.broken && hours < 100) { st.hour += 1; BD.breakdownsHour(st); hours++; }
  check(!gen.broken && near(gen.wear, BD.WEAR.repairWear) && !h.repairs.length, `fixed after ${job.hours} work-hours (${hours} clock hours), wear back to ${BD.WEAR.repairWear}`);
  // Jury-rig: quick, cheap, wears faster after.
  BD.breakFixture(st, h, gen, "test", { card: false });
  BD.startRepair(st, h, gen, "rig");
  hours = 0;
  while (gen.broken && hours < 100) { st.hour += 1; BD.breakdownsHour(st); hours++; }
  check(!gen.broken && gen.rigged && near(gen.wear, BD.WEAR.rigWear) && near(BD.wearMult(st, h, gen), BD.WEAR.greaseMonkey * BD.WEAR.rigMult), `jury-rigged: wear left at ${BD.WEAR.rigWear}, wears ×${BD.WEAR.rigMult} until repaired properly`);
  // Cancel refunds.
  BD.breakFixture(st, h, gen, "test", { card: false });
  const s1 = { ...h.stock };
  BD.startRepair(st, h, gen, "repair");
  BD.cancelRepair(st, h, gen.id);
  check(h.stock.scrap === s1.scrap && h.stock.parts === s1.parts, "cancelling a repair returns its materials");
  gen.broken = null; gen.wear = 0;
  // Effects of other fixtures.
  const well = addBuilding(h, "well");
  const w0 = waterProduction(st, h).wells;
  BD.breakFixture(st, h, well, "test", { card: false });
  check(waterProduction(st, h).wells === w0 - 6 * waterProduction(st, h).factor || waterProduction(st, h).wells < w0, `a broken well gives no water (${w0} → ${waterProduction(st, h).wells} a day)`);
  const walls = h.buildings.find((b) => b.type === "walls") || addBuilding(h, "walls");
  const wl0 = baseWalls(h);
  BD.breakFixture(st, h, walls, "test", { card: false });
  check(wl0 > 0 && baseWalls(h) === 0, `a broken wall loses its wall strength (${wl0} → ${baseWalls(h)})`);
  const radio = addBuilding(h, "radio");
  check(radioNodes(st).some((n) => n.base === h), "test setup: the radio station is on the air");
  BD.breakFixture(st, h, radio, "test", { card: false });
  check(!radioNodes(st).some((n) => n.base === h), "a broken radio station is off the air");
  BD.startRepair(st, h, radio, "repair", mech.id);
  for (let k = 0; k < 72 && radio.broken; k++) { st.hour += 1; BD.breakdownsHour(st); }
  check(!radio.broken && h.radio, "repaired, it is back on the air");
  // Attack damage on the walls and gate.
  walls.broken = null; walls.wear = 0;
  const gate = addBuilding(h, "gate");
  h.hordeHits = (h.hordeHits || 0);
  BD.breakdownsHour(st);
  h.hordeHits += 1;
  BD.breakdownsHour(st);
  check(walls.wear >= 2 && gate.wear > 10, `a horde attack wears the walls (a 1×4 wall piece ${walls.wear.toFixed(1)}: each piece takes its share, breakdowns.js) and the gate (${gate.wear.toFixed(0)})`);
  // The hub pump: the storm hub event is this breakdown now.
  const st2 = W(seed + 5);
  const h2 = hub(st2);
  Object.assign(h2.stock, { scrap: 40, parts: 6, water: 60 });
  const ev = hubEventCard(st2, "well", h2);
  check(ev.choices.length === 3 && /Repair it/.test(ev.choices[0].label) && /Jury-rig/.test(ev.choices[1].label), "the storm well-pump event offers repair, jury-rig or leave it");
  ev.choices[2].resolve(st2);
  const water = h2.stock.water;
  st2.hour += 24;
  hubUpkeepDaily(st2);
  check(h2.wellDown && h2.stock.water === Math.max(0, water - WELL_DOWN.water) && BD.fixtures(h2)[0].broken, `left broken: the pump costs ${WELL_DOWN.water} water a day and is on the Repairs list`);
  check(BD.repairPlan(st2, h2, BD.fixtures(h2)[0], "repair").ok, "and it can be repaired from there");
  // The autopilot and a steward start repairs themselves.
  const st3 = W(seed + 6);
  const h3 = hub(st3);
  Object.assign(h3.stock, { scrap: 60, parts: 10 });
  setSteward(st3, h3, true);
  st3.cards.length = 0;
  BD.breakFixture(st3, h3, BD.fixtures(h3)[0], "test");
  check(h3.repairs.length === 1 && !st3.cards.some((c) => c.breakdown), "a steward with Building on starts the repair itself (no card)");
  // Parked vehicles in the frost.
  const v = vehiclesAtBase(st3, h3.id)[0];
  if (v) {
    const c0 = v.condition;
    for (let d = 2; d < 400 && v.condition === c0; d++) { st3.hour = (d - 1) * 24; BD.breakdownsDaily(st3); }
    check(v.condition < c0, `a parked vehicle loses condition on frost days (${c0} → ${v.condition})`);
  }
}

// ======================================================================================
console.log(`Long runs (${longDays} days)`);
{
  const bad = (v) => typeof v !== "number" || !Number.isFinite(v);
  for (const [sd, style] of [[seed, "balanced"], [seed + 1, "cautious"], [seed + 2, null]]) {
    const st = createWorld({ seed: sd, factionCount: 7 });
    st.started = true;
    if (style) setAutopilot(st, true, style);
    let nan = "", crashCount = 0;
    try {
      for (let k = 0; k < longDays * 24 && !st.gameOver; k++) {
        tickHour(st);
        if (!style) {
          while (st.cards.length) { const c = st.cards.shift(); const ch = (c.choices || []).find((x) => /Return home|Mark it/.test(x.label)) || (c.choices || []).find((x) => !x.uiAction && !dis(st, x)); if (ch) ch.resolve(st); }
          st.engagement = null; st.trade = null;
        }
        if (k % 24 === 0) {
          for (const b of st.bases) {
            for (const kk of SUPPLY_KEYS) if (bad(b.stock[kk] || 0) || (b.stock[kk] || 0) < 0) nan = `${b.name} ${kk} ${b.stock[kk]}`;
            for (const f of BD.fixtures(b)) if (bad(f.wear || 0)) nan = `${b.name} ${f.type} wear ${f.wear}`;
            for (const j of b.repairs || []) if (bad(j.done) || bad(j.hours)) nan = `${b.name} repair job ${JSON.stringify(j)}`;
          }
          for (const c of st.crashes || []) if (bad(c.radius) || bad(c.expires) || st.tiles[c.tile] == null) nan = `crash ${JSON.stringify(c)}`;
          for (const [id, h] of Object.entries((st.tech && st.tech.progress) || {})) if (bad(h)) nan = `study ${id} ${h}`;
        }
        if (nan) break;
      }
    } catch (e) { crashCount++; console.log(e.stack); }
    const t = st.tech || { known: [] };
    check(!crashCount && !nan, `${style || "hands-off"} seed ${sd}: no crash and no NaN or negative stock over ${day(st)} days${nan ? ` (${nan})` : ""}`);
    console.log(`    ${style || "hands-off"} seed ${sd}: day ${day(st)}, crashes ${st.crashSeq || 0} (found ${(st.crashes || []).filter((c) => c.found).length} of the last ${(st.crashes || []).length}), breakdowns ${st.stats.breakdowns || 0}, broken now ${st.bases.reduce((a, b) => a + BD.brokenAt(b).length, 0)}, keys ${(st.keys || []).length}, blueprints known ${t.known.length} (${t.known.join(", ") || "none"}), found ${Object.values(t.found || {}).reduce((a, v) => a + v, 0)}`);
    if (style === "balanced") check((st.crashSeq || 0) >= Math.floor(day(st) / 25), `crashes keep coming (${st.crashSeq || 0} in ${day(st)} days)`);
  }
}

console.log(`\n${passes} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
