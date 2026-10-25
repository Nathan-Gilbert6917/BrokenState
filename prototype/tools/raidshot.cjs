// A raid on a big map in the real game (World… Raid map dials), saved as PNGs and measured: the Before you go in window
// with the map's size, then the battle screen as the team goes in, and the camera (zoom, whether your people are on
// screen, how much of the map shows). Usage: NODE_PATH=$(npm root -g) node tools/raidshot.cjs [outdir] [raidMin raidMax] [site] [noon]
// e.g. raidshot.cjs /tmp/shots 80 80 farm (a street map 80 × 60) or 80 80 hospital (a building's map; house, hospital:
// the decor inside, battle-<n>-inside.png with the roofs off). Starts the
// prototype's server on a free port and drives headless Chromium; prints one JSON line a shot.
// Site "furniture" (issue #8): a town raid with one of every kind of the furniture catalogue laid out on its map
// (tools/isobattles.js showroom), shot close up in two turns of the view as well (furniture-*.png).
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots"));
const [rawMin, rawMax] = [Number(process.argv[3] || 80), Number(process.argv[4] || 80)];
const show = process.argv[5] === "furniture"; // the furniture showroom on a town's raid map
const site = show ? "town" : process.argv[5] || "farm";
const noon = process.argv[6] === "noon"; // the raid at midday (the decor shots: the inside in daylight)
const port = 5300 + Math.floor(Math.random() * 600);

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 700));
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); else if (/^startScavenge/.test(m.text())) console.log(m.text()); });
    await page.goto(`http://localhost:${port}/?notitle`);
    await page.waitForFunction(() => window.game && document.querySelector('[data-action="begin"]'), null, { timeout: 30000 });
    await page.click('[data-action="begin"]');
    await page.waitForFunction(() => window.game.state.started, null, { timeout: 30000 });
    const setup = await page.evaluate(async ({ lo, hi, site, noon }) => {
      const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js"), C = await import("/src/sim/worldcfg.js"), S = await import("/src/sim/scavenge.js");
      const st = game.state, hub = W.hub(st);
      st.worldCfg = C.cleanCfg({ raidMin: lo, raidMax: hi });
      let t = st.tiles.find((x) => x.id !== hub.tile && x.loc && x.loc.type === site && !st.bases.some((b) => b.tile === x.id));
      if (!t) { t = st.tiles.find((x) => x.id !== hub.tile && x.terrain !== "water" && !x.loc && !st.bases.some((b) => b.tile === x.id)); st.tiles[t.id] = { ...t, loc: { type: site, name: site }, road: false }; t = st.tiles[t.id]; }
      if (noon) st.hour = Math.floor(st.hour / 24) * 24 + 12;
      hub.stock.ammo = 400; hub.stock.food = 100; hub.stock.water = 100; hub.stock.meds = 10;
      const crew = W.atBase(st, hub.id).filter((s) => s.alive).slice(0, 4);
      const r = P.launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 40, meds: 2 } });
      if (!r.party) throw new Error("launch: " + JSON.stringify(r).slice(0, 200));
      const p = r.party;
      p.path = [t.id]; p.idx = 0; p.phase = "engaged";
      game.ui.speed = 0;
      // The raid as startScavenge sets it up, without a point of interest picked (a place of the kind's own map).
      const groups = S.raidEnemies(st, t.id);
      const total = groups.reduce((a, g) => a + g.count, 0);
      game.combat.start({ mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "mixed", count: total, power: 3, name: "the dead", groups }, raid: { heat0: 5, choose: true, poi: null, kind: null, place: null, building: null }, plan: true, context: {} });
      const ret = true;
      const b = st.combat;
      if (!b) console.log("startScavenge:", ret, JSON.stringify({ phase: p.phase, eng: !!st.engagement, autoCombat: st.autoCombat, auto: st.autopilot, poi: p.poi, crew: p.crewRole }));
      return b ? { w: b.w, h: b.h, zones: b.raid ? b.raid.zones.map((z) => z.side) : [], plan: !!(b.setup && b.setup.plan) } : null;
    }, { lo: rawMin, hi: rawMax, site, noon });
    console.log("raid:", JSON.stringify(setup));
    if (!setup) throw new Error("no raid started");
    await page.waitForTimeout(600);
    const plan = path.join(outDir, `plan-${rawMax}.png`);
    await page.screenshot({ path: plan });
    console.log(plan, "title:", await page.evaluate(() => (document.querySelector(".rplanbox h1 + span") || {}).textContent));
    // Go in from the first side offered.
    await page.evaluate(() => document.querySelector('[data-action="cb-plan"][data-v="enter"]:not([disabled])').click());
    await page.waitForTimeout(1200);
    if (show) {
      const placed = await page.evaluate(async () => {
        const T = await import("/tools/isobattles.js"), I = await import("/src/ui/isoview.js"), b = game.state.combat;
        const at = T.showroom(b, 2, 2);
        I.clearIsoCache();
        game.refresh();
        return at;
      });
      console.log("showroom:", placed.length, "pieces");
      // Close up over the showroom, the rows in turn, from two turns of the view.
      const rowsY = [...new Set(placed.map((p) => p.y))];
      for (const [r, turn] of [[0, 0], [1, 2]]) {
        for (let i = 0; i < rowsY.length; i++) {
          await page.evaluate(async ({ y, turn, mid }) => {
            const I = await import("/src/ui/isoview.js"), b = game.state.combat;
            // The team in the aisle under these rows, spread along it, so they see the pieces (the fog); roofs off: the
            // showroom's floor reads as one building.
            const mine = b.units.filter((u) => u.side === "player");
            mine.forEach((u, n) => { const x = Math.max(1, Math.min(b.w - 2, mid - 12 + n * 8)); u.x = x; u.y = y + 2; });
            I.setRoofs(false);
            b.losCache.fill(0);
            for (let g = 0; g < 8 && (I.iso.rot !== turn || I.iso.straight); g++) I.isoRotate(b, 1);
            while (I.iso.zoom < 6) I.isoZoom(b, 1);
            I.isoCenterOn(b, mid, y + 1, false);
            b.rev = (b.rev || 0) + 1;
            game.refresh();
          }, { y: rowsY[i], turn, mid: Math.round(placed.filter((p) => p.y === rowsY[i]).reduce((a, p) => a + p.x, 0) / Math.max(1, placed.filter((p) => p.y === rowsY[i]).length)) });
          await page.waitForTimeout(500);
          const f = path.join(outDir, `furniture-view${r}-rows${i}.png`);
          await page.screenshot({ path: f });
          console.log(f);
        }
      }
    }
    const info = await page.evaluate(async () => {
      const I = await import("/src/ui/isoview.js"), b = game.state.combat;
      const cv = document.querySelector("canvas#battle, #battle canvas, canvas.battle") || [...document.querySelectorAll("canvas")].sort((a, c) => c.width * c.height - a.width * a.height)[0];
      const mine = b.units.filter((u) => u.side === "player");
      return {
        map: `${b.w}x${b.h}`, canvas: cv ? `${cv.clientWidth}x${cv.clientHeight}` : null, zoom: I.iso.zoom, rot: I.iso.rot,
        teamOnScreen: mine.map((u) => I.isoOnScreen(b, u.x, u.y, 0)), enemies: b.units.filter((u) => u.side === "enemy").length,
        enemiesOnScreen: b.units.filter((u) => u.side === "enemy" && I.isoOnScreen(b, u.x, u.y, 0)).length, containers: b.raid.containers.length, areas: b.raid.areas.length,
        heat: b.raid.heat, exitZones: b.raid.zones.map((z) => z.side),
      };
    });
    console.log("battle:", JSON.stringify(info));
    const shot = path.join(outDir, `battle-${rawMax}.png`);
    await page.screenshot({ path: shot });
    console.log(shot);
    // Zoomed all the way out: the whole map?
    const out = await page.evaluate(async () => {
      const I = await import("/src/ui/isoview.js"), b = game.state.combat;
      for (let i = 0; i < 12; i++) I.isoZoom(b, -1);
      game.refresh();
      return { zoom: I.iso.zoom };
    });
    await page.waitForTimeout(500);
    const far = path.join(outDir, `battle-${rawMax}-out.png`);
    await page.screenshot({ path: far });
    console.log(far, JSON.stringify(out));
    // A building's inside (sim/decor.js, issue #13): roofs off (B), zoomed in on its middle, the rugs, the clutter, the
    // wall art and the rooms' colours.
    const inner = await page.evaluate(async () => {
      const I = await import("/src/ui/isoview.js"), b = game.state.combat, B = b.raid && b.raid.plan && b.raid.plan.building;
      if (!B) return null;
      I.setRoofs(false);
      // The team spread over the ground floor's rooms (one in each of the biggest): what they see is drawn, the rest fogged.
      const rooms = b.raid.areas.filter((r) => !r.outdoor && (r.f || 0) === 0).sort((p, q) => q.w * q.h - p.w * p.h);
      b.units.filter((u) => u.side === "player").forEach((u, i) => {
        const r = rooms[i % Math.max(1, rooms.length)];
        if (!r) return;
        for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) if (b.cells[y * b.w + x].k === "open" && !b.units.some((q) => q !== u && q.x === x && q.y === y)) { u.x = x; u.y = y; return; }
      });
      for (const a of b.raid.areas) if (!a.outdoor && a.sw) a.on = true; // the lights on where there is a switch (sim/indoorlight.js)
      if (b.losCache) b.losCache.fill(0);
      b.rev = (b.rev || 0) + 1; // the view's cache (ui/combat.js view) made again: what they see from where they stand now
      I.isoCenterOn(b, B.x0 + Math.floor(B.w / 2), B.y0 + Math.floor(B.h / 2), false);
      for (let i = 0; i < 12; i++) I.isoZoom(b, 1);
      for (let i = 0; i < 2; i++) I.isoZoom(b, -1);
      game.refresh();
      const cells = b.floors ? b.floors.flatMap((F) => F.cells) : b.cells;
      return { zoom: I.iso.zoom, deco: cells.filter((c) => c.deco).length, art: cells.filter((c) => c.wart).length, painted: cells.filter((c) => c.wc).length };
    });
    if (inner) {
      await page.waitForTimeout(500);
      const ins = path.join(outDir, `battle-${rawMax}-inside.png`);
      await page.screenshot({ path: ins });
      console.log(ins, JSON.stringify(inner));
    }
    console.log("page errors:", JSON.stringify(errs.slice(0, 5)));
    await browser.close();
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
