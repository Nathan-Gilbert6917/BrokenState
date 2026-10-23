// Car alarms (sim/caralarms.js; the hooks in foundcars.js carAct, locks.js openLock, combat.js searchBox, stealth.js
// throwAt / stealthTurn, decoys.js stimuli / botDecoy, siege.js battleOverlays; the user's request 2026-10-23: "Be able to
// set off car alarms to attract zombies to the alarm and away from you. Be able to set them off from afar as well by
// throwing something through the window. Add chance of alarm set off when smashing the window to try to loot a locked
// car or to hotwire it."). Checks:
//   - which cars have one: about HAS × a live battery of the civilian cars, never with a flat battery, a burnt-out box
//     truck or an Army vehicle; the same die every time; a record from an old save (no alarm field) gets the same
//   - "Set it off" from next to the car: only on an armed one (the reason otherwise); it rings, its lure in b.lures, the
//     fx; the unaware dead go to look at the car, the aware ones that hear it walk to it and away from a survivor a few
//     tiles off; a Shepherd's pack does not; the overlay lists it; ringingCars
//   - it pulls each enemy turn and rings out after TURNS ("off", the lure gone, the alarmoff fx); Heat on a raid
//   - "silence" from inside a ringing one ends it at once
//   - the odds of tripping it, over many cars: breaking the glass (SMASH), a crowbar (FORCE), hotwiring (HOTWIRE), the
//     lock panel on a locked car's raid box (SMASH); picking never
//   - a bottle thrown from 6 tiles breaks a window about THROW.bottle of the time (the doors open then) and sets an
//     armed one off; a blast nearby shakes one off
//   - the search on a car in the road's cars: an armed one goes off at searchChance; Quiet Hands never
//   - the AI (botDecoy): with no decoy, a bottle at an armed car it sees, away from its people, when the dead press
// Usage: node tools/caralarmtest.js [seed = 7]
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import { createBattle, combatAct, endPlayerTurn, runEnemyPhase, registerCombatHandler, placeCar, searchBox, CELL } from "../src/sim/combat.js";
import { launchExpedition } from "../src/sim/parties.js";
import { newItem, stow } from "../src/sim/inventory.js";
import { carRecord, carOptions, COND } from "../src/sim/foundcars.js";
import { ALARM, alarmOf, ringingCars, armedShare, searchChance, throwBreakChance, carMiddle, alarmsNear } from "../src/sim/caralarms.js";
import { stealthTurn, THROWABLES, DECOY_KEYS, THROW_KEYS } from "../src/sim/stealth.js";
import { pullOf, stimuli, botDecoy } from "../src/sim/decoys.js";
import { battleOverlays } from "../src/sim/siege.js";
import { serializeState, deserializeState } from "../src/sim/save.js";

const SEED = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
const section = (s) => console.log(`\n${s}`);
const pct = (v) => `${Math.round(v * 100)}%`;
const near = (got, want, tol) => Math.abs(got - want) <= tol;
registerCombatHandler("cat", () => {});
const world = (s = SEED) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.cards.length = 0; return st; };

// A battle at the hub on an open map, the dead (count) placed by the caller, a sedan (3 × 2) at (cx, cy).
function openBattle(st, count = 2, cx = 12, cy = 6) {
  const h = hub(st);
  const ids = atBase(st, h.id).slice(0, 3).map((s) => s.id);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: ids, enemy: { kind: "zombies", count, power: 2, name: "Test" }, ambush: "player", canRetreat: false, handler: "cat", context: {} });
  const b = st.combat;
  for (const c of b.cells) { c.k = "open"; delete c.car; delete c.h; } // flat and open (no hills in the way of the dash light)
  b.losCache.fill(0); b.reach.fill(1);
  const r = placeCar(b.cells, b.w, b.h, cx, cy, "x", 3, "car", () => true, 0);
  b.lures = []; b.cars = {};
  return { b, id: r.id, r };
}
// A fresh record of the same car (new dice: carSalt), its alarm set when asked.
function fresh(st, b, id, salt, alarm) {
  b.cars = {}; b.carSalt = salt; b.lures = [];
  const rec = carRecord(st, b, id);
  if (alarm !== undefined) rec.alarm = alarm;
  return rec;
}
const act = (st, b, u, rec, op) => { u.ap = 2; b.phase = "player"; return combatAct(st, { type: "car", unit: u.id, car: rec.id, op }); };
const dist = (a, x, y) => Math.hypot(a.x - x, a.y - y);

// ---------------------------------------------------------------------------------------------------------------
section("Which cars have one (fitAlarm in carRecord)");
{
  const st = world();
  const { b, id } = openBattle(st, 0);
  let flatArmed = 0;
  for (const [model, L, v] of [["sedan", 3, 0], ["van", 4, 1], ["pickup", 4, 0]]) {
    for (const c of b.cells) if (c.car && c.car.id === id) { c.car.L = L; c.car.v = v; }
    let armed = 0, n = 2000;
    for (let i = 0; i < n; i++) {
      const rec = fresh(st, b, id, 10000 + i);
      if (rec.model !== model) throw new Error(`model ${rec.model}`);
      if (alarmOf(rec) === "armed") { armed++; if (rec.cond.battery === "flat") flatArmed++; }
      if (![null, "armed"].includes(rec.alarm)) throw new Error(`alarm ${rec.alarm}`);
    }
    const want = ALARM.HAS[model] * (1 - COND.civil.battery);
    check(near(armed / n, want, 0.03), `${model}: ${pct(armed / n)} armed (HAS ${pct(ALARM.HAS[model])} × a live battery ${pct(1 - COND.civil.battery)} = ${pct(want)})`);
  }
  check(flatArmed === 0, "never one with a flat battery");
  check(near(armedShare(), (ALARM.HAS.sedan + ALARM.HAS.van + ALARM.HAS.pickup) / 3 * (1 - COND.civil.battery), 1e-9), `armedShare ${pct(armedShare())} of all civilian cars`);
  for (const c of b.cells) if (c.car && c.car.id === id) { c.car.L = 3; c.car.v = 0; }
  // A burnt-out box truck, an Army truck: none.
  let any = 0;
  for (const c of b.cells) if (c.car && c.car.id === id) c.k = "truck", c.car.kind = "truck";
  for (let i = 0; i < 300; i++) if (fresh(st, b, id, 20000 + i).alarm) any++;
  for (const c of b.cells) if (c.car && c.car.id === id) { c.k = "car"; c.car.kind = "car"; c.car.mil = { kind: "cargo", cond: "intact" }; }
  for (let i = 0; i < 300; i++) if (fresh(st, b, id, 30000 + i).alarm) any++;
  check(any === 0, "a burnt-out box truck and an Army truck never have one");
  for (const c of b.cells) if (c.car && c.car.id === id) delete c.car.mil;
  check(carOptions(st, b, b.units.find((u) => u.side === "player"), fresh(st, b, id, 1, null)).alarm.why.includes("No alarm"), "no alarm: the car panel says so (no light on the dash)");
  // The same die every time; an old save's record (no alarm field) gets it on the next look; other dice unchanged.
  let same = true, saves = true;
  for (let i = 0; i < 200; i++) {
    const a = fresh(st, b, id, 40000 + i);
    const keep = JSON.stringify({ ...a, alarm: undefined });
    const al = a.alarm;
    delete a.alarm;
    const back = carRecord(st, b, id);
    if (back.alarm !== al) saves = false;
    if (JSON.stringify({ ...back, alarm: undefined }) !== keep) same = false;
  }
  check(saves && same, "an old save's car record gets the same alarm on the next look, nothing else changes");
}

// ---------------------------------------------------------------------------------------------------------------
section("Set it off (carAct \"alarm\"): the dead go to the car");
{
  const st = world(SEED + 1);
  const { b, id } = openBattle(st, 4, 12, 6);
  const [u, v, w] = b.units.filter((x) => x.side === "player");
  const [zu, za, zs, zh] = b.units.filter((x) => x.side === "enemy");
  const rec = fresh(st, b, id, 5);
  rec.alarm = null;
  u.x = 11; u.y = 6; v.x = 2; v.y = 2; w.x = 1; w.y = b.h - 1;
  zu.x = Math.min(b.w - 1, 24); zu.y = 10; zu.aware = false; // unaware, ~11 tiles from the car
  za.x = 6; za.y = 4; za.aware = true; // aware, 4 tiles from the survivor at (2, 2), 7 from the car
  zs.x = 4; zs.y = 9; zs.aware = true; zh.x = 5; zh.y = 10; zh.aware = true; zh.ztype = "shepherd"; // zs: in a Shepherd's pack
  const err0 = act(st, b, u, rec, "alarm");
  check(err0 !== "" && /No alarm/.test(err0), `no alarm: refused ("${err0}")`);
  rec.alarm = "armed";
  check(carOptions(st, b, u, rec).alarm.ok && carOptions(st, b, u, rec).alarm.armed, "an armed one: Set it off is open from next to it");
  const fx0 = b.fx.length;
  const err = act(st, b, u, rec, "alarm");
  const lure = b.lures.find((l) => l.key === "caralarm");
  const [cx, cy] = carMiddle(rec);
  check(!err && rec.alarm === "ringing" && rec.alarmLeft === ALARM.TURNS && u.ap === 1, `set off: ringing for ${rec.alarmLeft} turns, 1 action (${err || "done"})`);
  check(!!lure && lure.alarm === rec.id && lure.x === cx && lure.y === cy && lure.radius === ALARM.RADIUS && lure.decoy && lure.sense.includes("noise") && lure.side === null, "its lure in b.lures at the car's middle (noise, a decoy, radius 16)");
  check(b.fx.slice(fx0).some((e) => e.type === "alarm" && e.car === rec.id && e.to[0] === cx), "the alarm fx for the views");
  check(!!zu.investigate && zu.investigate.key === "caralarm" && zu.investigate.x === cx, "the unaware dead 11 tiles off go to look at the car");
  check(ringingCars(b).length === 1 && ringingCars(b)[0].id === rec.id && ringingCars(b)[0].left === ALARM.TURNS && ringingCars(b)[0].w === 3, "ringingCars lists it for the lights and the siren");
  const ov = battleOverlays(b).decoys.find((d) => d.key === "caralarm");
  check(!!ov && ov.decoy && ov.alarm === rec.id, "the overlay draws it as a decoy");
  check(stimuli(b).some((m) => m.key === "caralarm") && pullOf(b, za)?.key === "caralarm", "it pulls the aware dead that hear noise (decoys.js stimuli)");
  check(!pullOf(b, zs), "not one of a Shepherd's pack (herded)");
  check(!THROW_KEYS.includes("caralarm") && !DECOY_KEYS.includes("caralarm") && !THROWABLES.caralarm, "not something anyone can throw");
  // Walk away; the enemy's turn.
  u.x = b.w - 1; u.y = 0;
  const dCar0 = dist(za, cx, cy), dV0 = dist(za, v.x, v.y), dU0 = dist(zu, cx, cy);
  endPlayerTurn(st); runEnemyPhase(st);
  check(dist(za, cx, cy) < dCar0 && dist(za, v.x, v.y) > dV0 && za.lured === "caralarm", `the aware one walks to the car (${dCar0.toFixed(1)} → ${dist(za, cx, cy).toFixed(1)} tiles), away from the survivor (${dV0.toFixed(1)} → ${dist(za, v.x, v.y).toFixed(1)})`);
  check(dist(zu, cx, cy) < dU0, `the unaware one walks over (${dU0.toFixed(1)} → ${dist(zu, cx, cy).toFixed(1)})`);
  check(rec.alarmLeft === ALARM.TURNS - 1, `one enemy turn rung (${rec.alarmLeft} left)`);
  // Save and load mid-ring.
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  check(back.combat && back.combat.cars[rec.id].alarm === "ringing" && back.combat.lures.some((l) => l.key === "caralarm" && l.alarm === rec.id), "a save and a load keep it ringing");
}

// ---------------------------------------------------------------------------------------------------------------
section("Rings out after TURNS; silence");
{
  const st = world(SEED + 2);
  const { b, id } = openBattle(st, 0);
  const u = b.units.find((x) => x.side === "player");
  u.x = 11; u.y = 6;
  const rec = fresh(st, b, id, 7, "armed");
  act(st, b, u, rec, "alarm");
  let rang = 0;
  for (let t = 0; t < ALARM.TURNS; t++) { stealthTurn(b); if (rec.alarm === "ringing" && b.lures.some((l) => l.alarm === rec.id && l.turns === rec.alarmLeft)) rang++; }
  check(rang === ALARM.TURNS && rec.alarmLeft === 0, `rings ${rang} enemy turns, the lure in step with the record`);
  const fx0 = b.fx.length;
  stealthTurn(b);
  check(rec.alarm === "off" && !b.lures.some((l) => l.key === "caralarm") && b.fx.slice(fx0).some((e) => e.type === "alarmoff" && e.car === rec.id) && !ringingCars(b).length, "then it cuts out: off, the lure gone, the alarmoff fx");
  check(!carOptions(st, b, u, rec).alarm.ok && /rung out/.test(carOptions(st, b, u, rec).alarm.why), "it never sounds again");
  // Silence: from inside.
  const r2 = fresh(st, b, id, 8, "armed");
  r2.locked = false;
  act(st, b, u, r2, "alarm");
  check(!carOptions(st, b, u, r2).silence.ok && /Get in/.test(carOptions(st, b, u, r2).silence.why), "silence needs you inside");
  act(st, b, u, r2, "enter");
  const fx1 = b.fx.length;
  const err = act(st, b, u, r2, "silence");
  check(!err && r2.alarm === "off" && !b.lures.some((l) => l.key === "caralarm") && b.fx.slice(fx1).some((e) => e.type === "alarmoff") && u.ap === 1, `silenced from inside: the fuse pulled, 1 action (${err || "done"})`);
  const r3 = fresh(st, b, id, 9, "armed"); r3.locked = false; act(st, b, u, r3, "enter");
  check(!carOptions(st, b, u, r3).silence.ok, "nothing to silence while it is only armed");
}

// ---------------------------------------------------------------------------------------------------------------
section("The odds of tripping it (over many cars)");
{
  const st = world(SEED + 3);
  const { b, id } = openBattle(st, 0);
  const u = b.units.find((x) => x.side === "player");
  const s = survivorById(st, u.sid);
  for (const k of Object.keys(s.gear)) if (s.gear[k] && ["crowbar", "prybar", "fireaxe", "sledge", "halligan"].includes(s.gear[k].key)) s.gear[k] = null;
  u.x = 11; u.y = 6;
  const N = 600;
  const rate = (op, prep) => { let n = 0, k = 0; for (let i = 0; i < N; i++) { const rec = fresh(st, b, id, `${op}${i}`, "armed"); prep(rec); if (act(st, b, u, rec, op)) continue; k++; if (rec.alarm === "ringing") n++; } return [n / Math.max(1, k), k]; };
  const [smash, ns] = rate("force", (r) => { r.locked = true; r.open = false; });
  check(ns === N && near(smash, ALARM.SMASH, 0.07), `breaking the glass to get in: ${pct(smash)} of tries set it off (SMASH ${pct(ALARM.SMASH)}, ${ns} tries)`);
  const [hot, nh] = rate("hotwire", (r) => { r.locked = false; r.open = true; r.keys = false; });
  check(nh === N && near(hot, ALARM.HOTWIRE, 0.05), `hotwiring: ${pct(hot)} a try (HOTWIRE ${pct(ALARM.HOTWIRE)})`);
  stow(s, newItem("crowbar"));
  const [force, nf] = rate("force", (r) => { r.locked = true; r.open = false; });
  check(nf === N && near(force, ALARM.FORCE, 0.05), `prying the door with a crowbar: ${pct(force)} (FORCE ${pct(ALARM.FORCE)})`);
  const [pick, np] = rate("pick", (r) => { r.locked = true; r.open = false; });
  check(np === N && pick === 0, `picking the lock never sets it off (${np} tries)`);
  // A window broken getting in stays broken: the doors open by reaching in.
  let glassOk = true;
  const s2 = s; for (const k of Object.keys(s2.gear)) if (s2.gear[k] && s2.gear[k].key === "crowbar") s2.gear[k] = null;
  s2.pockets = (s2.pockets || []).map((it) => (it && it.key === "crowbar" ? null : it));
  if (s2.pack && s2.pack.items) s2.pack.items = s2.pack.items.filter((it) => it.key !== "crowbar");
  for (let i = 0; i < 30; i++) { const rec = fresh(st, b, id, `g${i}`, null); rec.locked = true; act(st, b, u, rec, "force"); if (rec.open && !rec.glass) glassOk = false; }
  check(glassOk, "a window broken to get in stays broken (rec.glass)");
}

// ---------------------------------------------------------------------------------------------------------------
section("Thrown at from afar");
{
  const st = world(SEED + 4);
  const { b, id } = openBattle(st, 0, 12, 6);
  const u = b.units.find((x) => x.side === "player");
  const s = survivorById(st, u.sid);
  const N = 500;
  let broke = 0, armedBroke = 0, armedRang = 0, falseRang = 0, opened = 0, thrown = 0;
  for (let i = 0; i < N; i++) {
    const armed = i % 2 === 0;
    const rec = fresh(st, b, id, `t${i}`, armed ? "armed" : null);
    rec.locked = true;
    const [cx, cy] = carMiddle(rec);
    u.x = cx - 6; u.y = cy; u.ap = 2; b.phase = "player";
    stow(s, newItem("bottle"));
    const err = combatAct(st, { type: "throw", unit: u.id, item: "bottle", x: cx, y: cy });
    if (err) { console.log("   ", err); continue; }
    thrown++;
    if (rec.glass) { broke++; if (carOptions(st, b, u, rec).enter) opened++; if (armed) armedBroke++; }
    if (rec.alarm === "ringing") { if (armed && rec.glass) armedRang++; else falseRang++; }
  }
  check(thrown === N && near(broke / thrown, throwBreakChance("bottle"), 0.06), `a bottle from 6 tiles breaks a window ${pct(broke / thrown)} of the time (THROW.bottle ${pct(throwBreakChance("bottle"))})`);
  check(armedRang === armedBroke && armedBroke > 0 && falseRang === 0, `every armed one with a window broken goes off (${armedRang}/${armedBroke}); none without a broken window or an alarm`);
  check(opened === broke, "a broken window: the doors open by reaching in (Get in is offered)");
  check(throwBreakChance("frag") === 0 && throwBreakChance("molotov") === 0, "explosives and fire break nothing this way (their own effect)");
  // A blast next to an armed car shakes it off.
  const rec = fresh(st, b, id, "blast", "armed");
  const [cx, cy] = carMiddle(rec);
  check(alarmsNear(st, b, cx + 2, cy, "blast") === 1 && rec.alarm === "ringing", "a pipe bomb 2 tiles off sets an armed one off");
  const r2 = fresh(st, b, id, "blast2", "armed");
  check(alarmsNear(st, b, cx + 2, cy, "smoke") === 0 && alarmsNear(st, b, cx + 9, cy, "blast") === 0 && r2.alarm === "armed", "smoke, or a blast far off, does not");
}

// ---------------------------------------------------------------------------------------------------------------
section("Searching the cars on the road (combat.js searchBox); the lock panel");
{
  // A raid on a bare road tile: the cars people left (AREAS.roadcars, def.alarm 0.15).
  let st = null, b = null, boxes = [];
  for (let k = 0; k < 30 && !boxes.length; k++) {
    st = world(SEED * 10 + k);
    const h = hub(st);
    const tile = st.tiles.find((t) => t.road && !t.loc && !t.bridge && t.terrain !== "water" && t.id !== h.tile);
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, 3);
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 30, meds: 2 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    st.combat = createBattle(st, { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "cat", enemy: { kind: "zombies", count: 0, power: 2, groups: [] }, raid: { heat0: 5 }, context: {} });
    b = st.combat;
    if (b.raid.choose) b.raid.choose = null;
    b.units = b.units.filter((u) => u.side === "player");
    boxes = b.raid.containers.filter((c) => c.kind === "car" && ["roadcars", "wreck"].includes(b.raid.areas[c.area].type) && b.cells[c.y * b.w + c.x].car);
  }
  check(boxes.length > 0, `a road raid with ${boxes.length} cars to search`);
  if (boxes.length) {
    const u = b.units.find((x) => x.side === "player");
    const box = boxes[0];
    const id = b.cells[box.y * b.w + box.x].car.id;
    const N = 400;
    const run = (quiet) => { let n = 0; u.quiet = quiet; for (let i = 0; i < N; i++) { const rec = fresh(st, b, id, `s${quiet}${i}`, "armed"); box.contents = null; box.searched = false; if (box.lock) box.lock.open = true; searchBox(st, b, u, box); if (rec.alarm === "ringing") n++; } return n / N; };
    const plain = run(false);
    check(near(plain, searchChance(0.15), 0.06), `an armed car searched goes off ${pct(plain)} of the time (searchChance ${pct(searchChance(0.15))}: about 15% over all cars, as before)`);
    check(run(true) === 0, "Quiet Hands never sets one off");
    let none = 0;
    u.quiet = false;
    for (let i = 0; i < 100; i++) { const rec = fresh(st, b, id, `n${i}`, null); box.contents = null; box.searched = false; if (box.lock) box.lock.open = true; const h0 = b.raid.heat; searchBox(st, b, u, box); if (rec.alarm || b.raid.heat >= h0 + 12) none++; }
    check(none === 0, "a car with no alarm never goes off when searched");
    // Heat on a raid: at once and each enemy turn.
    const rec = fresh(st, b, id, "heat", "armed");
    const ring = boxRing(b, box).find(([x, y]) => CELL[b.cells[y * b.w + x].k].walk);
    u.x = ring[0]; u.y = ring[1];
    b.raid.heat = 20;
    const h0 = b.raid.heat;
    act(st, b, u, rec, "alarm");
    const h1 = b.raid.heat;
    stealthTurn(b);
    check(h1 - h0 === ALARM.HEAT && near(b.raid.heat - h1, ALARM.TURN_HEAT, 1e-9), `raid Heat +${h1 - h0} when it starts, +${b.raid.heat - h1} an enemy turn it rings`);
    // The lock panel on a locked car's raid box: smashing the glass trips it at SMASH a try.
    const s = survivorById(st, u.sid);
    for (const k of Object.keys(s.gear)) if (s.gear[k] && ["crowbar", "prybar", "fireaxe", "sledge", "halligan"].includes(s.gear[k].key)) s.gear[k] = null;
    let n = 0, k = 0;
    for (let i = 0; i < 500; i++) {
      const r = fresh(st, b, id, `l${i}`, "armed");
      box.lock = { kind: "car", open: false, tries: 0 };
      u.ap = 2; b.phase = "player";
      const err = combatAct(st, { type: "open", unit: u.id, target: `c${box.id}`, method: "force" });
      if (err) { if (i === 0) console.log("   ", err); continue; }
      k++;
      if (r.alarm === "ringing") n++;
    }
    check(k > 400 && near(n / k, ALARM.SMASH, 0.07), `the lock panel's Break glass on a locked car: ${pct(n / Math.max(1, k))} of ${k} tries set it off (SMASH ${pct(ALARM.SMASH)})`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
section("The AI: a bottle at an armed car to pull the dead off its people (decoys.js botDecoy)");
{
  const st = world(SEED + 5);
  const { b, id } = openBattle(st, 4, 14, 6);
  const [u, v, w] = b.units.filter((x) => x.side === "player");
  const s = survivorById(st, u.sid);
  stow(s, newItem("bottle"));
  const rec = fresh(st, b, id, "ai", "armed");
  const [cx, cy] = carMiddle(rec);
  u.x = cx - 7; u.y = cy; v.x = cx - 8; v.y = cy + 1; w.x = cx - 8; w.y = cy - 1;
  const dead = b.units.filter((x) => x.side === "enemy");
  dead.forEach((z, i) => { z.x = u.x - 3; z.y = cy - 2 + i; z.aware = true; });
  u.ap = 2; b.phase = "player";
  const ok = botDecoy(st, b, u);
  check(ok && (rec.alarm === "ringing" || !rec.glass), `the bot throws its bottle at the armed car 7 tiles off (${ok ? (rec.alarm === "ringing" ? "it goes off" : "the glass held") : "did nothing"})`);
  check(b.fx.some((e) => e.type === "throw" && e.to[0] === cx && e.to[1] === cy), "the throw lands on the car's middle");
  // Not when the car is next to its people, nor with no alarm.
  const st2 = world(SEED + 6);
  const o2 = openBattle(st2, 4, 14, 6);
  const [u2] = o2.b.units.filter((x) => x.side === "player");
  stow(survivorById(st2, u2.sid), newItem("bottle"));
  fresh(st2, o2.b, o2.id, "ai2", null);
  u2.x = 7; u2.y = 6;
  o2.b.units.filter((x) => x.side === "enemy").forEach((z, i) => { z.x = 4; z.y = 4 + i; z.aware = true; });
  for (const o of o2.b.units.filter((x) => x.side === "player" && x !== u2)) { o.x = 6; o.y = 8 + o.id % 3; }
  u2.ap = 2; o2.b.phase = "player";
  check(!botDecoy(st2, o2.b, u2), "no alarm on the car: no throw");
}

// ---------------------------------------------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
function boxRing(b, c) {
  const out = [];
  for (let y = c.y - 1; y <= c.y + (c.h || 1); y++) for (let x = c.x - 1; x <= c.x + (c.w || 1); x++) if (x >= 0 && y >= 0 && x < b.w && y < b.h && !(x >= c.x && y >= c.y && x < c.x + (c.w || 1) && y < c.y + (c.h || 1))) out.push([x, y]);
  return out;
}
