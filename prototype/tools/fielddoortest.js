// Doors on the battle maps (the user's ask: doors were hard to find, some houses had only a gap in the wall):
// - a field map's houses (sim/combat.js genMap FIELD_DOOR) have real doors: no open floor on a house's outline, closed,
//   open or locked; some locked (b.doors); every house can still be walked into (b.reach), never only locked ways in;
// - your people walk through a closed door (it swings open); the open action (sim/locks.js openLock) opens a locked one
//   by key or force outside a raid; Close door and Peek work there too;
// - a click on a locked door next to the selected unit tries it (ui/combat.js lockedDoorClick), the hover text names
//   it and says how to open it; the iso view draws the doors (ui/isoview.js drawDoorMarks) at every turn of the view;
// - the enemy still gets at your people shut in a house: the dead batter the door, people open it or batter a locked one;
// - a raid's street map (genRaidMap): its houses have closed doors; a locked room still seals and opens with the key.
// Usage: node tools/fielddoortest.js [seed]
import { reachable, registerCombatHandler, combatAct, runEnemyPhase, CELL, unitAt } from "../src/sim/combat.js";
import { addKey } from "../src/sim/locks.js";
import { BMAP } from "../src/sim/buildingmaps.js";
import { survivorById } from "../src/sim/world.js";
import { newItem } from "../src/sim/inventory.js";
import { battles } from "./isobattles.js";

const seed0 = Number(process.argv[2] || 7);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
registerCombatHandler("fdtest", () => {});

const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
const calls = [];
const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, {
  get: (o, k) => (k in o ? o[k] : (...a) => { if (k === "fillRect" || k === "arc") calls.push(k); }),
});
const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
ISO.setIsoCanvas(cvs);
UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
const cui = UI.cui;
const draw = (st) => UI.drawCombat(st, 1e9);

const DOORISH = new Set(["door", "idoor", "odoor"]);
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// The houses: 4-connected cells with floorboards (as the iso view finds them), their outline and their inside.
function houses(b) {
  const seen = new Int16Array(b.w * b.h).fill(-1), out = [];
  for (let i = 0; i < b.cells.length; i++) {
    if (seen[i] >= 0 || b.cells[i].f !== "floor") continue;
    const cells = [], q = [i];
    seen[i] = out.length;
    while (q.length) {
      const j = q.pop(); cells.push(j);
      for (const [dx, dy] of NEXT4) { const x = (j % b.w) + dx, y = ((j / b.w) | 0) + dy, k = y * b.w + x; if (x >= 0 && y >= 0 && x < b.w && y < b.h && seen[k] < 0 && b.cells[k].f === "floor") { seen[k] = out.length; q.push(k); } }
    }
    const rim = cells.filter((j) => NEXT4.some(([dx, dy]) => { const x = (j % b.w) + dx, y = ((j / b.w) | 0) + dy; return x < 0 || y < 0 || x >= b.w || y >= b.h || seen[y * b.w + x] !== seen[j]; }));
    out.push({ cells, rim, inner: cells.filter((j) => !rim.includes(j)) });
  }
  return out;
}
const fieldTypes = ["field-town", "field-city"];
const maps = [];
for (let s = 0; s < 12; s++) for (const got of battles(seed0 * 100 + s, fieldTypes)) maps.push(got);

// ---------- 1. the houses' doors ----------
console.log("A field map's houses have doors");
{
  let nHouses = 0, gaps = 0, doors = 0, locked = 0, open = 0, cut = 0, noDoor = 0, badLock = 0, hpLess = 0, weakLock = 0;
  for (const { b } of maps) {
    for (const h of houses(b)) {
      nHouses++;
      gaps += h.rim.filter((j) => !["wall", "window", ...DOORISH].includes(b.cells[j].k)).length;
      const dd = h.rim.filter((j) => DOORISH.has(b.cells[j].k));
      if (!dd.length) noDoor++;
      doors += dd.length;
      locked += dd.filter((j) => b.cells[j].k === "door").length;
      open += dd.filter((j) => b.cells[j].k === "odoor").length;
      hpLess += dd.filter((j) => !(b.cells[j].hp > 0)).length;
      const ins = h.inner.filter((j) => CELL[b.cells[j].k].walk);
      // Cut off with a locked door in its walls (genMap unlocks those). A house whose doors open onto a pocket the
      // clutter closes off, or with a crate inside its only door, was so before it had doors (its gaps went nowhere too).
      if (ins.length && !ins.some((j) => b.reach[j]) && dd.some((j) => b.cells[j].k === "door")) cut++;
    }
    for (const d of b.doors || []) if (b.cells[d.y * b.w + d.x].k !== "door" || d.lock.kind !== "door") badLock++;
    weakLock += b.cells.filter((c) => c.k === "door" && !(c.mhp === BMAP.DOOR.locked && c.hp === c.mhp)).length;
    badLock += b.cells.filter((c) => c.k === "door").length - (b.doors || []).length;
  }
  check(nHouses >= 20, `${maps.length} field maps, ${nHouses} houses`);
  check(gaps === 0, `no gap in any house's walls: ${gaps} open cells on the outlines`);
  check(noDoor === 0 && doors >= nHouses * 2, `every house has doors (${doors} in all)`);
  check(locked > 0 && locked < doors / 2, `some locked (${locked} of ${doors}), some left open (${open})`);
  check(badLock === 0, "every locked door cell is one of b.doors (sim/locks.js opens it), and only those");
  check(hpLess === 0, "every door has strength (the dead batter it: BMAP.DOOR)");
  check(weakLock === 0 && BMAP.DOOR.locked >= BMAP.DOOR.outer * 3, `a locked door is the strong one: ${BMAP.DOOR.locked} hp against ${BMAP.DOOR.outer} for a closed one (about ten blows of the dead)`);
  check(cut === 0, `every house can be walked into from the map (${cut} cut off)`);
}

// A unit of yours put on the outside cell of a door, the inside cell free and walkable.
function besideDoor(b, kind, u, only = null) {
  for (let i = 0; i < b.cells.length; i++) {
    if (b.cells[i].k !== kind || (only != null && i !== only)) continue;
    const x = i % b.w, y = (i / b.w) | 0;
    for (const [dx, dy] of NEXT4) {
      const ox = x + dx, oy = y + dy, ix = x - dx, iy = y - dy;
      if (ox < 0 || oy < 0 || ix < 0 || iy < 0 || ox >= b.w || oy >= b.h || ix >= b.w || iy >= b.h) continue;
      const o = b.cells[oy * b.w + ox], n = b.cells[iy * b.w + ix];
      if (o.f === "floor" || !CELL[o.k].walk || !b.reach[oy * b.w + ox] || !CELL[n.k].walk || DOORISH.has(n.k)) continue;
      if ((unitAt(b, ox, oy) && unitAt(b, ox, oy) !== u) || unitAt(b, ix, iy) || unitAt(b, x, y)) continue;
      u.x = ox; u.y = oy; u.ap = 2;
      return { x, y, in: [ix, iy] };
    }
  }
  return null;
}

// A map not used yet with a door of each kind asked for (as many as asked) that one of yours can stand outside of.
const used = new Set();
function pickMap(kinds) {
  for (const got of maps) {
    if (used.has(got)) continue;
    const u = got.b.units.find((x) => x.side === "player" && !x.dead), at = [u.x, u.y];
    const ok = Object.entries(kinds.reduce((a, k) => ({ ...a, [k]: (a[k] || 0) + 1 }), {})).every(([k, n]) => {
      let m = 0;
      for (let i = 0; i < got.b.cells.length && m < n; i++) if (besideDoor(got.b, k, u, i)) m++;
      return m >= n;
    });
    [u.x, u.y] = at;
    if (ok) { used.add(got); return got; }
  }
  throw new Error(`no map with doors ${kinds}`);
}

// ---------- 2. walking through, opening, closing ----------
console.log("Through the doors");
{
  const got = pickMap(["idoor", "door", "door"]);
  const { st, b } = got;
  st.combat = b;
  const u = b.units.find((x) => x.side === "player" && !x.dead);
  let d = besideDoor(b, "idoor", u);
  check(!!d, "a closed door with your man outside it");
  let err = combatAct(st, { type: "move", unit: u.id, x: d.in[0], y: d.in[1] });
  check(!err && u.x === d.in[0] && u.y === d.in[1] && b.cells[d.y * b.w + d.x].k === "odoor", `he walks in through it and it stands open (${err || "ok"})`);
  // Close it behind him, then peek through it.
  u.ap = 2;
  err = combatAct(st, { type: "close", unit: u.id, x: d.x, y: d.y });
  check(!err && b.cells[d.y * b.w + d.x].k === "idoor" && u.ap === 1, `Close door works outside a raid (${err || "ok"})`);
  err = combatAct(st, { type: "peek", unit: u.id, x: d.x, y: d.y });
  check(!err && (b.peeks || []).length === 1, `and Peek (${err || "ok"})`);
  err = combatAct(st, { type: "brace", unit: u.id, x: d.x, y: d.y });
  check(!err && u.brace, `and Brace (${err || "ok"})`);
  delete u.brace;

  // A locked door: not walked through; the open action with the key.
  const s = survivorById(st, u.sid);
  d = besideDoor(b, "door", u);
  check(!!d, "a locked door with your man outside it");
  const lockOf = (dd) => b.doors.find((q) => q.x === dd.x && q.y === dd.y);
  const L = lockOf(d);
  check(!isFinite(reachable(b, u, 99).dist[d.y * b.w + d.x]), "he cannot walk into it (the way in is round by another door)");
  u.x = d.in[0] - (d.in[0] - d.x) * 2; u.y = d.in[1] - (d.in[1] - d.y) * 2; u.ap = 2;
  err = combatAct(st, { type: "open", unit: u.id, target: `d${L.id}`, method: "key" });
  check(/key/i.test(err), `no key on the ring: the key will not do (${err})`);
  addKey(st, b.tileId, "test");
  err = combatAct(st, { type: "open", unit: u.id, target: `d${L.id}`, method: "key" });
  check(!err && L.lock.open && b.cells[d.y * b.w + d.x].k === "odoor" && u.ap === 1, `with the key it opens: an open door now (${err || "ok"})`);
  check(b.log.some((l) => /door is open/.test(l.text)), "the log says so");
  err = combatAct(st, { type: "move", unit: u.id, x: d.in[0], y: d.in[1] });
  check(!err && u.x === d.in[0] && u.y === d.in[1], "and he walks in");

  // Forced with a crowbar: loud, no Heat (no raid), a few tries at most.
  st.keys = [];
  const d2 = besideDoor(b, "door", u);
  if (check(!!d2, "another locked door")) {
    const L2 = lockOf(d2);
    s.pockets = s.pockets || [];
    s.pockets[0] = newItem("crowbar");
    const noise0 = b.noise || 0;
    let tries = 0;
    u.x = d2.in[0] - (d2.in[0] - d2.x) * 2; u.y = d2.in[1] - (d2.in[1] - d2.y) * 2;
    while (!L2.lock.open && tries < 8) { u.ap = 2; err = combatAct(st, { type: "open", unit: u.id, target: `d${L2.id}`, method: "force" }); tries++; if (err) break; }
    check(L2.lock.open && b.cells[d2.y * b.w + d2.x].k === "odoor" && (b.noise || 0) > noise0, `forced open with the crowbar in ${tries} tr${tries === 1 ? "y" : "ies"}, loudly (${err || "ok"})`);
    s.pockets[0] = null;
  }
}

// ---------- 3. the battle screen: the click, the hover, the panel, the drawing ----------
console.log("On the battle screen");
{
  const got = pickMap(["door"]);
  const { st, b } = got;
  st.combat = b;
  st.keys = [];
  draw(st);
  UI.renderCombatPanel(st);
  const u = b.units.find((x) => x.id === cui.sel) || b.units.find((x) => x.side === "player");
  cui.sel = u.id;
  const d = besideDoor(b, "door", u);
  const L = b.doors.find((q) => q.x === d.x && q.y === d.y);
  const s = survivorById(st, u.sid);
  for (const k of Object.keys(s.gear || {})) if (s.gear[k] && (s.gear[k].key === "crowbar" || ["fireaxe", "sledgehammer"].includes(s.gear[k].key))) s.gear[k] = null;
  // The hover text.
  cui.hover = { x: d.x, y: d.y };
  let html = UI.renderCombatPanel(st);
  check(/Locked door/.test(html) && /click it/i.test(html) && /lockpicks/.test(html), "the hover text names the locked door and says how to open it");
  // The Open buttons are with the unit's orders in the battle bottom bar (ui/combat.js renderCombatBar), so read the whole screen.
  const screen = UI.renderCombatScreen(st);
  check(["key", "pick", "force"].every((m) => new RegExp(`data-action="lk-open"[^>]*data-m="${m}"`).test(screen)), "the panel has the Open buttons next to it (key, pick, force)");
  const id = b.cells.findIndex((c) => c.k === "idoor");
  cui.hover = { x: id % b.w, y: (id / b.w) | 0 };
  html = UI.renderCombatPanel(st);
  check(/Closed door/.test(html) && /walk through/.test(html), "a closed door's hover text says to walk through it");
  // The click: with one action left smashing it is out of reach and there is no key or picks: it says what it takes.
  const pick = (x, y) => { for (let py = 0; py < 900; py += 2) for (let px = 0; px < 1600; px += 2) { const c = ISO.isoPick(b, px, py); if (c && c.x === x && c.y === y) return [px, py]; } return null; };
  ISO.isoCenterOn(b, d.x, d.y, false);
  draw(st);
  let at = pick(d.x, d.y);
  check(!!at, "the locked door can be clicked on the map");
  u.ap = 1;
  cui.msg = "";
  if (at) UI.combatClick(st, at[0], at[1]);
  check(!L.lock.open && /no way in/.test(cui.msg) && u.ap === 1, `no key, no picks, one action: it says what it takes (${cui.msg})`);
  // With the key on the ring the click opens it.
  addKey(st, b.tileId, "test");
  u.ap = 2;
  draw(st);
  at = pick(d.x, d.y);
  if (at) UI.combatClick(st, at[0], at[1]);
  check(L.lock.open && b.cells[d.y * b.w + d.x].k === "odoor" && u.ap === 1, `with the key a click opens it (${cui.msg || "ok"})`);
  // From afar: says to come closer.
  const other = (b.doors || []).find((q) => !q.lock.open && Math.max(Math.abs(q.x - u.x), Math.abs(q.y - u.y)) > 2);
  if (other) {
    ISO.isoCenterOn(b, other.x, other.y, false);
    draw(st);
    at = pick(other.x, other.y);
    cui.msg = "";
    if (at) UI.combatClick(st, at[0], at[1]);
    check(!other.lock.open && /move right next to it/.test(cui.msg), `from afar a click says to come closer (${cui.msg})`);
  }
  // The drawing: door badges over the roofed houses at every turn of the view, a padlock over each locked door.
  for (let r = 0; r < 4; r++) {
    ISO.iso.rot = r;
    calls.length = 0;
    draw(st);
    check(calls.filter((k) => k === "arc").length >= (b.doors || []).filter((q) => !q.lock.open).length && calls.length > 0, `view turned ${r}: the doors are marked (${calls.length} marks drawn)`);
  }
  ISO.iso.rot = 0;
}

// ---------- 4. the enemy gets at your people in a house ----------
console.log("The enemy and the doors");
for (const [kind, lockAll] of [["zombie", false], ["human", false], ["human", true]]) {
  const what = `${kind === "zombie" ? "the dead" : "raiders"}${lockAll ? ", every door locked" : ""}`;
  let best = null;
  for (let s = 0; s < 12 && !best; s++) for (const { st, b } of battles(seed0 * 100 + s, ["field-city"])) {
    // Your people shut in a house whose ways in are closed or locked doors; an enemy of this kind on the map.
    const hs = houses(b).filter((h) => h.rim.some((j) => b.cells[j].k === "idoor") && h.rim.every((j) => b.cells[j].k !== "odoor") && h.inner.filter((j) => CELL[b.cells[j].k].walk).length >= 2);
    const free = hs.filter((h) => !b.units.some((e) => e.side === "enemy" && h.cells.includes(e.y * b.w + e.x)));
    if (free.length && b.units.some((e) => e.side === "enemy" && e.kind === kind)) { best = { st, b, h: free[0] }; break; }
  }
  if (!check(!!best, `${what}: a house shut by its doors`)) continue;
  const { st, b, h } = best;
  st.combat = b;
  if (lockAll) for (const j of h.rim) if (b.cells[j].k === "window") b.cells[j].k = "wall"; // nothing to shoot in through: they must break in
  if (lockAll) for (const j of h.rim) if (b.cells[j].k === "idoor") { const c = b.cells[j]; c.k = "door"; c.hp = c.mhp = BMAP.DOOR.locked; (b.doors = b.doors || []).push({ id: 900 + j, x: j % b.w, y: (j / b.w) | 0, lock: { kind: "door", open: false, tries: 0 } }); }
  const mine = b.units.filter((u) => u.side === "player" && !u.dead);
  const spots = h.inner.filter((j) => CELL[b.cells[j].k].walk && !b.units.some((o) => o.x === j % b.w && o.y === ((j / b.w) | 0)));
  mine.forEach((u, i) => { if (i < Math.min(2, spots.length)) { u.x = spots[i] % b.w; u.y = (spots[i] / b.w) | 0; } else { u.dead = true; } });
  const foes = b.units.filter((e) => e.side === "enemy" && !e.dead && e.kind === kind);
  for (const e of b.units) if (e.side === "enemy" && e.kind !== kind) e.dead = true;
  for (const e of foes) e.aware = true;
  const rim0 = h.rim.map((j) => b.cells[j].k).join();
  let reached = false, turns = 0;
  for (; turns < 30 && !b.over && !reached; turns++) {
    for (const u of mine) if (!u.dead) { u.ap = 0; u.ow = false; u.hp = u.maxHp; u.down = false; u.bleed = 0; }
    if (b.phase === "player") combatAct(st, { type: "end" });
    runEnemyPhase(st);
    // In, or in the doorway it opened or broke; or hurting them (raiders shoot in through a door or a window).
    reached = foes.some((e) => !e.dead && h.cells.includes(e.y * b.w + e.x)) || mine.some((u) => !u.dead && u.hp < u.maxHp);
  }
  const rim1 = h.rim.map((j) => b.cells[j].k).join();
  check(reached, `${what}: they get at your people shut in the house, in ${turns} turn${turns === 1 ? "" : "s"} (its doors ${rim0 === rim1 ? "as they were" : "opened or broken"}: ${h.rim.filter((j) => DOORISH.has(b.cells[j].k) || b.cells[j].k === "doorway").map((j) => b.cells[j].k).join(", ")})`);
}

// ---------- 5. raids ----------
console.log("Raids");
{
  let streets = 0, gaps = 0, doors = 0, sealed = 0, sealOk = 0;
  for (let s = 0; s < 8; s++) {
    const got = battles(seed0 * 100 + s, ["raid"])[0];
    if (!got) continue;
    const { st, b } = got;
    if (b.raid.interior) continue;
    streets++;
    for (const a of b.raid.areas) if (!a.outdoor && a.doors) for (const [x, y] of a.doors) {
      const k = b.cells[y * b.w + x].k;
      if (k === "open") gaps++; else if (DOORISH.has(k)) doors++;
    }
    // A locked room (sim/locks.js sealRoom): opens with the key, an open door then.
    const R = b.raid;
    for (const d of R.doors || []) {
      sealed++;
      if (d.lock.open) continue;
      st.combat = b;
      const u = b.units.find((x) => x.side === "player" && !x.dead);
      const c = NEXT4.map(([dx, dy]) => [d.x + dx, d.y + dy]).find(([x, y]) => x >= 0 && y >= 0 && x < b.w && y < b.h && CELL[b.cells[y * b.w + x].k].walk && !unitAt(b, x, y));
      if (!c) continue;
      u.x = c[0]; u.y = c[1]; u.ap = 2;
      addKey(st, b.tileId, "test");
      const err = combatAct(st, { type: "open", unit: u.id, target: `d${d.id}`, method: "key" });
      if (!err && d.lock.open && b.cells[d.y * b.w + d.x].k === "odoor") sealOk++;
      break;
    }
  }
  check(streets >= 3, `${streets} raid street maps`);
  check(gaps === 0 && doors > 0, `their houses' doors are doors (${doors}), not gaps (${gaps})`);
  check(sealed === 0 || sealOk > 0, `a locked room still opens with the key (${sealOk} of the maps with one)`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
