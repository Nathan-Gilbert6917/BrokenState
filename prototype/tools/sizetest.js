// Battle map sizes by context (src/sim/battlesize.js) and the guardrails that keep big maps from being a slog.
// Checks: the size table (Small 24×18, Medium 32×24, Large 40×30, Extra-large 48×34) and what maps to each class
// (sites, fights in the open by crowd and terrain, a hive, a group's base by its people, your hub and outposts by
// their buildings); every context's map built twice the same (deterministic), valid (everyone on a free walkable
// cell your people can reach, both sides where they belong), the sides starting the set distance apart, cover over
// most of the open ground, the first shot or blow within a few turns (the AI on both sides), a raid with more rooms,
// containers and dead on a bigger site; the anti-slog ends (a couple of far-off unaware stragglers: the AI ends it,
// the player is offered it; a fleeing raider out of sight is gone). Then the measurement: battles by size class played
// out by the AI on both sides (avg turns, % over the 60-turn limit, ends called "clear enough", the AI's time a turn).
// Usage: node tools/sizetest.js [battles per matchup=10] [seed=3] [--quick: the checks only]
import { createWorld, hub, atBase, makeSurvivor } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { newItem } from "../src/sim/inventory.js";
import { addBuilding } from "../src/sim/buildings.js";
import { launchExpedition } from "../src/sim/parties.js";
import { createBattle, autoPlayerTurn, runEnemyPhase, closeCombat, registerCombatHandler, active, combatAct, CELL, endPlayerTurn } from "../src/sim/combat.js";
import {
  SIZE_CLASSES, CLASS_KEYS, SIZES, CONTACT, COVER, CLEAR, dimsAt, sizeClass, siteScale, raidDims, fieldScale, assaultDims, baseScale,
  coverShare, coverTarget, clearEnough, raidAreaRange, raidDeadScale,
} from "../src/sim/battlesize.js";
import { yardDims, interiorSize, INTERIOR, structuresOf } from "../src/sim/interior.js";
import "../src/sim/hives.js";
import "../src/sim/conquest.js";

const args = process.argv.slice(2);
const QUICK = args.includes("--quick");
const nums = args.filter((a) => !a.startsWith("--"));
const N = Number(nums[0] || 10);
const SEED = Number(nums[1] || 3);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
let last = null;
registerCombatHandler("sz", (st, r) => { last = r; });
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };
const dimStr = ([w, h]) => `${w}×${h}`;

// ---------- worlds and battles ----------
const HUB_FULL = ["walls", "walls", "barricades", "barricades", "watchtower", "bunkhouse", "bunkhouse", "storehouse", "ammo_bench", "infirmary", "cistern", "well", "gate", "rain_catcher", "garage", "radio", "common_room", "cells", "cellar", "floodlights"];
function world(seed, people = 6, weapons = null) {
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true;
  const h = hub(st);
  for (const s of atBase(st, h.id)) s.location = { kind: "away" }; // a fresh team for each battle
  const rng = st.rng;
  for (let i = 0; i < people; i++) {
    const s = makeSurvivor(st);
    s.location = { kind: "base", baseId: h.id };
    s.health = 100;
    s.skills.shooting = rng.int(5, 11);
    const w = weapons ? weapons[i % weapons.length] : rng.pick(["pistol", "pistol", "huntrifle", "shotgun", "ar"]);
    s.gear.weapon = { key: w, name: GEAR[w].name, quality: 1 };
    st.survivors.push(s);
  }
  h.stock.ammo = 400; h.stock.meds = 6;
  return st;
}
const fakeTile = (st, terrain, loc = null, road = false) => {
  const h = hub(st), t = st.tiles.find((x) => x.id !== h.tile && x.terrain !== "water");
  st.tiles[t.id] = { ...t, terrain, road, infection: 0, loc: loc ? { type: loc, name: loc } : null };
  return t.id;
};
function field(st, terrain, loc, enemy, extra = {}) {
  const h = hub(st);
  const tile = fakeTile(st, terrain, loc, extra.road);
  return inBrowser(() => createBattle(st, { tile, baseId: h.id, fighterIds: atBase(st, h.id).map((s) => s.id), enemy, ambush: extra.ambush || null, canRetreat: true, handler: "sz", context: {}, layout: extra.layout }));
}
function raid(st, loc, groups) {
  const h = hub(st);
  const tile = st.tiles.find((t) => t.loc && t.loc.type === loc && t.id !== h.tile) || st.tiles[fakeTile(st, "city", loc)];
  const crew = atBase(st, h.id).slice(0, 3);
  const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 40, meds: 2 } }).party;
  p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
  return inBrowser(() => createBattle(st, { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "sz", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: 5 }, context: {} }));
}
function baseFight(st, list, enemy, walls = true, type = "hub") {
  const h = hub(st);
  if (type === "outpost") h.type = "outpost";
  if (!walls) h.buildings = h.buildings.filter((x) => x.type !== "walls" && x.type !== "gate");
  for (const t of list) addBuilding(h, t);
  return inBrowser(() => createBattle(st, { tile: h.tile, baseId: h.id, enemy, ambush: null, canRetreat: true, handler: "sz", layout: "baseDefence", deploy: true, downedLive: 0.4, context: { night: false, through: 150 } }));
}

// Every context: name, the class it should be, and how to build it on a world.
const CONTEXTS = [
  { name: "raid: gas station (its building)", cls: "S", make: (st) => raid(st, "gas", [{ kind: "zombies", count: 5, power: 2 }]) },
  { name: "raid: pharmacy (its building)", cls: "S|M", make: (st) => raid(st, "pharmacy", [{ kind: "zombies", count: 6, power: 2 }]) },
  { name: "raid: supermarket (its building)", cls: "M|L", make: (st) => raid(st, "supermarket", [{ kind: "zombies", count: 7, power: 2 }]) },
  { name: "raid: farm", cls: "M", make: (st) => raid(st, "farm", [{ kind: "zombies", count: 4, power: 2 }]) },
  { name: "raid: hospital (its building)", cls: "L", make: (st) => raid(st, "hospital", [{ kind: "zombies", count: 9, power: 2.5 }]) },
  { name: "raid: city center", cls: "L", make: (st) => raid(st, "city", [{ kind: "zombies", count: 8, power: 2.5 }, { kind: "raiders", count: 3, power: 4 }]) },
  { name: "field: 3 vs 3 raiders, plains", cls: "M", players: 3, make: (st) => field(st, "plains", null, { kind: "raiders", count: 3, power: 4 }, { road: true }) },
  { name: "field: 3 vs 4 raiders, forest", cls: "M", players: 3, make: (st) => field(st, "forest", null, { kind: "raiders", count: 4, power: 5 }) },
  { name: "field: 3 vs 12 dead, hills", cls: "M", players: 3, make: (st) => field(st, "hills", null, { kind: "zombies", count: 12, power: 2 }) },
  { name: "field: 4 vs 6 mixed, city", cls: "M", players: 4, make: (st) => field(st, "city", null, { kind: "mixed", count: 6, power: 4 }) },
  { name: "field: 6 vs 20 dead, plains", cls: "L", players: 6, make: (st) => field(st, "plains", null, { kind: "zombies", count: 20, power: 3 }) },
  { name: "field: 6 vs 8 raiders, suburb", cls: "M", players: 6, make: (st) => field(st, "suburb", "town", { kind: "raiders", count: 8, power: 5 }, { road: true }) },
  { name: "field: they ambush, 3 vs 4 raiders", cls: "M", players: 3, make: (st) => field(st, "plains", null, { kind: "raiders", count: 4, power: 5 }, { ambush: "enemy" }) },
  { name: "field: you ambush, 4 vs 12 dead", cls: "M", players: 4, make: (st) => field(st, "forest", null, { kind: "zombies", count: 12, power: 2 }, { ambush: "player" }) },
  { name: "hive assault", cls: "L", players: 6, make: (st) => field(st, "forest", null, { kind: "zombies", count: 14, power: 5, name: "the brood" }, { layout: "hive" }) },
  { name: "group base, 6 people", cls: "M", players: 5, make: (st) => field(st, "plains", null, { kind: "raiders", count: 4, power: 4.5, walls: 2, people: 6 }, { layout: "baseAssault", road: true }) },
  { name: "group base, 60 people", cls: "XL", players: 6, make: (st) => field(st, "plains", null, { kind: "raiders", count: 10, power: 5, walls: 4, people: 60 }, { layout: "baseAssault", road: true }) },
  { name: "hub, few buildings (wall map)", cls: "S", wallOf: "L", players: 8, make: (st) => baseFight(st, ["walls", "barricades", "bunkhouse"], { kind: "zombies", count: 14, power: 3, name: "the horde" }) },
  { name: "hub, fully built (wall map)", cls: "S", wallOf: "XL", players: 8, make: (st) => baseFight(st, HUB_FULL, { kind: "zombies", count: 16, power: 3, name: "the horde" }) },
  { name: "hub, no walls (yard map)", cls: "L", players: 8, make: (st) => baseFight(st, ["barricades", "bunkhouse", "storehouse", "well"], { kind: "zombies", count: 14, power: 3, name: "the horde" }, false) },
  { name: "outpost, no walls (yard map)", cls: "M", players: 6, make: (st) => baseFight(st, [], { kind: "raiders", count: 5, power: 4, name: "raiders" }, false, "outpost") },
];

function built(ctx, seed) {
  const st = world(seed, ctx.players || 4);
  const b = ctx.make(st);
  st.combat = b;
  return { st, b };
}
const sig = (b) => `${b.w}x${b.h}|${b.cells.map((c) => c.k[0] + c.k[1]).join("")}|${b.units.map((u) => `${u.side[0]}${u.x},${u.y}`).join(";")}`;
const pcOf = (b) => { const P = b.units.filter((u) => u.side === "player" && !u.dead); return P.reduce((a, u) => [a[0] + u.x / P.length, a[1] + u.y / P.length], [0, 0]); };

// ---------- 1. the table ----------
section("The size table (battlesize.js SIZE_CLASSES, SIZES)");
check(CLASS_KEYS.map((k) => `${SIZE_CLASSES[k].w}×${SIZE_CLASSES[k].h}`).join(" ") === "24×18 32×24 40×30 48×34", `four classes: ${CLASS_KEYS.map((k) => `${SIZE_CLASSES[k].name} ${SIZE_CLASSES[k].w}×${SIZE_CLASSES[k].h}`).join(", ")}`);
check(dimStr(dimsAt(0)) === "24×18" && dimStr(dimsAt(1)) === "32×24" && dimStr(dimsAt(2)) === "40×30" && dimStr(dimsAt(3)) === "48×34" && dimStr(dimsAt(0.5)) === "28×20", `in between: Small–Medium ${dimStr(dimsAt(0.5))}, Medium–Large ${dimStr(dimsAt(1.5))}`);
check(CLASS_KEYS.every((k) => sizeClass(SIZE_CLASSES[k].w, SIZE_CLASSES[k].h) === k) && sizeClass(28, 20) === "S" && sizeClass(36, 26) === "M", "every map size reads back as its nearest class");
const L_SITES = ["hospital", "univ", "prison", "military", "mall", "factory", "airport", "warehouse", "city"], M_SITES = ["supermarket", "school", "police", "firestation", "apartments", "office", "motel", "church", "farm", "ranch", "lodge", "campground"], SM_SITES = ["gas", "diner", "grocery", "pharmacy", "clinic", "cabin", "barn", "gunstore", "hardware", "autoshop", "feedstore"];
const loc = (type) => ({ terrain: "city", loc: { type } });
check(L_SITES.every((t) => dimStr(raidDims(loc(t))) === "40×30"), `Large sites: ${L_SITES.join(", ")} (40×30)`);
check(M_SITES.every((t) => dimStr(raidDims(loc(t))) === "32×24"), `Medium sites: ${M_SITES.join(", ")} (32×24)`);
check(SM_SITES.every((t) => siteScale(loc(t)) > 0 && siteScale(loc(t)) < 1), `Small–Medium sites: ${SM_SITES.join(", ")} (${dimStr(raidDims(loc("gas")))})`);
const f33 = fieldScale({ terrain: "plains" }, 3, { kind: "raiders", count: 3 }), f33f = fieldScale({ terrain: "forest" }, 3, { kind: "raiders", count: 3 });
const fBig = fieldScale({ terrain: "plains" }, 6, { kind: "zombies", count: 20 }), fHuge = fieldScale({ terrain: "plains" }, 8, { kind: "raiders", count: 20 });
check(f33 >= 1 && f33 < 1.5 && f33f < f33 && fBig > 1.5 && fHuge <= SIZES.FIELD.MAX, `fights in the open: 3 vs 3 on plains ${dimStr(dimsAt(f33))}, in a forest ${dimStr(dimsAt(f33f))}, 6 vs 20 of the dead ${dimStr(dimsAt(fBig))}, never over Large (8 vs 20 raiders ${dimStr(dimsAt(fHuge))})`);
check(fieldScale({ terrain: "plains", loc: { type: "hospital" } }, 3, { kind: "raiders", count: 3 }) >= 1.5, "a fight at a Large site is at least Medium–Large");
check(dimStr(assaultDims({ people: 6, count: 4 })) === "32×24" && sizeClass(...assaultDims({ people: 32, count: 10 })) === "L" && dimStr(assaultDims({ people: 60, count: 14 })) === "48×34", `a group's base by its people: 6 ${dimStr(assaultDims({ people: 6 }))}, 32 ${dimStr(assaultDims({ people: 32 }))}, 60 ${dimStr(assaultDims({ people: 60 }))}`);
{
  const st = createWorld({ seed: SEED, factionCount: 6 });
  const h = hub(st);
  const small = yardDims(h);
  for (const t of HUB_FULL) addBuilding(h, t);
  const big = yardDims(h), bigSize = interiorSize(h);
  const op = { ...h, type: "outpost", buildings: [] };
  check(sizeClass(...small) === "L" && sizeClass(...big) === "XL" && bigSize.W === big[0] && bigSize.H >= big[1], `your hub: ${dimStr(small)} with ${structuresOf({ ...h, buildings: [] }).length} building(s), ${bigSize.W}×${bigSize.H} fully built (${structuresOf(h).length}); the wall map as long, less ${INTERIOR.WALL_ROWS} rows`);
  check(sizeClass(...yardDims(op)) === "M" && baseScale(op, 5) > baseScale(op, 1) && baseScale(op, 9) <= 2, `an outpost: ${dimStr(yardDims(op))} bare, growing to ${dimStr(dimsAt(baseScale(op, 5)))} with its buildings`);
  check(dimStr(yardDims(null)) === "26×16", "no base (a test): the old 26×16 yard");
}
check(dimStr([40, 30]) === dimStr(dimsAt(SIZES.HIVE)), "a hive assault: Large (40×30)");

// ---------- 2. every context ----------
section("Every context: deterministic, valid, the sides apart, cover, the first shot");
const contactTurns = [];
for (const ctx of CONTEXTS) {
  const A = built(ctx, SEED), B = built(ctx, SEED), C2 = built(ctx, SEED + 1);
  const b = A.b;
  const cls = sizeClass(b.w, b.h);
  const det = sig(A.b) === sig(B.b) && sig(A.b) !== sig(C2.b);
  const bad = [];
  const seen = new Set();
  for (const u of b.units) {
    if (u.dead || u.off || u.fled || u.left) continue;
    if (u.x < 0 || u.y < 0 || u.x >= b.w || u.y >= b.h) { bad.push(`${u.name} off the map`); continue; }
    const c = b.cells[u.y * b.w + u.x];
    if (!CELL[c.k].walk) bad.push(`${u.name} on ${c.k}`);
    if (seen.has(u.x + u.y * b.w)) bad.push(`${u.name} on someone`);
    seen.add(u.x + u.y * b.w);
    if (u.side === "player" && !b.reach[u.y * b.w + u.x]) bad.push(`${u.name} cut off`);
  }
  // Every enemy can be got at: something next to it is reachable (the dead in a hive's openings, guards indoors).
  const near = (u) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => { const x = u.x + dx, y = u.y + dy; return x >= 0 && y >= 0 && x < b.w && y < b.h && b.reach[y * b.w + x]; });
  // (One of the dead shut in a locked room of a building is meant to be: buildingmaps.js LOCKED_DEAD.)
  const lockedIn = (u) => !!b.raid && (b.raid.areas || []).some((a) => a.locked && u.x >= a.x0 && u.x < a.x0 + a.w && u.y >= a.y0 && u.y < a.y0 + a.h);
  const unreachable = b.units.filter((u) => u.side === "enemy" && active(u) && !u.boss && !near(u) && !lockedIn(u)).length;
  let where = "";
  if (!b.raid && !b.tier && !b.setup.ambush) {
    const pc = pcOf(b), E = b.units.filter((u) => u.side === "enemy" && active(u) && !u.boss), P = b.units.filter((u) => u.side === "player");
    const d = E.map((u) => Math.hypot(u.x - pc[0], u.y - pc[1]));
    const [lo, hi] = E.some((u) => u.kind === "zombie") ? CONTACT.DEAD : CONTACT.HUMANS;
    const wallAt = b.setup.layout === "baseAssault" ? Math.min(Math.round((10 * b.w) / 18), CONTACT.PLAYER_X + CONTACT.HUMANS[0]) : null;
    const ok = P.every((u) => u.x < CONTACT.PLAYER_X) && (wallAt != null ? E.every((u) => u.x > wallAt) : d.filter((x) => x >= lo - 1 && x <= hi + 1).length >= d.length * 0.8);
    where = `, your people in the first ${CONTACT.PLAYER_X} columns, theirs ${Math.min(...d).toFixed(0)}–${Math.max(...d).toFixed(0)} tiles off${wallAt != null ? ` behind their wall (column ${wallAt})` : ""}`;
    if (!ok) bad.push(`spawns${where}`);
  }
  const target = b.tier ? (b.tier.map === "interior" || b.deploy?.interior ? INTERIOR.YARD_COVER : 0.5) : coverTarget(A.st.tiles[b.tileId]?.terrain);
  const cs = coverShare(b.cells, b.w, b.h, COVER.R, b.reach);
  // Wall maps are a wall and an approach, not ground to cross: only a token check there.
  const coverOk = cs.share >= target - 0.04;
  const yard = interiorSize(A.st.bases[0]);
  const wantCls = ctx.wallOf ? sizeClass(yard.W, yard.H) === ctx.wallOf : ctx.cls.split("|").includes(cls);
  check(det && !bad.length && !unreachable && coverOk && wantCls,
    `${ctx.name}: ${b.w}×${b.h} (${SIZE_CLASSES[cls].name}${ctx.wallOf ? `; its yard map ${dimStr([interiorSize(A.st.bases[0]).W, interiorSize(A.st.bases[0]).H])}` : ""}), cover within ${COVER.R} tiles of ${Math.round(cs.share * 100)}% of the open ground${where}${det ? "" : " NOT DETERMINISTIC"}${bad.length ? ` [${bad.slice(0, 3).join("; ")}]` : ""}${unreachable ? ` [${unreachable} enemies out of reach]` : ""}`);
  // The first shot or blow, the AI playing both sides (field fights, hives and assaults; raids are a search).
  if (!b.raid && !b.tier) {
    const st = A.st;
    let first = null;
    for (let t = 0; t < 8 && !b.over && first == null; t++) {
      autoPlayerTurn(st);
      if (b.fx.some((e) => e.type === "shot" || e.type === "melee")) first = b.turn;
      runEnemyPhase(st);
      if (first == null && b.fx.some((e) => e.type === "shot" || e.type === "melee")) first = b.turn - 1;
    }
    contactTurns.push([ctx.name, first]);
  }
}
const slow = contactTurns.filter(([, t]) => t == null || t > 3);
check(!slow.length, `the first shot or blow by turn 3 in every fight in the open, hive and assault (${contactTurns.map(([n, t]) => `${n.replace(/^field: /, "")} ${t ?? "never"}`).join(", ")})`);

// ---------- 3. content scales ----------
section("Content scales with the map");
{
  const per = (loc2) => {
    let areas = 0, boxes = 0, dead = 0, w = 0, h = 0;
    for (let i = 0; i < 4; i++) {
      const st = world(SEED * 10 + i, 3);
      const b = raid(st, loc2, [{ kind: "zombies", count: 6, power: 2 }]);
      areas += b.raid.areas.length; boxes += b.raid.containers.length; dead += b.units.filter((u) => u.side === "enemy").length; w = b.w; h = b.h;
    }
    return { areas: areas / 4, boxes: boxes / 4, dead: dead / 4, w, h };
  };
  const gas = per("gas"), mkt = per("supermarket"), hosp = per("hospital");
  check(gas.areas < mkt.areas && mkt.areas < hosp.areas && gas.boxes < hosp.boxes && gas.dead < hosp.dead,
    `raids: a gas station ${gas.w}×${gas.h} ${gas.areas} areas, ${gas.boxes} containers, ${gas.dead} dead; a supermarket ${mkt.w}×${mkt.h} ${mkt.areas}, ${mkt.boxes}, ${mkt.dead}; a hospital ${hosp.w}×${hosp.h} ${hosp.areas}, ${hosp.boxes}, ${hosp.dead} (6 of the dead asked for)`);
  check(raidAreaRange(24, 18)[1] < raidAreaRange(48, 34)[0] && raidDeadScale(24, 18) < 1 && raidDeadScale(40, 30) > 1, `rooms by size ${CLASS_KEYS.map((k) => `${k} ${raidAreaRange(SIZE_CLASSES[k].w, SIZE_CLASSES[k].h).join("–")}`).join(", ")}; the dead ×${raidDeadScale(24, 18).toFixed(2)} on Small to ×${raidDeadScale(48, 34).toFixed(2)} on Extra-large`);
  // Field maps: cover on open plains on every size (the props that top them up).
  const shares = [];
  for (const players of [3, 6, 8]) {
    const st = world(SEED, players);
    const b = field(st, "plains", null, { kind: "zombies", count: players * 3, power: 2 });
    shares.push(`${b.w}×${b.h} ${Math.round(coverShare(b.cells, b.w, b.h, COVER.R, b.reach).share * 100)}%`);
    if (coverShare(b.cells, b.w, b.h, COVER.R, b.reach).share < COVER.OPEN - 0.04) shares.push("LOW");
  }
  check(!shares.includes("LOW"), `open plains topped up with cover on every size (${shares.join(", ")}; target ${Math.round(COVER.OPEN * 100)}%)`);
}

// ---------- 4. the anti-slog ends ----------
section("The anti-slog ends");
{
  const st = world(SEED, 3);
  const b = field(st, "plains", null, { kind: "zombies", count: 8, power: 2 });
  st.combat = b;
  const P = b.units.filter((u) => u.side === "player"), E = b.units.filter((u) => u.side === "enemy");
  // Kill all but two; put the two far off and asleep, out of sight behind full cover.
  E.slice(2).forEach((u) => { u.dead = true; });
  const [z1, z2] = E;
  // Each penned in a corner by walls (it cannot shuffle out into sight while the enemy turn plays).
  const pen = (z, x, y) => {
    z.x = x; z.y = y; z.aware = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < b.w && yy < b.h) b.cells[yy * b.w + xx].k = dx || dy ? "wall" : "open"; }
  };
  pen(z1, b.w - 1, 0); pen(z2, b.w - 1, b.h - 1);
  b.losCache.fill(0);
  check(clearEnough(b), `two unaware stragglers ${CLEAR.FAR}+ tiles off and out of sight: the area is clear enough`);
  z1.aware = true;
  check(!clearEnough(b), "not while one of them is coming");
  z1.aware = false;
  const near = P[0];
  const ox = z1.x, oy = z1.y;
  z1.x = Math.min(b.w - 1, near.x + 3); z1.y = near.y;
  check(!clearEnough(b), "not with one close by");
  z1.x = ox; z1.y = oy;
  // The player's turn: offered once, ended by "callClear" as a win with the stragglers left.
  b.phase = "player";
  endPlayerTurn(st);
  runEnemyPhase(st);
  const offered = b.log.some((l) => /clear enough/.test(l.text));
  const err = combatAct(st, { type: "callClear" });
  check(offered && !err && b.over && b.result.outcome === "victory" && b.result.enemiesLeft === 2, `the player is told (${offered ? "yes" : "no"}) and can call it: a win with ${b.result ? b.result.enemiesLeft : "?"} left (${err || "ok"})`);
  st.combat = null;
  // The AI calls it at once.
  const st2 = world(SEED + 1, 3);
  const b2 = field(st2, "plains", null, { kind: "zombies", count: 6, power: 2 });
  st2.combat = b2;
  const E2 = b2.units.filter((u) => u.side === "enemy");
  E2.slice(1).forEach((u) => { u.dead = true; });
  E2[0].aware = false; E2[0].x = b2.w - 1; E2[0].y = 0;
  for (let y = 0; y < 3; y++) b2.cells[y * b2.w + b2.w - 3].k = "wall";
  b2.cells[0 * b2.w + b2.w - 1].k = "open";
  b2.losCache.fill(0);
  autoPlayerTurn(st2);
  check(b2.over && b2.result.outcome === "victory" && b2.clearedEarly, "the battle AI ends a fight with one straggler far off and unaware");
  // A raider who breaks and runs out of sight is gone, not a long walk to the edge.
  const st3 = world(SEED, 4);
  const b3 = field(st3, "plains", null, { kind: "raiders", count: 6, power: 3 });
  st3.combat = b3;
  const R = b3.units.filter((u) => u.side === "enemy");
  R.slice(1).forEach((u) => { u.dead = true; });
  R[0].fleeing = true; R[0].aware = true; R[0].x = Math.min(b3.w - 5, R[0].x); R[0].y = 1;
  b3.cells[2 * b3.w + R[0].x].k = "wall"; b3.cells[1 * b3.w + R[0].x - 1].k = "wall"; b3.cells[0 * b3.w + R[0].x - 1].k = "wall"; b3.cells[2 * b3.w + R[0].x - 1].k = "wall";
  b3.losCache.fill(0);
  endPlayerTurn(st3);
  runEnemyPhase(st3);
  check(R[0].fled || b3.over, `a raider running from the fight out of sight and ${CLEAR.GONE}+ tiles off gets away (${R[0].fled ? "fled" : "still there"})`);
}

// ---------- 5. measurement ----------
const MATCH = [
  { cls: "S", name: "raid: gas station (3, 5 of the dead)", raid: "gas", groups: [{ kind: "zombies", count: 5, power: 2 }] },
  { cls: "M", name: "raid: supermarket (3, 7 of the dead)", raid: "supermarket", groups: [{ kind: "zombies", count: 7, power: 2 }] },
  { cls: "L", name: "raid: hospital (3, 9 of the dead)", raid: "hospital", groups: [{ kind: "zombies", count: 9, power: 2.5 }] },
  { cls: "M", name: "field: 3 vs 4 raiders", players: 3, terrain: "plains", enemy: { kind: "raiders", count: 4, power: 5 } },
  { cls: "M", name: "field: 3 vs 12 dead", players: 3, terrain: "forest", enemy: { kind: "zombies", count: 12, power: 2 } },
  { cls: "M", name: "field: you ambush 4 vs 12 dead", players: 4, terrain: "hills", enemy: { kind: "zombies", count: 12, power: 2 }, ambush: "player" },
  { cls: "M", name: "field: 6 vs 8 raiders, suburb", players: 6, terrain: "suburb", loc: "town", enemy: { kind: "raiders", count: 8, power: 5 } },
  { cls: "L", name: "field: 8 vs 10 raiders, plains", players: 8, terrain: "plains", enemy: { kind: "raiders", count: 10, power: 5 } },
  { cls: "L", name: "field: 6 vs 20 dead, plains", players: 6, terrain: "plains", enemy: { kind: "zombies", count: 20, power: 3 } },
  { cls: "L", name: "hive: 6 vs 14 brood + Broodmother", players: 6, terrain: "forest", enemy: { kind: "zombies", count: 14, power: 5 }, layout: "hive" },
  { cls: "M", name: "group base: 5 vs 4 (6 people)", players: 5, terrain: "plains", enemy: { kind: "raiders", count: 4, power: 4.5, walls: 2, people: 6 }, layout: "baseAssault" },
  { cls: "XL", name: "group base: 6 vs 10 (60 people)", players: 6, terrain: "plains", enemy: { kind: "raiders", count: 10, power: 4.5, walls: 4, people: 60 }, layout: "baseAssault" },
  { cls: "L", name: "hub siege: 8 vs 16 dead (walls, few buildings)", players: 8, base: ["walls", "barricades", "bunkhouse"], enemy: { kind: "zombies", count: 16, power: 3 } },
  { cls: "XL", name: "hub siege: 8 vs 20 dead (fully built)", players: 8, base: HUB_FULL, enemy: { kind: "zombies", count: 20, power: 3.5 } },
  { cls: "M", name: "outpost: 5 vs 5 raiders (no walls)", players: 5, base: [], outpost: true, enemy: { kind: "raiders", count: 5, power: 4 } },
];
if (!QUICK) {
  section(`Battle length by size class (${N} battles each, the AI on both sides, 60-turn limit; raids to extraction)`);
  const byClass = {};
  let worstMs = 0, allMs = [];
  for (const m of MATCH) {
    let turns = 0, over = 0, clear = 0, won = 0, size = "";
    const ms = [];
    for (let i = 0; i < N; i++) {
      const st = world(SEED * 1000 + i, m.raid ? 3 : m.players);
      let b;
      if (m.raid) b = raid(st, m.raid, m.groups);
      else if (m.base) b = baseFight(st, m.base, { ...m.enemy, name: "attackers" }, m.base.includes("walls"), m.outpost ? "outpost" : "hub");
      else b = field(st, m.terrain, m.loc || null, m.enemy, { layout: m.layout, ambush: m.ambush });
      st.combat = b;
      size = `${b.w}×${b.h}`;
      const limit = b.raid ? 200 : 60;
      let guard = 0;
      while (!b.over && guard++ < limit) {
        autoPlayerTurn(st);
        const t1 = performance.now();
        runEnemyPhase(st);
        ms.push(performance.now() - t1);
      }
      if (!b.over) over++;
      else { if (b.clearedEarly) clear++; if (b.result.outcome === "victory" || b.result.outcome === "extracted") won++; }
      turns += b.turn;
      if (b.over) closeCombat(st); else st.combat = null;
    }
    ms.sort((a, c) => a - c);
    const avgMs = ms.reduce((a, c) => a + c, 0) / Math.max(1, ms.length), maxMs = ms[ms.length - 1] || 0, p95 = ms[Math.floor(ms.length * 0.95)] || 0;
    worstMs = Math.max(worstMs, maxMs);
    allMs.push(...ms);
    const kc = m.base ? m.cls : sizeClass(...size.split("×").map(Number)); // the map's class (a base: its yard's)
    const k = (byClass[kc] = byClass[kc] || { turns: 0, n: 0, over: 0 });
    k.turns += turns; k.n += N; k.over += over;
    console.log(`  ${kc.padEnd(2)} ${m.name.padEnd(46)} ${size.padStart(5)}  turns ${(turns / N).toFixed(1).padStart(4)}  over 60: ${Math.round((over / N) * 100)}%  won ${Math.round((won / N) * 100)}%  called clear ${clear}  AI a turn ${avgMs.toFixed(1)} ms (p95 ${p95.toFixed(1)}, max ${maxMs.toFixed(1)})`);
  }
  console.log(`  by class: ${CLASS_KEYS.filter((k) => byClass[k]).map((k) => `${SIZE_CLASSES[k].name} ${(byClass[k].turns / byClass[k].n).toFixed(1)} turns, ${Math.round((byClass[k].over / byClass[k].n) * 100)}% over the limit`).join("; ")}`);
  allMs.sort((a, c) => a - c);
  const p99 = allMs[Math.floor(allMs.length * 0.99)] || 0;
  check(Object.values(byClass).every((k) => k.over / k.n <= 0.05), "at most 5% of the battles of any class run past the turn limit");
  check(p99 < 40, `the enemy's turn: 99% under 40 ms (p99 ${p99.toFixed(1)} ms, worst ${worstMs.toFixed(1)} ms)`);
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
