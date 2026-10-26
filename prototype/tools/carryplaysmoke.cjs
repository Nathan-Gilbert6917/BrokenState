// The carry playthrough in the browser (issue #48, the user's request 2026-10-26): the first steps of
// tools/carryplaytest.js's scene A driven through the real game's UI with Playwright, a screenshot at each step.
// Optional and by hand, outside the gate (it starts the server and a browser). A house raid with two survivors and the
// team's vehicle, nobody else on the map, the doors propped open: the two by the fridge, Lift from the battle panel (the
// Lift order, then "With <name>" in its chooser), the two carry it to the vehicle (move orders, as clicks on the map
// give them), Load into vehicle, then everyone extracts and the raid's summary shows the fridge in the loot.
// Usage: node tools/carryplaysmoke.cjs [outdir]   (default: the scratch dir carryplay-shots; prints one line a shot,
// exits 1 on a page error or a step that did not happen)
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const outDir = path.resolve(process.argv[2] || path.join(os.tmpdir(), "carryplay-shots"));
const port = 5300 + Math.floor(Math.random() * 600);
let bad = 0;

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  let browser = null;
  try {
    await new Promise((r) => setTimeout(r, 700));
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await page.goto(`http://localhost:${port}/?notitle`);
    await page.waitForFunction(() => window.game && document.querySelector('[data-action="begin"]'), null, { timeout: 30000 });
    await page.click('[data-action="begin"]');
    await page.waitForFunction(() => window.game.state.started, null, { timeout: 30000 });
    let n = 0;
    const shot = async (name, line) => {
      await page.evaluate(async () => {
        const I = await import("/src/ui/isoview.js"), b = game.state.combat;
        document.querySelectorAll(".tipbox, .coach").forEach((e) => e.remove && e.remove());
        if (b && !b.over) {
          const us = b.units.filter((u) => u.side === "player" && !u.left);
          if (us.length) { while (I.iso.zoom < 5) I.isoZoom(b, 1); I.isoCenterOn(b, Math.round(us.reduce((a, u) => a + u.x, 0) / us.length), Math.round(us.reduce((a, u) => a + u.y, 0) / us.length), false); }
          I.setRoofs(false);
          b.rev = (b.rev || 0) + 1;
        }
        game.refresh();
      });
      await page.waitForTimeout(400);
      const f = path.join(outDir, `${String(++n).padStart(2, "0")}-${name}.png`);
      await page.screenshot({ path: f });
      console.log(`${f}  ${line}`);
    };
    const step = (ok, what) => { if (!ok) { bad++; console.log(`FAIL: ${what}`); } return ok; };
    // A house with the van, at noon, nobody else on the map (the script is about the carrying, as carryplaytest.js).
    const setup = await page.evaluate(async () => {
      const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js"), POI = await import("/src/sim/pois.js"), PR = await import("/src/sim/poiraid.js");
      const st = game.state, hub = W.hub(st);
      st.hour = Math.floor(st.hour / 24) * 24 + 12;
      let ti = null;
      for (const t of st.tiles) { if (t.id === hub.tile || ti) continue; const L = POI.poisOf(t); for (let i = 0; i < L.length && !ti; i++) if (L[i].kind === "house" && !POI.isSitePoi(t, i)) ti = [t, i]; }
      const [t, i] = ti;
      const crew = W.atBase(st, hub.id).filter((s) => s.alive).slice(0, 2);
      const v = st.vehicles.find((x) => x.type !== "bike" && x.loc && x.loc.kind === "base" && x.loc.baseId === hub.id);
      const r = P.launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: v ? v.id : null, supplies: { food: 2, water: 2, ammo: 10 } });
      if (!r.party) return { err: "launch" };
      const p = r.party;
      p.path = [t.id]; p.idx = 0; p.phase = "engaged";
      game.ui.speed = 0;
      const rs = PR.poiRaidSetup(st, t, i);
      game.combat.start({ mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: 0, power: 3, name: "nobody", groups: [] }, raid: { heat0: 0, choose: rs.choose, poi: i, kind: rs.kind || null, place: rs.place || null }, context: {} });
      const b = st.combat;
      if (!b) return { err: "no battle" };
      b.raid.choose = null;
      b.units = b.units.filter((u) => u.side === "player");
      b.corpses = []; b.infection = 0; b.raid.spawnCap = 0;
      for (const c of b.cells) if (c.k === "idoor") c.k = "odoor"; // the doors propped open first: hands full, nobody opens one (carryplaytest.js walks them open)
      for (const u of b.units) u.ap = 2;
      return { van: v ? v.type : null, w: b.w, h: b.h };
    });
    console.log("raid:", JSON.stringify(setup));
    if (setup.err) throw new Error(setup.err);
    await page.waitForTimeout(800);
    await shot("raid", "the house raid: two survivors, the van at the front");
    // The two stood by the fridge (or one stood in the kitchen), the first selected: Lift from the panel.
    const at = await page.evaluate(async () => {
      const C = await import("/src/sim/combat.js"), UI = await import("/src/ui/combat.js"), b = game.state.combat;
      const [u, o] = b.units;
      const free = (x, y) => { const c = b.cells[y * b.w + x]; return c && C.CELL[c.k] && C.CELL[c.k].walk && c.k !== "vehicle" && !b.units.some((q) => q.x === x && q.y === y); };
      let F = null;
      for (let j = 0; j < b.cells.length && !F; j++) if (b.cells[j].k === "fridge") F = { x: j % b.w, y: (j / b.w) | 0 };
      if (!F) for (let j = 0; j < b.cells.length && !F; j++) { const x = j % b.w, y = (j / b.w) | 0; if (b.cells[j].k === "open" && b.cells[j].f === "floor" && free(x + 1, y) && free(x + 1, y + 1)) { b.cells[j].k = "fridge"; F = { x, y }; } }
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: F.x + dx, y: F.y + dy })).find((q) => free(q.x, q.y));
      u.x = near.x; u.y = near.y;
      const beside = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => ({ x: u.x + dx, y: u.y + dy })).find((q) => free(q.x, q.y) && !(q.x === F.x && q.y === F.y));
      o.x = beside.x; o.y = beside.y;
      b.losCache.fill(0);
      UI.cui.sel = u.id;
      game.refresh();
      return { F, u: [u.x, u.y], o: [o.x, o.y] };
    });
    await shot("by-the-fridge", `the two by the fridge at ${at.F.x},${at.F.y}`);
    const clickOrder = async (v, k = null) => page.evaluate(async ({ v, k }) => {
      const sel = k == null ? `[data-action="cb-act"][data-v="${v}"]:not([data-k])` : `[data-action="cb-act"][data-v="${v}"][data-k="${k}"]`;
      const el = document.querySelector(sel);
      if (el && !el.disabled) { el.click(); return "clicked"; }
      const UI = await import("/src/ui/combat.js");
      UI.combatAction(game.state, "cb-act", k == null ? { v } : { v, k }); // the same handler a click runs (the tray folded away)
      game.refresh();
      return "handler";
    }, { v, k });
    console.log("Lift:", await clickOrder("liftPiece"));
    await page.waitForTimeout(300);
    const chooser = await page.evaluate(() => [...document.querySelectorAll('[data-action="cb-act"][data-v="liftPiece"][data-k]')].map((e) => ({ k: e.dataset.k, t: e.textContent })));
    await shot("lift-chooser", `the Lift chooser: ${chooser.map((c) => c.t).join(", ") || "(none shown)"}`);
    const withK = (chooser.find((c) => /^With /.test(c.t)) || {}).k || `${at.F.x},${at.F.y},${await page.evaluate(() => game.state.combat.units[1].id)},-1`;
    console.log("With:", await clickOrder("liftPiece", withK));
    const lifted = await page.evaluate(() => { const [u, o] = game.state.combat.units; return { piece: u.piece, tether: u.tether === o.id, share: u.shareKg }; });
    step(lifted.piece === "fridge" && lifted.tether, `the two lift the fridge (${JSON.stringify(lifted)})`);
    await shot("lifted", `lifted between the two, ${lifted.share} kg each`);
    // Out to the van: move orders, a turn ended when the actions run out.
    const walked = await page.evaluate(async () => {
      const C = await import("/src/sim/combat.js"), b = game.state.combat, st = game.state;
      const z = b.raid.zones[b.raid.vehicleZone >= 0 ? b.raid.vehicleZone : 0];
      const spots = []; for (let y = z.y0; y < z.y0 + z.h; y++) for (let x = z.x0; x < z.x0 + z.w; x++) spots.push({ x, y });
      let moves = 0;
      for (let g = 0; g < 60; g++) {
        const [u, o] = b.units;
        if (spots.some((s) => (s.x === u.x && s.y === u.y) || (s.x === o.x && s.y === o.y))) break;
        if (u.ap < 1) { C.endPlayerTurn(st); C.runEnemyPhase(st); b.units = b.units.filter((q) => q.side === "player"); for (const q of b.units) q.ap = 2; }
        let best = null;
        for (const lead of [u, o]) {
          const r = C.reachable(b, lead, 400, { manual: true });
          const s = spots.filter((q) => isFinite(r.dist[q.y * b.w + q.x])).sort((a, c) => r.dist[a.y * b.w + a.x] - r.dist[c.y * b.w + c.x])[0];
          if (s && (!best || r.dist[s.y * b.w + s.x] < best.d)) best = { lead, r, s, d: r.dist[s.y * b.w + s.x] };
        }
        if (!best) return { moves, err: "no way to the van" };
        const path = C.pathTo(best.r, best.s.x, best.s.y), mob = C.moveMob(best.lead);
        let err = "no step";
        for (let k = path.length - 1; k >= 0 && err; k--) if (best.r.dist[path[k][1] * b.w + path[k][0]] <= mob) err = C.combatAct(st, { type: "move", unit: best.lead.id, x: path[k][0], y: path[k][1] });
        if (err) { C.endPlayerTurn(st); C.runEnemyPhase(st); b.units = b.units.filter((q) => q.side === "player"); for (const q of b.units) q.ap = 2; continue; }
        moves++;
      }
      game.refresh();
      return { moves };
    });
    step(!walked.err, `carried out to the van (${JSON.stringify(walked)})`);
    await shot("at-the-van", `at the van after ${walked.moves} moves, still tethered`);
    const stowed = await page.evaluate(async () => {
      const R = await import("/src/sim/raidloot.js"), UI = await import("/src/ui/combat.js"), b = game.state.combat;
      const u = b.units.find((q) => R.atVehicle(b, q)) || b.units[0];
      if (u.ap < 1) u.ap = 1;
      UI.cui.sel = u.id;
      game.refresh();
      return u.id;
    });
    console.log("Load:", await clickOrder("stowPiece"));
    const inVan = await page.evaluate(async () => { const P = await import("/src/sim/raidloot.js"); const p = P.raidParty(game.state, game.state.combat); return (p.cargo.gear || []).some((it) => it.key === "fridge"); });
    step(inVan, `the fridge in the van's cargo (unit ${stowed})`);
    await shot("loaded", "Load into vehicle: the fridge in the van");
    // Everyone extracts: the summary.
    await page.evaluate(async () => {
      const C = await import("/src/sim/combat.js"), b = game.state.combat, st = game.state;
      for (const u of b.units) { if (u.left) continue; u.ap = 2; const z = b.raid.zones[b.raid.vehicleZone >= 0 ? b.raid.vehicleZone : 0]; for (let y = z.y0; y < z.y0 + z.h && !u.left; y++) for (let x = z.x0; x < z.x0 + z.w && !u.left; x++) if (!b.units.some((q) => q !== u && q.x === x && q.y === y) && C.CELL[b.cells[y * b.w + x].k].walk) { u.x = x; u.y = y; C.combatAct(st, { type: "extract", unit: u.id }); } }
      if (!b.over) { C.endPlayerTurn(st); C.runEnemyPhase(st); }
      game.refresh();
    });
    await shot("summary", "the raid's end");
    if (errs.length) { bad++; console.log("page errors:", errs.slice(0, 5).join(" | ")); }
  } catch (e) {
    bad++;
    console.log("FAIL:", String(e.stack || e).split("\n").slice(0, 3).join(" | "));
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }
  console.log(bad ? `${bad} problem(s)` : "smoke ok");
  process.exit(bad ? 1 : 0);
})();
