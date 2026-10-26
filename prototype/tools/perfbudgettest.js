// The turn's time budget on the biggest maps (issue #47): a raid at each map cap with 100 and with 200 of the dead,
// every one of them aware (the worst case: the whole horde pathing toward the team), the raid bot playing your side.
// Each run is its own node process (a clean heap, nothing warm from the run before); the table gives the map, the
// build, the player's turn, the enemy phase and the whole turn (mean and worst), and the test fails when a run's mean
// turn is over its budget: BUDGET_MS a hundred of the dead (1.5 s for 100, 3 s for 200).
// The sites (SITES): 300 (the default cap: a 4-storey hospital), 400 (a prison complex), 500 (a state university's
// campus and the mega mall). Any building with a raid map of its own is timed too with --key (its map side from
// battlesize.js MAP_CAP, or --side): wave 2's stadiums, zoos, data centres and hospitals at their new caps.
// Slow (a minute or two in all), so not in the gate; BS_QUICK=1 plays 2 turns a run instead of 4.
// Usage: node tools/perfbudgettest.js [--sites 300,400,campus,mall] [--key stadium,zoo] [--side 500] [--dead 100,200]
//   --key <key>/<plan>: that plan of the kind pinned (datacenter/hyperscale: a data centre's campus, issue #51).
//                                     [--turns 4] [--seed 42] [--budget 1500] [--storeys 3]
//   --budget: the mean turn allowed a hundred of the dead, in ms. --sites none with --key: only those buildings.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const BUDGET_MS = 1500; // a hundred of the dead (the issue's 1.5 s a turn with 100 at 500 × 500)
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const QUICK = process.env.BS_QUICK === "1";

// ---------- one run (the child): node tools/perfbudgettest.js --one <site> <dead> <turns> <seed> ----------
async function one(site, dead, turns, seed) {
  const { createWorld, hub, atBase } = await import("../src/sim/world.js");
  const { createBattle, runEnemyPhase, autoPlayerTurn, endPlayerTurn, registerCombatHandler, enemyUnit, CELL } = await import("../src/sim/combat.js");
  const { launchExpedition } = await import("../src/sim/parties.js");
  const { cleanCfg } = await import("../src/sim/worldcfg.js");
  const { mapCap } = await import("../src/sim/battlesize.js");
  registerCombatHandler("perfbudget", () => {});
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true; st.cards.length = 0; st.crashNext = 1e9;
  const h = hub(st), crew = atBase(st, h.id).slice(0, 4);
  const party = (tile) => {
    const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 60, meds: 2 } }).party;
    p.path = [tile.id]; p.idx = 0; p.dest = tile.id; p.phase = "engaged";
    return p;
  };
  const zombies = [{ kind: "zombies", count: 20, power: 3 }];
  let setup;
  if (site === "campus") { // a state university (campus.js), at CAMPUS.MAX 500
    const t = st.tiles.find((x) => x.loc && x.loc.type === "univ");
    t.loc.campus = "state";
    setup = { mode: "raid", tile: t.id, partyId: party(t).id, canRetreat: true, ambush: null, handler: "perfbudget", enemy: { kind: "zombies", count: 100, power: 3, name: "the dead", groups: Array.from({ length: 5 }, () => zombies[0]) }, raid: { heat0: 5 }, context: {} };
  } else if (site === "mall") { // a regional mall's biggest variant (mall.js REGIONAL_VARIANTS mega), at MAP_CAP regionalmall 500
    const { poiRaidSetup } = await import("../src/sim/poiraid.js");
    const t = st.tiles.find((x) => x.loc && x.loc.type === "mall" && x.pois && x.pois[0] && x.pois[0].site);
    const rs = poiRaidSetup(st, t, 0);
    setup = { mode: "raid", tile: t.id, partyId: party(t).id, canRetreat: true, ambush: null, handler: "perfbudget", enemy: { kind: "zombies", count: 0, power: 3, name: "the dead", groups: zombies }, raid: { heat0: 5, poi: 0, kind: rs.kind || null, place: { id: "regionalmall", key: "regionalmall", name: "Mall", variant: "mega" } }, context: {} };
  } else { // a city's building by its key (buildingmaps.js BUILDINGS), its map `side` across: "300" a hospital, "400" a prison, "key:side"
    const [kp, s] = site === "300" ? ["hospital", 300] : site === "400" ? ["prison", 400] : site.split(":");
    const [key, plan] = String(kp).split("/"); // key/plan: one of the kind's named plans pinned (a data centre's hyperscale campus: datacenter/hyperscale)
    const side = Number(s) || mapCap(key) || 300, storeys = Number(opt("storeys", 3));
    st.worldCfg = cleanCfg({ raidMin: Math.min(side, 80), raidMax: side });
    const t = st.tiles.find((x) => x.loc && x.loc.type === "city" && x.id !== h.tile) || st.tiles.find((x) => x.terrain === "city" && x.id !== h.tile);
    setup = { mode: "raid", tile: t.id, partyId: party(t).id, canRetreat: true, ambush: null, handler: "perfbudget", enemy: { kind: "zombies", count: 20, power: 3, groups: zombies }, raid: { heat0: 5, place: { id: `${key}:b`, key, name: key, storeyBonus: Math.max(0, storeys - 3), ...(plan ? { plan } : {}) } }, context: {} };
  }
  let t0 = performance.now();
  const b = createBattle(st, setup);
  st.combat = b;
  const buildMs = performance.now() - t0;
  if (b.plan) b.plan = null; // raidplan.js: straight in
  // Exactly `dead` of the dead: the extra ones dropped, or more of them on free walkable cells (most on the ground floor),
  // placed on the run's own dice (a seeded LCG: the same cells every time).
  const isDead = (u) => u.side === "enemy" && u.kind === "zombie" && !u.dead;
  const have = b.units.filter(isDead);
  for (const u of have.slice(dead)) b.units.splice(b.units.indexOf(u), 1);
  let r = seed >>> 0;
  const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
  const nf = b.floors ? b.floors.length : 1, taken = new Set(b.units.map((u) => `${u.f || 0},${u.x},${u.y}`));
  for (let n = have.length, guard = 0; n < dead && guard < 1e6; guard++) {
    const f = rnd() < 0.6 || nf === 1 ? 0 : 1 + Math.floor(rnd() * (nf - 1));
    const F = b.floors ? b.floors[f] : b, x = Math.floor(rnd() * b.w), y = Math.floor(rnd() * b.h), c = F.cells[y * b.w + x];
    if (!CELL[c.k].walk || c.k === "stairs" || taken.has(`${f},${x},${y}`)) continue;
    const u = enemyUnit(b, st.rng, "zombies", 3, b.units.length);
    u.x = x; u.y = y; u.f = f; u.away = f !== (b.floor || 0);
    b.units.push(u); taken.add(`${f},${x},${y}`); n++;
  }
  const aware = () => { for (const u of b.units) if (isDead(u)) u.aware = true; };
  const pt = [], et = [];
  for (let i = 0; i < turns && st.combat && !b.over; i++) {
    aware();
    t0 = performance.now();
    autoPlayerTurn(st);
    if (!b.over && b.phase === "player") endPlayerTurn(st);
    const mid = performance.now();
    aware();
    if (!b.over && b.phase === "enemy") runEnemyPhase(st);
    pt.push(mid - t0); et.push(performance.now() - mid);
  }
  return { site, map: `${b.w}x${b.h}`, floors: nf, dead: b.units.filter((u) => u.side === "enemy" && u.kind === "zombie").length, buildMs, pt, et, over: !!b.over };
}

if (args[0] === "--one") {
  const res = await one(args[1], Number(args[2]), Number(args[3]), Number(args[4]));
  console.log(JSON.stringify(res));
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const SITES = { 300: "300", 400: "400", campus: "campus", mall: "mall" };
  const sites = String(opt("sites", "300,400,campus,mall")).split(",").filter((s) => s && s !== "none").map((s) => SITES[s] || s);
  const side = opt("side", "");
  for (const k of String(opt("key", "")).split(",").filter(Boolean)) sites.push(`${k}:${side}`);
  const deads = String(opt("dead", "100,200")).split(",").map(Number);
  const turns = Number(opt("turns", QUICK ? 2 : 4)), seed = Number(opt("seed", 42)), budget = Number(opt("budget", BUDGET_MS));
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const rows = [];
  let fails = 0;
  for (const site of sites) for (const dead of deads) {
    const out = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--one", site, String(dead), String(turns), String(seed)], { encoding: "utf8", maxBuffer: 1 << 26 });
    const line = String(out.stdout || "").trim().split("\n").pop();
    let res = null;
    try { res = JSON.parse(line); } catch { /* reported below */ }
    if (!res) { fails++; console.log(`FAIL ${site} with ${dead} dead: the run broke\n${String(out.stderr || out.stdout).slice(-1500)}`); continue; }
    const turn = res.pt.map((v, i) => v + res.et[i]), limit = (budget * dead) / 100, ok = turn.length > 0 && mean(turn) <= limit;
    if (!ok) fails++;
    rows.push([ok ? "ok" : "OVER", site, res.map, res.floors, res.dead, Math.round(res.buildMs), Math.round(mean(res.pt)), Math.round(mean(res.et)), Math.round(Math.max(...res.et, 0)), Math.round(mean(turn)), Math.round(Math.max(...turn, 0)), limit, turn.length + (res.over ? " (over)" : "")]);
  }
  const head = ["", "site", "map", "floors", "dead", "build ms", "player ms", "enemy ms", "enemy worst", "turn ms", "turn worst", "budget", "turns"];
  const wid = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  for (const r of [head, ...rows]) console.log(r.map((v, i) => String(v).padStart(wid[i])).join("  "));
  console.log(fails ? `${fails} run(s) over budget or broken` : `All ${rows.length} runs within budget (${budget} ms a hundred of the dead)`);
  process.exit(fails ? 1 : 0);
}
