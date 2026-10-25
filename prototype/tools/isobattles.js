// Battles of every layout for the battle-view checks (tools/uitest.js) and measurements: a field encounter (a town
// with a road, a forest), a raid, a hive assault, a hive growth, an assault on a group's walled base, a base defence
// on the wall map (night, a manned tower) and after the fall back on the yard map (some of your people inside a
// building), a base without walls, and the furniture showroom (one of every kind: showroom). Each is built the way the browser opens it (a window there: no auto-resolve).
// battles(seed) → [{ name, st, b }]
import { createWorld, hub, atBase, makeSurvivor, survivorById } from "../src/sim/world.js";
import { createBattle, registerCombatHandler } from "../src/sim/combat.js";
import { launchExpedition } from "../src/sim/parties.js";
import { addBuilding } from "../src/sim/buildings.js";
import { newItem } from "../src/sim/inventory.js";
import { endDeploy } from "../src/sim/deploy.js";
import { fallBack } from "../src/sim/interior.js";
import { FURNITURE_KINDS, itemKey } from "../src/sim/data-furniture.js";
import { reweigh, LIFT } from "../src/sim/furnicarry.js";

registerCombatHandler("isotest", () => {});
const BUILT = ["walls", "walls", "barricades", "barricades", "watchtower", "bunkhouse", "bunkhouse", "storehouse", "ammo_bench", "infirmary", "cistern", "well", "gate", "rain_catcher", "garage", "radio", "common_room", "cells", "cellar", "floodlights"];

export function world(seed, extra = 4) {
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true;
  const h = hub(st);
  for (let i = 0; i < extra; i++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); }
  for (const s of atBase(st, h.id)) { s.health = 100; if (!s.gear.weapon) s.gear.weapon = newItem("pistol"); }
  h.stock.ammo = 300; h.stock.meds = 10;
  return st;
}
const inBrowser = (fn) => {
  const had = "window" in globalThis, w = globalThis.window;
  if (!had) globalThis.window = {};
  try { return fn(); } finally { if (!had) delete globalThis.window; } // in a browser the window is its own (a getter): left as it is
};
const fakeTile = (st, terrain, loc, road = false) => {
  const h = hub(st), t = st.tiles.find((x) => x.id !== h.tile && x.terrain !== "water");
  const fake = { ...t, terrain, road, infection: 0, loc: loc ? { type: loc, name: loc[0].toUpperCase() + loc.slice(1) } : null };
  st.tiles[t.id] = fake;
  return t.id;
};
const field = (st, tile, enemy, extra = {}) => {
  const h = hub(st);
  return inBrowser(() => createBattle(st, { tile, baseId: h.id, fighterIds: atBase(st, h.id).slice(0, 6).map((s) => s.id), enemy, ambush: null, canRetreat: true, handler: "isotest", context: {}, ...extra }));
};

// The furniture showroom (sim/data-furniture.js, issue #8): one of every kind of the catalogue laid out on the battle's
// map in rows, each at its own size (a sofa two cells, bleachers two by two) with a free cell round it, on a floor of
// floorboards; the cells under it cleared first, anyone standing there moved off, any raid container there dropped.
// Used by the "furniture" layout below and by tools/raidshot.cjs (site "furniture": the same on a real raid's map).
// showroom(b, x0?, y0?) → [{ k, x, y }] (each piece's first cell; from (1, 1) by default: 101 kinds since issues #15 and #16).
export function showroom(b, x0 = 1, y0 = 1) {
  const placed = [];
  const kinds = Object.keys(FURNITURE_KINDS);
  // Packed in rows, each piece at its own width with a free cell after it, a row as tall as its tallest piece and a free
  // row under it (the catalogue outgrew a grid of 3 × 3 slots on the field map: issue #15).
  // When that runs off the map (the campus pieces, issue #28), the pieces stand side by side along a row instead.
  let spots = [], x = x0, y = y0, rowH = 1;
  for (const gap of [1, 0]) {
    spots = []; x = x0; y = y0; rowH = 1;
    for (const k of kinds) {
      const [w, h] = FURNITURE_KINDS[k].size;
      if (x + w > b.w - 2) { x = x0; y += rowH + 1; rowH = 1; }
      spots.push({ k, x, y, w, h });
      x += w + gap; rowH = Math.max(rowH, h);
    }
    if (y + rowH <= b.h - 1) break;
  }
  const x1 = Math.min(b.w - 1, Math.max(...spots.map((p) => p.x + p.w))), y1 = Math.min(b.h - 1, y + rowH);
  for (let yy = y0 - 1; yy <= y1; yy++) for (let xx = x0 - 1; xx <= x1; xx++) {
    if (xx < 0 || yy < 0 || xx >= b.w || yy >= b.h) continue;
    b.cells[yy * b.w + xx] = { k: "open", f: "floor", fl: (xx + yy) % 7 ? undefined : "tile" };
  }
  for (const { k, x, y, w, h } of spots) {
    if (y + h > b.h - 1) continue;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) b.cells[(y + dy) * b.w + x + dx] = { k, f: "floor" };
    placed.push({ k, x, y });
  }
  const taken = (x, y) => b.units.some((u) => u.x === x && u.y === y);
  for (const u of b.units) {
    if (b.cells[u.y * b.w + u.x].k === "open") continue;
    let best = null, bd = Infinity; // the nearest free open cell (the gaps between the pieces count)
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { const d = Math.abs(x - u.x) + Math.abs(y - u.y); if (d < bd && b.cells[y * b.w + x].k === "open" && !taken(x, y)) { bd = d; best = [x, y]; } }
    if (best) { u.x = best[0]; u.y = best[1]; }
  }
  if (b.raid && b.raid.containers) b.raid.containers = b.raid.containers.filter((c) => c.x < x0 - 1 || c.x > x1 || c.y < y0 - 1 || c.y > y1);
  if (b.losCache) b.losCache.fill(0);
  b.rev = (b.rev || 0) + 1;
  return placed;
}

// Carrying furniture (sim/furnicarry.js, issue #17's carry poses): your people on a cleared floor near (x0, y0), in the
// order [kind, partner?]: one alone with a fridge (60 kg: past 40 kg, the low pose), a pair with a sofa (two cells, the
// piece between them), one alone with a table (the carry pose), a pair with a washer (one cell: the tether line), as
// many of these as there are people. Each as liftAct leaves it (u.bag = s.gear.carry, u.piece, a pair's tether and
// shareKg), reweighed. Used by the "carry" layout below, tools/carryviewtest.js and tools/raidshot.cjs (site "carry").
// carryScene(st, b, x0?, y0?) → [{ k, ids: [carrier, partner?] }].
export const CARRY_SET = [["fridge", false], ["sofa", true], ["table", false], ["washer", true]];
export function carryScene(st, b, x0 = 3, y0 = 3) {
  const mine = b.units.filter((u) => u.side === "player" && !u.dead && !u.down);
  for (let y = y0 - 1; y <= y0 + 5; y++) for (let x = x0 - 1; x <= x0 + 4 * 3 + 1; x++) if (x >= 0 && y >= 0 && x < b.w && y < b.h) b.cells[y * b.w + x] = { k: "open", f: "floor" };
  for (const u of b.units) if (u.side !== "player" && u.x >= x0 - 1 && u.x <= x0 + 13 && u.y >= y0 - 1 && u.y <= y0 + 5) u.x = Math.max(0, x0 - 2); // nobody else in the way
  const out = [];
  let n = 0;
  CARRY_SET.forEach(([k, pair], i) => {
    if (n + (pair ? 2 : 1) > mine.length) return;
    const u = mine[n++], v = pair ? mine[n++] : null, s = survivorById(st, u.sid), it = newItem(itemKey(k));
    u.x = x0 + i * 3; u.y = y0 + 1;
    s.gear.carry = it; u.bag = it; u.piece = k; u.tether = null; u.shareKg = null; u.face = [1, 1];
    if (v) {
      v.x = u.x + (i % 2 ? 1 : 0); v.y = u.y + (i % 2 ? 0 : 1); // the sofa's pair one above the other, the washer's side by side
      v.piece = k; v.tether = u.id; u.tether = v.id;
      v.shareKg = u.shareKg = Math.round(FURNITURE_KINDS[k].kg * LIFT.SHARE * 100) / 100;
    }
    reweigh(st, b, u);
    out.push({ k, ids: v ? [u.id, v.id] : [u.id] });
  });
  if (b.losCache) b.losCache.fill(0);
  b.rev = (b.rev || 0) + 1;
  return out;
}

export function battles(seed = 42, only = null) {
  const out = [];
  const add = (name, fn) => { if (only && !only.includes(name)) return; const st = world(seed); const b = fn(st); st.combat = b; out.push({ name, st, b }); };
  add("field-town", (st) => field(st, fakeTile(st, "suburb", "town", true), { kind: "raiders", count: 6, power: 4, name: "Red Hand raiders" }));
  add("field-forest", (st) => field(st, fakeTile(st, "forest", null), { kind: "zombies", count: 14, power: 3 }));
  add("field-city", (st) => field(st, fakeTile(st, "city", "police", true), { kind: "mixed", count: 10, power: 4 }));
  add("raid", (st) => {
    const h = hub(st), tile = st.tiles.find((t) => t.loc && t.loc.type === "town" && t.id !== h.tile).id;
    const crew = atBase(st, h.id).slice(0, 4);
    const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 20, meds: 1 } }).party;
    p.path = [tile]; p.idx = 0; p.phase = "engaged";
    return inBrowser(() => createBattle(st, { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "isotest", enemy: { kind: "mixed", count: 6, power: 3, groups: [{ kind: "raiders", count: 3, power: 3 }, { kind: "zombies", count: 5, power: 2 }] }, raid: { heat0: 0 }, context: {} }));
  });
  // A raid inside a building (sim/buildingmaps.js): an apartment block (rooms, a corridor, an upper floor up the stairs)
  // or a police station, with a few of the team inside and some doors opened.
  const inBuilding = (st, tile) => {
    const h = hub(st);
    const crew = atBase(st, h.id).slice(0, 4);
    const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", vehicleId: st.vehicles[0].id, supplies: { food: 6, water: 6, ammo: 20, meds: 1 } }).party;
    p.path = [tile]; p.idx = 0; p.phase = "engaged";
    const b = inBrowser(() => createBattle(st, { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "isotest", enemy: { kind: "mixed", count: 6, power: 3, groups: [{ kind: "raiders", count: 2, power: 3 }, { kind: "zombies", count: 6, power: 2 }] }, raid: { heat0: 0 }, context: {} }));
    // Two of the team just inside the front door, which is open now.
    const B = b.raid.plan.building, fr = b.raid.plan.front;
    const me = b.units.filter((u) => u.side === "player");
    const inside = [];
    for (let y = B.y0 + 1; y < B.y0 + B.h - 1; y++) for (let x = B.x0 + 1; x < B.x0 + B.w - 1; x++) if (b.cells[y * b.w + x].k === "open" && !b.units.some((u) => u.x === x && u.y === y)) inside.push([x, y]);
    inside.sort((a, c) => Math.hypot(a[0] - fr.x, a[1] - fr.y) - Math.hypot(c[0] - fr.x, c[1] - fr.y));
    me.slice(0, 2).forEach((u, i) => { if (inside[i * 2]) { u.x = inside[i * 2][0]; u.y = inside[i * 2][1]; } });
    b.cells[fr.y * b.w + fr.x].k = "odoor";
    b.losCache.fill(0);
    // One of them peeks deeper in (the peeked cells are drawn tinted).
    const deep = inside[Math.min(inside.length - 1, 12)];
    if (deep) b.peeks = [{ turn: b.turn, unit: me[0].id, x: deep[0], y: deep[1], dx: deep[0], dy: deep[1] + 1, r: 8 }];
    return b;
  };
  add("raid-building", (st) => { const h = hub(st); return inBuilding(st, (st.tiles.find((t) => t.loc && t.loc.type === "apartments" && t.id !== h.tile) || st.tiles.find((t) => t.loc && t.loc.type === "police" && t.id !== h.tile)).id); });
  // Interior decor (sim/decor.js, tools/decortest.js): a house and a hospital, a few of the team inside. Only when asked
  // for by name (battles(seed, ["decor-house"])): every layout's list stays as it was.
  const siteTile = (st, type) => { const h = hub(st), t = st.tiles.find((x) => x.loc && x.loc.type === "town" && x.id !== h.tile); st.tiles[t.id] = { ...t, loc: { type, name: type[0].toUpperCase() + type.slice(1) } }; return t.id; }; // a town's tile (in reach) made the site
  if (only && only.includes("decor-house")) add("decor-house", (st) => inBuilding(st, siteTile(st, "house")));
  if (only && only.includes("decor-hospital")) add("decor-hospital", (st) => inBuilding(st, siteTile(st, "hospital")));
  add("hive", (st) => field(st, fakeTile(st, "forest", null), { kind: "zombies", count: 20, power: 4, types: { runner: 3, brute: 2, spitter: 2, screamer: 1, crawler: 3 }, name: "the brood" }, { layout: "hive" }));
  add("growth", (st) => field(st, fakeTile(st, "plains", null), { kind: "zombies", count: 8, power: 3 }, { layout: "growth" }));
  add("base-assault", (st) => field(st, fakeTile(st, "plains", null, true), { kind: "raiders", count: 7, power: 5, walls: 3, name: "their base" }, { layout: "baseAssault" }));
  const baseFight = (st, night, build = BUILT, walls = true) => {
    const h = hub(st);
    if (!walls) h.buildings = h.buildings.filter((x) => x.type !== "walls" && x.type !== "gate");
    for (const t of build) addBuilding(h, t);
    st.combat = inBrowser(() => createBattle(st, { tile: h.tile, baseId: h.id, enemy: { kind: "zombies", count: 16, power: 3, name: "the horde" }, ambush: null, canRetreat: true, handler: "isotest", layout: "baseDefence", deploy: true, downedLive: 0.4, context: { strip: true, night, through: 150, floodlit: true, ready: { manned: true } } })); // ready: everyone at a post (defenceplan.js openStart)
    return st.combat;
  };
  add("base-wall-night", (st) => {
    const b = baseFight(st, true);
    b.night = true;
    endDeploy(b);
    return b;
  });
  add("base-yard", (st) => {
    const b = baseFight(st, false);
    endDeploy(b);
    inBrowser(() => fallBack(st));
    endDeploy(b);
    return b;
  });
  add("base-open", (st) => baseFight(st, false, ["barricades", "bunkhouse", "storehouse", "well", "ammo_bench"], false));
  // One of every piece of furniture and appliance (showroom above) on a field map.
  add("furniture", (st) => { const b = field(st, fakeTile(st, "plains", null), { kind: "zombies", count: 2, power: 2 }); b.showroom = showroom(b); return b; });
  // Carrying furniture (carryScene above), on a field map: only when asked for by name (battles(seed, ["carry"])).
  if (only && only.includes("carry")) add("carry", (st) => { const b = field(st, fakeTile(st, "plains", null), { kind: "zombies", count: 2, power: 2 }); b.carried = carryScene(st, b); return b; });
  return out;
}
