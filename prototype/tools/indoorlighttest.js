// Light inside a raid's buildings (src/sim/indoorlight.js; the user's request of 2026-10-12: "Barns are dark inside;
// buildings can have light switches to turn on/off lights"): a barn is dark inside by day and has no switch; a
// farmhouse by day is lit and its rooms have switches beside their doors; a dark room is seen only down the night cone
// (a light's beam and night vision as at night), from inside and from outside it; an unaware guard notices someone in
// a dark room as at night; at night every room starts dark; Lights (1 action, next to the switch, inside the room or
// in its doorway) lights the room: seen as by day by both sides, and back off again; the light state survives a save;
// a street map's barn is dark too; a battle that is not a raid keeps the old rules; the battle screen (stub canvases):
// the Lights button next to a switch, Alt+K, the hover texts, the dark and lit rooms drawn without error.
// Usage: node tools/indoorlighttest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { createBattle, combatAct, registerCombatHandler, canSeeAt, playerVision } from "../src/sim/combat.js";
import { noticeRange } from "../src/sim/stealth.js";
import { setFacing } from "../src/sim/vision.js";
import { INDOOR, LIT, DARK, lightAt, roomAt, switchAt, switchOptions, roomCells } from "../src/sim/indoorlight.js";
import { serializeState, deserializeState } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 300);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
registerCombatHandler("ilt", () => {});
const D = Math.PI / 180;

// A raid on a farm (a farmhouse and a barn) at this hour, into this building ("street": the street map).
function raidAt(building, hour, types = ["farm", "ranch"]) {
  for (let i = 0; i < 60; i++) {
    const st = createWorld({ seed: seed + i, factionCount: 6 });
    st.cards.length = 0;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && types.includes(t.loc.type) && t.id !== h.tile);
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, 2);
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4, ammo: 30, meds: 2 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    st.hour = 24 * 3 + hour;
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "ilt", enemy: { kind: "mixed", count: 0, power: 3, groups: [{ kind: "raiders", count: 1, power: 3 }] }, raid: { heat0: 0, building }, context: {} };
    st.combat = createBattle(st, setup);
    return { st, b: st.combat, tile };
  }
  return null;
}
// Clear a room's floor (furniture out of the way of the sight lines), keep one enemy, park the rest.
function clearRoom(b, a) {
  for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) { const c = b.cells[y * b.w + x]; if (c.k !== "stairs" && c.k !== "ladder") { c.k = "open"; delete c.h; delete c.t; } }
  b.losCache.fill(0);
}
function cast(b) {
  const me = b.units.filter((u) => u.side === "player");
  const e = b.units.find((u) => u.side === "enemy" && u.kind === "human") || b.units.find((u) => u.side === "enemy");
  b.units = [...me, e].filter(Boolean);
  for (const u of b.units) { u.f = 0; u.away = false; }
  for (const u of me) { u.light = null; u.lightOff = false; u.nvg = false; u.optic = 0; u.vsight = 0; u.ap = 2; u.sneak = 0; u.ghost = false; u.stealth = 4; }
  return { u: me[0], w: me[1], e };
}
const place = (u, x, y, ang = null) => { u.x = x; u.y = y; if (ang != null) setFacing(u, ang); };
// Is (x, y) a cell of room a's floor?
const inRoom = (a, x, y) => x > a.x0 && x < a.x0 + a.w - 1 && y > a.y0 && y < a.y0 + a.h - 1;

console.log("A barn by day: dark inside, no switch");
{
  const r = raidAt("barn", 12);
  check(!!r && r.b.raid.interior && r.b.raid.interior.key === "barn" && !r.b.night && r.b.indoor === 1, `a raid into the barn at noon (${r && r.b.w}x${r && r.b.h})`);
  const { b } = r;
  const fl = b.raid.areas.find((a) => a.role === "barnfloor");
  check(fl && fl.dark && !fl.sw && !fl.on, "the barn floor is dark by day and has no light switch (no power)");
  check(b.raid.areas.filter((a) => !a.outdoor && a.role).every((a) => !a.sw), "no room of the barn has a switch");
  const { u, e } = cast(b);
  clearRoom(b, fl);
  const cx = fl.x0 + 2, cy = fl.y0 + Math.floor(fl.h / 2);
  check(lightAt(b, cx, cy) === DARK && roomAt(b, cx, cy) === fl, "a cell of its floor is dark at noon");
  place(u, cx, cy, 0);
  const far = Math.min(fl.x0 + fl.w - 2, cx + 7);
  check(canSeeAt(b, u, cx + INDOOR.DARK, cy) && !canSeeAt(b, u, cx + INDOOR.DARK + 1, cy), `without a light: ${INDOOR.DARK} tiles ahead down the cone, not ${INDOOR.DARK + 1}`);
  check(canSeeAt(b, u, cx - 1, cy) && (cx - 3 <= fl.x0 || !canSeeAt(b, u, cx - 3, cy)), "behind: only the cells right round them");
  check(far - cx < 6 || !canSeeAt(b, u, far, cy), "the far end of the barn is not seen without a light");
  u.light = "flashlight";
  check(far - cx < INDOOR.DARK + 1 || canSeeAt(b, u, far, cy), `a flashlight switched on: its beam shows the far end (${far - cx} tiles)`);
  u.lightOff = true;
  check(far - cx < INDOOR.DARK + 1 || !canSeeAt(b, u, far, cy), "switched off it shows nothing");
  u.light = null; u.lightOff = false; u.nvg = true;
  check(far - cx < INDOOR.DARK + 1 || canSeeAt(b, u, far, cy), "night vision sees the day's sight down the cone");
  u.nvg = false;
  const vis = playerVision(b);
  check(!vis[cy * b.w + Math.min(fl.x0 + fl.w - 2, cx + INDOOR.DARK + 2)] && vis[cy * b.w + cx + 2], "the fog of war inside follows the cone");
  // A guard notices someone in the dark barn as at night; outside in the sun as by day.
  if (e) {
    place(e, cx + 3, cy, Math.PI);
    const inDark = noticeRange(b, e, u);
    const yard = { ...u, x: fl.x0 + Math.floor(fl.w / 2), y: fl.y0 + fl.h + 2 };
    check(lightAt(b, yard.x, yard.y) === 0, "the yard outside is outdoors (the day's own light)");
    const inSun = noticeRange(b, e, yard);
    check(inDark < inSun, `an unaware guard notices someone in the dark barn closer (${inDark}) than in the sun (${inSun})`);
    // The guard in the dark sees down its own cone too (both sides alike).
    e.aware = true;
    place(u, cx, cy, 0);
    check(canSeeAt(b, e, cx, cy) && !canSeeAt(b, e, cx + 5, cy), "a guard in the dark sees the dark ahead, not behind it");
  }
}

console.log("A farmhouse by day: lit, switches by the doors");
{
  const r = raidAt("farmhouse", 12);
  check(!!r && r.b.raid.interior && r.b.raid.interior.key === "farmhouse" && !r.b.night, "a raid into the farmhouse at noon");
  const { b } = r;
  const rooms = b.raid.areas.filter((a) => !a.outdoor && a.role);
  const living = rooms.find((a) => a.role === "living");
  check(living && !living.dark && !living.on, "the living room is lit by day (daylight through the windows)");
  const withSw = rooms.filter((a) => a.sw);
  check(withSw.length >= rooms.length - 1, `the rooms have light switches (${withSw.length} of ${rooms.length})`);
  const cellsOf = (a) => (b.floors && b.floors[a.f || 0] ? b.floors[a.f || 0].cells : b.cells);
  check(withSw.every((a) => cellsOf(a)[a.sw[1] * b.w + a.sw[0]].k === "wall" && inRoom(a, a.swIn[0], a.swIn[1]) && Math.abs(a.sw[0] - a.swIn[0]) + Math.abs(a.sw[1] - a.swIn[1]) === 1), "every switch is a wall cell of its room with the room's floor in front of it");
  check(withSw.filter((a) => (a.doors || []).some((d) => Math.abs(d[0] - a.sw[0]) + Math.abs(d[1] - a.sw[1]) === 1)).length >= withSw.length * 0.6, "most switches are right beside a door");
  check(new Set(withSw.map((a) => `${a.f || 0}:${a.sw}`)).size === withSw.length, "no two rooms share a switch");
  const { u } = cast(b);
  clearRoom(b, living);
  const cx = living.x0 + Math.floor(living.w / 2), cy = living.y0 + Math.floor(living.h / 2);
  place(u, cx, cy, 0);
  check(lightAt(b, cx, cy) === LIT && canSeeAt(b, u, living.x0 + 1, cy), "by day in a lit room they see all round (behind them too)");
  check(roomCells(b, "dark").every((i) => rooms.some((a) => a.dark && inRoom(a, i % b.w, (i / b.w) | 0))), "by day only the windowless rooms are drawn dark");
}

console.log("At night: every room dark until its lights are on");
{
  const r = raidAt("farmhouse", 23);
  check(!!r && r.b.night, "a raid into the farmhouse at 23:00");
  const { st, b } = r;
  const rooms = b.raid.areas.filter((a) => !a.outdoor && a.role && (a.f || 0) === 0);
  check(rooms.every((a) => !a.on && lightAt(b, a.x0 + 1, a.y0 + 1, 0) === DARK), "every room starts dark");
  const room = rooms.find((a) => a.sw && a.w >= 5 && a.h >= 4) || rooms.find((a) => a.sw);
  const { u, w, e } = cast(b);
  clearRoom(b, room);
  const [ix, iy] = room.swIn;
  // Facing away from the far side of the room: in the dark, only the cells right round them.
  const farX = ix <= room.x0 + 1 ? room.x0 + room.w - 2 : room.x0 + 1, farY = iy <= room.y0 + 1 ? room.y0 + room.h - 2 : room.y0 + 1;
  const away = Math.atan2(iy - farY, ix - farX);
  place(u, ix, iy, away);
  if (w) place(w, -50, -50);
  if (w) w.left = true;
  if (e) { place(e, -40, -40); e.left = true; }
  const farSeen0 = canSeeAt(b, u, farX, farY);
  check(!farSeen0 || Math.hypot(farX - ix, farY - iy) < 1.6, `in the dark, facing away, the far corner (${farX},${farY}) is not seen`);
  // Not next to the switch: refused, no action spent.
  place(u, farX, farY, away);
  const err0 = combatAct(st, { type: "lights", unit: u.id });
  check(!!err0 && u.ap === 2 && !room.on, `away from the switch: refused (${err0})`);
  place(u, ix, iy, away);
  check(switchOptions(b, u).includes(room) && switchAt(b, room.sw[0], room.sw[1], 0) === room, "standing in front of it the switch is in reach");
  const err = combatAct(st, { type: "lights", unit: u.id });
  check(!err && room.on && u.ap === 1, `Lights: 1 action, the room lit (${err || "ok"})`);
  check(lightAt(b, ix, iy, 0) === LIT && canSeeAt(b, u, farX, farY), "lit: seen as by day (the far corner, behind them)");
  check(roomCells(b, "lit").length === (room.w - 2) * (room.h - 2), "the lit room's floor is drawn lit");
  // The doorway of a lit room is lit; a dark room next door stays dark.
  const other = rooms.find((a) => a !== room && !a.on);
  check(!other || lightAt(b, other.x0 + 1, other.y0 + 1, 0) === DARK, "the room next door stays dark");
  // Both sides: a guard in the lit room sees it all round and notices as by day; in a dark one as at night.
  if (e) {
    e.left = false;
    const ex = room.x0 + 1 === ix ? room.x0 + room.w - 2 : room.x0 + 1;
    place(e, ex, iy, Math.PI / 2);
    e.aware = false;
    const litR = noticeRange(b, e, u);
    room.on = false;
    const darkR = noticeRange(b, e, u);
    room.on = true;
    check(litR > darkR, `an unaware guard notices someone in the lit room further off (${litR}) than in the dark (${darkR})`);
    e.aware = true;
    check(canSeeAt(b, e, ix, iy) || Math.hypot(ex - ix, 0) > (e.daySight ?? 13), "an aware guard in the lit room sees across it, facing any way");
    place(e, -40, -40); e.left = true;
  }
  // Saved and loaded: the room is still lit, the switches where they were.
  const st2 = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const b2 = st2.combat, room2 = b2.raid.areas.find((a) => a.id === room.id && (a.f || 0) === (room.f || 0));
  check(b2.indoor === 1 && room2 && room2.on && room2.sw && room2.sw[0] === room.sw[0] && room2.sw[1] === room.sw[1] && lightAt(b2, ix, iy, 0) === LIT, "the save keeps the light state and the switches");
  check(b2.raid.areas.filter((a) => a.dark).length === b.raid.areas.filter((a) => a.dark).length, "and which rooms are dark by day");
  // Off again.
  u.ap = 2;
  const err2 = combatAct(st, { type: "lights", unit: u.id });
  check(!err2 && !room.on && lightAt(b, ix, iy, 0) === DARK && u.ap === 1, "Lights again: off, dark again (1 action)");
}

console.log("The street map's barns; a battle that is not a raid");
{
  const sr = raidAt("street", 12, ["farm", "ranch"]);
  const sbarn = sr && sr.b.raid.areas.find((a) => a.type === "barn" && !a.outdoor && a.x0 != null);
  const found = sbarn ? { ...sr, barn: sbarn } : null;
  if (found) {
    const { b, barn } = found;
    check(barn.dark && !barn.sw && lightAt(b, barn.x0 + 1, barn.y0 + 1) === DARK, "a barn on the street map is dark inside by day, no switch");
    const other = b.raid.areas.find((a) => !a.outdoor && a.x0 != null && a.type !== "barn");
    check(!other || (!other.dark && lightAt(b, other.x0 + 1, other.y0 + 1) === LIT), "another building there is lit by day");
  } else console.log("  (no street map with a barn for this seed)");
  // Your own base's battle: no indoor rules.
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true; st.hour = 24 * 3 + 12;
  const h = hub(st);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: atBase(st, h.id).slice(0, 2).map((s) => s.id), enemy: { kind: "raiders", count: 1, power: 3, name: "Test" }, ambush: "player", canRetreat: false, handler: "ilt", context: {} });
  check(!st.combat.indoor && lightAt(st.combat, 1, 1) === 0, "a battle at your own base has no indoor light rules");
}

console.log("The battle screen: the Lights button, the key, the hover, the drawing");
{
  // Stub canvases (as tools/battleviewtest.js): every draw call checked for NaN.
  let nan = 0;
  const ctx2d = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }), getLineDash: () => [] }, {
    get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; }),
    set: (o, k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nan++; o[k] = v; return true; },
  });
  const cvs = (w, h) => ({ width: w, height: h, getContext: () => ctx2d(), toDataURL: () => "data:," });
  globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  const ISO = await import("../src/ui/isoview.js");
  const UI = await import("../src/ui/combat.js");
  const K = await import("../src/ui/keymap.js");
  ISO.setIsoCanvas(cvs);
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => ctx2d() });
  K.initKeymap({});
  check(K.keyAction({ code: "KeyK", altKey: true, shiftKey: false, ctrlKey: false, metaKey: false }, "battle") === "battle.lights" && !K.conflicts().length, "Alt+K is Lights in a battle, no clash with any other key");
  let clock = 1e6;
  const draw = (st) => { try { clock += 50; UI.drawCombat(st, clock); return ""; } catch (e) { return e.stack.split("\n").slice(0, 3).join(" "); } };
  const r = raidAt("farmhouse", 23);
  const { st, b } = r;
  const room = b.raid.areas.find((a) => !a.outdoor && a.role && a.sw && (a.f || 0) === 0);
  const { u } = cast(b);
  for (const o of b.units) if (o !== u) { o.left = true; o.x = -30; o.y = -30; }
  place(u, room.swIn[0], room.swIn[1], 0);
  UI.cui.sel = u.id; UI.cui.mode = "move";
  const html0 = UI.renderCombatPanel(st);
  check(/data-v="lights"[^>]*>Lights on/.test(html0), "next to the switch the panel offers Lights on");
  UI.cui.hover = { x: room.sw[0], y: room.sw[1], px: 400, py: 300 };
  const hov = UI.renderCombatPanel(st);
  check(/Light switch: off/.test(hov) && /to flip it \(1 action/.test(hov), "hovering the switch: Light switch: off, how to flip it");
  clearRoom(b, room);
  b.raid.containers = b.raid.containers.filter((c) => !inRoom(room, c.x, c.y));
  const hx = room.swIn[0] === room.x0 + 1 ? room.x0 + 2 : room.x0 + 1, hy = room.swIn[1];
  UI.cui.hover = { x: hx, y: hy, px: 400, py: 300 };
  const hov2 = UI.renderCombatPanel(st);
  check(/Dark inside/.test(hov2), "hovering the dark room: Dark inside");
  UI.cui.hover = null;
  check(draw(st) === "" && nan === 0, "the dark farmhouse at night draws (switch markers), no error or NaN");
  UI.combatKey(st, { code: "KeyK", altKey: true, shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
  check(room.on && u.ap === 1, "Alt+K flips the switch in reach (1 action)");
  check(/Lights off/.test(UI.renderCombatPanel(st)) && draw(st) === "" && nan === 0, "lit: the button says Lights off; the lit room draws");
  const rb = raidAt("barn", 12);
  const fl = rb.b.raid.areas.find((a) => a.role === "barnfloor");
  const cb = cast(rb.b);
  for (const o of rb.b.units) if (o !== cb.u) { o.left = true; o.x = -30; o.y = -30; }
  place(cb.u, fl.x0 + 2, fl.y0 + 2, 0); cb.u.light = "flashlight";
  UI.cui.sel = cb.u.id;
  check(draw(rb.st) === "" && nan === 0 && !/data-v="lights"/.test(UI.renderCombatPanel(rb.st)), "the dark barn by day draws (shaded, a flashlight's beam), no Lights button (no switch)");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
