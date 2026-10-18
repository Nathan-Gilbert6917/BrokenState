// The battle AI and the lights (src/sim/ailights.js; the user's request of 2026-10-12: "make non-zombie enemies switch
// lights on when alerted, move into a building with the lights off etc and friendly AI groups"): an unaware guard at
// night keeps his flashlight off and switches it on when alerted; an alerted guard in a dark room flips its switch on
// (1 action) from next to it, or walks to it first when it is within a move and nothing is in sight; an unaware one
// leaves it; an investigating guard lights up to look; by day in a lit room a light is put away; your side under the
// AI (the raid bot) keeps its lights off while unseen and switches them on once found; the dead never touch a switch.
// Usage: node tools/ailightstest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { createBattle, registerCombatHandler, alertPod, endPlayerTurn, runEnemyPhase } from "../src/sim/combat.js";
import { setFacing, activeLight } from "../src/sim/vision.js";
import { roomLit, switchOptions } from "../src/sim/indoorlight.js";
import { aiFlashlight, aiRoomLights, wakeLights, inTheKnow } from "../src/sim/ailights.js";

const seed = Number(process.argv[2] || 300);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
registerCombatHandler("alt", () => {});

// A raid on a farm's farmhouse at this hour (as tools/indoorlighttest.js).
function raidAt(building, hour) {
  for (let i = 0; i < 60; i++) {
    const st = createWorld({ seed: seed + i, factionCount: 6 });
    st.cards.length = 0;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && ["farm", "ranch"].includes(t.loc.type) && t.id !== h.tile);
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, 2);
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4, ammo: 30, meds: 2 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    st.hour = 24 * 3 + hour;
    st.combat = createBattle(st, { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "alt", enemy: { kind: "mixed", count: 0, power: 3, groups: [{ kind: "raiders", count: 1, power: 3 }] }, raid: { heat0: 0, building }, context: {} });
    return { st, b: st.combat };
  }
  return null;
}
// One guard and your two people, all on the ground floor; the guard carries a flashlight.
function cast(b) {
  const me = b.units.filter((u) => u.side === "player");
  const e = b.units.find((u) => u.side === "enemy" && u.kind === "human");
  b.units = [...me, e];
  for (const u of b.units) { u.f = 0; u.away = false; }
  e.light = "flashlight"; e.lightOff = !e.aware; e.nvg = false;
  return { u: me[0], w: me[1], e };
}
const powered = (b) => b.raid.areas.filter((a) => !a.outdoor && a.sw && a.swIn && (a.f || 0) === 0);
const free = (b, x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h && !b.units.some((o) => o.x === x && o.y === y);
// A floor cell of room a next to its switch (switchOptions holds), other than its swIn cell.
function besideSwitch(b, u, a, notIn = false) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = a.sw[0] + dx, y = a.sw[1] + dy;
    if (!free(b, x, y) || b.cells[y * b.w + x].k !== "open" || (notIn && x === a.swIn[0] && y === a.swIn[1])) continue;
    const ox = u.x, oy = u.y;
    u.x = x; u.y = y;
    if (switchOptions(b, u).includes(a)) return [x, y];
    u.x = ox; u.y = oy;
  }
  return null;
}

console.log("Flashlights: off at the post, on when alerted");
{
  const r = raidAt("farmhouse", 23);
  check(!!r && r.b.night && r.b.indoor === 1, "a night raid into a farmhouse");
  const { b } = r;
  const { e } = cast(b);
  e.aware = false; e.lightOff = true;
  check(!inTheKnow(b, e) && !aiFlashlight(b, e) && !activeLight(e), "an unaware guard at night keeps his flashlight off");
  alertPod(b, e.pod, "test");
  check(e.aware && activeLight(e) === "flashlight", "alerted: he switches it on at once");
  e.aware = false; e.lightOff = true; e.investigate = { x: e.x + 1, y: e.y, turns: 2 };
  check(aiFlashlight(b, e) && activeLight(e), "going to look at a noise: on");
  delete e.investigate;
}

console.log("Room lights: an alerted guard lights the dark room he is in");
{
  const r = raidAt("farmhouse", 23);
  const { b } = r;
  const { e } = cast(b);
  const rooms = powered(b);
  check(rooms.length > 0 && rooms.every((a) => !roomLit(b, a)), `${rooms.length} powered rooms, all dark at night`);
  let a = null, at = null;
  for (const q of rooms) { at = besideSwitch(b, e, q); if (at) { a = q; break; } }
  check(!!at, "a guard next to a switch inside its room");
  if (at) {
    e.x = at[0]; e.y = at[1]; e.aware = false; e.ap = 2;
    check(!aiRoomLights(b, e) && !roomLit(b, a), "unaware: he leaves it dark");
    e.aware = true;
    check(aiRoomLights(b, e) && roomLit(b, a) && e.ap === 1, "aware: he flips it on (1 action)");
    a.on = false;
    // From further in the room, nothing in sight: he walks to it first.
    let far = null;
    for (let y = a.y0 + 1; y < a.y0 + a.h - 1 && !far; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) {
      if (!free(b, x, y) || b.cells[y * b.w + x].k !== "open" || Math.max(Math.abs(x - a.sw[0]), Math.abs(y - a.sw[1])) < 2 || Math.hypot(x - a.swIn[0], y - a.swIn[1]) > 3) continue;
      far = [x, y]; break;
    }
    for (const u of b.units) if (u.side === "player") { u.x = 0; u.y = 0; }
    if (far) {
      e.x = far[0]; e.y = far[1]; e.ap = 2;
      check(aiRoomLights(b, e) && roomLit(b, a) && e.ap === 0 && e.x === a.swIn[0] && e.y === a.swIn[1], `from further in: he walks to the switch and flips it (both actions)`);
    } else console.log("  (no cell a move from the switch in this room)");
  }
}

console.log("By day: lights put away; the dead never switch");
{
  const r = raidAt("farmhouse", 12);
  const { b } = r;
  const { e } = cast(b);
  e.aware = true; e.light = "flashlight"; e.lightOff = false;
  const room = powered(b).find((a) => !a.dark);
  if (room) { e.x = room.x0 + 1; e.y = room.y0 + 1; }
  aiFlashlight(b, e);
  check(!activeLight(e), "aware by day in a lit room: the flashlight is off");
  const z = { ...e, kind: "zombie", id: 9999, light: "flashlight", lightOff: true };
  check(!aiFlashlight(b, z) && !aiRoomLights(b, z), "the dead: no light, no switch");
}

console.log("Your side under the AI (the raid bot, volunteers)");
{
  const r = raidAt("farmhouse", 23);
  const { b } = r;
  const { u, e } = cast(b);
  u.light = "headlamp"; u.lightOff = false; u.nvg = false;
  e.aware = false;
  aiFlashlight(b, u, true);
  check(!activeLight(u), "the team not found yet: the bot keeps its headlamp off");
  e.aware = true;
  aiFlashlight(b, u, true);
  check(activeLight(u) === "headlamp", "found: on");
  u.lightOff = true;
  check(!aiFlashlight(b, u, false) && !activeLight(u), "your own people under your orders: never touched");
  u.nvg = true; u.nvgOff = false; u.lightOff = false;
  aiFlashlight(b, u, true);
  check(!activeLight(u), "night vision on: the light stays off");
}

console.log("A night raid played out: the AI turns run with the lights");
{
  const r = raidAt("farmhouse", 23);
  const { st, b } = r;
  b.units.filter((x) => x.side === "enemy").forEach((x) => { x.aware = true; });
  let ok = true;
  try { for (let t = 0; t < 4 && !b.over; t++) { endPlayerTurn(st); runEnemyPhase(st); } } catch (err) { ok = false; console.log(err.stack); }
  check(ok, "four enemy turns at night in a building, no error");
  wakeLights(b, b.units);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
