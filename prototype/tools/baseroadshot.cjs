// The hub's base map in the real game (a road through it), saved as PNGs: the Base map view as the game opens it,
// zoomed in on the road, and a raid on it (the battle map built from the base map). Usage:
//   NODE_PATH=$(npm root -g) node tools/baseroadshot.cjs [outdir] [seed]
// Starts the prototype's server on a free port and drives headless Chromium; prints the files it saved.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots"));
const seed = Number(process.argv[3] || 42);
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
    const info = await page.evaluate(async () => {
      const UB = await import("/src/ui/basemap.js"), W = await import("/src/sim/world.js");
      const st = game.state, hub = W.hub(st), t = st.tiles[hub.tile];
      game.ui.speed = 0;
      const err = UB.openBuildMap(st, game.ui, hub.id);
      game.refresh();
      return { err, road: !!t.road, terrain: t.terrain, name: hub.name };
    });
    console.log("base:", JSON.stringify(info));
    await page.waitForTimeout(800);
    const files = [];
    const shot = async (name) => { const f = path.join(outDir, name); await page.screenshot({ path: f }); files.push(f); };
    await shot("basemap.png");
    // On the road, away from the middle: a road cell a third of the way out (else the middle).
    await page.evaluate(async () => {
      const I = await import("/src/ui/isoview.js"), b = game.state.combat;
      let at = [b.w >> 1, b.h >> 1];
      for (let d = Math.floor(b.w / 3); d > 0 && at[0] === b.w >> 1; d--) for (const [x, y] of [[(b.w >> 1) + d, b.h >> 1], [b.w >> 1, (b.h >> 1) + d]]) if (b.cells[y * b.w + x].f === "road") { at = [x, y]; break; }
      I.isoCenterOn(b, at[0], at[1], false);
      for (let i = 0; i < 3; i++) I.isoZoom(b, 1);
      game.refresh();
    });
    await page.waitForTimeout(500);
    await shot("basemap-zoom.png");
    await page.evaluate(async () => { const I = await import("/src/ui/isoview.js"), b = game.state.combat; I.isoRotate(b, 1); game.refresh(); });
    await page.waitForTimeout(500);
    await shot("basemap-turn.png");
    console.log(files.join("\n"));
    console.log("page errors:", JSON.stringify(errs.slice(0, 5)));
    await browser.close();
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
