// distField's patch (issue #47: src/sim/combat.js distField, fieldPatch, DIST_FIELD): a field made again after a change
// to the map that only made a way cheaper (a door battered, broken in) is patched from the cells round the change, and
// it must be the very field the full search makes. Checked two ways:
//   1. by hand on a walled yard: a door battered, broken, a wall knocked through (patched), a door mended, a wall put
//      up, a window opened (the full search), each field the same number for number as the full search's;
//   2. whole battles played twice in their own processes, the patch on and off (DIST_FIELD.PATCH): a community
//      college's campus, a city hospital's raid (the raid bot playing your side) and a hub's defence (your people
//      holding still), the dead all aware. Every turn's units, hit points, log and cells hash the same both ways, and
//      the patch was used (the raids).
// BS_QUICK=1: fewer turns; in full a state university's campus (500 × 500 cap) too.
// Usage: node tools/fieldpatchtest.js
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, runEnemyPhase, autoPlayerTurn, endPlayerTurn, registerCombatHandler, distField, DIST_FIELD } from "../src/sim/combat.js";
import { launchExpedition } from "../src/sim/parties.js";
import { cleanCfg } from "../src/sim/worldcfg.js";

const QUICK = process.env.BS_QUICK === "1";
registerCombatHandler("fptest", () => {});
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };

// ---------- a battle played (the child): --play <scenario> <turns> <patch 0|1> ----------
function battle(scenario, seed = 42) {
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true; st.cards.length = 0; st.crashNext = 1e9;
  const h = hub(st), crew = atBase(st, h.id).slice(0, 4);
  if (scenario === "defence") {
    st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "zombies", count: 40, power: 3, name: "the dead" }, ambush: null, canRetreat: false, handler: "fptest", context: {} });
    return { st, b: st.combat };
  }
  const party = (t) => {
    const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 60 } }).party;
    p.path = [t.id]; p.idx = 0; p.dest = t.id; p.phase = "engaged";
    return p;
  };
  if (scenario === "hospital") { // a city hospital's raid, its map 160 across, 3 storeys, topped up with the dead
    st.worldCfg = cleanCfg({ raidMin: 80, raidMax: 160 });
    const t = st.tiles.find((x) => x.loc && x.loc.type === "city" && x.id !== h.tile) || st.tiles.find((x) => x.terrain === "city" && x.id !== h.tile);
    const groups = Array.from({ length: 3 }, () => ({ kind: "zombies", count: 20, power: 3 }));
    st.combat = createBattle(st, { mode: "raid", tile: t.id, partyId: party(t).id, canRetreat: true, ambush: null, handler: "fptest", enemy: { kind: "zombies", count: 60, power: 3, groups }, raid: { heat0: 5, place: { id: "hospital:b", key: "hospital", name: "hospital" } }, context: {} });
    if (st.combat.plan) st.combat.plan = null;
    return { st, b: st.combat };
  }
  const t = st.tiles.find((x) => x.loc && x.loc.type === "univ");
  t.loc.campus = scenario === "state" ? "state" : "community";
  const p = party(t);
  const groups = Array.from({ length: 5 }, () => ({ kind: "zombies", count: 20, power: 3 }));
  st.combat = createBattle(st, { mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "fptest", enemy: { kind: "zombies", count: 100, power: 3, name: "the dead", groups }, raid: { heat0: 5 }, context: {} });
  return { st, b: st.combat };
}
function play(scenario, turns, patch) {
  DIST_FIELD.PATCH = patch;
  const { st, b } = battle(scenario);
  const aware = () => { for (const u of b.units) if (u.side === "enemy" && !u.dead) u.aware = true; };
  const hashes = [];
  for (let i = 0; i < turns && st.combat && !b.over; i++) {
    aware();
    if (scenario !== "defence") autoPlayerTurn(st); // the defence: your people hold where they are, the dead batter the walls
    if (!b.over && b.phase === "player") endPlayerTurn(st);
    aware();
    if (!b.over && b.phase === "enemy") runEnemyPhase(st);
    const H = createHash("sha1");
    H.update(JSON.stringify(b.units.map((u) => [u.id, u.x, u.y, u.f || 0, u.hp, !!u.dead, !!u.down, u.ap])));
    H.update(JSON.stringify(b.log.map((l) => l.text)));
    for (const F of b.floors || [b]) H.update((F.cells || b.cells).map((c) => `${c.k}${c.hp ?? ""}${c.bar ?? ""}`).join(","));
    hashes.push(H.digest("hex").slice(0, 12));
  }
  return { hashes, made: DIST_FIELD.made, dead: b.units.filter((u) => u.side === "enemy" && u.dead).length, over: !!b.over };
}

if (process.argv[2] === "--play") {
  console.log(JSON.stringify(play(process.argv[3], Number(process.argv[4]), process.argv[5] === "1")));
  process.exit(0);
}

// ---------- 1. by hand ----------
console.log("By hand: a walled yard");
{
  const { st, b } = battle("defence");
  const W = b.w, at = (x, y) => b.cells[y * W + x];
  for (const c of b.cells) { c.k = "open"; for (const k of ["h", "t", "hp", "mhp", "win", "dk", "car", "under", "boards", "bar", "wet", "gnd", "ice", "ter"]) delete c[k]; }
  b.fires = []; b.acid = []; b.tunnels = null;
  // A yard 20 × 12 walled round, a door each side, a window in the top wall.
  const x0 = 10, y0 = 10, x1 = 30, y1 = 22;
  for (let x = x0; x <= x1; x++) { at(x, y0).k = "wall"; at(x, y1).k = "wall"; }
  for (let y = y0; y <= y1; y++) { at(x0, y).k = "wall"; at(x1, y).k = "wall"; }
  const doorL = at(x0, 16), doorR = at(x1, 16), win = at(20, y0);
  for (const d of [doorL, doorR]) { d.k = "door"; d.hp = 10; d.mhp = 10; }
  win.k = "window"; win.win = { open: false };
  const z = b.units.find((u) => u.side === "enemy" && u.kind === "zombie");
  z.x = 3; z.y = 16; z.f = 0;
  const src = [[20, 16]];
  // The patched field against the full search on the same map (a fresh cache, the patch off).
  const same = (what, expectPatch) => {
    const before = DIST_FIELD.made.patched;
    DIST_FIELD.PATCH = true;
    const f1 = Float32Array.from(distField(b, src, z));
    const patched = DIST_FIELD.made.patched > before;
    const keep = b._fields;
    b._fields = new WeakMap();
    DIST_FIELD.PATCH = false;
    const f2 = distField(b, src, z);
    b._fields = keep;
    DIST_FIELD.PATCH = true;
    let diff = 0;
    for (let i = 0; i < f1.length; i++) if (f1[i] !== f2[i]) diff++;
    check(diff === 0 && patched === expectPatch, `${what}: ${patched ? "patched" : "searched in full"}, ${diff} cells differ (field at the dead ${f1[z.y * W + z.x].toFixed(2)})`);
  };
  same("the first field", false);
  doorL.hp = 6; same("the left door battered (10 → 6 hit points)", true);
  doorL.hp = 3; doorR.hp = 2; same("both doors battered", true);
  doorL.k = "doorway"; delete doorL.hp; delete doorL.mhp; same("the left door broken in", true);
  at(x0, 12).k = "rubble"; same("a wall knocked through", true);
  doorR.hp = 9; same("the right door mended (dearer: the full search)", false);
  at(x0, 12).k = "wall"; same("the wall put back up (closed: the full search)", false);
  win.win.open = true; doorR.hp = 8; same("the window opened, the door battered", true);
  check(isFinite(distField(b, src, z)[z.y * W + z.x]), "the dead's way in is still there");
}

// ---------- 2. whole battles, the patch on and off ----------
console.log("Whole battles, the patch on and off");
const turns = QUICK ? 4 : 8;
const scenarios = QUICK ? ["community", "hospital", "defence"] : ["community", "hospital", "defence", "state"];
for (const sc of scenarios) {
  const run = (patch) => {
    const out = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--play", sc, String(turns), patch ? "1" : "0"], { encoding: "utf8", maxBuffer: 1 << 26 });
    try { return JSON.parse(String(out.stdout).trim().split("\n").pop()); } catch { console.log(String(out.stderr || out.stdout).slice(-1500)); return null; }
  };
  const on = run(true), off = run(false);
  if (!check(!!on && !!off, `${sc}: both runs played`)) continue;
  const firstDiff = on.hashes.findIndex((h, i) => h !== off.hashes[i]);
  check(on.hashes.length === off.hashes.length && firstDiff < 0, `${sc}: the same ${on.hashes.length} turns both ways (${firstDiff < 0 ? "every hash the same" : `turn ${firstDiff + 1} differs`}; ${on.dead} of the dead down)`);
  // The defence (your people holding still, the dead at the walls) is there for its siege fields: new sources most
  // turns, so little or nothing to patch.
  if (sc !== "defence") check(on.made.patched > 0 && off.made.patched === 0, `${sc}: ${on.made.patched} fields patched, ${on.made.full} searched in full after a change the patch cannot take, ${on.made.fresh} fresh (the patch off: ${off.made.fresh} fresh)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
