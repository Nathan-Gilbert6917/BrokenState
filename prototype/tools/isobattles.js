// Battles of every layout for the battle-view checks (tools/uitest.js) and measurements: a field encounter (a town
// with a road, a forest), a raid, a hive assault, a hive growth, an assault on a group's walled base, a base defence
// on the wall map (night, a manned tower) and after the fall back on the yard map (some of your people inside a
// building), a base without walls. Each is built the way the browser opens it (a window there: no auto-resolve).
// battles(seed) → [{ name, st, b }]
import { createWorld, hub, atBase, makeSurvivor } from "../src/sim/world.js";
import { createBattle, registerCombatHandler } from "../src/sim/combat.js";
import { launchExpedition } from "../src/sim/parties.js";
import { addBuilding } from "../src/sim/buildings.js";
import { newItem } from "../src/sim/inventory.js";
import { endDeploy } from "../src/sim/deploy.js";
import { fallBack } from "../src/sim/interior.js";

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
  try { return fn(); } finally { if (!had) delete globalThis.window; else globalThis.window = w; }
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
  add("raid-building", (st) => {
    const h = hub(st), tile = (st.tiles.find((t) => t.loc && t.loc.type === "apartments" && t.id !== h.tile) || st.tiles.find((t) => t.loc && t.loc.type === "police" && t.id !== h.tile)).id;
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
  });
  add("hive", (st) => field(st, fakeTile(st, "forest", null), { kind: "zombies", count: 20, power: 4, types: { runner: 3, brute: 2, spitter: 2, screamer: 1, crawler: 3 }, name: "the brood" }, { layout: "hive" }));
  add("growth", (st) => field(st, fakeTile(st, "plains", null), { kind: "zombies", count: 8, power: 3 }, { layout: "growth" }));
  add("base-assault", (st) => field(st, fakeTile(st, "plains", null, true), { kind: "raiders", count: 7, power: 5, walls: 3, name: "their base" }, { layout: "baseAssault" }));
  const baseFight = (st, night, build = BUILT, walls = true) => {
    const h = hub(st);
    if (!walls) h.buildings = h.buildings.filter((x) => x.type !== "walls" && x.type !== "gate");
    for (const t of build) addBuilding(h, t);
    st.combat = inBrowser(() => createBattle(st, { tile: h.tile, baseId: h.id, enemy: { kind: "zombies", count: 16, power: 3, name: "the horde" }, ambush: null, canRetreat: true, handler: "isotest", layout: "baseDefence", deploy: true, downedLive: 0.4, context: { strip: true, night, through: 150, floodlit: true } }));
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
  return out;
}
