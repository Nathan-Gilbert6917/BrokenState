// The trees by the season in the real game (ui/seasontrees.js), saved as PNGs: an open fight on the forest tile
// nearest the hub in summer, early autumn, late autumn and winter (snow lying), and the State Map round that forest in
// summer, autumn and winter. Usage: NODE_PATH=$(npm root -g) node tools/treeshot.cjs [outdir] [seed]
// Starts the prototype's server on a free port and drives headless Chromium; prints the files it saved.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots", "season-trees"));
const seed = Number(process.argv[3] || 8);
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
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await page.goto(`http://localhost:${port}/?notitle&seed=${seed}`);
    await page.waitForFunction(() => window.game && document.querySelector('[data-action="begin"]'), null, { timeout: 30000 });
    await page.click('[data-action="begin"]');
    await page.waitForFunction(() => window.game.state.started, null, { timeout: 30000 });
    const files = [];
    const shot = async (name, clip) => { const f = path.join(outDir, name); await page.screenshot({ path: f, clip }); files.push(f); };
    // The days: one in each season (day index: day 1 of a campaign is the 15th of spring); winter's with snow lying
    // on the forest tile and statewide (the State Map's snow wash).
    const days = await page.evaluate(async () => {
      const W = await import("/src/sim/world.js"), WX = await import("/src/sim/weather.js"), st = game.state, g = st.grid, hub = W.hub(st);
      game.ui.speed = 0;
      const forest = st.tiles.filter((t) => t.terrain === "forest" && !t.loc).sort((a, b) => g.distance(a.id, hub.tile) - g.distance(b.id, hub.tile))[0];
      let winter = 80;
      for (let d = 72; d < 97; d++) { const w = WX.weatherAt(st, forest.id, d * 24 + 12), tint = WX.weatherTint(st, d * 24 + 12); if (w.snowCover >= 0.4 && tint && tint.startsWith("rgba(235,240,248,")) { winter = d; break; } }
      window.__forest = forest.id;
      return { forest: forest.id, summer: 35, early: 43, autumn: 58, winter };
    });
    console.log("days:", JSON.stringify(days));
    // An open fight on the forest tile, the view zoomed in on the middle of the map.
    for (const [name, d] of [["battle-summer.png", days.summer], ["battle-autumn-early.png", days.early], ["battle-autumn.png", days.autumn], ["battle-winter.png", days.winter]]) {
      const info = await page.evaluate(async (d) => {
        const W = await import("/src/sim/world.js"), C = await import("/src/sim/combat.js"), I = await import("/src/ui/isoview.js"), WX = await import("/src/sim/weather.js");
        const st = game.state, hub = W.hub(st);
        st.combat = null;
        st.hour = d * 24 + 12;
        C.registerCombatHandler("treeshot", () => {});
        const ids = W.atBase(st, hub.id).filter((s) => s.alive).slice(0, 3).map((s) => s.id);
        const b = C.createBattle(st, { tile: window.__forest, baseId: hub.id, fighterIds: ids, enemy: { kind: "zombies", count: 2, power: 3, name: "the dead" }, ambush: null, canRetreat: true, handler: "treeshot", context: {} });
        st.combat = b;
        b.phase = "player";
        game.refresh();
        for (const el of document.querySelectorAll(".tipcard, .newtip, [class*='coach']")) el.remove();
        // The middle of the trees: the cell with the most trees round it.
        let mid = [b.w >> 1, b.h >> 1], best = -1;
        for (let y = 3; y < b.h - 3; y++) for (let x = 3; x < b.w - 3; x++) { let n = 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (b.cells[(y + dy) * b.w + x + dx].k === "tree") n++; if (n > best) { best = n; mid = [x, y]; } }
        I.isoCenterOn(b, mid[0], mid[1], false);
        I.isoZoom(b, 1);
        game.refresh();
        const s = WX.season(st);
        return { season: s.key, day: s.dayOfSeason, trees: b.cells.filter((c) => c.k === "tree").length, bushes: b.cells.filter((c) => c.k === "bush").length, snowLie: b.snowLie || 0, snow: WX.weatherAt(st, window.__forest).snowCover };
      }, d);
      console.log(name, JSON.stringify(info));
      await page.waitForTimeout(700);
      await shot(name);
      // Close up, by your people (in sight: not under the fog of war).
      await page.evaluate(async () => {
        const I = await import("/src/ui/isoview.js"), b = game.state.combat, u = b.units.find((p) => p.side === "player");
        I.isoZoom(b, 1); I.isoZoom(b, 1);
        I.isoCenterOn(b, u.x + 2, u.y, false);
        game.refresh();
      });
      await page.waitForTimeout(700);
      await shot(name.replace(".png", "-close.png"), { x: 250, y: 120, width: 800, height: 560 });
    }
    // The hub's base map (its scatter: bushes, trees, clumps), close in on its bushes (last: its window stays open).
    const baseShots = async () => { for (const [name, d] of [["base-summer.png", days.summer], ["base-autumn.png", days.autumn], ["base-winter.png", days.winter]]) {
      const info = await page.evaluate(async (d) => {
        const UB = await import("/src/ui/basemap.js"), W = await import("/src/sim/world.js"), I = await import("/src/ui/isoview.js");
        const st = game.state, hub = W.hub(st);
        st.combat = null;
        st.hour = d * 24 + 12;
        const err = UB.openBuildMap(st, game.ui, hub.id);
        const b = st.combat;
        let mid = [b.w >> 1, b.h >> 1], best = -1;
        for (let y = 3; y < b.h - 3; y++) for (let x = 3; x < b.w - 3; x++) { let n = 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const k = b.cells[(y + dy) * b.w + x + dx].k; if (k === "bush") n += 2; else if (k === "tree") n++; } if (n > best) { best = n; mid = [x, y]; } }
        window.__mid = mid;
        game.refresh();
        return { err, bushes: b.cells.filter((c) => c.k === "bush").length, trees: b.cells.filter((c) => c.k === "tree").length, snowLie: b.snowLie || 0, mid };
      }, d);
      console.log(name, JSON.stringify(info));
      await page.waitForTimeout(600);
      await page.evaluate(async () => {
        const I = await import("/src/ui/isoview.js"), b = game.state.combat, [x, y] = window.__mid;
        I.isoZoom(b, 2 - I.iso.zoom);
        for (let i = 0; i < 2; i++) I.isoZoom(b, 1);
        I.isoCenterOn(b, x, y, false);
        for (const el of document.querySelectorAll(".tipcard, .newtip, [class*='coach']")) el.remove();
        game.refresh();
      });
      await page.waitForTimeout(600);
      await shot(name, { x: 150, y: 80, width: 900, height: 640 });
    } };
    // The State Map round the forest tile, zoomed in so the decals show.
    const cv = await page.$("#map");
    for (const [name, d] of [["map-summer.png", days.summer], ["map-autumn.png", days.autumn], ["map-winter.png", days.winter]]) {
      await page.evaluate(async (d) => {
        const R = await import("/src/ui/render.js"), st = game.state;
        st.combat = null;
        st.hour = d * 24 + 12;
        R.view.devReveal = true;
        game.refresh();
        R.camera.zoom = 2;
        R.centerOn(st, window.__forest);
        game.refresh();
      }, d);
      await page.waitForTimeout(700);
      const box = await cv.boundingBox();
      const w = Math.min(box.width, 900), h = Math.min(box.height, 600);
      await shot(name, { x: box.x + box.width / 2 - w / 2, y: box.y + box.height / 2 - h / 2, width: w, height: h });
    }
    // Zoomed out, where the forests are their flat colour.
    for (const [name, d] of [["mapfar-autumn.png", days.autumn], ["mapfar-winter.png", days.winter]]) {
      await page.evaluate(async (d) => { const R = await import("/src/ui/render.js"), st = game.state; st.hour = d * 24 + 12; R.camera.zoom = 0.5; R.centerOn(st, window.__forest); game.refresh(); }, d);
      await page.waitForTimeout(700);
      const box = await cv.boundingBox();
      await shot(name, { x: box.x, y: box.y, width: Math.min(box.width, 1100), height: Math.min(box.height, 700) });
    }
    await baseShots();
    console.log(files.join("\n"));
    console.log("page errors:", JSON.stringify(errs.slice(0, 5)));
    await browser.close();
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
