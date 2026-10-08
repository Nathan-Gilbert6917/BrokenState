// Gun safes and gun cases (docs/weapons-overhaul-plan.md section 19; sim/gunsafes.js, sim/locks.js): where safes stand
// and how often, the odds of every way in by tier (with the skill gates), drilling's progress and Heat over turns, a
// charge that blows one open and what it does to the contents, combination notes, the contents by tier and a
// registered extra, gun cases (carried locked, opened at a base for free; a cased gun is not fielded), the raid bot's
// rules (no drilling past the Heat cap, never a blast), the hour-by-hour search, a save round-trip, the loot tags.
// Usage: node tools/gunsafetest.js [seed]
import { totalRounds } from "../src/sim/ammo.js"; // rounds by calibre
import { SUPPLIES } from "../src/sim/data.js";
import { createWorld, hub, atBase, makeSurvivor } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
import { createBattle, combatAct, CELL, registerCombatHandler, autoPlayerTurn, runEnemyPhase, endPlayerTurn, unitAt } from "../src/sim/combat.js";
import { newItem, itemLoad } from "../src/sim/inventory.js";
import { itemValue } from "../src/sim/valuation.js";
import { hash01 } from "../src/sim/skills.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { ITEM_TAGS, AREA_TAGS, SITE_TAGS, fitsTags } from "../src/sim/loot.js";
import { packTripKit } from "../src/sim/kit.js";
import * as L from "../src/sim/locks.js";
import * as G from "../src/sim/gunsafes.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const pct = (v) => `${Math.round(v * 1000) / 10}%`;
registerCombatHandler("gstest", () => {});

// A world, its hub and one survivor with these skills (no traits: the numbers are exact).
function world(s = seed) {
  const st = createWorld({ seed: s, factionCount: 6 });
  st.started = true; st.cards.length = 0; st.crashNext = 1e9;
  return st;
}
function person(st, skills = {}) {
  const h = hub(st);
  const s = makeSurvivor(st, 1);
  s.traits = [];
  s.location = { kind: "base", baseId: h.id };
  for (const k of Object.keys(s.skills)) s.skills[k] = 0;
  Object.assign(s.skills, skills);
  st.survivors.push(s);
  return s;
}
const survivorOf = (st, u) => st.survivors.find((q) => q.id === u.sid);
const givePack = (s) => { if (!s.gear.backpack) s.gear.backpack = newItem("rucksack"); return s.gear.backpack.contents; };
const give = (s, key) => { const it = newItem(key, 1); const pk = givePack(s); const i = pk.indexOf(null); if (i >= 0) pk[i] = it; else pk.push(it); return it; };

// ======================================================================================
console.log("Placement: rates by area and site (many lockRaid rolls)");
{
  const st = world();
  // One area of a type with one locker; a fresh roll each time (the hour changes).
  const rate = (areaType, site, kind, N = 4000, interior = null) => {
    let n = 0, tier = 0;
    for (let i = 0; i < N; i++) {
      const areas = [{ id: 0, type: areaType, name: "Room", ...(interior || {}) }];
      const b = { tileId: 3, w: 4, h: 4, turn: 1, log: [], cells: Array.from({ length: 16 }, () => ({ k: "open" })), raid: { areas, containers: [{ id: 1, x: 1, y: 1, area: 0, kind: "locker" }], interior: interior ? { id: 1 } : null } };
      b.cells[5].k = "locker";
      st.hour = i;
      L.placeGunSafes(st, b, site, (...k) => hash01(st.seed, "lock", b.tileId, st.hour, ...k));
      const c = b.raid.containers[0];
      if (c.lock && c.lock.kind === kind) { n++; if (c.kind === "gunsafe" && b.cells[5].k === "gunsafe") tier++; }
    }
    return { p: n / N, cell: tier === n };
  };
  const cases = [
    ["house", "town", "gunsafe1", 0.06], ["house", "city", "gunsafe1", 0.02], ["house", "motel", "gunsafe1", 0.03],
    ["farmhouse", "farm", "gunsafe1", 0.15], ["farmhouse", "ranch", "gunsafe2", 0.12], ["farmhouse", "ranch", "gunsafe1", 0.15],
    ["cabin", "cabin", "gunsafe1", 0.2], ["cabin", "cabin", "gunsafe2", 0.08], ["cabin", "lodge", "gunsafe2", 0.12],
    ["armory", "police", "gunsafe3", 0.3], ["armory", "prison", "gunsafe3", 0.25], ["armory", "military", "gunsafe3", 0.35],
    ["office", "gunstore", "gunsafe2", 0.5], ["office", "police", "gunsafe2", 0.3], ["milwreck", "crash_mil", "gunsafe3", 0.1],
  ];
  const rows = [];
  for (const [a, site, kind, want] of cases) {
    const r = rate(a, site, kind);
    rows.push(`${a}@${site} ${kind} ${pct(r.p)}`);
    check(Math.abs(r.p - want) <= want * 0.3 && r.cell, `${a} at a ${site}: ${kind} ${pct(r.p)} (target ${pct(want)} ±30%), its cell turns into a gun safe`);
  }
  console.log(`  ${rows.join(" · ")}`);
  check(rate("office", "office", "gunsafe2", 500).p === 0 && rate("armory", "gunstore", "gunsafe3", 500).p === 0 && rate("store", "town", "gunsafe1", 500).p === 0, "no gun safes in an office block's offices, a gun store's armory row or a shop");
  // A building's own map: the rooms that carry room.gunSafe (buildingmaps.js), the armories at the site's rate.
  const gs = rate("office", "gunstore", "gunsafe2", 3000, { gunSafe: ["gunsafe2", 0.5] });
  const ch = rate("office", "police", "gunsafe2", 3000, { gunSafe: ["gunsafe2", 0.3] });
  const ar = rate("armory", "prison", "gunsafe3", 3000, { gunSafe: ["gunsafe3", 0.35] });
  check(Math.abs(gs.p - 0.5) < 0.15 && Math.abs(ch.p - 0.3) < 0.09 && Math.abs(ar.p - 0.25) < 0.075, `building maps: a gun shop office ${pct(gs.p)} (50%), the Chief's office ${pct(ch.p)} (30%), a prison's armory ${pct(ar.p)} (25%: the site's rate)`);
  const plain = rate("office", "office", "gunsafe2", 500, { name: "Office" });
  check(plain.p === 0, "a building map's office without room.gunSafe gets none");
}

// ======================================================================================
console.log("Placement: real raid maps");
function raidAt(types, opts = {}) {
  for (let i = opts.from || 0; i < (opts.from || 0) + 80; i++) {
    const st = createWorld({ seed: seed * 100 + i, factionCount: 6 });
    st.cards.length = 0; st.crashNext = 1e9;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && types.includes(t.loc.type) && t.id !== h.tile);
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, opts.crew || 3);
    for (const s of crew) s.traits = [];
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", supplies: { food: 4, water: 4, ammo: 30, meds: 1, parts: 2 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "gstest", enemy: { kind: "zombies", count: 0, power: 2, groups: [] }, raid: { heat0: 0, ...(opts.raid || {}) }, context: {} };
    st.combat = createBattle(st, setup);
    const b = st.combat;
    if (opts.want && !opts.want(b)) continue;
    return { st, b, p, tile, crew, setup };
  }
  return null;
}
const safesIn = (b) => b.raid.containers.filter((c) => c.lock && L.isGunSafe(c.lock));
{
  let maps = 0, withSafe = 0, cellsOk = true, labels = true;
  const kinds = {};
  for (let i = 0; i < 30; i++) {
    const r = raidAt([["farm", "ranch", "cabin", "lodge", "police", "gunstore", "military", "prison"][i % 8]], { from: i * 5 });
    if (!r) continue;
    maps++;
    const list = safesIn(r.b);
    if (list.length) withSafe++;
    for (const c of list) {
      kinds[c.lock.kind] = (kinds[c.lock.kind] || 0) + 1;
      const cells = r.b.floors ? r.b.floors[c.f || 0].cells : r.b.cells;
      if (cells[c.y * r.b.w + c.x].k !== "gunsafe" || c.kind !== "gunsafe") cellsOk = false;
      if (!/gun cabinet|gun safe|armoury safe/.test(c.label) || !c.lock.mech) labels = false;
    }
  }
  check(maps >= 20 && withSafe > 0, `gun safes stand on real raid maps (${withSafe} of ${maps} maps: ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  check(cellsOk && labels, "each safe's cell is a gun safe cell, labelled and with a dial, keypad or key lock");
  check(CELL.gunsafe && !CELL.gunsafe.walk, "the gun safe cell blocks movement (combat.js CELL.gunsafe)");
}

// ======================================================================================
console.log("Odds: every way in, by tier, with the skill gates");
{
  const st = world();
  const s = person(st, { stealth: 10, mechanics: 0 });
  const u = { id: 1, sid: s.id, ap: 2, side: "player" };
  const b = { tileId: hub(st).tile, raid: { combos: [], heat: 0 }, pools: [{ parts: 1 }] };
  const lock = (kind, mech, extra = {}) => ({ kind, open: false, tries: 0, mech, ref: "c1", ...extra });
  let o = L.openOdds(st, b, u, lock("gunsafe2", "dial"));
  check(near(o.crack.chance, 0.3) && o.crack.ok && o.crack.ap === 2 && o.crack.heat === 1, `crack a mid safe at Stealth 10: ${pct(o.crack.chance)} (30%), both actions, Heat +1`);
  o = L.openOdds(st, b, u, lock("gunsafe3", "dial"));
  check(near(o.crack.chance, 0.2), `crack a high safe at Stealth 10: ${pct(o.crack.chance)} (20%)`);
  s.skills.stealth = 5;
  o = L.openOdds(st, b, u, lock("gunsafe2", "dial"));
  check(!o.crack.ok && /Stealth 6/.test(o.crack.why), "no cracking under Stealth 6");
  s.skills.stealth = 6;
  o = L.openOdds(st, b, u, lock("gunsafe2", "dial"));
  check(o.crack.ok && near(o.crack.chance, 0.14), `Stealth 6: ${pct(o.crack.chance)} (14%)`);
  s.skills.stealth = 20;
  o = L.openOdds(st, b, u, lock("gunsafe2", "dial"));
  check(near(o.crack.chance, 0.6), `crack odds top out at 60% (${pct(o.crack.chance)})`);
  u.ap = 1;
  o = L.openOdds(st, b, u, lock("gunsafe2", "dial"));
  check(!o.crack.ok && o.crack.gate === "ap", "cracking needs both actions");
  u.ap = 2;
  check(!o.bypass.ok && /keypad/.test(o.bypass.why), "no bypass on a dial");
  // Bypass a keypad.
  o = L.openOdds(st, b, u, lock("gunsafe2", "keypad"));
  check(o.bypass.ok && near(o.bypass.chance, 0.3) && o.bypass.ap === 1 && !o.bypass.heat && !o.crack.ok, `bypass a mid keypad at Mechanics 0: ${pct(o.bypass.chance)} (30%), 1 action, silent; no cracking a keypad`);
  s.skills.mechanics = 10;
  o = L.openOdds(st, b, u, lock("gunsafe2", "keypad"));
  const o3 = L.openOdds(st, b, u, lock("gunsafe3", "keypad"));
  check(near(o.bypass.chance, 0.8) && near(o3.bypass.chance, 0.65), `Mechanics 10: mid ${pct(o.bypass.chance)} (80%), high ${pct(o3.bypass.chance)} (65%)`);
  b.pools = [{ parts: 0 }];
  o = L.openOdds(st, b, u, lock("gunsafe2", "keypad"));
  check(!o.bypass.ok && /parts/.test(o.bypass.why), "bypass needs a part in the team's supplies");
  b.pools = [{ parts: 1 }];
  s.skills.mechanics = 0;
  // Drill and grind: sure, by progress.
  o = L.openOdds(st, b, u, lock("gunsafe2", "dial"));
  check(!o.drill.ok && !o.grind.ok && /drill/.test(o.drill.why), "no drill, no drilling");
  give(s, "powerdrill"); give(s, "anglegrinder");
  const dr = (kind) => L.openOdds(st, b, u, lock(kind, "keypad")).drill;
  check(dr("gunsafe1").actions === 2 && dr("gunsafe2").actions === 6 && dr("gunsafe3").actions === 12, `drilling at Mechanics 0: cheap ${dr("gunsafe1").actions}, mid ${dr("gunsafe2").actions}, high ${dr("gunsafe3").actions} actions (2 / 6 / 12)`);
  check(dr("gunsafe2").turns === 3 && dr("gunsafe3").turns === 6 && dr("gunsafe2").chance === 1, "a mid safe is 3 turns of drilling, a high one 6; sure");
  o = L.openOdds(st, b, u, lock("gunsafe2", "keypad"));
  check(o.grind.ok && o.grind.actions === 3 && o.grind.wake === 11 && o.drill.wake === 8, `grinding: half the actions (${o.grind.actions}), wakes within 11 (a drill 8)`);
  s.skills.mechanics = 10;
  check(near(dr("gunsafe2").rate, 1.5) && dr("gunsafe2").actions === 4, `Mechanics 10: +1.5 an action, a mid safe in ${dr("gunsafe2").actions} actions`);
  s.skills.mechanics = 0;
  o = L.openOdds(st, b, u, lock("gunsafe2", "keypad", { prog: 4 }));
  check(o.drill.actions === 2 && o.drill.prog === 4, "progress counts: 4 of 6 done, 2 actions left");
  // Blow it.
  check(!o.blow.ok, "no explosive, no blowing");
  give(s, "pipebomb");
  o = L.openOdds(st, b, u, lock("gunsafe2", "keypad"));
  const ob3 = L.openOdds(st, b, u, lock("gunsafe3", "keypad"));
  check(o.blow.ok && o.blow.chance === 1 && near(ob3.blow.chance, 0.7) && o.blow.heat === 10 && o.blow.wake === 14, `blow: mid ${pct(o.blow.chance)}, high ${pct(ob3.blow.chance)}, Heat +10, wakes within 14`);
  // Key, pick, force by tier.
  st.keys = [{ tile: b.tileId, name: "k" }];
  check(L.openOdds(st, b, u, lock("gunsafe1", "key")).key.ok && L.openOdds(st, b, u, lock("gunsafe2", "dial")).key.ok && !L.openOdds(st, b, u, lock("gunsafe3", "dial")).key.ok, "the site key opens a gun cabinet and a gun safe, never an armoury safe");
  st.keys = [];
  check(!L.openOdds(st, b, u, lock("gunsafe2", "dial")).pick.ok && !L.openOdds(st, b, u, lock("gunsafe3", "keypad")).pick.ok, "no picking a dial or a keypad");
  s.gear.tool = newItem("crowbar");
  s.skills.stealth = 10;
  o = L.openOdds(st, b, u, lock("gunsafe1", "key"));
  check(o.pick.ok && near(o.pick.chance, 0.55 + 0.4 - 0.15) && o.force.ok && near(o.force.chance, 0.85 - 0.2) && o.force.heat === 6 && o.force.wake === 8, `a gun cabinet: pick ${pct(o.pick.chance)}, pry ${pct(o.force.chance)} (Heat +6, wakes within 8)`);
  check(!L.openOdds(st, b, u, lock("gunsafe2", "dial")).force.ok && !L.openOdds(st, b, u, lock("gunsafe3", "dial")).force.ok, "a gun safe and an armoury safe cannot be pried");
  s.gear.tool = null;
  o = L.openOdds(st, b, u, lock("gunsafe1", "key"));
  check(!o.force.ok, "a gun cabinet cannot be kicked in without a crowbar");
  // The combination.
  o = L.openOdds(st, b, u, lock("gunsafe3", "keypad"));
  check(!o.combo.ok, "no note, no combination");
  b.raid.combos = ["c1"];
  o = L.openOdds(st, b, u, lock("gunsafe3", "keypad"));
  check(o.combo.ok && o.combo.chance === 1 && !o.combo.heat, "with the note: sure, silent");
}

// ======================================================================================
// A raid with one container turned into a gun safe of this kind, a unit next to it, nothing else on the map.
function safeRaid(kind, mech, opts = {}) {
  const r = raidAt(opts.types || ["town", "farm", "police", "gunstore"], { from: opts.from || 0, crew: opts.crew || 2, want: (b) => b.raid.containers.some((c) => c.kind !== "body" && c.kind !== "car" && c.kind !== "pump" && !c.lock) });
  if (!r) return null;
  const { st, b } = r;
  b.units.filter((x) => x.side === "enemy").forEach((x) => { x.dead = true; });
  b.infection = 0;
  b.raid.heat = 0;
  const c = b.raid.containers.find((q) => q.kind !== "body" && q.kind !== "car" && q.kind !== "pump" && !q.lock && !(q.f || 0) && !q.room);
  const cells = b.cells;
  cells[c.y * b.w + c.x].k = "gunsafe";
  c.kind = "gunsafe";
  c.lock = { kind, open: false, tries: 0, mech, ref: `c${c.id}` };
  const u = b.units.find((x) => x.side === "player");
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const nx = c.x + dx, ny = c.y + dy;
    if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h || !CELL[cells[ny * b.w + nx].k].walk || unitAt(b, nx, ny)) continue;
    u.x = nx; u.y = ny; break;
  }
  const s = r.crew.find((q) => q.id === u.sid);
  for (const k of Object.keys(s.skills)) s.skills[k] = 0;
  return { ...r, c, u, s };
}
// Ends the turn and plays the enemy phase (Heat climbs in raidTurn), back to the player.
const nextTurn = (st) => { endPlayerTurn(st); runEnemyPhase(st); };

console.log("Drilling: progress and Heat over turns");
for (const [kind, want, turnsWant] of [["gunsafe2", 9.6, 3], ["gunsafe3", 19.2, 6]]) {
  const r = safeRaid(kind, "keypad");
  if (!check(!!r, "test setup: a raid with a container to turn into a safe")) break;
  const { st, b, c, u, s } = r;
  give(s, "powerdrill");
  const h0 = b.raid.heat;
  let turns = 0, err = "";
  while (!c.lock.open && turns < 10) {
    for (const o of b.units) if (o.side === "player" && o !== u) o.ap = 0;
    while (u.ap > 0 && !c.lock.open) { err = combatAct(st, { type: "open", unit: u.id, target: `c${c.id}`, method: "drill" }) || err; }
    turns++;
    if (b.phase === "player") nextTurn(st); else runEnemyPhase(st);
  }
  const added = b.raid.heat - h0;
  check(c.lock.open && c.lock.how === "drill" && turns === turnsWant && !err, `a ${L.LOCKS[kind].name.toLowerCase()} drilled open in ${turns} turns (${turnsWant}) ${err ? `(${err})` : ""}`);
  check(Math.abs(added - want) <= 2, `Heat added over the drilling: ${added.toFixed(1)} (section 19.3: about ${want} ±2)`);
  const drill = s.gear.backpack.contents.find((it) => it && it.key === "powerdrill");
  check(drill && drill.dur === 2, `the drill's bits lose a use per safe (${drill ? drill.dur : "gone"} of 3 left)`);
}
{
  const r = safeRaid("gunsafe2", "dial");
  const { st, b, c, u, s } = r;
  give(s, "anglegrinder");
  const err = combatAct(st, { type: "open", unit: u.id, target: `c${c.id}`, method: "grind" });
  check(!err && c.lock.prog === 2 && b.noise === 1.5 && u.sparks === b.turn, `grinding: 2 progress an action (${c.lock.prog}), noise 1.5, the sparks mark the grinder's user this turn`);
  const other = b.units.find((x) => x.side === "player" && x !== u);
  if (other) {
    const os = r.crew.find((q) => q.id === other.sid);
    for (const k of Object.keys(os.skills)) os.skills[k] = 0;
    give(os, "powerdrill");
    other.x = u.x; other.y = u.y; u.x = -5; // the second one steps in where the first stood
    const e2 = combatAct(st, { type: "open", unit: other.id, target: `c${c.id}`, method: "drill" });
    check(!e2 && c.lock.prog === 3, `work is shared: a second person's drill adds to the grinder's progress (${c.lock.prog}/6)`);
  }
}

// ======================================================================================
console.log("Blowing it: the charge, the blast, the contents");
{
  const r = safeRaid("gunsafe2", "keypad");
  const { st, b, c, u, s } = r;
  give(s, "pipebomb");
  for (const o of b.units) if (o.side === "player" && o !== u) o.ap = 0;
  const err = combatAct(st, { type: "open", unit: u.id, target: `c${c.id}`, method: "blow" });
  check(!err && c.lock.armed && !c.lock.open && b.raid.charges.length === 1, `the charge is set (1 action) and waits for the next turn ${err}`);
  check(!s.gear.backpack.contents.some((it) => it && it.key === "pipebomb"), "the pipe bomb is used");
  // Move away before it goes off.
  u.x = Math.max(0, c.x - 4 < 0 ? c.x + 4 : c.x - 4);
  const h0 = b.raid.heat;
  if (b.phase === "player") nextTurn(st); else runEnemyPhase(st);
  check(c.lock.open && c.lock.blown && c.lock.how === "blow" && !b.raid.charges.length, "it goes off at the start of the next player turn: the safe is blown open");
  check(b.raid.heat - h0 >= 10, `Heat +10 for the blast (and the turn's 1.2): +${(b.raid.heat - h0).toFixed(1)}`);
  // The contents: the same safe rolled blown and not.
  const roll = () => { const sup = {}, gear = []; c.contents = null; L.lockedLoot(st, b, u, c, sup, gear); return { sup, gear }; };
  c.lock.blown = false;
  const clean = roll();
  c.lock.blown = true;
  const blown = roll();
  const guns = (g) => g.filter((it) => GEAR[it.key].slot === "weapon" && GEAR[it.key].cat !== "melee");
  const gc = guns(clean.gear), gb = guns(blown.gear);
  check(gc.length === gb.length && gc.length > 0 && gc.every((it, i) => near(gb[i].quality, Math.max(0.2, Math.round((it.quality - 0.3) * 100) / 100), 0.011)), `each gun −0.3 condition (${gc.map((x) => x.quality).join(", ")} → ${gb.map((x) => x.quality).join(", ")})`);
  const R = (sup) => totalRounds(sup), keysOf = (sup) => Object.keys(sup).filter((k) => sup[k] > 0 && SUPPLIES[k] && SUPPLIES[k].round); // ammo.js: the rounds by calibre
  check(R(blown.sup) < R(clean.sup) && keysOf(clean.sup).every((k) => near(blown.sup[k] || 0, clean.sup[k] - Math.round(clean.sup[k] * 0.3))), `30% of the ammo gone (${R(clean.sup)} → ${R(blown.sup)})`);
  const g2 = [newItem("scotch"), newItem("wine"), newItem("watch"), newItem("pistol", 0.4)];
  const s2 = { ammo: 10, food: 3 };
  G.blastContents(g2, s2);
  check(g2.length === 2 && g2.some((x) => x.key === "watch") && near(g2.find((x) => x.key === "pistol").quality, 0.2) && s2.ammo === 7 && s2.food === 2, "bottles smashed, a watch survives, a gun's condition stops at 0.2, supplies lose 30%");
  // A high-tier safe can hold.
  let held = 0, opened = 0;
  for (let i = 0; i < 40; i++) {
    const r3 = safeRaid("gunsafe3", "keypad", { from: i * 3 });
    if (!r3) continue;
    give(r3.s, "frag");
    for (const o of r3.b.units) if (o.side === "player" && o !== r3.u) o.ap = 0;
    combatAct(r3.st, { type: "open", unit: r3.u.id, target: `c${r3.c.id}`, method: "blow" });
    r3.u.x = r3.c.x > 4 ? r3.c.x - 4 : r3.c.x + 4;
    if (r3.b.phase === "player") nextTurn(r3.st); else runEnemyPhase(r3.st);
    if (r3.c.lock.open) opened++; else held++;
  }
  check(opened > held && held > 0, `an armoury safe opens to a blast about 70% of the time (${opened} of ${opened + held})`);
}

// ======================================================================================
console.log("Combination notes");
{
  const st = world();
  const counts = { 1: [0, 0], 2: [0, 0], 3: [0, 0] };
  let bodyNotes = 0, foundOk = 0, tests = 0;
  for (let i = 0; i < 3000; i++) {
    const tier = 1 + (i % 3);
    const site = tier === 1 ? "farm" : tier === 2 ? "gunstore" : "police";
    const areaType = tier === 1 ? "farmhouse" : tier === 2 ? "office" : "armory";
    const areas = [{ id: 0, type: areaType, name: "Room" }];
    const containers = [{ id: 1, x: 1, y: 1, area: 0, kind: "locker" }, { id: 2, x: 2, y: 1, area: 0, kind: "cabinet" }, { id: 3, x: 3, y: 1, area: 0, kind: "shelf" }];
    const b = { tileId: 3, w: 6, h: 4, turn: 1, log: [], cells: Array.from({ length: 24 }, () => ({ k: "open" })), raid: { areas, containers, interior: null, foundKeys: [] }, units: [] };
    st.hour = i;
    L.placeGunSafes(st, b, site, (...k) => hash01(st.seed, "lock", b.tileId, st.hour, ...k));
    const safe = containers.find((c) => c.kind === "gunsafe");
    if (!safe) continue;
    const t = L.LOCKS[safe.lock.kind].tier;
    counts[t][0]++;
    if (!safe.lock.note) continue;
    counts[t][1]++;
    if (safe.lock.note.at === "body") { bodyNotes++; continue; }
    // Searching the container with the note finds it; the safe then opens with it.
    if (tests < 40) {
      tests++;
      const holder = containers.find((c) => c.id === safe.lock.note.at);
      const u = { id: 1, name: "Ana", sid: -1, ap: 2, side: "player" };
      L.lockedLoot(st, b, u, holder, {}, []);
      if (b.raid.combos.includes(safe.lock.ref) && b.log.some((l) => /note|key on a tag/.test(l.text)) && holder !== safe) foundOk++;
    }
  }
  const r = (t) => counts[t][1] / Math.max(1, counts[t][0]);
  check(Math.abs(r(1) - 0.25) < 0.25 * 0.3 && Math.abs(r(2) - 0.15) < 0.15 * 0.3 && Math.abs(r(3) - 0.08) < 0.08 * 0.4, `the combination is written down: cheap ${pct(r(1))} (25%), mid ${pct(r(2))} (15%), high ${pct(r(3))} (8%)`);
  check(foundOk === tests && tests > 10, `searching the container with the note finds it and the safe's combination is known (${foundOk} of ${tests})`);
  check(bodyNotes > 0, `now and then the note is on a body (${bodyNotes})`);
  // Opening with it: silent, sure.
  const rr = safeRaid("gunsafe2", "dial");
  rr.b.raid.combos = [rr.c.lock.ref];
  const h0 = rr.b.raid.heat;
  const err = combatAct(rr.st, { type: "open", unit: rr.u.id, target: `c${rr.c.id}`, method: "combo" });
  check(!err && rr.c.lock.open && rr.b.raid.heat === h0 && (rr.b.noise || 0) === 0, "the combination opens the safe at once, silently");
}

// ======================================================================================
console.log("Contents by tier (rollGunStash)");
{
  const N = 3000;
  const stats = (tier, site) => {
    let guns = 0, ammo = 0, items = 0, minQ = 9, maxQ = 0, val = 0, gren = 0;
    const keys = {};
    for (let i = 0; i < N; i++) {
      const out = G.rollGunStash((...k) => hash01(seed, "gstest", tier, site, i, ...k), tier, site);
      for (const it of out.gear) {
        if (GEAR[it.key].slot === "weapon") { guns++; keys[it.key] = (keys[it.key] || 0) + 1; minQ = Math.min(minQ, it.quality); maxQ = Math.max(maxQ, it.quality); } else if (it.key === "flashbang" || it.key === "smokegren") gren++; // the flashbang branch's extra (gunsafes.js STASH_GRENADES)
        else { items++; val += GEAR[it.key].value; }
      }
      ammo += totalRounds(out.sup); // ammo.js: the rounds by calibre
    }
    return { guns: guns / N, ammo: ammo / N, items: items / N, minQ, maxQ, keys, gren: gren / N };
  };
  const ch = stats("cheap", "farm"), md = stats("mid", "gunstore"), hp = stats("high", "police"), hm = stats("high", "military"), pc = stats("pistolcase", "town"), rc = stats("riflecase", "town"), rcm = stats("riflecase", "military");
  console.log(`  cheap ${ch.guns.toFixed(2)} guns ${ch.ammo.toFixed(0)} ammo · mid ${md.guns.toFixed(2)} / ${md.ammo.toFixed(0)} · high (police) ${hp.guns.toFixed(2)} / ${hp.ammo.toFixed(0)} · high (military) ${hm.guns.toFixed(2)} / ${hm.ammo.toFixed(0)}`);
  check(near(ch.guns, 1.35, 0.05) && ch.minQ >= 0.6 && ch.maxQ <= 0.9 && near(ch.ammo, 20, 1.5) && Object.keys(ch.keys).every((k) => ["huntrifle", "shotgun", "leverrifle", "revolver"].includes(k)), `cheap: 1 gun, 35% a second (${ch.guns.toFixed(2)}), condition 0.6–0.9, ammo 10–30, hunting guns only`);
  check(near(md.guns, 3.08, 0.1) && md.minQ >= 0.75 && md.maxQ <= 1 && near(md.ammo, 55, 3) && near(md.items, 0.5, 0.05), `mid: 2–4 guns + the rare 8% (${md.guns.toFixed(2)}), condition 0.75–1, ammo 30–80 (${md.ammo.toFixed(0)}), valuables 50% (${md.items.toFixed(2)})`);
  check(near(hp.guns, 3.5, 0.1) && near(hp.ammo, 140, 6) && Object.keys(hp.keys).every((k) => ["pistol", "carbine", "shotgun"].includes(k)) && near(hp.items, 0.2, 0.04), `high (police, prison): 2–5 service guns (${hp.guns.toFixed(2)}), ammo 80–200, a riot helmet 20% (${hp.items.toFixed(2)})`);
  check(near(hm.guns, 3, 0.1) && near(hm.ammo, 175, 7) && Object.keys(hm.keys).every((k) => ["ar", "carbine"].includes(k)) && near(hm.items, 0.2, 0.04), `high (military): 2–4 rifles (${hm.guns.toFixed(2)}), ammo 100–250, a frag 20% (${hm.items.toFixed(2)})`);
  check(near(hp.gren, 1, 0.08) && near(hm.gren, 1, 0.08) && !ch.gren && !md.gren && !pc.gren, `an armoury safe (high) keeps 0–2 flashbangs or smoke grenades (police ${hp.gren.toFixed(2)}, military ${hm.gren.toFixed(2)}); nothing in the others`);
  check(pc.guns === 1 && Object.keys(pc.keys).every((k) => ["pistol", "revolver"].includes(k)) && near(pc.ammo, 10.5, 0.6), "a pistol case: one handgun, 6–15 rounds");
  check(rc.guns === 1 && !rc.keys.carbine && rcm.keys.carbine > 0 && near(rc.ammo, 12.5, 0.8), "a rifle case: one long gun, 5–20 rounds; a police carbine only at police or military sites");
  // A registered extra (a later stage: magazines, attachments) is applied.
  const off = G.registerStashExtra((ctx, out) => { if (ctx.tier === "mid") { out.gear.push(newItem("suppressor", 1)); out.sup.extra = 1; } });
  const withX = G.rollGunStash((...k) => hash01(seed, "x", ...k), "mid", "gunstore");
  const cheapX = G.rollGunStash((...k) => hash01(seed, "x", ...k), "cheap", "farm");
  off();
  const noX = G.rollGunStash((...k) => hash01(seed, "x", ...k), "mid", "gunstore");
  check(withX.gear.some((it) => it.key === "suppressor") && withX.sup.extra === 1 && !cheapX.gear.some((it) => it.key === "suppressor") && !noX.gear.some((it) => it.key === "suppressor"), "a registered extra is applied to the tiers it wants, and can be taken off again");
  check(Object.values(G.GUN_STASH).every((T) => Object.keys(T.guns).every((k) => GEAR[k])), "every gun in the stash tables is a real item");
}

// ======================================================================================
console.log("Gun cases: carried locked, opened at a base for free; a cased gun is not fielded");
{
  const st = world();
  const h = hub(st);
  let cs = null;
  for (let i = 0; i < 200 && !cs; i++) { const it = G.rollGunCase((...k) => hash01(seed, "case", i, ...k), "riflecase", "farm"); if (it.locked) cs = it; }
  const gun = cs.contents[0];
  check(cs.locked && gun && GEAR[gun.key].slot === "weapon" && totalRounds(cs.sup) >= 5, `a locked rifle case with a ${gun.name} and ${totalRounds(cs.sup)} rounds`);
  check(near(itemLoad(cs), GEAR.riflecase.weight + GEAR[gun.key].weight) && itemValue(cs) > GEAR.riflecase.value, `its weight and worth count the gun inside (${itemLoad(cs)} kg)`);
  let n = 0, l = 0;
  for (let i = 0; i < 2000; i++) { const it = G.rollGunCase((...k) => hash01(seed, "case2", i, ...k), "pistolcase", "town"); n++; if (it.locked) l++; }
  check(Math.abs(l / n - 0.4) < 0.05, `40% of cases are locked (${pct(l / n)})`);
  // In a raid: carried loose, opened with a blade (1 action, Heat +1).
  const r = safeRaid("gunsafe1", "key");
  const { b, u, s } = r;
  const cs2 = G.rollGunCase((...k) => hash01(seed, "case3", ...k), "pistolcase", "town");
  cs2.locked = true;
  u.haul.gear.push(cs2);
  const tg = L.caseTargets(r.st, b, u);
  check(tg.length === 1 && tg[0].ref === "kh0", "a case carried loose can be opened from the raid panel");
  let err = combatAct(r.st, { type: "open", unit: u.id, target: "kh0", method: "case" });
  check(/blade or a crowbar/.test(err), `a locked case needs a blade or a crowbar ("${err}")`);
  s.gear.weapon = newItem("knife");
  const h0 = b.raid.heat, ap0 = u.ap;
  err = combatAct(r.st, { type: "open", unit: u.id, target: "kh0", method: "case" });
  check(!err && !cs2.locked && u.haul.gear.some((it) => it && GEAR[it.key].slot === "weapon") && b.raid.heat - h0 === 1 && ap0 - u.ap === 1, `prised open with a knife: 1 action, Heat +1, the gun comes out loose (${err || "ok"})`);
  // A case in the base armory opens for free.
  st.combat = null;
  const cs3 = G.rollGunCase((...k) => hash01(seed, "case4", ...k), "riflecase", "farm");
  cs3.locked = true;
  h.armory.push(cs3);
  const ammo0 = totalRounds(h.stock), n0 = h.armory.length;
  const msg = G.openCaseAt(st, `armory:${h.id}:list:${h.armory.length - 1}`);
  check(!cs3.locked && !cs3.contents.length && h.armory.length === n0 + 1 && totalRounds(h.stock) > ammo0, `at a base it opens for free: the gun into the armory, the rounds into the stores ("${msg}")`);
  // The autopilot opens what comes home.
  const cs4 = G.rollGunCase((...k) => hash01(seed, "case5", ...k), "pistolcase", "town");
  h.armory.push(cs4);
  const got = G.openCasesIn(h.armory, h.stock);
  check(got.length > 0 && !cs4.contents.length, `cases brought home are opened (autopilot.js equipFromArmory): ${got.join(", ")}`);
  // A cased gun is not fielded and does not wear.
  const r2 = safeRaid("gunsafe1", "key", { from: 5 });
  const s2 = r2.s;
  s2.gear.weapon = null;
  const cs5 = G.rollGunCase((...k) => hash01(seed, "case6", ...k), "riflecase", "farm");
  givePack(s2);
  s2.gear.backpack.contents[0] = cs5;
  const q0 = cs5.contents[0].quality;
  r2.st.combat = null;
  r2.setup.raid = { heat0: 0 };
  const b2 = (r2.st.combat = createBattle(r2.st, r2.setup));
  const u2 = b2.units.find((x) => x.sid === s2.id);
  check(u2 && !u2.fielded.some(([, it]) => it === cs5.contents[0]) && u2.weapon !== cs5.contents[0].key, `a gun in a case is not fielded: ${s2.name.split(" ")[0]} fights with ${u2 ? u2.weapon : "?"}`);
  b2.units.filter((x) => x.side === "enemy").forEach((x) => { x.dead = true; });
  let g = 0;
  while (!b2.over && g++ < 60) { autoPlayerTurn(r2.st); runEnemyPhase(r2.st); }
  check(cs5.contents[0].quality === q0, "and it does not wear");
}

// ======================================================================================
console.log("The raid bot: Heat cap, never a blast");
{
  const r = safeRaid("gunsafe2", "keypad");
  const { st, b, c, u, s } = r;
  give(s, "powerdrill"); give(s, "pipebomb");
  b.pools.forEach((p) => { if (p) p.parts = 0; });
  b.raid.heat = 30; // a mid safe drilled: 3 turns × 3.2 Heat → 39.6, over the cap of 35
  let a = L.autoLock(st, b, u);
  check(!a && c.botSkip, `Heat 30: the bot does not start drilling a mid safe (it would end at ${L.drillEndHeat(b, L.openOdds(st, b, u, c.lock).drill).toFixed(1)}) and gives it up; it never blows it`);
  c.botSkip = false;
  b.raid.heat = 20;
  a = L.autoLock(st, b, u);
  check(a && a.method === "drill", `Heat 20: it drills (ends at ${L.drillEndHeat(b, L.openOdds(st, b, u, c.lock).drill).toFixed(1)})`);
  // An aware enemy close by: no drilling.
  const z = b.units.find((x) => x.side === "enemy");
  if (z) {
    z.dead = false; z.down = false; z.left = false; z.aware = true; z.f = 0; z.x = c.x; z.y = Math.min(b.h - 1, c.y + 3);
    c.botSkip = false;
    a = L.autoLock(st, b, u);
    check(!a, "an aware enemy within 8 tiles: no drilling");
    z.dead = true;
  }
  // Order: the key or the combination first, then bypass with a part at 40%+, crack only at Stealth 8.
  c.botSkip = false;
  b.raid.combos = [c.lock.ref];
  check(L.autoLock(st, b, u).method === "combo", "the combination first");
  b.raid.combos = [];
  b.pools[0].parts = 2;
  s.skills.mechanics = 2; // 40%
  check(L.autoLock(st, b, u).method === "bypass", "a part and 40%: bypass");
  s.skills.mechanics = 1; // 35%
  check(L.autoLock(st, b, u).method === "drill", "under 40%: no bypass (drills instead)");
  c.lock.mech = "dial";
  s.skills.stealth = 7;
  check(L.autoLock(st, b, u).method === "drill", "Stealth 7: no cracking");
  s.skills.stealth = 8;
  check(L.autoLock(st, b, u).method === "crack", "Stealth 8: crack");
  c.lock.cracks = 3;
  check(L.autoLock(st, b, u).method === "drill", "after 3 tries it stops cracking");
  // Full bot raids with drills and pipe bombs: they play to the end and never blow a safe.
  let raids = 0, crashes = 0, safes = 0, opened = 0, blown = 0, startedHot = 0;
  const how = {};
  for (let i = 0; i < 16; i++) {
    const rr = raidAt([["police", "gunstore", "military", "farm", "cabin", "lodge", "ranch", "prison"][i % 8]], { from: i * 4, want: (bb) => safesIn(bb).length > 0 });
    if (!rr) continue;
    rr.b.units.filter((x) => x.side === "enemy").forEach((x) => { x.dead = true; });
    for (const p of rr.crew) { p.skills.stealth = 8; p.skills.mechanics = 4; give(p, "powerdrill"); give(p, "pipebomb"); }
    // Watch every drill the bot starts: the Heat it projected must be under the cap.
    const list = safesIn(rr.b);
    try {
      let g = 0;
      while (!rr.b.over && g++ < 200) {
        const before = list.map((c) => c.lock.prog || 0);
        const heat = rr.b.raid.heat;
        autoPlayerTurn(rr.st);
        list.forEach((c, k) => { if (!before[k] && c.lock.prog && heat >= L.SAFE.bot.heatCap) startedHot++; });
        runEnemyPhase(rr.st);
      }
    } catch (e) { crashes++; console.log(e.stack); continue; }
    raids++;
    for (const c of list) { safes++; if (c.lock.open) { opened++; how[c.lock.how] = (how[c.lock.how] || 0) + 1; } if (c.lock.how === "blow" || c.lock.armed) blown++; }
  }
  check(raids >= 8 && !crashes, `the bot plays raids with gun safes to the end (${raids} raids, ${crashes} crashes)`);
  check(!blown && !startedHot, `it never blows a safe and never starts drilling at the Heat cap (${opened} of ${safes} safes opened: ${Object.entries(how).map(([k, v]) => `${k} ${v}`).join(", ") || "none"})`);
  check(opened > 0, "and it does open some");
}

// ======================================================================================
console.log("The hour-by-hour search");
{
  const st = world();
  const tile = st.tiles.find((t) => t.loc && t.loc.type === "gunstore") || st.tiles.find((t) => t.loc && t.loc.type === "police");
  const crew = [person(st, { stealth: 0, mechanics: 0 }), person(st, { stealth: 0, mechanics: 0 })];
  const run = (hours) => {
    const out = { found: 0, opened: 0, shut: 0, heat: [], lines: [] };
    for (let k = 0; k < hours; k++) {
      tile.loot = 1;
      const e = { tile: tile.id, hours: k, heat: 0, found: { gear: [], supplies: {} }, approach: "normal" };
      st.hour = 1000 + k;
      const line = L.gunSearchHour(st, e, null, crew);
      if (!/safe|cabinet/.test(line)) continue;
      out.found++;
      if (/stays shut/.test(line)) out.shut++;
      else if (/(Drilled|Cut|Cracked|Unlocked|Pried|Blew) open|Cracked/.test(line)) { out.opened++; out.heat.push(e.heat); out.lines.push(line); }
    }
    return out;
  };
  const none = run(600);
  check(none.found > 10 && none.opened === 0 && none.shut === none.found, `no drill, no safecracker, no key: every safe found stays shut (${none.found} found)`);
  give(crew[0], "powerdrill");
  crew[0].gear.backpack.contents.find((it) => it && it.key === "powerdrill").dur = 1000;
  const drilled = run(600);
  check(drilled.opened === drilled.found && drilled.heat.every((h) => h === 8 || h === 15), `with a drill: every one opened at +8 Heat (+15 for an armoury safe) (${drilled.opened} of ${drilled.found})`);
  crew[0].gear.backpack.contents = crew[0].gear.backpack.contents.map((it) => (it && it.key === "powerdrill" ? null : it));
  crew[1].skills.stealth = 10;
  const cracked = run(1200);
  check(cracked.opened > 0 && cracked.opened < cracked.found && cracked.heat.every((h) => h === 1), `a safecracker (Stealth 10): some cracked at +1 Heat (${cracked.opened} of ${cracked.found})`);
  check(cracked.lines.every((l) => /Cracked/.test(l)), "the search only opens them with a drill or a successful crack");
  // Tools on a workbench at a hardware store.
  const hw = st.tiles.find((t) => t.loc && t.loc.type === "hardware");
  let tools = 0;
  for (let k = 0; hw && k < 400; k++) { hw.loot = 1; const e = { tile: hw.id, hours: k, heat: 0, found: { gear: [], supplies: {} } }; st.hour = 5000 + k; L.gunSearchHour(st, e, null, crew); tools += e.found.gear.filter((it) => it.key === "powerdrill" || it.key === "anglegrinder").length; }
  check(!hw || tools > 0, `drills and grinders turn up in a hardware store's search (${tools} in 400 hours)`);
}

// ======================================================================================
console.log("The autopilot packs a drill");
{
  const st = world();
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2);
  for (const s of crew) givePack(s);
  h.armory.push(newItem("powerdrill"));
  const farm = st.tiles.find((t) => t.loc && t.loc.type === "farm");
  const shop = st.tiles.find((t) => t.loc && t.loc.type === "supermarket");
  const kit1 = shop ? packTripKit(st, h, crew, "scavenge", shop.id) : [];
  check(!kit1.includes(GEAR.powerdrill.name), "not to a supermarket");
  const kit2 = packTripKit(st, h, crew, "scavenge", farm.id);
  check(kit2.includes(GEAR.powerdrill.name) && !h.armory.some((it) => it.key === "powerdrill"), `to a farm: the drill goes along (${kit2.join(", ")})`);
}

// ======================================================================================
console.log("Save round-trip");
{
  const r = safeRaid("gunsafe3", "keypad");
  const { st, b, c, u, s } = r;
  give(s, "powerdrill");
  combatAct(st, { type: "open", unit: u.id, target: `c${c.id}`, method: "drill" });
  const cs = G.rollGunCase((...k) => hash01(seed, "savecase", ...k), "riflecase", "farm");
  cs.locked = true;
  u.haul.gear.push(cs);
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const b2 = back.combat;
  const c2 = b2.raid.containers.find((q) => q.id === c.id);
  const u2 = b2.units.find((q) => q.id === u.id);
  const cs2 = u2.haul.gear.find((it) => it && it.key === "riflecase");
  check(c2 && c2.lock.prog === c.lock.prog && c2.lock.prog > 0 && c2.lock.mech === "keypad" && c2.kind === "gunsafe", `a lock's drilling progress survives a save (${c2 && c2.lock.prog})`);
  check(cs2 && cs2.locked && cs2.contents[0].key === cs.contents[0].key && totalRounds(cs2.sup) === totalRounds(cs.sup), "a locked case and what is in it survive a save");
  const cells = b2.cells;
  check(cells[c.y * b2.w + c.x].k === "gunsafe", "the safe's cell too");
}

// ======================================================================================
console.log("Loot tags");
{
  const keys = ["powerdrill", "anglegrinder", "riflecase", "pistolcase"];
  check(keys.every((k) => GEAR[k] && ITEM_TAGS[k] && GEAR[k].desc && GEAR[k].weight > 0 && GEAR[k].value > 0), "the four new items have tags, a description, a weight and a value");
  check(Object.entries(G.GUN_FINDS).every(([a, f]) => Object.keys(f).every((k) => fitsTags(k, AREA_TAGS[a] || []))), "the raid finds fit their areas' themes");
  check(Object.entries(G.SEARCH_TOOLS).every(([t, f]) => Object.keys(f).every((k) => fitsTags(k, SITE_TAGS[t] || []))), "the search finds fit their sites' themes");
  check(near(GEAR.powerdrill.weight, 2.2) && GEAR.powerdrill.value === 25 && GEAR.powerdrill.dur === 3 && GEAR.anglegrinder.weight === 3 && GEAR.anglegrinder.value === 35 && GEAR.anglegrinder.dur === 4, "drill 2.2 kg / 25 / 3 safes; grinder 3 kg / 35 / 4");
  check(GEAR.riflecase.weight === 3.5 && GEAR.riflecase.value === 12 && GEAR.riflecase.bulky && GEAR.pistolcase.weight === 1 && GEAR.pistolcase.value === 6 && GEAR.pistolcase.small, "rifle case 3.5 kg / 12, bulky; pistol case 1 kg / 6, small");
}

// ======================================================================================
console.log("The screen: the safe drawn (both views), its buttons and its tooltip");
{
  const { battles } = await import("./isobattles.js");
  let nan = 0;
  const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, {
    get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; }),
    set: (o, k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nan++; o[k] = v; return true; },
  });
  const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
  globalThis.document = globalThis.document || { createElement: () => cvs(0, 0), getElementById: () => null };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  const ISO = await import("../src/ui/isoview.js");
  const UI = await import("../src/ui/combat.js");
  const UL = await import("../src/ui/locks.js");
  ISO.setIsoCanvas(cvs);
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
  const { st, b } = battles(31, ["raid"])[0];
  const c = b.raid.containers.find((q) => q.kind !== "body" && q.kind !== "car" && q.kind !== "pump" && !q.lock);
  b.cells[c.y * b.w + c.x].k = "gunsafe";
  c.kind = "gunsafe";
  c.lock = { kind: "gunsafe2", open: false, tries: 1, mech: "keypad", ref: `c${c.id}`, prog: 2 };
  const errs = [];
  for (const view of ["iso", "2d"]) {
    UI.setBattleView(view);
    try { UI.drawCombat(st, 1e9); } catch (e) { errs.push(`${view}: ${e.stack.split("\n").slice(0, 2).join(" ")}`); }
  }
  check(!errs.length && !nan, `a gun safe on the raid map draws in the iso view and the 2D view with no error or NaN${errs.length ? ` (${errs.join("; ")})` : ""}`);
  const u = b.units.find((x) => x.side === "player");
  u.x = c.x + 1; u.y = c.y;
  const s = survivorOf(st, u);
  give(s, "powerdrill");
  const html = UL.lockPanel(st, b, u);
  check(/data-m="drill"/.test(html) && /data-m="bypass"/.test(html) && /data-m="blow"/.test(html) && /Drilling 2\/6/.test(html) && !/data-m="crack"/.test(html), "the panel shows the keypad's ways in (bypass, drill, grind, blow) with the drilling progress bar");
  check(/Heat about \+3\.2 a turn/.test(html) && /wakes everything within 8/.test(html) && /about 2 turns/.test(html), "each button says its actions, turns, Heat a turn and how far it carries");
  const tip = UL.lockPreview(b, u, c.x, c.y);
  check(/Gun safe, mid tier, keypad/.test(tip) && /drilled 2\/6/.test(tip), `the tooltip: "${(tip.match(/Gun safe[^<]*/) || [""])[0]}"`);
  const cs = G.rollGunCase((...k) => hash01(seed, "uicase", ...k), "pistolcase", "town");
  u.haul = u.haul || { sup: {}, gear: [] };
  u.haul.gear.push(cs);
  check(/data-t="kh\d+"/.test(UL.lockPanel(st, b, u)), "a gun case carried shows an Open button");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
