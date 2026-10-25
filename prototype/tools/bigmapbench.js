// Big raid maps measured (issue #24: raid maps up to 300 × 300): a building's raid in a city, at today's largest raid
// map (56 × 42) and at the run's largest raid map dial raised (200 and 300 across), each with the building forced to
// a few storeys and topped up to N of the dead. Measures, headless:
//   gen     the map made (createBattle: the building, its floors, who is inside);
//   turn    a player turn played by the AI (autoPlayerTurn) plus the enemy phase (runEnemyPhase), the median and the
//           worst of T turns;
//   save    the save with the raid in progress (serializeState: its bytes, and gzipped), after the team walked a floor
//           or two (every visited floor's sight cache);
//   mem     the heap the raid's floors hold (losCache entries).
// --render: the frame time too, in the real game in headless Chromium (playwright; a 1500 × 950 view): the battle
// view redrawn F times on each map, the median frame and the biggest canvas.
// --shots <dir> (with --render): the ground floor and the top floor built revealed with the roofs off, and a blocked
// stair close up when there is one (a taller building's), as PNGs.
// --save5: a save holding five big buildings left as they were (crawl snapshots), its size gzipped.
// Usage: node tools/bigmapbench.js [--sizes 56,200,300] [--dead 60] [--turns 6] [--key hospital] [--storeys 3] [--render] [--shots dir] [--save5]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { createBattle, autoPlayerTurn, runEnemyPhase, endPlayerTurn, registerCombatHandler, CELL, enemyUnit } from "../src/sim/combat.js";
import { saveToString } from "../src/sim/save.js";
import { snapshotBuilding } from "../src/sim/citycrawl.js";
import { cleanCfg } from "../src/sim/worldcfg.js";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SIZES = String(opt("sizes", "56,200,300")).split(",").map(Number);
const DEAD = Number(opt("dead", 60)), TURNS = Number(opt("turns", 6)), KEY = opt("key", "hospital"), STOREYS = Number(opt("storeys", 3));
const RENDER = args.includes("--render");
registerCombatHandler("bench", () => {});
const med = (l) => { const s = l.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)] || 0; };
const ms = (v) => `${v.toFixed(v < 10 ? 1 : 0)} ms`;
const kb = (v) => `${(v / 1024).toFixed(0)} KB`;

// A raid on the city's building `key` with the run's largest raid map `side` across (a city's buildings take it).
export function bigRaid(side, key = KEY, dead = DEAD, storeys = STOREYS, seed = 11) {
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true;
  st.cards.length = 0;
  st.worldCfg = cleanCfg({ raidMin: Math.min(side, 80), raidMax: side });
  const h = hub(st);
  const tile = st.tiles.find((t) => t.loc && t.loc.type === "city" && t.id !== h.tile) || st.tiles.find((t) => t.terrain === "city" && t.id !== h.tile);
  const crew = atBase(st, h.id).slice(0, 4);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4, ammo: 60, meds: 2 } });
  const p = res.party;
  p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
  const groups = [{ kind: "zombies", count: 14, power: 3, name: "the dead" }];
  const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "bench", enemy: { kind: "zombies", count: 14, power: 3, groups }, raid: { heat0: 5, place: { id: `${key}:b`, key, name: key, storeyBonus: Math.max(0, storeys - 3) } }, context: {} };
  const t0 = performance.now();
  st.combat = createBattle(st, setup);
  const gen = performance.now() - t0;
  const b = st.combat;
  // Topped up to `dead` of the dead, on walkable cells of every floor (most on the ground floor).
  const nf = b.floors ? b.floors.length : 1;
  let guard = 0;
  while (b.units.filter((u) => u.side === "enemy" && !u.dead).length < dead && guard++ < 100000) {
    const f = Math.random() < 0.6 ? 0 : 1 + Math.floor(Math.random() * Math.max(1, nf - 1)) % nf;
    const F = b.floors ? b.floors[Math.min(nf - 1, f)] : b;
    const x = Math.floor(Math.random() * b.w), y = Math.floor(Math.random() * b.h), c = F.cells[y * b.w + x];
    if (!CELL[c.k].walk || c.k === "stairs" || b.units.some((u) => (u.f || 0) === f && u.x === x && u.y === y)) continue;
    const u = enemyUnit(b, st.rng, "zombies", 3, b.units.length);
    u.x = x; u.y = y;
    u.f = b.floors ? Math.min(nf - 1, f) : 0; u.away = u.f !== (b.floor || 0);
    b.units.push(u);
  }
  return { st, b, gen };
}

function measure(side) {
  const { st, b, gen } = bigRaid(side);
  const turns = [];
  for (let t = 0; t < TURNS && st.combat && !st.combat.over; t++) {
    const t0 = performance.now();
    autoPlayerTurn(st);
    if (st.combat && !st.combat.over && st.combat.phase === "player") endPlayerTurn(st);
    if (st.combat && !st.combat.over && st.combat.phase === "enemy") runEnemyPhase(st);
    turns.push(performance.now() - t0);
  }
  // Every floor looked at once (each gets its sight cache, as a team that climbed them).
  const B = st.combat || b;
  let losN = 0;
  for (const F of B.floors || [B]) { const c = F.losCache; if (c) losN += c instanceof Map ? c.size : c.length; }
  const t1 = performance.now();
  const json = saveToString(st);
  const saveT = performance.now() - t1;
  const gz = gzipSync(Buffer.from(json)).length;
  return { side, w: b.w, h: b.h, storeys: b.floors ? b.floors.length : 1, dead: b.units.filter((u) => u.side === "enemy").length, gen, turnMed: med(turns), turnMax: Math.max(...turns, 0), save: json.length, gz, saveT, losN, heap: process.memoryUsage().heapUsed };
}

// A save holding five big buildings left as they were (the city crawl's snapshots, citycrawl.js snapshotBuilding: every
// floor packed), each explored a few turns first: its bytes and gzipped (the browser stores saves gzipped: ui/saves.js),
// against the same world with none.
function saveFive(side) {
  const keys = ["hospital", "factory", "warehouse", "offices", "apartments"];
  const base = bigRaid(side, "hospital", 10, 3, 21);
  const st = base.st;
  st.combat = null;
  const empty = saveToString(st);
  const tile = st.tiles.find((t) => t.loc && t.loc.type === "city");
  tile.crawlMem = tile.crawlMem || { visits: 0, looted: {}, alert: 0, hour: 0 };
  tile.crawlMem.snaps = {};
  let cells = 0;
  for (const key of keys) {
    const { st: s2, b } = bigRaid(side, key, 30, 4, 21 + key.length);
    for (let t = 0; t < 2 && s2.combat && !s2.combat.over; t++) { autoPlayerTurn(s2); if (s2.combat && s2.combat.phase === "player") endPlayerTurn(s2); if (s2.combat && s2.combat.phase === "enemy") runEnemyPhase(s2); }
    const B = s2.combat || b;
    tile.crawlMem.snaps[`cc1-${key}`] = snapshotBuilding(B);
    cells += B.w * B.h * (B.floors ? B.floors.length : 1);
  }
  const full = saveToString(st);
  return { side, cells, empty: empty.length, emptyGz: gzipSync(Buffer.from(empty)).length, full: full.length, fullGz: gzipSync(Buffer.from(full)).length };
}

// The frame in the real game: the battle view drawn F times on a raid of each size (the first frame builds the
// pictures; the median of the rest is the frame), on the ground floor and on the top floor, and the biggest canvas
// the page made.
async function render(sizes, F = 30) {
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const port = 5900 + Math.floor(Math.random() * 400);
  const srv = spawn(process.execPath, [path.join(here, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  const out = [];
  try {
    await new Promise((r) => setTimeout(r, 800));
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.addInitScript(() => {
      window.__canvases = [];
      const mk = Document.prototype.createElement;
      Document.prototype.createElement = function (t, o) { const el = mk.call(this, t, o); if (String(t).toLowerCase() === "canvas") window.__canvases.push(el); return el; };
    });
    const shotDir = opt("shots", null);
    if (shotDir) {
      const fs = require("fs");
      fs.mkdirSync(shotDir, { recursive: true });
      await page.addInitScript(() => { window.__shots = true; });
      await page.exposeFunction("__shot", async (name) => { const f = path.join(shotDir, `${name}.png`); await page.screenshot({ path: f }); console.log(`  shot ${f}`); });
    }
    await page.goto(`http://localhost:${port}/?notitle`);
    await page.waitForFunction(() => window.game && document.querySelector('[data-action="begin"]'), null, { timeout: 30000 });
    await page.click('[data-action="begin"]');
    await page.waitForFunction(() => window.game.state.started, null, { timeout: 30000 });
    for (const side of sizes) {
      const prof = args.includes("--profile") && side === sizes[sizes.length - 1] ? await page.context().newCDPSession(page) : null;
      if (prof) { await prof.send("Profiler.enable"); await prof.send("Profiler.setSamplingInterval", { interval: 200 }); await page.exposeFunction("__profStart", () => prof.send("Profiler.start")); }
      const r = await page.evaluate(async ({ side, F, key, storeys, profile }) => {
        const IV = await import("/src/ui/isoview.js"), P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js"), C = await import("/src/sim/worldcfg.js"), CB = await import("/src/ui/combat.js"), SIM = await import("/src/sim/combat.js");
        const st = game.state, hub = W.hub(st);
        if (st.combat) st.combat = null;
        st.worldCfg = C.cleanCfg({ raidMin: Math.min(side, 80), raidMax: side });
        const t = st.tiles.find((x) => x.loc && x.loc.type === "city" && x.id !== hub.tile) || st.tiles.find((x) => x.terrain === "city" && x.id !== hub.tile);
        const crew = W.atBase(st, hub.id).filter((s) => s.alive).slice(0, 4);
        for (const s of crew) s.location = { kind: "base", baseId: hub.id };
        hub.stock.ammo = 400; hub.stock.food = 100; hub.stock.water = 100; hub.stock.meds = 10;
        const res = P.launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2, ammo: 20, meds: 1 } });
        if (!res.party) return { err: JSON.stringify(res).slice(0, 200) };
        const p = res.party;
        p.path = [t.id]; p.idx = 0; p.phase = "engaged";
        game.ui.speed = 0;
        const groups = [{ kind: "zombies", count: 14, power: 3, name: "the dead" }];
        game.combat.start({ mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: 14, power: 3, name: "the dead", groups }, raid: { heat0: 5, place: { id: `${key}:r${side}`, key, name: key, storeyBonus: Math.max(0, storeys - 3) } }, context: {} });
        const b = st.combat;
        if (!b) return { err: "no battle" };
        await new Promise((r) => setTimeout(r, 300));
        const time = (n) => { const l = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); CB.drawCombat(st, performance.now()); l.push(performance.now() - t0); } return l; };
        window.__canvases.length = 0;
        const first = time(1)[0];
        if (profile) await window.__profStart();
        const rest = time(F).sort((a, q) => a - q);
        let top = null;
        if (b.floors && b.floors.length > 1) {
          const u = b.units.find((x) => x.side === "player");
          SIM.setFloor(b, b.floors.length - 1);
          if (u) { u.f = b.floor; u.away = false; }
          const f1 = time(1)[0], fr = time(F).sort((a, q) => a - q);
          top = { first: f1, med: fr[Math.floor(fr.length / 2)] };
          SIM.setFloor(b, 0);
          if (u) u.f = 0;
        }
        const big = window.__canvases.reduce((m, c) => Math.max(m, c.width, c.height), 0);
        // --shots: the floors revealed with the roofs off (every cell seen and known), the building filling the view,
        // and a close look at a blocked stair (a taller building's top floor built), each as the page stands.
        const shots = [];
        if (window.__shots) {
          const reveal = () => { CB.drawCombat(st, performance.now()); const ca = CB.cui.cache; if (ca.vis) ca.vis.fill(1); if (ca.known && ca.known.cells) ca.known.cells.fill(1); CB.drawCombat(st, performance.now()); };
          IV.setRoofs(false);
          const B = b.raid.plan && b.raid.plan.building;
          const u = b.units.find((x) => x.side === "player");
          for (const f of b.floors ? [0, b.floors.length - 1] : [0]) {
            if (b.floors) { SIM.setFloor(b, f); if (u) { u.f = f; u.away = false; } }
            IV.iso.zoom = 1; if (B) IV.isoCenterOn(b, B.x0 + (B.w >> 1), B.y0 + (B.h >> 1), false);
            reveal();
            await window.__shot(`${key}-${side}-floor${f + 1}`);
            const seal = b.cells.findIndex((c) => c.sealUp && c.top);
            if (seal >= 0) { IV.iso.zoom = 6; IV.isoCenterOn(b, seal % b.w, (seal / b.w) | 0, false); reveal(); await window.__shot(`${key}-${side}-floor${f + 1}-stairs-${b.cells[seal].sealUp}`); }
            shots.push(f);
          }
          if (b.floors) { SIM.setFloor(b, 0); if (u) u.f = 0; }
          IV.setRoofs(true);
        }
        const px = window.__canvases.reduce((m, c) => m + c.width * c.height, 0);
        const w = b.w, h = b.h, n = b.floors ? b.floors.length : 1;
        st.combat = null; st.parties = st.parties.filter((x) => x !== p); for (const s of crew) s.location = { kind: "base", baseId: hub.id };
        return { zoom: IV.iso.zoom, w, h, n, first, med: rest[Math.floor(rest.length / 2)], p90: rest[Math.floor(rest.length * 0.9)], top, big, px };
      }, { side, F, key: KEY, storeys: STOREYS, profile: !!prof });
      if (prof) {
        const { profile: pr } = await prof.send("Profiler.stop");
        const self = new Map(), byId = new Map(pr.nodes.map((n) => [n.id, n]));
        pr.samples.forEach((id, i) => { const n = byId.get(id), k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (pr.timeDeltas[i] || 0)); });
        console.log("self time (ms) over the frames:");
        for (const [k, v] of [...self].sort((a, q) => q[1] - a[1]).slice(0, 25)) console.log(`  ${(v / 1000).toFixed(0).padStart(6)} ${k}`);
      }
      out.push({ side, ...r });
    }
    if (errs.length) console.log("page errors:", errs.slice(0, 3).join(" | "));
    await browser.close();
  } finally { srv.kill(); }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`Big raid maps: a city ${KEY} (${STOREYS}+ storeys) with ${DEAD} dead, ${TURNS} turns each`);
  console.log("side  map        floors dead  gen       turn med  turn max  save       gzip      save time losCache   heap");
  for (const side of SIZES) {
    const r = measure(side);
    console.log(`${String(side).padEnd(5)} ${`${r.w}×${r.h}`.padEnd(10)} ${String(r.storeys).padEnd(6)} ${String(r.dead).padEnd(5)} ${ms(r.gen).padEnd(9)} ${ms(r.turnMed).padEnd(9)} ${ms(r.turnMax).padEnd(9)} ${kb(r.save).padEnd(10)} ${kb(r.gz).padEnd(9)} ${ms(r.saveT).padEnd(9)} ${String(r.losN).padEnd(10)} ${(r.heap / 1048576).toFixed(0)} MB`);
    if (global.gc) global.gc();
  }
  if (args.includes("--save5")) {
    console.log("\nA save with five big buildings left as they were (hospital, factory, warehouse, offices, apartments: crawl snapshots):");
    for (const side of SIZES) { const r = saveFive(side); console.log(`  raid map dial ${side}: ${(r.cells / 1e6).toFixed(2)} M cells of floors; the save ${kb(r.full)} (${kb(r.fullGz)} gzipped) against ${kb(r.empty)} (${kb(r.emptyGz)}) without them: +${kb(r.fullGz - r.emptyGz)} gzipped`); }
  }
  if (RENDER) {
    console.log("\nThe frame (1500 × 950 view; the first frame builds the pictures):");
    console.log("side  map        floors first     median    p90       top first top median biggest canvas  canvas px");
    for (const r of await render(SIZES)) {
      if (r.err) { console.log(`${r.side}: ${r.err}`); continue; }
      console.log(`${String(r.side).padEnd(5)} ${`${r.w}×${r.h}`.padEnd(10)} ${String(r.n).padEnd(6)} ${ms(r.first).padEnd(9)} ${ms(r.med).padEnd(9)} ${ms(r.p90).padEnd(9)} ${(r.top ? ms(r.top.first) : "-").padEnd(9)} ${(r.top ? ms(r.top.med) : "-").padEnd(10)} ${`${r.big} px`.padEnd(15)} ${(r.px / 1e6).toFixed(1)} M  zoom ${r.zoom}`);
    }
  }
}
