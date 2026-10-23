// Ponds on the State Map and on a pond tile's maps in the real game (sim/mapgen.js tile.pond, the user's words
// 2026-10-23: "add pond decor to the world map when a tile has a pond in the world map generate a pond in the battle
// map"), saved as PNGs: the State Map round a pond tile in summer (and its hover tooltip) and with the ponds frozen in
// winter (ui/terraindeco.js ICE_LOOK); an open fight on that tile, its spring-fed pond waded in summer and ice in
// winter (relief.js, ponds.js); and the hub's Base map view with its tile made a pond tile (basescatter.js SPRING).
// Usage: NODE_PATH=$(npm root -g) node tools/worldpondshot.cjs [outdir] [seed]
// Starts the prototype's server on a free port and drives headless Chromium; prints the files it saved.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots"));
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
    const shot = async (name, clip) => { const f = path.join(outDir, name); await page.screenshot({ path: f, ...(clip ? { clip } : {}) }); files.push(f); };
    // The days: one in summer with the ponds open, one in winter with them frozen.
    const pick = await page.evaluate(async () => {
      const W = await import("/src/sim/world.js"), WX = await import("/src/sim/weather.js"), P = await import("/src/sim/ponds.js"), R = await import("/src/ui/render.js");
      const st = game.state, g = st.grid, hub = W.hub(st);
      game.ui.speed = 0;
      R.view.devReveal = true;
      // A pond tile near the hub with no site, base or hive on it or round it (their clear zones hide the decals).
      const bare = (id) => { const t = st.tiles[id]; return !t.loc && !t.hive && !st.bases.some((b) => b.tile === id); };
      const ponds = st.tiles.filter((t) => t.pond && bare(t.id) && g.neighbors(t.id).every(bare)).sort((a, b) => g.distance(a.id, hub.tile) - g.distance(b.id, hub.tile));
      let summer = null, winter = null;
      for (let d = 1; d < 400 && (summer == null || winter == null); d++) {
        const hr = d * 24 + 12, s = WX.season(st, hr).key;
        if (summer == null && s === "summer" && !P.pondIce(st, d)) summer = d;
        if (winter == null && s === "winter" && P.pondIce(st, d) && WX.iceIndex(st, hr) >= P.PONDS.FREEZE + 4) winter = d;
      }
      return { tile: ponds[0] ? ponds[0].id : null, n: st.tiles.filter((t) => t.pond).length, summer, winter, terrain: ponds[0] ? ponds[0].terrain : null };
    });
    console.log("pick:", JSON.stringify(pick));
    const mapAt = async (d, zoom) => page.evaluate(async ({ d, tile, zoom }) => {
      const R = await import("/src/ui/render.js"), P = await import("/src/sim/ponds.js");
      const st = game.state;
      st.combat = null;
      st.hour = d * 24 + 12;
      R.camera.zoom = zoom;
      R.centerOn(st, tile);
      R.redrawMap(true);
      game.refresh();
      return { ice: P.pondIce(st), word: P.pondTileWord(st, tile) };
    }, { d, tile: pick.tile, zoom });
    const cv = await page.$("#map");
    for (const [name, d] of [["map-ponds-summer.png", pick.summer], ["map-ponds-frozen.png", pick.winter]]) {
      const info = await mapAt(d, 4);
      await page.waitForTimeout(700);
      const box = await cv.boundingBox();
      const w = Math.min(box.width, 640), h = Math.min(box.height, 440);
      await shot(name, { x: box.x + box.width / 2 - w / 2, y: box.y + box.height / 2 - h / 2, width: w, height: h });
      console.log(name, JSON.stringify(info));
    }
    // The tooltip over the pond tile (summer), the whole window.
    await mapAt(pick.summer, 3);
    await page.waitForTimeout(500);
    { const box = await cv.boundingBox(); await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 3); await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2 + 6); }
    await page.waitForTimeout(700);
    await shot("map-pond-tooltip.png");
    await page.mouse.move(5, 5);
    // An open fight on the pond tile: summer (its spring's pond waded) and winter (ice).
    for (const [name, d] of [["fight-pond-summer.png", pick.summer], ["fight-pond-winter.png", pick.winter]]) {
      const info = await page.evaluate(async ({ d, tile }) => {
        const W = await import("/src/sim/world.js"), C = await import("/src/sim/combat.js"), I = await import("/src/ui/isoview.js");
        const st = game.state, hub = W.hub(st);
        st.combat = null;
        st.hour = d * 24 + 12;
        C.registerCombatHandler("worldpondshot", () => {});
        const ids = W.atBase(st, hub.id).filter((s) => s.alive).slice(0, 3).map((s) => s.id);
        const b = C.createBattle(st, { tile, baseId: hub.id, fighterIds: ids, enemy: { kind: "zombies", count: 3, power: 3, name: "the dead" }, ambush: null, canRetreat: true, handler: "worldpondshot", context: {} });
        const spring = [];
        for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.cells[y * b.w + x].spring) spring.push([x, y]);
        const edge = spring.filter(([x, y]) => b.cells[y * b.w + x].wet === "wade" || b.cells[y * b.w + x].wet === "ice");
        const mine = b.units.filter((u) => u.side === "player");
        mine.forEach((u, i) => { const [x, y] = edge[Math.min(edge.length - 1, i * 4)]; u.x = x; u.y = y; });
        st.combat = b;
        b.phase = "player";
        game.refresh();
        const mid = spring[Math.floor(spring.length / 2)];
        I.isoCenterOn(b, mid[0], mid[1], false);
        for (let i = 0; i < 2; i++) I.isoZoom(b, 1);
        game.refresh();
        const kinds = {};
        for (const c of b.cells) if (c.spring) kinds[c.wet + (c.k === "water" ? "(water)" : "")] = (kinds[c.wet + (c.k === "water" ? "(water)" : "")] || 0) + 1;
        return { map: `${b.w}x${b.h}`, spring: spring.length, kinds, snow: b.snowLie || 0 };
      }, { d, tile: pick.tile });
      console.log(name, JSON.stringify(info));
      await page.waitForTimeout(800);
      await shot(name);
    }
    // The hub's Base map view with its tile a pond tile: the spring's pond in the yard's margin.
    const base = await page.evaluate(async ({ d }) => {
      const W = await import("/src/sim/world.js"), UB = await import("/src/ui/basemap.js");
      const st = game.state, hub = W.hub(st);
      st.combat = null;
      st.hour = d * 24 + 12;
      st.tiles[hub.tile].pond = true;
      delete hub.ponds;
      const err = UB.openBuildMap(st, game.ui, hub.id);
      const b = st.combat, spring = [];
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.cells[y * b.w + x].spring) spring.push([x, y]);
      window.__springMid = spring[Math.floor(spring.length / 2)];
      game.refresh();
      return { err, map: `${b.w}x${b.h}`, spring: spring.length, wet: b.cells.filter((c) => c.spring && c.wet).length };
    }, { d: pick.summer });
    console.log("base:", JSON.stringify(base));
    await page.waitForTimeout(600);
    await page.evaluate(async () => {
      const I = await import("/src/ui/isoview.js"), b = game.state.combat, [x, y] = window.__springMid;
      I.isoZoom(b, 2 - I.iso.zoom);
      for (let i = 0; i < 2; i++) I.isoZoom(b, 1);
      I.isoCenterOn(b, x, y, false);
      for (const el of document.querySelectorAll(".tipcard, .newtip, [class*='coach']")) el.remove();
      game.refresh();
    });
    await page.waitForTimeout(600);
    await shot("base-pond.png");
    console.log(files.join("\n"));
    console.log("page errors:", JSON.stringify(errs.slice(0, 5)));
    await browser.close();
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
