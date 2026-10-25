// A raid on a big map in the real game (World… Raid map dials), saved as PNGs and measured: the Before you go in window
// with the map's size, then the battle screen as the team goes in, and the camera (zoom, whether your people are on
// screen, how much of the map shows). Usage: NODE_PATH=$(npm root -g) node tools/raidshot.cjs [outdir] [raidMin raidMax] [site]
// e.g. raidshot.cjs /tmp/shots 80 80 farm (a street map 80 × 60) or 80 80 hospital (a building's map). Starts the
// prototype's server on a free port and drives headless Chromium; prints one JSON line a shot. A 6th argument "scene":
// then the team is set in a barricaded room (or another scene) of the building and the view centred on it (scene.png).
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots"));
const [rawMin, rawMax] = [Number(process.argv[3] || 80), Number(process.argv[4] || 80)];
const site = process.argv[5] || "farm";
const wantScene = process.argv[6] === "scene"; // a building's signs of survival (sim/interiorscenes.js): the team set in a scene's room, the view on it (scene.png)
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
    const setup = await page.evaluate(async ({ lo, hi, site }) => {
      const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js"), C = await import("/src/sim/worldcfg.js"), S = await import("/src/sim/scavenge.js");
      const st = game.state, hub = W.hub(st);
      st.worldCfg = C.cleanCfg({ raidMin: lo, raidMax: hi });
      let t = st.tiles.find((x) => x.id !== hub.tile && x.loc && x.loc.type === site && !st.bases.some((b) => b.tile === x.id));
      if (!t) { t = st.tiles.find((x) => x.id !== hub.tile && x.terrain !== "water" && !x.loc && !st.bases.some((b) => b.tile === x.id)); st.tiles[t.id] = { ...t, loc: { type: site, name: site }, road: false }; t = st.tiles[t.id]; }
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
    }, { lo: rawMin, hi: rawMax, site });
    console.log("raid:", JSON.stringify(setup));
    if (!setup) throw new Error("no raid started");
    await page.waitForTimeout(600);
    const plan = path.join(outDir, `plan-${rawMax}.png`);
    await page.screenshot({ path: plan });
    console.log(plan, "title:", await page.evaluate(() => (document.querySelector(".rplanbox h1 + span") || {}).textContent));
    // Go in from the first side offered.
    await page.evaluate(() => document.querySelector('[data-action="cb-plan"][data-v="enter"]').click());
    await page.waitForTimeout(1200);
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
    if (wantScene) {
      const scene = await page.evaluate(async () => {
        const C = await import("/src/sim/combat.js"), b = game.state.combat;
        const L = (b.raid.scenes && b.raid.scenes.list) || [];
        const s = L.find((q) => q.kind === "barricade" && !q.alive) || L.find((q) => q.kind === "overrun") || L[0];
        if (!s) return null;
        const r = b.raid.areas.find((a) => a.id === s.room);
        C.setFloor(b, s.f);
        const cells = b.cells, mine = b.units.filter((u) => u.side === "player");
        const spots = [];
        if (r) for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) if (cells[y * b.w + x].k === "open" && !b.units.some((u) => u.x === x && u.y === y && (u.f || 0) === s.f)) spots.push([x, y]);
        mine.forEach((u, i) => { const p = spots[i] || spots[0]; if (p) { u.x = p[0]; u.y = p[1]; u.f = s.f; u.away = false; } });
        for (const u of b.units) if (u.side === "enemy" && (u.f || 0) === s.f && r && u.x >= r.x0 && u.x < r.x0 + r.w && u.y >= r.y0 && u.y < r.y0 + r.h) u.x = -50;
        document.querySelectorAll(".tipbox, .coach, [data-action='coach-close']").forEach((e) => e.remove && e.remove());
        const I = await import("/src/ui/isoview.js");
        for (let i = 0; i < 6; i++) I.isoZoom(b, 1); // back in from the zoomed-out shot
        I.isoCenterOn(b, s.x, s.y, false);
        game.refresh();
        return { kind: s.kind, text: s.text, f: s.f, door: [s.x, s.y], cell: cells[s.y * b.w + s.x].k, blood: cells.filter((c) => c.blood).length };
      });
      console.log("scene:", JSON.stringify(scene));
      await page.waitForTimeout(800);
      await page.evaluate(() => game.refresh());
      await page.waitForTimeout(500);
      const sceneShot = path.join(outDir, "scene.png");
      await page.screenshot({ path: sceneShot });
      console.log(sceneShot);
    }
    console.log("page errors:", JSON.stringify(errs.slice(0, 5)));
    await browser.close();
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
