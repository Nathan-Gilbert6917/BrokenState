// The hollows' ponds, mud and ice in the real game (sim/ponds.js), saved as PNGs: the hub's Base map view centred on a
// hollow with its hollows a pond, mud and a frozen pond (base.ponds set), the frozen one in winter with snow lying on
// the banks; and an open fight on a hills tile on a wet day (its ponds by the tile's own weather, your people at the
// edge). Usage: NODE_PATH=$(npm root -g) node tools/pondshot.cjs [outdir] [seed]
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
    // A new game until the hub's base map has a hollow in view (a few tries: not every tile has one).
    for (let tries = 0; tries < 10; tries++) {
      await page.goto(`http://localhost:${port}/?notitle&seed=${seed + tries}`);
      await page.waitForFunction(() => window.game && document.querySelector('[data-action="begin"]'), null, { timeout: 30000 });
      await page.click('[data-action="begin"]');
      await page.waitForFunction(() => window.game.state.started, null, { timeout: 30000 });
      const n = await page.evaluate(async () => {
        const UB = await import("/src/ui/basemap.js"), W = await import("/src/sim/world.js"), st = game.state;
        UB.openBuildMap(st, game.ui, W.hub(st).id);
        const k = st.combat ? st.combat.cells.filter((c) => c.ter && c.h < 0).length : 0;
        st.combat = null;
        return k;
      });
      console.log("try", tries, "hollow cells in the hub's view:", n);
      if (n >= 40) break;
    }
    const files = [];
    const shot = async (name) => { const f = path.join(outDir, name); await page.screenshot({ path: f }); files.push(f); };
    // The hub's base map, its hollows in each state; the view centred on the biggest hollow's middle, zoomed in.
    for (const [name, ponds, winter] of [["base-pond.png", { dry: 0, ice: false }, false], ["base-mud.png", { dry: 4, ice: false }, false], ["base-ice.png", { dry: 0, ice: true }, true]]) {
      const info = await page.evaluate(async ({ ponds, winter }) => {
        const UB = await import("/src/ui/basemap.js"), W = await import("/src/sim/world.js"), WX = await import("/src/sim/weather.js"), I = await import("/src/ui/isoview.js");
        const st = game.state, hub = W.hub(st);
        game.ui.speed = 0;
        if (st.combat) st.combat = null;
        if (winter) for (let d = 70; d < 140; d++) { const w = WX.weatherAt(st, hub.tile, d * 24 + 12); if (WX.season(st, d * 24 + 12).key === "winter" && w.snowCover >= 0.6) { st.hour = d * 24 + 12; break; } }
        hub.ponds = { d: WX.dayIndex(st), ...ponds };
        const err = UB.openBuildMap(st, game.ui, hub.id);
        const b = st.combat;
        const cells = [];
        for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { const c = b.cells[y * b.w + x]; if (c.ter && c.h < 0) cells.push([x, y]); }
        // The hollow cell with the most hollow round it (the middle of the biggest).
        const inH = new Set(cells.map(([x, y]) => y * b.w + x));
        let mid = [b.w >> 1, b.h >> 1], best = -1;
        for (const [x, y] of cells) { let n = 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (inH.has((y + dy) * b.w + x + dx)) n++; if (n > best) { best = n; mid = [x, y]; } }
        window.__pondMid = mid;
        game.refresh();
        const kinds = {};
        for (const c of b.cells) if (c.wet) kinds[c.wet + (c.k === "water" ? "(water)" : "")] = (kinds[c.wet + (c.k === "water" ? "(water)" : "")] || 0) + 1;
        return { err, hollow: cells.length, mid, kinds, snow: b.snowLie || 0, climbX: b.climbX || 1, day: WX.dayIndex(st) + 1 };
      }, { ponds, winter });
      console.log(name, JSON.stringify(info));
      await page.waitForTimeout(600);
      // The camera once the view has opened (its first frame sets its own).
      await page.evaluate(async () => {
        const I = await import("/src/ui/isoview.js"), b = game.state.combat, [x, y] = window.__pondMid;
        I.isoZoom(b, 2 - I.iso.zoom); // back to the middle zoom, then in
        for (let i = 0; i < 3; i++) I.isoZoom(b, 1);
        I.isoCenterOn(b, x, y, false);
        for (const el of document.querySelectorAll(".tipcard, .newtip, [class*='coach']")) el.remove(); // the first-time hint over the view
        game.refresh();
      });
      await page.waitForTimeout(600);
      await shot(name);
    }
    // An open fight on a hills tile with hollows, on a day its hollows hold water.
    const fight = await page.evaluate(async () => {
      const W = await import("/src/sim/world.js"), C = await import("/src/sim/combat.js"), P = await import("/src/sim/ponds.js"), I = await import("/src/ui/isoview.js");
      const st = game.state, hub = W.hub(st);
      st.combat = null;
      C.registerCombatHandler("pondshot", () => {});
      const ids = W.atBase(st, hub.id).filter((s) => s.alive).slice(0, 3).map((s) => s.id);
      for (let d = 20; d < 70; d++) {
        st.hour = d * 24 + 12;
        for (const t of st.tiles.filter((x) => x.terrain === "hills")) {
          if (!P.cellWet(P.pondsOn(st, t.id, d), 1)) continue;
          const b = C.createBattle(st, { tile: t.id, baseId: hub.id, fighterIds: ids, enemy: { kind: "zombies", count: 3, power: 3, name: "the dead" }, ambush: null, canRetreat: true, handler: "pondshot", context: {} });
          if (!b.cells.some((c) => c.k === "water" && c.wet)) continue;
          // Your people at the pond's edge: one wading in it.
          const wade = [];
          for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.cells[y * b.w + x].wet === "wade") wade.push([x, y]);
          const mine = b.units.filter((u) => u.side === "player");
          mine.forEach((u, i) => { const [x, y] = wade[Math.min(wade.length - 1, i * 3)]; u.x = x; u.y = y; });
          st.combat = b;
          b.phase = "player";
          game.refresh();
          I.isoCenterOn(b, wade[0][0], wade[0][1], false);
          for (let i = 0; i < 2; i++) I.isoZoom(b, 1);
          game.refresh();
          return { tile: t.id, day: d + 1, map: `${b.w}x${b.h}`, wade: wade.length, water: b.cells.filter((c) => c.k === "water" && c.wet).length, climbX: b.climbX || 1 };
        }
      }
      return null;
    });
    console.log("fight:", JSON.stringify(fight));
    await page.waitForTimeout(800);
    if (fight) await shot("fight-pond.png");
    console.log(files.join("\n"));
    console.log("page errors:", JSON.stringify(errs.slice(0, 5)));
    await browser.close();
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
