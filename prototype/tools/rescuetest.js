// Rescue (rescueraid.js, ransom.js): getting your people back from the groups that hold them.
// The tactical rescue raid on their base's map (the cell and its lock, the ropes, the jailer's keys, weapons off bodies
// and out of their armory, guards who take the armory back and recapture captives, the way out), the card's by-the-
// numbers path, the ransom by radio with any group (raiders included: their price, a haggle, a prisoner exchange), the
// handover at a meeting point and its betrayal ambush, the autopilot's choice, and a save round-trip.
// Usage: node tools/rescuetest.js [seed=11]
import { createWorld, hub, makeSurvivor, survivorById, tickHour, day } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { launchExpedition, partyMembers, planPath, startReturn } from "../src/sim/parties.js";
import { takeCaptive, captivesOf, isCaptive, captivesDaily, rescueArrive, CAPTIVE_TOOL } from "../src/sim/conflicts.js";
import { combatAct, autoPlayerTurn, runEnemyPhase, closeCombat, endPlayerTurn, unitById, active, playerUnit } from "../src/sim/combat.js";
import * as RR from "../src/sim/rescueraid.js";
import * as RS from "../src/sim/ransom.js";
import { prisonersOf, takePrisonersAt } from "../src/sim/prisoners.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { setAutopilot, autopilotDaily, autopilotResolve } from "../src/sim/autopilot.js";
import { newItem } from "../src/sim/inventory.js";

const seed = Number(process.argv[2] || 11);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (process.env.V && ok) console.log(`  ok: ${msg}`); if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.noNewGangs = true; st.erasOff = true; st.noWanderers = true; return st; };
const pick = (card, re) => card.choices.find((c) => re.test(c.label));
const isOff = (st, ch) => (typeof ch.disabled === "function" ? ch.disabled(st) : !!ch.disabled);
// The sim opens tactical battles only "in a browser" (it checks typeof window). Tests that need one stub it.
const browser = (on) => { if (on) globalThis.window = {}; else delete globalThis.window; };

function raiders(st) {
  const f = st.factions.find((x) => x.alive && x.type === "raider" && x.bases.length) || st.factions.find((x) => x.alive && x.bases.length);
  f.type = "raider"; f.known = true; f.pop = Math.max(f.pop, 12);
  return f;
}
function captive(st, f, o = {}) {
  const s = makeSurvivor(st, 1);
  s.traits = []; s.health = o.health ?? 70;
  for (const k of Object.keys(s.skills)) s.skills[k] = o.skill ?? 4;
  if (o.stealth != null) s.skills.stealth = o.stealth;
  s.location = { kind: "base", baseId: hub(st).id };
  st.survivors.push(s);
  takeCaptive(st, s, f, null);
  return s;
}
function fighters(st, n, o = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = makeSurvivor(st, 1);
    s.traits = []; s.skills.shooting = o.shooting ?? 10; s.health = 100;
    s.gear.weapon = newItem(o.weapon || "huntrifle");
    s.gear.armor = newItem("vest");
    if (o.picks) s.gear.tool = newItem("crowbar");
    s.location = { kind: "base", baseId: hub(st).id };
    st.survivors.push(s);
    out.push(s);
  }
  return out;
}
// A team standing at their base (teleported there).
function teamAt(st, f, n, o = {}) {
  const crew = fighters(st, n, o);
  hub(st).stock.ammo = (hub(st).stock.ammo || 0) + 400;
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: f.bases[0], mission: "rescue", stance: "normal", supplies: { food: 10, water: 10, ammo: 200, meds: 3 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  p.path = [f.bases[0]]; p.idx = 0; p.phase = "engaged";
  return p;
}
// Plays the open battle with the AI on both sides; returns the battle (closed).
function playOut(st, maxTurns = 60, each = null) {
  const b = st.combat;
  for (let t = 0; t < maxTurns && st.combat === b && !b.over; t++) {
    if (each) each(b, t);
    if (b.over) break;
    autoPlayerTurn(st);
    if (!b.over && b.phase === "enemy") runEnemyPhase(st);
  }
  if (st.combat === b && b.over) closeCombat(st);
  return b;
}
const capUnits = (b) => b.units.filter((u) => u.captive);
const move = (st, b, u, x, y) => { u.x = x; u.y = y; };

section("The rescue raid's map: the cell, its lock, the jailer, the armory, your people tied up inside");
{
  const st = world();
  const f = raiders(st);
  const a = captive(st, f), c2 = captive(st, f);
  const p = teamAt(st, f, 4);
  browser(true);
  RR.startRescueRaid(st, p, f, "sneak");
  const b = st.combat;
  check(!!b && b.rescue && b.rescue.kind === "base", "a rescue raid opens on their base's map");
  const R = b.rescue;
  check(R.tier === "makeshift" && R.doors.some((d) => d.area === "cell" && d.diff === 1), `raiders keep them in a chain-link cage (difficulty 1): ${R.tier}`);
  const caps = capUnits(b);
  check(caps.length === 2 && caps.every((u) => u.tied && !active(u) && u.weapon === "fists"), "both captives are on the map, tied up and unarmed");
  check(caps.every((u) => R.cell.cells.some(([x, y]) => x === u.x && y === u.y)), "inside the cell");
  check(R.doors.filter((d) => d.area === "cell").every((d) => b.cells[d.y * b.w + d.x].k === "door"), "the cell's doors are locked");
  const j = unitById(b, R.jailer);
  check(!!j && j.cellKey && j.post === "door", "a jailer with the keys stands by the cell");
  check(!!R.armory && R.armory.items.length > 0, `their armory holds ${R.armory ? R.armory.items.length : 0} things`);
  check(b.units.filter((u) => u.side === "enemy").every((u) => !u.aware), "sneaking: nobody has seen you");
  check(combatAct(st, { type: "move", unit: caps[0].id, x: caps[0].x, y: caps[0].y }) !== "", "a tied captive cannot move");
  st.combat = null; browser(false);
}

section("Captives escape on their own: the ropes, a pin, the lock");
{
  const st = world(seed + 1);
  const f = raiders(st);
  const a = captive(st, f, { stealth: 10 });
  const p = teamAt(st, f, 3);
  browser(true);
  RR.startRescueRaid(st, p, f, "sneak");
  const b = st.combat;
  b.phase = "player";
  const u = capUnits(b)[0];
  // Nobody sees the cell (the guards look away): the ropes, until free.
  for (const g of b.units.filter((x) => x.side === "enemy")) g.x = g.x; // as placed
  let tries = 0;
  while (u.tied && tries < 30) { u.ap = 2; combatAct(st, { type: "rescue", unit: u.id, op: "ropes" }); tries++; }
  check(!u.tied && active(u), `a captive works free of the ropes (${tries} tries at ${Math.round(RR.ropeOdds(st, b, u) * 100)}%)`);
  // Pick the lock: odds with and without a tool.
  const d = b.rescue.doors.find((x) => x.area === "cell");
  const bare = RR.pickOdds(st, b, u, d).chance;
  u.pin = true;
  const pin = RR.pickOdds(st, b, u, d).chance;
  const s = survivorById(st, u.sid);
  s.gear.tool = newItem("crowbar");
  const picks = RR.pickOdds(st, b, u, d).chance;
  s.gear.tool = null;
  check(bare < pin && pin < picks, `picking: bare hands ${Math.round(bare * 100)}% < a pin ${Math.round(pin * 100)}% < lockpicks ${Math.round(picks * 100)}%`);
  // Next to the door (inside), pick it with the pin until open.
  const inside = b.rescue.cell.cells.find(([x, y]) => Math.max(Math.abs(x - d.x), Math.abs(y - d.y)) <= 1 && !b.units.some((o) => o !== u && o.x === x && o.y === y));
  move(st, b, u, inside[0], inside[1]);
  let n = 0;
  while (!d.open && n < 40) { u.ap = 2; combatAct(st, { type: "rescue", unit: u.id, op: "pick" }); n++; }
  check(d.open && b.cells[d.y * b.w + d.x].k === "odoor", `the lock picked with a pin (${n} tries)`);
  // Without any tool at all it still works, slower (a fresh door).
  u.pin = false;
  const d2 = { ...d, open: false, tries: 0 };
  b.rescue.doors.push(d2);
  b.cells[d.y * b.w + d.x].k = "door";
  let m = 0;
  while (!d2.open && m < 80) { u.ap = 2; combatAct(st, { type: "rescue", unit: u.id, op: "pick" }); m++; }
  check(d2.open, `bare-handed picking gets there too (${m} tries)`);
  // Searching the cell for a pin: once, about 30%.
  let found = 0;
  for (let i = 0; i < 400; i++) { const r = { ...b.rescue, searched: {} }; const v = { ...u, pin: false, ap: 2, id: u.id }; const old = b.rescue; b.rescue = r; const src = b.units.indexOf(u); b.units[src] = v; v.x = inside[0]; v.y = inside[1]; combatAct(st, { type: "rescue", unit: v.id, op: "search" }); if (v.pin) found++; b.units[src] = u; b.rescue = old; }
  check(found > 80 && found < 160, `a search turns up a pin about 30% of the time (${found}/400)`);
  st.combat = null; browser(false);
}

section("The jailer's keys: a captive downs him bare-handed, takes the keys, frees the others");
{
  const st = world(seed + 2);
  const f = raiders(st);
  const a = captive(st, f), b2 = captive(st, f), c3 = captive(st, f);
  const p = teamAt(st, f, 2);
  browser(true);
  RR.startRescueRaid(st, p, f, "sneak");
  const b = st.combat;
  b.phase = "player";
  const R = b.rescue;
  const [u, v, w] = capUnits(b);
  u.tied = false;
  const j = unitById(b, R.jailer);
  // Out of the cell next to the jailer (as if the door had been picked), and he goes down.
  const d = R.doors.find((x) => x.area === "cell");
  move(st, b, u, j.x + (j.x > 0 ? -1 : 1), j.y);
  if (b.units.some((o) => o !== u && o.x === u.x && o.y === u.y)) move(st, b, u, j.x, j.y + 1);
  let blows = 0;
  while (!j.dead && !j.down && blows < 60) { u.ap = 2; j.aware = true; const e = combatAct(st, { type: "melee", unit: u.id, target: j.id }); if (e) { j.hp = 0; j.dead = true; } blows++; }
  check(j.dead || j.down, `a captive brings the jailer down with fists (${blows} blows)`);
  // medics.js: a person brought to 0 goes down, bleeding, and lies across a cell; finished (a blow, Shift+K) he is a body.
  if (j.down && !j.dead) { u.ap = 2; combatAct(st, { type: "finish", unit: u.id, target: j.id }); }
  u.ap = 2;
  check(combatAct(st, { type: "rescue", unit: u.id, op: "key" }) === "" && R.keyUnit === u.id, "and takes his keys");
  // To the door, unlock it.
  const out = [[d.x - 1, d.y], [d.x + 1, d.y], [d.x, d.y - 1], [d.x, d.y + 1]].find(([x, y]) => b.cells[y * b.w + x] && ["open", "odoor"].includes(b.cells[y * b.w + x].k) && !R.cell.cells.some(([cx, cy]) => cx === x && cy === y) && !b.units.some((o) => o.x === x && o.y === y && !o.dead));
  move(st, b, u, out[0], out[1]);
  u.ap = 2;
  check(combatAct(st, { type: "rescue", unit: u.id, op: "unlock" }) === "" && R.doors.filter((x) => x.area === "cell").every((x) => x.open), "the keys open the cell");
  // In: cut the others free.
  move(st, b, u, v.x + (b.cells[v.y * b.w + v.x + 1] && !b.units.some((o) => o.x === v.x + 1 && o.y === v.y) ? 1 : -1), v.y);
  u.ap = 2;
  const e1 = combatAct(st, { type: "rescue", unit: u.id, op: "cut", target: v.id });
  check(e1 === "" && !v.tied && active(v), `a freed captive cuts another loose${e1 ? `: ${e1}` : ""}`);
  st.combat = null; browser(false);
}

section("Weapons: off a downed guard's body, and out of their armory (gone from their stock)");
{
  const st = world(seed + 3);
  const f = raiders(st);
  captive(st, f);
  const p = teamAt(st, f, 2);
  browser(true);
  RR.startRescueRaid(st, p, f, "assault");
  const b = st.combat;
  b.phase = "player";
  const R = b.rescue;
  const u = capUnits(b)[0];
  u.tied = false;
  const g = b.units.find((x) => x.side === "enemy" && !x.cellKey && x.weapon !== "fists" && GEAR[x.weapon]);
  g.dead = true; g.hp = 0;
  move(st, b, u, g.x + 1, g.y);
  if (b.units.some((o) => o !== u && o.x === u.x && o.y === u.y && !o.dead)) move(st, b, u, g.x - 1, g.y);
  const gun = g.weapon;
  u.ap = 2;
  const e = combatAct(st, { type: "rescue", unit: u.id, op: "grab" });
  const s = survivorById(st, u.sid);
  check(e === "" && s.gear.weapon && s.gear.weapon.key === gun && u.weapon === gun, `a captive takes the ${gun} off a dead guard and is armed with it at once${e ? `: ${e}` : ""}`);
  check(g.weapon === "fists", "the body has no gun left to loot twice");
  // The armory: open it (forced or unlocked), take the best weapon.
  const A = R.armory;
  for (const d of R.doors.filter((x) => x.area === "armory")) { d.open = true; b.cells[d.y * b.w + d.x].k = "odoor"; }
  const v = playerUnit(b, survivorById(st, partyMembers(st, p)[0].id)); // a stand-in to test the captive path below
  void v;
  const before = RR.groupArmory(st, f).length;
  const ammo0 = f.stock.ammo || 0;
  s.gear.weapon = null; u.weapon = "fists";
  const ring = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => [A.x + dx, A.y + dy]).find(([x, y]) => ["open", "odoor"].includes(b.cells[y * b.w + x].k) || b.cells[y * b.w + x].f === "floor" && !["wall", "window", "door", "locker"].includes(b.cells[y * b.w + x].k));
  move(st, b, u, ring[0], ring[1]);
  u.ap = 2;
  const e2 = combatAct(st, { type: "rescue", unit: u.id, op: "armory" });
  check(e2 === "" && s.gear.weapon && R.took.length >= 1, `the armory: ${R.took.map((it) => it.name).join(", ")}${e2 ? ` (${e2})` : ""}`);
  check(RR.groupArmory(st, f).length === before - R.took.length && (f.stock.ammo || 0) <= ammo0, `gone from their stock (${before} → ${RR.groupArmory(st, f).length} things, ammo ${ammo0} → ${f.stock.ammo || 0})`);
  // The arsenal work's store, when a group has one, is the one that shrinks.
  const st2 = world(seed + 4);
  const f2 = raiders(st2);
  // arsenal.js: the guards on the map carry their own kit; the rack holds the rest (three extra pieces here).
  const extra = [newItem("knife"), newItem("bat"), newItem("baton")]; // the worst pieces: no guard takes them up
  f2.arsenal = { items: [...Array.from({ length: 30 }, () => newItem("pistol")), ...extra], rev: 0 };
  const n2 = f2.arsenal.items.length;
  captive(st2, f2);
  const p2 = teamAt(st2, f2, 2);
  RR.startRescueRaid(st2, p2, f2, "assault");
  const b2 = st2.combat;
  check(b2.rescue.armory && b2.rescue.armory.items.length >= 3 && extra.every((it) => b2.rescue.armory.items.includes(it)) && b2.rescue.armory.items.every((it) => f2.arsenal.items.includes(it) && !b2.units.some((x) => x.arsItem === it)), "an arsenal's own items are on the rack (not the guns its guards carry)");
  for (const d of b2.rescue.doors.filter((x) => x.area === "armory")) { d.open = true; b2.cells[d.y * b2.w + d.x].k = "odoor"; }
  const u2 = capUnits(b2)[0];
  u2.tied = false;
  const A2 = b2.rescue.armory;
  const r2 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => [A2.x + dx, A2.y + dy]).find(([x, y]) => !["wall", "window", "door", "locker", "bars", "fence"].includes(b2.cells[y * b2.w + x].k));
  move(st2, b2, u2, r2[0], r2[1]);
  b2.phase = "player"; u2.ap = 2;
  combatAct(st2, { type: "rescue", unit: u2.id, op: "armory" });
  check(f2.arsenal.items.length < n2 && f2.arsenal.rev > 0, `the arsenal shrinks (${f2.arsenal.items.length} left of ${n2})`);
  // Out with it: extracted, the gear is theirs.
  st.combat = b;
  const s0 = survivorById(st, u.sid);
  const gear = s0.gear.weapon;
  for (const x of b.units.filter((o) => o.side === "player")) { x.left = true; x.tied = false; }
  b.units.filter((o) => o.side === "enemy").forEach((o) => { o.dead = true; });
  autoPlayerTurn(st);
  if (st.combat === b && b.over) closeCombat(st);
  check(!isCaptive(s0) && s0.gear.weapon === gear, `extracted, ${s0.name.split(" ")[0]} keeps the ${gear ? gear.name : "?"} and is with the team`);
  st.combat = null; st2.combat = null; browser(false);
}

section("Guards: the alarm, retaking the armory, recapturing a downed or cornered captive (stripped, re-tied)");
{
  const st = world(seed + 5);
  const f = raiders(st);
  captive(st, f);
  const p = teamAt(st, f, 3);
  browser(true);
  RR.startRescueRaid(st, p, f, "sneak");
  const b = st.combat;
  b.phase = "player";
  const R = b.rescue;
  const A = R.armory;
  // Someone of yours at the armory, the alarm up: the guards go to retake it.
  for (const d of R.doors.filter((x) => x.area === "armory")) { d.open = true; b.cells[d.y * b.w + d.x].k = "odoor"; }
  const u = capUnits(b)[0];
  u.tied = false;
  const s = survivorById(st, u.sid);
  const ring = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => [A.x + dx, A.y + dy]).find(([x, y]) => !["wall", "window", "door", "locker", "bars", "fence"].includes(b.cells[y * b.w + x].k) && !b.units.some((o) => o.x === x && o.y === y));
  move(st, b, u, ring[0], ring[1]);
  u.ap = 2;
  const count0 = RR.groupArmory(st, f).length;
  combatAct(st, { type: "rescue", unit: u.id, op: "armory" });
  const took = s.gear.weapon;
  check(!!took, `the captive armed from the rack (${took ? took.name : "nothing"})`);
  for (const g of b.units.filter((x) => x.side === "enemy")) g.aware = true;
  const before = RR.groupArmory(st, f).length;
  // The captive is beaten down (guards shoot to wound) and a guard stands next to him: taken back.
  u.hp = 0; u.down = true; u.stab = true;
  const g = b.units.find((x) => x.side === "enemy" && active(x) && !x.cellKey);
  const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [u.x + dx, u.y + dy]).find(([x, y]) => b.cells[y * b.w + x] && ["open", "odoor"].includes(b.cells[y * b.w + x].k) || (b.cells[y * b.w + x] && b.cells[y * b.w + x].f === "floor" && !["wall", "window", "door", "locker"].includes(b.cells[y * b.w + x].k) && !b.units.some((o) => o.x === x && o.y === y)));
  g.x = spot[0]; g.y = spot[1];
  combatAct(st, { type: "end" });
  runEnemyPhase(st);
  check(u.tied && !u.down && !s.gear.weapon && R.cell.cells.some(([x, y]) => x === u.x && y === u.y), "a downed armed captive is taken back: stripped and tied up in the cell again");
  check(RR.groupArmory(st, f).includes(took) && R.armory.items.includes(took), "the stripped weapon goes back to their armory");
  check(RR.groupArmory(st, f).length === count0 && before < count0, `their stock is whole again (${count0} → ${before} → ${RR.groupArmory(st, f).length})`);
  // The armory retaken: a guard walks there, re-arms if he can and posts himself.
  const mate = b.units.find((x) => x.side === "player" && !x.captive && active(x));
  if (mate) { const r2 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => [A.x + dx, A.y + dy]).find(([x, y]) => !["wall", "window", "door", "locker", "bars", "fence"].includes(b.cells[y * b.w + x].k) && !b.units.some((o) => o.x === x && o.y === y)); if (r2) { mate.x = r2[0]; mate.y = r2[1]; } }
  for (let t = 0; t < 12 && !A.held && !b.over; t++) { if (b.phase === "player") combatAct(st, { type: "end" }); runEnemyPhase(st); if (mate) { mate.hp = mate.maxHp; mate.down = false; } }
  check(A.held && b.units.some((x) => x.side === "enemy" && x.post === "door" && Math.max(Math.abs(x.x - A.x), Math.abs(x.y - A.y)) <= 1), `the guards retake the armory and post a guard (${R.retakers.length} sent)`);
  // Surrender: alone, hurt, 3 guards close.
  const st2 = world(seed + 6);
  const f2 = raiders(st2);
  captive(st2, f2);
  const p2 = teamAt(st2, f2, 1);
  RR.startRescueRaid(st2, p2, f2, "assault");
  const b2 = st2.combat;
  b2.phase = "player";
  const v = capUnits(b2)[0];
  v.tied = false; v.hp = 20;
  const mates2 = b2.units.filter((x) => x.side === "player" && !x.captive);
  for (const m of mates2) { m.x = 0; m.y = 0; }
  const near = [];
  for (let y = 0; y < b2.h && near.length < 3; y++) for (let x = 0; x < b2.w && near.length < 3; x++) if (Math.max(Math.abs(x - v.x), Math.abs(y - v.y)) <= 2 && (x !== v.x || y !== v.y) && !b2.units.some((o) => o.x === x && o.y === y)) near.push([x, y]);
  b2.units.filter((x) => x.side === "enemy").slice(0, 3).forEach((g2, i) => { g2.x = near[i][0]; g2.y = near[i][1]; g2.aware = true; });
  let gave = false;
  for (let i = 0; i < 20 && !gave; i++) { RR.rescueRound(st2, b2); gave = v.tied; }
  check(gave, "hurt, alone and surrounded by three guards, a captive gives up and is tied up again");
  st.combat = null; st2.combat = null; browser(false);
}

section("The whole raid played out: the team frees the captive and extracts; the captive comes home");
{
  let ok = 0, failsLeft = 0, tries = 0, home = 0;
  for (let k = 0; k < 6; k++) {
    const st = world(seed + 20 + k);
    const f = raiders(st);
    f.pop = 8;
    const a = captive(st, f);
    const p = teamAt(st, f, 5, { picks: true });
    browser(true);
    RR.startRescueRaid(st, p, f, "assault");
    const b = playOut(st, 80);
    browser(false);
    tries++;
    if (!isCaptive(a) && a.alive) {
      ok++;
      if (a.location.kind === "party" && st.parties.some((q) => q.id === a.location.partyId)) {
        const q = st.parties.find((x) => x.id === a.location.partyId);
        // Home: the team returns.
        for (let h = 0; h < 24 * 6 && st.parties.includes(q); h++) { if (q.phase === "waiting") { q.orders = []; startReturn(st, q); } tickHour(st); while (st.cards.length) { const c = st.cards.shift(); const ch = c.choices.find((x) => !isOff(st, x)); if (ch) ch.resolve(st); } }
        if (a.location.kind === "base") home++;
      }
    } else if (isCaptive(a)) failsLeft++;
    void b;
  }
  check(ok >= 3, `a strong team frees the captive and gets out in ${ok} of ${tries} raids (still held after a failed one: ${failsLeft})`);
  check(home >= 1, `and the captive comes home with the team (${home})`);
}

section("A failed raid leaves them captive");
{
  const st = world(seed + 40);
  const f = raiders(st);
  f.pop = 30;
  const a = captive(st, f);
  const p = teamAt(st, f, 1, { shooting: 1, weapon: "knife" });
  browser(true);
  RR.startRescueRaid(st, p, f, "assault");
  const b = st.combat;
  // Your one fighter runs at once.
  b.phase = "player";
  for (const u of b.units.filter((x) => x.side === "player" && !x.captive)) { u.left = true; }
  autoPlayerTurn(st);
  if (st.combat === b && b.over) closeCombat(st);
  browser(false);
  check(isCaptive(a) && a.alive && a.location.factionId === f.id, "the team gone, the captive is still held where they were");
}

section("Auto-resolved: the rescue card's by-the-numbers paths still work (and headless the map choices fall back to them)");
{
  let freed = 0, n = 0;
  for (let k = 0; k < 10; k++) {
    const st = world(seed + 60 + k);
    const f = raiders(st);
    f.pop = 6;
    const a = captive(st, f);
    const p = teamAt(st, f, 5);
    p.dest = f.bases[0];
    rescueArrive(st, p);
    const card = st.cards.find((c) => c.partyId === p.id);
    const ch = pick(card, /^Storm/);
    ch.resolve(st);
    n++;
    if (!isCaptive(a) && a.alive) freed++;
    if (k === 0) check(!card.choices.some((c) => /on the map/.test(c.label)), "headless, the card offers no map choices");
  }
  check(freed >= 6, `storming by the numbers with a strong team frees them most of the time (${freed}/${n})`);
  // With the battle screen, the card has the map choices and the by-the-numbers ones.
  const st = world(seed + 80);
  const f = raiders(st);
  captive(st, f);
  const p = teamAt(st, f, 3);
  p.dest = f.bases[0];
  browser(true);
  rescueArrive(st, p);
  const card = st.cards.find((c) => c.partyId === p.id);
  check(!!pick(card, /^Sneak in on the map/) && !!pick(card, /^Storm the base on the map/) && !!pick(card, /by the numbers/), "in the browser: Sneak in / Storm on the map, and by the numbers");
  pick(card, /^Storm by the numbers/).resolve(st);
  check(!st.combat, "by the numbers opens no battle screen");
  browser(false);
}

section("Without a raid: a pin or the keys they kept make an escape likelier");
{
  check(CAPTIVE_TOOL.key > CAPTIVE_TOOL.picks && CAPTIVE_TOOL.picks > CAPTIVE_TOOL.pin && CAPTIVE_TOOL.pin > 0, "keys > lockpicks > a pin");
  let plain = 0, keyed = 0;
  for (let k = 0; k < 2; k++) {
    const st = world(seed + 90 + k);
    const f = raiders(st);
    f.goodwill = -60;
    const list = [];
    for (let i = 0; i < 60; i++) list.push(captive(st, f, { stealth: 0 }));
    if (k === 1) for (const s of list) s.location.tool = "key";
    for (let d = 0; d < 20; d++) { st.hour += 24; captivesDaily(st); st.cards.length = 0; }
    const out = list.filter((s) => !isCaptive(s) && s.alive && s.location.kind === "base").length;
    if (k === 0) plain = out; else keyed = out;
  }
  check(keyed > plain, `escapes in 20 days: ${plain} plain, ${keyed} with the keys`);
}

RS && section("Ransom: by radio with raiders, haggling, a prisoner exchange");
{
  const st = world(seed + 100);
  const f = raiders(st);
  f.goodwill = -60;
  const a = captive(st, f, { skill: 6 });
  const h = hub(st);
  const offer = RS.ransomOffer(st, f, [a]);
  check(offer && offer.value > 0 && !offer.refused, `raiders name a price: ${offer.value} worth (${offer.wants.join(", ")})`);
  const low = captive(st, f, { skill: 1 });
  check(RS.ransomOffer(st, f, [low]).value < offer.value, "a less skilled captive is cheaper");
  const g0 = f.goodwill;
  f.goodwill = 40;
  const friendlier = RS.ransomOffer(st, f, [a]).value;
  f.goodwill = g0;
  check(friendlier < offer.value, `less hostile, cheaper (${friendlier} < ${offer.value})`);
  // Pay: by radio (a station at the hub, them in reach), the deal at a meeting point.
  h.radio = true;
  Object.assign(h.stock, { ammo: 2000, meds: 60, food: 400, fuel: 80 });
  const card = RS.negotiationCard(st, f, [a.id], { channel: "radio" });
  check(!!card && /radio/i.test(card.text), "the ransom talks by radio");
  const pay = pick(card, /^Agree/);
  check(!!pay && !isOff(st, pay), "the hub can pay");
  pay.resolve(st);
  const deal = RS.dealsOf(st).find((d) => d.factionId === f.id);
  check(!!deal && deal.tile != null && st.tiles[deal.tile], `raiders want a meeting point (tile ${deal && deal.tile})`);
  // The handover team: goes, the exchange happens (no betrayal forced off).
  RS.RANSOM.BETRAY_OFF = true;
  const sent = RS.sendHandover(st, deal);
  check(typeof sent === "object" && sent.party, `the handover team sets out${typeof sent === "string" ? `: ${sent}` : ""}`);
  const q = sent.party;
  q.path = [deal.tile]; q.idx = 0;
  RS.handoverArrive(st, q);
  const hc = st.cards.find((c) => c.partyId === q.id);
  check(!!hc && !!pick(hc, /^Make the exchange/), "at the meeting point: the exchange card");
  pick(hc, /^Make the exchange/).resolve(st);
  check(!isCaptive(a) && a.location.kind === "party", "the captive is handed over to the team");
  RS.RANSOM.BETRAY_OFF = false;
  // Haggle once: Speech decides, the price moves; not twice.
  const st2 = world(seed + 101);
  const f2 = raiders(st2);
  const b2 = captive(st2, f2, { skill: 5 });
  hub(st2).radio = true;
  let down = 0, up = 0;
  for (let i = 0; i < 40; i++) {
    const c = RS.negotiationCard(st2, f2, [b2.id], { channel: "radio" });
    const v0 = c.offer.value;
    pick(c, /^Haggle/).resolve(st2);
    const c2 = st2.cards.pop();
    if (c2.offer.value < v0) down++; else if (c2.offer.value > v0) up++;
    if (i === 0) check(!pick(c2, /^Haggle/), "only one haggle");
  }
  check(down > 0 && up > 0, `haggling: cheaper ${down} times, dearer ${up} (Speech)`);
  // A prisoner exchange: prisoners of yours (their own people count for more) for the captive.
  const st3 = world(seed + 102);
  const f3 = raiders(st3);
  f3.goodwill = 0;
  const c3 = captive(st3, f3, { skill: 4 });
  const h3 = hub(st3);
  h3.radio = true;
  takePrisonersAt(st3, f3, h3, 2);
  const prs = prisonersOf(st3).filter((x) => x.factionId === f3.id);
  const ex = RS.exchangeOffer(st3, f3, [c3]);
  check(ex && ex.prisoners.length >= 1 && ex.covers, `their own prisoners offered in exchange (${ex.prisoners.length}, worth ${ex.worth} against ${ex.price})`);
  const card3 = RS.negotiationCard(st3, f3, [c3.id], { channel: "radio" });
  const exCh = pick(card3, /^Offer a prisoner exchange/);
  check(!!exCh && !isOff(st3, exCh), "the exchange is a choice");
  exCh.resolve(st3);
  const deal3 = RS.dealsOf(st3).find((d) => d.factionId === f3.id);
  check(deal3 && deal3.prisonerIds.length >= 1, "the deal takes the prisoners along");
  RS.RANSOM.BETRAY_OFF = true;
  const s3 = RS.sendHandover(st3, deal3);
  const q3 = s3.party;
  check(prisonersOf(st3).filter((x) => x.at.kind === "party" && x.at.partyId === q3.id).length === deal3.prisonerIds.length, "the prisoners walk with the handover team");
  q3.path = [deal3.tile]; q3.idx = 0;
  RS.handoverArrive(st3, q3);
  pick(st3.cards.find((c) => c.partyId === q3.id), /^Make the exchange/).resolve(st3);
  check(!isCaptive(c3) && deal3.prisonerIds.every((id) => !prisonersOf(st3).some((x) => x.id === id)), "exchanged: the captive is back, the prisoners go home to them");
  RS.RANSOM.BETRAY_OFF = false;
  // A friendly group: no meeting point, they bring them home.
  const st4 = world(seed + 103);
  const f4 = st4.factions.find((x) => x.alive && x.type !== "raider" && x.type !== "zealot" && x.type !== "expansionist" && x.bases.length);
  if (f4) {
    f4.known = true; f4.goodwill = 30;
    const c4 = captive(st4, f4, { skill: 3 });
    hub(st4).radio = true;
    Object.assign(hub(st4).stock, { ammo: 2000, meds: 60, food: 400, fuel: 80, scrap: 300, parts: 40 });
    const card4 = RS.negotiationCard(st4, f4, [c4.id], { channel: "radio" });
    pick(card4, /^Agree/).resolve(st4);
    check(!RS.dealsOf(st4).some((d) => d.factionId === f4.id) && RS.returnsOf(st4).some((r) => r.sid === c4.id), `${f4.name} (${f4.type}) bring them home themselves`);
    for (let i = 0; i < 24 * 4 && isCaptive(c4); i++) { st4.hour++; RS.ransomHour(st4); }
    check(!isCaptive(c4) && c4.location.kind === "base", "and they arrive home");
  }
  // Zealots: refuse below goodwill unless you pay more.
  const st5 = world(seed + 104);
  const z = st5.factions.find((x) => x.alive && x.bases.length);
  z.type = "zealot"; z.known = true; z.goodwill = -70;
  const c5 = captive(st5, z);
  const o5 = RS.ransomOffer(st5, z, [c5]);
  check(o5.refused && o5.doubled > o5.value, `zealots refuse at goodwill −70 unless you pay double (${o5.doubled})`);
}

section("The betrayal ambush at the handover: about 15% with an even team, less with a strong one; a battle on the road");
{
  const st = world(seed + 120);
  const f = raiders(st);
  const rates = [];
  for (const n of [2, 6]) {
    const crew = fighters(st, n);
    const fake = { members: crew.map((s) => s.id), supplies: {}, cargo: { supplies: {}, gear: [] } };
    for (const s of crew) s.location = { kind: "party", partyId: -1 };
    rates.push(RS.betrayChance(st, fake, f, { captiveIds: [1] }));
  }
  check(rates[0] > rates[1] && rates[0] >= 0.1 && rates[0] <= 0.3, `betrayal: ${Math.round(rates[0] * 100)}% with 2, ${Math.round(rates[1] * 100)}% with 6`);
  // The roll at the meeting point over many deals.
  let betrayed = 0, total = 0;
  for (let k = 0; k < 120; k++) {
    const s2 = world(seed + 200 + (k % 4));
    s2.rng.state = (s2.rng.state + k * 7919) >>> 0;
    const g = raiders(s2);
    g.goodwill = -60;
    const c = captive(s2, g);
    hub(s2).radio = true;
    Object.assign(hub(s2).stock, { ammo: 3000, meds: 80, food: 500, fuel: 100 });
    const card = RS.negotiationCard(s2, g, [c.id], { channel: "radio" });
    pick(card, /^Agree/).resolve(s2);
    const d = RS.dealsOf(s2)[0];
    const sent = RS.sendHandover(s2, d, { crew: 3 });
    if (!sent.party) continue;
    sent.party.path = [d.tile]; sent.party.idx = 0;
    RS.handoverArrive(s2, sent.party);
    const hc = s2.cards.find((x) => x.partyId === sent.party.id);
    pick(hc, /^Make the exchange/).resolve(s2);
    total++;
    if (s2.cards.some((x) => /Betrayal/.test(x.title))) betrayed++;
  }
  check(total > 80 && betrayed / total > 0.06 && betrayed / total < 0.3, `betrayed at ${betrayed} of ${total} handovers (${Math.round((betrayed / Math.max(1, total)) * 100)}%)`);
  // A betrayal: the battle on the road, the captive tied up behind their line.
  const s3 = world(seed + 130);
  const g3 = raiders(s3);
  const c3 = captive(s3, g3);
  hub(s3).radio = true;
  Object.assign(hub(s3).stock, { ammo: 3000, meds: 80, food: 500, fuel: 100 });
  pick(RS.negotiationCard(s3, g3, [c3.id], { channel: "radio" }), /^Agree/).resolve(s3);
  const d3 = RS.dealsOf(s3)[0];
  const q3 = RS.sendHandover(s3, d3, { crew: 4 }).party;
  q3.path = [d3.tile]; q3.idx = 0;
  RS.RANSOM.BETRAY_FORCE = true;
  RS.handoverArrive(s3, q3);
  pick(s3.cards.find((x) => x.partyId === q3.id), /^Make the exchange/).resolve(s3);
  RS.RANSOM.BETRAY_FORCE = false;
  const bc = s3.cards.find((x) => /Betrayal/.test(x.title));
  check(!!bc, "betrayed: the ambush card");
  browser(true);
  pick(bc, /^Fight/).resolve(s3);
  const b = s3.combat;
  check(!!b && b.rescue && b.rescue.kind === "road" && capUnits(b).length === 1 && capUnits(b)[0].tied && b.setup.ambush === "enemy", "a battle on the road: they have the drop on you, the captive tied up behind their line");
  const cargo0 = Object.values(q3.cargo.supplies).reduce((x, y) => x + y, 0);
  const fought = playOut(s3, 60);
  browser(false);
  const won = fought.result && fought.result.outcome === "victory";
  const freed = !isCaptive(c3);
  const cargo1 = s3.parties.includes(q3) ? Object.values(q3.cargo.supplies).reduce((x, y) => x + y, 0) : 0;
  check(won ? freed && cargo1 > 0 : cargo1 < cargo0, `after the ambush (${fought.result && fought.result.outcome}): ${won ? "won, the captive and the goods kept" : `they kept the goods${freed ? ", but the captive got out with the team" : " and the captive"}`} (cargo ${cargo0} → ${cargo1})`);
  // By the numbers (headless): win and both are yours, lose and they keep both.
  let wins = 0, kept = 0;
  for (let k = 0; k < 8; k++) {
    const s4 = world(seed + 300 + k);
    const g4 = raiders(s4);
    const c4 = captive(s4, g4);
    hub(s4).radio = true;
    Object.assign(hub(s4).stock, { ammo: 3000, meds: 80, food: 500, fuel: 100 });
    pick(RS.negotiationCard(s4, g4, [c4.id], { channel: "radio" }), /^Agree/).resolve(s4);
    const d4 = RS.dealsOf(s4)[0];
    fighters(s4, 4);
    const q4 = RS.sendHandover(s4, d4, { crew: 4 }).party;
    q4.path = [d4.tile]; q4.idx = 0;
    RS.RANSOM.BETRAY_FORCE = true;
    RS.handoverArrive(s4, q4);
    pick(s4.cards.find((x) => x.partyId === q4.id), /^Make the exchange/).resolve(s4);
    RS.RANSOM.BETRAY_FORCE = false;
    const g0 = (g4.stock.meds || 0);
    pick(s4.cards.find((x) => /Betrayal/.test(x.title)), /^Fight/).resolve(s4);
    if (!isCaptive(c4)) { wins++; if (s4.parties.includes(q4) && (q4.cargo.supplies.meds || 0) > 0) kept++; }
    else if ((g4.stock.meds || 0) <= g0) check(false, "lost by the numbers: they should have the goods");
  }
  check(wins > 0 && kept === wins, `by the numbers: won ${wins} of 8, the goods kept each time (${kept})`);
}

section("The autopilot: a ransom first when it can afford it, a rescue raid when strong and the captive is worth it");
{
  const st = world(seed + 140);
  const f = raiders(st);
  f.jails = { [f.bases[0]]: 3 }; // jailhouse: a cell for them (with none they would be sold on, freed by a military buyer, or killed), and a tight one (the ransom under test, not an escape)
  const a = captive(st, f, { skill: 5 });
  setAutopilot(st, true, "balanced");
  hub(st).radio = true;
  Object.assign(hub(st).stock, { ammo: 3000, meds: 80, food: 600, fuel: 120, water: 400 });
  const plan = RS.autoRescuePlan(st, a);
  check(plan && plan.kind === "ransom", `rich: ransom first (${plan && plan.kind}: ${plan && plan.why})`);
  const st2 = world(seed + 141);
  const f2 = raiders(st2);
  f2.pop = 6;
  const b2 = captive(st2, f2, { skill: 8 });
  setAutopilot(st2, true, "balanced");
  for (const k of Object.keys(hub(st2).stock)) if (["ammo", "meds", "fuel", "food"].includes(k)) hub(st2).stock[k] = Math.min(hub(st2).stock[k], 5);
  fighters(st2, 6);
  const plan2 = RS.autoRescuePlan(st2, b2);
  check(plan2 && plan2.kind === "raid", `poor but strong, a valuable captive: a rescue raid (${plan2 && plan2.kind}: ${plan2 && plan2.why})`);
  const st3 = world(seed + 142);
  const f3 = raiders(st3);
  f3.pop = 40;
  const c3 = captive(st3, f3, { skill: 2 });
  setAutopilot(st3, true, "balanced");
  for (const k of ["ammo", "meds", "fuel", "food"]) hub(st3).stock[k] = 0;
  const plan3 = RS.autoRescuePlan(st3, c3);
  check(!plan3 || plan3.kind === "wait", `poor, weak, a low-value captive: wait (${plan3 ? plan3.kind : "none"})`);
  // The governor's day: the ransom is agreed and the handover team sent.
  autopilotDaily(st);
  const viaEnvoy = RS.talksOf(st).some((t) => t.factionId === f.id);
  for (let h = 0; h < 96 && !st.parties.some((q) => q.mission === "handover"); h++) { tickHour(st); autopilotResolve(st); }
  check(st.parties.some((q) => q.mission === "handover" && q.dealId != null), `the governor agrees the ransom${viaEnvoy ? " (by envoy: no radio reaches them)" : ""} and sends the handover team`);
}

section("Save round-trip: a deal, a return, a rescue raid mid-battle");
{
  const st = world(seed + 160);
  const f = raiders(st);
  const a = captive(st, f);
  hub(st).radio = true;
  Object.assign(hub(st).stock, { ammo: 3000, meds: 80, food: 500, fuel: 100 });
  pick(RS.negotiationCard(st, f, [a.id], { channel: "radio" }), /^Agree/).resolve(st);
  for (const c of [...st.cards]) { st.cards.splice(st.cards.indexOf(c), 1); pick(c, /^Later/).resolve(st); } // answered: saves wait for open cards
  const c2 = captive(st, f);
  const p = teamAt(st, f, 3);
  browser(true);
  RR.startRescueRaid(st, p, f, "sneak");
  const b = st.combat;
  b.phase = "player";
  const st2 = deserializeState(serializeState(st));
  const b2 = st2.combat;
  check(RS.dealsOf(st2).length === RS.dealsOf(st).length && RS.dealsOf(st2)[0].tile === RS.dealsOf(st)[0].tile, "the deal survives a save");
  check(b2 && b2.rescue && b2.rescue.doors.length === b.rescue.doors.length && capUnits(b2).length === capUnits(b).length && capUnits(b2).every((u) => u.tied), "the rescue raid survives a save, captives tied up");
  check(b2.rescue.armory && b2.rescue.armory.items.length === b.rescue.armory.items.length, "and its armory");
  const end = playOut(st2, 40);
  check(end.over, "the loaded raid plays to its end");
  browser(false);
}

section("No blows across a wall's corner (combat.js cornerBlocked: the player's Melee, the battle AI, the rescue reach)");
{
  const st = world(seed + 170);
  const f = raiders(st);
  captive(st, f);
  const p = teamAt(st, f, 1);
  browser(true);
  RR.startRescueRaid(st, p, f, "assault");
  const b = st.combat;
  b.phase = "player";
  const me = b.units.find((u) => u.side === "player" && !u.captive);
  const foes = b.units.filter((u) => u.side === "enemy");
  const g = foes[0];
  for (const o of foes.slice(1)) { o.dead = true; o.hp = 0; } // one guard left, the field otherwise quiet
  for (const o of capUnits(b)) { o.x = 0; o.y = 0; }
  // A clear 3 × 3 patch of open ground, then a wall corner between the two.
  let at = null;
  for (let y = 2; y < b.h - 3 && !at; y++) for (let x = 2; x < b.w - 3 && !at; x++) {
    let ok = true;
    for (let dy = -1; dy <= 2 && ok; dy++) for (let dx = -1; dx <= 2 && ok; dx++) { const c = b.cells[(y + dy) * b.w + x + dx]; ok = c.k === "open" && !(c.h > 0); }
    if (ok) at = [x, y];
  }
  const [x, y] = at;
  me.x = x; me.y = y; g.x = x + 1; g.y = y + 1;
  g.weapon = "machete"; g.weaponName = "Machete"; g.aware = true; g.hp = g.maxHp;
  const W2 = (k1, k2) => { b.cells[y * b.w + x + 1].k = k1; b.cells[(y + 1) * b.w + x].k = k2; if (b.losCache) b.losCache.fill(0); };
  W2("wall", "wall");
  me.ap = 2;
  const e = combatAct(st, { type: "melee", unit: me.id, target: g.id });
  check(/corner/.test(e) && me.ap === 2 && !(await import("../src/sim/combat.js")).meleeReach(b, me, g), `diagonally past two walls: no blow (${e})`);
  W2("idoor", "wall");
  check(/corner/.test(combatAct(st, { type: "melee", unit: me.id, target: g.id })), "a wall and a closed door: still no blow");
  { const SL = await import("../src/sim/stealth.js"); check(!SL.canSubdue(me, g, b) && SL.canSubdue(me, g), "no takedown (Subdue) across it either"); }
  W2("crate", "sandbag");
  check((await import("../src/sim/combat.js")).meleeReach(b, me, g), "low cover (crates, sandbags) does not block a blow");
  W2("open", "wall");
  me.ap = 2;
  const e2 = combatAct(st, { type: "melee", unit: me.id, target: g.id });
  check(e2 === "" && me.ap === 0, `one side open: the blow lands or misses (${e2 || "struck"})`);
  // The AI: a guard with a machete across the corner does not strike through it.
  W2("wall", "wall");
  me.hp = me.maxHp; me.ap = 0; me.ow = false;
  const hp0 = me.hp;
  const log0 = b.log.length;
  combatAct(st, { type: "end" });
  // Only the guard's own step (the rescue's guard logic and the usual AI).
  for (let i = 0; i < 50 && b.phase === "enemy" && !b.over; i++) { const CB = await import("../src/sim/combat.js"); CB.enemyStep(st); }
  const struck = b.log.slice(log0).some((l) => l.text.includes(`strikes ${me.name}`) || l.text.includes(`lunges at ${me.name}`));
  const stayed = g.x === x + 1 && g.y === y + 1;
  check(!(struck && stayed), `the guard does not strike across the corner (${struck ? "struck after moving" : "no blow"}, hp ${hp0} → ${me.hp})`);
  st.combat = null;
  browser(false);
}

section("One notion of tied: a captive, an enemy knocked out and tied, a teammate the guards tied");
{
  const CB = await import("../src/sim/combat.js");
  check(!CB.active({ tied: true }) && CB.isTied({ tied: true }) && CB.active({}), "anyone tied is not active, whatever side");
  const st = world(seed + 175);
  const f = raiders(st);
  captive(st, f);
  const p = teamAt(st, f, 2);
  browser(true);
  RR.startRescueRaid(st, p, f, "assault");
  const b = st.combat;
  b.phase = "player";
  const [m1, m2] = b.units.filter((u) => u.side === "player" && !u.captive);
  // A teammate knocked out and tied by the guards: no ropes to work (out cold), cut loose by the other; still out cold.
  m2.x = m1.x + 1; m2.y = m1.y;
  if (b.units.some((o) => o !== m2 && o.x === m2.x && o.y === m2.y)) m2.y = m1.y + 1;
  m2.down = true; m2.ko = true; m2.tied = true; m2.stab = true;
  check(!RR.rescueOptions(st, b, m2).length, "knocked out and tied: no ropes to work");
  m1.ap = 2;
  const e = combatAct(st, { type: "rescue", unit: m1.id, op: "cut", target: m2.id });
  check(e === "" && !m2.tied && m2.ko && m2.down, `cut loose, still out cold${e ? ` (${e})` : ""}`);
  // An enemy tied up by your side is a prisoner, as before (stealth.js).
  const g = b.units.find((u) => u.side === "enemy");
  g.down = true; g.ko = true; g.tied = true;
  check(!CB.active(g) && !RR.rescueOptions(st, b, m1).some((o) => o.op === "cut" && o.ok && /Raider|Guard/.test(o.tip)), "a tied enemy is nobody's to cut loose");
  // A freed captive who gives up (nonlethal: surr) with a guard next to them is taken back and tied in the cell again.
  const cu = capUnits(b)[0];
  cu.tied = false; cu.surr = true; cu.down = true;
  const g2 = b.units.find((u) => u.side === "enemy" && u !== g && CB.active(u));
  for (const m of [m1, m2]) { m.x = 0; m.y = 0; }
  const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [cu.x + dx, cu.y + dy]).find(([x, y]) => b.cells[y * b.w + x] && ["open", "odoor"].includes(b.cells[y * b.w + x].k) || (b.cells[y * b.w + x] && b.cells[y * b.w + x].f === "floor" && !["wall", "window", "door", "locker", "bars", "fence"].includes(b.cells[y * b.w + x].k) && !b.units.some((o) => o.x === x && o.y === y)));
  g2.x = spot[0]; g2.y = spot[1]; g2.aware = true;
  RR.rescueRound(st, b);
  check(cu.tied && !cu.surr && !cu.down && RR.captiveStays !== undefined, "a captive who surrendered is taken back: tied, not down, no longer surrendered");
  // Knocked out at the end of a failed raid: still their captive (not taken a second time, not finished off).
  const s = survivorById(st, cu.sid);
  const captured0 = st.stats.conflicts.captured;
  cu.tied = false; cu.ko = true; cu.down = true;
  for (const m of b.units.filter((u) => u.side === "player" && !u.captive)) m.left = true;
  CB.endBattleNow(st, "retreat");
  closeCombat(st);
  check(isCaptive(s) && s.alive && st.stats.conflicts.captured === captured0, "knocked out when the team pulls out: still held, once");
  st.combat = null;
  browser(false);
}

section("On screen: the captive's line on the People tab, the rescue buttons in battle, the Help topic");
{
  const UI = await import("../src/ui/ui.js");
  const UC = await import("../src/ui/combat.js");
  const { helpTopics } = await import("../src/ui/help.js");
  const bad = /undefined|NaN|\[object/;
  const text = (h) => h.replace(/<[^>]*>/g, " ");
  const st = world(seed + 180);
  const f = raiders(st);
  const a = captive(st, f);
  const html = UI.renderLeft(st, { tab: "people" });
  check(/Held by/.test(html) && /since day \d+/.test(html) && /data-action="plan"[^>]*data-mission="rescue"/.test(html) && /data-action="rescue-talk"/.test(html) && !bad.test(text(html)), "the People tab: held by X at Y since day N, Plan a rescue and Negotiate");
  hub(st).radio = true;
  Object.assign(hub(st).stock, { ammo: 3000, meds: 80, food: 500, fuel: 100 });
  pick(RS.negotiationCard(st, f, [a.id], { channel: "radio" }), /^Agree/).resolve(st);
  st.cards.length = 0;
  const html2 = UI.renderLeft(st, { tab: "people" });
  check(/Ransom agreed/.test(html2) && /data-action="rescue-send"/.test(html2), "a deal agreed: its line and Send the handover team");
  const p = teamAt(st, f, 2);
  browser(true);
  RR.startRescueRaid(st, p, f, "sneak");
  const b = st.combat;
  b.phase = "player";
  const cu = capUnits(b)[0];
  for (const u of b.units) if (u.side === "player") u.ap = u === cu ? 2 : 0;
  UC.combatAction(st, "cb-sel", { id: cu.id });
  let ph = UC.renderCombatPanel(st);
  check(/Work the ropes/.test(ph) && /data-v="rescue:ropes"/.test(ph) && /Tied up \(captive\)/.test(ph) && !bad.test(text(ph)), "a tied captive's panel: Work the ropes");
  UC.combatAction(st, "cb-act", { v: "rescue:ropes" });
  check(cu.ap === 1 || !cu.tied, "the button works the ropes (1 action)");
  cu.tied = false; cu.ap = 2;
  UC.combatAction(st, "cb-sel", { id: cu.id });
  ph = UC.renderCombatPanel(st);
  check(/Search the cell/.test(ph) && /Cut free/.test(ph) && !bad.test(text(ph)), `free in the cell: Search the cell, Cut free${bad.test(text(ph)) ? ` (bad text: ${text(ph).match(bad)})` : ""}`);
  st.combat = null;
  browser(false);
  const t = helpTopics().find((x) => x.id === "getting-captives-back");
  check(!!t && /Negotiate/.test(t.html) && /meeting point/.test(t.html), "Help: Getting captives back");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
